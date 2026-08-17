import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Plus } from "lucide-react";
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
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ipc } from "@/lib/ipc";
import { invalidateLibrary, reportError } from "@/hooks/queries";
import type { Project } from "@/lib/types";
import { useSubmitHotkey } from "@/hooks/use-hotkeys";

interface Props {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  ids: number[];
  projects: Project[];
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Records a usage event (§15).
 *
 * Choosing a project is optional on purpose — "I used this, I don't want to file
 * it" is a real workflow, and forcing a project would make people skip marking
 * usage at all, which is the one thing this app exists to track.
 */
export function MarkUsedDialog({ open, onOpenChange, ids, projects }: Props) {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [usedAt, setUsedAt] = useState(today());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setProjectId(null);
      setFilter("");
      setUsedAt(today());
      setNotes("");
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;
  }, [projects, filter]);

  const exactMatch = projects.some(
    (p) => p.name.toLowerCase() === filter.trim().toLowerCase(),
  );
  const canCreate = filter.trim().length > 0 && !exactMatch;

  async function submit(withProject: number | null) {
    setBusy(true);
    try {
      await ipc.markUsed(ids, withProject, usedAt, notes.trim() || null);
      invalidateLibrary(qc);
      for (const id of ids) qc.invalidateQueries({ queryKey: ["footage", "detail", id] });
      toast.success(
        ids.length > 1 ? `Marked ${ids.length} items as used` : "Marked as used",
      );
      onOpenChange(false);
    } catch (e) {
      reportError(e, "Could not record usage");
    } finally {
      setBusy(false);
    }
  }

  // The project is the only required choice, so ⌘⏎ means "with that one".
  useSubmitHotkey(open && !busy && projectId != null, () => void submit(projectId));

  async function createAndUse() {
    setBusy(true);
    try {
      const id = await ipc.createProject(filter.trim());
      await ipc.markUsed(ids, id, usedAt, notes.trim() || null);
      invalidateLibrary(qc);
      toast.success(`Marked as used in “${filter.trim()}”`);
      onOpenChange(false);
    } catch (e) {
      reportError(e, "Could not create the project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as Used</DialogTitle>
          <DialogDescription>
            {ids.length > 1
              ? `${ids.length} items will get a usage record.`
              : "Adds a usage record to this footage."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          <Field label="Project">
            <Input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search or create a project…"
            />
            <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border">
              {filtered.length === 0 && !canCreate && (
                <p className="px-2 py-2 text-[12px] text-subtle-foreground">
                  No projects yet.
                </p>
              )}
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setProjectId(p.id === projectId ? null : p.id)}
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12.5px]",
                    "transition-colors hover:bg-accent",
                    projectId === p.id && "bg-accent",
                  )}
                >
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      projectId === p.id ? "text-primary" : "text-transparent",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="tnum text-[11px] text-subtle-foreground">
                    {p.footageCount}
                  </span>
                </button>
              ))}
              {canCreate && (
                <button
                  onClick={createAndUse}
                  disabled={busy}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12.5px]
                             text-primary transition-colors hover:bg-accent"
                >
                  <Plus className="size-3.5" />
                  Create “{filter.trim()}”
                </button>
              )}
            </div>
          </Field>

          <Field label="Date">
            <Input
              type="date"
              value={usedAt}
              onChange={(e) => setUsedAt(e.target.value)}
              className="w-40"
            />
          </Field>

          <Field label="Notes (optional)">
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Which cut, which edit…"
            />
          </Field>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" size="lg" disabled={busy} onClick={() => submit(null)}>
            Mark Used Without Project
          </Button>
          <Button
            size="lg"
            disabled={busy || projectId == null}
            onClick={() => submit(projectId)}
          >
            Mark as Used
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}
