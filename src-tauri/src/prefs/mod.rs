//! Application preferences — everything that is *not* library data.
//!
//! Deliberately separate from `.footagedb`: theme, window size and recent-file
//! lists belong to this machine, not to a library that gets emailed to a
//! colleague (§2 of the original brief).

pub mod secrets;

use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const MAX_RECENT: usize = 12;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RecentLibrary {
    pub path: String,
    pub name: String,
    pub opened_at: String,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
    #[default]
    System,
}

/// Longest edge of the thumbnails stored inside the library file. Larger means
/// a better-looking portable library and a bigger file; see ARCHITECTURE.md §5.2.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum PortableThumbnailSize {
    None,
    Small,
    #[default]
    Standard,
}

impl PortableThumbnailSize {
    pub fn max_edge(self) -> Option<u32> {
        match self {
            PortableThumbnailSize::None => None,
            PortableThumbnailSize::Small => Some(320),
            PortableThumbnailSize::Standard => Some(480),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    pub theme: Theme,
    pub recent: Vec<RecentLibrary>,
    pub last_library: Option<String>,
    pub portable_thumbnail_size: PortableThumbnailSize,
    /// Not a secret: an OAuth client id is public by design. The matching client
    /// secret lives in the keychain.
    pub google_client_id: Option<String>,
    pub google_account_email: Option<String>,
    pub window_width: Option<f64>,
    pub window_height: Option<f64>,
    pub sidebar_width: Option<f64>,
    pub inspector_width: Option<f64>,
    pub inspector_visible: Option<bool>,
    pub grid_size: Option<f64>,
    pub view_mode: Option<String>,
}

pub struct PrefsStore {
    path: PathBuf,
    inner: Mutex<Prefs>,
}

impl PrefsStore {
    pub fn load(dir: &Path) -> Self {
        let path = dir.join("prefs.json");
        let inner = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<Prefs>(&s).ok())
            .unwrap_or_default();
        PrefsStore {
            path,
            inner: Mutex::new(inner),
        }
    }

    pub fn get(&self) -> Prefs {
        self.inner.lock().unwrap().clone()
    }

    pub fn update(&self, f: impl FnOnce(&mut Prefs)) -> Result<Prefs> {
        let snapshot = {
            let mut guard = self.inner.lock().unwrap();
            f(&mut guard);
            guard.clone()
        };
        self.persist(&snapshot)?;
        Ok(snapshot)
    }

    fn persist(&self, p: &Prefs) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // Write-then-rename: a crash mid-write must not leave preferences
        // truncated, because that would silently reset the recent-files list.
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(p).unwrap_or_default())?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    pub fn push_recent(&self, path: &Path) -> Result<()> {
        let entry = RecentLibrary {
            path: path.to_string_lossy().to_string(),
            name: path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Library".into()),
            opened_at: crate::util::now_iso(),
        };
        self.update(|p| {
            p.recent.retain(|r| r.path != entry.path);
            p.recent.insert(0, entry.clone());
            p.recent.truncate(MAX_RECENT);
            p.last_library = Some(entry.path.clone());
        })?;
        Ok(())
    }

    pub fn forget_recent(&self, path: &str) -> Result<()> {
        self.update(|p| p.recent.retain(|r| r.path != path))?;
        Ok(())
    }
}

/// OAuth client configuration, resolved at runtime.
///
/// Never compiled in. Absence is a normal state that disables *only* the
/// advanced integration pane — the rest of the app does not consult this (§19).
pub struct GoogleClientConfig {
    pub client_id: String,
    pub client_secret: Option<crate::util::Secret>,
}

pub fn resolve_google_client(prefs: &PrefsStore) -> Option<GoogleClientConfig> {
    let p = prefs.get();
    let client_id = std::env::var("STASH_GOOGLE_CLIENT_ID")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| p.google_client_id.clone())
        .filter(|s| !s.trim().is_empty())?;

    let client_secret = std::env::var("STASH_GOOGLE_CLIENT_SECRET")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(crate::util::Secret::new)
        .or_else(|| secrets::get(secrets::KEY_CLIENT_SECRET));

    Some(GoogleClientConfig {
        client_id: client_id.trim().to_string(),
        client_secret,
    })
}
