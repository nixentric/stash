// Mirrors the serde types in src-tauri. Kept hand-written and narrow on purpose:
// the UI should only be able to name concepts the backend actually exposes.

export type MediaType = "image" | "video" | "audio" | "other" | "unknown";
export type ProviderId = "google_drive" | "local" | "url";

export type Accessibility =
  | "available"
  | "preview_available"
  | "authentication_required"
  | "permission_required"
  | "offline"
  | "source_missing"
  | "unknown";

export type Tri = "yes" | "bestEffort" | "no";

export interface Capabilities {
  canOpen: boolean;
  canPreview: Tri;
  canFetchMetadata: boolean;
  canBrowseContainer: boolean;
  canSync: boolean;
  canDownloadThumbnail: Tri;
  canResolvePrivate: boolean;
}

export interface AppCapabilities {
  googleDrive: Capabilities;
  local: Capabilities;
  url: Capabilities;
  driveConnected: boolean;
  online: boolean;
}

export interface LibraryInfo {
  path: string;
  name: string;
  schemaVersion: number;
  fileSize: number;
  footageCount: number;
}

export interface RecentLibrary {
  path: string;
  name: string;
  openedAt: string;
}

/** Provider-reported facts. Every field may be absent — that is a normal state. */
export interface SourceInfo {
  provider: ProviderId;
  externalId: string | null;
  externalKey: string | null;
  originalUrl: string | null;
  localPath: string | null;
  containerId: string | null;
  containerPath: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sourceCreatedAt: string | null;
  sourceModifiedAt: string | null;
  accessibility: Accessibility;
  lastSyncedAt: string | null;
}

export interface FootageListItem {
  id: number;
  displayName: string;
  mediaType: MediaType;
  rating: number;
  favorite: boolean;
  usageCount: number;
  lastUsedAt: string | null;
  dateAdded: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  provider: ProviderId;
  accessibility: Accessibility;
  hasThumbnail: boolean;
  tags: string[];
}

export interface UsageRecord {
  id: number;
  projectId: number | null;
  projectName: string | null;
  usedAt: string;
  notes: string;
}

export interface Collection {
  id: number;
  name: string;
  footageCount: number;
}

export interface Tag {
  id: number;
  name: string;
  /** Files the tag reaches — folder tags only reach them when the switch is on. */
  footageCount: number;
  /** Source folders carrying the tag, whatever the switch says. */
  folderCount: number;
}

export interface Project {
  id: number;
  name: string;
  color: string | null;
  notes: string;
  createdAt: string;
  usageCount: number;
  footageCount: number;
}

export interface FootageDetail {
  id: number;
  displayName: string;
  mediaType: MediaType;
  notes: string;
  rating: number;
  favorite: boolean;
  usageCount: number;
  lastUsedAt: string | null;
  dateAdded: string;
  dateModified: string;
  source: SourceInfo;
  tags: string[];
  collections: Collection[];
  usage: UsageRecord[];
  hasThumbnail: boolean;
  thumbnailOrigin: string | null;
  thumbnailPinned: boolean;
}

export interface FolderNode {
  containerPath: string;
  /** The name the user gave the folder. The original path is still shown under it. */
  displayName: string | null;
  /** Drive id of the folder these files came from — the link back to the original. */
  driveFolderId: string | null;
  footageCount: number;
  usedCount: number;
  unusedCount: number;
  tags: string[];
  fields: FolderFieldValue[];
  /** Whose folder this is, resolved from the brand itself so renames follow. */
  brandId: number | null;
  brandName: string | null;
  /** Oldest footage added from this folder — folders have no creation record of their own. */
  addedAt: string;
  /** Latest footage edit or folder tag/column edit. */
  updatedAt: string;
}

// ── brands ──────────────────────────────────────────────────────────────────

/** Roles a colour can hold in a palette, in the order they are shown. */
export const COLOR_ROLES = [
  "primary",
  "secondary",
  "accent",
  "neutral",
  "background",
  "semantic",
] as const;

export const TYPE_ROLES = [
  "display",
  "heading",
  "subheading",
  "body",
  "caption",
  "ui",
  "fallback",
] as const;

export const LOGO_VARIANTS = [
  "primary",
  "secondary",
  "horizontal",
  "vertical",
  "icon",
  "white",
  "black",
  "mono",
] as const;

export interface Brand {
  id: number;
  name: string;
  description: string;
  tagline: string;
  website: string;
  notes: string;
  coverFootageId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrandColor {
  id: number;
  brandId: number;
  role: string;
  name: string;
  /** Canonical `#RRGGBB`; RGB and CMYK are derived for display. */
  hex: string;
  notes: string;
  position: number;
}

export interface BrandTypeface {
  id: number;
  brandId: number;
  role: string;
  family: string;
  weight: string;
  size: string;
  lineHeight: string;
  letterSpacing: string;
  notes: string;
  /** Set when the family came from a font file on disk rather than an installed one. */
  fontFile: string | null;
  position: number;
}

export interface BrandLogo {
  id: number;
  brandId: number;
  variant: string;
  name: string;
  /** Points into the asset library, so the file exists exactly once. */
  footageId: number | null;
  notes: string;
  position: number;
}

export const ELEMENT_CATEGORIES = [
  "shape",
  "pattern",
  "gradient",
  "texture",
  "decorative",
  "frame",
  "background",
] as const;

export interface BrandLogoRules {
  brandId: number;
  clearSpace: string;
  minimumSize: string;
  backgroundUsage: string;
  updatedAt: string;
}

export interface BrandExample {
  id: number;
  brandId: number;
  /** Only "logo" has a screen today; the field exists for the sections to come. */
  section: string;
  verdict: "correct" | "incorrect";
  caption: string;
  footageId: number | null;
  position: number;
}

export interface BrandElement {
  id: number;
  brandId: number;
  category: string;
  name: string;
  /** Points into the asset library rather than duplicating the file. */
  footageId: number | null;
  notes: string;
  position: number;
}

export interface BrandAdditionalInfo {
  id: number;
  brandId: number;
  title: string;
  editorMode: string;
  contentType: string;
  content: string;
  fileReference: string | null;
  position: number;
  updatedAt: string;
}

export interface BrandDetail {
  brand: Brand;
  colors: BrandColor[];
  typefaces: BrandTypeface[];
  logos: BrandLogo[];
  logoRules: BrandLogoRules;
  examples: BrandExample[];
  elements: BrandElement[];
  additionalInfos: BrandAdditionalInfo[];
}

export const emptyBrand = (): Brand => ({
  id: 0,
  name: "",
  description: "",
  tagline: "",
  website: "",
  notes: "",
  coverFootageId: null,
  createdAt: "",
  updatedAt: "",
});

export interface FolderField { id: number; name: string }
export interface FolderFieldValue { fieldId: number; name: string; value: string }

export type UsageFilter = "all" | "used" | "unused";

export type SortKey =
  | "newestAdded"
  | "oldestAdded"
  | "nameAsc"
  | "nameDesc"
  | "recentlyUsed"
  | "mostUsed"
  | "neverUsed"
  | "highestRating"
  | "duration";

export interface FootageQuery {
  search?: string | null;
  usage: UsageFilter;
  mediaTypes: MediaType[];
  /** Types kept out. A type never sits in both lists — the UI cycles one value. */
  excludeMediaTypes: MediaType[];
  minRating?: number | null;
  maxRating?: number | null;
  /** null: rating irrelevant · true: favorites only · false: favorites hidden. */
  favorite?: boolean | null;
  tags: string[];
  /** Tags that disqualify a file, however many other tags match. */
  excludeTags: string[];
  collectionId?: number | null;
  projectId?: number | null;
  containerPath?: string | null;
  providers: string[];
  accessibility: string[];
  addedAfter?: string | null;
  addedBefore?: string | null;
  usedAfter?: string | null;
  usedBefore?: string | null;
  missingThumbnail: boolean;
  /** Brand logos are hidden from the library; set this for whole-catalogue jobs. */
  includeBrandLogos: boolean;
  sort: SortKey;
  offset: number;
  limit: number;
}

export interface FootagePage {
  items: FootageListItem[];
  total: number;
}

export interface LibraryStats {
  total: number;
  used: number;
  unused: number;
  images: number;
  videos: number;
  favorites: number;
  missing: number;
  withoutThumbnail: number;
}

export interface NewFootage {
  displayName: string;
  mediaType?: MediaType | null;
  provider: ProviderId;
  externalId?: string | null;
  externalKey?: string | null;
  originalUrl?: string | null;
  localPath?: string | null;
  containerId?: string | null;
  containerPath?: string | null;
  originalFilename?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  sourceCreatedAt?: string | null;
  sourceModifiedAt?: string | null;
  tags?: string[] | null;
  notes?: string | null;
  /** Imported from the brand page: it belongs to the guideline, not the grid. */
  brandAsset?: boolean;
}

export interface FootagePatch {
  displayName?: string;
  notes?: string;
  rating?: number;
  favorite?: boolean;
}

export interface DuplicateHit {
  footageId: number;
  displayName: string;
  externalId: string | null;
  input: string;
}

export interface ImportOutcome {
  imported: number[];
  duplicates: DuplicateHit[];
  failed: { input: string; reason: string }[];
}

/** A pasted Drive id that turns out to already be in the library. */
export interface DriveHit {
  externalId: string;
  kind: "item" | "folder";
  footageId: number | null;
  name: string;
  containerPath: string | null;
  count: number;
}

export type SourceKind = "item" | "container";

export interface ParsedSource {
  provider: ProviderId;
  kind: SourceKind;
  externalId: string | null;
  externalKey: string | null;
  originalUrl: string | null;
  localPath: string | null;
  suggestedName: string;
}

export interface BulkEntry {
  source: ParsedSource;
  label: string | null;
  line: number;
}

export interface BulkParseResult {
  entries: BulkEntry[];
  unrecognized: string[];
}

export interface ScannedItem {
  externalId: string;
  name: string;
  mimeType: string | null;
  mediaType: MediaType;
  isFolder: boolean;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  createdTime: string | null;
  modifiedTime: string | null;
  containerId: string | null;
  containerPath: string;
  webViewLink: string | null;
  alreadyInLibrary: boolean;
}

export interface ScanResult {
  jobId: string;
  rootName: string;
  items: ScannedItem[];
  foldersScanned: number;
  cancelled: boolean;
}

/** How to render a preview. The UI switches on `kind` and nothing else. */
export interface PlaybackTarget {
  kind: "stream" | "embed" | "image" | "gone" | "none";
  url: string | null;
  externalUrl: string | null;
  reason: string | null;
  /** True once the original is on disk; the preview is then the real file. */
  downloaded: boolean;
  /** The file on this machine, downloaded copy or catalogued local file. */
  localPath: string | null;
  /** Whether Download can do anything for this source. */
  downloadable: boolean;
}

/** Emitted as `download:progress` while an original is being fetched. */
export interface DownloadProgress {
  id: number;
  received: number;
  total: number | null;
}

export interface DriveAccount {
  email: string | null;
  displayName: string | null;
}

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  account: DriveAccount | null;
  keychainAvailable: boolean;
  clientIdSource: "environment" | "settings" | "none";
  /** Whether the client secret is stored — an id without one cannot connect. */
  clientSecretSaved: boolean;
  /** Development builds keep secrets in a temp file, not the keychain. */
  secretsTemporary: boolean;
}

export interface SyncReport {
  checked: number;
  updated: number;
  renamed: number;
  moved: number;
  /** The ones an authenticated lookup says are gone, so the caller can act on them. */
  missingIds: number[];
  failed: number;
  cancelled: boolean;
}

/** One source, checked, as it happens. Emitted as `sync:item` during a check. */
export interface SyncItem {
  /** So a dialog watching the run can offer to stop it. */
  jobId: string;
  done: number;
  total: number;
  footageId: number;
  /** The name on screen, not the filename at the source. */
  name: string;
  /** This one came back gone. */
  gone: boolean;
}

export interface JobProgress {
  jobId: string;
  phase: "scanning" | "importing" | "thumbnails" | "syncing" | "done" | "cancelled" | "error";
  done: number;
  total: number | null;
  message: string | null;
}

export type Theme = "light" | "dark" | "system";
export type PortableThumbnailSize = "none" | "small" | "standard";

export type AddFootageTab = "links" | "local" | "drive";

export interface Prefs {
  theme: Theme;
  recent: RecentLibrary[];
  lastLibrary: string | null;
  portableThumbnailSize: PortableThumbnailSize;
  googleClientId: string | null;
  googleAccountEmail: string | null;
  windowWidth: number | null;
  windowHeight: number | null;
  sidebarWidth: number | null;
  inspectorWidth: number | null;
  inspectorVisible: boolean | null;
  gridSize: number | null;
  viewMode: string | null;
  /** Which tab Add Footage opens on. Null means Links. */
  addFootageTab: AddFootageTab | null;
  /** Where downloaded originals go. Null means `Downloaded/` beside the library. */
  downloadDir: string | null;
  /** Download the original as soon as a footage is opened. */
  autoDownload: boolean;
  /** When false, Stash never contacts the update server at all. */
  checkUpdates: boolean;
}

/** Shape of every rejected `invoke`. */
export interface IpcError {
  kind: string;
  message: string;
  retryable: boolean;
}

export const emptyQuery = (): FootageQuery => ({
  search: null,
  usage: "all",
  mediaTypes: [],
  excludeMediaTypes: [],
  minRating: null,
  maxRating: null,
  favorite: null,
  tags: [],
  excludeTags: [],
  collectionId: null,
  projectId: null,
  containerPath: null,
  providers: [],
  accessibility: [],
  addedAfter: null,
  addedBefore: null,
  usedAfter: null,
  usedBefore: null,
  missingThumbnail: false,
  includeBrandLogos: false,
  sort: "newestAdded",
  offset: 0,
  limit: 200,
});

export interface UpdateStatus {
  current: string;
  latest: string;
  updateAvailable: boolean;
  url: string;
  notes: string;
  publishedAt: string;
}

export interface SearchHit {
  /** asset | brand | color | typeface | logo */
  kind: string;
  id: number;
  title: string;
  subtitle: string;
  brandId: number | null;
  brandName: string;
  hex: string | null;
  /** Link-shaped hits (a URL Additional Info): clicking opens this. */
  url: string | null;
}
