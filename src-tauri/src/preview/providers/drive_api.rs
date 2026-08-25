//! Authenticated Drive thumbnails — the documented path.

use super::{BoxFuture, PreviewCtx, PreviewProvider};
use crate::db::models::SourceInfo;
use crate::error::{AppError, Result};

/// Thumbnails are small; anything larger is not a thumbnail and is refused.
const MAX_THUMB_BYTES: usize = 8 * 1024 * 1024;

/// What we ask Drive for, on the longest edge.
///
/// The link Drive hands back renders at 220 px — enough to label a row, blurry
/// the moment it is the picture you are looking at. 960 is a downscale for the
/// portable tier rather than an upscale, and gives Quick Look something worth
/// caching, without turning a library-wide refresh into a download of the
/// originals.
const REQUEST_EDGE: u32 = 960;

/// Re-points a `thumbnailLink` at a different rendition.
///
/// The size lives in a trailing `=s220` parameter, and only that shape is
/// rewritten — Docs-style links carry other parameters there and are left alone
/// rather than guessed at.
fn at_size(link: &str, edge: u32) -> String {
    match link.rsplit_once('=') {
        Some((head, tail))
            if tail.starts_with('s')
                && tail.len() > 1
                && tail[1..].bytes().all(|b| b.is_ascii_digit()) =>
        {
            format!("{head}=s{edge}")
        }
        _ => link.to_string(),
    }
}

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
                return Err(AppError::NoPreview(
                    "Google Drive has no thumbnail for this file".into(),
                ));
            }

            let link = file.thumbnail_link.ok_or_else(|| {
                AppError::NoPreview("Google Drive returned no thumbnail link".into())
            })?;

            // The link is short-lived (documented as "on the order of hours"), so
            // it is consumed immediately and never stored.
            ctx.drive
                .fetch_bytes(&at_size(&link, REQUEST_EDGE), MAX_THUMB_BYTES)
                .await
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_size_parameter_is_replaced_not_appended() {
        assert_eq!(
            at_size("https://lh3.googleusercontent.com/drive-storage/AbC=s220", 960),
            "https://lh3.googleusercontent.com/drive-storage/AbC=s960",
        );
    }

    #[test]
    fn links_without_a_size_parameter_are_left_alone() {
        // Docs renditions carry an opaque `=` parameter; rewriting it 404s.
        let docs = "https://docs.google.com/feeds/vt?gd=true&id=abc&s=AMedNnoZ";
        assert_eq!(at_size(docs, 960), docs);
        let bare = "https://example.com/thumb.jpg";
        assert_eq!(at_size(bare, 960), bare);
    }
}
