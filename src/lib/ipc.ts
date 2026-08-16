import { invoke } from "@tauri-apps/api/core";
import type * as T from "./types";

/** Normalizes any rejection into the backend's error shape. */
export function asIpcError(e: unknown): T.IpcError {
  if (e && typeof e === "object" && "kind" in e && "message" in e) {
    return e as T.IpcError;
  }
  return { kind: "other", message: String(e), retryable: false };
}

export const ipc = {
  // ── library ───────────────────────────────────────────────────────────────
  createLibrary: (path: string) => invoke<T.LibraryInfo>("create_library", { path }),
  openLibrary: (path: string) => invoke<T.LibraryInfo>("open_library", { path }),
  closeLibrary: () => invoke<void>("close_library"),
  currentLibrary: () => invoke<T.LibraryInfo | null>("current_library"),
  saveLibraryAs: (path: string, switchTo: boolean) =>
    invoke<T.LibraryInfo>("save_library_as", { path, switch: switchTo }),
  libraryStats: () => invoke<T.LibraryStats>("library_stats"),
  recentLibraries: () => invoke<T.RecentLibrary[]>("recent_libraries"),
  forgetRecent: (path: string) => invoke<void>("forget_recent", { path }),

  // ── footage ───────────────────────────────────────────────────────────────
  listFootage: (query: T.FootageQuery) => invoke<T.FootagePage>("list_footage", { query }),
  listFootageIds: (query: T.FootageQuery) => invoke<number[]>("list_footage_ids", { query }),
  getFootage: (id: number) => invoke<T.FootageDetail>("get_footage", { id }),
  patchFootage: (ids: number[], patch: T.FootagePatch) =>
    invoke<void>("patch_footage", { ids, patch }),
  removeFootage: (ids: number[]) => invoke<number>("remove_footage", { ids }),
  listFolders: () => invoke<T.FolderNode[]>("list_folders"),
  folderFields: () => invoke<T.FolderField[]>("folder_fields"),
  createFolderField: (name: string) => invoke<number>("create_folder_field", { name }),
  deleteFolderField: (id: number) => invoke<void>("delete_folder_field", { id }),
  deleteFolder: (path: string) => invoke<number>("delete_folder", { path }),
  setFolderTags: (path: string, tags: string[]) => invoke<void>("set_folder_tags", { path, tags }),
  setFolderFieldValue: (path: string, fieldId: number, value: string) =>
    invoke<void>("set_folder_field_value", { path, fieldId, value }),
  setFolderBrand: (path: string, brandId: number | null) =>
    invoke<void>("set_folder_brand", { path, brandId }),
  folderTagsCoverFiles: () => invoke<boolean>("folder_tags_cover_files"),
  setFolderTagsCoverFiles: (on: boolean) => invoke<void>("set_folder_tags_cover_files", { on }),
  defaultFolderBrand: () => invoke<number | null>("default_folder_brand"),
  setDefaultFolderBrand: (brandId: number | null) =>
    invoke<void>("set_default_folder_brand", { brandId }),

  // ── tags / collections / projects / usage ─────────────────────────────────
  allTags: () => invoke<T.Tag[]>("all_tags"),
  addTags: (ids: number[], tags: string[]) => invoke<void>("add_tags", { ids, tags }),
  removeTags: (ids: number[], tags: string[]) => invoke<void>("remove_tags", { ids, tags }),
  setTags: (id: number, tags: string[]) => invoke<void>("set_tags", { id, tags }),
  deleteTags: (ids: number[]) => invoke<number>("delete_tags", { ids }),
  renameTag: (id: number, name: string) => invoke<void>("rename_tag", { id, name }),

  allCollections: () => invoke<T.Collection[]>("all_collections"),
  createCollection: (name: string) => invoke<number>("create_collection", { name }),
  renameCollection: (id: number, name: string) =>
    invoke<void>("rename_collection", { id, name }),
  deleteCollection: (id: number) => invoke<void>("delete_collection", { id }),
  addToCollection: (collectionId: number, ids: number[]) =>
    invoke<void>("add_to_collection", { collectionId, ids }),
  removeFromCollection: (collectionId: number, ids: number[]) =>
    invoke<void>("remove_from_collection", { collectionId, ids }),

  allProjects: () => invoke<T.Project[]>("all_projects"),
  createProject: (name: string) => invoke<number>("create_project", { name }),
  renameProject: (id: number, name: string) => invoke<void>("rename_project", { id, name }),
  deleteProject: (id: number) => invoke<void>("delete_project", { id }),

  markUsed: (
    ids: number[],
    projectId: number | null,
    usedAt: string | null,
    notes: string | null,
  ) => invoke<number>("mark_used", { ids, projectId, usedAt, notes }),
  markUnused: (ids: number[]) => invoke<number>("mark_unused", { ids }),
  deleteUsage: (usageId: number) => invoke<void>("delete_usage", { usageId }),

  // ── preview ───────────────────────────────────────────────────────────────
  getThumbnail: (id: number, large: boolean) =>
    invoke<string | null>("get_thumbnail", { id, large }),
  refreshThumbnail: (id: number, force: boolean) =>
    invoke<boolean>("refresh_thumbnail", { id, force }),
  playbackTarget: (id: number) => invoke<T.PlaybackTarget>("playback_target", { id }),
  setThumbnailFromPath: (id: number, path: string) =>
    invoke<void>("set_thumbnail_from_path", { id, path }),
  setThumbnailFromBytes: (id: number, dataBase64: string) =>
    invoke<void>("set_thumbnail_from_bytes", { id, dataBase64 }),
  clearThumbnail: (id: number) => invoke<void>("clear_thumbnail", { id }),
  cacheInfo: () => invoke<{ bytesOnDisk: number }>("cache_info"),
  clearPreviewCache: () => invoke<void>("clear_preview_cache"),

  // ── import ────────────────────────────────────────────────────────────────
  parseSourceInput: (text: string) =>
    invoke<T.ParsedSource | null>("parse_source_input", { text }),
  parseBulkInput: (text: string) => invoke<T.BulkParseResult>("parse_bulk_input", { text }),
  importFootage: (items: T.NewFootage[]) =>
    invoke<T.ImportOutcome>("import_footage", { items }),
  scanDriveFolder: (folderId: string, recursive: boolean) =>
    invoke<T.ScanResult>("scan_drive_folder", { folderId, recursive }),
  browseDrive: (folderId: string | null) =>
    invoke<T.ScannedItem[]>("browse_drive", { folderId }),
  fetchThumbnails: (ids: number[], force: boolean) =>
    invoke<number>("fetch_thumbnails", { ids, force }),
  cancelJob: (jobId: string) => invoke<boolean>("cancel_job", { jobId }),

  // ── google drive ──────────────────────────────────────────────────────────
  googleStatus: () => invoke<T.GoogleStatus>("google_status"),
  googleSetClient: (clientId: string, clientSecret: string | null) =>
    invoke<void>("google_set_client", { clientId, clientSecret }),
  googleClearClient: () => invoke<void>("google_clear_client"),
  googleConnect: () => invoke<T.DriveAccount>("google_connect"),
  googleDisconnect: () => invoke<void>("google_disconnect"),
  syncLibrary: (ids: number[] | null) => invoke<T.SyncReport>("sync_library", { ids }),

  // ── brands ────────────────────────────────────────────────────────────────
  allBrands: () => invoke<T.Brand[]>("all_brands"),
  brandDetail: (id: number) => invoke<T.BrandDetail>("brand_detail", { id }),
  saveBrand: (brand: T.Brand) => invoke<number>("save_brand", { brand }),
  deleteBrand: (id: number) => invoke<void>("delete_brand", { id }),
  saveBrandColor: (color: T.BrandColor) => invoke<number>("save_brand_color", { color }),
  deleteBrandColor: (id: number) => invoke<void>("delete_brand_color", { id }),
  saveBrandTypeface: (typeface: T.BrandTypeface) =>
    invoke<number>("save_brand_typeface", { typeface }),
  deleteBrandTypeface: (id: number) => invoke<void>("delete_brand_typeface", { id }),
  systemFonts: () => invoke<string[]>("system_fonts"),
  loadFontFile: (path: string) =>
    invoke<{ family: string; dataUrl: string }>("load_font_file", { path }),
  saveBrandLogo: (logo: T.BrandLogo) => invoke<number>("save_brand_logo", { logo }),
  deleteBrandLogo: (id: number) => invoke<void>("delete_brand_logo", { id }),
  reorderBrandLogos: (updates: { id: number; variant: string; position: number }[]) =>
    invoke<void>("reorder_brand_logos", { updates }),
  reorderBrandAdditionalInfos: (updates: { id: number; position: number }[]) =>
    invoke<void>("reorder_brand_additional_infos", { updates }),
  saveBrandLogoRules: (rules: T.BrandLogoRules) =>
    invoke<void>("save_brand_logo_rules", { rules }),
  saveBrandExample: (example: T.BrandExample) => invoke<number>("save_brand_example", { example }),
  deleteBrandExample: (id: number) => invoke<void>("delete_brand_example", { id }),
  saveBrandElement: (element: T.BrandElement) => invoke<number>("save_brand_element", { element }),
  deleteBrandElement: (id: number) => invoke<void>("delete_brand_element", { id }),
  saveBrandAdditionalInfo: (info: T.BrandAdditionalInfo) => invoke<number>("save_brand_additional_info", { info }),
  deleteBrandAdditionalInfo: (id: number) => invoke<void>("delete_brand_additional_info", { id }),
  universalSearch: (query: string) => invoke<T.SearchHit[]>("universal_search", { query }),

  // ── app ───────────────────────────────────────────────────────────────────
  appCapabilities: () => invoke<T.AppCapabilities>("app_capabilities"),
  getPrefs: () => invoke<T.Prefs>("get_prefs"),
  setPrefs: (patch: Partial<T.Prefs>) => invoke<T.Prefs>("set_prefs", { patch }),
  openExternal: (url: string) => invoke<void>("open_external", { url }),
  revealInFileManager: (path: string) => invoke<void>("reveal_in_file_manager", { path }),
};
