import { describe, expect, it } from "vitest";
import { buildQuery, useUi } from "./ui";

/**
 * `buildQuery` folds the sidebar view and the filter bar into one backend query.
 * It is the only place those two can contradict each other, so it is the piece
 * worth pinning down.
 */
function stateWith(overrides: Partial<ReturnType<typeof useUi.getState>> = {}) {
  return { ...useUi.getState(), ...overrides } as ReturnType<typeof useUi.getState>;
}

describe("buildQuery", () => {
  it("defaults to the whole library with no filters", () => {
    const q = buildQuery(stateWith());
    expect(q.usage).toBe("all");
    expect(q.search).toBeNull();
    expect(q.tags).toEqual([]);
    expect(q.collectionId).toBeNull();
  });

  it("translates smart views into usage filters", () => {
    expect(buildQuery(stateWith({ view: { kind: "unused" } })).usage).toBe("unused");
    expect(buildQuery(stateWith({ view: { kind: "used" } })).usage).toBe("used");
    expect(buildQuery(stateWith({ view: { kind: "mostUsed" } })).usage).toBe("used");
  });

  it("maps collection, project and folder views onto their own fields", () => {
    expect(
      buildQuery(stateWith({ view: { kind: "collection", id: 7, name: "People" } }))
        .collectionId,
    ).toBe(7);
    expect(
      buildQuery(stateWith({ view: { kind: "project", id: 3, name: "Promo" } })).projectId,
    ).toBe(3);
    expect(
      buildQuery(stateWith({ view: { kind: "folder", path: "Footage/Raw" } }))
        .containerPath,
    ).toBe("Footage/Raw");
  });

  it("combines a tag view with tags picked in the filter bar", () => {
    const q = buildQuery(
      stateWith({ view: { kind: "tag", name: "iphone" }, filterTags: ["outdoor"] }),
    );
    expect(q.tags.sort()).toEqual(["iphone", "outdoor"]);
  });

  it("does not add a tag twice when the view and the filter agree", () => {
    const q = buildQuery(
      stateWith({ view: { kind: "tag", name: "iphone" }, filterTags: ["iphone"] }),
    );
    expect(q.tags).toEqual(["iphone"]);
  });

  it("lets the Favorites view set favorite without clobbering other facets", () => {
    const q = buildQuery(
      stateWith({ view: { kind: "favorites" }, mediaTypes: ["video"], minRating: 4 }),
    );
    expect(q.favorite).toBe(true);
    expect(q.mediaTypes).toEqual(["video"]);
    expect(q.minRating).toBe(4);
  });

  it("carries both sides of every facet through", () => {
    const q = buildQuery(
      stateWith({
        mediaTypes: ["video"],
        excludeMediaTypes: ["image"],
        minRating: 2,
        maxRating: 4,
        favorite: false,
        filterTags: ["outdoor"],
        excludeTags: ["draft"],
      }),
    );
    expect(q.excludeMediaTypes).toEqual(["image"]);
    expect(q.maxRating).toBe(4);
    expect(q.favorite).toBe(false);
    expect(q.excludeTags).toEqual(["draft"]);
  });

  it("drops an exclusion the current tag view contradicts", () => {
    const q = buildQuery(
      stateWith({ view: { kind: "tag", name: "iphone" }, excludeTags: ["iphone", "draft"] }),
    );
    expect(q.tags).toEqual(["iphone"]);
    expect(q.excludeTags).toEqual(["draft"]);
  });

  it("scopes the needs-attention view to unreachable sources only", () => {
    const q = buildQuery(stateWith({ view: { kind: "missing" } }));
    expect(q.accessibility).toEqual(["source_missing", "permission_required"]);
  });

  it("trims search and sends null rather than an empty string", () => {
    expect(buildQuery(stateWith({ search: "   " })).search).toBeNull();
    expect(buildQuery(stateWith({ search: "  iphone  " })).search).toBe("iphone");
  });

  it("passes paging through untouched", () => {
    const q = buildQuery(stateWith(), 400, 50);
    expect(q.offset).toBe(400);
    expect(q.limit).toBe(50);
  });
});

describe("filter cycling", () => {
  it("walks a value from include to exclude to off", () => {
    useUi.setState({ mediaTypes: [], excludeMediaTypes: [] });
    const ui = () => useUi.getState();
    ui().cycleMediaType("video");
    expect(ui().mediaTypes).toEqual(["video"]);
    ui().cycleMediaType("video");
    expect([ui().mediaTypes, ui().excludeMediaTypes]).toEqual([[], ["video"]]);
    ui().cycleMediaType("video");
    expect([ui().mediaTypes, ui().excludeMediaTypes]).toEqual([[], []]);
  });

  it("keeps the rating band from crossing itself", () => {
    useUi.setState({ minRating: null, maxRating: null });
    useUi.getState().setMaxRating(2);
    useUi.getState().setMinRating(4);
    expect(useUi.getState().maxRating).toBe(4);
    useUi.getState().setMaxRating(1);
    expect(useUi.getState().minRating).toBe(1);
  });

  it("clears both sides at once", () => {
    useUi.setState({ excludeTags: ["draft"], favorite: false, maxRating: 3 });
    useUi.getState().clearFilters();
    expect(useUi.getState().hasActiveFilters()).toBe(false);
  });
});

describe("view switching", () => {
  it("adopts the natural sort for time-based smart views", () => {
    const { setView } = useUi.getState();
    setView({ kind: "recentlyUsed" });
    expect(useUi.getState().sort).toBe("recentlyUsed");
    setView({ kind: "mostUsed" });
    expect(useUi.getState().sort).toBe("mostUsed");
  });

  it("walks back and forward through visited views", () => {
    const ui = () => useUi.getState();
    ui().setView({ kind: "all" });
    ui().setView({ kind: "favorites" });
    ui().setView({ kind: "tag", name: "logo" });
    // Re-clicking the same entry must not stack up a no-op step.
    ui().setView({ kind: "tag", name: "logo" });

    ui().goBack();
    expect(ui().view).toEqual({ kind: "favorites" });
    ui().goBack();
    expect(ui().view).toEqual({ kind: "all" });
    ui().goForward();
    expect(ui().view).toEqual({ kind: "favorites" });

    // A fresh navigation drops the forward trail, like a browser.
    ui().setView({ kind: "missing" });
    expect(ui().forward).toEqual([]);
  });

  it("does nothing at the ends of the history", () => {
    useUi.setState({ view: { kind: "all" }, back: [], forward: [] });
    useUi.getState().goBack();
    useUi.getState().goForward();
    expect(useUi.getState().view).toEqual({ kind: "all" });
  });

  it("clears the selection when the view changes", () => {
    useUi.getState().select([1, 2, 3]);
    expect(useUi.getState().selection).toHaveLength(3);
    useUi.getState().setView({ kind: "all" });
    expect(useUi.getState().selection).toEqual([]);
  });
});
