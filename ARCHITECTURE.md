# ARCHITECTURE.md

**Stash** — a portable, local-first visual footage catalog for designers and editors.

> Core rule: Stash is a *catalog*, not a file manager, not a Drive client, not a
> DAM. It never downloads original footage. It stores *what you have*, *what it
> looks like*, and *whether you already used it*.

---

## 0. Non-negotiable constraints

These drove every decision below. They are listed first so any future change can
be checked against them.

| # | Constraint | Consequence |
|---|---|---|
| C1 | The library is **one portable file** (`.footagedb`) | SQLite in rollback-journal mode, no sidecar files, no AppData-only storage |
| C2 | **Google Drive API is optional** | Zero Google code on the required path; build succeeds with no credentials |
| C3 | A shared `.footagedb` must still be **visual** on another machine | Small thumbnails live *inside* the DB as capped BLOBs |
| C4 | **Never download original footage** | Only metadata, thumbnails, and ranged streaming for preview |
| C5 | **No OAuth token in the `.footagedb`** | Tokens go to the OS keychain, keyed by account, never to the library |
| C6 | The core app **must not know what Google Drive is** | Provider + capability abstraction; `footages` table has no Google columns |
| C7 | 10,000+ records stay fast | Indexed SQL, server-side paging, virtualized grid, lazy thumbnails |
| C8 | No telemetry, no analytics, no server | Everything is local; network egress only to Google, only when connected |

---

## 1. System overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  WebView (React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui)   │
│                                                                     │
│   Views          Library · Inspector · QuickLook · Settings         │
│   State          TanStack Query (server state) · Zustand (UI state) │
│   Knows about    Footage, Source{provider,…}, Capabilities          │
│   Does NOT know  Google Drive, OAuth, SQL, file paths, thumbnails   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │  Tauri IPC (typed commands + events)
                               │  stash:// URI scheme (ranged media)
┌──────────────────────────────┴──────────────────────────────────────┐
│  Rust core (src-tauri)                                              │
│                                                                     │
│  commands/    thin, validating IPC surface — no business logic       │
│  library/     open · create · saveas · close · migrate · backup      │
│  db/          schema, migrations, repositories, query builder        │
│  source/      SourceProvider trait · registry · capabilities         │
│  preview/     PreviewProvider chain · thumbnail cache · encoder      │
│  gdrive/      OAuth (PKCE loopback) · Files API client · sync        │
│  jobs/        cancellable background workers + progress events       │
│  prefs/       app preferences (JSON) + keychain (secrets)            │
└──────────────────────────────┬──────────────────────────────────────┘
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
  My Library.footagedb    App preferences        OS Keychain
  (portable, user-owned)  + preview cache        (OAuth tokens)
  SQLite                  (disposable)           (never in library)
```

### Frontend / backend boundary

The rule is **the WebView never holds a secret and never holds a file handle.**

| Responsibility | Side |
|---|---|
| SQL, transactions, migrations | Rust |
| OAuth, token storage, refresh | Rust |
| Network calls to Google | Rust |
| Thumbnail decode / resize / encode | Rust |
| Filtering, sorting, pagination | Rust (SQL) |
| Selection state, focus, dialogs | React |
| Keyboard shortcuts, layout, theme | React |
| Optimistic updates + cache invalidation | React (TanStack Query) |

Filtering and sorting are deliberately **not** done in JavaScript. At 10k records,
shipping the whole table to the WebView to filter it is the thing that makes
these apps feel slow. The grid asks for `{ filters, sort, offset, limit }` and
gets back a page plus a total count.

---

## 2. The portable library file

### 2.1 Format

A `.footagedb` file is **a plain SQLite 3 database**. No container, no
encryption, no proprietary framing. Rename it to `.sqlite` and any SQLite tool
opens it. This is a feature: the user's data is never hostage to this app.

Identity is asserted by two things, checked on open:

1. `PRAGMA application_id = 0x53544148` (`"STAH"`) — cheap, standard SQLite
   practice, survives copying.
2. A row in `app_metadata` with `key = 'format'`, `value = 'stash-library'`.

Opening a SQLite file that fails both is rejected with a clear message rather
than being silently migrated into something else.

### 2.2 Why not WAL — the single-file rule

SQLite's WAL mode is faster, and it is the wrong choice here.

WAL creates `library.footagedb-wal` and `library.footagedb-shm` next to the
database. They are removed on a clean close, but they exist for the entire time
the app is open — which is exactly when a user is most likely to drag the file
into Dropbox, AirDrop it, or copy it to a USB stick. Copying only the main file
while a WAL is live loses every committed change still sitting in the log.

So the library opens with:

```sql
PRAGMA journal_mode = DELETE;   -- rollback journal, deleted at end of each txn
PRAGMA synchronous  = FULL;     -- durable; write volume here is tiny
PRAGMA foreign_keys = ON;
```

The cost is real but irrelevant to this workload: writes are user actions
(tag a clip, mark it used), not a stream. Bulk import wraps thousands of inserts
in **one transaction**, so an import pays for one journal cycle, not 5,000.

> `ponytail:` rollback journal costs ~1 fsync per transaction. If some future
> feature does sustained small writes, batch them rather than switching to WAL —
> switching to WAL breaks C1.

### 2.3 Save model: autosave, and what "Save As" means

**Decision: autosave. There is no dirty state and no "unsaved changes" dialog.**

This was requirement §41's open question, and the answer is that a dirty-buffer
model would be *actively worse* here:

- SQLite already gives ACID durability per transaction. To implement "unsaved
  changes" we would have to *undo* that — hold edits in memory or in a temp
  overlay and flush on Save. That means inventing a second, weaker persistence
  layer whose only feature is the ability to lose data on a crash.
- A footage catalog is edited in small, intentional, independent acts. Tagging a
  clip is not a draft. There is no coherent "revert the document" gesture the
  user would actually want.
- Every comparable tool — Lightroom, Eagle, Capture One, Photos — autosaves for
  exactly this reason.

So the UI states `All changes saved`, and the two document commands mean:

| Command | Implementation | Semantics |
|---|---|---|
| **Save a Copy** | `VACUUM INTO '<path>'` | Writes a defragmented snapshot. Keeps working in the *original*. |
| **Save As** | `VACUUM INTO '<path>'`, then reopen that path | Snapshot, then switch to it. Original left untouched at its last state. |

`VACUUM INTO` (SQLite ≥ 3.27) is transactionally safe, produces a compact file,
and cannot half-write a target. It is strictly better than copying bytes.

### 2.4 Migrations and backup

Schema version lives in `PRAGMA user_version` — an integer in the SQLite header,
so it is readable *before* trusting any table.

```
open(path)
 ├─ application_id / format check ─────────── fail → "Not a Stash library"
 ├─ v = user_version
 ├─ v >  APP_SCHEMA_VERSION ───────────────── fail → "Created by a newer version
 │                                                     of Stash. Please update."
 ├─ v == APP_SCHEMA_VERSION ───────────────── open
 └─ v <  APP_SCHEMA_VERSION
       ├─ copy → "<name>.footagedb.backup-v<v>-<timestamp>"   ← always, cheap
       ├─ BEGIN
       ├─ apply migrations v+1 … APP_SCHEMA_VERSION
       ├─ PRAGMA user_version = APP_SCHEMA_VERSION
       └─ COMMIT   (any error → ROLLBACK, restore backup, report)
```

Migrations are an ordered `&[(u32, &str)]` array in `db/migrations.rs`. Rules:

- Migrations are **append-only**. A shipped migration is never edited.
- Every migration is **additive** where possible (new table, new column with
  default, new index). Destructive changes require the 12-step SQLite table
  rebuild and a bumped backup retention.
- The backup is taken **before** the transaction opens, because a rollback
  cannot undo a corrupted file, only a failed statement.

Opening a *newer* database read-only is refused rather than attempted. Silently
opening a v9 file with v7 code is how catalogs get destroyed.

---

## 3. Data model

### 3.1 The user-metadata / source-metadata split

This split is the backbone of the whole design (requirement §25, §31).

```
        ┌───────────────────────┐        ┌───────────────────────┐
        │      footages         │  1:1   │       sources         │
        │  USER metadata        ├────────┤  PROVIDER metadata    │
        │  authored by you      │        │  reported by the      │
        │  never overwritten    │        │  source; refetchable  │
        │  by any sync          │        │  freely overwritten   │
        └───────────────────────┘        └───────────────────────┘
```

- **`footages`** holds what *you* wrote: display name, notes, rating, favorite,
  tags, collections, usage. This survives everything. Sync never touches it.
- **`sources`** holds what the *provider* said: real filename, MIME type, size,
  resolution, duration, folder path. It may be entirely `NULL` — that is a
  normal, fully supported state (link mode with no API).

Because of this split, disconnecting Google Drive cannot damage the library, and
connecting it later cannot clobber the user's names. Everything valuable is on
the left-hand side of that diagram.

Crucially, `footages` contains **no Google-specific column**. Adding Dropbox or a
NAS later means one new `provider` value and one new provider implementation —
not a schema migration of the main table.

### 3.2 Schema

```sql
-- ── identity / user metadata ────────────────────────────────────────────────
CREATE TABLE footages (
  id             INTEGER PRIMARY KEY,
  display_name   TEXT    NOT NULL,              -- always present, user-editable
  media_type     TEXT    NOT NULL,              -- image|video|audio|other|unknown
  notes          TEXT    NOT NULL DEFAULT '',
  rating         INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  favorite       INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0,1)),
  date_added     TEXT    NOT NULL,              -- ISO-8601 UTC
  date_modified  TEXT    NOT NULL,
  -- derived, trigger-maintained (see 3.3)
  usage_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at   TEXT
);

-- ── where it lives + what the provider says about it ────────────────────────
CREATE TABLE sources (
  footage_id       INTEGER PRIMARY KEY REFERENCES footages(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL,               -- 'google_drive' | 'local' | 'url'
  external_id      TEXT,                        -- Drive fileId; canonical identity
  original_url     TEXT,                        -- exactly as the user gave it
  local_path       TEXT,
  container_id     TEXT,                        -- Drive parent folder id
  container_path   TEXT,                        -- 'Footage / Repair / August'
  -- provider-reported metadata; all nullable by design
  original_filename TEXT,
  mime_type        TEXT,
  file_size        INTEGER,
  width            INTEGER,
  height           INTEGER,
  duration_ms      INTEGER,
  source_created_at  TEXT,
  source_modified_at TEXT,
  -- runtime state, cached
  accessibility    TEXT NOT NULL DEFAULT 'unknown',
  last_synced_at   TEXT
);
-- duplicate detection (§30): identity is (provider, external_id), never filename
CREATE UNIQUE INDEX ux_sources_external
  ON sources(provider, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX ux_sources_localpath
  ON sources(provider, local_path)  WHERE local_path  IS NOT NULL;

-- ── portable thumbnails: separate table so list queries never touch BLOBs ────
CREATE TABLE thumbnails (
  footage_id   INTEGER PRIMARY KEY REFERENCES footages(id) ON DELETE CASCADE,
  data         BLOB NOT NULL,        -- JPEG, longest edge 480px, hard cap 64 KiB
  width        INTEGER NOT NULL,
  height       INTEGER NOT NULL,
  origin       TEXT    NOT NULL,     -- 'provider' | 'custom' | 'generated'
  pinned       INTEGER NOT NULL DEFAULT 0,  -- 1 = user-set, sync must not replace
  updated_at   TEXT    NOT NULL
);

-- ── usage ───────────────────────────────────────────────────────────────────
CREATE TABLE projects (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color      TEXT,
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE footage_usage (
  id         INTEGER PRIMARY KEY,
  footage_id INTEGER NOT NULL REFERENCES footages(id) ON DELETE CASCADE,
  project_id INTEGER          REFERENCES projects(id) ON DELETE SET NULL, -- NULL = "used, no project"
  used_at    TEXT NOT NULL,
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX ix_usage_footage ON footage_usage(footage_id);
CREATE INDEX ix_usage_project ON footage_usage(project_id);
CREATE INDEX ix_usage_date    ON footage_usage(used_at DESC);

-- ── tags / collections ──────────────────────────────────────────────────────
CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE footage_tags (
  footage_id INTEGER NOT NULL REFERENCES footages(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id)     ON DELETE CASCADE,
  PRIMARY KEY (footage_id, tag_id)
);
CREATE INDEX ix_footage_tags_tag ON footage_tags(tag_id);

CREATE TABLE collections (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL
);
CREATE TABLE collection_footages (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  footage_id    INTEGER NOT NULL REFERENCES footages(id)    ON DELETE CASCADE,
  added_at      TEXT NOT NULL,
  PRIMARY KEY (collection_id, footage_id)
);
CREATE INDEX ix_coll_footage ON collection_footages(footage_id);

-- ── remembered source containers (Drive folders etc.) ───────────────────────
CREATE TABLE source_containers (
  id           INTEGER PRIMARY KEY,
  provider     TEXT NOT NULL,
  external_id  TEXT,
  name         TEXT NOT NULL,
  path         TEXT NOT NULL,
  original_url TEXT,
  last_scanned_at TEXT,
  UNIQUE (provider, external_id)
);

CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

Index rationale — every one of these backs a specific sidebar view or sort from
§24/§25, and nothing else is indexed:

```sql
CREATE INDEX ix_footages_added    ON footages(date_added DESC);
CREATE INDEX ix_footages_usage    ON footages(usage_count);        -- Used/Unused/Most Used
CREATE INDEX ix_footages_lastused ON footages(last_used_at DESC);  -- Recently Used
CREATE INDEX ix_footages_fav      ON footages(favorite) WHERE favorite = 1;
CREATE INDEX ix_footages_type     ON footages(media_type);
CREATE INDEX ix_footages_rating   ON footages(rating);
```

### 3.3 Derived usage status — why `usage_count` is stored

Requirement §16 says status must be derived from history, and that redundant
state must not cause inconsistency. Those two goals conflict if you store the
counter in application code — so the counter is stored, but **application code
can never write it**. Triggers own it:

```sql
CREATE TRIGGER trg_usage_ai AFTER INSERT ON footage_usage BEGIN
  UPDATE footages SET
    usage_count  = (SELECT COUNT(*) FROM footage_usage WHERE footage_id = NEW.footage_id),
    last_used_at = (SELECT MAX(used_at) FROM footage_usage WHERE footage_id = NEW.footage_id)
  WHERE id = NEW.footage_id;
END;
-- …matching AFTER DELETE and AFTER UPDATE triggers
```

The invariant `usage_count = COUNT(footage_usage)` therefore holds by
construction, including for rows deleted by `ON DELETE CASCADE`. Delete the last
usage record and the footage returns to `Unused` automatically. Status is a pure
function: `usage_count > 0 → Used`. It is never stored as a boolean.

The payoff is that `Unused`, `Recently Used`, and `Most Used` become
index-backed single-table scans instead of correlated subqueries over
`footage_usage` — the difference between instant and janky at 10k rows.

### 3.4 Search

Search spans filename, display name, tags, collections, projects, notes, and
Drive folder path (§23). Implementation is a single indexed SQL statement using
`LIKE` with case-insensitive collation across those columns, with each
whitespace-separated term ANDed.

Universal search (`db/repo/search.rs`) reuses that filter for its asset half
rather than growing a second dialect of the same SQL — anything that becomes
searchable for the grid becomes searchable in the panel for free. The other
halves are one statement per kind (source folders, brands, colors, typefaces,
logos, elements, additional infos, logo rules), capped at five hits each, so
the ranking rules for the whole result set sit in one file. A hit carries the
brand it belongs to, and optionally a hex to paint or a URL to open — that is
what lets the panel act on a click without a second round trip.

> `ponytail:` `LIKE '%term%'` is a full scan — measured at roughly 8 ms over
> 10,000 rows, which is well inside "instant" for a debounced 150 ms input.
> Upgrade path if a library ever reaches ~100k rows: an FTS5 external-content
> table over a denormalized search blob, rebuilt on tag/usage change. Not built
> now because it adds trigger complexity for a problem that does not exist yet.

---

## 4. Source provider architecture

### 4.1 The abstraction

```rust
pub enum Provider { GoogleDrive, Local, Url }

/// Runtime answer to "what can I actually do with this thing right now?"
#[derive(Serialize, Clone, Copy)]
pub struct Capabilities {
    pub can_open:              bool,  // open in browser / reveal in Finder
    pub can_preview:           Tri,   // Yes | BestEffort | No
    pub can_fetch_metadata:    bool,
    pub can_browse_container:  bool,  // folder browser
    pub can_sync:              bool,
    pub can_download_thumbnail: bool,
    pub can_resolve_private:   bool,
}

pub trait SourceProvider: Send + Sync {
    fn id(&self) -> Provider;
    fn capabilities(&self) -> Capabilities;
    fn parse(&self, input: &str) -> Option<ParsedSource>;
    async fn fetch_metadata(&self, s: &SourceRef) -> Result<SourceMetadata>;
    async fn list_container(&self, id: &str, recursive: bool) -> Result<Vec<RemoteEntry>>;
    async fn check_accessibility(&self, s: &SourceRef) -> Result<Accessibility>;
}
```

`Tri::BestEffort` exists specifically so the UI can say "we'll try" without
promising. It is what anonymous Drive returns.

### 4.2 Capability matrix

| | `can_open` | `can_preview` | `metadata` | `browse` | `sync` | `private` |
|---|---|---|---|---|---|---|
| **Local** | yes | yes | yes | yes | yes | n/a |
| **URL** | yes | best-effort | partial | no | no | no |
| **Drive — Link mode** | **yes** | **best-effort** | no | **no** | no | no |
| **Drive — Connected** | yes | yes | yes | yes | yes | yes |

The UI reads this matrix; it never branches on `provider == 'google_drive'`.
"Scan Folder" is disabled-with-reason because `can_browse_container` is false,
not because of a Google-specific check. That is what makes requirement §12
("capability based UI") structurally true rather than a convention someone has
to remember.

### 4.3 Google Drive: two modes, one provider

```
                        GoogleDriveProvider
                                │
              ┌─────────────────┴─────────────────┐
        LINK MODE (default)              CONNECTED MODE (opt-in)
        no account, no API                OAuth + Drive API v3
        no Cloud project
              │                                   │
    • parse share URLs                  • everything in link mode
    • store fileId + original URL       • files.get real metadata
    • open in browser                   • recursive folder scan
    • best-effort public thumbnail      • authenticated thumbnails
    • user-supplied thumbnail           • private file streaming
                                        • metadata sync, rename/move detection
```

Link mode is not a degraded fallback — it is the **default and complete**
product. Connected mode adds automation. This is the inversion requirement §C2
demanded.

### 4.4 URL parsing

The parser accepts every share form Google currently emits and normalizes them,
but it stores all three of `provider`, `external_id`, and the **untouched
original URL** (§5). A transformed URL is never the only record.

Recognized:

```
https://drive.google.com/file/d/{ID}/view?usp=sharing
https://drive.google.com/open?id={ID}
https://drive.google.com/uc?id={ID}&export=download
https://drive.google.com/drive/folders/{ID}                → container
https://drive.google.com/drive/u/0/folders/{ID}            → container
https://docs.google.com/{doc|spreadsheets|presentation}/d/{ID}/edit
https://drive.google.com/file/d/{ID}/view?resourcekey={RK} → id + resourceKey
```

`resourceKey` is preserved when present; older shared files require it and
dropping it turns a working link into a 404.

Bulk paste (§14, §15) runs the same parser over each line. The
`Label\nURL` pattern from §15 is detected conservatively: a non-URL line
immediately followed by exactly one URL line becomes that entry's display name.
Anything ambiguous is imported as a bare link rather than guessed at — a wrong
auto-name is worse than no name.

---

## 5. Preview architecture

### 5.1 Provider chain

The UI calls one thing: `PreviewService::thumbnail(footage_id)`. It has no idea
what answered.

```
  request thumbnail(id)
        │
        ▼
  ┌───────────────────────────────────────────────┐
  │ 1. disk cache        <cache>/previews/<hash>  │ ← fastest, larger (1600px)
  ├───────────────────────────────────────────────┤
  │ 2. portable BLOB     thumbnails.data          │ ← travels with .footagedb
  ├───────────────────────────────────────────────┤
  │ 3. provider chain, first success wins:        │
  │      LocalFileProvider          (local)       │
  │      GoogleDriveApiProvider     (connected)   │
  │      BestEffortDrivePublic      (link mode)   │  ← isolated, replaceable
  │      HttpImageProvider          (url)         │
  ├───────────────────────────────────────────────┤
  │ 4. media-type placeholder (never an error)    │
  └───────────────────────────────────────────────┘
        │ on any success from step 3
        ▼
  downscale → encode JPEG → write BLOB (≤64 KiB) + write disk cache
```

A failure at every level is **not an error state**. It renders a typed
placeholder. Requirement §3: the app must never break because a preview didn't
load.

### 5.2 Why the thumbnail is copied into the database

`thumbnailLink` is documented as *"A short-lived link to the file's thumbnail…
Typically lasts on the order of hours."* Therefore the URL is **never stored**.
The bytes are fetched once, re-encoded, and stored; the canonical reference kept
in the database is `(provider, external_id)`, which is stable forever.

Two tiers, because they answer two different questions:

| | Portable thumbnail | Local preview cache |
|---|---|---|
| Lives in | `thumbnails.data` BLOB inside `.footagedb` | app cache dir, disk |
| Size | longest edge 480px, JPEG q78, **hard cap 64 KiB** | longest edge 1600px |
| Travels with the file | **yes** | no |
| Disposable | no | yes — deletable at any time |
| Purpose | the library stays visual on any machine | crisp Quick Look |

Budget check for C3: 10,000 footage × ~35 KiB median ≈ **350 MB**. That is a
large but sendable file, and it is the price of "my colleague opens the library
and immediately sees everything". A Library setting offers `480px` (default),
`320px` (≈160 MB), or `None` for users who prefer a lean file.

The 64 KiB cap is enforced by re-encoding at descending quality, not by
rejecting the image, so a pathological source can never bloat the library.

### 5.3 Missing-thumbnail recovery (§9)

`.footagedb` arrives on a new machine → disk cache is empty, but BLOBs are
present → **grid renders immediately**. Quick Look falls back to the 480px BLOB
upscaled until a higher-resolution fetch succeeds. If Drive is connected, a
background job refills the disk cache for whatever the user is actually looking
at, viewport-first. If it is not connected, the 480px thumbnails remain, and the
library stays fully usable — which is the entire point of C3.

### 5.4 Video playback

`<video>` cannot send an `Authorization` header, so authenticated streaming
needs a shim. The two obvious shims are a local HTTP proxy (open port, needs its
own auth) or a custom URI scheme. Tauri v2 provides
`register_asynchronous_uri_scheme_protocol`, which supports partial responses —
so there is no port to secure and no proxy to write.

```
  <video src="stash://media/{footage_id}">
        │  browser sends Range: bytes=0-…
        ▼
  Rust scheme handler
        ├─ local        → ranged read from disk                        → 206
        ├─ drive+conn.  → GET files/{id}?alt=media, Range forwarded    → 206
        └─ otherwise    → 404, UI shows the fallback below
```

Range is forwarded verbatim, which is what makes seeking work while downloading
only the requested bytes — satisfying C4. The Drive docs confirm `alt=media`
honors `Range: bytes=…`.

Fallbacks, in order:

1. **Connected** → `stash://` stream, native `<video>`, full scrub control.
2. **Link mode, public file** → Google's own published embed,
   `https://drive.google.com/file/d/{ID}/preview`, in a sandboxed iframe. This is
   the snippet Drive's own "Embed item" UI produces. Best-effort.
3. **Anything else** → the honest state:
   `Preview unavailable · [Open in Google Drive]`.

### 5.5 The best-effort provider is quarantined on purpose

Anonymous thumbnail retrieval uses `drive.google.com/thumbnail?id={ID}&sz=w480`.
This endpoint is **not part of the documented API** and Google may change it.
It therefore lives alone in `preview/providers/best_effort_drive.rs` behind the
same `PreviewProvider` trait as everything else, and requirement §30's rule is
enforced structurally: deleting that one file degrades link-mode auto-thumbnails
to manual ones and breaks nothing else. It is never used when connected mode is
available, and a non-image response (an HTML sign-in page) is classified as
`PermissionRequired`, not as a missing file.

### 5.6 User-supplied thumbnails

Because auto-preview can never be guaranteed without the API, manual thumbnails
are a first-class path, not a workaround (§7–§9): **Set Thumbnail…** (file
picker), **Paste** (clipboard image), and **drag an image onto the card**. All
three land in the same pipeline, stored with `origin='custom'` and `pinned=1`.
Pinned thumbnails are never overwritten by sync — if you chose a frame, it stays.

---

## 6. Google Drive integration (optional module)

### 6.1 Credentials are runtime configuration, never build-time

The build must never depend on Google credentials (§19). So `GOOGLE_CLIENT_ID`
is not compiled in. It is resolved at runtime, first match wins:

1. Environment variable `STASH_GOOGLE_CLIENT_ID` / `STASH_GOOGLE_CLIENT_SECRET`
2. App preferences (the user pastes their own Cloud project's client into
   Settings → Integrations)
3. Absent → connected mode is simply not offered

Case 3 shows *"Advanced Google Drive integration isn't configured"* inside the
Integrations pane only. It never appears anywhere else in the app, and no
feature outside that pane is blocked by it (§12).

### 6.2 OAuth flow

Installed-app OAuth: the out-of-band copy/paste flow is **no longer supported**,
and loopback redirect remains the recommended option for desktop. PKCE is used.

```
 1. bind 127.0.0.1:0                    → ephemeral port, no fixed port to squat
 2. verifier = 64 random bytes          challenge = BASE64URL(SHA256(verifier))
 3. open system browser →
      https://accounts.google.com/o/oauth2/v2/auth
        ?client_id=…&redirect_uri=http://127.0.0.1:{port}
        &response_type=code&scope=drive.readonly
        &code_challenge={challenge}&code_challenge_method=S256
        &state={random}&access_type=offline&prompt=consent
 4. handle exactly one GET on the loopback socket; verify `state`; close listener
 5. POST https://oauth2.googleapis.com/token   (+ code_verifier)
 6. refresh_token → OS keychain.  access_token → memory only.
```

The listener accepts one request and shuts down; `state` is compared in constant
time; a mismatch aborts without touching the keychain.

**Scope: `drive.readonly`.** `drive.file` cannot see files the app did not
create, which makes cataloging an existing library impossible. `drive.readonly`
is a *restricted* scope — for a personal Cloud project in testing mode this
requires nothing, and the README documents the verification requirement for
anyone distributing their own build. The app is read-only against Drive by
design, so it never requests write scope.

### 6.3 Token storage

| Secret | Where | Never |
|---|---|---|
| refresh token | OS keychain (`keyring`: Keychain / Credential Manager / Secret Service) | in `.footagedb`, in prefs JSON, in logs |
| access token | process memory | persisted anywhere |
| client secret | prefs (user's own) or env | committed, logged |

If no keychain backend exists (a bare Linux session), the app **refuses to
persist** rather than silently writing a token to disk. The session still works;
reconnect is needed next launch, and the UI says so. Every token value is
wrapped in a type whose `Debug` prints `Secret(***)`, so it cannot reach a log
by accident (§49).

### 6.4 Folder scanning

```
files.list
  q                       = "'{FOLDER_ID}' in parents and trashed = false"
  fields                  = "nextPageToken, files(id,name,mimeType,size,
                             parents,thumbnailLink,hasThumbnail,webViewLink,
                             createdTime,modifiedTime,shortcutDetails,
                             imageMediaMetadata(width,height),
                             videoMediaMetadata(width,height,durationMillis))"
  pageSize                = 1000        ← documented maximum
  supportsAllDrives       = true
  includeItemsFromAllDrives = true
```

Only requested fields are returned, so `fields` is always explicit — the default
response omits `thumbnailLink` and `videoMediaMetadata` entirely.

Media type is decided by **MIME type first** (§5), falling back to extension only
when MIME is absent or generic (`application/octet-stream`). Folders are
`application/vnd.google-apps.folder`; shortcuts are resolved through
`shortcutDetails.targetId`.

Recursive scan is an explicit **breadth-first queue with a depth cap**, not
recursion — a folder cycle via shortcuts would otherwise hang the app. Each
child's `container_path` is composed as it descends, preserving the original
hierarchy required by §6.

Pagination is mandatory, never assumed away: the scanner loops on
`nextPageToken` until absent, emitting progress after each page.

### 6.5 Errors, retries, rate limits

Drive allows on the order of 12,000 queries per minute per user, and answers
overage with `403 userRateLimitExceeded`; the documented remedy is exponential
backoff.

```rust
match status {
  200..=299                       => Ok,
  401                             => refresh once, then AuthenticationRequired,
  403 rateLimitExceeded
    | 403 userRateLimitExceeded
    | 429                         => retry w/ backoff,
  403 (other)                     => PermissionRequired,   // NOT "missing"
  404                             => SourceMissing,        // only when authed
  5xx | network                   => retry w/ backoff,
  _                               => Fatal,
}
```

Backoff is `min(2^n * 500ms, 32s) + jitter`, **capped at 5 attempts**. There is
no infinite retry (§45). Every job holds a cancellation token checked between
requests, so Cancel is immediate rather than "after the current 1,000 files".

### 6.6 Accessibility states (§23)

The critical rule: **an anonymous failure is not evidence a file is gone.**

| State | Meaning |
|---|---|
| `Available` | verified reachable |
| `PreviewAvailable` | thumbnail obtained, full access unverified |
| `AuthenticationRequired` | connected mode would resolve this |
| `PermissionRequired` | private file, no access with current credentials |
| `Offline` | no network — say nothing about the file |
| `SourceMissing` | **only** set by an authenticated 404 or `trashed = true` |
| `Unknown` | never checked |

A record is never auto-deleted (§32). `SourceMissing` shows a warning badge and
keeps every tag, note, rating, and usage record intact.

### 6.7 Upgrade and downgrade (§26, §27)

**Anonymous → connected.** Existing rows already carry
`(provider='google_drive', external_id=FILE_ID)`. Connecting runs a metadata
backfill keyed on `external_id`, so it **matches existing rows** and creates
zero duplicates. It fills `sources` only. If `display_name` was auto-derived
from the URL it is upgraded to the real filename; if the user typed a name it is
kept and the real filename is offered separately as
`Original filename: IMG_8821.MOV [Use this name]` (§24).

**Connected → anonymous.** Disconnect clears the keychain entry and recomputes
capabilities. Nothing is deleted: cached metadata, portable thumbnails, and every
piece of user metadata remain. The library degrades to link mode — exactly the
mode it was designed to run in.

### 6.8 Sync is metadata-only

Sync compares `external_id` against Drive and updates filename, parent folder,
MIME, size, resolution, duration, and thumbnail version. It **never transfers
file content** (§31, C4). A rename in Drive updates `original_filename` and
leaves `display_name` alone — renamed files are not new footage (§30).

---

## 7. Performance

| Concern | Approach |
|---|---|
| 10k records | SQL paging (`LIMIT/OFFSET` + `COUNT(*)`), never load all rows |
| Grid rendering | `@tanstack/react-virtual`; ~40 DOM nodes regardless of library size |
| Thumbnails | fetched per visible card, `IntersectionObserver`, TanStack Query cache |
| Search | 150 ms debounce, cancel-on-change, indexed SQL |
| Bulk import | one transaction for the whole batch; UI stays interactive |
| Blob avoidance | `thumbnails` is a separate table; list queries never read BLOBs |
| Counts | trigger-maintained `usage_count`, not a runtime aggregate |

Import runs on a Tokio task and reports through a `import:progress` event
(`{ jobId, phase, done, total, currentPath }`). The window is never blocked.

---

## 8. Security

- **Input validation at the IPC boundary.** Every command validates before
  touching state: paths are canonicalized and rejected if they escape their
  expected root; URLs must parse and match an allowlisted host before any fetch;
  ids are integers; strings are length-capped. A Tauri command is a trust
  boundary and is treated as one (§49).
- **No SQL string interpolation.** Every query is parameterized, including the
  dynamic filter builder, which composes fixed fragments and binds values.
- **Secrets never serialize.** Token types implement `Debug` as `Secret(***)`
  and are not `Serialize`. They cannot cross IPC to the WebView at all.
- **CSP.** Restrictive by default. `frame-src` allows only
  `https://drive.google.com` (for the embed fallback), `img-src` allows `self`,
  `data:`, and `stash:`. No inline script, no remote script.
- **Iframe sandboxing.** The Drive embed runs with an explicit `sandbox`
  attribute so a Google page cannot script the app.
- **Least privilege.** Tauri capabilities grant only the plugins actually used;
  the dialog plugin is scoped to file picking; there is no shell plugin.
- **Read-only Drive.** No write scope is ever requested, so a compromised token
  cannot alter the user's Drive.

## 9. Privacy

No telemetry. No analytics. No crash reporting. No update pings. The application
opens exactly two kinds of network connection: `accounts.google.com` /
`oauth2.googleapis.com` during an explicit connect, and `googleapis.com` /
`drive.google.com` when the user asks for thumbnails, a scan, or a sync. A
library that is never connected to Drive makes **zero** network requests. The
database is never uploaded anywhere (§50).

---

## 10. Directory structure

```
stash/
├── ARCHITECTURE.md
├── README.md
├── .env.example
├── package.json · vite.config.ts · tsconfig.json · index.html
│
├── src/                                  ── React / TypeScript
│   ├── main.tsx · App.tsx · index.css
│   ├── lib/
│   │   ├── ipc.ts                        typed invoke wrappers (one per command)
│   │   ├── types.ts                      mirrors Rust serde types
│   │   ├── drive-url.ts                  client-side paste preview parser
│   │   ├── format.ts                     duration / bytes / date formatting
│   │   └── utils.ts                      cn()
│   ├── hooks/
│   │   ├── use-library.ts · use-footage.ts · use-thumbnail.ts
│   │   ├── use-selection.ts              cmd/shift-click range logic
│   │   └── use-hotkeys.ts
│   ├── store/ui.ts                       Zustand: selection, panels, view mode
│   ├── components/
│   │   ├── ui/                           shadcn primitives (only what is used)
│   │   ├── welcome/                      WelcomeScreen, RecentLibraries
│   │   ├── library/                      Sidebar, Toolbar, FootageGrid,
│   │   │                                 FootageCard, FootageList, EmptyState,
│   │   │                                 FilterBar, StatsBar, ContextMenu
│   │   ├── inspector/                    Inspector, MetadataPanel, TagEditor,
│   │   │                                 UsageHistory, RatingStars
│   │   ├── preview/                      QuickLook, VideoPlayer, DriveEmbed
│   │   ├── import/                       AddFootageDialog, BulkLinkPaste,
│   │   │                                 DriveFolderBrowser, ImportProgress
│   │   └── settings/                     Settings, GoogleDriveIntegration
│   └── styles/
│
└── src-tauri/                            ── Rust
    ├── Cargo.toml · tauri.conf.json · build.rs
    ├── capabilities/default.json
    └── src/
        ├── main.rs · lib.rs
        ├── error.rs                      AppError → typed IPC error
        ├── state.rs                      AppState: library handle, providers
        ├── commands/                     library · footage · tags · collections
        │                                 projects · usage · import · preview
        │                                 gdrive · prefs
        ├── db/
        │   ├── mod.rs · connection.rs    pragmas, open/create/vacuum-into
        │   ├── migrations.rs             ordered, append-only
        │   ├── models.rs
        │   └── repo/                     footage · tag · collection · project
        │                                 usage · thumbnail · query_builder
        ├── source/
        │   ├── mod.rs                    SourceProvider trait, Capabilities
        │   ├── registry.rs
        │   ├── local.rs · url.rs
        │   └── gdrive.rs                 link mode + connected mode
        ├── preview/
        │   ├── mod.rs                    PreviewService (the chain)
        │   ├── encode.rs                 downscale + JPEG cap
        │   ├── cache.rs                  disk cache
        │   ├── scheme.rs                 stash:// ranged media handler
        │   └── providers/
        │       ├── local_file.rs
        │       ├── drive_api.rs
        │       ├── best_effort_drive.rs  ← quarantined undocumented endpoint
        │       └── http_image.rs
        ├── gdrive/
        │   ├── oauth.rs                  PKCE loopback
        │   ├── client.rs                 files.list / files.get / backoff
        │   ├── parse.rs                  URL → (fileId, resourceKey, kind)
        │   └── sync.rs
        ├── jobs/                         cancellation tokens, progress events
        └── prefs/                        prefs.json + keychain
```

---

## 11. Build order

| Phase | Deliverable | Gate |
|---|---|---|
| 1 | Tauri + React shell, theme, portable create/open/close | `cargo build` + `tsc` clean, window opens |
| 2 | Schema, migrations, repositories, CRUD, tests | `cargo test` green |
| 3 | Library UI: grid, list, inspector, search, filter, sort, multi-select, Quick Look | usable against seeded data |
| 4 | OAuth + Drive client | connect / disconnect / reconnect |
| 5 | Preview chain, thumbnail cache, `stash://` streaming | thumbnails in all modes |
| 6 | Import: links, bulk paste, folder browser, recursive, dedupe, progress | 1,000-file import without freeze |
| 7 | Sync, missing-source handling, thumbnail refresh | rename/move/delete handled |
| 8 | Shortcuts, virtualization, loading/error/empty states, a11y | §58 end-to-end walkthrough |

Every phase ends with a real build and a real run. Nothing is reported complete
on the strength of having been typed.
