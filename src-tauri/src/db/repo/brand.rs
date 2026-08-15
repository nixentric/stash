//! Brand guidelines: the brand row and its colour, type and logo entries.
//!
//! Logos reference footage rather than storing a path of their own, so a brand's
//! files live in the asset library exactly once. Colours store hex only; RGB and
//! CMYK are derived at display time.

use crate::db::models::{
    Brand, BrandAdditionalInfo, BrandColor, BrandDetail, BrandElement, BrandExample, BrandLogo, BrandLogoRules,
    BrandTypeface,
};
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
        "SELECT id, brand_id, role, family, weight, size, line_height, letter_spacing, notes,
                font_file, position
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
                font_file: r.get(9)?,
                position: r.get(10)?,
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

    // Absent rules are an empty row, not an error: a brand that has not written
    // its rules down yet still renders the section, ready to fill in.
    let logo_rules = conn
        .query_row(
            "SELECT brand_id, clear_space, minimum_size, background_usage, updated_at
               FROM brand_logo_rules WHERE brand_id = ?1",
            [id],
            |r| {
                Ok(BrandLogoRules {
                    brand_id: r.get(0)?,
                    clear_space: r.get(1)?,
                    minimum_size: r.get(2)?,
                    background_usage: r.get(3)?,
                    updated_at: r.get(4)?,
                })
            },
        )
        .unwrap_or(BrandLogoRules { brand_id: id, ..Default::default() });

    let mut examples = conn.prepare(
        "SELECT id, brand_id, section, verdict, caption, footage_id, position FROM brand_examples
         -- 'correct' sorts before 'incorrect', which is also how they read.
         WHERE brand_id = ?1 ORDER BY section, verdict, position, id",
    )?;
    let examples = examples
        .query_map([id], |r| {
            Ok(BrandExample {
                id: r.get(0)?,
                brand_id: r.get(1)?,
                section: r.get(2)?,
                verdict: r.get(3)?,
                caption: r.get(4)?,
                footage_id: r.get(5)?,
                position: r.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut elements = conn.prepare(
        "SELECT id, brand_id, category, name, footage_id, notes, position FROM brand_elements
         WHERE brand_id = ?1 ORDER BY position, id",
    )?;
    let elements = elements
        .query_map([id], |r| {
            Ok(BrandElement {
                id: r.get(0)?,
                brand_id: r.get(1)?,
                category: r.get(2)?,
                name: r.get(3)?,
                footage_id: r.get(4)?,
                notes: r.get(5)?,
                position: r.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut additional_infos = conn.prepare(
        "SELECT id, brand_id, title, editor_mode, content_type, content, file_reference, position, updated_at FROM brand_additional_infos
         WHERE brand_id = ?1 ORDER BY position, id",
    )?;
    let additional_infos = additional_infos
        .query_map([id], |r| {
            Ok(BrandAdditionalInfo {
                id: r.get(0)?,
                brand_id: r.get(1)?,
                title: r.get(2)?,
                editor_mode: r.get(3)?,
                content_type: r.get(4)?,
                content: r.get(5)?,
                file_reference: r.get(6)?,
                position: r.get(7)?,
                updated_at: r.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(BrandDetail { brand, colors, typefaces, logos, logo_rules, examples, elements, additional_infos })
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
    let font_file = t.font_file.as_deref().filter(|p| !p.trim().is_empty());

    let id = if t.id == 0 {
        conn.execute(
            "INSERT INTO brand_typefaces (brand_id, role, family, weight, size, line_height,
                                          letter_spacing, notes, font_file, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                     COALESCE((SELECT MAX(position) + 1 FROM brand_typefaces WHERE brand_id = ?1), 0))",
            params![t.brand_id, role, family, weight, size, line_height, letter_spacing, notes, font_file],
        )?;
        conn.last_insert_rowid()
    } else {
        conn.execute(
            "UPDATE brand_typefaces SET role = ?2, family = ?3, weight = ?4, size = ?5,
                    line_height = ?6, letter_spacing = ?7, notes = ?8, font_file = ?9 WHERE id = ?1",
            params![t.id, role, family, weight, size, line_height, letter_spacing, notes, font_file],
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

pub fn save_logo_rules(conn: &Connection, r: &BrandLogoRules) -> Result<()> {
    let clear_space = optional("Clear space", &r.clear_space, 1000)?;
    let minimum_size = optional("Minimum size", &r.minimum_size, 1000)?;
    let background_usage = optional("Background usage", &r.background_usage, 2000)?;

    conn.execute(
        "INSERT INTO brand_logo_rules (brand_id, clear_space, minimum_size, background_usage, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(brand_id) DO UPDATE SET clear_space = excluded.clear_space,
             minimum_size = excluded.minimum_size, background_usage = excluded.background_usage,
             updated_at = excluded.updated_at",
        params![r.brand_id, clear_space, minimum_size, background_usage, now_iso()],
    )?;
    touch(conn, r.brand_id)
}

pub fn save_example(conn: &Connection, e: &BrandExample) -> Result<i64> {
    if !matches!(e.verdict.as_str(), "correct" | "incorrect") {
        return Err(AppError::Invalid("An example is either correct or incorrect".into()));
    }
    let section = required("Section", &e.section, 40)?;
    let caption = optional("Caption", &e.caption, 500)?;

    let id = if e.id == 0 {
        conn.execute(
            "INSERT INTO brand_examples (brand_id, section, verdict, caption, footage_id, position)
             VALUES (?1, ?2, ?3, ?4, ?5, COALESCE((SELECT MAX(position) + 1 FROM brand_examples
                                                    WHERE brand_id = ?1 AND section = ?2), 0))",
            params![e.brand_id, section, e.verdict, caption, e.footage_id],
        )?;
        conn.last_insert_rowid()
    } else {
        conn.execute(
            "UPDATE brand_examples SET section = ?2, verdict = ?3, caption = ?4, footage_id = ?5
             WHERE id = ?1",
            params![e.id, section, e.verdict, caption, e.footage_id],
        )?;
        e.id
    };
    touch(conn, e.brand_id)?;
    Ok(id)
}

pub fn save_element(conn: &Connection, el: &BrandElement) -> Result<i64> {
    let name = required("Element name", &el.name, 120)?;
    let category = required("Category", &el.category, 40)?;
    let notes = optional("Notes", &el.notes, 1000)?;

    let id = if el.id == 0 {
        conn.execute(
            "INSERT INTO brand_elements (brand_id, category, name, footage_id, notes, position)
             VALUES (?1, ?2, ?3, ?4, ?5, COALESCE((SELECT MAX(position) + 1 FROM brand_elements
                                                    WHERE brand_id = ?1), 0))",
            params![el.brand_id, category, name, el.footage_id, notes],
        )?;
        conn.last_insert_rowid()
    } else {
        conn.execute(
            "UPDATE brand_elements SET category = ?2, name = ?3, footage_id = ?4, notes = ?5
             WHERE id = ?1",
            params![el.id, category, name, el.footage_id, notes],
        )?;
        el.id
    };
    touch(conn, el.brand_id)?;
    Ok(id)
}

pub fn delete_example(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM brand_examples WHERE id = ?1", [id])?;
    Ok(())
}

pub fn delete_element(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM brand_elements WHERE id = ?1", [id])?;
    Ok(())
}

pub fn delete_color(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM brand_colors WHERE id = ?1", [id])?;
    Ok(())
}

pub fn delete_typeface(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM brand_typefaces WHERE id = ?1", [id])?;
    Ok(())
}

/// Whether this asset is used as a brand logo.
///
/// The thumbnail pipeline asks so it can keep transparency for these and only
/// these — everywhere else a flattened JPEG is the cheaper, better answer.
pub fn is_logo_asset(conn: &Connection, footage_id: i64) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM brand_logos WHERE footage_id = ?1)",
        [footage_id],
        |r| r.get::<_, i64>(0),
    )? != 0)
}

pub fn delete_logo(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM brand_logos WHERE id = ?1", [id])?;
    Ok(())
}

pub fn reorder_logos(conn: &Connection, updates: &[crate::commands::brand::LogoOrderUpdate]) -> Result<()> {
    if updates.is_empty() {
        return Ok(());
    }
    
    // Begin transaction for bulk update
    let tx = conn.unchecked_transaction()?;
    let mut stmt = tx.prepare("UPDATE brand_logos SET variant = ?1, position = ?2 WHERE id = ?3")?;
    
    for update in updates {
        stmt.execute(params![update.variant, update.position, update.id])?;
    }
    drop(stmt);
    
    tx.commit()?;
    Ok(())
}

pub fn save_additional_info(conn: &Connection, info: &BrandAdditionalInfo) -> Result<i64> {
    let title = required("Title", &info.title, 200)?;
    let editor_mode = required("Editor mode", &info.editor_mode, 40)?;
    let content_type = required("Content type", &info.content_type, 40)?;

    let id = if info.id == 0 {
        conn.execute(
            "INSERT INTO brand_additional_infos (brand_id, title, editor_mode, content_type, content, file_reference, position, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE((SELECT MAX(position) + 1 FROM brand_additional_infos
                                                    WHERE brand_id = ?1), 0), ?7)",
            params![info.brand_id, title, editor_mode, content_type, info.content, info.file_reference, now_iso()],
        )?;
        conn.last_insert_rowid()
    } else {
        conn.execute(
            "UPDATE brand_additional_infos SET title = ?2, editor_mode = ?3, content_type = ?4, content = ?5, file_reference = ?6, updated_at = ?7
             WHERE id = ?1",
            params![info.id, title, editor_mode, content_type, info.content, info.file_reference, now_iso()],
        )?;
        info.id
    };
    touch(conn, info.brand_id)?;
    Ok(id)
}

pub fn delete_additional_info(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM brand_additional_infos WHERE id = ?1", [id])?;
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
    fn rules_are_an_empty_row_until_written_and_survive_rewriting() {
        let c = db();
        let id = save(&c, &Brand { name: "Acme".into(), ..Default::default() }).unwrap();

        let rules = detail(&c, id).unwrap().logo_rules;
        assert_eq!(rules.clear_space, "", "a brand with no rules still renders the section");
        assert_eq!(rules.brand_id, id);

        save_logo_rules(&c, &BrandLogoRules {
            brand_id: id,
            clear_space: "1x the mark height".into(),
            minimum_size: "24px".into(),
            background_usage: "Never on busy photography".into(),
            ..Default::default()
        })
        .unwrap();
        save_logo_rules(&c, &BrandLogoRules {
            brand_id: id,
            clear_space: "Half the mark height".into(),
            ..Default::default()
        })
        .unwrap();

        // Upsert, not insert: the second write replaces rather than duplicating.
        let count: i64 = c
            .query_row("SELECT COUNT(*) FROM brand_logo_rules", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(detail(&c, id).unwrap().logo_rules.clear_space, "Half the mark height");
    }

    #[test]
    fn examples_are_grouped_by_verdict_and_junk_verdicts_are_refused() {
        let c = db();
        let id = save(&c, &Brand { name: "Acme".into(), ..Default::default() }).unwrap();

        for (verdict, caption) in
            [("correct", "On white"), ("incorrect", "Stretched"), ("correct", "On brand blue")]
        {
            save_example(&c, &BrandExample {
                brand_id: id,
                section: "logo".into(),
                verdict: verdict.into(),
                caption: caption.into(),
                ..Default::default()
            })
            .unwrap();
        }
        assert!(
            save_example(&c, &BrandExample {
                brand_id: id,
                section: "logo".into(),
                verdict: "maybe".into(),
                ..Default::default()
            })
            .is_err(),
            "an example is either correct or incorrect"
        );

        let examples = detail(&c, id).unwrap().examples;
        assert_eq!(examples.len(), 3);
        assert_eq!(examples[0].verdict, "correct", "do comes before don't");
        assert_eq!(examples.iter().filter(|e| e.verdict == "incorrect").count(), 1);
    }

    #[test]
    fn elements_reference_assets_and_cascade_with_the_brand() {
        let c = db();
        let id = save(&c, &Brand { name: "Acme".into(), ..Default::default() }).unwrap();
        c.execute(
            "INSERT INTO footages (id, display_name, media_type, date_added, date_modified)
             VALUES (9, 'grid.svg', 'other', '2026-01-01', '2026-01-01')",
            [],
        )
        .unwrap();
        save_element(&c, &BrandElement {
            brand_id: id,
            category: "pattern".into(),
            name: "Grid".into(),
            footage_id: Some(9),
            ..Default::default()
        })
        .unwrap();

        assert_eq!(detail(&c, id).unwrap().elements[0].footage_id, Some(9));

        delete(&c, id).unwrap();
        let left: i64 = c
            .query_row("SELECT COUNT(*) FROM brand_elements", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0, "elements go with the brand");
        let asset: i64 = c.query_row("SELECT COUNT(*) FROM footages", [], |r| r.get(0)).unwrap();
        assert_eq!(asset, 1, "but the asset itself is untouched");
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

    /// A logo is documentation, not stock: it should not turn up while browsing
    /// footage, and the counts beside the views should not include it either.
    #[test]
    fn a_logo_asset_is_hidden_from_the_library_but_still_reachable() {
        use crate::db::models::FootageQuery;
        use crate::db::repo::footage;

        let c = db();
        let brand = save(&c, &Brand { name: "Acme".into(), ..Default::default() }).unwrap();
        for (id, name) in [(7, "logo.png"), (8, "b-roll.mp4")] {
            c.execute(
                "INSERT INTO footages (id, display_name, media_type, date_added, date_modified)
                 VALUES (?1, ?2, 'image', '2026-01-01', '2026-01-01')",
                params![id, name],
            )
            .unwrap();
        }
        save_logo(&c, &BrandLogo {
            brand_id: brand,
            variant: "primary".into(),
            name: "Primary Logo".into(),
            footage_id: Some(7),
            ..Default::default()
        })
        .unwrap();

        let q = FootageQuery { limit: 50, ..Default::default() };
        let listed = footage::list(&c, &q).unwrap();
        assert_eq!(listed.total, 1, "only the b-roll is in the library");
        assert_eq!(listed.items[0].id, 8);

        assert_eq!(footage::stats(&c).unwrap().total, 1, "counts agree with the grid");

        // The brand page and any whole-catalogue job still see it.
        assert!(is_logo_asset(&c, 7).unwrap());
        let all = FootageQuery { limit: 50, include_brand_logos: true, ..Default::default() };
        assert_eq!(footage::list(&c, &all).unwrap().total, 2);
    }
}
