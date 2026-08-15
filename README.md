# Stash

A lightweight, offline-first **creative asset manager** for editors and
designers — asset organization, usage tracking, fast search, and interactive
brand guidelines in one portable workspace.

Stash is a desktop application, not a cloud service. Your files never move, your
library is a single file you own, and nothing is uploaded anywhere.

---

## Why this exists

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

---

## Who it's for

- **Video editors** — footage, B-roll, stock, sound effects, music, motion
  graphics, and which client project already used them
- **Motion designers** — templates, transitions, logo animations, brand motion
  rules
- **Graphic designers** — vectors, icons, textures, mockups, brand colors and
  type
- **Content creators** — social templates, thumbnails, per-platform dimensions
- **Small creative teams and freelancers** — one portable library per client,
  handed over as a single file

---

## Install

Grab the installer for your machine from the
[latest release](https://github.com/nixentric/stash/releases/latest):

| Platform | File | Notes |
|---|---|---|
| macOS (Apple Silicon) | `Stash_<version>_aarch64.dmg` | M1 and newer |
| macOS (Intel) | `Stash_<version>_x64.dmg` | |
| Windows | `Stash_<version>_x64-setup.exe` | `.msi` also available |
| Linux (Debian/Ubuntu) | `Stash_<version>_amd64.deb` | `sudo dpkg -i Stash_*.deb` |
| Linux (anything else) | `Stash_<version>_amd64.AppImage` | `chmod +x` then run |

Open the `.dmg` and drag Stash to Applications, or run the `.exe`. There is
nothing else to set up: no account, no API key, no config file.

### First launch

The app is **not signed with a paid Apple or Microsoft certificate**, so both
systems warn about it the first time. The bundles are built in public by
[this workflow](.github/workflows/release.yml) — you can read exactly what
produced them, or build your own from source below.

**macOS** — the first double-click is refused with *"Apple could not verify
Stash is free of malware"*. Click **Done**, then open **System Settings →
Privacy & Security**, scroll to **Security**, and press **Open Anyway** next to
the message about Stash. That records a permanent exception for this app.

On Sequoia (macOS 15) the old right-click → **Open** trick no longer works —
**Open Anyway** is the only click-through. To skip the dialog entirely, remove
the quarantine flag macOS attaches to downloads:

```bash
xattr -dr com.apple.quarantine /Applications/Stash.app
```

**Windows** — SmartScreen shows a blue "Windows protected your PC" screen. Click
**More info**, then **Run anyway**.

**Linux** — no warning; the `.AppImage` needs `chmod +x Stash_*.AppImage` first.

---

## Contents

- [Install](#install)
- [Feature status](#feature-status)
- [Asset library](#asset-library)
- [Footage and sources](#footage-and-sources)
- [Tags, filters, and search](#tags-filters-and-search)
- [Usage tracking](#usage-tracking)
- [Brand guidelines](#brand-guidelines-planned) *(planned)*
- [Quick Brand Kit](#quick-brand-kit-planned) *(planned)*
- [Universal search](#universal-search-planned) *(planned)*
- [Offline-first architecture](#offline-first-architecture)
- [Portable database](#portable-database)
- [Google Drive: optional integration](#google-drive-optional-integration)
- [Tech stack](#tech-stack)
- [Roadmap](#roadmap)
- [Build from source](#build-from-source)
- [Google OAuth setup](#google-oauth-setup)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Troubleshooting](#troubleshooting)

---

## Feature status

Three states are used throughout this document, and they mean exactly this:

| State | Meaning |
|---|---|
| **Available** | Shipped in the current release. Backed by schema, IPC commands, and UI you can click. |
| **In development** | Partially implemented. Some of it works today; the section says which part. |
| **Planned** | Designed, not built. No tables, no commands, no UI. |

| Area | State |
|---|---|
| Asset library (any file type, metadata, previews) | **Available** |
| Footage from local disk, Drive links, URLs, bulk paste | **Available** |
| Tags, collections, projects | **Available** |
| Usage tracking and history | **Available** |
| Library search and filters | **Available** |
| Source folders with custom columns | **Available** |
| Clickable tag/value filters | **In development** — Source Folders table only |
| Per-asset custom fields | **In development** — folder-level only today |
| Brand guidelines (colors, type, logos, rules) | **Planned** |
| Quick Brand Kit | **Planned** |
| Universal search across brands and assets | **Planned** |

The brand layer is the next major body of work. **None of it exists yet** — the
sections below describe the design target, not shipped behaviour.

---

## Asset library

**Status: Available.**

Stash catalogs any file type. Media type is inferred from MIME type, falling back
to the file extension, and drives filtering, preview behaviour, and Quick Look.

| Kind | Recognized as | Examples |
|---|---|---|
| Video | `video` | mp4, mov, mkv, webm, mxf, braw, r3d, prores |
| Images | `image` | jpg, png, webp, gif, heic, tiff, psd, raw (cr2/cr3/nef/arw/dng) |
| Audio | `audio` | mp3, wav, aac, flac, m4a, aiff, ogg |
| Everything else | `other` | svg, ai, pdf, fonts, templates, project files, archives |

In practice that covers footage and B-roll, stock video, photos, PNG assets,
vectors and SVG, illustrations, icons, textures, backgrounds, mockups,
templates, motion graphics, sound effects, music, font files, and logo and brand
assets. Anything Stash cannot generate a preview for is still catalogued,
searchable, taggable, and usage-tracked — you can also paste or drag in your own
thumbnail for it.

### Metadata per asset

| Field | Notes |
|---|---|
| Name | Editable display name, independent of the filename |
| Tags | Free-form, shared namespace with folder tags |
| Source | Provider, external ID, and your original URL |
| Local path | For assets on disk; **Reveal in Finder / File Explorer** |
| Google Drive link | Preserved verbatim; **Open in Drive** / **Copy link** |
| Preview / thumbnail | Auto-fetched where possible, or set by hand |
| Notes | Free text, searchable |
| Usage status | Derived from usage records, never a stored boolean |
| Usage history | Which project, and when |
| Favorite | |
| Rating | 0–5, filterable |
| Date added / modified | |
| Media type, resolution, duration, size | Where the source provides them |

**Category** is not a dedicated field. Collections, tags, and source folders
cover that role today; a first-class category is not planned as a separate
concept.

---

## Footage and sources

**Status: Available.**

Footage remains a first-class part of Stash — it is simply no longer the whole
product. Assets enter the library from:

- **This Computer** — pick files from disk
- **Links** — paste a Drive share link, a plain URL, or a local path
- **Bulk paste** — many links at once, one per line
- **Drive Folder** — browse and scan recursively *(requires connected mode)*

Source identity is stored as provider + external ID + your original URL, so a
record survives being renamed, moved, or re-shared, and the link you pasted is
never rewritten.

### Source folders

Every container path that assets came from becomes a row in **Source Folders**,
with used/unused counts, a preview strip, folder-level tags, and **custom
columns** you define per library (Branch, Client, Shoot date — whatever your
workflow needs). Folder tags apply to everything inside, so tagging a folder
`client-a` makes all its assets findable that way.

---

## Tags, filters, and search

**Status: Available.**

Search matches every whitespace-separated term against display name, notes,
original filename, container path, original URL, tags, collections, and project
names. Terms are ANDed, so `iphone woman outdoor` narrows rather than widens.

Filters combine with the active view and with each other:

- Usage — all / used / unused
- Media type — image, video, audio, other
- Minimum rating
- Favorites only
- Tags — multiple tags, ANDed; a tag matches whether it sits on the asset or on
  its source folder

**Clickable filters — in development.** In the Source Folders table, tags and
custom column values are chips: click to filter the table, click again to
release, and combine several at once. Tags stack with AND; values within one
column stack with OR, since a folder holds a single value per column. The same
interaction has not yet been extended to the main library grid, where tag
filtering happens through the Filters panel.

---

## Usage tracking

**Status: Available.**

Mark an asset as used in a project and Stash records the fact, not a flag.
Deleting a project keeps the usage history. Smart views — **Never Used**,
**Used**, **Recently Used**, **Most Used** — are query presets computed fresh
from those records, so they cannot drift out of sync.

This is what makes "have I already used this B-roll for this client?" a
one-second question.

---

## Brand guidelines *(planned)*

**Status: Planned. Nothing in this section is implemented** — there are no
tables, no IPC commands, and no UI for any of it today. It is documented here as
the design target for the next major version.

The goal is not to store a brand PDF. It is an **interactive brand reference**:
when you are mid-edit and need the client's blue, the heading font, or the white
logo, you get it in one click without leaving the app.

Stash will support **multiple brands** in one library, so a freelancer can hold
every client's guidelines side by side:

```
Brands → Brand A     → Guidelines
Brands → Brand B     → Guidelines
Brands → Client A    → Guidelines
```

### Brand overview

Brand name, description, tagline, website, notes, and a cover thumbnail.

### Color library

Palettes grouped by role — primary, secondary, accent, neutral, background,
semantic. Each color carries a name, HEX, RGB, CMYK, and usage notes, with
quick actions to copy any format. Clicking a swatch copies its HEX. Colors are
searchable, so `blue` surfaces every relevant brand color.

### Typography library

Type scales — display, heading, subheading, body, caption, UI, and fallbacks —
each with font family, weight, size, line height, letter spacing, and usage
notes. Live preview with your own text (type `Promo Agustus` and see it set in
the brand's face), **Copy font name**, and a link to the font file where one is
referenced.

### Logo library

Variants — primary, secondary, horizontal, vertical, icon/symbol, white, black,
monochrome — each holding SVG, PNG, PDF, or a source-file reference, with
preview and quick actions: open file, reveal in Finder/Explorer, open source,
open in Drive.

Usage rules travel with them: clear space, minimum size, background usage, and
correct/incorrect examples.

### Graphic elements

Shapes, patterns, gradients, textures, decorative elements, frames, and
backgrounds — **referenced from the asset library rather than duplicated**, so
there is exactly one copy of every file.

### Photography guidelines

Style, lighting, composition, subject, color treatment, mood, reference
examples, and do/don't pairs.

### Video and motion guidelines

Built for editors: transition style, animation style, logo animation,
intro/outro, lower thirds, subtitle style, motion graphics, aspect ratios, safe
areas, frame-rate recommendations, and reference examples.

### Tone of voice

Brand personality, tone, preferred terminology, words to avoid, CTA style,
example copy, and do/don't pairs.

### Icons and illustration

Icon style, stroke width, corner style, filled vs outline, illustration and
character style, plus example assets.

### Social media guidelines

Per-platform reference — Instagram feed, story, Reels, TikTok, YouTube
thumbnails, banners, LinkedIn — each with dimensions, safe areas, typography,
logo placement, and template references.

### Brand assets

A brand's own collection of logos, vectors, PDFs, PSDs, templates, backgrounds,
patterns, and graphic elements — again as **references into the asset library**,
not a second copy of every file.

---

## Quick Brand Kit *(planned)*

**Status: Planned.**

The 10% of a brand guideline that gets used 90% of the time, one keystroke from
the main workflow:

```text
Brand A

COLORS
Primary Blue     #146EF5   [Copy]
White            #FFFFFF   [Copy]

TYPOGRAPHY
Inter Bold                 [Copy]
Inter Regular              [Copy]

LOGOS
Primary Logo               [Open]
White Logo                 [Open]
```

---

## Universal search *(planned)*

**Status: Planned.** Search today covers the asset library only — names, notes,
filenames, paths, URLs, tags, collections, and projects (see
[Tags, filters, and search](#tags-filters-and-search)). Brand entities do not
exist yet, so they cannot be searched yet.

The target is one search field across every entity, grouped by kind:

```text
Search: red

COLORS
Brand Red — #E92832

ASSETS
Red Gradient.png
Logo Red.svg

GUIDELINES
Red Background Usage
```

```text
Search: instagram

Instagram Feed Template
Instagram Story Template
Social Media Safe Area
Instagram Logo Placement
```

Tags and custom values stay clickable throughout, as interactive filters that
combine with the query.

---

## Offline-first architecture

**Status: Available.**

Everything that matters works with the network unplugged: the database, asset
metadata, tags, search, filters, usage tracking, collections, projects, and
embedded thumbnails. The same will hold for brand guidelines, color, and
typography when they land — they are local data, not a hosted service.

A library that has never been connected to Drive makes **zero network
requests**. No telemetry, no analytics, no crash reporting, no update pings.

Cloud is never a requirement. It is one optional source among several.

---

## Portable database

**Status: Available.**

A library is a **single SQLite file** with a `.footagedb` extension. Rename it to
`.sqlite` and any SQLite tool will open it — your data is never hostage to this
app.

**Inside:** asset records, source identity (provider + external ID + your
original URL), provider metadata, tags, collections, projects, usage history,
ratings, favorites, notes, and small embedded thumbnails.

**Deliberately not inside:** OAuth tokens, your Google account, or any other
credential. Those live in the OS keychain, so a library file is always safe to
send to someone else.

The file uses SQLite's rollback journal rather than WAL, specifically so a
library is genuinely one file with no `-wal`/`-shm` sidecars. Copy it, move it,
email it, or back it up while the app is open without losing committed changes.

Thumbnails up to 480px are embedded, so a colleague who opens your library sees
the assets immediately — with no Google account and no network. Adjustable in
**Settings → Library**.

### Saving

Changes commit immediately. There is no unsaved state and no Save button.

- **Save a Copy…** — writes a compact snapshot, keeps you in the original
- **Save As…** — writes a snapshot and switches you to it

Both use SQLite's `VACUUM INTO`, which cannot produce a half-written file.

### Migrations

The schema version lives in `PRAGMA user_version`. Opening an older library
takes a timestamped backup next to it (`.footagedb.backup-v1-<timestamp>`), then
migrates in a single transaction. Opening a library created by a *newer* build of
Stash is refused rather than attempted.

---

## Google Drive: optional integration

**Status: Available. Optional by design** — Google APIs are never required for
core functionality, and the build never fails for missing Google credentials.

### Link mode — the default

Paste Drive share links. No account, no Cloud project, no API.

- Parses every Drive share-URL form and stores the file ID plus your original URL
- Downloads a preview image anonymously when the file is shared
  *"Anyone with the link"*, and stores it locally
- Open in Drive / Copy Link
- Everything else works normally: search, tags, collections, projects,
  used/unused, usage history, ratings, favorites, notes, custom thumbnails

**Limitation:** a folder link cannot be expanded. A share URL carries only the
folder's ID; listing what is inside it requires an authenticated API call. Stash
will not scrape the Drive web page to work around this.

### Connected mode — optional

Adds automation:

- Browse and scan Drive folders, recursively
- Automatic thumbnails and metadata (resolution, duration, size, MIME)
- Metadata sync: detect renamed, moved, and trashed files
- Preview private files you have access to

Connecting never changes your data. Disconnecting never deletes any of it —
cached metadata, thumbnails, tags, notes, and usage history all remain, and the
library returns to link mode.

Only `drive.readonly` is ever requested. No write scope is requested and no write
endpoint is implemented, so Stash structurally cannot modify or delete anything
in your Drive.

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
[ARCHITECTURE.md](ARCHITECTURE.md).

---

## Roadmap

**Shipped**

- Asset library across local disk, Drive links, and URLs
- Tags, collections, projects, ratings, favorites, notes
- Usage tracking with history and smart views
- Library search and combinable filters
- Source folders with custom columns and clickable facet filters
- Portable single-file database, embedded thumbnails, optional Drive integration

**Next — brand layer**

1. Brand entity and multi-brand navigation
2. Color library with copy actions and search
3. Typography library with custom preview text
4. Logo library with variants, files, and reveal/open actions
5. Quick Brand Kit
6. Logo usage rules, graphic elements referencing the asset library

**After that**

7. Universal search across assets, brands, colors, type, logos, and guidelines
8. Photography, video/motion, tone of voice, icon, and social guidelines
9. Per-asset custom fields, generalizing today's folder columns
10. Clickable facet filters across the main library grid

**Not planned**

- Cloud sync, accounts, or a hosted backend
- Editing, converting, or downloading your source files
- Any write access to Google Drive

---

## Build from source

Only needed if you want to develop Stash or build your own bundles — the
[installers above](#install) need none of this.

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

Every environment variable is optional. See [`.env.example`](.env.example).

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

## Google OAuth setup

Only needed for connected mode. Takes about five minutes.

### 1. Create a Google Cloud project

Go to <https://console.cloud.google.com/> → **Select a project** → **New Project**.
Name it anything.

### 2. Enable the Drive API

**APIs & Services → Library** → search *Google Drive API* → **Enable**.

### 3. Configure the OAuth consent screen

**APIs & Services → OAuth consent screen**

- User type: **External**
- Fill in app name, your email for both support and developer contact
- On the **Scopes** step, add `.../auth/drive.readonly`
- On the **Test users** step, add your own Google account

### 4. ⚠️ Set publishing status to "In production"

**This step is not optional, and skipping it is the most common problem.**

Google issues refresh tokens that **expire after 7 days** to any app whose
consent screen is still in *Testing*, unless it only requests basic profile
scopes. Stash requests `drive.readonly`, so the 7-day rule applies — you would
have to reconnect every week.

On the OAuth consent screen page, click **Publish app**.

You do *not* need to complete Google's verification review for personal use.
Your app stays "unverified", which means you will see a warning screen the first
time you connect (see step 7) and the app is capped at 100 users. Both are fine
for a personal or small-team tool.

### 5. Create the OAuth client

**APIs & Services → Credentials → Create Credentials → OAuth client ID**

- Application type: **Desktop app**
- Name: anything

Copy the **Client ID** and **Client secret**.

> Stash uses the loopback redirect (`http://127.0.0.1:<random port>`) with PKCE,
> which is Google's recommended flow for desktop apps. You do not need to
> configure any redirect URI yourself — desktop clients allow loopback
> automatically.

### 6. Enter them in Stash

Open **Settings** (`⌘,` / `Ctrl+,`) → **Integrations** → expand **OAuth client**.

Paste the Client ID and Client secret, then **Save client**.

The client ID is stored in app preferences. The client secret goes into your
operating system's keychain — never into your `.footagedb` library, and never
into a file in this repo.

### 7. Connect

Click **Connect Google Drive**. Your browser opens.

- Because the app is unverified, Google shows
  *"Google hasn't verified this app"* → click **Advanced** →
  **Go to \<your app name\> (unsafe)**. This is your own app and your own Cloud
  project; the warning only means Google has not reviewed it.
- Grant the read-only Drive permission.
- The browser shows "Google Drive connected". Close the tab.

Stash now shows your account email in Settings, and **Drive Folder** in Add
Footage becomes a browser and scanner.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `⌘/Ctrl + N` | New library |
| `⌘/Ctrl + O` | Open library |
| `⌘/Ctrl + F` | Search |
| `⌘/Ctrl + A` | Select all |
| `⌘/Ctrl + I` | Toggle inspector |
| `⌘/Ctrl + ,` | Settings |
| `Space` | Quick Look |
| `Esc` | Close preview / clear selection |
| `←` `→` | Previous / next in Quick Look |
| `F` | Toggle favorite |
| `U` | Mark as used |
| `Delete` | Remove from library (never touches the source) |
| `⌘/Ctrl + click` | Add to selection |
| `Shift + click` | Extend selection |
| `⌘/Ctrl + V` | Paste an image as the selected asset's thumbnail |

---

## Troubleshooting

**Thumbnails don't appear for Drive links.**
Anonymous previews only work for files shared *"Anyone with the link"*. If a file
is Restricted, Google returns a sign-in page rather than an image — Stash reports
this as *"No access to this source"*, not as a missing file. Fix it by sharing
the file, connecting Drive, or setting a thumbnail yourself (right-click → **Set
Thumbnail…**, or paste/drag an image onto the card).

**"Google Drive folder detected" and nothing imports.**
Expected in link mode. Folder contents require the API. Either connect Drive, or
open the folder and paste the individual file links.

**I have to reconnect Google Drive every week.**
Your OAuth consent screen is still in *Testing*. See
[step 4](#4-️-set-publishing-status-to-in-production).

**"Google hasn't verified this app".**
Expected for your own unverified Cloud project. Click **Advanced** → **Go to
\<app\> (unsafe)**.

**macOS asks for the login keychain password repeatedly.**
Fixed in 0.1.4 — secrets are now read once per launch. The prompt still appears
once after each update, because the keychain ties access to the app's code
signature and an ad-hoc signature changes with every build. Choose **Always
Allow** to silence it for that version.

**Connecting works, but is forgotten after a restart.**
No usable OS keychain was found. Stash refuses to write credentials to disk
rather than storing them in plaintext. On a bare Linux session, install and
unlock a Secret Service provider such as `gnome-keyring`.

**"This library was created by a newer version of Stash".**
Update Stash. Opening it with an older build would risk corrupting it, so it is
refused.

**"… is not a Stash library".**
The file is not a Stash database, or its header markers were stripped by a
third-party tool.

**Previews are stale or the cache is huge.**
**Settings → Preview → Clear cache**. Only disposable data is removed; the
thumbnails inside your library are untouched.

**A file shows "Source missing".**
Set only by an authenticated 404 or an explicit trashed flag — never by a failed
anonymous request. The record keeps every tag, note, rating and usage record, so
restoring the file in Drive and running a sync brings it back.

---

## Privacy

No telemetry. No analytics. No crash reporting. No update pings. Your library is
never uploaded anywhere. A library that is never connected to Drive makes zero
network requests.
