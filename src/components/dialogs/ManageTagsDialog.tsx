import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Hash, Pencil, Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ipc } from "@/lib/ipc";
import { count } from "@/lib/format";
import { invalidateLibrary, reportError, useTags } from "@/hooks/queries";

/**
 * The one place where a tag is edited as a thing, not as a label on a clip.
 * A tag reaches zero when its last clip or source folder is removed — nothing
 * prunes it there, because a footage delete says nothing about the taxonomy.
 */
export function ManageTagsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const tags = useTags(open);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const rows = tags.data ?? [];
  const unused = rows.filter((t) => t.footageCount === 0);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      invalidateLibrary(qc);
      setEditing(null);
    } catch (e) {
      reportError(e, message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(32rem,92vw)]">
        <DialogHeader>
          <DialogTitle>Manage Tags</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
          <p className="text-[12px] text-subtle-foreground">
            Deleting a tag removes it from every clip and source folder that carries it. The
            files themselves are never touched.
          </p>

          {rows.length === 0 && (
            <p className="py-6 text-center text-[13px] text-muted-foreground">No tags yet.</p>
          )}

          {rows.map((tag) =>
            editing === tag.id ? (
              <div key={tag.id} className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void run(() => ipc.renameTag(tag.id, draft), "Could not rename tag");
                    if (e.key === "Escape") setEditing(null);
                  }}
                  placeholder="Tag name"
                />
                <Button
                  size="sm"
                  disabled={busy || !draft.trim()}
                  aria-label="Save name"
                  onClick={() => run(() => ipc.renameTag(tag.id, draft), "Could not rename tag")}
                >
                  <Check />
                </Button>
                <Button size="sm" variant="ghost" aria-label="Cancel rename" onClick={() => setEditing(null)}>
                  <X />
                </Button>
              </div>
            ) : (
              <div key={tag.id} className="flex items-center gap-2">
                <Hash className="size-3.5 shrink-0 text-subtle-foreground" />
                <span className="min-w-0 flex-1 truncate text-[13px]">{tag.name}</span>
                <span
                  className={`shrink-0 text-[12px] ${
                    tag.footageCount === 0 ? "text-subtle-foreground" : "text-muted-foreground"
                  }`}
                >
                  {tag.footageCount === 0 ? "unused" : count(tag.footageCount)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Rename ${tag.name}`}
                  onClick={() => {
                    setEditing(tag.id);
                    setDraft(tag.name);
                  }}
                >
                  <Pencil />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Delete ${tag.name}`}
                  onClick={() => run(() => ipc.deleteTags([tag.id]), "Could not delete tag")}
                >
                  <Trash2 />
                </Button>
              </div>
            ),
          )}
        </DialogBody>
        <DialogFooter>
          {unused.length > 0 && (
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => run(() => ipc.deleteTags(unused.map((t) => t.id)), "Could not delete unused tags")}
            >
              <Trash2 /> Delete {unused.length} unused
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
