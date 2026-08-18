// Regenerates src/lib/licenses.json — the list Settings → License shows.
//
// Direct dependencies only. The transitive tree is thousands of crates and
// packages, and a list nobody can read credits nobody; what is here is what
// Stash actually chose to depend on, with the version it is built against.
//
//   npm run licenses
//
// Run it whenever a dependency is added, removed, or bumped.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** github.com/a/b.git and git+https://… all reduce to one browsable URL. */
function tidyUrl(url) {
  if (!url) return null;
  return String(url)
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "");
}

function rustDeps() {
  const meta = JSON.parse(
    execFileSync("cargo", ["metadata", "--format-version", "1", "--locked"], {
      cwd: join(root, "src-tauri"),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  );

  // Resolved ids rather than names: two versions of the same crate can sit in
  // the graph, and only the one actually linked belongs on the page. Every
  // dependency table counts, per-platform ones included — libheif is Windows
  // and Linux only and still has to be credited.
  const node = meta.resolve.nodes.find((n) => n.id === meta.resolve.root);
  const direct = new Set(
    node.deps
      .filter((d) => d.dep_kinds.some((k) => k.kind === null))
      .map((d) => d.pkg),
  );

  return meta.packages
    .filter((p) => direct.has(p.id))
    .map((p) => ({
      name: p.name,
      version: p.version,
      license: p.license ?? "see repository",
      url: tidyUrl(p.repository) ?? `https://crates.io/crates/${p.name}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function nodeDeps() {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return Object.keys(pkg.dependencies ?? {})
    .map((name) => {
      const manifest = join(root, "node_modules", name, "package.json");
      if (!existsSync(manifest)) return null;
      const m = JSON.parse(readFileSync(manifest, "utf8"));
      return {
        name,
        version: m.version,
        license: typeof m.license === "string" ? m.license : (m.license?.type ?? "see repository"),
        url: tidyUrl(m.repository?.url ?? m.repository) ?? `https://npmjs.com/package/${name}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// C libraries, which no package manifest in this repo lists. Their versions are
// pinned by the build: libheif by the Cargo feature, libde265 by the distro
// package on Linux and by the vcpkg tag on Windows.
const native = [
  {
    name: "libheif",
    version: "1.23",
    license: "LGPL-2.1-or-later",
    url: "https://github.com/strukturag/libheif",
    note: "Decodes the HEIC photos those two webviews cannot.",
  },
  {
    name: "libde265",
    version: "1.0",
    license: "LGPL-3.0-or-later",
    url: "https://github.com/strukturag/libde265",
    note: "The HEVC decoder libheif hands the actual pixels to.",
  },
];

const out = {
  // Generated file — edit scripts/licenses.mjs, not this.
  rust: rustDeps(),
  node: nodeDeps(),
  native,
};

writeFileSync(join(root, "src/lib/licenses.json"), JSON.stringify(out, null, 2) + "\n");
console.log(
  `licenses.json: ${out.rust.length} crates, ${out.node.length} packages, ${native.length} native libraries`,
);
