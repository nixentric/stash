import { describe, expect, it } from "vitest";
import { nextOffset } from "./queries";
import type { FootageListItem, FootagePage } from "@/lib/types";

/** One `list_footage` answer: the backend clamps every page to 500 rows. */
function page(total: number, offset: number): FootagePage {
  const n = Math.max(0, Math.min(500, total - offset));
  return {
    total,
    items: Array.from({ length: n }, (_, i) => ({ id: offset + i + 1 }) as FootageListItem),
  };
}

describe("nextOffset", () => {
  it("reaches every item of a library far past the first page (#8)", () => {
    const pages = [page(10_400, 0)];
    for (let at = nextOffset(pages); at != null && pages.length < 100; at = nextOffset(pages)) {
      pages.push(page(10_400, at));
    }
    const ids = pages.flatMap((p) => p.items.map((i) => i.id));
    expect(ids).toHaveLength(10_400);
    expect(new Set(ids).size).toBe(10_400);
  });

  it("stops at an empty page even when the count promised more", () => {
    expect(nextOffset([page(900, 0), { total: 900, items: [] }])).toBeUndefined();
  });
});
