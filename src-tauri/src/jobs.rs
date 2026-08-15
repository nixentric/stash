//! Cancellable background work with progress reporting.
//!
//! Importing 1,200 files must not freeze the window, and pressing Cancel must
//! stop it *now* — not after the current page of 1,000 finishes (§44, §45).

use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    pub job_id: String,
    /// "scanning" | "importing" | "thumbnails" | "syncing" | "done" | "cancelled" | "error"
    pub phase: String,
    pub done: u64,
    /// `None` while the total is still unknown (mid-pagination).
    pub total: Option<u64>,
    pub message: Option<String>,
}

#[derive(Clone)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

#[derive(Default)]
pub struct JobRegistry {
    inner: Mutex<HashMap<String, CancelToken>>,
}

impl JobRegistry {
    pub fn start(&self, kind: &str) -> (String, CancelToken) {
        let id = format!("{kind}-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed));
        let token = CancelToken(Arc::new(AtomicBool::new(false)));
        if let Ok(mut g) = self.inner.lock() {
            g.insert(id.clone(), token.clone());
        }
        (id, token)
    }

    pub fn cancel(&self, job_id: &str) -> bool {
        match self.inner.lock() {
            Ok(g) => match g.get(job_id) {
                Some(t) => {
                    t.cancel();
                    true
                }
                None => false,
            },
            Err(_) => false,
        }
    }

    pub fn finish(&self, job_id: &str) {
        if let Ok(mut g) = self.inner.lock() {
            g.remove(job_id);
        }
    }

    pub fn active(&self) -> Vec<String> {
        self.inner
            .lock()
            .map(|g| g.keys().cloned().collect())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancelling_flips_only_the_named_job() {
        let reg = JobRegistry::default();
        let (a, ta) = reg.start("import");
        let (b, tb) = reg.start("import");
        assert_ne!(a, b, "job ids must be unique");

        assert!(reg.cancel(&a));
        assert!(ta.is_cancelled());
        assert!(!tb.is_cancelled());

        reg.finish(&a);
        assert!(!reg.cancel(&a), "a finished job is no longer cancellable");
        assert_eq!(reg.active(), vec![b]);
    }
}
