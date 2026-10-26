# Atlas: The Folder

**Updated**: 2026-09-29 (split from DESIGN.md).
**Job**: what atlas writes to disk and how it reads a folder back. This file holds the File naming table, which is the Folder Format spec's source; other bays cite it, so change it deliberately and say so. The index is `DESIGN.md`; the numbered rules are `DESIGN_LAWS.md`.

---

## On-disk layout

A world is a folder. Atlas keeps new world folders inside one user-chosen home folder (the atlas root, below), but a world folder anywhere on disk opens in place.

```
<user-picked-parent>/
  onlyworlds-atlas/                     the wrapper (legacy name: atlas-worlds/)
    .atlas-root                         marker: {version, created_at}
    <world-slug>-<id8>/                 one world
      world.json                        metadata + api block when linked; format_version and `producer` stamped at birth (spec §4.2); a linked world's world file adds `source` and `exported_as` (below);
                                        a LINKED folder's id IS the server world id (spec §4.1, 2026-09-04; older links keep their minted id)
      .atlas/                           atlas internal state
        lock                            {tab_id, started_at, last_heartbeat}: one writer at a time (conv. 13)
        sync-state.json                 /changes cursor, conflicts, server-delete review list, world-meta baseline, foreign ids, finished re-key map
        tombstones.json                 deletion log (id, type, deleted_at)
        charts.json                     saved chart configs (DESIGN_CHARTS)
        styles.json                     world styles: how the world draws its kinds (DESIGN_ZONES §5b)
        world-prefs.json                notes, cast, calendar lens, writing labels (conv. 112)
        rekey-journal.json              present only while a re-key is unfinished (conv. 105)
        quarantine/<type>/              same-id twins whose content differs from the survivor (conv. 94)
      elements/<type>/                  ALL 22 element types, one subfolder each
        <name-slug>--<id-tail8>.json    e.g. aragorn--0d2a8c2b.json (unnamed: <full-id>.json)
      spatial/{map,pin,zone,marker}/    LEGACY ONLY (atlas up to v1.0). Read, never created.
      media/<element-id>/<folder>/
        <original-filename>.<ext>       the file (a name collision gets -<id8> added)
        <media-id>.meta.json            one sidecar per item (MediaItem: id, element_id, folder, filename, mime, size_bytes, added_at)
```

The file names under `.atlas/` are constants in `src/core/constants.ts` (`SYNC_STATE_FILE`, `TOMBSTONES_FILE`, `CHARTS_FILE`, `STYLES_FILE`, `WORLD_PREFS_FILE`, `REKEY_JOURNAL_FILE`, `LOCK_FILE`); the quarantine directory is made by `quarantineFile` in `src/store/folder-store-fs.ts`.

**Element file format**:

```json
{
  "id": "<uuid>",
  "type": "character",
  "name": "Alice",
  "description": "...",
  "species": ["..."],
  "local_updated_at": "2026-05-12T10:30:45.123Z",
  "server_updated_at": "2026-05-12T10:25:00.000Z"
}
```

- `local_updated_at` is the truth for "this changed locally at time T". The FolderStore stamps it on every save (conv. 11).
- `server_updated_at` is the last value the server confirmed. Only sync code stamps it (the engine, the initial download, Make Online), never a user write. It is absent in a local-only world and on a never-synced element.
- Local ids are v4 today (`crypto.randomUUID()`); keel accepts any RFC-4122 uuid and keeps the client's id (DESIGN_SYNC "Ids").
- Pin and marker link fields keep each FILE's spelling (`map` or `map_id`), and a new file is born bare (conv. 8).

## The union read (settled 2026-07-28, spec v0.3)

**`elements/<type>/` is the format for all 22 types.** `spatial/{map,pin,zone,marker}/` is a **named, dated legacy path**: atlas through v1.0 wrote the four spatial types there and no other implementation ever did. The split carried no semantics: it was the Leaflet subsystem's convenience leaking into the serialization.

| Behaviour | Rule |
|---|---|
| read | **BOTH layouts, unioned** (`buildIndexFor` scans `elements/<type>/` then `spatial/<type>/` for spatial types). A world written either way opens whole |
| write, new element | `elements/` for all 22, in every folder, one with legacy `spatial/` files included (spec v0.3.8 §4, "One id, one file"; Skeld 2026-10-17). `spatial/` is never created. Until Atlas 1.51.2 a folder already holding spatial files kept receiving new ones there (`detectSpatialLayout`, removed) |
| existing element | rewritten **where it was found** (`fileIndex` records each element's `layout`). An edit never migrates a file between layouts; a re-key writes its new file in the old one's layout |
| same id in BOTH layouts | the `elements/` copy is served, whatever either file's `local_updated_at` says (a conforming writer stamps nothing, so a stamp rule hands the id to any old stamped copy), a warning names both paths, and **neither file is touched**. Same-directory twins are a rename crash and get deduped; cross-directory twins are two tools writing legitimately, and resolving someone else's folder by deleting half of it is not atlas's call. A copy that appears mid-session beside a served one is left unserved until the next open |
| tidy | scheduled per (type, layout): two directories are two occupancy spaces. A file shadowed by the merge is absent from the index and therefore never renamed |

`elementDirSegmentsIn(layout, type)` makes every caller name the layout. **Why it matters**: before this, a world written to spec opened in atlas showing every content element, a clean UI, and no maps, pins, zones or markers at all, with no warning anywhere. Guards: `tests/e2e/folder-store-fs.spec.ts` (both halves revert-checked) and the conformance fixture below. This is conv. 91.

## The world file's archive (spec §4.7; Atlas 1.71, SDK 4.49)

The world file (Settings, This world, Download the whole world; the `.zip` a world comes back from) is written and read by the SDK's one implementation (`writeWorldFile`, `readWorldFile`), with Atlas's sentences for each refusal (`REFUSALS` in `src/store/world-file.ts`, and two of its own for a write refused on this world's own names). Since §4.7 the file leads with a stored `mimetype` marker, orders its entries by the UTF-8 bytes of their names, stamps each 1980-01-01, and carries only the parts: `world.json`, `elements/`, `spatial/`, `media/` (each item's `.meta.json` sidecar with it), `records/` and the `.atlas/` Atlas hands it; any other file in a world folder (a README, a notes folder) stays behind. Reading, a loose file beside the world's folder is left out rather than refused, and the budget is the spec's floor, the SDK's own constants (2 GiB, 500,000 entries; Atlas's 1 GiB and 200,000 were below it). Guards: `tests/unit/world-file.test.ts`.

**Private records** (spec §4.5 rule 11, §4.7 OW-8, v0.3.15; Atlas 1.82, SDK 4.63.0): a producer may mark its `records/<producer>/` private in `records/RECORDS.json`, and a world file then leaves that directory out, whole, unless the person asks; `RECORDS.json` travels byte for byte either way, so a reader learns what was left out. The download asks when it would leave something out, and a records list that will not read leaves nothing out by guess (conv. 166).

## Provenance lines: where a copy came from, and which slice (spec §4.2, v0.3.9; Atlas 1.67)

The world file of a **linked** world carries two lines in its world.json, and the spec version it was written against (`format_version`, `FOLDER_FORMAT_VERSION`): `source` (`{server, world, at}`: the link's server origin, its world id, the export's time) and `exported_as` (`{kind, role, character}`: `owner`, `member` with its role, or `character` with the guest's Character by id and name). The slice comes from `/me`, asked with the world's own key at export time (`src/sync/export-provenance.ts`); no signal, a refusal, a guest whose Character keel hides, or a Character not in the copy means no `exported_as` (absent, never guessed). Atlas never writes `public`; a demo key is never asked, and `/me` must answer for the link's own world. **Unlink** of a guest's or a seat's world records `exported_as: {kind: character, role: guest, character: null}` before the link goes (the role is known, the Character is not). The Data room's JSON export and an import as a new world carry both lines (keel's one-file export is that envelope). A **restore** that puts this browser's link back drops the lines it brings, since they are about the file's slice. The demo copy writes `source`. Only the file's bytes change: the world's own world.json is left as it is (`withProvenanceLines`, `src/store/world-file.ts`). A local world's file carries whatever its world.json already holds. Bringing a world down from onlyworlds.com makes a linked folder, not a portable copy, so no lines.

Reading: Settings, This world says where a copy came from and which slice (`sliceLine`); the Home cover says a Character's view or the public view is not the whole world (`partialSliceNote`). Make online is not offered on such a slice (Settings, the Home card, an element's picture row), and refuses one at the modal's door and again in route 2's merge kernel (`slicePushRefusal`, a `MergeRefusedError` before anything is read). Beside a slice the download says "Download this world". All of it in `src/core/provenance.ts` and `src/sync/export-provenance.ts`. Every copy path keeps the two keys (unknown world.json keys survive `writeWorldMeta`, the world file's reader drops only `api`, a move copies bytes); import as a new world is a whitelist on purpose. Guards: `tests/unit/provenance.test.ts`, `tests/unit/provenance-gate.test.ts` (the gate's G1-G11), `tests/integration/world-download.test.ts`, `tests/integration/world-file-open.test.ts`.

## The producer line: which tool made a folder, and from what (spec §4.2, v0.3.14; Atlas 1.72)

`producer` (`{tool, version, input}`) is written once, when Atlas makes a folder, and kept verbatim by every copy after (keel counts imports by it). Atlas writes `tool: 'atlas'`, its own version, and one of three inputs: `bare` for a world made empty (New world, the new online world before it goes up, the tour's world); `json` for a world made from JSON of unknown origin (the Data room's import of loose lists or a `World` block, the convert-notes prompt's shape); `server` for a world made from onlyworlds.com (a linked download, Bring it down again, the demo copy). An import that carries a line keeps it as written, a word Atlas does not know included; an export envelope with no line stays without one, since a copy never invents its maker (`importedProducer`, `src/core/provenance.ts`). A world file opened is not a birth: its world.json arrives as it was. The store takes the line at birth only (`writeWorldMeta`, both stores): a later write never adds or moves it, whoever sends it. The Data room's JSON export carries it. Atlas never reads it to open a folder. Guards: `tests/unit/producer-line.test.ts`, `tests/unit/producer-births-census.test.ts` (every birth names a line; the count pinned), `tests/e2e/folder-store-fs.spec.ts`.

## The conformance fixture (2026-07-28)

`tests/fixtures/folder-conformance/` is an **ecosystem artifact**: one tiny world folder plus a machine-readable `expected.json`, which any Folder Format reader can run against and report what it found. Its README states the contract (only `name` required, body type beats directory, id-less files skipped and left, unknown `x_*` round-trips, mapless pins are legal, filenames are presentation). `tests/e2e/folder-conformance.spec.ts` is atlas answering it, so "shipped atlas reads the format" is a failing test rather than a claim in a document. Proposed by Kael, adopted by Skeld's review round; destined for a public sibling repo beside the spec, so it is built portable: plain files, nothing generated at read time.

## File naming (Folder Format spec source — settled 2026-07-03)

**The invariant**: the filename is PRESENTATION; the `id` INSIDE the file is identity. A consumer MUST load every `*.json` in a type folder and key on the internal id — never parse a filename for meaning. This makes every legacy and foreign filename automatically valid, and keeps both id-minting models legal (atlas server-uuids; magelet-style deterministic uuid5-from-slug — how ids are minted is the implementation's business).

**Canonical form atlas writes**: `<name-slug>--<id-tail8>.json`

| Rule | Detail |
|------|--------|
| slug | lowercase; NFKD diacritic-strip to ASCII (José → jose); non-alphanumeric runs → single `-`; trimmed; capped at 40 chars |
| separator | `--` (unambiguous: slugs can never contain a double hyphen) |
| id-tail | LAST 8 chars of the element id (guards: a tail that would contain `--` or start with `-` falls back to the hyphen-stripped tail — canonical uuids never hit this) |
| unnamed element | bare `<full-id>.json`; renamed to slug form on the first SLUGGABLE naming |
| named but unsluggable (all-non-ASCII/emoji name → empty slug) | same bare `<full-id>.json`; stays bare until renamed to a sluggable name |
| rename | renaming the element renames the file (write-new, delete-old; the crash window heals via dedupe at next open) |
| stability (sticky runtime writes) | a write keeps the file's current name whenever that name is any valid form for the element's name — case-insensitively. Filenames never change because a sibling appeared/vanished, and never churn on body-only edits (keeps git-versioned world folders quiet). The ONE sanctioned sibling-dependent rename: open-time tidy converges a full-id fallback back to the short form once its collision has cleared |
| case-folding filesystems | equivalence is by LOWERCASE comparison everywhere (NTFS/APFS resolve case variants to the same physical entry — writing one and deleting the other would destroy the file; canonical forms are pure lowercase ASCII, so ASCII folding is the whole space). A case-variant of a target form is that target: written in place under its existing name, never renamed to its lowercase twin. (A case-variant of a NON-target form still converges normally — the write+remove pair is safe whenever the two names differ case-insensitively) |
| tail collision (same slug + same tail, different ids, ~2^-32) | the later writer falls back to `<slug>--<full-id>.json`; at open-time tidy the LOWER full id keeps the short form (deterministic — two machines produce identical layouts from the same data) |
| Windows reserved names | non-issue by construction: the always-present `--<tail>` means the base name is never exactly `con`/`prn`/`aux`/… |
| index & dedupe | the store indexes by reading file BODIES; same-id twins resolve to the latest `local_updated_at`. A loser with IDENTICAL content (a rename crash) is unlinked; one with different content moves to `.atlas/quarantine/<type>/` (convention 94). Grouping is by body id, so a same-named stranger can never be touched |
| tidy | non-canonical filenames (legacy full-uuid tails, hand-renamed files) converge to canonical form in a BACKGROUND pass shortly after first index per type per open (deferred out of the open path 2026-07-19 — an inline tidy froze activation on foreign folders with thousands of non-canonical names); processed id-sorted with a FULL occupancy view (a target name held by ANY other survivor — case-insensitively — forces the full-id fallback; both taken → the file is left alone), each rename serialized against user edits via the per-id write chain. Unreadable/id-less files are skipped and never deleted or overwritten; a converged open is a no-op. CONSUMER RULE unchanged: filenames are presentation — a consumer must never require canonical names |

Implementation: `src/store/fs-utils.ts` (`slugify`, `idTail`, `elementFilename`, `elementFilenameFullId`) + `FsFolderStore.ensureIndexFor`/`resolveFilename`. Contract tests: `tests/unit/fs-utils.slug.test.ts`, `tests/e2e/folder-store-slug.spec.ts`.

## Sync state (`sync-state.json`)

Per-world sync bookkeeping. The authoritative shape is `SyncState` in `src/core/types.ts`; every read-modify-write goes through `updateSyncState(mutate)` (conv. 86).

| Field | Holds |
|---|---|
| `changes_cursor`, `changes_last_seq` | the `/changes` watermark and the highest applied seq (the rewind guard's memory) |
| `last_pull_at`, `last_push_at` | round timestamps (informational) |
| `conflicts` | conflicts persisted under pause-and-review |
| `server_deletes` | elements the server deleted, waiting for the user's review |
| `kept_outside_view`, `walked_as_role` | elements this world's key no longer sees, kept as they are and no longer synced, and the key's role when the folder was last walked whole (conv. 151) |
| `meta_baseline`, `meta_server_updated_at`, `meta_conflicts` | the world-meta three-way (DESIGN_SYNC "World-meta sync") |
| `foreign` | ids another OnlyWorlds world already holds, scoped to the api world (conv. 108) |
| `rekeyed` | every finished re-key's old id to new id map (conv. 105) |
| `paused`, `pause_reason` | vestigial: the default shape writes them and nothing reads them. The user's "stay offline" lives in the registry (DESIGN_SYNC "Pause") |

There is no per-element entry: each element's baseline is its own `server_updated_at`. `resetSyncBaseline` clears the lot on unlink (conv. 24).

## The other `.atlas/` files

- **`lock`**: `{ tab_id, started_at, last_heartbeat }`, heartbeat every 30 s, stale after 90 s (`LOCK_HEARTBEAT_MS`, `LOCK_STALE_MS`). A live lock refuses the open with `ELockHeld` and the caller offers a consented take-over (conv. 13). A parked store stales its heartbeat so another tab can take the world at once.
- **`tombstones.json`**: `{ "deletions": [ { "id", "type", "deleted_at" } ] }`, appended before the file is unlinked (conv. 12). The engine pushes each entry as a DELETE and clears it on success; a 404 counts as success.
- **`charts.json`**: saved `ChartConfig`s, read-modify-write through `mutateCharts` (conv. 109). DESIGN_CHARTS.
- **`styles.json`**: world style rules (`core/world-styles.ts`), DESIGN_ZONES §5b. Values from this file pass `hexColourOr` before any style attribute (conv. 93).
- **`world-prefs.json`**: the world's notes, cast, calendar lens and writing labels, mirrored from the registry with a three-way at open and at write (conv. 112, `src/core/world-prefs.ts`).
- **`rekey-journal.json`**: written first by a re-key and removed when it finishes; while it exists every sync round refuses and a UI delete of a named id throws (conv. 105).
- **`quarantine/<type>/`**: where the index moves a second file claiming an element id when its content differs from the survivor (conv. 94). Nothing reads it back; it exists so atlas never deletes a file it cannot prove is a copy.

**One writer per file** (conv. 118): every one of these files, and `world.json`, is written through its own chain in `FsFolderStore`, because two overlapping writes of one file fail each other (the first write's read-back verify reads the second's bytes). A new shared file gets a chain the day it is born.

Reads that feed a whole-file write use `readJsonStrict`: a file that exists and will not parse throws `CorruptFileError` instead of reading as absent (world.json, sync-state, tombstones; charts and styles are checked before their writes).

## The atlas root (the home folder)

One user-chosen folder that holds atlas-made worlds. Set once per browser profile, and asked for only when an action makes a new world folder (create local, new api world, link or view an api world, an account world's open, import as a new world): `ensureAtlasRoot(toasts, purpose)` in `src/setup/world-doors.ts` shows one dialog and runs the picker inside its click (conv. 114). The root handle persists in IndexedDB under `ATLAS_ROOT_HANDLE_KEY`.

**The root is a creation convenience, not a storage layer.** Each world stores its own `FileSystemDirectoryHandle` in the handle vault under `world-<meta.id>`. Changing the root does not move worlds; losing it does not break them. A world with no root at all is normal (`isAtlasGrounded` = a root OR any non-demo world, `src/core/grounded.ts`).

**Wrap convention**: when the user picks a parent folder, atlas creates `onlyworlds-atlas/` inside it for worlds, unless the picked folder itself has a `.atlas-root` marker (use it directly) or already contains an `onlyworlds-atlas/` (or legacy `atlas-worlds/`) with a marker (use that). This sandboxes atlas data when the user picks a busy folder like Documents.

**Discovery**: after resolving the root, atlas scans its subfolders for a valid `world.json` and registers each (`isSameEntry` avoids duplicates; a world id already registered from another folder is skipped). An `api` block registers the world api-linked; absent, local-only.

**Recovery**: when localStorage is cleared but IndexedDB survives, `hydrateAtlasRoot` surfaces `state.atlasRootRecoverable`. The welcome panel then shows "Re-link OnlyWorlds folder" (plus "Or set up a different folder"), which re-grants, validates the marker, restores the registry entry and rediscovers the worlds; the worlds sidebar shows the recoverable state too.

**Subfolder naming**: created worlds get `<slugified-name>-<id8>` directories; `world.json` carries the friendly name. The link flow never writes into an existing folder: it falls to `-2`, `-3` suffixes.

## Opening a world folder in place

Any folder containing a `world.json` opens IN PLACE: no copy, no download (`openWorldFolder` in `src/setup/atlas-root-flow.ts`, reached through `pickAndOpenWorldFolder` / `openPickedWorld` in `src/setup/world-doors.ts`). The doors: the landing's "open a world folder", any setup door whose pick turns out to be a world, the worlds sidebar's open-folder icon (second in the icon row), the "add a world" chooser, and Ctrl+K. An `api` block in the meta registers the world api-linked with sync intact; dedupe is by the `world-<meta.id>` handle key; a failed first open rolls the entry back. This is how a folder made by another tool, synced through Dropbox or carried from another machine becomes an atlas world. A folder of world folders with a marker becomes the home folder only when there is none (conv. 114).

## Store parking

Switching worlds PARKS the prior `FsFolderStore` (LRU of 3, `src/core/active-store.ts`): caches kept, heartbeat stopped, the on-disk lock kept but heartbeat-staled so another tab can take over at once. Switching back revives in about 80 ms if the lock still carries this tab's id, and runs one live-folder pass in the background (conv. 111); a takeover forces a cold reopen, so a stale cache is never trusted. Details: SYNC_NOTES "Background tidy + parked locks".

## Media (always local)

Even for api-linked worlds, media lives only in the folder and never uploads.

- `media/<element-id>/<folder>/<filename>` holds the file, and `<media-id>.meta.json` beside it holds the `MediaItem` (scanned by the `.meta.json` suffix).
- Today the only user of local media is the map base image: `image_media_id` on a Map binds it (map-create, the map image row in `src/middle/element-detail-map-image.ts`, the tour). The image source rule: `image_url` is canonical and wins when set; `image_media_id` is the fallback when there is no url; only `image_url` goes to the API (DESIGN_MAPS).
- Unbuilt: turning a local file into an `image_url` (it needs a third-party upload). Open until the schema moves: multi-image support (one `image_url` per element today).

## The FolderStore

The single source of truth for a world's data. The authoritative interface is `src/store/folder-store.ts`; `FsFolderStore` (`src/store/folder-store-fs.ts`) is the disk implementation and `tests/fixtures/mock-folder-store.ts` the in-memory one. The method groups:

- **Lifecycle and guards**: `open(handle | null)`, `close()`, `setViewOnly()` (view-only worlds throw at every UI mutator; the engine's channels bypass).
- **World meta**: `readWorldMeta({ strict? })`, `writeWorldMeta(patch, { fromSync? })` (serialized store-wide).
- **Elements**: `listElements`, `getElement`, `createElement`, `updateElement`, `updateElementWith` (read-compute-write inside the chain), `deleteElement(id, { cascade?, silent? })`, `findDependents`, plus typed helpers for maps, pins, zones and markers (`listMarkers({ mapId, zoneId })`; pin, zone and marker deletes take no options).
- **Media**: `addMedia`, `listMedia`, `getMediaBlob` (Blob or null), `deleteMedia`, `copyMediaDir`, `removeMediaDir`.
- **Sync reads and writes**: `listLocallyChangedSince(baseline | null)`, `listTombstonesSince(baseline | null)`, `clearTombstone`, `readSyncState`, `writeSyncState`, `updateSyncState(mutate)`, `stampServerUpdatedAt(.., sentLocalUpdatedAt)`, `clearServerBaseline`, `applyServerRecord`, `applyServerRecordIfUnchanged`, `resetSyncBaseline`.
- **Atlas files**: `readCharts`/`writeCharts`, `readStyles`/`writeStyles`, `readWorldPrefs`/`writeWorldPrefs`, the re-key journal (`readRekeyJournal`, `writeRekeyJournal`, `clearRekeyJournal`, `hasRekeyJournal`), `createElementVerbatim`, `hasShadowCopy`.
- **The live folder**: `rescanDisk({ full? })` (conv. 111).

**Save semantics**:
- Every create and update stamps `local_updated_at`; callers never set it (conv. 11). Every write merges into the file as it is on disk, re-read inside the per-id chain (`readForWrite`, conv. 92).
- Writes to one id run in submission order through `PerIdWriteChain` (`src/store/write-chain.ts`, conv. 79); different ids stay concurrent. Pull-apply rides the same chain (conv. 99).
- `server_updated_at` is stamped only by sync code, and a stamp passes the `local_updated_at` the sent body carried so an edit made in flight stays dirty (conv. 96).

**Delete semantics** (`deleteElement`, cascade on by default):
- Serialized on the target's write chain; each dependent goes through its OWN chain (tombstone, then unlink); then the primary's tombstone, then its unlink. Tombstones always land before the unlink (conv. 12). It is not atomic across files and takes no lock.
- **Cascade rules** (`findDependents`): a content element takes the pins whose `element_id` names it; a map takes its pins and markers (zones carry no map link and are kept as orphan metadata); a zone takes its markers; a narrative takes its descendant narratives through `parent_narrative` plus the pins on any of them (conv. 43); a pin or marker takes nothing.
- After a non-silent delete, `scrubReferrers` removes the dead ids from every other element's link fields, each referrer through its own chain (conv. 101). Silent deletes (the engine's server-delete channel, Route 2's swap) neither tombstone nor scrub.
- The UI asks `findDependents` for the confirm count ("This will also remove N pins"); `cascade: false` is an escape hatch for engine repairs, never for UI flows.

**Copies and portability**:
- A snapshot is a copy of the folder. The Data room also exports JSON in the keel `onlyworlds-world-export` envelope (`src/import/export-world.ts`): local-only extension fields and sync stamps stripped, and never the API key (conv. 102).
- A zipped world folder opens elsewhere through "Open a world folder". It still carries `world.json.api`, so it opens api-linked with the sender's key; share an export instead when that matters.
