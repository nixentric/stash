import { useEffect, useRef, useState } from "react";
import { Check, Copy, Image, Palette, SwatchBook, Type as TypeIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc";
import { useUi } from "@/store/ui";
import type { SearchHit } from "@/lib/types";

/** Kinds in the order they are shown, with the heading each group gets. */
const GROUPS = [
  ["asset", "Assets", Image],
  ["color", "Colors", Palette],
  ["typeface", "Typography", TypeIcon],
  ["logo", "Logos", SwatchBook],
  ["brand", "Brands", SwatchBook],
] as const;

/**
 * The panel under the search field. The field itself keeps filtering the grid —
 * this only adds the things a grid query can never reach: a brand's colour, its
 * type styles, its logos.
 */
export function UniversalSearch({
  term,
  onNavigate,
}: {
  term: string;
  onNavigate: () => void;
}) {
  const { setView } = useUi();
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

  const hits = results.data ?? [];
  // Assets already fill the grid behind this panel; showing them again is noise
  // unless the query also matched something a grid cannot show.
  const beyondAssets = hits.some((h) => h.kind !== "asset");
  if (!beyondAssets || debounced.trim().length < 2) return null;

  const open = (hit: SearchHit) => {
    if (hit.brandId != null) setView({ kind: "brand", id: hit.brandId, name: hit.brandName });
    onNavigate();
  };

  return (
    <div
      ref={box}
      className="absolute left-0 right-0 top-9 z-50 max-h-[26rem] overflow-y-auto rounded-lg
                 border border-border bg-surface p-1 shadow-lg"
    >
      {GROUPS.map(([kind, label, Icon]) => {
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
                key={`${hit.kind}-${hit.id}`}
                className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent/60"
              >
                <button
                  type="button"
                  onClick={() => open(hit)}
                  disabled={hit.kind === "asset"}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                >
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
