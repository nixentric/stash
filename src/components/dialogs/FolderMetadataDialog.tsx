import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TagInput } from "@/components/inspector/TagInput";
import { ipc } from "@/lib/ipc";
import type { FolderNode } from "@/lib/types";
import { invalidateLibrary, reportError, useFolderFields } from "@/hooks/queries";
import { useQueryClient } from "@tanstack/react-query";

export function FolderMetadataDialog({ folder, onClose }: { folder: FolderNode | null; onClose: () => void }) {
  const qc = useQueryClient();
  const fields = useFolderFields(!!folder);
  const [tags, setTags] = useState<string[]>([]);
  const [values, setValues] = useState<Record<number, string>>({});
  const [column, setColumn] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTags(folder?.tags ?? []);
    setValues(Object.fromEntries((folder?.fields ?? []).map((f) => [f.fieldId, f.value])));
  }, [folder]);

  const addColumn = async () => {
    if (!column.trim()) return;
    try { await ipc.createFolderField(column.trim()); setColumn(""); invalidateLibrary(qc); }
    catch (e) { reportError(e, "Could not add column"); }
  };
  const save = async () => {
    if (!folder) return;
    setSaving(true);
    try {
      await ipc.setFolderTags(folder.containerPath, tags);
      await Promise.all((fields.data ?? []).map((f) => ipc.setFolderFieldValue(folder.containerPath, f.id, values[f.id] ?? "")));
      invalidateLibrary(qc); onClose();
    } catch (e) { reportError(e, "Could not save folder metadata"); }
    finally { setSaving(false); }
  };
  return <Dialog open={!!folder} onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="w-[min(32rem,92vw)]">
      <DialogHeader><DialogTitle>Source Folder Metadata</DialogTitle></DialogHeader>
      <DialogBody className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
        <p className="truncate text-[12px] text-subtle-foreground">{folder?.containerPath}</p>
        <div><p className="mb-1.5 text-[12px] font-medium">Tags</p><TagInput value={tags} onChange={setTags} placeholder="Add folder tag…" /></div>
        <div className="flex flex-col gap-2">
          <p className="text-[12px] font-medium">Custom columns</p>
          {(fields.data ?? []).map((field) => <div key={field.id} className="flex items-center gap-2">
            <span className="w-28 shrink-0 truncate text-[12px] text-muted-foreground">{field.name}</span>
            <Input value={values[field.id] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))} placeholder={`Set ${field.name}`} />
            <Button variant="ghost" size="sm" aria-label={`Delete ${field.name}`} onClick={async () => { await ipc.deleteFolderField(field.id); invalidateLibrary(qc); }}><Trash2 /></Button>
          </div>)}
          <div className="flex gap-2"><Input value={column} onChange={(e) => setColumn(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void addColumn()} placeholder="New column, e.g. Client" /><Button variant="secondary" size="sm" onClick={addColumn}><Plus /> Add</Button></div>
        </div>
      </DialogBody>
      <DialogFooter><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={saving} onClick={save}>Save</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
