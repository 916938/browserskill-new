//! Standalone server tests use child processes and private homes, never the installed daemon.
use bsk::daemon::remote::authorization::{AuthorizationResponse, AuthorizationStore};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{
    path::Path,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio_tungstenite::{
    WebSocketStream,
    tungstenite::{Message, client::IntoClientRequest},
};

struct Server {
    home: tempfile::TempDir,
    child: Child,
    port: u16,
    tls: bool,
}
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Server {
    async fn start(tls: bool) -> Self {
        let home = tempfile::tempdir().unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let url = format!(
            "{}://127.0.0.1:{port}/extension{}",
            if tls { "wss" } else { "ws" },
            if tls { "//" } else { "" }
        );
        let mut command = cli(home.path());
        command.args([
            "daemon",
            "start",
            "--mode",
            "server",
            "--port",
            &port.to_string(),
            "--public-url",
            &url,
        ]);
        if tls {
            let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/remote-tls");
            command
                .arg("--tls-cert")
                .arg(fixtures.join("cert.pem"))
                .arg("--tls-key")
                .arg(fixtures.join("key.pem"));
        }
        let child = command
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut server = Self {
            home,
            child,
            port,
            tls,
        };
        let deadline = Instant::now() + Duration::from_secs(10);
        while !server.home.path().join("daemon.json").exists() {
            assert!(
                server.child.try_wait().unwrap().is_none(),
                "server exited before readiness"
            );
            assert!(Instant::now() < deadline, "server startup timed out");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        server
    }
    fn command(&self, args: &[&str]) -> String {
        let output = cli(self.home.path()).args(args).output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().into()
    }
    fn url(&self) -> String {
        format!(
            "{}://127.0.0.1:{}/extension{}",
            if self.tls { "wss" } else { "ws" },
            self.port,
            if self.tls { "//" } else { "" }
        )
    }
    fn http_url(&self) -> String {
        format!(
            "{}/authorize",
            self.url().strip_suffix('/').unwrap_or(&self.url())
        )
        .replacen("ws", "http", 1)
    }
    fn client(&self) -> reqwest::Client {
        reqwest::Client::builder()
            .no_proxy()
            .tls_certs_only([reqwest::Certificate::from_pem(include_bytes!(
                "fixtures/remote-tls/cert.pem"
            ))
            .unwrap()])
            .build()
            .unwrap()
    }
    async fn exchange(&self, token: &str, action: &str, next: &str) -> reqwest::Response {
        self.client()
            .post(self.http_url())
            .bearer_auth(token)
            .header("content-type", "application/json")
            .body(
                json!({"action":action,"next_token":next,"label":"Integration browser"})
                    .to_string(),
            )
            .send()
            .await
            .unwrap()
    }
    fn request(
        &self,
        token: &str,
        origin: &str,
    ) -> tokio_tungstenite::tungstenite::http::Request<()> {
        let mut request = self.url().into_client_request().unwrap();
        request
            .headers_mut()
            .insert("origin", origin.parse().unwrap());
        request.headers_mut().insert(
            "sec-websocket-protocol",
            format!("bsk-auth.{token}").parse().unwrap(),
        );
        request
    }
}
fn cli(home: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_bsk"));
    command
        .env("BSK_HOME", home)
        .env("HOME", home)
        .env("USERPROFILE", home)
        .env("BSK_AUTO_START", "0")
        .env("BSK_AUTO_UPDATE", "off")
        .env("BSK_UPDATE_MANIFEST_URL", "http://127.0.0.1:1/disabled");
    command
}
const ORIGIN: &str = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
async fn handshake<S: AsyncRead + AsyncWrite + Unpin>(ws: &mut WebSocketStream<S>, instance: &str) {
    ws.send(Message::Text(json!({"id":"handshake","method":"system.handshake","params":{
        "client":"browser-skill-extension","version":"0.2.1","protocol_version":bsk::daemon::state::PROTOCOL_VERSION,
        "instance_id":instance,"browser":{"name":"chrome","version":"131"},"label":"Remote browser"
    }}).to_string())).await.unwrap();
    let frame = tokio::time::timeout(Duration::from_secs(3), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let reply: Value = serde_json::from_str(frame.to_text().unwrap()).unwrap();
    assert!(reply.get("result").is_some(), "{reply}");
}
async fn closed<S: AsyncRead + AsyncWrite + Unpin>(ws: &mut WebSocketStream<S>) {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            match ws.next().await {
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                _ => {}
            }
        }
    })
    .await
    .expect("authorization must close existing connection");
}

#[tokio::test]
async fn standalone_pair_rotate_reconnect_revoke_and_bind_browser_identity() {
    let server = Server::start(false).await;
    let link = server.command(&["daemon", "pair"]);
    let pairing = link.rsplit_once('#').unwrap().1;
    let client = server.client();
    let wrong = "z".repeat(43);
    assert_eq!(
        server
            .exchange(&wrong, "pair", &"x".repeat(43))
            .await
            .status(),
        401
    );
    assert_eq!(
        client
            .post(server.http_url())
            .bearer_auth(pairing)
            .header("authorization", format!("Bearer {pairing}"))
            .body("{}")
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        client
            .post(server.http_url())
            .bearer_auth(pairing)
            .body("x".repeat(8192))
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        client
            .post(server.http_url() + "?credential=invalid")
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    let first = "a".repeat(43);
    let second = "b".repeat(43);
    assert!(
        tokio_tungstenite::connect_async(server.request(pairing, ORIGIN))
            .await
            .is_err()
    );
    let response = server.exchange(pairing, "pair", &first).await;
    assert_eq!(response.status(), 200);
    let grant: AuthorizationResponse =
        serde_json::from_slice(&response.bytes().await.unwrap()).unwrap();
    assert_eq!(
        server.exchange(pairing, "pair", &second).await.status(),
        401
    );
    assert!(
        tokio_tungstenite::connect_async(server.request(&first, "https://untrusted.example"))
            .await
            .is_err()
    );
    let (mut ws, response) = tokio_tungstenite::connect_async(server.request(&first, ORIGIN))
        .await
        .unwrap();
    assert_eq!(
        response.headers()["sec-websocket-protocol"],
        format!("bsk-auth.{first}")
    );
    handshake(&mut ws, "spoofed-browser").await;
    let store = AuthorizationStore::at_home(server.home.path());
    let stable = store.authenticate(&first).unwrap().browser_id;
    let status: Value = serde_json::from_str(&server.command(&["status", "--json"])).unwrap();
    assert!(status.to_string().contains(&stable));
    assert!(!status.to_string().contains("spoofed-browser"));
    assert_eq!(
        server.exchange(&first, "renew", &second).await.status(),
        200
    );
    assert_eq!(
        server.exchange(&first, "renew", &second).await.status(),
        200
    );
    assert!(
        tokio_tungstenite::connect_async(server.request(&first, ORIGIN))
            .await
            .is_err()
    );
    let (mut replacement, _) = tokio_tungstenite::connect_async(server.request(&second, ORIGIN))
        .await
        .unwrap();
    handshake(&mut replacement, "another-spoof").await;
    closed(&mut ws).await;
    assert_eq!(store.authenticate(&second).unwrap().browser_id, stable);
    server.command(&["daemon", "revoke", &grant.device_id]);
    closed(&mut replacement).await;
    assert_eq!(
        server.exchange(&second, "renew", &first).await.status(),
        401
    );
    assert!(
        tokio_tungstenite::connect_async(server.request(&second, ORIGIN))
            .await
            .is_err()
    );
    let log = std::fs::read_dir(server.home.path())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("daemon.log")
        })
        .filter_map(|entry| std::fs::read_to_string(entry.path()).ok())
        .collect::<String>();
    assert!(!log.contains(pairing) && !log.contains(&first) && !log.contains(&second));
}

#[tokio::test]
async fn native_tls_serves_the_same_authorization_and_websocket_protocol() {
    use std::sync::Arc;
    use tokio_rustls::{
        TlsConnector,
        rustls::{
            self,
            pki_types::{CertificateDer, ServerName, pem::PemObject},
        },
    };
    let server = Server::start(true).await;
    let link = server.command(&["daemon", "pair"]);
    let credential = "c".repeat(43);
    assert_eq!(
        server
            .exchange(link.rsplit_once('#').unwrap().1, "pair", &credential)
            .await
            .status(),
        200
    );
    let mut roots = rustls::RootCertStore::empty();
    roots
        .add(
            CertificateDer::from_pem_slice(include_bytes!("fixtures/remote-tls/cert.pem")).unwrap(),
        )
        .unwrap();
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_root_certificates(roots)
    .with_no_client_auth();
    let stream = tokio::net::TcpStream::connect(("127.0.0.1", server.port))
        .await
        .unwrap();
    let tls = TlsConnector::from(Arc::new(config))
        .connect(ServerName::try_from("localhost").unwrap(), stream)
        .await
        .unwrap();
    let (mut ws, _) = tokio_tungstenite::client_async(server.request(&credential, ORIGIN), tls)
        .await
        .unwrap();
    handshake(&mut ws, "tls-browser").await;
    server.command(&["daemon", "revoke", "--all"]);
    closed(&mut ws).await;
}
