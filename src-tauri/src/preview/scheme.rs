//! `stash://media/{footage_id}` — ranged media for `<video>` and `<img>`.
//! `stash://thumb/{footage_id}` — the stored thumbnail, for every list on screen.
//!
//! A `<video>` element cannot attach an `Authorization` header, so authenticated
//! Drive playback needs a shim. The two options are a local HTTP proxy (an open
//! port that then needs its own auth) or a custom URI scheme. The scheme wins:
//! nothing is listening on a port, and the webview's origin check is the
//! access control.
//!
//! `Range` is forwarded verbatim to Drive's `alt=media` endpoint, which honors
//! it — so seeking transfers only the bytes asked for and the original file is
//! never downloaded (§7 of the brief).

use crate::db::models::MediaType;
use crate::db::repo::footage as footage_repo;
use crate::error::{AppError, Result};
use crate::state::AppState;
use std::io::{Read, Seek, SeekFrom};
use tauri::http::{Request, Response};
use tauri::Manager;

/// Upper bound on a single response. Without it, a `<video>` that omits `Range`
/// would pull an entire 4 GB master into memory.
const MAX_CHUNK: u64 = 4 * 1024 * 1024;

/// A still has to arrive whole or it does not decode, so `<img>` gets one 200
/// with the entire file. Bounded anyway: a "photo" that big is not a photo.
const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;

struct RangeSpec {
    start: u64,
    end: u64,
}

/// Parses `bytes=START-END`, `bytes=START-`, and `bytes=-SUFFIX`.
fn parse_range(header: Option<&str>, total: u64) -> RangeSpec {
    let default = RangeSpec {
        start: 0,
        end: total.saturating_sub(1).min(MAX_CHUNK - 1),
    };
    let Some(h) = header.and_then(|h| h.strip_prefix("bytes=")) else {
        return default;
    };
    let Some((a, b)) = h.split_once('-') else {
        return default;
    };

    let (start, end) = match (a.trim().parse::<u64>(), b.trim().parse::<u64>()) {
        // bytes=-N → the final N bytes
        (Err(_), Ok(suffix)) => (total.saturating_sub(suffix), total.saturating_sub(1)),
        (Ok(s), Ok(e)) => (s, e),
        (Ok(s), Err(_)) => (s, total.saturating_sub(1)),
        _ => return default,
    };

    let start = start.min(total.saturating_sub(1));
    let end = end.min(total.saturating_sub(1)).max(start);
    RangeSpec {
        start,
        end: end.min(start + MAX_CHUNK - 1),
    }
}

/// Only the types a webview will actually decode. A DNG or PSD is a still too,
/// but no `<img>` will render it — those fall back to the thumbnail.
fn ext_mime(name: &str) -> Option<&'static str> {
    match name.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "avif" => Some("image/avif"),
        "heic" | "heif" => Some("image/heic"),
        "bmp" => Some("image/bmp"),
        "tif" | "tiff" => Some("image/tiff"),
        _ => None,
    }
}

/// Whether an `<img>` can decode this still at all. A DNG or PSD cannot, and
/// that is a fact about the format, not a failure worth retrying.
pub fn is_web_still(name: &str) -> bool {
    ext_mime(name).is_some()
}

/// `("media" | "thumb", footage_id)`.
///
/// macOS/Linux: `stash://media/12` · Windows: `http://stash.localhost/media/12`.
/// Both end in `<kind>/<id>`, so the last two segments are all this needs.
fn route_from(request: &Request<Vec<u8>>) -> Option<(String, i64)> {
    let uri = request.uri().to_string();
    let path = uri.split("://").nth(1)?;
    let path = path.split(['?', '#']).next()?;
    let mut back = path.rsplit('/');
    let id: i64 = back.next()?.parse().ok()?;
    Some((back.next()?.to_string(), id))
}

/// The URL the *webview* must use to reach the scheme handler.
///
/// WKWebView answers `stash://`; WebView2 does not — on Windows Tauri serves the
/// same handler at `http://stash.localhost/…`. Handing a Windows webview a
/// `stash://` URL is a broken image, which is what a library opened on a second
/// machine looked like.
pub fn url(kind: &str, footage_id: i64) -> String {
    if cfg!(windows) {
        format!("http://stash.localhost/{kind}/{footage_id}")
    } else {
        format!("stash://{kind}/{footage_id}")
    }
}

/// The portable thumbnail, straight from the library file.
///
/// Serving it here rather than as a base64 data URL through IPC is what keeps a
/// scrolled library from costing a gigabyte: the bytes never enter the JS heap,
/// and the webview owns the decoded copy, so it can drop it the moment the
/// image is off screen.
fn serve_thumb(state: &AppState, footage_id: i64) -> Result<Response<Vec<u8>>> {
    let bytes = state
        .with_library(|lib| crate::db::repo::thumbnail::get(&lib.conn, footage_id))?
        .ok_or_else(|| AppError::NotFound("No thumbnail".into()))?;

    // Same sniff as the data-URL path: JPEG unless the encoder kept alpha.
    let mime = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else {
        "image/jpeg"
    };

    Ok(Response::builder()
        .status(200)
        .header("Content-Type", mime)
        .header("Content-Length", bytes.len().to_string())
        // A thumbnail can be replaced in place, and the URL does not change when
        // it is. Reading it again is one indexed row out of a local file.
        .header("Cache-Control", "no-store")
        .body(bytes)
        .unwrap_or_else(|_| Response::new(Vec::new())))
}

fn err_response(status: u16, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn partial(body: Vec<u8>, start: u64, end: u64, total: u64, mime: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(206)
        .header("Content-Type", mime)
        .header("Accept-Ranges", "bytes")
        .header("Content-Range", format!("bytes {start}-{end}/{total}"))
        .header("Content-Length", body.len().to_string())
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// Reads a file off disk, whole for a still and ranged for anything else.
fn serve_file(
    path: &std::path::Path,
    still: bool,
    mime: &str,
    range_header: Option<&str>,
) -> Result<Response<Vec<u8>>> {
    let total = std::fs::metadata(path)?.len();

    if still && range_header.is_none() && total <= MAX_IMAGE_BYTES {
        return Ok(Response::builder()
            .status(200)
            .header("Content-Type", mime)
            .header("Content-Length", total.to_string())
            .body(std::fs::read(path)?)
            .unwrap_or_else(|_| Response::new(Vec::new())));
    }

    let r = parse_range(range_header, total);

    let mut file = std::fs::File::open(path)?;
    file.seek(SeekFrom::Start(r.start))?;
    let mut buf = vec![0u8; (r.end - r.start + 1) as usize];
    let n = file.read(&mut buf)?;
    buf.truncate(n);
    Ok(partial(buf, r.start, r.end, total, mime))
}

async fn serve(state: &AppState, footage_id: i64, range_header: Option<String>) -> Result<Response<Vec<u8>>> {
    let src = state.with_library(|lib| footage_repo::get_source(&lib.conn, footage_id))?;

    // The mime column is empty for most local files, so the extension decides —
    // the same fallback `MediaType::from_mime_or_name` uses when cataloging.
    let name = src
        .local_path
        .clone()
        .or_else(|| src.original_filename.clone())
        .unwrap_or_default();
    let still = MediaType::from_mime_or_name(src.mime_type.as_deref(), &name) == MediaType::Image;
    let mime = src
        .mime_type
        .clone()
        .filter(|m| !m.is_empty() && !m.ends_with("octet-stream"))
        .or_else(|| ext_mime(&name).map(str::to_string))
        .unwrap_or_else(|| "application/octet-stream".into());

    // A downloaded original outranks every remote route: it is already here, it
    // needs no account, and it is the whole file rather than a preview of it.
    if let Some(path) = crate::preview::downloads::find(state, footage_id) {
        return serve_file(&path, still, &mime, range_header.as_deref());
    }

    match src.provider.as_str() {
        "local" => {
            let path = src
                .local_path
                .clone()
                .ok_or_else(|| AppError::NotFound("No file path".into()))?;
            serve_file(std::path::Path::new(&path), still, &mime, range_header.as_deref())
        }

        "google_drive" => {
            state.drive.ensure_restored(&state.prefs).await;
            if !state.drive.is_connected().await {
                // Link mode has no authenticated stream. The UI falls back to
                // the public embed or "Open in Google Drive".
                return Err(AppError::NotConnected);
            }
            let id = src
                .external_id
                .clone()
                .ok_or_else(|| AppError::NotFound("No Drive id".into()))?;

            // Ask Drive for a bounded window even when the webview asked for
            // everything, so one request cannot buffer a whole master file.
            let whole_image = still && range_header.is_none();
            let forwarded = match range_header.as_deref() {
                Some(h) if h.starts_with("bytes=") => clamp_range_header(h),
                _ if whole_image => format!("bytes=0-{}", MAX_IMAGE_BYTES - 1),
                _ => format!("bytes=0-{}", MAX_CHUNK - 1),
            };

            let resp = state.drive.media_range(&id, Some(&forwarded)).await?;
            let content_range = resp
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string);
            let content_type = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string)
                .unwrap_or(mime);
            let bytes = resp.bytes().await?.to_vec();

            let mut builder = Response::builder()
                .status(if whole_image { 200 } else { 206 })
                .header("Content-Type", content_type)
                .header("Accept-Ranges", "bytes")
                .header("Content-Length", bytes.len().to_string());
            if let Some(cr) = content_range.filter(|_| !whole_image) {
                builder = builder.header("Content-Range", cr);
            }
            Ok(builder
                .body(bytes)
                .unwrap_or_else(|_| Response::new(Vec::new())))
        }

        _ => Err(AppError::Invalid(
            "This source cannot be streamed directly".into(),
        )),
    }
}

/// Narrows an open-ended client range so the upstream response stays bounded.
fn clamp_range_header(h: &str) -> String {
    let body = h.trim_start_matches("bytes=");
    match body.split_once('-') {
        Some((a, b)) => match (a.trim().parse::<u64>(), b.trim().parse::<u64>()) {
            (Ok(s), Ok(e)) => format!("bytes={s}-{}", e.min(s + MAX_CHUNK - 1)),
            (Ok(s), Err(_)) => format!("bytes={s}-{}", s + MAX_CHUNK - 1),
            _ => format!("bytes=0-{}", MAX_CHUNK - 1),
        },
        None => format!("bytes=0-{}", MAX_CHUNK - 1),
    }
}

pub fn handle<R: tauri::Runtime>(
    ctx: tauri::UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    let range_header = request
        .headers()
        .get("Range")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    let Some((kind, footage_id)) = route_from(&request) else {
        responder.respond(err_response(400, "Bad media request"));
        return;
    };

    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let result = match kind.as_str() {
            "thumb" => serve_thumb(&state, footage_id),
            "media" => serve(&state, footage_id, range_header).await,
            _ => Err(AppError::NotFound("Unknown stash:// route".into())),
        };
        let response = match result {
            Ok(r) => r,
            Err(AppError::NotConnected) => err_response(409, "Not connected to Google Drive"),
            Err(AppError::PermissionRequired) => err_response(403, "No access to this source"),
            Err(AppError::NotFound(m)) => err_response(404, &m),
            Err(e) => {
                log::warn!("stash:// media request failed: {e}");
                err_response(500, "Preview unavailable")
            }
        };
        responder.respond(response);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_platform_urls_route_back_to_kind_and_id() {
        for u in ["stash://thumb/12", "http://stash.localhost/thumb/12?v=3"] {
            let req = Request::builder().uri(u).body(Vec::new()).unwrap();
            assert_eq!(route_from(&req), Some(("thumb".into(), 12)));
        }
    }

    #[test]
    fn absent_range_serves_a_bounded_opening_chunk() {
        let r = parse_range(None, 100_000_000);
        assert_eq!(r.start, 0);
        assert_eq!(r.end, MAX_CHUNK - 1, "must not buffer the whole file");
    }

    #[test]
    fn explicit_ranges_are_honored_and_clamped() {
        let r = parse_range(Some("bytes=1000-2000"), 100_000);
        assert_eq!((r.start, r.end), (1000, 2000));

        // Open-ended request over a huge file stays bounded.
        let r = parse_range(Some("bytes=5000-"), 100_000_000);
        assert_eq!(r.start, 5000);
        assert_eq!(r.end, 5000 + MAX_CHUNK - 1);
    }

    #[test]
    fn suffix_ranges_read_from_the_end() {
        // `bytes=-500` is how a player grabs an MP4 moov atom at the tail.
        let r = parse_range(Some("bytes=-500"), 10_000);
        assert_eq!((r.start, r.end), (9500, 9999));
    }

    #[test]
    fn ranges_past_the_end_are_pulled_back_in() {
        let r = parse_range(Some("bytes=99999-999999"), 1000);
        assert!(r.start < 1000 && r.end < 1000);
        assert!(r.end >= r.start);
    }

    #[test]
    fn malformed_ranges_fall_back_instead_of_panicking() {
        for h in ["bytes=abc", "bytes=", "garbage", "bytes=-", "bytes=1-2-3"] {
            let r = parse_range(Some(h), 10_000);
            assert!(r.end >= r.start, "failed on {h}");
            assert!(r.end < 10_000);
        }
    }

    /// The regression: a catalogued JPEG has no mime in the database, so the
    /// handler has to recognize the still from its name — otherwise `<img>`
    /// gets a 4 MB slice of octet-stream and shows nothing.
    #[test]
    fn a_photo_with_no_stored_mime_is_still_recognized() {
        let name = "/Photos/20260617_011836_690_IMG_0011.JPG";
        assert_eq!(MediaType::from_mime_or_name(None, name), MediaType::Image);
        assert_eq!(ext_mime(name), Some("image/jpeg"));
        assert_eq!(ext_mime("/Clips/a.mov"), None);
    }

    #[test]
    fn forwarded_drive_ranges_stay_bounded() {
        assert_eq!(clamp_range_header("bytes=0-"), format!("bytes=0-{}", MAX_CHUNK - 1));
        assert_eq!(clamp_range_header("bytes=10-20"), "bytes=10-20");
        assert_eq!(
            clamp_range_header("bytes=0-999999999"),
            format!("bytes=0-{}", MAX_CHUNK - 1)
        );
    }
}
