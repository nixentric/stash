import { describe, expect, it } from "vitest";
import { percent } from "./format";

/**
 * Both progress bars — the preview's stage and the toast — read their width off
 * this, so what it does with a missing or absurd total is the whole story.
 */
describe("percent", () => {
  it("reports whole percentages", () => {
    expect(percent(0, 100)).toBe(0);
    expect(percent(50, 100)).toBe(50);
    expect(percent(100, 100)).toBe(100);
  });

  it("stays null when there is nothing to be a percentage of", () => {
    // Drive sends no Content-Length for some files; a made-up number would be
    // worse than an honest "still going".
    expect(percent(1024, null)).toBeNull();
    expect(percent(1024, undefined)).toBeNull();
    expect(percent(1024, 0)).toBeNull();
  });

  it("never leaves the 0–100 range, whatever the server claimed", () => {
    expect(percent(200, 100)).toBe(100);
    expect(percent(-5, 100)).toBe(0);
  });
});
