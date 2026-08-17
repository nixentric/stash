import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { QueryClient } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc";
import { bytes, percent } from "@/lib/format";
import { keys } from "@/hooks/queries";
import type { DownloadProgress } from "@/lib/types";

/**
 * Fetch an original. The one path every download takes.
 *
 * What lives here is the part every caller was repeating: the invoke, and the
 * two caches that answer "where is this file?" — the scheme handler prefers a
 * downloaded copy, so re-asking for the playback target is what switches
 * previews over to it. Where the progress is *drawn* is the caller's business:
 * the preview has a stage for it, everything else gets `downloadToast`.
 */
export async function fetchOriginal(qc: QueryClient, id: number): Promise<string> {
  const path = await ipc.downloadOriginal(id);
  await qc.invalidateQueries({ queryKey: keys.playback(id) });
  qc.invalidateQueries({ queryKey: keys.downloaded });
  return path;
}

/**
 * The bytes as they land, for a download with no stage of its own.
 *
 * Subscribes for itself rather than being handed a number: a toast lives outside
 * the tree that started the download, and the backend is already announcing
 * every chunk to the whole window.
 */
export function DownloadBar({ id, label }: { id: number; label: string }) {
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

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
      <span className="text-[13px] text-foreground">Downloading {label}</span>
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
