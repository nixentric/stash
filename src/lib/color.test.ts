import { describe, expect, it } from "vitest";
import { colorFormats, hexToRgb, readableOn, rgbToCmyk } from "./format";

describe("hexToRgb", () => {
  it("reads both notations, with or without the hash", () => {
    expect(hexToRgb("#146EF5")).toEqual([20, 110, 245]);
    expect(hexToRgb("146ef5")).toEqual([20, 110, 245]);
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
  });

  it("returns null rather than a wrong colour", () => {
    for (const bad of ["", "#12345", "nope", "#gggggg"]) expect(hexToRgb(bad)).toBeNull();
  });
});

describe("rgbToCmyk", () => {
  it("matches the standard conversion at the corners", () => {
    expect(rgbToCmyk(0, 0, 0)).toEqual([0, 0, 0, 100]);
    expect(rgbToCmyk(255, 255, 255)).toEqual([0, 0, 0, 0]);
    expect(rgbToCmyk(255, 0, 0)).toEqual([0, 100, 100, 0]);
    expect(rgbToCmyk(0, 0, 255)).toEqual([100, 100, 0, 0]);
  });
});

describe("colorFormats", () => {
  it("produces the three copyable strings", () => {
    expect(colorFormats("#146EF5")).toEqual({
      hex: "#146EF5",
      rgb: "rgb(20, 110, 245)",
      cmyk: "92, 55, 0, 4",
    });
  });
});

describe("readableOn", () => {
  it("keeps label text legible on either extreme", () => {
    expect(readableOn("#FFFFFF")).toBe("#000000");
    expect(readableOn("#000000")).toBe("#FFFFFF");
    expect(readableOn("#146EF5")).toBe("#FFFFFF");
  });
});
