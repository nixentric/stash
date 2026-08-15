//! Disposable on-disk preview cache.
//!
//! Keyed by *source identity*, not by footage id, so two libraries cataloguing
//! the same Drive file share one cached preview — and deleting the cache costs
//! nothing but a refetch.

use crate::error::Result;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub struct PreviewCache {
    root: PathBuf,
}

impl PreviewCache {
    pub fn new(root: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&root);
        PreviewCache { root }
    }

    fn key(provider: &str, identity: &str) -> String {
        let digest = Sha256::digest(format!("{provider}:{identity}").as_bytes());
        // Two-level fan-out keeps directory sizes sane at 10k+ entries.
        format!("{:x}", digest)
    }

    fn path_for(&self, provider: &str, identity: &str) -> PathBuf {
        let k = Self::key(provider, identity);
        self.root.join(&k[0..2]).join(format!("{}.jpg", &k[2..]))
    }

    pub fn get(&self, provider: &str, identity: &str) -> Option<Vec<u8>> {
        std::fs::read(self.path_for(provider, identity)).ok()
    }

    pub fn put(&self, provider: &str, identity: &str, bytes: &[u8]) -> Result<()> {
        let path = self.path_for(provider, identity);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // Write-then-rename so a concurrent reader never sees a half-written JPEG.
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, bytes)?;
        std::fs::rename(&tmp, &path)?;
        Ok(())
    }

    pub fn remove(&self, provider: &str, identity: &str) {
        let _ = std::fs::remove_file(self.path_for(provider, identity));
    }

    pub fn clear(&self) -> Result<()> {
        if self.root.exists() {
            std::fs::remove_dir_all(&self.root)?;
        }
        std::fs::create_dir_all(&self.root)?;
        Ok(())
    }

    pub fn size_on_disk(&self) -> u64 {
        fn walk(dir: &Path) -> u64 {
            std::fs::read_dir(dir)
                .map(|entries| {
                    entries
                        .filter_map(|e| e.ok())
                        .map(|e| match e.file_type() {
                            Ok(t) if t.is_dir() => walk(&e.path()),
                            Ok(_) => e.metadata().map(|m| m.len()).unwrap_or(0),
                            Err(_) => 0,
                        })
                        .sum()
                })
                .unwrap_or(0)
        }
        walk(&self.root)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_cache() -> PreviewCache {
        PreviewCache::new(std::env::temp_dir().join(format!("stash-cache-{}", rand::random::<u64>())))
    }

    #[test]
    fn roundtrips_and_isolates_keys() {
        let c = tmp_cache();
        c.put("google_drive", "ABC", b"first").unwrap();
        c.put("google_drive", "DEF", b"second").unwrap();

        assert_eq!(c.get("google_drive", "ABC").unwrap(), b"first");
        assert_eq!(c.get("google_drive", "DEF").unwrap(), b"second");
        assert!(c.get("google_drive", "ZZZ").is_none());
        // Same identity under a different provider must not collide.
        assert!(c.get("local", "ABC").is_none());

        c.clear().unwrap();
        assert!(c.get("google_drive", "ABC").is_none());
    }

    #[test]
    fn identities_with_path_characters_cannot_escape_the_cache_root() {
        let c = tmp_cache();
        c.put("url", "../../etc/passwd", b"x").unwrap();
        // Hashing means the key never reaches the filesystem verbatim.
        assert_eq!(c.get("url", "../../etc/passwd").unwrap(), b"x");
        assert!(c.size_on_disk() > 0);
        c.clear().unwrap();
    }
}
