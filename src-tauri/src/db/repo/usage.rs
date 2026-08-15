//! Projects and usage history.
//!
//! "Used" is never written anywhere. It is `usage_count > 0`, and `usage_count`
//! is owned by triggers (see migrations.rs). Marking footage used means
//! *inserting a usage record*; un-marking it means deleting those records.

use crate::db::models::{Project, UsageRecord};
use crate::error::{AppError, Result};
use crate::util::{now_iso, today_iso};
use rusqlite::{params, Connection, OptionalExtension};

pub fn create_project(conn: &Connection, name: &str) -> Result<i64> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("Project needs a name".into()));
    }
    if name.chars().count() > 200 {
        return Err(AppError::Invalid("Project name is too long".into()));
    }
    if let Some(id) = conn
        .query_row("SELECT id FROM projects WHERE name = ?1", [name], |r| r.get(0))
        .optional()?
    {
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO projects (name, created_at) VALUES (?1, ?2)",
        params![name, now_iso()],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn rename_project(conn: &Connection, id: i64, name: &str) -> Result<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("Project needs a name".into()));
    }
    conn.execute("UPDATE projects SET name = ?2 WHERE id = ?1", params![id, name])?;
    Ok(())
}

/// Deleting a project keeps its usage records (they become "used, no project"),
/// because the fact that footage *was used* is history, not a reference.
pub fn delete_project(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    Ok(())
}

pub fn all_projects(conn: &Connection) -> Result<Vec<Project>> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.color, p.notes, p.created_at,
                COUNT(u.id), COUNT(DISTINCT u.footage_id)
         FROM projects p LEFT JOIN footage_usage u ON u.project_id = p.id
         GROUP BY p.id ORDER BY p.name COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Project {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                notes: r.get(3)?,
                created_at: r.get(4)?,
                usage_count: r.get(5)?,
                footage_count: r.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Records usage for a batch of footage.
///
/// `project_id == None` is the supported "Mark Used Without Project" path (§15).
pub fn mark_used(
    conn: &mut Connection,
    footage_ids: &[i64],
    project_id: Option<i64>,
    used_at: Option<&str>,
    notes: &str,
) -> Result<usize> {
    if let Some(pid) = project_id {
        let exists: bool = conn
            .query_row("SELECT 1 FROM projects WHERE id = ?1", [pid], |_| Ok(true))
            .optional()?
            .unwrap_or(false);
        if !exists {
            return Err(AppError::NotFound("That project no longer exists".into()));
        }
    }
    let used_at = used_at
        .map(str::to_string)
        .unwrap_or_else(today_iso);
    let now = now_iso();

    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO footage_usage (footage_id, project_id, used_at, notes, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        for fid in footage_ids {
            stmt.execute(params![fid, project_id, used_at, notes, now])?;
        }
    }
    tx.commit()?;
    Ok(footage_ids.len())
}

/// Clears all usage history for the given footage, which returns them to
/// Unused via the delete trigger.
pub fn mark_unused(conn: &mut Connection, footage_ids: &[i64]) -> Result<usize> {
    let tx = conn.transaction()?;
    let mut n = 0;
    {
        let mut stmt = tx.prepare("DELETE FROM footage_usage WHERE footage_id = ?1")?;
        for fid in footage_ids {
            n += stmt.execute([fid])?;
        }
    }
    tx.commit()?;
    Ok(n)
}

pub fn delete_usage(conn: &Connection, usage_id: i64) -> Result<()> {
    conn.execute("DELETE FROM footage_usage WHERE id = ?1", [usage_id])?;
    Ok(())
}

pub fn history(conn: &Connection, footage_id: i64) -> Result<Vec<UsageRecord>> {
    let mut stmt = conn.prepare(
        "SELECT u.id, u.project_id, p.name, u.used_at, u.notes
         FROM footage_usage u LEFT JOIN projects p ON p.id = u.project_id
         WHERE u.footage_id = ?1 ORDER BY u.used_at DESC, u.id DESC",
    )?;
    let rows = stmt
        .query_map([footage_id], |r| {
            Ok(UsageRecord {
                id: r.get(0)?,
                project_id: r.get(1)?,
                project_name: r.get(2)?,
                used_at: r.get(3)?,
                notes: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::migrate;

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&mut c, 0).unwrap();
        for i in 1..=3 {
            c.execute(
                "INSERT INTO footages (id, display_name, media_type, date_added, date_modified)
                 VALUES (?1, 'clip', 'video', '2026-08-01', '2026-08-01')",
                [i],
            )
            .unwrap();
        }
        c
    }

    fn count(c: &Connection, id: i64) -> i64 {
        c.query_row("SELECT usage_count FROM footages WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .unwrap()
    }

    #[test]
    fn one_footage_can_be_used_by_many_projects() {
        let mut c = db();
        let a = create_project(&c, "Project A").unwrap();
        let b = create_project(&c, "Project B").unwrap();

        mark_used(&mut c, &[1], Some(a), Some("2026-08-14"), "").unwrap();
        mark_used(&mut c, &[1], Some(b), Some("2026-08-15"), "second cut").unwrap();

        let h = history(&c, 1).unwrap();
        assert_eq!(h.len(), 2);
        assert_eq!(h[0].project_name.as_deref(), Some("Project B"), "newest first");
        assert_eq!(count(&c, 1), 2);
    }

    #[test]
    fn used_without_a_project_is_supported() {
        let mut c = db();
        mark_used(&mut c, &[2], None, None, "").unwrap();
        assert_eq!(count(&c, 2), 1);
        assert_eq!(history(&c, 2).unwrap()[0].project_name, None);
    }

    #[test]
    fn clearing_history_returns_footage_to_unused() {
        let mut c = db();
        let p = create_project(&c, "Promo").unwrap();
        mark_used(&mut c, &[1, 2, 3], Some(p), None, "").unwrap();
        assert_eq!((count(&c, 1), count(&c, 3)), (1, 1));

        mark_unused(&mut c, &[1]).unwrap();
        assert_eq!(count(&c, 1), 0, "back to Unused");
        assert_eq!(count(&c, 3), 1, "others untouched");
    }

    #[test]
    fn deleting_a_project_keeps_the_usage_fact() {
        let mut c = db();
        let p = create_project(&c, "Temporary").unwrap();
        mark_used(&mut c, &[1], Some(p), None, "").unwrap();

        delete_project(&c, p).unwrap();

        assert_eq!(count(&c, 1), 1, "still used");
        let h = history(&c, 1).unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].project_name, None, "orphaned, not deleted");
    }

    #[test]
    fn project_names_are_deduplicated_case_insensitively() {
        let c = db();
        let a = create_project(&c, "August Content").unwrap();
        let b = create_project(&c, "august content").unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn marking_used_against_a_missing_project_fails_loudly() {
        let mut c = db();
        assert!(mark_used(&mut c, &[1], Some(999), None, "").is_err());
        assert_eq!(count(&c, 1), 0);
    }
}
