import { memo } from "react";
import { Heart, ImageOff, Link2, Play, Star, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { duration as fmtDuration, accessibilityLabel } from "@/lib/format";
import { useThumbnail, useVisible } from "@/hooks/use-thumbnail";
import type { FootageListItem } from "@/lib/types";

interface Props {
  item: FootageListItem;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDropImage: (dataUrl: string) => void;
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
  selected,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDropImage,
}: Props) {
  const { ref, visible } = useVisible<HTMLDivElement>();
  const thumb = useThumbnail(item.id, visible);
  const used = item.usageCount > 0;
  const warning = accessibilityLabel[item.accessibility];

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        const file = e.dataTransfer.files?.[0];
        if (!file || !file.type.startsWith("image/")) return;
        e.preventDefault();
        e.stopPropagation();
        const reader = new FileReader();
        reader.onload = () => onDropImage(String(reader.result));
        reader.readAsDataURL(file);
      }}
      className={cn(
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
        <div className="size-full animate-pulse bg-muted" />
      ) : (
        <div className="flex flex-col items-center gap-1 text-subtle-foreground/60">
          <ImageOff className="size-5" />
          <span className="text-[10px] uppercase tracking-wide">{mediaType}</span>
        </div>
      )}
    </div>
  );
}
