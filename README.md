# Stash

A portable, local-first visual catalog for footage that lives in Google Drive.

Stash answers four questions in a couple of seconds: **what footage do I have,
what does it look like, have I used it already, and where is the original?**

It is not a file manager, not a Drive client, and not a downloader. Your original
files never move and are never downloaded — Stash stores metadata, small
previews, and your own notes in a single portable file.

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

**macOS** — right-click the app in Applications and choose **Open**, then
**Open** again in the dialog. If macOS insists the app "is damaged" or refuses
outright, clear the download flag it attached and sign the copy locally:

```bash
xattr -cr /Applications/Stash.app && codesign --force --deep -s - /Applications/Stash.app
```

**Windows** — SmartScreen shows a blue "Windows protected your PC" screen. Click
**More info**, then **Run anyway**.

**Linux** — no warning; the `.AppImage` needs `chmod +x Stash_*.AppImage` first.

---

## Contents

- [Install](#install)
- [Requirements](#requirements)
- [Build from source](#build-from-source)
- [Local development](#local-development)
- [Google Drive: two modes](#google-drive-two-modes)
- [Google OAuth setup](#google-oauth-setup)
- [Environment configuration](#environment-configuration)
- [Build](#build)
- [Database format](#database-format)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Troubleshooting](#troubleshooting)

---

## Requirements

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

---

## Build from source

Only needed if you want to develop Stash or build your own bundles — the
[installers above](#install) need none of this.

```bash
git clone https://github.com/nixentric/stash.git
cd stash
npm install
```

That is the whole setup. No API keys, no `.env`, no account.

```bash
npm run tauri dev
```

---

## Local development

| Command | What it does |
|---|---|
| `npm run tauri dev` | Runs the app with hot reload |
| `npm run dev` | Vite only, in a browser (IPC calls will fail) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Frontend unit tests (Vitest) |
| `cd src-tauri && cargo test` | Backend unit + end-to-end tests |
| `npm run tauri build` | Production bundle |

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

Architecture decisions and their rationale live in
[ARCHITECTURE.md](ARCHITECTURE.md).

### Tests

The backend tests are the ones that matter. `src-tauri/tests/workflow.rs` walks
the entire product end to end: create a library, catalog Drive links with no
account, tag and organize, mark usage, close, reopen, then copy the file to a
simulated second machine and assert that everything — including the thumbnails —
survived.

```bash
cd src-tauri && cargo test
```

---

## Google Drive: two modes

Google Drive integration is **optional**. Stash has two modes, and the first one
needs nothing at all.

### Link mode — the default

Paste Drive share links. No account, no Cloud project, no API.

- Parses every Drive share-URL form and stores the file ID plus your original URL
- Downloads a preview image anonymously when the file is shared
  *"Anyone with the link"*, and stores it locally
- Open in Drive / Copy Link
- Everything else: search, tags, collections, projects, used/unused, usage
  history, ratings, favorites, notes, custom thumbnails

**Limitation:** a folder link cannot be expanded. A share URL carries only the
folder's ID; listing what is inside it requires an authenticated API call.
Stash will not scrape the Drive web page to work around this.

### Connected mode — optional

Adds automation:

- Browse and scan Drive folders, recursively
- Automatic thumbnails and metadata (resolution, duration, size, MIME)
- Metadata sync: detect renamed, moved and trashed files
- Preview private files you have access to

Connecting never changes your data. Disconnecting never deletes any of it —
cached metadata, thumbnails, tags, notes and usage history all remain, and the
library simply returns to link mode.

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

### What Stash asks for, and what it does not

Only `https://www.googleapis.com/auth/drive.readonly` is requested. No write
scope is ever requested, and no write endpoint is implemented, so Stash
structurally cannot modify or delete anything in your Drive.

`drive.file` — the non-restricted alternative — only exposes files the app
itself created, which makes it useless for cataloging footage that already
exists.

---

## Environment configuration

Every environment variable is optional. See [`.env.example`](.env.example).

| Variable | Purpose |
|---|---|
| `STASH_GOOGLE_CLIENT_ID` | OAuth client ID for connected mode |
| `STASH_GOOGLE_CLIENT_SECRET` | OAuth client secret |

Environment variables take precedence over values entered in Settings. If
neither is present, connected mode is simply not offered and everything else
works normally — **the build never fails for missing Google credentials.**

OAuth tokens are never read from or written to `.env`. They live in the OS
keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service).

---

## Build

```bash
npm run tauri build
```

Output lands in `src-tauri/target/release/bundle/`:

- macOS — `.app` and `.dmg`
- Windows — `.msi` and `.exe`
- Linux — `.deb`, `.rpm`, `.AppImage`

For an unsigned local build with the devtools available:

```bash
npm run tauri build -- --debug
```

---

## Database format

A library is a **single SQLite file** with a `.footagedb` extension. Rename it to
`.sqlite` and any SQLite tool will open it — your data is never hostage to this
app.

### What is inside

Footage records, source identity (provider + external ID + your original URL),
provider metadata, tags, collections, projects, usage history, ratings,
favorites, notes, and small embedded thumbnails.

### What is deliberately *not* inside

OAuth tokens, your Google account, and any other credential. Those live in the
OS keychain, so a library file is always safe to send to someone else.

### Portability

The file uses SQLite's rollback journal rather than WAL, specifically so that a
library is genuinely one file with no `-wal`/`-shm` sidecars. You can copy,
move, email, or back it up while the app is open without losing committed
changes.

Thumbnails up to 480px are embedded in the file itself, so a colleague who opens
your library sees the footage immediately — even with no Google account and no
network. Adjustable in **Settings → Library**.

### Saving

Changes are saved automatically; every edit commits immediately. There is no
unsaved state and no Save button.

- **Save a Copy…** — writes a compact snapshot, keeps you in the original
- **Save As…** — writes a snapshot and switches you to it

Both use SQLite's `VACUUM INTO`, which cannot produce a half-written file.

### Migrations

The schema version lives in `PRAGMA user_version`. Opening an older library
takes a timestamped backup next to it (`.footagedb.backup-v1-<timestamp>`), then
migrates in a single transaction. Opening a library created by a *newer* build of
Stash is refused rather than attempted.

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
| `⌘/Ctrl + V` | Paste an image as the selected footage's thumbnail |

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
