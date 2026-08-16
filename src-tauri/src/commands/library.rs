use crate::db::connection::{self, LibraryInfo};
use crate::db::models::LibraryStats;
use crate::db::repo::footage as footage_repo;
use crate::error::{AppError, Result};
use crate::prefs::RecentLibrary;
use crate::state::AppState;
use std::path::{Path, PathBuf};
use tauri::State;

/// Library paths arrive from the native file dialog, but a command is a trust
/// boundary regardless of who is expected to call it (§49).
fn validated_path(raw: &str) -> Result<PathBuf> {
    let p = Path::new(raw);
    if raw.trim().is_empty() {
        return Err(AppError::Invalid("No file was chosen".into()));
    }
    if !p.is_absolute() {
        return Err(AppError::Invalid("Library paths must be absolute".into()));
    }
    if raw.contains('\0') {
        return Err(AppError::Invalid("Invalid path".into()));
    }
    Ok(p.to_path_buf())
}

#[tauri::command]
pub fn create_library(state: State<'_, AppState>, path: String) -> Result<LibraryInfo> {
    let path = validated_path(&path)?;
    let lib = connection::create(&path)?;
    let info = connection::info(&lib)?;
    state.prefs.push_recent(&lib.path)?;
    state.set_library(Some(lib))?;
    Ok(info)
}

#[tauri::command]
pub fn open_library(state: State<'_, AppState>, path: String) -> Result<LibraryInfo> {
    let path = validated_path(&path)?;
    let lib = connection::open(&path)?;
    let info = connection::info(&lib)?;
    state.prefs.push_recent(&lib.path)?;
    state.set_library(Some(lib))?;
    Ok(info)
}

#[tauri::command]
pub fn close_library(state: State<'_, AppState>) -> Result<()> {
    // Nothing to flush: every command commits its own transaction, so closing is
    // just dropping the connection (ARCHITECTURE.md §2.3).
    state.set_library(None)
}

#[tauri::command]
pub fn current_library(state: State<'_, AppState>) -> Result<Option<LibraryInfo>> {
    if !state.is_open() {
        return Ok(None);
    }
    state.with_library(connection::info).map(Some)
}

/// `Save As` — snapshot to a new file and continue working in it.
/// `Save a Copy` — snapshot and stay in the current file.
#[tauri::command]
pub fn save_library_as(
    state: State<'_, AppState>,
    path: String,
    switch: bool,
) -> Result<LibraryInfo> {
    let target = validated_path(&path)?;
    let written = state.with_library(|lib| connection::vacuum_into(&lib.conn, &target))?;

    if switch {
        state.set_library(None)?;
        let lib = connection::open(&written)?;
        let info = connection::info(&lib)?;
        state.prefs.push_recent(&lib.path)?;
        state.set_library(Some(lib))?;
        return Ok(info);
    }

    let lib = connection::open(&written)?;
    connection::info(&lib)
}

#[tauri::command]
pub fn library_stats(state: State<'_, AppState>) -> Result<LibraryStats> {
    state.with_library(|lib| footage_repo::stats(&lib.conn))
}

#[tauri::command]
pub fn recent_libraries(state: State<'_, AppState>) -> Vec<RecentLibrary> {
    // A recent entry whose file has been moved or deleted is noise on the
    // welcome screen, so the list is filtered on read rather than pruned on disk
    // — a library on an unmounted drive should come back when it is mounted.
    state
        .prefs
        .get()
        .recent
        .into_iter()
        .filter(|r| Path::new(&r.path).exists())
        .collect()
}

#[tauri::command]
pub fn forget_recent(state: State<'_, AppState>, path: String) -> Result<()> {
    state.prefs.forget_recent(&path)
}
