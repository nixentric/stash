//! The preview chain (ARCHITECTURE.md §5.1).
//!
//! Callers ask for "a preview of footage N". They never name a provider, never
//! see a URL, and never get an error for a missing picture — a footage with no
//! obtainable preview simply reports `None` and the UI draws a typed placeholder.

pub mod cache;
pub mod heic;
pub mod downloads;
pub mod encode;
pub mod providers;
pub mod scheme;

use crate::db::models::{Accessibility, SourceInfo};
use crate::db::repo::{brand as brand_repo, footage as footage_repo, thumbnail as thumb_repo};
use crate::error::{AppError, Result};
use crate::state::AppState;
use base64::{engine::general_purpose::STANDARD, Engine};
use providers::PreviewCtx;

/// Stable cache key for a source, independent of which library it lives in.
fn identity(src: &SourceInfo) -> Option<String> {
    src.external_id
        .clone()
        .or_else(|| src.local_path.clone())
        .or_else(|| src.original_url.clone())
}

fn to_data_url(bytes: &[u8]) -> String {
    // Thumbnails are JPEG unless the source had transparency worth keeping, in
    // which case they are PNG. Labelling those as JPEG left the webview to guess.
    let mime = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else {
        "image/jpeg"
    };
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}

/// Reads an existing preview without touching the network.
///
/// `large` prefers the disk cache (crisp, for Quick Look) and falls back to the
/// portable blob, which is what makes a freshly-copied `.footagedb` show
/// pictures immediately even with nothing cached and no account connected (§9).
pub fn read(state: &AppState, footage_id: i64, large: bool) -> Result<Option<String>> {
    let (portable, src) = state.with_library(|lib| {
        Ok((
            thumb_repo::get(&lib.conn, footage_id)?,
            footage_repo::get_source(&lib.conn, footage_id).ok(),
        ))
    })?;

    if large {
        if let Some(bytes) = src
            .as_ref()
            .and_then(|s| identity(s).map(|id| (s.provider.clone(), id)))
            .and_then(|(p, id)| state.cache.get(&p, &id))
        {
            return Ok(Some(to_data_url(&bytes)));
        }
    }

    Ok(portable.as_deref().map(to_data_url))
}

/// What a provider chain's last failure says about the source itself.
///
/// The distinction everything else rests on: "I could not make a picture" is
/// not "the file is gone". A RAW in Drive, a video on a machine without ffmpeg,
/// a URL serving HTML — all three files are exactly where they were, and
/// flagging them missing would offer to delete a live archive. Those arrive as
/// `NoPreview` and conclude nothing.
///
/// `NotFound` is kept for the things that are evidence, and who may present it
/// depends on the provider. A path either is on disk or is not, so the
/// filesystem answers for itself. Drive does not: signed out, a private file
/// answers exactly the way a deleted one does, so only a connected account's
/// 404 counts. An HTTP source speaks for itself again — the provider only
/// raises `NotFound` there for a 404 or a 410.
fn conclude(err: Option<&AppError>, provider: &str, drive_connected: bool) -> Accessibility {
    let may_say_gone = match provider {
        "google_drive" => drive_connected,
        _ => true,
    };
    match err {
        Some(AppError::PermissionRequired) if drive_connected => Accessibility::PermissionRequired,
        Some(AppError::PermissionRequired) => Accessibility::AuthenticationRequired,
        Some(AppError::NotFound(_)) if may_say_gone => Accessibility::SourceMissing,
        Some(AppError::Network(_)) => Accessibility::Offline,
        Some(AppError::AuthExpired) => Accessibility::AuthenticationRequired,
        // Including `NoPreview`, and including a Drive 404 nobody was signed in
        // for: something is wrong, and it is not something we can name.
        _ => Accessibility::Unknown,
    }
}

/// Runs the provider chain and stores whatever it finds.
///
/// Returns `false` when no provider could produce pixels — an ordinary outcome,
/// not a failure. The source's accessibility state is updated as a side effect
/// so the inspector can explain *why* there is no picture.
pub async fn refresh(state: &AppState, footage_id: i64, force: bool) -> Result<bool> {
    // Already tried and failed this session. Retrying on every scroll would burn
    // the user's API quota to re-learn the same answer.
    if !force && state.preview_failed_before(footage_id) {
        return Ok(false);
    }

    let (src, pinned, already_have) = state.with_library(|lib| {
        Ok((
            footage_repo::get_source(&lib.conn, footage_id)?,
            thumb_repo::is_pinned(&lib.conn, footage_id)?,
            thumb_repo::exists(&lib.conn, footage_id)?,
        ))
    })?;

    // A thumbnail the user chose by hand is never replaced by an automated
    // refresh — that would be silent data loss (§7 of the revision).
    if pinned {
        return Ok(true);
    }
    if already_have && !force {
        return Ok(true);
    }

    state.drive.ensure_restored(&state.prefs).await;
    let ctx = PreviewCtx {
        drive: state.drive.clone(),
        http: state.http.clone(),
        drive_connected: state.drive.is_connected().await,
    };

    let mut last_error: Option<AppError> = None;

    for provider in providers::all() {
        if !provider.supports(&src, &ctx) {
            continue;
        }
        match provider.fetch(&ctx, &src).await {
            Ok(bytes) => {
                store(state, footage_id, &src, &bytes, thumb_repo::Origin::Provider)?;
                state.clear_preview_failure(footage_id);
                state.with_library(|lib| {
                    footage_repo::set_accessibility(
                        &lib.conn,
                        footage_id,
                        Accessibility::PreviewAvailable,
                    )
                })?;
                return Ok(true);
            }
            Err(e) => {
                log::debug!("preview provider {} declined: {e}", provider.name());
                last_error = Some(e);
            }
        }
    }

    // Nothing worked. Record *why*, carefully (§23).
    let accessibility = conclude(last_error.as_ref(), &src.provider, ctx.drive_connected);
    state.with_library(|lib| footage_repo::set_accessibility(&lib.conn, footage_id, accessibility))?;
    state.note_preview_failure(footage_id);

    Ok(false)
}

/// Encodes and writes both tiers for one footage.
pub fn store(
    state: &AppState,
    footage_id: i64,
    src: &SourceInfo,
    raw: &[u8],
    origin: thumb_repo::Origin,
) -> Result<()> {
    let max_edge = state.prefs.get().portable_thumbnail_size.max_edge();

    if let Some(edge) = max_edge {
        let keep_alpha =
            state.with_library(|lib| brand_repo::is_logo_asset(&lib.conn, footage_id))?;
        let small = encode::portable(raw, edge, keep_alpha)?;
        state.with_library(|lib| {
            thumb_repo::put(
                &lib.conn,
                footage_id,
                &small.bytes,
                small.width,
                small.height,
                origin,
            )
        })?;
    }

    // The large tier is best-effort: a failure here costs sharpness in Quick
    // Look, never the ability to see the library.
    if let Some(id) = identity(src) {
        match encode::cached(raw) {
            Ok(big) => {
                if let Err(e) = state.cache.put(&src.provider, &id, &big.bytes) {
                    log::warn!("could not write preview cache: {e}");
                }
            }
            Err(e) => log::debug!("large preview encode skipped: {e}"),
        }
    }
    Ok(())
}

/// Applies a user-supplied image (file picker, clipboard paste, or drag-drop).
///
/// Stored `pinned`, so sync will not overwrite it.
pub fn set_custom(state: &AppState, footage_id: i64, raw: &[u8]) -> Result<()> {
    let src = state.with_library(|lib| footage_repo::get_source(&lib.conn, footage_id))?;
    state.clear_preview_failure(footage_id);
    store(state, footage_id, &src, raw, thumb_repo::Origin::Custom)
}

pub fn clear_custom(state: &AppState, footage_id: i64) -> Result<()> {
    let src = state.with_library(|lib| {
        thumb_repo::clear(&lib.conn, footage_id)?;
        footage_repo::get_source(&lib.conn, footage_id)
    })?;
    if let Some(id) = identity(&src) {
        state.cache.remove(&src.provider, &id);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_that_cannot_be_rendered_is_not_a_file_that_is_gone() {
        // ffmpeg absent, a RAW in Drive, a URL serving HTML. Every one of these
        // is sitting exactly where it belongs.
        let no_preview = AppError::NoPreview("no rendition".into());
        for provider in ["local", "google_drive", "url"] {
            for connected in [true, false] {
                assert_eq!(
                    conclude(Some(&no_preview), provider, connected),
                    Accessibility::Unknown,
                    "{provider}, connected={connected}",
                );
            }
        }
    }

    #[test]
    fn only_a_source_that_can_speak_for_itself_may_be_called_gone() {
        let gone = AppError::NotFound("not there".into());

        // The filesystem needs no account to be believed.
        assert_eq!(conclude(Some(&gone), "local", false), Accessibility::SourceMissing);
        // Nor does an HTTP 404 — the provider only raises this for 404 and 410.
        assert_eq!(conclude(Some(&gone), "url", false), Accessibility::SourceMissing);

        // Drive signed out cannot tell deleted from private, so it says nothing.
        assert_eq!(conclude(Some(&gone), "google_drive", false), Accessibility::Unknown);
        assert_eq!(
            conclude(Some(&gone), "google_drive", true),
            Accessibility::SourceMissing,
        );
    }

    #[test]
    fn a_refusal_reads_as_no_access_only_when_there_is_an_account_to_refuse() {
        let denied = AppError::PermissionRequired;
        assert_eq!(
            conclude(Some(&denied), "google_drive", true),
            Accessibility::PermissionRequired,
        );
        // Signed out, "no access" is just "nobody asked" — the fix is to connect.
        assert_eq!(
            conclude(Some(&denied), "google_drive", false),
            Accessibility::AuthenticationRequired,
        );
    }
}
