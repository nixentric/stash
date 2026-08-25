use crate::db::models::Accessibility;
use crate::db::repo::footage as footage_repo;
use crate::error::{AppError, Result};
use crate::gdrive::{client::DriveAccount, oauth};
use crate::jobs::JobProgress;
use crate::prefs::{resolve_google_client, secrets};
use crate::state::AppState;
use crate::util::Secret;
use serde::Serialize;
use tauri::{Emitter, State};
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GoogleStatus {
    /// An OAuth client is available (env var or user-supplied). When false the
    /// advanced integration is simply not offered — and nothing else changes.
    pub configured: bool,
    pub connected: bool,
    pub account: Option<DriveAccount>,
    /// False on systems with no usable keychain: the session will work but will
    /// not survive a restart, and the UI says so rather than pretending.
    pub keychain_available: bool,
    pub client_id_source: &'static str,
    /// Whether the client secret is actually stored. Separate from `configured`
    /// because "an id with no secret" is the state that silently fails to
    /// connect, and the pane has to be able to name it.
    pub client_secret_saved: bool,
    /// True in development builds, where secrets live in a temp file rather
    /// than the keychain — so they disappear whenever the system clears it.
    pub secrets_temporary: bool,
}

#[tauri::command]
pub async fn google_status(state: State<'_, AppState>) -> Result<GoogleStatus> {
    // Google may issue a client secret even for a Desktop app. A client ID on
    // its own is not enough for the token exchange, so don't advertise the
    // integration as ready until the secret is available as well.
    let configured =
        resolve_google_client(&state.prefs).is_some_and(|config| config.client_secret.is_some());
    let connected = state.drive.appears_connected(&state.prefs).await;
    let prefs = state.prefs.get();

    Ok(GoogleStatus {
        configured,
        connected,
        account: connected.then(|| DriveAccount {
            email: prefs.google_account_email.clone(),
            display_name: None,
        }),
        keychain_available: secrets::available(),
        client_secret_saved: std::env::var("STASH_GOOGLE_CLIENT_SECRET")
            .is_ok_and(|s| !s.trim().is_empty())
            || secrets::get(secrets::KEY_CLIENT_SECRET).is_some(),
        secrets_temporary: secrets::temporary(),
        client_id_source: if std::env::var("STASH_GOOGLE_CLIENT_ID").is_ok() {
            "environment"
        } else if prefs.google_client_id.is_some() {
            "settings"
        } else {
            "none"
        },
    })
}

/// Stores the user's own OAuth client. The id is not secret; the secret is.
#[tauri::command]
pub fn google_set_client(
    state: State<'_, AppState>,
    client_id: String,
    client_secret: Option<String>,
) -> Result<()> {
    let id = client_id.trim().to_string();
    if id.is_empty() {
        return Err(AppError::Invalid("Client ID cannot be empty".into()));
    }
    if !id.ends_with(".apps.googleusercontent.com") {
        return Err(AppError::Invalid(
            "That doesn't look like a Google OAuth client ID".into(),
        ));
    }

    match client_secret
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        Some(s) => {
            if !secrets::set(secrets::KEY_CLIENT_SECRET, &Secret::new(s)) {
                return Err(AppError::Other(
                    "Could not store the client secret in the system keychain".into(),
                ));
            }
        }
        // Saving an unchanged form must never silently delete an existing
        // keychain secret. For a new client, make the missing value actionable
        // here instead of letting Google's token endpoint reject it later.
        None if secrets::get(secrets::KEY_CLIENT_SECRET).is_none() => {
            return Err(AppError::Invalid(
                "Client secret cannot be empty. Paste the secret from your Google OAuth Desktop client."
                    .into(),
            ));
        }
        None => {}
    }
    state.prefs.update(|p| p.google_client_id = Some(id))?;
    Ok(())
}

#[tauri::command]
pub async fn google_clear_client(state: State<'_, AppState>) -> Result<()> {
    state.drive.disconnect().await;
    secrets::delete(secrets::KEY_CLIENT_SECRET);
    state.prefs.update(|p| {
        p.google_client_id = None;
        p.google_account_email = None;
    })?;
    Ok(())
}

#[tauri::command]
pub async fn google_connect(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<DriveAccount> {
    let cfg = resolve_google_client(&state.prefs).ok_or_else(|| {
        AppError::Invalid("Add a Google OAuth client ID in Settings before connecting".into())
    })?;
    if cfg.client_secret.is_none() {
        return Err(AppError::Invalid(
            "Add the OAuth client secret in Settings → Integrations → OAuth client before connecting"
                .into(),
        ));
    }

    let opener = app.clone();
    let tokens = oauth::authorize(&cfg, move |url| {
        opener
            .opener()
            .open_url(url, None::<&str>)
            .map_err(|e| AppError::Other(format!("Could not open the browser: {e}")))
    })
    .await?;

    // Persist the refresh token, and only the refresh token. If there is no
    // keychain we keep the session in memory and say so, rather than writing a
    // credential to disk (§4, §49).
    let persisted = match &tokens.refresh_token {
        Some(rt) => secrets::set(secrets::KEY_REFRESH_TOKEN, rt),
        None => secrets::get(secrets::KEY_REFRESH_TOKEN).is_some(),
    };
    if !persisted {
        log::warn!("connected without persisting a refresh token (no keychain backend)");
    }

    state.drive.set_tokens(cfg, tokens).await;
    // Previews that failed anonymously may well succeed now, so let them retry.
    state.reset_preview_failures();

    let account = state.drive.about().await?;
    state
        .prefs
        .update(|p| p.google_account_email = account.email.clone())?;

    Ok(account)
}

#[tauri::command]
pub async fn google_disconnect(state: State<'_, AppState>) -> Result<()> {
    // Nothing in the library is deleted: cached metadata, portable thumbnails,
    // tags, notes and usage all remain. The library degrades to link mode, which
    // is the mode it was designed to run in (§27).
    state.drive.disconnect().await;
    state.reset_preview_failures();
    state.prefs.update(|p| p.google_account_email = None)?;
    Ok(())
}

// ── metadata sync ───────────────────────────────────────────────────────────

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub checked: u64,
    pub updated: u64,
    pub renamed: u64,
    pub moved: u64,
    /// The ones an authenticated lookup says are gone — ids, not a count, so
    /// the caller can offer to remove exactly those (§23).
    pub missing_ids: Vec<i64>,
    pub failed: u64,
    pub cancelled: bool,
}

/// What a catalogued path on this computer says about itself.
///
/// A deleted file leaves its folder behind. A whole tree that vanished at once
/// is a volume that is not mounted, and calling those files deleted would flag
/// a healthy archive on the strength of an unplugged cable — the local half of
/// the rule that only real evidence produces `SourceMissing` (§23).
fn local_state(path: &str) -> Accessibility {
    let p = std::path::Path::new(path);
    if p.exists() {
        Accessibility::Available
    } else if p.parent().is_some_and(|d| d.as_os_str().is_empty() || d.exists()) {
        Accessibility::SourceMissing
    } else {
        Accessibility::Offline
    }
}

/// Metadata-only synchronization (§31, §8).
///
/// Never transfers file content. Never touches user metadata — a file renamed in
/// Drive updates `original_filename` and leaves the user's display name, tags,
/// notes and usage history exactly as they were.
///
/// Both kinds of source in one pass: Drive answers over the network, a
/// catalogued local file answers from the filesystem, and "is my footage still
/// there" is one question to the person asking it.
#[tauri::command]
pub async fn sync_library(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    ids: Option<Vec<i64>>,
) -> Result<SyncReport> {
    let targets: Vec<(i64, String, Option<String>, Option<String>)> = state.with_library(|lib| {
        let sql = "SELECT footage_id, provider, external_id, local_path FROM sources
                   WHERE (provider = 'google_drive' AND external_id IS NOT NULL)
                      OR (provider = 'local' AND local_path IS NOT NULL)";
        let mut stmt = lib.conn.prepare(sql)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })?;

    let targets: Vec<_> = match &ids {
        Some(filter) => targets
            .into_iter()
            .filter(|(id, ..)| filter.contains(id))
            .collect(),
        None => targets,
    };

    // Only the Drive half needs an account. A library of local files answers
    // with the network unplugged, and refusing to check it would be an odd kind
    // of principle.
    state.drive.ensure_restored(&state.prefs).await;
    if targets.iter().any(|(_, p, ..)| p == "google_drive") && !state.drive.is_connected().await {
        return Err(AppError::NotConnected);
    }

    let (job_id, token) = state.jobs.start("sync");
    let total = targets.len() as u64;
    let mut report = SyncReport::default();

    let progress = |done: u64| {
        let _ = app.emit(
            "job:progress",
            JobProgress {
                job_id: job_id.clone(),
                phase: "syncing".into(),
                done,
                total: Some(total),
                message: None,
            },
        );
    };

    for (footage_id, provider, external_id, local_path) in targets {
        if token.is_cancelled() {
            report.cancelled = true;
            break;
        }
        report.checked += 1;

        if provider == "local" {
            let state_now = local_state(local_path.as_deref().unwrap_or_default());
            state.with_library(|lib| {
                footage_repo::set_accessibility(&lib.conn, footage_id, state_now)
            })?;
            match state_now {
                Accessibility::SourceMissing => report.missing_ids.push(footage_id),
                Accessibility::Available => report.updated += 1,
                // The volume is not there to ask. Not gone, not fine.
                _ => report.failed += 1,
            }
            progress(report.checked);
            continue;
        }

        let external_id = external_id.unwrap_or_default();
        match state.drive.get_file(&external_id).await {
            Ok(file) if file.trashed => {
                state.with_library(|lib| {
                    footage_repo::set_accessibility(
                        &lib.conn,
                        footage_id,
                        Accessibility::SourceMissing,
                    )
                })?;
                report.missing_ids.push(footage_id);
            }
            Ok(file) => {
                let (width, height) = file.dimensions();
                let new_parent = file.parents.first().cloned();

                let changed = state.with_library(|lib| {
                    let before: (Option<String>, Option<String>) = lib.conn.query_row(
                        "SELECT original_filename, container_id FROM sources WHERE footage_id = ?1",
                        [footage_id],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )?;

                    lib.conn.execute(
                        "UPDATE sources SET
                           original_filename = ?2, mime_type = ?3, file_size = ?4,
                           width = ?5, height = ?6, duration_ms = ?7,
                           source_created_at = ?8, source_modified_at = ?9,
                           container_id = ?10, accessibility = 'available',
                           last_synced_at = ?11
                         WHERE footage_id = ?1",
                        rusqlite::params![
                            footage_id,
                            file.name,
                            file.mime_type,
                            file.size,
                            width,
                            height,
                            file.duration_ms(),
                            file.created_time,
                            file.modified_time,
                            new_parent,
                            crate::util::now_iso(),
                        ],
                    )?;
                    Ok(before)
                })?;

                if changed.0.as_deref() != Some(file.name.as_str()) {
                    report.renamed += 1;
                }
                if changed.1 != new_parent {
                    report.moved += 1;
                }
                report.updated += 1;
            }
            Err(AppError::NotFound(_)) => {
                // Authenticated 404 is the only evidence that permits this
                // conclusion. The record and all its user metadata are kept (§32).
                state.with_library(|lib| {
                    footage_repo::set_accessibility(
                        &lib.conn,
                        footage_id,
                        Accessibility::SourceMissing,
                    )
                })?;
                report.missing_ids.push(footage_id);
            }
            Err(AppError::PermissionRequired) => {
                state.with_library(|lib| {
                    footage_repo::set_accessibility(
                        &lib.conn,
                        footage_id,
                        Accessibility::PermissionRequired,
                    )
                })?;
                report.failed += 1;
            }
            Err(e) => {
                log::warn!("sync failed for footage {footage_id}: {e}");
                report.failed += 1;
            }
        }

        progress(report.checked);
    }

    state.jobs.finish(&job_id);
    let _ = app.emit(
        "job:progress",
        JobProgress {
            job_id,
            phase: if report.cancelled { "cancelled" } else { "done" }.into(),
            done: report.checked,
            total: Some(total),
            message: None,
        },
    );

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_deleted_file_is_gone_but_an_unmounted_volume_is_only_unreachable() {
        let dir = std::env::temp_dir().join(format!("stash-local-{}", rand::random::<u64>()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("clip.mov");
        std::fs::write(&file, b"x").unwrap();
        let path = file.to_str().unwrap();

        assert_eq!(local_state(path), Accessibility::Available);

        std::fs::remove_file(&file).unwrap();
        // The folder it lived in is still there, so the file itself went.
        assert_eq!(local_state(path), Accessibility::SourceMissing);

        // A whole tree that is not there is a volume nobody plugged in — saying
        // "deleted" would condemn a healthy archive.
        assert_eq!(
            local_state("/Volumes/Archive 2024/shoot/clip.mov"),
            Accessibility::Offline
        );

        std::fs::remove_dir_all(&dir).ok();
    }
}
