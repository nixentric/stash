import { useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
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
import { SourceFoldersPage, TaggedFolders } from "@/components/library/SourceFoldersPage";
import { ManageTagsDialog } from "@/components/dialogs/ManageTagsDialog";
import {
  BrandDialog,
  ColorDialog,
  ElementDialog,
  ExampleDialog,
  LogoDialog,
  TypefaceDialog,
  AdditionalInfoDialog,
} from "@/components/dialogs/BrandDialogs";
import { BrandPage } from "@/components/brand/BrandPage";
import { ipc } from "@/lib/ipc";
import { DotmCircular2 } from "@/components/ui/dotm-circular-2";
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
import { emptyBrand } from "@/lib/types";
import type {
  Brand,
  BrandColor,
  BrandElement,
  BrandExample,
  BrandLogo,
  BrandTypeface,
  BrandAdditionalInfo,
  JobProgress,
} from "@/lib/types";

export default function App() {
  const qc = useQueryClient();
  const library = useCurrentLibrary();
  const prefs = usePrefs();

  const [addOpen, setAddOpen] = useState(false);
  const [markUsedOpen, setMarkUsedOpen] = useState(false);
  const [newCollectionOpen, setNewCollectionOpen] = useState(false);
  const [manageTagsOpen, setManageTagsOpen] = useState(false);
  const [job, setJob] = useState<JobProgress | null>(null);
  const [brandDraft, setBrandDraft] = useState<Brand | null>(null);
  const [colorDraft, setColorDraft] = useState<BrandColor | null>(null);
  const [typefaceDraft, setTypefaceDraft] = useState<BrandTypeface | null>(null);
  const [logoDraft, setLogoDraft] = useState<BrandLogo | null>(null);
  const [exampleDraft, setExampleDraft] = useState<BrandExample | null>(null);
  const [elementDraft, setElementDraft] = useState<BrandElement | null>(null);
  const [additionalInfoDraft, setAdditionalInfoDraft] = useState<BrandAdditionalInfo | null>(null);

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

  useEffect(() => {
    // Show the window only after React has mounted and applied themes
    // to prevent the white flash on startup.
    requestAnimationFrame(() => {
      setTimeout(() => {
        const win = getCurrentWindow();
        win.show().then(() => win.setFocus()).catch(console.error);
      }, 50);
    });
  }, []);

  // ── theme ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (prefs.data) applyTheme(prefs.data.theme);
  }, [prefs.data?.theme]);

  useEffect(() => watchSystemTheme(() => prefs.data?.theme ?? "system"), [prefs.data?.theme]);

  // ── update check ──────────────────────────────────────────────────────────
  // Once per launch, and only with the setting on: this is the single request
  // Stash makes on its own behalf, so it stays easy to point at and to refuse.
  // A failure is silent — someone offline does not need to be told twice.
  useEffect(() => {
    if (!prefs.data?.checkUpdates) return;
    let cancelled = false;

    checkUpdate()
      .then((update) => {
        if (cancelled || !update) return;
        
        let downloading = false;
        
        toast(`Stash ${update.version} is available`, {
          description: `You are on ${update.currentVersion}.`,
          duration: 12_000,
          action: {
            label: "Update & Restart",
            onClick: async () => {
              if (downloading) return;
              downloading = true;
              
              const id = toast.loading(
                <div className="flex items-center gap-3 py-1">
                  <DotmCircular2 size={28} colorPreset="solid-mint" className="shrink-0" ariaLabel="Downloading update" />
                  <span className="text-[13px]">Downloading update...</span>
                </div>
              );
              try {
                let downloaded = 0;
                let contentLength = 0;
                
                await update.downloadAndInstall((event) => {
                  switch (event.event) {
                    case 'Started':
                      contentLength = event.data.contentLength || 0;
                      break;
                    case 'Progress':
                      downloaded += event.data.chunkLength;
                      if (contentLength > 0) {
                        const pct = Math.round((downloaded / contentLength) * 100);
                        toast.loading(
                          <div className="flex items-center gap-3 py-1">
                            <DotmCircular2 size={28} colorPreset="solid-mint" className="shrink-0" ariaLabel="Downloading update" />
                            <span className="text-[13px]">Downloading update... {pct}%</span>
                          </div>,
                          { id }
                        );
                      }
                      break;
                    case 'Finished':
                      toast.loading(
                        <div className="flex items-center gap-3 py-1">
                          <DotmCircular2 size={28} colorPreset="solid-mint" className="shrink-0" ariaLabel="Downloading update" />
                          <span className="text-[13px]">Installing...</span>
                        </div>,
                        { id }
                      );
                      break;
                  }
                });
                
                toast.success("Update installed!", { id });
                await relaunch();
              } catch (e) {
                toast.error(`Update failed: ${e}`, { id });
              } finally {
                downloading = false;
              }
            },
          },
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [prefs.data?.checkUpdates]);

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
        <Toaster position="bottom-right" theme="system" richColors closeButton icons={{ loading: null }} />
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full w-full overflow-hidden">
        <div className="w-[13.5rem] shrink-0">
          <Sidebar
            onNewCollection={() => setNewCollectionOpen(true)}
            onNewBrand={() => setBrandDraft(emptyBrand())}
            onManageTags={() => setManageTagsOpen(true)}
            onEditBrand={setBrandDraft}
          />
        </div>

        <main className="flex min-w-0 flex-1 flex-col">
          <Toolbar
            total={page.data?.total ?? 0}
            onAddFootage={() => setAddOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
          {job && <JobBanner job={job} />}
          <div className="min-h-0 flex-1">
            {ui.view.kind === "brand" ? (
              <BrandPage
                brandId={ui.view.id}
                onEditBrand={setBrandDraft}
                onEditColor={setColorDraft}
                onEditTypeface={setTypefaceDraft}
                onEditLogo={setLogoDraft}
                onEditExample={setExampleDraft}
                onEditElement={setElementDraft}
                onEditAdditionalInfo={setAdditionalInfoDraft}
              />
            ) : ui.view.kind === "sourceFolders" ? <SourceFoldersPage /> : (
              <div className="flex h-full min-h-0 flex-col">
                {ui.view.kind === "tag" && <TaggedFolders tag={ui.view.name} />}
                <div className="min-h-0 flex-1">
                  <FootageGrid
                    items={items}
                    total={page.data?.total ?? 0}
                    loading={page.isLoading}
                    onAddFootage={() => setAddOpen(true)}
                    onSetThumbnail={setThumbnailFromDataUrl}
                  />
                </div>
              </div>
            )}
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

      <ManageTagsDialog open={manageTagsOpen} onClose={() => setManageTagsOpen(false)} />
      <BrandDialog brand={brandDraft} onClose={() => setBrandDraft(null)} />
      <ColorDialog color={colorDraft} onClose={() => setColorDraft(null)} />
      <TypefaceDialog typeface={typefaceDraft} onClose={() => setTypefaceDraft(null)} />
      <LogoDialog logo={logoDraft} onClose={() => setLogoDraft(null)} />
      <ExampleDialog example={exampleDraft} onClose={() => setExampleDraft(null)} />
      <ElementDialog element={elementDraft} onClose={() => setElementDraft(null)} />
      <AdditionalInfoDialog info={additionalInfoDraft} onClose={() => setAdditionalInfoDraft(null)} />

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

      <Toaster position="bottom-right" theme="system" richColors closeButton icons={{ loading: null }} />
    </TooltipProvider>
  );
}
