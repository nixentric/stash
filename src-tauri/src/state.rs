use crate::db::Library;
use crate::error::{AppError, Result};
use crate::gdrive::client::{DriveState, SharedDrive};
use crate::jobs::JobRegistry;
use crate::prefs::PrefsStore;
use crate::preview::cache::PreviewCache;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub struct AppState {
    /// `None` until a library is opened. The welcome screen is the app's real
    /// starting state, not an error condition.
    library: Mutex<Option<Library>>,
    pub prefs: PrefsStore,
    pub drive: SharedDrive,
    pub cache: PreviewCache,
    pub http: reqwest::Client,
    pub jobs: JobRegistry,
    /// Footage whose preview lookup already failed this session.
    ///
    /// Without this, a card that can never resolve a preview — a private Drive
    /// file, a dead link — re-hits the network every single time it scrolls back
    /// into the viewport, because the component remounts and finds nothing
    /// stored. Scrolling a library of private files would otherwise generate
    /// unbounded repeat requests against the user's API quota.
    ///
    /// In memory only, and deliberately so: a restart, an explicit refresh, or
    /// connecting an account are all reasons the answer might genuinely change.
    preview_failures: Mutex<HashSet<i64>>,
}

impl AppState {
    pub fn new(config_dir: PathBuf, cache_dir: PathBuf) -> Self {
        AppState {
            library: Mutex::new(None),
            prefs: PrefsStore::load(&config_dir),
            drive: Arc::new(DriveState::new()),
            cache: PreviewCache::new(cache_dir.join("previews")),
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .user_agent("Stash/0.1 (+local desktop catalog)")
                .build()
                .unwrap_or_default(),
            jobs: JobRegistry::default(),
            preview_failures: Mutex::new(HashSet::new()),
        }
    }

    pub fn preview_failed_before(&self, footage_id: i64) -> bool {
        self.preview_failures
            .lock()
            .map(|s| s.contains(&footage_id))
            .unwrap_or(false)
    }

    pub fn note_preview_failure(&self, footage_id: i64) {
        if let Ok(mut s) = self.preview_failures.lock() {
            s.insert(footage_id);
        }
    }

    pub fn clear_preview_failure(&self, footage_id: i64) {
        if let Ok(mut s) = self.preview_failures.lock() {
            s.remove(&footage_id);
        }
    }

    /// Called when the answer might have changed for everything at once —
    /// connecting or disconnecting an account, or switching libraries.
    pub fn reset_preview_failures(&self) {
        if let Ok(mut s) = self.preview_failures.lock() {
            s.clear();
        }
    }

    /// Runs `f` against the open library.
    ///
    /// The lock is a plain `std::sync::Mutex` and the closure is synchronous by
    /// construction — that is deliberate. It makes "hold the database lock
    /// across an await" impossible to write, which is the deadlock this app
    /// would otherwise hit during long Drive imports.
    pub fn with_library<T>(&self, f: impl FnOnce(&Library) -> Result<T>) -> Result<T> {
        let guard = self.library.lock().map_err(|_| {
            AppError::Other("The library is in an inconsistent state; reopen it".into())
        })?;
        let lib = guard.as_ref().ok_or(AppError::NoLibraryOpen)?;
        f(lib)
    }

    pub fn with_library_mut<T>(&self, f: impl FnOnce(&mut Library) -> Result<T>) -> Result<T> {
        let mut guard = self.library.lock().map_err(|_| {
            AppError::Other("The library is in an inconsistent state; reopen it".into())
        })?;
        let lib = guard.as_mut().ok_or(AppError::NoLibraryOpen)?;
        f(lib)
    }

    pub fn set_library(&self, lib: Option<Library>) -> Result<()> {
        let mut guard = self
            .library
            .lock()
            .map_err(|_| AppError::Other("Could not switch libraries".into()))?;
        *guard = lib;
        // Footage ids are per-library, so a stale set would suppress previews
        // for unrelated records in the library being opened.
        drop(guard);
        self.reset_preview_failures();
        Ok(())
    }

    pub fn is_open(&self) -> bool {
        self.library.lock().map(|g| g.is_some()).unwrap_or(false)
    }

    pub fn library_path(&self) -> Option<PathBuf> {
        self.library
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|l| l.path.clone()))
    }
}
