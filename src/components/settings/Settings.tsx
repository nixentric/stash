import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DotmCircular2 } from "@/components/ui/dotm-circular-2";
import {
  Check,
  ChevronRight,
  Cloud,
  Download,
  ExternalLink,
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
import { emptyQuery } from "@/lib/types";
import type { PortableThumbnailSize, Theme } from "@/lib/types";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { Update } from "@tauri-apps/plugin-updater";

type Pane = "general" | "appearance" | "library" | "preview" | "integrations";

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
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Pane({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[14px] font-semibold tracking-[-0.01em]">{title}</h2>
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
  const [status, setStatus] = useState<Update | 'latest' | null>(null);
  const [checking, setChecking] = useState(false);

  const checkUpdates = prefs.data?.checkUpdates ?? true;

  async function check() {
    setChecking(true);
    try {
      const update = await checkUpdate();
      setStatus(update || 'latest');
    } catch (e) {
      reportError(e, "Could not reach the update server");
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

            {status && status !== 'latest' && (
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

function LibraryPane() {
  const qc = useQueryClient();
  const prefs = usePrefs();
  const size = prefs.data?.portableThumbnailSize ?? "standard";

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
    </Pane>
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
              toast.success("Preview cache cleared");
            }}
          >
            Clear cache
          </Button>
        </div>
      </Field>

      <Field
        label="Rebuild thumbnails"
        hint="Re-encodes every thumbnail in the library from its source. Worth doing once after an update that changes how previews are made — logos with transparent backgrounds keep their transparency now, and older thumbnails were flattened."
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

      {s?.clientIdSource === "settings" && !s.configured && (
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
