//! Ordered, append-only schema migrations.
//!
//! Rules (see ARCHITECTURE.md §2.4):
//!   * A shipped migration is NEVER edited. Fix forward with a new one.
//!   * The runner is driven by `PRAGMA user_version`, which lives in the SQLite
//!     header and can therefore be read before trusting any table.
//!   * A backup is taken before any migration runs.

use crate::error::{AppError, Result};
use rusqlite::Connection;

/// Schema version this build understands. Bump when adding a migration.
pub const APP_SCHEMA_VERSION: u32 = 10;

/// `PRAGMA application_id` — "STAH" as big-endian ASCII. Marks the file as ours
/// without needing to read a table, and survives copying between machines.
pub const APPLICATION_ID: i32 = 0x5354_4148;

const MIGRATIONS: &[(u32, &str)] = &[
    (1, M1_INITIAL),
    (2, M2_SOURCE_FOLDER_METADATA),
    (3, M3_SOURCE_FOLDER_TOUCHED),
    (4, M4_BRANDS),
    (5, M5_BRAND_RULES_AND_ELEMENTS),
    (6, M6_BRAND_ADDITIONAL_INFO),
    (7, M7_TYPEFACE_FONT_FILE),
    (8, M8_BRAND_ASSET_FLAG),
    (9, M9_FOLDER_BRAND),
    (10, M10_FOLDER_DISPLAY_NAME),
];

const M1_INITIAL: &str = r#"
-- ── user metadata: authored by the user, never overwritten by any sync ──────
CREATE TABLE footages (
  id             INTEGER PRIMARY KEY,
  display_name   TEXT    NOT NULL,
  media_type     TEXT    NOT NULL DEFAULT 'unknown',
  notes          TEXT    NOT NULL DEFAULT '',
  rating         INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  favorite       INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0,1)),
  date_added     TEXT    NOT NULL,
  date_modified  TEXT    NOT NULL,
  -- Derived from footage_usage and maintained exclusively by the triggers at the
  -- bottom of this migration. Application code must never write these columns.
  usage_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at   TEXT
);

CREATE INDEX ix_footages_added    ON footages(date_added DESC);
CREATE INDEX ix_footages_name     ON footages(display_name COLLATE NOCASE);
CREATE INDEX ix_footages_usage    ON footages(usage_count);
CREATE INDEX ix_footages_lastused ON footages(last_used_at DESC);
CREATE INDEX ix_footages_fav      ON footages(favorite) WHERE favorite = 1;
CREATE INDEX ix_footages_type     ON footages(media_type);
CREATE INDEX ix_footages_rating   ON footages(rating);

-- ── where it lives + whatever the provider reported about it ────────────────
-- Intentionally provider-agnostic: adding Dropbox/S3/NAS later is a new
-- `provider` value, not a migration of the footages table.
CREATE TABLE sources (
  footage_id         INTEGER PRIMARY KEY REFERENCES footages(id) ON DELETE CASCADE,
  provider           TEXT NOT NULL,
  external_id        TEXT,
  external_key       TEXT,          -- Drive resourceKey, required by some old shares
  original_url       TEXT,          -- exactly as the user supplied it
  local_path         TEXT,
  container_id       TEXT,
  container_path     TEXT,
  original_filename  TEXT,
  mime_type          TEXT,
  file_size          INTEGER,
  width              INTEGER,
  height             INTEGER,
  duration_ms        INTEGER,
  source_created_at  TEXT,
  source_modified_at TEXT,
  accessibility      TEXT NOT NULL DEFAULT 'unknown',
  last_synced_at     TEXT
);

-- Canonical identity for dedupe (§30). A rename in Drive changes the filename,
-- never the id, so renamed files are not re-imported as new footage.
CREATE UNIQUE INDEX ux_sources_external
  ON sources(provider, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX ux_sources_local
  ON sources(provider, local_path) WHERE local_path IS NOT NULL;
CREATE INDEX ix_sources_provider  ON sources(provider);
CREATE INDEX ix_sources_container ON sources(container_id);
CREATE INDEX ix_sources_access    ON sources(accessibility);

-- ── portable thumbnails ─────────────────────────────────────────────────────
-- Separate table so that listing footage never drags BLOB pages through cache.
CREATE TABLE thumbnails (
  footage_id INTEGER PRIMARY KEY REFERENCES footages(id) ON DELETE CASCADE,
  data       BLOB    NOT NULL,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  origin     TEXT    NOT NULL DEFAULT 'provider',
  pinned     INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  updated_at TEXT    NOT NULL
);

-- ── usage ───────────────────────────────────────────────────────────────────
CREATE TABLE projects (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color      TEXT,
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE footage_usage (
  id         INTEGER PRIMARY KEY,
  footage_id INTEGER NOT NULL REFERENCES footages(id) ON DELETE CASCADE,
  project_id INTEGER          REFERENCES projects(id) ON DELETE SET NULL,
  used_at    TEXT NOT NULL,
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX ix_usage_footage ON footage_usage(footage_id);
CREATE INDEX ix_usage_project ON footage_usage(project_id);
CREATE INDEX ix_usage_date    ON footage_usage(used_at DESC);

-- ── tags ────────────────────────────────────────────────────────────────────
CREATE TABLE tags (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE footage_tags (
  footage_id INTEGER NOT NULL REFERENCES footages(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id)     ON DELETE CASCADE,
  PRIMARY KEY (footage_id, tag_id)
);
CREATE INDEX ix_footage_tags_tag ON footage_tags(tag_id);

-- ── collections ─────────────────────────────────────────────────────────────
CREATE TABLE collections (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL
);
CREATE TABLE collection_footages (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  footage_id    INTEGER NOT NULL REFERENCES footages(id)    ON DELETE CASCADE,
  added_at      TEXT NOT NULL,
  PRIMARY KEY (collection_id, footage_id)
);
CREATE INDEX ix_coll_footage ON collection_footages(footage_id);

-- ── remembered containers (Drive folders, local dirs) ───────────────────────
CREATE TABLE source_containers (
  id              INTEGER PRIMARY KEY,
  provider        TEXT NOT NULL,
  external_id     TEXT,
  name            TEXT NOT NULL,
  path            TEXT NOT NULL DEFAULT '',
  original_url    TEXT,
  last_scanned_at TEXT,
  UNIQUE (provider, external_id)
);

CREATE TABLE app_metadata (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ── usage_count / last_used_at are trigger-owned ────────────────────────────
-- This is what makes "Used" a derived fact (§16) while keeping Unused / Recently
-- Used / Most Used index-backed instead of correlated subqueries.
CREATE TRIGGER trg_usage_ai AFTER INSERT ON footage_usage BEGIN
  UPDATE footages SET
    usage_count  = (SELECT COUNT(*)      FROM footage_usage WHERE footage_id = NEW.footage_id),
    last_used_at = (SELECT MAX(used_at)  FROM footage_usage WHERE footage_id = NEW.footage_id)
  WHERE id = NEW.footage_id;
END;

CREATE TRIGGER trg_usage_ad AFTER DELETE ON footage_usage BEGIN
  UPDATE footages SET
    usage_count  = (SELECT COUNT(*)      FROM footage_usage WHERE footage_id = OLD.footage_id),
    last_used_at = (SELECT MAX(used_at)  FROM footage_usage WHERE footage_id = OLD.footage_id)
  WHERE id = OLD.footage_id;
END;

CREATE TRIGGER trg_usage_au AFTER UPDATE ON footage_usage BEGIN
  UPDATE footages SET
    usage_count  = (SELECT COUNT(*)      FROM footage_usage WHERE footage_id = NEW.footage_id),
    last_used_at = (SELECT MAX(used_at)  FROM footage_usage WHERE footage_id = NEW.footage_id)
  WHERE id IN (NEW.footage_id, OLD.footage_id);
END;
"#;

// Folder metadata belongs to the library, not the local app preferences: a
// shared .footagedb must retain the team's source-folder labels and columns.
const M2_SOURCE_FOLDER_METADATA: &str = r#"
CREATE TABLE source_folder_tags (
  container_path TEXT NOT NULL,
  tag_id         INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (container_path, tag_id)
);
CREATE INDEX ix_source_folder_tags_tag ON source_folder_tags(tag_id);

CREATE TABLE source_folder_fields (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL
);

CREATE TABLE source_folder_field_values (
  container_path TEXT NOT NULL,
  field_id       INTEGER NOT NULL REFERENCES source_folder_fields(id) ON DELETE CASCADE,
  value          TEXT NOT NULL,
  PRIMARY KEY (container_path, field_id)
);
"#;

// A source folder has no row of its own — it is derived from `sources.container_path`
// — so an edit to its tags or columns has nowhere to leave a timestamp. This table is
// that one place. "Created" stays derived (the oldest footage added from the folder).
const M3_SOURCE_FOLDER_TOUCHED: &str = r#"
CREATE TABLE source_folder_meta (
  container_path TEXT PRIMARY KEY,
  updated_at     TEXT NOT NULL
);
"#;

// Brand guidelines. Three deliberate choices here:
//
//   * A logo points at a footage row rather than carrying its own path, so a
//     brand's files live in the asset library exactly once (§ the README's
//     "referenced, not duplicated"). ON DELETE SET NULL keeps the logo entry —
//     with its variant and usage notes — when the asset is removed.
//   * Colours store hex only. RGB and CMYK are derived; storing all three
//     invites the three drifting apart, and honest CMYK needs an ICC profile
//     this app has no business owning.
//   * `position` orders entries inside a role, because a palette's order is
//     meaning, not decoration.
const M4_BRANDS: &str = r#"
CREATE TABLE brands (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  tagline     TEXT NOT NULL DEFAULT '',
  website     TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  cover_footage_id INTEGER REFERENCES footages(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE brand_colors (
  id       INTEGER PRIMARY KEY,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  role     TEXT NOT NULL,
  name     TEXT NOT NULL,
  hex      TEXT NOT NULL,
  notes    TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_brand_colors_brand ON brand_colors(brand_id);

CREATE TABLE brand_typefaces (
  id             INTEGER PRIMARY KEY,
  brand_id       INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  role           TEXT NOT NULL,
  family         TEXT NOT NULL,
  weight         TEXT NOT NULL DEFAULT '',
  size           TEXT NOT NULL DEFAULT '',
  line_height    TEXT NOT NULL DEFAULT '',
  letter_spacing TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',
  position       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_brand_typefaces_brand ON brand_typefaces(brand_id);

CREATE TABLE brand_logos (
  id         INTEGER PRIMARY KEY,
  brand_id   INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  variant    TEXT NOT NULL,
  name       TEXT NOT NULL,
  footage_id INTEGER REFERENCES footages(id) ON DELETE SET NULL,
  notes      TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_brand_logos_brand ON brand_logos(brand_id);
"#;

// Logo usage rules and graphic elements.
//
// `brand_logo_rules` is keyed by brand rather than by logo: clear space and
// minimum size are properties of the mark, and restating them per variant is
// how two variants end up disagreeing.
//
// `brand_examples` carries a `section` column because do/don't pairs recur
// across the guideline (photography, motion, icons). Only 'logo' is wired to a
// screen today; the column exists so those sections reuse this table instead of
// each growing a near-identical one.
const M5_BRAND_RULES_AND_ELEMENTS: &str = r#"
CREATE TABLE brand_logo_rules (
  brand_id         INTEGER PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  clear_space      TEXT NOT NULL DEFAULT '',
  minimum_size     TEXT NOT NULL DEFAULT '',
  background_usage TEXT NOT NULL DEFAULT '',
  updated_at       TEXT NOT NULL
);

CREATE TABLE brand_examples (
  id         INTEGER PRIMARY KEY,
  brand_id   INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  section    TEXT NOT NULL DEFAULT 'logo',
  verdict    TEXT NOT NULL CHECK (verdict IN ('correct','incorrect')),
  caption    TEXT NOT NULL DEFAULT '',
  footage_id INTEGER REFERENCES footages(id) ON DELETE SET NULL,
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_brand_examples_brand ON brand_examples(brand_id, section);

CREATE TABLE brand_elements (
  id         INTEGER PRIMARY KEY,
  brand_id   INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  category   TEXT NOT NULL,
  name       TEXT NOT NULL,
  footage_id INTEGER REFERENCES footages(id) ON DELETE SET NULL,
  notes      TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_brand_elements_brand ON brand_elements(brand_id);
"#;

pub fn user_version(conn: &Connection) -> Result<u32> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? as u32)
}

const M6_BRAND_ADDITIONAL_INFO: &str = r#"
CREATE TABLE brand_additional_infos (
  id             INTEGER PRIMARY KEY,
  brand_id       INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  editor_mode    TEXT NOT NULL,
  content_type   TEXT NOT NULL,
  content        TEXT NOT NULL,
  file_reference TEXT,
  position       INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL
);
CREATE INDEX ix_brand_additional_infos_brand ON brand_additional_infos(brand_id);
"#;

// The path, not the bytes: a brand font is often tens of megabytes and already
// lives somewhere the user manages. A moved file costs a preview, not the entry.
const M7_TYPEFACE_FONT_FILE: &str = r#"
ALTER TABLE brand_typefaces ADD COLUMN font_file TEXT;
"#;

/// A file brought in from the brand page was never meant for the shot list, and
/// the brand link alone cannot say so: cancelling the logo dialog, unlinking, or
/// deleting the logo all leave the imported row behind with nothing pointing at
/// it. The flag records the intent at import time, so the leak has no path.
const M8_BRAND_ASSET_FLAG: &str = r#"
ALTER TABLE footages ADD COLUMN brand_asset INTEGER NOT NULL DEFAULT 0
  CHECK (brand_asset IN (0,1));
"#;

/// Which brand a source folder belongs to. One brand per folder: a shoot folder
/// is for a client, not shared between them — and `SET NULL` means deleting a
/// brand loses the label, never the folder.
const M9_FOLDER_BRAND: &str = r#"
ALTER TABLE source_folder_meta ADD COLUMN brand_id INTEGER
  REFERENCES brands(id) ON DELETE SET NULL;
"#;

/// A label the user gives a source folder. The path stays the identity — it is
/// what every footage row points at — so this is a second name shown next to it,
/// never a replacement for it.
const M10_FOLDER_DISPLAY_NAME: &str = r#"
ALTER TABLE source_folder_meta ADD COLUMN display_name TEXT;
"#;

pub fn application_id(conn: &Connection) -> Result<i32> {
    Ok(conn.query_row("PRAGMA application_id", [], |r| r.get::<_, i64>(0))? as i32)
}

/// Applies every migration above `from`, in one transaction, and stamps the new
/// version. Callers are responsible for taking the backup first — a rollback can
/// undo a failed statement, but not a file that was already damaged.
pub fn migrate(conn: &mut Connection, from: u32) -> Result<()> {
    let tx = conn.transaction()?;
    for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v > from) {
        tx.execute_batch(sql)
            .map_err(|e| AppError::Migration(format!("v{version}: {e}")))?;
    }
    tx.pragma_update(None, "user_version", APP_SCHEMA_VERSION as i64)?;
    tx.pragma_update(None, "application_id", APPLICATION_ID as i64)?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&mut c, 0).unwrap();
        c
    }

    #[test]
    fn migrates_from_empty_and_stamps_version() {
        let c = fresh();
        assert_eq!(user_version(&c).unwrap(), APP_SCHEMA_VERSION);
        assert_eq!(application_id(&c).unwrap(), APPLICATION_ID);
    }

    #[test]
    fn migration_is_idempotent_at_current_version() {
        let mut c = fresh();
        // Re-running with `from == current` must apply nothing and not error.
        migrate(&mut c, APP_SCHEMA_VERSION).unwrap();
        assert_eq!(user_version(&c).unwrap(), APP_SCHEMA_VERSION);
    }

    /// The core invariant of §16: usage status is derived, and cannot drift.
    #[test]
    fn usage_count_is_maintained_by_triggers() {
        let c = fresh();
        c.execute(
            "INSERT INTO footages (id, display_name, media_type, date_added, date_modified)
             VALUES (1, 'clip.mov', 'video', '2026-08-15', '2026-08-15')",
            [],
        )
        .unwrap();

        let count = |c: &Connection| -> i64 {
            c.query_row("SELECT usage_count FROM footages WHERE id = 1", [], |r| {
                r.get(0)
            })
            .unwrap()
        };
        let last = |c: &Connection| -> Option<String> {
            c.query_row("SELECT last_used_at FROM footages WHERE id = 1", [], |r| {
                r.get(0)
            })
            .unwrap()
        };

        assert_eq!(count(&c), 0, "new footage starts Unused");

        c.execute(
            "INSERT INTO footage_usage (footage_id, project_id, used_at, created_at)
             VALUES (1, NULL, '2026-08-14', '2026-08-14')",
            [],
        )
        .unwrap();
        assert_eq!(count(&c), 1);
        assert_eq!(last(&c).as_deref(), Some("2026-08-14"));

        c.execute(
            "INSERT INTO footage_usage (footage_id, project_id, used_at, created_at)
             VALUES (1, NULL, '2026-08-15', '2026-08-15')",
            [],
        )
        .unwrap();
        assert_eq!(count(&c), 2);
        assert_eq!(last(&c).as_deref(), Some("2026-08-15"), "tracks the latest");

        // Deleting every usage record must return the footage to Unused (§16).
        c.execute("DELETE FROM footage_usage WHERE footage_id = 1", [])
            .unwrap();
        assert_eq!(count(&c), 0);
        assert_eq!(last(&c), None);
    }

    #[test]
    fn duplicate_drive_ids_are_rejected_but_null_ids_are_not() {
        let c = fresh();
        for id in 1..=3 {
            c.execute(
                "INSERT INTO footages (id, display_name, media_type, date_added, date_modified)
                 VALUES (?1, 'x', 'video', '2026-08-15', '2026-08-15')",
                [id],
            )
            .unwrap();
        }
        let ins = |c: &Connection, fid: i64, ext: Option<&str>| {
            c.execute(
                "INSERT INTO sources (footage_id, provider, external_id) VALUES (?1,'google_drive',?2)",
                rusqlite::params![fid, ext],
            )
        };
        ins(&c, 1, Some("ABC")).unwrap();
        assert!(ins(&c, 2, Some("ABC")).is_err(), "same Drive id rejected");
        // Link-mode rows without an id must still be insertable, repeatedly.
        ins(&c, 2, None).unwrap();
        ins(&c, 3, None).unwrap();
    }

    #[test]
    fn deleting_footage_cascades_but_keeps_projects() {
        let c = fresh();
        c.execute(
            "INSERT INTO footages (id, display_name, media_type, date_added, date_modified)
             VALUES (1,'a','video','2026-08-15','2026-08-15')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO projects (id, name, created_at) VALUES (1,'Promo','2026-08-15')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO footage_usage (footage_id, project_id, used_at, created_at)
             VALUES (1,1,'2026-08-15','2026-08-15')",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO thumbnails (footage_id,data,width,height,updated_at)
                   VALUES (1, X'00', 1, 1, '2026-08-15')", []).unwrap();

        c.execute("DELETE FROM footages WHERE id = 1", []).unwrap();

        let usage: i64 = c
            .query_row("SELECT COUNT(*) FROM footage_usage", [], |r| r.get(0))
            .unwrap();
        let thumbs: i64 = c
            .query_row("SELECT COUNT(*) FROM thumbnails", [], |r| r.get(0))
            .unwrap();
        let projects: i64 = c
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        assert_eq!((usage, thumbs, projects), (0, 0, 1), "project outlives footage");
    }
}
