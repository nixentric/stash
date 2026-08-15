//! Previews for files on this machine.

use super::{BoxFuture, PreviewCtx, PreviewProvider};
use crate::db::models::SourceInfo;
use crate::error::{AppError, Result};
use std::path::Path;

pub struct LocalFileProvider;

impl PreviewProvider for LocalFileProvider {
    fn name(&self) -> &'static str {
        "local_file"
    }

    fn supports(&self, src: &SourceInfo, _ctx: &PreviewCtx) -> bool {
        src.provider == "local" && src.local_path.is_some()
    }

    fn fetch<'a>(&'a self, _ctx: &'a PreviewCtx, src: &'a SourceInfo) -> BoxFuture<'a, Result<Vec<u8>>> {
        Box::pin(async move {
            let path = src
                .local_path
                .as_deref()
                .ok_or_else(|| AppError::Invalid("Source has no path".into()))?;
            let path = Path::new(path);

            if !path.exists() {
                return Err(AppError::NotFound("File is no longer at that path".into()));
            }

            let is_video = src
                .mime_type
                .as_deref()
                .map(|m| m.starts_with("video/"))
                .unwrap_or_else(|| {
                    crate::db::models::MediaType::from_mime_or_name(None, &path.to_string_lossy())
                        == crate::db::models::MediaType::Video
                });

            if is_video {
                return grab_video_frame(path);
            }

            let bytes = tokio::fs::read(path).await?;
            if bytes.len() > super::super::encode::MAX_SOURCE_BYTES {
                return Err(AppError::Other("File is too large to preview".into()));
            }
            Ok(bytes)
        })
    }
}

/// Extracts a still from a local video using `ffmpeg`, if the user happens to
/// have it.
///
/// Deliberately *not* bundled: shipping an ffmpeg build would add tens of
/// megabytes and a licensing question to an app whose primary sources live in
/// the cloud. When it is absent, the footage falls through to "Set Thumbnail",
/// which is a first-class path anyway.
fn grab_video_frame(path: &Path) -> Result<Vec<u8>> {
    use std::process::{Command, Stdio};

    let out = Command::new("ffmpeg")
        .args(["-v", "error", "-ss", "1", "-i"])
        .arg(path)
        .args(["-frames:v", "1", "-f", "image2", "-vcodec", "mjpeg", "-"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map_err(|_| {
            AppError::NotFound("Install ffmpeg to generate video thumbnails, or set one manually".into())
        })?;

    if !out.status.success() || out.stdout.is_empty() {
        return Err(AppError::NotFound("Could not read a frame from this video".into()));
    }
    Ok(out.stdout)
}
