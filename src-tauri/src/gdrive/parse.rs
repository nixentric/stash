//! Google Drive share-URL parsing.
//!
//! This is pure string work with no network and no API dependency — it is what
//! makes Link Mode possible without a Google account (§2 of the revision).
//!
//! Whatever this produces, the caller stores the **original URL untouched**
//! alongside the extracted id. A transformed URL is never the only record (§5).

use serde::Serialize;
use url::Url;

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum DriveRefKind {
    File,
    Folder,
}

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DriveRef {
    pub kind: DriveRefKind,
    pub file_id: String,
    /// Older shared files require `resourceKey` in addition to the id. Dropping
    /// it turns a working link into a 404, so it is preserved when present.
    pub resource_key: Option<String>,
    pub original_url: String,
}

const DRIVE_HOSTS: [&str; 3] = ["drive.google.com", "docs.google.com", "drive.usercontent.google.com"];

/// Drive ids are URL-safe base64-ish. Length is checked loosely because Google
/// has changed it over the years; the charset check is what actually rejects
/// path fragments like "view" or "edit".
fn plausible_id(s: &str) -> bool {
    let len = s.len();
    (10..=128).contains(&len) && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn is_drive_url(input: &str) -> bool {
    parse(input).is_some()
}

pub fn parse(input: &str) -> Option<DriveRef> {
    let raw = input.trim();
    if raw.is_empty() {
        return None;
    }
    // Tolerate a pasted URL with no scheme; anything else is not a URL.
    let url = Url::parse(raw)
        .or_else(|_| Url::parse(&format!("https://{raw}")))
        .ok()?;

    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let host = url.host_str()?.to_ascii_lowercase();
    if !DRIVE_HOSTS.contains(&host.as_str()) {
        return None;
    }

    let resource_key = url
        .query_pairs()
        .find(|(k, _)| k.eq_ignore_ascii_case("resourcekey"))
        .map(|(_, v)| v.to_string())
        .filter(|v| !v.is_empty());

    let query_id = url
        .query_pairs()
        .find(|(k, _)| k == "id")
        .map(|(_, v)| v.to_string());

    let segments: Vec<&str> = url
        .path_segments()
        .map(|s| s.filter(|p| !p.is_empty()).collect())
        .unwrap_or_default();

    // /drive/folders/{id}, /drive/u/0/folders/{id}, /drive/mobile/folders/{id}
    if let Some(i) = segments.iter().position(|s| *s == "folders") {
        if let Some(id) = segments.get(i + 1).filter(|id| plausible_id(id)) {
            return Some(DriveRef {
                kind: DriveRefKind::Folder,
                file_id: (*id).to_string(),
                resource_key,
                original_url: raw.to_string(),
            });
        }
    }

    // /folderview?id={id}
    if segments.first() == Some(&"folderview") {
        let id = query_id.filter(|id| plausible_id(id))?;
        return Some(DriveRef {
            kind: DriveRefKind::Folder,
            file_id: id,
            resource_key,
            original_url: raw.to_string(),
        });
    }

    // /file/d/{id}/…, /document/d/{id}/…, /spreadsheets/d/{id}/…, /presentation/d/{id}/…
    if let Some(i) = segments.iter().position(|s| *s == "d") {
        if let Some(id) = segments.get(i + 1).filter(|id| plausible_id(id)) {
            return Some(DriveRef {
                kind: DriveRefKind::File,
                file_id: (*id).to_string(),
                resource_key,
                original_url: raw.to_string(),
            });
        }
    }

    // /open?id={id}, /uc?id={id}, /thumbnail?id={id}, /download?id={id}
    if let Some(id) = query_id.filter(|id| plausible_id(id)) {
        return Some(DriveRef {
            kind: DriveRefKind::File,
            file_id: id,
            resource_key,
            original_url: raw.to_string(),
        });
    }

    None
}

/// Canonical human-facing URL for a Drive item — what "Open in Google Drive" and
/// "Copy Link" use. Only ever derived at display time; never stored in place of
/// the original.
pub fn view_url(r: &DriveRef) -> String {
    let base = match r.kind {
        DriveRefKind::File => format!("https://drive.google.com/file/d/{}/view", r.file_id),
        DriveRefKind::Folder => format!("https://drive.google.com/drive/folders/{}", r.file_id),
    };
    match &r.resource_key {
        Some(k) => format!("{base}?resourcekey={k}"),
        None => base,
    }
}

/// Google's published embed URL — the snippet Drive's own "Embed item" produces.
/// Best-effort: it only renders for files shared as "Anyone with the link".
pub fn embed_url(file_id: &str) -> String {
    format!("https://drive.google.com/file/d/{file_id}/preview")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file_id(u: &str) -> Option<String> {
        parse(u).filter(|r| r.kind == DriveRefKind::File).map(|r| r.file_id)
    }
    fn folder_id(u: &str) -> Option<String> {
        parse(u).filter(|r| r.kind == DriveRefKind::Folder).map(|r| r.file_id)
    }

    const ID: &str = "1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv";

    #[test]
    fn parses_every_file_share_form() {
        for u in [
            format!("https://drive.google.com/file/d/{ID}/view"),
            format!("https://drive.google.com/file/d/{ID}/view?usp=sharing"),
            format!("https://drive.google.com/file/d/{ID}/edit"),
            format!("https://drive.google.com/open?id={ID}"),
            format!("https://drive.google.com/uc?id={ID}&export=download"),
            format!("https://drive.google.com/uc?export=download&id={ID}"),
            format!("https://docs.google.com/document/d/{ID}/edit"),
            format!("https://docs.google.com/spreadsheets/d/{ID}/edit#gid=0"),
            format!("https://docs.google.com/presentation/d/{ID}/edit"),
            format!("drive.google.com/file/d/{ID}/view"), // pasted without scheme
        ] {
            assert_eq!(file_id(&u).as_deref(), Some(ID), "failed on {u}");
        }
    }

    #[test]
    fn parses_every_folder_form() {
        for u in [
            format!("https://drive.google.com/drive/folders/{ID}"),
            format!("https://drive.google.com/drive/u/0/folders/{ID}"),
            format!("https://drive.google.com/drive/u/2/folders/{ID}?usp=sharing"),
            format!("https://drive.google.com/drive/mobile/folders/{ID}"),
            format!("https://drive.google.com/folderview?id={ID}"),
        ] {
            assert_eq!(folder_id(&u).as_deref(), Some(ID), "failed on {u}");
        }
    }

    /// Dropping resourceKey silently converts a working old share link into a 404.
    #[test]
    fn preserves_resource_key() {
        let r = parse(&format!(
            "https://drive.google.com/file/d/{ID}/view?usp=sharing&resourcekey=0-AbCdEf"
        ))
        .unwrap();
        assert_eq!(r.resource_key.as_deref(), Some("0-AbCdEf"));
        assert!(view_url(&r).contains("resourcekey=0-AbCdEf"));
    }

    #[test]
    fn keeps_the_original_url_verbatim() {
        let raw = format!("https://drive.google.com/file/d/{ID}/view?usp=drive_link");
        assert_eq!(parse(&raw).unwrap().original_url, raw);
    }

    #[test]
    fn rejects_non_drive_and_malformed_input() {
        for u in [
            "https://example.com/file/d/abc/view",
            "https://drive.google.com.evil.tld/file/d/abc/view",
            "https://dropbox.com/s/xyz",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "not a url at all",
            "",
            "   ",
        ] {
            assert!(parse(u).is_none(), "should have rejected {u:?}");
        }
    }

    #[test]
    fn rejects_path_fragments_that_are_not_ids() {
        // "/file/d/view" — the segment after `d` is too short to be an id.
        assert!(parse("https://drive.google.com/file/d/view").is_none());
        assert!(parse("https://drive.google.com/drive/folders/x").is_none());
    }
}
