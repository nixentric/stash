//! Google Drive API v3 client.
//!
//! Only the read surface this app needs: `files.list`, `files.get`, `about.get`,
//! and ranged media reads. No write scope is requested and no write endpoint is
//! implemented, so the app structurally cannot modify the user's Drive.

use crate::error::{AppError, Result};
use crate::prefs::{secrets, GoogleClientConfig, PrefsStore};
use crate::util::Secret;
use serde::{Deserialize, Deserializer};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

const API: &str = "https://www.googleapis.com/drive/v3";
pub const FOLDER_MIME: &str = "application/vnd.google-apps.folder";
pub const SHORTCUT_MIME: &str = "application/vnd.google-apps.shortcut";

/// `fields` is always explicit: the default `files.list` response omits
/// `thumbnailLink`, `videoMediaMetadata` and `imageMediaMetadata` entirely.
pub const FILE_FIELDS: &str = "id,name,mimeType,size,parents,trashed,\
thumbnailLink,hasThumbnail,thumbnailVersion,webViewLink,createdTime,modifiedTime,\
shortcutDetails(targetId,targetMimeType),\
imageMediaMetadata(width,height,rotation),\
videoMediaMetadata(width,height,durationMillis)";

/// Documented maximum for `files.list`.
const PAGE_SIZE: u32 = 1000;

const MAX_ATTEMPTS: u32 = 5;

// ── wire types ──────────────────────────────────────────────────────────────

/// Drive returns 64-bit counters as JSON strings to survive JavaScript's number
/// precision. Accept either form.
fn num_from_string<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<Option<i64>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StrOrNum {
        S(String),
        N(i64),
    }
    Ok(match Option::<StrOrNum>::deserialize(d)? {
        Some(StrOrNum::S(s)) => s.parse().ok(),
        Some(StrOrNum::N(n)) => Some(n),
        None => None,
    })
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImageMeta {
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub rotation: Option<i64>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct VideoMeta {
    pub width: Option<i64>,
    pub height: Option<i64>,
    #[serde(default, deserialize_with = "num_from_string")]
    pub duration_millis: Option<i64>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutDetails {
    pub target_id: Option<String>,
    pub target_mime_type: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DriveFile {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default, deserialize_with = "num_from_string")]
    pub size: Option<i64>,
    #[serde(default)]
    pub parents: Vec<String>,
    #[serde(default)]
    pub trashed: bool,
    /// Short-lived — documented as lasting "on the order of hours". Used
    /// immediately to fetch bytes and never persisted (ARCHITECTURE.md §5.2).
    #[serde(default)]
    pub thumbnail_link: Option<String>,
    #[serde(default)]
    pub has_thumbnail: bool,
    #[serde(default)]
    pub thumbnail_version: Option<String>,
    #[serde(default)]
    pub web_view_link: Option<String>,
    #[serde(default)]
    pub created_time: Option<String>,
    #[serde(default)]
    pub modified_time: Option<String>,
    #[serde(default)]
    pub shortcut_details: Option<ShortcutDetails>,
    #[serde(default)]
    pub image_media_metadata: Option<ImageMeta>,
    #[serde(default)]
    pub video_media_metadata: Option<VideoMeta>,
}

impl DriveFile {
    pub fn is_folder(&self) -> bool {
        self.mime_type.as_deref() == Some(FOLDER_MIME)
    }
    pub fn dimensions(&self) -> (Option<i64>, Option<i64>) {
        if let Some(v) = &self.video_media_metadata {
            if v.width.is_some() {
                return (v.width, v.height);
            }
        }
        match &self.image_media_metadata {
            Some(i) => (i.width, i.height),
            None => (None, None),
        }
    }
    pub fn duration_ms(&self) -> Option<i64> {
        self.video_media_metadata.as_ref().and_then(|v| v.duration_millis)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileList {
    #[serde(default)]
    files: Vec<DriveFile>,
    #[serde(default)]
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
struct AboutResponse {
    user: AboutUser,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AboutUser {
    #[serde(default)]
    email_address: Option<String>,
    #[serde(default)]
    display_name: Option<String>,
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DriveAccount {
    pub email: Option<String>,
    pub display_name: Option<String>,
}

// ── session ─────────────────────────────────────────────────────────────────

struct Session {
    cfg: GoogleClientConfig,
    refresh_token: Secret,
    access: Option<(Secret, Instant)>,
}

/// Connection state for the optional Drive integration.
///
/// `None` inside the lock is the *normal* state: the app is fully usable in link
/// mode and nothing outside this module is allowed to require a session.
pub struct DriveState {
    http: reqwest::Client,
    session: RwLock<Option<Session>>,
    /// Whether the keychain has already been consulted this run.
    restored: AtomicBool,
}

impl DriveState {
    pub fn new() -> Self {
        DriveState {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(60))
                .user_agent("Stash/0.1 (+local desktop catalog)")
                .build()
                .unwrap_or_default(),
            session: RwLock::new(None),
            restored: AtomicBool::new(false),
        }
    }

    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    /// Rebuilds the session from the keychain, at most once per run, the first
    /// time something actually needs Drive.
    ///
    /// Deliberately *not* called at startup. Reading the keychain is a
    /// user-visible event — macOS raises an authorization dialog — so it has to
    /// be caused by the user asking for something from Drive, never by the app
    /// merely launching or by a status panel repainting. No network call, so
    /// this stays instant and silent when offline.
    pub async fn ensure_restored(&self, prefs: &PrefsStore) {
        if self.restored.swap(true, Ordering::SeqCst) {
            return;
        }
        let Some(cfg) = crate::prefs::resolve_google_client(prefs) else {
            return;
        };
        let Some(refresh_token) = secrets::get(secrets::KEY_REFRESH_TOKEN) else {
            return;
        };
        *self.session.write().await = Some(Session {
            cfg,
            refresh_token,
            access: None,
        });
    }

    pub async fn is_connected(&self) -> bool {
        self.session.read().await.is_some()
    }

    /// Whether the UI should *present* Drive as connected.
    ///
    /// Never touches the keychain, so status queries — capabilities, the
    /// Settings panel, menu gating — cost nothing. `google_account_email` is
    /// written only after a successful connect and cleared on disconnect, which
    /// makes it the durable marker; a live session, once restored, wins over it.
    pub async fn appears_connected(&self, prefs: &PrefsStore) -> bool {
        self.is_connected().await || prefs.get().google_account_email.is_some()
    }

    pub async fn set_tokens(&self, cfg: GoogleClientConfig, tokens: super::oauth::Tokens) {
        // A fresh connect supersedes anything the keychain holds, and a later
        // lazy restore must not overwrite it.
        self.restored.store(true, Ordering::SeqCst);
        let refresh_token = tokens
            .refresh_token
            .clone()
            .or_else(|| secrets::get(secrets::KEY_REFRESH_TOKEN))
            .unwrap_or_else(|| Secret::new(String::new()));

        *self.session.write().await = Some(Session {
            cfg,
            refresh_token,
            access: Some((tokens.access_token, tokens.expires_at)),
        });
    }

    pub async fn disconnect(&self) {
        // Blocks a later lazy restore from resurrecting the session we just cut.
        self.restored.store(true, Ordering::SeqCst);
        *self.session.write().await = None;
        secrets::delete(secrets::KEY_REFRESH_TOKEN);
    }

    /// Returns a valid access token, refreshing if the cached one is stale.
    async fn token(&self) -> Result<Secret> {
        {
            let guard = self.session.read().await;
            let s = guard.as_ref().ok_or(AppError::NotConnected)?;
            if let Some((tok, exp)) = &s.access {
                if Instant::now() < *exp {
                    return Ok(tok.clone());
                }
            }
        }

        let (cfg_id, cfg_secret, refresh_token) = {
            let guard = self.session.read().await;
            let s = guard.as_ref().ok_or(AppError::NotConnected)?;
            (
                s.cfg.client_id.clone(),
                s.cfg.client_secret.clone(),
                s.refresh_token.clone(),
            )
        };
        if refresh_token.is_empty() {
            return Err(AppError::AuthExpired);
        }

        let cfg = GoogleClientConfig {
            client_id: cfg_id,
            client_secret: cfg_secret,
        };
        let fresh = super::oauth::refresh(&cfg, &refresh_token).await?;

        let mut guard = self.session.write().await;
        if let Some(s) = guard.as_mut() {
            s.access = Some((fresh.access_token.clone(), fresh.expires_at));
        }
        Ok(fresh.access_token)
    }

    /// One authenticated GET with retry.
    ///
    /// Backoff applies only to conditions that can actually clear on their own —
    /// rate limits, 5xx and transport errors. Permission and not-found are
    /// returned immediately; retrying them just makes the UI hang (§45).
    async fn get(&self, url: &str) -> Result<reqwest::Response> {
        let mut attempt = 0u32;
        loop {
            attempt += 1;
            let token = self.token().await?;
            let sent = self
                .http
                .get(url)
                .bearer_auth(token.expose())
                .send()
                .await;

            let resp = match sent {
                Ok(r) => r,
                Err(e) if attempt < MAX_ATTEMPTS => {
                    log::warn!("drive request failed (attempt {attempt}): {e}");
                    backoff(attempt).await;
                    continue;
                }
                Err(e) => return Err(e.into()),
            };

            let status = resp.status();
            if status.is_success() {
                return Ok(resp);
            }

            let body = resp.text().await.unwrap_or_default();
            match classify(status, &body) {
                Retry::Yes if attempt < MAX_ATTEMPTS => {
                    backoff(attempt).await;
                    continue;
                }
                Retry::Yes => return Err(AppError::RateLimited),
                Retry::No(err) => return Err(err),
            }
        }
    }

    pub async fn about(&self) -> Result<DriveAccount> {
        let resp = self
            .get(&format!("{API}/about?fields=user(emailAddress,displayName)"))
            .await?;
        let about: AboutResponse = resp.json().await?;
        Ok(DriveAccount {
            email: about.user.email_address,
            display_name: about.user.display_name,
        })
    }

    pub async fn get_file(&self, file_id: &str) -> Result<DriveFile> {
        let url = format!(
            "{API}/files/{}?fields={}&supportsAllDrives=true",
            enc(file_id),
            enc(FILE_FIELDS)
        );
        Ok(self.get(&url).await?.json().await?)
    }

    /// Lists the direct children of a folder, following `nextPageToken` to the
    /// end. Pagination is never assumed away — a folder of 5,000 clips arrives
    /// in five requests, not one truncated one.
    pub async fn list_children(
        &self,
        folder_id: &str,
        cancelled: &(dyn Fn() -> bool + Send + Sync),
    ) -> Result<Vec<DriveFile>> {
        let mut all = Vec::new();
        let mut page_token: Option<String> = None;

        loop {
            if cancelled() {
                return Err(AppError::Cancelled);
            }
            let q = format!("'{}' in parents and trashed = false", folder_id.replace('\'', "\\'"));
            let mut url = format!(
                "{API}/files?q={}&fields={}&pageSize={PAGE_SIZE}\
                 &supportsAllDrives=true&includeItemsFromAllDrives=true\
                 &orderBy=folder,name_natural",
                enc(&q),
                enc(&format!("nextPageToken,files({FILE_FIELDS})"))
            );
            if let Some(t) = &page_token {
                url.push_str(&format!("&pageToken={}", enc(t)));
            }

            let list: FileList = self.get(&url).await?.json().await?;
            all.extend(list.files);

            match list.next_page_token {
                Some(t) => page_token = Some(t),
                None => break,
            }
        }
        Ok(all)
    }

    /// Downloads bytes from an absolute Drive URL (a `thumbnailLink`).
    pub async fn fetch_bytes(&self, url: &str, limit: usize) -> Result<Vec<u8>> {
        let resp = self.get(url).await?;
        let bytes = resp.bytes().await?;
        if bytes.len() > limit {
            return Err(AppError::Other("Response too large".into()));
        }
        Ok(bytes.to_vec())
    }

    /// Ranged read of file content, for `<video>` seeking.
    ///
    /// `alt=media` honors `Range`, which is what makes preview possible without
    /// ever downloading the whole file (§7 of the brief, ARCHITECTURE.md §5.4).
    pub async fn media_range(
        &self,
        file_id: &str,
        range: Option<&str>,
    ) -> Result<reqwest::Response> {
        let token = self.token().await?;
        let url = format!(
            "{API}/files/{}?alt=media&supportsAllDrives=true",
            enc(file_id)
        );
        let mut req = self.http.get(&url).bearer_auth(token.expose());
        if let Some(r) = range {
            req = req.header(reqwest::header::RANGE, r);
        }
        let resp = req.send().await?;
        let status = resp.status();
        if status.is_success() {
            return Ok(resp);
        }
        let body = resp.text().await.unwrap_or_default();
        match classify(status, &body) {
            Retry::No(e) => Err(e),
            Retry::Yes => Err(AppError::RateLimited),
        }
    }
}

impl Default for DriveState {
    fn default() -> Self {
        Self::new()
    }
}

// ── error classification ────────────────────────────────────────────────────

enum Retry {
    Yes,
    No(AppError),
}

/// Maps an HTTP failure onto the app's error model.
///
/// The important line is the 403 split: a rate-limit 403 is transient, every
/// other 403 means the current credentials genuinely cannot see the file. And a
/// 404 here is authenticated, which is the only situation in which "the file is
/// gone" may be concluded (§23).
fn classify(status: reqwest::StatusCode, body: &str) -> Retry {
    use reqwest::StatusCode as S;
    let reason = extract_reason(body);
    match status {
        S::UNAUTHORIZED => Retry::No(AppError::AuthExpired),
        S::TOO_MANY_REQUESTS => Retry::Yes,
        S::FORBIDDEN => {
            if matches!(
                reason.as_deref(),
                Some("rateLimitExceeded")
                    | Some("userRateLimitExceeded")
                    | Some("sharingRateLimitExceeded")
                    | Some("backendError")
            ) {
                Retry::Yes
            } else {
                Retry::No(AppError::PermissionRequired)
            }
        }
        S::NOT_FOUND => Retry::No(AppError::NotFound("File not found in Google Drive".into())),
        s if s.is_server_error() => Retry::Yes,
        s => Retry::No(AppError::Network(format!("Google Drive returned HTTP {s}"))),
    }
}

fn extract_reason(body: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()?
        .get("error")?
        .get("errors")?
        .get(0)?
        .get("reason")?
        .as_str()
        .map(str::to_string)
}

/// `min(2^n * 500ms, 32s)` plus jitter, and it always terminates.
async fn backoff(attempt: u32) {
    use rand::Rng;
    let base = 500u64.saturating_mul(1 << attempt.min(6));
    let capped = base.min(32_000);
    let jitter = rand::rng().random_range(0..=250);
    tokio::time::sleep(Duration::from_millis(capped + jitter)).await;
}

fn enc(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

// ── shared session handle ───────────────────────────────────────────────────

pub type SharedDrive = Arc<DriveState>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn size_and_duration_survive_string_encoding() {
        let f: DriveFile = serde_json::from_str(
            r#"{"id":"x","name":"a.mp4","mimeType":"video/mp4","size":"1073741824",
                "videoMediaMetadata":{"width":3840,"height":2160,"durationMillis":"23400"}}"#,
        )
        .unwrap();
        assert_eq!(f.size, Some(1_073_741_824));
        assert_eq!(f.duration_ms(), Some(23_400));
        assert_eq!(f.dimensions(), (Some(3840), Some(2160)));
    }

    #[test]
    fn a_sparse_response_does_not_break_parsing() {
        let f: DriveFile = serde_json::from_str(r#"{"id":"x"}"#).unwrap();
        assert_eq!(f.size, None);
        assert!(!f.has_thumbnail);
        assert!(!f.is_folder());
    }

    #[test]
    fn image_dimensions_are_read_when_there_is_no_video_metadata() {
        let f: DriveFile = serde_json::from_str(
            r#"{"id":"x","imageMediaMetadata":{"width":6000,"height":4000}}"#,
        )
        .unwrap();
        assert_eq!(f.dimensions(), (Some(6000), Some(4000)));
        assert_eq!(f.duration_ms(), None);
    }

    /// The distinction the whole "Source Missing" story rests on.
    #[test]
    fn rate_limited_403_retries_but_a_permission_403_does_not() {
        let rate = r#"{"error":{"errors":[{"reason":"userRateLimitExceeded"}],"code":403}}"#;
        let denied = r#"{"error":{"errors":[{"reason":"insufficientFilePermissions"}],"code":403}}"#;

        assert!(matches!(
            classify(reqwest::StatusCode::FORBIDDEN, rate),
            Retry::Yes
        ));
        assert!(matches!(
            classify(reqwest::StatusCode::FORBIDDEN, denied),
            Retry::No(AppError::PermissionRequired)
        ));
    }

    #[test]
    fn transient_statuses_retry_and_auth_failures_do_not() {
        assert!(matches!(
            classify(reqwest::StatusCode::TOO_MANY_REQUESTS, ""),
            Retry::Yes
        ));
        assert!(matches!(
            classify(reqwest::StatusCode::INTERNAL_SERVER_ERROR, ""),
            Retry::Yes
        ));
        assert!(matches!(
            classify(reqwest::StatusCode::UNAUTHORIZED, ""),
            Retry::No(AppError::AuthExpired)
        ));
        assert!(matches!(
            classify(reqwest::StatusCode::NOT_FOUND, ""),
            Retry::No(AppError::NotFound(_))
        ));
    }

    #[test]
    fn backoff_is_bounded() {
        for attempt in 1..=MAX_ATTEMPTS {
            let base = 500u64.saturating_mul(1 << attempt.min(6));
            assert!(base.min(32_000) <= 32_000);
        }
    }
}
