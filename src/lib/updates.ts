/**
 * Reading the updater's own failure back to the person in front of it.
 *
 * A release is built one platform at a time and they upload as they finish, so
 * for a few minutes `latest.json` describes a version that exists without the
 * package this machine can install. The updater says so as
 *
 *   None of the fallback platforms `["darwin-aarch64-app", "darwin-aarch64"]`
 *   were found in the response `platforms` object
 *
 * which is true, and useless: it is not an error to act on, it is "wait a bit".
 * Everything here is about telling those two apart.
 */

const PLATFORMS: Record<string, string> = {
  "darwin-aarch64": "macOS (Apple silicon)",
  "darwin-x86_64": "macOS (Intel)",
  "linux-x86_64": "Linux (x86_64)",
  "linux-aarch64": "Linux (ARM64)",
  "windows-x86_64": "Windows (x86_64)",
  "windows-aarch64": "Windows (ARM64)",
};

/**
 * The build this machine needs, when the release does not have it yet — and
 * `null` for every other failure, which stays an error.
 */
export function pendingPlatform(e: unknown): string | null {
  const message = e instanceof Error ? e.message : String(e);
  if (!message.includes("were found in the response")) return null;

  // The quoted list names the same platform twice, once with the `-app` suffix
  // the macOS bundle uses. One name is what a person wants to read.
  const names = [...message.matchAll(/"([^"]+)"/g)]
    .map((m) => m[1]!.replace(/-app$/, ""))
    .map((key) => PLATFORMS[key] ?? key);

  const unique = [...new Set(names)];
  return unique.length > 0 ? unique.join(" or ") : "this device";
}

/** What to say about it, in both places that ask. */
export const pendingUpdateNote = (platform: string) => ({
  title: "A newer version is out, but not for this device yet",
  body:
    `The ${platform} package has not finished uploading. Releases are built one ` +
    "platform at a time, so it usually appears within a few minutes — try again shortly.",
});
