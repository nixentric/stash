import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { asIpcError, ipc } from "@/lib/ipc";
import { bytes, count, percent } from "@/lib/format";
import { baseName } from "@/lib/utils";
import { runQueue } from "@/lib/queue";
import { keys } from "@/hooks/queries";
import type { DownloadProgress } from "@/lib/types";

/**
 * Fetch an original. The one path every download takes.
 *
 * What lives here is the part every caller was repeating: the invoke, and the
 * two caches that answer "where is this file?" — the scheme handler prefers a
 * downloaded copy, so re-asking for the playback target is what switches
 * previews over to it. Where the progress is *drawn* is the caller's business:
 * the preview has a stage for it, everything else gets `downloadOriginals`.
 */
export async function fetchOriginal(qc: QueryClient, id: number): Promise<string> {
  const path = await ipc.downloadOriginal(id);
  await qc.invalidateQueries({ queryKey: keys.playback(id) });
  qc.invalidateQueries({ queryKey: keys.downloaded });
  return path;
}

/**
 * Download a selection, one file after another, in one toast.
 *
 * A queue rather than a stampede: a dozen parallel fetches from the same Drive
 * account finish later than the same dozen in order, and one bar that says
 * "4 of 12" is readable in a way that twelve toasts are not. Nothing is skipped
 * client-side — a file already on this computer costs the backend one directory
 * read and no network, so the backend stays the only judge of what needs
 * fetching.
 *
 * Stop takes effect between files. The one in flight finishes, which is why
 * there is never a half-written file left behind (the backend writes to `.part`
 * and renames, so even a crash cannot leave one).
 */
export async function downloadOriginals(qc: QueryClient, ids: number[]): Promise<void> {
  if (ids.length === 0) return;

  let lastPath = "";
  const t = toast.loading("Starting the download…", { duration: Infinity });

  const { done, failures, stopped } = await runQueue(
    ids,
    async (id, i, stop) => {
      // One toast per file, not per chunk: the bar inside it follows the bytes
      // on its own.
      toast.loading(
        <DownloadBar
          id={id}
          label={ids.length === 1 ? "the original" : `file ${i + 1} of ${ids.length}`}
          onStop={ids.length > 1 ? stop : undefined}
        />,
        { id: t, duration: Infinity },
      );
      lastPath = await fetchOriginal(qc, id);
    },
    (e) => asIpcError(e).message || "The download failed",
  );

  // What actually happened, in one line — a count with no explanation of the
  // leftovers is a dead end (§23).
  const opts = { id: t, duration: 6000 };
  if (failures.length > 0) {
    toast.error(`Downloaded ${count(done)} of ${count(ids.length)}`, {
      ...opts,
      description: [...new Set(failures)].join(" · "),
    });
  } else if (stopped) {
    toast.info(`Stopped after ${count(done)} of ${count(ids.length)}`, opts);
  } else if (ids.length === 1) {
    toast.success(`Downloaded ${baseName(lastPath)}`, opts);
  } else {
    toast.success(`Downloaded ${count(done)} files`, opts);
  }
}

/**
 * The bytes as they land, for a download with no stage of its own.
 *
 * Subscribes for itself rather than being handed a number: a toast lives outside
 * the tree that started the download, and the backend is already announcing
 * every chunk to the whole window.
 */
export function DownloadBar({
  id,
  label,
  onStop,
}: {
  id: number;
  label: string;
  onStop?: () => void;
}) {
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    const unlisten = listen<DownloadProgress>("download:progress", (e) => {
      if (e.payload.id === id) setProgress(e.payload);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [id]);

  const received = progress?.received ?? 0;
  const total = progress?.total ?? null;
  const pct = percent(received, total);

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] text-foreground">Downloading {label}</span>
        {onStop && (
          <button
            type="button"
            disabled={stopping}
            onClick={() => {
              setStopping(true);
              onStop();
            }}
            className="ml-auto shrink-0 text-[11px] text-subtle-foreground underline
                       hover:text-foreground disabled:no-underline disabled:opacity-70"
          >
            {stopping ? "Stopping after this file" : "Stop"}
          </button>
        )}
      </div>
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-border">
        <div
          className={`h-full rounded-full bg-success ${
            pct == null ? "animate-pulse" : "transition-[width] duration-200"
          }`}
          style={{ width: pct == null ? "35%" : `${pct}%` }}
        />
      </div>
      <span className="tnum text-[11px] text-subtle-foreground">
        {pct == null
          ? (received ? bytes(received) : "Starting…")
          : `${pct}% · ${bytes(received)} of ${bytes(total)}`}
      </span>
    </div>
  );
}
