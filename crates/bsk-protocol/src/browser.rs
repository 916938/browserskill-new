//! Browser-level control payloads (`browser.close`).
//!
//! Closing a browser is the only operation that reaches outside a
//! session: it stops every session of that instance and then closes all
//! of its windows, which makes the browser process exit. It is therefore
//! gated behind an explicit `confirm` flag on the wire and `--confirm`
//! on the CLI — no caller quits a browser by accident.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// `browser.close` request payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BrowserCloseParams {
    /// Exact `instance_id` reported by `bsk browsers`. Smart labels and
    /// prefixes are never accepted here: closing the wrong browser is
    /// unrecoverable.
    pub browser_id: String,
    /// Must be `true`. Kept on the wire (not just on the CLI) so a
    /// non-CLI peer cannot quit a browser without acknowledging it.
    pub confirm: bool,
}

/// `browser.close` response payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct BrowserCloseResult {
    /// Echo of the requested `instance_id`.
    pub browser_id: String,
    /// `true` when every window of the instance was closed (or the
    /// connection dropped, see [`Self::disconnected`]). The browser
    /// process is expected to exit.
    pub closed: bool,
    /// Windows the extension closed before replying.
    pub windows_closed: u32,
    /// Sessions that were stopped so their Agent Windows did not leak.
    pub sessions_stopped: u32,
    /// `true` when the extension's reply never arrived because its
    /// WebSocket dropped — i.e. the browser went away while closing.
    /// The daemon reports success in that case; `windows_closed` may
    /// then under-report.
    pub disconnected: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn close_params_round_trip() {
        let params: BrowserCloseParams =
            serde_json::from_value(json!({ "browser_id": "abc123", "confirm": true })).unwrap();
        assert_eq!(params.browser_id, "abc123");
        assert!(params.confirm);
        assert_eq!(
            serde_json::to_value(params).unwrap(),
            json!({ "browser_id": "abc123", "confirm": true })
        );
    }

    #[test]
    fn close_params_require_confirm() {
        assert!(
            serde_json::from_value::<BrowserCloseParams>(json!({ "browser_id": "abc123" }))
                .is_err()
        );
    }

    #[test]
    fn close_params_reject_unknown_fields() {
        assert!(
            serde_json::from_value::<BrowserCloseParams>(json!({
                "browser_id": "abc123",
                "confirm": true,
                "force": true
            }))
            .is_err()
        );
    }

    #[test]
    fn close_result_round_trip() {
        let result = BrowserCloseResult {
            browser_id: "abc123".into(),
            closed: true,
            windows_closed: 2,
            sessions_stopped: 1,
            disconnected: false,
        };
        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            json!({
                "browser_id": "abc123",
                "closed": true,
                "windows_closed": 2,
                "sessions_stopped": 1,
                "disconnected": false
            })
        );
        let back: BrowserCloseResult =
            serde_json::from_value(serde_json::to_value(&result).unwrap()).unwrap();
        assert_eq!(back, result);
    }
}
