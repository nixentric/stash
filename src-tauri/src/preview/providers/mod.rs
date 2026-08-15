//! Preview providers.
//!
//! Each provider answers one question — "can you get me pixels for this source?"
//! — and the service tries them in order. Nothing above this layer knows which
//! one succeeded, which is what keeps `FootageGrid` from ever referring to
//! Google Drive (§31 of the revision).

pub mod best_effort_drive;
pub mod drive_api;
pub mod http_image;
pub mod local_file;

use crate::db::models::SourceInfo;
use crate::error::Result;
use crate::gdrive::client::SharedDrive;
use std::future::Future;
use std::pin::Pin;

pub struct PreviewCtx {
    pub drive: SharedDrive,
    pub http: reqwest::Client,
    pub drive_connected: bool,
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub trait PreviewProvider: Send + Sync {
    fn name(&self) -> &'static str;

    /// Cheap, synchronous check. Providers that cannot possibly serve a source
    /// are skipped without allocating a future or touching the network.
    fn supports(&self, src: &SourceInfo, ctx: &PreviewCtx) -> bool;

    /// Returns the raw image bytes of a preview, in whatever format the source
    /// produced. Re-encoding is the service's job, not the provider's.
    fn fetch<'a>(&'a self, ctx: &'a PreviewCtx, src: &'a SourceInfo) -> BoxFuture<'a, Result<Vec<u8>>>;
}

/// Providers in priority order.
///
/// The authenticated Drive provider always outranks the best-effort one, so a
/// connected user never silently falls back to an undocumented endpoint.
pub fn all() -> Vec<Box<dyn PreviewProvider>> {
    vec![
        Box::new(local_file::LocalFileProvider),
        Box::new(drive_api::DriveApiProvider),
        Box::new(best_effort_drive::BestEffortDriveProvider),
        Box::new(http_image::HttpImageProvider),
    ]
}
