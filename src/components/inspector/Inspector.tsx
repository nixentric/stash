import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Copy,
  ExternalLink,
  Heart,
  ImageOff,
  Layers,
  Play,
  RefreshCw,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Badge, Rating, Separator, Tooltip } from "@/components/ui/misc";
import { TagInput } from "./TagInput";
import { cn } from "@/lib/utils";
import {
  accessibilityLabel,
  bytes,
  date,
  duration as fmtDuration,
  mediaLabel,
  providerLabel,
  resolution,
} from "@/lib/format";
import { ipc } from "@/lib/ipc";
import {
  invalidateLibrary,
  keys,
  reportError,
  useFootageAction,
  useFootageDetail,
} from "@/hooks/queries";
import { useThumbnail } from "@/hooks/use-thumbnail";
import { useUi } from "@/store/ui";

export function Inspector() {
  const { selection, setInspectorOpen, setQuickLookId } = useUi();
  const id = selection.length === 1 ? (selection[0] ?? null) : null;
  const detail = useFootageDetail(id);
  const action = useFootageAction();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (detail.data) {
      setName(detail.data.displayName);
      setNotes(detail.data.notes);
    }
  }, [detail.data?.id, detail.data?.displayName, detail.data?.notes]);

  const thumb = useThumbnail(id ?? -1, id != null, false);

  if (selection.length === 0 || (selection.length > 1 && !id)) {
    return (
      <Panel onClose={() => setInspectorOpen(false)}>
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-[12px] leading-relaxed text-subtle-foreground">
            {selection.length > 1
              ? `${selection.length} items selected.\nSelect a single item to see its details.`
              : "Select footage to see its details."}
          </p>
        </div>
      </Panel>
    );
  }

  const d = detail.data;
  if (!d) {
    return (
      <Panel onClose={() => setInspectorOpen(false)}>
        <div className="flex-1 animate-pulse px-3 py-3">
          <div className="aspect-[4/3] w-full rounded bg-muted" />
        </div>
      </Panel>
    );
  }

  const used = d.usageCount > 0;
  const warning = accessibilityLabel[d.source.accessibility];

  const commit = (patch: { displayName?: string; notes?: string }) =>
    action.mutate({ type: "patch", ids: [d.id], patch });

  return (
    <Panel onClose={() => setInspectorOpen(false)}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Preview */}
        <button
          onClick={() => setQuickLookId(d.id)}
          className="group relative block aspect-[4/3] w-full overflow-hidden bg-thumb-bg outline-none"
          aria-label="Open preview"
        >
          {thumb.data ? (
            <img src={thumb.data} alt="" className="size-full object-cover" draggable={false} />
          ) : (
            <span className="flex size-full items-center justify-center">
              <ImageOff className="size-5 text-subtle-foreground/60" />
            </span>
          )}
          <span
            className="absolute inset-0 flex items-center justify-center bg-black/0
                       transition-colors group-hover:bg-black/25"
          >
            <Play className="size-6 fill-white text-white opacity-0 transition-opacity group-hover:opacity-100" />
          </span>
        </button>

        <div className="flex flex-col gap-3 px-3 py-3">
          {/* Name */}
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== d.displayName && commit({ displayName: name })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="h-7 font-medium"
            aria-label="Display name"
          />

          {/* Status + quick actions */}
          <div className="flex items-center gap-1.5">
            <Badge tone={used ? "used" : "unused"}>
              {used ? (d.usageCount > 1 ? `Used ×${d.usageCount}` : "Used") : "Unused"}
            </Badge>
            {warning && (
              <Badge tone="warn">
                <TriangleAlert className="size-2.5" />
                {warning.label}
              </Badge>
            )}
            <div className="ml-auto flex items-center gap-0.5">
              <Tooltip content={d.favorite ? "Remove favorite" : "Favorite"} shortcut="F">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => commit0(action, d.id, { favorite: !d.favorite })}
                  aria-pressed={d.favorite}
                >
                  <Heart
                    className={cn(d.favorite && "fill-destructive text-destructive")}
                  />
                </Button>
              </Tooltip>
            </div>
          </div>

          <Rating
            value={d.rating}
            onChange={(v) => commit0(action, d.id, { rating: v })}
          />

          <Separator />

          {/* Tags */}
          <Section title="Tags">
            <TagInput
              value={d.tags}
              onChange={(tags) => action.mutate({ type: "setTags", id: d.id, tags })}
            />
          </Section>

          {d.collections.length > 0 && (
            <Section title="Collections">
              <div className="flex flex-wrap gap-1">
                {d.collections.map((c) => (
                  <span
                    key={c.id}
                    className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11.5px]"
                  >
                    <Layers className="size-2.5 text-subtle-foreground" />
                    {c.name}
                    <button
                      aria-label={`Remove from ${c.name}`}
                      onClick={() =>
                        action.mutate({
                          type: "removeFromCollection",
                          collectionId: c.id,
                          ids: [d.id],
                        })
                      }
                      className="text-subtle-foreground hover:text-foreground"
                    >
                      <X className="size-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            </Section>
          )}

          <Separator />

          {/* Source metadata — may be entirely empty in link mode, and that is
              a supported state, not an error. */}
          <Section title="Metadata">
            <dl className="flex flex-col gap-0.5">
              <Meta label="Type" value={mediaLabel[d.mediaType]} />
              <Meta label="Resolution" value={resolution(d.source.width, d.source.height)} />
              <Meta label="Duration" value={fmtDuration(d.source.durationMs)} />
              <Meta label="Size" value={bytes(d.source.fileSize)} />
              <Meta label="Format" value={d.source.mimeType} />
              <Meta label="Added" value={date(d.dateAdded)} />
              <Meta label="Modified" value={date(d.source.sourceModifiedAt)} />
            </dl>
          </Section>

          <Section title="Source">
            <dl className="flex flex-col gap-0.5">
              <Meta label="From" value={providerLabel[d.source.provider] ?? d.source.provider} />
              <Meta label="Folder" value={d.source.containerPath} />
              <Meta label="Filename" value={d.source.originalFilename} />
              <Meta label="Synced" value={date(d.source.lastSyncedAt)} />
            </dl>

            {/* Offered when the provider's real filename differs from what the
                user typed — never applied automatically (§24). */}
            {d.source.originalFilename &&
              d.source.originalFilename !== d.displayName && (
                <button
                  onClick={() => commit({ displayName: d.source.originalFilename ?? "" })}
                  className="mt-1 self-start text-[11.5px] text-primary hover:underline"
                >
                  Use original filename
                </button>
              )}

            <div className="mt-1.5 flex flex-wrap gap-1">
              {d.source.originalUrl && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      ipc.openExternal(d.source.originalUrl!).catch(reportError)
                    }
                  >
                    <ExternalLink />
                    Open
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      await navigator.clipboard.writeText(d.source.originalUrl!);
                      toast.success("Link copied");
                    }}
                  >
                    <Copy />
                    Copy Link
                  </Button>
                </>
              )}
              {d.source.localPath && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    ipc.revealInFileManager(d.source.localPath!).catch(reportError)
                  }
                >
                  <ExternalLink />
                  Reveal
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  try {
                    const ok = await ipc.refreshThumbnail(d.id, true);
                    qc.invalidateQueries({ queryKey: keys.thumb(d.id, false) });
                    qc.invalidateQueries({ queryKey: keys.thumb(d.id, true) });
                    qc.invalidateQueries({ queryKey: keys.detail(d.id) });
                    toast[ok ? "success" : "info"](
                      ok ? "Thumbnail refreshed" : "No preview available for this source",
                    );
                  } catch (e) {
                    reportError(e);
                  }
                }}
              >
                <RefreshCw />
                Refresh preview
              </Button>
              {d.hasThumbnail && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await ipc.clearThumbnail(d.id);
                    qc.invalidateQueries({ queryKey: keys.thumb(d.id, false) });
                    qc.invalidateQueries({ queryKey: keys.detail(d.id) });
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
            {d.thumbnailPinned && (
              <p className="mt-1 text-[11px] text-subtle-foreground">
                Custom thumbnail — sync will not replace it.
              </p>
            )}
          </Section>

          <Separator />

          <Section title="Notes">
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== d.notes && commit({ notes })}
              placeholder="What is this good for?"
            />
          </Section>

          <Separator />

          <Section title={`Usage History${d.usageCount ? ` (${d.usageCount})` : ""}`}>
            {d.usage.length === 0 ? (
              <p className="text-[12px] text-subtle-foreground">
                Never used. Mark it when it lands in a project.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {d.usage.map((u) => (
                  <li key={u.id} className="group flex items-start gap-2">
                    <span className="mt-[5px] size-1.5 shrink-0 rounded-full bg-used" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium">
                        {u.projectName ?? "Used without a project"}
                      </p>
                      <p className="text-[11px] text-subtle-foreground">{date(u.usedAt)}</p>
                      {u.notes && (
                        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                          {u.notes}
                        </p>
                      )}
                    </div>
                    <button
                      aria-label="Delete this usage record"
                      onClick={() => {
                        action.mutate({
                          type: "deleteUsage",
                          usageId: u.id,
                          footageId: d.id,
                        });
                        invalidateLibrary(qc);
                      }}
                      className="rounded p-1 text-subtle-foreground opacity-0 transition-opacity
                                 hover:bg-accent hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </Panel>
  );
}

function commit0(
  action: ReturnType<typeof useFootageAction>,
  id: number,
  patch: { favorite?: boolean; rating?: number },
) {
  action.mutate({ type: "patch", ids: [id], patch });
}

function Panel({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <aside
      className="flex h-full flex-col bg-sidebar hairline-l"
      aria-label="Inspector"
    >
      <div className="drag-region flex h-10 shrink-0 items-center justify-between pl-3 pr-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">
          Inspector
        </span>
        <Button variant="ghost" size="icon-sm" className="no-drag" onClick={onClose} aria-label="Hide inspector">
          <X />
        </Button>
      </div>
      {children}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-2 text-[12px]">
      <dt className="w-[4.75rem] shrink-0 text-subtle-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-foreground">{value}</dd>
    </div>
  );
}
