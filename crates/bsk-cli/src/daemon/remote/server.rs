use std::collections::HashMap;
use std::convert::Infallible;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use bytes::Bytes;
use http_body_util::{BodyExt, Full, Limited};
use hyper::{
    Request, Response, StatusCode, body::Incoming, server::conn::http1, service::service_fn,
};
use hyper_util::rt::{TokioIo, TokioTimer};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpListener;
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore, watch};
use tokio_rustls::{
    TlsAcceptor,
    rustls::{
        self,
        pki_types::{CertificateDer, PrivateKeyDer, pem::PemObject},
    },
};
use tokio_tungstenite::{
    WebSocketStream,
    tungstenite::{handshake::server::create_response, protocol::Role},
};

use super::authorization::{AuthorizationRequest, AuthorizationStore, AuthorizedDevice};
use crate::daemon::{
    DaemonState, paths,
    ws::{WsHandle, drive_connection, origin_allowed},
};

type Body = Full<Bytes>;

struct Gateway {
    state: Arc<DaemonState>,
    stopped: AtomicBool,
    store: AuthorizationStore,
    path: String,
    authorize_path: String,
    active: Mutex<HashMap<String, watch::Sender<bool>>>,
    attempts: Mutex<HashMap<IpAddr, (Instant, u32)>>,
}

pub(crate) struct ConnectionAuthorization {
    pub device: AuthorizedDevice,
    gateway: Arc<Gateway>,
    cancelled: watch::Receiver<bool>,
}

impl ConnectionAuthorization {
    pub fn valid(&self) -> bool {
        !self.gateway.stopped.load(Ordering::Acquire)
            && !*self.cancelled.borrow()
            && self.gateway.store.is_authorized(&self.device.device_id)
    }

    pub async fn revoked(&self) {
        let mut cancelled = self.cancelled.clone();
        let mut timer = tokio::time::interval(Duration::from_secs(1));
        loop {
            tokio::select! {
                _ = cancelled.changed() => return,
                _ = timer.tick() => if !self.valid() { return; },
            }
        }
    }
}

impl Drop for ConnectionAuthorization {
    fn drop(&mut self) {
        let mut active = self.gateway.active.lock().unwrap();
        if active
            .get(&self.device.device_id)
            .is_some_and(|sender| sender.receiver_count() == 1 && !*sender.borrow())
        {
            // The current receiver still belongs to this connection. A replaced
            // connection has already been cancelled and must not remove its successor.
            if !*self.cancelled.borrow() {
                active.remove(&self.device.device_id);
            }
        }
    }
}

pub async fn bind(state: Arc<DaemonState>, addr: SocketAddr) -> Result<WsHandle> {
    let config = state
        .config
        .server
        .as_ref()
        .context("server mode required")?;
    config.validate()?;
    let tls = if let (Some(cert), Some(key)) = (&config.tls_cert, &config.tls_key) {
        let certificates: Vec<_> =
            CertificateDer::pem_file_iter(cert)?.collect::<std::result::Result<_, _>>()?;
        let key = PrivateKeyDer::from_pem_file(key)?;
        let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
        let mut tls_config = rustls::ServerConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()?
            .with_no_client_auth()
            .with_single_cert(certificates, key)?;
        tls_config.alpn_protocols = vec![b"http/1.1".to_vec()];
        Some(TlsAcceptor::from(Arc::new(tls_config)))
    } else {
        None
    };
    let url = super::validate_endpoint(&config.public_url)?;
    let listener = TcpListener::bind(addr).await?;
    let local_addr = listener.local_addr()?;
    let store = AuthorizationStore::at_home(&paths::bsk_home()?);
    store.configure(config)?;
    let gateway = Arc::new(Gateway {
        store,
        path: url.path().to_owned(),
        authorize_path: format!(
            "{}/authorize",
            url.path().strip_suffix('/').unwrap_or(url.path())
        ),
        state,
        stopped: AtomicBool::new(false),
        active: Mutex::new(HashMap::new()),
        attempts: Mutex::new(HashMap::new()),
    });
    let shutdown = Arc::new(Notify::new());
    let stop = shutdown.clone();
    let task = tokio::spawn(async move {
        let limit = Arc::new(Semaphore::new(64));
        loop {
            tokio::select! {
                _ = stop.notified() => break,
                incoming = listener.accept() => {
                    let Ok((stream, peer)) = incoming else { break; };
                    let Ok(permit) = limit.clone().try_acquire_owned() else { continue; };
                    let gateway = gateway.clone();
                    let tls = tls.clone();
                    tokio::spawn(async move {
                        if let Some(tls) = tls {
                            if let Ok(Ok(stream)) = tokio::time::timeout(Duration::from_secs(5), tls.accept(stream)).await {
                                serve(stream, gateway, peer.ip(), permit).await;
                            }
                        } else { serve(stream, gateway, peer.ip(), permit).await; }
                    });
                }
            }
        }
        gateway.stopped.store(true, Ordering::Release);
        for (_, sender) in gateway.active.lock().unwrap().drain() {
            let _ = sender.send(true);
        }
    });
    Ok(WsHandle {
        local_addr,
        shutdown,
        task,
    })
}

async fn serve<T: AsyncRead + AsyncWrite + Unpin + Send + 'static>(
    stream: T,
    gateway: Arc<Gateway>,
    peer: IpAddr,
    permit: OwnedSemaphorePermit,
) {
    let permit = Arc::new(permit);
    let service = service_fn(move |request| handle(request, gateway.clone(), peer, permit.clone()));
    // Header, body, connection and authorization-rate limits apply before a
    // caller can retain a browser connection or perform durable grant writes.
    let _ = http1::Builder::new()
        .timer(TokioTimer::new())
        .header_read_timeout(Duration::from_secs(5))
        .max_buf_size(16 * 1024)
        .keep_alive(true)
        .serve_connection(TokioIo::new(stream), service)
        .with_upgrades()
        .await;
}

fn response(status: StatusCode, value: serde_json::Value) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .header("cache-control", "no-store")
        .body(Full::new(Bytes::from(value.to_string())))
        .unwrap()
}

fn denied() -> Response<Body> {
    response(
        StatusCode::UNAUTHORIZED,
        serde_json::json!({"error": "invalid_authorization"}),
    )
}

fn one_header<'a>(request: &'a Request<Incoming>, name: &str) -> Option<&'a str> {
    let mut values = request.headers().get_all(name).iter();
    let value = values.next()?.to_str().ok()?;
    if values.next().is_some() {
        return None;
    }
    Some(value)
}

async fn handle(
    mut request: Request<Incoming>,
    gateway: Arc<Gateway>,
    peer: IpAddr,
    permit: Arc<OwnedSemaphorePermit>,
) -> std::result::Result<Response<Body>, Infallible> {
    if gateway.stopped.load(Ordering::Acquire) {
        return Ok(denied());
    }
    if request.uri().query().is_some() {
        return Ok(denied());
    }
    if request.method() == hyper::Method::POST && request.uri().path() == gateway.authorize_path {
        let allowed = {
            let mut attempts = gateway.attempts.lock().unwrap();
            attempts.retain(|_, (start, _)| start.elapsed() < Duration::from_secs(60));
            if attempts.len() >= 1024 && !attempts.contains_key(&peer) {
                false
            } else {
                let entry = attempts.entry(peer).or_insert((Instant::now(), 0));
                entry.1 += 1;
                entry.1 <= 60
            }
        };
        if !allowed {
            return Ok(response(
                StatusCode::TOO_MANY_REQUESTS,
                serde_json::json!({"error": "rate_limited"}),
            ));
        }
        let Some(credential) = one_header(&request, "authorization")
            .and_then(|value| value.strip_prefix("Bearer "))
            .filter(|value| super::authorization::valid_token(value))
            .map(str::to_owned)
        else {
            return Ok(denied());
        };
        let body = tokio::time::timeout(
            Duration::from_secs(5),
            Limited::new(request.into_body(), 4096).collect(),
        )
        .await;
        let Ok(Ok(body)) = body else {
            return Ok(response(
                StatusCode::BAD_REQUEST,
                serde_json::json!({"error": "invalid_request"}),
            ));
        };
        let Ok(parameters) = serde_json::from_slice::<AuthorizationRequest>(&body.to_bytes())
        else {
            return Ok(response(
                StatusCode::BAD_REQUEST,
                serde_json::json!({"error": "invalid_request"}),
            ));
        };
        let store = gateway.store.clone();
        return Ok(
            match tokio::task::spawn_blocking(move || store.exchange(&credential, parameters)).await
            {
                Ok(Ok(grant)) => response(StatusCode::OK, serde_json::to_value(grant).unwrap()),
                _ => denied(),
            },
        );
    }
    if request.method() != hyper::Method::GET || request.uri().path() != gateway.path {
        return Ok(response(
            StatusCode::NOT_FOUND,
            serde_json::json!({"error": "not_found"}),
        ));
    }
    if !one_header(&request, "origin").is_some_and(|origin| origin_allowed(origin, false)) {
        return Ok(denied());
    }
    let Some(protocol) = one_header(&request, "sec-websocket-protocol").map(str::to_owned) else {
        return Ok(denied());
    };
    let Some(credential) = protocol.strip_prefix("bsk-auth.") else {
        return Ok(denied());
    };
    let Ok(device) = gateway.store.authenticate(credential) else {
        return Ok(denied());
    };
    let mut upgrade_request = Request::new(());
    *upgrade_request.method_mut() = request.method().clone();
    *upgrade_request.version_mut() = request.version();
    *upgrade_request.uri_mut() = request.uri().clone();
    *upgrade_request.headers_mut() = request.headers().clone();
    let Ok(mut upgrade_response) = create_response(&upgrade_request) else {
        return Ok(response(
            StatusCode::BAD_REQUEST,
            serde_json::json!({"error": "invalid_upgrade"}),
        ));
    };
    upgrade_response
        .headers_mut()
        .insert("sec-websocket-protocol", protocol.parse().unwrap());
    let upgrade = hyper::upgrade::on(&mut request);
    tokio::spawn(async move {
        let _permit = permit;
        let Ok(Ok(stream)) = tokio::time::timeout(Duration::from_secs(5), upgrade).await else {
            return;
        };
        if gateway.stopped.load(Ordering::Acquire)
            || !gateway.store.is_authorized(&device.device_id)
        {
            return;
        }
        let (cancel, cancelled) = watch::channel(false);
        if let Some(previous) = gateway
            .active
            .lock()
            .unwrap()
            .insert(device.device_id.clone(), cancel)
        {
            let _ = previous.send(true);
        }
        let authorization = ConnectionAuthorization {
            device,
            gateway: gateway.clone(),
            cancelled,
        };
        let ws = WebSocketStream::from_raw_socket(TokioIo::new(stream), Role::Server, None).await;
        // The native dispatcher supplies session isolation and cancellation.
        // The authenticated device, rather than a self-reported instance ID,
        // supplies the browser identity used by that dispatcher.
        let _ = drive_connection(gateway.state.clone(), ws, Some(authorization)).await;
    });
    Ok(upgrade_response.map(|_| Full::new(Bytes::new())))
}
