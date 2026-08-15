# Features

What Stash does today. Statuses follow the legend in the
[main README](../README.md#feature-status).

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

---

## Universal search

**Status: Available.** One field reaches assets, brands, colors, typography,
and logos at once. Typing filters the grid as before; a panel underneath lists
what a grid query can never show, grouped by kind. Colors and font names carry
a copy button inline, and everything else jumps to the brand it belongs to.

Colors match on name, role, notes — and on hex, so pasting `#E92832` answers
"which brand owns this?" without opening anything.

```text
Search: red

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
