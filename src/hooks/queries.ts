import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { ipc, asIpcError } from "@/lib/ipc";
import type * as T from "@/lib/types";

export const keys = {
  library: ["library"] as const,
  recent: ["recent"] as const,
  stats: ["stats"] as const,
  footage: (q: T.FootageQuery) => ["footage", q] as const,
  footageIds: (q: T.FootageQuery) => ["footageIds", q] as const,
  detail: (id: number) => ["footage", "detail", id] as const,
  thumb: (id: number, large: boolean) => ["thumb", id, large] as const,
  playback: (id: number) => ["playback", id] as const,
  downloaded: ["downloaded"] as const,
  tags: ["tags"] as const,
  collections: ["collections"] as const,
  projects: ["projects"] as const,
  folders: ["folders"] as const,
  folderFields: ["folderFields"] as const,
  defaultFolderBrand: ["defaultFolderBrand"] as const,
  folderTagsCoverFiles: ["folderTagsCoverFiles"] as const,
  google: ["google"] as const,
  caps: ["caps"] as const,
  prefs: ["prefs"] as const,
  brands: ["brands"] as const,
  brand: (id: number) => ["brands", "detail", id] as const,
};

/** Everything that changes when footage records change. */
export function invalidateLibrary(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["footage"] });
  qc.invalidateQueries({ queryKey: ["footageIds"] });
  qc.invalidateQueries({ queryKey: keys.stats });
  qc.invalidateQueries({ queryKey: keys.tags });
  qc.invalidateQueries({ queryKey: keys.collections });
  qc.invalidateQueries({ queryKey: keys.projects });
  qc.invalidateQueries({ queryKey: keys.folders });
  qc.invalidateQueries({ queryKey: keys.folderFields });
  qc.invalidateQueries({ queryKey: keys.library });
}

export function reportError(e: unknown, fallback = "Something went wrong") {
  const err = asIpcError(e);
  toast.error(err.message || fallback);
}

// ── library ─────────────────────────────────────────────────────────────────

export const useCurrentLibrary = () =>
  useQuery({ queryKey: keys.library, queryFn: ipc.currentLibrary, staleTime: 2000 });

export const useRecentLibraries = () =>
  useQuery({ queryKey: keys.recent, queryFn: ipc.recentLibraries });

export const useStats = (enabled: boolean) =>
  useQuery({ queryKey: keys.stats, queryFn: ipc.libraryStats, enabled });

// ── footage ─────────────────────────────────────────────────────────────────

export const useFootage = (query: T.FootageQuery, enabled: boolean) =>
  useQuery({
    queryKey: keys.footage(query),
    queryFn: () => ipc.listFootage(query),
    enabled,
    // Keeps the previous page visible while a new filter loads, so the grid
    // never flashes empty mid-typing.
    placeholderData: (prev) => prev,
  });

/**
 * Which footage has its original on disk, as one set for the whole grid.
 *
 * One directory read answers every card: asking per row would be a filesystem
 * scan per row. Nothing outside Stash writes there, so it only needs
 * refreshing when a download finishes.
 */
export const useDownloadedIds = (enabled: boolean) =>
  useQuery({
    queryKey: keys.downloaded,
    queryFn: async () => new Set(await ipc.downloadedIds()),
    enabled,
    staleTime: 60_000,
  });

export const useFootageIds = (query: T.FootageQuery, enabled: boolean) =>
  useQuery({
    queryKey: keys.footageIds(query),
    queryFn: () => ipc.listFootageIds(query),
    enabled,
  });

export const useFootageDetail = (id: number | null) =>
  useQuery({
    queryKey: keys.detail(id ?? -1),
    queryFn: () => ipc.getFootage(id as number),
    enabled: id != null,
  });

export const useTags = (enabled: boolean) =>
  useQuery({ queryKey: keys.tags, queryFn: ipc.allTags, enabled });

export const useCollections = (enabled: boolean) =>
  useQuery({ queryKey: keys.collections, queryFn: ipc.allCollections, enabled });

export const useProjects = (enabled: boolean) =>
  useQuery({ queryKey: keys.projects, queryFn: ipc.allProjects, enabled });

export const useFolders = (enabled: boolean) =>
  useQuery({ queryKey: keys.folders, queryFn: ipc.listFolders, enabled });

export const useFolderFields = (enabled: boolean) =>
  useQuery({ queryKey: keys.folderFields, queryFn: ipc.folderFields, enabled });

export const useDefaultFolderBrand = (enabled: boolean) =>
  useQuery({ queryKey: keys.defaultFolderBrand, queryFn: ipc.defaultFolderBrand, enabled });

export const useFolderTagsCoverFiles = (enabled: boolean) =>
  useQuery({ queryKey: keys.folderTagsCoverFiles, queryFn: ipc.folderTagsCoverFiles, enabled });

// ── integrations ────────────────────────────────────────────────────────────

export const useGoogleStatus = () =>
  useQuery({ queryKey: keys.google, queryFn: ipc.googleStatus });

// ── brands ──────────────────────────────────────────────────────────────────

export const useBrands = (enabled: boolean) =>
  useQuery({ queryKey: keys.brands, queryFn: ipc.allBrands, enabled });

export const useBrand = (id: number | null) =>
  useQuery({
    queryKey: keys.brand(id ?? 0),
    queryFn: () => ipc.brandDetail(id!),
    enabled: id != null,
  });

/**
 * One mutation for the whole brand surface: every write invalidates the same
 * two keys, and a hook per entity would only duplicate that rule four times.
 */
type BrandAction =
  | { type: "saveBrand"; brand: T.Brand }
  | { type: "deleteBrand"; id: number }
  | { type: "saveColor"; color: T.BrandColor }
  | { type: "deleteColor"; id: number }
  | { type: "saveTypeface"; typeface: T.BrandTypeface }
  | { type: "deleteTypeface"; id: number }
  | { type: "saveLogo"; logo: T.BrandLogo }
  | { type: "deleteLogo"; id: number }
  | { type: "reorderLogos"; updates: { id: number; variant: string; position: number }[] }
  | { type: "saveLogoRules"; rules: T.BrandLogoRules }
  | { type: "saveExample"; example: T.BrandExample }
  | { type: "deleteExample"; id: number }
  | { type: "saveElement"; element: T.BrandElement }
  | { type: "deleteElement"; id: number }
  | { type: "saveAdditionalInfo"; info: T.BrandAdditionalInfo }
  | { type: "deleteAdditionalInfo"; id: number }
  | { type: "reorderAdditionalInfos"; updates: { id: number; position: number }[] };

export function useBrandAction() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (a: BrandAction) => {
      switch (a.type) {
        case "saveBrand":
          return ipc.saveBrand(a.brand);
        case "deleteBrand":
          return ipc.deleteBrand(a.id);
        case "saveColor":
          return ipc.saveBrandColor(a.color);
        case "deleteColor":
          return ipc.deleteBrandColor(a.id);
        case "saveTypeface":
          return ipc.saveBrandTypeface(a.typeface);
        case "deleteTypeface":
          return ipc.deleteBrandTypeface(a.id);
        case "saveLogo": {
          const id = await ipc.saveBrandLogo(a.logo);
          // Thumbnails keep transparency only for brand logos, and the asset's
          // thumbnail is usually made at import — before this row existed, when the
          // answer to "is this a logo?" was still no. Re-encode now that it is.
          if (a.logo.footageId != null) {
            await ipc.refreshThumbnail(a.logo.footageId, true).catch(() => {});
          }
          return id;
        }
        case "deleteLogo":
          return ipc.deleteBrandLogo(a.id);
        case "reorderLogos":
          return ipc.reorderBrandLogos(a.updates);
        case "saveLogoRules":
          return ipc.saveBrandLogoRules(a.rules);
        case "saveExample":
          return ipc.saveBrandExample(a.example);
        case "deleteExample":
          return ipc.deleteBrandExample(a.id);
        case "saveElement":
          return ipc.saveBrandElement(a.element);
        case "deleteElement":
          return ipc.deleteBrandElement(a.id);
        case "saveAdditionalInfo":
          return ipc.saveBrandAdditionalInfo(a.info);
        case "deleteAdditionalInfo":
          return ipc.deleteBrandAdditionalInfo(a.id);
        case "reorderAdditionalInfos":
          return ipc.reorderBrandAdditionalInfos(a.updates);
      }
    },
    onSuccess: (_data, a) => {
      qc.invalidateQueries({ queryKey: keys.brands });
      // The re-encode above changes the bytes behind a cached data URL, so the
      // old one has to be dropped or the card keeps drawing the flattened copy.
      if (a.type === "saveLogo") {
        qc.invalidateQueries({ queryKey: ["thumb"] });
      }
    },
    onError: (e) => reportError(e),
  });
}

export const useCapabilities = () =>
  useQuery({ queryKey: keys.caps, queryFn: ipc.appCapabilities });

export const usePrefs = () => useQuery({ queryKey: keys.prefs, queryFn: ipc.getPrefs });

// ── mutations ───────────────────────────────────────────────────────────────

/**
 * All footage edits funnel through here.
 *
 * One mutation with an action union rather than a dozen near-identical hooks:
 * the invalidation rules are the same for every one of them, and duplicating
 * them is how caches drift out of sync.
 */
type Action =
  | { type: "patch"; ids: number[]; patch: T.FootagePatch }
  | { type: "markUsed"; ids: number[]; projectId: number | null; usedAt: string | null; notes: string | null }
  | { type: "markUnused"; ids: number[] }
  | { type: "deleteUsage"; usageId: number; footageId: number }
  | { type: "addTags"; ids: number[]; tags: string[] }
  | { type: "removeTags"; ids: number[]; tags: string[] }
  | { type: "setTags"; id: number; tags: string[] }
  | { type: "addToCollection"; collectionId: number; ids: number[] }
  | { type: "removeFromCollection"; collectionId: number; ids: number[] }
  | { type: "remove"; ids: number[] };

export function useFootageAction() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (a: Action) => {
      switch (a.type) {
        case "patch":
          return ipc.patchFootage(a.ids, a.patch);
        case "markUsed":
          return ipc.markUsed(a.ids, a.projectId, a.usedAt, a.notes);
        case "markUnused":
          return ipc.markUnused(a.ids);
        case "deleteUsage":
          return ipc.deleteUsage(a.usageId);
        case "addTags":
          return ipc.addTags(a.ids, a.tags);
        case "removeTags":
          return ipc.removeTags(a.ids, a.tags);
        case "setTags":
          return ipc.setTags(a.id, a.tags);
        case "addToCollection":
          return ipc.addToCollection(a.collectionId, a.ids);
        case "removeFromCollection":
          return ipc.removeFromCollection(a.collectionId, a.ids);
        case "remove":
          return ipc.removeFootage(a.ids);
      }
    },
    onSuccess: (_r, a) => {
      invalidateLibrary(qc);
      const touched =
        "ids" in a ? a.ids : "id" in a ? [a.id] : "footageId" in a ? [a.footageId] : [];
      for (const id of touched) qc.invalidateQueries({ queryKey: keys.detail(id) });
    },
    onError: (e) => reportError(e),
  });
}
