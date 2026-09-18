use std::path::PathBuf;
use std::sync::{Arc, Mutex, atomic::AtomicBool};
use std::time::{Duration, Instant};

use bsk::daemon::browsers::{
    BrowserClient, BrowserId, BrowserSink, Pending, next_browser_generation,
};
use bsk::daemon::ipc::{DaemonStatus, RpcHandler, default_ping_handler, full_handler};
use bsk::daemon::{DaemonConfig, DaemonState};
use bsk_protocol::{ErrorCode, Frame, Method, ResponseBody, ResponseFrame, RpcError};
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
        label: "wrong-id".into(),
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
async fn browser_tabs_wrong_id_never_matches_label_or_starts_session() {
    let (state, handler, _, mut rx) = fixture();
    for method in [
        Method::BrowserTabsList,
        Method::BrowserTabsSelect,
        Method::BrowserTabsCreate,
    ] {
        let params = match method {
            Method::BrowserTabsList => json!({"browser_id":"wrong-id","scope":"user"}),
            Method::BrowserTabsSelect => json!({"browser_id":"wrong-id","tab_id":7}),
            _ => json!({"browser_id":"wrong-id","url":"https://agentrouter.org"}),
        };
        assert_error(
            handler("wrong".into(), method, params).await,
            ErrorCode::NotFound,
        );
    }
    assert!(rx.try_recv().is_err());
    assert!(state.sessions.snapshot().is_empty());
}

#[tokio::test]
async fn browser_tabs_validates_before_forwarding() {
    let (state, handler, _, mut rx) = fixture();
    for (method, params) in [
        (
            Method::BrowserTabsList,
            json!({"browser_id":" ","scope":"user"}),
        ),
        (
            Method::BrowserTabsList,
            json!({"browser_id":"exact-edge","scope":"all"}),
        ),
        (
            Method::BrowserTabsList,
            json!({"browser_id":"exact-edge","scope":"user","session_id":"escape"}),
        ),
        (
            Method::BrowserTabsSelect,
            json!({"browser_id":"exact-edge","tab_id":0}),
        ),
        (
            Method::BrowserTabsSelect,
            json!({"browser_id":"exact-edge","tab_id":7,"expected_origin":"https://site.test/path"}),
        ),
        (
            Method::BrowserTabsCreate,
            json!({"browser_id":"exact-edge","url":"javascript:alert(1)"}),
        ),
        (
            Method::BrowserTabsCreate,
            json!({"browser_id":"exact-edge","url":"https://user:pass@site.test"}),
        ),
    ] {
        assert_error(
            handler("invalid".into(), method, params).await,
            ErrorCode::InvalidParams,
        );
    }
    assert!(rx.try_recv().is_err());
    assert!(state.sessions.snapshot().is_empty());
}

#[tokio::test]
async fn browser_tabs_exact_methods_round_trip_without_session_creation() {
    let (state, handler, browser, mut rx) = fixture();
    for (method, params, result) in [
        (
            Method::BrowserTabsList,
            json!({"browser_id":"exact-edge","scope":"user"}),
            json!({"tabs":[]}),
        ),
        (
            Method::BrowserTabsSelect,
            json!({"browser_id":"exact-edge","tab_id":7,"expected_origin":"https://agentrouter.org"}),
            json!({"tab_id":7,"window_id":20}),
        ),
        (
            Method::BrowserTabsCreate,
            json!({"browser_id":"exact-edge","url":"https://agentrouter.org"}),
            json!({"tab_id":8,"window_id":20}),
        ),
    ] {
        let task = tokio::spawn(handler("roundtrip".into(), method.clone(), params.clone()));
        let Frame::Request(request) = rx.recv().await.unwrap() else {
            panic!("request")
        };
        assert_eq!(request.method, method);
        assert_eq!(request.params.unwrap(), params);
        browser.pending.lock().unwrap().resolve(ResponseFrame {
            id: request.id,
            body: ResponseBody::Ok(result.clone()),
        });
        match task.await.unwrap() {
            ResponseBody::Ok(value) => assert_eq!(value, result),
            other => panic!("{other:?}"),
        }
    }
    assert!(state.sessions.snapshot().is_empty());
    assert!(state.abort_registry.is_empty());
    assert!(rx.try_recv().is_err());
}

#[tokio::test]
async fn browser_tabs_old_extension_and_old_daemon_fail_closed() {
    let (state, handler, browser, mut rx) = fixture();
    let params = json!({"browser_id":"exact-edge","url":"https://agentrouter.org"});
    let task = tokio::spawn(handler(
        "legacy".into(),
        Method::BrowserTabsCreate,
        params.clone(),
    ));
    let Frame::Request(request) = rx.recv().await.unwrap() else {
        panic!("request")
    };
    assert_eq!(request.method, Method::BrowserTabsCreate);
    browser.pending.lock().unwrap().resolve(ResponseFrame {
        id: request.id,
        body: ResponseBody::Err(RpcError {
            code: ErrorCode::UnknownMethod,
            message: "old extension".into(),
            data: None,
        }),
    });
    assert_error(task.await.unwrap(), ErrorCode::UnknownMethod);
    assert_error(
        default_ping_handler()("old-daemon".into(), Method::BrowserTabsCreate, params).await,
        ErrorCode::UnknownMethod,
    );
    assert!(rx.try_recv().is_err());
    assert!(state.sessions.snapshot().is_empty());
}

#[tokio::test]
async fn browser_tabs_cancel_cleans_waiter_and_forwards_only_cancel() {
    let (state, handler, browser, mut rx) = fixture();
    let task = tokio::spawn(handler(
        "cancel-me".into(),
        Method::BrowserTabsSelect,
        json!({"browser_id":"exact-edge","tab_id":7}),
    ));
    let Frame::Request(request) = rx.recv().await.unwrap() else {
        panic!("request")
    };
    assert!(state.abort_registry.cancel(&"cancel-me".into()));
    assert_error(task.await.unwrap(), ErrorCode::Cancelled);
    let Frame::Request(cancel) = rx.recv().await.unwrap() else {
        panic!("cancel")
    };
    assert_eq!(cancel.method, Method::Cancel);
    assert_eq!(cancel.params, Some(json!({"rpc_id":request.id})));
    assert!(!browser.pending.lock().unwrap().resolve(ResponseFrame {
        id: request.id,
        body: ResponseBody::Ok(Value::Null)
    }));
    assert!(state.abort_registry.is_empty());
}

#[tokio::test]
async fn browser_tabs_timeout_cleans_waiter_without_retry() {
    let (state, handler, browser, mut rx) = fixture();
    let task = tokio::spawn(handler(
        "timeout".into(),
        Method::BrowserTabsCreate,
        json!({"browser_id":"exact-edge","url":"https://agentrouter.org"}),
    ));
    let Frame::Request(request) = rx.recv().await.unwrap() else {
        panic!("request")
    };
    assert_error(
        tokio::time::timeout(Duration::from_secs(17), task)
            .await
            .unwrap()
            .unwrap(),
        ErrorCode::Timeout,
    );
    let Frame::Request(cancel) = rx.recv().await.unwrap() else {
        panic!("cancel")
    };
    assert_eq!(cancel.method, Method::Cancel);
    assert!(!browser.pending.lock().unwrap().resolve(ResponseFrame {
        id: request.id,
        body: ResponseBody::Ok(Value::Null)
    }));
    assert!(rx.try_recv().is_err());
    assert!(state.sessions.snapshot().is_empty());
}

#[tokio::test]
async fn browser_tabs_removed_instance_rejects_late_success() {
    let (state, handler, browser, mut rx) = fixture();
    let task = tokio::spawn(handler(
        "stale".into(),
        Method::BrowserTabsCreate,
        json!({"browser_id":"exact-edge","url":"https://agentrouter.org"}),
    ));
    let Frame::Request(request) = rx.recv().await.unwrap() else {
        panic!("request")
    };
    state.browsers.remove(&browser.id);
    browser.pending.lock().unwrap().resolve(ResponseFrame {
        id: request.id,
        body: ResponseBody::Ok(json!({"tab_id":7,"window_id":20})),
    });
    assert_error(task.await.unwrap(), ErrorCode::ProtocolError);
    assert!(state.sessions.snapshot().is_empty());
    assert!(state.abort_registry.is_empty());
    let Frame::Request(cancel) = rx.recv().await.unwrap() else {
        panic!("cancel")
    };
    assert_eq!(cancel.method, Method::Cancel);
    assert!(rx.try_recv().is_err());
}

#[tokio::test]
async fn browser_tabs_disconnect_fails_promptly_without_retry() {
    let (_, handler, _, mut rx) = fixture();
    let task = tokio::spawn(handler(
        "disconnect".into(),
        Method::BrowserTabsCreate,
        json!({"browser_id":"exact-edge","url":"https://agentrouter.org"}),
    ));
    assert!(matches!(rx.recv().await.unwrap(), Frame::Request(_)));
    drop(rx);
    assert_error(
        tokio::time::timeout(Duration::from_secs(1), task)
            .await
            .unwrap()
            .unwrap(),
        ErrorCode::ProtocolError,
    );
}
