import { describe, expect, it } from "vitest";
import { applyFacets, type Facet } from "./SourceFoldersPage";
import type { FolderNode } from "@/lib/types";

const folder = (path: string, tags: string[], branch?: string): FolderNode => ({
  containerPath: path,
  footageCount: 1,
  usedCount: 0,
  unusedCount: 1,
  tags,
  fields: branch ? [{ fieldId: 1, name: "Branch", value: branch }] : [],
  addedAt: "2026-01-01",
  updatedAt: "2026-01-01",
});

const all = [
  folder("A", ["test", "kol"], "Serang"),
  folder("B", ["test"], "Bandung"),
  folder("C", ["kol"]),
];

const tag = (value: string): Facet => ({ fieldId: null, label: "Tag", value });
const branch = (value: string): Facet => ({ fieldId: 1, label: "Branch", value });

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
});
