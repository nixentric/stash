import type { Accessibility, MediaType } from "./types";

/** `00:14`, `1:02:33`. Tabular numerals keep grid cards from jittering. */
export function duration(ms: number | null | undefined): string | null {
  if (ms == null || ms < 0) return null;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function bytes(n: number | null | undefined): string | null {
  if (n == null || n < 0) return null;
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function resolution(w: number | null, h: number | null): string | null {
  return w && h ? `${w} × ${h}` : null;
}

const DATE = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function date(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DATE.format(d);
}

export function relativeDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return DATE.format(d);
}

export function count(n: number): string {
  return n.toLocaleString();
}

export const providerLabel: Record<string, string> = {
  google_drive: "Google Drive",
  local: "This computer",
  url: "Web link",
};

export const mediaLabel: Record<MediaType, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  other: "File",
  unknown: "Unknown",
};

/**
 * User-facing wording for source state.
 *
 * The `permission_required` / `source_missing` split is the point: a private
 * file must never be described as missing (§23).
 */
export const accessibilityLabel: Record<
  Accessibility,
  { label: string; tone: "ok" | "warn" | "muted" } | null
> = {
  available: null,
  preview_available: null,
  unknown: null,
  authentication_required: { label: "Connect Drive for full access", tone: "muted" },
  permission_required: { label: "No access to this source", tone: "warn" },
  offline: { label: "Offline", tone: "muted" },
  source_missing: { label: "Source missing", tone: "warn" },
};

// ── colour ──────────────────────────────────────────────────────────────────

/** `#RRGGBB` → `[r, g, b]`. Returns null for anything that is not a hex colour. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const raw = hex.trim().replace(/^#/, "");
  const full = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Naive device-independent CMYK, the same arithmetic Figma and CSS pickers show.
 *
 * ponytail: no ICC profile, so this is a reference value for talking to a
 * printer, not a proof. Real separation depends on paper and press; swap in a
 * colour-managed conversion only if someone is actually printing from here.
 */
export function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const [rf, gf, bf] = [r / 255, g / 255, b / 255];
  const k = 1 - Math.max(rf, gf, bf);
  if (k === 1) return [0, 0, 0, 100];
  const pct = (v: number) => Math.round(((1 - v - k) / (1 - k)) * 100);
  return [pct(rf), pct(gf), pct(bf), Math.round(k * 100)];
}

/** The three copyable representations of a swatch. */
export function colorFormats(hex: string): { hex: string; rgb: string; cmyk: string } | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  const [c, m, y, k] = rgbToCmyk(r, g, b);
  return {
    hex: hex.trim().toUpperCase().startsWith("#") ? hex.trim().toUpperCase() : `#${hex.trim().toUpperCase()}`,
    rgb: `rgb(${r}, ${g}, ${b})`,
    cmyk: `${c}, ${m}, ${y}, ${k}`,
  };
}

/** White or black body text, whichever stays legible on `hex` (WCAG relative luminance). */
export function readableOn(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#000000";
  const linear = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
  return luminance > 0.179 ? "#000000" : "#FFFFFF";
}
