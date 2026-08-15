import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ipc } from "@/lib/ipc";
import { count } from "@/lib/format";
import type { JobProgress } from "@/lib/types";

const PHASE_LABEL: Record<string, string> = {
  scanning: "Scanning Google Drive",
  importing: "Importing",
  thumbnails: "Fetching previews",
  syncing: "Syncing metadata",
};

/**
 * Non-blocking progress for background work (§44).
 *
 * A strip rather than a modal on purpose: a 1,200-file scan must not stop the
 * user from browsing what is already in the library.
 */
export function JobBanner({ job }: { job: JobProgress }) {
  const pct =
    job.total && job.total > 0 ? Math.round((job.done / job.total) * 100) : null;

  return (
    <div className="relative flex h-7 shrink-0 items-center gap-2 bg-muted/70 px-3 hairline-b">
      <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
      <span className="text-[12px] font-medium">
        {PHASE_LABEL[job.phase] ?? "Working"}
      </span>
      <span className="tnum text-[11.5px] text-muted-foreground">
        {job.total != null
          ? `${count(job.done)} / ${count(job.total)}`
          : count(job.done)}
      </span>
      {job.message && (
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-subtle-foreground">
          {job.message}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        className="ml-auto"
        aria-label="Cancel"
        onClick={() => ipc.cancelJob(job.jobId)}
      >
        <X />
      </Button>
      {pct != null && (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-primary transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  );
}
