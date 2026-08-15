import { FilterX, Plus, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUi } from "@/store/ui";

/**
 * Two genuinely different situations, two different messages.
 *
 * "You have nothing yet" wants an import button. "Your filter matched nothing"
 * wants a way back — offering Import there would be answering the wrong question.
 */
export function EmptyState({
  filtered,
  onAddFootage,
}: {
  filtered: boolean;
  onAddFootage: () => void;
}) {
  const { clearFilters, setSearch, setView, search, hasActiveFilters } = useUi();

  if (filtered) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 pb-16 text-center">
        <SearchX className="size-6 text-subtle-foreground/70" />
        <div>
          <p className="text-[13px] font-medium">No footage matches</p>
          <p className="mt-1 max-w-[22rem] text-[12px] leading-relaxed text-muted-foreground">
            {search.trim()
              ? `Nothing found for “${search.trim()}”.`
              : "Nothing in this view matches the current filters."}
          </p>
        </div>
        <div className="flex gap-2">
          {search.trim() && (
            <Button variant="secondary" size="sm" onClick={() => setSearch("")}>
              Clear search
            </Button>
          )}
          {hasActiveFilters() && (
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              <FilterX />
              Reset filters
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setView({ kind: "all" })}>
            Show whole library
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 pb-16 text-center">
      <div>
        <p className="text-[14px] font-medium tracking-[-0.01em]">
          Your footage library is empty
        </p>
        <p className="mx-auto mt-1.5 max-w-[24rem] text-[12.5px] leading-relaxed text-muted-foreground">
          Paste Google Drive links, add files from this computer, or connect Google Drive
          to scan a whole folder at once.
        </p>
      </div>
      <Button onClick={onAddFootage}>
        <Plus />
        Add Footage
      </Button>
      <p className="text-[11.5px] text-subtle-foreground">
        No Google account required — links work on their own.
      </p>
    </div>
  );
}
