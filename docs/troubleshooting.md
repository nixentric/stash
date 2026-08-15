# Troubleshooting

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
[step 4 of the OAuth setup](google-drive.md#4-set-publishing-status-to-in-production).

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
