use crate::db::models::{FolderField, FolderFieldValue};
use crate::db::repo::taxonomy;
use crate::error::{AppError, Result};
use crate::util::now_iso;
use rusqlite::{params, Connection, OptionalExtension};

pub fn fields(conn: &Connection) -> Result<Vec<FolderField>> {
    let mut stmt = conn.prepare("SELECT id, name FROM source_folder_fields ORDER BY name COLLATE NOCASE")?;
    let rows = stmt
        .query_map([], |r| Ok(FolderField { id: r.get(0)?, name: r.get(1)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn create_field(conn: &Connection, name: &str) -> Result<i64> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 64 {
        return Err(AppError::Invalid("Column name must be 1–64 characters".into()));
    }
    conn.execute("INSERT INTO source_folder_fields (name, created_at) VALUES (?1, ?2)", params![name, now_iso()])?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_field(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM source_folder_fields WHERE id = ?1", [id])?;
    Ok(())
}

/// Drops a whole source folder from the catalog: every footage record inside it
/// plus the folder's own tags and column values. Like [`footage::remove`], this
/// never touches Drive or the filesystem — the app has no delete path to any
/// source (§17). Returns how many footage records went.
pub fn delete_folder(conn: &mut Connection, path: &str) -> Result<usize> {
    let path = path.trim();
    if path.is_empty() {
        return Err(AppError::Invalid("Folder path cannot be empty".into()));
    }
    let tx = conn.transaction()?;
    let n = tx.execute(
        "DELETE FROM footages WHERE id IN (SELECT footage_id FROM sources WHERE container_path = ?1)",
        [path],
    )?;
    // Metadata is keyed by path, not by footage, so no cascade reaches it.
    tx.execute("DELETE FROM source_folder_tags WHERE container_path = ?1", [path])?;
    tx.execute("DELETE FROM source_folder_field_values WHERE container_path = ?1", [path])?;
    tx.execute("DELETE FROM source_folder_meta WHERE container_path = ?1", [path])?;
    tx.commit()?;
    Ok(n)
}

/// Stamps a folder as edited. Every write to folder tags or columns routes through
/// here so the Source Folders table can show when the metadata last changed.
fn touch(conn: &Connection, path: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO source_folder_meta (container_path, updated_at) VALUES (?1, ?2)
         ON CONFLICT(container_path) DO UPDATE SET updated_at = excluded.updated_at",
        params![path, now_iso()],
    )?;
    Ok(())
}

pub fn set_tags(conn: &Connection, path: &str, tags: &[String]) -> Result<()> {
    let path = path.trim();
    if path.is_empty() { return Err(AppError::Invalid("Folder path cannot be empty".into())); }
    conn.execute("DELETE FROM source_folder_tags WHERE container_path = ?1", [path])?;
    for tag in tags {
        let tag = taxonomy::normalize_tag(tag).ok_or_else(|| AppError::Invalid("Invalid folder tag".into()))?;
        conn.execute("INSERT INTO tags (name) VALUES (?1) ON CONFLICT(name) DO NOTHING", [&tag])?;
        conn.execute("INSERT OR IGNORE INTO source_folder_tags (container_path, tag_id) SELECT ?1, id FROM tags WHERE name = ?2", params![path, tag])?;
    }
    touch(conn, path)
}

/// Assigns the folder to a brand, or to none. Unlike tags and columns this is a
/// real reference: renaming the brand renames the label everywhere it is shown.
pub fn set_brand(conn: &Connection, path: &str, brand_id: Option<i64>) -> Result<()> {
    let path = path.trim();
    if path.is_empty() { return Err(AppError::Invalid("Folder path cannot be empty".into())); }
    touch(conn, path)?;
    conn.execute(
        "UPDATE source_folder_meta SET brand_id = ?2 WHERE container_path = ?1",
        params![path, brand_id],
    )?;
    Ok(())
}

/// The brand newly catalogued folders start on, or none.
///
/// Kept in the library file rather than app prefs because a brand id only means
/// anything inside the library that defines it — a default in prefs would point
/// at an unrelated brand the moment a second library is opened.
pub fn default_brand(conn: &Connection) -> Result<Option<i64>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM app_metadata WHERE key = 'default_brand_id'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    Ok(raw.and_then(|v| v.parse().ok()))
}

pub fn set_default_brand(conn: &Connection, brand_id: Option<i64>) -> Result<()> {
    match brand_id {
        Some(id) => conn.execute(
            "INSERT INTO app_metadata (key, value) VALUES ('default_brand_id', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [id.to_string()],
        )?,
        None => conn.execute("DELETE FROM app_metadata WHERE key = 'default_brand_id'", [])?,
    };
    Ok(())
}

/// Whether a tag on a folder also counts for every file inside it.
///
/// Off by default, because a folder tag labels the folder. Turning it on is what
/// makes "bestie" mean the 776 clips sitting in the five folders that carry it
/// rather than the five folders themselves — and it has to move the grid filter
/// with the count, or the sidebar advertises a number the grid cannot produce.
pub fn folder_tags_cover_files(conn: &Connection) -> Result<bool> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM app_metadata WHERE key = 'folder_tags_cover_files'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    Ok(raw.as_deref() == Some("1"))
}

pub fn set_folder_tags_cover_files(conn: &Connection, on: bool) -> Result<()> {
    conn.execute(
        "INSERT INTO app_metadata (key, value) VALUES ('folder_tags_cover_files', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [if on { "1" } else { "0" }],
    )?;
    Ok(())
}

/// Stamps the folders these footage rows landed in with the library's default
/// brand, if one is set.
///
/// `DO NOTHING` on conflict is the whole point: a folder that already has a meta
/// row has been touched by hand, and overwriting it would re-brand folders the
/// user deliberately left blank every time they import one more file into them.
pub fn apply_default_brand(conn: &Connection, footage_ids: &[i64]) -> Result<()> {
    let Some(brand_id) = default_brand(conn)? else { return Ok(()) };
    if footage_ids.is_empty() {
        return Ok(());
    }
    // Ids come from this database, not from the caller, so joining them into the
    // statement cannot carry anything but digits.
    let ids = footage_ids.iter().map(i64::to_string).collect::<Vec<_>>().join(",");
    conn.execute(
        &format!(
            "INSERT INTO source_folder_meta (container_path, updated_at, brand_id)
             SELECT DISTINCT container_path, ?1, ?2 FROM sources
             WHERE footage_id IN ({ids})
               AND container_path IS NOT NULL AND container_path <> ''
             ON CONFLICT(container_path) DO NOTHING"
        ),
        params![now_iso(), brand_id],
    )?;
    Ok(())
}

pub fn set_field_value(conn: &Connection, path: &str, field_id: i64, value: &str) -> Result<()> {
    let value = value.trim();
    if value.chars().count() > 256 { return Err(AppError::Invalid("Column value is too long".into())); }
    if value.is_empty() {
        conn.execute("DELETE FROM source_folder_field_values WHERE container_path = ?1 AND field_id = ?2", params![path, field_id])?;
    } else {
        conn.execute("INSERT INTO source_folder_field_values (container_path, field_id, value) VALUES (?1, ?2, ?3) ON CONFLICT(container_path, field_id) DO UPDATE SET value = excluded.value", params![path, field_id, value])?;
    }
    touch(conn, path)
}

pub fn values(conn: &Connection, path: &str) -> Result<Vec<FolderFieldValue>> {
    let mut stmt = conn.prepare("SELECT f.id, f.name, v.value FROM source_folder_field_values v JOIN source_folder_fields f ON f.id = v.field_id WHERE v.container_path = ?1 ORDER BY f.name COLLATE NOCASE")?;
    let rows = stmt
        .query_map([path], |r| Ok(FolderFieldValue { field_id: r.get(0)?, name: r.get(1)?, value: r.get(2)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::migrate;
    use crate::db::repo::footage;

    /// One clip in `Drive/KOL`, added and last modified in 2026.
    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&mut c, 0).unwrap();
        c.execute(
            "INSERT INTO footages (id, display_name, media_type, date_added, date_modified)
             VALUES (1, 'clip', 'video', '2026-01-05', '2026-02-10')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO sources (footage_id, provider, container_path) VALUES (1, 'local', 'Drive/KOL')",
            [],
        )
        .unwrap();
        c
    }

    #[test]
    fn folder_timestamps_track_creation_and_the_latest_edit() {
        let c = db();

        let f = footage::folders(&c).unwrap().remove(0);
        assert_eq!(f.added_at, "2026-01-05", "added is the oldest footage in the folder");
        assert_eq!(f.updated_at, "2026-02-10", "no metadata edit yet: newest footage edit wins");

        // Editing folder metadata has no footage row to stamp — it must still move `updated`.
        set_tags(&c, "Drive/KOL", &["test".into()]).unwrap();
        let f = footage::folders(&c).unwrap().remove(0);
        assert_eq!(f.added_at, "2026-01-05", "editing metadata never moves added");
        assert!(f.updated_at.as_str() > "2026-02-10", "tag edit moved updated: {}", f.updated_at);

        let field = create_field(&c, "Branch").unwrap();
        set_field_value(&c, "Drive/KOL", field, "Serang").unwrap();
        let after_field = footage::folders(&c).unwrap().remove(0).updated_at;
        assert!(after_field >= f.updated_at, "column edit moved updated too");
    }

    #[test]
    fn deleting_a_folder_takes_its_footage_and_its_metadata() {
        let mut c = db();
        let field = create_field(&c, "Branch").unwrap();
        set_tags(&c, "Drive/KOL", &["test".into()]).unwrap();
        set_field_value(&c, "Drive/KOL", field, "Serang").unwrap();

        assert_eq!(delete_folder(&mut c, "Drive/KOL").unwrap(), 1);
        assert!(footage::folders(&c).unwrap().is_empty(), "folder is gone from the table");
        assert!(values(&c, "Drive/KOL").unwrap().is_empty(), "column values went with it");
        let tags: i64 = c
            .query_row("SELECT COUNT(*) FROM source_folder_tags WHERE container_path = 'Drive/KOL'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tags, 0, "folder tags went with it");
        // The column itself is library-wide, so it must survive.
        assert_eq!(fields(&c).unwrap().len(), 1);
    }
}
