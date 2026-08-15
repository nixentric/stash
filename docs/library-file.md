# The library file

How Stash stores your work, and why it stays yours.

## Offline-first architecture

**Status: Available.**

Everything that matters works with the network unplugged: the database, asset
metadata, tags, search, filters, usage tracking, collections, projects, and
embedded thumbnails. The same will hold for brand guidelines, color, and
typography when they land — they are local data, not a hosted service.

With Drive disconnected and the update check switched off in **Settings →
General**, Stash makes **zero network requests**. No telemetry, no analytics, no
crash reporting.

The update check is the only request Stash makes on its own behalf: it asks the
GitHub releases API whether a newer version exists, sends no identifier, and
downloads nothing — a newer release opens in your browser.

Cloud is never a requirement. It is one optional source among several.

---

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
