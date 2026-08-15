import { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useTags } from "@/hooks/queries";

interface Props {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * Tag editor with autocomplete over tags already in the library (§19).
 *
 * Suggestions come from what exists rather than a fixed vocabulary, which is
 * what stops `iphone` / `iPhone` / `i phone` from becoming three tags.
 */
export function TagInput({ value, onChange, placeholder = "Add tag…", autoFocus }: Props) {
  const [draft, setDraft] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const all = useTags(true);

  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return [];
    return (all.data ?? [])
      .map((t) => t.name)
      .filter((n) => n.includes(q) && !value.includes(n))
      .slice(0, 6);
  }, [draft, all.data, value]);

  function commit(raw: string) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (!tag) return;
    if (!value.includes(tag)) onChange([...value, tag]);
    setDraft("");
    setHighlight(0);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="flex flex-wrap items-center gap-1 rounded-md border border-input bg-surface p-1
                   focus-within:border-ring/70 focus-within:ring-2 focus-within:ring-ring/25"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11.5px]"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((t) => t !== tag));
              }}
              className="text-subtle-foreground transition-colors hover:text-foreground"
            >
              <X className="size-2.5" />
            </button>
          </span>
        ))}

        <Input
          ref={inputRef}
          autoFocus={autoFocus}
          value={draft}
          placeholder={value.length === 0 ? placeholder : ""}
          onChange={(e) => {
            setDraft(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
              if (draft.trim()) {
                e.preventDefault();
                commit(suggestions[highlight] ?? draft);
              }
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            } else if (e.key === "ArrowDown" && suggestions.length) {
              e.preventDefault();
              setHighlight((h) => (h + 1) % suggestions.length);
            } else if (e.key === "ArrowUp" && suggestions.length) {
              e.preventDefault();
              setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
            }
          }}
          className="h-5 min-w-[6rem] flex-1 border-0 bg-transparent px-1 focus-visible:ring-0"
        />
      </div>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((s, i) => (
            <button
              key={s}
              type="button"
              onMouseEnter={() => setHighlight(i)}
              onClick={() => commit(s)}
              className={cn(
                "rounded px-1.5 py-0.5 text-[11.5px] transition-colors",
                i === highlight
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
