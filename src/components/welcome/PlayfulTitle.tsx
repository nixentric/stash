import { useEffect, useRef } from "react";

/**
 * "Playful" from aicanvas.me/components/playful (MIT), adapted: the original
 * ships a full-screen hero on Next's Science Gothic and wraps each letter in
 * `motion()` without passing a single motion prop — every frame is plain rAF
 * writing CSS variables. So the wrapper, the Google font, and the framer-motion
 * dependency are all dropped; this is the per-letter physics and nothing else.
 *
 * Letters lift, rotate, and swell as the pointer nears them, alternating
 * direction so the word ripples instead of moving as one block.
 */

// tune: raise to widen pointer influence
const INFLUENCE_RADIUS = 300;
// tune: raise to increase maximum glyph rotation
const MAX_ROTATION = 62;
// tune: raise to increase vertical glyph travel
const MAX_TRANSLATE_Y = 44;
// tune: raise to increase sideways glyph travel
const MAX_TRANSLATE_X = 26;
// tune: raise to shear the glyphs further out of shape
const MAX_SKEW = 20;
// tune: raise to enlarge nearby glyphs further
const MAX_SCALE = 1.45;
const MIN_SCALE = 1;
// tune: raise to quicken the active response
const EASE_ACTIVE = 0.15;
// tune: raise to quicken the return to rest
const EASE_EXIT = 0.05;

/**
 * The A is drawn rather than typed: a solid triangle, no crossbar. Sized in em
 * so it tracks the title's font-size, and `display:block` puts its base on the
 * text baseline like a real cap.
 */
function TriangleA() {
  return (
    <svg
      viewBox="0 0 100 100"
      style={{ height: "0.72em", width: "0.68em", display: "block" }}
      fill="currentColor"
      aria-hidden
    >
      <polygon points="50,0 100,100 0,100" />
    </svg>
  );
}

export function PlayfulTitle({ text, className }: { text: string; className?: string }) {
  const letters = useRef<(HTMLSpanElement | null)[]>([]);
  const pointer = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // A fixed random seed per letter. Without it every glyph reacts with the
    // same magnitude and the word moves like one rigid object; with it the
    // letters scatter at their own rates and the word comes apart.
    const rand = (min: number, max: number) => min + Math.random() * (max - min);
    const seed = text.split("").map(() => ({
      rotate: rand(0.5, 1.6) * (Math.random() < 0.5 ? -1 : 1),
      x: rand(-1, 1),
      y: rand(0.6, 1.5),
      skew: rand(-1, 1),
    }));

    const state = text.split("").map(() => ({
      rotate: 0,
      translateX: 0,
      translateY: 0,
      skew: 0,
      scale: MIN_SCALE,
    }));
    let frame = 0;
    let alive = true;

    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    const onLeave = () => {
      pointer.current = null;
    };
    window.addEventListener("pointermove", onMove);
    document.addEventListener("pointerleave", onLeave);

    function animate() {
      if (!alive) return;

      const mx = pointer.current?.x ?? -99999;
      const my = pointer.current?.y ?? -99999;
      const easing = pointer.current ? EASE_ACTIVE : EASE_EXIT;

      state.forEach((s, i) => {
        const el = letters.current[i];
        if (!el) return;

        const rect = el.getBoundingClientRect();
        const dx = rect.left + rect.width / 2 - mx;
        const dy = rect.top + rect.height / 2 - my;
        const dist = Math.hypot(dx, dy);

        let influence = 0;
        if (dist < INFLUENCE_RADIUS) {
          influence = 1 - dist / INFLUENCE_RADIUS;
          // Smoothstep, so a letter eases into the effect instead of snapping.
          influence = influence * influence * (3 - 2 * influence);
        }

        const k = seed[i]!;
        const targetRotate =
          influence > 0 ? MAX_ROTATION * influence * Math.sin(Math.atan2(dy, dx)) * k.rotate : 0;
        const targetTranslateX = MAX_TRANSLATE_X * influence * k.x;
        const targetTranslateY = MAX_TRANSLATE_Y * influence * k.y * (i % 2 === 0 ? -1 : 1);
        const targetSkew = MAX_SKEW * influence * k.skew;
        const targetScale = MIN_SCALE + (MAX_SCALE - MIN_SCALE) * influence;

        s.rotate += (targetRotate - s.rotate) * easing;
        s.translateX += (targetTranslateX - s.translateX) * easing;
        s.translateY += (targetTranslateY - s.translateY) * easing;
        s.skew += (targetSkew - s.skew) * easing;
        s.scale += (targetScale - s.scale) * easing;

        el.style.setProperty("--rotate", `${s.rotate.toFixed(2)}deg`);
        el.style.setProperty("--translate-x", `${s.translateX.toFixed(2)}px`);
        el.style.setProperty("--translate-y", `${s.translateY.toFixed(2)}px`);
        el.style.setProperty("--skew", `${s.skew.toFixed(2)}deg`);
        el.style.setProperty("--scale", s.scale.toFixed(3));
      });

      frame = requestAnimationFrame(animate);
    }

    animate();

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [text]);

  return (
    <span className={className} aria-label={text}>
      {text.split("").map((letter, i) => (
        <span
          key={i}
          aria-hidden
          ref={(el) => {
            letters.current[i] = el;
          }}
          className="inline-block select-none"
          style={{
            transform:
              "translate(var(--translate-x, 0px), var(--translate-y, 0px)) rotate(var(--rotate, 0deg)) skewX(var(--skew, 0deg)) scale(var(--scale, 1))",
            transformOrigin: "center",
            willChange: "transform",
          }}
        >
          {letter === "A" ? <TriangleA /> : letter}
        </span>
      ))}
    </span>
  );
}
