//! An MCP server over the Source Folders table.
//!
//! Folder metadata — tags, the custom columns, the brand, the label — is the one
//! part of a library that is genuinely tedious by hand. A hundred-plus folders
//! each needing a `Client` filled in and an `archived` tag is an afternoon of
//! clicking, and it is exactly the shape of work an assistant is good at. So the
//! tools here are the Source Folders table's own gestures, taken in bulk: the
//! same `db::repo` calls the IPC commands make, over a list of paths instead of
//! one row.
//!
//! It is a subcommand of the app binary rather than a second executable because
//! the people who want it are not going to install a Rust toolchain. `stash mcp`
//! is already on their disk the moment they install the app.
//!
//! ## Who owns the file
//!
//! The server opens the `.footagedb` directly — it does not talk to a running
//! Stash. There is no second process to coordinate with because SQLite *is* the
//! coordination: rollback-journal mode is a multi-process format, and the
//! `busy_timeout` every library connection sets is what arbitrates two writers.
//! Adding an HTTP listener to the app to avoid that would be inventing a
//! protocol SQLite already ships.
//!
//! What SQLite cannot save us from is a *lost update* one layer up. The Source
//! Folders table writes a folder's whole tag set from the copy it last read, so
//! if this server adds a tag and the user then edits that folder's tags in an
//! app window that has not refetched, the app writes the old set back and the
//! new tag is gone. Hence the rule, stated again in `docs/mcp-server.md`: one
//! editor at a time. Bulk work belongs in a window the user is not also typing
//! into.
//!
//! The other thing a second process must not do is migrate, which is why this
//! opens through [`connection::open_without_migrating`].

use crate::db::models::FolderNode;
use crate::db::repo::{brand, footage, source_folder, taxonomy};
use crate::db::{connection, Library};
use crate::error::{AppError, Result};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// The spec revision we answer with when a client does not name its own. Clients
/// that do get their own string echoed back: this server is tools-only, which
/// every revision since 2024-11-05 spells the same way, so there is nothing to
/// negotiate.
const PROTOCOL_VERSION: &str = "2025-11-25";

/// What the assistant is told it is looking at, once, at connect time. Cheaper
/// than repeating it in nine tool descriptions.
const INSTRUCTIONS: &str = "\
Stash catalogs footage without moving it. A *source folder* is a folder files \
were imported from; it carries the metadata you are here to edit — tags, \
library-wide custom columns, a brand, and an optional display name. A folder is \
identified by its path, which is also what its files are keyed by, so paths are \
never invented: read them with list_folders first. Start with describe_library \
to learn which columns, tags and brands this library already has, and prefer an \
existing spelling over a new one.";

// ── entry point ─────────────────────────────────────────────────────────────

/// `stash mcp [--library <path>] [--http <addr>]`.
pub fn run(args: &[String]) -> std::process::ExitCode {
    match serve(args) {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            // stdout is the protocol channel; anything for a human goes to stderr.
            eprintln!("stash mcp: {e}");
            std::process::ExitCode::FAILURE
        }
    }
}

fn serve(args: &[String]) -> Result<()> {
    let path = library_path(args)?;
    let lib = connection::open_without_migrating(&path)?;
    eprintln!("stash mcp: {}", lib.path.display());

    match flag(args, "--http") {
        Some(addr) => serve_http(lib, &addr),
        None => serve_stdio(lib),
    }
}

fn flag(args: &[String], name: &str) -> Option<String> {
    let i = args.iter().position(|a| a == name)?;
    args.get(i + 1).filter(|v| !v.starts_with("--")).cloned()
}

/// Which library to open: what was asked for, or the one the app had open last.
///
/// Reading the app's `prefs.json` is the whole reason this needs `dirs`: the
/// path comes from Tauri's `app_config_dir` at runtime, which needs an app
/// handle this process does not have. The identifier below is the one in
/// `tauri.conf.json`, and the two have to stay in step.
fn library_path(args: &[String]) -> Result<PathBuf> {
    if let Some(p) = flag(args, "--library").or_else(|| std::env::var("STASH_LIBRARY").ok()) {
        return Ok(PathBuf::from(p));
    }
    let prefs = dirs::config_dir()
        .ok_or_else(|| AppError::Other("this system has no config directory".into()))?
        .join("app.stash.footage/prefs.json");
    let remembered = std::fs::read_to_string(&prefs)
        .ok()
        .and_then(|s| serde_json::from_str::<crate::prefs::Prefs>(&s).ok())
        .and_then(|p| p.last_library);
    remembered.map(PathBuf::from).ok_or_else(|| {
        AppError::NotFound(format!(
            "No library to open. Pass --library <path to .footagedb>, or set STASH_LIBRARY — \
             {} does not remember one.",
            prefs.display()
        ))
    })
}

// ── the tools ───────────────────────────────────────────────────────────────

fn paths_arg(description: &str) -> Value {
    json!({
        "type": "array",
        "items": { "type": "string" },
        "description": description,
    })
}

fn tools() -> Value {
    json!([
        {
            "name": "describe_library",
            "description": "The library's vocabulary: which custom columns, tags and brands exist, \
                            with how much carries each. Read this before writing anything, so an \
                            existing spelling gets reused instead of a near-duplicate created.",
            "annotations": { "readOnlyHint": true },
            "inputSchema": { "type": "object", "properties": {} },
        },
        {
            "name": "list_folders",
            "description": "Source folders with their current tags, column values and brand. The \
                            filters narrow the list; with none, every folder comes back.",
            "annotations": { "readOnlyHint": true },
            "inputSchema": { "type": "object", "properties": {
                "pathContains": { "type": "string", "description": "Case-insensitive substring of the folder path, e.g. \"/Footage/2026\"." },
                "hasTag": { "type": "string", "description": "Only folders carrying this tag." },
                "brand": { "type": "string", "description": "Only folders assigned to this brand." },
                "missingColumn": { "type": "string", "description": "Only folders with no value in this custom column — what to call before a fill-in-the-blanks pass." },
                "limit": { "type": "integer", "description": "Default 200." },
            }},
        },
        {
            "name": "set_folder_tags",
            "description": "Adds and/or removes tags across folders, or replaces their tag sets \
                            outright. Tags are lowercased and whitespace-collapsed on write.",
            "inputSchema": { "type": "object", "properties": {
                "paths": paths_arg("Source folder paths, exactly as list_folders reports them."),
                "add": { "type": "array", "items": { "type": "string" }, "description": "Tags to add, keeping what is already there." },
                "remove": { "type": "array", "items": { "type": "string" }, "description": "Tags to take off." },
                "replace": { "type": "array", "items": { "type": "string" }, "description": "The folders' whole new tag set. Cannot be combined with add or remove; an empty list clears every tag." },
            }, "required": ["paths"]},
        },
        {
            "name": "set_folder_column",
            "description": "Writes one custom column's value on each of these folders. An empty \
                            value clears the cell. The column must already exist — add_folder_column \
                            makes a new one.",
            "inputSchema": { "type": "object", "properties": {
                "paths": paths_arg("Source folder paths, exactly as list_folders reports them."),
                "column": { "type": "string", "description": "Column name, as describe_library lists it." },
                "value": { "type": "string" },
            }, "required": ["paths", "column", "value"]},
        },
        {
            "name": "set_folder_brand",
            "description": "Assigns these folders to a brand, or clears it. The brand must already \
                            exist in the library; brands are created in the app, not here.",
            "inputSchema": { "type": "object", "properties": {
                "paths": paths_arg("Source folder paths, exactly as list_folders reports them."),
                "brand": { "type": ["string", "null"], "description": "Brand name, or null to clear." },
            }, "required": ["paths"]},
        },
        {
            "name": "rename_folder",
            "description": "Sets a folder's display label. The path underneath is untouched — it is \
                            what every file, tag and column value is keyed by. An empty name drops \
                            back to showing the path.",
            "inputSchema": { "type": "object", "properties": {
                "path": { "type": "string" },
                "name": { "type": "string" },
            }, "required": ["path", "name"]},
        },
        {
            "name": "add_folder_column",
            "description": "Creates a custom column. Columns are library-wide: one new column \
                            appears on every folder, empty, waiting for set_folder_column.",
            "inputSchema": { "type": "object", "properties": {
                "name": { "type": "string" },
            }, "required": ["name"]},
        },
    ])
}

// ── dispatch ────────────────────────────────────────────────────────────────

/// Every folder in the library, keyed by path.
///
/// Folder metadata is keyed by path and nothing in the schema ties it to a
/// folder that exists — a mistyped path writes a row that is invisible forever
/// and silently does nothing. So every path a write tool is handed is checked
/// against this first. It also hands the tag-editing tools the current tag sets
/// they need to compute an add or a remove.
fn folders_by_path(conn: &Connection) -> Result<BTreeMap<String, FolderNode>> {
    Ok(footage::folders(conn)?
        .into_iter()
        .map(|f| (f.container_path.clone(), f))
        .collect())
}

fn str_list(args: &Value, key: &str) -> Option<Vec<String>> {
    let a = args.get(key)?.as_array()?;
    Some(a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
}

fn text(args: &Value, key: &str) -> Result<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| AppError::Invalid(format!("{key} is required and must be a string")))
}

fn targets(known: &BTreeMap<String, FolderNode>, args: &Value) -> Result<Vec<String>> {
    let paths = str_list(args, "paths")
        .ok_or_else(|| AppError::Invalid("paths must be a list of source folder paths".into()))?;
    if paths.is_empty() {
        return Err(AppError::Invalid("paths is empty — nothing to change".into()));
    }
    let unknown: Vec<&str> = paths
        .iter()
        .filter(|p| !known.contains_key(p.as_str()))
        .map(String::as_str)
        .collect();
    if !unknown.is_empty() {
        return Err(AppError::NotFound(format!(
            "This library has no source folder at {}. Paths must be copied from list_folders.",
            unknown.join(", ")
        )));
    }
    Ok(paths)
}

/// Looks a name up in a library-wide list, reporting what the real names are
/// when it misses. The miss is the common case — the assistant guessed `Clients`
/// for a column called `Client` — and an error that lists the options is one the
/// model can act on by itself.
fn by_name(options: &[(i64, String)], wanted: &str, what: &str) -> Result<i64> {
    options
        .iter()
        .find(|(_, name)| name.eq_ignore_ascii_case(wanted.trim()))
        .map(|(id, _)| *id)
        .ok_or_else(|| {
            let names: Vec<&str> = options.iter().map(|(_, n)| n.as_str()).collect();
            AppError::NotFound(if names.is_empty() {
                format!("This library has no {what} yet.")
            } else {
                format!("No {what} called \"{wanted}\". This library has: {}.", names.join(", "))
            })
        })
}

fn call_tool(lib: &mut Library, name: &str, args: &Value) -> Result<Value> {
    match name {
        "describe_library" => {
            let conn = &lib.conn;
            let folders = footage::folders(conn)?;
            Ok(json!({
                "library": lib.path.display().to_string(),
                "folderCount": folders.len(),
                "footageCount": folders.iter().map(|f| f.footage_count).sum::<i64>(),
                "columns": source_folder::fields(conn)?.iter().map(|f| &f.name).collect::<Vec<_>>(),
                "tags": taxonomy::all_tags(conn)?,
                "brands": brand::all(conn)?.iter().map(|b| &b.name).collect::<Vec<_>>(),
                "folderTagsCoverFiles": source_folder::folder_tags_cover_files(conn)?,
            }))
        }

        "list_folders" => {
            let want = |key: &str| args.get(key).and_then(Value::as_str).map(str::to_lowercase);
            let contains = want("pathContains");
            let has_tag = want("hasTag");
            let of_brand = want("brand");
            let missing = want("missingColumn");
            let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(200) as usize;

            // An absent filter passes everything, which is what `unwrap_or(true)`
            // is doing on each of these.
            let keeps = |want: &Option<String>, pass: &dyn Fn(&str) -> bool| {
                want.as_deref().map(pass).unwrap_or(true)
            };
            let matched: Vec<FolderNode> = footage::folders(&lib.conn)?
                .into_iter()
                .filter(|f| {
                    keeps(&contains, &|c| f.container_path.to_lowercase().contains(c))
                        && keeps(&has_tag, &|t| f.tags.iter().any(|x| x.to_lowercase() == t))
                        && keeps(&of_brand, &|b| {
                            f.brand_name.as_deref().map(str::to_lowercase).as_deref() == Some(b)
                        })
                        && keeps(&missing, &|m| {
                            !f.fields.iter().any(|v| v.name.to_lowercase() == m && !v.value.is_empty())
                        })
                })
                .collect();
            Ok(json!({
                "total": matched.len(),
                "folders": matched.iter().take(limit).collect::<Vec<_>>(),
            }))
        }

        "set_folder_tags" => {
            let known = folders_by_path(&lib.conn)?;
            let paths = targets(&known, args)?;
            let replace = str_list(args, "replace");
            let add = str_list(args, "add").unwrap_or_default();
            let remove = str_list(args, "remove").unwrap_or_default();
            if replace.is_some() && !(add.is_empty() && remove.is_empty()) {
                return Err(AppError::Invalid(
                    "replace sets the whole tag list, so it cannot be combined with add or remove".into(),
                ));
            }
            if replace.is_none() && add.is_empty() && remove.is_empty() {
                return Err(AppError::Invalid("nothing to do: pass add, remove or replace".into()));
            }

            let wanted = add
                .iter()
                .map(|t| {
                    taxonomy::normalize_tag(t).ok_or_else(|| {
                        AppError::Invalid(format!("\"{t}\" cannot be a tag: 1-64 characters"))
                    })
                })
                .collect::<Result<Vec<String>>>()?;
            let dropped: Vec<String> = remove.iter().filter_map(|t| taxonomy::normalize_tag(t)).collect();

            // One transaction for the whole batch: a bulk edit that half-applied
            // would leave the user guessing which folders it reached.
            let tx = lib.conn.transaction()?;
            let mut after = BTreeMap::new();
            for path in &paths {
                let next = match &replace {
                    Some(set) => set.clone(),
                    None => {
                        // Stored tags are already normalized, so normalizing both
                        // sides is what makes "Archived" and "archived" the same
                        // edit rather than two.
                        let mut tags = known[path].tags.clone();
                        tags.retain(|t| !dropped.contains(t));
                        for t in &wanted {
                            if !tags.contains(t) {
                                tags.push(t.clone());
                            }
                        }
                        tags
                    }
                };
                source_folder::set_tags(&tx, path, &next)?;
                after.insert(path.clone(), next);
            }
            tx.commit()?;
            Ok(json!({ "updated": paths.len(), "tags": after }))
        }

        "set_folder_column" => {
            let known = folders_by_path(&lib.conn)?;
            let paths = targets(&known, args)?;
            let wanted = text(args, "column")?;
            let value = text(args, "value")?;
            let columns: Vec<(i64, String)> = source_folder::fields(&lib.conn)?
                .into_iter()
                .map(|f| (f.id, f.name))
                .collect();
            let field_id = by_name(&columns, &wanted, "column")?;

            let tx = lib.conn.transaction()?;
            for path in &paths {
                source_folder::set_field_value(&tx, path, field_id, &value)?;
            }
            tx.commit()?;
            Ok(json!({ "updated": paths.len(), "column": wanted, "value": value }))
        }

        "set_folder_brand" => {
            let known = folders_by_path(&lib.conn)?;
            let paths = targets(&known, args)?;
            let wanted = args.get("brand").and_then(Value::as_str);
            let brand_id = match wanted {
                Some(n) if !n.trim().is_empty() => {
                    let brands: Vec<(i64, String)> =
                        brand::all(&lib.conn)?.into_iter().map(|b| (b.id, b.name)).collect();
                    Some(by_name(&brands, n, "brand")?)
                }
                _ => None,
            };

            let tx = lib.conn.transaction()?;
            for path in &paths {
                source_folder::set_brand(&tx, path, brand_id)?;
            }
            tx.commit()?;
            Ok(json!({ "updated": paths.len(), "brand": wanted }))
        }

        "rename_folder" => {
            let known = folders_by_path(&lib.conn)?;
            let path = text(args, "path")?;
            if !known.contains_key(&path) {
                return Err(AppError::NotFound(format!(
                    "This library has no source folder at {path}. Paths must be copied from list_folders."
                )));
            }
            let name = text(args, "name")?;
            source_folder::set_name(&lib.conn, &path, &name)?;
            Ok(json!({ "path": path, "name": name }))
        }

        "add_folder_column" => {
            let name = text(args, "name")?;
            let id = source_folder::create_field(&lib.conn, &name)?;
            Ok(json!({ "column": name.trim(), "id": id }))
        }

        _ => Err(AppError::NotFound(format!("No tool called \"{name}\""))),
    }
}

// ── JSON-RPC ────────────────────────────────────────────────────────────────

/// Fixed-length stand-in for a secret, so comparing two of them cannot leak how
/// far along they first differ.
fn digest(s: &str) -> [u8; 32] {
    use sha2::Digest;
    sha2::Sha256::digest(s.as_bytes()).into()
}

fn error(id: Value, code: i64, message: String) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Answers one request, or `None` for a notification — which by definition
/// carries no id and must not be replied to.
fn handle(lib: &Mutex<Library>, req: &Value) -> Option<Value> {
    let id = req.get("id").cloned();
    let method = req.get("method").and_then(Value::as_str).unwrap_or_default();
    let params = req.get("params").cloned().unwrap_or_else(|| json!({}));

    let result = match method {
        "initialize" => Ok(json!({
            // Echo the client's revision. Tools-only servers read identically in
            // every revision that has shipped, so disagreeing would be theatre.
            "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL_VERSION),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "stash", "version": env!("CARGO_PKG_VERSION") },
            "instructions": INSTRUCTIONS,
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            let mut lib = lib.lock().map_err(|_| ()).ok()?;
            Ok(match call_tool(&mut lib, &name, &args) {
                Ok(v) => json!({
                    "content": [{ "type": "text", "text": serde_json::to_string_pretty(&v).unwrap_or_default() }],
                }),
                // A bad path or an unknown column is something the model can fix
                // on its next turn, so it comes back as a readable tool result
                // rather than a transport error that just ends the exchange.
                Err(e) => json!({
                    "content": [{ "type": "text", "text": e.to_string() }],
                    "isError": true,
                }),
            })
        }
        _ => Err(()),
    };

    let id = id?;
    Some(match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(()) => error(id, -32601, format!("Method not found: {method}")),
    })
}

// ── transports ──────────────────────────────────────────────────────────────

/// Newline-delimited JSON-RPC on stdin/stdout — what Claude Desktop and Claude
/// Code spawn.
fn serve_stdio(lib: Library) -> Result<()> {
    let lib = Mutex::new(lib);
    let mut out = std::io::stdout();
    for line in std::io::stdin().lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(req) => handle(&lib, &req),
            Err(e) => Some(error(Value::Null, -32700, e.to_string())),
        };
        if let Some(response) = response {
            writeln!(out, "{response}")?;
            out.flush()?;
        }
    }
    Ok(())
}

/// Streamable HTTP — what a remote client like a ChatGPT connector needs.
///
/// Stateless, and deliberately so: there is no session to resume because there
/// is no state between calls, only the library on disk. A POST carries one
/// request and the answer comes straight back as JSON. The GET half of the
/// transport, the server-initiated event stream, is answered 405 because nothing
/// here ever speaks first.
///
/// `STASH_MCP_TOKEN`, when set, is required as `Authorization: Bearer …`. This
/// endpoint can rewrite the user's whole library, so anything that puts it on a
/// public tunnel needs it; see `docs/mcp-server.md`.
fn serve_http(lib: Library, addr: &str) -> Result<()> {
    use http_body_util::{BodyExt, Full};
    use hyper::body::Bytes;
    use hyper::service::service_fn;
    use hyper::{Method, Response, StatusCode};

    let lib = Arc::new(Mutex::new(lib));
    // Hashed so the comparison below is over fixed-length digests rather than
    // the secret itself, which is what keeps a tunnelled endpoint from leaking
    // its token one byte at a time to whoever is timing the replies.
    let token = std::env::var("STASH_MCP_TOKEN")
        .ok()
        .filter(|t| !t.is_empty())
        .map(|t| digest(&t));
    // Binding anything but loopback publishes a surface that can rewrite the
    // whole library. A tunnel in front of 127.0.0.1 is the supported way to
    // reach it from elsewhere, and a tunnel does not need this.
    let loopback = addr
        .rsplit_once(':')
        .map(|(host, _)| matches!(host.trim_matches(['[', ']']), "127.0.0.1" | "localhost" | "::1"))
        .unwrap_or(false);
    if token.is_none() {
        if !loopback {
            return Err(AppError::Invalid(format!(
                "{addr} is reachable from outside this machine and this endpoint can rewrite the \
                 library. Set STASH_MCP_TOKEN, or bind 127.0.0.1 and put a tunnel in front of it."
            )));
        }
        eprintln!("stash mcp: no STASH_MCP_TOKEN set — fine on loopback, but anything that tunnels this needs one");
    }

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;

    rt.block_on(async move {
        let listener = tokio::net::TcpListener::bind(addr).await?;
        eprintln!("stash mcp: listening on http://{addr}/mcp");
        loop {
            let (stream, _) = listener.accept().await?;
            let lib = lib.clone();
            tokio::spawn(async move {
                let service = service_fn(move |req: hyper::Request<hyper::body::Incoming>| {
                    let lib = lib.clone();
                    async move {
                        let reply = |status: StatusCode, body: String| {
                            Response::builder()
                                .status(status)
                                .header("content-type", "application/json")
                                .body(Full::new(Bytes::from(body)))
                        };
                        let presented = req
                            .headers()
                            .get("authorization")
                            .and_then(|h| h.to_str().ok())
                            .and_then(|h| h.strip_prefix("Bearer "));
                        if token.is_some() && presented.map(digest) != token {
                            return reply(StatusCode::UNAUTHORIZED, json!({"error":"bad or missing bearer token"}).to_string());
                        }
                        if req.method() != Method::POST {
                            return reply(StatusCode::METHOD_NOT_ALLOWED, json!({"error":"POST JSON-RPC to this endpoint"}).to_string());
                        }
                        let body = match req.into_body().collect().await {
                            Ok(b) => b.to_bytes(),
                            Err(e) => return reply(StatusCode::BAD_REQUEST, error(Value::Null, -32700, e.to_string()).to_string()),
                        };
                        match serde_json::from_slice::<Value>(&body) {
                            // A notification gets no body, which is what 202 means here.
                            Ok(request) => match handle(&lib, &request) {
                                Some(response) => reply(StatusCode::OK, response.to_string()),
                                None => reply(StatusCode::ACCEPTED, String::new()),
                            },
                            Err(e) => reply(StatusCode::BAD_REQUEST, error(Value::Null, -32700, e.to_string()).to_string()),
                        }
                    }
                });
                let io = hyper_util::rt::TokioIo::new(stream);
                if let Err(e) = hyper::server::conn::http1::Builder::new().serve_connection(io, service).await {
                    eprintln!("stash mcp: connection error: {e}");
                }
            });
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::migrate;

    /// Three folders of one brand's footage, one custom column, one tag.
    fn library() -> Library {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&mut conn, 0).unwrap();
        for (id, path) in [(1, "Footage/2026/Jan"), (2, "Footage/2026/Feb"), (3, "Footage/2025/Dec")] {
            conn.execute(
                "INSERT INTO footages (id, display_name, media_type, date_added, date_modified)
                 VALUES (?1, 'clip', 'video', '2026-01-05', '2026-02-10')",
                [id],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO sources (footage_id, provider, container_path) VALUES (?1, 'local', ?2)",
                rusqlite::params![id, path],
            )
            .unwrap();
        }
        source_folder::create_field(&conn, "Client").unwrap();
        brand::save(&conn, &crate::db::models::Brand { name: "Etive".into(), ..Default::default() }).unwrap();
        Library { conn, path: PathBuf::from("test.footagedb") }
    }

    fn call(lib: &Mutex<Library>, name: &str, args: Value) -> std::result::Result<Value, String> {
        let response = handle(
            lib,
            &json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
                     "params": { "name": name, "arguments": args } }),
        )
        .expect("a request with an id is always answered");
        let result = &response["result"];
        let text = result["content"][0]["text"].as_str().unwrap().to_string();
        if result["isError"] == json!(true) {
            Err(text)
        } else {
            Ok(serde_json::from_str(&text).unwrap())
        }
    }

    /// The job the server exists for: narrow a path, tag what matched, fill a
    /// column, set a brand — and leave everything outside the selection alone.
    #[test]
    fn bulk_edits_reach_exactly_the_folders_asked_for() {
        let lib = Mutex::new(library());

        let found = call(&lib, "list_folders", json!({ "pathContains": "2026" })).unwrap();
        assert_eq!(found["total"], 2, "the 2025 folder is not in the selection");
        let paths = found["folders"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["containerPath"].clone())
            .collect::<Vec<_>>();

        call(&lib, "set_folder_tags", json!({ "paths": paths, "add": ["Archived"] })).unwrap();
        call(&lib, "set_folder_column", json!({ "paths": paths, "column": "client", "value": "Etive" })).unwrap();
        call(&lib, "set_folder_brand", json!({ "paths": paths, "brand": "Etive" })).unwrap();

        let all = call(&lib, "list_folders", json!({})).unwrap();
        let rows = all["folders"].as_array().unwrap();
        let row = |path: &str| rows.iter().find(|f| f["containerPath"] == path).unwrap().clone();

        for path in ["Footage/2026/Jan", "Footage/2026/Feb"] {
            let f = row(path);
            assert_eq!(f["tags"], json!(["archived"]), "{path}: tag normalized and stored");
            assert_eq!(f["fields"][0]["value"], "Etive", "{path}: column filled");
            assert_eq!(f["brandName"], "Etive", "{path}: brand assigned");
        }
        let untouched = row("Footage/2025/Dec");
        assert_eq!(untouched["tags"], json!([]));
        assert!(untouched["brandName"].is_null());

        // Removing is the other half of a correction pass.
        call(&lib, "set_folder_tags", json!({ "paths": ["Footage/2026/Jan"], "remove": ["archived"], "add": ["raw"] })).unwrap();
        assert_eq!(row_after(&lib, "Footage/2026/Jan")["tags"], json!(["raw"]));
    }

    fn row_after(lib: &Mutex<Library>, path: &str) -> Value {
        call(lib, "list_folders", json!({}))
            .unwrap()["folders"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["containerPath"] == path)
            .unwrap()
            .clone()
    }

    /// The guards that keep a model's guess from writing somewhere invisible.
    #[test]
    fn a_wrong_name_is_refused_with_the_real_ones() {
        let lib = Mutex::new(library());

        let e = call(&lib, "set_folder_tags", json!({ "paths": ["Footage/2027/Mar"], "add": ["x"] })).unwrap_err();
        assert!(e.contains("no source folder at Footage/2027/Mar"), "{e}");

        let e = call(&lib, "set_folder_column", json!({ "paths": ["Footage/2026/Jan"], "column": "Clients", "value": "x" })).unwrap_err();
        assert!(e.contains("Client"), "names the column that does exist: {e}");

        let e = call(&lib, "set_folder_brand", json!({ "paths": ["Footage/2026/Jan"], "brand": "Nope" })).unwrap_err();
        assert!(e.contains("Etive"), "names the brand that does exist: {e}");

        let e = call(&lib, "set_folder_tags", json!({ "paths": ["Footage/2026/Jan"], "replace": [], "add": ["x"] })).unwrap_err();
        assert!(e.contains("cannot be combined"), "{e}");
    }

    /// A client has to be able to connect and read the menu without a library
    /// lookup ever happening, and a notification must draw no reply at all.
    #[test]
    fn handshake_answers_and_notifications_do_not() {
        let lib = Mutex::new(library());

        let init = handle(&lib, &json!({ "jsonrpc": "2.0", "id": 0, "method": "initialize",
                                         "params": { "protocolVersion": "2025-06-18" } }))
            .unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-06-18", "the client's revision is echoed");
        assert!(init["result"]["capabilities"]["tools"].is_object());

        let listed = handle(&lib, &json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" })).unwrap();
        let names: Vec<&str> = listed["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"set_folder_tags") && names.contains(&"describe_library"), "{names:?}");

        assert!(handle(&lib, &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).is_none());
        assert_eq!(
            handle(&lib, &json!({ "jsonrpc": "2.0", "id": 2, "method": "resources/list" })).unwrap()["error"]["code"],
            -32601,
            "a method we do not have is a protocol error, not a tool result"
        );
    }
}
