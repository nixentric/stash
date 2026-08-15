import { useEffect } from "react";
import { ipc } from "@/lib/ipc";
import type { BrandTypeface } from "@/lib/types";

/**
 * Families already handed to the document. Registering the same family twice is
 * harmless but re-reads the file, and a brand page renders its typefaces on
 * every keystroke in the editor.
 */
const registered = new Set<string>();

export async function registerFont(family: string, dataUrl: string) {
  if (registered.has(family)) return;
  const face = new FontFace(family, `url(${dataUrl})`);
  await face.load();
  document.fonts.add(face);
  registered.add(family);
}

/**
 * Loads the font files a brand's typefaces point at, so previews render in the
 * real face instead of silently falling back to whatever the system has.
 *
 * A file that has since moved or been deleted just leaves the fallback in place —
 * the typeface entry still holds the family name, which is the part that matters.
 */
export function useBrandFonts(typefaces: BrandTypeface[] | undefined) {
  useEffect(() => {
    for (const t of typefaces ?? []) {
      if (!t.fontFile || registered.has(t.family)) continue;
      ipc
        .loadFontFile(t.fontFile)
        .then((f) => registerFont(t.family, f.dataUrl))
        .catch((e) => console.warn(`Font file for ${t.family} could not be loaded:`, e));
    }
  }, [typefaces]);
}
