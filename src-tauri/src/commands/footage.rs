use crate::db::models::*;
use crate::db::repo::footage as repo;
use crate::error::Result;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn list_footage(state: State<'_, AppState>, query: FootageQuery) -> Result<FootagePage> {
    state.with_library(|lib| repo::list(&lib.conn, &query))
}

/// Ids in current sort order — backs Select All and Quick Look next/previous
/// without shipping every row's metadata to the webview.
#[tauri::command]
pub fn list_footage_ids(state: State<'_, AppState>, query: FootageQuery) -> Result<Vec<i64>> {
    state.with_library(|lib| repo::list_ids(&lib.conn, &query))
}

#[tauri::command]
pub fn get_footage(state: State<'_, AppState>, id: i64) -> Result<FootageDetail> {
    state.with_library(|lib| repo::get(&lib.conn, id))
}

#[tauri::command]
pub fn patch_footage(
    state: State<'_, AppState>,
    ids: Vec<i64>,
    patch: FootagePatch,
) -> Result<()> {
    state.with_library(|lib| repo::patch(&lib.conn, &ids, &patch))
}

/// Removes catalog records. The wording matters and is enforced by the absence
/// of any delete path to a source: nothing here touches Google Drive or disk.
#[tauri::command]
pub fn remove_footage(state: State<'_, AppState>, ids: Vec<i64>) -> Result<usize> {
    let removed = state.with_library_mut(|lib| repo::remove(&mut lib.conn, &ids))?;
    let n = removed.count;
    state.stash_removed(removed);
    Ok(n)
}

/// Puts the last removal back — the same records, under the same ids, with
/// their tags, usage history and collections still attached.
#[tauri::command]
pub fn restore_removed(state: State<'_, AppState>) -> Result<usize> {
    let Some(removed) = state.take_removed() else {
        return Ok(0);
    };
    match state.with_library_mut(|lib| repo::restore(&mut lib.conn, &removed)) {
        Ok(n) => Ok(n),
        // A failed restore keeps its snapshot: the user can try again.
        Err(e) => {
            state.stash_removed(removed);
            Err(e)
        }
    }
}

#[tauri::command]
pub fn list_folders(state: State<'_, AppState>) -> Result<Vec<FolderNode>> {
    state.with_library(|lib| repo::folders(&lib.conn))
}
