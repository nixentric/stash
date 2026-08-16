//! Opening, creating and snapshotting a portable `.footagedb` library.

use super::migrations::{
    application_id, migrate, user_version, APPLICATION_ID, APP_SCHEMA_VERSION,
};
use crate::error::{AppError, Result};
use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};

pub const LIBRARY_EXTENSION: &str = "footagedb";

pub struct Library {
    pub conn: Connection,
    pub path: PathBuf,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    pub path: String,
    pub name: String,
    pub schema_version: u32,
    pub file_size: u64,
    pub footage_count: i64,
}

/// Pragmas applied to every library connection.
///
/// `journal_mode = DELETE` is deliberate and load-bearing: WAL would leave
/// `-wal`/`-shm` sidecars alongside the library for as long as the app is open,
/// and a user copying "the file" during that window would silently lose every
/// committed change still in the log. A single portable file is the product
/// requirement; WAL is incompatible with it. See ARCHITECTURE.md §2.2.
fn apply_pragmas(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = DELETE;
         PRAGMA synchronous  = FULL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;
         PRAGMA temp_store   = MEMORY;",
    )?;
    Ok(())
}

fn ensure_extension(path: &Path) -> PathBuf {
    match path.extension() {
        Some(e) if e.eq_ignore_ascii_case(LIBRARY_EXTENSION) => path.to_path_buf(),
        _ => {
            let mut s = path.as_os_str().to_os_string();
            s.push(".");
            s.push(LIBRARY_EXTENSION);
            PathBuf::from(s)
        }
    }
}

pub fn create(path: &Path) -> Result<Library> {
    let path = ensure_extension(path);
    if path.exists() {
        return Err(AppError::Invalid(format!(
            "{} already exists. Choose a different name.",
            path.display()
        )));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut conn = Connection::open(&path)?;
    apply_pragmas(&conn)?;
    migrate(&mut conn, 0)?;

    let now = crate::util::now_iso();
    conn.execute(
        "INSERT INTO app_metadata (key, value) VALUES ('format','stash-library'),('created_at',?1)",
        [&now],
    )?;

    Ok(Library { conn, path })
}

pub fn open(path: &Path) -> Result<Library> {
    if !path.exists() {
        return Err(AppError::NotFound(format!(
            "{} could not be found. It may have been moved or renamed.",
            path.display()
        )));
    }

    let mut conn = Connection::open(path).map_err(|e| cannot_open(path, e))?;
    apply_pragmas(&conn)?;
    verify_is_library(&conn, path)?;

    let found = user_version(&conn)?;
    if found > APP_SCHEMA_VERSION {
        return Err(AppError::LibraryTooNew {
            found,
            supported: APP_SCHEMA_VERSION,
            app: env!("CARGO_PKG_VERSION"),
        });
    }
    if found < APP_SCHEMA_VERSION {
        // Backup first: a transaction rollback cannot rescue a file that was
        // already damaged, so the safety copy has to exist before we start.
        drop(conn);
        let backup = backup_path(path, found);
        std::fs::copy(path, &backup).map_err(|e| {
            AppError::Migration(format!("could not write safety backup {}: {e}", backup.display()))
        })?;

        conn = Connection::open(path).map_err(|e| cannot_open(path, e))?;
        apply_pragmas(&conn)?;
        if let Err(e) = migrate(&mut conn, found) {
            drop(conn);
            // Put the user's file back exactly as it was, then report.
            let _ = std::fs::copy(&backup, path);
            return Err(e);
        }
        log::info!("migrated library v{found} -> v{APP_SCHEMA_VERSION}");
    }

    Ok(Library {
        conn,
        path: path.to_path_buf(),
    })
}

/// Turns SQLite's "unable to open database file" into something actionable.
///
/// That one message covers a missing file, a folder SQLite cannot write its
/// journal into, and — the common one — a folder the operating system has not
/// let this build reach. `open` has already established that the file exists,
/// so reporting the raw SQLite string sends the user looking for a corrupt
/// library that is in fact perfectly fine.
fn cannot_open(path: &Path, e: rusqlite::Error) -> AppError {
    use rusqlite::ErrorCode::{CannotOpen, DatabaseBusy, PermissionDenied, ReadOnly};

    if !matches!(
        e.sqlite_error_code(),
        Some(CannotOpen | PermissionDenied | ReadOnly)
    ) {
        // A locked file is its own story and says so.
        if e.sqlite_error_code() == Some(DatabaseBusy) {
            return AppError::Database(format!(
                "{} is in use by another program. Close it there and try again.",
                path.display()
            ));
        }
        return AppError::Database(e.to_string());
    }

    let where_it_is = path.parent().unwrap_or(path).display().to_string();
    let mut msg = format!(
        "Stash could not open {}. The file is there, but this build is not allowed to read it — \
         this is a permission problem, not a damaged or outdated library.",
        path.display()
    );
    if cfg!(target_os = "macos") {
        msg.push_str(&format!(
            " Open System Settings → Privacy & Security → Files and Folders and give Stash access \
             to {where_it_is}. Stash builds are unsigned, so macOS treats every update as a new \
             app and asks again."
        ));
    } else {
        msg.push_str(" Check that you can write to the folder it lives in.");
    }
    AppError::Invalid(msg)
}

/// Rejects arbitrary SQLite files. Accepts either marker, because a library
/// restored by a third-party tool may have lost its `application_id`.
fn verify_is_library(conn: &Connection, path: &Path) -> Result<()> {
    if application_id(conn).unwrap_or(0) == APPLICATION_ID {
        return Ok(());
    }
    let marked: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_metadata'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false)
        && conn
            .query_row(
                "SELECT value FROM app_metadata WHERE key='format'",
                [],
                |r| r.get::<_, String>(0),
            )
            .map(|v| v == "stash-library")
            .unwrap_or(false);

    if marked {
        Ok(())
    } else {
        Err(AppError::NotALibrary(
            path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path.display().to_string()),
        ))
    }
}

fn backup_path(path: &Path, from_version: u32) -> PathBuf {
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let mut s = path.as_os_str().to_os_string();
    s.push(format!(".backup-v{from_version}-{stamp}"));
    PathBuf::from(s)
}

/// `Save As` / `Save a Copy`.
///
/// `VACUUM INTO` writes a transactionally consistent, defragmented snapshot. It
/// is strictly safer than copying bytes: it cannot observe a half-written page
/// and it cannot produce a target that only partially exists.
pub fn vacuum_into(conn: &Connection, target: &Path) -> Result<PathBuf> {
    let target = ensure_extension(target);
    if target.exists() {
        // VACUUM INTO refuses to overwrite; removing first is what makes
        // "Save As" over an existing file behave the way users expect.
        std::fs::remove_file(&target)?;
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy().as_ref()])?;
    Ok(target)
}

pub fn info(lib: &Library) -> Result<LibraryInfo> {
    let footage_count: i64 = lib
        .conn
        .query_row("SELECT COUNT(*) FROM footages", [], |r| r.get(0))?;
    Ok(LibraryInfo {
        path: lib.path.to_string_lossy().to_string(),
        name: lib
            .path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Library".into()),
        schema_version: user_version(&lib.conn)?,
        file_size: std::fs::metadata(&lib.path).map(|m| m.len()).unwrap_or(0),
        footage_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir() -> PathBuf {
        let p = std::env::temp_dir().join(format!("stash-test-{}", rand::random::<u64>()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn create_then_open_roundtrips_and_forces_extension() {
        let dir = tmpdir();
        let lib = create(&dir.join("My Library")).unwrap();
        assert!(lib.path.to_string_lossy().ends_with(".footagedb"));
        let path = lib.path.clone();
        drop(lib);

        let reopened = open(&path).unwrap();
        assert_eq!(user_version(&reopened.conn).unwrap(), APP_SCHEMA_VERSION);
        std::fs::remove_dir_all(dir).ok();
    }

    /// A library must be a single file with no sidecars, or "copy it to another
    /// computer" silently loses data.
    #[test]
    fn open_library_leaves_no_wal_sidecars() {
        let dir = tmpdir();
        let lib = create(&dir.join("solo")).unwrap();
        lib.conn
            .execute(
                "INSERT INTO footages (display_name, media_type, date_added, date_modified)
                 VALUES ('a','video','t','t')",
                [],
            )
            .unwrap();

        let files: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(files.len(), 1, "expected exactly one file, got {files:?}");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn rejects_a_foreign_sqlite_file() {
        let dir = tmpdir();
        let path = dir.join("notours.footagedb");
        Connection::open(&path)
            .unwrap()
            .execute_batch("CREATE TABLE unrelated (x)")
            .unwrap();

        assert!(matches!(open(&path), Err(AppError::NotALibrary(_))));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn refuses_a_library_from_a_newer_build() {
        let dir = tmpdir();
        let lib = create(&dir.join("future")).unwrap();
        let path = lib.path.clone();
        lib.conn
            .pragma_update(None, "user_version", (APP_SCHEMA_VERSION + 5) as i64)
            .unwrap();
        drop(lib);

        let Err(err) = open(&path) else {
            panic!("a library from a newer build must be refused");
        };
        assert!(matches!(err, AppError::LibraryTooNew { .. }));

        // The message is the whole feature: it has to name the app version the
        // user is running and tell them what to do about it.
        let msg = err.to_string();
        assert!(msg.contains(env!("CARGO_PKG_VERSION")), "names this build: {msg}");
        assert!(msg.contains("not compatible"), "says so plainly: {msg}");
        assert!(msg.contains("Update"), "says which way out: {msg}");

        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn save_as_snapshot_contains_the_data() {
        let dir = tmpdir();
        let lib = create(&dir.join("orig")).unwrap();
        lib.conn
            .execute(
                "INSERT INTO footages (display_name, media_type, date_added, date_modified)
                 VALUES ('kept.mov','video','t','t')",
                [],
            )
            .unwrap();

        let copy = vacuum_into(&lib.conn, &dir.join("copy")).unwrap();
        let opened = open(&copy).unwrap();
        let name: String = opened
            .conn
            .query_row("SELECT display_name FROM footages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "kept.mov");
        std::fs::remove_dir_all(dir).ok();
    }
}
