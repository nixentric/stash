import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ExternalLink, ImageOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/misc";
import { ipc } from "@/lib/ipc";
import { keys, reportError, useFootageDetail } from "@/hooks/queries";
import { useThumbnail } from "@/hooks/use-thumbnail";
import {
  bytes,
  duration as fmtDuration,
  mediaLabel,
  providerLabel,
  resolution,
} from "@/lib/format";
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

  const target = useQuery({
    queryKey: keys.playback(quickLookId ?? -1),
    queryFn: () => ipc.playbackTarget(quickLookId as number),
    enabled: quickLookId != null,
  });

  const index = quickLookId != null ? orderedIds.indexOf(quickLookId) : -1;

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
  const t = target.data;

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
          <Stage kind={t?.kind} url={t?.url} poster={thumb.data ?? undefined} />
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
                d?.source.containerPath,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

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
 * Renders whatever the backend said is possible.
 *
 * Note what is absent: no Drive URL construction, no "is the account
 * connected?" check. The component receives a `kind` and renders it.
 */
function Stage({
  kind,
  url,
  poster,
}: {
  kind: string | undefined;
  url: string | null | undefined;
  poster?: string;
}) {
  if (!kind || !url) {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <ImageOff className="size-7 text-subtle-foreground/60" />
        <p className="text-[13px] text-muted-foreground">Preview unavailable</p>
        <p className="max-w-sm text-[12px] text-subtle-foreground">
          Connect Google Drive, or set a thumbnail manually from the Inspector.
        </p>
      </div>
    );
  }

  if (kind === "image") {
    // RAW and PSD are stills the webview cannot decode; the thumbnail is the
    // only thing left to show for them.
    return (
      <img
        src={url}
        alt=""
        className="max-h-full max-w-full object-contain"
        onError={(e) => {
          const img = e.currentTarget;
          if (poster && img.src !== poster) img.src = poster;
        }}
      />
    );
  }

  if (kind === "embed") {
    // Google's own embed. Sandboxed: the page is third-party and must not be
    // able to script the app (ARCHITECTURE.md §8).
    return (
      <iframe
        src={url}
        title="Preview"
        sandbox="allow-scripts allow-same-origin allow-presentation"
        referrerPolicy="no-referrer"
        allow="autoplay; fullscreen"
        className="h-full max-h-[70vh] w-full rounded-md border border-border bg-black"
      />
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
