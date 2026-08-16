import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  Copy,
  FileText,
  Folder,
  Image,
  Palette,
  Shapes,
  SwatchBook,
  Type as TypeIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc";
import { reportError } from "@/hooks/queries";
import { useThumbnail } from "@/hooks/use-thumbnail";
import { useUi } from "@/store/ui";
import type { SearchHit } from "@/lib/types";

/**
 * Kinds in the order they are shown, with the heading each group gets.
 *
 * Assets sit last on purpose: they are the bulk of any library, and the panel
 * exists for the things the grid behind it cannot show. Searching a colour
 * should not mean scrolling past five clips first — the grid already has them.
 */
export const GROUPS = [
  ["folder", "Source Folders", Folder],
  ["color", "Colors", Palette],
  ["typeface", "Typography", TypeIcon],
  ["logo", "Logos", SwatchBook],
  ["element", "Elements", Shapes],
  ["info", "Additional Info", FileText],
  ["guideline", "Guidelines", BookOpen],
  ["brand", "Brands", SwatchBook],
  ["asset", "Assets", Image],
] as const;

/** The thumbnail an asset hit carries — the fastest way to know it is the file. */
function Thumb({ id }: { id: number }) {
  const thumb = useThumbnail(id, true);
  return thumb.data ? (
    <img src={thumb.data} alt="" loading="lazy" className="size-7 shrink-0 rounded-sm object-cover" />
  ) : (
    <div className="size-7 shrink-0 rounded-sm bg-thumb-bg" />
  );
}

/**
 * The panel under the search field. The field itself keeps filtering the grid —
 * this only adds the things a grid query can never reach: a brand's colour, its
 * type styles, its logos.
 */
export function UniversalSearch({
  term,
  only,
  onNavigate,
}: {
  term: string;
  /** Kind picked in the search field, or null for everything. */
  only: string | null;
  onNavigate: () => void;
}) {
  const { setView, setQuickLookId, select } = useUi();
  const [copied, setCopied] = useState<number | null>(null);
  const [debounced, setDebounced] = useState(term);
  const box = useRef<HTMLDivElement>(null);

  // Typing is faster than SQLite is slow, but a query per keystroke is still
  // waste when the user is mid-word.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term), 150);
    return () => clearTimeout(t);
  }, [term]);

  const results = useQuery({
    queryKey: ["universalSearch", debounced],
    queryFn: () => ipc.universalSearch(debounced),
    enabled: debounced.trim().length > 1,
  });

  const hits = (results.data ?? []).filter((h) => !only || h.kind === only);
  // Assets already fill the grid behind this panel; showing them again is noise
  // unless the query also matched something a grid cannot show. Picking a kind
  // in the field is that judgement made by hand, so it overrides this.
  const beyondAssets = hits.some((h) => h.kind !== "asset");
  if (debounced.trim().length < 2) return null;
  if (!only && !beyondAssets) return null;

  const open = (hit: SearchHit) => {
    // A link entry is the link: opening the brand page and asking the user to
    // find the card again is one hop too many.
    if (hit.url) {
      ipc.openExternal(hit.url).catch(reportError);
    } else if (hit.kind === "asset") {
      // The file itself is what was asked for: preview it, and leave it selected
      // so closing the preview lands on it in the grid.
      select([hit.id], hit.id);
      setQuickLookId(hit.id);
    } else if (hit.kind === "folder") {
      // A folder hit carries its path as the subtitle, and that is the view.
      setView({ kind: "folder", path: hit.subtitle });
    } else if (hit.brandId != null) {
      setView({ kind: "brand", id: hit.brandId, name: hit.brandName });
    }
    onNavigate();
  };

  return (
    <div
      ref={box}
      className="absolute left-0 right-0 top-9 z-50 max-h-[26rem] overflow-y-auto rounded-lg
                 border border-border bg-surface p-1 shadow-lg"
    >
      {/* A scoped search that matches nothing must say so — an empty box reads
          as a broken panel. */}
      {hits.length === 0 && !results.isLoading && (
        <p className="px-2 py-3 text-center text-[12px] text-subtle-foreground">
          Nothing here matches “{debounced.trim()}”.
        </p>
      )}

      {GROUPS.map(([kind, label, Icon]) => {
        if (only && only !== kind) return null;
        const group = hits.filter((h) => h.kind === kind);
        if (group.length === 0) return null;

        return (
          <div key={kind} className="mb-1 last:mb-0">
            <div className="flex items-center gap-1.5 px-2 py-1 text-[10.5px] font-medium uppercase tracking-wide text-subtle-foreground">
              <Icon className="size-3" />
              {label}
            </div>
            {group.map((hit) => (
              <div
                key={`${hit.kind}-${hit.id}-${hit.subtitle}`}
                className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent/60"
              >
                <button
                  type="button"
                  onClick={() => open(hit)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {hit.kind === "asset" && <Thumb id={hit.id} />}
                  {hit.hex && (
                    <span
                      className="size-4 shrink-0 rounded border border-border"
                      style={{ backgroundColor: hit.hex }}
                      aria-hidden
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{hit.title}</span>
                    {hit.subtitle && (
                      <span className="block truncate text-[11px] text-subtle-foreground">
                        {hit.subtitle}
                      </span>
                    )}
                  </span>
                </button>

                {/* A colour or a font name is usually wanted as text, not as a
                    page to visit — so copying is one click, without leaving. */}
                {(hit.hex || hit.kind === "typeface") && (
                  <button
                    type="button"
                    title={`Copy ${hit.hex ?? hit.title}`}
                    onClick={async () => {
                      await navigator.clipboard.writeText(hit.hex ?? hit.title);
                      setCopied(hit.id);
                      setTimeout(() => setCopied(null), 1200);
                    }}
                    className="shrink-0 cursor-pointer rounded p-1 text-subtle-foreground
                               hover:bg-accent hover:text-foreground"
                  >
                    {copied === hit.id ? (
                      <Check className="size-3.5" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
