import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { useBrandAction, useFootage } from "@/hooks/queries";
import {
  COLOR_ROLES,
  ELEMENT_CATEGORIES,
  LOGO_VARIANTS,
  TYPE_ROLES,
  emptyQuery,
} from "@/lib/types";
import type {
  Brand,
  BrandColor,
  BrandElement,
  BrandExample,
  BrandLogo,
  BrandTypeface,
} from "@/lib/types";

/** Label + control, the shape every field in these dialogs takes. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium">{label}</span>
      {children}
    </label>
  );
}

/**
 * A native `<select>` renders with the system's own chrome on macOS — grey and
 * opaque in the middle of a dark dialog, and immune to most CSS. This is the
 * same menu primitive the toolbar already uses, so a picker looks like the rest
 * of the app and keeps type-ahead and keyboard control.
 */
function Select({
  value,
  options,
  onChange,
  swatches,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  /** Optional colour per option, for pickers where the value is visual. */
  swatches?: Record<string, string>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-md
                     border border-border bg-surface px-2 text-[13px] capitalize outline-none
                     transition-colors hover:border-border-strong
                     focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <span className="flex min-w-0 items-center gap-2">
            {swatches?.[value] && (
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-full border border-border"
                style={{ backgroundColor: swatches[value] }}
              />
            )}
            <span className="truncate">{value}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-[var(--radix-dropdown-menu-trigger-width)]">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o} value={o} className="capitalize">
              {swatches?.[o] && (
                <span
                  aria-hidden
                  className="mr-1.5 size-3 shrink-0 rounded-full border border-border"
                  style={{ backgroundColor: swatches[o] }}
                />
              )}
              {o}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BrandDialog({ brand, onClose }: { brand: Brand | null; onClose: () => void }) {
  const action = useBrandAction();
  const [draft, setDraft] = useState<Brand | null>(brand);

  useEffect(() => setDraft(brand), [brand]);
  if (!draft) return null;

  const set = (patch: Partial<Brand>) => setDraft({ ...draft, ...patch });

  return (
    <Dialog open={!!brand} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(32rem,92vw)]">
        <DialogHeader>
          <DialogTitle>{draft.id === 0 ? "New Brand" : "Edit Brand"}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          <Field label="Name">
            <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
          </Field>
          <Field label="Tagline">
            <Input value={draft.tagline} onChange={(e) => set({ tagline: e.target.value })} />
          </Field>
          <Field label="Description">
            <Input value={draft.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <Field label="Website">
            <Input
              value={draft.website}
              onChange={(e) => set({ website: e.target.value })}
              placeholder="https://"
            />
          </Field>
          <Field label="Notes">
            <Input value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </DialogBody>
        <DialogFooter>
          {draft.id !== 0 && (
            <Button
              variant="ghost"
              onClick={() => {
                action.mutate({ type: "deleteBrand", id: draft.id });
                onClose();
              }}
            >
              Delete brand
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!draft.name.trim()}
            onClick={() => {
              action.mutate({ type: "saveBrand", brand: draft }, { onSuccess: onClose });
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ColorDialog({ color, onClose }: { color: BrandColor | null; onClose: () => void }) {
  const action = useBrandAction();
  const [draft, setDraft] = useState<BrandColor | null>(color);

  useEffect(() => setDraft(color), [color]);
  if (!draft) return null;

  const set = (patch: Partial<BrandColor>) => setDraft({ ...draft, ...patch });
  const valid = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(draft.hex.trim());

  return (
    <Dialog open={!!color} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(28rem,92vw)]">
        <DialogHeader>
          <DialogTitle>{draft.id === 0 ? "Add Color" : "Edit Color"}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field label="Name">
            <Input
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Primary Blue"
              autoFocus
            />
          </Field>
          <Field label="Role">
            <Select value={draft.role} options={COLOR_ROLES} onChange={(role) => set({ role })} />
          </Field>
          <Field label="Hex">
            <div className="flex items-center gap-2">
              <Input
                value={draft.hex}
                onChange={(e) => set({ hex: e.target.value })}
                placeholder="#146EF5"
              />
              <span
                className="size-8 shrink-0 rounded border border-border"
                style={{ backgroundColor: valid ? draft.hex : "transparent" }}
                aria-hidden
              />
            </div>
            {!valid && draft.hex.trim() !== "" && (
              <span className="mt-1 block text-[11px] text-destructive">
                Enter a hex colour like #146EF5
              </span>
            )}
          </Field>
          <Field label="Usage notes">
            <Input
              value={draft.notes}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="Buttons, links, primary CTA"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!draft.name.trim() || !valid}
            onClick={() => action.mutate({ type: "saveColor", color: draft }, { onSuccess: onClose })}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TypefaceDialog({
  typeface,
  onClose,
}: {
  typeface: BrandTypeface | null;
  onClose: () => void;
}) {
  const action = useBrandAction();
  const [draft, setDraft] = useState<BrandTypeface | null>(typeface);

  useEffect(() => setDraft(typeface), [typeface]);
  if (!draft) return null;

  const set = (patch: Partial<BrandTypeface>) => setDraft({ ...draft, ...patch });

  return (
    <Dialog open={!!typeface} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(30rem,92vw)]">
        <DialogHeader>
          <DialogTitle>{draft.id === 0 ? "Add Type Style" : "Edit Type Style"}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          <Field label="Font family">
            <Input
              value={draft.family}
              onChange={(e) => set({ family: e.target.value })}
              placeholder="Inter"
              autoFocus
            />
          </Field>
          <Field label="Role">
            <Select value={draft.role} options={TYPE_ROLES} onChange={(role) => set({ role })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Weight">
              <Input
                value={draft.weight}
                onChange={(e) => set({ weight: e.target.value })}
                placeholder="Bold / 700"
              />
            </Field>
            <Field label="Size">
              <Input
                value={draft.size}
                onChange={(e) => set({ size: e.target.value })}
                placeholder="32px"
              />
            </Field>
            <Field label="Line height">
              <Input
                value={draft.lineHeight}
                onChange={(e) => set({ lineHeight: e.target.value })}
                placeholder="1.2"
              />
            </Field>
            <Field label="Letter spacing">
              <Input
                value={draft.letterSpacing}
                onChange={(e) => set({ letterSpacing: e.target.value })}
                placeholder="-0.02em"
              />
            </Field>
          </div>
          <Field label="Usage notes">
            <Input value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!draft.family.trim()}
            onClick={() =>
              action.mutate({ type: "saveTypeface", typeface: draft }, { onSuccess: onClose })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LogoDialog({ logo, onClose }: { logo: BrandLogo | null; onClose: () => void }) {
  const action = useBrandAction();
  const [draft, setDraft] = useState<BrandLogo | null>(logo);
  const [search, setSearch] = useState("");

  // Logos point into the asset library rather than carrying their own file, so
  // picking one is a search over footage the user already catalogued.
  const results = useFootage(
    { ...emptyQuery(), search: search.trim() || null, limit: 8 },
    !!logo && search.trim().length > 1,
  );

  useEffect(() => {
    setDraft(logo);
    setSearch("");
  }, [logo]);
  if (!draft) return null;

  const set = (patch: Partial<BrandLogo>) => setDraft({ ...draft, ...patch });

  return (
    <Dialog open={!!logo} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(30rem,92vw)]">
        <DialogHeader>
          <DialogTitle>{draft.id === 0 ? "Add Logo" : "Edit Logo"}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          <Field label="Name">
            <Input
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Primary Logo"
              autoFocus
            />
          </Field>
          <Field label="Variant">
            <Select
              value={draft.variant}
              options={LOGO_VARIANTS}
              onChange={(variant) => set({ variant })}
            />
          </Field>

          <Field label="Linked asset">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search the asset library…"
            />
          </Field>
          {draft.footageId != null && (
            <p className="text-[12px] text-muted-foreground">
              Linked to asset #{draft.footageId}{" "}
              <button
                type="button"
                className="cursor-pointer text-primary hover:underline"
                onClick={() => set({ footageId: null })}
              >
                unlink
              </button>
            </p>
          )}
          {(results.data?.items ?? []).length > 0 && (
            <ul className="max-h-40 overflow-y-auto rounded-md border border-border">
              {results.data!.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => set({ footageId: item.id })}
                    className={`w-full cursor-pointer px-2 py-1.5 text-left text-[12px] hover:bg-accent ${
                      draft.footageId === item.id ? "bg-accent" : ""
                    }`}
                  >
                    {item.displayName}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Field label="Usage notes">
            <Input
              value={draft.notes}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="Clear space: 1x the mark height. Minimum 24px."
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!draft.name.trim()}
            onClick={() => action.mutate({ type: "saveLogo", logo: draft }, { onSuccess: onClose })}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Do/don't examples and graphic elements are the same shape of thing: a name,
 * a category, and a link into the asset library. One dialog serves both.
 */
function AssetPicker({
  footageId,
  onPick,
}: {
  footageId: number | null;
  onPick: (id: number | null) => void;
}) {
  const [search, setSearch] = useState("");
  const results = useFootage(
    { ...emptyQuery(), search: search.trim() || null, limit: 8 },
    search.trim().length > 1,
  );

  return (
    <>
      <Field label="Linked asset">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search the asset library…"
        />
      </Field>
      {footageId != null && (
        <p className="text-[12px] text-muted-foreground">
          Linked to asset #{footageId}{" "}
          <button
            type="button"
            className="cursor-pointer text-primary hover:underline"
            onClick={() => onPick(null)}
          >
            unlink
          </button>
        </p>
      )}
      {(results.data?.items ?? []).length > 0 && (
        <ul className="max-h-40 overflow-y-auto rounded-md border border-border">
          {results.data!.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onPick(item.id)}
                className={`w-full cursor-pointer px-2 py-1.5 text-left text-[12px] hover:bg-accent ${
                  footageId === item.id ? "bg-accent" : ""
                }`}
              >
                {item.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function ExampleDialog({
  example,
  onClose,
}: {
  example: BrandExample | null;
  onClose: () => void;
}) {
  const action = useBrandAction();
  const [draft, setDraft] = useState<BrandExample | null>(example);

  useEffect(() => setDraft(example), [example]);
  if (!draft) return null;

  return (
    <Dialog open={!!example} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(30rem,92vw)]">
        <DialogHeader>
          <DialogTitle>
            {draft.verdict === "correct" ? "Correct usage example" : "Incorrect usage example"}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          <Field label="Caption">
            <Input
              value={draft.caption}
              onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
              placeholder={
                draft.verdict === "correct" ? "On solid white" : "Never stretch the mark"
              }
              autoFocus
            />
          </Field>
          <Field label="Verdict">
            <Select
              value={draft.verdict}
              options={["correct", "incorrect"]}
              swatches={{ correct: "var(--success)", incorrect: "var(--destructive)" }}
              onChange={(v) => setDraft({ ...draft, verdict: v as "correct" | "incorrect" })}
            />
          </Field>
          <AssetPicker
            footageId={draft.footageId}
            onPick={(footageId) => setDraft({ ...draft, footageId })}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              action.mutate({ type: "saveExample", example: draft }, { onSuccess: onClose })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ElementDialog({
  element,
  onClose,
}: {
  element: BrandElement | null;
  onClose: () => void;
}) {
  const action = useBrandAction();
  const [draft, setDraft] = useState<BrandElement | null>(element);

  useEffect(() => setDraft(element), [element]);
  if (!draft) return null;

  return (
    <Dialog open={!!element} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(30rem,92vw)]">
        <DialogHeader>
          <DialogTitle>{draft.id === 0 ? "Add Graphic Element" : "Edit Graphic Element"}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          <Field label="Name">
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Diagonal grid"
              autoFocus
            />
          </Field>
          <Field label="Category">
            <Select
              value={draft.category}
              options={ELEMENT_CATEGORIES}
              onChange={(category) => setDraft({ ...draft, category })}
            />
          </Field>
          <AssetPicker
            footageId={draft.footageId}
            onPick={(footageId) => setDraft({ ...draft, footageId })}
          />
          <Field label="Usage notes">
            <Input
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="Backgrounds only, 20% opacity"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!draft.name.trim()}
            onClick={() =>
              action.mutate({ type: "saveElement", element: draft }, { onSuccess: onClose })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
