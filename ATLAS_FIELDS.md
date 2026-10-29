# Atlas-Specific Fields

**Updated**: 2026-09-29 (rebuilt from `src/core/constants.ts`; the old table in DESIGN.md had the zone visuals in the wrong bucket).
**Job**: the register of what atlas adds to OnlyWorlds that the schema does not (yet) hold, and where each thing lives. The code is the truth: `ATLAS_WIRE_EXTENSION_FIELDS` and `ATLAS_LOCAL_ONLY_FIELDS` in `src/core/constants.ts`. If this file and the constants disagree, fix this file.

---

## Two buckets, opposite rules

| | `ATLAS_WIRE_EXTENSION_FIELDS` | `ATLAS_LOCAL_ONLY_FIELDS` |
|---|---|---|
| On push | **sent**: keel stores extension fields verbatim (`atlas_*`, `x_*`, `shadow_*`), nested objects included | **stripped** by the adapter (`STRIP_FIELDS` in `src/sync/ow-v2-client-adapter.ts`, with the sync stamps and the server-managed fields) |
| On pull (`applyServerRecord`) | the **server value wins** when the record carries the field; the local value is kept only when the server record lacks it (written by a non-atlas or v1-era client) | **kept from the local file**: a pull never erases them |
| In a JSON export | carried | stripped (`src/import/export-world.ts`) |
| In the custom-fields editor | hidden (edited only by their own UI) | hidden |
| Test fakes | accepted like any field | rejected: `FakeOwApiClient` and the v2 MSW handlers answer 4xx if one reaches a write body (conv. 20) |

`ATLAS_LOCAL_EXTENSION_FIELDS` is the two lists combined. It survives for import/export compatibility checks, `isCustomEditableField`, and the legacy v1 MSW handler in `tests/msw-handlers.ts`; new code picks one of the two buckets. A new atlas field goes in exactly one: LOCAL_ONLY if another device has no use for it, WIRE if it must travel.

## Synced extensions (`ATLAS_WIRE_EXTENSION_FIELDS`)

| Field | On | Holds | Schema-motion candidate? |
|---|---|---|---|
| `atlas_color` | Zone | fill colour (hex) | no, visual preference |
| `atlas_opacity` | Zone | fill opacity, 0..1 | no, visual preference |
| `atlas_label_visible` | Zone | whether the zone label renders | no, visual preference |
| `atlas_shape` | Zone | `'polygon' \| 'line'` | **taken**: the standard's Zone `shape` (schema 00.33.00) is read before it since 1.75 and written beside it on every drawn zone since 1.77 (DESIGN_ZONES "1.75, the standard's shape") |
| `atlas_map_style` | Map | the map's style (`'ink'`, ink on parchment): its zones draw from their kinds, read from the subtype (`src/core/map-ink.ts`); absent means plain | no, presentation |
| `atlas_calendar` | Construct (supertype `calendar` by convention) | the calendar's machine config, a nested object; DETECTION keys on this field's presence, never the supertype | maybe, once calendars prove out across tools |

Before the v2 port (2026-07-12) the zone visuals were local-only because the old server refused unknown fields; under keel they sync, so two devices converge on zone styling. DESIGN_ZONES §5 and DESIGN_CHARTS "Calendars" hold their design.

## Local-only fields (`ATLAS_LOCAL_ONLY_FIELDS`)

| Field | On | Holds | Schema-motion candidate? |
|---|---|---|---|
| `image_media_id` | Map (the only user today) | binding to a local media file used when there is no `image_url` | maybe, if the schema ever holds local media |
| `atlas_richtext_json` | Narrative | the TipTap document behind `story`; every atlas write keeps `story === serialize(sidecar)` (conv. 116) | maybe, if the schema grows rich text |
| `atlas_aliases` | any element | `string[]` of alternate names for linking, the picker and search | **yes**: writers, pickers and search all want it |
| `atlas_dismissed_suggestions` | Narrative | element ids dismissed from the context pane's Potentials | no, UI state |
| `atlas_page_blocks` | Narrative, subtype `page` | the page's block stack, the source of truth (heading, prose, element card, circle, collection, map, chart; `src/core/sharing.ts`) | no, composition is presentation |
| `atlas_page_refs` | page | the flat element-id mirror of the blocks' bindings, so a re-key (the Settings re-key or Route 2, both on the kernel) can follow them (`blocksOf()` heals nested ids) | no, mechanics |
| `atlas_page_intent` | page | show / reference / publish (kept in the model, hidden in the UI) | probably not |
| `atlas_page_theme` | page | the page's theme tokens (`parsePageTheme`, carried into the publish payload) | no, visual preference |
| `atlas_hidden_shown_online` | any linked element | `true` when keel's last answer to a write showed an element whose file holds the hidden mark (keel takes the mark in a write on a create only, conv. 170; the owner's and a co-builder's key send keel's hide for it since 1.88.0, conv. 173, so the word stays for any other key); written and removed with the push stamp (`stampedBody`), dropped by every pull and on import; the page then says "Hidden here only" | no, keel's word about one world |
| `atlas_page_pub` | page | the published-state mirror `{id, slug, published_at, updated_at, revoked, content_sig}` from the sharing backend; a display cache (the API rows are the truth), per folder | no, sharing metadata |

A page's canonical `story` carries a derived plain-markdown compilation of its blocks (synced, readable by other tools, regenerated on every blocks save, never hand-edited). The published artifact is a frozen snapshot on the sharing backend: `SHARING_CONTRACT.md`.

## Server-authored, kept as received (`SERVER_AUTHOR_FIELDS`)

Not atlas's fields and not the schema's: who wrote the element, as keel records it. `created_by` (the membership that made it), `changed_by` and `changed_via` (the membership and the door of the last write), and `changed_client` (the software that made the last write, as it named itself; Atlas 1.72.1 kept it ahead of keel serving it, and since 1.77 every Atlas write names itself with `X-OW-Client: atlas`, writes only: the sync adapter sends it (`ATLAS_CLIENT_NAME` in `src/sync/ow-v2-client-adapter.ts`) and every SDK client Atlas builds passes it as `client` (SDK 4.56.0, a census in `tests/unit/client-name-header.test.ts`)), and since 1.106.1 `doors` (each tool that wrote the element, with the time of its last write there, or null; served to a world's members since 2026-10-29, SDK 4.106). A pull keeps them on disk; atlas never sends them, never counts them as a change, drops them on import from another world, and drops `changed_by`, `changed_via` and `changed_client` on every local edit (conv. 144); `doors` stays through an edit, since each tool's line is still true until the next pull, and a write's answer brings the write's own (1.107.0: the stamp keeps the answer's `doors`, `stampWordOf` in `src/core/door-trail.ts`, `tests/integration/sync-engine.door-trail.test.ts`). A first stamp is a new row on keel (a create, a re-keyed id, a create after a cleared baseline), so it keeps only the answer's `doors` and drops any left from the element's older life; a `/bulk` echo brings none, so the trail waits for the next pull (`stampedBody`, `tests/integration/sync-engine.door-trail-first-stamp.test.ts`). The element page's footer reads it as the trail (1.107.0, #760): in a synced world, for an element with a baseline, "On OnlyWorlds: last shaped in Lantern" and the tools before it, newest first. The quiet agent mark reads `changed_via`. A linked world's roster, which names an agent seat, is held in memory for the session only (`src/sync/world-roster.ts`). Beside them, `SERVER_MARK_FIELDS`: keel's `hidden: true`, on a body served to whoever sees a hidden element (the owner, a co-builder, its maker), absent otherwise; kept as received, never a change, gone with the pull after an unhide (1.70.1, `tests/integration/hidden-mark.test.ts`). Its second member since 1.97.1 is `x_served_trimmed` (folder spec §4.4 rule 6): the fields of a message keel served with ids this seat may not see left out, kept in the file as served through any local edit, never sent on a create or an update (keel refuses it with a 422), never a difference, gone when a whole body arrives (`tests/integration/served-trimmed-mark.test.ts`). Since 1.73 it is said: a quiet glyph beside the agent mark in the element page, Knowledge's entry and a page's header (`src/core/hidden-mark.ts`, `tests/unit/hidden-mark.test.ts`). Since 1.86 it is also a folder key (folder spec §4.8, conv. 170): kept on import, shown in every world with the word Hidden in the list and Recent rows, left out of a published page, sent on a create only, and held here for a key that cannot hide.

## Semantic reinterpretations (candidates for first-class schema)

Atlas also reads canon fields in ways other tools cannot see:

| Reinterpretation | Where | Motion shape | Status |
|---|---|---|---|
| Narrative `narrator` + `collectives` read as **knowledge holders** when `subtype: "knowledge"` | DESIGN_KNOWLEDGE (conv. 67-72, "De-hiding path") | first-class `held_by_characters` / `held_by_collectives` on Narrative, then migrate off the reinterpretation | logged 2026-06-07; draft the motion once Knowledge proves out in real use |
| A Narrative's `supertype` equal to a writing label (Book, Chapter, Scene, Draft by default) puts it in the writing tree | DESIGN_WRITING (conv. 33, 38) | none planned: the label is the stored value, other tools see a plain supertype | settled |

## World-level state atlas keeps outside the element files

**Per world, on the registry entry** (`WorldRegistryEntry` in `src/core/types.ts`, in localStorage, never synced): `writing_labels`, `writing_initialized`, `writing_tree_collapsed`, `last_writing_narrative_id`, `notes`, `favorites` (protagonist and home), `active_calendar_id`, `tour_dismissed`, `right_tabs`, `sync_paused`, `context_filters_off`, `context_hop_depth`, `context_lock_layout`, `context_edge_color`, `former_api_world_id`, `review_first_sync`, `shared_with_others` and `shared_keep_policy` (what keel's roster last said about others writing here, and the person's per-world switch for the shared rule, conv. 150), and `api.member_role` (the key's role as last told to the person, from keel's `GET /me`, conv. 151). Five of these (`WORLD_PREF_KEYS`: notes, favorites, active calendar, writing labels, writing initialized) are also written to `.atlas/world-prefs.json`, so a copied folder carries them (conv. 112). `showcases` is a dead field from the retired publishing model: declared, never read or written.

**The link, on the registry entry's `api` block** (conv. 132): `world_id`, `api_key`, `world_name`, `read_only`, `seat` (`{ role? }`, an agent seat) and `seat_secret` (that seat's `ow_s_` secret, this world's PIN). All but `seat_secret` are mirrored in `world.json`'s `api` (`diskApiBlock`); `seat_secret` never reaches the folder (`withoutSeatSecret` at both stores' `writeWorldMeta`).

**Atlas-wide, on the registry**: `pin` (the account PIN, never sent for a seat world), `email`, `account_token`, `account_username`, `atlas_root`, `sync_pull_on_activate`, `sync_cadence_ms`, `sync_default_policy`, `sync_confirm_server_deletes`, `sync_pause_all`, `sync_debounce_ms`, `worlds_add_icons`, `maps_settings`, `editor_settings`.

**In the folder, not the registry**: sync bookkeeping (`last_pull_at`, `last_push_at`, the `/changes` cursor, conflicts and the rest) lives in `.atlas/sync-state.json` (DESIGN_FOLDER).

**Per browser, other localStorage keys**: `atlas_ui_prefs` (sidebar mode, default create type, where the last new world went, the name the last invite link was signed with), `atlas_shell_ratios_v2`, `atlas_right_tabs`, `atlas_map_view_defaults`, `atlas_map_view_prefs`, `atlas_map_camera_state`, `atlas_world_prefs_synced` (the world-prefs three-way base), `atlas_disk_held` (a standing big-batch question), `atlas-held-seat:<server world id>` (a join link's seat kept until its world lands, with an agent seat's secret, conv. 178; never synced, never on disk), plus small UI memories (`atlas_nav_labels`, the tour flags, drafts). Storage keys are constants in `src/core/constants.ts` or at the top of their owning module.

**Per tab, sessionStorage**: `atlas-signin-resume` (Sign in with OnlyWorlds' round trip, conv. 171: the route, the open door, a held Open id or invitation code; written at the press, read once and removed on `/signin/callback`, and removed on any other boot), beside the SDK's own pending record (state and PKCE verifier) under its own key.

## Why keep this register

Atlas is a primary OnlyWorlds tool, and the line between "atlas innovates" and "OnlyWorlds standardizes" should be a conscious decision. Periodically:

1. Read both buckets and ask which fields would help other tools if the schema held them.
2. Draft council motions for the strong candidates (today `atlas_shape` and `atlas_aliases`).
3. After a motion and amendment: a LOCAL_ONLY candidate first moves to WIRE (so it travels), then existing data migrates to the canonical field name, and atlas reads both names until the old one is gone.

Atlas innovating is healthy; feeding what it learns back to OnlyWorlds is the design intent.
