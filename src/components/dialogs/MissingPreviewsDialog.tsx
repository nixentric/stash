import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, RefreshCw } from "lucide-react";
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
import { useFootage } from "@/hooks/queries";
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
    todo: "Nothing is wrong with these files — the network was. Refresh again when you are back online.",
  },
  {
    key: "noPreview",
    title: "No preview could be made",
    todo:
      "The source answered but nothing displayable came back — usually a RAW, PSD or other format " +
      "no preview exists for. Open the file and set a thumbnail by hand from the Inspector.",
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
  const items = missing.data?.items ?? [];
  const groups = BUCKETS.map((b) => ({
    ...b,
    items: items.filter((f) => bucketOf(f.accessibility) === b.key),
  })).filter((g) => g.items.length > 0);

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
                  <FileRow key={f.id} footage={f} />
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
function FileRow({ footage }: { footage: FootageListItem }) {
  const [open, setOpen] = useState(false);
  const reason = useQuery({
    queryKey: ["previewFailure", footage.id],
    queryFn: () => ipc.previewFailure(footage.id),
    enabled: open,
    staleTime: 30_000,
  });

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-accent"
      >
        <ChevronRight
          className={cn("size-3 shrink-0 text-subtle-foreground transition-transform", open && "rotate-90")}
        />
        <span className="min-w-0 flex-1 truncate text-[12.5px]">{footage.displayName}</span>
        <span className="shrink-0 text-[11px] text-subtle-foreground">
          {providerLabel[footage.provider] ?? footage.provider}
        </span>
      </button>
      {open && (
        <p className="px-2 pb-2 pl-6 text-[11.5px] leading-relaxed text-muted-foreground">
          {reason.isError ? "The reason could not be checked." : (reason.data ?? "Checking why…")}
        </p>
      )}
    </li>
  );
}
