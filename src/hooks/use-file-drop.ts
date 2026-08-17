import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import { invalidateLibrary, keys, reportError } from "@/hooks/queries";
import { baseName, isImagePath, isMediaPath } from "@/lib/utils";
import type { NewFootage } from "@/lib/types";
import { useUi } from "@/store/ui";
import { thumbsChanged } from "@/lib/thumbs";

/** The footage card under the cursor, if the drop landed on one. */
function cardIdAt(x: number, y: number): number | null {
  const el = document
    .elementFromPoint(x / window.devicePixelRatio, y / window.devicePixelRatio)
    ?.closest<HTMLElement>("[role=option][data-id]");
  const id = Number(el?.dataset.id);
  return Number.isFinite(id) && el ? id : null;
}

/**
 * Files dropped on the window land in the library (§8).
 *
 * The listener is Tauri's, not the DOM's: with `dragDropEnabled` the webview
 * never sees the OS drop, so `ondrop` in a component would never fire. Paths
 * arrive instead of File objects, which is what the importer wants anyway —
 * Stash records where a file lives, it does not copy it.
 *
 * One image dropped onto a card keeps its older meaning: that card's thumbnail.
 */
export function useFileDrop(enabled: boolean) {
  const qc = useQueryClient();
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    setOver(false);

    async function importPaths(paths: string[], x: number, y: number) {
      const files = paths.filter(isMediaPath);

      const cardId = cardIdAt(x, y);
      const single = files.length === 1 ? files[0] : undefined;
      if (cardId != null && single && isImagePath(single)) {
        try {
          await ipc.setThumbnailFromPath(cardId, single);
          qc.invalidateQueries({ queryKey: keys.thumb(cardId, false) });
          thumbsChanged();
          qc.invalidateQueries({ queryKey: keys.thumb(cardId, true) });
          qc.invalidateQueries({ queryKey: keys.detail(cardId) });
          toast.success("Thumbnail set");
        } catch (e) {
          reportError(e, "Could not set that thumbnail");
        }
        return;
      }

      const skipped = paths.length - files.length;
      if (files.length === 0) {
        toast.error(
          skipped === 1
            ? "That is not a supported media file"
            : "No supported media files in what you dropped",
          { description: "Folders are not scanned yet — drop the files themselves." },
        );
        return;
      }

      const view = useUi.getState().view;
      const payload: NewFootage[] = files.map((p) => ({
        displayName: baseName(p),
        provider: "local",
        localPath: p,
        originalFilename: baseName(p),
        containerPath: p.split(/[\\/]/).slice(0, -1).pop() ?? null,
      }));

      try {
        const outcome = await ipc.importFootage(payload);
        if (outcome.imported.length && view.kind === "collection") {
          await ipc.addToCollection(view.id, outcome.imported);
        }
        invalidateLibrary(qc);

        const parts = [`Added ${outcome.imported.length}`];
        if (outcome.duplicates.length) parts.push(`${outcome.duplicates.length} already in library`);
        if (skipped) parts.push(`${skipped} skipped`);
        toast.success(parts.join(" · "));

        if (outcome.imported.length) ipc.fetchThumbnails(outcome.imported, false).catch(() => {});
      } catch (e) {
        reportError(e, "Import failed");
      }
    }

    const unlisten = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "enter") {
        setOver(true);
      } else if (e.payload.type === "leave") {
        setOver(false);
      } else if (e.payload.type === "drop") {
        setOver(false);
        void importPaths(e.payload.paths, e.payload.position.x, e.payload.position.y);
      }
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, [enabled, qc]);

  return over;
}
