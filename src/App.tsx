import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import { TooltipProvider } from "@/components/ui/misc";
import { Welcome } from "@/components/welcome/Welcome";
import { Sidebar } from "@/components/library/Sidebar";
import { Toolbar } from "@/components/library/Toolbar";
import { FootageGrid } from "@/components/library/FootageGrid";
import { Inspector } from "@/components/inspector/Inspector";
import { QuickLook } from "@/components/preview/QuickLook";
import { Settings } from "@/components/settings/Settings";
import { AddFootageDialog } from "@/components/dialogs/AddFootageDialog";
import { MarkUsedDialog } from "@/components/dialogs/MarkUsedDialog";
import { PromptDialog } from "@/components/dialogs/PromptDialog";
import { JobBanner } from "@/components/library/JobBanner";
import { SourceFoldersPage } from "@/components/library/SourceFoldersPage";
import { FolderMetadataDialog } from "@/components/dialogs/FolderMetadataDialog";
import { ipc } from "@/lib/ipc";
import { applyTheme, watchSystemTheme } from "@/lib/theme";
import {
  invalidateLibrary,
  keys,
  reportError,
  useCurrentLibrary,
  useFootage,
  useFootageAction,
  useFootageIds,
  usePrefs,
  useProjects,
} from "@/hooks/queries";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { buildQuery, useUi } from "@/store/ui";
import type { FolderNode, JobProgress } from "@/lib/types";

export default function App() {
  const qc = useQueryClient();
  const library = useCurrentLibrary();
  const prefs = usePrefs();

  const [addOpen, setAddOpen] = useState(false);
  const [markUsedOpen, setMarkUsedOpen] = useState(false);
  const [newCollectionOpen, setNewCollectionOpen] = useState(false);
  const [job, setJob] = useState<JobProgress | null>(null);
  const [folderMetadata, setFolderMetadata] = useState<FolderNode | null>(null);

  const ui = useUi();
  const { selection, inspectorOpen, settingsOpen, setSettingsOpen, select } = ui;
  const action = useFootageAction();
  const projects = useProjects(!!library.data);

  const hasLibrary = !!library.data;

  const query = useMemo(
    () => buildQuery(ui, 0, 500),
    // The query is derived from exactly these facets; recomputing on every
    // store change would refetch the grid on unrelated UI state.
    [
      ui.view,
      ui.search,
      ui.sort,
      ui.usage,
      ui.mediaTypes,
      ui.minRating,
      ui.favoriteOnly,
      ui.filterTags,
    ],
  );

  const page = useFootage(query, hasLibrary);
  const allIds = useFootageIds(query, hasLibrary);

  const items = page.data?.items ?? [];
  const orderedIds = useMemo(() => items.map((i) => i.id), [items]);

  // ── theme ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (prefs.data) applyTheme(prefs.data.theme);
  }, [prefs.data?.theme]);

  useEffect(() => watchSystemTheme(() => prefs.data?.theme ?? "system"), [prefs.data?.theme]);

  // ── background job progress ───────────────────────────────────────────────
  useEffect(() => {
    const unlisten = listen<JobProgress>("job:progress", (e) => {
      const p = e.payload;
      if (p.phase === "done" || p.phase === "cancelled") {
        setJob(null);
        qc.invalidateQueries({ queryKey: ["thumb"] });
        invalidateLibrary(qc);
      } else {
        setJob(p);
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [qc]);

  // ── library actions used by shortcuts ─────────────────────────────────────
  const newLibrary = useCallback(async () => {
    const path = await saveDialog({
      title: "New Library",
      defaultPath: "My Footage Library.footagedb",
      filters: [{ name: "Stash Library", extensions: ["footagedb"] }],
    });
    if (!path) return;
    try {
      await ipc.createLibrary(path);
      await qc.invalidateQueries();
    } catch (e) {
      reportError(e, "Could not create the library");
    }
  }, [qc]);

  const openLibrary = useCallback(async () => {
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
  }, [qc]);

  const hotkeyOptions = useMemo(
    () => ({
      onNewLibrary: newLibrary,
      onOpenLibrary: openLibrary,
      onSelectAll: () => select(allIds.data ?? orderedIds),
      onToggleFavorite: () => {
        const anyUnfavorited = items.some(
          (i) => selection.includes(i.id) && !i.favorite,
        );
        action.mutate({
          type: "patch",
          ids: selection,
          patch: { favorite: anyUnfavorited },
        });
      },
      onMarkUsed: () => setMarkUsedOpen(true),
      onDelete: () => {
        const n = selection.length;
        action.mutate(
          { type: "remove", ids: selection },
          {
            onSuccess: () =>
              toast.success(
                `Removed ${n} item${n > 1 ? "s" : ""} from the library. Original files were not touched.`,
              ),
          },
        );
      },
    }),
    [newLibrary, openLibrary, select, allIds.data, orderedIds, items, selection, action],
  );

  useHotkeys(hotkeyOptions);

  const setThumbnailFromDataUrl = useCallback(
    async (id: number, dataUrl: string) => {
      if (!dataUrl) {
        // Already written by the caller; just refresh what is on screen.
        qc.invalidateQueries({ queryKey: keys.thumb(id, false) });
        qc.invalidateQueries({ queryKey: keys.detail(id) });
        return;
      }
      try {
        await ipc.setThumbnailFromBytes(id, dataUrl);
        qc.invalidateQueries({ queryKey: keys.thumb(id, false) });
        qc.invalidateQueries({ queryKey: keys.thumb(id, true) });
        qc.invalidateQueries({ queryKey: keys.detail(id) });
        toast.success("Thumbnail set");
      } catch (e) {
        reportError(e, "Could not set that thumbnail");
      }
    },
    [qc],
  );

  // Paste an image onto the selection to use it as a thumbnail (§8).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA/.test(target.tagName)) return;
      const id = selection.length === 1 ? selection[0] : null;
      if (id == null) return;

      const file = Array.from(e.clipboardData?.items ?? [])
        .find((i) => i.type.startsWith("image/"))
        ?.getAsFile();
      if (!file) return;

      e.preventDefault();
      const reader = new FileReader();
      reader.onload = () => setThumbnailFromDataUrl(id, String(reader.result));
      reader.readAsDataURL(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [selection, setThumbnailFromDataUrl]);

  if (!hasLibrary) {
    return (
      <TooltipProvider delayDuration={400}>
        <Welcome />
        <Toaster position="bottom-right" theme="system" richColors closeButton />
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full w-full overflow-hidden">
        <div className="w-[13.5rem] shrink-0">
          <Sidebar onNewCollection={() => setNewCollectionOpen(true)} />
        </div>

        <main className="flex min-w-0 flex-1 flex-col">
          <Toolbar
            total={page.data?.total ?? 0}
            onAddFootage={() => setAddOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
          {job && <JobBanner job={job} />}
          <div className="min-h-0 flex-1">
            {ui.view.kind === "sourceFolders" ? <SourceFoldersPage onEdit={setFolderMetadata} /> : <FootageGrid
              items={items}
              total={page.data?.total ?? 0}
              loading={page.isLoading}
              onAddFootage={() => setAddOpen(true)}
              onSetThumbnail={setThumbnailFromDataUrl}
            />}
          </div>
        </main>

        {inspectorOpen && (
          <div className="w-[17.5rem] shrink-0">
            <Inspector />
          </div>
        )}
      </div>

      <QuickLook orderedIds={orderedIds} />

      <AddFootageDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onOpenSettings={() => {
          setAddOpen(false);
          setSettingsOpen(true);
        }}
      />
      <FolderMetadataDialog folder={folderMetadata} onClose={() => setFolderMetadata(null)} />

      <MarkUsedDialog
        open={markUsedOpen}
        onOpenChange={setMarkUsedOpen}
        ids={selection}
        projects={projects.data ?? []}
      />

      <PromptDialog
        open={newCollectionOpen}
        onOpenChange={setNewCollectionOpen}
        title="New Collection"
        description="Collections group footage without moving anything at the source."
        placeholder="People, Product, 17 Agustus…"
        confirmLabel="Create"
        onSubmit={async (name) => {
          try {
            await ipc.createCollection(name);
            qc.invalidateQueries({ queryKey: keys.collections });
            toast.success(`Created “${name}”`);
          } catch (e) {
            reportError(e);
          }
        }}
      />

      <Settings open={settingsOpen} onOpenChange={setSettingsOpen} />

      <Toaster position="bottom-right" theme="system" richColors closeButton />
    </TooltipProvider>
  );
}
