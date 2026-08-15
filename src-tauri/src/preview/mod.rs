//! The preview chain (ARCHITECTURE.md §5.1).
//!
//! Callers ask for "a preview of footage N". They never name a provider, never
//! see a URL, and never get an error for a missing picture — a footage with no
//! obtainable preview simply reports `None` and the UI draws a typed placeholder.

pub mod cache;
pub mod encode;
pub mod providers;
pub mod scheme;

use crate::db::models::{Accessibility, SourceInfo};
use crate::db::repo::{footage as footage_repo, thumbnail as thumb_repo};
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
    format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes))
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

    // Nothing worked. Record *why*, carefully — an anonymous failure is not
    // evidence that a file is gone (§23).
    let accessibility = match &last_error {
        Some(AppError::PermissionRequired) if ctx.drive_connected => Accessibility::PermissionRequired,
        Some(AppError::PermissionRequired) => Accessibility::AuthenticationRequired,
        Some(AppError::NotFound(_)) if ctx.drive_connected => Accessibility::SourceMissing,
        Some(AppError::Network(_)) => Accessibility::Offline,
        Some(AppError::AuthExpired) => Accessibility::AuthenticationRequired,
        _ => Accessibility::Unknown,
    };
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
        let small = encode::portable(raw, edge)?;
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
