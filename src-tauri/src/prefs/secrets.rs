//! OS keychain access. The only place OAuth secrets are persisted.
//!
//! Nothing here ever writes to the `.footagedb` library or to `prefs.json`
//! (§20, §49). If the platform has no keychain, this module **refuses to
//! persist** rather than silently falling back to a file — a refresh token on
//! disk in plaintext is worse than having to reconnect next launch.

use crate::util::Secret;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

const SERVICE: &str = "app.stash.footage";

/// Every keychain read can raise an OS authorization dialog, and `google_status`
/// reads one on each call — so a user who opens Settings, or lets a status query
/// refetch, was asked for the login password again and again. Reads are memoised
/// for the life of the process instead: one prompt per secret per launch, and
/// none at all once the user picks "Always Allow".
fn memo() -> &'static Mutex<HashMap<String, Option<String>>> {
    static MEMO: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    MEMO.get_or_init(Default::default)
}

/// Poisoning only means some other thread panicked mid-update; the map itself is
/// still coherent, and refusing to serve a cached secret would bring the dialogs
/// straight back.
fn memoized(key: &str, load: impl FnOnce() -> Option<String>) -> Option<String> {
    let m = memo();
    if let Some(hit) = m.lock().unwrap_or_else(|e| e.into_inner()).get(key) {
        return hit.clone();
    }
    let value = load();
    m.lock().unwrap_or_else(|e| e.into_inner()).insert(key.to_string(), value.clone());
    value
}

fn remember(key: &str, value: Option<String>) {
    memo().lock().unwrap_or_else(|e| e.into_inner()).insert(key.to_string(), value);
}

pub const KEY_REFRESH_TOKEN: &str = "google-refresh-token";
pub const KEY_CLIENT_SECRET: &str = "google-client-secret";

fn entry(key: &str) -> Option<keyring::Entry> {
    match keyring::Entry::new(SERVICE, key) {
        Ok(e) => Some(e),
        Err(e) => {
            // Log the failure kind, never the key material.
            log::warn!("keychain unavailable: {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn a_secret_is_read_from_the_keychain_once_per_process() {
        let reads = AtomicUsize::new(0);
        let mut load = || {
            reads.fetch_add(1, Ordering::SeqCst);
            Some("token".to_string())
        };

        assert_eq!(memoized("test-key", &mut load).as_deref(), Some("token"));
        assert_eq!(memoized("test-key", &mut load).as_deref(), Some("token"));
        assert_eq!(reads.load(Ordering::SeqCst), 1, "second read hit the keychain again");

        // A miss is cached too: repeatedly asking for a secret that is not there
        // is exactly what the status query does.
        let misses = AtomicUsize::new(0);
        let mut absent = || {
            misses.fetch_add(1, Ordering::SeqCst);
            None
        };
        assert!(memoized("absent-key", &mut absent).is_none());
        assert!(memoized("absent-key", &mut absent).is_none());
        assert_eq!(misses.load(Ordering::SeqCst), 1);

        // Writing a new value must be visible without another keychain trip.
        remember("test-key", Some("rotated".into()));
        assert_eq!(memoized("test-key", &mut load).as_deref(), Some("rotated"));
        assert_eq!(reads.load(Ordering::SeqCst), 1);
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

/// Returns false when there is no keychain to write to, so callers can tell the
/// user that the connection will not survive a restart.
pub fn set(key: &str, value: &Secret) -> bool {
    match entry(key) {
        Some(e) => match e.set_password(value.expose()) {
            Ok(()) => {
                // What we just wrote is what a later read must see, prompt-free.
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
        // A missing entry is the desired end state, so a NoEntry error is fine.
        let _ = e.delete_credential();
    }
    remember(key, None);
}
