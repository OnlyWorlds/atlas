# Changelog

## Unreleased

- Sync now speaks the OnlyWorlds v2 API. Making a world online uploads everything in one atomic request: worlds whose elements reference each other in loops (any real world, in practice) now come through complete on the first try.
- Custom fields: fields named with an `atlas_`, `x_`, or `shadow_` prefix now sync, import, and export like any other data. Bring your own fields; atlas carries them.
- Custom fields have a home in the editor: a Custom fields section at the bottom of every element shows them with clean labels, and an add field row creates new ones. Names autocomplete from fields already used in the world, values keep their type, and shared pages show the clean label too.
- Zone colors, opacity, and shape now sync between devices instead of living on one machine.
- Pulling changes uses the server's change feed: faster, and deletions arrive as explicit events instead of being inferred, which removes a whole class of false "deleted on the server" prompts.
- Elements deleted and later restored on the server no longer risk a stale deletion prompt.
- Sync errors are more precise: a dangling reference names the missing element, an expired key reads differently from a wrong PIN, and rate limiting no longer pauses sync as if your credentials failed.
- Credential checks (linking, Test connection, make online) use the v2 world endpoint: one call validates the key and reads the world's identity.
- If the OnlyWorlds server is ever restored from a backup, atlas now detects it and rebuilds its sync position from scratch instead of trusting a position that points past the server's history.
- Charts open richer by default: every element type present keeps a seat, and worlds dominated by one type now fill the whole view instead of a handful of dots.
- Chart interactions: click previews an element, clicking it again focuses the chart on it, clicking empty space dismisses. Larger click targets and a clearer selection ring.
- Events no longer sit directly on top of narrative or era lines in charts.
- The home page chart now always previews the Charts room's default view, with saved charts as quick links below it, in a compact layout built for the smaller space.
- Switching worlds keeps you in the same room (charts to charts, writing to writing) instead of jumping to home.
- Removed the unfinished search and templates pages; their old links land on home.
- Search everywhere with Ctrl+K (or `/`): a command palette that finds elements by name, alias, type label, or description text, jumps to rooms by name, and can hand its query to the sidebar for the full list. The sidebar filter now searches those same fields, not just names.
- Fixed: creating a map from the sidebar left the element search stuck filtered.

## 1.0.0

- Folder-first world browser and editor: worlds live as local folders, with optional two-way sync to the OnlyWorlds API.
- Schema-driven element editing across all 22 OnlyWorlds element types.
- Maps, zones, and pins for spatial worldbuilding, alongside the graph-based context pane for browsing connections.
- Writing room for drafting narratives with element mentions, plus a knowledge room for tracking who knows what.
- Charts for visualizing world data (timelines, distributions, relationships).
- Sharing and publishing: build and publish read-only pages of world content.
- Import and export: bring in worlds from JSON, or take a world out to file or clipboard.
