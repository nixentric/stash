# 🗃️ Stash

[![Support on Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20Stash-FF5E5B?style=for-the-badge&logo=kofi&logoColor=white)](https://ko-fi.com/nixentric)

A lightweight, offline-first **creative asset manager** for editors and
designers — asset organization, usage tracking, fast search, and interactive
brand guidelines in one portable workspace.

Stash is a desktop application, not a cloud service. Your files never move, your
library is a single file you own, and nothing is uploaded anywhere.

---

## ☕ Help me pay for an Apple Developer membership

Stash is built by one person, and the builds are unsigned — which is why macOS
nags you. It warns on first launch, and because every unsigned build gets a
different code identity, the keychain stops recognising Stash after each update
and asks for your login password all over again. Signing and notarising fixes
both, and that needs an Apple Developer membership at **$99/year**.

If Stash saves you time, [buying me a coffee](https://ko-fi.com/nixentric) goes
straight at that. Everything else stays as it is either way — same MIT licence,
same offline app, no telemetry, no paid tier.

---

## 🤔 Why this exists

Creative work accumulates assets faster than any folder structure survives:
B-roll on a drive, logo variants in Drive, a client's hex codes in a PDF, the
font name in a Slack message from four months ago. The questions that actually
slow work down are not "where is this file" but:

- **What do I have?** — across disks, Drive links, and downloads
- **What does it look like?** — without opening seven applications
- **Have I used this already?** — and in which project
- **What is this brand's blue?** — right now, while the timeline is open

Stash answers those in a couple of seconds, offline, from one file you can hand
to a colleague.

It is not a file manager, not a Drive client, and not a downloader. Originals
are never moved, modified, or downloaded — Stash stores metadata, small
previews, and your own notes.

## 🎬 Who it's for

Video editors, motion designers, graphic designers, content creators, and small
creative teams — anyone who keeps footage, vectors, templates, sound, fonts, and
client brand rules in more places than they can remember.

---

## 📦 Install

Download for your platform from the
[latest release](https://github.com/nixentric/stash/releases/latest): `.dmg` for
macOS (Apple Silicon or Intel), `.exe`/`.msi` for Windows,
`.deb`/`.AppImage`/`.rpm` for Linux. No account, no API key, no config file.

The app is unsigned, so both macOS and Windows warn on first launch —
[how to get past that](docs/install.md#first-launch) takes one click.

---

## 📚 Documentation

| Document | What's in it |
|---|---|
| [Install](docs/install.md) | Downloads per platform, first-launch warnings |
| [Features](docs/features.md) | Asset library, sources, tags, search, usage tracking, shortcuts |
| [Brand guidelines](docs/brand-guidelines.md) | Brands, colors, typography, logos, rules, elements, Quick Brand Kit |
| [The library file](docs/library-file.md) | Offline-first design, portable SQLite format, saving, migrations |
| [Google Drive](docs/google-drive.md) | Link mode, connected mode, OAuth setup |
| [Development](docs/development.md) | Build from source, project layout, tests, tech stack |
| [Troubleshooting](docs/troubleshooting.md) | Common problems and what they actually mean |
| [Roadmap](docs/roadmap.md) | What's next, and what will never be built |
| [Architecture](ARCHITECTURE.md) | Design decisions and their rationale |

---

## 🚧 Feature status

Three states are used throughout the documentation, and they mean exactly this:

| State | Meaning |
|---|---|
| **Available** | Shipped in the current release. Backed by schema, IPC commands, and UI you can click. |
| **In development** | Partially implemented. Some of it works today; the section says which part. |
| **Planned** | Designed, not built. No tables, no commands, no UI. |

| Area | State |
|---|---|
| Asset library — any file type, metadata, previews | **Available** |
| Sources — local disk, Drive links, URLs, bulk paste | **Available** |
| Tags, collections, projects | **Available** |
| Usage tracking and history | **Available** |
| Library search and filters | **Available** |
| Source folders with custom columns | **Available** |
| Brands, colors, typography, logos | **Available** |
| Logo usage rules and do/don't examples | **Available** |
| Graphic elements referencing the asset library | **Available** |
| Quick Brand Kit | **Available** |
| Universal search — assets, source folders, brands, colors, type, logos, elements, additional info | **Available** |
| Scoped search — aim the field at one kind before typing | **Available** |
| Folder tags — tag a folder, optionally covering every file inside | **Available** |
| Clickable tag/value filters | **In development** — Source Folders table only |
| Per-asset custom fields | **In development** — folder-level only today |
| Photography, motion, tone of voice, icon, social guidelines | **Planned** |
| Brand asset collections beyond logos and elements | **Planned** |

---

## 🧭 Principles

**Offline-first.** Every core feature works with the network unplugged. With
Drive disconnected and the update check off, Stash makes zero network requests.

**Your file, not our format.** A library is one SQLite file. Rename it to
`.sqlite` and any SQLite tool opens it.

**Referenced, never duplicated.** Brand logos and graphic elements point at rows
in the asset library, so a file exists exactly once.

**Cloud is optional.** Google Drive is one source among several, never a
requirement. Stash requests read-only scope and implements no write endpoint, so
it structurally cannot modify your Drive.

**No telemetry.** No analytics, no crash reporting, no tracking of any kind.
Stash makes exactly one request on its own behalf — asking GitHub whether a
newer release exists — and **Settings → General** switches that off, after which
it contacts nothing at all unless you connect Drive.

---

## 🛠️ Tech stack

Tauri v2 (Rust) · React + TypeScript · Tailwind · Zustand + TanStack Query ·
SQLite via rusqlite · OS keychain for secrets · GitHub Actions for packaging.

Details in [Development](docs/development.md).

---

## 📄 License

[MIT](LICENSE). Use it, fork it, ship it.
