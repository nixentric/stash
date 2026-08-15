use crate::db::models::{
    Brand, BrandColor, BrandDetail, BrandElement, BrandExample, BrandLogo, BrandLogoRules,
    BrandTypeface, SearchHit,
};
use crate::db::repo::brand as repo;
use crate::error::Result;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn all_brands(state: State<'_, AppState>) -> Result<Vec<Brand>> {
    state.with_library(|lib| repo::all(&lib.conn))
}

#[tauri::command]
pub fn brand_detail(state: State<'_, AppState>, id: i64) -> Result<BrandDetail> {
    state.with_library(|lib| repo::detail(&lib.conn, id))
}

/// Create when `brand.id` is 0, update otherwise. One command rather than two
/// because the dialog is the same dialog either way.
#[tauri::command]
pub fn save_brand(state: State<'_, AppState>, brand: Brand) -> Result<i64> {
    state.with_library(|lib| repo::save(&lib.conn, &brand))
}

#[tauri::command]
pub fn delete_brand(state: State<'_, AppState>, id: i64) -> Result<()> {
    state.with_library(|lib| repo::delete(&lib.conn, id))
}

#[tauri::command]
pub fn save_brand_color(state: State<'_, AppState>, color: BrandColor) -> Result<i64> {
    state.with_library(|lib| repo::save_color(&lib.conn, &color))
}

#[tauri::command]
pub fn delete_brand_color(state: State<'_, AppState>, id: i64) -> Result<()> {
    state.with_library(|lib| repo::delete_color(&lib.conn, id))
}

#[tauri::command]
pub fn save_brand_typeface(state: State<'_, AppState>, typeface: BrandTypeface) -> Result<i64> {
    state.with_library(|lib| repo::save_typeface(&lib.conn, &typeface))
}

#[tauri::command]
pub fn delete_brand_typeface(state: State<'_, AppState>, id: i64) -> Result<()> {
    state.with_library(|lib| repo::delete_typeface(&lib.conn, id))
}

#[tauri::command]
pub fn save_brand_logo(state: State<'_, AppState>, logo: BrandLogo) -> Result<i64> {
    state.with_library(|lib| repo::save_logo(&lib.conn, &logo))
}

#[tauri::command]
pub fn delete_brand_logo(state: State<'_, AppState>, id: i64) -> Result<()> {
    state.with_library(|lib| repo::delete_logo(&lib.conn, id))
}

/// Universal search across assets and every brand entity, grouped by the caller.
#[tauri::command]
pub fn universal_search(state: State<'_, AppState>, query: String) -> Result<Vec<SearchHit>> {
    state.with_library(|lib| crate::db::repo::search::universal(&lib.conn, &query))
}

#[tauri::command]
pub fn save_brand_logo_rules(state: State<'_, AppState>, rules: BrandLogoRules) -> Result<()> {
    state.with_library(|lib| repo::save_logo_rules(&lib.conn, &rules))
}

#[tauri::command]
pub fn save_brand_example(state: State<'_, AppState>, example: BrandExample) -> Result<i64> {
    state.with_library(|lib| repo::save_example(&lib.conn, &example))
}

#[tauri::command]
pub fn delete_brand_example(state: State<'_, AppState>, id: i64) -> Result<()> {
    state.with_library(|lib| repo::delete_example(&lib.conn, id))
}

#[tauri::command]
pub fn save_brand_element(state: State<'_, AppState>, element: BrandElement) -> Result<i64> {
    state.with_library(|lib| repo::save_element(&lib.conn, &element))
}

#[tauri::command]
pub fn delete_brand_element(state: State<'_, AppState>, id: i64) -> Result<()> {
    state.with_library(|lib| repo::delete_element(&lib.conn, id))
}
