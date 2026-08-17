import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ExternalLink,
  Filter,
  FolderTree,
  ImageOff,
  ListChecks,
  Pencil,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { PromptDialog } from "@/components/dialogs/PromptDialog";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ipc } from "@/lib/ipc";
import {
  invalidateLibrary,
  keys,
  reportError,
  toastUndo,
  useFolders,
  useFolderFields,
  useFootage,
  useTags,
  useBrands,
} from "@/hooks/queries";
import { useThumbSrc, useVisible } from "@/hooks/use-thumbnail";
import { Marquee, useMarquee } from "@/hooks/use-marquee";
import { Select } from "@/components/dialogs/BrandDialogs";
import { useUi } from "@/store/ui";
import { emptyQuery, type FolderNode } from "@/lib/types";
import { count, date, relativeDate } from "@/lib/format";
import { ManageColumnsDialog } from "@/components/dialogs/ManageColumnsDialog";

/**
 * The folders carrying a tag, shown above the grid on a tag view.
 *
 * Without it a folder-only tag looks empty: the files are only tagged through
 * their folder, and that link is off unless "folder tags cover the files
 * inside" is on. The folders themselves carry the tag either way, so they are
 * always worth showing.
 */
export function TaggedFolders({ tag }: { tag: string }) {
  const { setView } = useUi();
  const folders = useFolders(true);
  const carrying = (folders.data ?? []).filter((f) => f.tags.includes(tag));
  if (carrying.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3.5 py-2">
      <span className="mr-0.5 text-[11px] uppercase tracking-wide text-subtle-foreground">
        Folders
      </span>
      {carrying.map((f) => (
        <button
          key={f.containerPath}
          type="button"
          title={f.containerPath}
          onClick={() => setView({ kind: "folder", path: f.containerPath })}
          className="flex max-w-[16rem] items-center gap-1.5 rounded-md border border-border px-2 py-1
                     text-[12px] text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        >
          <FolderTree className="size-3.5 shrink-0" />
          <span className="truncate">
            {f.displayName ?? (f.containerPath.split("/").pop() || f.containerPath)}
          </span>
          <span className="tnum shrink-0 text-[11px] text-subtle-foreground">{f.footageCount}</span>
        </button>
      ))}
    </div>
  );
}

/** Where a Drive folder lives on the web. Its id is all the URL needs. */
export const driveFolderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;

/**
 * One thumbnail in a folder's preview strip.
 *
 * Memoised on purpose: the table is not virtualized, so every tick of a
 * selection re-renders all of it, and each of these carries a query hook and an
 * effect. Its props are a number and a class, so nothing re-runs unless the row
 * is actually a different one.
 */
const Thumb = memo(function Thumb({ id, className = "size-8" }: { id: number; className?: string }) {
  const thumb = useThumbSrc(id, true);
  // The placeholder is the background rather than a branch, so the row keeps its
  // shape while the image is still on its way in.
  return (
    <div className={cn(className, "shrink-0 overflow-hidden rounded-sm bg-thumb-bg")}>
      {thumb.src && (
        <img
          src={thumb.src}
          onError={thumb.onError}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      )}
    </div>
  );
});

/**
 * Bigger covers floating by the cursor, so a row can be read without opening the
 * folder. Fixed to the viewport and pointer-transparent: the card never steals
 * the hover that spawned it, and never scrolls away from the cursor.
 */
function HoverPreview({ path, x, y }: { path: string; x: number; y: number }) {
  const ref = useRef<HTMLDivElement>(null);

  // Below the cursor while there is room, above it near the bottom of the window
  // — a card pinned to the edge covers the row you are pointing at.
  const CARD = 220; // size-52 thumb plus the padding around it
  const place = (cx: number, cy: number) => ({
    left: Math.min(cx + 20, window.innerWidth - 240),
    top: cy + 16 + CARD <= window.innerHeight ? cy + 16 : Math.max(cy - 16 - CARD, 8),
    below: cy + 16 + CARD <= window.innerHeight,
  });

  // Following the cursor writes straight to the node. Through state it re-rendered
  // this card — and re-ran its query hooks — on every pixel of mouse movement.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const el = ref.current;
      if (!el) return;
      const at = place(e.clientX, e.clientY);
      el.style.left = `${at.left}px`;
      el.style.top = `${at.top}px`;
    };
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The same query the row's preview strip already ran, so hovering costs no
  // fetch of its own — only the first of the three is shown.
  const page = useFootage({ ...emptyQuery(), containerPath: path, limit: 3 }, true);
  const first = page.data?.items?.[0];
  if (!first) return null;

  const at = place(x, y);
  return (
    <div
      ref={ref}
      className={cn(
        `pointer-events-none fixed z-50 rounded-lg border border-border bg-surface-raised p-1.5 shadow-lg
         animate-in fade-in duration-150`,
        at.below ? "slide-in-from-top-2" : "slide-in-from-bottom-2",
      )}
      style={{ left: at.left, top: at.top }}
    >
      <Thumb id={first.id} className="size-52" />
    </div>
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
 * What a bulk edit writes into a cell: multi-value cells (tags, columns marked
 * "multiple") gain the new values without losing what is there, single-value
 * cells are replaced — the same rule the per-row editors already follow.
 */
export function mergeValues(current: string[], added: string[], multi: boolean): string[] {
  return multi ? [...new Set([...current, ...added])] : [added.join(", ")];
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
    // Sorts by the name on screen, so a renamed folder lands where the eye looks for it.
    case "path": return (folder.displayName ?? folder.containerPath).toLowerCase();
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
const FolderPreview = memo(function FolderPreview({ path }: { path: string }) {
  const { ref, visible } = useVisible<HTMLDivElement>();
  const page = useFootage({ ...emptyQuery(), containerPath: path, limit: 3 }, visible);
  const items = page.data?.items ?? [];

  return (
    // Scrolled out of sight, the images come down with it — a decoded bitmap for
    // a row nobody is looking at is memory for nothing. The list itself stays
    // cached, so scrolling back is instant.
    <div ref={ref} className="flex min-h-8 gap-1">
      {visible &&
        items.map((i) => <Thumb key={i.id} id={i.id} />)}
      {visible && !page.isLoading && items.length === 0 && (
        <ImageOff className="size-4 text-subtle-foreground" />
      )}
    </div>
  );
});

export function SourceFoldersPage() {
  const folders = useFolders(true);
  const fields = useFolderFields(true);
  const { setView } = useUi();
  const qc = useQueryClient();

  const brands = useBrands(true);

  /**
   * Filters outlive the page.
   *
   * Opening a folder unmounts this table, and coming back used to hand you an
   * unfiltered list — the filter you set to find the folder was gone by the time
   * you returned to it. Clearing them stays a thing you do on purpose, with the
   * Clear button or Reset filters.
   */
  const [facets, setFacets] = useState<Facet[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("stash:folder_facets") ?? "[]");
    } catch {
      return [];
    }
  });
  const [sort, setSort] = useState<Sort>({ key: "added", dir: -1 });
  const [doomed, setDoomed] = useState<FolderNode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState<FolderNode | null>(null);

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
  // Same shelf as the multi-value columns above: a table preference, kept where
  // the table can read it without a round trip to the backend.
  const [hoverPreview, setHoverPreview] = useState(
    () => localStorage.getItem("stash:folder_hover_preview") !== "off",
  );

  // Bulk editing: which folders are ticked, and what the bar writes to. The tick
  // column is off until asked for — a column of empty boxes on every row is noise
  // on the many days you are only reading the table.
  const [selectMode, setSelectMode] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [bulkTarget, setBulkTarget] = useState("Tags");
  const [bulkText, setBulkText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkHighlight, setBulkHighlight] = useState(0);
  const [bulkFocused, setBulkFocused] = useState(false);
  const lastPickedIdx = useRef<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * Dragging a box over the rows picks them, the same gesture as the library
   * grid. It turns the tick column on by itself: dragging is how you say "I am
   * selecting now", so having to arm it first would be a button in the way.
   */
  const marquee = useMarquee(
    "tr[data-id]",
    () => picked,
    (paths) => {
      setSelectMode(true);
      setPicked(paths);
    },
    scrollRef,
  );

  // Which row the cursor rests on, and where, for the floating preview.
  const [hover, setHover] = useState<{ path: string; x: number; y: number } | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const clearHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHover(null);
  };
  // Delayed, so running the cursor down the table does not flash a card per row.
  const startHover = (path: string) => (e: React.MouseEvent) => {
    if (!hoverPreview) return;
    const { clientX: x, clientY: y } = e;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHover({ path, x, y }), 350);
  };

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

  /**
   * What there is to filter by, read off the folders themselves.
   *
   * Nothing here is configured: a new tag, a new brand or a new custom column
   * shows up as soon as one folder carries a value for it, and disappears with
   * the last one. Values are split on commas the same way `matches()` does, so
   * the menu can never offer a value the filter would not match.
   */
  const facetGroups = useMemo(() => {
    const list = folders.data ?? [];
    const distinct = (pick: (f: FolderNode) => string[]) => {
      const seen = new Set<string>();
      for (const f of list) for (const v of pick(f)) if (v) seen.add(v);
      return [...seen].sort((a, b) => a.localeCompare(b));
    };
    const groups: { label: string; fieldId: Facet["fieldId"]; values: string[] }[] = [
      { label: "Brand", fieldId: "brand", values: distinct((f) => (f.brandName ? [f.brandName] : [])) },
      { label: "Tag", fieldId: null, values: distinct((f) => f.tags) },
      ...(fields.data ?? []).map((c) => ({
        label: c.name,
        fieldId: c.id as Facet["fieldId"],
        values: distinct((f) =>
          (f.fields.find((v) => v.fieldId === c.id)?.value ?? "").split(",").map((x) => x.trim()),
        ),
      })),
    ];
    return groups.filter((g) => g.values.length > 0);
  }, [folders.data, fields.data]);

  /**
   * What the bulk bar can complete to: known tags, or the values that column
   * already holds — the same pool the filter menu offers, so bulk editing cannot
   * invent a near-miss of a value that already exists ("kol" vs "kols").
   *
   * Only the last comma-separated word is being typed; the ones before it are
   * finished and are dropped from the list.
   */
  const bulkSuggestions = useMemo(() => {
    const parts = bulkText.split(",");
    const q = parts[parts.length - 1]!.trim().toLowerCase();
    if (!q) return [];
    const done = parts.slice(0, -1).map((s) => s.trim().toLowerCase());
    const colId = (fields.data ?? []).find((c) => c.name === bulkTarget)?.id;
    const pool =
      bulkTarget === "Tags"
        ? (allTags.data ?? []).map((t) => t.name)
        : (facetGroups.find((g) => g.fieldId === colId)?.values ?? []);
    return pool
      .filter((v) => v.toLowerCase().includes(q) && !done.includes(v.toLowerCase()))
      .slice(0, 6);
  }, [bulkText, bulkTarget, allTags.data, facetGroups, fields.data]);

  const showBulkSuggestions = bulkFocused && bulkSuggestions.length > 0;

  /** Replaces the half-typed word with the picked value and opens the next one. */
  const takeBulkSuggestion = (value: string) => {
    const kept = bulkText.split(",").slice(0, -1).map((s) => s.trim()).filter(Boolean);
    setBulkText([...kept, value].join(", ") + ", ");
    setBulkHighlight(0);
  };

  useEffect(() => {
    localStorage.setItem("stash:folder_facets", JSON.stringify(facets));
  }, [facets]);

  // A remembered filter for a tag that has since been deleted would hide every
  // folder with no way to tell why. Waits for the folders themselves: before they
  // arrive there is nothing to filter by, and every remembered facet would look
  // stale.
  useEffect(() => {
    if (!folders.data) return;
    setFacets((cur) => {
      const alive = cur.filter((f) =>
        facetGroups.some((g) => g.fieldId === f.fieldId && g.values.includes(f.value)),
      );
      return alive.length === cur.length ? cur : alive;
    });
  }, [facetGroups, folders.data]);

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: "added", label: "Added" },
    { key: "updated", label: "Updated" },
    { key: "path", label: "Folder name" },
    { key: "brand", label: "Brand" },
    { key: "used", label: "Used" },
    ...(fields.data ?? []).map((c) => ({ key: `field:${c.id}` as SortKey, label: c.name })),
  ];

  const commitTag = async (folder: FolderNode, tagText: string) => {
    const tag = tagText.trim().toLowerCase().replace(/\s+/g, " ");
    if (tag && !folder.tags.includes(tag)) {
      await setTags([folder], (f) => [...f.tags, tag], `Tag "${tag}" added`);
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
  // Filtering and sorting every folder on every keystroke and every tick of a
  // drag was the table's own contribution to the lag.
  const rows = useMemo(
    () => sortFolders(applyFacets(folders.data ?? [], facets), sort),
    [folders.data, facets, sort],
  );
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

  /**
   * Bulk editing works off the *visible* rows, so a folder hidden by a filter is
   * never written to even if it was ticked before the filter went on.
   */
  // A set, not the array: a marquee over 200 folders asked "is this one picked?"
  // 200 times per row.
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const pickedRows = useMemo(
    () => rows.filter((f) => pickedSet.has(f.containerPath)),
    [rows, pickedSet],
  );
  const allPicked = rows.length > 0 && pickedRows.length === rows.length;

  const toggleRow = (idx: number, shift: boolean) => {
    const path = rows[idx]!.containerPath;
    if (shift && lastPickedIdx.current !== null) {
      const [lo, hi] =
        lastPickedIdx.current < idx ? [lastPickedIdx.current, idx] : [idx, lastPickedIdx.current];
      const range = rows.slice(lo, hi + 1).map((f) => f.containerPath);
      setPicked((cur) => [...new Set([...cur, ...range])]);
    } else {
      setPicked((cur) => (cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path]));
    }
    lastPickedIdx.current = idx;
  };

  /**
   * The one place folder edits are written, whether they came from a cell or
   * from the bulk bar.
   *
   * The `FolderNode`s handed in are the values as they were before the write,
   * so undoing is just writing them back — no snapshot type, no history stack.
   *
   * ponytail: sequential writes — a few hundred folders at worst, and one
   * failing row should not leave the rest half-applied silently.
   */
  const applyFolders = async (
    targets: FolderNode[],
    write: (f: FolderNode) => Promise<void>,
    back: (f: FolderNode) => Promise<void>,
    message: string,
    failMsg: string,
  ) => {
    if (targets.length === 0) return;
    setBulkBusy(true);
    try {
      for (const f of targets) await write(f);
      toastUndo(qc, message, async () => {
        for (const f of targets) await back(f);
      });
    } catch (err) {
      reportError(err, failMsg);
    } finally {
      // Only what these writes touch. `invalidateLibrary` also drops every
      // ["footage"] query, and each row's preview strip is one of those — adding
      // a single tag refetched a thumbnail list per visible folder.
      qc.invalidateQueries({ queryKey: keys.folders });
      qc.invalidateQueries({ queryKey: keys.folderFields });
      qc.invalidateQueries({ queryKey: keys.tags });
      setBulkBusy(false);
    }
  };

  const undoBrand = (f: FolderNode) => ipc.setFolderBrand(f.containerPath, f.brandId);
  const undoTags = (f: FolderNode) => ipc.setFolderTags(f.containerPath, f.tags);
  const undoField = (fieldId: number) => (f: FolderNode) =>
    ipc.setFolderFieldValue(
      f.containerPath,
      fieldId,
      f.fields.find((v) => v.fieldId === fieldId)?.value ?? "",
    );

  /** How many folders a message is about: "3 folders", or nothing when it is one. */
  const on = (targets: FolderNode[]) =>
    targets.length === 1 ? "" : ` on ${count(targets.length)} folders`;

  const setBrand = (targets: FolderNode[], brandName: string) => {
    const brandId = (brands.data ?? []).find((b) => b.name === brandName)?.id ?? null;
    return applyFolders(
      targets,
      (f) => ipc.setFolderBrand(f.containerPath, brandId),
      undoBrand,
      brandId === null ? `Brand cleared${on(targets)}` : `Brand set to ${brandName}${on(targets)}`,
      "Could not update the brand",
    );
  };

  const setTags = (targets: FolderNode[], tags: (f: FolderNode) => string[], message: string) =>
    applyFolders(
      targets,
      (f) => ipc.setFolderTags(f.containerPath, tags(f)),
      undoTags,
      message,
      "Could not update the tags",
    );

  const setField = (
    targets: FolderNode[],
    fieldId: number,
    value: (f: FolderNode) => string,
    message: string,
  ) =>
    applyFolders(
      targets,
      (f) => ipc.setFolderFieldValue(f.containerPath, fieldId, value(f)),
      undoField(fieldId),
      message,
      "Could not update the value",
    );

  /** Values of a comma-joined custom column cell. */
  const cellValues = (f: FolderNode, fieldId: number) =>
    (f.fields.find((v) => v.fieldId === fieldId)?.value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  /** Adds to tags and to multi-value columns; single-value columns are replaced. */
  const bulkAddValue = async () => {
    const parts = bulkText.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return;

    if (bulkTarget === "Tags") {
      const tags = parts.map((t) => t.toLowerCase().replace(/\s+/g, " "));
      await setTags(
        pickedRows,
        (f) => mergeValues(f.tags, tags, true),
        `Tags added${on(pickedRows)}`,
      );
    } else {
      const col = customColumns.find((c) => c.name === bulkTarget);
      if (!col) return;
      const multi = multipleTagFields.includes(col.id);
      await setField(
        pickedRows,
        col.id,
        (f) => mergeValues(cellValues(f, col.id), parts, multi).join(", "),
        `${col.name} updated${on(pickedRows)}`,
      );
    }
    setBulkText("");
  };

  const bulkClearTarget = () => {
    if (bulkTarget === "Tags") {
      return setTags(pickedRows, () => [], `Tags cleared${on(pickedRows)}`);
    }
    const col = customColumns.find((c) => c.name === bulkTarget);
    if (!col) return;
    return setField(pickedRows, col.id, () => "", `${col.name} cleared${on(pickedRows)}`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The library's second toolbar row, minus the grid/list switch — there is
          only ever one way to read a table. The header above has one row on this
          view, so the same height and padding land it in the same place, and
          being outside the scroller keeps it there. */}
      <div className="flex h-9 shrink-0 items-center gap-1 bg-titlebar px-2 hairline-b">
        <span className="tnum mr-1 shrink-0 text-[11.5px] text-subtle-foreground">
          {facets.length > 0
            ? `${count(rows.length)} of ${count(folders.data?.length ?? 0)} folders`
            : `${count(rows.length)} ${rows.length === 1 ? "folder" : "folders"}`}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className={cn(facets.length > 0 && "text-foreground")}>
              <Filter />
              Filters
              {facets.length > 0 && <Badge className="ml-0.5">{facets.length}</Badge>}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[70vh] min-w-[13rem] overflow-y-auto">
            {facetGroups.length === 0 ? (
              <DropdownMenuLabel>Nothing to filter by yet</DropdownMenuLabel>
            ) : (
              facetGroups.map((g, i) => (
                <DropdownMenuGroup key={`${g.fieldId}`}>
                  {i > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel>{g.label}</DropdownMenuLabel>
                  {g.values.map((value) => {
                    const facet: Facet = { fieldId: g.fieldId, label: g.label, value };
                    return (
                      <DropdownMenuCheckboxItem
                        key={value}
                        checked={isActive(facet)}
                        onCheckedChange={() => toggleFacet(facet)}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {value}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuGroup>
              ))
            )}
            {facets.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setFacets([])}>Reset filters</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <ArrowUpDown />
              {sortOptions.find((o) => o.key === sort.key)?.label ?? "Sort"}
              {sort.dir === 1 ? <ChevronUp /> : <ChevronDown />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[70vh] overflow-y-auto">
            {sortOptions.map((o) => (
              // Same click twice flips the direction, exactly like the column
              // headers — one behaviour, two ways in.
              <DropdownMenuItem key={o.key} onSelect={() => toggleSort(o.key)}>
                <Check className={cn("size-3.5", sort.key !== o.key && "opacity-0")} />
                {o.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Turning selection off drops the ticks with it: leaving them hidden but
            live is how you bulk-edit rows you forgot you had picked. */}
        <Button
          variant="ghost"
          size="sm"
          title="Show tick boxes for editing several folders at once"
          onClick={() =>
            setSelectMode((on) => {
              if (on) setPicked([]);
              return !on;
            })
          }
          className={cn(selectMode && "text-foreground")}
        >
          <ListChecks />
          Select
          {picked.length > 0 && <Badge className="ml-0.5">{pickedRows.length}</Badge>}
        </Button>

        {facets.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setFacets([])}>
            <X />
            Clear
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          title="Source folder settings — default brand and custom columns"
          onClick={() => setManageColumnsOpen(true)}
          className="ml-auto shrink-0"
        >
          <Settings />
        </Button>
      </div>

      <div
        ref={scrollRef}
        onMouseDown={marquee.onMouseDown}
        className={cn("min-h-0 flex-1 overflow-y-auto p-6", marquee.dragging && "select-none")}
      >
      {facets.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
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
        </div>
      )}

      {/* Bulk bar — only there when something is ticked, so the table reads the
          same as before until you actually want to edit several folders.
          Floats over the bottom of the window: ticking a row far down the table
          used to mean scrolling back to the top to act on it.
          The wrapper does the centring and the inner bar the animation — sharing
          one element would have the keyframe's transform eat the -translate-x. */}
      {pickedRows.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-6">
        <div
          // The bar sits over the table; pressing it is not the start of a
          // selection drag.
          onMouseDown={(e) => e.stopPropagation()}
          className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-border
                     bg-surface-raised px-3 py-2 shadow-xl
                     animate-in fade-in slide-in-from-bottom-8 duration-300
                     ease-[cubic-bezier(.34,1.56,.64,1)]"
        >
          <span className="tnum shrink-0 text-[12px] font-medium">
            {count(pickedRows.length)} selected
          </span>

          <div className="w-40 shrink-0">
            <Select
              value="Set brand…"
              options={brandOptions}
              onChange={(name) => setBrand(pickedRows, name)}
            />
          </div>

          <div className="w-32 shrink-0">
            <Select
              value={bulkTarget}
              options={["Tags", ...customColumns.map((c) => c.name)]}
              onChange={setBulkTarget}
            />
          </div>

          <div className="relative">
            <input
              type="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={`Add to ${bulkTarget.toLowerCase()}… (comma separated)`}
              value={bulkText}
              onChange={(e) => {
                setBulkText(e.target.value);
                setBulkHighlight(0);
              }}
              onFocus={() => setBulkFocused(true)}
              onBlur={() => setBulkFocused(false)}
              onKeyDown={(e) => {
                // Enter completes the word while the list is up, and applies once
                // there is nothing left to complete — so a typo is never written
                // to every ticked folder by one keystroke too many.
                if (e.key === "Enter") {
                  e.preventDefault();
                  const pick = showBulkSuggestions ? bulkSuggestions[bulkHighlight] : undefined;
                  if (pick) takeBulkSuggestion(pick);
                  else bulkAddValue();
                } else if (e.key === "Escape") {
                  setBulkFocused(false);
                } else if (e.key === "ArrowDown" && showBulkSuggestions) {
                  e.preventDefault();
                  setBulkHighlight((h) => (h + 1) % bulkSuggestions.length);
                } else if (e.key === "ArrowUp" && showBulkSuggestions) {
                  e.preventDefault();
                  setBulkHighlight((h) => (h - 1 + bulkSuggestions.length) % bulkSuggestions.length);
                }
              }}
              className="h-8 w-56 rounded-md border border-input bg-surface px-2 text-[13px]
                         focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {showBulkSuggestions && (
              <div
                // Upwards: the bar sits at the bottom of the window, so downwards
                // would be off screen.
                className="absolute bottom-full left-0 z-50 mb-1 max-h-40 min-w-[10rem] overflow-y-auto
                           rounded-md border border-border bg-surface-raised p-1 shadow-md"
              >
                {bulkSuggestions.map((s, idx) => (
                  <button
                    key={s}
                    type="button"
                    // mousedown, not click: the input keeps focus, so the list
                    // stays up for the next value.
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      takeBulkSuggestion(s);
                    }}
                    className={`w-full rounded px-1.5 py-0.5 text-left text-[12px] transition-colors ${
                      idx === bulkHighlight
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
          <Button size="sm" disabled={bulkBusy || !bulkText.trim()} onClick={bulkAddValue}>
            <Plus />
            Apply
          </Button>
          <Button variant="ghost" size="sm" disabled={bulkBusy} onClick={bulkClearTarget}>
            Clear {bulkTarget}
          </Button>

          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setPicked([])}>
            <X />
            Deselect
          </Button>
        </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table
          className="w-full border-collapse text-left"
          style={{ minWidth: `${1040 + customColumns.length * 160}px` }}
        >
          <thead>
            <tr
              className="group/head border-b border-border bg-muted/40 text-[11px] font-medium
                         uppercase tracking-wide text-subtle-foreground"
            >
              {selectMode && (
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select every folder shown"
                    checked={allPicked}
                    onChange={() =>
                      setPicked(allPicked ? [] : rows.map((f) => f.containerPath))
                    }
                    className="size-3.5 cursor-pointer accent-primary"
                  />
                </th>
              )}
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
            {rows.map((folder, idx) => (
              <ContextMenu key={folder.containerPath}>
                <ContextMenuTrigger asChild>
                <tr
                  role="button"
                  tabIndex={0}
                  data-id={folder.containerPath}
                  onMouseEnter={startHover(folder.containerPath)}
                  onMouseLeave={clearHover}
                  // A drag that ends on a row is a selection, not a request to
                  // open the folder it happened to stop over.
                  onClick={() => {
                    if (marquee.dragged.current) return;
                    setView({ kind: "folder", path: folder.containerPath });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setView({ kind: "folder", path: folder.containerPath });
                    }
                  }}
                  className={cn(
                    `cursor-pointer border-b border-border outline-none transition-colors
                     last:border-0 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50`,
                    pickedSet.has(folder.containerPath) && "bg-accent/40",
                  )}
                >
                  {selectMode && (
                    <td className="w-8 px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      {/* Shift-click extends from the last tick, so a run of
                          folders is one click apart instead of forty. */}
                      <input
                        type="checkbox"
                        aria-label={`Select ${folder.displayName ?? folder.containerPath}`}
                        checked={pickedSet.has(folder.containerPath)}
                        onChange={() => {}}
                        onClick={(e) => toggleRow(idx, e.shiftKey)}
                        className="size-3.5 cursor-pointer accent-primary"
                      />
                    </td>
                  )}
                  <td className="w-[116px] min-w-[116px] px-3 py-2.5">
                    <FolderPreview path={folder.containerPath} />
                  </td>
                  <td className="max-w-[22rem] min-w-[12rem] px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <FolderTree className="size-4 shrink-0 text-subtle-foreground" />
                      {/* The custom name never replaces the path: a label that hides
                          where the files came from is worse than no label. */}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px]" title={folder.containerPath}>
                          {folder.displayName ?? folder.containerPath}
                        </div>
                        {folder.displayName && (
                          <div className="truncate text-[11px] text-subtle-foreground">
                            {folder.containerPath}
                          </div>
                        )}
                      </div>
                      {folder.driveFolderId && (
                        <button
                          type="button"
                          title="Open original folder in Google Drive"
                          onClick={(e) => {
                            e.stopPropagation();
                            ipc
                              .openExternal(driveFolderUrl(folder.driveFolderId!))
                              .catch((err) => reportError(err, "Could not open Drive"));
                          }}
                          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <ExternalLink className="size-3.5" />
                        </button>
                      )}
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
                              await setBrand([folder], newBrandName);
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setBrand([folder], NO_BRAND);
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setTags(
                                    [folder],
                                    (f) => f.tags.filter((x) => x !== t),
                                    `Tag "${t}" removed`,
                                  );
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
                              // Same reason as ui/input.tsx: tag names are labels, not prose,
                              // and macOS rewriting one mid-type creates a tag you never wanted.
                              autoComplete="off"
                              autoCorrect="off"
                              autoCapitalize="off"
                              spellCheck={false}
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
                                    await commitTag(folder, selected);
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
                                  await commitTag(folder, tagInputText);
                                }
                                setEditingTagsPath(null);
                              }}
                              className="rounded p-0.5 text-success hover:bg-success/15 hover:text-success/90 shrink-0"
                            >
                              <Check className="size-3.5" />
                            </button>
                            {tagSuggestions.length > 0 && (
                              <div className="absolute left-0 top-full z-50 mt-1 min-w-[8rem] max-h-32 overflow-y-auto rounded-md border border-border bg-surface-raised p-1 shadow-md">
                                {tagSuggestions.map((s, idx) => (
                                  <button
                                    key={s}
                                    type="button"
                                    onMouseDown={async (ev) => {
                                      ev.preventDefault();
                                      ev.stopPropagation();
                                      await commitTag(folder, s);
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
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setTags([folder], () => [], "Tags cleared");
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

                    // One writer per cell, so every path here — typing, picking a
                    // suggestion, clearing — gets the same undo.
                    const addValue = (raw: string) => {
                      const v = raw.trim();
                      if (!v || currentTags.includes(v)) return;
                      return setField(
                        [folder],
                        c.id,
                        (f) => [...cellValues(f, c.id), v].join(", "),
                        `${c.name}: "${v}" added`,
                      );
                    };
                    const writeValue = (raw: string, message: string) =>
                      setField([folder], c.id, () => raw, message);
                    /** Single-value cell. Leaving the value alone is not an edit. */
                    const commitColumn = (raw: string) => {
                      const v = raw.trim();
                      if (v === rawValue) return;
                      return writeValue(v, v ? `${c.name} set to "${v}"` : `${c.name} cleared`);
                    };

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
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      writeValue(
                                        currentTags.filter((x) => x !== t).join(", "),
                                        `${c.name}: "${t}" removed`,
                                      );
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
                                  autoComplete="off"
                                  autoCorrect="off"
                                  autoCapitalize="off"
                                  spellCheck={false}
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
                                        await addValue(selected);
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
                                    if (columnInputText.trim()) await addValue(columnInputText);
                                    setEditingColumnPath(null);
                                    setEditingColumnId(null);
                                  }}
                                  className="rounded p-0.5 text-success hover:bg-success/15 hover:text-success/90 shrink-0"
                                >
                                  <Check className="size-3.5" />
                                </button>
                                {columnSuggestions.length > 0 && (
                                  <div className="absolute left-0 top-full z-50 mt-1 min-w-[8rem] max-h-32 overflow-y-auto rounded-md border border-border bg-surface-raised p-1 shadow-md">
                                    {columnSuggestions.map((s, idx) => (
                                      <button
                                        key={s}
                                        type="button"
                                        onMouseDown={async (ev) => {
                                          ev.preventDefault();
                                          ev.stopPropagation();
                                          await addValue(s);
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
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck={false}
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
                                    await commitColumn(selected);
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
                                    await commitColumn(columnInputText);
                                    setEditingColumnPath(null);
                                    setEditingColumnId(null);
                                  }, 200);
                                }}
                                className="h-6 w-28 rounded border border-input bg-surface px-1.5 py-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                autoFocus
                              />
                              {columnSuggestions.length > 0 && (
                                <div className="absolute left-0 top-full z-50 mt-1 min-w-[8rem] max-h-32 overflow-y-auto rounded-md border border-border bg-surface-raised p-1 shadow-md">
                                  {columnSuggestions.map((s, idx) => (
                                    <button
                                      key={s}
                                      type="button"
                                      onMouseDown={async (ev) => {
                                        ev.preventDefault();
                                        ev.stopPropagation();
                                        await commitColumn(s);
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
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        writeValue("", `${c.name} cleared`);
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
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        writeValue("", `${c.name} cleared`);
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
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => setRenaming(folder)}>
                    <Pencil /> Rename Folder...
                  </ContextMenuItem>
                  {folder.displayName && (
                    <ContextMenuItem
                      onSelect={async () => {
                        try {
                          await ipc.setFolderName(folder.containerPath, "");
                          invalidateLibrary(qc);
                        } catch (err) {
                          reportError(err, "Could not reset the folder name");
                        }
                      }}
                    >
                      <X /> Use Original Name
                    </ContextMenuItem>
                  )}
                  {folder.driveFolderId && (
                    <ContextMenuItem
                      onSelect={() =>
                        ipc
                          .openExternal(driveFolderUrl(folder.driveFolderId!))
                          .catch((err) => reportError(err, "Could not open Drive"))
                      }
                    >
                      <ExternalLink /> Open in Google Drive
                    </ContextMenuItem>
                  )}
                  <ContextMenuSeparator />
                  <ContextMenuItem destructive onSelect={() => setDoomed(folder)}>
                    <Trash2 /> Delete Folder
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
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

      {/* Not while a cell is open: an editor is a place you park the cursor, and
          a card popping over it is in the way. */}
      {hoverPreview && hover && !marquee.dragging && !editingTagsPath && !editingColumnPath && !editingBrandPath && (
        <HoverPreview path={hover.path} x={hover.x} y={hover.y} />
      )}

      <Marquee boxRef={marquee.boxRef} />

      <Dialog open={!!doomed} onOpenChange={(open) => !open && setDoomed(null)}>
        <DialogContent className="w-[min(28rem,92vw)]">
          <DialogHeader>
            <DialogTitle>Delete source folder?</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-2 text-[13px]">
            {doomed?.displayName && <p className="truncate font-medium">{doomed.displayName}</p>}
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

      <PromptDialog
        open={!!renaming}
        onOpenChange={(open) => !open && setRenaming(null)}
        title="Rename source folder"
        description={`The original folder stays ${renaming?.containerPath ?? ""} and is still shown under the new name.`}
        placeholder="Folder name"
        initialValue={renaming?.displayName ?? ""}
        onSubmit={async (name) => {
          if (!renaming) return;
          try {
            await ipc.setFolderName(renaming.containerPath, name);
            invalidateLibrary(qc);
          } catch (err) {
            reportError(err, "Could not rename folder");
          }
        }}
      />

      <ManageColumnsDialog
        open={manageColumnsOpen}
        onClose={() => setManageColumnsOpen(false)}
        multipleTagFields={multipleTagFields}
        onChangeMultipleTagFields={setMultipleTagFields}
        hoverPreview={hoverPreview}
        onChangeHoverPreview={(on) => {
          setHoverPreview(on);
          localStorage.setItem("stash:folder_hover_preview", on ? "on" : "off");
        }}
      />
      </div>
    </div>
  );
}
