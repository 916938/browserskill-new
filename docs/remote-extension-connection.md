# Remote browser connections

An Agent can run on a server while the BrowserSkill extension controls a browser on the user's computer. The extension initiates an outbound connection; the user's computer needs no inbound port. Tasks continue to use separate Agent Windows, including the existing borrow-and-return flow for user tabs.

`bsk` includes device pairing, connection authentication, credential renewal and revocation. No account system or authentication gateway is required. Alternatively, the extension can pair with a third-party gateway implementing the protocol below.

## Local mode

The existing local workflow remains the default:

```sh
bsk daemon start
# Equivalent: bsk daemon start --mode local
```

It listens on loopback. Existing CLI commands and extension port settings continue to work. Select **Local connection** in the extension to leave a remote connection; this ends its current tasks.

## Standalone server

Run the Agent, CLI and daemon under the same OS user on the server. Automation commands continue to use the existing local IPC socket; the public listener accepts only authenticated extension connections and credential exchanges.

With a certificate and private key for `browser.example.com`:

```sh
bsk daemon start --mode server \
  --listen 0.0.0.0 --port 52800 \
  --public-url wss://browser.example.com:52800/extension \
  --tls-cert /etc/bsk/fullchain.pem \
  --tls-key /etc/bsk/privkey.pem
```

Use a certificate trusted by the user's browser. The certificate's hostname must match the public URL. `bsk` does not issue certificates or modify browser trust settings. Server mode stays in the foreground and does not exit when idle; a process supervisor can manage it. Certificate changes require a restart with the same flags. Session idle limits still apply. The server does not automatically update or restart itself.

Set `BSK_AUTO_START=0` in the Agent environment so a stopped managed server is reported as unavailable. Keep `BSK_HOME` consistent between the daemon and its CLI clients. Persist this private directory across service restarts and container replacements: it contains device grants and local IPC metadata. Do not share it between independent running servers or untrusted OS users.

In another shell on the server:

```sh
bsk daemon pair
```

Copy the resulting pairing link into the extension's **Remote connection** field and save it. The link is a secret, expires after five minutes and can be used once. Saving it switches the connection and ends existing tasks. BrowserSkill then replaces the pairing secret with a device credential generated in the extension.

Once connected, run the existing commands on the server:

```sh
bsk status
bsk session start
```

With multiple paired browsers, select the browser using the existing `--browser` option. Each device receives its own stable browser identity; it cannot select another device's identity through its handshake.

Manage grants from the server's local CLI:

```sh
bsk daemon devices
bsk daemon revoke DEVICE_ID
bsk daemon revoke --all
```

`devices` includes device and browser IDs, label and expiration, never credentials. `revoke --all` also invalidates unused pairing links. Revocation closes existing connections as well as rejecting new ones. The server checks grants before processing messages and polls idle connections once per second. Actions already performed on a page cannot be undone by revocation.

Defaults are configurable at server startup:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--pairing-ttl` | `5m` | One-use pairing lifetime, at most one hour |
| `--device-ttl` | `90d` | Device lifetime from pairing or successful renewal, at most 366 days |
| `--renew-after` | `30d` | Time before the extension should renew; must be less than device lifetime |

The extension checks for renewal on startup and periodically while running. If it remains offline past expiration, create a new pairing link. A renewal rotates the credential; its pending replacement is persisted before the request so a lost response can be retried after a service-worker or server restart. Changing lifetime flags affects subsequent exchanges, not grants already issued.

## TLS reverse proxy

A conventional TLS reverse proxy can terminate HTTPS/WSS without implementing authentication:

```sh
bsk daemon start --mode server --listen 127.0.0.1 --port 52800 \
  --public-url wss://browser.example.com/extension
```

Forward both `/extension` and `/extension/authorize` to `127.0.0.1:52800`, preserving the path and WebSocket upgrade headers. Preserve `Origin`, `Authorization` and `Sec-WebSocket-Protocol`. Never log authorization headers, WebSocket subprotocol values or request bodies. Do not pass credentials in query strings. The built-in server remains responsible for authentication; proxy-injected user headers do not bypass it.

Without native TLS, the listener must be on loopback. Plain `ws://` public URLs are allowed only for loopback development. Non-loopback browser connections require WSS. Changing the configured public URL requires revoking existing grants and generating new pairing links.

## Third-party gateway protocol

The extension uses the same protocol whether it connects to `bsk` or a compatible gateway. It does not call provider-specific login APIs. The gateway may use any account or management system to issue its pairing links, but must implement this browser-facing contract:

1. A pairing link is `wss://HOST/PATH#PAIRING_SECRET`. Its fragment contains 32–256 base64url characters and is removed before any network request.
2. The extension POSTs to `https://HOST/PATH/authorize` with `Authorization: Bearer PAIRING_SECRET` and JSON `{ "action": "pair", "next_token": "…", "label": "…" }`. `next_token` is a new random 256-bit, unpadded base64url credential (43 characters). Consume the pairing secret once and bind the replacement to one device. Pairing secrets cannot open a WebSocket.
3. Return HTTP 200 with `{ "device_id": "32 lowercase hex characters", "expires_at": "RFC3339 timestamp", "renew_after": "RFC3339 timestamp", "service_name": "optional display name" }`. Invalid or unauthorized exchanges fail with a non-2xx response. The extension refuses redirects and sends no cookies.
4. WebSocket upgrades to `wss://HOST/PATH` authenticate with exactly one `Sec-WebSocket-Protocol: bsk-auth.DEVICE_TOKEN`. Validate before upgrading and echo the selected subprotocol. A browser-shaped Origin alone is never authorization. Credentials belong to the specific endpoint and cannot authorize another device or deployment.
5. Renewal uses the same POST endpoint and the current token, with `action: "renew"` and a new `next_token`. Keep the same `device_id`. Invalidate the old credential for new connections. An exact retry of the same old/new pair returns the original successful response; the old credential must not rotate to a different replacement. Revocation invalidates retries too. An already connected socket can remain open during renewal while its device grant is valid.
6. After upgrade, support the existing native handshake and RPC frames. Bind all RPC routing, responses, events and session state to the authenticated device. Do not trust its self-reported browser ID as authorization to another device's tasks. Close active sockets on expiration or revocation and cancel their pending work.

A gateway can bridge this protocol to a local `bsk` daemon on its server, keeping that daemon's loopback/IPC boundary private. A gateway that terminates device authentication owns that authentication lifecycle and routing isolation. Merely forwarding its credentials to the built-in server will not authorize them: the built-in server accepts its own issued grants.

## Browser permissions and task lifetime

Pair only with a server you trust to operate your browser. A paired server can create Agent Windows and navigate using that browser profile, including its signed-in website sessions. Pairing is device authorization, not a restricted account or website sandbox.

Remote content reads, screenshots, recording and page operations require a tab explicitly created or borrowed by the task. Listing tab titles and URLs remains available to select a tab to borrow. A user tab moved or opened inside an Agent Window does not by itself become authorized. Borrowing uses the existing browser-controlled confirmation preference; remote request flags cannot change that preference. After a borrowed tab is returned, remote content access ends. Returning a tab during remote recording cancels that recording before releasing the tab.

Disconnecting cancels task work, returns borrowed tabs and closes task-created tabs. User-created tabs survive cleanup. Failed returns preserve the window and must be resolved before reconnecting. Reconnection starts new tasks; commands and sessions are never replayed. Failed remote authentication does not select a local connection automatically.

Remote upload and download are unsupported in this version and return the `unsupported` error. Existing local file transfer behavior is unchanged. Screenshots and other existing RPC content results remain supported. There is no gateway preview or focus side protocol, background task tab group, or alternative window model.

Device credentials live in extension-origin IndexedDB; only a non-secret revision is published in ordinary extension settings. The standalone server persists hashed credentials with private file permissions and atomic writes. Treat the whole browser profile and `BSK_HOME` as trusted local data. Protect TLS private keys separately.

## Validation

Build the CLI and extension, then run the ordinary Rust and extension suites. The real browser regression additionally needs an isolated Chrome for Testing executable:

```sh
cargo test --workspace
pnpm --filter @browser-skill/extension test
cargo build -p bsk
pnpm --filter @browser-skill/extension build
BSK_REMOTE_CLI=/absolute/path/to/target/debug/bsk \
BSK_REMOTE_CHROME=/absolute/path/to/chrome-for-testing \
  pnpm --filter @browser-skill/extension test src/transport/__tests__/remote-connection.browser.test.ts
```

The remote server integration tests cover credential exchange, rotation retries, stable device routing, replacement connections, revocation and native TLS. TLS fixtures contain a test-only private key and must never be used for deployment.
