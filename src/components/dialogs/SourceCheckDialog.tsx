import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { DotmSquare3 } from "@/components/ui/dotm-square-3";
import { asIpcError, ipc } from "@/lib/ipc";
import { count } from "@/lib/format";
import { invalidateLibrary, reportError, toastUndo } from "@/hooks/queries";
import { emptyQuery, type SyncReport } from "@/lib/types";

/** What to check: an explicit selection, or everything under a folder. */
export type SourceCheckScope = {
  ids?: number[];
  containerPath?: string;
  /** What is being checked, in the words the menu used. */
  label: string;
};

/** The most names the dialog will pull for the list. Removal uses the ids. */
const NAME_LIMIT = 2000;

/**
 * Asks the source whether these files are still there, and offers to clear out
 * the ones that are not.
 *
 * The check itself is `sync_library` — the same authenticated `files.get` that
 * the Refresh button runs, which is the only evidence §23 accepts for calling a
 * file gone. Nothing here concludes anything from a failed thumbnail or from
 * Google's embed: a private file and a deleted one look identical from outside.
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

  // One run per opening. `scope` is a fresh object each time the menu sets it,
  // and null while the dialog is closed, so this never re-fires on its own.
  useEffect(() => {
    if (!scope) return;
    let dropped = false;
    setResult(null);
    setError(null);
    setStep("result");

    (async () => {
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
    };
  }, [scope, qc]);

  const missingIds = result?.missingIds ?? [];

  // Names for the list, and which of them already have a downloaded original.
  // Both are read once the check is in: the ids are the truth, these are the
  // words around them.
  const gone = useQuery({
    queryKey: ["sourceCheck", missingIds],
    enabled: missingIds.length > 0,
    queryFn: async () => {
      const [page, downloaded] = await Promise.all([
        ipc.listFootage({
          ...emptyQuery(),
          accessibility: ["source_missing"],
          containerPath: scope?.containerPath ?? null,
          limit: NAME_LIMIT,
        }),
        ipc.downloadedIds(),
      ]);
      const want = new Set(missingIds);
      const items = page.items.filter((f) => want.has(f.id));
      const onDisk = new Set(downloaded);
      return { items, withDownloads: missingIds.filter((id) => onDisk.has(id)) };
    },
  });

  const withDownloads = gone.data?.withDownloads ?? [];

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

  const checking = !!scope && !result && !error;

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
                ? `Asking Google Drive about ${scope?.label ?? "these files"}. Metadata only — nothing is downloaded.`
                : `${scope?.label ?? ""}`}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex max-h-[52vh] flex-col gap-3 overflow-y-auto">
          {checking && (
            <div className="flex flex-col items-center gap-3 py-8">
              <DotmSquare3 size={36} colorPreset="grad-ocean" ariaLabel="Checking sources" />
              <p className="text-[12.5px] text-subtle-foreground">Checking…</p>
            </div>
          )}

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
            <>
              <p className="text-[12.5px] text-muted-foreground">
                Checked {count(result.checked)} · {count(missingIds.length)} gone
                {result.cancelled && " · cancelled early"}
              </p>

              {missingIds.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <CircleCheck className="size-5 text-success" />
                  <p className="text-[13px] text-muted-foreground">
                    Every source is still there.
                  </p>
                </div>
              ) : (
                <ul className="flex flex-col rounded-md border border-border">
                  {(gone.data?.items ?? []).map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 last:border-b-0"
                    >
                      <Unplug className="size-3.5 shrink-0 text-subtle-foreground" />
                      <span className="truncate text-[12.5px]">{f.displayName}</span>
                      {withDownloads.includes(f.id) && (
                        <HardDriveDownload
                          className="ml-auto size-3.5 shrink-0 text-subtle-foreground"
                          aria-label="Downloaded to this computer"
                        />
                      )}
                    </li>
                  ))}
                  {(gone.data?.items.length ?? 0) < missingIds.length && (
                    <li className="px-2.5 py-1.5 text-[12px] text-subtle-foreground">
                      …and {count(missingIds.length - (gone.data?.items.length ?? 0))} more.
                    </li>
                  )}
                </ul>
              )}

              {missingIds.length > 0 && (
                <p className="text-[12px] leading-relaxed text-subtle-foreground">
                  Removing takes the records out of this library only. Tags, notes and usage
                  history go with them, and Undo puts all of it back.
                </p>
              )}
            </>
          )}

          {step === "downloads" && (
            <p className="text-[12px] leading-relaxed text-subtle-foreground">
              Kept files stay in the downloads folder under their own names — no longer tied
              to a record, so Undo will not bring them back as previews. Deleting them cannot
              be undone at all.
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
              {missingIds.length > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={removing || gone.isLoading}
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
