//! ⚠️  QUARANTINE ZONE — undocumented Google endpoint.
//!
//! Anonymous thumbnail retrieval for Drive files shared as "Anyone with the
//! link". This endpoint is **not part of the documented Drive API** and Google
//! may change or remove it without notice.
//!
//! It is isolated here on purpose (§30 of the revision). Deleting this one file
//! degrades link-mode auto-thumbnails to manual ones — "Set Thumbnail", "Paste
//! Thumbnail", drag-and-drop — and breaks nothing else in the application. No
//! other module imports it, and the service treats its failure as ordinary.
//!
//! It never runs when the authenticated provider is available.

use super::{BoxFuture, PreviewCtx, PreviewProvider};
use crate::db::models::SourceInfo;
use crate::error::{AppError, Result};
use std::time::Duration;

/// Requested width.
///
/// Matches the disk cache's longest edge so Quick Look gets a sharp image in
/// link mode too — the portable thumbnail is downscaled from this same fetch,
/// so asking for more costs one request, not two. Google may return something
/// smaller for a given file; that is fine, it is still an image.
const REQUEST_WIDTH: u32 = 1600;

const MAX_BYTES: usize = 8 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(20);

/// Anonymous download address for a file shared as "Anyone with the link".
///
/// Also undocumented, and here for the same reason as the thumbnail endpoint:
/// in link mode there is no token to authenticate with, and refusing to
/// download a file the user can already see in the embed would be an odd kind
/// of principle. The caller must treat an HTML response as "not public" — this
/// URL answers 200 with a sign-in page for anything private.
pub fn public_download_url(file_id: &str, resource_key: Option<&str>) -> String {
    let mut url = format!("https://drive.google.com/uc?export=download&id={file_id}");
    if let Some(key) = resource_key {
        url.push_str(&format!("&resourcekey={key}"));
    }
    url
}

pub struct BestEffortDriveProvider;

impl PreviewProvider for BestEffortDriveProvider {
    fn name(&self) -> &'static str {
        "best_effort_drive_public"
    }

    fn supports(&self, src: &SourceInfo, _ctx: &PreviewCtx) -> bool {
        // Deliberately does *not* check `drive_connected`: the service only
        // reaches this provider after the authenticated one has declined or
        // failed, so it doubles as the fallback for a file the account cannot see.
        src.provider == "google_drive" && src.external_id.is_some()
    }

    fn fetch<'a>(&'a self, ctx: &'a PreviewCtx, src: &'a SourceInfo) -> BoxFuture<'a, Result<Vec<u8>>> {
        Box::pin(async move {
            let id = src
                .external_id
                .as_deref()
                .ok_or_else(|| AppError::Invalid("Source has no Drive id".into()))?;

            let mut url =
                format!("https://drive.google.com/thumbnail?id={id}&sz=w{REQUEST_WIDTH}");
            if let Some(key) = &src.external_key {
                url.push_str(&format!("&resourcekey={key}"));
            }

            let resp = ctx
                .http
                .get(&url)
                .timeout(TIMEOUT)
                .send()
                .await
                .map_err(|_| AppError::Network("Could not reach Google Drive".into()))?;

            if !resp.status().is_success() {
                // A private file answers with a redirect to sign-in or a 40x.
                // That means "you don't have access", never "the file is gone" —
                // concluding otherwise would wrongly flag live footage as
                // missing (§23).
                return Err(AppError::PermissionRequired);
            }

            // The sign-in page is served with HTTP 200, so the content type is
            // the only reliable signal that we actually got an image.
            let is_image = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(|ct| ct.starts_with("image/"))
                .unwrap_or(false);
            if !is_image {
                return Err(AppError::PermissionRequired);
            }

            let bytes = resp.bytes().await?;
            if bytes.is_empty() {
                return Err(AppError::PermissionRequired);
            }
            if bytes.len() > MAX_BYTES {
                return Err(AppError::Other("Preview response was too large".into()));
            }
            Ok(bytes.to_vec())
        })
    }
}
