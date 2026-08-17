import { useEffect, useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TagInput } from "@/components/inspector/TagInput";
import { useFootageAction } from "@/hooks/queries";
import { useSubmitHotkey } from "@/hooks/use-hotkeys";

export function TagPromptDialog({
  open,
  onOpenChange,
  ids,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  ids: number[];
}) {
  const [tags, setTags] = useState<string[]>([]);
  const action = useFootageAction();

  useEffect(() => {
    if (open) setTags([]);
  }, [open]);

  const submit = () => {
    action.mutate({ type: "addTags", ids, tags });
    onOpenChange(false);
  };
  useSubmitHotkey(open && tags.length > 0, submit);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Tags</DialogTitle>
          <DialogDescription>
            {ids.length > 1 ? `Applied to ${ids.length} items.` : "Applied to this footage."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <TagInput value={tags} onChange={setTags} autoFocus />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="lg" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="lg" disabled={tags.length === 0} onClick={submit}>
            Add {tags.length > 0 && `(${tags.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
