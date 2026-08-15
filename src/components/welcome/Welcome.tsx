import { useState, useEffect } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Clock, FilePlus2, FolderOpen, Layers, X, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd, Tooltip } from "@/components/ui/misc";
import { ipc } from "@/lib/ipc";
import { keys, reportError } from "@/hooks/queries";
import { useRecentLibraries } from "@/hooks/queries";
import { relativeDate } from "@/lib/format";
import { cn, mod } from "@/lib/utils";
import { getVersion } from "@tauri-apps/api/app";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { Update } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";
import { HexOrbitLoader } from "@/components/ui/dot-matrix";

export function Welcome() {
  const qc = useQueryClient();
  const recent = useRecentLibraries();
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState<string>("");
  const [update, setUpdate] = useState<Update | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion).catch(console.error);

    let cancelled = false;
    setChecking(true);
    checkUpdate()
      .then((upd) => {
        if (cancelled) return;
        setUpdate(upd);
      })
      .catch((err) => {
        console.error("Welcome update check failed:", err);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function checkManual() {
    if (checking || updating) return;
    setChecking(true);
    try {
      const upd = await checkUpdate();
      setUpdate(upd);
      if (!upd) {
        toast.success("You are on the latest version.");
      }
    } catch (e) {
      reportError(e, "Could not reach the update server");
    } finally {
      setChecking(false);
    }
  }

  async function handleUpdate() {
    if (!update || updating) return;
    setUpdating(true);
    const id = toast.loading(
      <div className="flex items-center gap-3 py-1">
        <HexOrbitLoader className="shrink-0 scale-75" />
        <span className="text-[13px]">Downloading update...</span>
      </div>
    );
    try {
      let downloaded = 0;
      let contentLength = 0;
      await update.downloadAndInstall((e) => {
        if (e.event === 'Started') {
          contentLength = e.data.contentLength || 0;
        } else if (e.event === 'Progress') {
          downloaded += e.data.chunkLength;
          if (contentLength > 0) {
            const pct = Math.round((downloaded / contentLength) * 100);
            toast.loading(
              <div className="flex items-center gap-3 py-1">
                <HexOrbitLoader className="shrink-0 scale-75" />
                <span className="text-[13px]">Downloading update... {pct}%</span>
              </div>,
              { id }
            );
          }
        } else if (e.event === 'Finished') {
          toast.loading(
            <div className="flex items-center gap-3 py-1">
              <HexOrbitLoader className="shrink-0 scale-75" />
              <span className="text-[13px]">Installing...</span>
            </div>,
            { id }
          );
        }
      });
      toast.success("Update installed!", { id });
      await relaunch();
    } catch (e) {
      toast.error(`Update failed: ${e}`, { id });
    } finally {
      setUpdating(false);
    }
  }

  async function afterOpen() {
    await qc.invalidateQueries();
  }

  async function createLibrary() {
    const path = await saveDialog({
      title: "New Library",
      defaultPath: "My Footage Library.footagedb",
      filters: [{ name: "Stash Library", extensions: ["footagedb"] }],
    });
    if (!path) return;
    setBusy(true);
    try {
      await ipc.createLibrary(path);
      await afterOpen();
    } catch (e) {
      reportError(e, "Could not create the library");
    } finally {
      setBusy(false);
    }
  }

  async function openLibrary(path?: string) {
    let target = path;
    if (!target) {
      const picked = await openDialog({
        title: "Open Library",
        multiple: false,
        filters: [{ name: "Stash Library", extensions: ["footagedb"] }],
      });
      if (!picked || Array.isArray(picked)) return;
      target = picked;
    }
    setBusy(true);
    try {
      await ipc.openLibrary(target);
      await afterOpen();
    } catch (e) {
      reportError(e, "Could not open the library");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="drag-region flex h-10 shrink-0 items-center justify-end px-4 gap-2">
        {update ? (
          <Button
            variant="default"
            size="sm"
            className="no-drag h-7 text-[11.5px] font-medium animate-fade-in"
            onClick={handleUpdate}
            disabled={updating}
          >
            <Download className="size-3.5" />
            Update to v{update.version}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="no-drag h-7 text-[11.5px] font-normal text-muted-foreground hover:text-foreground"
            onClick={checkManual}
            disabled={checking}
          >
            <RefreshCw className={cn("size-3.5", checking && "animate-spin")} />
            {checking ? "Checking..." : version ? `v${version}` : "Check for Updates"}
          </Button>
        )}
      </div>

      <div className="flex flex-1 items-center justify-center px-8 pb-16">
        <div className="grid w-full max-w-3xl grid-cols-1 gap-12 md:grid-cols-[1fr_auto_1fr]">
          <div className="flex flex-col justify-center">
            <div className="mb-7 flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
                <Layers className="size-4 text-primary" />
              </div>
              <div>
                <h1 className="text-[15px] font-semibold leading-tight tracking-[-0.01em]">
                  Stash
                </h1>
                <p className="text-[11.5px] text-subtle-foreground">
                  Visual footage catalog
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <ActionRow
                icon={<FilePlus2 className="size-4" />}
                label="New Library"
                hint={`${mod} N`}
                disabled={busy}
                onClick={createLibrary}
              />
              <ActionRow
                icon={<FolderOpen className="size-4" />}
                label="Open Library…"
                hint={`${mod} O`}
                disabled={busy}
                onClick={() => openLibrary()}
              />
            </div>

            <p className="mt-7 max-w-[16rem] text-[12px] leading-relaxed text-subtle-foreground">
              A library is one portable <code className="font-mono">.footagedb</code> file.
              Move it, back it up, or send it to a collaborator — the catalog travels with it.
            </p>
          </div>

          <div className="hidden w-px bg-border md:block" />

          <div className="min-w-0">
            <h2 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">
              <Clock className="size-3" />
              Recent
            </h2>

            {recent.data && recent.data.length > 0 ? (
              <ul className="flex flex-col gap-px">
                {recent.data.map((r) => (
                  <li key={r.path} className="group relative">
                    <button
                      onClick={() => openLibrary(r.path)}
                      disabled={busy}
                      className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5
                                 text-left outline-none transition-colors hover:bg-accent
                                 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                    >
                      <span className="w-full truncate text-[13px] font-medium">{r.name}</span>
                      <span className="w-full truncate text-[11px] text-subtle-foreground">
                        {relativeDate(r.openedAt)} · {r.path}
                      </span>
                    </button>
                    <Tooltip content="Remove from list">
                      <button
                        aria-label={`Remove ${r.name} from recent`}
                        onClick={async (e) => {
                          e.stopPropagation();
                          await ipc.forgetRecent(r.path);
                          qc.invalidateQueries({ queryKey: keys.recent });
                        }}
                        className="absolute right-1.5 top-1.5 rounded p-1 text-subtle-foreground
                                   opacity-0 transition-opacity hover:bg-muted hover:text-foreground
                                   group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        <X className="size-3" />
                      </button>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2 text-[12px] text-subtle-foreground">
                No libraries yet. Create one to get started.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionRow({
  icon,
  label,
  hint,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="secondary"
      size="lg"
      onClick={onClick}
      disabled={disabled}
      className="h-9 w-full justify-start gap-2.5 px-3 font-normal"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-[13px]">{label}</span>
      <Kbd className="ml-auto">{hint}</Kbd>
    </Button>
  );
}
