use crate::db::models::FolderField;
use crate::db::repo::source_folder as repo;
use crate::error::Result;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn folder_fields(state: State<'_, AppState>) -> Result<Vec<FolderField>> {
    state.with_library(|lib| repo::fields(&lib.conn))
}

#[tauri::command]
pub fn create_folder_field(state: State<'_, AppState>, name: String) -> Result<i64> {
    state.with_library(|lib| repo::create_field(&lib.conn, &name))
}

#[tauri::command]
pub fn delete_folder_field(state: State<'_, AppState>, id: i64) -> Result<()> {
    state.with_library(|lib| repo::delete_field(&lib.conn, id))
}

#[tauri::command]
pub fn set_folder_tags(state: State<'_, AppState>, path: String, tags: Vec<String>) -> Result<()> {
    state.with_library(|lib| repo::set_tags(&lib.conn, &path, &tags))
}

#[tauri::command]
pub fn set_folder_field_value(
    state: State<'_, AppState>,
    path: String,
    field_id: i64,
    value: String,
) -> Result<()> {
    state.with_library(|lib| repo::set_field_value(&lib.conn, &path, field_id, &value))
}
