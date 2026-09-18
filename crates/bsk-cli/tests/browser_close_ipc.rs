//! `browser.close` daemon routing: strict validation, happy path, and the
//! "browser died while closing" outcome (reported as success).

use std::path::PathBuf;
use std::sync::{Arc, Mutex, atomic::AtomicBool};
use std::time::{Duration, Instant};

use bsk::daemon::browsers::{
    BrowserClient, BrowserId, BrowserSink, Pending, next_browser_generation,
};
use bsk::daemon::ipc::{DaemonStatus, RpcHandler, full_handler};
use bsk::daemon::{DaemonConfig, DaemonState};
use bsk_protocol::{ErrorCode, Frame, Method, ResponseBody, ResponseFrame};
use serde_json::{Value, json};
use tokio::sync::mpsc;

fn fixture() -> (
    Arc<DaemonState>,
    RpcHandler,
    Arc<BrowserClient>,
    mpsc::UnboundedReceiver<Frame>,
) {
    let state = Arc::new(DaemonState::new(DaemonConfig::new(0)));
    let (tx, rx) = mpsc::unbounded_channel();
    let browser = Arc::new(BrowserClient {
        id: BrowserId("exact-edge".into()),
        browser_name: "edge".into(),
        browser_version: "130".into(),
        extension_version: "0.2.3".into(),
        extension_protocol_version: "1.1".into(),
        label: "Daily Edge".into(),
        profile_account_id: String::new(),
        sink: BrowserSink { tx },
        pending: Mutex::new(Pending::default()),
        generation: next_browser_generation(),
        connected_at_ms: 0,
        version_skew: false,
        last_seen: Mutex::new(Instant::now()),
        heartbeat_seen: AtomicBool::new(false),
    });
    state.browsers.insert(browser.clone());
    let handler = full_handler(
        DaemonStatus {
            started_at: Instant::now(),
            ws_port: 0,
            sock_path: PathBuf::new(),
            daemon_version: "0.2.3",
            protocol_version: "1.1",
        },
        state.clone(),
    );
    (state, handler, browser, rx)
}

fn assert_error(body: ResponseBody, code: ErrorCode) {
    match body {
        ResponseBody::Err(error) => assert_eq!(error.code, code),
        other => panic!("expected error, got {other:?}"),
    }
}

#[tokio::test]
async fn browser_close_validates_before_forwarding() {
    let (state, handler, _, mut rx) = fixture();
    // Missing / false confirm — closing a browser must never be implicit.
    assert_error(
        handler(
            "no-confirm".into(),
            Method::BrowserClose,
            json!({"browser_id":"exact-edge"}),
        )
        .await,
        ErrorCode::InvalidParams,
    );
    assert_error(
        handler(
            "false-confirm".into(),
            Method::BrowserClose,
            json!({"browser_id":"exact-edge","confirm":false}),
        )
        .await,
        ErrorCode::InvalidParams,
    );
    assert_error(
        handler(
            "blank-id".into(),
            Method::BrowserClose,
            json!({"browser_id":" ","confirm":true}),
        )
        .await,
        ErrorCode::InvalidParams,
    );
    // An id that only matches the label, or another instance entirely.
    for browser_id in ["Daily Edge", "other-edge"] {
        assert_error(
            handler(
                "bad-id".into(),
                Method::BrowserClose,
                json!({"browser_id":browser_id,"confirm":true}),
            )
            .await,
            ErrorCode::NotFound,
        );
    }
    // Nothing reached the extension and no waiter leaked.
    assert!(rx.try_recv().is_err());
    assert!(state.abort_registry.is_empty());
}

#[tokio::test]
async fn browser_close_round_trips_extension_result() {
    let (state, handler, browser, mut rx) = fixture();
    let params = json!({"browser_id":"exact-edge","confirm":true});
    let result = json!({
        "browser_id":"exact-edge",
        "closed":true,
        "windows_closed":2,
        "sessions_stopped":1,
        "disconnected":false
    });
    let task = tokio::spawn(handler(
        "close".into(),
        Method::BrowserClose,
        params.clone(),
    ));
    let Frame::Request(request) = rx.recv().await.unwrap() else {
        panic!("request")
    };
    assert_eq!(request.method, Method::BrowserClose);
    assert_eq!(request.params.unwrap(), params);
    browser.pending.lock().unwrap().resolve(ResponseFrame {
        id: request.id,
        body: ResponseBody::Ok(result.clone()),
    });
    match task.await.unwrap() {
        ResponseBody::Ok(value) => assert_eq!(value, result),
        other => panic!("{other:?}"),
    }
    assert!(state.abort_registry.is_empty());
    assert!(rx.try_recv().is_err());
}

#[tokio::test]
async fn browser_close_rejects_mismatched_echo() {
    let (_, handler, browser, mut rx) = fixture();
    let task = tokio::spawn(handler(
        "echo".into(),
        Method::BrowserClose,
        json!({"browser_id":"exact-edge","confirm":true}),
    ));
    let Frame::Request(request) = rx.recv().await.unwrap() else {
        panic!("request")
    };
    browser.pending.lock().unwrap().resolve(ResponseFrame {
        id: request.id,
        body: ResponseBody::Ok(json!({
            "browser_id":"someone-else",
            "closed":true,
            "windows_closed":1,
            "sessions_stopped":0,
            "disconnected":false
        })),
    });
    assert_error(task.await.unwrap(), ErrorCode::ProtocolError);
}

#[tokio::test]
async fn browser_close_disconnect_is_reported_as_closed() {
    let (state, handler, browser, mut rx) = fixture();
    let task = tokio::spawn(handler(
        "disconnect".into(),
        Method::BrowserClose,
        json!({"browser_id":"exact-edge","confirm":true}),
    ));
    assert!(matches!(rx.recv().await.unwrap(), Frame::Request(_)));
    // The extension closes the last window and the browser exits: the WS
    // dies before any reply can be written.
    state.browsers.remove(&browser.id);
    drop(rx);
    match task.await.unwrap() {
        ResponseBody::Ok(value) => assert_eq!(
            value,
            json!({
                "browser_id":"exact-edge",
                "closed":true,
                "windows_closed":0,
                "sessions_stopped":0,
                "disconnected":true
            })
        ),
        other => panic!("{other:?}"),
    }
    assert!(state.abort_registry.is_empty());
}

#[tokio::test]
async fn browser_close_reports_timeout_when_instance_survives() {
    let (state, handler, _browser, mut rx) = fixture();
    let task = tokio::spawn(handler(
        "survives".into(),
        Method::BrowserClose,
        json!({"browser_id":"exact-edge","confirm":true}),
    ));
    assert!(matches!(rx.recv().await.unwrap(), Frame::Request(_)));
    // The socket died but the instance is still registered: no reply and
    // no teardown means the browser was *not* closed, so this must fail
    // rather than report a success that never happened.
    drop(rx);
    assert!(
        state
            .browsers
            .get(&BrowserId("exact-edge".into()))
            .is_some()
    );
    assert_error(
        tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap(),
        ErrorCode::Timeout,
    );
}

#[tokio::test]
async fn browser_close_cancel_aborts_without_cancel_frame() {
    let (state, handler, browser, mut rx) = fixture();
    let task = tokio::spawn(handler(
        "cancel-me".into(),
        Method::BrowserClose,
        json!({"browser_id":"exact-edge","confirm":true}),
    ));
    let Frame::Request(request) = rx.recv().await.unwrap() else {
        panic!("request")
    };
    assert!(state.abort_registry.cancel(&"cancel-me".into()));
    assert_error(task.await.unwrap(), ErrorCode::Cancelled);
    assert!(!browser.pending.lock().unwrap().resolve(ResponseFrame {
        id: request.id,
        body: ResponseBody::Ok(Value::Null)
    }));
    assert!(state.abort_registry.is_empty());
    assert!(rx.try_recv().is_err());
}
