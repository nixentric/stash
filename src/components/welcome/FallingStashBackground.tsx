import { useEffect, useRef, useState } from "react";
import Matter from "matter-js";
import {
  ArrowUpRight,
  Bookmark,
  Camera,
  Clapperboard,
  Folder,
  Heart,
  Image,
  MousePointer2,
  Palette,
  Paperclip,
  Play,
  Shapes,
  Sparkles,
  Star,
  Type,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Decorative physics layer for the Welcome screen: things worth keeping drop in
 * and pile up. Matter.js does the physics only — every object is a real DOM
 * node using the app's own tokens, so the pile inherits the theme for free.
 *
 * React state changes once per spawn (a few times a minute), never per frame;
 * the rAF loop writes transforms straight to the elements through refs.
 */

// Everything drops once and stays: no recycling, so nothing ever vanishes out
// from under the reader. Enough to bury the bottom edge two or three deep.
const TOTAL = 38;
// Enough to notice the effect immediately without a dump.
const BURST = 5;

/**
 * Each object picks a tone. Theme tokens first so light/dark both work; the two
 * arbitrary hues only exist because the palette ships no pink or teal.
 */
const TONES = [
  "border-primary/50 bg-primary/25 text-primary",
  "border-success/50 bg-success/25 text-success",
  "border-warning/55 bg-warning/25 text-warning",
  "border-destructive/45 bg-destructive/20 text-destructive",
  "border-[oklch(0.72_0.16_320)]/55 bg-[oklch(0.72_0.16_320)]/25 text-[oklch(0.8_0.14_320)]",
  "border-[oklch(0.75_0.14_195)]/55 bg-[oklch(0.75_0.14_195)]/25 text-[oklch(0.82_0.12_195)]",
];

const LABELS = [
  "STASH", "KEEP", "SAVE", "FOUND", "PICKED", "MOOD", "FRAME", "CLIP", "SHOT",
  "TYPE", "COLOR", "ASSET", "VISUAL", "IDEA", "DRAFT", "REFERENCE", "TEXTURE",
];

const MICROCOPY = [
  "GOOD FIND", "KEEP IT", "SAVE THIS", "FOR LATER", "NICE ONE", "LOVE THIS",
  "FOUND IT", "DON'T LOSE THIS", "YEP!", "OOH!", "THIS ONE", "SO GOOD",
  "KEEP KEEP KEEP", "MAYBE?", "WHY NOT?", "COOL.", "YES.",
];

// Rare enough that spotting one feels like a find, not a feature.
const EGGS = ["👀", "???", "OH!", "WAIT—", "THIS.", "★ ★ ★", "VERY NICE", "KEEP FOREVER", "SECRET STASH"];

const CHIPS = ["PNG", "JPG", "SVG", "MP4", "GIF"];

const ICONS: LucideIcon[] = [
  Folder, Image, Clapperboard, Bookmark, Heart, Star, Sparkles, Camera,
  Palette, Type, Shapes, Paperclip, MousePointer2, Play,
];

// Every shape carries a visible mark: a bare pill reads as a rendering bug.
type Shape = "star" | "squiggle" | "cluster" | "sparkle" | "arrow";
const SHAPES: Shape[] = ["star", "squiggle", "cluster", "sparkle", "arrow"];

type Item = { id: number; tone: string } & (
  | { kind: "label" | "micro" | "egg" | "chip" | "glyph"; text: string }
  | { kind: "icon"; Icon: LucideIcon }
  | { kind: "shape"; shape: Shape }
);

const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
const rand = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * Roughly three parts type to one part icon — words carry the metaphor, the
 * icon tiles just break up the rhythm: labels 42, microcopy 16, chips/glyphs 14,
 * icons 16, shapes 10, eggs 2.
 */
function makeItem(id: number): Item {
  const tone = pick(TONES);
  const roll = Math.random() * 100;
  if (roll < 42) return { id, tone, kind: "label", text: pick(LABELS) };
  if (roll < 58) return { id, tone, kind: "micro", text: pick(MICROCOPY) };
  if (roll < 72) {
    return Math.random() < 0.25
      ? { id, tone, kind: "glyph", text: "Aa" }
      : { id, tone, kind: "chip", text: pick(CHIPS) };
  }
  if (roll < 88) return { id, tone, kind: "icon", Icon: pick(ICONS) };
  if (roll < 98) return { id, tone, kind: "shape", shape: pick(SHAPES) };
  return { id, tone, kind: "egg", text: pick(EGGS) };
}

// Every object is a full-radius pill or disc with a visible edge; the tone
// carries the color so the shared shell can stay one string.
const SHELL = "flex items-center justify-center rounded-full border-2 backdrop-blur-[1px]";

function Piece({ item }: { item: Item }) {
  switch (item.kind) {
    case "label":
      return (
        <span className={`${SHELL} ${item.tone} px-5 py-2.5 text-[16px] font-semibold tracking-wide`}>
          {item.text}
        </span>
      );
    case "micro":
      return (
        <span className={`${SHELL} ${item.tone} px-5 py-2.5 text-[17px] font-bold tracking-tight`}>
          {item.text}
        </span>
      );
    case "egg":
      return (
        <span className={`${SHELL} ${item.tone} border-dashed px-5 py-2.5 text-[18px] font-bold`}>
          {item.text}
        </span>
      );
    case "chip":
      return (
        <span className={`${SHELL} ${item.tone} px-4 py-2 font-mono text-[14px] font-semibold uppercase`}>
          {item.text}
        </span>
      );
    case "glyph":
      return (
        <span className={`${SHELL} ${item.tone} size-14 text-[22px] font-bold leading-none`}>
          {item.text}
        </span>
      );
    case "icon": {
      const { Icon } = item;
      return (
        <span className={`${SHELL} ${item.tone} size-14`}>
          <Icon className="size-6" />
        </span>
      );
    }
    case "shape":
      switch (item.shape) {
        case "sparkle":
          return (
            <span className={`${SHELL} ${item.tone} size-14`}>
              <Sparkles className="size-6" />
            </span>
          );
        case "arrow":
          return (
            <span className={`${SHELL} ${item.tone} h-11 w-20`}>
              <ArrowUpRight className="size-6" />
            </span>
          );
        case "star":
          return (
            <span className={`${SHELL} ${item.tone} size-14`}>
              <Star className="size-6 fill-current" />
            </span>
          );
        case "squiggle":
          return (
            <span className={`${SHELL} ${item.tone} h-11 w-20`}>
              <svg viewBox="0 0 40 12" className="h-4 w-12">
                <path d="M2 6c4-6 8 6 12 0s8-6 12 0 8 6 12 0" fill="none" stroke="currentColor" strokeWidth="2.5" />
              </svg>
            </span>
          );
        case "cluster":
          return (
            <span className={`${SHELL} ${item.tone} size-14`}>
              <span className="grid grid-cols-2 gap-1.5">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="block size-2 rounded-full bg-current" />
                ))}
              </span>
            </span>
          );
      }
  }
}

export function FallingStashBackground() {
  const host = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  // Static fallback keeps the screen's personality without any motion.
  const [reduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const elements = useRef(new Map<number, HTMLElement>());
  const bodies = useRef(new Map<number, Matter.Body>());
  const sizes = useRef(new Map<number, { w: number; h: number }>());
  const order = useRef<number[]>([]);
  const engineRef = useRef<Matter.Engine | null>(null);
  const nextId = useRef(0);

  // ── engine, walls, mouse, loop ────────────────────────────────────────────
  useEffect(() => {
    const el = host.current;
    if (reduced || !el) {
      if (reduced) setItems(Array.from({ length: 6 }, () => makeItem(nextId.current++)));
      return;
    }

    const engine = Matter.Engine.create({ enableSleeping: true });
    engineRef.current = engine;
    const world = engine.world;

    // Floor and side walls only — objects enter from above, so no ceiling.
    const WALL = 200;
    let walls: Matter.Body[] = [];
    const buildWalls = () => {
      const { clientWidth: w, clientHeight: h } = el;
      Matter.Composite.remove(world, walls);
      walls = [
        Matter.Bodies.rectangle(w / 2, h + WALL / 2, w + WALL * 2, WALL, { isStatic: true }),
        Matter.Bodies.rectangle(-WALL / 2, h / 2, WALL, h * 3, { isStatic: true }),
        Matter.Bodies.rectangle(w + WALL / 2, h / 2, WALL, h * 3, { isStatic: true }),
      ];
      Matter.Composite.add(world, walls);
    };
    buildWalls();

    // The world is the container, not the window: Welcome renders at whatever
    // size the shell gives it.
    const resize = new ResizeObserver(buildWalls);
    resize.observe(el);

    // The layer sits behind the UI and only receives clicks that miss it, so a
    // drag can never steal a button press.
    const mouse = Matter.Mouse.create(el);
    const mouseConstraint = Matter.MouseConstraint.create(engine, {
      mouse,
      constraint: { stiffness: 0.15, render: { visible: false } },
    });
    Matter.Composite.add(world, mouseConstraint);
    // Matter binds a non-passive wheel handler that would eat scrolling here.
    const handlers = mouse as unknown as Record<string, EventListener>;
    el.removeEventListener("wheel", handlers.mousewheel!);

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // Matter warns above 16.667ms and gets unstable past it, so a slow frame
      // runs short rather than letting objects tunnel through the floor.
      const dt = Math.min(now - last, 16.667);
      last = now;
      Matter.Engine.update(engine, dt);

      for (const [id, body] of bodies.current) {
        const node = elements.current.get(id);
        const size = sizes.current.get(id);
        if (!node || !size) continue;
        node.style.transform =
          `translate3d(${body.position.x - size.w / 2}px, ${body.position.y - size.h / 2}px, 0) ` +
          `rotate(${body.angle}rad)`;
      }
    };

    // Burst first so the effect registers, then an irregular ambient drip.
    let spawnTimer: ReturnType<typeof setTimeout> | undefined;
    let dropped = 0;
    const schedule = () => {
      if (dropped >= TOTAL) return;
      // Paced so the pile finishes in roughly half a minute rather than
      // trickling in long after anyone has stopped looking.
      const delay =
        dropped < BURST ? rand(110, 280) : Math.random() < 0.35 ? rand(220, 480) : rand(700, 1700);
      spawnTimer = setTimeout(() => {
        dropped++;
        spawn();
        spawnTimer = undefined;
        schedule();
      }, delay);
    };

    const spawn = () => {
      const id = nextId.current++;
      order.current.push(id);
      setItems((prev) => [...prev, makeItem(id)]);
    };

    const start = () => {
      last = performance.now();
      if (!raf) raf = requestAnimationFrame(tick);
      if (!spawnTimer && dropped < TOTAL) schedule();
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      clearTimeout(spawnTimer);
      spawnTimer = undefined;
    };

    // Welcome is unmounted whenever it is not on screen, so tab visibility is
    // the only case worth pausing for — no IntersectionObserver needed.
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      resize.disconnect();
      for (const type of ["mousemove", "mousedown", "mouseup", "touchmove", "touchstart", "touchend"]) {
        el.removeEventListener(type, handlers[type === "touchmove" ? "mousemove" : type]!);
      }
      Matter.Composite.clear(world, false);
      Matter.Engine.clear(engine);
      engineRef.current = null;
      bodies.current.clear();
      elements.current.clear();
      sizes.current.clear();
      order.current = [];
    };
  }, [reduced]);

  // ── give every freshly rendered item a body sized to its own box ──────────
  useEffect(() => {
    const engine = engineRef.current;
    const el = host.current;
    if (!engine || !el) return;

    for (const item of items) {
      if (bodies.current.has(item.id)) continue;
      const node = elements.current.get(item.id);
      if (!node) continue;

      const w = node.offsetWidth;
      const h = node.offsetHeight;
      if (!w || !h) continue;
      sizes.current.set(item.id, { w, h });

      const x = rand(w, Math.max(w * 2, el.clientWidth - w));
      // Chamfer close to half the short side, so the body is as pill-shaped as
      // the element looks and the pile rolls instead of catching on corners.
      const body = Matter.Bodies.rectangle(x, -80, w, h, {
        chamfer: { radius: (Math.min(w, h) / 2) * 0.9 },
      });

      Matter.Body.setAngle(body, rand(-0.5, 0.5));
      Matter.Body.setAngularVelocity(body, rand(-0.06, 0.06));
      Matter.Body.setVelocity(body, { x: rand(-0.7, 0.7), y: 0 });
      body.restitution = 0.18;
      body.friction = 0.45;
      body.frictionAir = 0.012;

      Matter.Composite.add(engine.world, body);
      bodies.current.set(item.id, body);
    }
  }, [items]);

  return (
    <div ref={host} aria-hidden className="absolute inset-0 overflow-hidden">
      {items.map((item, i) => (
        <div
          key={item.id}
          ref={(node) => {
            if (node) elements.current.set(item.id, node);
            else elements.current.delete(item.id);
          }}
          className="absolute left-0 top-0 opacity-70 will-change-transform"
          style={
            reduced
              ? // Scattered by hand: no engine runs, but the screen keeps its pile.
                {
                  transform: `translate3d(${8 + ((i * 17) % 78)}vw, ${58 + ((i * 11) % 26)}%, 0) rotate(${(i % 2 ? 1 : -1) * (4 + i * 2)}deg)`,
                }
              : // Parked off-screen for the one frame between mounting and getting
                // a body, otherwise every object blinks at the top-left corner first.
                { transform: "translate3d(-9999px, -9999px, 0)" }
          }
        >
          <Piece item={item} />
        </div>
      ))}
    </div>
  );
}
