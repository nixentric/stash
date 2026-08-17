# Changelog

Every released version, and what actually changed in it. The release notes on
GitHub are generated from this file.

## v0.5.28 — 2026-08-17

**Opening a library, properly this time**

- **The Welcome screen leaves before the app arrives.** Its physics animation freezes where it stands, the screen fades, and only then does the library load — previously a running engine and a fully drawn screen were competing with the app mounting itself, which is what the jolt was.
- **The pile stays put while it fades**, rather than vanishing a frame early.
- **A quiet indicator holds the gap** while the catalog is read, instead of an empty window.

## v0.5.27 — 2026-08-17

**"There is an update, but not for your Mac yet"**

- **Checking for updates while a release is still uploading used to show the updater's own words**: *None of the fallback platforms `["darwin-aarch64-app", "darwin-aarch64"]` were found in the response `platforms` object*. It now says what that means — a newer version is out, the package for your machine has not finished uploading, try again in a few minutes — and names the package it is waiting for.
- **Every other update failure is still reported as one.** "Wait a moment" and "the update server is unreachable" are different answers.

**Opening a library is no longer a jolt**

- **The Welcome screen no longer flashes on the way in.** Starting with a library to reopen used to draw the whole Welcome screen for a moment and then tear it down — the app now waits for the answer before choosing a screen, and shows that it is working.
- **The library fades in** rather than appearing mid-render.

## v0.5.26 — 2026-08-17

**Add Footage is ready for the paste**

- **The Drive Folder tab puts the cursor in its link box**, so ⌘V works the moment the window opens. The Links tab has always done this; the tab most people pin was the one that did not.

## v0.5.25 — 2026-08-17

**No more question marks where a picture should be**

- **A cover still being fetched shows the waiting animation, not a broken-image mark.** Since previews started coming straight from the library file, a card whose picture was not there yet drew the webview's own "?" — and behind a queue of a few hundred, it drew it for a long time.

**The folder table remembers how it is sorted**

- **The column and direction you chose survive leaving the page**, like the filters do. Ordering by a column you later delete falls back to newest first, rather than sorting every row as blank.

## v0.5.24 — 2026-08-17

**Folder filters stay where you left them**

- **Opening a folder and coming back keeps the filter on.** The filter you set to find that folder used to be gone by the time you returned to it, which made it useless for working through a list.
- **Clearing them is still something you do on purpose** — the Clear button beside Filters, or Reset filters inside the menu.
- **A filter for a tag that has since been deleted lets itself go**, rather than quietly hiding every folder.

**The Inspector shows the bigger picture**

- **The preview panel was asking for the card-sized thumbnail** and drawing it across a panel several times that wide. It now asks for the same large preview Quick Look uses, and falls back to the small one when there is nothing cached.

## v0.5.23 — 2026-08-17

**Thumbnails that are not blurry**

- **Google Drive is asked for a 960 px preview**, not the 220 px one its link points at by default. That 220 px picture was being stretched across a card several times its size, which is exactly as soft as it sounds.
- **Everything stored before this stays soft until it is re-fetched.** Settings → Preview → **Rebuild all** goes and gets them again.

**The hover preview can be turned off**

- **Source Folders → the gear → Preview on hover.** A picture that appears under the cursor is welcome right up until it is in your way, so it is a switch, and it stays where you left it.

**The pictures stop going through JavaScript**

- **Thumbnails are served straight to the webview** over `stash://thumb/{id}`, instead of being handed to the interface as base64 text through the app's own message channel.
- **That is where the memory was going.** A library of four thousand covers had four thousand copies in the interface's memory on top of the pictures themselves, and nothing could let go of them while a list was open. Now the webview owns them and drops each one when it scrolls out of sight.
- **A cover still missing is fetched once, on the spot**, exactly as before — and a file that genuinely has no preview says so instead of retrying forever.

## v0.5.22 — 2026-08-17

**Pick folders by dragging over them**

- **Drag a box across the table** and every folder it touches is picked, the same gesture the library grid already had. Hold ⌘ or shift while you start to add to what is already picked.
- **The tick column only appears when you want it.** A drag turns it on by itself, and the Select button in the toolbar turns it off again — a column of empty boxes on every row is noise on the days you are only reading the table.
- **The bulk bar floats at the bottom of the window**, so ticking a folder far down the table no longer means scrolling back to the top to act on it.

**The bulk bar finishes what you type**

- **Tags and column values you already use are offered as you type**, one word at a time between the commas. Picking one is ↑↓ and Enter, and Enter again applies — so a typo is never written to every picked folder by one keystroke too many.
- **The same list the Filters menu offers**, so a bulk edit cannot invent a near-miss of a value that already exists.

**A cover, where your cursor is**

- **Rest on a row and its first cover floats up beside the pointer**, following it, and opening above or below depending on where there is room. It never covers the row you are pointing at and never eats the click.

**It stops hoarding memory**

- **Thumbnails are let go once nothing is showing them.** A list you had scrolled once kept every image it had ever displayed — the queries behind them never switched off, so nothing was ever collected and memory only went up.
- **Adding one tag no longer refetches a preview strip per folder on screen.** Folder edits now refresh the folders, not the whole library.
- **Dragging a selection is quiet now.** The band moves without re-rendering the table, and the selection is only rewritten when it actually changes.

## v0.5.21 — 2026-08-17

**Undo, and it means it**

- **Every edit offers a way back**, in the confirmation that appears when you make it — tags, brands, custom columns, collections. **⌘Z does the same thing** without aiming at a button that is about to disappear, and it works over the preview too, which is where ⌫ removes footage.
- **Removing from the library can be undone.** Stash photographs the record before it deletes it — the file's details, its thumbnail, its tags, its usage history, the collections it was in — and puts all of it back under the same id. Nothing is orphaned and nothing is duplicated if you undo twice.
- **It only holds the last removal**, in memory, and forgets it when you switch libraries. Undo here means "take that back", not a history you can walk.
- **Mark as Unused still has no undo, and does not pretend to.** The usage records it deletes are gone, and a button that promised otherwise would be a lie.

**Tag, brand and fill columns for many folders at once**

- **Tick the folders you want in Source Folders** — shift-click takes a whole run of them — and one bar above the table sets the brand, adds tags, or writes any custom column for all of them.
- **Adding never wipes what is there.** Tags and multi-value columns gain what you type; single-value columns are replaced, exactly as they behave when you edit one cell.
- **It writes only to the folders on screen.** A folder hidden by a filter is never touched by a selection you made before the filter went on.

**Right-click inside the preview**

- **The library's own menu, over the file you are looking at**: Mark as Used, Favorite, Add Tag, Add to Collection, Copy Link, Set Thumbnail, Remove. No more closing the preview to reach the thing you just decided.
- **The preview lets go of the keyboard while the menu is open**, so the arrows walk the menu and Esc closes the menu — not the preview.

## v0.5.20 — 2026-08-16

**You can see what you have already downloaded**

- **A badge on every card whose original is on this computer**, and an icon on the row in list view. No more opening a file to find out whether you already have it.
- **It costs one look at the folder, not one per file.** Finding a download means scanning the downloads folder, so asking that per card would be a filesystem scan per card on a library of thousands. Stash reads the folder once and answers the whole grid from it, then re-reads only when a download finishes. A download still in progress does not count as one you have.

**Smaller things**

- **Settings → Updates says which version you are running**, before it tells you whether there is a newer one. It comes from the app itself, so it is the real version, not a number someone remembered to update.
- **The Source Folders filter bar sits where the library's does.** It was inside the page, indented and a line lower than the eye expects; now it is the same toolbar row, and it stays put while the table scrolls.

## v0.5.19 — 2026-08-16

**Clear out what will never have a preview**

- **Every row in "Still without a preview" has a Remove button**, and the footer removes everything listed at once. A file that is gone from its source is never going to get a preview, and that list is where you find out — so it is where the record can be dropped, without hunting for it in the grid afterwards.
- **Removing all of them asks first.** It is the only action in that dialog that refreshing again cannot undo. The originals on Drive or on disk are not touched either way, and the list shrinks as you go.

## v0.5.18 — 2026-08-16

**Source folders get a filter bar**

- **The same bar the library has, above the folder table** — how many folders you are looking at, Filters, the sort, and the settings button, all in one row. The page title and its paragraph are gone: the bar already says what they said.
- **The Filters menu builds itself from your folders.** Brand, tags, and one group for every custom column you have made. A column appears there the moment one folder carries a value for it, and drops out with the last one — nothing to configure, nothing to keep in sync. Multi-value columns are split on commas exactly the way the filter matches them, so the menu can never offer a value that matches nothing.
- **Sorting from the bar is the same toggle as the column headers**, including picking the same option again to flip the direction. Custom columns are in the list too.
- **Clicking a chip in a row still filters.** That is unchanged; the bar is a second way in, for when the value you want is not on screen.

**Removing and downloading, where you already are**

- **Delete or Backspace removes what is open in the preview**, and there is a Remove button next to Download. The preview moves to the next file instead of leaving you on an empty screen. As everywhere else in Stash, this removes the record — the file on Drive or on disk is not touched.
- **Right-click offers Download Original when there is something to download.** It stays hidden for local files and for anything already downloaded, because the backend already knows the difference.
- **Mark as Used and Mark as Unused are one entry now.** It flips the way Favorite always has: anything still unused offers Used, a selection that is entirely used offers the way back. The `U` shortcut is on it.

**Projects can be renamed and deleted**

- **Right-click a project in the sidebar**, the same as collections, tags and brands. Deleting says what it costs first: the files stay marked as used, they just stop saying which project used them. Renaming updates the view you are in, and deleting the project you are viewing puts you back in the library.

## v0.5.17 — 2026-08-16

**The files that still have no preview, named**

- **"Refreshed 8 of 20" now tells you about the other twelve.** A dialog lists them by name, grouped by the reason the preview could not be fetched: gone from the source, no access with the connected account, needs a connected account at all, could not be reached, or no preview exists to be made. Each group says what to do about it — nothing is removed from your library either way.
- **The exact reason is one click away, per file.** Expanding a row asks the backend why that one failed, and only then, so a list of a hundred is not a hundred round trips nobody reads.
- **"Try again" is in the dialog**, so a network blip does not mean hunting for the button again.

**A missing count you can act on**

- **Syncing a folder that reports missing files now offers "Show them".** It jumps straight to the missing view instead of leaving you with a number.

## v0.5.16 — 2026-08-16

**Drop files straight onto the window**

- **Drag media in from Finder or Explorer and let go anywhere.** No dialog, no file picker. The files stay exactly where they are — Stash records where to find them, it never copies or moves anything. Whatever is not a supported media file is skipped and counted, and duplicates are recognised the way they always were, so the toast tells you what actually landed. Dropping into a collection adds to that collection.
- **A single image dropped onto a card still sets that card's thumbnail.** That has not changed; it just no longer needs the card to be the only thing that accepts a drop.
- **Folders are not scanned yet.** Drop the files themselves — the message says so rather than failing silently.

**⌘↵ imports**

- **⌘/Ctrl + Enter runs the import from any tab of Add Footage** — links, local files, or Drive — including while the cursor is still in the paste box. The shortcut is on the button, so it is not something you have to know.

## v0.5.15 — 2026-08-16

**Source folders you can name, and a way back to Drive**

- **Give a folder your own name.** Right-click any row in Source Folders → Rename Folder, and the table shows your name with the original folder path underneath it — never instead of it. A label that hides where the files actually came from is worse than no label, and the path is still what every footage record, tag and column value is keyed by, so renaming moves nothing and breaks nothing. "Use Original Name" puts it back.
- **A Drive folder links back to the original.** Folders imported from Google Drive now carry a button to open the real folder in Drive, in the row and in the right-click menu. No connection or API call is needed for it: the files recorded which folder they came from when they were imported.
- **Right-click a source folder.** The same menu the sidebar has always had — rename, use the original name, open in Drive, delete — instead of hunting for the one button at the end of a wide row. The delete confirmation now names the folder the way you named it.
- **Sorting by Folder follows the name you see.** A renamed folder sorts where you would look for it, not where its path happens to fall.

**A link you already imported says so**

- **Pasting a Drive link that is already in your library tells you before you import.** Both shapes are recognised: a file link is matched against what was imported, a folder link against the folder its files came from — all of it answered from your own library, with no request to Google. It says what it found, and how many files came from that folder.
- **And it takes you there.** "Go to item" opens the file itself, in the folder it lives in. "Open folder" jumps to that source folder. Importing again was always harmless — footage is identified by its Drive id, so nothing duplicates — but it happened silently, and "Added 0" reads like a failure rather than an answer.

**Getting around**

- **Back and Forward.** Clicking a tag, then a folder, then a brand left no way back to where you started. The view now keeps a browser-style history: buttons in the toolbar, ⌘/Ctrl + `[` and `]`, or Alt + ←/→. Re-clicking the entry you are already on does not stack up a step that goes nowhere.
- **A tag badge shows both of its numbers.** Folders carrying the tag and files reached by it, each with its own icon, instead of one count that quietly changed meaning depending on whether "folder tags cover the files inside" was on.

## v0.5.14 — 2026-08-16

**macOS asks for permission instead of quietly refusing**

- **The folder permission dialog finally appears.** The app bundle was missing the keys macOS requires before it will even ask about your Documents, Desktop or Downloads folder — and without them macOS does not ask, it refuses. That is the whole story behind a library that "could not be opened" while being in perfect health, and behind a download that failed with `Operation not permitted`. Stash now declares what it needs the access for, so macOS puts the question to you.
- **A blocked folder says what to do about it.** `Operation not permitted (os error 1)` is not a sentence anyone can act on. It now names the folder and offers the two ways out — pick a downloads folder in Settings → Library, which grants access as a side effect of choosing it, or allow Stash under System Settings → Privacy & Security → Files and Folders.

If you updated from an earlier version and macOS still will not ask, it is remembering its old answer. `tccutil reset SystemPolicyDocumentsFolder app.stash.footage` in Terminal clears it.

## v0.5.13 — 2026-08-16

**A library that will not open says why**

- **"Database error: unable to open database file" is gone.** SQLite says that same sentence whether a file is missing, its folder is unwritable, or macOS is simply blocking the app from reaching it — and the last one is routine here, because Stash builds are unsigned and macOS treats every update as a new app whose folder permissions have to be granted again. Stash now says the file is there and undamaged, that this is a permission problem, and where to grant it: System Settings → Privacy & Security → Files and Folders.
- **An incompatible library names the version you need.** It now reads "not compatible with Stash 0.5.13" in those words, with the format numbers as supporting detail, and points at both ways out: update to the latest release, or open it with the build that last saved it.
- **A library open in another program is told apart** from both of the above, instead of arriving as the same generic database error.

## v0.5.12 — 2026-08-16

**Drive photos open immediately, or you keep the file**

- **A Drive photo shows up straight away.** A still cannot be drawn a piece at a time — the whole file has to arrive before the first pixel of it exists — so every Drive photo meant staring at a loader for as long as the download took, and at nothing at all when it failed. Photos now open through Google's own viewer, which paints as fast as Google can serve it. Video is unchanged: it streams, because a player genuinely can use the first few seconds before the rest arrives.
- **Download keeps the original.** One button puts the real file in a `Downloaded` folder next to your library, and the preview switches to that copy — full quality, opens instantly the second time, and still works with the Google account disconnected. Progress is the real byte count, not a guess.
- **Open Local shows you where it went.** Reveals the file in Finder, for a downloaded copy or for footage that was on this computer all along, with the full path on hover.
- **A failed preview says why.** Instead of "Preview unavailable", it now names the cause: the account has no access, the file is in the trash, the sign-in expired, Google is rate-limiting, or the file is a RAW that no preview can decode — which no amount of retrying was ever going to fix.
- **Where downloads go is yours to choose.** Settings → Library points them anywhere you like and takes the existing files along. There is a switch there to download automatically whenever you open a footage, off by default.

**Settings tells you what it knows**

- **The OAuth client says whether it is actually set.** Saved, secret missing, or not set at all — "an id with no secret" was the state that failed at connect time with nothing on screen to explain it.
- **Development builds admit their limits.** They keep credentials in a temporary file the system can clear at any time, and cannot see what the released app saved. That is now written down where you would look for it, instead of appearing as a connection that mysteriously forgot itself.
- **More room between settings.** The panes were tight enough that a label read as if it belonged to the control above it.

**Also**

- **Add Footage remembers which tab it opens on.** Pin it from the dialog or pick it in Settings → Library.

## v0.5.11 — 2026-08-16

**Quick Look stops going blank**

- **A photo loading from Google Drive says so.** A still has to arrive whole before the webview can decode a single pixel of it, so a 5 MB photo meant an empty screen for as long as the download took — with nothing on it to say whether anything was happening. There is now a loader, a progress bar, and a running count of how long you have been waiting, and the photo replaces them the moment it is ready.
- **A preview that fails admits it.** When the image cannot be fetched and there is no thumbnail left to fall back on, Quick Look says "Preview unavailable" instead of leaving behind exactly the same empty screen as a slow load.

## v0.5.10 — 2026-08-16

**Search finds the rest of the library**

- **Source folders are searchable.** Typing part of a folder's path finds the folder itself, and folder tags match too — so a tag on a folder at least reaches the folder even with "Folder tags cover the files inside" switched off. Folders are the first group in the panel: a folder is the coarsest thing a query can mean, and opening one is usually faster than scrolling the assets under it.
- **Additional Info is searchable.** Matched on the title *and* on the body, so a link entry is findable by its URL — and clicking one opens the link straight away instead of dropping you on the brand page to hunt for the card.
- **Elements and logo rules show up at all.** Both were already being found; the panel was quietly throwing the results away.

**The search panel is worth clicking**

- **Assets moved to the bottom.** They are the bulk of any library and the grid behind the panel is already full of them. Looking for a colour no longer means scrolling past five clips first.
- **Every hit does something.** An asset opens Quick Look with the file left selected in the grid — it used to be a dead row that ignored clicks. A folder opens the folder, a link opens the link, everything else jumps to its brand.
- **Thumbnails on asset results.** The fastest way to know it is the file you meant.
- **Search one kind at a time.** The magnifier at the left of the search field is now a picker: choose Source Folders, Colors, Typography — any single kind — and both the results and the placeholder narrow to it.

**Folder-only tags stop looking broken**

- **The sidebar says what the tag actually holds.** A tag carried only by folders showed a bare `0` next to it and an empty grid when clicked. It now reads `5 folders`, and opening it lists those folders above the grid — click one to open it. What the tag does to the files inside is still the "Folder tags cover the files inside" switch, unchanged.

## v0.5.9 — 2026-08-16

**Support Stash**

- **A Support pane in Settings.** Stash is built by one person, in the open, for free, and now says so. **Settings → Support** explains why macOS warns on first launch and asks for your login password again after every update — the builds are unsigned, so every build has a different code identity and the keychain stops recognising the app — and that an Apple Developer membership at $99/year is what makes both stop. There is a Ko-fi button under it.
- **Nothing is gated behind it.** No paid tier, no accounts, no telemetry, and no plan to add any. The pane is an explanation and a link, and that is all it is.
- **Same ask on the repo.** The README leads with it, and the GitHub page carries a Sponsor button.

## v0.5.8 — 2026-08-16

**Folder tags decide for themselves whether they reach the files**

- **New switch: "Folder tags cover the files inside".** Off by default. With it off, a tag on a source folder labels the folder and nothing else — the tag list counts it as one folder, and clicking it in the sidebar shows only files tagged directly. Turn it on and the same tag reaches every file in that folder, so a tag on five folders becomes the several hundred clips sitting in them. It lives in **Source Folder Settings**, next to the default brand, and is stored inside the `.footagedb` so each library keeps its own answer.
- **The count and the grid can no longer disagree.** The sidebar count and the grid filter read the same switch, so the number a tag advertises is always the number the grid can actually produce.
- **Manage Tags counts by files or by folders.** A new **Count by** toggle switches the tag list between file counts and folder counts, and hovering a count shows both. A tag that only labels folders is no longer reported as "unused" — and so is no longer offered up for deletion along with the real orphans.

**Additional Info reorders by dragging**

- **Drag the cards into the order you want.** Additional Info entries on a brand page now carry the same grip handle the logo cards do, and dragging one moves it in the list. The order is saved to the library, so it survives reopening — Additional Info used to be stuck in the order the entries happened to be created.

**A welcome screen worth looking at**

- **New title treatment.** The welcome screen leads with STASH set in Special Gothic Expanded One, self-hosted so the app still makes no network request of its own, with the letters reacting as you move across them.
- **Falling background.** Physics-driven pieces drop and settle behind the screen, and you can grab them in the empty space around the buttons. Everything that is actually a control keeps its clicks.
- **Version button moved.** The update / version button now sits at the bottom right instead of the title bar, leaving the top edge clear for dragging the window.

**New loaders**

- **Dot-matrix loaders replace the Hex Orbit.** Update toasts get a circular dot loader, and thumbnails being generated get a square spiral one. The old Hex Orbit and its stand-in toast spinner are gone.

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
