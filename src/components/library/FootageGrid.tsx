import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Heart, ImageOff, Play, Star, TriangleAlert } from "lucide-react";
import { FootageCard } from "./FootageCard";
import { FootageContextMenu } from "./FootageContextMenu";
import { EmptyState } from "./EmptyState";
import { cn } from "@/lib/utils";
import { duration as fmtDuration, accessibilityLabel, date } from "@/lib/format";
import { useThumbnail, useVisible } from "@/hooks/use-thumbnail";
import { useSelectionHandlers } from "@/hooks/use-selection";
import { useUi } from "@/store/ui";
import type { FootageListItem } from "@/lib/types";

interface Props {
  items: FootageListItem[];
  total: number;
  loading: boolean;
  onAddFootage: () => void;
  onSetThumbnail: (id: number, dataUrl: string) => void;
}

const GAP = 10;
const PAD = 14;

export function FootageGrid({ items, total, loading, onAddFootage, onSetThumbnail }: Props) {
  const { selection, viewMode, gridSize, quickLookId, setQuickLookId, hasActiveFilters, search, lastAnchor, select } = useUi();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  const orderedIds = useMemo(() => items.map((i) => i.id), [items]);
  const { handleClick, handleContextMenu } = useSelectionHandlers(orderedIds);
  const [focusedId, setFocusedId] = useState<number | null>(null);

  const [dragBox, setDragBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const activeFocusId = (focusedId !== null && selection.includes(focusedId))
    ? focusedId
    : (selection.length > 0 ? (selection[selection.length - 1] ?? null) : null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (quickLookId !== null) return;
    if (orderedIds.length === 0) return;

    // Ctrl+A / Cmd+A selection
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      select(orderedIds, orderedIds[0] ?? null);
      return;
    }

    const isArrow = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key);
    if (!isArrow) return;

    e.preventDefault();

    const lastIndex = activeFocusId !== null ? orderedIds.indexOf(activeFocusId) : -1;
    let newIndex = 0;

    if (lastIndex === -1) {
      newIndex = 0;
    } else {
      switch (e.key) {
        case "ArrowLeft":
          newIndex = Math.max(0, lastIndex - 1);
          break;
        case "ArrowRight":
          newIndex = Math.min(orderedIds.length - 1, lastIndex + 1);
          break;
        case "ArrowUp":
          if (viewMode === "grid") {
            newIndex = Math.max(0, lastIndex - columns);
          } else {
            newIndex = Math.max(0, lastIndex - 1);
          }
          break;
        case "ArrowDown":
          if (viewMode === "grid") {
            newIndex = Math.min(orderedIds.length - 1, lastIndex + columns);
          } else {
            newIndex = Math.min(orderedIds.length - 1, lastIndex + 1);
          }
          break;
      }
    }

    const targetId = orderedIds[newIndex];
    if (targetId !== undefined) {
      setFocusedId(targetId);
      if (e.shiftKey && lastAnchor !== null) {
        const from = orderedIds.indexOf(lastAnchor);
        const to = newIndex;
        const [lo, hi] = from < to ? [from, to] : [to, from];
        const range = orderedIds.slice(lo, hi + 1);
        select(range, lastAnchor);
      } else {
        select([targetId], targetId);
      }

      const targetRowIndex = viewMode === "grid" ? Math.floor(newIndex / columns) : newIndex;
      virtualizer.scrollToIndex(targetRowIndex, { align: "auto" });
    }
  };

  const onCardClick = (id: number, e: React.MouseEvent) => {
    handleClick(id, e);
    scrollRef.current?.focus({ preventScroll: true });
  };

  const onCardContextMenu = (id: number) => {
    handleContextMenu(id);
    scrollRef.current?.focus({ preventScroll: true });
  };

  const handleMouseDown = (mouseDownEvent: React.MouseEvent) => {
    if (mouseDownEvent.button !== 0) return;

    const target = mouseDownEvent.target as HTMLElement;
    if (
      target.closest("button") ||
      target.closest("input") ||
      target.closest("textarea") ||
      target.closest("select") ||
      target.closest("a") ||
      target.closest("[role='menu']")
    ) {
      return;
    }

    const startX = mouseDownEvent.clientX;
    const startY = mouseDownEvent.clientY;
    const initialSelection = mouseDownEvent.metaKey || mouseDownEvent.ctrlKey || mouseDownEvent.shiftKey ? [...selection] : [];
    
    let isDragging = false;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      if (!isDragging && Math.sqrt(dx * dx + dy * dy) > 6) {
        isDragging = true;
      }

      if (isDragging) {
        moveEvent.preventDefault();
        const currentX = moveEvent.clientX;
        const currentY = moveEvent.clientY;

        const left = Math.min(startX, currentX);
        const top = Math.min(startY, currentY);
        const width = Math.abs(startX - currentX);
        const height = Math.abs(startY - currentY);

        setDragBox({ left, top, width, height });

        // Auto-scroll the container during dragging near boundaries
        if (scrollRef.current) {
          const containerRect = scrollRef.current.getBoundingClientRect();
          const scrollSpeed = 12;
          if (currentY < containerRect.top + 30) {
            scrollRef.current.scrollTop -= scrollSpeed;
          } else if (currentY > containerRect.bottom - 30) {
            scrollRef.current.scrollTop += scrollSpeed;
          }
        }

        const cardElements = document.querySelectorAll(".footage-card-item");
        const intersectedIds: number[] = [];

        cardElements.forEach((el) => {
          const cardRect = el.getBoundingClientRect();
          const intersects = !(
            cardRect.left > left + width ||
            cardRect.right < left ||
            cardRect.top > top + height ||
            cardRect.bottom < top
          );
          if (intersects) {
            const dataId = el.getAttribute("data-id");
            if (dataId) {
              intersectedIds.push(Number(dataId));
            }
          }
        });

        let newSelection = intersectedIds;
        if (mouseDownEvent.metaKey || mouseDownEvent.ctrlKey || mouseDownEvent.shiftKey) {
          newSelection = Array.from(new Set([...initialSelection, ...intersectedIds]));
        }
        
        select(newSelection, selection[selection.length - 1] ?? null);
      }
    };

    const onSelectStart = (e: Event) => {
      e.preventDefault();
    };

    const onMouseUp = () => {
      setDragBox(null);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("selectstart", onSelectStart);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("selectstart", onSelectStart);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const columns = Math.max(1, Math.floor((width - PAD * 2 + GAP) / (gridSize + GAP)));
  const cardWidth = columns > 0 ? (width - PAD * 2 - GAP * (columns - 1)) / columns : gridSize;
  // 4:3 thumbnail + two lines of metadata.
  const cardHeight = Math.round(cardWidth * 0.75) + 42;

  const rowCount = viewMode === "grid" ? Math.ceil(items.length / columns) : items.length;
  const rowHeight = viewMode === "grid" ? cardHeight + GAP : 30;

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 4,
  });

  // Row geometry changes with the window; the measurement cache has to follow.
  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, columns, virtualizer]);

  const isEmpty = !loading && items.length === 0;

  return (
    <FootageContextMenu items={items} onSetThumbnail={onSetThumbnail}>
      <div
        ref={scrollRef}
        onKeyDown={handleKeyDown}
        onMouseDown={handleMouseDown}
        className={cn(
          "relative h-full overflow-y-auto outline-none",
          dragBox && "select-none"
        )}
        role="listbox"
        aria-multiselectable
        aria-label="Footage"
        tabIndex={0}
      >
        {isEmpty ? (
          <EmptyState
            filtered={hasActiveFilters() || search.trim().length > 0 || total > 0}
            onAddFootage={onAddFootage}
          />
        ) : (
          <div
            style={{ height: virtualizer.getTotalSize() + PAD * 2, position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const style: React.CSSProperties = {
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${row.start + PAD}px)`,
              };

              if (viewMode === "list") {
                const item = items[row.index];
                if (!item) return null;
                return (
                  <div key={row.key} style={{ ...style, height: rowHeight }}>
                    <ListRow
                      item={item}
                      selected={selection.includes(item.id)}
                      onClick={(e) => onCardClick(item.id, e)}
                      onDoubleClick={() => setQuickLookId(item.id)}
                      onContextMenu={() => onCardContextMenu(item.id)}
                    />
                  </div>
                );
              }

              const start = row.index * columns;
              const rowItems = items.slice(start, start + columns);
              return (
                <div
                  key={row.key}
                  style={{
                    ...style,
                    height: cardHeight,
                    display: "grid",
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    gap: GAP,
                    paddingLeft: PAD,
                    paddingRight: PAD,
                  }}
                >
                  {rowItems.map((item) => (
                    <FootageCard
                      key={item.id}
                      item={item}
                      selected={selection.includes(item.id)}
                      onClick={(e) => onCardClick(item.id, e)}
                      onDoubleClick={() => setQuickLookId(item.id)}
                      onContextMenu={() => onCardContextMenu(item.id)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
        {dragBox && (
          <div
            style={{
              position: "fixed",
              left: dragBox.left,
              top: dragBox.top,
              width: dragBox.width,
              height: dragBox.height,
              backgroundColor: "color-mix(in srgb, var(--primary) 15%, transparent)",
              border: "1.5px solid color-mix(in srgb, var(--primary) 60%, transparent)",
              borderRadius: "4px",
              pointerEvents: "none",
              zIndex: 9999,
            }}
          />
        )}
      </div>
    </FootageContextMenu>
  );
}

// ── list row ────────────────────────────────────────────────────────────────

function ListRow({
  item,
  selected,
  onClick,
  onDoubleClick,
  onContextMenu,
}: {
  item: FootageListItem;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: () => void;
}) {
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
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={cn(
        "footage-card-item",
        "mx-2 flex h-[28px] cursor-default items-center gap-2.5 rounded px-2 text-[12.5px]",
        selected ? "bg-selection text-foreground" : "hover:bg-accent/60",
      )}
    >
      <div className="relative size-[20px] shrink-0 overflow-hidden rounded-sm bg-thumb-bg">
        {thumb.data ? (
          <img src={thumb.data} alt="" className="size-full object-cover" draggable={false} />
        ) : (
          <ImageOff className="absolute inset-0 m-auto size-2.5 text-subtle-foreground/50" />
        )}
        {item.mediaType === "video" && (
          <Play className="absolute inset-0 m-auto size-2 fill-white/90 text-white/90 drop-shadow" />
        )}
      </div>

      {item.favorite && <Heart className="size-3 shrink-0 fill-destructive text-destructive" />}
      {warning && <TriangleAlert className="size-3 shrink-0 text-warning" />}

      <span className="min-w-0 flex-1 truncate">{item.displayName}</span>

      {item.rating > 0 && (
        <span className="tnum flex shrink-0 items-center gap-px text-[11px] text-subtle-foreground">
          <Star className="size-2.5 fill-warning text-warning" />
          {item.rating}
        </span>
      )}

      <span className="w-14 shrink-0 truncate text-right text-[11px] text-subtle-foreground">
        {item.tags[0] ?? ""}
      </span>
      <span className="tnum w-12 shrink-0 text-right text-[11px] text-subtle-foreground">
        {fmtDuration(item.durationMs) ?? (item.width ? `${item.width}px` : "")}
      </span>
      <span
        className={cn(
          "w-14 shrink-0 text-right text-[11px] font-medium",
          used ? "text-used" : "text-subtle-foreground",
        )}
      >
        {used ? `Used ×${item.usageCount}` : "Unused"}
      </span>
      <span className="tnum w-20 shrink-0 text-right text-[11px] text-subtle-foreground">
        {date(item.dateAdded)}
      </span>
    </div>
  );
}
