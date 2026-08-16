import { memo } from "react";
import { HardDriveDownload, Heart, ImageOff, Link2, Play, Star, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { DotmSquare3 } from "@/components/ui/dotm-square-3";
import { duration as fmtDuration, accessibilityLabel } from "@/lib/format";
import { useThumbnail, useVisible } from "@/hooks/use-thumbnail";
import type { FootageListItem } from "@/lib/types";

interface Props {
  item: FootageListItem;
  /** The original is on this machine. One directory read answers the whole grid. */
  downloaded: boolean;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

/**
 * One footage card.
 *
 * Shows only what is scannable at a glance (§12): picture, name, duration,
 * usage state. Everything else lives in the Inspector — a card that lists ten
 * metadata fields is a card nobody can scan.
 */
export const FootageCard = memo(function FootageCard({
  item,
  downloaded,
  selected,
  onClick,
  onDoubleClick,
  onContextMenu,
}: Props) {
  const { ref, visible } = useVisible<HTMLDivElement>();
  const thumb = useThumbnail(item.id, visible);
  const used = item.usageCount > 0;
  const warning = accessibilityLabel[item.accessibility];

  return (
    <div
      ref={ref}
      role="option"
      data-id={item.id}
      aria-selected={selected}
      tabIndex={-1}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={cn(
        "footage-card-item",
        "group relative flex cursor-default flex-col overflow-hidden rounded-md border",
        "outline-none transition-[border-color,background-color] duration-100",
        selected
          ? "border-primary/70 bg-selection"
          : "border-border bg-surface hover:border-border-strong",
      )}
    >
      {/* Thumbnail */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-thumb-bg">
        {thumb.data ? (
          <img
            src={thumb.data}
            alt=""
            loading="lazy"
            draggable={false}
            className="size-full object-cover"
          />
        ) : (
          <Placeholder loading={visible && thumb.isLoading} mediaType={item.mediaType} />
        )}

        {item.mediaType === "video" && (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center
                       opacity-0 transition-opacity group-hover:opacity-100"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
              <Play className="size-3.5 fill-white text-white" />
            </span>
          </div>
        )}

        {item.durationMs != null && (
          <span
            className="tnum pointer-events-none absolute bottom-1 right-1 rounded bg-black/65
                       px-1 py-px text-[10px] font-medium text-white backdrop-blur-sm"
          >
            {fmtDuration(item.durationMs)}
          </span>
        )}

        {item.favorite && (
          <span className="pointer-events-none absolute left-1 top-1">
            <Heart className="size-3.5 fill-destructive text-destructive drop-shadow" />
          </span>
        )}

        {/* Bottom-left: the one corner the heart, the warning and the duration
            do not use, so nothing has to move to make room for it. */}
        {downloaded && (
          <span
            className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/55 p-0.5 backdrop-blur-sm"
            title="Downloaded to this computer"
          >
            <HardDriveDownload className="size-3 text-success" />
          </span>
        )}

        {warning && (
          <span
            className="pointer-events-none absolute right-1 top-1 rounded bg-black/55 p-0.5 backdrop-blur-sm"
            title={warning.label}
          >
            <TriangleAlert className="size-3 text-warning" />
          </span>
        )}

        {/* Usage state: a hairline, not a badge. Visible when scanning a wall of
            cards, silent when you are not looking for it. */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 h-[2px]",
            used ? "bg-used" : "bg-transparent",
          )}
        />
      </div>

      {/* Meta */}
      <div className="flex min-w-0 flex-col gap-0.5 px-1.5 py-1.5">
        <div className="flex min-w-0 items-center gap-1">
          {item.provider === "url" && (
            <Link2 className="size-3 shrink-0 text-subtle-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-tight">
            {item.displayName}
          </span>
        </div>

        <div className="flex h-3.5 items-center gap-1.5">
          <span
            className={cn(
              "text-[10.5px] font-medium leading-none",
              used ? "text-used" : "text-subtle-foreground",
            )}
          >
            {used ? (item.usageCount > 1 ? `Used ×${item.usageCount}` : "Used") : "Unused"}
          </span>

          {item.rating > 0 && (
            <span className="tnum flex items-center gap-px text-[10.5px] text-subtle-foreground">
              <Star className="size-2.5 fill-warning text-warning" />
              {item.rating}
            </span>
          )}

          {item.tags.length > 0 && (
            <span className="ml-auto min-w-0 truncate text-[10.5px] text-subtle-foreground">
              {item.tags.slice(0, 2).join(" · ")}
              {item.tags.length > 2 && ` +${item.tags.length - 2}`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

function Placeholder({ loading, mediaType }: { loading: boolean; mediaType: string }) {
  return (
    <div className="flex size-full items-center justify-center">
      {loading ? (
        <DotmSquare3 colorPreset="grad-ocean" ariaLabel="Generating preview" />
      ) : (
        <div className="flex flex-col items-center gap-1 text-subtle-foreground/60">
          <ImageOff className="size-5" />
          <span className="text-[10px] uppercase tracking-wide">{mediaType}</span>
        </div>
      )}
    </div>
  );
}
