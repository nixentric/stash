import { useEffect, useState } from "react";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/dialogs/BrandDialogs";
import { ipc } from "@/lib/ipc";
import type { FolderNode } from "@/lib/types";
import { invalidateLibrary, reportError, useBrands } from "@/hooks/queries";
import { useQueryClient } from "@tanstack/react-query";
import { useSubmitHotkey } from "@/hooks/use-hotkeys";

/** Shown when a folder belongs to nobody in particular. */
const NO_BRAND = "No brand";

export function FolderMetadataDialog({ folder, onClose }: { folder: FolderNode | null; onClose: () => void }) {
  const qc = useQueryClient();
  const brands = useBrands(!!folder);
  const [brand, setBrand] = useState(NO_BRAND);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBrand(folder?.brandName ?? NO_BRAND);
  }, [folder]);

  const save = async () => {
    if (!folder) return;
    setSaving(true);
    try {
      await ipc.setFolderBrand(
        folder.containerPath,
        (brands.data ?? []).find((b) => b.name === brand)?.id ?? null,
      );
      invalidateLibrary(qc);
      onClose();
    } catch (e) {
      reportError(e, "Could not save folder brand");
    } finally {
      setSaving(false);
    }
  };

  useSubmitHotkey(!!folder && !saving, () => void save());

  return (
    <Dialog open={!!folder} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(28rem,92vw)]">
        <DialogHeader>
          <DialogTitle>Edit Folder Brand</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <p className="truncate text-[12px] text-subtle-foreground">{folder?.containerPath}</p>
          <div>
            <p className="mb-1.5 text-[12px] font-medium">Brand</p>
            <Select
              value={brand}
              options={[NO_BRAND, ...(brands.data ?? []).map((b) => b.name)]}
              onChange={setBrand}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

