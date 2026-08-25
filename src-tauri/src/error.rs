use serde::Serialize;

/// Every failure that can cross the IPC boundary.
///
/// The `kind` is what the UI branches on; `message` is what it shows. `retryable`
/// exists so the UI can offer "Try again" without knowing anything about HTTP
/// status codes or SQLite result codes.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("No library is open")]
    NoLibraryOpen,

    #[error("{0} is not a Stash library")]
    NotALibrary(String),

    #[error("This library is not compatible with Stash {app}. The file uses library format v{found}; this version reads up to v{supported}. Update to the latest release, or open it with the version of Stash that last saved it.")]
    LibraryTooNew {
        found: u32,
        supported: u32,
        /// The running app version, not the schema number — it is what the user
        /// has to act on, and what they can report.
        app: &'static str,
    },

    #[error("Database error: {0}")]
    Database(String),

    #[error("Migration failed: {0}")]
    Migration(String),

    #[error("{0}")]
    NotFound(String),

    #[error("{0}")]
    Invalid(String),

    /// The source answered and is exactly where it should be — there is just no
    /// picture to be had from it. A RAW in Drive, a video on a machine without
    /// ffmpeg, a URL serving HTML. Kept apart from `NotFound` because the two
    /// used to share it, and "no preview" read as "deleted" (§23).
    #[error("{0}")]
    NoPreview(String),

    #[error("Google Drive is not connected")]
    NotConnected,

    #[error("Google Drive authorization has expired. Reconnect in Settings.")]
    AuthExpired,

    #[error("You don't currently have access to this source")]
    PermissionRequired,

    #[error("Google Drive is rate limiting requests. Try again shortly.")]
    RateLimited,

    #[error("Network error: {0}")]
    Network(String),

    #[error("Cancelled")]
    Cancelled,

    #[error("{0}")]
    Io(String),

    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn kind(&self) -> &'static str {
        use AppError::*;
        match self {
            NoLibraryOpen => "no_library_open",
            NotALibrary(_) => "not_a_library",
            LibraryTooNew { .. } => "library_too_new",
            Database(_) => "database",
            Migration(_) => "migration",
            NotFound(_) => "not_found",
            Invalid(_) => "invalid",
            NoPreview(_) => "no_preview",
            NotConnected => "not_connected",
            AuthExpired => "auth_expired",
            PermissionRequired => "permission_required",
            RateLimited => "rate_limited",
            Network(_) => "network",
            Cancelled => "cancelled",
            Io(_) => "io",
            Other(_) => "other",
        }
    }

    pub fn retryable(&self) -> bool {
        matches!(self, AppError::Network(_) | AppError::RateLimited)
    }
}

#[derive(Serialize)]
pub struct IpcError {
    pub kind: &'static str,
    pub message: String,
    pub retryable: bool,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        IpcError {
            kind: self.kind(),
            message: self.to_string(),
            retryable: self.retryable(),
        }
        .serialize(s)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound("Record not found".into()),
            other => AppError::Database(other.to_string()),
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        // Deliberately does not use `{:?}` — a reqwest error's debug output can
        // include the full URL, and Drive URLs may carry access tokens.
        if e.is_timeout() || e.is_connect() {
            AppError::Network("Could not reach the network".into())
        } else {
            AppError::Network(e.without_url().to_string())
        }
    }
}

impl From<image::ImageError> for AppError {
    fn from(e: image::ImageError) -> Self {
        AppError::Other(format!("Image decode failed: {e}"))
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
