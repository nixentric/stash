pub mod commands;
pub mod db;
pub mod error;
pub mod gdrive;
pub mod jobs;
pub mod prefs;
pub mod preview;
pub mod source;
pub mod state;
pub mod util;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Ranged media for <video>/<img>. See preview/scheme.rs for why this is
        // a URI scheme and not a localhost proxy.
        .register_asynchronous_uri_scheme_protocol("stash", preview::scheme::handle)
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let cache_dir = app.path().app_cache_dir()?;
            std::fs::create_dir_all(&config_dir).ok();
            std::fs::create_dir_all(&cache_dir).ok();

            let state = AppState::new(config_dir, cache_dir);
            app.manage(state);

            // The window paints its own background before the first frame. The
            // config colour covers dark; flip it for a light desktop so launch
            // never flashes a colour the app isn't about to render.
            // ponytail: follows the OS theme, not the app's own theme setting —
            // move the setting into prefs if an explicit override starts mattering.
            if let Some(win) = app.get_webview_window("main") {
                if win.theme().map(|t| t == tauri::Theme::Light).unwrap_or(false) {
                    let _ = win.set_background_color(Some(tauri::window::Color(253, 253, 253, 255)));
                }
            }

            // No Drive session is restored here on purpose: reading the keychain
            // makes the OS ask the user for permission, and launching the app is
            // not a reason to ask. `DriveState::ensure_restored` does it on the
            // first call that genuinely needs Drive.

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // library
            commands::library::create_library,
            commands::library::open_library,
            commands::library::close_library,
            commands::library::current_library,
            commands::library::save_library_as,
            commands::library::library_stats,
            commands::library::recent_libraries,
            commands::library::forget_recent,
            // footage
            commands::footage::list_footage,
            commands::footage::list_footage_ids,
            commands::footage::get_footage,
            commands::footage::patch_footage,
            commands::footage::remove_footage,
            commands::footage::list_folders,
            commands::source_folder::folder_fields,
            commands::source_folder::create_folder_field,
            commands::source_folder::delete_folder_field,
            commands::source_folder::delete_folder,
            commands::source_folder::set_folder_name,
            commands::source_folder::set_folder_tags,
            commands::source_folder::set_folder_field_value,
            commands::source_folder::set_folder_brand,
            commands::source_folder::default_folder_brand,
            commands::source_folder::set_default_folder_brand,
            commands::source_folder::folder_tags_cover_files,
            commands::source_folder::set_folder_tags_cover_files,
            // brands
            commands::brand::all_brands,
            commands::brand::brand_detail,
            commands::brand::save_brand,
            commands::brand::delete_brand,
            commands::brand::save_brand_color,
            commands::brand::delete_brand_color,
            commands::brand::save_brand_typeface,
            commands::brand::delete_brand_typeface,
            commands::brand::save_brand_logo,
            commands::brand::delete_brand_logo,
            commands::brand::reorder_brand_logos,
            commands::brand::save_brand_logo_rules,
            commands::brand::save_brand_example,
            commands::brand::delete_brand_example,
            commands::brand::save_brand_element,
            commands::brand::delete_brand_element,
            commands::font::system_fonts,
            commands::font::load_font_file,
            commands::brand::save_brand_additional_info,
            commands::brand::delete_brand_additional_info,
            commands::brand::reorder_brand_additional_infos,
            commands::brand::universal_search,
            // tags / collections / projects / usage
            commands::taxonomy::all_tags,
            commands::taxonomy::add_tags,
            commands::taxonomy::remove_tags,
            commands::taxonomy::set_tags,
            commands::taxonomy::delete_tags,
            commands::taxonomy::rename_tag,
            commands::taxonomy::all_collections,
            commands::taxonomy::create_collection,
            commands::taxonomy::rename_collection,
            commands::taxonomy::delete_collection,
            commands::taxonomy::add_to_collection,
            commands::taxonomy::remove_from_collection,
            commands::taxonomy::all_projects,
            commands::taxonomy::create_project,
            commands::taxonomy::rename_project,
            commands::taxonomy::delete_project,
            commands::taxonomy::mark_used,
            commands::taxonomy::mark_unused,
            commands::taxonomy::delete_usage,
            // preview
            commands::preview::get_thumbnail,
            commands::preview::refresh_thumbnail,
            commands::preview::playback_target,
            commands::preview::set_thumbnail_from_path,
            commands::preview::set_thumbnail_from_bytes,
            commands::preview::clear_thumbnail,
            commands::preview::download_original,
            commands::preview::downloaded_ids,
            commands::preview::preview_failure,
            commands::preview::download_dir,
            commands::preview::set_download_dir,
            commands::preview::cache_info,
            commands::preview::clear_preview_cache,
            // import
            commands::import::parse_source_input,
            commands::import::parse_bulk_input,
            commands::import::import_footage,
            commands::import::check_drive_ids,
            commands::import::scan_drive_folder,
            commands::import::browse_drive,
            commands::import::fetch_thumbnails,
            commands::import::cancel_job,
            // google drive
            commands::gdrive::google_status,
            commands::gdrive::google_set_client,
            commands::gdrive::google_clear_client,
            commands::gdrive::google_connect,
            commands::gdrive::google_disconnect,
            commands::gdrive::sync_library,
            // app
            commands::app::app_capabilities,
            commands::app::get_prefs,
            commands::app::set_prefs,
            commands::app::open_external,
            commands::app::reveal_in_file_manager,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Stash");
}
