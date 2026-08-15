# Changelog

Every released version, and what actually changed in it. The release notes on
GitHub are generated from this file.

## v0.5.3 — 2026-08-16

**Hex Orbit Green Gradient Update Loader**

- **Hex Orbit loading animation.** Upgraded the update download status to use a beautiful custom Hex Orbit loader inside the toast notification. The animation simulates two perimeter dots chasing around a hexagonal field with a quietly lit center.
- **Green gradient theme.** Styled the hexagonal dots using a premium, vibrant green-to-emerald gradient to clearly indicate active progression.

## v0.5.2 — 2026-08-16

**Keyboard Select All and Drag-to-Select box**

- **Select all with Ctrl+A / Cmd+A.** Added a standard shortcut to select all footage in the library grid or list by pressing `Ctrl+A` (or `Cmd+A` on macOS) when the viewport is focused.
- **Drag-to-select box.** Dragging the cursor in empty space or across items now draws a visual selection box (using a themed boundary indicator). Any item touched by the box is added to the selection.
- **Interactive modifiers.** Selection box dragging seamlessly handles keyboard modifier keys: holding `Ctrl/Cmd` or `Shift` while dragging extends your current selection instead of replacing it.
- **Boundaries Auto-scrolling.** When dragging near the top or bottom of the window, the viewport automatically scrolls up or down, making it easy to select items across long lists.

## v0.5.1 — 2026-08-16

**Right-click context menus for Sidebar items**

- **Quick actions on Sidebar.** Right-clicking any item under **Brands**, **Collections**, or **Tags** in the left sidebar now opens a context menu with actions to edit or delete the item directly.
- **Rename and Edit.** Selecting **Edit Brand...** opens the brand designer, while selecting **Rename Collection...** or **Rename Tag...** opens an inline text prompt to quickly rename them without leaving your current view.
- **Instant Deletion.** Selecting the **Delete** action triggers a warning prompt to confirm deletion. Once confirmed, it deletes the item and updates the library state immediately.

## v0.5.0 — 2026-08-16

**Inline editing for Brands, Tags, and Custom Columns**

- **Set Brand and Custom Columns directly.** You no longer need to open the edit folder dialog to customize a folder. Click the **Plus (+)** button or edit icon on any cell to choose a brand or type a custom column value right in the table row.
- **Pencil and Plus icons.** Added visual hints: empty fields show a dashed **Plus (+)** button to add a new value, while populated fields show a **Pencil** icon on hover to edit the existing value.
- **Save checklist and keyboard friendly.** Added a green **Check** icon button next to inline inputs to save changes immediately. Pressing `Enter` or `Comma` also saves your input without triggering page navigations.
- **Single Value vs Multiple Tags columns.** Custom columns now support two distinct types. Choose **Single Value** for standard text inputs, or **Multiple Tags** to write comma-separated tags that render as individual chips (just like the main Tags column). Configure types in the Custom Columns settings.
- **Quick clear buttons.** Hovering over any brand, tag, or custom value reveals a small **X (clear)** button next to the edit icon. Click it to immediately clear the field value without opening the editor.

**Responsive table sizing and layout fixes**

- **Prevent column squeezing.** The table now dynamically scales its minimum width (`1000px + 160px` per custom column) and scrolls horizontally when window width is constrained. This prevents columns from squashing each other.
- **Fixed Preview column overlap.** Enforced a strict minimum width of `116px` on both headers and cells of the Preview column, giving thumbnails enough space so they never collide with the Folder name.
- **Edit dialog cleanup.** The old metadata edit modal and its Pencil row button have been removed completely, simplifying the workspace since all properties are now editable inline.

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
