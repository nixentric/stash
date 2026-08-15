use crate::db::models::{Collection, Project, Tag};
use crate::db::repo::{taxonomy as tax, usage as usage_repo};
use crate::error::Result;
use crate::state::AppState;
use tauri::State;

// ── tags ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn all_tags(state: State<'_, AppState>) -> Result<Vec<Tag>> {
    state.with_library(|lib| tax::all_tags(&lib.conn))
}

#[tauri::command]
pub fn add_tags(state: State<'_, AppState>, ids: Vec<i64>, tags: Vec<String>) -> Result<()> {
    state.with_library(|lib| tax::add_tags(&lib.conn, &ids, &tags))
}

#[tauri::command]
pub fn remove_tags(state: State<'_, AppState>, ids: Vec<i64>, tags: Vec<String>) -> Result<()> {
    state.with_library(|lib| tax::remove_tags(&lib.conn, &ids, &tags))
}

#[tauri::command]
pub fn set_tags(state: State<'_, AppState>, id: i64, tags: Vec<String>) -> Result<()> {
    state.with_library(|lib| tax::set_tags(&lib.conn, id, &tags))
}

// ── collections ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn all_collections(state: State<'_, AppState>) -> Result<Vec<Collection>> {
    state.with_library(|lib| tax::all_collections(&lib.conn))
}

#[tauri::command]
pub fn create_collection(state: State<'_, AppState>, name: String) -> Result<i64> {
    state.with_library(|lib| tax::create_collection(&lib.conn, &name))
}

#[tauri::command]
pub fn rename_collection(state: State<'_, AppState>, id: i64, name: String) -> Result<()> {
    state.with_library(|lib| tax::rename_collection(&lib.conn, id, &name))
}

#[tauri::command]
pub fn delete_collection(state: State<'_, AppState>, id: i64) -> Result<()> {
    state.with_library(|lib| tax::delete_collection(&lib.conn, id))
}

#[tauri::command]
pub fn add_to_collection(
    state: State<'_, AppState>,
    collection_id: i64,
    ids: Vec<i64>,
) -> Result<()> {
    state.with_library(|lib| tax::add_to_collection(&lib.conn, collection_id, &ids))
}

#[tauri::command]
pub fn remove_from_collection(
    state: State<'_, AppState>,
    collection_id: i64,
    ids: Vec<i64>,
) -> Result<()> {
    state.with_library(|lib| tax::remove_from_collection(&lib.conn, collection_id, &ids))
}

// ── projects & usage ────────────────────────────────────────────────────────

#[tauri::command]
pub fn all_projects(state: State<'_, AppState>) -> Result<Vec<Project>> {
    state.with_library(|lib| usage_repo::all_projects(&lib.conn))
}

#[tauri::command]
pub fn create_project(state: State<'_, AppState>, name: String) -> Result<i64> {
    state.with_library(|lib| usage_repo::create_project(&lib.conn, &name))
}

#[tauri::command]
pub fn rename_project(state: State<'_, AppState>, id: i64, name: String) -> Result<()> {
    state.with_library(|lib| usage_repo::rename_project(&lib.conn, id, &name))
}

#[tauri::command]
pub fn delete_project(state: State<'_, AppState>, id: i64) -> Result<()> {
    state.with_library(|lib| usage_repo::delete_project(&lib.conn, id))
}

/// Records usage. `projectId` may be omitted — "Mark Used Without Project" is a
/// supported path, not a degenerate case.
#[tauri::command]
pub fn mark_used(
    state: State<'_, AppState>,
    ids: Vec<i64>,
    project_id: Option<i64>,
    used_at: Option<String>,
    notes: Option<String>,
) -> Result<usize> {
    state.with_library_mut(|lib| {
        usage_repo::mark_used(
            &mut lib.conn,
            &ids,
            project_id,
            used_at.as_deref(),
            notes.as_deref().unwrap_or(""),
        )
    })
}

/// Clears usage history, which returns the footage to Unused via the triggers.
#[tauri::command]
pub fn mark_unused(state: State<'_, AppState>, ids: Vec<i64>) -> Result<usize> {
    state.with_library_mut(|lib| usage_repo::mark_unused(&mut lib.conn, &ids))
}

#[tauri::command]
pub fn delete_usage(state: State<'_, AppState>, usage_id: i64) -> Result<()> {
    state.with_library(|lib| usage_repo::delete_usage(&lib.conn, usage_id))
}
