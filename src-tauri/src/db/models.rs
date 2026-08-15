use serde::{Deserialize, Serialize};

// ── enums ───────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum MediaType {
    Image,
    Video,
    Audio,
    Other,
    Unknown,
}

impl MediaType {
    pub fn as_str(self) -> &'static str {
        match self {
            MediaType::Image => "image",
            MediaType::Video => "video",
            MediaType::Audio => "audio",
            MediaType::Other => "other",
            MediaType::Unknown => "unknown",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "image" => MediaType::Image,
            "video" => MediaType::Video,
            "audio" => MediaType::Audio,
            "other" => MediaType::Other,
            _ => MediaType::Unknown,
        }
    }

    /// MIME first, extension only as a fallback (§5: do not trust extensions).
    pub fn from_mime_or_name(mime: Option<&str>, name: &str) -> Self {
        if let Some(m) = mime {
            let m = m.to_ascii_lowercase();
            if m.starts_with("image/") {
                return MediaType::Image;
            }
            if m.starts_with("video/") {
                return MediaType::Video;
            }
            if m.starts_with("audio/") {
                return MediaType::Audio;
            }
            // Generic types carry no information; fall through to the extension.
            if !matches!(m.as_str(), "application/octet-stream" | "binary/octet-stream" | "")
            {
                return MediaType::Other;
            }
        }
        let ext = name
            .rsplit('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        match ext.as_str() {
            "jpg" | "jpeg" | "png" | "webp" | "gif" | "heic" | "heif" | "tif" | "tiff" | "bmp"
            | "avif" | "dng" | "raw" | "cr2" | "cr3" | "nef" | "arw" | "psd" => MediaType::Image,
            "mp4" | "mov" | "mkv" | "webm" | "m4v" | "avi" | "wmv" | "flv" | "mpg" | "mpeg"
            | "mts" | "m2ts" | "mxf" | "prores" | "braw" | "r3d" => MediaType::Video,
            "mp3" | "wav" | "aac" | "flac" | "m4a" | "aif" | "aiff" | "ogg" => MediaType::Audio,
            "" => MediaType::Unknown,
            _ => MediaType::Other,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    GoogleDrive,
    Local,
    Url,
}

impl Provider {
    pub fn as_str(self) -> &'static str {
        match self {
            Provider::GoogleDrive => "google_drive",
            Provider::Local => "local",
            Provider::Url => "url",
        }
    }
    pub fn parse(s: &str) -> Self {
        match s {
            "google_drive" => Provider::GoogleDrive,
            "local" => Provider::Local,
            _ => Provider::Url,
        }
    }
}

/// Runtime reachability of a source (§23).
///
/// The distinction that matters: an anonymous request failing is *not* evidence
/// that a file is gone. Only an authenticated 404 or an explicit `trashed` flag
/// may produce `SourceMissing`.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Accessibility {
    Available,
    PreviewAvailable,
    AuthenticationRequired,
    PermissionRequired,
    Offline,
    SourceMissing,
    Unknown,
}

impl Accessibility {
    pub fn as_str(self) -> &'static str {
        match self {
            Accessibility::Available => "available",
            Accessibility::PreviewAvailable => "preview_available",
            Accessibility::AuthenticationRequired => "authentication_required",
            Accessibility::PermissionRequired => "permission_required",
            Accessibility::Offline => "offline",
            Accessibility::SourceMissing => "source_missing",
            Accessibility::Unknown => "unknown",
        }
    }
    pub fn parse(s: &str) -> Self {
        match s {
            "available" => Accessibility::Available,
            "preview_available" => Accessibility::PreviewAvailable,
            "authentication_required" => Accessibility::AuthenticationRequired,
            "permission_required" => Accessibility::PermissionRequired,
            "offline" => Accessibility::Offline,
            "source_missing" => Accessibility::SourceMissing,
            _ => Accessibility::Unknown,
        }
    }
}

// ── records ─────────────────────────────────────────────────────────────────

/// Provider-reported facts. Every field is optional by design: in Drive link
/// mode none of them are knowable, and that is a fully supported state.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub provider: String,
    pub external_id: Option<String>,
    pub external_key: Option<String>,
    pub original_url: Option<String>,
    pub local_path: Option<String>,
    pub container_id: Option<String>,
    pub container_path: Option<String>,
    pub original_filename: Option<String>,
    pub mime_type: Option<String>,
    pub file_size: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub source_created_at: Option<String>,
    pub source_modified_at: Option<String>,
    pub accessibility: String,
    pub last_synced_at: Option<String>,
}

/// The row rendered in the grid. Deliberately lean — no BLOBs, no usage history,
/// no metadata the card does not show (§12). Details come from `get_footage`.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FootageListItem {
    pub id: i64,
    pub display_name: String,
    pub media_type: MediaType,
    pub rating: i64,
    pub favorite: bool,
    pub usage_count: i64,
    pub last_used_at: Option<String>,
    pub date_added: String,
    pub duration_ms: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub provider: String,
    pub accessibility: String,
    pub has_thumbnail: bool,
    pub tags: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FootageDetail {
    pub id: i64,
    pub display_name: String,
    pub media_type: MediaType,
    pub notes: String,
    pub rating: i64,
    pub favorite: bool,
    pub usage_count: i64,
    pub last_used_at: Option<String>,
    pub date_added: String,
    pub date_modified: String,
    pub source: SourceInfo,
    pub tags: Vec<String>,
    pub collections: Vec<Collection>,
    pub usage: Vec<UsageRecord>,
    pub has_thumbnail: bool,
    pub thumbnail_origin: Option<String>,
    pub thumbnail_pinned: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UsageRecord {
    pub id: i64,
    pub project_id: Option<i64>,
    pub project_name: Option<String>,
    pub used_at: String,
    pub notes: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    pub notes: String,
    pub created_at: String,
    pub usage_count: i64,
    pub footage_count: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub footage_count: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub footage_count: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FolderNode {
    pub container_path: String,
    pub footage_count: i64,
    pub used_count: i64,
    pub unused_count: i64,
    pub tags: Vec<String>,
    pub fields: Vec<FolderFieldValue>,
    pub added_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FolderField {
    pub id: i64,
    pub name: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FolderFieldValue {
    pub field_id: i64,
    pub name: String,
    pub value: String,
}

// ── query ───────────────────────────────────────────────────────────────────

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub enum UsageFilter {
    #[default]
    All,
    Used,
    Unused,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub enum SortKey {
    #[default]
    NewestAdded,
    OldestAdded,
    NameAsc,
    NameDesc,
    RecentlyUsed,
    MostUsed,
    NeverUsed,
    HighestRating,
    Duration,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FootageQuery {
    pub search: Option<String>,
    pub usage: UsageFilter,
    pub media_types: Vec<MediaType>,
    pub min_rating: Option<i64>,
    pub favorite_only: bool,
    pub tags: Vec<String>,
    pub collection_id: Option<i64>,
    pub project_id: Option<i64>,
    pub container_path: Option<String>,
    pub providers: Vec<String>,
    pub accessibility: Vec<String>,
    pub added_after: Option<String>,
    pub added_before: Option<String>,
    pub used_after: Option<String>,
    pub used_before: Option<String>,
    pub missing_thumbnail: bool,
    pub sort: SortKey,
    pub offset: i64,
    pub limit: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FootagePage {
    pub items: Vec<FootageListItem>,
    pub total: i64,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub total: i64,
    pub used: i64,
    pub unused: i64,
    pub images: i64,
    pub videos: i64,
    pub favorites: i64,
    pub missing: i64,
    pub without_thumbnail: i64,
}

// ── input payloads ──────────────────────────────────────────────────────────

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewFootage {
    pub display_name: String,
    pub media_type: Option<MediaType>,
    pub provider: String,
    pub external_id: Option<String>,
    pub external_key: Option<String>,
    pub original_url: Option<String>,
    pub local_path: Option<String>,
    pub container_id: Option<String>,
    pub container_path: Option<String>,
    pub original_filename: Option<String>,
    pub mime_type: Option<String>,
    pub file_size: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub source_created_at: Option<String>,
    pub source_modified_at: Option<String>,
    pub tags: Option<Vec<String>>,
    pub notes: Option<String>,
}

/// Partial update. `None` means "leave alone" — this is what keeps a Drive sync
/// from ever clobbering user-authored fields (§25).
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FootagePatch {
    pub display_name: Option<String>,
    pub notes: Option<String>,
    pub rating: Option<i64>,
    pub favorite: Option<bool>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub imported: Vec<i64>,
    pub duplicates: Vec<DuplicateHit>,
    pub failed: Vec<FailedEntry>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateHit {
    pub footage_id: i64,
    pub display_name: String,
    pub external_id: Option<String>,
    pub input: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FailedEntry {
    pub input: String,
    pub reason: String,
}
