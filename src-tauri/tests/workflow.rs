//! End-to-end walkthrough of the Definition of Done (§58), minus the parts that
//! need a window or a live Google account.
//!
//! This is the test that decides whether the product actually works: create a
//! library, catalog Drive links with no account, organize, track usage, close,
//! reopen, then copy the file to "another computer" and confirm everything —
//! including the pictures — is still there.

use stash_lib::db::connection::{self, Library};
use stash_lib::db::models::{
    Brand, FootagePatch, FootageQuery, MediaType, NewFootage, SortKey, UsageFilter,
};
use stash_lib::db::repo::{brand, footage, source_folder, taxonomy, thumbnail, usage};
use stash_lib::source;
use std::path::PathBuf;

struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("stash-e2e-{}", rand::random::<u64>()));
        std::fs::create_dir_all(&p).unwrap();
        TempDir(p)
    }
    fn join(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn q() -> FootageQuery {
    FootageQuery {
        limit: 100,
        ..Default::default()
    }
}

/// Builds a footage record the way the Add Footage dialog does in link mode:
/// parse the pasted URL, keep the id and the original URL, invent nothing else.
fn from_link(url: &str, display_name: &str) -> NewFootage {
    let parsed = source::parse_input(url).expect("URL should parse");
    NewFootage {
        display_name: display_name.to_string(),
        media_type: None,
        provider: parsed.provider,
        external_id: parsed.external_id,
        external_key: parsed.external_key,
        original_url: parsed.original_url,
        local_path: parsed.local_path,
        container_id: None,
        container_path: None,
        original_filename: None,
        mime_type: None,
        file_size: None,
        width: None,
        height: None,
        duration_ms: None,
        source_created_at: None,
        source_modified_at: None,
        tags: None,
        notes: None,
        brand_asset: false,
    }
}

const LINK_A: &str = "https://drive.google.com/file/d/1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/view?usp=sharing";
const LINK_B: &str = "https://drive.google.com/file/d/1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB/view";
const LINK_C: &str = "https://drive.google.com/open?id=1CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

/// A tiny but real JPEG, standing in for a fetched thumbnail.
fn jpeg_bytes() -> Vec<u8> {
    let mut img = image::RgbImage::new(64, 48);
    for (x, y, p) in img.enumerate_pixels_mut() {
        *p = image::Rgb([(x * 4) as u8, (y * 5) as u8, 128]);
    }
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img)
        .write_to(&mut out, image::ImageFormat::Jpeg)
        .unwrap();
    out.into_inner()
}

#[test]
fn full_catalog_workflow_without_any_google_account() {
    let dir = TempDir::new();

    // ── 2. Create My Library.footagedb ───────────────────────────────────────
    let lib = connection::create(&dir.join("My Library")).unwrap();
    let library_path = lib.path.clone();
    assert!(library_path.to_string_lossy().ends_with(".footagedb"));

    // ── 4–7. Paste Drive links and import (no OAuth, no API key) ─────────────
    let a = footage::insert(&lib.conn, &from_link(LINK_A, "Woman holding iPhone 01")).unwrap();
    let b = footage::insert(&lib.conn, &from_link(LINK_B, "Outdoor B-roll")).unwrap();
    let c = footage::insert(&lib.conn, &from_link(LINK_C, "Product macro")).unwrap();

    // Media type is unknowable from a bare link, and that is a supported state.
    let detail = footage::get(&lib.conn, a).unwrap();
    assert_eq!(detail.source.provider, "google_drive");
    assert_eq!(
        detail.source.external_id.as_deref(),
        Some("1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
    );
    assert_eq!(
        detail.source.original_url.as_deref(),
        Some(LINK_A),
        "the URL the user pasted is stored verbatim"
    );
    assert!(detail.source.mime_type.is_none(), "no API, no source metadata");

    // ── 30. Re-importing the same file must not duplicate it ────────────────
    let dup = footage::find_by_identity(
        &lib.conn,
        "google_drive",
        Some("1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
        None,
    )
    .unwrap();
    assert_eq!(dup, Some(a), "same Drive id resolves to the existing record");

    // A different share-URL form for the same id is still the same footage.
    let same_file_other_url =
        source::parse_input("https://drive.google.com/uc?id=1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&export=download")
            .unwrap();
    assert_eq!(same_file_other_url.external_id, detail.source.external_id);

    // ── organize: tags, collection, rating, favorite, notes ─────────────────
    taxonomy::add_tags(
        &lib.conn,
        &[a],
        &["iPhone".into(), "Woman".into(), "Outdoor".into()],
    )
    .unwrap();
    taxonomy::add_tags(&lib.conn, &[b], &["outdoor".into()]).unwrap();

    let tech = taxonomy::create_collection(&lib.conn, "Technology").unwrap();
    taxonomy::add_to_collection(&lib.conn, tech, &[a, c]).unwrap();

    footage::patch(
        &lib.conn,
        &[a],
        &FootagePatch {
            rating: Some(5),
            favorite: Some(true),
            notes: Some("Bagus untuk konten promo battery. Talent menghadap kamera.".into()),
            display_name: None,
        },
    )
    .unwrap();

    // ── 8. Portable thumbnail, as the preview chain would store it ──────────
    let encoded = stash_lib::preview::encode::portable(&jpeg_bytes(), 480, false).unwrap();
    thumbnail::put(
        &lib.conn,
        a,
        &encoded.bytes,
        encoded.width,
        encoded.height,
        thumbnail::Origin::Custom,
    )
    .unwrap();
    assert!(thumbnail::is_pinned(&lib.conn, a).unwrap(), "custom = pinned");

    // ── 9. Search and filter ────────────────────────────────────────────────
    let by_tag = footage::list(
        &lib.conn,
        &FootageQuery {
            search: Some("iphone".into()),
            ..q()
        },
    )
    .unwrap();
    assert_eq!(by_tag.total, 1, "search reaches tags, not just filenames");
    assert_eq!(by_tag.items[0].id, a);

    let by_note = footage::list(
        &lib.conn,
        &FootageQuery {
            search: Some("battery".into()),
            ..q()
        },
    )
    .unwrap();
    assert_eq!(by_note.total, 1, "search reaches notes");

    // Multiple terms narrow rather than widen.
    let narrowed = footage::list(
        &lib.conn,
        &FootageQuery {
            search: Some("iphone outdoor".into()),
            ..q()
        },
    )
    .unwrap();
    assert_eq!(narrowed.total, 1);

    let nonsense = footage::list(
        &lib.conn,
        &FootageQuery {
            search: Some("iphone zzzz".into()),
            ..q()
        },
    )
    .unwrap();
    assert_eq!(nonsense.total, 0);

    let in_collection = footage::list(
        &lib.conn,
        &FootageQuery {
            collection_id: Some(tech),
            ..q()
        },
    )
    .unwrap();
    assert_eq!(in_collection.total, 2);

    // ── 11–12. Mark as Used, against a project ──────────────────────────────
    let promo = usage::create_project(&lib.conn, "Instagram Independence Promo").unwrap();
    let campaign = usage::create_project(&lib.conn, "Back Camera Campaign").unwrap();

    let mut conn = lib.conn;
    usage::mark_used(&mut conn, &[a], Some(promo), Some("2026-08-14"), "").unwrap();
    usage::mark_used(&mut conn, &[a], Some(campaign), Some("2026-08-15"), "second cut").unwrap();
    usage::mark_used(&mut conn, &[b], None, Some("2026-08-15"), "").unwrap();

    // ── 13. Usage history ───────────────────────────────────────────────────
    let history = usage::history(&conn, a).unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(
        history[0].project_name.as_deref(),
        Some("Back Camera Campaign"),
        "newest usage first"
    );

    // Status is derived, never stored as a flag.
    let stats = footage::stats(&conn).unwrap();
    assert_eq!((stats.total, stats.used, stats.unused), (3, 2, 1));

    let unused = footage::list(
        &conn,
        &FootageQuery {
            usage: UsageFilter::Unused,
            ..q()
        },
    )
    .unwrap();
    assert_eq!(unused.total, 1);
    assert_eq!(unused.items[0].id, c, "the never-used clip is findable");

    let most_used = footage::list(
        &conn,
        &FootageQuery {
            sort: SortKey::MostUsed,
            ..q()
        },
    )
    .unwrap();
    assert_eq!(most_used.items[0].id, a);

    // ── 14. Close the application ───────────────────────────────────────────
    drop(Library {
        conn,
        path: library_path.clone(),
    });

    // ── 15–16. Reopen: every piece of metadata is still there ───────────────
    let reopened = connection::open(&library_path).unwrap();
    let d = footage::get(&reopened.conn, a).unwrap();

    assert_eq!(d.display_name, "Woman holding iPhone 01");
    assert_eq!(d.rating, 5);
    assert!(d.favorite);
    assert!(d.notes.contains("promo battery"));
    assert_eq!(d.tags, vec!["iphone", "outdoor", "woman"]);
    assert_eq!(d.collections.len(), 1);
    assert_eq!(d.collections[0].name, "Technology");
    assert_eq!(d.usage.len(), 2);
    assert_eq!(d.usage_count, 2);
    assert!(d.has_thumbnail);
    assert_eq!(
        d.source.original_url.as_deref(),
        Some(LINK_A),
        "source link survives a close/reopen"
    );

    // ── 17–19. Copy to "another computer" and open it there ─────────────────
    let other_machine = TempDir::new();
    let delivered = other_machine.join("Client Assets.footagedb");
    std::fs::copy(&library_path, &delivered).unwrap();

    // Only one file was copied — a sidecar would mean data loss here.
    let sidecars: Vec<_> = std::fs::read_dir(&dir.0)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    assert_eq!(sidecars.len(), 1, "library must be a single file, got {sidecars:?}");

    let colleague = connection::open(&delivered).unwrap();
    let their_view = footage::get(&colleague.conn, a).unwrap();

    assert_eq!(their_view.display_name, "Woman holding iPhone 01");
    assert_eq!(their_view.tags.len(), 3);
    assert_eq!(their_view.usage.len(), 2);
    assert_eq!(
        their_view.usage[0].project_name.as_deref(),
        Some("Back Camera Campaign")
    );

    // ── 22. The shared library is still visual, with no account connected ───
    let travelled = thumbnail::get(&colleague.conn, a).unwrap();
    assert!(
        travelled.is_some(),
        "portable thumbnails must survive the copy — this is the whole point of §22"
    );
    assert_eq!(travelled.unwrap(), encoded.bytes);

    // Search works on the delivered copy too.
    let found = footage::list(
        &colleague.conn,
        &FootageQuery {
            search: Some("woman".into()),
            ..q()
        },
    )
    .unwrap();
    assert_eq!(found.total, 1);
}

/// §26: connecting Drive later must enrich existing rows, never duplicate them,
/// and never overwrite a name the user typed.
#[test]
fn connecting_drive_later_enriches_rather_than_duplicates() {
    let dir = TempDir::new();
    let lib = connection::create(&dir.join("Upgrade")).unwrap();

    let id = footage::insert(&lib.conn, &from_link(LINK_A, "Woman holding iPhone 01")).unwrap();

    // What the sync pass does once an account exists.
    lib.conn
        .execute(
            "UPDATE sources SET original_filename = ?2, mime_type = ?3, width = ?4,
                                height = ?5, duration_ms = ?6, accessibility = 'available'
             WHERE footage_id = ?1",
            rusqlite::params![id, "IMG_8821.MOV", "video/quicktime", 3840, 2160, 23_400],
        )
        .unwrap();

    let after = footage::get(&lib.conn, id).unwrap();
    assert_eq!(
        after.display_name, "Woman holding iPhone 01",
        "the user's own name is never overwritten by sync"
    );
    assert_eq!(after.source.original_filename.as_deref(), Some("IMG_8821.MOV"));
    assert_eq!(after.source.duration_ms, Some(23_400));

    // Still exactly one record for that Drive file.
    let total = footage::list(&lib.conn, &q()).unwrap().total;
    assert_eq!(total, 1);
}

/// §17: removing footage from the catalog must never look like deleting a file,
/// and must leave the source record's identity recoverable from nothing.
#[test]
fn removing_footage_is_catalog_only_and_cascades_cleanly() {
    let dir = TempDir::new();
    let lib = connection::create(&dir.join("Removal")).unwrap();
    let mut conn = lib.conn;

    let id = footage::insert(&conn, &from_link(LINK_A, "Clip")).unwrap();
    taxonomy::add_tags(&conn, &[id], &["keep-me".into()]).unwrap();
    let p = usage::create_project(&conn, "Some Project").unwrap();
    usage::mark_used(&mut conn, &[id], Some(p), None, "").unwrap();

    let removed = footage::remove(&mut conn, &[id]).unwrap();
    assert_eq!(removed, 1);

    let orphan_sources: i64 = conn
        .query_row("SELECT COUNT(*) FROM sources", [], |r| r.get(0))
        .unwrap();
    let orphan_usage: i64 = conn
        .query_row("SELECT COUNT(*) FROM footage_usage", [], |r| r.get(0))
        .unwrap();
    let projects: i64 = conn
        .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
        .unwrap();

    assert_eq!((orphan_sources, orphan_usage), (0, 0), "no orphaned rows");
    assert_eq!(projects, 1, "the project itself outlives the footage");
}

/// A logo imported from the brand page stays out of the grid even before it is
/// linked to a logo entry — and after it is unlinked again. The link alone used
/// to be the only signal, so cancelling the dialog leaked the file into the
/// library with nothing to hide it.
#[test]
fn brand_imports_never_show_up_in_the_library() {
    let dir = TempDir::new();
    let lib = connection::create(&dir.join("Brand")).unwrap();

    let clip = footage::insert(&lib.conn, &from_link(LINK_A, "B-roll")).unwrap();
    let logo = footage::insert(
        &lib.conn,
        &NewFootage {
            brand_asset: true,
            ..from_link(LINK_B, "Wordmark")
        },
    )
    .unwrap();

    let grid = footage::list(&lib.conn, &q()).unwrap();
    let ids: Vec<i64> = grid.items.iter().map(|i| i.id).collect();
    assert_eq!(ids, vec![clip], "only the clip belongs in the grid");

    // The brand page and the search bar ask for everything, and still find it.
    let all = footage::list(
        &lib.conn,
        &FootageQuery { include_brand_logos: true, ..q() },
    )
    .unwrap();
    assert!(all.items.iter().any(|i| i.id == logo));

    assert_eq!(footage::stats(&lib.conn).unwrap().total, 1, "counts agree");
}

/// A library that belongs to one brand can name that brand once, and every
/// folder catalogued afterwards arrives already assigned — without the default
/// ever reaching back and re-branding a folder somebody set by hand.
#[test]
fn the_default_brand_claims_new_folders_and_leaves_settled_ones_alone() {
    let dir = TempDir::new();
    let lib = connection::create(&dir.join("Branded")).unwrap();

    let etive = brand::save(
        &lib.conn,
        &Brand { name: "ETIVE".into(), ..Default::default() },
    )
    .unwrap();
    let other = brand::save(
        &lib.conn,
        &Brand { name: "Other".into(), ..Default::default() },
    )
    .unwrap();
    source_folder::set_default_brand(&lib.conn, Some(etive)).unwrap();

    let in_folder = |link: &str, name: &str, path: &str| NewFootage {
        container_path: Some(path.to_string()),
        ..from_link(link, name)
    };

    // A folder somebody already claimed for another brand, and one they left
    // blank on purpose — set_brand writes the meta row either way.
    let claimed = footage::insert(&lib.conn, &in_folder(LINK_A, "Claimed", "/Shoots/Claimed")).unwrap();
    source_folder::set_brand(&lib.conn, "/Shoots/Claimed", Some(other)).unwrap();
    let blank = footage::insert(&lib.conn, &in_folder(LINK_B, "Blank", "/Shoots/Blank")).unwrap();
    source_folder::set_brand(&lib.conn, "/Shoots/Blank", None).unwrap();

    // Now catalogue a brand new folder, and one more file into each old one.
    let fresh = footage::insert(&lib.conn, &in_folder(LINK_C, "Fresh", "/Shoots/Fresh")).unwrap();
    source_folder::apply_default_brand(&lib.conn, &[claimed, blank, fresh]).unwrap();

    let brand_of = |path: &str| {
        footage::folders(&lib.conn)
            .unwrap()
            .into_iter()
            .find(|f| f.container_path == path)
            .unwrap_or_else(|| panic!("{path} should be listed"))
            .brand_id
    };
    assert_eq!(brand_of("/Shoots/Fresh"), Some(etive), "new folder takes the default");
    assert_eq!(brand_of("/Shoots/Claimed"), Some(other), "an assigned brand survives");
    assert_eq!(brand_of("/Shoots/Blank"), None, "a deliberately blank folder stays blank");

    // Turning the default off leaves later folders alone entirely.
    source_folder::set_default_brand(&lib.conn, None).unwrap();
    let later = footage::insert(
        &lib.conn,
        &in_folder("https://cdn.example.com/clips/later.mp4", "Later", "/Shoots/Later"),
    )
    .unwrap();
    source_folder::apply_default_brand(&lib.conn, &[later]).unwrap();
    assert_eq!(brand_of("/Shoots/Later"), None, "no default, no brand");
}

/// A tag on a folder means the folder, until you say otherwise — and whichever
/// way the switch sits, the number the tag list shows is the number the grid
/// produces when you click it.
#[test]
fn folder_tags_count_folders_until_the_switch_says_files() {
    let dir = TempDir::new();
    let lib = connection::create(&dir.join("Tagged")).unwrap();

    let in_folder = |link: &str, name: &str, path: &str| NewFootage {
        container_path: Some(path.to_string()),
        ..from_link(link, name)
    };

    // Three clips in one folder; the folder carries "bestie", nothing else does.
    for (link, name) in [(LINK_A, "One"), (LINK_B, "Two"), (LINK_C, "Three")] {
        footage::insert(&lib.conn, &in_folder(link, name, "/Shoots/Bestie")).unwrap();
    }
    source_folder::set_tags(&lib.conn, "/Shoots/Bestie", &["bestie".into()]).unwrap();

    let bestie = |conn: &_| {
        taxonomy::all_tags(conn)
            .unwrap()
            .into_iter()
            .find(|t| t.name == "bestie")
            .expect("the tag exists")
    };
    let clicking_bestie = |conn: &_| {
        footage::list(conn, &FootageQuery { tags: vec!["bestie".into()], ..q() })
            .unwrap()
            .total
    };

    // Off by default: one folder, no files — and the grid agrees.
    let off = bestie(&lib.conn);
    assert_eq!(off.folder_count, 1, "the tag labels one folder");
    assert_eq!(off.footage_count, 0, "and no file carries it directly");
    assert_eq!(clicking_bestie(&lib.conn), 0, "the count is what the grid shows");

    // On: the tag reaches everything in the folder, count and filter together.
    source_folder::set_folder_tags_cover_files(&lib.conn, true).unwrap();
    let on = bestie(&lib.conn);
    assert_eq!(on.footage_count, 3, "now it reaches the folder's contents");
    assert_eq!(on.folder_count, 1, "the folder count never moves");
    assert_eq!(clicking_bestie(&lib.conn), 3, "the count is still what the grid shows");
}

/// A mixed library — Drive links, a web URL, a local file — behaves uniformly.
#[test]
fn providers_coexist_in_one_library() {
    let dir = TempDir::new();
    let lib = connection::create(&dir.join("Mixed")).unwrap();

    footage::insert(&lib.conn, &from_link(LINK_A, "Drive clip")).unwrap();
    footage::insert(
        &lib.conn,
        &from_link("https://cdn.example.com/clips/beach.mp4", "Web clip"),
    )
    .unwrap();
    footage::insert(
        &lib.conn,
        &from_link("/Users/me/Movies/DSC001.MOV", "Local clip"),
    )
    .unwrap();

    let page = footage::list(&lib.conn, &q()).unwrap();
    assert_eq!(page.total, 3);

    let mut providers: Vec<String> = page.items.iter().map(|i| i.provider.clone()).collect();
    providers.sort();
    assert_eq!(providers, vec!["google_drive", "local", "url"]);

    // Filtering by provider is generic — no Google special case in the query.
    let only_drive = footage::list(
        &lib.conn,
        &FootageQuery {
            providers: vec!["google_drive".into()],
            ..q()
        },
    )
    .unwrap();
    assert_eq!(only_drive.total, 1);
}

/// §48: the grid pages in SQL. Loading a 10k library must not mean loading
/// 10k rows into the webview.
#[test]
fn large_libraries_page_in_sql_and_stay_responsive() {
    let dir = TempDir::new();
    let lib = connection::create(&dir.join("Big")).unwrap();
    let mut conn = lib.conn;

    let n = 10_000;
    let tx = conn.transaction().unwrap();
    for i in 0..n {
        let item = NewFootage {
            display_name: format!("Clip {i:05}"),
            media_type: Some(if i % 3 == 0 { MediaType::Image } else { MediaType::Video }),
            provider: "google_drive".into(),
            external_id: Some(format!("id-{i:06}")),
            external_key: None,
            original_url: Some(format!("https://drive.google.com/file/d/id-{i:06}/view")),
            local_path: None,
            container_id: None,
            container_path: Some(format!("Footage/Shoot {:02}", i % 20)),
            original_filename: Some(format!("DSC{i:05}.MOV")),
            mime_type: Some("video/quicktime".into()),
            file_size: Some(1024 * 1024),
            width: Some(3840),
            height: Some(2160),
            duration_ms: Some((i % 120) as i64 * 1000),
            source_created_at: None,
            source_modified_at: None,
            tags: None,
            notes: None,
            brand_asset: false,
        };
        footage::insert(&tx, &item).unwrap();
    }
    tx.commit().unwrap();

    let started = std::time::Instant::now();
    let page = footage::list(
        &conn,
        &FootageQuery {
            limit: 200,
            ..Default::default()
        },
    )
    .unwrap();
    let listing = started.elapsed();

    assert_eq!(page.total, n, "the count reflects the whole library");
    assert_eq!(page.items.len(), 200, "but only one page crosses the boundary");

    let started = std::time::Instant::now();
    let searched = footage::list(
        &conn,
        &FootageQuery {
            search: Some("Clip 04242".into()),
            limit: 200,
            ..Default::default()
        },
    )
    .unwrap();
    let search_time = started.elapsed();
    assert_eq!(searched.total, 1, "every term must match, so this narrows to one");

    // Folder scoping is a filter, not a search term — clicking a folder in the
    // sidebar must return exactly that folder's contents.
    let in_folder = footage::list(
        &conn,
        &FootageQuery {
            container_path: Some("Footage/Shoot 07".into()),
            limit: 200,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(in_folder.total, n / 20);

    // Generous ceilings — this is a regression guard against a missing index or
    // an accidental full-table scan, not a benchmark.
    assert!(listing.as_millis() < 400, "listing took {listing:?}");
    assert!(search_time.as_millis() < 800, "search took {search_time:?}");

    let folders = footage::folders(&conn).unwrap();
    assert_eq!(folders.len(), 20, "Drive hierarchy is preserved on import");
}
