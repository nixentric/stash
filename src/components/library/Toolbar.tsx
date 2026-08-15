import { useEffect, useRef, useState } from "react";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  Cloud,
  CloudOff,
  Filter,
  Grid2x2,
  List,
  PanelRight,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuShortcut,
} from "@/components/ui/menu";
import { Badge, Kbd, Rating, Tooltip } from "@/components/ui/misc";
import { cn, mod } from "@/lib/utils";
import { count } from "@/lib/format";
import { ipc } from "@/lib/ipc";
import {
  invalidateLibrary,
  reportError,
  useCapabilities,
  useCurrentLibrary,
  useStats,
} from "@/hooks/queries";
import { useUi } from "@/store/ui";
import { UniversalSearch } from "@/components/library/UniversalSearch";
import { emptyQuery, type MediaType, type SortKey } from "@/lib/types";

const SORT_LABELS: Record<SortKey, string> = {
  newestAdded: "Newest added",
  oldestAdded: "Oldest added",
  nameAsc: "Name A–Z",
  nameDesc: "Name Z–A",
  recentlyUsed: "Recently used",
  mostUsed: "Most used",
  neverUsed: "Never used first",
  highestRating: "Highest rating",
  duration: "Duration",
};

export function Toolbar({
  total,
  onAddFootage,
  onOpenSettings,
}: {
  total: number;
  onAddFootage: () => void;
  onOpenSettings: () => void;
}) {
  const qc = useQueryClient();
  const library = useCurrentLibrary();
  const caps = useCapabilities();
  const stats = useStats(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const {
    view,
    search,
    setSearch,
    sort,
    setSort,
    viewMode,
    setViewMode,
    inspectorOpen,
    setInspectorOpen,
    usage,
    setUsage,
    mediaTypes,
    toggleMediaType,
    minRating,
    setMinRating,
    favoriteOnly,
    setFavoriteOnly,
    clearFilters,
    hasActiveFilters,
    selection,
  } = useUi();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filterCount =
    (usage !== "all" ? 1 : 0) +
    mediaTypes.length +
    (minRating ? 1 : 0) +
    (favoriteOnly ? 1 : 0);

  async function closeLibrary() {
    await ipc.closeLibrary();
    await qc.invalidateQueries();
  }

  async function saveAs(switchTo: boolean) {
    const path = await saveDialog({
      title: switchTo ? "Save Library As" : "Save a Copy",
      defaultPath: `${library.data?.name ?? "Library"}${switchTo ? "" : " copy"}.footagedb`,
      filters: [{ name: "Stash Library", extensions: ["footagedb"] }],
    });
    if (!path) return;
    try {
      await ipc.saveLibraryAs(path, switchTo);
      await qc.invalidateQueries();
      toast.success(switchTo ? "Saved as a new library" : "Copy saved");
    } catch (e) {
      reportError(e, "Could not save");
    }
  }

  async function openAnother() {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "Stash Library", extensions: ["footagedb"] }],
    });
    if (!picked || Array.isArray(picked)) return;
    try {
      await ipc.openLibrary(picked);
      await qc.invalidateQueries();
    } catch (e) {
      reportError(e, "Could not open the library");
    }
  }

  return (
    <header className="shrink-0 bg-titlebar hairline-b">
      {/* Row 1 — identity, search, actions */}
      <div className="drag-region flex h-10 items-center gap-2 pl-2 pr-2">
        <div className="no-drag flex items-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="max-w-[15rem] gap-1 px-2">
                <span className="truncate font-medium text-foreground">
                  {library.data?.name ?? "Library"}
                </span>
                <ChevronDown className="size-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[15rem]">
              <DropdownMenuLabel>Library</DropdownMenuLabel>
              <DropdownMenuItem onSelect={openAnother}>
                Open Library…
                <MenuShortcut>{mod} O</MenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => saveAs(false)}>Save a Copy…</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => saveAs(true)}>Save As…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onOpenSettings}>
                Settings…
                <MenuShortcut>{mod} ,</MenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={closeLibrary}>Close Library</DropdownMenuItem>
              {library.data && (
                <>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1 text-[11px] leading-relaxed text-subtle-foreground">
                    <p className="break-all">{library.data.path}</p>
                  </div>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Autosave: there is no dirty state to show, so the app says so
              plainly rather than inventing a save button. */}
          <span className="ml-1 hidden text-[11px] text-subtle-foreground lg:inline">
            All changes saved
          </span>
        </div>

        <div className="no-drag relative mx-auto w-full max-w-md">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPanelOpen(true);
            }}
            onFocus={() => setPanelOpen(true)}
            // A click inside the panel blurs the field; closing on the next tick
            // lets that click land first.
            onBlur={() => setTimeout(() => setPanelOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearch("");
                setPanelOpen(false);
              }
            }}
            placeholder="Search assets, tags, brands, colors, fonts…"
            className="h-7 pl-7 pr-14"
            aria-label="Search the library"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
          />
          {panelOpen && (
            <UniversalSearch term={search} onNavigate={() => setPanelOpen(false)} />
          )}
          {search ? (
            <button
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5
                         text-subtle-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          ) : (
            <Kbd className="absolute right-1.5 top-1/2 -translate-y-1/2">{mod} F</Kbd>
          )}
        </div>

        <div className="no-drag flex items-center gap-1">
          <DriveIndicator
            connected={caps.data?.driveConnected ?? false}
            onOpenSettings={onOpenSettings}
            onSync={async () => {
              try {
                const r = await ipc.syncLibrary(null);
                invalidateLibrary(qc);
                toast.success(
                  `Synced ${r.checked} · ${r.renamed} renamed · ${r.missing} missing`,
                );
              } catch (e) {
                reportError(e, "Sync failed");
              }
            }}
          />

          <Button size="sm" onClick={onAddFootage}>
            <Plus />
            Add Footage
          </Button>
        </div>
      </div>

      {/* Row 2 — filters, sort, view */}
      {view.kind !== "brand" && view.kind !== "sourceFolders" && (
        <div className="flex h-9 items-center gap-1 px-2">
          <span className="tnum mr-1 shrink-0 text-[11.5px] text-subtle-foreground">
          {count(total)} {total === 1 ? "item" : "items"}
          {selection.length > 0 && ` · ${count(selection.length)} selected`}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className={cn(filterCount > 0 && "text-foreground")}>
              <Filter />
              Filters
              {filterCount > 0 && <Badge className="ml-0.5">{filterCount}</Badge>}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[13rem]">
            <DropdownMenuLabel>Usage</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={usage}
              onValueChange={(v) => setUsage(v as typeof usage)}
            >
              <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="used">Used</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="unused">Unused</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>

            <DropdownMenuSeparator />
            <DropdownMenuLabel>Type</DropdownMenuLabel>
            {(["image", "video"] as MediaType[]).map((m) => (
              <DropdownMenuCheckboxItem
                key={m}
                checked={mediaTypes.includes(m)}
                onCheckedChange={() => toggleMediaType(m)}
                onSelect={(e) => e.preventDefault()}
              >
                {m === "image" ? "Images" : "Videos"}
              </DropdownMenuCheckboxItem>
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={favoriteOnly}
              onCheckedChange={(v) => setFavoriteOnly(v === true)}
              onSelect={(e) => e.preventDefault()}
            >
              Favorites only
            </DropdownMenuCheckboxItem>

            <DropdownMenuSeparator />
            <DropdownMenuLabel>Minimum rating</DropdownMenuLabel>
            <div className="px-2 py-1">
              <Rating value={minRating ?? 0} onChange={(v) => setMinRating(v || null)} />
            </div>

            {filterCount > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={clearFilters}>Reset filters</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <ArrowUpDown />
              {SORT_LABELS[sort]}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <DropdownMenuItem key={k} onSelect={() => setSort(k)}>
                <Check className={cn("size-3.5", sort !== k && "opacity-0")} />
                {SORT_LABELS[k]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {hasActiveFilters() && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X />
            Clear
          </Button>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          {!!stats.data?.withoutThumbnail && caps.data?.driveConnected && (
            <Tooltip content="Fetch previews that are missing">
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  try {
                    const ids = await ipc.listFootageIds({
                      ...emptyQuery(),
                      missingThumbnail: true,
                    });
                    toast.info(`Fetching ${ids.length} preview(s)…`);
                    const n = await ipc.fetchThumbnails(ids, false);
                    qc.invalidateQueries({ queryKey: ["thumb"] });
                    invalidateLibrary(qc);
                    if (n < ids.length) {
                      toast.info(
                        `Refreshed ${n} of ${ids.length} — the rest have no preview available, ` +
                          `usually a missing source or an unsupported file.`,
                      );
                    } else {
                      toast.success(`Refreshed ${n} preview(s)`);
                    }
                  } catch (e) {
                    reportError(e);
                  }
                }}
              >
                <RefreshCw />
                {stats.data.withoutThumbnail} missing
              </Button>
            </Tooltip>
          )}

          <div className="flex items-center rounded-md border border-border p-px">
            <Tooltip content="Grid">
              <Button
                variant={viewMode === "grid" ? "subtle" : "ghost"}
                size="icon-sm"
                onClick={() => setViewMode("grid")}
                aria-pressed={viewMode === "grid"}
              >
                <Grid2x2 />
              </Button>
            </Tooltip>
            <Tooltip content="List">
              <Button
                variant={viewMode === "list" ? "subtle" : "ghost"}
                size="icon-sm"
                onClick={() => setViewMode("list")}
                aria-pressed={viewMode === "list"}
              >
                <List />
              </Button>
            </Tooltip>
          </div>

          <Tooltip content={inspectorOpen ? "Hide inspector" : "Show inspector"} shortcut={`${mod} I`}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setInspectorOpen(!inspectorOpen)}
              aria-pressed={inspectorOpen}
            >
              <PanelRight />
            </Button>
          </Tooltip>

          <Tooltip content="Settings" shortcut={`${mod} ,`}>
            <Button variant="ghost" size="icon-sm" onClick={onOpenSettings}>
              <Settings2 />
            </Button>
          </Tooltip>
        </div>
      </div>
      )}
    </header>
  );
}

/**
 * Connection state, stated once and quietly.
 *
 * Disconnected is not an error and is never presented as one — link mode is the
 * default product, so this reads as an available upgrade rather than a warning.
 */
function DriveIndicator({
  connected,
  onOpenSettings,
  onSync,
}: {
  connected: boolean;
  onOpenSettings: () => void;
  onSync: () => void;
}) {
  if (!connected) {
    return (
      <Tooltip content="Google Drive is optional — connect for folder scanning and automatic previews">
        <Button variant="ghost" size="sm" onClick={onOpenSettings}>
          <CloudOff />
          <span className="hidden md:inline">Link mode</span>
        </Button>
      </Tooltip>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <Cloud className="text-success" />
          <span className="hidden md:inline">Drive</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onSync}>
          <RefreshCw />
          Sync metadata
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenSettings}>
          <Settings2 />
          Integration settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
