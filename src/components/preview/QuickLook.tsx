import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FolderOpen,
  HardDriveDownload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dotm3x3_18 } from "@/components/ui/dotm-3x3-18";
import { DotmSquare15 } from "@/components/ui/dotm-square-15";
import { DotmSquare3 } from "@/components/ui/dotm-square-3";
import { Kbd, Tooltip } from "@/components/ui/misc";
import { asIpcError, ipc } from "@/lib/ipc";
import { keys, reportError, useFootageDetail, usePrefs } from "@/hooks/queries";
import { useThumbnail } from "@/hooks/use-thumbnail";
import {
  bytes,
  duration as fmtDuration,
  mediaLabel,
  providerLabel,
  resolution,
} from "@/lib/format";
import type { DownloadProgress } from "@/lib/types";
import { useUi } from "@/store/ui";

/**
 * Space-to-preview, arrows to move, Esc to close (§27).
 *
 * Navigation walks the ids currently on screen, so it follows the user's sort
 * and filter rather than the database's natural order.
 */
export function QuickLook({ orderedIds }: { orderedIds: number[] }) {
  const { quickLookId, setQuickLookId, select } = useUi();
  const detail = useFootageDetail(quickLookId);
  const thumb = useThumbnail(quickLookId ?? -1, quickLookId != null, true);
  const prefs = usePrefs();

  const target = useQuery({
    queryKey: keys.playback(quickLookId ?? -1),
    queryFn: () => ipc.playbackTarget(quickLookId as number),
    enabled: quickLookId != null,
  });

  const download = useDownload(quickLookId);
  const index = quickLookId != null ? orderedIds.indexOf(quickLookId) : -1;

  const t = target.data;
  const autoDownload = prefs.data?.autoDownload ?? false;

  // "Download automatically when opened" — the same call the button makes, so
  // there is one download path, not two.
  useEffect(() => {
    if (autoDownload && t?.downloadable && !download.busy && !download.error) {
      download.start();
    }
  }, [autoDownload, t?.downloadable, download.busy, download.error, download.start]);

  useEffect(() => {
    if (quickLookId == null) return;

    const step = (delta: number) => {
      const next = orderedIds[index + delta];
      if (next != null) {
        setQuickLookId(next);
        // Keep the grid selection in step, so closing the preview leaves the
        // user where they navigated to.
        select([next], next);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === " ") {
        e.preventDefault();
        setQuickLookId(null);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [quickLookId, index, orderedIds, setQuickLookId, select]);

  if (quickLookId == null) return null;
  const d = detail.data;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background/96 backdrop-blur-md
                 animate-in fade-in-0 duration-100"
      role="dialog"
      aria-modal="true"
      aria-label="Preview"
      onClick={(e) => e.target === e.currentTarget && setQuickLookId(null)}
    >
      <div className="drag-region flex h-11 shrink-0 items-center justify-end gap-1 px-2">
        <Button
          variant="ghost"
          size="icon"
          className="no-drag"
          aria-label="Close preview"
          onClick={() => setQuickLookId(null)}
        >
          <X />
        </Button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-4">
        <NavButton
          side="left"
          disabled={index <= 0}
          onClick={() => {
            const prev = orderedIds[index - 1];
            if (prev != null) {
              setQuickLookId(prev);
              select([prev], prev);
            }
          }}
        />

        <div className="flex h-full max-h-full min-h-0 w-full max-w-5xl items-center justify-center">
          {download.busy ? (
            <Downloading progress={download.progress} />
          ) : (
            <Stage
              id={quickLookId}
              kind={t?.kind}
              url={t?.url}
              poster={thumb.data ?? undefined}
              downloadable={t?.downloadable ?? false}
              onDownload={download.start}
              downloadError={download.error}
            />
          )}
        </div>

        <NavButton
          side="right"
          disabled={index < 0 || index >= orderedIds.length - 1}
          onClick={() => {
            const next = orderedIds[index + 1];
            if (next != null) {
              setQuickLookId(next);
              select([next], next);
            }
          }}
        />
      </div>

      {/* Info bar */}
      <div className="shrink-0 border-t border-border bg-surface/80 px-4 py-2.5">
        <div className="mx-auto flex max-w-5xl items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{d?.displayName ?? "…"}</p>
            <p className="truncate text-[11.5px] text-subtle-foreground">
              {[
                d && providerLabel[d.source.provider],
                d && mediaLabel[d.mediaType],
                d && resolution(d.source.width, d.source.height),
                d && fmtDuration(d.source.durationMs),
                d && bytes(d.source.fileSize),
                t?.downloaded ? "Downloaded" : null,
                d?.source.containerPath,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          {t?.downloadable && (
            <Button
              variant="secondary"
              size="sm"
              onClick={download.start}
              disabled={download.busy}
            >
              <Download />
              Download
            </Button>
          )}

          {t?.localPath && (
            <Tooltip content={t.localPath}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => ipc.revealInFileManager(t.localPath!).catch(reportError)}
              >
                <FolderOpen />
                Open Local
              </Button>
            </Tooltip>
          )}

          {t?.externalUrl && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => ipc.openExternal(t.externalUrl!).catch(reportError)}
            >
              <ExternalLink />
              Open Original
            </Button>
          )}

          <div className="hidden items-center gap-2 text-[11px] text-subtle-foreground sm:flex">
            <span className="flex items-center gap-1">
              <Kbd>←</Kbd>
              <Kbd>→</Kbd>
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Esc</Kbd>
              Close
            </span>
            {index >= 0 && (
              <span className="tnum">
                {index + 1} / {orderedIds.length}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Fetching the original, with the byte counts the backend reports.
 *
 * Lives here rather than in `queries.ts` because the progress is an event
 * stream, not a query — react-query has nothing to cache until it finishes.
 */
function useDownload(id: number | null) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setProgress(null);
    setError(null);
    setBusy(false);
  }, [id]);

  useEffect(() => {
    const unlisten = listen<DownloadProgress>("download:progress", (e) => {
      if (e.payload.id === id) setProgress(e.payload);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [id]);

  const start = useCallback(async () => {
    if (id == null) return;
    setError(null);
    setBusy(true);
    setProgress({ id, received: 0, total: null });
    try {
      const path = await ipc.downloadOriginal(id);
      // The scheme handler prefers the downloaded file, so re-asking for the
      // playback target is all it takes to switch the preview over to it.
      await qc.invalidateQueries({ queryKey: keys.playback(id) });
      toast.success(`Downloaded ${path.split(/[/\\]/).pop()}`);
    } catch (e) {
      // Toast as well as inline: the embed fills the stage, so an inline-only
      // message would leave a failed download looking like nothing happened.
      setError(asIpcError(e).message || "The download failed");
      reportError(e, "The download failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [id, qc]);

  return { start, progress, busy, error };
}

/**
 * Renders whatever the backend said is possible.
 *
 * Note what is absent: no Drive URL construction, no "is the account
 * connected?" check. The component receives a `kind` and renders it.
 */
function Stage({
  id,
  kind,
  url,
  poster,
  downloadable,
  onDownload,
  downloadError,
}: {
  id: number;
  kind: string | undefined;
  url: string | null | undefined;
  poster?: string;
  downloadable: boolean;
  onDownload: () => void;
  downloadError: string | null;
}) {
  if (!kind || !url) {
    return (
      <Unavailable
        id={id}
        downloadable={downloadable}
        onDownload={onDownload}
        downloadError={downloadError}
      />
    );
  }

  if (kind === "image") {
    return (
      <ImageStage
        id={id}
        url={url}
        downloadable={downloadable}
        onDownload={onDownload}
        downloadError={downloadError}
      />
    );
  }

  if (kind === "embed") {
    // Google's own embed. Sandboxed: the page is third-party and must not be
    // able to script the app (ARCHITECTURE.md §8).
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2">
        <iframe
          src={url}
          title="Preview"
          sandbox="allow-scripts allow-same-origin allow-presentation"
          referrerPolicy="no-referrer"
          allow="autoplay; fullscreen"
          className="h-full max-h-[70vh] w-full rounded-md border border-border bg-black"
        />
        {downloadError ? (
          <p className="text-[11.5px] text-destructive">{downloadError}</p>
        ) : (
          downloadable && (
            <p className="text-[11.5px] text-subtle-foreground">
              Shown by Google Drive. Download it for the full-quality file, kept offline.
            </p>
          )
        )}
      </div>
    );
  }

  if (kind === "stream") {
    return (
      <video
        src={url}
        poster={poster}
        controls
        autoPlay
        playsInline
        className="max-h-full max-w-full rounded-md bg-black"
      />
    );
  }

  // Anything unrecognized falls back to the thumbnail rather than a player:
  // handing a still to <video> is what made images render as a black box.
  return poster ? (
    <img src={poster} alt="" className="max-h-full max-w-full object-contain" />
  ) : null;
}

/**
 * A still served through `stash://` arrives whole before a single byte reaches
 * the webview, so a big photo is a blank screen for as long as it takes. Show
 * the wait instead of hiding it — and, when it fails, say why.
 */
function ImageStage({
  id,
  url,
  downloadable,
  onDownload,
  downloadError,
}: {
  id: number;
  url: string;
  downloadable: boolean;
  onDownload: () => void;
  downloadError: string | null;
}) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => setState("loading"), [url]);

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <img
        key={url}
        src={url}
        alt=""
        className={`max-h-full max-w-full object-contain ${state === "ok" ? "" : "invisible"}`}
        onLoad={() => setState("ok")}
        onError={() => setState("error")}
      />
      {state === "loading" && <Loading />}
      {state === "error" && (
        <Unavailable
          id={id}
          downloadable={downloadable}
          onDownload={onDownload}
          downloadError={downloadError}
        />
      )}
    </div>
  );
}

function Loading() {
  const [ms, setMs] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setMs(Date.now() - started), 100);
    return () => clearInterval(t);
  }, []);

  // ponytail: the backend buffers the whole file, so there is no byte count to
  // report — the bar eases toward 95% on elapsed time. Wire it to real bytes
  // only if the scheme handler ever streams.
  const pct = 95 * (1 - Math.exp(-ms / 6000));

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
      <DotmSquare3 size={40} colorPreset="grad-ocean" ariaLabel="Loading preview" />
      <div className="h-[3px] w-44 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-foreground/60 transition-[width] duration-100 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="tnum text-[11.5px] text-subtle-foreground">
        Loading full image · {(ms / 1000).toFixed(1)}s
      </p>
    </div>
  );
}

/** The download itself, with the byte counts the backend actually reports. */
function Downloading({ progress }: { progress: DownloadProgress | null }) {
  const received = progress?.received ?? 0;
  const total = progress?.total ?? null;
  const pct = total ? Math.min(100, (received / total) * 100) : null;

  return (
    <div className="flex flex-col items-center gap-3">
      <DotmSquare15 size={44} colorPreset="grad-neon" ariaLabel="Downloading" />
      <div className="h-[3px] w-56 overflow-hidden rounded-full bg-border">
        <div
          className={`h-full rounded-full bg-success ${pct == null ? "animate-pulse" : "transition-[width] duration-200"}`}
          style={{ width: pct == null ? "35%" : `${pct}%` }}
        />
      </div>
      <p className="tnum text-[11.5px] text-subtle-foreground">
        {pct == null
          ? `Downloading · ${bytes(received)}`
          : `Downloading · ${pct.toFixed(0)}% · ${bytes(received)} of ${bytes(total)}`}
      </p>
    </div>
  );
}

/**
 * Failure, with the reason spelled out.
 *
 * The `<img>` element reports only that something broke, so the backend is
 * asked why — "the account has no access to this file" is actionable in a way
 * that "Preview unavailable" never was.
 */
function Unavailable({
  id,
  downloadable,
  onDownload,
  downloadError,
}: {
  id: number;
  downloadable: boolean;
  onDownload: () => void;
  downloadError: string | null;
}) {
  const reason = useQuery({
    queryKey: ["previewFailure", id],
    queryFn: () => ipc.previewFailure(id),
    enabled: downloadError == null,
    staleTime: 30_000,
  });

  return (
    <div className="flex max-w-md flex-col items-center gap-3 text-center">
      <Dotm3x3_18 size={40} colorPreset="grad-fire" ariaLabel="Preview failed" />
      <p className="text-[13px] font-medium text-muted-foreground">
        {downloadError ? "The download failed" : "This preview could not be shown"}
      </p>
      <p className="text-[12px] leading-relaxed text-subtle-foreground">
        {downloadError ?? reason.data ?? "Checking why…"}
      </p>
      {downloadable && (
        <Button size="sm" variant="secondary" onClick={onDownload}>
          <HardDriveDownload />
          {downloadError ? "Try again" : "Download the file"}
        </Button>
      )}
    </div>
  );
}

function NavButton({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={disabled}
      onClick={onClick}
      aria-label={side === "left" ? "Previous" : "Next"}
      className={`absolute ${side === "left" ? "left-3" : "right-3"} top-1/2 size-9 -translate-y-1/2`}
    >
      {side === "left" ? <ChevronLeft /> : <ChevronRight />}
    </Button>
  );
}
