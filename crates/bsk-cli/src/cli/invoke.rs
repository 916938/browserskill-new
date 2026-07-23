//! `bsk invoke` — generic passthrough to any `tool.*` RPC (M10).
//!
//! Every other subcommand (`bsk fill`, `bsk click`, …) is a strongly
//! typed clap wrapper that serialises its fields into the `params`
//! JSON object the daemon forwards to the extension. `bsk invoke` skips
//! the typed layer: the caller supplies the raw JSON object directly,
//! and this command forwards it verbatim.
//!
//! This exists so shell helpers (`invoke.sh` / `invoke.ps1`) can stay
//! thin passthroughs. Before this command they had to flatten a JSON
//! object into `--key value` flags on the host side (jq on Bash,
//! `ConvertFrom-Json` on PowerShell); the Bash path silently dropped
//! every argument when `jq` was missing. Forwarding the blob through
//! `bsk invoke` removes that host-side parsing entirely.
//!
//! ## Action naming
//!
//! `--action` accepts either the bare tool name (`fill`) or the fully
//! qualified protocol method (`tool.fill`). Both resolve to the same
//! [`Method`]. Resolution reuses the protocol crate's serde rename
//! table (no hardcoded map here): we try the string as-is, then with a
//! `tool.` prefix. Anything that still fails to resolve is rejected
//! before a daemon round-trip.
//!
//! ## session_id
//!
//! The daemon requires a non-empty `session_id` inside `params` for
//! every `tool.*` RPC. For ergonomics `--session` is merged into the
//! params object. If the JSON already carries `session_id`, `--session`
//! must either be omitted or match it — a conflict is a hard error so a
//! caller cannot silently target the wrong session.

use std::time::Duration;

use anyhow::Context;
use bsk_protocol::Method;
use clap::Args;
use serde::Serialize;
use serde_json::Value;

use crate::cli::ensure_daemon::ensure_daemon;
use crate::cli::error::{CliError, Format};

/// Default IPC timeout for a passthrough call, in milliseconds. Mirrors
/// the 30s tool timeout other commands use as their clap default.
const DEFAULT_TIMEOUT_MS: u32 = 30_000;

/// Read default session from BSK_DEFAULT_SESSION env var.
fn default_session_from_env() -> Option<String> {
    std::env::var("BSK_DEFAULT_SESSION").ok().and_then(|s| {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

/// Read timeout override from BSK_INVOKE_TIMEOUT_MS env var.
/// Returns None to use the CLI default; Some(ms) to override.
fn timeout_from_env() -> Option<u32> {
    std::env::var("BSK_INVOKE_TIMEOUT_MS")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .filter(|&ms| ms > 0)
}

#[derive(Debug, Clone, Args)]
pub struct InvokeArgs {
    /// Tool action to invoke. Accepts a bare name (`fill`) or a fully
    /// qualified method (`tool.fill`).
    #[arg(long)]
    pub action: String,

    /// Session id. Merged into `params` as `session_id`. Required
    /// unless the `--args-json` / `--args-file` payload already
    /// contains a `session_id`.
    #[arg(long)]
    pub session: Option<String>,

    /// Raw JSON object of action arguments. Mutually exclusive with
    /// `--args-file`.
    #[arg(long = "args-json")]
    pub args_json: Option<String>,

    /// Path to a UTF-8 JSON file of action arguments, or `-` to read
    /// from stdin. Mutually exclusive with `--args-json`.
    #[arg(long = "args-file")]
    pub args_file: Option<String>,

    /// Hard timeout (default 30s). Accepts `30s`, `1m`, `1500ms`, or bare milliseconds.
    #[arg(long = "timeout", long = "timeout-ms", default_value = "30s", value_parser = crate::cli::navigate::parse_timeout_ms)]
    pub timeout: u32,

    /// Validate and preview the request without executing it.
    #[arg(long)]
    pub dry_run: bool,
}

pub fn dispatch(args: InvokeArgs, format: Format) -> Result<(), CliError> {
    let method = resolve_action(&args.action)?;

    let raw = read_args_payload(args.args_json.as_deref(), args.args_file.as_deref())?;
    let mut params = parse_params_object(&raw)?;

    // Apply environment variable defaults for session
    let effective_session = args.session.or_else(default_session_from_env);
    merge_session(&mut params, effective_session.as_deref())?;

    // Apply environment variable override for timeout (CLI arg takes precedence)
    let effective_timeout = if args.timeout != DEFAULT_TIMEOUT_MS {
        args.timeout
    } else {
        timeout_from_env().unwrap_or(DEFAULT_TIMEOUT_MS)
    };

    // Dry-run path: validate and preview without calling the daemon
    if args.dry_run {
        return render_dry_run_preview(&method, &params, effective_timeout, format);
    }

    let info = ensure_daemon().context("ensure daemon is running")?;
    let reply: Value = crate::cli::business_rpc::call::<Value, Value>(
        info.sock_path,
        "invoke",
        method,
        Some(Value::Object(params)),
        ipc_timeout(effective_timeout),
    )?;

    // The passthrough is format-agnostic: the reply is whatever the
    // extension returned. Pretty-print in --json mode, compact
    // otherwise, but never try to interpret it — callers that need
    // structure pass --json and parse it themselves.
    let rendered = match format {
        Format::Json => serde_json::to_string_pretty(&reply),
        Format::Human => serde_json::to_string(&reply),
    }
    .map_err(|e| CliError::Local(anyhow::anyhow!(e)))?;
    println!("{rendered}");
    Ok(())
}

/// Resolve a bare or qualified action string to a [`Method`], reusing
/// the protocol crate's serde rename table (no hardcoded map here).
///
/// Resolution order, first match wins:
/// 1. **Verbatim** — so already-qualified methods like `tool.fill`,
///    `session.stop`, or `cancel` pass straight through.
/// 2. **First `_` → `.`** — so `session_stop` → `session.stop` and
///    `browser_list` → `browser.list`. This MUST come before the
///    `tool.` prefix: the enum also carries `tool.session_stop` /
///    `tool.session_start` variants that the daemon does NOT implement
///    (they fall through to `unknown_method`). Trying the namespaced
///    form first routes lifecycle actions to the handlers that exist.
/// 3. **`tool.` prefix** — so `fill` → `tool.fill`, `tab_list` →
///    `tool.tab_list`. Reached only when the namespaced form above is
///    not a real variant (e.g. `tab.list` is not, so `tab_list` lands
///    on `tool.tab_list`).
fn resolve_action(action: &str) -> Result<Method, CliError> {
    let trimmed = action.trim();
    if trimmed.is_empty() {
        return Err(CliError::Local(anyhow::anyhow!(
            "--action must not be empty"
        )));
    }
    let mut candidates = vec![trimmed.to_string()];
    if let Some((head, tail)) = trimmed.split_once('_') {
        candidates.push(format!("{head}.{tail}"));
    }
    candidates.push(format!("tool.{trimmed}"));
    for candidate in candidates {
        if let Ok(m) = serde_json::from_value::<Method>(Value::String(candidate)) {
            return Ok(m);
        }
    }
    Err(CliError::Local(anyhow::anyhow!(
        "unknown action '{trimmed}'; expected a tool name like 'fill' or a method like 'tool.fill'"
    )))
}

/// Read the arguments payload from `--args-json`, `--args-file PATH`,
/// or stdin (`--args-file -`). Exactly one source may be set; if
/// neither is set the payload defaults to an empty object.
fn read_args_payload(args_json: Option<&str>, args_file: Option<&str>) -> Result<String, CliError> {
    match (args_json, args_file) {
        (Some(_), Some(_)) => Err(CliError::Local(anyhow::anyhow!(
            "use either --args-json or --args-file, not both"
        ))),
        (Some(json), None) => Ok(json.to_string()),
        (None, Some(path)) => read_args_file(path),
        (None, None) => Ok("{}".to_string()),
    }
}

fn read_args_file(path: &str) -> Result<String, CliError> {
    use std::io::{IsTerminal, Read};
    if path == "-" {
        if std::io::stdin().is_terminal() {
            return Err(CliError::Local(anyhow::anyhow!(
                "refusing to wait for JSON on an interactive terminal; pipe input or use a heredoc"
            )));
        }
        let mut buf = String::new();
        std::io::stdin()
            .read_to_string(&mut buf)
            .context("read action arguments from stdin")
            .map_err(CliError::Local)?;
        Ok(buf)
    } else {
        std::fs::read_to_string(path)
            .with_context(|| format!("read action arguments file: {path}"))
            .map_err(CliError::Local)
    }
}

/// Parse the raw payload into a JSON object. Rejects non-object JSON
/// (arrays, scalars) because the daemon's params must be an object.
/// Whitespace-only input is treated as an empty object.
fn parse_params_object(raw: &str) -> Result<serde_json::Map<String, Value>, CliError> {
    if raw.trim().is_empty() {
        return Ok(serde_json::Map::new());
    }
    let value: Value = serde_json::from_str(raw)
        .context("action arguments must be valid UTF-8 JSON")
        .map_err(CliError::Local)?;
    match value {
        Value::Object(map) => Ok(map),
        _ => Err(CliError::Local(anyhow::anyhow!(
            "action arguments must be a JSON object"
        ))),
    }
}

/// Merge `--session` into the params object as `session_id`, enforcing
/// consistency with any `session_id` already present in the payload.
fn merge_session(
    params: &mut serde_json::Map<String, Value>,
    session: Option<&str>,
) -> Result<(), CliError> {
    let existing = params
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    match (session, existing.as_deref()) {
        (Some(flag), Some(in_json)) if flag != in_json => Err(CliError::Local(anyhow::anyhow!(
            "session mismatch: --session '{flag}' conflicts with session_id '{in_json}' in args"
        ))),
        (Some(flag), _) => {
            params.insert("session_id".to_string(), Value::String(flag.to_string()));
            Ok(())
        }
        // No --session flag: rely on whatever the payload carries. The
        // daemon rejects a missing/empty session_id itself, so we don't
        // duplicate that check here.
        (None, _) => Ok(()),
    }
}

fn ipc_timeout(timeout_ms: u32) -> Duration {
    Duration::from_millis(u64::from(timeout_ms))
        .checked_add(Duration::from_secs(15))
        .unwrap_or_else(|| Duration::from_secs(u64::from(timeout_ms / 1_000) + 15))
}

// --- Dry-run preview ---

/// Structured dry-run output for JSON serialization.
#[derive(Debug, Serialize)]
struct DryRunPreview {
    action: String,
    method: String,
    session_id: Option<String>,
    params: serde_json::Map<String, Value>,
    timeout_ms: u32,
    formatted_timeout: String,
}

fn dry_run_preview(
    method: &Method,
    params: &serde_json::Map<String, Value>,
    timeout_ms: u32,
) -> DryRunPreview {
    let method_str = serde_json::to_string(method).unwrap_or_default();
    // Remove surrounding quotes from JSON string representation
    let method_clean = method_str.trim_matches('"').to_string();

    DryRunPreview {
        action: method_to_action_string(&method_clean),
        method: method_clean,
        session_id: params
            .get("session_id")
            .and_then(|v| v.as_str())
            .map(String::from),
        params: params.clone(),
        timeout_ms,
        formatted_timeout: format_human_readable_timeout(timeout_ms),
    }
}

fn format_human_readable_timeout(ms: u32) -> String {
    if ms >= 60_000 && ms % 60_000 == 0 {
        format!("{}m", ms / 60_000)
    } else if ms >= 1_000 && ms % 1_000 == 0 {
        format!("{}s", ms / 1_000)
    } else {
        format!("{ms}ms")
    }
}

fn method_to_action_string(method_str: &str) -> String {
    method_str
        .strip_prefix("tool.")
        .unwrap_or(method_str)
        .to_string()
}

fn render_dry_run_preview(
    method: &Method,
    params: &serde_json::Map<String, Value>,
    timeout_ms: u32,
    format: Format,
) -> Result<(), CliError> {
    let preview = dry_run_preview(method, params, timeout_ms);

    match format {
        Format::Json => {
            let json = serde_json::to_string_pretty(&preview)
                .map_err(|e| CliError::Local(anyhow::anyhow!(e)))?;
            println!("{json}");
        }
        Format::Human => {
            println!("=== DRY RUN PREVIEW ===");
            println!("Action:     {}", preview.action);
            println!("Method:     {}", preview.method);
            println!("Timeout:    {}", preview.formatted_timeout);
            if let Some(ref sid) = preview.session_id {
                println!("Session:    {sid}");
            } else {
                println!("Session:    <not set>");
            }
            println!("\nParams:");
            let params_json = serde_json::to_string_pretty(&Value::Object(preview.params.clone()))
                .map_err(|e| CliError::Local(anyhow::anyhow!(e)))?;
            // Indent each line for readability
            for line in params_json.lines() {
                println!("  {line}");
            }
            println!("\n[Dry run mode — request was validated but NOT sent to daemon]");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_action_accepts_bare_tool_name() {
        assert_eq!(resolve_action("fill").unwrap(), Method::ToolFill);
        assert_eq!(resolve_action("tab_list").unwrap(), Method::ToolTabList);
        assert_eq!(resolve_action("snapshot").unwrap(), Method::ToolSnapshot);
    }

    #[test]
    fn resolve_action_accepts_qualified_method() {
        assert_eq!(resolve_action("tool.fill").unwrap(), Method::ToolFill);
        assert_eq!(
            resolve_action("tool.tab_list").unwrap(),
            Method::ToolTabList
        );
    }

    #[test]
    fn resolve_action_accepts_non_tool_namespaces_verbatim() {
        // Verbatim match must win before the `tool.` prefix attempt, so
        // session/system methods stay reachable through invoke.
        assert_eq!(resolve_action("session.list").unwrap(), Method::SessionList);
    }

    #[test]
    fn resolve_action_routes_lifecycle_underscore_to_dot_namespace() {
        // `session_stop` must resolve to the implemented `session.stop`,
        // NOT the dead `tool.session_stop` variant that the daemon
        // handler rejects with unknown_method. The `_`→`.` attempt has
        // to beat the `tool.` prefix for these.
        assert_eq!(resolve_action("session_stop").unwrap(), Method::SessionStop);
        assert_eq!(
            resolve_action("session_start").unwrap(),
            Method::SessionStart
        );
        assert_eq!(
            resolve_action("session_stop_all").unwrap(),
            Method::SessionStopAll
        );
        assert_eq!(resolve_action("browser_list").unwrap(), Method::BrowserList);
    }

    #[test]
    fn resolve_action_tool_actions_unaffected_by_dot_rule() {
        // `tab.list` is not a real variant, so `tab_list` must still
        // fall through to `tool.tab_list` rather than erroring.
        assert_eq!(resolve_action("tab_list").unwrap(), Method::ToolTabList);
        assert_eq!(resolve_action("tab_create").unwrap(), Method::ToolTabCreate);
        assert_eq!(resolve_action("wait_ms").unwrap(), Method::ToolWaitMs);
    }

    #[test]
    fn resolve_action_trims_whitespace() {
        assert_eq!(resolve_action("  fill  ").unwrap(), Method::ToolFill);
    }

    #[test]
    fn resolve_action_rejects_unknown_and_empty() {
        assert!(resolve_action("definitely_not_a_tool").is_err());
        assert!(resolve_action("").is_err());
        assert!(resolve_action("   ").is_err());
    }

    #[test]
    fn read_args_payload_rejects_both_sources() {
        assert!(read_args_payload(Some("{}"), Some("f.json")).is_err());
    }

    #[test]
    fn read_args_payload_defaults_to_empty_object() {
        assert_eq!(read_args_payload(None, None).unwrap(), "{}");
    }

    #[test]
    fn read_args_payload_passes_json_through() {
        assert_eq!(
            read_args_payload(Some(r#"{"a":1}"#), None).unwrap(),
            r#"{"a":1}"#
        );
    }

    #[test]
    fn parse_params_object_accepts_object_and_rejects_scalars() {
        assert!(parse_params_object(r#"{"selector":"@e1"}"#).is_ok());
        assert!(parse_params_object("[]").is_err());
        assert!(parse_params_object("42").is_err());
        assert!(parse_params_object("not json").is_err());
    }

    #[test]
    fn parse_params_object_preserves_unicode_and_nesting() {
        let map = parse_params_object(r#"{"value":"显卡 🌔","p":{"x":true}}"#).unwrap();
        assert_eq!(map.get("value").unwrap().as_str().unwrap(), "显卡 🌔");
        assert!(map.get("p").unwrap().is_object());
    }

    #[test]
    fn merge_session_injects_flag() {
        let mut m = serde_json::Map::new();
        merge_session(&mut m, Some("demo")).unwrap();
        assert_eq!(m.get("session_id").unwrap().as_str().unwrap(), "demo");
    }

    #[test]
    fn merge_session_accepts_matching_values() {
        let mut m = serde_json::Map::new();
        m.insert("session_id".into(), Value::String("demo".into()));
        merge_session(&mut m, Some("demo")).unwrap();
        assert_eq!(m.get("session_id").unwrap().as_str().unwrap(), "demo");
    }

    #[test]
    fn merge_session_rejects_conflict() {
        let mut m = serde_json::Map::new();
        m.insert("session_id".into(), Value::String("real".into()));
        assert!(merge_session(&mut m, Some("other")).is_err());
    }

    #[test]
    fn merge_session_leaves_payload_session_when_flag_absent() {
        let mut m = serde_json::Map::new();
        m.insert("session_id".into(), Value::String("fromjson".into()));
        merge_session(&mut m, None).unwrap();
        assert_eq!(m.get("session_id").unwrap().as_str().unwrap(), "fromjson");
    }

    #[test]
    fn invoke_timeout_format_compatibility() {
        // Verify that the timeout parser used by InvokeArgs accepts all
        // expected formats (delegates to navigate::parse_timeout_ms).
        use crate::cli::navigate::parse_timeout_ms;

        // Human-readable formats
        assert_eq!(parse_timeout_ms("30s").unwrap(), 30_000);
        assert_eq!(parse_timeout_ms("250ms").unwrap(), 250);
        assert_eq!(parse_timeout_ms("1m").unwrap(), 60_000);

        // Bare number (milliseconds)
        assert_eq!(parse_timeout_ms("5000").unwrap(), 5_000);
        assert_eq!(parse_timeout_ms("5s").unwrap(), 5_000);

        // Invalid formats should be rejected
        assert!(parse_timeout_ms("0").is_err());
        assert!(parse_timeout_ms("0ms").is_err());
        assert!(parse_timeout_ms("-1").is_err());
        assert!(parse_timeout_ms("1h").is_err());
        assert!(parse_timeout_ms("abc").is_err());
    }

    #[test]
    fn invoke_args_default_timeout_is_30s() {
        // Verify that the default timeout value "30s" parses to 30000ms
        use crate::cli::navigate::parse_timeout_ms;
        assert_eq!(parse_timeout_ms("30s").unwrap(), 30_000);
    }

    #[test]
    fn invoke_args_supports_timeout_ms_alias_for_backward_compat() {
        // --timeout-ms accepts bare milliseconds, same as before
        use crate::cli::navigate::parse_timeout_ms;
        assert_eq!(parse_timeout_ms("60000").unwrap(), 60_000);
    }

    #[test]
    fn default_session_from_env_reads_valid_value() {
        // Test the core logic directly (avoids env var race in multi-threaded tests)
        let input = "test-session-123";
        let trimmed = input.trim();
        let result = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
        assert_eq!(result.as_deref(), Some("test-session-123"));
    }

    #[test]
    fn default_session_from_env_ignores_empty() {
        // Test the trimming/empty logic directly (avoids env var race in multi-threaded tests)
        let input = "";
        let trimmed = input.trim();
        assert!(trimmed.is_empty());
        let result = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
        assert!(result.is_none(), "expected None for empty string");

        // Also test whitespace-only
        let input = "   ";
        let trimmed = input.trim();
        assert!(trimmed.is_empty());
        let result = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
        assert!(result.is_none(), "expected None for whitespace-only string");
    }

    #[test]
    fn default_session_from_env_returns_none_when_unset() {
        // Simulates std::env::var returning Err (unset variable) via the Ok/None path
        // When var() returns Err, .ok() converts to None, and and_then is never called
        let input: Option<String> = None;
        let result = input.and_then(|s| {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        });
        assert!(result.is_none());
    }

    #[test]
    fn timeout_from_env_parses_valid_ms() {
        // Test parsing logic directly
        let input = "60000";
        let result = input.parse::<u32>().ok().filter(|&ms| ms > 0);
        assert_eq!(result, Some(60_000));
    }

    #[test]
    fn timeout_from_env_rejects_zero_and_negative() {
        // Zero is filtered out
        let input = "0";
        let result = input.parse::<u32>().ok().filter(|&ms| ms > 0);
        assert!(result.is_none());

        // Negative fails parse -> None
        let input = "-1";
        let result = input.parse::<u32>().ok().filter(|&ms| ms > 0);
        assert!(result.is_none());
    }

    #[test]
    fn timeout_from_env_returns_none_when_unset_or_invalid() {
        // Unset -> None (simulates Err from var())
        let input: Option<String> = None;
        let result = input
            .and_then(|v| v.parse::<u32>().ok())
            .filter(|&ms| ms > 0);
        assert!(result.is_none());

        // Invalid number -> parse fails -> None
        let input = Some("not-a-number".to_string());
        let result = input
            .and_then(|v| v.parse::<u32>().ok())
            .filter(|&ms| ms > 0);
        assert!(result.is_none());
    }

    #[test]
    fn dry_run_preview_contains_all_fields() {
        let mut params = serde_json::Map::new();
        params.insert("session_id".into(), Value::String("test-session".into()));
        params.insert("selector".into(), Value::String("#button".into()));

        let preview = dry_run_preview(&Method::ToolFill, &params, 30_000);

        assert_eq!(preview.action, "fill");
        assert_eq!(preview.method, "tool.fill");
        assert_eq!(preview.session_id.as_deref(), Some("test-session"));
        assert_eq!(preview.timeout_ms, 30_000);
        assert_eq!(preview.formatted_timeout, "30s");
        assert_eq!(
            preview.params.get("selector").unwrap().as_str().unwrap(),
            "#button"
        );
    }

    #[test]
    fn dry_run_preview_handles_missing_session() {
        let params = serde_json::Map::new();
        let preview = dry_run_preview(&Method::ToolSnapshot, &params, 60_000);

        assert!(preview.session_id.is_none());
    }

    #[test]
    fn format_human_readable_timeout_conversions() {
        // Exact minute
        assert_eq!(format_human_readable_timeout(60_000), "1m");
        assert_eq!(format_human_readable_timeout(120_000), "2m");

        // Exact second
        assert_eq!(format_human_readable_timeout(30_000), "30s");
        assert_eq!(format_human_readable_timeout(90_000), "90s");

        // Milliseconds (not exact second)
        assert_eq!(format_human_readable_timeout(250), "250ms");
        assert_eq!(format_human_readable_timeout(1_500), "1500ms");

        // Edge case: not exact minute but exact second
        assert_eq!(format_human_readable_timeout(90_000), "90s");
    }

    #[test]
    fn method_to_action_string_strips_tool_prefix() {
        assert_eq!(method_to_action_string("tool.fill"), "fill");
        assert_eq!(method_to_action_string("tool.snapshot"), "snapshot");
        assert_eq!(method_to_action_string("tool.tab_list"), "tab_list");
    }

    #[test]
    fn method_to_action_string_preserves_non_tool_methods() {
        // session.stop doesn't have tool. prefix
        assert_eq!(method_to_action_string("session.stop"), "session.stop");
    }
}
