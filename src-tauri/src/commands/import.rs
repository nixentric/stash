use crate::db::models::*;
use crate::db::repo::footage as footage_repo;
use crate::error::{AppError, Result};
use crate::gdrive::client::{DriveFile, FOLDER_MIME, SHORTCUT_MIME};
use crate::jobs::JobProgress;
use crate::source::{self, bulk, ParsedSource};
use crate::state::AppState;
use serde::Serialize;
use tauri::{Emitter, State};

const MAX_INPUT_CHARS: usize = 4 * 1024 * 1024;
const MAX_SCAN_DEPTH: usize = 24;

// ── parsing (no network, works with no account) ─────────────────────────────

#[tauri::command]
pub fn parse_source_input(text: String) -> Option<ParsedSource> {
    if text.len() > 8192 {
        return None;
    }
    source::parse_input(&text)
}

#[tauri::command]
pub fn parse_bulk_input(text: String) -> bulk::BulkParseResult {
    let clipped = if text.len() > MAX_INPUT_CHARS {
        &text[..MAX_INPUT_CHARS]
    } else {
        &text
    };
    bulk::parse(clipped)
}

// ── import ──────────────────────────────────────────────────────────────────

/// Inserts footage, skipping anything already catalogued.
///
/// Identity is `(provider, external_id)` — never the filename — so re-importing
/// a folder after files were renamed in Drive adds nothing and loses nothing
/// (§30). The whole batch is one transaction, which is what keeps a 1,000-file
/// import from paying 1,000 fsyncs.
#[tauri::command]
pub fn import_footage(state: State<'_, AppState>, items: Vec<NewFootage>) -> Result<ImportOutcome> {
    let mut outcome = ImportOutcome {
        imported: Vec::new(),
        duplicates: Vec::new(),
        failed: Vec::new(),
    };

    state.with_library_mut(|lib| {
        let tx = lib.conn.transaction()?;
        for item in &items {
            let label = item
                .original_url
                .clone()
                .or_else(|| item.local_path.clone())
                .unwrap_or_else(|| item.display_name.clone());

            match footage_repo::find_by_identity(
                &tx,
                &item.provider,
                item.external_id.as_deref(),
                item.local_path.as_deref(),
            ) {
                Ok(Some(existing)) => {
                    let name: String = tx
                        .query_row(
                            "SELECT display_name FROM footages WHERE id = ?1",
                            [existing],
                            |r| r.get(0),
                        )
                        .unwrap_or_default();
                    outcome.duplicates.push(DuplicateHit {
                        footage_id: existing,
                        display_name: name,
                        external_id: item.external_id.clone(),
                        input: label,
                    });
                }
                Ok(None) => match footage_repo::insert(&tx, item) {
                    Ok(id) => outcome.imported.push(id),
                    Err(e) => outcome.failed.push(FailedEntry {
                        input: label,
                        reason: e.to_string(),
                    }),
                },
                Err(e) => outcome.failed.push(FailedEntry {
                    input: label,
                    reason: e.to_string(),
                }),
            }
        }
        tx.commit()?;
        Ok(())
    })?;

    Ok(outcome)
}

// ── Drive folder scanning (connected mode only) ─────────────────────────────

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScannedItem {
    pub external_id: String,
    pub name: String,
    pub mime_type: Option<String>,
    pub media_type: MediaType,
    pub is_folder: bool,
    pub file_size: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub created_time: Option<String>,
    pub modified_time: Option<String>,
    pub container_id: Option<String>,
    /// Original Drive hierarchy, preserved on import (§6).
    pub container_path: String,
    pub web_view_link: Option<String>,
    pub already_in_library: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub job_id: String,
    pub root_name: String,
    pub items: Vec<ScannedItem>,
    pub folders_scanned: u64,
    pub cancelled: bool,
}

fn to_scanned(f: &DriveFile, container_path: &str, parent: Option<&str>) -> ScannedItem {
    let (width, height) = f.dimensions();
    ScannedItem {
        media_type: MediaType::from_mime_or_name(f.mime_type.as_deref(), &f.name),
        external_id: f.id.clone(),
        name: f.name.clone(),
        mime_type: f.mime_type.clone(),
        is_folder: f.is_folder(),
        file_size: f.size,
        width,
        height,
        duration_ms: f.duration_ms(),
        created_time: f.created_time.clone(),
        modified_time: f.modified_time.clone(),
        container_id: parent.map(str::to_string),
        container_path: container_path.to_string(),
        web_view_link: f.web_view_link.clone(),
        already_in_library: false,
    }
}

/// Breadth-first, depth-capped folder walk.
///
/// Explicitly a queue rather than recursion: Drive shortcuts can form cycles,
/// and a naive recursive walk would spin forever on one.
#[tauri::command]
pub async fn scan_drive_folder(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    folder_id: String,
    recursive: bool,
) -> Result<ScanResult> {
    state.drive.ensure_restored(&state.prefs).await;
    if !state.drive.is_connected().await {
        return Err(AppError::NotConnected);
    }

    let (job_id, token) = state.jobs.start("scan");
    let emit = |phase: &str, done: u64, message: Option<String>| {
        let _ = app.emit(
            "job:progress",
            JobProgress {
                job_id: job_id.clone(),
                phase: phase.to_string(),
                done,
                total: None,
                message,
            },
        );
    };

    let root = state.drive.get_file(&folder_id).await?;
    let root_name = if root.name.is_empty() {
        "Drive folder".to_string()
    } else {
        root.name.clone()
    };

    let mut items: Vec<ScannedItem> = Vec::new();
    let mut queue: Vec<(String, String, usize)> = vec![(folder_id.clone(), root_name.clone(), 0)];
    let mut visited: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut folders_scanned = 0u64;
    let mut cancelled = false;

    while let Some((id, path, depth)) = queue.pop() {
        if token.is_cancelled() {
            cancelled = true;
            break;
        }
        if !visited.insert(id.clone()) {
            continue; // shortcut cycle
        }
        folders_scanned += 1;
        emit("scanning", items.len() as u64, Some(path.clone()));

        let is_cancelled = || token.is_cancelled();
        let children = match state
            .drive
            .list_children(&id, &is_cancelled)
            .await
        {
            Ok(c) => c,
            Err(AppError::Cancelled) => {
                cancelled = true;
                break;
            }
            Err(e) => {
                state.jobs.finish(&job_id);
                return Err(e);
            }
        };

        for f in &children {
            if f.mime_type.as_deref() == Some(SHORTCUT_MIME) {
                // Not followed: resolving shortcuts would need another request
                // per item and can point outside the folder the user chose.
                continue;
            }
            if f.mime_type.as_deref() == Some(FOLDER_MIME) {
                if recursive && depth + 1 < MAX_SCAN_DEPTH {
                    queue.push((f.id.clone(), format!("{path}/{}", f.name), depth + 1));
                }
                continue;
            }
            items.push(to_scanned(f, &path, Some(&id)));
        }

        emit("scanning", items.len() as u64, Some(path));
    }

    // Mark what is already catalogued so the picker can pre-dim it (§30).
    if state.is_open() {
        let _ = state.with_library(|lib| {
            for item in items.iter_mut() {
                item.already_in_library = footage_repo::find_by_identity(
                    &lib.conn,
                    "google_drive",
                    Some(&item.external_id),
                    None,
                )?
                .is_some();
            }
            Ok(())
        });
    }

    state.jobs.finish(&job_id);
    emit(
        if cancelled { "cancelled" } else { "done" },
        items.len() as u64,
        None,
    );

    Ok(ScanResult {
        job_id,
        root_name,
        items,
        folders_scanned,
        cancelled,
    })
}

/// Lists one level of Drive for the folder browser (§37).
#[tauri::command]
pub async fn browse_drive(
    state: State<'_, AppState>,
    folder_id: Option<String>,
) -> Result<Vec<ScannedItem>> {
    state.drive.ensure_restored(&state.prefs).await;
    if !state.drive.is_connected().await {
        return Err(AppError::NotConnected);
    }
    let id = folder_id.unwrap_or_else(|| "root".to_string());
    let never = || false;
    let children = state.drive.list_children(&id, &never).await?;
    Ok(children
        .iter()
        .filter(|f| f.mime_type.as_deref() != Some(SHORTCUT_MIME))
        .map(|f| to_scanned(f, "", Some(&id)))
        .collect())
}

/// Fetches previews for a set of footage in the background.
///
/// Used after an import and by "Refresh missing thumbnails" when a library
/// arrives on a new machine with an empty cache (§9).
#[tauri::command]
pub async fn fetch_thumbnails(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    ids: Vec<i64>,
    force: bool,
) -> Result<u64> {
    let (job_id, token) = state.jobs.start("thumbnails");
    let total = ids.len() as u64;
    let mut done = 0u64;
    let mut succeeded = 0u64;

    for id in ids {
        if token.is_cancelled() {
            break;
        }
        match crate::preview::refresh(&state, id, force).await {
            Ok(true) => succeeded += 1,
            Ok(false) => {}
            // Silently dropping this left the badge stuck with no way to find out why.
            Err(e) => log::warn!("thumbnail refresh failed for footage {id}: {e}"),
        }
        done += 1;
        let _ = app.emit(
            "job:progress",
            JobProgress {
                job_id: job_id.clone(),
                phase: "thumbnails".into(),
                done,
                total: Some(total),
                message: None,
            },
        );
    }

    state.jobs.finish(&job_id);
    let _ = app.emit(
        "job:progress",
        JobProgress {
            job_id: job_id.clone(),
            phase: if token.is_cancelled() { "cancelled" } else { "done" }.into(),
            done,
            total: Some(total),
            message: None,
        },
    );
    Ok(succeeded)
}

#[tauri::command]
pub fn cancel_job(state: State<'_, AppState>, job_id: String) -> bool {
    state.jobs.cancel(&job_id)
}
