import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc";
import { keys } from "./queries";

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
    if (!el || visible) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, rootMargin]);

  return { ref, visible };
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
