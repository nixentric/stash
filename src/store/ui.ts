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

/** Identity of a view, so history can tell "same place" from "new place". */
const viewKey = (v: SidebarView) =>
  [v.kind, "id" in v ? v.id : "", "name" in v ? v.name : "", "path" in v ? v.path : ""].join("\u0000");

const sameView = (a: SidebarView, b: SidebarView) => viewKey(a) === viewKey(b);

/**
 * Switching to a smart view adopts its natural ordering, which is what makes
 * "Recently Used" actually show recent things first.
 */
function sortFor(view: SidebarView, current: SortKey): SortKey {
  return view.kind === "recentlyUsed"
    ? "recentlyUsed"
    : view.kind === "mostUsed"
      ? "mostUsed"
      : view.kind === "unused"
        ? "newestAdded"
        : current;
}

/**
 * One value's trip through include → exclude → off, over the two lists that hold
 * it. A value is never in both lists, which is what keeps "include" and "exclude"
 * from contradicting each other.
 */
function cycle<T>(include: T[], exclude: T[], v: T): [T[], T[]] {
  if (include.includes(v)) return [include.filter((x) => x !== v), [...exclude, v]];
  if (exclude.includes(v)) return [include, exclude.filter((x) => x !== v)];
  return [[...include, v], exclude];
}

/** Which side of a filter a value sits on, for the menus and chips to draw. */
export const triOf = <T,>(include: T[], exclude: T[], v: T): 1 | 0 | -1 =>
  include.includes(v) ? 1 : exclude.includes(v) ? -1 : 0;

interface UiState {
  view: SidebarView;
  /** Browser-style history around `view`, the one place navigation happens. */
  back: SidebarView[];
  forward: SidebarView[];
  search: string;
  sort: SortKey;
  viewMode: ViewMode;
  gridSize: number;

  // Filter facets that combine with the active view (§24). Every facet reads in
  // both directions: a list of what to keep beside a list of what to drop, and a
  // rating band instead of a floor.
  usage: UsageFilter;
  mediaTypes: MediaType[];
  excludeMediaTypes: MediaType[];
  minRating: number | null;
  maxRating: number | null;
  /** null: don't care · true: favorites only · false: favorites hidden. */
  favorite: boolean | null;
  filterTags: string[];
  excludeTags: string[];

  selection: number[];
  lastAnchor: number | null;
  inspectorOpen: boolean;
  quickLookId: number | null;
  settingsOpen: boolean;

  setView: (v: SidebarView) => void;
  goBack: () => void;
  goForward: () => void;
  setSearch: (s: string) => void;
  setSort: (s: SortKey) => void;
  setViewMode: (m: ViewMode) => void;
  setGridSize: (n: number) => void;
  setUsage: (u: UsageFilter) => void;
  cycleMediaType: (m: MediaType) => void;
  setMinRating: (n: number | null) => void;
  setMaxRating: (n: number | null) => void;
  cycleFavorite: () => void;
  cycleFilterTag: (t: string) => void;
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
  back: [],
  forward: [],
  search: "",
  sort: "newestAdded",
  viewMode: "grid",
  gridSize: 200,

  usage: "all",
  mediaTypes: [],
  excludeMediaTypes: [],
  minRating: null,
  maxRating: null,
  favorite: null,
  filterTags: [],
  excludeTags: [],

  selection: [],
  lastAnchor: null,
  inspectorOpen: true,
  quickLookId: null,
  settingsOpen: false,

  setView: (view) =>
    set((s) => {
      // Re-clicking the entry you are already on is not a navigation, so it
      // must not push a duplicate onto the back stack.
      if (sameView(s.view, view)) return { selection: [], lastAnchor: null };
      return {
        view,
        back: [...s.back, s.view],
        forward: [],
        selection: [],
        lastAnchor: null,
        sort: sortFor(view, s.sort),
      };
    }),
  goBack: () =>
    set((s) => {
      const prev = s.back.at(-1);
      if (!prev) return {};
      return {
        view: prev,
        back: s.back.slice(0, -1),
        forward: [s.view, ...s.forward],
        selection: [],
        lastAnchor: null,
        sort: sortFor(prev, s.sort),
      };
    }),
  goForward: () =>
    set((s) => {
      const [next, ...rest] = s.forward;
      if (!next) return {};
      return {
        view: next,
        back: [...s.back, s.view],
        forward: rest,
        selection: [],
        lastAnchor: null,
        sort: sortFor(next, s.sort),
      };
    }),
  setSearch: (search) => set({ search }),
  setSort: (sort) => set({ sort }),
  setViewMode: (viewMode) => set({ viewMode }),
  setGridSize: (gridSize) => set({ gridSize }),

  setUsage: (usage) => set({ usage }),
  cycleMediaType: (m) =>
    set((s) => {
      const [mediaTypes, excludeMediaTypes] = cycle(s.mediaTypes, s.excludeMediaTypes, m);
      return { mediaTypes, excludeMediaTypes };
    }),
  // A band that crosses itself matches nothing and looks like a broken library,
  // so the other end gives way instead.
  setMinRating: (minRating) =>
    set((s) => ({
      minRating,
      maxRating: minRating && s.maxRating && s.maxRating < minRating ? minRating : s.maxRating,
    })),
  setMaxRating: (maxRating) =>
    set((s) => ({
      maxRating,
      minRating: maxRating && s.minRating && s.minRating > maxRating ? maxRating : s.minRating,
    })),
  // Off → only → hidden → off. Two menu rows would say the same thing twice.
  cycleFavorite: () =>
    set((s) => ({ favorite: s.favorite == null ? true : s.favorite ? false : null })),
  cycleFilterTag: (t) =>
    set((s) => {
      const [filterTags, excludeTags] = cycle(s.filterTags, s.excludeTags, t);
      return { filterTags, excludeTags };
    }),
  clearFilters: () =>
    set({
      usage: "all",
      mediaTypes: [],
      excludeMediaTypes: [],
      minRating: null,
      maxRating: null,
      favorite: null,
      filterTags: [],
      excludeTags: [],
    }),
  hasActiveFilters: () => {
    const s = get();
    return (
      s.usage !== "all" ||
      s.mediaTypes.length > 0 ||
      s.excludeMediaTypes.length > 0 ||
      s.minRating != null ||
      s.maxRating != null ||
      s.favorite != null ||
      s.filterTags.length > 0 ||
      s.excludeTags.length > 0
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
    excludeMediaTypes: s.excludeMediaTypes,
    minRating: s.minRating,
    maxRating: s.maxRating,
    favorite: s.favorite,
    tags: [...s.filterTags],
    excludeTags: [...s.excludeTags],
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
      q.favorite = true;
      break;
    case "missing":
      q.accessibility = ["source_missing", "permission_required"];
      break;
    case "tag": {
      // Standing inside a tag beats having excluded it earlier, otherwise the
      // view opens empty with no way to see why.
      const { name } = s.view;
      q.excludeTags = q.excludeTags.filter((t) => t !== name);
      if (!q.tags.includes(name)) q.tags.push(name);
      break;
    }
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
