import { useCallback } from "react";
import { useUi } from "@/store/ui";

/**
 * Desktop selection semantics (§17).
 *
 *   click            → replace selection
 *   cmd/ctrl-click   → toggle one
 *   shift-click      → extend from the anchor, in *display order*
 *
 * Ordering comes from the currently-rendered ids, so shift-click follows what
 * the user can see rather than the database's idea of order.
 */
export function useSelectionHandlers(orderedIds: number[]) {
  const { selection, lastAnchor, select, toggleSelect } = useUi();

  const handleClick = useCallback(
    (id: number, e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => {
      if (e.shiftKey && lastAnchor != null) {
        const from = orderedIds.indexOf(lastAnchor);
        const to = orderedIds.indexOf(id);
        if (from !== -1 && to !== -1) {
          const [lo, hi] = from < to ? [from, to] : [to, from];
          const range = orderedIds.slice(lo, hi + 1);
          // Union with the existing selection so shift-click after a
          // cmd-click extends rather than discards.
          const merged = Array.from(new Set([...selection, ...range]));
          select(merged, lastAnchor);
          return;
        }
      }
      if (e.metaKey || e.ctrlKey) {
        toggleSelect(id);
        return;
      }
      select([id], id);
    },
    [orderedIds, selection, lastAnchor, select, toggleSelect],
  );

  /**
   * Right-clicking inside an existing multi-selection must keep it — otherwise
   * "right-click → Mark as Used" silently applies to one item instead of forty.
   */
  const handleContextMenu = useCallback(
    (id: number) => {
      if (!selection.includes(id)) select([id], id);
    },
    [selection, select],
  );

  return { handleClick, handleContextMenu };
}
