//! OS keychain access. The only place OAuth secrets are persisted.
//!
//! Nothing here ever writes to the `.footagedb` library or to `prefs.json`
//! (§20, §49). If the platform has no keychain, this module **refuses to
//! persist** rather than silently falling back to a file — a refresh token on
//! disk in plaintext is worse than having to reconnect next launch.

use crate::util::Secret;
use std::collections::HashMap;
#[cfg(not(debug_assertions))]
use std::sync::{Mutex, OnceLock};

#[cfg(not(debug_assertions))]
const SERVICE: &str = "app.stash.footage";

/// Every keychain read can raise an OS authorization dialog, and `google_status`
/// reads one on each call — so a user who opens Settings, or lets a status query
/// refetch, was asked for the login password again and again. Reads are memoised
/// for the life of the process instead: one prompt per secret per launch, and
/// none at all once the user picks "Always Allow".

pub const KEY_REFRESH_TOKEN: &str = "google-refresh-token";
pub const KEY_CLIENT_SECRET: &str = "google-client-secret";

#[cfg(debug_assertions)]
mod dev_store {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn path() -> PathBuf {
        std::env::temp_dir().join("stash-dev-secrets.json")
    }

    fn load_map() -> HashMap<String, String> {
        fs::read_to_string(path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn available() -> bool { true }

    pub fn get(key: &str) -> Option<Secret> {
        load_map().get(key).map(|s| Secret::new(s.clone()))
    }

    pub fn set(key: &str, value: &Secret) -> bool {
        let mut map = load_map();
        map.insert(key.to_string(), value.expose().to_string());
        if let Ok(json) = serde_json::to_string(&map) {
            fs::write(path(), json).is_ok()
        } else {
            false
        }
    }

    pub fn delete(key: &str) {
        let mut map = load_map();
        map.remove(key);
        if let Ok(json) = serde_json::to_string(&map) {
            let _ = fs::write(path(), json);
        }
    }
}

#[cfg(debug_assertions)]
pub use dev_store::*;

#[cfg(not(debug_assertions))]
mod prod_store {
    use super::*;

    fn memo() -> &'static Mutex<HashMap<String, Option<String>>> {
        static MEMO: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
        MEMO.get_or_init(Default::default)
    }

    fn memoized(key: &str, load: impl FnOnce() -> Option<String>) -> Option<String> {
        let m = memo();
        let mut map = m.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(hit) = map.get(key) {
            return hit.clone();
        }
        let value = load();
        map.insert(key.to_string(), value.clone());
        value
    }

    fn remember(key: &str, value: Option<String>) {
        memo().lock().unwrap_or_else(|e| e.into_inner()).insert(key.to_string(), value);
    }

    fn entry(key: &str) -> Option<keyring::Entry> {
        match keyring::Entry::new(SERVICE, key) {
            Ok(e) => Some(e),
            Err(e) => {
                log::warn!("keychain unavailable: {e}");
                None
            }
        }
    }

    pub fn available() -> bool {
        entry(KEY_REFRESH_TOKEN).is_some()
    }

    pub fn get(key: &str) -> Option<Secret> {
        memoized(key, || {
            let e = entry(key)?;
            match e.get_password() {
                Ok(v) if !v.is_empty() => Some(v),
                _ => None,
            }
        })
        .map(Secret::new)
    }

    pub fn set(key: &str, value: &Secret) -> bool {
        match entry(key) {
            Some(e) => match e.set_password(value.expose()) {
                Ok(()) => {
                    remember(key, Some(value.expose().to_string()));
                    true
                }
                Err(err) => {
                    log::warn!("could not store {key} in the keychain: {err}");
                    false
                }
            },
            None => false,
        }
    }

    pub fn delete(key: &str) {
        if let Some(e) = entry(key) {
            let _ = e.delete_credential();
        }
        remember(key, None);
    }
}

#[cfg(not(debug_assertions))]
pub use prod_store::*;
