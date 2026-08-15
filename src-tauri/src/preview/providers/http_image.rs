//! Previews for plain `url` sources.

use super::{BoxFuture, PreviewCtx, PreviewProvider};
use crate::db::models::SourceInfo;
use crate::error::{AppError, Result};
use std::time::Duration;

const MAX_BYTES: usize = 16 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(15);

pub struct HttpImageProvider;

impl PreviewProvider for HttpImageProvider {
    fn name(&self) -> &'static str {
        "http_image"
    }

    fn supports(&self, src: &SourceInfo, _ctx: &PreviewCtx) -> bool {
        src.provider == "url"
            && src
                .original_url
                .as_deref()
                .map(is_fetchable_http_url)
                .unwrap_or(false)
    }

    fn fetch<'a>(&'a self, ctx: &'a PreviewCtx, src: &'a SourceInfo) -> BoxFuture<'a, Result<Vec<u8>>> {
        Box::pin(async move {
            let url = src
                .original_url
                .as_deref()
                .filter(|u| is_fetchable_http_url(u))
                .ok_or_else(|| AppError::Invalid("Source has no usable URL".into()))?;

            let resp = ctx.http.get(url).timeout(TIMEOUT).send().await?;
            if !resp.status().is_success() {
                return Err(AppError::NotFound("Preview is unavailable".into()));
            }
            let is_image = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(|ct| ct.starts_with("image/"))
                .unwrap_or(false);
            if !is_image {
                return Err(AppError::NotFound("That URL is not an image".into()));
            }

            let bytes = resp.bytes().await?;
            if bytes.len() > MAX_BYTES {
                return Err(AppError::Other("Image is too large".into()));
            }
            Ok(bytes.to_vec())
        })
    }
}

/// Rejects non-HTTP schemes and hosts that resolve inside the machine.
///
/// Without this, a crafted `url` record turns the app into a probe for services
/// bound to localhost or a link-local metadata endpoint.
pub fn is_fetchable_http_url(raw: &str) -> bool {
    let Ok(u) = url::Url::parse(raw) else {
        return false;
    };
    if !matches!(u.scheme(), "http" | "https") {
        return false;
    }
    let Some(host) = u.host() else {
        return false;
    };
    match host {
        url::Host::Domain(d) => {
            let d = d.to_ascii_lowercase();
            !(d == "localhost" || d.ends_with(".localhost") || d.ends_with(".local"))
        }
        url::Host::Ipv4(ip) => {
            !(ip.is_loopback() || ip.is_private() || ip.is_link_local() || ip.is_unspecified())
        }
        url::Host::Ipv6(ip) => !(ip.is_loopback() || ip.is_unspecified()),
    }
}

#[cfg(test)]
mod tests {
    use super::is_fetchable_http_url;

    #[test]
    fn accepts_ordinary_public_urls() {
        assert!(is_fetchable_http_url("https://cdn.example.com/a.jpg"));
        assert!(is_fetchable_http_url("http://example.org/b.png"));
    }

    #[test]
    fn refuses_internal_and_non_http_targets() {
        for u in [
            "http://localhost:8080/x.jpg",
            "http://127.0.0.1/x.jpg",
            "http://192.168.1.1/admin.png",
            "http://10.0.0.5/x.jpg",
            "http://169.254.169.254/latest/meta-data",
            "http://[::1]/x.jpg",
            "http://printer.local/x.jpg",
            "file:///etc/passwd",
            "ftp://example.com/x.jpg",
            "not a url",
        ] {
            assert!(!is_fetchable_http_url(u), "should have refused {u}");
        }
    }
}
