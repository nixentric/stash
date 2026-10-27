# The MCP server

Letting an assistant do the Source Folders table's filing for you.

## Why this exists

Everything else in Stash is fast because you do it once. Folder metadata is the
exception: tags, the custom columns, the brand, the label. Those are the same
decision repeated across every folder you have ever imported, and a library with
a hundred and twenty source folders is an afternoon of clicking to put a
`Client` in each one. Nothing about that work is hard — it is just long, and it
is the kind of long that gets abandoned halfway, which leaves a library where
half the folders are filed and half are not.

So Stash ships an [MCP](https://modelcontextprotocol.io) server over exactly
that table. You describe the filing in a sentence — *tag everything under
`/Footage/2026` as archived*, *put "Etive Bandung" in the Client column for the
Bandung folders* — and the assistant makes the same writes the table makes, in
bulk, in one transaction.

It is deliberately only that table. Per-file tags, collections, ratings, usage —
none of it is here. Those are decisions you make while looking at a clip, and
looking at clips is what the app is for.

## Install

There is nothing to install. The server is a subcommand of the app you already
have:

```bash
/Applications/Stash.app/Contents/MacOS/stash mcp
```

That is the whole binary — the same executable that opens the window, which
starts an MCP server instead when you pass `mcp` as its first argument. It is
built this way because asking a designer to install a Rust toolchain to tag
folders would defeat the point.

| Platform | Path to use in the config below |
|---|---|
| macOS | `/Applications/Stash.app/Contents/MacOS/stash` |
| Windows | `C:\Program Files\Stash\stash.exe` |
| Linux (deb) | `/usr/bin/stash` |
| Linux (AppImage) | the `.AppImage` file itself |
| From source | `src-tauri/target/release/stash` after `cargo build --release` |

The subcommand shipped in v0.5.51, so an older release has the app but not the
server. Run it in a terminal first: a working build prints which
library it opened and then waits. Anything else is an error message that says
what to fix.

## Which library it opens, and who owns the file

Left alone, the server opens **the library the app had open last** — it reads
that from the app's own preferences, so the usual case needs no configuration at
all. To point it somewhere else, pass `--library /path/to/Library.footagedb` or
set `STASH_LIBRARY`. That is worth doing the first time: practise on a copy.

The server opens the `.footagedb` file directly. It does not ask a running Stash
for permission, and it does not need to: a library is SQLite in rollback-journal
mode, which is a multi-process format, and the five-second busy timeout every
Stash connection sets is what arbitrates two writers. Two processes editing one
library is a situation SQLite was built for, and inventing a second protocol to
avoid it would be inventing something SQLite already ships.

What SQLite cannot protect you from is one layer up. **The rule is one editor at
a time.** The Source Folders table writes a folder's *whole* tag set from the
copy it last read, so this sequence loses work:

1. The assistant adds `archived` to a folder.
2. You add a tag to that same folder in a Stash window that has not refetched.
3. The window writes back the tag set it remembers — without `archived`.

Nothing is corrupted; a tag is simply gone. So do bulk work with the app closed,
or at least not in the folder you are also editing by hand, and switch away and
back in the app afterwards so the table reloads. The reverse direction is the
same story: the server reads the file fresh on every call, so it always sees your
manual edits, but a window open on stale rows does not see its.

One thing the server will never do is **migrate**. If the library was last
written by an older Stash, the server refuses to open it and tells you to open
it in the app once. Upgrading a schema under a running app that is still reading
the old shape is the one way a second process could genuinely destroy a library,
and the app's migration path — which takes a backup first — is where that
belongs.

## Claude

### Claude Desktop

Add the server to `claude_desktop_config.json` — **Settings → Developer → Edit
Config** opens it — and restart Claude:

```json
{
  "mcpServers": {
    "stash": {
      "command": "/Applications/Stash.app/Contents/MacOS/stash",
      "args": ["mcp"]
    }
  }
}
```

To pin it to one library rather than following the app, add the path:

```json
      "args": ["mcp", "--library", "/Users/you/Footage/Library.footagedb"]
```

### Claude Code

One command, and every session in that project gets it:

```bash
claude mcp add stash -- /Applications/Stash.app/Contents/MacOS/stash mcp
```

Either way, `describe_library` is the thing to ask for first — "what does my
Stash library have in it?" — because it tells you (and the assistant) the
columns, tags and brands that already exist.

## ChatGPT

**Read this before you plan around it: on a personal ChatGPT plan — Free, Go,
Plus or Pro — ChatGPT cannot do the bulk editing this server exists for.** Not
through a connector, and not through a custom GPT. The HTTP transport below is
real and works, but the gate is on OpenAI's side, not here.

Everything in this section was checked against OpenAI's own documentation on
**27 October 2026**, because third-party guides on this subject contradict each
other and most of them are describing the state of play a year ago. Two of the
pages below had been updated within hours of being read, so treat the dates as
load-bearing and re-check before relying on any of it.

### What each plan can actually do

From [Connecting custom MCP servers in
ChatGPT](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt):

| Plan | Custom MCP servers |
|---|---|
| Business, Enterprise, Edu | Full support, write actions included. Admins connect and publish; Enterprise/Edu can delegate with RBAC. |
| Pro | Connect with **read/fetch permissions** only. |
| Plus, Go, Free | Not named as able to connect a custom MCP server at all. |

In OpenAI's words: *"Custom MCP server connections and full MCP support are
available for ChatGPT Business and Enterprise/Edu customers on ChatGPT web"*,
and, from the same page's FAQ, *"Full MCP is only available to Business and
Enterprise/Edu users, currently. Pro users can connect custom MCP servers with
read/fetch permissions."*

Four of this server's seven tools write. On Pro they would be unusable; on Plus
there is no connector to put them behind. So if the machine you want to file
folders from is a ChatGPT machine on a personal plan, the honest answer is to
**run Claude on it instead** — the stdio setup above needs no tunnel, no public
endpoint and no plan, because the assistant launches the server itself. That is
not a workaround; it is the better arrangement, and it is where the heavy
editing should happen regardless.

### Custom GPTs are not the way around it

A custom GPT with an Action — an OpenAPI schema over an HTTPS endpoint — used to
be the way to get write access on a personal plan. It is closed. From [Creating
and editing GPTs](https://help.openai.com/en/articles/8554397-creating-and-editing-gpts):

- *"New GPT creation and publishing are not available on personal ChatGPT
  accounts, including Free, Go, Plus, and Pro."*
- *"We're planning to retire custom GPTs and help creators move their workflows
  to plugins."* Standard retirement is **11 December 2026**; new creation in
  affected Enterprise workspaces ended on 26 October 2026.

So Stash deliberately has **no REST/OpenAPI surface**. Building one would mean
shipping a second API, with its own auth and its own docs, for a ChatGPT feature
that a personal account can no longer create and that is weeks from being
switched off entirely. If OpenAI's replacement surface grows a write path on
personal plans, the tools here are already one `call_tool` dispatch behind a
transport — adding one is a day's work, and doing it before there is something
to connect it to is a day spent on nothing.

### Connecting it on Business, Enterprise or Edu

This is the configuration that works, and the one the HTTP transport is for:

```bash
STASH_MCP_TOKEN=pick-something-long \
  /Applications/Stash.app/Contents/MacOS/stash mcp --http 127.0.0.1:8899
```

That speaks Streamable HTTP at `http://127.0.0.1:8899/mcp`. ChatGPT accepts
[SSE and streaming
HTTP](https://developers.openai.com/api/docs/guides/custom-mcp-server);
Streamable HTTP is the current one and the only one implemented here.

ChatGPT cannot reach that address on its own — *"ChatGPT connects to remote MCP
servers. If your MCP server runs on a private network, on-premises, or on a
developer machine, use Secure MCP Tunnel"* — so it needs one of:

- **[OpenAI's Secure MCP
  Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)** —
  the supported route. Run their tunnel client, then pick **Tunnel** instead of
  a Server URL when you add the server. Nothing of yours is published to the
  internet.
- **A general-purpose tunnel** — `cloudflared tunnel --url http://127.0.0.1:8899`
  or `ngrok http 8899` — and paste the public `https://…/mcp` URL in as the
  Server URL.

Then: **Plugins → + → Add custom MCP server**, name it, give it the URL or the
tunnel, set authentication, acknowledge the risk warning, and **Create as a
plugin**. Developer Mode is no longer a prerequisite. Afterwards, `@`-mention
the plugin in a conversation to use it.

Two things worth knowing before you test:

- **Authentication can be none.** The connector offers OAuth, no
  authentication, or either; where OAuth is configured, static credentials are
  accepted, so `STASH_MCP_TOKEN` as a bearer token is enough and you do not need
  to stand up an authorization server. If you do use real OAuth, your provider
  must issue refresh tokens — OpenAI's page is explicit that without
  `offline_access` advertised in its discovery metadata, *"ChatGPT may lose
  access after the original authorization expires"*.
- **The tool list is frozen at approval.** Once an admin approves the
  connection, ChatGPT uses a snapshot of the tools. Updating Stash does not
  update the connector; an admin has to refresh it. New actions arrive disabled.

Write actions are confirmed per call, which is correct, and is why the two
reading tools here are annotated `readOnlyHint` and the four writing ones are
not. It is also why every write tool takes a *list* of folder paths: one call
that tags two hundred folders is one confirmation, where a per-folder tool would
be two hundred.

### What a tunnel actually means for your library

While the tunnel is up, a `.footagedb` on your own disk is reachable from the
internet by anything that can resolve the URL, and four of the seven tools
rewrite it. There is no read-only mode and no per-folder permission; a caller
who gets through can retag or re-brand the whole catalogue. Nothing can delete
footage from your disk — Stash has no delete path to any source — but a library
whose filing has been scrambled is still a day of your work gone.

So the defaults lean the safe way, and one of them will stop you:

- `--http` **refuses to bind anything but loopback unless `STASH_MCP_TOKEN` is
  set.** A tunnel in front of `127.0.0.1` does not need a wide bind, and the
  common mistake — `--http 0.0.0.0:8899` with no token on a café network — is
  the one worth making impossible rather than merely discouraged.
- The token is compared as a hash, so a wrong guess tells an attacker nothing
  about how close it was.
- Prefer the Secure MCP Tunnel over ngrok or cloudflared where you can have it:
  it reaches OpenAI without putting a public URL on the internet for anyone else
  to find.

Take the tunnel down when you are done. The server is a command you ran, not a
service — closing the terminal is the off switch.

## The tools

Seven, which is the whole Source Folders table and nothing else. Three read,
four write.

| Tool | What it does |
|---|---|
| `describe_library` | The library's vocabulary: which custom columns, tags and brands exist, and how much carries each. |
| `list_folders` | Source folders with their tags, column values, brand and file counts. Filters by path substring, tag, brand, or *missing* a column's value. |
| `set_folder_tags` | Adds and/or removes tags across many folders, or replaces their tag sets outright. |
| `set_folder_column` | Writes one custom column's value across many folders. An empty value clears the cell. |
| `set_folder_brand` | Assigns many folders to a brand, or clears it. |
| `rename_folder` | Sets a folder's display label. The path underneath never moves. |
| `add_folder_column` | Creates a custom column. Columns are library-wide. |

Two things are refused rather than guessed, because both would otherwise fail
silently:

- **A path that is not a source folder.** Folder metadata is keyed by path, and
  the schema is happy to store a row for a path no file sits in — where it would
  be invisible forever. So every path has to be one `list_folders` reported.
- **A column or brand that does not exist.** The error names the ones that do,
  which is usually all the assistant needs to correct itself: ask for `Clients`
  and it is told the column is called `Client`.

Brands themselves are not created here. A brand carries colors, typefaces, logos
and rules; it is a thing you build in the app, not a label an assistant should
invent on your behalf.

## Worked examples

**Tag a year's worth of folders as archived.**

> Tag every folder under /Footage/2026 as archived.

The assistant calls `list_folders` with `pathContains: "/Footage/2026"`, reads
back the paths that matched, and passes exactly those to `set_folder_tags` with
`add: ["archived"]`. Two calls, one transaction, and the folders outside that
path are untouched. Tags are lowercased and whitespace-collapsed on write, so
`Archived`, `archived` and `ARCHIVED` all land as one tag rather than three
chips that mean the same thing.

**Fill a column across a set of folders.**

> Fill the Client column with "Etive Bandung" for the folders whose Branch is
> Bandung.

`list_folders` with no filter, read which folders have `Bandung` in their
`Branch` column, then one `set_folder_column` over that list. If the `Client`
column does not exist yet, the first attempt is refused with the names of the
columns that do, and the fix is one `add_folder_column` call.

**Find what is not filed yet.**

> Which folders still have no Client?

`list_folders` with `missingColumn: "Client"` — the filter exists for exactly
this, because the useful question before a filing pass is always *what is
missing*, and answering it by listing everything and reading 124 rows wastes the
assistant's attention on folders that are already done.

**Clear a mistake.**

> Actually those should be "kol" not "archived".

`set_folder_tags` takes `add` and `remove` in the same call, so the correction is
one write per folder rather than a delete pass and an add pass.

## When it goes wrong

**"No library to open."** The app has never opened a library on this machine, or
the preferences file is somewhere the server cannot read. Pass `--library`.

**"… uses library format v*n* and this build reads v*m*."** The app and the
server are different versions. Open the library in Stash once, or update the
app — they are the same binary, so they cannot disagree unless one of them is
an old copy.

**"… is not allowed to read it" on macOS.** Same unsigned-app permission wall as
the app itself: System Settings → Privacy & Security → Files and Folders, and
give Stash access to the folder the library lives in. Running the server from a
different launcher does not get a different answer — it is the same executable,
and macOS is asking about the app, not the invocation.

**The assistant insists a folder does not exist.** Paths are what the *library*
recorded at import, not what the folder is called on disk now. `list_folders`
with no filter is the ground truth.

**Changes do not show up in the app.** The table is holding rows it read before
the edit. Switch to another view and back.
