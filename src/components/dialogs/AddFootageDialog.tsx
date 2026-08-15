import { useEffect, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronRight,
  ExternalLink,
  FolderTree,
  HardDrive,
  Link2,
  Loader2,
  Search,
  TriangleAlert,
} from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Checkbox, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { bytes, duration as fmtDuration } from "@/lib/format";
import { ipc } from "@/lib/ipc";
import { invalidateLibrary, reportError, useCapabilities } from "@/hooks/queries";
import type { BulkParseResult, NewFootage, ScannedItem } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  onOpenSettings: () => void;
}

export function AddFootageDialog({ open, onOpenChange, onOpenSettings }: Props) {
  const caps = useCapabilities();
  const [tab, setTab] = useState("links");

  useEffect(() => {
    if (open) setTab("links");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(46rem,80vh)] w-[min(46rem,92vw)] max-w-none flex-col overflow-hidden">
        <DialogHeader className="pb-2">
          <DialogTitle>Add Footage</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <div className="px-4">
            <TabsList>
              <TabsTrigger value="links">
                <Link2 className="size-3.5" />
                Links
              </TabsTrigger>
              <TabsTrigger value="local">
                <HardDrive className="size-3.5" />
                This Computer
              </TabsTrigger>
              <TabsTrigger value="drive">
                <FolderTree className="size-3.5" />
                Drive Folder
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="links" className="min-h-0 flex-1 outline-none">
            <LinksTab
              connected={caps.data?.driveConnected ?? false}
              onDone={() => onOpenChange(false)}
              onOpenSettings={onOpenSettings}
              onOpenDriveFolder={() => setTab("drive")}
            />
          </TabsContent>
          <TabsContent value="local" className="min-h-0 flex-1 outline-none">
            <LocalTab onDone={() => onOpenChange(false)} />
          </TabsContent>
          <TabsContent value="drive" className="min-h-0 flex-1 outline-none">
            <DriveTab
              connected={caps.data?.driveConnected ?? false}
              onDone={() => onOpenChange(false)}
              onOpenSettings={onOpenSettings}
              onUseLinks={() => setTab("links")}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ── links ───────────────────────────────────────────────────────────────────

function LinksTab({
  connected,
  onDone,
  onOpenSettings,
  onOpenDriveFolder,
}: {
  connected: boolean;
  onDone: () => void;
  onOpenSettings: () => void;
  onOpenDriveFolder: () => void;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<BulkParseResult | null>(null);
  const [busy, setBusy] = useState(false);

  // No clipboard probing here. Reading the clipboard without a user gesture
  // makes WebKit show its own native "Paste" permission button over the app,
  // which looks like a glitch. The textarea is autofocused instead, so Cmd/Ctrl+V
  // already does the job with one keystroke and no prompt.

  useEffect(() => {
    if (!text.trim()) {
      setParsed(null);
      return;
    }
    const t = setTimeout(() => {
      ipc.parseBulkInput(text).then(setParsed).catch(() => setParsed(null));
    }, 200);
    return () => clearTimeout(t);
  }, [text]);

  const folders = parsed?.entries.filter((e) => e.source.kind === "container") ?? [];
  const items = parsed?.entries.filter((e) => e.source.kind === "item") ?? [];

  async function importAll() {
    if (items.length === 0) return;
    setBusy(true);
    try {
      const payload: NewFootage[] = items.map((e) => ({
        displayName: e.label ?? e.source.suggestedName,
        provider: e.source.provider,
        externalId: e.source.externalId,
        externalKey: e.source.externalKey,
        originalUrl: e.source.originalUrl,
        localPath: e.source.localPath,
      }));
      const outcome = await ipc.importFootage(payload);
      invalidateLibrary(qc);

      const parts = [`Added ${outcome.imported.length}`];
      if (outcome.duplicates.length) parts.push(`${outcome.duplicates.length} already in library`);
      if (outcome.failed.length) parts.push(`${outcome.failed.length} failed`);
      toast.success(parts.join(" · "));

      // Fetching previews is fire-and-forget: the records already exist and the
      // grid is usable whether or not any thumbnail resolves.
      if (outcome.imported.length) {
        ipc.fetchThumbnails(outcome.imported, false).catch(() => {});
      }
      onDone();
    } catch (e) {
      reportError(e, "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DialogBody className="flex min-h-0 flex-1 flex-col gap-2 pt-3">
        <Textarea
          autoFocus
          rows={7}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            "Paste one or more links, one per line.\n\n" +
            "https://drive.google.com/file/d/FILE_ID/view\n\n" +
            "Optionally put a name on the line above a link:\n" +
            "Woman holding iPhone 01\nhttps://drive.google.com/file/d/FILE_ID/view"
          }
          className="min-h-[9rem] font-mono text-[12px]"
        />

        {folders.length > 0 && (
          <FolderNotice
            connected={connected}
            folderUrl={folders[0]?.source.originalUrl ?? null}
            onOpenSettings={onOpenSettings}
            onOpenDriveFolder={onOpenDriveFolder}
          />
        )}

        {/* Suppressed while a folder notice is showing — "no links detected"
            directly under "folder detected" reads as a contradiction. */}
        {parsed && !(items.length === 0 && folders.length > 0) && (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
            {items.length === 0 && parsed.unrecognized.length === 0 && (
              <p className="px-2 py-2 text-[12px] text-subtle-foreground">
                No links detected yet.
              </p>
            )}
            {items.map((e, i) => (
              <div
                key={`${e.line}-${i}`}
                className="flex items-center gap-2 border-b border-border px-2 py-1.5 last:border-0"
              >
                <Link2 className="size-3 shrink-0 text-subtle-foreground" />
                <span className="min-w-0 flex-1 truncate text-[12.5px]">
                  {e.label ?? e.source.suggestedName}
                </span>
                <span className="shrink-0 text-[10.5px] uppercase tracking-wide text-subtle-foreground">
                  {e.source.provider === "google_drive"
                    ? "Drive"
                    : e.source.provider === "local"
                      ? "Local"
                      : "Link"}
                </span>
              </div>
            ))}
            {parsed.unrecognized.map((u, i) => (
              <div
                key={`u-${i}`}
                className="flex items-center gap-2 border-b border-border px-2 py-1.5 last:border-0"
              >
                <TriangleAlert className="size-3 shrink-0 text-warning" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted-foreground">
                  {u}
                </span>
                <span className="shrink-0 text-[10.5px] text-warning">Not a valid link</span>
              </div>
            ))}
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        <span className="mr-auto text-[12px] text-subtle-foreground">
          {items.length > 0 && `${items.length} link${items.length > 1 ? "s" : ""} ready`}
        </span>
        <Button size="lg" disabled={busy || items.length === 0} onClick={importAll}>
          {busy && <Loader2 className="animate-spin" />}
          Import {items.length > 0 && items.length}
        </Button>
      </DialogFooter>
    </div>
  );
}

/**
 * A Drive folder link cannot be expanded without the API.
 *
 * A share URL carries only the folder's id; reading what is inside it requires
 * an authenticated `files.list` call. The one alternative — scraping the Drive
 * web page — is explicitly out of bounds (§17, §30), so the honest options are
 * offered instead of a broken attempt. Both are given, and neither is a
 * dead end.
 */
function FolderNotice({
  connected,
  folderUrl,
  onOpenSettings,
  onOpenDriveFolder,
}: {
  connected: boolean;
  folderUrl: string | null;
  onOpenSettings: () => void;
  onOpenDriveFolder: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/60 px-3 py-2.5">
      <p className="text-[12.5px] font-medium">Google Drive folder detected</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
        {connected
          ? "Your Google Drive is connected. Open the Drive Folder tab to scan and choose the files to import."
          : "A folder link only carries the folder's ID — reading what's inside it needs the Drive API. Everything else in Stash keeps working without connecting."}
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        {connected ? (
          <Button size="sm" onClick={onOpenDriveFolder}>
            Scan in Drive Folder
          </Button>
        ) : (
          <Button size="sm" onClick={onOpenSettings}>
            Connect Google Drive
          </Button>
        )}
        {folderUrl && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => ipc.openExternal(folderUrl).catch(reportError)}
          >
            <ExternalLink />
            Open folder in Drive
          </Button>
        )}
      </div>

      <p className="mt-2 border-t border-border pt-2 text-[11.5px] leading-relaxed text-subtle-foreground">
        <span className="font-medium text-muted-foreground">Prefer not to connect?</span> Open
        the folder in Drive, copy each file's link (right-click → Share → Copy link), and
        paste them here — one per line. Connecting is worth it for folders of more than a
        handful of files.
      </p>
    </div>
  );
}

// ── local files ─────────────────────────────────────────────────────────────

function LocalTab({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [paths, setPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function pick() {
    const picked = await openFileDialog({
      title: "Add files",
      multiple: true,
      filters: [
        {
          name: "Media",
          extensions: [
            "jpg", "jpeg", "png", "webp", "gif", "heic", "tif", "tiff", "bmp", "avif",
            "mp4", "mov", "mkv", "webm", "m4v", "avi", "mpg", "mpeg", "mts", "mxf",
          ],
        },
      ],
    });
    if (!picked) return;
    setPaths(Array.isArray(picked) ? picked : [picked]);
  }

  async function importAll() {
    setBusy(true);
    try {
      const payload: NewFootage[] = paths.map((p) => ({
        displayName: p.split(/[\\/]/).pop() ?? p,
        provider: "local",
        localPath: p,
        originalFilename: p.split(/[\\/]/).pop() ?? null,
        containerPath: p.split(/[\\/]/).slice(0, -1).pop() ?? null,
      }));
      const outcome = await ipc.importFootage(payload);
      invalidateLibrary(qc);
      toast.success(`Added ${outcome.imported.length} file(s)`);
      if (outcome.imported.length) ipc.fetchThumbnails(outcome.imported, false).catch(() => {});
      onDone();
    } catch (e) {
      reportError(e, "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DialogBody className="flex min-h-0 flex-1 flex-col gap-2 pt-3">
        <Button variant="secondary" size="lg" className="self-start" onClick={pick}>
          <HardDrive />
          Choose files…
        </Button>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
          {paths.length === 0 ? (
            <p className="px-2 py-2 text-[12px] text-subtle-foreground">
              Files stay where they are — Stash only records where to find them.
            </p>
          ) : (
            paths.map((p) => (
              <div key={p} className="truncate border-b border-border px-2 py-1.5 text-[12px] last:border-0">
                {p}
              </div>
            ))
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button size="lg" disabled={busy || paths.length === 0} onClick={importAll}>
          {busy && <Loader2 className="animate-spin" />}
          Import {paths.length > 0 && paths.length}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ── drive folder ────────────────────────────────────────────────────────────

function DriveTab({
  connected,
  onDone,
  onOpenSettings,
  onUseLinks,
}: {
  connected: boolean;
  onDone: () => void;
  onOpenSettings: () => void;
  onUseLinks: () => void;
}) {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [recursive, setRecursive] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [items, setItems] = useState<ScannedItem[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [crumbs, setCrumbs] = useState<{ id: string; name: string }[]>([
    { id: "root", name: "My Drive" },
  ]);
  const [browse, setBrowse] = useState<ScannedItem[] | null>(null);

  const currentFolder = crumbs.at(-1)?.id ?? "root";

  useEffect(() => {
    if (!connected) return;
    let alive = true;
    ipc
      .browseDrive(currentFolder === "root" ? null : currentFolder)
      .then((r) => alive && setBrowse(r))
      .catch(() => alive && setBrowse([]));
    return () => {
      alive = false;
    };
  }, [connected, currentFolder]);

  if (!connected) {
    return (
      <DialogBody className="pt-3">
        <div className="rounded-md border border-border bg-muted/50 px-4 py-4">
          <p className="text-[13px] font-medium">Google Drive is not connected</p>
          <p className="mt-1 max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
            Scanning a folder needs the Drive API. Everything else in Stash works without
            it — you can add Drive links by hand right now and connect later without
            losing anything.
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={onOpenSettings}>
              Connect Google Drive
            </Button>
            <Button size="sm" variant="secondary" onClick={onUseLinks}>
              Add Links Manually
            </Button>
          </div>
        </div>
      </DialogBody>
    );
  }

  async function scan(folderId: string) {
    setScanning(true);
    setItems(null);
    try {
      const result = await ipc.scanDriveFolder(folderId, recursive);
      setItems(result.items);
      setChosen(
        new Set(result.items.filter((i) => !i.alreadyInLibrary).map((i) => i.externalId)),
      );
      if (result.cancelled) toast.info("Scan cancelled");
    } catch (e) {
      reportError(e, "Could not scan that folder");
    } finally {
      setScanning(false);
    }
  }

  async function scanFromUrl() {
    const parsed = await ipc.parseSourceInput(url.trim());
    if (!parsed?.externalId) {
      toast.error("That is not a Google Drive folder link");
      return;
    }
    void scan(parsed.externalId);
  }

  async function importChosen() {
    if (!items) return;
    setBusy(true);
    try {
      const payload: NewFootage[] = items
        .filter((i) => chosen.has(i.externalId) && !i.isFolder)
        .map((i) => ({
          displayName: i.name,
          mediaType: i.mediaType,
          provider: "google_drive",
          externalId: i.externalId,
          originalUrl: i.webViewLink ?? `https://drive.google.com/file/d/${i.externalId}/view`,
          containerId: i.containerId,
          containerPath: i.containerPath,
          originalFilename: i.name,
          mimeType: i.mimeType,
          fileSize: i.fileSize,
          width: i.width,
          height: i.height,
          durationMs: i.durationMs,
          sourceCreatedAt: i.createdTime,
          sourceModifiedAt: i.modifiedTime,
        }));

      const outcome = await ipc.importFootage(payload);
      invalidateLibrary(qc);
      toast.success(
        `Added ${outcome.imported.length}${
          outcome.duplicates.length ? ` · ${outcome.duplicates.length} already in library` : ""
        }`,
      );
      if (outcome.imported.length) ipc.fetchThumbnails(outcome.imported, false).catch(() => {});
      onDone();
    } catch (e) {
      reportError(e, "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const selectable = items?.filter((i) => !i.isFolder) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DialogBody className="flex min-h-0 flex-1 flex-col gap-2 pt-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && scanFromUrl()}
              placeholder="Paste a Drive folder link, or browse below"
              className="pl-7"
            />
          </div>
          <Button variant="secondary" disabled={!url.trim() || scanning} onClick={scanFromUrl}>
            Scan
          </Button>
        </div>

        <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Checkbox
            checked={recursive}
            onCheckedChange={(v) => setRecursive(v === true)}
          />
          Include files inside subfolders
        </label>

        {/* Breadcrumb browser */}
        {!items && (
          <>
            <div className="flex flex-wrap items-center gap-0.5 text-[12px]">
              {crumbs.map((c, i) => (
                <span key={c.id} className="flex items-center gap-0.5">
                  {i > 0 && <ChevronRight className="size-3 text-subtle-foreground" />}
                  <button
                    onClick={() => setCrumbs(crumbs.slice(0, i + 1))}
                    className={cn(
                      "rounded px-1 py-0.5 transition-colors hover:bg-accent",
                      i === crumbs.length - 1 ? "font-medium" : "text-muted-foreground",
                    )}
                  >
                    {c.name}
                  </button>
                </span>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
              {browse === null ? (
                <p className="px-2 py-2 text-[12px] text-subtle-foreground">Loading…</p>
              ) : browse.length === 0 ? (
                <p className="px-2 py-2 text-[12px] text-subtle-foreground">
                  This folder is empty.
                </p>
              ) : (
                browse.map((f) => (
                  <div
                    key={f.externalId}
                    className="flex items-center gap-2 border-b border-border px-2 py-1.5 last:border-0"
                  >
                    {f.isFolder ? (
                      <>
                        <FolderTree className="size-3.5 shrink-0 text-subtle-foreground" />
                        <button
                          onClick={() =>
                            setCrumbs([...crumbs, { id: f.externalId, name: f.name }])
                          }
                          className="min-w-0 flex-1 truncate text-left text-[12.5px] hover:underline"
                        >
                          {f.name}
                        </button>
                        <Button size="sm" variant="ghost" onClick={() => scan(f.externalId)}>
                          Scan
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="size-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
                          {f.name}
                        </span>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>

            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              disabled={scanning}
              onClick={() => scan(currentFolder)}
            >
              {scanning && <Loader2 className="animate-spin" />}
              Scan this folder
            </Button>
          </>
        )}

        {items && (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
            {selectable.length === 0 ? (
              <p className="px-2 py-2 text-[12px] text-subtle-foreground">
                No supported media found in that folder.
              </p>
            ) : (
              selectable.map((f) => (
                <label
                  key={f.externalId}
                  className={cn(
                    "flex items-center gap-2 border-b border-border px-2 py-1.5 last:border-0",
                    f.alreadyInLibrary && "opacity-55",
                  )}
                >
                  <Checkbox
                    checked={chosen.has(f.externalId)}
                    disabled={f.alreadyInLibrary}
                    onCheckedChange={(v) =>
                      setChosen((prev) => {
                        const next = new Set(prev);
                        if (v === true) next.add(f.externalId);
                        else next.delete(f.externalId);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{f.name}</span>
                  <span className="shrink-0 truncate text-[11px] text-subtle-foreground">
                    {f.containerPath}
                  </span>
                  <span className="tnum w-12 shrink-0 text-right text-[11px] text-subtle-foreground">
                    {fmtDuration(f.durationMs) ?? bytes(f.fileSize) ?? ""}
                  </span>
                  {f.alreadyInLibrary && (
                    <span className="shrink-0 text-[10.5px] text-subtle-foreground">
                      Already in library
                    </span>
                  )}
                </label>
              ))
            )}
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        {items && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto"
              onClick={() => setItems(null)}
            >
              Back to browsing
            </Button>
            <span className="text-[12px] text-subtle-foreground">
              {chosen.size} of {selectable.length} selected
            </span>
            <Button size="lg" disabled={busy || chosen.size === 0} onClick={importChosen}>
              {busy && <Loader2 className="animate-spin" />}
              Import {chosen.size}
            </Button>
          </>
        )}
      </DialogFooter>
    </div>
  );
}
