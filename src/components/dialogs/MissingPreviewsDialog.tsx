import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/misc";
import { ipc } from "@/lib/ipc";
import { count, providerLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useFootage, useFootageAction } from "@/hooks/queries";
import { emptyQuery, type Accessibility, type FootageListItem } from "@/lib/types";

/**
 * What is left after a refresh, named file by file.
 *
 * "12 still missing" tells the owner nothing they can act on. The backend
 * already records *why* each attempt failed — as `accessibility` for the
 * bucket, and as `preview_failure` for the exact sentence — so this dialog
 * only has to group and say it out loud (§23).
 */
const MISSING = { ...emptyQuery(), missingThumbnail: true, sort: "nameAsc" as const, limit: 500 };

type Bucket = "gone" | "noAccess" | "notConnected" | "offline" | "noPreview";

const BUCKETS: { key: Bucket; title: string; todo: string }[] = [
  {
    key: "gone",
    title: "Gone from the source",
    todo:
      "The file was deleted or moved to the trash. Restore it at the source and refresh again, " +
      "or remove the record here — tags, notes and usage history are only lost when you do.",
  },
  {
    key: "noAccess",
    title: "No access",
    todo:
      "The file is there, but the connected account cannot open it. Ask the owner to share it " +
      "with that account, or connect the account that owns it.",
  },
  {
    key: "notConnected",
    title: "Needs a connected account",
    todo:
      "Only files shared as \"Anyone with the link\" can be previewed without a connection. " +
      "Connect Google Drive in Settings, then refresh again.",
  },
  {
    key: "offline",
    title: "Could not be reached",
    todo:
      "Nothing is wrong with these files — the network was, or the volume they live on was not " +
      "mounted. Refresh again once you are back online, or the drive is plugged in.",
  },
  {
    key: "noPreview",
    title: "No preview could be made",
    todo:
      "The source answered and the file is still there — nothing displayable came back. Usually a " +
      "RAW, PSD or other format no preview exists for, or a video on a machine without ffmpeg. " +
      "Open the file and set a thumbnail by hand from the Inspector.",
  },
];

function bucketOf(a: Accessibility): Bucket {
  switch (a) {
    case "source_missing":
      return "gone";
    case "permission_required":
      return "noAccess";
    case "authentication_required":
      return "notConnected";
    case "offline":
      return "offline";
    default:
      return "noPreview";
  }
}

export function MissingPreviewsDialog({
  open,
  onClose,
  onRetry,
}: {
  open: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  const missing = useFootage(MISSING, open);
  const action = useFootageAction();
  const items = missing.data?.items ?? [];
  const groups = BUCKETS.map((b) => ({
    ...b,
    items: items.filter((f) => bucketOf(f.accessibility) === b.key),
  })).filter((g) => g.items.length > 0);

  // The list refreshes itself: the mutation invalidates the library, and this
  // query is part of it.
  const remove = (ids: number[]) =>
    action.mutate(
      { type: "remove", ids },
      {
        onSuccess: () =>
          toast.success(
            `Removed ${ids.length === 1 ? "1 file" : `${count(ids.length)} files`} from the library. ` +
              "Original files were not touched.",
          ),
      },
    );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(36rem,92vw)]">
        <DialogHeader>
          <DialogTitle>Still without a preview</DialogTitle>
          <DialogDescription>
            {missing.isLoading
              ? "Checking…"
              : `${count(items.length)} ${items.length === 1 ? "file" : "files"} came back empty. ` +
                "Nothing was removed from the library — here is why each one failed."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {!missing.isLoading && groups.length === 0 && (
            <p className="py-6 text-center text-[13px] text-muted-foreground">
              Every file has a preview now.
            </p>
          )}

          {groups.map((g) => (
            <section key={g.key} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <h3 className="text-[12.5px] font-semibold">{g.title}</h3>
                <Badge tone={g.key === "noPreview" ? "default" : "warn"}>{g.items.length}</Badge>
              </div>
              <p className="text-[12px] leading-relaxed text-subtle-foreground">{g.todo}</p>
              <ul className="flex flex-col rounded-md border border-border">
                {g.items.map((f) => (
                  <FileRow key={f.id} footage={f} onRemove={() => remove([f.id])} />
                ))}
              </ul>
            </section>
          ))}

          {(missing.data?.total ?? 0) > items.length && (
            <p className="text-[12px] text-subtle-foreground">
              Showing the first {count(items.length)} of {count(missing.data!.total)}.
            </p>
          )}
        </DialogBody>

        <DialogFooter>
          {items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto text-destructive hover:text-destructive"
              onClick={() => {
                // Removing everything listed is not something to do by accident,
                // and it is the one action here that cannot be undone by
                // refreshing again.
                if (confirm(`Remove ${count(items.length)} files from the library? The original files are not touched.`))
                  remove(items.map((f) => f.id));
              }}
            >
              <Trash2 />
              Remove all {count(items.length)}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" onClick={onRetry} disabled={items.length === 0}>
            <RefreshCw />
            Try again
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One file, with the exact reason a click away.
 *
 * The probe behind `preview_failure` re-runs the request, so it is asked for
 * per file and only when the row is opened — a hundred rows must not mean a
 * hundred round trips nobody reads.
 */
function FileRow({ footage, onRemove }: { footage: FootageListItem; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const reason = useQuery({
    queryKey: ["previewFailure", footage.id],
    queryFn: () => ipc.previewFailure(footage.id),
    enabled: open,
    staleTime: 30_000,
  });

  return (
    <li className="border-b border-border last:border-b-0">
      <div className="group/row flex items-center gap-1.5 px-2 py-1.5 hover:bg-accent">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronRight
            className={cn("size-3 shrink-0 text-subtle-foreground transition-transform", open && "rotate-90")}
          />
          <span className="min-w-0 flex-1 truncate text-[12.5px]">{footage.displayName}</span>
          <span className="shrink-0 text-[11px] text-subtle-foreground">
            {providerLabel[footage.provider] ?? footage.provider}
          </span>
        </button>
        <button
          type="button"
          aria-label={`Remove ${footage.displayName} from the library`}
          title="Remove from the library. The original file is not touched."
          onClick={onRemove}
          className="shrink-0 rounded p-0.5 text-subtle-foreground opacity-0 transition-opacity
                     hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100
                     group-hover/row:opacity-100"
        >
          <Trash2 className="size-3" />
        </button>
      </div>
      {open && (
        <p className="px-2 pb-2 pl-6 text-[11.5px] leading-relaxed text-muted-foreground">
          {reason.isError ? "The reason could not be checked." : (reason.data ?? "Checking why…")}
        </p>
      )}
    </li>
  );
}
