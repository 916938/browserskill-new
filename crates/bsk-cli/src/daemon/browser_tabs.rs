use std::sync::Arc;
use std::time::Duration;

use bsk_protocol::browser_tabs::{
    BrowserTabsCreateParams, BrowserTabsListParams, BrowserTabsObserveParams,
    BrowserTabsObserveResult, BrowserTabsSelectParams, MAX_OBSERVE_BYTES, MAX_OBSERVE_CHARS,
};
use bsk_protocol::{ErrorCode, Frame, Method, RequestFrame, ResponseBody, RpcError, RpcId};
use serde_json::Value;

use super::browsers::{BrowserClient, BrowserId};
use super::state::DaemonState;

fn error(code: ErrorCode, message: impl Into<String>) -> RpcError {
    RpcError {
        code,
        message: message.into(),
        data: None,
    }
}

pub(crate) fn validate_url(value: &str, origin_only: bool) -> Result<(), String> {
    let url = reqwest::Url::parse(value).map_err(|_| "invalid HTTP(S) URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || value.trim() != value
        || value.chars().any(|c| c.is_control() || c == ' ')
        || !value
            .to_ascii_lowercase()
            .starts_with(&format!("{}://", url.scheme()))
        || value.contains('\\')
        || value.split_once("://").is_some_and(|(_, rest)| {
            rest.split(['/', '?', '#'])
                .next()
                .is_some_and(|authority| authority.contains('@'))
        })
    {
        return Err("only absolute HTTP(S) URLs without credentials are allowed".into());
    }
    if origin_only && (url.path() != "/" || url.query().is_some() || url.fragment().is_some()) {
        return Err(
            "expected-origin must be an HTTP(S) origin, without path, query or fragment".into(),
        );
    }
    Ok(())
}

fn prepare(method: &Method, params: Value) -> Result<(String, Value), RpcError> {
    let invalid = |e: serde_json::Error| error(ErrorCode::InvalidParams, e.to_string());
    let (id, payload) = match method {
        Method::BrowserTabsList => {
            let p: BrowserTabsListParams = serde_json::from_value(params).map_err(invalid)?;
            (
                p.browser_id.clone(),
                serde_json::to_value(p).map_err(invalid)?,
            )
        }
        Method::BrowserTabsSelect => {
            let p: BrowserTabsSelectParams = serde_json::from_value(params).map_err(invalid)?;
            if p.tab_id <= 0 || p.tab_id > 9_007_199_254_740_991 {
                return Err(error(
                    ErrorCode::InvalidParams,
                    "tab_id must be a positive safe integer",
                ));
            }
            if let Some(origin) = &p.expected_origin {
                validate_url(origin, true).map_err(|e| error(ErrorCode::InvalidParams, e))?;
            }
            (
                p.browser_id.clone(),
                serde_json::to_value(p).map_err(invalid)?,
            )
        }
        Method::BrowserTabsObserve => {
            let p: BrowserTabsObserveParams = serde_json::from_value(params).map_err(invalid)?;
            if p.tab_id <= 0
                || p.tab_id > 9_007_199_254_740_991
                || p.max_chars == 0
                || p.max_chars > MAX_OBSERVE_CHARS
            {
                return Err(error(
                    ErrorCode::InvalidParams,
                    "invalid tab_id or max_chars",
                ));
            }
            validate_url(&p.expected_origin, true)
                .map_err(|e| error(ErrorCode::InvalidParams, e))?;
            (
                p.browser_id.clone(),
                serde_json::to_value(p).map_err(invalid)?,
            )
        }
        Method::BrowserTabsCreate => {
            let p: BrowserTabsCreateParams = serde_json::from_value(params).map_err(invalid)?;
            validate_url(&p.url, false).map_err(|e| error(ErrorCode::InvalidParams, e))?;
            (
                p.browser_id.clone(),
                serde_json::to_value(p).map_err(invalid)?,
            )
        }
        _ => return Err(error(ErrorCode::UnknownMethod, "not a browser.tabs method")),
    };
    if id.trim().is_empty() {
        return Err(error(
            ErrorCode::InvalidParams,
            "browser_id must not be empty",
        ));
    }
    Ok((id, payload))
}

fn validate_observe_result(
    value: Value,
    params: &BrowserTabsObserveParams,
) -> Result<Value, RpcError> {
    let invalid = || {
        error(
            ErrorCode::ProtocolError,
            "invalid browser.tabs.observe response",
        )
    };
    let result: BrowserTabsObserveResult = serde_json::from_value(value).map_err(|_| invalid())?;
    let origin = reqwest::Url::parse(&params.expected_origin)
        .map_err(|_| invalid())?
        .origin()
        .ascii_serialization();
    if result.browser_id != params.browser_id
        || result.tab_id != params.tab_id
        || result.window_id <= 0
        || result.window_id > 9_007_199_254_740_991
        || result.origin != origin
        || result.document_id.is_empty()
        || result.document_id.len() > 128
        || !result
            .document_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        || result.text.chars().count() > params.max_chars as usize
        || result.text.len() > MAX_OBSERVE_BYTES
    {
        return Err(invalid());
    }
    serde_json::to_value(result).map_err(|_| invalid())
}

// 只注册独立白名单方法；不允许把调用者的任意 RPC 转发给扩展。
pub(super) async fn handle(
    state: &Arc<DaemonState>,
    rpc_id: RpcId,
    method: Method,
    params: Value,
) -> Result<Value, RpcError> {
    let (id, payload) = prepare(&method, params)?;
    let observe: Option<BrowserTabsObserveParams> = if method == Method::BrowserTabsObserve {
        Some(
            serde_json::from_value(payload.clone())
                .map_err(|_| error(ErrorCode::InvalidParams, "invalid observe params"))?,
        )
    } else {
        None
    };
    let client = state.browsers.get(&BrowserId(id)).ok_or_else(|| {
        error(
            ErrorCode::NotFound,
            "exact browser instance id not connected",
        )
    })?;
    let abort = state
        .abort_registry
        .register(rpc_id)
        .map_err(|_| error(ErrorCode::InvalidParams, "duplicate rpc id"))?;
    let ws_id = format!("browser-tabs-{}", uuid::Uuid::new_v4());
    let waiter = client.pending.lock().unwrap().register(ws_id.clone());
    let mut cleanup = PendingCleanup {
        client: client.clone(),
        id: ws_id.clone(),
        cancel: true,
    };
    client
        .sink
        .send(Frame::Request(RequestFrame {
            id: ws_id,
            method,
            params: Some(payload),
        }))
        .map_err(|_| error(ErrorCode::ProtocolError, "browser disconnected"))?;
    let response = tokio::select! {
        biased;
        _ = abort.token().cancelled() => return Err(error(ErrorCode::Cancelled, "browser tabs request cancelled")),
        result = waiter => result.map_err(|_| error(ErrorCode::ProtocolError, "browser disconnected"))?,
        _ = client.sink.tx.closed() => return Err(error(ErrorCode::ProtocolError, "browser disconnected")),
        _ = tokio::time::sleep(Duration::from_secs(15)) => return Err(error(ErrorCode::Timeout, "browser tabs request timed out")),
    };
    if state
        .browsers
        .get(&client.id)
        .is_none_or(|current| current.generation != client.generation)
    {
        return Err(error(
            ErrorCode::ProtocolError,
            "browser connection changed",
        ));
    }
    cleanup.cancel = false;
    match response.body {
        ResponseBody::Ok(value) => match observe {
            Some(params) => validate_observe_result(value, &params),
            None => Ok(value),
        },
        ResponseBody::Err(err) => Err(err),
    }
}

// 超时、断连和任务取消都清理 waiter，并通知原连接停止后续动作，不重试创建。
struct PendingCleanup {
    client: Arc<BrowserClient>,
    id: RpcId,
    cancel: bool,
}

impl Drop for PendingCleanup {
    fn drop(&mut self) {
        self.client.pending.lock().unwrap().cancel(&self.id);
        if self.cancel {
            let _ = self.client.sink.send(Frame::Request(RequestFrame {
                id: format!("cancel-{}", self.id),
                method: Method::Cancel,
                params: Some(serde_json::json!({ "rpc_id": self.id })),
            }));
        }
    }
}
