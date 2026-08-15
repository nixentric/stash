//! Universal search: one query, every kind of thing a library holds.
//!
//! The asset half reuses the existing footage filter rather than growing a
//! second dialect of the same SQL — anything that becomes searchable for the
//! grid becomes searchable here for free. The brand half is new, and lives
//! here rather than in `brand.rs` so the ranking rules for the whole result
//! set sit in one place.

use crate::db::models::{FootageQuery, SearchHit};
use crate::db::repo::footage;
use crate::error::Result;
use crate::util::like_pattern;
use rusqlite::Connection;

/// Hits per kind. A search panel is a shortcut, not a results page: past a
/// handful of rows per group nobody reads, they refine the query instead.
const PER_KIND: usize = 5;

pub fn universal(conn: &Connection, term: &str) -> Result<Vec<SearchHit>> {
    let term = term.trim();
    if term.is_empty() {
        return Ok(Vec::new());
    }
    let pattern = like_pattern(term);
    let mut hits = Vec::new();

    // ── assets ──────────────────────────────────────────────────────────────
    let page = footage::list(
        conn,
        &FootageQuery {
            search: Some(term.to_string()),
            limit: PER_KIND as i64,
            ..Default::default()
        },
    )?;
    for item in page.items {
        // Tags say more about why a result matched than the provider does.
        let subtitle = if item.tags.is_empty() {
            item.media_type.as_str().to_string()
        } else {
            item.tags.iter().map(|t| format!("#{t}")).collect::<Vec<_>>().join(" ")
        };
        hits.push(SearchHit {
            kind: "asset".into(),
            id: item.id,
            title: item.display_name,
            subtitle,
            brand_id: None,
            brand_name: String::new(),
            hex: None,
        });
    }

    // ── brands ──────────────────────────────────────────────────────────────
    let mut stmt = conn.prepare(
        "SELECT id, name, tagline FROM brands
          WHERE name LIKE ?1 ESCAPE '\\' OR tagline LIKE ?1 ESCAPE '\\'
             OR description LIKE ?1 ESCAPE '\\' OR notes LIKE ?1 ESCAPE '\\'
          ORDER BY name COLLATE NOCASE LIMIT ?2",
    )?;
    for row in stmt.query_map(rusqlite::params![pattern, PER_KIND], |r| {
        Ok(SearchHit {
            kind: "brand".into(),
            id: r.get(0)?,
            title: r.get(1)?,
            subtitle: r.get(2)?,
            brand_id: Some(r.get(0)?),
            brand_name: r.get(1)?,
            hex: None,
        })
    })? {
        hits.push(row?);
    }

    // ── colours ─────────────────────────────────────────────────────────────
    // Hex is matched too, so pasting `#146EF5` finds which brand owns it.
    let mut stmt = conn.prepare(
        "SELECT c.id, c.name, c.hex, c.role, b.id, b.name FROM brand_colors c
           JOIN brands b ON b.id = c.brand_id
          WHERE c.name LIKE ?1 ESCAPE '\\' OR c.hex LIKE ?1 ESCAPE '\\'
             OR c.role LIKE ?1 ESCAPE '\\' OR c.notes LIKE ?1 ESCAPE '\\'
          ORDER BY b.name COLLATE NOCASE, c.position LIMIT ?2",
    )?;
    for row in stmt.query_map(rusqlite::params![pattern, PER_KIND], |r| {
        let hex: String = r.get(2)?;
        let role: String = r.get(3)?;
        let brand: String = r.get(5)?;
        Ok(SearchHit {
            kind: "color".into(),
            id: r.get(0)?,
            title: r.get(1)?,
            subtitle: format!("{brand} — {role} — {hex}"),
            brand_id: Some(r.get(4)?),
            brand_name: brand,
            hex: Some(hex),
        })
    })? {
        hits.push(row?);
    }

    // ── typography ──────────────────────────────────────────────────────────
    let mut stmt = conn.prepare(
        "SELECT t.id, t.family, t.weight, t.role, b.id, b.name FROM brand_typefaces t
           JOIN brands b ON b.id = t.brand_id
          WHERE t.family LIKE ?1 ESCAPE '\\' OR t.role LIKE ?1 ESCAPE '\\'
             OR t.weight LIKE ?1 ESCAPE '\\' OR t.notes LIKE ?1 ESCAPE '\\'
          ORDER BY b.name COLLATE NOCASE, t.position LIMIT ?2",
    )?;
    for row in stmt.query_map(rusqlite::params![pattern, PER_KIND], |r| {
        let weight: String = r.get(2)?;
        let role: String = r.get(3)?;
        let brand: String = r.get(5)?;
        let family: String = r.get(1)?;
        Ok(SearchHit {
            kind: "typeface".into(),
            id: r.get(0)?,
            title: if weight.is_empty() { family.clone() } else { format!("{family} {weight}") },
            subtitle: format!("{brand} — {role}"),
            brand_id: Some(r.get(4)?),
            brand_name: brand,
            hex: None,
        })
    })? {
        hits.push(row?);
    }

    // ── logos ───────────────────────────────────────────────────────────────
    let mut stmt = conn.prepare(
        "SELECT l.id, l.name, l.variant, b.id, b.name FROM brand_logos l
           JOIN brands b ON b.id = l.brand_id
          WHERE l.name LIKE ?1 ESCAPE '\\' OR l.variant LIKE ?1 ESCAPE '\\'
             OR l.notes LIKE ?1 ESCAPE '\\'
          ORDER BY b.name COLLATE NOCASE, l.position LIMIT ?2",
    )?;
    for row in stmt.query_map(rusqlite::params![pattern, PER_KIND], |r| {
        let variant: String = r.get(2)?;
        let brand: String = r.get(4)?;
        Ok(SearchHit {
            kind: "logo".into(),
            id: r.get(0)?,
            title: r.get(1)?,
            subtitle: format!("{brand} — {variant}"),
            brand_id: Some(r.get(3)?),
            brand_name: brand,
            hex: None,
        })
    })? {
        hits.push(row?);
    }

    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::migrate;
    use crate::db::models::{Brand, BrandColor, BrandLogo, BrandTypeface};
    use crate::db::repo::brand;

    /// One asset, one brand, and a guideline that mentions red in three places.
    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&mut c, 0).unwrap();
        c.execute(
            "INSERT INTO footages (id, display_name, media_type, date_added, date_modified)
             VALUES (1, 'Red Gradient.png', 'image', '2026-01-01', '2026-01-01')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO sources (footage_id, provider, container_path)
             VALUES (1, 'local', '/Assets/Backgrounds')",
            [],
        )
        .unwrap();

        let b = brand::save(&c, &Brand { name: "Acme".into(), ..Default::default() }).unwrap();
        brand::save_color(&c, &BrandColor {
            brand_id: b,
            role: "primary".into(),
            name: "Brand Red".into(),
            hex: "#E92832".into(),
            ..Default::default()
        })
        .unwrap();
        brand::save_typeface(&c, &BrandTypeface {
            brand_id: b,
            role: "heading".into(),
            family: "Inter".into(),
            weight: "Bold".into(),
            ..Default::default()
        })
        .unwrap();
        brand::save_logo(&c, &BrandLogo {
            brand_id: b,
            variant: "primary".into(),
            name: "Logo Red".into(),
            ..Default::default()
        })
        .unwrap();
        c
    }

    fn kinds(hits: &[SearchHit], kind: &str) -> Vec<String> {
        hits.iter().filter(|h| h.kind == kind).map(|h| h.title.clone()).collect()
    }

    #[test]
    fn one_term_reaches_assets_colors_and_logos_at_once() {
        let c = db();
        let hits = universal(&c, "red").unwrap();

        assert_eq!(kinds(&hits, "asset"), ["Red Gradient.png"]);
        assert_eq!(kinds(&hits, "color"), ["Brand Red"]);
        assert_eq!(kinds(&hits, "logo"), ["Logo Red"]);
        assert!(kinds(&hits, "typeface").is_empty(), "Inter has nothing to do with red");

        let color = hits.iter().find(|h| h.kind == "color").unwrap();
        assert_eq!(color.hex.as_deref(), Some("#E92832"));
        assert_eq!(color.brand_name, "Acme", "a hit carries the brand it belongs to");
    }

    #[test]
    fn a_pasted_hex_finds_the_brand_that_owns_it() {
        let c = db();
        let hits = universal(&c, "#E92832").unwrap();
        assert_eq!(kinds(&hits, "color"), ["Brand Red"]);
    }

    #[test]
    fn searching_by_role_and_family_reaches_typography() {
        let c = db();
        assert_eq!(kinds(&universal(&c, "inter").unwrap(), "typeface"), ["Inter Bold"]);
        assert_eq!(kinds(&universal(&c, "heading").unwrap(), "typeface"), ["Inter Bold"]);
    }

    #[test]
    fn an_empty_query_returns_nothing_rather_than_everything() {
        let c = db();
        assert!(universal(&c, "   ").unwrap().is_empty());
    }
}
