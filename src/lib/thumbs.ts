/**
 * "The stored pictures are not what they were."
 *
 * Thumbnails are served over `stash://thumb/{id}` and never enter the query
 * cache, so invalidating a key cannot make one change on screen — only a
 * different URL can. This counter is what makes it different.
 *
 * It lives on its own so both the query layer and the thumbnail hook can reach
 * it without importing each other.
 */
// Seeded from the launch time rather than 0, so the `?v=` on every thumbnail URL
// is unique to this run. The webview is now allowed to cache a thumbnail for a
// year (preview/scheme.rs); a picture replaced in an earlier session would
// otherwise come back out of that cache under the URL it had then.
let generation = Date.now();
const listeners = new Set<() => void>();

export const subscribeThumbs = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const thumbGeneration = () => generation;

export function thumbsChanged() {
  generation++;
  for (const l of listeners) l();
}
