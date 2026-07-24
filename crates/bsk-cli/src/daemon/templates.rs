//! Profile template registry: CRUD + JSON persistence to `~/.bsk/templates/{uuid}.json`.

use std::collections::HashMap;
use std::sync::Mutex;

use anyhow::{Context, Result};
use bsk_protocol::template::{CookieEntry, ProfileTemplate, StorageEntry, TemplateSummary};
use uuid::Uuid;

/// In-memory + on-disk template store.
///
/// Each template is stored as a single JSON file named `{id}.json` under
/// `~/.bsk/templates/`.  The in-memory index (`HashMap<String,
/// ProfileTemplate>`) is rebuilt from disk at construction time so that
/// a daemon restart picks up previously created templates.
#[derive(Debug)]
pub struct TemplateRegistry {
    inner: Mutex<TemplateStore>,
    dir: std::path::PathBuf,
}

#[derive(Debug)]
struct TemplateStore {
    /// Keyed by template id (UUID string).
    templates: HashMap<String, ProfileTemplate>,
}

impl TemplateRegistry {
    /// Load all `.json` files from `dir` into memory.
    pub fn new(dir: std::path::PathBuf) -> Result<Self> {
        let store = Self::load_from_disk(&dir)?;
        Ok(Self {
            inner: Mutex::new(store),
            dir,
        })
    }

    fn load_from_disk(dir: &std::path::Path) -> Result<TemplateStore> {
        let mut templates = HashMap::new();
        if !dir.exists() {
            std::fs::create_dir_all(dir)
                .with_context(|| format!("create templates dir {}", dir.display()))?;
            return Ok(TemplateStore { templates });
        }
        for entry in std::fs::read_dir(dir)
            .with_context(|| format!("read templates dir {}", dir.display()))?
        {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let raw = std::fs::read_to_string(&path)
                .with_context(|| format!("read template file {}", path.display()))?;
            let t: ProfileTemplate = serde_json::from_str(&raw)
                .with_context(|| format!("parse template {}", path.display()))?;
            templates.insert(t.id.clone(), t);
        }
        Ok(TemplateStore { templates })
    }

    // ── CRUD ──────────────────────────────────────────────

    /// List all templates as lightweight summaries.
    pub fn list(&self) -> Vec<TemplateSummary> {
        let guard = self.inner.lock().expect("template registry poisoned");
        guard
            .templates
            .values()
            .map(TemplateSummary::from)
            .collect()
    }

    /// Get a single full template by id.  Returns `None` if not found.
    pub fn get(&self, id: &str) -> Option<ProfileTemplate> {
        let guard = self.inner.lock().expect("template registry poisoned");
        guard.templates.get(id).cloned()
    }

    /// Create a new template.  Generates a UUID v4 for the id and sets
    /// timestamps.
    pub fn create(
        &self,
        name: String,
        description: Option<String>,
        cookies: Vec<CookieEntry>,
        storage: HashMap<String, StorageEntry>,
        user_agent: Option<String>,
    ) -> Result<ProfileTemplate> {
        let id = Uuid::new_v4().to_string();
        let now_ms = timestamp_ms();
        let t = ProfileTemplate {
            id: id.clone(),
            name,
            description,
            cookies,
            storage,
            user_agent,
            created_at_ms: now_ms,
            updated_at_ms: now_ms,
        };
        self.persist(&t)?;
        let mut guard = self.inner.lock().expect("template registry poisoned");
        guard.templates.insert(id, t.clone());
        Ok(t)
    }

    /// Update an existing template.  Only non-`None` fields are applied.
    /// Returns `None` if the id does not exist.
    pub fn update(
        &self,
        id: &str,
        name: Option<String>,
        description: Option<String>,
        cookies: Option<Vec<CookieEntry>>,
        storage: Option<HashMap<String, StorageEntry>>,
        user_agent: Option<Option<String>>,
    ) -> Result<Option<ProfileTemplate>> {
        let mut guard = self.inner.lock().expect("template registry poisoned");
        let Some(t) = guard.templates.get_mut(id) else {
            return Ok(None);
        };
        if let Some(v) = name {
            t.name = v;
        }
        if let Some(v) = description {
            t.description = Some(v);
        }
        if let Some(v) = cookies {
            t.cookies = v;
        }
        if let Some(v) = storage {
            t.storage = v;
        }
        if let Some(v) = user_agent {
            t.user_agent = v;
        }
        t.updated_at_ms = timestamp_ms();
        let cloned = t.clone();
        drop(guard);
        self.persist(&cloned)?;
        // Re-acquire to confirm we're still the owner (no concurrent delete).
        let mut guard = self.inner.lock().expect("template registry poisoned");
        if let Some(entry) = guard.templates.get_mut(id) {
            *entry = cloned.clone();
        }
        Ok(Some(cloned))
    }

    /// Delete a template by id.  Returns `true` if it existed and was removed.
    pub fn delete(&self, id: &str) -> Result<bool> {
        let path = self.dir.join(format!("{id}.json"));
        let existed = if path.exists() {
            std::fs::remove_file(&path)
                .with_context(|| format!("delete template file {}", path.display()))?;
            true
        } else {
            false
        };
        let mut guard = self.inner.lock().expect("template registry poisoned");
        guard.templates.remove(id);
        Ok(existed)
    }

    // ── persistence helpers ───────────────────────────────

    fn persist(&self, t: &ProfileTemplate) -> Result<()> {
        let path = self.dir.join(format!("{}.json", t.id));
        let json = serde_json::to_string_pretty(t).context("serialize template")?;
        std::fs::write(&path, json)
            .with_context(|| format!("write template {}", path.display()))?;
        Ok(())
    }
}

fn timestamp_ms() -> i64 {
    use std::time::SystemTime;
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tempfile::TempDir;

    fn empty_registry() -> (TempDir, Arc<TemplateRegistry>) {
        let tmp = TempDir::new().unwrap();
        let reg = Arc::new(TemplateRegistry::new(tmp.path().to_path_buf()).unwrap());
        (tmp, reg)
    }

    #[test]
    fn list_empty() {
        let (_tmp, reg) = empty_registry();
        assert!(reg.list().is_empty());
    }

    #[test]
    fn get_missing() {
        let (_tmp, reg) = empty_registry();
        assert!(reg.get("nope").is_none());
    }

    #[test]
    fn create_and_get() {
        let (_tmp, reg) = empty_registry();
        let t = reg
            .create("Test Template".into(), None, vec![], HashMap::new(), None)
            .unwrap();
        assert_eq!(t.name, "Test Template");
        assert!(!t.id.is_empty());
        assert_ne!(t.created_at_ms, 0);
        let back = reg.get(&t.id).unwrap();
        assert_eq!(back.id, t.id);
        assert_eq!(back.name, t.name);
    }

    #[test]
    fn create_persists_to_disk() {
        let (tmp, reg) = empty_registry();
        let t = reg
            .create("Persisted".into(), None, vec![], HashMap::new(), None)
            .unwrap();
        let path = tmp.path().join(format!("{}.json", t.id));
        assert!(path.exists());
        let raw = std::fs::read_to_string(path).unwrap();
        let loaded: ProfileTemplate = serde_json::from_str(&raw).unwrap();
        assert_eq!(loaded.name, "Persisted");
    }

    #[test]
    fn update_name() {
        let (_tmp, reg) = empty_registry();
        let t = reg
            .create("Old".into(), None, vec![], HashMap::new(), None)
            .unwrap();
        let updated = reg
            .update(&t.id, Some("New".into()), None, None, None, None)
            .unwrap();
        let u = updated.unwrap();
        assert_eq!(u.name, "New");
        assert!(u.updated_at_ms >= u.created_at_ms);
    }

    #[test]
    fn update_clear_user_agent() {
        let (_tmp, reg) = empty_registry();
        let t = reg
            .create(
                "UA".into(),
                None,
                vec![],
                HashMap::new(),
                Some("Bot/1.0".into()),
            )
            .unwrap();
        assert!(reg.get(&t.id).unwrap().user_agent.is_some());
        let _updated = reg
            .update(&t.id, None, None, None, None, Some(Some(String::new())))
            .unwrap();
        assert!(
            reg.get(&t.id)
                .unwrap()
                .user_agent
                .as_deref()
                .unwrap_or("")
                .is_empty()
        );
    }

    #[test]
    fn delete_removes_file_and_memory() {
        let (tmp, reg) = empty_registry();
        let t = reg
            .create("Del".into(), None, vec![], HashMap::new(), None)
            .unwrap();
        assert!(reg.delete(&t.id).unwrap());
        assert!(reg.get(&t.id).is_none());
        assert!(!tmp.path().join(format!("{}.json", t.id)).exists());
        // Double-delete returns false
        assert!(!reg.delete(&t.id).unwrap());
    }

    #[test]
    fn reloads_from_disk_on_restart() {
        let (tmp, _reg) = empty_registry();
        let t1 = _reg
            .create(
                "Survive".into(),
                Some("desc".into()),
                vec![],
                HashMap::new(),
                None,
            )
            .unwrap();
        // Simulate daemon restart: new registry loads from same dir.
        let reg2 = TemplateRegistry::new(tmp.path().to_path_buf()).unwrap();
        let list = reg2.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Survive");
        assert_eq!(list[0].description.as_deref(), Some("desc"));
        let got = reg2.get(&t1.id).unwrap();
        assert_eq!(got.name, "Survive");
    }

    #[test]
    fn list_returns_summaries_not_full_templates() {
        let (_tmp, reg) = empty_registry();
        reg.create(
            "Secret".into(),
            None,
            vec![CookieEntry {
                name: "sess".into(),
                value: "abc123".into(),
                domain: ".x.com".into(),
                path: None,
                secure: None,
                http_only: None,
            }],
            [(
                "key".into(),
                StorageEntry {
                    value: "val".into(),
                },
            )]
            .into(),
            Some("Bot/1.0".into()),
        )
        .unwrap();
        let summaries = reg.list();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].cookie_count, 1);
        assert_eq!(summaries[0].storage_count, 1);
        assert!(summaries[0].has_user_agent);
        // Verify no sensitive data leaks in summary serialization
        let json = serde_json::to_string(&summaries[0]).unwrap();
        assert!(!json.contains("abc123"));
        assert!(!json.contains("val"));
    }
}
