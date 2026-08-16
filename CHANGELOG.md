# Changelog

Every released version, and what actually changed in it. The release notes on
GitHub are generated from this file.

## v0.5.8 — 2026-08-16

**Folder tags decide for themselves whether they reach the files**

- **New switch: "Folder tags cover the files inside".** Off by default. With it off, a tag on a source folder labels the folder and nothing else — the tag list counts it as one folder, and clicking it in the sidebar shows only files tagged directly. Turn it on and the same tag reaches every file in that folder, so a tag on five folders becomes the several hundred clips sitting in them. It lives in **Source Folder Settings**, next to the default brand, and is stored inside the `.footagedb` so each library keeps its own answer.
- **The count and the grid can no longer disagree.** The sidebar count and the grid filter read the same switch, so the number a tag advertises is always the number the grid can actually produce.
- **Manage Tags counts by files or by folders.** A new **Count by** toggle switches the tag list between file counts and folder counts, and hovering a count shows both. A tag that only labels folders is no longer reported as "unused" — and so is no longer offered up for deletion along with the real orphans.

**A welcome screen worth looking at**

- **New title treatment.** The welcome screen leads with STASH set in Special Gothic Expanded One, self-hosted so the app still makes no network request of its own, with the letters reacting as you move across them.
- **Falling background.** Physics-driven pieces drop and settle behind the screen, and you can grab them in the empty space around the buttons. Everything that is actually a control keeps its clicks.
- **Version button moved.** The update / version button now sits at the bottom right instead of the title bar, leaving the top edge clear for dragging the window.

**New loaders**

- **Dot-matrix loaders replace the Hex Orbit.** Update toasts get a circular dot loader, and thumbnails being generated get a square spiral one. The old Hex Orbit and its stand-in toast spinner are gone.

**macOS updates stop asking for your password**

- **The app now has a stable code identity.** Builds are signed with a consistent self-signed identity instead of an ad-hoc one that changed with every build. This is not Gatekeeper notarisation — first launch still warns — but it does mean the keychain keeps recognising Stash across updates, so "Always Allow" survives an update instead of prompting for your login password again.

## v0.5.7 — 2026-08-16

**A default brand for new folders**

- **Set the brand once, not folder by folder.** The gear button on Source Folders now opens **Source Folder Settings**, and the first thing in it is a default brand. Pick one, and every folder catalogued from then on arrives already assigned to it — a library that belongs to a single brand no longer needs the brand set by hand on every folder that shows up.
- **It never touches folders you have settled.** A folder that already carries a brand keeps it, and a folder you deliberately left blank stays blank, even when you import more files into it later. The default only claims folders that Stash has never seen before.
- **Stored inside the library file.** A brand id only means something in the library that defines it, so the default travels with the `.footagedb` rather than with the app. Open a different library and you get that library's default, not this one's.
- **Same picker as everywhere else.** The brand dropdown is the one the brand dialogs already use, so it renders in the app's own dark chrome instead of the grey system menu a native `<select>` produces on macOS.

**Fixed autocorrect in the folder table**

- **Tags and column values are no longer rewritten as you type.** The three inline editors in the Source Folders table — the tag field, the multi-tag column field, and the single-value column field — were plain inputs that never opted out of macOS autocorrect, so a tag could be silently changed into a different word on the way in. They now decline autocorrect, autocapitalisation and spellcheck, matching every other text field in Stash.

## v0.5.6 — 2026-08-16

**Newest Source Folders First**

- **Source Folders opens on the newest additions.** The Source Folders table used to open sorted alphabetically by folder path, which buried the folder you had just catalogued somewhere in the middle of the list. It now opens sorted by the Added column, newest first, so the folders you most recently brought into the library are the ones waiting at the top.
- **Nothing else changes about sorting.** Clicking any column header still works exactly as before — pick a different column, click again to flip the direction — and the date columns still start at newest first when you switch to them.

## v0.5.4 — 2026-08-16

**Fixed Invisible Selection Box**

- **Color format compatibility.** Resolved a rendering bug where the drag-to-select rectangle was completely invisible. Because Stash defines its primary colors in OKLCH format, passing it directly as `hsl(var(--primary))` caused browser engines to fail parsing the CSS color. Upgraded the styles to use `color-mix` for seamless background/border opacity blending in all color formats.
- **Improved Drag-Selection UX.** Prevented native browser text-selection highlights while drag-selecting is active, keeping focus cleanly on footage items.

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
