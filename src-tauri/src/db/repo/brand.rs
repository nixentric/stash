//! Brand guidelines: the brand row and its colour, type and logo entries.
//!
//! Logos reference footage rather than storing a path of their own, so a brand's
//! files live in the asset library exactly once. Colours store hex only; RGB and
//! CMYK are derived at display time.

use crate::db::models::{Brand, BrandColor, BrandDetail, BrandLogo, BrandTypeface};
use crate::error::{AppError, Result};
use crate::util::now_iso;
use rusqlite::{params, Connection};

/// Trimmed, length-checked, non-empty — the same shape of validation the rest of
/// the IPC surface applies before anything reaches SQL.
fn required(label: &str, value: &str, max: usize) -> Result<String> {
    let v = value.trim();
    if v.is_empty() || v.chars().count() > max {
        return Err(AppError::Invalid(format!("{label} must be 1–{max} characters")));
    }
    Ok(v.to_string())
}

fn optional(label: &str, value: &str, max: usize) -> Result<String> {
    let v = value.trim();
    if v.chars().count() > max {
        return Err(AppError::Invalid(format!("{label} is too long (max {max})")));
    }
    Ok(v.to_string())
}

/// Accepts `#rgb`, `rgb`, `#rrggbb` or `rrggbb` in any case and returns the
/// canonical `#RRGGBB`. Anything else is refused rather than silently stored, so
/// a swatch always has a colour to paint.
pub fn normalize_hex(input: &str) -> Result<String> {
    let raw = input.trim().trim_start_matches('#');
    let expanded = match raw.len() {
        3 => raw.chars().flat_map(|c| [c, c]).collect::<String>(),
        6 => raw.to_string(),
        _ => return Err(AppError::Invalid(format!("\"{input}\" is not a hex colour"))),
    };
    if !expanded.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::Invalid(format!("\"{input}\" is not a hex colour")));
    }
    Ok(format!("#{}", expanded.to_ascii_uppercase()))
}

fn brand_row(r: &rusqlite::Row) -> rusqlite::Result<Brand> {
    Ok(Brand {
        id: r.get(0)?,
        name: r.get(1)?,
        description: r.get(2)?,
        tagline: r.get(3)?,
        website: r.get(4)?,
        notes: r.get(5)?,
        cover_footage_id: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

const BRAND_COLUMNS: &str =
    "id, name, description, tagline, website, notes, cover_footage_id, created_at, updated_at";

pub fn all(conn: &Connection) -> Result<Vec<Brand>> {
    let sql = format!("SELECT {BRAND_COLUMNS} FROM brands ORDER BY name COLLATE NOCASE");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], brand_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn detail(conn: &Connection, id: i64) -> Result<BrandDetail> {
    let sql = format!("SELECT {BRAND_COLUMNS} FROM brands WHERE id = ?1");
    let brand = conn
        .query_row(&sql, [id], brand_row)
        .map_err(|_| AppError::Invalid("That brand no longer exists".into()))?;

    let mut colors = conn.prepare(
        "SELECT id, brand_id, role, name, hex, notes, position FROM brand_colors
         WHERE brand_id = ?1 ORDER BY position, id",
    )?;
    let colors = colors
        .query_map([id], |r| {
            Ok(BrandColor {
                id: r.get(0)?,
                brand_id: r.get(1)?,
                role: r.get(2)?,
                name: r.get(3)?,
                hex: r.get(4)?,
                notes: r.get(5)?,
                position: r.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut typefaces = conn.prepare(
        "SELECT id, brand_id, role, family, weight, size, line_height, letter_spacing, notes, position
           FROM brand_typefaces WHERE brand_id = ?1 ORDER BY position, id",
    )?;
    let typefaces = typefaces
        .query_map([id], |r| {
            Ok(BrandTypeface {
                id: r.get(0)?,
                brand_id: r.get(1)?,
                role: r.get(2)?,
                family: r.get(3)?,
                weight: r.get(4)?,
                size: r.get(5)?,
                line_height: r.get(6)?,
                letter_spacing: r.get(7)?,
                notes: r.get(8)?,
                position: r.get(9)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut logos = conn.prepare(
        "SELECT id, brand_id, variant, name, footage_id, notes, position FROM brand_logos
         WHERE brand_id = ?1 ORDER BY position, id",
    )?;
    let logos = logos
        .query_map([id], |r| {
            Ok(BrandLogo {
                id: r.get(0)?,
                brand_id: r.get(1)?,
                variant: r.get(2)?,
                name: r.get(3)?,
                footage_id: r.get(4)?,
                notes: r.get(5)?,
                position: r.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(BrandDetail { brand, colors, typefaces, logos })
}

/// Creates when `id` is 0, updates otherwise. Returns the brand's id.
pub fn save(conn: &Connection, b: &Brand) -> Result<i64> {
    let name = required("Brand name", &b.name, 120)?;
    let description = optional("Description", &b.description, 2000)?;
    let tagline = optional("Tagline", &b.tagline, 200)?;
    let website = optional("Website", &b.website, 500)?;
    let notes = optional("Notes", &b.notes, 4000)?;
    let now = now_iso();

    let taken: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM brands WHERE name = ?1 COLLATE NOCASE AND id <> ?2)",
        params![name, b.id],
        |r| r.get(0),
    )?;
    if taken {
        return Err(AppError::Invalid(format!("A brand named \"{name}\" already exists")));
    }

    if b.id == 0 {
        conn.execute(
            "INSERT INTO brands (name, description, tagline, website, notes, cover_footage_id,
                                 created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![name, description, tagline, website, notes, b.cover_footage_id, now],
        )?;
        Ok(conn.last_insert_rowid())
    } else {
        let changed = conn.execute(
            "UPDATE brands SET name = ?2, description = ?3, tagline = ?4, website = ?5,
                    notes = ?6, cover_footage_id = ?7, updated_at = ?8 WHERE id = ?1",
            params![b.id, name, description, tagline, website, notes, b.cover_footage_id, now],
        )?;
        if changed == 0 {
            return Err(AppError::Invalid("That brand no longer exists".into()));
        }
        Ok(b.id)
    }
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM brands WHERE id = ?1", [id])?;
    Ok(())
}

/// Every child write moves the brand's own timestamp: the guideline is one
/// document as far as the user is concerned.
fn touch(conn: &Connection, brand_id: i64) -> Result<()> {
    conn.execute("UPDATE brands SET updated_at = ?2 WHERE id = ?1", params![brand_id, now_iso()])?;
    Ok(())
}

pub fn save_color(conn: &Connection, c: &BrandColor) -> Result<i64> {
    let name = required("Colour name", &c.name, 120)?;
    let role = required("Role", &c.role, 40)?;
    let hex = normalize_hex(&c.hex)?;
    let notes = optional("Notes", &c.notes, 1000)?;

    let id = if c.id == 0 {
        conn.execute(
            "INSERT INTO brand_colors (brand_id, role, name, hex, notes, position)
             VALUES (?1, ?2, ?3, ?4, ?5, COALESCE((SELECT MAX(position) + 1 FROM brand_colors
                                                    WHERE brand_id = ?1), 0))",
            params![c.brand_id, role, name, hex, notes],
        )?;
        conn.last_insert_rowid()
    } else {
        conn.execute(
            "UPDATE brand_colors SET role = ?2, name = ?3, hex = ?4, notes = ?5 WHERE id = ?1",
            params![c.id, role, name, hex, notes],
        )?;
        c.id
    };
    touch(conn, c.brand_id)?;
    Ok(id)
}

pub fn save_typeface(conn: &Connection, t: &BrandTypeface) -> Result<i64> {
    let family = required("Font family", &t.family, 200)?;
    let role = required("Role", &t.role, 40)?;
    let weight = optional("Weight", &t.weight, 60)?;
    let size = optional("Size", &t.size, 60)?;
    let line_height = optional("Line height", &t.line_height, 60)?;
    let letter_spacing = optional("Letter spacing", &t.letter_spacing, 60)?;
    let notes = optional("Notes", &t.notes, 1000)?;

    let id = if t.id == 0 {
        conn.execute(
            "INSERT INTO brand_typefaces (brand_id, role, family, weight, size, line_height,
                                          letter_spacing, notes, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                     COALESCE((SELECT MAX(position) + 1 FROM brand_typefaces WHERE brand_id = ?1), 0))",
            params![t.brand_id, role, family, weight, size, line_height, letter_spacing, notes],
        )?;
        conn.last_insert_rowid()
    } else {
        conn.execute(
            "UPDATE brand_typefaces SET role = ?2, family = ?3, weight = ?4, size = ?5,
                    line_height = ?6, letter_spacing = ?7, notes = ?8 WHERE id = ?1",
            params![t.id, role, family, weight, size, line_height, letter_spacing, notes],
        )?;
        t.id
    };
    touch(conn, t.brand_id)?;
    Ok(id)
}

pub fn save_logo(conn: &Connection, l: &BrandLogo) -> Result<i64> {
    let name = required("Logo name", &l.name, 120)?;
    let variant = required("Variant", &l.variant, 40)?;
    let notes = optional("Notes", &l.notes, 1000)?;

    let id = if l.id == 0 {
        conn.execute(
            "INSERT INTO brand_logos (brand_id, variant, name, footage_id, notes, position)
             VALUES (?1, ?2, ?3, ?4, ?5, COALESCE((SELECT MAX(position) + 1 FROM brand_logos
                                                    WHERE brand_id = ?1), 0))",
            params![l.brand_id, variant, name, l.footage_id, notes],
        )?;
        conn.last_insert_rowid()
    } else {
        conn.execute(
            "UPDATE brand_logos SET variant = ?2, name = ?3, footage_id = ?4, notes = ?5
             WHERE id = ?1",
            params![l.id, variant, name, l.footage_id, notes],
        )?;
        l.id
    };
    touch(conn, l.brand_id)?;
    Ok(id)
}

pub fn delete_color(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM brand_colors WHERE id = ?1", [id])?;
    Ok(())
}

pub fn delete_typeface(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM brand_typefaces WHERE id = ?1", [id])?;
    Ok(())
}

pub fn delete_logo(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM brand_logos WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::migrate;

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&mut c, 0).unwrap();
        c
    }

    #[test]
    fn hex_is_canonicalised_and_junk_is_refused() {
        for input in ["#146ef5", "146EF5", "#146EF5"] {
            assert_eq!(normalize_hex(input).unwrap(), "#146EF5");
        }
        assert_eq!(normalize_hex("#fff").unwrap(), "#FFFFFF", "shorthand expands");
        for bad in ["", "#12345", "nope", "#ggg", "#1234567"] {
            assert!(normalize_hex(bad).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn a_brand_carries_its_guideline_and_releases_it_on_delete() {
        let c = db();
        let id = save(&c, &Brand { name: "  Acme  ".into(), tagline: "Move it".into(), ..Default::default() })
            .unwrap();
        assert_eq!(all(&c).unwrap()[0].name, "Acme", "name is trimmed");

        save_color(&c, &BrandColor {
            brand_id: id,
            role: "primary".into(),
            name: "Primary Blue".into(),
            hex: "146ef5".into(),
            ..Default::default()
        })
        .unwrap();
        save_typeface(&c, &BrandTypeface {
            brand_id: id,
            role: "heading".into(),
            family: "Inter".into(),
            weight: "Bold".into(),
            ..Default::default()
        })
        .unwrap();
        save_logo(&c, &BrandLogo {
            brand_id: id,
            variant: "primary".into(),
            name: "Primary Logo".into(),
            ..Default::default()
        })
        .unwrap();

        let d = detail(&c, id).unwrap();
        assert_eq!(d.colors[0].hex, "#146EF5", "stored canonical, not as typed");
        assert_eq!(d.typefaces[0].family, "Inter");
        assert_eq!(d.logos.len(), 1);
        assert!(d.brand.updated_at >= d.brand.created_at, "a child write touches the brand");

        // Two brands cannot share a name, however it is cased.
        assert!(save(&c, &Brand { name: "acme".into(), ..Default::default() }).is_err());

        delete(&c, id).unwrap();
        assert!(all(&c).unwrap().is_empty());
        let orphans: i64 = c
            .query_row("SELECT COUNT(*) FROM brand_colors", [], |r| r.get(0))
            .unwrap();
        assert_eq!(orphans, 0, "deleting a brand cascades to its palette");
    }

    #[test]
    fn a_logo_outlives_the_asset_it_points_at() {
        let c = db();
        let brand = save(&c, &Brand { name: "Acme".into(), ..Default::default() }).unwrap();
        c.execute(
            "INSERT INTO footages (id, display_name, media_type, date_added, date_modified)
             VALUES (7, 'logo.svg', 'other', '2026-01-01', '2026-01-01')",
            [],
        )
        .unwrap();
        save_logo(&c, &BrandLogo {
            brand_id: brand,
            variant: "primary".into(),
            name: "Primary Logo".into(),
            footage_id: Some(7),
            ..Default::default()
        })
        .unwrap();

        // Removing the asset must not remove the brand's record of the variant.
        c.execute("DELETE FROM footages WHERE id = 7", []).unwrap();
        let d = detail(&c, brand).unwrap();
        assert_eq!(d.logos.len(), 1, "the logo entry survives");
        assert_eq!(d.logos[0].footage_id, None, "but no longer points at a missing asset");
    }
}
