import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc";
import { keys } from "./queries";
import { subscribeThumbs, thumbGeneration } from "@/lib/thumbs";

/**
 * Loads a thumbnail only once its card is near the viewport.
 *
 * At 10,000 records the grid is virtualized to ~40 live cards, but scrolling
 * fast still mounts hundreds in a second. Gating on IntersectionObserver means
 * a flick-scroll to the bottom fetches what you land on, not everything you flew
 * past (ARCHITECTURE.md §7).
 */
export function useVisible<E extends HTMLElement>(rootMargin = "300px") {
  const ref = useRef<E | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Both ways. Latching on at the first sighting meant a list you scrolled
    // once kept every image it had ever shown: the queries stayed active, so
    // nothing was ever collected and memory only went up.
    const io = new IntersectionObserver(
      ([entry]) => setVisible(!!entry?.isIntersecting),
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);

  return { ref, visible };
}

/**
 * A thumbnail the webview fetches for itself, over `stash://thumb/{id}`.
 *
 * The bytes never touch JavaScript: no base64 string in the heap, no copy held
 * by a query cache, and the decoded image belongs to the webview, which drops it
 * when it goes off screen. A list of a few thousand covers is the difference
 * between a few hundred megabytes and a few tens.
 *
 * The generate-if-missing step the IPC version does is kept, moved onto the
 * image's own error: a 404 means "nothing stored yet", so the provider chain is
 * asked once and the URL is bumped to reload it. A second failure is a footage
 * with no obtainable preview, which is an ordinary outcome, not an error.
 */
export function useThumbSrc(id: number, enabled: boolean) {
  const [version, setVersion] = useState(0);
  const [missing, setMissing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const attempted = useRef(false);
  const gen = useSyncExternalStore(subscribeThumbs, thumbGeneration);

  // A footage whose picture could not be made is worth asking about again once
  // the stored thumbnails change — that is what a bulk refresh just did.
  useEffect(() => {
    attempted.current = false;
    setVersion(0);
    setMissing(false);
    setGenerating(false);
  }, [id, gen]);

  const onError = () => {
    if (attempted.current) {
      setMissing(true);
      return;
    }
    attempted.current = true;
    setGenerating(true);
    ipc
      .refreshThumbnail(id, false)
      .then((found) => (found ? setVersion((v) => v + 1) : setMissing(true)))
      .catch(() => setMissing(true))
      .finally(() => setGenerating(false));
  };

  // ponytail: a thumbnail replaced in place (Inspector → Set thumbnail) only
  // reaches an off-screen card when it next scrolls back into view. Give the URL
  // the row's updated_at if that ever reads as stale.
  return {
    src:
      enabled && !missing
        ? `stash://thumb/${id}${gen + version ? `?v=${gen + version}` : ""}`
        : undefined,
    missing,
    generating,
    onError,
  };
}

/**
 * Resolves a preview for one footage.
 *
 * Two stages, deliberately: read what is already stored (instant, offline-safe),
 * and only if there is nothing at all, ask the backend to try its provider chain
 * once. A footage with no obtainable preview is not an error — it renders a
 * placeholder and is never retried in a loop.
 */
export function useThumbnail(id: number, enabled: boolean, large = false) {
  const qc = useQueryClient();
  const attempted = useRef(false);
  const [generating, setGenerating] = useState(false);

  const stored = useQuery({
    queryKey: keys.thumb(id, large),
    queryFn: () => ipc.getThumbnail(id, large),
    enabled,
    staleTime: 5 * 60_000,
    // Thumbnails are base64 data URLs, by far the heaviest thing in the cache,
    // and the default holds every one for five minutes after its card is gone.
    // Dropped soon after nothing is showing it instead; the re-read is one local
    // SQL round trip. The large ones are whole-screen images, so they go sooner.
    // ponytail: a time bound, not a size bound — swap for an LRU if scroll-back
    // starts flickering.
    gcTime: large ? 10_000 : 30_000,
  });

  useEffect(() => {
    if (!enabled || stored.isLoading || stored.data || attempted.current) return;
    attempted.current = true;

    let cancelled = false;
    setGenerating(true);
    ipc
      .refreshThumbnail(id, false)
      .then((found) => {
        if (found && !cancelled) {
          qc.invalidateQueries({ queryKey: keys.thumb(id, large) });
          qc.invalidateQueries({ queryKey: keys.detail(id) });
        }
      })
      // A failed fetch is an ordinary outcome here; the card shows a placeholder.
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setGenerating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, id, large, stored.data, stored.isLoading, qc]);

  // Reading a stored thumbnail and making one that does not exist yet are both
  // "not ready yet" to the card. Without this the second one rendered as the
  // no-image icon, which reads as failure rather than work in progress.
  return generating ? { ...stored, isLoading: true } : stored;
}
