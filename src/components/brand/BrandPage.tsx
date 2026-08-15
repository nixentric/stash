import { useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  Palette,
  Pencil,
  Plus,
  Trash2,
  Type as TypeIcon,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBrand, useBrandAction, useFootageDetail } from "@/hooks/queries";
import { colorFormats, readableOn } from "@/lib/format";
import { COLOR_ROLES, LOGO_VARIANTS, TYPE_ROLES } from "@/lib/types";
import type { Brand, BrandColor, BrandLogo, BrandTypeface } from "@/lib/types";
import { ipc } from "@/lib/ipc";
import { reportError } from "@/hooks/queries";

/** Copy-to-clipboard button that confirms itself, so a click never feels lost. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      title={`Copy ${label}`}
      onClick={async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Check /> : <Copy />}
      {label}
    </Button>
  );
}

/** Groups entries by role, in the canonical order, dropping empty roles. */
function byRole<T extends { role: string }>(items: T[], order: readonly string[]) {
  const known = order.map((role) => [role, items.filter((i) => i.role === role)] as const);
  const extra = items.filter((i) => !order.includes(i.role));
  const groups = known.filter(([, list]) => list.length > 0);
  return extra.length > 0 ? [...groups, ["other", extra] as const] : groups;
}

function Swatch({
  color,
  onEdit,
  onDelete,
}: {
  color: BrandColor;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const formats = colorFormats(color.hex);

  return (
    <div className="group overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        title={`Copy ${color.hex}`}
        onClick={async () => {
          await navigator.clipboard.writeText(color.hex);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="flex h-24 w-full cursor-pointer items-end justify-between p-2 transition-opacity hover:opacity-95"
        style={{ backgroundColor: color.hex, color: readableOn(color.hex) }}
      >
        <span className="text-[11px] font-medium opacity-80">{copied ? "Copied" : color.hex}</span>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5 opacity-0 group-hover:opacity-70" />}
      </button>

      <div className="space-y-1 p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-medium">{color.name}</span>
          <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
            <Button size="sm" variant="ghost" title="Edit colour" onClick={onEdit}>
              <Pencil />
            </Button>
            <Button size="sm" variant="ghost" title="Delete colour" onClick={onDelete}>
              <Trash2 />
            </Button>
          </div>
        </div>
        {formats && (
          <div className="space-y-px text-[11px] text-muted-foreground">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate">{formats.rgb}</span>
              <CopyButton value={formats.rgb} label="RGB" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate">CMYK {formats.cmyk}</span>
              <CopyButton value={formats.cmyk} label="CMYK" />
            </div>
          </div>
        )}
        {color.notes && <p className="text-[11px] text-subtle-foreground">{color.notes}</p>}
      </div>
    </div>
  );
}

function TypeRow({
  face,
  sample,
  onEdit,
  onDelete,
}: {
  face: BrandTypeface;
  sample: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
            <span className="font-medium">{face.family}</span>
            {face.weight && <span className="text-muted-foreground">{face.weight}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-subtle-foreground">
            {face.size && <span>size {face.size}</span>}
            {face.lineHeight && <span>line height {face.lineHeight}</span>}
            {face.letterSpacing && <span>tracking {face.letterSpacing}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <CopyButton value={face.family} label="Font" />
          <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
            <Button size="sm" variant="ghost" title="Edit style" onClick={onEdit}>
              <Pencil />
            </Button>
            <Button size="sm" variant="ghost" title="Delete style" onClick={onDelete}>
              <Trash2 />
            </Button>
          </div>
        </div>
      </div>

      {/* The font is only rendered if the machine actually has it; otherwise this
          falls back, which is itself useful information. */}
      <p
        className="mt-2 truncate text-[22px] leading-tight"
        style={{
          fontFamily: `"${face.family}", system-ui, sans-serif`,
          fontWeight: /\d{3}/.test(face.weight) ? Number(face.weight.match(/\d{3}/)![0]) : undefined,
          letterSpacing: face.letterSpacing || undefined,
        }}
      >
        {sample}
      </p>
      {face.notes && <p className="mt-1 text-[11px] text-subtle-foreground">{face.notes}</p>}
    </div>
  );
}

function LogoRow({
  logo,
  onEdit,
  onDelete,
}: {
  logo: BrandLogo;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const asset = useFootageDetail(logo.footageId);
  const source = asset.data?.source;

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border p-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{logo.name}</div>
        <div className="truncate text-[11px] text-subtle-foreground">
          {logo.footageId == null
            ? "No file linked"
            : (asset.data?.displayName ?? "Linked asset")}
        </div>
        {logo.notes && <p className="mt-1 text-[11px] text-subtle-foreground">{logo.notes}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {source?.localPath && (
          <Button
            size="sm"
            variant="ghost"
            title="Reveal in file manager"
            onClick={() => ipc.revealInFileManager(source.localPath!).catch(reportError)}
          >
            <FolderOpen /> Reveal
          </Button>
        )}
        {source?.originalUrl && (
          <Button
            size="sm"
            variant="ghost"
            title="Open source"
            onClick={() => ipc.openExternal(source.originalUrl!).catch(reportError)}
          >
            <ExternalLink /> Open
          </Button>
        )}
        <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
          <Button size="sm" variant="ghost" title="Edit logo" onClick={onEdit}>
            <Pencil />
          </Button>
          <Button size="sm" variant="ghost" title="Delete logo" onClick={onDelete}>
            <Trash2 />
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The 10% of a guideline that gets used 90% of the time: the first colours, the
 * first two type styles, and the logos — each one click from copy or open.
 */
function QuickKit({
  colors,
  typefaces,
  logos,
}: {
  colors: BrandColor[];
  typefaces: BrandTypeface[];
  logos: BrandLogo[];
}) {
  if (colors.length === 0 && typefaces.length === 0 && logos.length === 0) return null;

  return (
    <section className="mb-6 rounded-lg border border-border bg-muted/30 p-4">
      <h2 className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">
        <Zap className="size-3.5" /> Quick Brand Kit
      </h2>

      <div className="grid gap-4 sm:grid-cols-3">
        {colors.length > 0 && (
          <div className="space-y-1">
            {colors.slice(0, 4).map((c) => (
              <div key={c.id} className="flex items-center gap-2">
                <span
                  className="size-4 shrink-0 rounded border border-border"
                  style={{ backgroundColor: c.hex }}
                />
                <span className="min-w-0 flex-1 truncate text-[12px]">{c.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{c.hex}</span>
                <CopyButton value={c.hex} label="" />
              </div>
            ))}
          </div>
        )}

        {typefaces.length > 0 && (
          <div className="space-y-1">
            {typefaces.slice(0, 4).map((t) => (
              <div key={t.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px]">
                  {t.family} {t.weight}
                </span>
                <CopyButton value={`${t.family} ${t.weight}`.trim()} label="" />
              </div>
            ))}
          </div>
        )}

        {logos.length > 0 && (
          <div className="space-y-1">
            {logos.slice(0, 4).map((l) => (
              <QuickLogo key={l.id} logo={l} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function QuickLogo({ logo }: { logo: BrandLogo }) {
  const asset = useFootageDetail(logo.footageId);
  const url = asset.data?.source.originalUrl;
  const path = asset.data?.source.localPath;

  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-[12px]">{logo.name}</span>
      {path ? (
        <Button size="sm" variant="ghost" onClick={() => ipc.revealInFileManager(path).catch(reportError)}>
          <FolderOpen /> Open
        </Button>
      ) : url ? (
        <Button size="sm" variant="ghost" onClick={() => ipc.openExternal(url).catch(reportError)}>
          <ExternalLink /> Open
        </Button>
      ) : null}
    </div>
  );
}

interface Props {
  brandId: number;
  onEditBrand: (brand: Brand) => void;
  onEditColor: (color: BrandColor) => void;
  onEditTypeface: (typeface: BrandTypeface) => void;
  onEditLogo: (logo: BrandLogo) => void;
}

export function BrandPage({ brandId, onEditBrand, onEditColor, onEditTypeface, onEditLogo }: Props) {
  const detail = useBrand(brandId);
  const action = useBrandAction();
  const [sample, setSample] = useState("Promo Agustus");

  const d = detail.data;
  if (!d) return <div className="p-6 text-[13px] text-muted-foreground">Loading…</div>;

  const blank = { id: 0, brandId, notes: "", position: 0 };

  return (
    <div className="h-full overflow-y-auto p-6">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{d.brand.name}</h1>
          {d.brand.tagline && (
            <p className="mt-0.5 text-[13px] text-muted-foreground">{d.brand.tagline}</p>
          )}
          {d.brand.description && (
            <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">{d.brand.description}</p>
          )}
          {d.brand.website && (
            <button
              type="button"
              onClick={() => ipc.openExternal(d.brand.website).catch(reportError)}
              className="mt-1 cursor-pointer text-[13px] text-primary hover:underline"
            >
              {d.brand.website}
            </button>
          )}
        </div>
        <Button size="sm" variant="secondary" onClick={() => onEditBrand(d.brand)}>
          <Pencil /> Edit brand
        </Button>
      </header>

      <QuickKit colors={d.colors} typefaces={d.typefaces} logos={d.logos} />

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Palette className="size-4" /> Colors
          </h2>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onEditColor({ ...blank, role: "primary", name: "", hex: "#146EF5" })}
          >
            <Plus /> Add color
          </Button>
        </div>

        {d.colors.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No colors yet. Add the brand's primary color to make it copyable from anywhere.
          </p>
        ) : (
          byRole(d.colors, COLOR_ROLES).map(([role, list]) => (
            <div key={role} className="mb-4">
              <h3 className="mb-1.5 text-[11px] uppercase tracking-wide text-subtle-foreground">
                {role}
              </h3>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]">
                {list.map((c) => (
                  <Swatch
                    key={c.id}
                    color={c}
                    onEdit={() => onEditColor(c)}
                    onDelete={() => action.mutate({ type: "deleteColor", id: c.id })}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      <section className="mb-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <TypeIcon className="size-4" /> Typography
          </h2>
          <div className="flex items-center gap-2">
            <Input
              value={sample}
              onChange={(e) => setSample(e.target.value)}
              placeholder="Preview text"
              className="h-7 w-44 text-[12px]"
              aria-label="Typography preview text"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onEditTypeface({ ...blank, role: "heading", family: "", weight: "", size: "", lineHeight: "", letterSpacing: "" })}
            >
              <Plus /> Add style
            </Button>
          </div>
        </div>

        {d.typefaces.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No type styles yet. Add the heading and body faces you set most often.
          </p>
        ) : (
          byRole(d.typefaces, TYPE_ROLES).map(([role, list]) => (
            <div key={role} className="mb-4">
              <h3 className="mb-1.5 text-[11px] uppercase tracking-wide text-subtle-foreground">
                {role}
              </h3>
              <div className="space-y-2">
                {list.map((t) => (
                  <TypeRow
                    key={t.id}
                    face={t}
                    sample={sample || "The quick brown fox"}
                    onEdit={() => onEditTypeface(t)}
                    onDelete={() => action.mutate({ type: "deleteTypeface", id: t.id })}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold">Logos</h2>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onEditLogo({ ...blank, variant: "primary", name: "", footageId: null })}
          >
            <Plus /> Add logo
          </Button>
        </div>

        {d.logos.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No logos yet. Link one from the asset library so the file lives in exactly one place.
          </p>
        ) : (
          byRole(
            d.logos.map((l) => ({ ...l, role: l.variant })),
            LOGO_VARIANTS,
          ).map(([variant, list]) => (
            <div key={variant} className="mb-4">
              <h3 className="mb-1.5 text-[11px] uppercase tracking-wide text-subtle-foreground">
                {variant}
              </h3>
              <div className="space-y-2">
                {list.map((l) => (
                  <LogoRow
                    key={l.id}
                    logo={l}
                    onEdit={() => onEditLogo(l)}
                    onDelete={() => action.mutate({ type: "deleteLogo", id: l.id })}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
