// Keeps the console window from appearing on Windows release builds. The MCP
// subcommand below is unaffected: a GUI-subsystem process still inherits the
// stdin/stdout pipes whoever spawned it handed over, which is all MCP needs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() -> std::process::ExitCode {
    // `stash mcp` is the MCP server over this library's Source Folders — a
    // subcommand rather than a second executable so that installing the app is
    // the only install step. See src/mcp.rs.
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("mcp") {
        return stash_lib::mcp::run(&args[2..]);
    }
    stash_lib::run();
    std::process::ExitCode::SUCCESS
}
