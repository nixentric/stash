# Development

## Build from source

Only needed if you want to develop Stash or build your own bundles — the
[installers](install.md) need none of this.

### Requirements

| | Version | Notes |
|---|---|---|
| Node.js | 20+ | tested on 26 |
| Rust | 1.77+ | tested on 1.97 |
| Tauri prerequisites | v2 | see below |

Tauri needs platform build tools:

- **macOS** — Xcode Command Line Tools: `xcode-select --install`
- **Windows** — Microsoft C++ Build Tools + WebView2 (preinstalled on Win 11)
- **Linux** — `webkit2gtk-4.1`, `libappindicator3`, `librsvg2`, `patchelf`

Full list: <https://tauri.app/start/prerequisites/>

**A Google account is not required.** Stash builds and runs as a complete
catalog with no Google credentials of any kind.

```bash
git clone https://github.com/nixentric/stash.git
cd stash
npm install
npm run tauri dev
```

That is the whole setup. No API keys, no `.env`, no account.

| Command | What it does |
|---|---|
| `npm run tauri dev` | Runs the app with hot reload |
| `npm run dev` | Vite only, in a browser (IPC calls will fail) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Frontend unit tests (Vitest) |
| `cd src-tauri && cargo test` | Backend unit + end-to-end tests |
| `npm run tauri build` | Production bundle |

Output lands in `src-tauri/target/release/bundle/` — `.app`/`.dmg` on macOS,
`.msi`/`.exe` on Windows, `.deb`/`.rpm`/`.AppImage` on Linux.

### Project layout

```
src/                    React + TypeScript
  lib/                  typed IPC wrappers, formatting, types
  hooks/                TanStack Query hooks, selection, hotkeys
  store/                Zustand UI state
  components/           ui/ (shadcn primitives) + feature folders

src-tauri/src/          Rust
  commands/             IPC surface — thin, validating, no business logic
  db/                   schema, migrations, repositories
  source/               provider-agnostic source abstraction
  preview/              preview provider chain, cache, stash:// scheme
  gdrive/               OAuth + Drive API (optional module)
```

### Tests

The backend tests are the ones that matter. `src-tauri/tests/workflow.rs` walks
the entire product end to end: create a library, catalog Drive links with no
account, tag and organize, mark usage, close, reopen, then copy the file to a
simulated second machine and assert that everything — including the thumbnails —
survived.

```bash
cd src-tauri && cargo test
```

### Environment configuration

Every environment variable is optional. See [`.env.example`](../.env.example).

| Variable | Purpose |
|---|---|
| `STASH_GOOGLE_CLIENT_ID` | OAuth client ID for connected mode |
| `STASH_GOOGLE_CLIENT_SECRET` | OAuth client secret |

Environment variables take precedence over values entered in Settings. If
neither is present, connected mode is simply not offered and everything else
works normally.

OAuth tokens are never read from or written to `.env`. They live in the OS
keychain.

---

---

## Tech stack

| Layer | Choice |
|---|---|
| Shell | Tauri v2 (Rust) |
| Frontend | React + TypeScript, Vite |
| UI | Tailwind, shadcn-style primitives |
| State | Zustand (UI), TanStack Query (server state) |
| Database | SQLite via rusqlite — single file, rollback journal |
| Secrets | OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service) |
| Packaging | GitHub Actions matrix → dmg, msi/exe, deb/AppImage/rpm |

Architecture decisions and their rationale live in
[ARCHITECTURE.md](../ARCHITECTURE.md).

---
