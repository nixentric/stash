//! Font pickers.
//!
//! Two ways to name a typeface: pick one the machine already has installed, or
//! point at a font file. The second matters because a brand font is often *not*
//! installed on the machine the kit is being written on, and typing its name
//! blind gets you a preview rendered in something else entirely.

use crate::error::{AppError, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LoadedFont {
    /// The family name as the font itself declares it, not the file name.
    pub family: String,
    /// `data:` URL the webview can hand to `FontFace`, so the preview renders in
    /// the real thing without the font being installed.
    pub data_url: String,
}

/// Families installed on this machine, sorted and de-duplicated.
#[tauri::command]
pub fn system_fonts() -> Vec<String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();

    let mut names: Vec<String> = db
        .faces()
        .filter_map(|f| f.families.first().map(|(name, _)| name.clone()))
        // Apple marks its private interface fonts with a leading dot. They are
        // installed, but ".Aqua Kana" is not a font anyone is setting a brand in.
        .filter(|name| !name.starts_with('.'))
        .collect();

    // A family has one entry per weight and style; the picker wants the family once.
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup();
    names
}

/// Read a font file and report what family it actually is.
#[tauri::command]
pub fn load_font_file(path: String) -> Result<LoadedFont> {
    let bytes = std::fs::read(&path).map_err(|e| AppError::Io(format!("Could not read {path}: {e}")))?;

    let mut db = fontdb::Database::new();
    db.load_font_data(bytes.clone());
    let family = db
        .faces()
        .next()
        .and_then(|f| f.families.first().map(|(name, _)| name.clone()))
        .ok_or_else(|| AppError::Invalid(format!("{path} is not a font file Stash can read")))?;

    let mime = match Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .as_deref()
    {
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("otf") => "font/otf",
        _ => "font/ttf",
    };

    Ok(LoadedFont {
        family,
        data_url: format!("data:{mime};base64,{}", STANDARD.encode(&bytes)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_that_is_not_a_font_is_rejected_rather_than_named_after_itself() {
        let dir = std::env::temp_dir().join("stash-font-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("Definitely-Not-A-Font.ttf");
        std::fs::write(&path, b"this is not a font").unwrap();

        let err = load_font_file(path.to_string_lossy().into_owned()).unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));

        std::fs::remove_file(path).ok();
    }

    #[test]
    fn a_missing_file_reports_io_rather_than_panicking() {
        let err = load_font_file("/nope/not/here.ttf".into()).unwrap_err();
        assert!(matches!(err, AppError::Io(_)));
    }
}
