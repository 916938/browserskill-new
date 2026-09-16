//! `bsk browsers` — list connected extension clients (M4) and quit one
//! of them (`bsk browsers close`).

use std::path::PathBuf;
use std::time::Duration;

use anyhow::Context;
use bsk_protocol::Method;
use bsk_protocol::browser::{BrowserCloseParams, BrowserCloseResult};
use bsk_protocol::system::BrowserListParams;
use bsk_protocol::system::BrowserStatusEntry;
use clap::{Args, Subcommand};
use serde::Deserialize;
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::cli::browser_wait::{
    browser_connect_wait, browser_query_ipc_timeout, wait_for_browser_ms,
};
use crate::cli::ensure_daemon::ensure_daemon;
use crate::cli::error::{CliError, Format};

/// Slightly longer than the daemon's 20s `browser.close` budget: the
/// extension stops every session before it closes the windows, and the
/// daemon may spend up to 400ms confirming the instance is gone.
const CLOSE_IPC_TIMEOUT: Duration = Duration::from_secs(25);

#[derive(Debug, Deserialize)]
struct ListReply {
    browsers: Vec<BrowserStatusEntry>,
}

#[derive(Debug, Clone, Args, Default)]
pub struct BrowsersCmd {
    #[command(subcommand)]
    pub sub: Option<BrowsersSub>,
}

#[derive(Debug, Clone, Subcommand)]
pub enum BrowsersSub {
    /// Quit a connected browser: stop its sessions, then close every window.
    Close(BrowserCloseArgs),
}

#[derive(Debug, Clone, Args)]
pub struct BrowserCloseArgs {
    /// Exact `instance_id` from `bsk browsers`. Labels and prefixes are
    /// never accepted — quitting the wrong browser is unrecoverable.
    #[arg(long, value_parser = non_empty_browser_id)]
    pub browser_id: String,
    /// Required acknowledgement: quitting a browser closes every window of
    /// that instance and discards anything unsaved in them.
    #[arg(long)]
    pub confirm: bool,
}

fn non_empty_browser_id(value: &str) -> Result<String, String> {
    if value.trim().is_empty() {
        Err("browser id must not be empty".into())
    } else {
        Ok(value.into())
    }
}

pub fn dispatch(cmd: BrowsersCmd, format: Format) -> Result<(), CliError> {
    let info = ensure_daemon().context("ensure daemon is running")?;
    match cmd.sub {
        None => run_list(info.sock_path, format),
        Some(BrowsersSub::Close(args)) => run_close(info.sock_path, args, format),
    }
}

fn run_close(sock: PathBuf, args: BrowserCloseArgs, format: Format) -> Result<(), CliError> {
    if !args.confirm {
        return Err(CliError::Local(anyhow::anyhow!(
            "refusing to quit browser {}: pass --confirm (this closes every window of that browser and discards unsaved state)",
            args.browser_id
        )));
    }
    let params = BrowserCloseParams {
        browser_id: args.browser_id.clone(),
        confirm: true,
    };
    let reply: BrowserCloseResult = call(
        sock,
        "browser-close-1",
        Method::BrowserClose,
        params,
        CLOSE_IPC_TIMEOUT,
    )?;
    match format {
        Format::Json => {
            println!(
                "{}",
                serde_json::to_string_pretty(&reply)
                    .map_err(|e| CliError::Local(anyhow::anyhow!(e)))?
            );
        }
        Format::Human => {
            let suffix = if reply.disconnected {
                " (connection dropped; browser exited)"
            } else {
                ""
            };
            println!(
                "closed browser_id={} windows={} sessions={}{}",
                reply.browser_id, reply.windows_closed, reply.sessions_stopped, suffix
            );
        }
    }
    Ok(())
}

fn run_list(sock: PathBuf, format: Format) -> Result<(), CliError> {
    let wait = browser_connect_wait();
    let params = BrowserListParams {
        wait_for_browser_ms: wait_for_browser_ms(wait),
    };
    let timeout = browser_query_ipc_timeout(wait, Duration::from_secs(5));
    let reply: ListReply = call(sock, "browser-list-1", Method::BrowserList, params, timeout)?;
    match format {
        Format::Json => {
            println!(
                "{}",
                serde_json::to_string_pretty(&reply.browsers)
                    .map_err(|e| CliError::Local(anyhow::anyhow!(e)))?
            );
        }
        Format::Human => {
            if reply.browsers.is_empty() {
                println!("(no browsers connected)");
                return Ok(());
            }
            let rows: Vec<[String; 5]> = reply
                .browsers
                .iter()
                .map(|b| {
                    [
                        b.instance_id.clone(),
                        format!("{} {}", b.browser_name, b.browser_version),
                        b.extension_version.clone(),
                        if b.label.is_empty() {
                            "-".into()
                        } else {
                            b.label.clone()
                        },
                        b.session_count.to_string(),
                    ]
                })
                .collect();
            let headers = ["INSTANCE", "BROWSER", "EXT", "LABEL", "SESSIONS"];
            let widths: [usize; 5] = std::array::from_fn(|i| {
                rows.iter()
                    .map(|r| r[i].len())
                    .max()
                    .unwrap_or(0)
                    .max(headers[i].len())
            });
            println!(
                "{:<w0$}  {:<w1$}  {:<w2$}  {:<w3$}  {}",
                headers[0],
                headers[1],
                headers[2],
                headers[3],
                headers[4],
                w0 = widths[0],
                w1 = widths[1],
                w2 = widths[2],
                w3 = widths[3],
            );
            for r in &rows {
                println!(
                    "{:<w0$}  {:<w1$}  {:<w2$}  {:<w3$}  {}",
                    r[0],
                    r[1],
                    r[2],
                    r[3],
                    r[4],
                    w0 = widths[0],
                    w1 = widths[1],
                    w2 = widths[2],
                    w3 = widths[3],
                );
            }
        }
    }
    Ok(())
}

fn call<P, R>(
    sock: PathBuf,
    rpc_id: &'static str,
    method: Method,
    params: P,
    timeout: Duration,
) -> Result<R, CliError>
where
    P: Serialize + Send + 'static,
    R: DeserializeOwned + Send + 'static,
{
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("build tokio runtime for browser RPC")
        .map_err(CliError::Local)?;
    rt.block_on(async move {
        let mut client = crate::ipc_client::IpcClient::connect(sock).await?;
        let outcome = client.call(rpc_id, method, Some(params), timeout).await?;
        outcome.map_err(CliError::from_rpc)
    })
}
