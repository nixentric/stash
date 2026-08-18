import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { toast } from "sonner";
import { DotmCircular2 } from "@/components/ui/dotm-circular-2";
import {
  Check,
  ChevronRight,
  Cloud,
  Download,
  ExternalLink,
  FolderOpen,
  Heart,
  KeyRound,
  Loader2,
  Monitor,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Separator } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { bytes } from "@/lib/format";
import { ipc } from "@/lib/ipc";
import { invalidateLibrary, keys, reportError, useGoogleStatus, usePrefs } from "@/hooks/queries";
import { applyTheme } from "@/lib/theme";
import licenses from "@/lib/licenses.json";
import { emptyQuery } from "@/lib/types";
import { ADD_FOOTAGE_TABS } from "@/components/dialogs/AddFootageDialog";
import type { GoogleStatus, PortableThumbnailSize, Theme } from "@/lib/types";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { Update } from "@tauri-apps/plugin-updater";
import { thumbsChanged } from "@/lib/thumbs";
import { pendingPlatform, pendingUpdateNote } from "@/lib/updates";

type Pane = "general" | "appearance" | "library" | "preview" | "integrations" | "license" | "support";

export function Settings({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
}) {
  const [pane, setPane] = useState<Pane>("general");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[32rem] w-[min(52rem,94vw)] max-w-none gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Settings</DialogTitle>

        <nav className="w-[11rem] shrink-0 bg-sidebar p-2 hairline-r">
          <p className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">
            Settings
          </p>
          {(
            [
              ["general", "General"],
              ["appearance", "Appearance"],
              ["library", "Library"],
              ["preview", "Preview"],
              ["integrations", "Integrations"],
              ["license", "License"],
              // The one item that asks for something rather than configuring
              // something, so it carries a mark to set it apart from the rest.
              ["support", "Support"],
            ] as [Pane, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setPane(id)}
              className={cn(
                "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px]",
                "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                pane === id
                  ? "bg-accent font-medium"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {id === "support" && <Heart className="size-3.5 fill-[#FF5E5B] text-[#FF5E5B]" />}
              {label}
              {pane === id && <ChevronRight className="ml-auto size-3 opacity-50" />}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto p-5">
          {pane === "general" && <GeneralPane />}
          {pane === "appearance" && <AppearancePane />}
          {pane === "library" && <LibraryPane />}
          {pane === "preview" && <PreviewPane />}
          {pane === "integrations" && <IntegrationsPane />}
          {pane === "license" && <LicensePane />}
          {pane === "support" && <SupportPane />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Pane({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    // Wide gap between settings, pulled back under the heading: the space is
    // what groups a label with its own control rather than the next one down.
    <div className="flex flex-col gap-7">
      <h2 className="-mb-3 text-[14px] font-semibold tracking-[-0.01em]">{title}</h2>
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <p className="text-[12.5px] font-medium">{label}</p>
        {hint && (
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{hint}</p>
        )}
      </div>
      {children}
    </div>
  );
}

// ── panes ───────────────────────────────────────────────────────────────────

function GeneralPane() {
  const qc = useQueryClient();
  const prefs = usePrefs();
  const [status, setStatus] = useState<Update | "latest" | { pending: string } | null>(null);
  const [checking, setChecking] = useState(false);
  // Asked once: the running binary's version cannot change while it runs.
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(console.error);
  }, []);

  const checkUpdates = prefs.data?.checkUpdates ?? true;

  async function check() {
    setChecking(true);
    try {
      const update = await checkUpdate();
      setStatus(update || 'latest');
    } catch (e) {
      // "There is a version, yours is still uploading" is not a failure to
      // report as one — it is an answer, and it belongs where the question was
      // asked rather than in an error toast.
      const pending = pendingPlatform(e);
      if (pending) setStatus({ pending });
      else reportError(e, "Could not reach the update server");
    } finally {
      setChecking(false);
    }
  }

  return (
    <Pane title="General">
      <div className="rounded-md border border-border bg-muted/40 p-3">
        <p className="flex items-center gap-1.5 text-[12.5px] font-medium">
          <ShieldCheck className="size-3.5 text-success" />
          Local and private
        </p>
        <ul className="mt-1.5 flex flex-col gap-1 text-[12px] leading-relaxed text-muted-foreground">
          <li>No telemetry, no analytics, no crash reporting.</li>
          <li>Your library never leaves this computer.</li>
          <li>
            Network requests happen only when you connect Google Drive, ask for a preview, or
            when the update check below is switched on.
          </li>
        </ul>
      </div>

      <Field
        label="Updates"
        hint="Stash checks for newer releases and can download and install them directly in the app. Switch this off and Stash never contacts the update server at all."
      >
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] text-muted-foreground">
            You are running <span className="font-medium text-foreground">Stash {version ?? "…"}</span>
          </p>

          <label className="flex cursor-pointer items-center gap-2 text-[12.5px]">
            <input
              type="checkbox"
              checked={checkUpdates}
              onChange={async (e) => {
                await ipc.setPrefs({ checkUpdates: e.target.checked });
                qc.invalidateQueries({ queryKey: keys.prefs });
                if (!e.target.checked) setStatus(null);
              }}
              className="size-3.5 cursor-pointer accent-primary"
            />
            Check for updates when Stash starts
          </label>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={check} disabled={checking}>
              <RefreshCw className={cn("size-3.5", checking && "animate-spin")} />
              {checking ? "Checking…" : "Check now"}
            </Button>

            {status && status !== 'latest' && !("pending" in status) && (
              <Button size="sm" onClick={async () => {
                const id = toast.loading(
                   <div className="flex items-center gap-3 py-1">
                     <DotmCircular2 size={28} colorPreset="solid-mint" className="shrink-0" ariaLabel="Downloading update" />
                     <span className="text-[13px]">Downloading update...</span>
                   </div>
                 );
                 try {
                   let downloaded = 0;
                   let contentLength = 0;
                   await status.downloadAndInstall((e) => {
                     if (e.event === 'Started') contentLength = e.data.contentLength || 0;
                     else if (e.event === 'Progress') {
                       downloaded += e.data.chunkLength;
                       if (contentLength > 0) {
                         toast.loading(
                           <div className="flex items-center gap-3 py-1">
                             <DotmCircular2 size={28} colorPreset="solid-mint" className="shrink-0" ariaLabel="Downloading update" />
                             <span className="text-[13px]">Downloading update... {Math.round((downloaded / contentLength) * 100)}%</span>
                           </div>,
                           { id }
                         );
                       }
                     }
                     else if (e.event === 'Finished') {
                       toast.loading(
                         <div className="flex items-center gap-3 py-1">
                           <DotmCircular2 size={28} colorPreset="solid-mint" className="shrink-0" ariaLabel="Downloading update" />
                           <span className="text-[13px]">Installing...</span>
                         </div>,
                         { id }
                       );
                     }
                   });
                  toast.success("Update installed!", { id });
                  await relaunch();
                } catch (e) {
                  toast.error(`Update failed: ${e}`, { id });
                }
              }}>
                <Download /> Get {status.version}
              </Button>
            )}
            {status === 'latest' && (
              <span className="text-[12px] text-muted-foreground">
                You are on the latest version.
              </span>
            )}
          </div>

          {status && status !== 'latest' && "pending" in status && (
            <div className="rounded-md border border-warning/30 bg-warning/5 p-2.5">
              <p className="text-[12.5px] font-medium">{pendingUpdateNote(status.pending).title}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                {pendingUpdateNote(status.pending).body}
              </p>
            </div>
          )}
        </div>
      </Field>

      <Field
        label="Changes are saved automatically"
        hint="Every edit commits to the library file immediately. There is no unsaved state to lose. Use Save a Copy from the library menu to snapshot or share it."
      >
        <span />
      </Field>
    </Pane>
  );
}

/**
 * The only pane that asks for something instead of setting something, so it is
 * allowed the one loud button in the app — Ko-fi's own red rather than the
 * app's primary, because it is a link out to Ko-fi, not a Stash action.
 */
/**
 * Who else built this.
 *
 * Direct dependencies only, with the version Stash is actually built against —
 * the full transitive tree runs to thousands of names, and a list nobody reads
 * credits nobody. libheif and libde265 are listed apart because they are C
 * libraries under the LGPL: that licence asks for the notice, and they are the
 * reason iPhone photos show up on Windows and Linux at all.
 */
function LicensePane() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(console.error);
  }, []);

  return (
    <Pane title="License">
      <div className="rounded-md border border-border bg-muted/40 p-3">
        <p className="text-[12.5px] font-medium">
          Stash {version ?? "…"} — MIT
        </p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
          Yours to use, change, and pass on. The source is all there, and so is everything below:
          Stash is mostly other people's work, held together. Thank you to everyone who wrote a
          line of it — this app would not exist without you.
        </p>
        <button
          type="button"
          onClick={() =>
            ipc.openExternal("https://github.com/nixentric/stash/blob/main/LICENSE").catch(reportError)
          }
          className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-foreground
                     underline-offset-2 outline-none hover:underline
                     focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Read the license
          <ExternalLink className="size-3" />
        </button>
      </div>

      <LicenseList
        title="Bundled libraries"
        hint="Shipped inside the Windows and Linux builds. macOS decodes HEIC on its own and carries neither."
        items={licenses.native}
      />
      <LicenseList title="Rust crates" items={licenses.rust} />
      <LicenseList title="Web packages" items={licenses.node} />
    </Pane>
  );
}

function LicenseList({
  title,
  hint,
  items,
}: {
  title: string;
  hint?: string;
  items: { name: string; version: string; license: string; url: string; note?: string }[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-[12.5px] font-medium">
          {title} <span className="text-subtle-foreground">· {items.length}</span>
        </p>
        {hint && <p className="mt-0.5 text-[11.5px] text-subtle-foreground">{hint}</p>}
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        {items.map((it, i) => (
          <button
            key={`${it.name}@${it.version}`}
            type="button"
            onClick={() => ipc.openExternal(it.url).catch(reportError)}
            title={it.url}
            className={cn(
              "group flex w-full items-baseline gap-2 px-3 py-1.5 text-left outline-none",
              "hover:bg-accent/60 focus-visible:bg-accent/60",
              i > 0 && "hairline-t",
            )}
          >
            <span className="shrink-0 text-[12px] font-medium">{it.name}</span>
            <span className="tnum shrink-0 text-[11.5px] text-subtle-foreground">{it.version}</span>
            {it.note && (
              <span className="truncate text-[11.5px] text-muted-foreground">{it.note}</span>
            )}
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{it.license}</span>
            <ExternalLink className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-50" />
          </button>
        ))}
      </div>
    </div>
  );
}

function SupportPane() {
  return (
    <Pane title="Support Stash">
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        Stash is built by one person, in the open, for free. No paid tier, no accounts, no
        telemetry — and no plan to add any.
      </p>

      <button
        type="button"
        onClick={() => ipc.openExternal("https://ko-fi.com/nixentric").catch(reportError)}
        className="group relative w-full overflow-hidden rounded-xl bg-gradient-to-r
                   from-[#FF5E5B] via-[#FF7A5B] to-[#FFA25B] px-5 py-3.5 text-[13.5px] font-semibold
                   text-white shadow-lg shadow-[#FF5E5B]/25 outline-none transition-all
                   hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[#FF5E5B]/40
                   focus-visible:ring-2 focus-visible:ring-[#FF5E5B]/60 focus-visible:ring-offset-2
                   focus-visible:ring-offset-background active:translate-y-0 active:scale-[0.99]"
      >
        {/* Sweeps across on hover; parked off the left edge the rest of the time. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r
                     from-transparent via-white/25 to-transparent transition-transform duration-700
                     group-hover:translate-x-full"
        />
        <span className="relative flex items-center justify-center gap-2">
          <Heart className="size-4 fill-current transition-transform duration-300 group-hover:scale-125" />
          Buy me a coffee on Ko-fi
          <ExternalLink className="size-3.5 opacity-70" />
        </span>
      </button>

      <div className="rounded-md border border-border bg-muted/40 p-3">
        <p className="flex items-center gap-1.5 text-[12.5px] font-medium">
          <ShieldCheck className="size-3.5 text-success" />
          What the money is for
        </p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
          An Apple Developer membership, <span className="font-medium text-foreground">$99/year</span>.
          Stash's builds are unsigned, which is why macOS warns you on first launch — and why, because
          every unsigned build gets a different code identity, the keychain stops recognising Stash
          after an update and asks for your login password all over again. Signing and notarising is
          what makes both stop, and that membership is the only thing standing in the way.
        </p>
      </div>

      <p className="text-[11.5px] leading-relaxed text-subtle-foreground">
        Nothing here is gated behind it. Whether or not anyone chips in, Stash stays MIT-licensed,
        offline, and complete.
      </p>
    </Pane>
  );
}

function AppearancePane() {
  const qc = useQueryClient();
  const prefs = usePrefs();
  const theme = prefs.data?.theme ?? "system";

  async function set(t: Theme) {
    applyTheme(t);
    await ipc.setPrefs({ theme: t });
    qc.invalidateQueries({ queryKey: keys.prefs });
  }

  return (
    <Pane title="Appearance">
      <Field label="Theme">
        <div className="flex gap-1.5">
          {(
            [
              ["light", "Light", <Sun key="s" className="size-3.5" />],
              ["dark", "Dark", <Moon key="m" className="size-3.5" />],
              ["system", "System", <Monitor key="y" className="size-3.5" />],
            ] as [Theme, string, React.ReactNode][]
          ).map(([id, label, icon]) => (
            <button
              key={id}
              onClick={() => set(id)}
              className={cn(
                "flex flex-1 flex-col items-center gap-1.5 rounded-md border p-3 transition-colors",
                theme === id
                  ? "border-primary/70 bg-selection"
                  : "border-border hover:border-border-strong hover:bg-accent/50",
              )}
            >
              {icon}
              <span className="text-[12px]">{label}</span>
            </button>
          ))}
        </div>
      </Field>
    </Pane>
  );
}

/**
 * Whether the OAuth client is actually usable, at a glance.
 *
 * The section used to look identical whether nothing was saved, half of it was,
 * or all of it — and half of it is the state that fails at connect time with no
 * hint as to why.
 */
function ClientBadge({ status }: { status: GoogleStatus }) {
  const hasId = status.clientIdSource !== "none";

  if (!hasId && !status.clientSecretSaved) {
    return <Badge tone="unused">Not set</Badge>;
  }
  if (!hasId) return <Badge tone="warn">Client ID missing</Badge>;
  if (!status.clientSecretSaved) return <Badge tone="warn">Secret missing</Badge>;
  return (
    <Badge tone="used">
      <Check className="size-2.5" />
      Saved
    </Badge>
  );
}

function LibraryPane() {
  const qc = useQueryClient();
  const prefs = usePrefs();
  const size = prefs.data?.portableThumbnailSize ?? "standard";
  const addTab = prefs.data?.addFootageTab ?? "links";

  const options: [PortableThumbnailSize, string, string][] = [
    ["standard", "Standard — 480 px", "Best balance. About 35 KB per item."],
    ["small", "Small — 320 px", "Roughly half the size. Good for very large libraries."],
    ["none", "Don't embed", "Smallest file. Previews will not travel with the library."],
  ];

  return (
    <Pane title="Library">
      <Field
        label="Portable thumbnails"
        hint="Small previews stored inside the .footagedb file. They are what lets someone else open your library and immediately see the footage, even without a Google account."
      >
        <div className="flex flex-col gap-1">
          {options.map(([id, label, hint]) => (
            <button
              key={id}
              onClick={async () => {
                await ipc.setPrefs({ portableThumbnailSize: id });
                qc.invalidateQueries({ queryKey: keys.prefs });
              }}
              className={cn(
                "flex items-start gap-2 rounded-md border p-2.5 text-left transition-colors",
                size === id
                  ? "border-primary/70 bg-selection"
                  : "border-border hover:border-border-strong hover:bg-accent/50",
              )}
            >
              <Check
                className={cn(
                  "mt-0.5 size-3.5 shrink-0 text-primary",
                  size !== id && "opacity-0",
                )}
              />
              <span>
                <span className="block text-[12.5px] font-medium">{label}</span>
                <span className="block text-[11.5px] text-muted-foreground">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      </Field>

      <Field
        label="Add Footage opens on"
        hint="Which tab the Add Footage dialog starts on. The pin next to its tabs sets this too."
      >
        <div className="flex gap-1.5">
          {ADD_FOOTAGE_TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={async () => {
                await ipc.setPrefs({ addFootageTab: id });
                qc.invalidateQueries({ queryKey: keys.prefs });
              }}
              className={cn(
                "flex-1 rounded-md border p-2 text-[12px] transition-colors",
                addTab === id
                  ? "border-primary/70 bg-selection"
                  : "border-border hover:border-border-strong hover:bg-accent/50",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>

      <DownloadsField />
    </Pane>
  );
}

/**
 * Where originals land when they are downloaded, and whether that happens on
 * its own. The folder defaults to `Downloaded/` beside the library file, so a
 * library carried to another machine carries its files with it.
 */
function DownloadsField() {
  const qc = useQueryClient();
  const prefs = usePrefs();
  const dir = useQuery({ queryKey: ["downloadDir"], queryFn: ipc.downloadDir, retry: false });
  const auto = prefs.data?.autoDownload ?? false;

  async function pick() {
    const chosen = await openDialog({ directory: true, multiple: false, title: "Downloads folder" });
    if (typeof chosen !== "string") return;
    try {
      await ipc.setDownloadDir(chosen);
      qc.invalidateQueries({ queryKey: ["downloadDir"] });
      qc.invalidateQueries({ queryKey: keys.prefs });
      toast.success("Downloads folder moved");
    } catch (e) {
      reportError(e, "Could not move the downloads folder");
    }
  }

  return (
    <Field
      label="Downloads"
      hint="Previewing a Drive file goes through Google's viewer. Downloading keeps the original next to your library, and the preview then opens that file — full quality, and it still works with the account disconnected."
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[11.5px]">
            {dir.data ?? "Open a library to see the folder"}
          </code>
          <Button size="sm" variant="secondary" onClick={pick} disabled={!dir.data}>
            <FolderOpen className="size-3.5" />
            Change…
          </Button>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-[12.5px]">
          <input
            type="checkbox"
            checked={auto}
            onChange={async (e) => {
              await ipc.setPrefs({ autoDownload: e.target.checked });
              qc.invalidateQueries({ queryKey: keys.prefs });
            }}
            className="size-3.5 cursor-pointer accent-primary"
          />
          Download the original as soon as a footage is opened
        </label>
      </div>
    </Field>
  );
}

function PreviewPane() {
  const [info, setInfo] = useState<number | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    ipc.cacheInfo().then((i) => setInfo(i.bytesOnDisk)).catch(() => {});
  }, []);

  return (
    <Pane title="Preview">
      <Field
        label="Local preview cache"
        hint="Larger previews kept on this computer for Quick Look. Safe to clear at any time — the thumbnails inside your library are separate and are not affected."
      >
        <div className="flex items-center gap-2">
          <span className="tnum text-[12.5px] text-muted-foreground">
            {info != null ? (bytes(info) ?? "0 B") : "…"}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              await ipc.clearPreviewCache();
              const i = await ipc.cacheInfo();
              setInfo(i.bytesOnDisk);
              qc.invalidateQueries({ queryKey: ["thumb"] });
              thumbsChanged();
              toast.success("Preview cache cleared");
            }}
          >
            Clear cache
          </Button>
        </div>
      </Field>

      <Field
        label="Rebuild thumbnails"
        hint="Re-fetches every thumbnail in the library from its source. Worth doing once after an update that changes how previews are made — Drive is now asked for a 960 px rendition instead of the 220 px one it offers by default, so anything stored before this will look soft next to a new one."
      >
        <Button
          variant="secondary"
          size="sm"
          disabled={rebuilding}
          onClick={async () => {
            setRebuilding(true);
            try {
              // Brand logos are the ones that most need re-encoding, and they are
              // hidden from ordinary listings.
              const ids = await ipc.listFootageIds({ ...emptyQuery(), includeBrandLogos: true });
              toast.info(`Rebuilding ${ids.length} thumbnail(s)…`);
              const n = await ipc.fetchThumbnails(ids, true);
              qc.invalidateQueries({ queryKey: ["thumb"] });
              thumbsChanged();
              invalidateLibrary(qc);
              toast.success(`Rebuilt ${n} of ${ids.length} thumbnail(s)`);
            } catch (e) {
              reportError(e, "Could not rebuild thumbnails");
            } finally {
              setRebuilding(false);
            }
          }}
        >
          {rebuilding ? "Rebuilding…" : "Rebuild all"}
        </Button>
      </Field>
    </Pane>
  );
}

// ── integrations ────────────────────────────────────────────────────────────

function IntegrationsPane() {
  const qc = useQueryClient();
  const status = useGoogleStatus();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status.data?.clientIdSource === "none") setShowSetup(true);
  }, [status.data?.clientIdSource]);

  const s = status.data;

  async function connect() {
    setBusy(true);
    try {
      const account = await ipc.googleConnect();
      await qc.invalidateQueries();
      toast.success(`Connected as ${account.email ?? "your Google account"}`);
    } catch (e) {
      reportError(e, "Could not connect");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pane title="Google Drive">
      {/* Link mode is the product; it is stated first and framed as complete. */}
      <div className="rounded-md border border-border p-3">
        <div className="flex items-center justify-between">
          <p className="text-[12.5px] font-medium">Basic link mode</p>
          <Badge tone="used">
            <Check className="size-2.5" />
            Always available
          </Badge>
        </div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
          Paste Drive links, organize, tag, track usage, set your own thumbnails, and open
          files in Drive. No Google account or Cloud project required.
        </p>
      </div>

      <Separator />

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium">
            <Cloud className="size-3.5" />
            Advanced integration
            <span className="font-normal text-subtle-foreground">Optional</span>
          </p>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            Status:{" "}
            <span className={s?.connected ? "text-success" : "text-muted-foreground"}>
              {s?.connected ? "Connected" : "Not connected"}
            </span>
            {s?.account?.email && ` · ${s.account.email}`}
          </p>
        </div>
        {s?.connected ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              await ipc.googleDisconnect();
              await qc.invalidateQueries();
              toast.success("Disconnected. Your library is unchanged.");
            }}
          >
            Disconnect
          </Button>
        ) : (
          <Button size="sm" disabled={busy || !s?.configured} onClick={connect}>
            {busy && <Loader2 className="animate-spin" />}
            Connect Google Drive
          </Button>
        )}
      </div>

      <ul className="flex flex-col gap-1 text-[12px] text-muted-foreground">
        {[
          "Browse and scan Drive folders",
          "Automatic thumbnails and metadata",
          "Detect renamed, moved and deleted files",
          "Preview private files you have access to",
        ].map((f) => (
          <li key={f} className="flex items-center gap-1.5">
            <Check className="size-3 text-success" />
            {f}
          </li>
        ))}
      </ul>

      {s && s.clientIdSource !== "none" && !s.clientSecretSaved && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
          A Google client ID is saved, but its client secret is missing. Expand OAuth client and
          save both values from your Google OAuth Desktop client before connecting.
        </p>
      )}

      {s && !s.keychainAvailable && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
          No system keychain was found. You can still connect, but the sign-in will not
          survive a restart. Stash will not write credentials to disk.
        </p>
      )}

      <Separator />

      {/* Credentials pane — the only place "not configured" is ever mentioned. */}
      <div>
        <button
          onClick={() => setShowSetup((v) => !v)}
          className="flex items-center gap-1.5 text-[12.5px] font-medium"
        >
          <KeyRound className="size-3.5" />
          OAuth client
          {s && <ClientBadge status={s} />}
          <ChevronRight
            className={cn("size-3 transition-transform", showSetup && "rotate-90")}
          />
        </button>

        {showSetup && (
          <div className="mt-2 flex flex-col gap-2.5">
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              {s?.clientIdSource === "environment"
                ? "Using the client ID from your environment variables. Set STASH_GOOGLE_CLIENT_SECRET too before connecting."
                : "Advanced integration needs your own Google OAuth client (Desktop app type). Paste both its client ID and client secret below."}
            </p>

            {s?.secretsTemporary && (
              <p className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
                Development build. The client secret is kept in a temporary file
                instead of the keychain, so it disappears whenever the system clears
                temporary files — and this build cannot see what the released app
                saved. Paste both values again here when that happens.
              </p>
            )}

            {s?.clientIdSource !== "environment" && (
              <>
                <Input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="xxxxx.apps.googleusercontent.com"
                  spellCheck={false}
                />
                <Input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="Client secret (stored in your system keychain)"
                  spellCheck={false}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!clientId.trim() || !clientSecret.trim()}
                    onClick={async () => {
                      try {
                        await ipc.googleSetClient(
                          clientId.trim(),
                          clientSecret.trim() || null,
                        );
                        setClientSecret("");
                        await qc.invalidateQueries({ queryKey: keys.google });
                        toast.success("OAuth client saved");
                      } catch (e) {
                        reportError(e);
                      }
                    }}
                  >
                    Save client
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      ipc
                        .openExternal("https://console.cloud.google.com/apis/credentials")
                        .catch(reportError)
                    }
                  >
                    <ExternalLink />
                    Google Cloud Console
                  </Button>
                  {s?.clientIdSource === "settings" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        await ipc.googleClearClient();
                        await qc.invalidateQueries();
                        toast.success("OAuth client removed");
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Pane>
  );
}
