//! OS keychain access. The only place OAuth secrets are persisted.
//!
//! Nothing here ever writes to the `.footagedb` library or to `prefs.json`
//! (§20, §49). If the platform has no keychain, this module **refuses to
//! persist** rather than silently falling back to a file — a refresh token on
//! disk in plaintext is worse than having to reconnect next launch.

use crate::util::Secret;

const SERVICE: &str = "app.stash.footage";

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

pub fn available() -> bool {
    entry(KEY_REFRESH_TOKEN).is_some()
}

pub fn get(key: &str) -> Option<Secret> {
    let e = entry(key)?;
    match e.get_password() {
        Ok(v) if !v.is_empty() => Some(Secret::new(v)),
        _ => None,
    }
}

/// Returns false when there is no keychain to write to, so callers can tell the
/// user that the connection will not survive a restart.
pub fn set(key: &str, value: &Secret) -> bool {
    match entry(key) {
        Some(e) => match e.set_password(value.expose()) {
            Ok(()) => true,
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
}
