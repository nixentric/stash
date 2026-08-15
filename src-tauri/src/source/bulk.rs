//! Bulk paste parsing (§14, §15).
//!
//! Designed to be *conservative*. A label is only adopted when the structure is
//! unambiguous, because a confidently wrong auto-name is worse than no name —
//! the user can always rename, but they cannot notice a name they never saw.

use super::{parse_input, ParsedSource};
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BulkEntry {
    pub source: ParsedSource,
    /// Label detected next to the link, if any. Never invented.
    pub label: Option<String>,
    pub line: usize,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BulkParseResult {
    pub entries: Vec<BulkEntry>,
    /// Lines that looked like they wanted to be links but were not. Surfaced so
    /// a typo is visible instead of silently dropped.
    pub unrecognized: Vec<String>,
}

const MAX_LINES: usize = 20_000;
const MAX_LABEL_LEN: usize = 200;

fn clean_label(s: &str) -> Option<String> {
    let t = s
        .trim()
        .trim_matches(|c: char| c == '-' || c == '•' || c == '*' || c == ':' || c == '\t')
        .trim();
    if t.is_empty() || t.chars().count() > MAX_LABEL_LEN {
        None
    } else {
        Some(t.to_string())
    }
}

/// Splits a line into (source, inline label) — handles `Name<TAB>URL` and
/// `Name: URL`, which is what pasting a spreadsheet column produces.
fn split_line(line: &str) -> Option<(ParsedSource, Option<String>)> {
    if let Some(s) = parse_input(line) {
        return Some((s, None));
    }
    // Find a whitespace-delimited token that is a source; the rest is the label.
    let mut label_parts: Vec<&str> = Vec::new();
    for token in line.split_whitespace() {
        if let Some(s) = parse_input(token) {
            let rest: Vec<&str> = line
                .split_whitespace()
                .filter(|t| *t != token)
                .collect();
            let label = clean_label(&rest.join(" "));
            return Some((s, label));
        }
        label_parts.push(token);
    }
    None
}

pub fn parse(text: &str) -> BulkParseResult {
    let mut entries: Vec<BulkEntry> = Vec::new();
    let mut unrecognized: Vec<String> = Vec::new();
    let mut pending_label: Option<String> = None;

    for (idx, raw) in text.lines().take(MAX_LINES).enumerate() {
        let line = raw.trim();
        if line.is_empty() {
            // A blank line ends a label's reach — `Label\n\nURL` is not a pair.
            pending_label = None;
            continue;
        }

        match split_line(line) {
            Some((source, inline_label)) => {
                entries.push(BulkEntry {
                    source,
                    label: inline_label.or_else(|| pending_label.take()),
                    line: idx + 1,
                });
                pending_label = None;
            }
            None => {
                // Only text that plausibly *is* a label becomes one. Anything
                // that looked like a link attempt is reported instead.
                if line.contains("://") || line.contains("drive.google") {
                    unrecognized.push(line.to_string());
                    pending_label = None;
                } else {
                    pending_label = clean_label(line);
                }
            }
        }
    }

    BulkParseResult {
        entries,
        unrecognized,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const B: &str = "1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    const C: &str = "1CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

    fn link(id: &str) -> String {
        format!("https://drive.google.com/file/d/{id}/view")
    }

    #[test]
    fn plain_list_of_links() {
        let text = format!("{}\n{}\n{}", link(A), link(B), link(C));
        let r = parse(&text);
        assert_eq!(r.entries.len(), 3);
        assert!(r.entries.iter().all(|e| e.label.is_none()));
        assert_eq!(r.entries[1].source.external_id.as_deref(), Some(B));
    }

    #[test]
    fn label_on_the_line_above_is_adopted() {
        let text = format!(
            "Footage Talent 01\n{}\n\nFootage Product 02\n{}",
            link(A),
            link(B)
        );
        let r = parse(&text);
        assert_eq!(r.entries.len(), 2);
        assert_eq!(r.entries[0].label.as_deref(), Some("Footage Talent 01"));
        assert_eq!(r.entries[1].label.as_deref(), Some("Footage Product 02"));
    }

    #[test]
    fn a_blank_line_breaks_the_label_pairing() {
        let text = format!("Some heading\n\n{}", link(A));
        let r = parse(&text);
        assert_eq!(r.entries.len(), 1);
        assert_eq!(r.entries[0].label, None, "heading is too far away to trust");
    }

    #[test]
    fn a_label_is_never_reused_for_a_second_link() {
        let text = format!("Only names the first\n{}\n{}", link(A), link(B));
        let r = parse(&text);
        assert_eq!(r.entries[0].label.as_deref(), Some("Only names the first"));
        assert_eq!(r.entries[1].label, None);
    }

    #[test]
    fn inline_labels_from_pasted_spreadsheet_rows() {
        let text = format!("Beach wide shot\t{}\nSunset B-roll  {}", link(A), link(B));
        let r = parse(&text);
        assert_eq!(r.entries[0].label.as_deref(), Some("Beach wide shot"));
        assert_eq!(r.entries[1].label.as_deref(), Some("Sunset B-roll"));
    }

    #[test]
    fn broken_links_are_reported_not_swallowed() {
        let text = format!("{}\nhttps://drive.google.com/file/d/\nnope", link(A));
        let r = parse(&text);
        assert_eq!(r.entries.len(), 1);
        assert_eq!(r.unrecognized.len(), 1);
    }

    #[test]
    fn mixed_providers_in_one_paste() {
        let text = format!(
            "{}\nhttps://cdn.example.com/a.mp4\n/Users/me/b.mov",
            link(A)
        );
        let r = parse(&text);
        let providers: Vec<&str> = r.entries.iter().map(|e| e.source.provider.as_str()).collect();
        assert_eq!(providers, vec!["google_drive", "url", "local"]);
    }
}
