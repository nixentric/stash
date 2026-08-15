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
  footageCount: number;
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
  footageCount: number;
  usedCount: number;
  unusedCount: number;
  tags: string[];
  fields: FolderFieldValue[];
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

export interface BrandDetail {
  brand: Brand;
  colors: BrandColor[];
  typefaces: BrandTypeface[];
  logos: BrandLogo[];
  logoRules: BrandLogoRules;
  examples: BrandExample[];
  elements: BrandElement[];
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
  minRating?: number | null;
  favoriteOnly: boolean;
  tags: string[];
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
  kind: "stream" | "embed" | "image" | "none";
  url: string | null;
  externalUrl: string | null;
  reason: string | null;
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
}

export interface SyncReport {
  checked: number;
  updated: number;
  renamed: number;
  moved: number;
  missing: number;
  failed: number;
  cancelled: boolean;
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
  minRating: null,
  favoriteOnly: false,
  tags: [],
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
  sort: "newestAdded",
  offset: 0,
  limit: 200,
});

export interface SearchHit {
  /** asset | brand | color | typeface | logo */
  kind: string;
  id: number;
  title: string;
  subtitle: string;
  brandId: number | null;
  brandName: string;
  hex: string | null;
}
