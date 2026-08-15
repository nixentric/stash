import { useState } from "react";
import { FolderTree, ImageOff, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFolders, useFolderFields, useFootage } from "@/hooks/queries";
import { useThumbnail, useVisible } from "@/hooks/use-thumbnail";
import { useUi } from "@/store/ui";
import { emptyQuery, type FolderNode } from "@/lib/types";
import { date, relativeDate } from "@/lib/format";

/** One thumbnail in a folder's preview strip. */
function Thumb({ id }: { id: number }) {
  const thumb = useThumbnail(id, true);
  return thumb.data ? (
    <img src={thumb.data} alt="" loading="lazy" className="size-8 shrink-0 rounded-sm object-cover" />
  ) : (
    <div className="size-8 shrink-0 rounded-sm bg-thumb-bg" />
  );
}

/** A tag or custom-field value that narrows the table to matching folders. */
export type Facet = { fieldId: number | null; label: string; value: string };

export const sameFacet = (a: Facet, b: Facet) => a.fieldId === b.fieldId && a.value === b.value;

const matches = (folder: FolderNode, f: Facet) =>
  f.fieldId === null
    ? folder.tags.includes(f.value)
    : folder.fields.some((v) => v.fieldId === f.fieldId && v.value === f.value);

/**
 * Tags combine with AND — a folder carries many, so "test AND kol" is the useful
 * reading. Values of one custom column combine with OR instead: a folder holds a
 * single value per column, so AND there would always return nothing.
 */
export function applyFacets(folders: FolderNode[], facets: Facet[]): FolderNode[] {
  const tags = facets.filter((f) => f.fieldId === null);
  const byField = new Map<number, Facet[]>();
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
      className={`flex max-w-[12rem] cursor-pointer items-center gap-1.5 rounded px-1.5 py-px
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

export function SourceFoldersPage({ onEdit }: { onEdit: (folder: FolderNode) => void }) {
  const folders = useFolders(true);
  const fields = useFolderFields(true);
  const { setView } = useUi();

  const [facets, setFacets] = useState<Facet[]>([]);

  const customColumns = fields.data ?? [];
  const rows = applyFacets(folders.data ?? [], facets);
  const isActive = (f: Facet) => facets.some((x) => sameFacet(x, f));
  const toggleFacet = (f: Facet) =>
    setFacets((cur) => (cur.some((x) => sameFacet(x, f)) ? cur.filter((x) => !sameFacet(x, f)) : [...cur, f]));

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">Source Folders</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Track usage, tags, and custom columns for every source folder. Add a column from
          any folder's Edit dialog. Click a tag or column value to filter.
        </p>
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
        <table className="w-full border-collapse text-left">
          <thead>
            <tr
              className="border-b border-border bg-muted/40 text-[11px] font-medium uppercase
                         tracking-wide text-subtle-foreground"
            >
              <th className="px-4 py-2 font-medium">Preview</th>
              <th className="px-4 py-2 font-medium">Folder</th>
              <th className="whitespace-nowrap px-4 py-2 font-medium">Used</th>
              <th className="whitespace-nowrap px-4 py-2 font-medium">Unused</th>
              <th className="px-4 py-2 font-medium">Tags</th>
              {customColumns.map((c) => (
                <th key={c.id} className="max-w-[12rem] truncate px-4 py-2 font-medium" title={c.name}>
                  {c.name}
                </th>
              ))}
              <th className="whitespace-nowrap px-4 py-2 font-medium">Added</th>
              <th className="whitespace-nowrap px-4 py-2 font-medium">Updated</th>
              <th className="w-px px-4 py-2" />
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
                className="cursor-pointer border-b border-border outline-none transition-colors
                           last:border-0 hover:bg-accent/50 focus-visible:ring-2
                           focus-visible:ring-ring/50"
              >
                <td className="px-4 py-3">
                  <FolderPreview path={folder.containerPath} />
                </td>
                <td className="max-w-[22rem] px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <FolderTree className="size-4 shrink-0 text-subtle-foreground" />
                    <span className="truncate text-[13px]">{folder.containerPath}</span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-[13px] text-success">
                  {folder.usedCount} used
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-[13px] text-muted-foreground">
                  {folder.unusedCount} unused
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {folder.tags.length === 0 ? (
                      <span className="text-[12px] text-subtle-foreground">—</span>
                    ) : (
                      folder.tags.map((t) => {
                        const f: Facet = { fieldId: null, label: "Tag", value: t };
                        return (
                          <FacetChip
                            key={t}
                            facet={f}
                            active={isActive(f)}
                            onToggle={toggleFacet}
                          />
                        );
                      })
                    )}
                  </div>
                </td>
                {customColumns.map((c) => {
                  const value = folder.fields.find((f) => f.fieldId === c.id)?.value;
                  if (!value) {
                    return (
                      <td key={c.id} className="px-4 py-3 text-[12px] text-subtle-foreground">
                        —
                      </td>
                    );
                  }
                  const f: Facet = { fieldId: c.id, label: c.name, value };
                  return (
                    <td key={c.id} className="px-4 py-3">
                      <FacetChip
                        facet={f}
                        active={isActive(f)}
                        onToggle={toggleFacet}
                      />
                    </td>
                  );
                })}
                <td
                  className="whitespace-nowrap px-4 py-3 text-[12px] text-muted-foreground"
                  title={folder.addedAt}
                >
                  {date(folder.addedAt)}
                </td>
                <td
                  className="whitespace-nowrap px-4 py-3 text-[12px] text-muted-foreground"
                  title={folder.updatedAt}
                >
                  {relativeDate(folder.updatedAt)}
                </td>
                <td className="px-4 py-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(folder);
                    }}
                  >
                    <Pencil /> Edit
                  </Button>
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
    </div>
  );
}
