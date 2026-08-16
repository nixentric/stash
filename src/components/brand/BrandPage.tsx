import { useState, useRef, useEffect } from "react";
import {
  Ban,
  Check,
  Copy,
  ExternalLink,
  Palette,
  Pencil,
  Plus,
  Trash2,
  GripVertical,
  Type as TypeIcon,
  Zap,
  BookOpen,
  Shapes,
  FolderOpen,
  Hexagon,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBrand, useBrandAction, useFootageDetail } from "@/hooks/queries";
import { useThumbnail } from "@/hooks/use-thumbnail";
import { useBrandFonts } from "@/lib/fonts";
import { colorFormats, readableOn } from "@/lib/format";
import { COLOR_ROLES, ELEMENT_CATEGORIES, LOGO_VARIANTS, TYPE_ROLES } from "@/lib/types";
import type {
  Brand,
  BrandColor,
  BrandElement,
  BrandExample,
  BrandLogoRules,
  BrandTypeface,
  BrandAdditionalInfo,
  BrandLogo,
} from "@/lib/types";
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

function LogoPreview({ id, className }: { id: number | null; className?: string }) {
  const thumb = useThumbnail(id ?? 0, id != null);
  const [background, setBackground] = useState<"light" | "dark" | "transparent">("transparent");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!thumb.data) return;
    const img = new Image();
    // Handler before src: a cached image can finish loading synchronously, and
    // then onload has already fired by the time it is attached.
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // The corner is the image's own background: transparent for a cut-out logo,
      // and whatever the export flattened to otherwise. Averaging the whole image
      // instead measures mostly that background, which is why a black logo on
      // white read as "light" and got a black card behind it.
      const bg = [data[0]!, data[1]!, data[2]!, data[3]!];
      const bgOpaque = bg[3]! > 20;

      let totalLuminance = 0;
      let inkPixels = 0;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        const a = data[i + 3]!;

        if (a < 20) continue;
        if (bgOpaque) {
          const distance =
            Math.abs(r - bg[0]!) + Math.abs(g - bg[1]!) + Math.abs(b - bg[2]!);
          // 30 clears JPEG ringing around the edges without eating the mark.
          if (distance <= 30) continue;
        }

        totalLuminance += 0.299 * r + 0.587 * g + 0.114 * b;
        inkPixels++;
      }

      if (inkPixels === 0) {
        setBackground("transparent");
        return;
      }

      const avgLuminance = totalLuminance / inkPixels;
      setBackground(avgLuminance > 128 ? "dark" : "light");
    };
    img.src = thumb.data;
  }, [thumb.data]);

  return (
    <div className={`relative overflow-hidden group/preview ${className || ""}`}>
      <div 
         className={`absolute inset-0 transition-colors ${
           background === "dark" ? "bg-black" : background === "light" ? "bg-white" : "bg-transparent"
         }`} 
      />
      
      <canvas ref={canvasRef} className="hidden" />
      {thumb.data ? (
        <img src={thumb.data} alt="" className="relative size-full object-contain p-4" draggable={false} />
      ) : (
        <div className="relative flex size-full items-center justify-center text-muted-foreground text-[11px]">
          No image
        </div>
      )}
      
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover/preview:opacity-100 z-10">
         <button onClick={() => setBackground("light")} className="size-5 rounded-sm border border-border bg-white shadow-sm" title="Light Background" />
         <button onClick={() => setBackground("dark")} className="size-5 rounded-sm border border-border bg-black shadow-sm" title="Dark Background" />
         <button onClick={() => setBackground("transparent")} className="size-5 rounded-sm border border-border bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHklEQVQ4T2NkYGD4z0ABYBw1gGE0DBhGw4BhWIQBAE5H/8Ex6Yw6AAAAAElFTkSuQmCC')] shadow-sm" title="Transparent Background" />
      </div>
    </div>
  );
}


function SortableLogoRow({ logo, onEdit, onDelete }: { logo: BrandLogo; onEdit: () => void; onDelete: () => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: logo.id, data: { variant: logo.variant } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="group relative flex flex-col rounded-lg border border-border overflow-hidden bg-muted/5">
      <div 
        {...attributes} 
        {...listeners}
        className="absolute top-2 left-2 z-10 size-6 bg-background/80 rounded backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-grab hover:bg-background border border-border shadow-sm text-muted-foreground"
      >
        <GripVertical className="size-3.5" />
      </div>
      {/* No pointer-events-none here: dragging is driven by the grip above, and
          blocking events killed hover on the preview's own background swatches. */}
      <div className="h-40 w-full border-b border-border bg-pattern relative">
        <LogoPreview id={logo.footageId} className="h-full w-full" />
      </div>
      <div className="flex items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{logo.name}</div>
          <div className="truncate text-[11px] text-subtle-foreground">
            {logo.footageId == null ? "No file linked" : "Linked asset"}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button size="sm" variant="ghost" title="Edit logo" onClick={onEdit}>
            <Pencil className="size-4" />
          </Button>
          <Button size="sm" variant="ghost" title="Remove logo" onClick={onDelete}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
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
    <div className="group flex flex-col rounded-lg border border-border overflow-hidden bg-muted/5">
      <div className="h-40 w-full border-b border-border bg-pattern relative">
        <LogoPreview id={logo.footageId} className="h-full w-full" />
      </div>
      <div className="flex items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{logo.name}</div>
          <div className="truncate text-[11px] text-subtle-foreground">
            {logo.footageId == null
              ? "No file linked"
              : (asset.data?.displayName ?? "Linked asset")}
          </div>
          {logo.notes && <p className="mt-1 text-[11px] text-subtle-foreground">{logo.notes}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
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
          <Button size="sm" variant="ghost" title="Edit logo" onClick={onEdit}>
            <Pencil />
          </Button>
          <Button size="sm" variant="ghost" title="Remove logo" onClick={onDelete}>
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

/** Thumbnail of the asset an entry points at, or a neutral placeholder. */
function AssetThumb({ id, className }: { id: number | null; className?: string }) {
  const thumb = useThumbnail(id ?? 0, id != null);
  return thumb.data ? (
    <img src={thumb.data} alt="" loading="lazy" className={className} />
  ) : (
    <div className={`${className} bg-thumb-bg`} />
  );
}

/**
 * Rules about the mark itself. Editing happens in place rather than in a dialog:
 * these are three short lines a designer amends while looking at the logos.
 */
function LogoRules({ rules }: { rules: BrandLogoRules }) {
  const action = useBrandAction();
  const [draft, setDraft] = useState(rules);
  const [editing, setEditing] = useState(false);

  useEffect(() => setDraft(rules), [rules]);

  const written = rules.clearSpace || rules.minimumSize || rules.backgroundUsage;

  if (!editing) {
    return (
      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[12px] font-medium">Usage rules</h3>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil /> {written ? "Edit" : "Add rules"}
          </Button>
        </div>
        {written ? (
          <dl className="grid gap-2 sm:grid-cols-3">
            {(
              [
                ["Clear space", rules.clearSpace],
                ["Minimum size", rules.minimumSize],
                ["Background usage", rules.backgroundUsage],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-[11px] uppercase tracking-wide text-subtle-foreground">
                  {label}
                </dt>
                <dd className="text-[13px]">{value || "—"}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Clear space, minimum size, and where the mark may sit.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        {(
          [
            ["Clear space", "clearSpace", "1x the mark height"],
            ["Minimum size", "minimumSize", "24px / 10mm"],
            ["Background usage", "backgroundUsage", "Solid backgrounds only"],
          ] as const
        ).map(([label, key, placeholder]) => (
          <label key={key} className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-subtle-foreground">
              {label}
            </span>
            <Input
              value={draft[key]}
              placeholder={placeholder}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        {written && (
          <Button
            size="sm"
            variant="ghost"
            className="mr-auto text-destructive"
            onClick={() => {
              // One row per brand, so clearing the three fields is the delete.
              const empty = { ...draft, clearSpace: "", minimumSize: "", backgroundUsage: "" };
              action.mutate(
                { type: "saveLogoRules", rules: empty },
                { onSuccess: () => setEditing(false) },
              );
            }}
          >
            <Trash2 /> Clear rules
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setDraft(rules);
            setEditing(false);
          }}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() =>
            action.mutate(
              { type: "saveLogoRules", rules: draft },
              { onSuccess: () => setEditing(false) },
            )
          }
        >
          Save rules
        </Button>
      </div>
    </div>
  );
}

/** Do / don't pairs, side by side, because the contrast is the lesson. */
function Examples({
  examples,
  onAdd,
  onEdit,
}: {
  examples: BrandExample[];
  onAdd: (verdict: "correct" | "incorrect") => void;
  onEdit: (example: BrandExample) => void;
}) {
  const action = useBrandAction();

  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {(["correct", "incorrect"] as const).map((verdict) => {
        const list = examples.filter((e) => e.verdict === verdict);
        return (
          <div key={verdict} className="rounded-lg border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3
                className={`flex items-center gap-1.5 text-[12px] font-medium ${
                  verdict === "correct" ? "text-success" : "text-destructive"
                }`}
              >
                {verdict === "correct" ? <Check className="size-3.5" /> : <Ban className="size-3.5" />}
                {verdict === "correct" ? "Correct usage" : "Don't"}
              </h3>
              <Button size="sm" variant="ghost" onClick={() => onAdd(verdict)}>
                <Plus />
              </Button>
            </div>

            {list.length === 0 ? (
              <p className="text-[12px] text-subtle-foreground">Nothing yet.</p>
            ) : (
              <ul className="space-y-2">
                {list.map((e) => (
                  <li key={e.id} className="group flex items-center gap-2">
                    <AssetThumb id={e.footageId} className="size-10 shrink-0 rounded object-cover" />
                    <span className="min-w-0 flex-1 truncate text-[12px]">
                      {e.caption || "Untitled example"}
                    </span>
                    <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button size="sm" variant="ghost" title="Edit example" onClick={() => onEdit(e)}>
                        <Pencil />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Delete example"
                        onClick={() => action.mutate({ type: "deleteExample", id: e.id })}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  brandId: number;
  onEditBrand: (brand: Brand) => void;
  onEditColor: (color: BrandColor) => void;
  onEditTypeface: (typeface: BrandTypeface) => void;
  onEditLogo: (logo: BrandLogo) => void;
  onEditExample: (example: BrandExample) => void;
  onEditElement: (element: BrandElement) => void;
  onEditAdditionalInfo: (info: BrandAdditionalInfo) => void;
}

function SortableLogoGrid({ logos, onEditLogo, action }: { logos: BrandLogo[]; onEditLogo: (l: BrandLogo) => void; action: any }) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [items, setItems] = useState<BrandLogo[]>(logos);

  useEffect(() => {
    if (!activeId) setItems(logos);
  }, [logos, activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = (e: any) => {
    setActiveId(e.active.id);
  };

  const handleDragOver = (e: any) => {
    const { active, over } = e;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;
    
    if (LOGO_VARIANTS.includes(overId)) {
      setItems((items) => {
        const activeIndex = items.findIndex((i) => i.id === activeId);
        if (activeIndex !== -1 && items[activeIndex]!.variant !== overId) {
           const newItems = [...items];
           newItems[activeIndex] = { ...newItems[activeIndex]!, variant: overId as string };
           return newItems;
        }
        return items;
      });
      return;
    }

    const activeItem = items.find((i) => i.id === activeId);
    const overItem = items.find((i) => i.id === overId);
    
    if (!activeItem || !overItem) return;

    if (activeItem.variant !== overItem.variant) {
      setItems((items) => {
        const activeIndex = items.findIndex((i) => i.id === activeId);
        const overIndex = items.findIndex((i) => i.id === overId);
        
        if (activeIndex !== -1 && overIndex !== -1) {
          const newItems = [...items];
          newItems[activeIndex] = { ...newItems[activeIndex]!, variant: overItem.variant };
          return arrayMove(newItems, activeIndex, overIndex);
        }
        return items;
      });
    }
  };

  const handleDragEnd = (e: any) => {
    const { active, over } = e;
    setActiveId(null);
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    let finalItems = items;
    
    if (activeId !== overId) {
      const activeIndex = items.findIndex((i) => i.id === activeId);
      const overIndex = items.findIndex((i) => i.id === overId);
      
      if (overIndex !== -1) {
         finalItems = arrayMove(items, activeIndex, overIndex);
      }
    }

    let positionCounter = 0;
    const updates = finalItems.map(item => ({
       id: item.id,
       variant: item.variant,
       position: positionCounter++
    }));

    setItems(finalItems);
    action.mutate({ type: "reorderLogos", updates });
  };

  const grouped = byRole(
    items.map((l) => ({ ...l, role: l.variant })),
    LOGO_VARIANTS,
  );

  return (
    <DndContext 
      sensors={sensors} 
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {grouped.map(([variant, list]) => (
        <div key={variant} className="mb-4">
          <h3 className="mb-1.5 text-[11px] uppercase tracking-wide text-subtle-foreground">
            {variant}
          </h3>
          <SortableContext 
            id={variant}
            items={list.map(l => l.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))] min-h-[5rem] p-1 -m-1 rounded-lg">
              {list.map((l) => (
                <SortableLogoRow
                  key={l.id}
                  logo={l as BrandLogo}
                  onEdit={() => onEditLogo(l as BrandLogo)}
                  onDelete={() => action.mutate({ type: "deleteLogo", id: l.id })}
                />
              ))}
            </div>
          </SortableContext>
        </div>
      ))}
      <DragOverlay>
        {activeId ? (
          <LogoRow
            logo={items.find(i => i.id === activeId)!}
            onEdit={() => {}}
            onDelete={() => {}}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export function BrandPage({
  brandId,
  onEditBrand,
  onEditColor,
  onEditTypeface,
  onEditLogo,
  onEditExample,
  onEditElement,
  onEditAdditionalInfo,
}: Props) {
  const detail = useBrand(brandId);
  const action = useBrandAction();
  const [sample, setSample] = useState("Building Meaningful Brand Experiences");
  useBrandFonts(detail.data?.typefaces);

  const d = detail.data;
  if (!d) return <div className="p-6 text-[13px] text-muted-foreground">Loading…</div>;

  const blank = { id: 0, brandId, notes: "", position: 0 };

  return (
    <div className="h-full overflow-y-auto p-6 pb-24">
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
              onClick={() => onEditTypeface({ ...blank, role: "heading", family: "", weight: "", size: "", lineHeight: "", letterSpacing: "", fontFile: null })}
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

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Hexagon className="size-4" /> Logos
          </h2>
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
          <SortableLogoGrid logos={d.logos} onEditLogo={onEditLogo} action={action} />
        )}

        <div className="mt-3 space-y-3">
          <LogoRules rules={d.logoRules} />
          <Examples
            examples={d.examples.filter((e) => e.section === "logo")}
            onAdd={(verdict) =>
              onEditExample({ ...blank, section: "logo", verdict, caption: "", footageId: null })
            }
            onEdit={onEditExample}
          />
        </div>
      </section>

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Shapes className="size-4" /> Graphic elements
          </h2>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              onEditElement({ ...blank, category: "pattern", name: "", footageId: null })
            }
          >
            <Plus /> Add element
          </Button>
        </div>

        {d.elements.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Shapes, patterns, gradients, textures, frames — linked from the asset library, so a
            file is never stored twice.
          </p>
        ) : (
          byRole(
            d.elements.map((el) => ({ ...el, role: el.category })),
            ELEMENT_CATEGORIES,
          ).map(([category, list]) => (
            <div key={category} className="mb-4">
              <h3 className="mb-1.5 text-[11px] uppercase tracking-wide text-subtle-foreground">
                {category}
              </h3>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9rem,1fr))]">
                {list.map((el) => (
                  <ElementCard
                    key={el.id}
                    element={el}
                    onEdit={() => onEditElement(el)}
                    onDelete={() => action.mutate({ type: "deleteElement", id: el.id })}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <BookOpen className="size-4" /> Additional Info
          </h2>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              onEditAdditionalInfo({ id: 0, brandId, title: "", editorMode: "minimal", contentType: "url", content: "", fileReference: null, position: 0, updatedAt: "" })
            }
          >
            <Plus /> Add info
          </Button>
        </div>

        {d.additionalInfos?.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Add brand voice, tone, specific links or documents here.
          </p>
        ) : (
          <SortableAdditionalInfos
            infos={d.additionalInfos ?? []}
            onEdit={onEditAdditionalInfo}
            action={action}
          />
        )}
      </section>
    </div>
  );
}

function ElementCard({
  element,
  onEdit,
  onDelete,
}: {
  element: BrandElement;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const asset = useFootageDetail(element.footageId);
  const path = asset.data?.source.localPath;
  const url = asset.data?.source.originalUrl;

  return (
    <div className="group overflow-hidden rounded-lg border border-border">
      <AssetThumb id={element.footageId} className="h-20 w-full object-cover" />
      <div className="p-2">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-[12px] font-medium">{element.name}</span>
          <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
            {path && (
              <Button
                size="sm"
                variant="ghost"
                title="Reveal in file manager"
                onClick={() => ipc.revealInFileManager(path).catch(reportError)}
              >
                <FolderOpen />
              </Button>
            )}
            {!path && url && (
              <Button
                size="sm"
                variant="ghost"
                title="Open source"
                onClick={() => ipc.openExternal(url).catch(reportError)}
              >
                <ExternalLink />
              </Button>
            )}
            <Button size="sm" variant="ghost" title="Edit element" onClick={onEdit}>
              <Pencil />
            </Button>
            <Button size="sm" variant="ghost" title="Delete element" onClick={onDelete}>
              <Trash2 />
            </Button>
          </div>
        </div>
        {element.notes && (
          <p className="truncate text-[11px] text-subtle-foreground">{element.notes}</p>
        )}
      </div>
    </div>
  );
}

/**
 * One flat list, so unlike the logo grid there is no group to drop into — only
 * the order changes. Local copy while a drag is live: the mutation refetches the
 * brand, and letting that land mid-drag would snap the card back under the
 * cursor.
 */
function SortableAdditionalInfos({
  infos,
  onEdit,
  action,
}: {
  infos: BrandAdditionalInfo[];
  onEdit: (info: BrandAdditionalInfo) => void;
  action: ReturnType<typeof useBrandAction>;
}) {
  const [items, setItems] = useState(infos);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) setItems(infos);
  }, [infos, dragging]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={() => setDragging(true)}
      onDragEnd={({ active, over }) => {
        setDragging(false);
        if (!over || active.id === over.id) return;

        const from = items.findIndex((i) => i.id === active.id);
        const to = items.findIndex((i) => i.id === over.id);
        if (from === -1 || to === -1) return;

        const next = arrayMove(items, from, to);
        setItems(next);
        action.mutate({
          type: "reorderAdditionalInfos",
          updates: next.map((i, position) => ({ id: i.id, position })),
        });
      }}
      onDragCancel={() => setDragging(false)}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-3">
          {items.map((info) => (
            <AdditionalInfoCard
              key={info.id}
              info={info}
              onEdit={() => onEdit(info)}
              onDelete={() => action.mutate({ type: "deleteAdditionalInfo", id: info.id })}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function AdditionalInfoCard({
  info,
  onEdit,
  onDelete,
}: {
  info: BrandAdditionalInfo;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: info.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="group rounded-lg border border-border p-4 bg-muted/10"
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        {/* Same grip as the logo cards: the whole card cannot be the handle or
            selecting the text inside it would start a drag. */}
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            title="Drag to reorder"
            className="shrink-0 cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          >
            <GripVertical className="size-3.5" />
          </button>
          <h3 className="truncate text-[13px] font-semibold">{info.title}</h3>
        </div>
        <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
          <Button size="sm" variant="ghost" title="Edit info" onClick={onEdit}>
            <Pencil />
          </Button>
          <Button size="sm" variant="ghost" title="Delete info" onClick={onDelete}>
            <Trash2 />
          </Button>
        </div>
      </div>
      
      {info.editorMode === "rich_text" ? (
        <div 
          className="prose prose-sm dark:prose-invert max-w-none text-[13px] [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mb-2"
          dangerouslySetInnerHTML={{ __html: info.content }}
        />
      ) : (
        <div className="text-[13px] text-muted-foreground whitespace-pre-wrap">
          {info.contentType === "text" && info.content}
          {info.contentType === "url" && (
            <div className="flex items-center gap-2">
              <span className="truncate">{info.content}</span>
              <Button size="sm" variant="ghost" onClick={() => ipc.openExternal(info.content).catch(reportError)}>
                <ExternalLink /> Open
              </Button>
            </div>
          )}
          {info.contentType === "file" && info.fileReference && (
            <div className="flex items-center gap-2">
              <span className="truncate">{info.fileReference}</span>
              <Button size="sm" variant="ghost" onClick={() => ipc.revealInFileManager(info.fileReference!).catch(reportError)}>
                <FolderOpen /> Reveal
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
