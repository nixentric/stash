import type { Theme } from "./types";

const KEY = "stash.theme";

/**
 * Applies a theme and remembers it locally.
 *
 * Mirrored in localStorage as well as app preferences so the inline script in
 * index.html can paint the correct background before React mounts — otherwise
 * every launch flashes white.
 */
export function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private-mode storage failures are not worth surfacing.
  }
}

/** Keeps "System" honest when the OS switches while the app is open. */
export function watchSystemTheme(getTheme: () => Theme) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (getTheme() === "system") applyTheme("system");
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
