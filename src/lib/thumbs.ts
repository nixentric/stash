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
let generation = 0;
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
