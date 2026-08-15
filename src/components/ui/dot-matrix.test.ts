import { describe, expect, it } from "vitest";
import { STEPS, dotOpacity } from "./dot-matrix";

/** The grid, row by row, at one step of the cycle. */
const frame = (at: number) =>
  Array.from({ length: 5 }, (_, r) =>
    Array.from({ length: 5 }, (_, c) => dotOpacity(r, c, at)),
  );

describe("strobe stack", () => {
  it("stacks each column from the bottom, one tick later than the one before", () => {
    // Tick 5: column 0 is already full, column 4 is one dot tall and that dot
    // is its leading edge — only a growing column carries the bright cap.
    const rows = frame(5);
    expect(rows[4]).toEqual([0.52, 0.52, 0.52, 0.52, 1]);
    expect(rows[0]!.map((o) => o > 0.08)).toEqual([true, false, false, false, false]);
  });

  it("blinks the whole grid twice once every column is full", () => {
    for (const [i, o] of [0.38, 1, 0.38, 1].entries()) {
      expect(frame(10 + i).flat().every((v) => v === o)).toBe(true);
    }
  });

  it("comes back to an empty grid at the end of the cycle", () => {
    expect(frame(STEPS - 1).flat().every((o) => o === 0.08)).toBe(true);
    expect(frame(0)).toEqual(frame(STEPS));
  });
});
