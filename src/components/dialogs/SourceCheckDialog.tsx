import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { CircleCheck, HardDriveDownload, Trash2, Unplug } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { asIpcError, ipc } from "@/lib/ipc";
import { count, percent } from "@/lib/format";
import { invalidateLibrary, reportError, toastUndo, useDownloadedIds } from "@/hooks/queries";
import { emptyQuery, type SyncItem, type SyncReport } from "@/lib/types";

/** What to check: an explicit selection, or everything under a folder. */
export type SourceCheckScope = {
  ids?: number[];
  containerPath?: string;
  /** What is being checked, in the words the menu used. */
  label: string;
};

/**
 * Asks the source whether these files are still there, and offers to clear out
 * the ones that are not.
 *
 * The check itself is `sync_library` — the same authenticated `files.get` that
 * the Refresh button runs, which is the only evidence §23 accepts for calling a
 * file gone. Nothing here concludes anything from a failed thumbnail or from
 * Google's embed: a private file and a deleted one look identical from outside.
 *
 * A folder is one round trip per file, so the answer is watched rather than
 * waited for: `sync:item` names each file as it goes past and the broken ones
 * land in the list the moment they are found, not at the end (§27). It also
 * carries the job id, which is what makes Stop possible.
 *
 * Removal is two questions, not one. Taking the record out is undoable; the
 * downloaded original next to the library is a file the user asked for, and
 * deleting that is not. So it is never bundled into the first click (§32).
 */
export function SourceCheckDialog({
  scope,
  onClose,
}: {
  scope: SourceCheckScope | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [result, setResult] = useState<SyncReport | null>(null);
  const [error, setError] = useState<{ kind: string; message: string } | null>(null);
  const [step, setStep] = useState<"result" | "downloads">("result");
  const [removing, setRemoving] = useState(false);
  const [live, setLive] = useState<Omit<SyncItem, "footageId" | "gone"> | null>(null);
  const [found, setFound] = useState<{ id: number; name: string }[]>([]);

  const downloaded = useDownloadedIds(!!scope);

  // One run per opening. `scope` is a fresh object each time the menu sets it,
  // and null while the dialog is closed, so this never re-fires on its own.
  useEffect(() => {
    if (!scope) return;
    let dropped = false;
    let off: (() => void) | null = null;
    setResult(null);
    setError(null);
    setStep("result");
    setLive(null);
    setFound([]);

    (async () => {
      // Registered before the call, or the first files go past unseen.
      off = await listen<SyncItem>("sync:item", (e) => {
        const { footageId, gone, ...rest } = e.payload;
        setLive(rest);
        if (gone) setFound((prev) => [...prev, { id: footageId, name: rest.name }]);
      });
      if (dropped) {
        off();
        return;
      }

      try {
        const targets =
          scope.ids ??
          (await ipc.listFootageIds({
            ...emptyQuery(),
            containerPath: scope.containerPath ?? null,
          }));
        const report = await ipc.syncLibrary(targets);
        if (dropped) return;
        setResult(report);
        invalidateLibrary(qc);
      } catch (e) {
        if (!dropped) setError(asIpcError(e));
      }
    })();

    return () => {
      dropped = true;
      off?.();
    };
  }, [scope, qc]);

  const missingIds = result?.missingIds ?? [];
  const onDisk = downloaded.data ?? new Set<number>();
  const withDownloads = missingIds.filter((id) => onDisk.has(id));
  const checking = !!scope && !result && !error;

  async function remove(deleteDownloads: boolean) {
    setRemoving(true);
    try {
      // Files first, records second: the removal is the undoable half, so it
      // goes last and nothing is half-done if the disk refuses.
      const touched = deleteDownloads
        ? await ipc.deleteDownloads(withDownloads)
        : await ipc.releaseDownloads(withDownloads);
      await ipc.removeFootage(missingIds);
      invalidateLibrary(qc);
      const records = `Removed ${count(missingIds.length)} ${
        missingIds.length === 1 ? "record" : "records"
      } from the library.`;
      const files =
        touched === 0
          ? ""
          : deleteDownloads
            ? ` ${count(touched)} downloaded ${touched === 1 ? "file" : "files"} deleted — Undo brings the records back, not the files.`
            : ` ${count(touched)} downloaded ${touched === 1 ? "file was" : "files were"} kept, under their own names.`;
      toastUndo(qc, records + files, () => ipc.restoreRemoved());
      onClose();
    } catch (e) {
      reportError(e, "Could not remove those records");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Dialog open={!!scope} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(34rem,92vw)]">
        <DialogHeader>
          <DialogTitle>
            {step === "downloads" ? "Delete the downloaded files too?" : "Check source"}
          </DialogTitle>
          <DialogDescription>
            {step === "downloads"
              ? `${count(withDownloads.length)} of these ${
                  withDownloads.length === 1 ? "file was" : "files were"
                } downloaded to this computer. Those copies still open — the source being gone does not touch them.`
              : checking
                ? `Asking about ${scope?.label ?? "these files"} — Drive over the network, catalogued files on disk. Metadata only, nothing is downloaded.`
                : `${scope?.label ?? ""}`}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex max-h-[52vh] flex-col gap-3 overflow-y-auto">
          {checking && <Progress live={live} found={found.length} />}

          {error && (
            <div className="flex flex-col gap-2 py-4">
              <p className="text-[13px] font-medium text-muted-foreground">
                The check could not run
              </p>
              <p className="text-[12px] leading-relaxed text-subtle-foreground">
                {error.message}
                {error.kind === "not_connected" &&
                  " — only a signed-in lookup can tell a deleted file from a private one, so Stash will not guess. Connect the account in Settings and try again."}
              </p>
            </div>
          )}

          {result && step === "result" && (
            <p className="text-[12.5px] text-muted-foreground">
              Checked {count(result.checked)} · {count(missingIds.length)} gone
              {result.cancelled && " · stopped early"}
            </p>
          )}

          {/* The same list during and after: a file found broken at number 40 of
              500 is on screen at number 40, not four minutes later. */}
          {found.length > 0 && (
            <ul className="flex flex-col rounded-md border border-border">
              {found.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 last:border-b-0
                             animate-in fade-in-0 slide-in-from-top-1 duration-200"
                >
                  <Unplug className="size-3.5 shrink-0 text-subtle-foreground" />
                  <span className="truncate text-[12.5px]">{f.name}</span>
                  {onDisk.has(f.id) && (
                    <HardDriveDownload
                      className="ml-auto size-3.5 shrink-0 text-subtle-foreground"
                      aria-label="Downloaded to this computer"
                    />
                  )}
                </li>
              ))}
            </ul>
          )}

          {result && step === "result" && missingIds.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CircleCheck className="size-5 text-success" />
              <p className="text-[13px] text-muted-foreground">Every source is still there.</p>
            </div>
          )}

          {result && step === "result" && missingIds.length > 0 && (
            <p className="text-[12px] leading-relaxed text-subtle-foreground">
              Removing takes the records out of this library only. Tags, notes and usage history
              go with them, and Undo puts all of it back.
            </p>
          )}

          {step === "downloads" && (
            <p className="text-[12px] leading-relaxed text-subtle-foreground">
              Kept files stay in the downloads folder under their own names — no longer tied to a
              record, so Undo will not bring them back as previews. Deleting them cannot be undone
              at all.
            </p>
          )}
        </DialogBody>

        <DialogFooter>
          {step === "downloads" ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setStep("result")}>
                Back
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={removing}
                onClick={() => remove(false)}
              >
                Keep the files
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={removing}
                onClick={() => remove(true)}
              >
                <Trash2 />
                Delete {count(withDownloads.length)} downloaded
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
              {/* Stopping keeps everything already learned: the run breaks out
                  and still reports what it got through. */}
              {checking && live && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => ipc.cancelJob(live.jobId).catch(reportError)}
                >
                  Stop
                </Button>
              )}
              {missingIds.length > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={removing}
                  onClick={() => (withDownloads.length > 0 ? setStep("downloads") : remove(false))}
                >
                  <Trash2 />
                  Remove {count(missingIds.length)} from Library
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * How far in, and what it is looking at right now.
 *
 * The file name matters more than the bar: a check that sits on one name for
 * ten seconds is a slow file, not a hung app, and only the name says which.
 */
function Progress({
  live,
  found,
}: {
  live: Omit<SyncItem, "footageId" | "gone"> | null;
  found: number;
}) {
  const pct = live ? percent(live.done, live.total) : null;

  return (
    // Pinned: the list below it grows as broken files are found, and a progress
    // bar that scrolls away is a progress bar nobody can read.
    <div className="sticky top-0 z-10 flex flex-col gap-1.5 bg-surface pb-2">
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-border">
        <div
          className={`h-full rounded-full bg-foreground/60 ${
            pct == null ? "animate-pulse" : "transition-[width] duration-150 ease-linear"
          }`}
          style={{ width: pct == null ? "20%" : `${pct}%` }}
        />
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate text-[11.5px] text-subtle-foreground">
          {live?.name ?? "Starting…"}
        </p>
        <p className="tnum shrink-0 text-[11.5px] text-subtle-foreground">
          {live ? `${count(live.done)} / ${count(live.total)}` : ""}
          {found > 0 && ` · ${count(found)} gone`}
        </p>
      </div>
    </div>
  );
}
