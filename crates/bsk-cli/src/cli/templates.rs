//! `bsk templates` — manage profile templates (CRUD + apply).
//!
//! Usage:
//!   bsk templates list              List all templates (summaries)
//!   bsk templates get <id>          Show full template details
//!   bsk templates create --name ..  Create a new template
//!   bsk templates update <id> ..    Update template fields
//!   bsk templates delete <id>       Delete a template
//!   bsk templates apply <id>        Apply a template to current profile

use std::path::PathBuf;
use std::time::Duration;

use anyhow::Context;
use bsk_protocol::Method;
use bsk_protocol::template::{
    CookieEntry, ProfileTemplate, StorageEntry, TemplateApplyParams, TemplateApplyResult,
    TemplateCreateParams, TemplateCreateResult, TemplateDeleteParams, TemplateDeleteResult,
    TemplateGetParams, TemplateGetResult, TemplateListParams, TemplateListResult, TemplateSummary,
    TemplateUpdateParams, TemplateUpdateResult,
};
use clap::{Args, Subcommand};
use serde::Deserialize;

use crate::cli::ensure_daemon::ensure_daemon;
use crate::cli::error::{CliError, Format};

// ── CLI args ────────────────────────────────────────────

#[derive(Debug, Args)]
pub struct TemplatesCmd {
    #[command(subcommand)]
    pub sub: TemplatesSub,
}

#[derive(Debug, Subcommand)]
pub enum TemplatesSub {
    /// List all templates (summaries only).
    List,

    /// Show full template details by ID.
    Get(TemplatesGetArgs),

    /// Create a new template.
    Create(TemplatesCreateArgs),

    /// Update an existing template.
    Update(TemplatesUpdateArgs),

    /// Delete a template by ID.
    Delete(TemplatesDeleteArgs),

    /// Apply a template to the current browser profile.
    Apply(TemplatesApplyArgs),
}

#[derive(Debug, Args)]
pub struct TemplatesGetArgs {
    /// Template ID.
    id: String,
}

#[derive(Debug, Args)]
pub struct TemplatesCreateArgs {
    /// Template name (required).
    #[arg(long)]
    name: String,

    /// Description.
    #[arg(long)]
    description: Option<String>,

    /// User-Agent string.
    #[arg(long)]
    user_agent: Option<String>,
}

#[derive(Debug, Args)]
pub struct TemplatesUpdateArgs {
    /// Template ID.
    id: String,

    /// New name.
    #[arg(long)]
    name: Option<String>,

    /// New description.
    #[arg(long)]
    description: Option<String>,

    /// New User-Agent string (pass empty string "" to clear).
    #[arg(long)]
    user_agent: Option<String>,
}

#[derive(Debug, Args)]
pub struct TemplatesDeleteArgs {
    /// Template ID.
    id: String,
}

#[derive(Debug, Args)]
pub struct TemplatesApplyArgs {
    /// Template ID.
    template_id: String,

    /// Scope: what to apply (default: all).
    #[arg(long, value_enum)]
    scope: Option<TemplatesScope>,
}

#[derive(Debug, Clone, clap::ValueEnum)]
enum TemplatesScope {
    All,
    Cookies,
    Storage,
    UserAgent,
}

impl From<TemplatesScope> for bsk_protocol::template::TemplateScope {
    fn from(s: TemplatesScope) -> Self {
        match s {
            TemplatesScope::All => bsk_protocol::template::TemplateScope::All,
            TemplatesScope::Cookies => bsk_protocol::template::TemplateScope::Cookies,
            TemplatesScope::Storage => bsk_protocol::template::TemplateScope::Storage,
            TemplatesScope::UserAgent => bsk_protocol::template::TemplateScope::UserAgent,
        }
    }
}

// ── Dispatch ───────────────────────────────────────────

const TEMPLATE_IPC_TIMEOUT: Duration = Duration::from_secs(10);

pub fn dispatch(cmd: TemplatesCmd, format: Format) -> Result<(), CliError> {
    let info = ensure_daemon().context("ensure daemon is running")?;
    match cmd.sub {
        TemplatesSub::List => run_list(info.sock_path, format),
        TemplatesSub::Get(args) => run_get(info.sock_path, args.id, format),
        TemplatesSub::Create(args) => run_create(info.sock_path, args, format),
        TemplatesSub::Update(args) => run_update(info.sock_path, args, format),
        TemplatesSub::Delete(args) => run_delete(info.sock_path, args.id, format),
        TemplatesSub::Apply(args) => run_apply(info.sock_path, args, format),
    }
}

// ── list ───────────────────────────────────────────────

fn run_list(sock: PathBuf, format: Format) -> Result<(), CliError> {
    let params = TemplateListParams {};
    let reply: TemplateListResult =
        ipc_call(sock, Method::TemplateList, params, TEMPLATE_IPC_TIMEOUT)?;
    match format {
        Format::Json => println!(
            "{}",
            serde_json::to_string_pretty(&reply.templates)
                .map_err(|e| CliError::Local(anyhow::anyhow!(e)))?
        ),
        Format::Human => {
            if reply.templates.is_empty() {
                println!("(no templates)");
                return Ok(());
            }
            let headers = ["ID", "NAME", "COOKIES", "STORAGE", "UA", "UPDATED"];
            let rows: Vec<Vec<String>> = reply
                .templates
                .iter()
                .map(|t| {
                    vec![
                        t.id.clone(),
                        t.name.clone(),
                        t.cookie_count.to_string(),
                        t.storage_count.to_string(),
                        if t.has_user_agent { "yes" } else { "-" }.to_string(),
                        fmt_timestamp(t.updated_at_ms),
                    ]
                })
                .collect();
            print_table(&headers, &rows);
        }
    }
    Ok(())
}

// ── get ────────────────────────────────────────────────

fn run_get(sock: PathBuf, id: String, format: Format) -> Result<(), CliError> {
    let params = TemplateGetParams { id };
    let reply: TemplateGetResult =
        ipc_call(sock, Method::TemplateGet, params, TEMPLATE_IPC_TIMEOUT)?;
    match format {
        Format::Json => println!(
            "{}",
            serde_json::to_string_pretty(&reply.template)
                .map_err(|e| CliError::Local(anyhow::anyhow!(e)))?
        ),
        Format::Human => {
            let t = &reply.template;
            println!("ID:          {}", t.id);
            println!("Name:        {}", t.name);
            if let Some(ref desc) = t.description {
                println!("Description: {}", desc);
            }
            println!("Cookies:     {}", t.cookies.len());
            println!("Storage keys: {}", t.storage.len());
            if let Some(ref ua) = t.user_agent {
                println!("User-Agent:  {}", ua);
            }
            println!("Created:     {}", fmt_timestamp(t.created_at_ms));
            println!("Updated:     {}", fmt_timestamp(t.updated_at_ms));
        }
    }
    Ok(())
}

// ── create ─────────────────────────────────────────────

fn run_create(sock: PathBuf, args: TemplatesCreateArgs, format: Format) -> Result<(), CliError> {
    let params = TemplateCreateParams {
        name: args.name.clone(),
        description: args.description,
        cookies: vec![],
        storage: std::collections::HashMap::new(),
        user_agent: args.user_agent,
    };
    let reply: TemplateCreateResult =
        ipc_call(sock, Method::TemplateCreate, params, TEMPLATE_IPC_TIMEOUT)?;
    match format {
        Format::Json => println!(
            "{}",
            serde_json::to_string_pretty(&reply.template)
                .map_err(|e| CliError::Local(anyhow::anyhow!(e)))?
        ),
        Format::Human => {
            let t = &reply.template;
            println!("Template created: {} ({})", t.name, t.id);
        }
    }
    Ok(())
}

// ── update ─────────────────────────────────────────────

fn run_update(sock: PathBuf, args: TemplatesUpdateArgs, format: Format) -> Result<(), CliError> {
    // Convert user_agent: None means "no change", Some("") means "clear"
    // CLI passes Some(value) when --user-agent is provided
    let user_agent = args
        .user_agent
        .map(|v| if v.is_empty() { None } else { Some(v) });

    let params = TemplateUpdateParams {
        id: args.id.clone(),
        name: args.name,
        description: args.description,
        user_agent,
        cookies: None,
        storage: None,
    };
    let reply: TemplateUpdateResult =
        ipc_call(sock, Method::TemplateUpdate, params, TEMPLATE_IPC_TIMEOUT)?;
    match format {
        Format::Json => println!(
            "{}",
            serde_json::to_string_pretty(&reply.template)
                .map_err(|e| CliError::Local(anyhow::anyhow!(e)))?
        ),
        Format::Human => {
            println!(
                "Template updated: {} ({})",
                reply.template.name, reply.template.id
            );
        }
    }
    Ok(())
}

// ── delete ─────────────────────────────────────────────

fn run_delete(sock: PathBuf, id: String, format: Format) -> Result<(), CliError> {
    let params = TemplateDeleteParams { id };
    let reply: TemplateDeleteResult =
        ipc_call(sock, Method::TemplateDelete, params, TEMPLATE_IPC_TIMEOUT)?;
    match format {
        Format::Json => println!("{{\"deleted\":{}}}", reply.deleted),
        Format::Human => {
            if reply.deleted {
                println!("Template deleted.");
            } else {
                eprintln!("warning: template not found");
            }
        }
    }
    Ok(())
}

// ── apply ──────────────────────────────────────────────

fn run_apply(sock: PathBuf, args: TemplatesApplyArgs, format: Format) -> Result<(), CliError> {
    let scope = args.scope.map(|s| s.into());
    let params = TemplateApplyParams {
        template_id: args.template_id.clone(),
        scope,
    };
    let reply: TemplateApplyResult =
        ipc_call(sock, Method::TemplateApply, params, TEMPLATE_IPC_TIMEOUT)?;
    match format {
        Format::Json => println!(
            "{}",
            serde_json::to_string_pretty(&reply)
                .map_err(|e| CliError::Local(anyhow::anyhow!(e)))?
        ),
        Format::Human => {
            println!(
                "Applied {} cookie(s), {} storage entry(ies), user_agent={}",
                reply.applied_cookies,
                reply.applied_storage,
                if reply.applied_user_agent {
                    "yes"
                } else {
                    "no"
                },
            );
        }
    }
    Ok(())
}

// ── IPC helper ─────────────────────────────────────────

/// Simple IPC call (no SIGINT cancellation — these are short admin commands).
fn ipc_call<P, R>(
    sock: PathBuf,
    method: Method,
    params: P,
    timeout: Duration,
) -> Result<R, CliError>
where
    P: serde::Serialize + Send + 'static,
    R: for<'de> Deserialize<'de> + Send + 'static,
{
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("build tokio runtime for template RPC")
        .map_err(CliError::Local)?;
    rt.block_on(async move {
        let mut client = crate::ipc_client::IpcClient::connect(sock).await?;
        let outcome = client
            .call("tpl-cli", method, Some(params), timeout)
            .await?;
        outcome.map_err(CliError::from_rpc)
    })
}

// ── Rendering helpers ──────────────────────────────────

fn print_table(headers: &[&str], rows: &[Vec<String>]) {
    let ncols = headers.len();
    let widths: Vec<usize> = (0..ncols)
        .map(|i| {
            rows.iter()
                .map(|r| r.get(i).map(|s| s.len()).unwrap_or(0))
                .max()
                .unwrap_or(0)
                .max(headers[i].len())
        })
        .collect();

    // Header row
    let header_parts: Vec<String> = headers
        .iter()
        .enumerate()
        .map(|(i, h)| format!("{:<w$}", h, w = widths[i]))
        .collect();
    println!("{}", header_parts.join("  "));

    // Data rows
    for row in rows {
        let parts: Vec<String> = (0..ncols)
            .map(|i| {
                let cell = row.get(i).map(|s| s.as_str()).unwrap_or("");
                format!("{:<w$}", cell, w = widths[i])
            })
            .collect();
        println!("{}", parts.join("  "));
    }
}

fn fmt_timestamp(ms: i64) -> String {
    if ms <= 0 {
        return "(unknown)".into();
    }
    // Simple relative formatting: "Xh ago" or "YYYY-MM-DD HH:MM" if within range
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let diff = now_ms - ms;
    if diff < 0 {
        // Future timestamp (clock skew), show absolute
        format!("{}ms", ms)
    } else if diff < 60_000 {
        format!("{}s ago", diff / 1000)
    } else if diff < 3_600_000 {
        format!("{}m ago", diff / 60_000)
    } else if diff < 86_400_000 {
        format!("{}h ago", diff / 3_600_000)
    } else {
        // Show as date: rough YYYY-MM-DD from epoch
        let days_since_epoch = ms / 86_400_000;
        // Approximate conversion (ignoring leap seconds, good enough for CLI display)
        let year = 1970 + (days_since_epoch / 365);
        let day_of_year = (days_since_epoch % 365) as u32;
        let month = day_of_year / 30 + 1;
        let day = day_of_year % 30 + 1;
        format!("{}-{:02}-{:02}", year, month, day)
    }
}

// ── Tests ─────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── fmt_timestamp ─────────────────────────────────

    #[test]
    fn fmt_timestamp_zero_returns_unknown() {
        assert_eq!(fmt_timestamp(0), "(unknown)");
    }

    #[test]
    fn fmt_timestamp_negative_returns_unknown() {
        assert_eq!(fmt_timestamp(-1), "(unknown)");
        assert_eq!(fmt_timestamp(-99999), "(unknown)");
    }

    #[test]
    fn fmt_timestamp_recent_shows_seconds() {
        let recent = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64 - 5000)
            .unwrap_or(0);
        let result = fmt_timestamp(recent);
        assert!(
            result.contains("s ago"),
            "expected 's ago' for recent timestamp, got: {result}"
        );
    }

    #[test]
    fn fmt_timestamp_old_shows_date_format() {
        let old_2024 = 1_704_068_000_000i64;
        let result = fmt_timestamp(old_2024);
        assert!(
            result.matches(char::is_numeric).count() >= 4,
            "expected date-like format, got: {result}"
        );
        assert!(
            !result.contains("ago"),
            "should not be relative for old timestamps"
        );
    }

    #[test]
    fn fmt_timestamp_future_shows_raw_ms() {
        let future = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64 + 100_000_000)
            .unwrap_or(i64::MAX);
        let result = fmt_timestamp(future);
        assert!(
            result.ends_with("ms") || result.contains("ms"),
            "expected raw ms format for future timestamp, got: {result}"
        );
    }

    // ── print_table ───────────────────────────────────

    #[test]
    fn print_table_empty_rows_does_not_panic() {
        let headers = ["ID", "NAME"];
        let rows: Vec<Vec<String>> = vec![];
        print_table(&headers, &rows);
    }

    #[test]
    fn print_table_single_row_does_not_panic() {
        let headers = ["SHORT", "A_VERY_LONG_HEADER_NAME"];
        let rows = vec![vec!["value1".into(), "value2".into()]];
        print_table(&headers, &rows);
    }

    #[test]
    fn print_table_multiple_rows_consistent_width() {
        let headers = ["COL_A", "COL_B"];
        let rows = vec![
            vec!["short".into(), "short_value".into()],
            vec!["much_longer_value".into(), "x".into()],
        ];
        print_table(&headers, &rows);
    }

    #[test]
    fn print_table_handles_wide_cell_content() {
        let headers = ["A"];
        let rows = vec![vec![
            "a very wide cell content that exceeds header width".into(),
        ]];
        print_table(&headers, &rows);
    }

    // ── TemplatesScope conversion ─────────────────────

    #[test]
    fn templates_scope_all_maps_to_protocol_all() {
        let proto: bsk_protocol::template::TemplateScope = TemplatesScope::All.into();
        assert_eq!(proto, bsk_protocol::template::TemplateScope::All);
    }

    #[test]
    fn templates_scope_cookies_maps_to_protocol_cookies() {
        let proto: bsk_protocol::template::TemplateScope = TemplatesScope::Cookies.into();
        assert_eq!(proto, bsk_protocol::template::TemplateScope::Cookies);
    }

    #[test]
    fn templates_scope_storage_maps_to_protocol_storage() {
        let proto: bsk_protocol::template::TemplateScope = TemplatesScope::Storage.into();
        assert_eq!(proto, bsk_protocol::template::TemplateScope::Storage);
    }

    #[test]
    fn templates_scope_user_agent_maps_to_protocol_user_agent() {
        let proto: bsk_protocol::template::TemplateScope = TemplatesScope::UserAgent.into();
        assert_eq!(proto, bsk_protocol::template::TemplateScope::UserAgent);
    }

    // ── Serialization round-trips ──────────────────────

    #[test]
    fn template_list_result_serialises_to_json() {
        let reply = TemplateListResult {
            templates: vec![TemplateSummary {
                id: "aaa".into(),
                name: "T1".into(),
                description: Some("Desc".into()),
                cookie_count: 3,
                storage_count: 5,
                has_user_agent: true,
                created_at_ms: 1000,
                updated_at_ms: 2000,
            }],
        };
        let json = serde_json::to_string(&reply).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["templates"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["templates"][0]["id"], "aaa");
        assert!(parsed["templates"][0].get("cookies").is_none());
        assert!(parsed["templates"][0].get("storage").is_none());
    }

    #[test]
    fn template_list_result_empty_serialises() {
        let reply = TemplateListResult { templates: vec![] };
        let json = serde_json::to_string(&reply).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["templates"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn template_get_result_contains_full_data() {
        let reply = TemplateGetResult {
            template: ProfileTemplate {
                id: "bbb".into(),
                name: "Full".into(),
                description: None,
                cookies: vec![CookieEntry {
                    name: "sess".into(),
                    value: "abc123".into(),
                    domain: ".example.com".into(),
                    path: Some("/".into()),
                    secure: Some(true),
                    http_only: Some(true),
                }],
                storage: [(
                    "key1".into(),
                    StorageEntry {
                        value: "val1".into(),
                    },
                )]
                .into_iter()
                .collect(),
                user_agent: Some("Bot/1.0".into()),
                created_at_ms: 3000,
                updated_at_ms: 4000,
            },
        };
        let json = serde_json::to_string_pretty(&reply).unwrap();
        assert!(json.contains("\"sess\""));
        assert!(json.contains("\"abc123\""));
        assert!(json.contains("\"val1\""));
        assert!(json.contains("\"Bot/1.0\""));
    }

    #[test]
    fn template_delete_result_serialises() {
        let reply = TemplateDeleteResult { deleted: true };
        assert_eq!(serde_json::to_string(&reply).unwrap(), "{\"deleted\":true}");
        let reply2 = TemplateDeleteResult { deleted: false };
        assert_eq!(
            serde_json::to_string(&reply2).unwrap(),
            "{\"deleted\":false}"
        );
    }

    #[test]
    fn template_apply_result_serialises() {
        let reply = TemplateApplyResult {
            applied_cookies: 5,
            applied_storage: 3,
            applied_user_agent: true,
        };
        let json = serde_json::to_string(&reply).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["applied_cookies"], 5);
        assert_eq!(parsed["applied_storage"], 3);
        assert_eq!(parsed["applied_user_agent"], true);
    }

    #[test]
    fn template_create_params_round_trip() {
        let params = TemplateCreateParams {
            name: "Test".into(),
            description: Some("Desc".into()),
            cookies: vec![CookieEntry {
                name: "c".into(),
                value: "v".into(),
                domain: ".d.com".into(),
                path: None,
                secure: None,
                http_only: None,
            }],
            storage: [("k".into(), StorageEntry { value: "sv".into() })]
                .into_iter()
                .collect(),
            user_agent: Some("UA/1.0".into()),
        };
        let json = serde_json::to_value(&params).unwrap();
        let back: TemplateCreateParams = serde_json::from_value(json).unwrap();
        assert_eq!(back.name, "Test");
        assert_eq!(back.cookies.len(), 1);
        assert_eq!(back.storage.len(), 1);
    }

    #[test]
    fn template_update_params_null_user_agent_clears() {
        let params = TemplateUpdateParams {
            id: "t1".into(),
            name: None,
            description: None,
            cookies: None,
            storage: None,
            user_agent: Some(None),
        };
        let json = serde_json::to_value(&params).unwrap();
        assert_eq!(json.get("user_agent").unwrap().is_null(), true);
    }
}
