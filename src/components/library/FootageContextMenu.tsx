import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  CircleCheck,
  CircleSlash,
  Copy,
  ExternalLink,
  Eye,
  FolderInput,
  HardDriveDownload,
  Hash,
  Heart,
  Image,
  Trash2,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  MenuShortcut,
} from "@/components/ui/menu";
import { ipc } from "@/lib/ipc";
import { keys, reportError, useCollections, useFootageAction, useProjects } from "@/hooks/queries";
import { useUi } from "@/store/ui";
import { MarkUsedDialog } from "@/components/dialogs/MarkUsedDialog";
import { TagPromptDialog } from "@/components/dialogs/TagPromptDialog";
import { cn } from "@/lib/utils";
import type { FootageListItem } from "@/lib/types";

/**
 * Right-click menu for the grid.
 *
 * Wraps the whole surface rather than each card: cards set the selection on
 * right-click, and every action here operates on the selection. That is what
 * makes "right-click → Mark as Used" apply to all forty selected clips instead
 * of just the one under the cursor.
 */
export function FootageContextMenu({
  children,
  items,
  onSetThumbnail,
}: {
  children: React.ReactNode;
  items: FootageListItem[];
  onSetThumbnail: (id: number, dataUrl: string) => void;
}) {
  const { selection, setQuickLookId } = useUi();
  const qc = useQueryClient();
  const action = useFootageAction();
  const collections = useCollections(true);
  const projects = useProjects(true);
  const [markUsedOpen, setMarkUsedOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [open, setOpen] = useState(false);

  const ids = selection;
  const single = ids.length === 1 ? ids[0] : null;
  const many = ids.length > 1;

  // Only the backend knows whether Download can do anything — it is false for
  // local files and for anything already on disk. Asked when the menu opens,
  // not on every selection change, and it shares QuickLook's cache entry.
  const target = useQuery({
    queryKey: keys.playback(single ?? -1),
    queryFn: () => ipc.playbackTarget(single as number),
    enabled: open && single != null,
  });

  const selectedItems = items.filter((item) => ids.includes(item.id));
  const anyUnfavorited = selectedItems.length === 0 || selectedItems.some((item) => !item.favorite);
  const anyUnused = selectedItems.length === 0 || selectedItems.some((item) => !item.usageCount);

  async function copyLink() {
    if (single == null) return;
    try {
      const detail = await ipc.getFootage(single);
      const url = detail.source.originalUrl;
      if (!url) {
        toast.error("This footage has no link to copy");
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch (e) {
      reportError(e);
    }
  }

  async function openSource() {
    if (single == null) return;
    try {
      const detail = await ipc.getFootage(single);
      const target = await ipc.playbackTarget(single);
      const url = target.externalUrl ?? detail.source.originalUrl;
      if (url) await ipc.openExternal(url);
      else if (detail.source.localPath)
        await ipc.revealInFileManager(detail.source.localPath);
      else toast.error("Nothing to open for this footage");
    } catch (e) {
      reportError(e);
    }
  }

  async function downloadOriginal() {
    if (single == null) return;
    const id = single;
    const t = toast.loading("Downloading the original…");
    try {
      const path = await ipc.downloadOriginal(id);
      // The scheme handler prefers the downloaded file, so re-asking for the
      // playback target is what switches previews over to it.
      qc.invalidateQueries({ queryKey: keys.playback(id) });
      qc.invalidateQueries({ queryKey: keys.downloaded });
      toast.success(`Downloaded ${path.split(/[/\\]/).pop()}`, { id: t });
    } catch (e) {
      toast.dismiss(t);
      reportError(e, "The download failed");
    }
  }

  async function chooseThumbnail() {
    if (single == null) return;
    const picked = await openFileDialog({
      title: "Choose thumbnail image",
      multiple: false,
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp"] }],
    });
    if (!picked || Array.isArray(picked)) return;
    try {
      await ipc.setThumbnailFromPath(single, picked);
      onSetThumbnail(single, "");
      toast.success("Thumbnail set");
    } catch (e) {
      reportError(e);
    }
  }

  const label = many ? `${ids.length} items` : "footage";

  return (
    <>
      <ContextMenu onOpenChange={setOpen}>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent>
          {ids.length === 0 ? (
            <ContextMenuLabel>Select footage first</ContextMenuLabel>
          ) : (
            <>
              {single != null && (
                <>
                  <ContextMenuItem onSelect={() => setQuickLookId(single)}>
                    <Eye />
                    Preview
                    <MenuShortcut>Space</MenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                </>
              )}

              {/* One entry that flips, the way Favorite already does: anything
                  still unused offers Used, and a selection that is all used
                  offers the way back. */}
              <ContextMenuItem
                onSelect={() =>
                  anyUnused ? setMarkUsedOpen(true) : action.mutate({ type: "markUnused", ids })
                }
              >
                {anyUnused ? <CircleCheck /> : <CircleSlash />}
                {anyUnused ? "Mark as Used…" : "Mark as Unused"}
                <MenuShortcut>U</MenuShortcut>
              </ContextMenuItem>

              <ContextMenuSeparator />

              <ContextMenuItem
                onSelect={() =>
                  action.mutate({ type: "patch", ids, patch: { favorite: anyUnfavorited } })
                }
              >
                <Heart className={cn(!anyUnfavorited && "fill-destructive text-destructive")} />
                {anyUnfavorited ? "Favorite" : "Remove Favorite"}
                <MenuShortcut>F</MenuShortcut>
              </ContextMenuItem>

              <ContextMenuItem onSelect={() => setTagOpen(true)}>
                <Hash />
                Add Tag…
              </ContextMenuItem>

              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <FolderInput />
                  Add to Collection
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {collections.data?.length ? (
                    collections.data.map((c) => (
                      <ContextMenuItem
                        key={c.id}
                        onSelect={() =>
                          action.mutate({
                            type: "addToCollection",
                            collectionId: c.id,
                            ids,
                          })
                        }
                      >
                        {c.name}
                      </ContextMenuItem>
                    ))
                  ) : (
                    <ContextMenuLabel>No collections yet</ContextMenuLabel>
                  )}
                </ContextMenuSubContent>
              </ContextMenuSub>

              {single != null && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={copyLink}>
                    <Copy />
                    Copy Link
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={openSource}>
                    <ExternalLink />
                    Open Original
                  </ContextMenuItem>
                  {target.data?.downloadable && (
                    <ContextMenuItem onSelect={downloadOriginal}>
                      <HardDriveDownload />
                      Download Original
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem onSelect={chooseThumbnail}>
                    <Image />
                    Set Thumbnail…
                  </ContextMenuItem>
                </>
              )}

              <ContextMenuSeparator />
              <ContextMenuItem
                destructive
                onSelect={() => {
                  action.mutate(
                    { type: "remove", ids },
                    {
                      onSuccess: () =>
                        // Wording matters: this is a catalog, and nothing in it
                        // can delete a file from Drive or from disk.
                        toast.success(
                          `Removed ${label} from the library. Original files were not touched.`,
                        ),
                    },
                  );
                }}
              >
                <Trash2 />
                Remove from Library
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      <MarkUsedDialog
        open={markUsedOpen}
        onOpenChange={setMarkUsedOpen}
        ids={ids}
        projects={projects.data ?? []}
      />
      <TagPromptDialog open={tagOpen} onOpenChange={setTagOpen} ids={ids} />
    </>
  );
}
