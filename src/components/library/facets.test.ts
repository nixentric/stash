import { describe, expect, it } from "vitest";
import {
  applyFacets,
  deleteLabel,
  deleteTarget,
  filterFolders,
  mergeValues,
  NOTHING_DOOMED,
  planTotals,
  sortFolders,
  type Facet,
  type FileRow,
} from "./SourceFoldersPage";
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

describe("filterFolders", () => {
  const hits = (term: string) => filterFolders(all, term).map((f) => f.containerPath);

  it("returns everything for an empty or blank term", () => {
    expect(hits("")).toEqual(["A", "B", "C"]);
    expect(hits("   ")).toEqual(["A", "B", "C"]);
  });

  it("matches a tag, a brand or a column value, whatever the case", () => {
    expect(hits("kol")).toEqual(["A", "C"]);
    expect(hits("ETIVE")).toEqual(["A"]);
    expect(hits("bandung")).toEqual(["B"]);
  });

  it("requires every word, and may take each from a different field", () => {
    expect(hits("kol serang")).toEqual(["A"]);
    expect(hits("kol bandung")).toEqual([]);
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

describe("deleteTarget", () => {
  const [a, b, c] = all as [FolderNode, FolderNode, FolderNode];
  const fileIn = (id: number, path: string): FileRow => ({
    id,
    containerPath: path,
    displayName: `file-${id}`,
  });
  const f1 = fileIn(1, "A");
  const f2 = fileIn(2, "Z");
  const picked = { folders: [a, b], files: [f1, f2] };

  it("takes the whole ticked set, files included, when the click lands inside it", () => {
    expect(deleteTarget(a, picked)).toBe(picked);
    expect(deleteTarget(f2, picked)).toBe(picked);
  });

  it("takes only the clicked folder when the click lands outside the ticked set", () => {
    const plan = deleteTarget(c, picked);
    expect(plan.folders.map((f) => f.containerPath)).toEqual(["C"]);
    expect(plan.files).toEqual([]);
  });

  it("takes only the clicked file when the click lands outside the ticked set", () => {
    const loose = fileIn(9, "C");
    const plan = deleteTarget(loose, picked);
    expect(plan.folders).toEqual([]);
    expect(plan.files.map((f) => f.id)).toEqual([9]);
  });

  it("takes the clicked row when nothing is ticked", () => {
    expect(deleteTarget(c, NOTHING_DOOMED).folders.map((f) => f.containerPath)).toEqual(["C"]);
  });
});

describe("planTotals", () => {
  const [a, b] = all as [FolderNode, FolderNode];
  const file = (id: number, path: string): FileRow => ({
    id,
    containerPath: path,
    displayName: `file-${id}`,
  });

  it("drops a ticked file whose folder is going anyway", () => {
    // A carries 1 footage record; the file inside it must not be counted twice
    // nor removed a second time after the folder already took it.
    const totals = planTotals({ folders: [a], files: [file(1, "A"), file(2, "Z")] });
    expect(totals.fileIds).toEqual([2]);
    expect(totals.footageCount).toBe(2);
  });

  it("counts every folder's contents plus the loose files", () => {
    const totals = planTotals({ folders: [a, b], files: [file(3, "Z")] });
    expect(totals.fileIds).toEqual([3]);
    expect(totals.footageCount).toBe(3);
  });

  it("is empty for an empty plan", () => {
    expect(planTotals(NOTHING_DOOMED)).toEqual({ fileIds: [], footageCount: 0 });
  });
});

describe("deleteLabel", () => {
  const [a, b] = all as [FolderNode, FolderNode];
  const file = (id: number): FileRow => ({ id, containerPath: "Z", displayName: `file-${id}` });

  it("names both halves of a mixed selection", () => {
    expect(deleteLabel({ folders: [a, b], files: [file(1)] })).toBe("Delete 2 Folders and 1 File");
  });

  it("names only the half that is there, in the singular when it is one", () => {
    expect(deleteLabel({ folders: [a], files: [] })).toBe("Delete 1 Folder");
    expect(deleteLabel({ folders: [], files: [file(1), file(2)] })).toBe("Delete 2 Files");
  });

  it("stays a plain Delete when there is nothing in the plan", () => {
    expect(deleteLabel(NOTHING_DOOMED)).toBe("Delete");
  });
});
