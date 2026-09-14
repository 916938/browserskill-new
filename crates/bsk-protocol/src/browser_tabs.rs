use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum UserTabScope {
    User,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BrowserTabsListParams {
    pub browser_id: String,
    pub scope: UserTabScope,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BrowserTabsSelectParams {
    pub browser_id: String,
    pub tab_id: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_origin: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BrowserTabsCreateParams {
    pub browser_id: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct UserTabInfo {
    pub tab_id: i64,
    pub window_id: i64,
    pub title: String,
    pub url: String,
    pub active: bool,
    pub scope: UserTabScope,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct BrowserTabsListResult {
    pub tabs: Vec<UserTabInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct BrowserTabResult {
    pub tab_id: i64,
    pub window_id: i64,
}

pub const DEFAULT_OBSERVE_CHARS: u32 = 4000;
pub const MAX_OBSERVE_CHARS: u32 = 8000;
pub const MAX_OBSERVE_BYTES: usize = 16000;

fn default_observe_chars() -> u32 {
    DEFAULT_OBSERVE_CHARS
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BrowserTabsObserveParams {
    pub browser_id: String,
    pub tab_id: i64,
    pub expected_origin: String,
    #[serde(default = "default_observe_chars")]
    pub max_chars: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BrowserTabsObserveResult {
    pub browser_id: String,
    pub tab_id: i64,
    pub window_id: i64,
    pub origin: String,
    pub document_id: String,
    pub text: String,
    pub truncated: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn browser_tabs_params_reject_session_and_non_user_scope() {
        assert!(
            serde_json::from_value::<BrowserTabsListParams>(
                json!({"browser_id": "exact", "scope": "all"})
            )
            .is_err()
        );
        assert!(
            serde_json::from_value::<BrowserTabsListParams>(
                json!({"browser_id": "exact", "scope": "user", "session_id": "session"})
            )
            .is_err()
        );
        assert!(
            serde_json::from_value::<BrowserTabsSelectParams>(
                json!({"browser_id": "exact", "tab_id": 7, "session_id": "session"})
            )
            .is_err()
        );
        assert!(
            serde_json::from_value::<BrowserTabsCreateParams>(
                json!({"browser_id": "exact", "url": "https://site.test", "session_id": "session"})
            )
            .is_err()
        );
    }

    #[test]
    fn browser_tabs_wire_contract_round_trips() {
        let list = json!({"tabs": [{"tab_id": 7, "window_id": 20, "title": "Site",
            "url": "https://site.test", "active": true, "scope": "user"}]});
        let result: BrowserTabsListResult = serde_json::from_value(list.clone()).unwrap();
        assert_eq!(serde_json::to_value(result).unwrap(), list);
        let tab = json!({"tab_id": 7, "window_id": 20});
        let result: BrowserTabResult = serde_json::from_value(tab.clone()).unwrap();
        assert_eq!(serde_json::to_value(result).unwrap(), tab);
        let params = json!({"browser_id": "exact", "tab_id": 7,
            "expected_origin": "https://site.test"});
        let select: BrowserTabsSelectParams = serde_json::from_value(params.clone()).unwrap();
        assert_eq!(serde_json::to_value(select).unwrap(), params);
    }
}
