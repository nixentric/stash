//! Tags and collections — both are many-to-many labels that never move a file.

use crate::db::models::{Collection, Tag};
use crate::error::{AppError, Result};
use crate::util::now_iso;
use rusqlite::{params, Connection, OptionalExtension};

const MAX_TAG_LEN: usize = 64;

/// Trim, collapse inner whitespace, lowercase. Tags are compared case-insensitively
/// anyway (`COLLATE NOCASE`), so normalizing on write keeps the tag list tidy
/// instead of showing `iPhone`, `iphone` and `IPHONE` as three chips.
pub fn normalize_tag(raw: &str) -> Option<String> {
    let t = raw.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    if t.is_empty() || t.chars().count() > MAX_TAG_LEN {
        None
    } else {
        Some(t)
    }
}

fn tag_id(conn: &Connection, name: &str) -> Result<i64> {
    if let Some(id) = conn
        .query_row("SELECT id FROM tags WHERE name = ?1", [name], |r| r.get(0))
        .optional()?
    {
        return Ok(id);
    }
    conn.execute("INSERT INTO tags (name) VALUES (?1)", [name])?;
    Ok(conn.last_insert_rowid())
}

pub fn add_tags(conn: &Connection, footage_ids: &[i64], raw: &[String]) -> Result<()> {
    let names: Vec<String> = raw.iter().filter_map(|t| normalize_tag(t)).collect();
    for name in &names {
        let tid = tag_id(conn, name)?;
        for fid in footage_ids {
            conn.execute(
                "INSERT OR IGNORE INTO footage_tags (footage_id, tag_id) VALUES (?1, ?2)",
                params![fid, tid],
            )?;
        }
    }
    Ok(())
}

pub fn remove_tags(conn: &Connection, footage_ids: &[i64], raw: &[String]) -> Result<()> {
    for name in raw.iter().filter_map(|t| normalize_tag(t)) {
        for fid in footage_ids {
            conn.execute(
                "DELETE FROM footage_tags WHERE footage_id = ?1
                   AND tag_id = (SELECT id FROM tags WHERE name = ?2)",
                params![fid, name],
            )?;
        }
    }
    prune_orphan_tags(conn)
}

pub fn set_tags(conn: &Connection, footage_id: i64, raw: &[String]) -> Result<()> {
    conn.execute("DELETE FROM footage_tags WHERE footage_id = ?1", [footage_id])?;
    add_tags(conn, &[footage_id], raw)?;
    prune_orphan_tags(conn)
}

/// A tag with no footage is noise in autocomplete; drop it.
fn prune_orphan_tags(conn: &Connection) -> Result<()> {
    conn.execute(
        "DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM footage_tags)",
        [],
    )?;
    Ok(())
}

pub fn tags_for(conn: &Connection, footage_id: i64) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT t.name FROM footage_tags ft JOIN tags t ON t.id = ft.tag_id
         WHERE ft.footage_id = ?1 ORDER BY t.name COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map([footage_id], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(rows)
}

pub fn all_tags(conn: &Connection) -> Result<Vec<Tag>> {
    // The count must use the same definition as the tag filter in `query.rs`
    // (footage tag OR source-folder tag), otherwise the sidebar advertises a
    // number the grid cannot reproduce.
    // ponytail: correlated scan, O(tags × footages). Fine at library scale; if a
    // huge library drags, precompute into a counts table.
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name,
                (SELECT COUNT(*) FROM footages f LEFT JOIN sources s ON s.footage_id = f.id
                  WHERE EXISTS (SELECT 1 FROM footage_tags ft
                                 WHERE ft.footage_id = f.id AND ft.tag_id = t.id)
                     OR EXISTS (SELECT 1 FROM source_folder_tags sft
                                 WHERE sft.tag_id = t.id
                                   AND sft.container_path = s.container_path))
         FROM tags t ORDER BY 3 DESC, t.name COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Tag {
                id: r.get(0)?,
                name: r.get(1)?,
                footage_count: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

// ── collections ─────────────────────────────────────────────────────────────

pub fn create_collection(conn: &Connection, name: &str) -> Result<i64> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("Collection needs a name".into()));
    }
    if let Some(id) = conn
        .query_row("SELECT id FROM collections WHERE name = ?1", [name], |r| {
            r.get(0)
        })
        .optional()?
    {
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO collections (name, created_at) VALUES (?1, ?2)",
        params![name, now_iso()],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn rename_collection(conn: &Connection, id: i64, name: &str) -> Result<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("Collection needs a name".into()));
    }
    conn.execute(
        "UPDATE collections SET name = ?2 WHERE id = ?1",
        params![id, name],
    )?;
    Ok(())
}

pub fn delete_collection(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM collections WHERE id = ?1", [id])?;
    Ok(())
}

pub fn add_to_collection(conn: &Connection, collection_id: i64, footage_ids: &[i64]) -> Result<()> {
    let now = now_iso();
    for fid in footage_ids {
        conn.execute(
            "INSERT OR IGNORE INTO collection_footages (collection_id, footage_id, added_at)
             VALUES (?1, ?2, ?3)",
            params![collection_id, fid, now],
        )?;
    }
    Ok(())
}

pub fn remove_from_collection(
    conn: &Connection,
    collection_id: i64,
    footage_ids: &[i64],
) -> Result<()> {
    for fid in footage_ids {
        conn.execute(
            "DELETE FROM collection_footages WHERE collection_id = ?1 AND footage_id = ?2",
            params![collection_id, fid],
        )?;
    }
    Ok(())
}

pub fn collections_for(conn: &Connection, footage_id: i64) -> Result<Vec<Collection>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.name,
                (SELECT COUNT(*) FROM collection_footages x WHERE x.collection_id = c.id)
         FROM collection_footages cf JOIN collections c ON c.id = cf.collection_id
         WHERE cf.footage_id = ?1 ORDER BY c.name COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map([footage_id], |r| {
            Ok(Collection {
                id: r.get(0)?,
                name: r.get(1)?,
                footage_count: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn all_collections(conn: &Connection) -> Result<Vec<Collection>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.name, COUNT(cf.footage_id) FROM collections c
         LEFT JOIN collection_footages cf ON cf.collection_id = c.id
         GROUP BY c.id ORDER BY c.name COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Collection {
                id: r.get(0)?,
                name: r.get(1)?,
                footage_count: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::migrate;
    use crate::db::models::FootageQuery;
    use crate::db::repo::{footage, source_folder};

    /// Two clips in `Drive/Cabang Bandung`, one loose clip with no folder.
    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&mut c, 0).unwrap();
        for (id, path) in [(1, Some("Drive/Cabang Bandung")), (2, Some("Drive/Cabang Bandung")), (3, None)] {
            c.execute(
                "INSERT INTO footages (id, display_name, media_type, date_added, date_modified)
                 VALUES (?1, 'clip', 'video', '2026-08-01', '2026-08-01')",
                [id],
            )
            .unwrap();
            c.execute(
                "INSERT INTO sources (footage_id, provider, container_path) VALUES (?1, 'local', ?2)",
                params![id, path],
            )
            .unwrap();
        }
        c
    }

    #[test]
    fn a_folder_tag_finds_every_clip_in_that_folder() {
        let c = db();
        source_folder::set_tags(&c, "Drive/Cabang Bandung", &["Cabang Bandung".into()]).unwrap();

        let q = FootageQuery {
            tags: vec!["cabang bandung".into()],
            limit: 100,
            ..Default::default()
        };
        assert_eq!(footage::list(&c, &q).unwrap().total, 2, "folder tag must reach its clips");

        let tag = all_tags(&c).unwrap().into_iter().find(|t| t.name == "cabang bandung").unwrap();
        assert_eq!(tag.footage_count, 2, "sidebar badge must match what the filter returns");
    }

    #[test]
    fn folder_and_footage_tags_are_the_same_namespace_and_do_not_double_count() {
        let c = db();
        source_folder::set_tags(&c, "Drive/Cabang Bandung", &["cabang".into()]).unwrap();
        // Clip 1 also carries it directly; clip 3 is outside the folder.
        add_tags(&c, &[1, 3], &["cabang".into()]).unwrap();

        let tag = all_tags(&c).unwrap().into_iter().find(|t| t.name == "cabang").unwrap();
        assert_eq!(tag.footage_count, 3, "clip 1 counts once, not twice");
    }

    #[test]
    fn tag_normalization_collapses_case_and_whitespace() {
        assert_eq!(normalize_tag("  iPhone  ").as_deref(), Some("iphone"));
        assert_eq!(normalize_tag("White   Background").as_deref(), Some("white background"));
        assert_eq!(normalize_tag("   "), None);
        assert_eq!(normalize_tag(&"x".repeat(65)), None);
    }
}
