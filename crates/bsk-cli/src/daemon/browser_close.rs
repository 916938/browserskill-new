//! `browser.close` — stop every session of a connected browser and close
//! all of its windows so the browser process exits.
//!
//! The extension closes its own windows from the inside; the daemon only
//! routes the RPC and interprets the outcome. Because closing the last
//! window kills the browser (and with it the extension's WebSocket), a
//! reply is not guaranteed: a dropped connection or a timeout is
//! reported as success **only** when the instance has actually left the
//! registry. Otherwise the call fails with `timeout` — a browser that is
//! still connected was, by definition, not closed.

use std::sync::Arc;
use std::time::Duration;

use bsk_protocol::browser::{BrowserCloseParams, BrowserCloseResult};
use bsk_protocol::{ErrorCode, Frame, Method, RequestFrame, ResponseBody, RpcError, RpcId};
use serde_json::Value;

use super::browsers::{BrowserClient, BrowserId};
use super::state::DaemonState;

/// Longer than the `browser.tabs` budget: the extension has to stop every
/// session (closing an Agent Window each) before it starts closing the
/// remaining windows.
const BROWSER_CLOSE_TIMEOUT: Duration = Duration::from_secs(20);

/// Grace period for the WS teardown to remove the browser from the
/// registry after its socket died.
const DISCONNECT_SETTLE: Duration = Duration::from_millis(400);
const DISCONNECT_POLL: Duration = Duration::from_millis(20);

fn error(code: ErrorCode, message: impl Into<String>) -> RpcError {
    RpcError {
        code,
        message: message.into(),
        data: None,
    }
}

pub(crate) async fn handle(
    state: &Arc<DaemonState>,
    rpc_id: RpcId,
    params: Value,
) -> Result<Value, RpcError> {
    let invalid = |e: serde_json::Error| error(ErrorCode::InvalidParams, e.to_string());
    let p: BrowserCloseParams = serde_json::from_value(params).map_err(invalid)?;
    if p.browser_id.trim().is_empty() {
        return Err(error(
            ErrorCode::InvalidParams,
            "browser_id must not be empty",
        ));
    }
    // Defense in depth: the CLI also requires `--confirm`, but a raw IPC
    // peer must not be able to quit a browser without acknowledging it.
    if !p.confirm {
        return Err(error(
            ErrorCode::InvalidParams,
            "browser.close requires confirm=true: closing a browser quits the process and discards unsaved state",
        ));
    }

    let client = state
        .browsers
        .get(&BrowserId(p.browser_id.clone()))
        .ok_or_else(|| {
            error(
                ErrorCode::NotFound,
                "exact browser instance id not connected",
            )
        })?;
    let abort = state
        .abort_registry
        .register(rpc_id)
        .map_err(|_| error(ErrorCode::InvalidParams, "duplicate rpc id"))?;
    let ws_id = format!("browser-close-{}", uuid::Uuid::new_v4());
    let waiter = client.pending.lock().unwrap().register(ws_id.clone());
    // No `cancel` frame: once the browser starts closing, a cancel would
    // race with the process exiting. The guard only unregisters the
    // waiter on every early-return path.
    let cleanup = PendingCleanup {
        client: client.clone(),
        id: ws_id.clone(),
    };
    client
        .sink
        .send(Frame::Request(RequestFrame {
            id: ws_id,
            method: Method::BrowserClose,
            params: Some(serde_json::to_value(&p).map_err(invalid)?),
        }))
        .map_err(|_| error(ErrorCode::ProtocolError, "browser disconnected"))?;

    let response = tokio::select! {
        biased;
        _ = abort.token().cancelled() => {
            return Err(error(ErrorCode::Cancelled, "browser close cancelled"));
        }
        result = waiter => match result {
            Ok(frame) => frame,
            Err(_) => return disconnected_or_fail(state, &p.browser_id).await,
        },
        _ = client.sink.tx.closed() => return disconnected_or_fail(state, &p.browser_id).await,
        _ = tokio::time::sleep(BROWSER_CLOSE_TIMEOUT) => {
            return disconnected_or_fail(state, &p.browser_id).await;
        }
    };
    drop(cleanup);

    if state
        .browsers
        .get(&client.id)
        .is_none_or(|current| current.generation != client.generation)
    {
        // The connection was replaced mid-flight; treat it like a drop
        // rather than trusting a stale peer's payload.
        return disconnected_or_fail(state, &p.browser_id).await;
    }
    match response.body {
        ResponseBody::Ok(value) => {
            let result: BrowserCloseResult = serde_json::from_value(value)
                .map_err(|_| error(ErrorCode::ProtocolError, "invalid browser.close response"))?;
            if result.browser_id != p.browser_id {
                return Err(error(
                    ErrorCode::ProtocolError,
                    "browser.close response echoed a different browser_id",
                ));
            }
            Ok(serde_json::to_value(result).unwrap_or(Value::Null))
        }
        ResponseBody::Err(err) => Err(err),
    }
}

/// The socket died or the reply never arrived. That is the *expected*
/// outcome of a successful close (the browser is gone), so report
/// success — but only once the instance has really left the registry.
async fn disconnected_or_fail(
    state: &Arc<DaemonState>,
    browser_id: &str,
) -> Result<Value, RpcError> {
    let mut waited = Duration::ZERO;
    loop {
        if state
            .browsers
            .get(&BrowserId(browser_id.to_string()))
            .is_none()
        {
            let result = BrowserCloseResult {
                browser_id: browser_id.to_string(),
                closed: true,
                windows_closed: 0,
                sessions_stopped: 0,
                disconnected: true,
            };
            return Ok(serde_json::to_value(result).unwrap_or(Value::Null));
        }
        if waited >= DISCONNECT_SETTLE {
            return Err(error(
                ErrorCode::Timeout,
                "browser.close did not complete: browser is still connected",
            ));
        }
        tokio::time::sleep(DISCONNECT_POLL).await;
        waited += DISCONNECT_POLL;
    }
}

/// Unregisters the pending waiter on every early-return path.
struct PendingCleanup {
    client: Arc<BrowserClient>,
    id: RpcId,
}

impl Drop for PendingCleanup {
    fn drop(&mut self) {
        self.client.pending.lock().unwrap().cancel(&self.id);
    }
}
