//! Provider-agnostic source abstraction.
//!
//! The rest of the app talks about *sources* and *capabilities*, never about
//! Google Drive. Adding Dropbox, OneDrive, S3 or a NAS means adding a variant
//! and a capability row — not touching the grid, the inspector, or the schema
//! (ARCHITECTURE.md §4).

pub mod bulk;

use crate::db::models::Provider;
use crate::gdrive::parse::{self, DriveRefKind};
use serde::Serialize;
use url::Url;

/// Three-state answer for things that might work.
///
/// `BestEffort` exists so the UI can say "we'll try" without promising — it is
/// exactly what anonymous Drive can honestly offer.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Tri {
    Yes,
    BestEffort,
    No,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub can_open: bool,
    pub can_preview: Tri,
    pub can_fetch_metadata: bool,
    pub can_browse_container: bool,
    pub can_sync: bool,
    pub can_download_thumbnail: Tri,
    pub can_resolve_private: bool,
}

/// The capability matrix. The UI gates every menu item and button on this,
/// which is what keeps "Scan Folder is unavailable" from being a hard-coded
/// Google check scattered through components (§12).
pub fn capabilities_for(provider: Provider, drive_connected: bool) -> Capabilities {
    match provider {
        Provider::Local => Capabilities {
            can_open: true,
            can_preview: Tri::Yes,
            can_fetch_metadata: true,
            can_browse_container: true,
            can_sync: true,
            can_download_thumbnail: Tri::Yes,
            can_resolve_private: true,
        },
        Provider::Url => Capabilities {
            can_open: true,
            can_preview: Tri::BestEffort,
            can_fetch_metadata: false,
            can_browse_container: false,
            can_sync: false,
            can_download_thumbnail: Tri::BestEffort,
            can_resolve_private: false,
        },
        Provider::GoogleDrive if drive_connected => Capabilities {
            can_open: true,
            can_preview: Tri::Yes,
            can_fetch_metadata: true,
            can_browse_container: true,
            can_sync: true,
            can_download_thumbnail: Tri::Yes,
            can_resolve_private: true,
        },
        // Link mode: fully functional as a catalog, no automation.
        Provider::GoogleDrive => Capabilities {
            can_open: true,
            can_preview: Tri::BestEffort,
            can_fetch_metadata: false,
            can_browse_container: false,
            can_sync: false,
            can_download_thumbnail: Tri::BestEffort,
            can_resolve_private: false,
        },
    }
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum SourceKind {
    Item,
    Container,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ParsedSource {
    pub provider: String,
    pub kind: SourceKind,
    pub external_id: Option<String>,
    pub external_key: Option<String>,
    pub original_url: Option<String>,
    pub local_path: Option<String>,
    /// A name to show until something better is known. In link mode this is all
    /// there is, and the user can rename it freely (§24).
    pub suggested_name: String,
}

/// Classifies one line of user input into a source, without any network access.
pub fn parse_input(raw: &str) -> Option<ParsedSource> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }

    if let Some(d) = parse::parse(raw) {
        let kind = match d.kind {
            DriveRefKind::Folder => SourceKind::Container,
            DriveRefKind::File => SourceKind::Item,
        };
        return Some(ParsedSource {
            provider: Provider::GoogleDrive.as_str().to_string(),
            kind,
            suggested_name: match kind {
                SourceKind::Container => "Drive folder".to_string(),
                // No filename is knowable without the API, so fall back to a
                // short, stable stub the user can rename.
                SourceKind::Item => format!("Drive file {}", &d.file_id[..d.file_id.len().min(8)]),
            },
            external_id: Some(d.file_id),
            external_key: d.resource_key,
            original_url: Some(d.original_url),
            local_path: None,
        });
    }

    if let Some(p) = raw.strip_prefix("file://") {
        let decoded = percent_decode(p);
        return Some(local_source(&decoded));
    }

    // Windows paths must be tested before `Url::parse`, which happily reads
    // `C:\Footage\shot.mp4` as a URL with the scheme "c".
    if is_absolute_path(raw) {
        return Some(local_source(raw));
    }

    if let Ok(u) = Url::parse(raw) {
        // A Drive host that the Drive parser rejected is a *broken Drive link*,
        // not a generic media URL. Importing it as one would produce a record
        // that can never resolve, so it is refused and reported instead.
        if u.host_str()
            .map(|h| is_drive_host(&h.to_ascii_lowercase()))
            .unwrap_or(false)
        {
            return None;
        }
        if matches!(u.scheme(), "http" | "https") {
            let name = u
                .path_segments()
                .and_then(|s| s.filter(|x| !x.is_empty()).next_back())
                .filter(|s| !s.is_empty())
                .map(|s| percent_decode(s))
                .unwrap_or_else(|| u.host_str().unwrap_or("Link").to_string());
            return Some(ParsedSource {
                provider: Provider::Url.as_str().to_string(),
                kind: SourceKind::Item,
                external_id: None,
                external_key: None,
                original_url: Some(raw.to_string()),
                local_path: None,
                suggested_name: name,
            });
        }
        // Any other scheme (javascript:, data:, …) is refused rather than
        // guessed at.
        return None;
    }

    None
}

fn is_drive_host(host: &str) -> bool {
    matches!(
        host,
        "drive.google.com" | "docs.google.com" | "drive.usercontent.google.com"
    )
}

fn is_absolute_path(raw: &str) -> bool {
    if raw.starts_with('/') || raw.starts_with("\\\\") {
        return true;
    }
    let b = raw.as_bytes();
    // `C:\…` or `C:/…`, but not `x://…`, which is a URL scheme.
    b.len() > 2
        && b[0].is_ascii_alphabetic()
        && b[1] == b':'
        && (b[2] == b'\\' || b[2] == b'/')
        && !raw[2..].starts_with("//")
}

fn local_source(path: &str) -> ParsedSource {
    let name = std::path::Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    ParsedSource {
        provider: Provider::Local.as_str().to_string(),
        kind: SourceKind::Item,
        external_id: None,
        external_key: None,
        original_url: None,
        local_path: Some(path.to_string()),
        suggested_name: name,
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv";

    #[test]
    fn link_mode_offers_no_automation_but_full_cataloging() {
        let c = capabilities_for(Provider::GoogleDrive, false);
        assert!(c.can_open, "opening a link never needs an API");
        assert_eq!(c.can_preview, Tri::BestEffort);
        assert!(!c.can_browse_container, "folder scan requires the API");
        assert!(!c.can_sync);
        assert!(!c.can_resolve_private);
    }

    #[test]
    fn connecting_drive_unlocks_automation() {
        let c = capabilities_for(Provider::GoogleDrive, true);
        assert_eq!(c.can_preview, Tri::Yes);
        assert!(c.can_browse_container && c.can_sync && c.can_resolve_private);
    }

    #[test]
    fn drive_folder_url_classifies_as_a_container() {
        let p = parse_input(&format!("https://drive.google.com/drive/folders/{ID}")).unwrap();
        assert_eq!(p.kind, SourceKind::Container);
        assert_eq!(p.provider, "google_drive");
        assert_eq!(p.external_id.as_deref(), Some(ID));
    }

    #[test]
    fn drive_file_url_keeps_id_and_original_url() {
        let raw = format!("https://drive.google.com/file/d/{ID}/view?usp=sharing");
        let p = parse_input(&raw).unwrap();
        assert_eq!(p.kind, SourceKind::Item);
        assert_eq!(p.external_id.as_deref(), Some(ID));
        assert_eq!(p.original_url.as_deref(), Some(raw.as_str()));
    }

    #[test]
    fn plain_http_urls_become_url_sources_named_after_the_file() {
        let p = parse_input("https://cdn.example.com/clips/beach%20walk.mp4").unwrap();
        assert_eq!(p.provider, "url");
        assert_eq!(p.suggested_name, "beach walk.mp4");
    }

    #[test]
    fn absolute_paths_and_file_urls_become_local_sources() {
        let p = parse_input("/Users/me/Movies/DSC001.MOV").unwrap();
        assert_eq!(p.provider, "local");
        assert_eq!(p.suggested_name, "DSC001.MOV");

        let p = parse_input("file:///Users/me/Movies/A%20Clip.mov").unwrap();
        assert_eq!(p.local_path.as_deref(), Some("/Users/me/Movies/A Clip.mov"));

        let p = parse_input("C:\\Footage\\shot.mp4").unwrap();
        assert_eq!(p.provider, "local");
    }

    #[test]
    fn dangerous_schemes_are_refused() {
        for s in ["javascript:alert(1)", "data:text/html,<script>", "vbscript:x"] {
            assert!(parse_input(s).is_none(), "should reject {s}");
        }
    }
}
