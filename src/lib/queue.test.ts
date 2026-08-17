import { describe, expect, it } from "vitest";
import { runQueue } from "./queue";

describe("runQueue", () => {
  it("works through every item in order", async () => {
    const seen: number[] = [];
    const r = await runQueue([1, 2, 3], async (n) => void seen.push(n));
    expect(seen).toEqual([1, 2, 3]);
    expect(r).toEqual({ done: 3, failures: [], stopped: false });
  });

  it("keeps going after a failure and reports the reason", async () => {
    const seen: number[] = [];
    const r = await runQueue(
      [1, 2, 3],
      async (n) => {
        seen.push(n);
        if (n === 2) throw new Error("no access");
      },
      (e) => (e as Error).message,
    );
    expect(seen).toEqual([1, 2, 3]); // the third one still ran
    expect(r).toEqual({ done: 2, failures: ["no access"], stopped: false });
  });

  it("stops between items, never mid-item", async () => {
    const seen: number[] = [];
    const r = await runQueue([1, 2, 3, 4], async (n, _i, stop) => {
      seen.push(n);
      if (n === 2) stop();
    });
    // Item 2 finished; 3 and 4 were never started.
    expect(seen).toEqual([1, 2]);
    expect(r).toEqual({ done: 2, failures: [], stopped: true });
  });

  it("does not call a run that finished 'stopped'", async () => {
    // Stopping while the last item is in flight stops nothing.
    const r = await runQueue([1, 2], async (n, _i, stop) => {
      if (n === 2) stop();
    });
    expect(r).toEqual({ done: 2, failures: [], stopped: false });
  });

  it("has nothing to do with an empty selection", async () => {
    expect(await runQueue([], async () => {})).toEqual({
      done: 0,
      failures: [],
      stopped: false,
    });
  });
});
