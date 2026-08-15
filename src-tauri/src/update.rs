//! Update checks against the public GitHub releases API.
//!
//! This is the only network request Stash makes on its own behalf, and it is
//! switchable off in Settings. It sends no identifier of any kind — no library
//! contents, no machine id, not even the installed version, which is compared
//! locally after the response arrives. Nothing is downloaded or installed: a
//! newer release opens in the browser, so the user stays in charge of what runs
//! on their machine.

use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};

const RELEASES_URL: &str = "https://api.github.com/repos/nixentric/stash/releases/latest";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current: String,
    pub latest: String,
    /// True only when `latest` is genuinely newer, never merely different.
    pub update_available: bool,
    pub url: String,
    pub notes: String,
    pub published_at: String,
}

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    published_at: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// `v0.3.0` / `0.3.0` → `[0, 3, 0]`. Non-numeric parts sort as 0 rather than
/// failing: a malformed tag must not make the app claim an update exists.
fn parts(version: &str) -> Vec<u32> {
    version
        .trim()
        .trim_start_matches(['v', 'V'])
        .split(['.', '-', '+'])
        .take(3)
        .map(|p| p.parse().unwrap_or(0))
        .collect()
}

/// Compares by precedence, not by string order, so 0.10.0 beats 0.9.0.
pub fn is_newer(latest: &str, current: &str) -> bool {
    let (a, b) = (parts(latest), parts(current));
    for i in 0..3 {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

pub async fn check(current: &str) -> Result<UpdateStatus> {
    let client = reqwest::Client::builder()
        .user_agent(format!("Stash/{current}"))
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Network(e.to_string()))?;

    let response = client
        .get(RELEASES_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Could not reach GitHub: {e}")))?;

    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "GitHub answered {} when asked for the latest release",
            response.status()
        )));
    }

    let release: GithubRelease = response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Unreadable release data: {e}")))?;

    // A draft or pre-release is not something to nudge anyone towards.
    let publishable = !release.draft && !release.prerelease;
    let latest = release.tag_name.trim_start_matches('v').to_string();

    Ok(UpdateStatus {
        update_available: publishable && is_newer(&latest, current),
        current: current.to_string(),
        latest,
        url: release.html_url,
        notes: release.body.chars().take(2000).collect(),
        published_at: release.published_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_by_precedence_not_alphabetically() {
        assert!(is_newer("0.10.0", "0.9.0"), "10 is not less than 9");
        assert!(is_newer("v1.0.0", "0.9.9"));
        assert!(is_newer("0.3.1", "0.3.0"));
        assert!(!is_newer("0.3.0", "0.3.0"), "same version is not an update");
        assert!(!is_newer("0.2.9", "0.3.0"), "older is never an update");
    }

    #[test]
    fn a_malformed_tag_never_claims_an_update() {
        for junk in ["", "latest", "v", "nightly-build", "..."] {
            assert!(!is_newer(junk, "0.3.0"), "{junk} should not read as newer");
        }
    }

    #[test]
    fn a_tag_with_extra_parts_still_compares_on_the_first_three() {
        assert!(is_newer("0.4.0-beta.2", "0.3.0"));
        assert!(!is_newer("0.3.0-beta.1", "0.3.0"), "a pre-release of the same version is not newer");
    }
}
