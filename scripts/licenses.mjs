// Regenerates src/lib/licenses.json — the list Settings → License shows.
//
// Everything, not just the direct dependencies: a crate three levels down is
// still someone's work that Stash is built on. The ones Stash names itself are
// separated out, because that is the shorter and more useful list to read
// first — the rest of the tree is behind a disclosure.
//
//   npm run licenses
//
// Run it whenever a dependency is added, removed, or bumped.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
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

  const entry = (p) => ({
    name: p.name,
    version: p.version,
    license: p.license ?? "see repository",
    url: tidyUrl(p.repository) ?? `https://crates.io/crates/${p.name}`,
  });

  const all = meta.packages.filter((p) => p.id !== meta.resolve.root);
  return {
    direct: all.filter((p) => direct.has(p.id)).map(entry).sort(byName),
    rest: all.filter((p) => !direct.has(p.id)).map(entry).sort(byName),
  };
}

const byName = (a, b) => a.name.localeCompare(b.name);

function nodeDeps() {
  const modules = join(root, "node_modules");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const direct = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);

  const read = (name) => {
    const manifest = join(modules, name, "package.json");
    if (!existsSync(manifest)) return null;
    const m = JSON.parse(readFileSync(manifest, "utf8"));
    if (!m.name || !m.version) return null;
    return {
      name,
      version: m.version,
      license: typeof m.license === "string" ? m.license : (m.license?.type ?? "see repository"),
      url: tidyUrl(m.repository?.url ?? m.repository) ?? `https://npmjs.com/package/${name}`,
    };
  };

  // Everything installed, not just what package.json names: the build tooling
  // and every package it pulled in are as much a part of this app as the
  // libraries that ship inside it.
  const installed = [];
  for (const dir of readdirSync(modules)) {
    if (dir.startsWith(".")) continue;
    if (dir.startsWith("@")) {
      for (const sub of readdirSync(join(modules, dir))) installed.push(`${dir}/${sub}`);
    } else {
      installed.push(dir);
    }
  }

  const entries = installed.map(read).filter(Boolean);
  return {
    direct: entries.filter((e) => direct.has(e.name)).sort(byName),
    rest: entries.filter((e) => !direct.has(e.name)).sort(byName),
  };
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
  `licenses.json: ${out.rust.direct.length}+${out.rust.rest.length} crates, ` +
    `${out.node.direct.length}+${out.node.rest.length} packages, ${native.length} native libraries`,
);
