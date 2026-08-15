//! Portable thumbnail storage — the BLOBs that travel inside `.footagedb`.

use crate::error::Result;
use crate::util::now_iso;
use rusqlite::{params, Connection, OptionalExtension};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Origin {
    Provider,
    Custom,
    Generated,
}

impl Origin {
    pub fn as_str(self) -> &'static str {
        match self {
            Origin::Provider => "provider",
            Origin::Custom => "custom",
            Origin::Generated => "generated",
        }
    }
}

pub fn get(conn: &Connection, footage_id: i64) -> Result<Option<Vec<u8>>> {
    Ok(conn
        .query_row(
            "SELECT data FROM thumbnails WHERE footage_id = ?1",
            [footage_id],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn exists(conn: &Connection, footage_id: i64) -> Result<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM thumbnails WHERE footage_id = ?1",
            [footage_id],
            |_| Ok(true),
        )
        .optional()?
        .unwrap_or(false))
}

/// True when the user chose this thumbnail themselves.
///
/// Sync must consult this before replacing anything: if someone picked a frame
/// by hand, an automated refresh overwriting it is data loss (§7).
pub fn is_pinned(conn: &Connection, footage_id: i64) -> Result<bool> {
    Ok(conn
        .query_row(
            "SELECT pinned FROM thumbnails WHERE footage_id = ?1",
            [footage_id],
            |r| r.get::<_, i64>(0),
        )
        .optional()?
        .map(|p| p != 0)
        .unwrap_or(false))
}

pub fn put(
    conn: &Connection,
    footage_id: i64,
    data: &[u8],
    width: u32,
    height: u32,
    origin: Origin,
) -> Result<()> {
    let pinned = matches!(origin, Origin::Custom) as i64;
    conn.execute(
        "INSERT INTO thumbnails (footage_id, data, width, height, origin, pinned, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(footage_id) DO UPDATE SET
           data = excluded.data, width = excluded.width, height = excluded.height,
           origin = excluded.origin, pinned = excluded.pinned, updated_at = excluded.updated_at",
        params![
            footage_id,
            data,
            width as i64,
            height as i64,
            origin.as_str(),
            pinned,
            now_iso()
        ],
    )?;
    Ok(())
}

pub fn clear(conn: &Connection, footage_id: i64) -> Result<()> {
    conn.execute("DELETE FROM thumbnails WHERE footage_id = ?1", [footage_id])?;
    Ok(())
}

/// Footage that would render as a placeholder, newest first — the work queue for
/// "refresh missing thumbnails" after a library arrives on a new machine (§9).
pub fn missing_ids(conn: &Connection, limit: i64) -> Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT f.id FROM footages f
         WHERE NOT EXISTS (SELECT 1 FROM thumbnails th WHERE th.footage_id = f.id)
         ORDER BY f.date_added DESC LIMIT ?1",
    )?;
    let rows = stmt
        .query_map([limit], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<i64>>>()?;
    Ok(rows)
}
