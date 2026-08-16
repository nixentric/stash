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
    /// True once the original is on disk — the preview is then the real file.
    pub downloaded: bool,
    /// The file on this machine, downloaded copy or catalogued local file.
    /// `None` means there is nothing for "Open Local" to reveal.
    pub local_path: Option<String>,
    /// Whether "Download" can do anything for this source.
    pub downloadable: bool,
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

    let downloaded_file = preview::downloads::find(&state, id);
    let downloaded = downloaded_file.is_some();
    let local_path = downloaded_file
        .map(|p| p.to_string_lossy().into_owned())
        .or_else(|| {
            src.local_path
                .clone()
                .filter(|p| std::path::Path::new(p).exists())
        });
    let downloadable = !downloaded
        && match src.provider.as_str() {
            "google_drive" => src.external_id.is_some(),
            "url" => src.original_url.is_some(),
            _ => false,
        };

    let (kind, url, reason) = match src.provider.as_str() {
        // The original is already here. Nothing remote is worth asking for.
        _ if downloaded => (served_kind, Some(format!("stash://media/{id}")), None),

        // Local files stream straight off disk through the same scheme handler.
        "local" => (served_kind, Some(format!("stash://media/{id}")), None),

        // Drive stills go through Google's own viewer rather than our scheme.
        // Fetching a still means buffering the whole file before one pixel
        // appears — a 5 MB photo is a blank screen for seconds, and a failure
        // is a blank screen forever. The embed renders immediately and is
        // Google's problem to get right; the Download button is there for the
        // full-quality local copy.
        "google_drive" if media_type == MediaType::Image => match &src.external_id {
            Some(fid) => ("embed", Some(gparse::embed_url(fid)), None),
            None => (
                "none",
                None,
                Some("This link has no recognizable Drive file".to_string()),
            ),
        },

        // Connected: authenticated ranged streaming. Nothing is downloaded
        // beyond the bytes the player asks for.
        "google_drive" if connected => (served_kind, Some(format!("stash://media/{id}")), None),

        // Link mode: Google's own published embed. Works only for files shared
        // as "Anyone with the link", which is why it is best-effort and why the
        // iframe is sandboxed on the frontend.
        "google_drive" => match &src.external_id {
            Some(fid) => ("embed", Some(gparse::embed_url(fid)), None),
            None => (
                "none",
                None,
                Some("This link has no recognizable Drive file".to_string()),
            ),
        },

        "url" => (served_kind, src.original_url.clone(), None),

        _ => (
            "none",
            None,
            Some("No preview is available for this source".to_string()),
        ),
    };

    Ok(PlaybackTarget {
        kind,
        url,
        external_url,
        reason,
        downloaded,
        local_path,
        downloadable,
    })
}

/// Downloads the original next to the library, reporting progress as it goes.
///
/// Returns the folder-relative name so the UI can say where the file landed.
#[tauri::command]
pub async fn download_original(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> Result<String> {
    let path = preview::downloads::fetch(&app, &state, id).await?;
    Ok(path.to_string_lossy().into_owned())
}

/// Which footage already has its original on disk, for the grid's badge.
#[tauri::command]
pub fn downloaded_ids(state: State<'_, AppState>) -> Result<Vec<i64>> {
    Ok(preview::downloads::downloaded_ids(&state))
}

/// Why the preview came up empty, in the words the user needs.
///
/// The `<img>` element reports only "it broke", so the reason has to be asked
/// for. The probe is a one-byte ranged read: it re-runs the same authorization
/// the real request did without pulling the file again.
#[tauri::command]
pub async fn preview_failure(state: State<'_, AppState>, id: i64) -> Result<String> {
    let (src, media_type) = state.with_library(|lib| {
        let src = footage_repo::get_source(&lib.conn, id)?;
        let mt: String = lib
            .conn
            .query_row("SELECT media_type FROM footages WHERE id = ?1", [id], |r| {
                r.get(0)
            })?;
        Ok((src, MediaType::parse(&mt)))
    })?;

    let name = src
        .original_filename
        .clone()
        .or_else(|| src.local_path.clone())
        .unwrap_or_default();
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_uppercase();

    // A RAW or PSD is a still that no webview will ever decode. That is not a
    // network problem and no amount of retrying fixes it.
    if media_type == MediaType::Image && !preview::scheme::is_web_still(&name) {
        return Ok(format!(
            "A {ext} file cannot be displayed by the app itself. Download it and open it in an editor, or set a thumbnail from the Inspector."
        ));
    }

    Ok(match src.provider.as_str() {
        "local" => match src.local_path.as_deref() {
            Some(p) if !std::path::Path::new(p).exists() => {
                format!("The file is no longer at {p}.")
            }
            Some(_) => "The file is there but could not be read.".into(),
            None => "This record has no file path.".into(),
        },
        "google_drive" => {
            state.drive.ensure_restored(&state.prefs).await;
            if !state.drive.is_connected().await {
                "Google Drive is not connected, so only files shared as \"Anyone with the link\" can be previewed.".into()
            } else {
                match src.external_id.as_deref() {
                    None => "This link has no recognizable Drive file id.".into(),
                    Some(fid) => match state.drive.media_range(fid, Some("bytes=0-0")).await {
                        Ok(_) => "Drive served the file, but the app could not decode it.".into(),
                        Err(AppError::PermissionRequired) => {
                            "The connected Google account has no access to this file.".into()
                        }
                        Err(AppError::NotFound(_)) => {
                            "The file is gone from Drive, or was moved to the trash.".into()
                        }
                        Err(AppError::AuthExpired) => {
                            "The Google sign-in expired. Reconnect the account in Settings.".into()
                        }
                        Err(AppError::RateLimited) => {
                            "Google is rate-limiting this account. Try again in a minute.".into()
                        }
                        Err(e) => format!("Drive refused the request: {e}"),
                    },
                }
            }
        }
        "url" => match src.original_url.as_deref() {
            None => "This record has no address to load from.".into(),
            Some(u) => match state.http.get(u).send().await {
                Ok(r) if r.status().is_success() => {
                    "The server answered, but the app could not decode the file.".into()
                }
                Ok(r) => format!("The server answered {}.", r.status().as_u16()),
                Err(_) => "The address could not be reached.".into(),
            },
        },
        other => format!("A {other} source has no preview route."),
    })
}

/// Where downloaded originals are kept right now.
#[tauri::command]
pub fn download_dir(state: State<'_, AppState>) -> Result<String> {
    Ok(preview::downloads::dir(&state)?
        .to_string_lossy()
        .into_owned())
}

/// Moves the download folder, existing files included.
#[tauri::command]
pub fn set_download_dir(state: State<'_, AppState>, path: String) -> Result<String> {
    let p = std::path::PathBuf::from(&path);
    if !p.is_absolute() || path.contains('\0') {
        return Err(AppError::Invalid("Invalid folder path".into()));
    }
    preview::downloads::set_dir(&state, &p)?;
    Ok(p.to_string_lossy().into_owned())
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
