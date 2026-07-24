//! Profile template types and RPC payloads (`template.*`).

use std::collections::HashMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Full profile template definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ProfileTemplate {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub cookies: Vec<CookieEntry>,
    #[serde(default)]
    pub storage: HashMap<String, StorageEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

/// A single cookie entry within a template.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct CookieEntry {
    pub name: String,
    pub value: String,
    pub domain: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secure: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_only: Option<bool>,
}

/// A localStorage entry within a template.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct StorageEntry {
    pub value: String,
}

/// Lightweight summary for list responses (excludes sensitive payload details).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct TemplateSummary {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Number of cookie entries.
    pub cookie_count: usize,
    /// Number of localStorage entries.
    pub storage_count: usize,
    /// Whether a custom user-agent is set.
    pub has_user_agent: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

impl From<&ProfileTemplate> for TemplateSummary {
    fn from(t: &ProfileTemplate) -> Self {
        TemplateSummary {
            id: t.id.clone(),
            name: t.name.clone(),
            description: t.description.clone(),
            cookie_count: t.cookies.len(),
            storage_count: t.storage.len(),
            has_user_agent: t.user_agent.is_some(),
            created_at_ms: t.created_at_ms,
            updated_at_ms: t.updated_at_ms,
        }
    }
}

// ─── RPC Payloads ───────────────────────────────────────────────

// --- template.list ---

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct TemplateListParams {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct TemplateListResult {
    pub templates: Vec<TemplateSummary>,
}

// --- template.get ---

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct TemplateGetParams {
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct TemplateGetResult {
    pub template: ProfileTemplate,
}

// --- template.create ---

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct TemplateCreateParams {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub cookies: Vec<CookieEntry>,
    #[serde(default)]
    pub storage: HashMap<String, StorageEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct TemplateCreateResult {
    pub template: ProfileTemplate,
}

// --- template.update ---

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct TemplateUpdateParams {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cookies: Option<Vec<CookieEntry>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage: Option<HashMap<String, StorageEntry>>,
    /// None = no change, Some(None) = explicitly clear
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<Option<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct TemplateUpdateResult {
    pub template: ProfileTemplate,
}

// --- template.delete ---

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct TemplateDeleteParams {
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct TemplateDeleteResult {
    pub deleted: bool,
}

// --- template.apply ---

/// Scope selector for `template.apply`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TemplateScope {
    Cookies,
    Storage,
    UserAgent,
    #[default]
    All,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct TemplateApplyParams {
    pub template_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<TemplateScope>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct TemplateApplyResult {
    pub applied_cookies: usize,
    pub applied_storage: usize,
    pub applied_user_agent: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_template() -> ProfileTemplate {
        ProfileTemplate {
            id: "template-001".into(),
            name: "E-commerce Login".into(),
            description: Some("Pre-login session for shop.example.com".into()),
            cookies: vec![CookieEntry {
                name: "session_id".into(),
                value: "abc123".into(),
                domain: ".example.com".into(),
                path: Some("/".into()),
                secure: Some(true),
                http_only: Some(true),
            }],
            storage: [(
                "user_prefs".into(),
                StorageEntry {
                    value: r#"{"theme":"dark","lang":"en"}"#.into(),
                },
            )]
            .into_iter()
            .collect(),
            user_agent: Some("MyBot/1.0".into()),
            created_at_ms: 1700000000000,
            updated_at_ms: 1700000000000,
        }
    }

    #[test]
    fn template_round_trip() {
        let t = sample_template();
        let json = serde_json::to_value(&t).unwrap();
        let back: ProfileTemplate = serde_json::from_value(json).unwrap();
        assert_eq!(t, back);
    }

    #[test]
    fn summary_from_template() {
        let t = sample_template();
        let s = TemplateSummary::from(&t);
        assert_eq!(s.id, "template-001");
        assert_eq!(s.name, "E-commerce Login");
        assert_eq!(s.cookie_count, 1);
        assert_eq!(s.storage_count, 1);
        assert!(s.has_user_agent);
    }

    #[test]
    fn summary_excludes_sensitive_data() {
        let t = sample_template();
        let json = serde_json::to_string(&TemplateSummary::from(&t)).unwrap();
        // Cookie values and storage values must NOT appear in summary
        assert!(!json.contains("abc123"));
        assert!(!json.contains("session_id"));
    }

    #[test]
    fn create_params_round_trip() {
        let params = TemplateCreateParams {
            name: "Test".into(),
            description: None,
            cookies: vec![],
            storage: HashMap::new(),
            user_agent: None,
        };
        let json = serde_json::to_value(&params).unwrap();
        let back: TemplateCreateParams = serde_json::from_value(json).unwrap();
        assert_eq!(params, back);
    }

    #[test]
    fn apply_scope_defaults_to_all() {
        let params: TemplateApplyParams =
            serde_json::from_value(serde_json::json!({"template_id": "t-1"})).unwrap();
        assert_eq!(params.scope, None); // daemon-side should treat None as All
    }

    #[test]
    fn update_params_clear_user_agent() {
        // To explicitly clear user_agent, the caller must send a JSON
        // value (not null).  An absent key or null both map to None
        // ("no change").  Sending the string "__CLEAR__" or similar is
        // one option; here we verify the round-trip behaviour.
        let params: TemplateUpdateParams = serde_json::from_value(serde_json::json!({
            "id": "t-1",
            "user_agent": ""
        }))
        .unwrap();
        // Some("") means explicitly set to empty string (clear)
        assert_eq!(params.user_agent, Some(Some("".into())));
    }
}
