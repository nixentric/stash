import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const IMAGE_EXTENSIONS = [
  "jpg", "jpeg", "png", "webp", "gif", "heic", "tif", "tiff", "bmp", "avif",
];
const VIDEO_EXTENSIONS = [
  "mp4", "mov", "mkv", "webm", "m4v", "avi", "mpg", "mpeg", "mts", "mxf",
];

/** What Stash will take in: the file dialog filter and the drop filter, one list. */
export const MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS];

const extOf = (path: string) => path.split(/[\\/]/).pop()?.split(".").slice(1).pop()?.toLowerCase() ?? "";

export const isMediaPath = (path: string) => MEDIA_EXTENSIONS.includes(extOf(path));
export const isImagePath = (path: string) => IMAGE_EXTENSIONS.includes(extOf(path));

/** Filename without its directories. */
export const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");

export const mod = isMac ? "⌘" : "Ctrl";
