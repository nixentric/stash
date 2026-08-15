use crate::db::models::Provider;
use crate::error::{AppError, Result};
use crate::prefs::Prefs;
use crate::source::{capabilities_for, Capabilities};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppCapabilities {
    pub google_drive: Capabilities,
    pub local: Capabilities,
    pub url: Capabilities,
    pub drive_connected: bool,
    pub online: bool,
}

/// One place the UI asks "what can I do?".
///
/// Menus, buttons and empty states all gate on this rather than checking for a
/// Google connection themselves, which is what makes §12 structural.
#[tauri::command]
pub async fn app_capabilities(state: State<'_, AppState>) -> Result<AppCapabilities> {
    let connected = state.drive.appears_connected(&state.prefs).await;
    Ok(AppCapabilities {
        google_drive: capabilities_for(Provider::GoogleDrive, connected),
        local: capabilities_for(Provider::Local, connected),
        url: capabilities_for(Provider::Url, connected),
        drive_connected: connected,
        // Reported by the webview, which knows about network changes; the
        // backend does not poll anything.
        online: true,
    })
}

#[tauri::command]
pub fn get_prefs(state: State<'_, AppState>) -> Prefs {
    state.prefs.get()
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PrefsPatch {
    pub theme: Option<crate::prefs::Theme>,
    pub portable_thumbnail_size: Option<crate::prefs::PortableThumbnailSize>,
    pub window_width: Option<f64>,
    pub window_height: Option<f64>,
    pub sidebar_width: Option<f64>,
    pub inspector_width: Option<f64>,
    pub inspector_visible: Option<bool>,
    pub grid_size: Option<f64>,
    pub view_mode: Option<String>,
    pub check_updates: Option<bool>,
}

#[tauri::command]
pub fn set_prefs(state: State<'_, AppState>, patch: PrefsPatch) -> Result<Prefs> {
    state.prefs.update(|p| {
        if let Some(v) = patch.theme {
            p.theme = v;
        }
        if let Some(v) = patch.portable_thumbnail_size {
            p.portable_thumbnail_size = v;
        }
        if let Some(v) = patch.window_width {
            p.window_width = Some(v);
        }
        if let Some(v) = patch.window_height {
            p.window_height = Some(v);
        }
        if let Some(v) = patch.sidebar_width {
            p.sidebar_width = Some(v);
        }
        if let Some(v) = patch.inspector_width {
            p.inspector_width = Some(v);
        }
        if let Some(v) = patch.inspector_visible {
            p.inspector_visible = Some(v);
        }
        if let Some(v) = patch.grid_size {
            p.grid_size = Some(v);
        }
        if let Some(v) = patch.check_updates {
            p.check_updates = v;
        }
        if let Some(v) = patch.view_mode {
            p.view_mode = Some(v);
        }
    })
}

/// Opens a link in the user's browser.
///
/// Validated here rather than trusted: a command is reachable from any page the
/// webview loads, and `open_url` on an arbitrary scheme is a code-execution
/// primitive on some platforms.
#[tauri::command]
pub fn open_external(app: tauri::AppHandle, url: String) -> Result<()> {
    let parsed = url::Url::parse(&url)
        .map_err(|_| AppError::Invalid("That is not a valid link".into()))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::Invalid("Only web links can be opened".into()));
    }
    app.opener()
        .open_url(parsed.to_string(), None::<&str>)
        .map_err(|e| AppError::Other(format!("Could not open the link: {e}")))
}

/// Reveals a local file in Finder/Explorer.
#[tauri::command]
pub fn reveal_in_file_manager(app: tauri::AppHandle, path: String) -> Result<()> {
    let p = std::path::Path::new(&path);
    if !p.is_absolute() || path.contains('\0') {
        return Err(AppError::Invalid("Invalid path".into()));
    }
    if !p.exists() {
        return Err(AppError::NotFound("That file is no longer there".into()));
    }
    app.opener()
        .reveal_item_in_dir(p)
        .map_err(|e| AppError::Other(format!("Could not reveal the file: {e}")))
}

/// Asks GitHub whether a newer release exists. Never downloads or installs —
/// the answer is a link the user chooses to follow.
#[tauri::command]
pub async fn check_for_update() -> Result<crate::update::UpdateStatus> {
    crate::update::check(env!("CARGO_PKG_VERSION")).await
}
