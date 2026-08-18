//! Original files pulled down to disk, next to the library.
//!
//! Streaming a Drive still into `<img>` means the whole file is buffered before
//! a single pixel appears, and a slow or unshared file leaves the preview blank
//! for as long as it takes. A downloaded copy is opened from disk instead:
//! instant on the second look, and readable with the account disconnected.
//!
//! The file is written under the id (`12-photo.jpg`) so the scheme handler can
//! find it without a database column — nothing here is library state, and
//! deleting the folder only costs a re-download.

use crate::db::repo::footage as footage_repo;
use crate::error::{AppError, Result};
use crate::state::AppState;
use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

/// Emitted as `download:progress` while bytes arrive.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub id: i64,
    pub received: u64,
    /// `None` when the server did not say how big the file is.
    pub total: Option<u64>,
}

/// Progress is emitted at most every 512 KB, so a fast local link does not
/// flood the webview with one event per chunk.
const EMIT_EVERY: u64 = 512 * 1024;

/// Where downloads land: the preference, or `Downloaded/` beside the library
/// file — so a library carried to another machine carries its files too.
pub fn dir(state: &AppState) -> Result<PathBuf> {
    if let Some(p) = state
        .prefs
        .get()
        .download_dir
        .filter(|p| !p.trim().is_empty())
    {
        return Ok(PathBuf::from(p));
    }
    let lib = state.library_path().ok_or(AppError::NoLibraryOpen)?;
    Ok(lib
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("Downloaded"))
}

/// Strips anything that would let a Drive filename write outside the folder.
fn safe_name(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or(raw);
    let cleaned: String = base
        .chars()
        .map(|c| match c {
            '\0'..='\x1f' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim_matches(['.', ' ']).to_string();
    if trimmed.is_empty() {
        "file".into()
    } else {
        trimmed
    }
}

/// Names the one failure the user can do something about.
///
/// macOS refuses writes into Documents, Desktop and Downloads until the app has
/// been granted access, and the refusal arrives as a bare `EPERM` — "Operation
/// not permitted (os error 1)" is not a sentence anyone can act on. Choosing a
/// folder in the file dialog grants access to it as a side effect, which is why
/// that is the first thing offered.
fn disk_error(dir: &Path, e: std::io::Error) -> AppError {
    if !matches!(
        e.kind(),
        std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::ReadOnlyFilesystem
    ) {
        return AppError::Io(e.to_string());
    }
    let grant = if cfg!(target_os = "macos") {
        " — choosing it in the dialog is what grants access — or allow Stash under System \
         Settings → Privacy & Security → Files and Folders"
    } else {
        " that you can write to"
    };
    AppError::Invalid(format!(
        "Stash is not allowed to write to {}. Pick a downloads folder in Settings → Library{}.",
        dir.display(),
        grant
    ))
}

/// The downloaded copy of this footage, if there is one.
pub fn find(state: &AppState, footage_id: i64) -> Option<PathBuf> {
    let prefix = format!("{footage_id}-");
    std::fs::read_dir(dir(state).ok()?)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .find(|p| {
            p.is_file()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    // `.part` is a download still in flight, not a preview.
                    .is_some_and(|n| n.starts_with(&prefix) && !n.ends_with(".part"))
        })
}

/// The footage id a downloaded file belongs to, from its name alone.
///
/// The same rule `find` matches on, read the other way round.
fn id_from_name(name: &str) -> Option<i64> {
    // `.part` is a download still in flight, not a file you have.
    if name.ends_with(".part") {
        return None;
    }
    name.split_once('-')?.0.parse::<i64>().ok()
}

/// A file this folder owns: a download, finished or in flight.
fn is_download(name: &str) -> bool {
    id_from_name(name).is_some()
        || name
            .strip_suffix(".part")
            .is_some_and(|n| id_from_name(n).is_some())
}

/// Every footage id that has a downloaded original, from one directory read.
///
/// `find` scans the folder per call, so asking it once per row would be
/// quadratic on a grid of thousands. Missing folder means nothing downloaded.
pub fn downloaded_ids(state: &AppState) -> Vec<i64> {
    let Ok(entries) = dir(state).and_then(|d| Ok(std::fs::read_dir(d)?)) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| id_from_name(&e.file_name().into_string().ok()?))
        .collect()
}

/// Downloads the original to disk, reporting progress as it goes.
///
/// Written to a `.part` file and renamed at the end, so an interrupted download
/// never leaves a truncated image that `<img>` would happily render as garbage.
pub async fn fetch(app: &AppHandle, state: &AppState, footage_id: i64) -> Result<PathBuf> {
    if let Some(existing) = find(state, footage_id) {
        return Ok(existing);
    }

    let src = state.with_library(|lib| footage_repo::get_source(&lib.conn, footage_id))?;

    // A local file is already on disk; copying it into Downloaded would only
    // burn the space twice.
    if src.provider == "local" {
        return src
            .local_path
            .map(PathBuf::from)
            .filter(|p| p.exists())
            .ok_or_else(|| AppError::NotFound("That file is not on this computer".into()));
    }

    let name = safe_name(
        src.original_filename
            .as_deref()
            .or(src.local_path.as_deref())
            .unwrap_or("file"),
    );
    let dir = dir(state)?;
    std::fs::create_dir_all(&dir).map_err(|e| disk_error(&dir, e))?;
    let dest = dir.join(format!("{footage_id}-{name}"));
    let part = dir.join(format!("{footage_id}-{name}.part"));

    let mut resp = match src.provider.as_str() {
        "google_drive" => {
            let id = src
                .external_id
                .clone()
                .ok_or_else(|| AppError::NotFound("This link has no Drive file id".into()))?;
            state.drive.ensure_restored(&state.prefs).await;

            if state.drive.is_connected().await {
                // No Range header: this is the one place the whole file is wanted.
                state.drive.media_range(&id, None).await?
            } else {
                // Link mode. The embed already renders this file, so it is
                // public and the anonymous route can fetch it too.
                let url = crate::preview::providers::best_effort_drive::public_download_url(
                    &id,
                    src.external_key.as_deref(),
                );
                let resp = state.http.get(&url).send().await?;
                if !resp.status().is_success() {
                    return Err(AppError::PermissionRequired);
                }
                // A private file answers 200 with a sign-in page, so the content
                // type is the only honest signal that these are real bytes.
                // ponytail: a public file over ~100 MB answers with the virus-scan
                // interstitial, also HTML, and is reported as "not shared
                // publicly". Parse the confirm token out of that page if anyone
                // hits it; connecting the account is the fix either way.
                let html = resp
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .is_some_and(|ct| ct.starts_with("text/html"));
                if html {
                    return Err(AppError::Invalid(
                        "This file is not shared publicly. Connect Google Drive in Settings to download it.".into(),
                    ));
                }
                resp
            }
        }
        "url" => {
            let url = src
                .original_url
                .clone()
                .ok_or_else(|| AppError::NotFound("This source has no address".into()))?;
            let resp = state.http.get(&url).send().await?;
            if !resp.status().is_success() {
                return Err(AppError::Network(format!(
                    "The server answered {}",
                    resp.status().as_u16()
                )));
            }
            resp
        }
        other => {
            return Err(AppError::Invalid(format!(
                "A {other} source cannot be downloaded"
            )))
        }
    };

    let total = resp.content_length();
    let mut file = std::fs::File::create(&part).map_err(|e| disk_error(&dir, e))?;
    let mut received = 0u64;
    let mut emitted = 0u64;
    let emit = |received: u64| {
        let _ = app.emit(
            "download:progress",
            DownloadProgress {
                id: footage_id,
                received,
                total,
            },
        );
    };
    emit(0);

    while let Some(chunk) = resp.chunk().await? {
        file.write_all(&chunk)?;
        received += chunk.len() as u64;
        if received - emitted >= EMIT_EVERY {
            emitted = received;
            emit(received);
        }
    }
    file.flush()?;
    drop(file);
    std::fs::rename(&part, &dest).map_err(|e| disk_error(&dir, e))?;
    emit(received);

    Ok(dest)
}

/// Points downloads at a new folder, taking the existing files along.
pub fn set_dir(state: &AppState, new_dir: &Path) -> Result<()> {
    let old = dir(state)?;
    std::fs::create_dir_all(new_dir).map_err(|e| disk_error(new_dir, e))?;

    if old.exists() && old != new_dir {
        // Best effort throughout: an old folder that cannot be read, or a file
        // that will not move, must not block the setting the user changed.
        for entry in std::fs::read_dir(&old).into_iter().flatten().flatten() {
            // Only our own downloads move. The old folder is often a folder the
            // user also keeps their own things in — Documents, say — and
            // dragging those along (or failing on a subfolder we cannot copy)
            // is not something changing a setting should do.
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if !is_download(name) || !entry.file_type().is_ok_and(|t| t.is_file()) {
                continue;
            }
            let to = new_dir.join(name);
            // Rename is instant on the same volume; across volumes it fails and
            // the copy is the only way over. A file that refuses to move is
            // left where it is and re-downloaded on demand — the preference is
            // what the user asked to change.
            if std::fs::rename(entry.path(), &to).is_err()
                && std::fs::copy(entry.path(), &to).is_ok()
            {
                let _ = std::fs::remove_file(entry.path());
            }
        }
        let _ = std::fs::remove_dir(&old);
    }

    state
        .prefs
        .update(|p| p.download_dir = Some(new_dir.to_string_lossy().into_owned()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_id_off_a_downloaded_file() {
        assert_eq!(id_from_name("12-photo.jpg"), Some(12));
        // A name with its own dashes still belongs to the id in front.
        assert_eq!(id_from_name("7-shoot-final-v2.mp4"), Some(7));
        // Still downloading, and things that were never ours.
        assert_eq!(id_from_name("12-photo.jpg.part"), None);
        assert_eq!(id_from_name("notes.txt"), None);
        assert_eq!(id_from_name(".DS_Store"), None);
    }

    #[test]
    fn only_our_own_downloads_are_carried_to_a_new_folder() {
        assert!(is_download("12-photo.jpg"));
        assert!(is_download("12-photo.jpg.part"));
        // Whatever else lives in the folder the user pointed us at stays put.
        assert!(!is_download("Tax return.pdf"));
        assert!(!is_download("desktop.ini"));
        assert!(!is_download("My Music"));
    }

    #[test]
    fn a_blocked_folder_is_reported_as_something_to_fix() {
        let e = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        let msg = disk_error(Path::new("/Users/x/Documents/Assets"), e).to_string();
        assert!(msg.contains("/Users/x/Documents/Assets"), "names the folder: {msg}");
        assert!(msg.contains("Settings"), "offers the fix: {msg}");
        assert!(!msg.contains("os error"), "no raw errno: {msg}");

        // Anything else keeps its own words rather than being blamed on macOS.
        let other = std::io::Error::from(std::io::ErrorKind::OutOfMemory);
        assert!(!disk_error(Path::new("/tmp"), other)
            .to_string()
            .contains("Privacy"));
    }

    #[test]
    fn filenames_cannot_escape_the_download_folder() {
        assert_eq!(safe_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_name("C:\\Windows\\evil.jpg"), "evil.jpg");
        assert_eq!(safe_name("photo.jpg"), "photo.jpg");
        // A name that sanitizes away entirely still has to produce a filename.
        assert_eq!(safe_name("..."), "file");
        assert_eq!(safe_name(""), "file");
        // The extension survives, because the scheme handler types the response
        // from it.
        assert!(safe_name("a:b?c.JPG").ends_with(".JPG"));
    }
}
