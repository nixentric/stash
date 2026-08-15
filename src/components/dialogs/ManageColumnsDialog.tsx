import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
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
import { Select } from "@/components/dialogs/BrandDialogs";
import { ipc } from "@/lib/ipc";
import {
  invalidateLibrary,
  keys,
  reportError,
  useBrands,
  useDefaultFolderBrand,
  useFolderFields,
} from "@/hooks/queries";

/** Same wording the folder brand pickers use, so the option reads identically. */
const NO_BRAND = "No brand";

export function ManageColumnsDialog({
  open,
  onClose,
  multipleTagFields,
  onChangeMultipleTagFields,
}: {
  open: boolean;
  onClose: () => void;
  multipleTagFields: number[];
  onChangeMultipleTagFields: (ids: number[]) => void;
}) {
  const qc = useQueryClient();
  const fields = useFolderFields(open);
  const brands = useBrands(open);
  const defaultBrand = useDefaultFolderBrand(open);
  const [column, setColumn] = useState("");
  const [colType, setColType] = useState<"single" | "multiple">("single");
  const [busy, setBusy] = useState(false);

  const addColumn = async () => {
    if (!column.trim()) return;
    setBusy(true);
    try {
      const fieldId = await ipc.createFolderField(column.trim());
      if (colType === "multiple") {
        onChangeMultipleTagFields([...multipleTagFields, fieldId]);
      }
      setColumn("");
      invalidateLibrary(qc);
    } catch (e) {
      reportError(e, "Could not add column");
    } finally {
      setBusy(false);
    }
  };

  const deleteColumn = async (id: number) => {
    setBusy(true);
    try {
      await ipc.deleteFolderField(id);
      onChangeMultipleTagFields(multipleTagFields.filter((fId) => fId !== id));
      invalidateLibrary(qc);
    } catch (e) {
      reportError(e, "Could not delete column");
    } finally {
      setBusy(false);
    }
  };

  const rows = fields.data ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(32rem,92vw)]">
        <DialogHeader>
          <DialogTitle>Source Folder Settings</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Default brand</span>
            <p className="text-[12px] text-subtle-foreground">
              New folders are catalogued under this brand automatically, so a library that belongs to
              one brand does not need the brand set folder by folder. Folders you have already given a
              brand — or deliberately left without one — are never changed.
            </p>
            <Select
              value={(brands.data ?? []).find((b) => b.id === defaultBrand.data)?.name ?? NO_BRAND}
              options={[NO_BRAND, ...(brands.data ?? []).map((b) => b.name)]}
              onChange={async (name) => {
                const id = (brands.data ?? []).find((b) => b.name === name)?.id ?? null;
                try {
                  await ipc.setDefaultFolderBrand(id);
                  qc.invalidateQueries({ queryKey: keys.defaultFolderBrand });
                } catch (e) {
                  reportError(e, "Could not save the default brand");
                }
              }}
            />
          </div>

          <div className="border-t border-border pt-3">
            <span className="text-[13px] font-medium">Custom columns</span>
            <p className="mt-1 text-[12px] text-subtle-foreground">
              Custom columns let you track extra metadata for your source folders. Deleting a column clears its values across all folders.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {rows.length === 0 && (
              <p className="py-4 text-center text-[13px] text-muted-foreground">No custom columns yet.</p>
            )}

            {rows.map((field) => {
              const isMultiple = multipleTagFields.includes(field.id);
              return (
                <div key={field.id} className="flex items-center justify-between gap-2 border-b border-border/50 py-1.5 last:border-0 animate-fade-in">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate text-[13px] font-medium">{field.name}</span>
                    <button
                      type="button"
                      title={`Click to switch to ${isMultiple ? 'Single Value' : 'Multiple Tags'}`}
                      onClick={() => {
                        const newFields = isMultiple
                          ? multipleTagFields.filter((id) => id !== field.id)
                          : [...multipleTagFields, field.id];
                        onChangeMultipleTagFields(newFields);
                      }}
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                        isMultiple
                          ? "bg-primary/10 text-primary hover:bg-primary/20"
                          : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      {isMultiple ? "Multiple Tags" : "Single Value"}
                    </button>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Delete ${field.name}`}
                    onClick={() => deleteColumn(field.id)}
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 pt-3 border-t border-border">
            <div className="flex gap-2">
              <Input
                value={column}
                onChange={(e) => setColumn(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void addColumn()}
                placeholder="New column name, e.g. Client"
                disabled={busy}
              />
              <Button variant="secondary" size="sm" onClick={addColumn} disabled={busy || !column.trim()}>
                <Plus className="size-4 mr-1" /> Add
              </Button>
            </div>
            <div className="flex items-center gap-4 text-[12px] text-muted-foreground pl-1">
              <span className="font-medium">Type:</span>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="radio"
                  name="colType"
                  checked={colType === "single"}
                  onChange={() => setColType("single")}
                  className="accent-primary size-3.5"
                />
                <span>Single Value</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="radio"
                  name="colType"
                  checked={colType === "multiple"}
                  onChange={() => setColType("multiple")}
                  className="accent-primary size-3.5"
                />
                <span>Multiple Tags</span>
              </label>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

