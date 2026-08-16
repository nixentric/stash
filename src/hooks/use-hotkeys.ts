import { useEffect } from "react";
import { useUi } from "@/store/ui";

interface Options {
  onSelectAll: () => void;
  onNewLibrary: () => void;
  onOpenLibrary: () => void;
  onToggleFavorite: () => void;
  onMarkUsed: () => void;
  onDelete: () => void;
}

/**
 * ⌘/Ctrl+Enter fires a dialog's primary action, even from inside its textarea.
 *
 * Window-level on purpose: the dialog and its inactive tabs unmount, so only the
 * visible one is ever listening.
 */
export function useSubmitHotkey(enabled: boolean, run: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, run]);
}

/** True when focus is somewhere that should own the keystroke. */
function inEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true
  );
}

/**
 * Global keyboard map (§47).
 *
 * Deliberately small. Every binding here is one a desktop user already expects
 * from Finder, Lightroom or Eagle; nothing was invented for its own sake.
 */
export function useHotkeys(o: Options) {
  const {
    selection,
    quickLookId,
    setQuickLookId,
    clearSelection,
    inspectorOpen,
    setInspectorOpen,
    settingsOpen,
    setSettingsOpen,
  } = useUi();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      // These must work even while a text field has focus.
      if (meta && e.key.toLowerCase() === "n") {
        e.preventDefault();
        o.onNewLibrary();
        return;
      }
      if (meta && e.key.toLowerCase() === "o") {
        e.preventDefault();
        o.onOpenLibrary();
        return;
      }
      if (meta && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(!settingsOpen);
        return;
      }

      if (inEditable(e.target)) return;
      // Quick Look owns arrows, Space and Escape while it is open.
      if (quickLookId != null) return;

      if (meta && e.key.toLowerCase() === "a") {
        e.preventDefault();
        o.onSelectAll();
        return;
      }
      if (meta && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setInspectorOpen(!inspectorOpen);
        return;
      }

      switch (e.key) {
        case " ":
          if (selection.length >= 1) {
            e.preventDefault();
            setQuickLookId(selection[0] ?? null);
          }
          break;
        case "Escape":
          if (selection.length) {
            e.preventDefault();
            clearSelection();
          }
          break;
        case "f":
        case "F":
          if (selection.length) {
            e.preventDefault();
            o.onToggleFavorite();
          }
          break;
        case "u":
        case "U":
          if (selection.length) {
            e.preventDefault();
            o.onMarkUsed();
          }
          break;
        case "Backspace":
        case "Delete":
          if (selection.length) {
            e.preventDefault();
            o.onDelete();
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    o,
    selection,
    quickLookId,
    inspectorOpen,
    settingsOpen,
    setQuickLookId,
    clearSelection,
    setInspectorOpen,
    setSettingsOpen,
  ]);
}
