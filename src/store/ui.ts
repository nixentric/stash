import { create } from "zustand";
import type { FootageQuery, MediaType, SortKey, UsageFilter } from "@/lib/types";
import { emptyQuery } from "@/lib/types";

/**
 * Which sidebar entry is active. Smart views are query presets, not stored
 * state — "Unused" is `usage_count = 0`, computed fresh every time (§16).
 */
export type SidebarView =
  | { kind: "all" }
  | { kind: "unused" }
  | { kind: "used" }
  | { kind: "recentlyUsed" }
  | { kind: "mostUsed" }
  | { kind: "favorites" }
  | { kind: "missing" }
  | { kind: "sourceFolders" }
  | { kind: "brand"; id: number; name: string }
  | { kind: "tag"; name: string }
  | { kind: "collection"; id: number; name: string }
  | { kind: "project"; id: number; name: string }
  | { kind: "folder"; path: string };

export type ViewMode = "grid" | "list";

interface UiState {
  view: SidebarView;
  search: string;
  sort: SortKey;
  viewMode: ViewMode;
  gridSize: number;

  // Filter facets that combine with the active view (§24).
  usage: UsageFilter;
  mediaTypes: MediaType[];
  minRating: number | null;
  favoriteOnly: boolean;
  filterTags: string[];

  selection: number[];
  lastAnchor: number | null;
  inspectorOpen: boolean;
  quickLookId: number | null;
  settingsOpen: boolean;

  setView: (v: SidebarView) => void;
  setSearch: (s: string) => void;
  setSort: (s: SortKey) => void;
  setViewMode: (m: ViewMode) => void;
  setGridSize: (n: number) => void;
  setUsage: (u: UsageFilter) => void;
  toggleMediaType: (m: MediaType) => void;
  setMinRating: (n: number | null) => void;
  setFavoriteOnly: (b: boolean) => void;
  toggleFilterTag: (t: string) => void;
  clearFilters: () => void;
  hasActiveFilters: () => boolean;

  select: (ids: number[], anchor?: number | null) => void;
  toggleSelect: (id: number) => void;
  clearSelection: () => void;
  setInspectorOpen: (b: boolean) => void;
  setQuickLookId: (id: number | null) => void;
  setSettingsOpen: (b: boolean) => void;
}

export const useUi = create<UiState>((set, get) => ({
  view: { kind: "all" },
  search: "",
  sort: "newestAdded",
  viewMode: "grid",
  gridSize: 200,

  usage: "all",
  mediaTypes: [],
  minRating: null,
  favoriteOnly: false,
  filterTags: [],

  selection: [],
  lastAnchor: null,
  inspectorOpen: true,
  quickLookId: null,
  settingsOpen: false,

  setView: (view) =>
    set({
      view,
      selection: [],
      lastAnchor: null,
      // Switching to a smart view adopts its natural ordering, which is what
      // makes "Recently Used" actually show recent things first.
      sort:
        view.kind === "recentlyUsed"
          ? "recentlyUsed"
          : view.kind === "mostUsed"
            ? "mostUsed"
            : view.kind === "unused"
              ? "newestAdded"
              : get().sort,
    }),
  setSearch: (search) => set({ search }),
  setSort: (sort) => set({ sort }),
  setViewMode: (viewMode) => set({ viewMode }),
  setGridSize: (gridSize) => set({ gridSize }),

  setUsage: (usage) => set({ usage }),
  toggleMediaType: (m) =>
    set((s) => ({
      mediaTypes: s.mediaTypes.includes(m)
        ? s.mediaTypes.filter((x) => x !== m)
        : [...s.mediaTypes, m],
    })),
  setMinRating: (minRating) => set({ minRating }),
  setFavoriteOnly: (favoriteOnly) => set({ favoriteOnly }),
  toggleFilterTag: (t) =>
    set((s) => ({
      filterTags: s.filterTags.includes(t)
        ? s.filterTags.filter((x) => x !== t)
        : [...s.filterTags, t],
    })),
  clearFilters: () =>
    set({ usage: "all", mediaTypes: [], minRating: null, favoriteOnly: false, filterTags: [] }),
  hasActiveFilters: () => {
    const s = get();
    return (
      s.usage !== "all" ||
      s.mediaTypes.length > 0 ||
      s.minRating != null ||
      s.favoriteOnly ||
      s.filterTags.length > 0
    );
  },

  select: (selection, anchor) =>
    set({ selection, lastAnchor: anchor === undefined ? (selection.at(-1) ?? null) : anchor }),
  toggleSelect: (id) =>
    set((s) => ({
      selection: s.selection.includes(id)
        ? s.selection.filter((x) => x !== id)
        : [...s.selection, id],
      lastAnchor: id,
    })),
  clearSelection: () => set({ selection: [], lastAnchor: null }),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  setQuickLookId: (quickLookId) => set({ quickLookId }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}));

/** Folds the sidebar view and the filter bar into one backend query. */
export function buildQuery(s: UiState, offset = 0, limit = 200): FootageQuery {
  const q: FootageQuery = {
    ...emptyQuery(),
    search: s.search.trim() || null,
    usage: s.usage,
    mediaTypes: s.mediaTypes,
    minRating: s.minRating,
    favoriteOnly: s.favoriteOnly,
    tags: [...s.filterTags],
    sort: s.sort,
    offset,
    limit,
  };

  switch (s.view.kind) {
    case "unused":
      q.usage = "unused";
      break;
    case "used":
      q.usage = "used";
      break;
    case "recentlyUsed":
      q.usage = "used";
      break;
    case "mostUsed":
      q.usage = "used";
      break;
    case "favorites":
      q.favoriteOnly = true;
      break;
    case "missing":
      q.accessibility = ["source_missing", "permission_required"];
      break;
    case "tag":
      if (!q.tags.includes(s.view.name)) q.tags.push(s.view.name);
      break;
    case "collection":
      q.collectionId = s.view.id;
      break;
    case "project":
      q.projectId = s.view.id;
      break;
    case "folder":
      q.containerPath = s.view.path;
      break;
    case "all":
    case "sourceFolders":
    // A brand page renders its own guideline, not a footage query.
    case "brand":
      break;
  }
  return q;
}
