use crate::db::models::MediaType;
use crate::db::repo::footage as footage_repo;
use crate::error::{AppError, Result};
use crate::gdrive::parse as gparse;
use crate::preview;
use crate::state::AppState;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use tauri::State;

const MAX_CUSTOM_THUMB_BYTES: usize = 24 * 1024 * 1024;

#[tauri::command]
pub fn get_thumbnail(state: State<'_, AppState>, id: i64, large: bool) -> Result<Option<String>> {
    preview::read(&state, id, large)
}

#[tauri::command]
pub async fn refresh_thumbnail(
    state: State<'_, AppState>,
    id: i64,
    force: bool,
) -> Result<bool> {
    preview::refresh(&state, id, force).await
}

/// How the UI should play or display this footage.
///
/// The frontend switches on `kind` alone. It never constructs a Drive URL, never
/// checks whether an account is connected, and never learns which provider
/// answered — that is the §31 rule expressed as a type.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackTarget {
    /// "stream" | "embed" | "image" | "none"
    pub kind: &'static str,
    /// Where to point `<video>`/`<img>`/`<iframe>`, when there is somewhere.
    pub url: Option<String>,
    /// Always offered as a fallback when the source has a web location.
    pub external_url: Option<String>,
    /// Shown when `kind == "none"`. Plain language, no error codes.
    pub reason: Option<String>,
}

#[tauri::command]
pub async fn playback_target(state: State<'_, AppState>, id: i64) -> Result<PlaybackTarget> {
    let (src, media_type) = state.with_library(|lib| {
        let src = footage_repo::get_source(&lib.conn, id)?;
        let detail: String = lib.conn.query_row(
            "SELECT media_type FROM footages WHERE id = ?1",
            [id],
            |r| r.get(0),
        )?;
        Ok((src, MediaType::parse(&detail)))
    })?;

    let external_url = match src.provider.as_str() {
        "google_drive" => src.external_id.as_ref().map(|fid| {
            gparse::view_url(&gparse::DriveRef {
                kind: gparse::DriveRefKind::File,
                file_id: fid.clone(),
                resource_key: src.external_key.clone(),
                original_url: String::new(),
            })
        }),
        _ => src.original_url.clone(),
    };

    state.drive.ensure_restored(&state.prefs).await;
    let connected = state.drive.is_connected().await;

    // Stills are shown, not played. Every provider that serves bytes has to
    // answer "image" for them, or the frontend hands a JPEG to <video>.
    let served_kind = if media_type == MediaType::Image {
        "image"
    } else {
        "stream"
    };

    let target = match src.provider.as_str() {
        // Local files stream straight off disk through the same scheme handler.
        "local" => PlaybackTarget {
            kind: served_kind,
            url: Some(format!("stash://media/{id}")),
            external_url,
            reason: None,
        },

        // Connected: authenticated ranged streaming. Nothing is downloaded
        // beyond the bytes the player asks for.
        "google_drive" if connected => PlaybackTarget {
            kind: served_kind,
            url: Some(format!("stash://media/{id}")),
            external_url,
            reason: None,
        },

        // Link mode: Google's own published embed. Works only for files shared
        // as "Anyone with the link", which is why it is best-effort and why the
        // iframe is sandboxed on the frontend.
        "google_drive" => match &src.external_id {
            Some(fid) => PlaybackTarget {
                kind: "embed",
                url: Some(gparse::embed_url(fid)),
                external_url,
                reason: None,
            },
            None => PlaybackTarget {
                kind: "none",
                url: None,
                external_url,
                reason: Some("This link has no recognizable Drive file".into()),
            },
        },

        "url" => PlaybackTarget {
            kind: served_kind,
            url: src.original_url.clone(),
            external_url,
            reason: None,
        },

        _ => PlaybackTarget {
            kind: "none",
            url: None,
            external_url,
            reason: Some("No preview is available for this source".into()),
        },
    };

    Ok(target)
}

/// "Set Thumbnail…" — pick an image file.
#[tauri::command]
pub fn set_thumbnail_from_path(state: State<'_, AppState>, id: i64, path: String) -> Result<()> {
    let p = std::path::Path::new(&path);
    if !p.is_absolute() || path.contains('\0') {
        return Err(AppError::Invalid("Invalid image path".into()));
    }
    let meta = std::fs::metadata(p)
        .map_err(|_| AppError::NotFound("That image could not be read".into()))?;
    if meta.len() as usize > MAX_CUSTOM_THUMB_BYTES {
        return Err(AppError::Invalid("That image is too large".into()));
    }
    let bytes = std::fs::read(p)?;
    preview::set_custom(&state, id, &bytes)
}

/// "Paste Thumbnail" and drag-and-drop both land here.
#[tauri::command]
pub fn set_thumbnail_from_bytes(
    state: State<'_, AppState>,
    id: i64,
    data_base64: String,
) -> Result<()> {
    // Accept a bare base64 payload or a full data: URL.
    let payload = data_base64
        .split_once("base64,")
        .map(|(_, b)| b)
        .unwrap_or(&data_base64);

    let bytes = STANDARD
        .decode(payload.trim())
        .map_err(|_| AppError::Invalid("That clipboard content is not an image".into()))?;
    if bytes.len() > MAX_CUSTOM_THUMB_BYTES {
        return Err(AppError::Invalid("That image is too large".into()));
    }
    preview::set_custom(&state, id, &bytes)
}

#[tauri::command]
pub fn clear_thumbnail(state: State<'_, AppState>, id: i64) -> Result<()> {
    preview::clear_custom(&state, id)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo {
    pub bytes_on_disk: u64,
}

#[tauri::command]
pub fn cache_info(state: State<'_, AppState>) -> CacheInfo {
    CacheInfo {
        bytes_on_disk: state.cache.size_on_disk(),
    }
}

#[tauri::command]
pub fn clear_preview_cache(state: State<'_, AppState>) -> Result<()> {
    // Safe by construction: the cache is derived data. Portable thumbnails
    // inside the library are untouched, so the grid stays visual.
    state.cache.clear()
}
