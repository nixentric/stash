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
pub fn delete_folder(state: State<'_, AppState>, path: String) -> Result<usize> {
    state.with_library_mut(|lib| repo::delete_folder(&mut lib.conn, &path))
}

#[tauri::command]
pub fn set_folder_tags(state: State<'_, AppState>, path: String, tags: Vec<String>) -> Result<()> {
    state.with_library(|lib| repo::set_tags(&lib.conn, &path, &tags))
}

#[tauri::command]
pub fn set_folder_brand(
    state: State<'_, AppState>,
    path: String,
    brand_id: Option<i64>,
) -> Result<()> {
    state.with_library(|lib| repo::set_brand(&lib.conn, &path, brand_id))
}

#[tauri::command]
pub fn default_folder_brand(state: State<'_, AppState>) -> Result<Option<i64>> {
    state.with_library(|lib| repo::default_brand(&lib.conn))
}

#[tauri::command]
pub fn set_default_folder_brand(state: State<'_, AppState>, brand_id: Option<i64>) -> Result<()> {
    state.with_library(|lib| repo::set_default_brand(&lib.conn, brand_id))
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
