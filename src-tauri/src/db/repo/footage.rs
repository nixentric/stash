use super::query;
use crate::db::models::*;
use crate::error::{AppError, Result};
use crate::util::now_iso;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};

/// Tags are concatenated with U+001F (unit separator) rather than a comma so a
/// tag containing punctuation cannot split into two.
const TAG_SEP: char = '\u{1f}';

const LIST_COLUMNS: &str = r#"
    f.id, f.display_name, f.media_type, f.rating, f.favorite,
    f.usage_count, f.last_used_at, f.date_added,
    s.duration_ms, s.width, s.height,
    IFNULL(s.provider,'url'), IFNULL(s.accessibility,'unknown'),
    EXISTS (SELECT 1 FROM thumbnails th WHERE th.footage_id = f.id),
    (SELECT group_concat(t.name, char(31)) FROM footage_tags ft
       JOIN tags t ON t.id = ft.tag_id WHERE ft.footage_id = f.id)
"#;

fn list_item(r: &Row<'_>) -> rusqlite::Result<FootageListItem> {
    let tags: Option<String> = r.get(14)?;
    Ok(FootageListItem {
        id: r.get(0)?,
        display_name: r.get(1)?,
        media_type: MediaType::parse(&r.get::<_, String>(2)?),
        rating: r.get(3)?,
        favorite: r.get::<_, i64>(4)? != 0,
        usage_count: r.get(5)?,
        last_used_at: r.get(6)?,
        date_added: r.get(7)?,
        duration_ms: r.get(8)?,
        width: r.get(9)?,
        height: r.get(10)?,
        provider: r.get(11)?,
        accessibility: r.get(12)?,
        has_thumbnail: r.get::<_, i64>(13)? != 0,
        tags: tags
            .map(|t| t.split(TAG_SEP).map(str::to_string).collect())
            .unwrap_or_default(),
    })
}

/// One page of the grid plus the total match count.
///
/// Both halves run against the same filter so the "1,248 footages" readout can
/// never disagree with what is scrolling. Paging happens in SQL — the WebView
/// never receives more rows than it draws (ARCHITECTURE.md §7).
pub fn list(conn: &Connection, q: &FootageQuery) -> Result<FootagePage> {
    let f = query::build(q, super::source_folder::folder_tags_cover_files(conn)?);
    let limit = q.limit.clamp(1, 500);
    let offset = q.offset.max(0);

    let total: i64 = conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM footages f LEFT JOIN sources s ON s.footage_id = f.id {}",
            f.where_sql
        ),
        params_from_iter(f.params.iter()),
        |r| r.get(0),
    )?;

    let sql = format!(
        "SELECT {LIST_COLUMNS} FROM footages f LEFT JOIN sources s ON s.footage_id = f.id
         {} {} LIMIT ?  OFFSET ?",
        f.where_sql,
        query::order_by(q.sort)
    );

    let mut params = f.params.clone();
    params.push(rusqlite::types::Value::Integer(limit));
    params.push(rusqlite::types::Value::Integer(offset));

    let mut stmt = conn.prepare(&sql)?;
    let items = stmt
        .query_map(params_from_iter(params.iter()), list_item)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(FootagePage { items, total })
}

/// Ids only, in the same order as `list` — powers Select All and Quick Look
/// navigation without pulling every row's metadata.
pub fn list_ids(conn: &Connection, q: &FootageQuery) -> Result<Vec<i64>> {
    let f = query::build(q, super::source_folder::folder_tags_cover_files(conn)?);
    let sql = format!(
        "SELECT f.id FROM footages f LEFT JOIN sources s ON s.footage_id = f.id {} {}",
        f.where_sql,
        query::order_by(q.sort)
    );
    let mut stmt = conn.prepare(&sql)?;
    let ids = stmt
        .query_map(params_from_iter(f.params.iter()), |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<i64>>>()?;
    Ok(ids)
}

pub fn get(conn: &Connection, id: i64) -> Result<FootageDetail> {
    let (display_name, media_type, notes, rating, favorite, usage_count, last_used_at, date_added, date_modified) =
        conn.query_row(
            "SELECT display_name, media_type, notes, rating, favorite, usage_count,
                    last_used_at, date_added, date_modified
             FROM footages WHERE id = ?1",
            [id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, Option<String>>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, String>(8)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("Footage {id} is not in this library")))?;

    let source = get_source(conn, id)?;

    let (has_thumbnail, thumbnail_origin, thumbnail_pinned) = conn
        .query_row(
            "SELECT origin, pinned FROM thumbnails WHERE footage_id = ?1",
            [id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? != 0)),
        )
        .optional()?
        .map(|(o, p)| (true, Some(o), p))
        .unwrap_or((false, None, false));

    Ok(FootageDetail {
        id,
        display_name,
        media_type: MediaType::parse(&media_type),
        notes,
        rating,
        favorite: favorite != 0,
        usage_count,
        last_used_at,
        date_added,
        date_modified,
        source,
        tags: super::taxonomy::tags_for(conn, id)?,
        collections: super::taxonomy::collections_for(conn, id)?,
        usage: super::usage::history(conn, id)?,
        has_thumbnail,
        thumbnail_origin,
        thumbnail_pinned,
    })
}

pub fn get_source(conn: &Connection, footage_id: i64) -> Result<SourceInfo> {
    conn.query_row(
        "SELECT provider, external_id, external_key, original_url, local_path,
                container_id, container_path, original_filename, mime_type, file_size,
                width, height, duration_ms, source_created_at, source_modified_at,
                accessibility, last_synced_at
         FROM sources WHERE footage_id = ?1",
        [footage_id],
        |r| {
            Ok(SourceInfo {
                provider: r.get(0)?,
                external_id: r.get(1)?,
                external_key: r.get(2)?,
                original_url: r.get(3)?,
                local_path: r.get(4)?,
                container_id: r.get(5)?,
                container_path: r.get(6)?,
                original_filename: r.get(7)?,
                mime_type: r.get(8)?,
                file_size: r.get(9)?,
                width: r.get(10)?,
                height: r.get(11)?,
                duration_ms: r.get(12)?,
                source_created_at: r.get(13)?,
                source_modified_at: r.get(14)?,
                accessibility: r.get(15)?,
                last_synced_at: r.get(16)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("Footage {footage_id} has no source record")))
}

/// Existing footage id for a source identity, if any.
///
/// Identity is `(provider, external_id)` — never the filename — so a file
/// renamed in Drive resolves to the same record instead of importing twice (§30).
pub fn find_by_identity(
    conn: &Connection,
    provider: &str,
    external_id: Option<&str>,
    local_path: Option<&str>,
) -> Result<Option<i64>> {
    let found = if let Some(ext) = external_id {
        conn.query_row(
            "SELECT footage_id FROM sources WHERE provider = ?1 AND external_id = ?2",
            params![provider, ext],
            |r| r.get(0),
        )
        .optional()?
    } else if let Some(path) = local_path {
        conn.query_row(
            "SELECT footage_id FROM sources WHERE provider = ?1 AND local_path = ?2",
            params![provider, path],
            |r| r.get(0),
        )
        .optional()?
    } else {
        None
    };
    Ok(found)
}

pub fn insert(conn: &Connection, n: &NewFootage) -> Result<i64> {
    let name = n.display_name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("Footage needs a name".into()));
    }
    if name.chars().count() > 512 {
        return Err(AppError::Invalid("Name is too long".into()));
    }

    let media_type = n.media_type.unwrap_or_else(|| {
        MediaType::from_mime_or_name(
            n.mime_type.as_deref(),
            n.original_filename.as_deref().unwrap_or(name),
        )
    });
    let now = now_iso();

    conn.execute(
        "INSERT INTO footages (display_name, media_type, notes, date_added, date_modified, brand_asset)
         VALUES (?1, ?2, ?3, ?4, ?4, ?5)",
        params![name, media_type.as_str(), n.notes.clone().unwrap_or_default(), now, n.brand_asset],
    )?;
    let id = conn.last_insert_rowid();

    conn.execute(
        "INSERT INTO sources (footage_id, provider, external_id, external_key, original_url,
                              local_path, container_id, container_path, original_filename,
                              mime_type, file_size, width, height, duration_ms,
                              source_created_at, source_modified_at, accessibility)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,'unknown')",
        params![
            id,
            n.provider,
            n.external_id,
            n.external_key,
            n.original_url,
            n.local_path,
            n.container_id,
            n.container_path,
            n.original_filename,
            n.mime_type,
            n.file_size,
            n.width,
            n.height,
            n.duration_ms,
            n.source_created_at,
            n.source_modified_at,
        ],
    )?;

    if let Some(tags) = &n.tags {
        super::taxonomy::set_tags(conn, id, tags)?;
    }
    Ok(id)
}

pub fn patch(conn: &Connection, ids: &[i64], p: &FootagePatch) -> Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    if let Some(r) = p.rating {
        if !(0..=5).contains(&r) {
            return Err(AppError::Invalid("Rating must be 0–5".into()));
        }
    }
    if let Some(name) = &p.display_name {
        if name.trim().is_empty() {
            return Err(AppError::Invalid("Name cannot be empty".into()));
        }
        if ids.len() > 1 {
            return Err(AppError::Invalid(
                "Renaming applies to one footage at a time".into(),
            ));
        }
    }

    let now = now_iso();
    for id in ids {
        if let Some(v) = &p.display_name {
            conn.execute(
                "UPDATE footages SET display_name = ?2, date_modified = ?3 WHERE id = ?1",
                params![id, v.trim(), now],
            )?;
        }
        if let Some(v) = &p.notes {
            conn.execute(
                "UPDATE footages SET notes = ?2, date_modified = ?3 WHERE id = ?1",
                params![id, v, now],
            )?;
        }
        if let Some(v) = p.rating {
            conn.execute(
                "UPDATE footages SET rating = ?2, date_modified = ?3 WHERE id = ?1",
                params![id, v, now],
            )?;
        }
        if let Some(v) = p.favorite {
            conn.execute(
                "UPDATE footages SET favorite = ?2, date_modified = ?3 WHERE id = ?1",
                params![id, v as i64, now],
            )?;
        }
    }
    Ok(())
}

/// Removes catalog records only.
///
/// This never touches Google Drive or the local filesystem — the app has no
/// write scope and no delete path to any source (§17).
pub fn remove(conn: &mut Connection, ids: &[i64]) -> Result<usize> {
    let tx = conn.transaction()?;
    let mut n = 0;
    {
        let mut stmt = tx.prepare("DELETE FROM footages WHERE id = ?1")?;
        for id in ids {
            n += stmt.execute([id])?;
        }
    }
    tx.commit()?;
    Ok(n)
}

pub fn stats(conn: &Connection) -> Result<LibraryStats> {
    conn.query_row(
        "SELECT
           COUNT(*),
           SUM(CASE WHEN f.usage_count > 0 THEN 1 ELSE 0 END),
           SUM(CASE WHEN f.usage_count = 0 THEN 1 ELSE 0 END),
           SUM(CASE WHEN f.media_type = 'image' THEN 1 ELSE 0 END),
           SUM(CASE WHEN f.media_type = 'video' THEN 1 ELSE 0 END),
           SUM(CASE WHEN f.favorite = 1 THEN 1 ELSE 0 END),
           SUM(CASE WHEN s.accessibility = 'source_missing' THEN 1 ELSE 0 END),
           SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM thumbnails th WHERE th.footage_id = f.id)
                    THEN 1 ELSE 0 END)
         FROM footages f LEFT JOIN sources s ON s.footage_id = f.id
         WHERE f.brand_asset = 0
           AND NOT EXISTS (SELECT 1 FROM brand_logos bl WHERE bl.footage_id = f.id)",
        [],
        |r| {
            Ok(LibraryStats {
                total: r.get(0)?,
                used: r.get::<_, Option<i64>>(1)?.unwrap_or(0),
                unused: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                images: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
                videos: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                favorites: r.get::<_, Option<i64>>(5)?.unwrap_or(0),
                missing: r.get::<_, Option<i64>>(6)?.unwrap_or(0),
                without_thumbnail: r.get::<_, Option<i64>>(7)?.unwrap_or(0),
            })
        },
    )
    .map_err(Into::into)
}

/// Distinct source folders, for the Folders section of the sidebar.
pub fn folders(conn: &Connection) -> Result<Vec<FolderNode>> {
    let mut stmt = conn.prepare(
        // A folder has no row of its own: "added" is when its oldest footage entered the
        // library, "updated" is the later of a footage edit and a folder-metadata edit.
        "SELECT s.container_path, COUNT(*),
                SUM(CASE WHEN f.usage_count > 0 THEN 1 ELSE 0 END),
                SUM(CASE WHEN f.usage_count = 0 THEN 1 ELSE 0 END),
                (SELECT group_concat(t.name, char(31))
                   FROM source_folder_tags sft JOIN tags t ON t.id = sft.tag_id
                  WHERE sft.container_path = s.container_path),
                MIN(f.date_added),
                MAX(MAX(f.date_modified),
                    COALESCE((SELECT m.updated_at FROM source_folder_meta m
                               WHERE m.container_path = s.container_path), '')),
                (SELECT b.id FROM source_folder_meta m JOIN brands b ON b.id = m.brand_id
                  WHERE m.container_path = s.container_path),
                (SELECT b.name FROM source_folder_meta m JOIN brands b ON b.id = m.brand_id
                  WHERE m.container_path = s.container_path),
                (SELECT m.display_name FROM source_folder_meta m
                  WHERE m.container_path = s.container_path),
                -- Every Drive file in one container_path shares its parent, so any
                -- row's container_id is the folder's id.
                MAX(CASE WHEN s.provider = 'google_drive' THEN s.container_id END)
         FROM sources s JOIN footages f ON f.id = s.footage_id
         WHERE container_path IS NOT NULL AND container_path <> ''
         GROUP BY s.container_path ORDER BY s.container_path COLLATE NOCASE",
    )?;
    #[allow(clippy::type_complexity)]
    let rows: Vec<(String, i64, i64, i64, Option<String>, String, String, Option<i64>, Option<String>, Option<String>, Option<String>)> = stmt
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|(container_path, footage_count, used_count, unused_count, tags, added_at, updated_at, brand_id, brand_name, display_name, drive_folder_id)| {
            Ok(FolderNode {
                fields: super::source_folder::values(conn, &container_path)?,
                container_path,
                display_name,
                drive_folder_id,
                footage_count,
                used_count,
                unused_count,
                tags: tags.map(|v| v.split(TAG_SEP).map(str::to_string).collect()).unwrap_or_default(),
                brand_id,
                brand_name,
                added_at,
                updated_at,
            })
        })
        .collect()
}

pub fn set_accessibility(conn: &Connection, footage_id: i64, state: Accessibility) -> Result<()> {
    conn.execute(
        "UPDATE sources SET accessibility = ?2 WHERE footage_id = ?1",
        params![footage_id, state.as_str()],
    )?;
    Ok(())
}
