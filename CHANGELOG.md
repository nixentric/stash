# Changelog

Every released version, and what actually changed in it. The release notes on
GitHub are generated from this file.

## v0.3.1 — 2026-08-15

**Update notifications, and a switch to turn them off**

- **Check for updates.** Settings → General has a **Check now** button, and Stash
  shows a notice at launch when a newer release exists.
- It **downloads and installs nothing** — a newer release opens in your browser,
  so you decide what runs on your machine.
- **No identifier is sent.** Not even the installed version: Stash asks GitHub
  for the latest tag and compares it locally after the answer arrives.
- **Switch it off** in Settings → General and Stash never contacts the update
  server at all. With Drive disconnected too, it makes zero network requests.
- Fixed: a fresh install would have started with the setting off while the
  saved-preferences path defaulted it on — the two disagreed, and now they don't.
- The privacy notes in the README, the library-file doc and the Settings pane
  each claimed network access happened only for Drive and previews. All three
  now name the update check and where to turn it off.

**Licence**

- Stash is now **MIT licensed** ([LICENSE](LICENSE)).

## v0.3.0 — 2026-08-15

**Logo usage rules**

- Clear space, minimum size and background usage, edited in place under the logo
  list. Stored once per brand rather than per variant, so two variants cannot
  drift into disagreeing.
- **Correct / Don't examples** side by side, each linking an asset with a
  caption and a thumbnail.

**Graphic elements**

- Shapes, patterns, gradients, textures, decorative elements, frames and
  backgrounds, shown as a thumbnail grid.
- Like logos, they **reference the asset library** instead of duplicating files,
  so Reveal in Finder works from either screen.

**Documentation**

- The README had grown to 800 lines and buried installation behind product
  prose. It is now a 121-line entry point over [docs/](docs/), split by what a
  reader came for. Nothing was dropped in the move.

## v0.2.0 — 2026-08-15

**Universal search**

- One search field now reaches **assets, brands, colors, typography and logos**
  at once, grouped by kind.
- Colors match on **hex** as well as name, so pasting `#E92832` answers which
  brand owns it.
- Colors and font names carry an inline **copy** button; everything else jumps
  to the brand it belongs to.

**Brand guidelines**

- **Multiple brands** per library, each with description, tagline and website.
- **Color library** grouped by role, with copy actions for HEX, RGB and CMYK.
  Clicking a swatch copies its hex.
- **Typography library** with live preview — type your own text and see it set
  in the brand's face — plus Copy font name.
- **Logo library** by variant, linking assets with Reveal in Finder and Open
  source.
- **Quick Brand Kit** at the top of every brand page: the colors, fonts and
  logos you reach for mid-edit, one click from copy or open.

## v0.1.4 — 2026-08-15

- Fixed: macOS asked for the login keychain password repeatedly. A status query
  read the keychain on every call; secrets are now read once per launch.

## v0.1.3 — 2026-08-15

- Fixed: macOS reported the app as **damaged**. The bundle carried only the
  linker's automatic signature, with no sealed resources — it is now ad-hoc
  signed, so the first launch is an ordinary unidentified-developer prompt.

## v0.1.2 — 2026-08-15

- First working release for **macOS (Apple Silicon and Intel), Windows and
  Linux**.
- Fixed: the Windows bundle failed to build because the bundler was pointed only
  at the PNG icon and needs an `.ico` named outright.

## v0.1.0 — 2026-08-15

Initial release: local-first catalog for footage from disk, Google Drive links
and URLs, with tags, collections, projects, usage tracking, search and filters,
source folders with custom columns, and a portable single-file library.
