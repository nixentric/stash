import { describe, expect, it } from "vitest";
import { baseName, isImagePath, isMediaPath } from "./utils";

describe("dropped paths", () => {
  it("takes media files, whatever the case or platform separator", () => {
    expect(isMediaPath("/Users/a/Shoot 01/clip.MOV")).toBe(true);
    expect(isMediaPath("C:\\Footage\\b-roll.mp4")).toBe(true);
    expect(isImagePath("/a/b/still.jpeg")).toBe(true);
  });

  it("leaves alone what the importer cannot use", () => {
    expect(isMediaPath("/Users/a/Shoot 01")).toBe(false); // a folder
    expect(isMediaPath("/Users/a/notes.pdf")).toBe(false);
    expect(isImagePath("/a/b/clip.mov")).toBe(false); // video is not a thumbnail
    expect(isMediaPath("/a/mp4")).toBe(false); // extension-shaped name, no extension
  });

  it("names a file without its folders", () => {
    expect(baseName("/Users/a/Shoot 01/clip.mov")).toBe("clip.mov");
    expect(baseName("C:\\Footage\\clip.mov")).toBe("clip.mov");
  });
});
