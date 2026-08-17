import { describe, expect, it } from "vitest";
import { undoOf } from "./queries";

describe("undoOf", () => {
  it("reverses a tag add with the matching remove", () => {
    expect(undoOf({ type: "addTags", ids: [1, 2], tags: ["kol"] })?.back).toEqual({
      type: "removeTags",
      ids: [1, 2],
      tags: ["kol"],
    });
  });

  it("puts the previous tags back when they were captured", () => {
    expect(undoOf({ type: "setTags", id: 1, tags: ["new"], prev: ["old"] })?.back).toEqual({
      type: "setTags",
      id: 1,
      tags: ["old"],
    });
  });

  it("offers nothing when the previous tags are unknown", () => {
    expect(undoOf({ type: "setTags", id: 1, tags: ["new"] })).toBeNull();
  });

  it("puts a removal back through the backend's restore", () => {
    expect(undoOf({ type: "remove", ids: [1, 2] })?.back).toEqual({ type: "restoreRemoved" });
  });

  it("never promises to undo a usage history it cannot rebuild", () => {
    expect(undoOf({ type: "markUnused", ids: [1] })).toBeNull();
  });
});
