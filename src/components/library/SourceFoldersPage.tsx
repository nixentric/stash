import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  FolderTree,
  ImageOff,
  Pencil,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ipc } from "@/lib/ipc";
import { invalidateLibrary, reportError, useFolders, useFolderFields, useFootage, useTags, useBrands } from "@/hooks/queries";
import { useThumbnail, useVisible } from "@/hooks/use-thumbnail";
import { Select } from "@/components/dialogs/BrandDialogs";
import { useUi } from "@/store/ui";
import { emptyQuery, type FolderNode } from "@/lib/types";
import { date, relativeDate } from "@/lib/format";
import { ManageColumnsDialog } from "@/components/dialogs/ManageColumnsDialog";

/** One thumbnail in a folder's preview strip. */
function Thumb({ id }: { id: number }) {
  const thumb = useThumbnail(id, true);
  return thumb.data ? (
    <img src={thumb.data} alt="" loading="lazy" className="size-8 shrink-0 rounded-sm object-cover" />
  ) : (
    <div className="size-8 shrink-0 rounded-sm bg-thumb-bg" />
  );
}

/**
 * A tag, a brand, or a custom-field value that narrows the table to matching
 * folders. `fieldId` says which: `null` is a tag, `"brand"` is the brand, a
 * number is that custom column.
 */
export type Facet = { fieldId: number | null | "brand"; label: string; value: string };

export const sameFacet = (a: Facet, b: Facet) => a.fieldId === b.fieldId && a.value === b.value;

const matches = (folder: FolderNode, f: Facet) =>
  f.fieldId === "brand"
    ? folder.brandName === f.value
    : f.fieldId === null
      ? folder.tags.includes(f.value)
      : folder.fields.some((v) => v.fieldId === f.fieldId && v.value.split(",").map((x) => x.trim()).includes(f.value));

/**
 * Tags combine with AND — a folder carries many, so "test AND kol" is the useful
 * reading. Values of one custom column combine with OR instead: a folder holds a
 * single value per column, so AND there would always return nothing. A brand is
 * single-valued too, so it follows the column rule.
 */
export function applyFacets(folders: FolderNode[], facets: Facet[]): FolderNode[] {
  const tags = facets.filter((f) => f.fieldId === null);
  const byField = new Map<number | "brand", Facet[]>();
  for (const f of facets) {
    if (f.fieldId !== null) byField.set(f.fieldId, [...(byField.get(f.fieldId) ?? []), f]);
  }
  return folders.filter(
    (folder) =>
      tags.every((f) => matches(folder, f)) &&
      [...byField.values()].every((group) => group.some((f) => matches(folder, f))),
  );
}

/**
 * Stable colour per value, so the same tag reads the same on every row. Hashing
 * beats storing a colour: no schema, no picker, and new tags are coloured for free.
 */
function hue(value: string): number {
  let h = 0;
  for (const ch of value) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}

/** Chip that toggles `facet` as the table filter. */
function FacetChip({
  facet,
  active,
  onToggle,
}: {
  facet: Facet;
  active: boolean;
  onToggle: (f: Facet) => void;
}) {
  return (
    <button
      type="button"
      title={active ? `Clear filter: ${facet.label}` : `Filter by ${facet.label}: ${facet.value}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(facet);
      }}
      className={`flex max-w-[12rem] cursor-pointer items-center gap-1.5 rounded-full px-2 py-0.5
                  text-[11px] transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-accent text-muted-foreground hover:text-foreground"
                  }`}
    >
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: `hsl(${hue(facet.value)} 70% 55%)` }}
      />
      <span className="truncate">{facet.value}</span>
    </button>
  );
}

/** Column the table is ordered by. Custom columns sort as `field:<id>`. */
type SortKey = "path" | "used" | "brand" | "added" | "updated" | `field:${number}`;
type Sort = { key: SortKey; dir: 1 | -1 };

/** Dates are ISO-8601, so string order is chronological order — no parsing. */
function sortValue(folder: FolderNode, key: SortKey): string | number {
  switch (key) {
    case "path": return folder.containerPath.toLowerCase();
    case "used": return folder.usedCount;
    case "brand": return folder.brandName?.toLowerCase() ?? "";
    case "added": return folder.addedAt;
    case "updated": return folder.updatedAt;
    default:
      return folder.fields.find((v) => `field:${v.fieldId}` === key)?.value.toLowerCase() ?? "";
  }
}

export function sortFolders(folders: FolderNode[], sort: Sort): FolderNode[] {
  return [...folders].sort((a, b) => {
    const [x, y] = [sortValue(a, sort.key), sortValue(b, sort.key)];
    // Folders with nothing in the column sink to the bottom either way, so
    // flipping the order never fills the top with blanks.
    if (x === "" || y === "") return x === y ? 0 : x === "" ? 1 : -1;
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });
}

/** Header cell that toggles the table's order between ascending and descending. */
function SortHeader({
  label,
  column,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  column: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === column;
  return (
    <th className={`px-3 py-2 font-medium ${className}`}>
      <button
        type="button"
        onClick={() => onSort(column)}
        title={`Sort by ${label}`}
        className={`flex cursor-pointer items-center gap-1 uppercase tracking-wide transition-colors
                    hover:text-foreground ${active ? "text-foreground" : ""}`}
      >
        <span className="truncate">{label}</span>
        {active ? (
          sort.dir === 1 ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />
        ) : (
          <ChevronsUpDown className="size-3 opacity-0 transition-opacity group-hover/head:opacity-40" />
        )}
      </button>
    </th>
  );
}

/**
 * First few covers in a folder, so the row says what is inside without opening
 * it. Gated on visibility — a library with hundreds of folders would otherwise
 * fire hundreds of queries on mount.
 */
function FolderPreview({ path }: { path: string }) {
  const { ref, visible } = useVisible<HTMLDivElement>();
  const page = useFootage({ ...emptyQuery(), containerPath: path, limit: 3 }, visible);
  const items = page.data?.items ?? [];

  return (
    <div ref={ref} className="flex gap-1">
      {items.map((i) => (
        <Thumb key={i.id} id={i.id} />
      ))}
      {visible && !page.isLoading && items.length === 0 && (
        <ImageOff className="size-4 text-subtle-foreground" />
      )}
    </div>
  );
}

export function SourceFoldersPage() {
  const folders = useFolders(true);
  const fields = useFolderFields(true);
  const { setView } = useUi();
  const qc = useQueryClient();

  const brands = useBrands(true);

  const [facets, setFacets] = useState<Facet[]>([]);
  const [sort, setSort] = useState<Sort>({ key: "path", dir: 1 });
  const [doomed, setDoomed] = useState<FolderNode | null>(null);
  const [deleting, setDeleting] = useState(false);

  // States for inline editing
  const [multipleTagFields, setMultipleTagFields] = useState<number[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("stash:multiple_tag_fields") ?? "[]");
    } catch {
      return [];
    }
  });
  const [editingBrandPath, setEditingBrandPath] = useState<string | null>(null);
  const [editingTagsPath, setEditingTagsPath] = useState<string | null>(null);
  const [tagInputText, setTagInputText] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);

  const [editingColumnPath, setEditingColumnPath] = useState<string | null>(null);
  const [editingColumnId, setEditingColumnId] = useState<number | null>(null);
  const [columnInputText, setColumnInputText] = useState("");
  const [colHighlightIdx, setColHighlightIdx] = useState(0);

  const [manageColumnsOpen, setManageColumnsOpen] = useState(false);

  const allTags = useTags(true);
  const tagSuggestions = useMemo(() => {
    const q = tagInputText.trim().toLowerCase();
    if (!q) return [];
    const folder = folders.data?.find((f) => f.containerPath === editingTagsPath);
    const existingTags = folder?.tags ?? [];
    return (allTags.data ?? [])
      .map((t) => t.name)
      .filter((n) => n.includes(q) && !existingTags.includes(n))
      .slice(0, 6);
  }, [tagInputText, allTags.data, editingTagsPath, folders.data]);

  const columnSuggestions = useMemo(() => {
    const q = columnInputText.trim().toLowerCase();
    if (!q || editingColumnId === null) return [];
    const isMultiple = multipleTagFields.includes(editingColumnId);
    const uniqueValues = new Set<string>();
    if (folders.data) {
      for (const f of folders.data) {
        const val = f.fields.find((fv) => fv.fieldId === editingColumnId)?.value;
        if (val && val.trim()) {
          if (isMultiple) {
            val.split(",").forEach((t) => {
              const cleaned = t.trim();
              if (cleaned && cleaned.toLowerCase().includes(q)) {
                uniqueValues.add(cleaned);
              }
            });
          } else {
            if (val.trim().toLowerCase().includes(q)) {
              uniqueValues.add(val.trim());
            }
          }
        }
      }
    }
    if (isMultiple && editingColumnPath) {
      const folder = folders.data?.find((f) => f.containerPath === editingColumnPath);
      const rawVal = folder?.fields.find((fv) => fv.fieldId === editingColumnId)?.value ?? "";
      const existingValues = rawVal.split(",").map((t) => t.trim()).filter(Boolean);
      return Array.from(uniqueValues)
        .filter((v) => !existingValues.includes(v))
        .slice(0, 6);
    }
    return Array.from(uniqueValues).slice(0, 6);
  }, [columnInputText, editingColumnId, folders.data, multipleTagFields, editingColumnPath]);

  const commitTag = async (folderPath: string, existingTags: string[], tagText: string) => {
    const tag = tagText.trim().toLowerCase().replace(/\s+/g, " ");
    if (!tag) return;
    if (!existingTags.includes(tag)) {
      const newTags = [...existingTags, tag];
      try {
        await ipc.setFolderTags(folderPath, newTags);
        invalidateLibrary(qc);
      } catch (err) {
        reportError(err, "Could not add tag");
      }
    }
    setTagInputText("");
    setHighlightIdx(0);
  };

  const NO_BRAND = "No brand";
  const brandOptions = useMemo(() => [NO_BRAND, ...(brands.data ?? []).map((b) => b.name)], [brands.data]);

  const confirmDelete = async () => {
    if (!doomed) return;
    setDeleting(true);
    try {
      await ipc.deleteFolder(doomed.containerPath);
      invalidateLibrary(qc);
      setDoomed(null);
    } catch (e) {
      reportError(e, "Could not delete folder");
    } finally {
      setDeleting(false);
    }
  };

  const customColumns = fields.data ?? [];
  const rows = sortFolders(applyFacets(folders.data ?? [], facets), sort);
  // Clicking the column you are already on flips it; a new column starts
  // ascending, except the dates, where "newest first" is what you want.
  const toggleSort = (key: SortKey) =>
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === 1 ? -1 : 1 }
        : { key, dir: key === "added" || key === "updated" ? -1 : 1 },
    );
  const isActive = (f: Facet) => facets.some((x) => sameFacet(x, f));
  const toggleFacet = (f: Facet) =>
    setFacets((cur) => (cur.some((x) => sameFacet(x, f)) ? cur.filter((x) => !sameFacet(x, f)) : [...cur, f]));

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold">Source Folders</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Track usage, tags, and custom columns for every source folder. Click the settings button to manage columns. Click a tag or column value to filter.
          </p>
        </div>
        <Button
          variant="secondary"
          size="icon"
          title="Manage custom columns"
          onClick={() => setManageColumnsOpen(true)}
          className="shrink-0"
        >
          <Settings className="size-4" />
        </Button>
      </div>

      {facets.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          <span>
            {rows.length} of {folders.data?.length ?? 0} folders
          </span>
          {facets.map((f) => (
            <button
              key={`${f.fieldId}:${f.value}`}
              type="button"
              title={`Remove filter: ${f.label}: ${f.value}`}
              onClick={() => toggleFacet(f)}
              className="flex cursor-pointer items-center gap-1.5 rounded bg-primary px-1.5 py-px
                         text-[11px] text-primary-foreground"
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: `hsl(${hue(f.value)} 70% 55%)` }}
              />
              {f.value}
              <X className="size-3" />
            </button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setFacets([])}>
            Clear all
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table
          className="w-full border-collapse text-left"
          style={{ minWidth: `${1000 + customColumns.length * 160}px` }}
        >
          <thead>
            <tr
              className="group/head border-b border-border bg-muted/40 text-[11px] font-medium
                         uppercase tracking-wide text-subtle-foreground"
            >
              <th className="w-[116px] min-w-[116px] px-4 py-2 font-medium">Preview</th>
              <SortHeader label="Folder" column="path" sort={sort} onSort={toggleSort} className="min-w-[12rem]" />
              <SortHeader label="Brand" column="brand" sort={sort} onSort={toggleSort} className="min-w-[10rem]" />
              <SortHeader
                label="Used"
                column="used"
                sort={sort}
                onSort={toggleSort}
                className="whitespace-nowrap"
              />
              <th className="px-3 py-2 font-medium min-w-[14rem]">Tags</th>
              {customColumns.map((c) => (
                <SortHeader
                  key={c.id}
                  label={c.name}
                  column={`field:${c.id}`}
                  sort={sort}
                  onSort={toggleSort}
                  className="min-w-[10rem] max-w-[12rem]"
                />
              ))}
              <SortHeader
                label="Added"
                column="added"
                sort={sort}
                onSort={toggleSort}
                className="whitespace-nowrap"
              />
              <SortHeader
                label="Updated"
                column="updated"
                sort={sort}
                onSort={toggleSort}
                className="whitespace-nowrap"
              />
              <th className="w-px px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((folder) => (
              <tr
                key={folder.containerPath}
                role="button"
                tabIndex={0}
                onClick={() => setView({ kind: "folder", path: folder.containerPath })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setView({ kind: "folder", path: folder.containerPath });
                  }
                }}
                className="cursor-pointer border-b border-border outline-none
                           transition-colors last:border-0 hover:bg-accent/50 focus-visible:ring-2
                           focus-visible:ring-ring/50"
              >
                <td className="w-[116px] min-w-[116px] px-3 py-2.5">
                  <FolderPreview path={folder.containerPath} />
                </td>
                <td className="max-w-[22rem] min-w-[12rem] px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <FolderTree className="size-4 shrink-0 text-subtle-foreground" />
                    <span className="truncate text-[13px]">{folder.containerPath}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 min-w-[10rem]" onClick={(e) => e.stopPropagation()}>
                  {editingBrandPath === folder.containerPath ? (
                    <div className="flex items-center gap-1.5 w-36">
                      <div className="flex-1 min-w-0">
                        <Select
                          value={folder.brandName ?? NO_BRAND}
                          options={brandOptions}
                          onChange={async (newBrandName) => {
                            try {
                              const selectedBrandId = (brands.data ?? []).find((b) => b.name === newBrandName)?.id ?? null;
                              await ipc.setFolderBrand(folder.containerPath, selectedBrandId);
                              invalidateLibrary(qc);
                            } catch (err) {
                              reportError(err, "Could not update folder brand");
                            }
                            setEditingBrandPath(null);
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        title="Cancel"
                        onClick={() => setEditingBrandPath(null)}
                        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground shrink-0"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 group/cell">
                      {folder.brandName ? (
                        <>
                          <FacetChip
                            facet={{ fieldId: "brand", label: "Brand", value: folder.brandName }}
                            active={isActive({ fieldId: "brand", label: "Brand", value: folder.brandName })}
                            onToggle={toggleFacet}
                          />
                          <div className="opacity-0 group-hover/cell:opacity-100 flex items-center gap-0.5 transition-opacity">
                            <button
                              type="button"
                              title="Change brand"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingBrandPath(folder.containerPath);
                              }}
                              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              <Pencil className="size-3" />
                            </button>
                            <button
                              type="button"
                              title="Clear brand"
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await ipc.setFolderBrand(folder.containerPath, null);
                                  invalidateLibrary(qc);
                                } catch (err) {
                                  reportError(err, "Could not clear brand");
                                }
                              }}
                              className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            >
                              <X className="size-3" />
                            </button>
                          </div>
                        </>
                      ) : (
                        <button
                          type="button"
                          title="Set brand"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingBrandPath(folder.containerPath);
                          }}
                          className="flex items-center gap-1 rounded border border-dashed border-muted-foreground/30 px-1.5 py-px text-[11px] text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground"
                        >
                          <Plus className="size-3" />
                        </button>
                      )}
                    </div>
                  )}
                </td>
                {/* One column, because "0 used" next to "3 unused" spent two
                    columns repeating the headers. */}
                <td
                  className="whitespace-nowrap px-3 py-2.5 text-[13px] tnum"
                  title={`${folder.usedCount} used, ${folder.unusedCount} unused`}
                >
                  <span className={folder.usedCount > 0 ? "text-success" : "text-subtle-foreground"}>
                    {folder.usedCount}
                  </span>
                  <span className="text-subtle-foreground"> / {folder.footageCount}</span>
                </td>
                <td className="px-3 py-2.5 min-w-[14rem]" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-wrap items-center gap-1.5 group/cell">
                    {editingTagsPath === folder.containerPath ? (
                      <>
                        {folder.tags.map((t) => (
                          <span
                            key={t}
                            className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px]"
                          >
                            {t}
                            <button
                              type="button"
                              aria-label={`Remove tag ${t}`}
                              onClick={async (e) => {
                                e.stopPropagation();
                                const newTags = folder.tags.filter((x) => x !== t);
                                try {
                                  await ipc.setFolderTags(folder.containerPath, newTags);
                                  invalidateLibrary(qc);
                                } catch (err) {
                                  reportError(err, "Could not remove tag");
                                }
                              }}
                              className="text-subtle-foreground transition-colors hover:text-foreground"
                            >
                              <X className="size-2.5" />
                            </button>
                          </span>
                        ))}
                        <div className="relative flex items-center gap-1">
                          <input
                            type="text"
                            placeholder="Add tag..."
                            value={tagInputText}
                            onChange={(e) => {
                              setTagInputText(e.target.value);
                              setHighlightIdx(0);
                            }}
                            onKeyDown={async (e) => {
                              e.stopPropagation();
                              if (e.key === "Enter" || e.key === ",") {
                                e.preventDefault();
                                const selected = tagSuggestions[highlightIdx] ?? tagInputText;
                                if (selected.trim()) {
                                  await commitTag(folder.containerPath, folder.tags, selected);
                                } else {
                                  setEditingTagsPath(null);
                                }
                              } else if (e.key === "Escape") {
                                setEditingTagsPath(null);
                              } else if (e.key === "ArrowDown" && tagSuggestions.length) {
                                e.preventDefault();
                                setHighlightIdx((h) => (h + 1) % tagSuggestions.length);
                              } else if (e.key === "ArrowUp" && tagSuggestions.length) {
                                e.preventDefault();
                                setHighlightIdx((h) => (h - 1 + tagSuggestions.length) % tagSuggestions.length);
                              }
                            }}
                            onBlur={() => {
                              setTimeout(() => setEditingTagsPath(null), 200);
                            }}
                            className="h-5 w-24 rounded border border-input bg-surface px-1.5 py-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            autoFocus
                          />
                          <button
                            type="button"
                            title="Done editing"
                            onMouseDown={async (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (tagInputText.trim()) {
                                await commitTag(folder.containerPath, folder.tags, tagInputText);
                              }
                              setEditingTagsPath(null);
                            }}
                            className="rounded p-0.5 text-success hover:bg-success/15 hover:text-success/90 shrink-0"
                          >
                            <Check className="size-3.5" />
                          </button>
                          {tagSuggestions.length > 0 && (
                            <div className="absolute left-0 top-full z-50 mt-1 min-w-[8rem] max-h-32 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
                              {tagSuggestions.map((s, idx) => (
                                <button
                                  key={s}
                                  type="button"
                                  onMouseDown={async (ev) => {
                                    ev.preventDefault();
                                    ev.stopPropagation();
                                    await commitTag(folder.containerPath, folder.tags, s);
                                  }}
                                  className={`w-full text-left rounded px-1.5 py-0.5 text-[11px] transition-colors ${
                                    idx === highlightIdx
                                      ? "bg-primary text-primary-foreground"
                                      : "text-foreground hover:bg-accent"
                                  }`}
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        {folder.tags.length === 0 ? (
                          <>
                            <span className="text-[12px] text-subtle-foreground">—</span>
                            <button
                              type="button"
                              title="Add tag"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingTagsPath(folder.containerPath);
                                setTagInputText("");
                                setHighlightIdx(0);
                              }}
                              className="flex items-center gap-1 rounded border border-dashed border-muted-foreground/30 px-1.5 py-px text-[11px] text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground"
                            >
                              <Plus className="size-3" />
                            </button>
                          </>
                        ) : (
                          <>
                            {folder.tags.map((t) => {
                              const f: Facet = { fieldId: null, label: "Tag", value: t };
                              return (
                                <FacetChip
                                  key={t}
                                  facet={f}
                                  active={isActive(f)}
                                  onToggle={toggleFacet}
                                />
                              );
                            })}
                            <div className="opacity-0 group-hover/cell:opacity-100 flex items-center gap-0.5 transition-opacity">
                              <button
                                type="button"
                                title="Edit tags"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingTagsPath(folder.containerPath);
                                  setTagInputText("");
                                  setHighlightIdx(0);
                                }}
                                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                              >
                                <Pencil className="size-3" />
                              </button>
                              <button
                                type="button"
                                title="Clear all tags"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    await ipc.setFolderTags(folder.containerPath, []);
                                    invalidateLibrary(qc);
                                  } catch (err) {
                                    reportError(err, "Could not clear tags");
                                  }
                                }}
                                className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              >
                                <X className="size-3" />
                              </button>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </td>
                {customColumns.map((c) => {
                  const rawValue = folder.fields.find((f) => f.fieldId === c.id)?.value ?? "";
                  const isMultiple = multipleTagFields.includes(c.id);
                  const currentTags = rawValue.split(",").map((t) => t.trim()).filter(Boolean);
                  const isEditing = editingColumnPath === folder.containerPath && editingColumnId === c.id;

                  return (
                    <td key={c.id} className="px-3 py-2.5 min-w-[10rem]" onClick={(e) => e.stopPropagation()}>
                      {isEditing ? (
                        isMultiple ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {currentTags.map((t) => (
                              <span
                                key={t}
                                className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px]"
                              >
                                {t}
                                <button
                                  type="button"
                                  aria-label={`Remove tag ${t}`}
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const newTags = currentTags.filter((x) => x !== t);
                                    try {
                                      await ipc.setFolderFieldValue(folder.containerPath, c.id, newTags.join(", "));
                                      invalidateLibrary(qc);
                                    } catch (err) {
                                      reportError(err, "Could not remove tag");
                                    }
                                  }}
                                  className="text-subtle-foreground transition-colors hover:text-foreground"
                                >
                                  <X className="size-2.5" />
                                </button>
                              </span>
                            ))}
                            <div className="relative flex items-center gap-1">
                              <input
                                type="text"
                                placeholder="Add..."
                                value={columnInputText}
                                onChange={(e) => {
                                  setColumnInputText(e.target.value);
                                  setColHighlightIdx(0);
                                }}
                                onKeyDown={async (e) => {
                                  e.stopPropagation();
                                  if (e.key === "Enter" || e.key === ",") {
                                    e.preventDefault();
                                    const selected = columnSuggestions[colHighlightIdx] ?? columnInputText;
                                    if (selected.trim()) {
                                      const newTag = selected.trim();
                                      if (!currentTags.includes(newTag)) {
                                        const newTags = [...currentTags, newTag];
                                        try {
                                          await ipc.setFolderFieldValue(folder.containerPath, c.id, newTags.join(", "));
                                          invalidateLibrary(qc);
                                        } catch (err) {
                                          reportError(err, "Could not add tag");
                                        }
                                      }
                                      setColumnInputText("");
                                    } else {
                                      setEditingColumnPath(null);
                                      setEditingColumnId(null);
                                    }
                                  } else if (e.key === "Escape") {
                                    setEditingColumnPath(null);
                                    setEditingColumnId(null);
                                  } else if (e.key === "ArrowDown" && columnSuggestions.length) {
                                    e.preventDefault();
                                    setColHighlightIdx((h) => (h + 1) % columnSuggestions.length);
                                  } else if (e.key === "ArrowUp" && columnSuggestions.length) {
                                    e.preventDefault();
                                    setColHighlightIdx((h) => (h - 1 + columnSuggestions.length) % columnSuggestions.length);
                                  }
                                }}
                                onBlur={() => {
                                  setTimeout(() => {
                                    setEditingColumnPath(null);
                                    setEditingColumnId(null);
                                  }, 200);
                                }}
                                className="h-5 w-24 rounded border border-input bg-surface px-1.5 py-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                autoFocus
                              />
                              <button
                                type="button"
                                title="Done editing"
                                onMouseDown={async (e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (columnInputText.trim()) {
                                    const newTag = columnInputText.trim();
                                    if (!currentTags.includes(newTag)) {
                                      const newTags = [...currentTags, newTag];
                                      try {
                                        await ipc.setFolderFieldValue(folder.containerPath, c.id, newTags.join(", "));
                                        invalidateLibrary(qc);
                                      } catch (err) {
                                        reportError(err, "Could not add tag");
                                      }
                                    }
                                  }
                                  setEditingColumnPath(null);
                                  setEditingColumnId(null);
                                }}
                                className="rounded p-0.5 text-success hover:bg-success/15 hover:text-success/90 shrink-0"
                              >
                                <Check className="size-3.5" />
                              </button>
                              {columnSuggestions.length > 0 && (
                                <div className="absolute left-0 top-full z-50 mt-1 min-w-[8rem] max-h-32 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
                                  {columnSuggestions.map((s, idx) => (
                                    <button
                                      key={s}
                                      type="button"
                                      onMouseDown={async (ev) => {
                                        ev.preventDefault();
                                        ev.stopPropagation();
                                        if (!currentTags.includes(s)) {
                                          const newTags = [...currentTags, s];
                                          try {
                                            await ipc.setFolderFieldValue(folder.containerPath, c.id, newTags.join(", "));
                                            invalidateLibrary(qc);
                                          } catch (err) {
                                            reportError(err, "Could not add tag");
                                          }
                                        }
                                        setColumnInputText("");
                                      }}
                                      className={`w-full text-left rounded px-1.5 py-0.5 text-[11px] transition-colors ${
                                        idx === colHighlightIdx
                                          ? "bg-primary text-primary-foreground"
                                          : "text-foreground hover:bg-accent"
                                      }`}
                                    >
                                      {s}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="relative inline-block">
                            <input
                              type="text"
                              placeholder="Set value..."
                              value={columnInputText}
                              onChange={(e) => {
                                setColumnInputText(e.target.value);
                                setColHighlightIdx(0);
                              }}
                              onKeyDown={async (e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  const selected = columnSuggestions[colHighlightIdx] ?? columnInputText;
                                  try {
                                    await ipc.setFolderFieldValue(folder.containerPath, c.id, selected.trim());
                                    invalidateLibrary(qc);
                                  } catch (err) {
                                    reportError(err, "Could not update column value");
                                  }
                                  setEditingColumnPath(null);
                                  setEditingColumnId(null);
                                } else if (e.key === "Escape") {
                                  setEditingColumnPath(null);
                                  setEditingColumnId(null);
                                } else if (e.key === "ArrowDown" && columnSuggestions.length) {
                                  e.preventDefault();
                                  setColHighlightIdx((h) => (h + 1) % columnSuggestions.length);
                                } else if (e.key === "ArrowUp" && columnSuggestions.length) {
                                  e.preventDefault();
                                  setColHighlightIdx((h) => (h - 1 + columnSuggestions.length) % columnSuggestions.length);
                                }
                              }}
                              onBlur={() => {
                                setTimeout(async () => {
                                  try {
                                    await ipc.setFolderFieldValue(folder.containerPath, c.id, columnInputText.trim());
                                    invalidateLibrary(qc);
                                  } catch (err) {
                                    // ignore
                                  }
                                  setEditingColumnPath(null);
                                  setEditingColumnId(null);
                                }, 200);
                              }}
                              className="h-6 w-28 rounded border border-input bg-surface px-1.5 py-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                              autoFocus
                            />
                            {columnSuggestions.length > 0 && (
                              <div className="absolute left-0 top-full z-50 mt-1 min-w-[8rem] max-h-32 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
                                {columnSuggestions.map((s, idx) => (
                                  <button
                                    key={s}
                                    type="button"
                                    onMouseDown={async (ev) => {
                                      ev.preventDefault();
                                      ev.stopPropagation();
                                      try {
                                        await ipc.setFolderFieldValue(folder.containerPath, c.id, s.trim());
                                        invalidateLibrary(qc);
                                      } catch (err) {
                                        reportError(err, "Could not update column value");
                                      }
                                      setEditingColumnPath(null);
                                      setEditingColumnId(null);
                                    }}
                                    className={`w-full text-left rounded px-1.5 py-0.5 text-[11px] transition-colors ${
                                      idx === colHighlightIdx
                                        ? "bg-primary text-primary-foreground"
                                        : "text-foreground hover:bg-accent"
                                    }`}
                                  >
                                    {s}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      ) : (
                        <div className="flex items-center gap-1.5 group/cell">
                          {isMultiple ? (
                            currentTags.length === 0 ? (
                              <>
                                <span className="text-[12px] text-subtle-foreground">—</span>
                                <button
                                  type="button"
                                  title="Add tag value"
                                  onClick={() => {
                                    setEditingColumnPath(folder.containerPath);
                                    setEditingColumnId(c.id);
                                    setColumnInputText("");
                                    setColHighlightIdx(0);
                                  }}
                                  className="flex items-center gap-1 rounded border border-dashed border-muted-foreground/30 px-1.5 py-px text-[11px] text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground"
                                >
                                  <Plus className="size-3" />
                                </button>
                              </>
                            ) : (
                              <>
                                <div className="flex flex-wrap gap-1">
                                  {currentTags.map((tag) => {
                                    const f: Facet = { fieldId: c.id, label: c.name, value: tag };
                                    return (
                                      <FacetChip
                                        key={tag}
                                        facet={f}
                                        active={isActive(f)}
                                        onToggle={toggleFacet}
                                      />
                                    );
                                  })}
                                </div>
                                <div className="opacity-0 group-hover/cell:opacity-100 flex items-center gap-0.5 transition-opacity">
                                  <button
                                    type="button"
                                    title="Edit tags"
                                    onClick={() => {
                                      setEditingColumnPath(folder.containerPath);
                                      setEditingColumnId(c.id);
                                      setColumnInputText("");
                                      setColHighlightIdx(0);
                                    }}
                                    className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                  >
                                    <Pencil className="size-3" />
                                  </button>
                                  <button
                                    type="button"
                                    title="Clear all values"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        await ipc.setFolderFieldValue(folder.containerPath, c.id, "");
                                        invalidateLibrary(qc);
                                      } catch (err) {
                                        reportError(err, "Could not clear values");
                                      }
                                    }}
                                    className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  >
                                    <X className="size-3" />
                                  </button>
                                </div>
                              </>
                            )
                          ) : (
                            rawValue ? (
                              <>
                                <FacetChip
                                  facet={{ fieldId: c.id, label: c.name, value: rawValue }}
                                  active={isActive({ fieldId: c.id, label: c.name, value: rawValue })}
                                  onToggle={toggleFacet}
                                />
                                <div className="opacity-0 group-hover/cell:opacity-100 flex items-center gap-0.5 transition-opacity">
                                  <button
                                    type="button"
                                    title="Edit value"
                                    onClick={() => {
                                      setEditingColumnPath(folder.containerPath);
                                      setEditingColumnId(c.id);
                                      setColumnInputText(rawValue);
                                      setColHighlightIdx(0);
                                    }}
                                    className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                  >
                                    <Pencil className="size-3" />
                                  </button>
                                  <button
                                    type="button"
                                    title="Clear value"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        await ipc.setFolderFieldValue(folder.containerPath, c.id, "");
                                        invalidateLibrary(qc);
                                      } catch (err) {
                                        reportError(err, "Could not clear value");
                                      }
                                    }}
                                    className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  >
                                    <X className="size-3" />
                                  </button>
                                </div>
                              </>
                            ) : (
                              <button
                                type="button"
                                title="Set value"
                                onClick={() => {
                                  setEditingColumnPath(folder.containerPath);
                                  setEditingColumnId(c.id);
                                  setColumnInputText("");
                                  setColHighlightIdx(0);
                                }}
                                className="flex items-center gap-1 rounded border border-dashed border-muted-foreground/30 px-1.5 py-px text-[11px] text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground"
                              >
                                <Plus className="size-3" />
                              </button>
                            )
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
                <td
                  className="whitespace-nowrap px-3 py-2.5 text-[12px] text-muted-foreground"
                  title={folder.addedAt}
                >
                  {date(folder.addedAt)}
                </td>
                <td
                  className="whitespace-nowrap px-3 py-2.5 text-[12px] text-muted-foreground"
                  title={folder.updatedAt}
                >
                  {relativeDate(folder.updatedAt)}
                </td>
                <td className="w-px whitespace-nowrap px-3 py-2.5">
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete ${folder.containerPath}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDoomed(folder);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
            {facets.length > 0
              ? "No folder matches these filters."
              : "Import footage from a folder to see it here."}
          </p>
        )}
      </div>

      <Dialog open={!!doomed} onOpenChange={(open) => !open && setDoomed(null)}>
        <DialogContent className="w-[min(28rem,92vw)]">
          <DialogHeader>
            <DialogTitle>Delete source folder?</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-2 text-[13px]">
            <p className="truncate text-subtle-foreground">{doomed?.containerPath}</p>
            <p className="text-muted-foreground">
              Removes {doomed?.footageCount ?? 0} footage records, plus this folder's tags and
              column values, from the library. Files on disk and on Drive are untouched.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDoomed(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={confirmDelete}>
              <Trash2 /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ManageColumnsDialog
        open={manageColumnsOpen}
        onClose={() => setManageColumnsOpen(false)}
        multipleTagFields={multipleTagFields}
        onChangeMultipleTagFields={setMultipleTagFields}
      />
    </div>
  );
}
