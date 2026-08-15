import { useSyncExternalStore, useEffect, useState } from "react";

/**
 * "Strobe Stack" from dotmatrix.zzzzshawn.cloud, rebuilt here: each column
 * stacks upward on a stagger, the full grid blinks twice, then the columns
 * drain downward the same way. The registry ships six files of presets,
 * patterns, shapes and hover phases to draw it — this is the loop itself.
 */
const ROWS = 5;
const COLS = 5;
/** Column `c` gains a row per tick starting at tick `c`, so the last one lands 4 ticks late. */
const FILL_LAST = ROWS + COLS - 1;
const BLINK = [0.38, 1, 0.38, 1];
export const STEPS = (FILL_LAST + 1) * 2 + BLINK.length;
/** The site's own cadence: a 2s cycle at its default speed of 1.4. */
const STEP_MS = Math.round(2000 / 1.4 / STEPS);

const DIM = 0.08;
const LIT = 0.52;
const CAP = 1;

const OCEAN = "linear-gradient(140deg, #00c6ff 0%, #0072ff 48%, #4facfe 100%)";

// One timer for every loader on screen. A grid mid-import can mount twenty of
// these; twenty intervals drifting against each other is both wasteful and
// visibly ragged.
const listeners = new Set<() => void>();
let step = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(cb: () => void) {
  listeners.add(cb);
  timer ??= setInterval(() => {
    step = (step + 1) % STEPS;
    for (const l of listeners) l();
  }, STEP_MS);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export function dotOpacity(row: number, col: number, at: number): number {
  let height: number;
  let blink: number | undefined;

  if (at <= FILL_LAST) {
    height = Math.max(0, Math.min(ROWS, at - col));
  } else if (at < FILL_LAST + 1 + BLINK.length) {
    height = ROWS;
    blink = BLINK[at - (FILL_LAST + 1)];
  } else {
    const drain = at - (FILL_LAST + 1 + BLINK.length);
    height = Math.max(0, Math.min(ROWS, ROWS - Math.max(0, drain - col)));
  }

  const topLit = ROWS - height;
  if (height === 0 || row < topLit) return DIM;
  if (blink !== undefined) return blink;
  // The leading dot of a growing stack reads as the moving edge.
  return row === topLit && height < ROWS ? CAP : LIT;
}

/**
 * Shown while a thumbnail is being generated. Honors reduced-motion by holding
 * the grid still rather than strobing it.
 */
export function DotMatrixLoader({ className }: { className?: string }) {
  const at = useSyncExternalStore(
    subscribe,
    () => step,
    () => 0,
  );
  const still =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <div
      className={className}
      style={{ display: "grid", gridTemplateColumns: `repeat(${COLS}, 5px)`, gap: 3 }}
      role="status"
      aria-label="Generating preview"
    >
      {Array.from({ length: ROWS * COLS }, (_, i) => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: 999,
            background: OCEAN,
            opacity: still ? LIT : dotOpacity(Math.floor(i / COLS), i % COLS, at),
            transition: `opacity ${STEP_MS}ms linear`,
          }}
        />
      ))}
    </div>
  );
}

export function HexOrbitLoader({ className }: { className?: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => (t + 1) % 12);
    }, 100);
    return () => clearInterval(timer);
  }, []);

  const rowCounts = [3, 4, 5, 4, 3] as const;
  const greenGradient = "linear-gradient(135deg, #4ade80 0%, #10b981 100%)";

  const perimeterPath = [
    "0,0", "0,1", "0,2", "1,3", "2,4", "3,3", "4,2", "4,1", "4,0", "3,0", "2,0", "1,0"
  ];

  const getOpacity = (row: number, col: number) => {
    const id = `${row},${col}`;
    if (row === 2 && col === 2) return 0.6; // Center is quietly lit

    const pathIndex = perimeterPath.indexOf(id);
    if (pathIndex !== -1) {
      // Two heads moving around
      const distA = (12 + pathIndex - tick) % 12;
      const distB = (12 + pathIndex - ((tick + 6) % 12)) % 12;

      const glowA = distA < 5 ? 1 - distA * 0.18 : 0;
      const glowB = distB < 5 ? 0.74 * (1 - distB * 0.18) : 0;

      return Math.max(0.1, glowA, glowB);
    }

    // Inner ring cells get a low ambient opacity
    return 0.2;
  };

  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
      }}
      role="status"
      aria-label="Downloading update"
    >
      {rowCounts.map((count, row) => (
        <div
          key={row}
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 3,
          }}
        >
          {Array.from({ length: count }, (_, col) => {
            const opacity = getOpacity(row, col);
            return (
              <span
                key={col}
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 999,
                  background: greenGradient,
                  opacity,
                  transition: "opacity 100ms linear",
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
