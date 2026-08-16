//! Filter/sort SQL construction for the library grid.
//!
//! Every value is bound as a parameter — the builder only ever concatenates
//! fixed string fragments it owns. There is no path by which user input reaches
//! the SQL text itself.

use crate::db::models::{FootageQuery, SortKey, UsageFilter};
use crate::util::like_pattern;
use rusqlite::types::Value;

pub struct Filter {
    pub where_sql: String,
    pub params: Vec<Value>,
}

/// Columns a free-text term is matched against (§23). Tags, collections and
/// projects are reached through EXISTS rather than joins so that a footage with
/// twelve tags still produces exactly one row.
const SEARCH_PREDICATE: &str = r#"(
    f.display_name LIKE ? ESCAPE '\'
 OR f.notes LIKE ? ESCAPE '\'
 OR IFNULL(s.original_filename,'') LIKE ? ESCAPE '\'
 OR IFNULL(s.container_path,'')    LIKE ? ESCAPE '\'
 OR IFNULL(s.original_url,'')      LIKE ? ESCAPE '\'
 OR EXISTS (SELECT 1 FROM footage_tags ft JOIN tags t ON t.id = ft.tag_id
            WHERE ft.footage_id = f.id AND t.name LIKE ? ESCAPE '\')
 OR EXISTS (SELECT 1 FROM collection_footages cf JOIN collections c ON c.id = cf.collection_id
            WHERE cf.footage_id = f.id AND c.name LIKE ? ESCAPE '\')
 OR EXISTS (SELECT 1 FROM footage_usage u JOIN projects p ON p.id = u.project_id
            WHERE u.footage_id = f.id AND p.name LIKE ? ESCAPE '\')
)"#;

const SEARCH_PLACEHOLDERS: usize = 8;

pub fn build(q: &FootageQuery, folder_tags_cover_files: bool) -> Filter {
    let mut clauses: Vec<String> = Vec::new();
    let mut params: Vec<Value> = Vec::new();

    // A logo belongs to the brand guideline, not the shot list. It stays reachable
    // by search and from the brand page, both of which look it up directly.
    if !q.include_brand_logos {
        clauses.push(
            "f.brand_asset = 0 AND NOT EXISTS \
             (SELECT 1 FROM brand_logos bl WHERE bl.footage_id = f.id)"
                .into(),
        );
    }

    // Free text: every whitespace-separated term must match somewhere, so
    // "iphone woman outdoor" narrows instead of widening.
    if let Some(search) = q.search.as_ref() {
        for term in search.split_whitespace().take(8) {
            clauses.push(SEARCH_PREDICATE.to_string());
            let pattern = like_pattern(term);
            for _ in 0..SEARCH_PLACEHOLDERS {
                params.push(Value::Text(pattern.clone()));
            }
        }
    }

    // Usage status is derived from the trigger-maintained counter, never stored
    // as a boolean (§16).
    match q.usage {
        UsageFilter::Used => clauses.push("f.usage_count > 0".into()),
        UsageFilter::Unused => clauses.push("f.usage_count = 0".into()),
        UsageFilter::All => {}
    }

    if !q.media_types.is_empty() {
        let holes = vec!["?"; q.media_types.len()].join(",");
        clauses.push(format!("f.media_type IN ({holes})"));
        params.extend(
            q.media_types
                .iter()
                .map(|m| Value::Text(m.as_str().to_string())),
        );
    }

    if let Some(r) = q.min_rating.filter(|r| *r > 0) {
        clauses.push("f.rating >= ?".into());
        params.push(Value::Integer(r));
    }

    if q.favorite_only {
        clauses.push("f.favorite = 1".into());
    }

    // Multiple tags are ANDed: selecting `iphone` + `outdoor` means both.
    //
    // Whether a folder tag also matches the files inside it is the library's
    // `folder_tags_cover_files` switch. With it on, tagging a folder
    // "cabang-bandung" labels a hundred clips at once; with it off (the default)
    // the tag stays on the folder. `all_tags` reads the same switch, so the count
    // in the sidebar is always the count this filter produces.
    if !q.tags.is_empty() {
        let holes = vec!["?"; q.tags.len()].join(",");
        let folder_match = if folder_tags_cover_files {
            "OR EXISTS (SELECT 1 FROM source_folder_tags sft
                         WHERE sft.tag_id = t.id
                           AND sft.container_path = s.container_path)"
        } else {
            ""
        };
        clauses.push(format!(
            "(SELECT COUNT(*) FROM tags t
               WHERE t.name IN ({holes})
                 AND (EXISTS (SELECT 1 FROM footage_tags ft
                               WHERE ft.footage_id = f.id AND ft.tag_id = t.id)
                   {folder_match})) = ?"
        ));
        params.extend(q.tags.iter().map(|t| Value::Text(t.clone())));
        params.push(Value::Integer(q.tags.len() as i64));
    }

    if let Some(cid) = q.collection_id {
        clauses.push(
            "EXISTS (SELECT 1 FROM collection_footages cf WHERE cf.footage_id = f.id AND cf.collection_id = ?)".into(),
        );
        params.push(Value::Integer(cid));
    }

    if let Some(pid) = q.project_id {
        clauses.push(
            "EXISTS (SELECT 1 FROM footage_usage u WHERE u.footage_id = f.id AND u.project_id = ?)"
                .into(),
        );
        params.push(Value::Integer(pid));
    }

    // Folder filter matches the folder and everything beneath it, so clicking a
    // parent in the sidebar shows the whole subtree.
    if let Some(path) = q.container_path.as_ref().filter(|p| !p.is_empty()) {
        clauses.push("(s.container_path = ? OR s.container_path LIKE ? ESCAPE '\\')".into());
        params.push(Value::Text(path.clone()));
        let mut prefix = path.clone();
        prefix.push('/');
        params.push(Value::Text(format!(
            "{}%",
            prefix.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
        )));
    }

    if !q.providers.is_empty() {
        let holes = vec!["?"; q.providers.len()].join(",");
        clauses.push(format!("s.provider IN ({holes})"));
        params.extend(q.providers.iter().map(|p| Value::Text(p.clone())));
    }

    if !q.accessibility.is_empty() {
        let holes = vec!["?"; q.accessibility.len()].join(",");
        clauses.push(format!("s.accessibility IN ({holes})"));
        params.extend(q.accessibility.iter().map(|a| Value::Text(a.clone())));
    }

    for (col, bound, op) in [
        ("f.date_added", q.added_after.as_ref(), ">="),
        ("f.date_added", q.added_before.as_ref(), "<="),
        ("f.last_used_at", q.used_after.as_ref(), ">="),
        ("f.last_used_at", q.used_before.as_ref(), "<="),
    ] {
        if let Some(v) = bound.filter(|v| !v.is_empty()) {
            clauses.push(format!("{col} {op} ?"));
            params.push(Value::Text(v.clone()));
        }
    }

    if q.missing_thumbnail {
        clauses.push("NOT EXISTS (SELECT 1 FROM thumbnails th WHERE th.footage_id = f.id)".into());
    }

    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join("\n  AND "))
    };

    Filter { where_sql, params }
}

/// SQLite sorts NULLs first on ASC and last on DESC, which puts never-used
/// footage at the top of "Recently Used". The explicit `IS NULL` key fixes that.
pub fn order_by(sort: SortKey) -> &'static str {
    match sort {
        SortKey::NewestAdded => "ORDER BY f.date_added DESC, f.id DESC",
        SortKey::OldestAdded => "ORDER BY f.date_added ASC, f.id ASC",
        SortKey::NameAsc => "ORDER BY f.display_name COLLATE NOCASE ASC, f.id ASC",
        SortKey::NameDesc => "ORDER BY f.display_name COLLATE NOCASE DESC, f.id DESC",
        SortKey::RecentlyUsed => {
            "ORDER BY f.last_used_at IS NULL, f.last_used_at DESC, f.id DESC"
        }
        SortKey::MostUsed => "ORDER BY f.usage_count DESC, f.last_used_at DESC, f.id DESC",
        SortKey::NeverUsed => "ORDER BY f.usage_count ASC, f.date_added DESC, f.id DESC",
        SortKey::HighestRating => "ORDER BY f.rating DESC, f.date_added DESC, f.id DESC",
        SortKey::Duration => "ORDER BY s.duration_ms IS NULL, s.duration_ms DESC, f.id DESC",
    }
}
