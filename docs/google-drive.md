# Google Drive

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

### 4. Set publishing status to "In production"

> ⚠️ **This step is not optional, and skipping it is the most common problem.**

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
