import { describe, expect, it } from "vitest";
import { applyFacets, mergeValues, sortFolders, type Facet } from "./SourceFoldersPage";
import type { FolderNode } from "@/lib/types";

const folder = (
  path: string,
  tags: string[],
  branch?: string,
  brandName: string | null = null,
  addedAt = "2026-01-01",
): FolderNode => ({
  containerPath: path,
  displayName: null,
  driveFolderId: null,
  footageCount: 1,
  usedCount: 0,
  unusedCount: 1,
  tags,
  fields: branch ? [{ fieldId: 1, name: "Branch", value: branch }] : [],
  brandId: brandName ? 1 : null,
  brandName,
  addedAt,
  updatedAt: "2026-01-01",
});

const all = [
  folder("A", ["test", "kol"], "Serang", "ETIVE", "2026-03-01"),
  folder("B", ["test"], "Bandung", "Acme", "2026-01-15"),
  folder("C", ["kol"]),
];

const tag = (value: string): Facet => ({ fieldId: null, label: "Tag", value });
const branch = (value: string): Facet => ({ fieldId: 1, label: "Branch", value });
const brand = (value: string): Facet => ({ fieldId: "brand", label: "Brand", value });

const paths = (facets: Facet[]) => applyFacets(all, facets).map((f) => f.containerPath);

describe("applyFacets", () => {
  it("returns everything when nothing is selected", () => {
    expect(paths([])).toEqual(["A", "B", "C"]);
  });

  it("combines tags with AND", () => {
    expect(paths([tag("test")])).toEqual(["A", "B"]);
    expect(paths([tag("test"), tag("kol")])).toEqual(["A"]);
  });

  it("combines values of one column with OR, since a folder holds only one", () => {
    expect(paths([branch("Serang"), branch("Bandung")])).toEqual(["A", "B"]);
  });

  it("combines a tag with a column value", () => {
    expect(paths([tag("kol"), branch("Serang")])).toEqual(["A"]);
    expect(paths([tag("kol"), branch("Bandung")])).toEqual([]);
  });

  it("drops folders matching an excluded facet", () => {
    expect(paths([{ ...tag("test"), neg: true }])).toEqual(["C"]);
    expect(paths([{ ...brand("ETIVE"), neg: true }])).toEqual(["B", "C"]);
  });

  it("narrows with an include and an exclude at once", () => {
    expect(paths([tag("test"), { ...tag("kol"), neg: true }])).toEqual(["B"]);
  });

  it("applies an exclusion after an OR group, not as one more branch of it", () => {
    expect(
      paths([branch("Serang"), branch("Bandung"), { ...brand("Acme"), neg: true }]),
    ).toEqual(["A"]);
  });

  it("filters by brand, and combines brands with OR like any single-valued column", () => {
    expect(paths([brand("ETIVE")])).toEqual(["A"]);
    expect(paths([brand("ETIVE"), brand("Acme")])).toEqual(["A", "B"]);
    expect(paths([brand("ETIVE"), tag("test")])).toEqual(["A"]);
  });
});

describe("sortFolders", () => {
  const order = (key: Parameters<typeof sortFolders>[1]) =>
    sortFolders(all, key).map((f) => f.containerPath);

  it("sorts newest or oldest first by date", () => {
    expect(order({ key: "added", dir: -1 })).toEqual(["A", "B", "C"]);
    expect(order({ key: "added", dir: 1 })).toEqual(["C", "B", "A"]);
  });

  it("keeps folders with an empty column at the bottom in both directions", () => {
    expect(order({ key: "brand", dir: 1 })).toEqual(["B", "A", "C"]);
    expect(order({ key: "brand", dir: -1 })).toEqual(["A", "B", "C"]);
  });
});

describe("mergeValues", () => {
  it("adds to a multi-value cell without dropping what is there", () => {
    expect(mergeValues(["kol"], ["test", "kol"], true)).toEqual(["kol", "test"]);
  });

  it("replaces a single-value cell", () => {
    expect(mergeValues(["Serang"], ["Bandung"], false)).toEqual(["Bandung"]);
  });
});
