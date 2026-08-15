import { useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Clock, FilePlus2, FolderOpen, Layers, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd, Tooltip } from "@/components/ui/misc";
import { ipc } from "@/lib/ipc";
import { keys, reportError } from "@/hooks/queries";
import { useRecentLibraries } from "@/hooks/queries";
import { relativeDate } from "@/lib/format";
import { mod } from "@/lib/utils";

export function Welcome() {
  const qc = useQueryClient();
  const recent = useRecentLibraries();
  const [busy, setBusy] = useState(false);

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
      <div className="drag-region h-10 shrink-0" />

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
