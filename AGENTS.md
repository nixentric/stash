## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Releases and Changelog Management

When preparing a release:
- Bump the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
- Document all changes in `CHANGELOG.md` under the new version header. Do NOT use dry, technical lists like [ADDED], [UPDATED], [FIXED], or [DELETED]. Instead, group changes under bold headers describing the feature group, and write descriptive, user-focused bullet points explaining what changed, how it works, and why (matching the conversational and explanatory style of v0.3.1).
- Make the descriptions detailed and user-focused, so users downloading the release know exactly what changed.
- Create a git tag corresponding to the new version (e.g., `git tag v0.5.0`) and push it to origin (e.g., `git push origin v0.5.0`) to trigger the GitHub Release Action workflow.

