//! OAuth 2.0 for installed apps: loopback redirect + PKCE.
//!
//! Google no longer supports the out-of-band copy/paste flow, and loopback
//! remains the recommended redirect for desktop apps. PKCE (S256) is used so the
//! authorization code is useless to anything that intercepts it.
//!
//! Refs (verified against current docs):
//!   https://developers.google.com/identity/protocols/oauth2/native-app

use crate::error::{AppError, Result};
use crate::prefs::GoogleClientConfig;
use crate::util::Secret;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";

/// Read-only across the whole Drive.
///
/// `drive.file` is the non-restricted alternative but only exposes files the app
/// itself created — useless for cataloging footage that already exists. No write
/// scope is ever requested, so a leaked token cannot modify the user's Drive.
pub const SCOPE: &str = "https://www.googleapis.com/auth/drive.readonly";

/// How long the loopback listener waits for the user to finish in the browser.
const AUTH_TIMEOUT: Duration = Duration::from_secs(300);

pub struct Tokens {
    pub access_token: Secret,
    pub refresh_token: Option<Secret>,
    pub expires_at: Instant,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
}

#[derive(Deserialize)]
struct TokenError {
    #[serde(default)]
    error: String,
    #[serde(default)]
    error_description: String,
}

fn random_b64(bytes: usize) -> String {
    use rand::TryRngCore;
    let mut buf = vec![0u8; bytes];
    // OS entropy, not the thread RNG: this is PKCE material and CSRF state.
    rand::rngs::OsRng
        .try_fill_bytes(&mut buf)
        .expect("operating system entropy is unavailable");
    URL_SAFE_NO_PAD.encode(buf)
}

fn challenge_for(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// Constant-time comparison for the `state` parameter.
fn state_matches(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn encode(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

/// Runs the whole interactive flow and returns the resulting tokens.
///
/// `open_browser` is injected so this module has no dependency on Tauri, which
/// keeps it testable and keeps the plugin surface in one place.
pub async fn authorize(
    cfg: &GoogleClientConfig,
    open_browser: impl FnOnce(&str) -> Result<()>,
) -> Result<Tokens> {
    // Port 0 → the OS picks a free port. Nothing is squatted, and two instances
    // of the app cannot collide.
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| AppError::Other(format!("Could not open a local port for sign-in: {e}")))?;
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let verifier = random_b64(64);
    let state = random_b64(24);

    let auth_url = format!(
        "{AUTH_ENDPOINT}?client_id={}&redirect_uri={}&response_type=code&scope={}\
         &code_challenge={}&code_challenge_method=S256&state={}\
         &access_type=offline&prompt=consent",
        encode(&cfg.client_id),
        encode(&redirect_uri),
        encode(SCOPE),
        encode(&challenge_for(&verifier)),
        encode(&state),
    );

    open_browser(&auth_url)?;

    let code = wait_for_code(listener, &state).await?;
    exchange_code(cfg, &code, &verifier, &redirect_uri).await
}

/// Accepts exactly one request, then drops the listener. The socket is not left
/// open for a second caller to reuse.
async fn wait_for_code(listener: TcpListener, expected_state: &str) -> Result<Secret> {
    let accept = async {
        loop {
            let (mut stream, _) = listener.accept().await?;

            let mut buf = vec![0u8; 8192];
            let n = stream.read(&mut buf).await?;
            let request = String::from_utf8_lossy(&buf[..n]).to_string();

            // "GET /?code=…&state=… HTTP/1.1"
            let target = request
                .lines()
                .next()
                .and_then(|l| l.split_whitespace().nth(1))
                .unwrap_or("/");

            // Browsers ask for /favicon.ico on the same origin; ignore it and
            // keep waiting for the real redirect.
            if target.starts_with("/favicon") {
                let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\n\r\n").await;
                continue;
            }

            let parsed = url::Url::parse(&format!("http://127.0.0.1{target}"))
                .map_err(|_| AppError::Other("Malformed redirect from Google".into()))?;
            let params: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();

            let outcome = if let Some(err) = params.get("error") {
                Err(match err.as_str() {
                    "access_denied" => AppError::Other("Sign-in was cancelled".into()),
                    other => AppError::Other(format!("Google returned: {other}")),
                })
            } else if !params
                .get("state")
                .map(|s| state_matches(s, expected_state))
                .unwrap_or(false)
            {
                // A state mismatch means this request did not originate from the
                // authorization we started. Abort without touching the keychain.
                Err(AppError::Other("Sign-in could not be verified".into()))
            } else {
                params
                    .get("code")
                    .filter(|c| !c.is_empty())
                    .map(|c| Secret::new(c.clone()))
                    .ok_or_else(|| AppError::Other("Google did not return an authorization code".into()))
            };

            let body = match &outcome {
                Ok(_) => BROWSER_OK,
                Err(_) => BROWSER_FAIL,
            };
            let _ = stream
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
                         Content-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                    .as_bytes(),
                )
                .await;
            let _ = stream.shutdown().await;

            return outcome;
        }
    };

    match tokio::time::timeout(AUTH_TIMEOUT, accept).await {
        Ok(r) => r,
        Err(_) => Err(AppError::Other(
            "Sign-in timed out. Try connecting again.".into(),
        )),
    }
}

async fn exchange_code(
    cfg: &GoogleClientConfig,
    code: &Secret,
    verifier: &str,
    redirect_uri: &str,
) -> Result<Tokens> {
    let mut form = vec![
        ("code", code.expose().to_string()),
        ("client_id", cfg.client_id.clone()),
        ("code_verifier", verifier.to_string()),
        ("grant_type", "authorization_code".to_string()),
        ("redirect_uri", redirect_uri.to_string()),
    ];
    // Desktop clients created in the Cloud console still issue a secret; it is
    // sent when present and simply omitted when not.
    if let Some(s) = &cfg.client_secret {
        form.push(("client_secret", s.expose().to_string()));
    }

    let resp = reqwest::Client::new()
        .post(TOKEN_ENDPOINT)
        .form(&form)
        .send()
        .await?;

    read_token_response(resp).await
}

pub async fn refresh(cfg: &GoogleClientConfig, refresh_token: &Secret) -> Result<Tokens> {
    let mut form = vec![
        ("refresh_token", refresh_token.expose().to_string()),
        ("client_id", cfg.client_id.clone()),
        ("grant_type", "refresh_token".to_string()),
    ];
    if let Some(s) = &cfg.client_secret {
        form.push(("client_secret", s.expose().to_string()));
    }

    let resp = reqwest::Client::new()
        .post(TOKEN_ENDPOINT)
        .form(&form)
        .send()
        .await?;

    if resp.status() == reqwest::StatusCode::BAD_REQUEST {
        // invalid_grant: the user revoked access, or the token expired after
        // long disuse. Both mean "reconnect", not "retry".
        return Err(AppError::AuthExpired);
    }
    read_token_response(resp).await
}

async fn read_token_response(resp: reqwest::Response) -> Result<Tokens> {
    let status = resp.status();
    let body = resp.text().await?;

    if !status.is_success() {
        let detail = serde_json::from_str::<TokenError>(&body)
            .map(|e| {
                if e.error_description.is_empty() {
                    e.error
                } else {
                    e.error_description
                }
            })
            .unwrap_or_else(|_| format!("HTTP {status}"));
        return Err(AppError::Other(format!("Google rejected the sign-in: {detail}")));
    }

    let t: TokenResponse = serde_json::from_str(&body)
        .map_err(|_| AppError::Other("Unexpected response from Google".into()))?;

    Ok(Tokens {
        // Refresh 60s early so a request never races the expiry.
        expires_at: Instant::now()
            + Duration::from_secs(t.expires_in.unwrap_or(3600).saturating_sub(60)),
        access_token: Secret::new(t.access_token),
        refresh_token: t.refresh_token.map(Secret::new),
    })
}

const BROWSER_OK: &str = r#"<!doctype html><meta charset="utf-8"><title>Connected</title>
<style>body{font:15px -apple-system,system-ui,sans-serif;display:grid;place-items:center;
height:100vh;margin:0;color:#111;background:#fafafa}div{text-align:center}
h1{font-size:17px;font-weight:600;margin:0 0 6px}p{margin:0;color:#666;font-size:13px}
@media(prefers-color-scheme:dark){body{background:#161618;color:#eee}p{color:#999}}</style>
<div><h1>Google Drive connected</h1><p>You can close this tab and return to Stash.</p></div>"#;

const BROWSER_FAIL: &str = r#"<!doctype html><meta charset="utf-8"><title>Not connected</title>
<style>body{font:15px -apple-system,system-ui,sans-serif;display:grid;place-items:center;
height:100vh;margin:0;color:#111;background:#fafafa}div{text-align:center}
h1{font-size:17px;font-weight:600;margin:0 0 6px}p{margin:0;color:#666;font-size:13px}
@media(prefers-color-scheme:dark){body{background:#161618;color:#eee}p{color:#999}}</style>
<div><h1>Sign-in was not completed</h1><p>Close this tab and try again from Stash.</p></div>"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_matches_the_rfc_test_vector() {
        // RFC 7636 Appendix B.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            challenge_for(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verifier_and_state_are_unique_per_run() {
        let a = random_b64(64);
        let b = random_b64(64);
        assert_ne!(a, b);
        assert!(a.len() >= 43, "PKCE verifiers must be at least 43 chars");
    }

    #[test]
    fn state_comparison_rejects_mismatches() {
        assert!(state_matches("abc123", "abc123"));
        assert!(!state_matches("abc123", "abc124"));
        assert!(!state_matches("abc123", "abc12"));
        assert!(!state_matches("", "x"));
    }
}
