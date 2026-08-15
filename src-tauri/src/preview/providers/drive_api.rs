//! Authenticated Drive thumbnails — the documented path.

use super::{BoxFuture, PreviewCtx, PreviewProvider};
use crate::db::models::SourceInfo;
use crate::error::{AppError, Result};

/// Thumbnails are small; anything larger is not a thumbnail and is refused.
const MAX_THUMB_BYTES: usize = 8 * 1024 * 1024;

pub struct DriveApiProvider;

impl PreviewProvider for DriveApiProvider {
    fn name(&self) -> &'static str {
        "drive_api"
    }

    fn supports(&self, src: &SourceInfo, ctx: &PreviewCtx) -> bool {
        ctx.drive_connected && src.provider == "google_drive" && src.external_id.is_some()
    }

    fn fetch<'a>(&'a self, ctx: &'a PreviewCtx, src: &'a SourceInfo) -> BoxFuture<'a, Result<Vec<u8>>> {
        Box::pin(async move {
            let id = src
                .external_id
                .as_deref()
                .ok_or_else(|| AppError::Invalid("Source has no Drive id".into()))?;

            let file = ctx.drive.get_file(id).await?;

            if file.trashed {
                return Err(AppError::NotFound("File is in the Drive trash".into()));
            }
            if !file.has_thumbnail {
                // Drive has no rendition for this type. Not an error worth
                // retrying — the user can set a thumbnail by hand.
                return Err(AppError::NotFound(
                    "Google Drive has no thumbnail for this file".into(),
                ));
            }

            let link = file.thumbnail_link.ok_or_else(|| {
                AppError::NotFound("Google Drive returned no thumbnail link".into())
            })?;

            // The link is short-lived (documented as "on the order of hours"), so
            // it is consumed immediately and never stored.
            ctx.drive.fetch_bytes(&link, MAX_THUMB_BYTES).await
        })
    }
}
