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

    // ── source folders ──────────────────────────────────────────────────────
    // First in the list: a folder is the coarsest thing a query can mean, and
    // opening one is usually cheaper than scrolling the assets under it. Folder
    // tags match too, so a tag on a folder at least finds the folder itself.
    // The path travels as the subtitle — it is both what to show and where
    // clicking goes, so the hit needs no id of its own.
    let mut stmt = conn.prepare(
        "SELECT s.container_path FROM sources s
          WHERE s.container_path IS NOT NULL AND s.container_path <> ''
            AND (s.container_path LIKE ?1 ESCAPE '\\'
              OR EXISTS (SELECT 1 FROM source_folder_tags sft JOIN tags t ON t.id = sft.tag_id
                          WHERE sft.container_path = s.container_path
                            AND t.name LIKE ?1 ESCAPE '\\'))
          GROUP BY s.container_path ORDER BY s.container_path COLLATE NOCASE LIMIT ?2",
    )?;
    for row in stmt.query_map(rusqlite::params![pattern, PER_KIND], |r| {
        let path: String = r.get(0)?;
        Ok(SearchHit {
            kind: "folder".into(),
            id: 0,
            title: path.rsplit('/').next().unwrap_or(&path).to_string(),
            subtitle: path,
            brand_id: None,
            brand_name: String::new(),
            hex: None,
            url: None,
        })
    })? {
        hits.push(row?);
    }

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
            url: None,
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
            url: None,
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
            url: None,
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
            url: None,
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
            url: None,
        })
    })? {
        hits.push(row?);
    }

    // ── graphic elements ────────────────────────────────────────────────────
    let mut stmt = conn.prepare(
        "SELECT e.id, e.name, e.category, b.id, b.name FROM brand_elements e
           JOIN brands b ON b.id = e.brand_id
          WHERE e.name LIKE ?1 ESCAPE '\\' OR e.category LIKE ?1 ESCAPE '\\'
             OR e.notes LIKE ?1 ESCAPE '\\'
          ORDER BY b.name COLLATE NOCASE, e.position LIMIT ?2",
    )?;
    for row in stmt.query_map(rusqlite::params![pattern, PER_KIND], |r| {
        let category: String = r.get(2)?;
        let brand: String = r.get(4)?;
        Ok(SearchHit {
            kind: "element".into(),
            id: r.get(0)?,
            title: r.get(1)?,
            subtitle: format!("{brand} — {category}"),
            brand_id: Some(r.get(3)?),
            brand_name: brand,
            hex: None,
            url: None,
        })
    })? {
        hits.push(row?);
    }

    // ── additional info ─────────────────────────────────────────────────────
    // The body is searched too: a link entry is only ever found by its URL.
    let mut stmt = conn.prepare(
        "SELECT i.id, i.title, i.content_type, i.content, b.id, b.name FROM brand_additional_infos i
           JOIN brands b ON b.id = i.brand_id
          WHERE i.title LIKE ?1 ESCAPE '\\' OR i.content LIKE ?1 ESCAPE '\\'
          ORDER BY b.name COLLATE NOCASE, i.position LIMIT ?2",
    )?;
    for row in stmt.query_map(rusqlite::params![pattern, PER_KIND], |r| {
        let content_type: String = r.get(2)?;
        let content: String = r.get(3)?;
        let brand: String = r.get(5)?;
        let is_url = content_type == "url" && !content.trim().is_empty();
        Ok(SearchHit {
            kind: "info".into(),
            id: r.get(0)?,
            // A link says more as itself than as the word "url".
            subtitle: if is_url { format!("{brand} — {content}") } else { format!("{brand} — {content_type}") },
            title: r.get(1)?,
            brand_id: Some(r.get(4)?),
            brand_name: brand,
            hex: None,
            url: is_url.then_some(content),
        })
    })? {
        hits.push(row?);
    }

    // ── written rules ───────────────────────────────────────────────────────
    // The rules are one row of prose per brand, so a hit points at the brand
    // rather than at a rule that has no page of its own.
    let mut stmt = conn.prepare(
        "SELECT r.brand_id, b.name FROM brand_logo_rules r JOIN brands b ON b.id = r.brand_id
          WHERE r.clear_space LIKE ?1 ESCAPE '\\' OR r.minimum_size LIKE ?1 ESCAPE '\\'
             OR r.background_usage LIKE ?1 ESCAPE '\\'
          ORDER BY b.name COLLATE NOCASE LIMIT ?2",
    )?;
    for row in stmt.query_map(rusqlite::params![pattern, PER_KIND], |r| {
        let brand: String = r.get(1)?;
        Ok(SearchHit {
            kind: "guideline".into(),
            id: r.get(0)?,
            title: "Logo usage rules".into(),
            subtitle: brand.clone(),
            brand_id: Some(r.get(0)?),
            brand_name: brand,
            hex: None,
            url: None,
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
    use crate::db::models::{Brand, BrandAdditionalInfo, BrandColor, BrandLogo, BrandTypeface};
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
        brand::save_additional_info(&c, &BrandAdditionalInfo {
            brand_id: b,
            title: "Press kit".into(),
            editor_mode: "minimal".into(),
            content_type: "url".into(),
            content: "https://acme.example/press-red".into(),
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
    fn a_source_folder_is_findable_by_path_and_by_its_folder_tag() {
        let c = db();
        let by_path = universal(&c, "backgrounds").unwrap();
        assert_eq!(kinds(&by_path, "folder"), ["Backgrounds"]);
        assert_eq!(
            by_path.iter().find(|h| h.kind == "folder").unwrap().subtitle,
            "/Assets/Backgrounds",
            "the full path travels with the hit — it is what clicking opens"
        );
        assert_eq!(by_path[0].kind, "folder", "folders rank above the assets inside them");

        crate::db::repo::source_folder::set_tags(&c, "/Assets/Backgrounds", &["evergreen".into()])
            .unwrap();
        assert_eq!(kinds(&universal(&c, "evergreen").unwrap(), "folder"), ["Backgrounds"]);
    }

    #[test]
    fn additional_info_matches_on_title_and_on_its_body() {
        let c = db();
        assert_eq!(kinds(&universal(&c, "press kit").unwrap(), "info"), ["Press kit"]);
        assert_eq!(kinds(&universal(&c, "acme.example").unwrap(), "info"), ["Press kit"]);

        let hit = universal(&c, "press kit").unwrap().into_iter().find(|h| h.kind == "info").unwrap();
        assert_eq!(hit.url.as_deref(), Some("https://acme.example/press-red"), "a link hit opens the link");
    }

    #[test]
    fn an_empty_query_returns_nothing_rather_than_everything() {
        let c = db();
        assert!(universal(&c, "   ").unwrap().is_empty());
    }
}
