# Atlas — Design Document

**Version**: 1.4 (2026-07-07) — folder-first rebuild
**Status**: **Feature-complete, in v1 RELEASE PREP.** Phases 0–6 + 3.5 shipped · Knowledge phase 1 (234-236, `DESIGN_KNOWLEDGE.md`) · **Sharing LIVE end-to-end** (237-239, `DESIGN_SHARING.md` — all v1 blocks incl. circle/collection/map/chart, themes, publish/republish/revoke against the deployed backend, contract v0.3; public viewer at `tools/show/` deployed to show.onlyworlds.com) · Import & export room shipped (241, `DESIGN_IMPORT.md`) · Charts room shipped (242-245, `DESIGN_CHARTS.md`) · filename contract + sync-state serialization gated (246). **Current arc: UI/UX polish toward release** — decision base: `Forge/Notes/2026-07-05-atlas-ui-workplan.md`; execution pickup: `BUILD_BRIEF.md`; release decision record: `Forge/Notes/2026-07-03-atlas-release-plan.md`. Operational state in `PROGRESS.md`; this doc is the stable architectural reference.
**Predecessor**: `tools/atlas-deprecated/` (IDB-cached architecture, retained as UI/UX reference)

---

## Vision

Atlas is the place where you see, explore, create, and edit any OnlyWorlds world — local or synced, alone or with collaborators.

**OnlyWorlds is local-first**. Atlas honors that. Every world lives as real files on real disk. Synchronization with the OW API is an **opt-in capability**, not a storage mode. Users choose when and how to sync, and the data on their machine is always the source of truth.

**Replaces** the legacy atlas at `tools/atlas-deprecated/` once at feature parity.
**Targets** the same three audiences as the legacy: the DM prepper, the worldbuilder, the developer using OW as headless backend.

---

## Foundational Principle

> **The folder is the world. The API is a sync target.**

Every world has a folder on disk. Reads come from the folder. Writes go to the folder first. If api credentials are attached, a `SyncEngine` runs alongside, pushing local changes up and pulling remote changes down.

This is the only architectural decision that matters. Everything else falls out of it.

The legacy atlas had two parallel local-storage layers (filesystem for local-only worlds, IndexedDB for api-linked worlds). That split made "where does my data live?" depend on "am I synced?" — wrong dimensions. The rebuild collapses them: one storage layer, one mental model.

### Local representation invariant

**Every world Atlas knows about is fully represented in local files, regardless of origin.** No "partial-shadow-of-server" mode. Consequences for every flow:

- Link existing api → initial download of every element BEFORE registry flips to api-linked.
- Make Online Route 2 (merge into existing api) → bidirectional. Local pushes up AND server-only pulls down. After the merge, local folder contains every element on either side.
- After a pull, server-side new elements are written to local; server-side deletes prompt user review (default: confirm before deleting locally).
- Even on auto-pull (cadence-driven), the rule holds — pull always reconciles into local first.

If a user goes offline indefinitely with an api-linked world, every element they had access to is still on disk and editable.

### Sync orientation: local-first by default

User intent is captured by what they DON'T have to opt into:

- Autosave (debounced push) is on by default — they made an edit, they want it persisted.
- Auto-pull is OFF by default — Atlas doesn't fetch unless asked. Pull on activate is a setting, periodic cadence is a setting, both default off.
- The manual "Refresh from API" button is always available regardless of cadence settings.

The asymmetry is deliberate: pushes reflect user intent (you typed → it saves). Pulls don't, unless the user opted in.

---

## World States

Two states. The difference is **whether sync is wired**, not where data lives.

| State | Folder | API credentials | SyncEngine attached |
|---|---|---|---|
| `local-only` | yes | no | no |
| `api-linked` | yes | yes (api_key + global PIN) | yes |

No `api-only` mode. Every world has a folder. The folder is the truth. If you want the world "online," you attach api credentials and the SyncEngine begins reconciling.

**Transitions**:
- `local-only` → `api-linked`: **Make Online** flow (two routes, see Workflows).
- `api-linked` → `local-only`: detach api credentials. Folder remains, sync stops. Reversible at any time without data loss.

---

## On-Disk Layout

User picks a root folder once per world (persisted via `FileSystemDirectoryHandle` in IndexedDB; the only IDB use case in atlas). Atlas writes (wrapper folder is `onlyworlds-atlas/` — `atlas-worlds/` is the recognized legacy name):

```
<user-chosen-root>/onlyworlds-atlas/
  <world-name>-<uuid-prefix>/
    world.json                       ← metadata + api credentials (if linked)
    .atlas/                          ← atlas internal state
      sync-state.json                ← last_synced_at per element, conflict log
      tombstones.json                ← deletion log (id, type, deleted_at)
      lock                           ← presence indicates a writer is active
    elements/
      character/                     ← one subfolder per element type
        <name-slug>--<id-tail8>.json   ← e.g. aragorn--0d2a8c2b.json (unnamed: <full-id>.json)
      location/
        <name-slug>--<id-tail8>.json
      institution/
        <name-slug>--<id-tail8>.json
      ... (18 content element types)
    spatial/                         ← map artifacts (one file per element, like content)
      map/
        <name-slug>--<id-tail8>.json
      pin/
        <name-slug>--<id-tail8>.json
      zone/
        <name-slug>--<id-tail8>.json
      marker/
        <name-slug>--<id-tail8>.json
    media/
      <element-id>/
        <folder-name>/
          <original-filename>.<ext>
          _meta.json
```

**Element file format**:

```json
{
  "id": "<uuid-v7>",
  "type": "character",
  "name": "Alice",
  "description": "...",
  "species_ids": ["..."],
  "local_updated_at": "2026-05-12T10:30:45.123Z",
  "server_updated_at": "2026-05-12T10:25:00.000Z",
  ...
}
```

- `local_updated_at` is the source of truth for "this changed locally at time T." Stamped by FolderStore on every save.
- `server_updated_at` is the last value the server confirmed. Used to detect server-side changes (server `updated_at > server_updated_at` means someone else edited).
- For `local-only` worlds, `server_updated_at` is omitted.

### File naming (Folder Format spec source — settled 2026-07-03)

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
| index & dedupe | the store indexes by reading file BODIES; rename-crash twins (same body id, two files) resolve to the latest `local_updated_at`, the loser is unlinked — grouping is by body id, so a same-named stranger can never be deleted |
| tidy | non-canonical filenames (legacy full-uuid tails, hand-renamed files) converge to canonical form lazily at first index per type per open, processed id-sorted with a FULL occupancy view (a target name held by ANY other survivor — case-insensitively — forces the full-id fallback; both taken → the file is left alone). Unreadable/id-less files are skipped and never deleted or overwritten; a second open is a no-op |

Implementation: `src/store/fs-utils.ts` (`slugify`, `idTail`, `elementFilename`, `elementFilenameFullId`) + `FsFolderStore.ensureIndexFor`/`resolveFilename`. Contract tests: `tests/unit/fs-utils.slug.test.ts`, `tests/e2e/folder-store-slug.spec.ts`.

**Tombstones format** (`tombstones.json`):

```json
{
  "deletions": [
    { "id": "<uuid>", "type": "character", "deleted_at": "2026-05-12T10:31:00Z" },
    ...
  ]
}
```

Append-only during local deletes. SyncEngine pushes each entry to the API as a DELETE, then removes it from the log on success.

**Sync state format** (`sync-state.json`):

```json
{
  "last_pull_at": "2026-05-12T10:25:00Z",
  "last_push_at": "2026-05-12T10:30:00Z",
  "conflicts": [
    {
      "element_id": "<uuid>",
      "type": "character",
      "detected_at": "...",
      "local_updated_at": "...",
      "server_updated_at": "...",
      "fields": ["description", "image_url"]
    }
  ],
  "paused": false
}
```

---

## Atlas Root (creation-default container for worlds)

A single user-chosen folder that holds atlas-managed worlds. Set up once per browser profile; the handle persists in IndexedDB under `ATLAS_ROOT_HANDLE_KEY`. New worlds default to becoming subfolders inside this root.

**Critical**: the atlas root is a **creation convenience**, not a storage layer. Each world stores its own `FileSystemDirectoryHandle` in the vault under `world-<uuid>`. Existing worlds work independently of the root — changing the root doesn't move them; losing the root doesn't break them.

**Wrap convention**: when the user picks a parent folder, atlas creates an `onlyworlds-atlas/` subfolder inside it for worlds, unless:
- the picked folder itself has a `.atlas-root` marker → use it directly
- the picked folder already contains an `onlyworlds-atlas/` (or legacy `atlas-worlds/`) with marker → use that subfolder

This sandboxes atlas data in a known subfolder when the user picks a busy folder like Documents, while supporting power users who pick the wrapper directly.

**World discovery on root setup**: after resolving the root, atlas scans its subfolders for any with a valid `world.json` and imports them into the registry (using `handle.isSameEntry()` to avoid duplicates). Critical when localStorage is wiped but the disk folder remains. Discovery reads each `world.json`'s `api` block — present → registered as api-linked (sync engine attaches normally on activation); absent → registered as local-only.

**Orphan-handle recovery** (session 212): the atlas-root handle persists in IndexedDB under the fixed `ATLAS_ROOT_HANDLE_KEY`. When localStorage is cleared but IDB survives (the common "clear site data" partial-wipe), `hydrateAtlasRoot` detects the orphan and surfaces `state.atlasRootRecoverable`. UI shows a one-click `↻ Recover atlas folder` button (sidebar header + welcome panel) that ensures-writable + validates the `.atlas-root` marker + restores the registry entry + runs `discoverWorldsInRoot`. Post-recovery, deep URLs from before the wipe are reset to `#/` so the sidebar lands on Worlds mode without requiring an extra click.

**Subfolder naming**: created worlds get `<slugified-name>-<uuid-prefix>` directories. Each world's `world.json` has the friendly name; the folder name is a backstage detail.

```
<user-picked-parent>/
  onlyworlds-atlas/
    .atlas-root                   ← marker file with {version, created_at}
    my-first-world-7a3f0c12/      ← per-world subfolder (the actual world)
      world.json
      .atlas/{lock, sync-state.json, tombstones.json}
      elements/<type>/<id>.json
      spatial/<type>/<id>.json
      media/<element-id>/<folder>/<filename>
    another-world-92b4ee01/
      ...
```

The atlas root also supports **external worlds** (advanced path, no UI in v1): a world folder anywhere on disk, registered via its own handle, not living inside any atlas root. Existing local-only worlds created before the atlas-root concept work as external automatically.

---

## The FolderStore

Single source of truth. Implements every read/write Atlas needs.

```ts
interface FolderStore {
  // Lifecycle
  open(handle: FileSystemDirectoryHandle): Promise<void>;
  close(): Promise<void>;

  // Elements
  listElements(type?: ElementType): Promise<Element[]>;
  getElement(id: string): Promise<Element | null>;
  createElement(type: ElementType, data: Partial<Element>): Promise<Element>;
  updateElement(id: string, patch: Partial<Element>): Promise<Element>;
  deleteElement(id: string): Promise<void>;       // also writes a tombstone

  // Spatial (maps, pins, zones, markers — same shape, specialized types)
  listMaps(): Promise<WorldMap[]>;
  createMap(data: Partial<WorldMap>): Promise<WorldMap>;
  updateMap(id: string, patch: Partial<WorldMap>): Promise<WorldMap>;
  deleteMap(id: string): Promise<void>;
  listPins(mapId?: string): Promise<Pin[]>;
  // ... pins, zones, markers identical shape

  // Media — files in folder, never sent to API
  addMedia(elementId: string, file: File, folder: string): Promise<MediaItem>;
  listMedia(elementId: string): Promise<MediaItem[]>;
  getMediaBlob(mediaId: string): Promise<Blob>;
  deleteMedia(mediaId: string): Promise<void>;

  // World-level
  readWorldMeta(): Promise<WorldMeta>;
  writeWorldMeta(patch: Partial<WorldMeta>): Promise<void>;

  // Sync-relevant reads (for SyncEngine)
  listLocallyChangedSince(timestamp: string): Promise<Element[]>;
  listTombstonesSince(timestamp: string): Promise<Tombstone[]>;
  readSyncState(): Promise<SyncState>;
  writeSyncState(patch: Partial<SyncState>): Promise<void>;
}
```

**Save semantics**:
- Every `createElement` / `updateElement` stamps `local_updated_at = now()` automatically.
- `deleteElement` writes a tombstone and removes the file in one atomic step (acquire lock, write tombstone, unlink file, release lock).
- `server_updated_at` is only stamped by the SyncEngine after a successful push or pull confirmation.

---

## The SyncEngine

Attached only to `api-linked` worlds. Reads the folder, talks to the OW API.

```ts
interface SyncEngine {
  // Lifecycle
  start(): void;
  stop(): void;
  pause(): void;        // user-initiated "stay offline"
  resume(): void;       // unpause; triggers immediate diff-and-sync

  // Manual triggers (from UI)
  pullNow(): Promise<SyncResult>;
  pushNow(): Promise<SyncResult>;
  syncNow(): Promise<SyncResult>;    // pull then push

  // Status (observable)
  getState(): SyncEngineState;
  onStateChange(cb: (state: SyncEngineState) => void): Unsubscribe;
  onConflict(cb: (conflict: Conflict) => void): Unsubscribe;
}

type SyncEngineState =
  | { kind: 'idle'; lastSyncAt: string | null }
  | { kind: 'syncing'; phase: 'pull' | 'push'; progress?: { done: number; total: number } }
  | { kind: 'paused'; reason: 'manual' | 'network'; pendingChanges: number }
  | { kind: 'error'; message: string; recoverable: boolean };

interface SyncResult {
  pushed: { creates: number; updates: number; deletes: number };
  pulled: { creates: number; updates: number; deletes: number };
  conflicts: Conflict[];
}
```

### Sync algorithm

**Push phase** (local → server):
1. Read `last_pull_at` from sync state.
2. Find all elements with `local_updated_at > server_updated_at` (or `server_updated_at` absent — meaning never synced).
3. Read tombstones.
4. For each push candidate:
   - If element has no `server_updated_at` → CREATE on server (client-provided UUID preserved).
   - Else → UPDATE on server. Before sending, optionally GET server state; if server `updated_at > server_updated_at` (stored), record a **conflict** instead of pushing (depending on policy).
5. For each tombstone → DELETE on server. On success, remove from tombstone log.
6. Stamp `server_updated_at = response.updated_at` on successfully synced elements.

**Pull phase** (server → local):
1. List server elements for each type bucket.
2. For each server element:
   - If not in folder → CREATE locally (download, write file with stamped `server_updated_at`).
   - If server `updated_at > server_updated_at` AND `local_updated_at <= server_updated_at` → UPDATE locally (overwrite with server version).
   - If both sides changed (`local_updated_at > server_updated_at` AND server `updated_at > server_updated_at`) → CONFLICT (don't overwrite locally; record in sync state).
3. For server elements missing locally that have NO tombstone → they were created on the server while we were offline; pull them.
4. For folder elements missing on server that have NO tombstone AND `server_updated_at` is present (meaning they were synced before) → server deleted them; route to `sync_state.server_deletes` and surface the server-delete review modal (per-row `keep + re-push` / `delete locally`). Default `sync_confirm_server_deletes` is on (confirm before deleting locally). Pagination-aware: detection is suppressed for types whose list was paginated, to avoid falsely flagging page-2+ elements (SYNC_NOTES).

### Sync policies (Phase 3.5+, simplified to two)

Global setting (per-world overrides deferred to 3.6+). Default: `local-wins`.

| Policy | Push conflict | Pull conflict | UI surfacing |
|---|---|---|---|
| **`local-wins`** (default) | Push local anyway, server overwritten | Skip applying server change for that element; local stays | One-shot toast per sync round. **No badge, no modal, no sync-state entries persisted.** |
| **`pause-and-review`** | Skip the push, conflict persisted | Skip applying server change, conflict persisted | ⚠ badge fires on sync pill. Click → modal with per-element `overwrite (mine wins)` / `pull (theirs wins)` actions. Closing without picking = "decide later"; badge persists. |

Both policies apply symmetrically across push AND pull (same divergence, different direction). Legacy values (`drain-blind`, `pause-on-conflict`, `ask`) are migrated on load — see `registry.loadRegistry`.

#### Why no `server-wins` policy

Destructive auto-overwrite of local edits is too dangerous as an implicit default. Users who want server's version for a specific element invoke the explicit `pull (theirs wins)` action in the conflict modal (or the future per-element refresh button).

#### When `pause-and-review` is the right choice

When you're editing the world from multiple places (web app, multiple atlas instances, obsidian plugin) and need to know when changes diverge. The modal forces an explicit choice per conflict so nothing gets silently overwritten in either direction. Default for solo atlas users is `local-wins` since their edits should generally win.

### Pause semantics

- `pause()` sets `sync state.paused = true` (`reason: manual`). Engine stops attempting pushes/pulls. Local writes continue normally to the folder. Sync indicator shows `offline (paused) · N pending`.
- `navigator.onLine === false` → engine self-pauses (`reason: network`). Same external behavior.
- `resume()` clears paused flag and immediately calls `syncNow()`.

### Push triggers

- Manual: `pushNow()` button.
- Auto-debounced: 5 seconds after the last local write, if not paused and online. Configurable later via `engine.setDebounceMs(ms)`.
- On resume / online event.

The auto-debounce is implemented in `SyncEngine.requestPush()`: schedules `pushOnce()` after the debounce window, resets on each call so bursts of edits coalesce. Wired into every folder-write site (element edit + delete + create, map create + delete, pin placement) via `requestPushIfLinked()` in `sync-attach.ts` — a no-op for local-only worlds. `SyncEngine.stop()` cancels any pending debounced push (called on engine detach).

### Push resilience

`pushPhase` is per-element error tolerant: 4xx, validation, transient network failures on a single element are recorded in `result.failures: PerElementFailure[]` and iteration continues. This matters most for `pushOnce()` invoked by Make-Online flows that upload dozens of elements at once — one bad element shouldn't abort the upload. Successful elements get `server_updated_at` stamped; failed ones retry on the next sync.

### Pull triggers (3.5+)

Pull is local-first opt-in. None of these fire unless the user enabled the corresponding setting.

- **Manual** (always available): `pullNow()` via "Refresh from API" button on the sync pill / world settings.
- **On world activate** (default OFF): if `registry.sync_pull_on_activate` is true, `pullNow()` runs after `attachSyncEngine` whenever an api-linked world activates.
- **Periodic auto-pull** (default OFF — `registry.sync_cadence_ms = null`): scheduler polls every N ms; pauses on `visibilitychange:hidden`; only ever calls `pullNow()` on the currently-active engine.
- **On `online` event**: when network returns AND the engine was network-auto-paused, a one-shot `syncNow()` flushes queued pushes + pulls.

Push triggers are unchanged — autosave debounce is the only push trigger; user typed = user wants saved.

---

## UUIDs

**Local creates use `crypto.randomUUID()` (v4). The OW server assigns its OWN UUID v7 on CREATE, overriding the client id** — this superseded the original "server accepts client ids" assumption (verified live; see SYNC_NOTES "Server-assigned ids").

Consequences:
- Every CREATE-push path runs the **id-swap**: re-key the local file to the server's id, rewrite FK references across all other local elements (`rewriteIdReferences`), silently delete the old file (no tombstone — the server never had the old id), and propagate to UI state + URL via `onIdSwap` → `handleIdSwap` (selection, `/element`, `/map`, `/knowledge`, `/knowledge/knower` routes).
- Locally (offline / local-only), client v4 ids work indefinitely — the swap only happens at first push.

**Implications for Make-Online Route 2** (link to existing api world): name+type matching is the primary match key (elements created independently on different machines have different UUIDs); ID matching catches re-uploads from the same machine cleanly.

---

## Workflows

### W1 — Create local world

1. User clicks "+ Create Local" in sidebar Worlds mode (or Welcome CTA).
2. Modal asks for name; "Pick Folder" button opens the OS folder picker.
3. Atlas writes `world.json`, empty `elements/`, `spatial/`, `media/`, `.atlas/`.
4. Registry entry added with `state: 'local-only'`, folder handle stored in handle-vault.
5. World activated. Middle shows the world home room (sidebar mode is independent — convention #37).

### W2 — Link existing api world

1. User clicks "+ Link API" (or Welcome CTA).
2. Modal asks for: API key, PIN (pre-filled from registry if set), optional display name override. Then "Pick Folder" (where the world's local files will live).
3. On submit:
   - Validate by calling `client.worlds.get()` with the credentials.
   - **Initial download**: fetch ALL elements/maps/pins/zones/markers from the API, write to folder with stamped `server_updated_at`.
   - Progress UI: "Downloading 247 of 412 elements…"
   - Register entry as `api-linked`, attach SyncEngine.
4. Toast: "linked {name}". Sync indicator shows "synced".

**Initial-download error handling**: partial downloads are valid (folder has what it has). User can resume by clicking "Refresh from API". The world is openable even if download is incomplete.

### W3 — Make local online: Route 1 (create new api world)

1. User opens local world. Sidebar Worlds mode → context menu on the world → "Make Online…" (or Settings → World → "Make Online").
2. Modal:
   - Display name (defaults to current world name)
   - Email (pre-filled from Settings, editable)
   - PIN (pre-filled from Settings, editable)
   - Validation: must be online; folder must contain at least one element OR user confirms creating an empty api world.
3. On submit:
   - `POST /api/worldsync/create-world-external/` with `{name, email, pin}` → returns `{api_key}`.
   - Push all local elements/maps/pins/zones/markers to the new api world using the SyncEngine push path (with `server_updated_at` stamped on success).
   - Progress UI: "Uploading 47 of 412 elements…"
   - Maps without `image_url` are pushed with empty url; UI shows warning indicator on those maps post-upload.
   - On full success: update registry entry — `state: 'api-linked'`, attach api credentials, start SyncEngine.
   - Folder data is untouched. Files stay where they are. The world is now api-linked but the local layer is the SAME folder.
4. Toast: "{name} is online."

**Error handling**: if push fails mid-upload, the api world has partial data. Registry entry stays `local-only` until user retries or proceeds with partial state. (No dedicated "finish upload" action — retry re-runs the flow; per-element push resilience means a partial upload converges on the next sync round.)

### W4 — Make local online: Route 2 (link to existing api world)

For users who already created an api world elsewhere (web app, obsidian plugin) and want to merge their local content into it. **Bidirectional**: local-only elements push up, server-only elements pull down, matched elements resolve per policy. End state: local folder contains every element on either side.

1. Same context menu entry → "Link to Existing API World…"
2. Modal:
   - API key
   - PIN
   - **Merge policy** (radio) for the MATCHED elements (same name+type on both sides):
     - **(b) Push, overwrite duplicates** (default): local content wins → UPDATE server. Local file's id is rewritten to the server's id (server-side id always wins).
     - **(c) Skip duplicates**: server content kept → local file fully overwritten with server's record (adopts server's id and content). Local edits to matched elements are LOST under this policy — explicit warning in UI.

   Full-overwrite ("wipe server, push local fresh") is intentionally NOT a v1 policy — too easy to nuke a collaborator's data. Users who genuinely want this delete the api world via the web app, then use Route 1 (Make Online → create new).
3. On submit:
   - Validate credentials, fetch server state for every type.
   - Build diff (three buckets):
     - **Local-only** (no server match) → CREATE on server.
     - **Server-only** (no local match) → DOWNLOAD to local (via `applyServerRecord`).
     - **Matched** (name+type match) → policy (b): UPDATE server with local + rewrite local id to server's id; policy (c): overwrite local file with server's full record.
   - Apply diff with progress UI showing all three counts.
   - On success: flip registry state, attach SyncEngine, stamp `server_updated_at` everywhere.
4. Toast: "{name} linked. {n} pushed, {m} downloaded, {p} updated/skipped."

**Id-swap on matched elements (policy b)**: when local id ≠ server id and they match by name+type, local file is re-saved with the server's id. Foreign-key references to the old local id (pins on this element, relations, etc.) MUST be rewritten in the same atomic operation. The folder-store provides a helper for this rewrite.

### W5 — Edit element (online, autosave default)

1. Click field value → popover opens.
2. Edit → Save (Enter or button).
3. FolderStore.updateElement stamps `local_updated_at` and writes the file.
4. UI re-renders from folder state.
5. SyncEngine's debounced push fires 5 seconds later → server gets the change → `server_updated_at` stamped.
6. Sync indicator: synced → saving (pulse cyan) → synced.

### W6 — Edit element (stay-offline or network-offline)

Same flow as W5, except:
- SyncEngine is paused (manual or network).
- FolderStore writes still happen normally; the element file is updated, `local_updated_at` stamped.
- Sync indicator shows: `offline (paused) · 1 pending` (count derived from elements with `local_updated_at > server_updated_at`).
- No SDK calls attempted while paused.

### W7 — Resume sync (manual toggle off, or network return)

1. User flips "stay offline" toggle to off (or `online` event fires).
2. SyncEngine `resume()` → state → `syncing`.
3. Push phase runs: for each locally-changed element, push to server. Conflicts handled per policy (default `local-wins`: push overwrites server, one-shot toast).
4. Pull phase runs: fetch updates from server since `last_pull_at`. Apply non-conflicting; conflicting handled per policy.
5. Sync indicator returns to `synced` (or `error` if anything failed).

### W8 — Conflict surfacing

Two policies only (see "Sync policies" above; legacy `drain-blind`/`pause-on-conflict`/`ask` names are migrated on load). Symmetric across push and pull.

Under **`local-wins`** (default):
- Conflict detected (both sides changed since the baseline).
- Local wins — push overwrites the server; pull skips applying the server change for that element.
- One-shot toast per round; no badge, no modal, no persisted conflict (the divergence is already resolved). A pull-time conflict triggers an immediate follow-up push to converge (SYNC_NOTES).

Under **`pause-and-review`**:
- Nothing auto-resolves — push skips, pull skips, the conflict is persisted to `sync-state.json`.
- ⚠ badge fires on the sync pill; clicking opens the conflict-review modal with per-element `overwrite (mine wins)` / `pull (theirs wins)` actions. Closing without choosing = decide later; the badge persists.

### W9 — Delete element (cascade-aware)

1. User clicks delete in element-detail header.
2. UI calls `folder.findDependents(id)` for the preview count.
3. Confirmation dialog: "Delete X? This will also remove {n} pins."
4. `folder.deleteElement(id)` (cascade defaults true): tombstones are written for every dependent first, then for the primary element. Returns `{ tombstones }` so the UI can surface a toast count.
5. **Cascade rules**:
   - Content element delete → tombstones every pin whose `element_id` references it.
   - Map delete → tombstones every pin / zone / marker on that map.
   - Pin / zone / marker delete → no cascade.
6. Cascade tombstones are appended BEFORE the primary so server DELETEs execute in dependency-safe order.
7. If api-linked: SyncEngine pushes DELETEs on next sync.
8. `opts.cascade: false` is an escape hatch for advanced flows (engine cleanups, repairs). UI flows must use the default.

### W10 — Multi-machine, same world

User opens the same world's folder on two machines (e.g., via Dropbox-synced folder, or two laptops with the same api credentials but separate folders).

- **Same folder via Dropbox**: undefined behavior (file system race conditions). Lock file (`.atlas/lock`) detects concurrent access and warns the second tab. User accepts at their own risk. Document as "not officially supported."
- **Separate folders, same api credentials**: each machine has its own FolderStore + SyncEngine. They reconcile through the api server. Standard distributed-edit semantics — last writer wins on conflicts unless policy is `pause-and-review`.

### W11 — Snapshot / backup

Native to the architecture: copy the folder. No export feature needed.

### W12 — Portability

Native: zip the folder, share it. Recipient picks "Open Local Folder" on their atlas, points it at the unzipped folder. Registry entry is theirs; the api credentials in `world.json` are also there (consider whether to strip them on copy — probably yes for shared zips; Phase 3.5 add a "Share copy without credentials" option).

---

## Maps Subsystem

See **`DESIGN_MAPS.md`** for the full map subsystem design — domain model (parent_map, location, hierarchy as sibling-order), tree-build algorithm, UI surfaces, image source rules, test world fixtures, schema-update pile, and the bout sequence.

**Image source rule** (supersedes prior text): `image_url` is canonical and wins display when set. `image_media_id` is the atlas-local fallback when no URL exists. Both can be stored simultaneously; UI badges indicate which is rendering. Push to API: `image_url` only.

---

## Media (always local, always in folder)

Even for api-linked worlds, media lives ONLY in the folder. No upload to OW.

- `media/<element-id>/<folder-name>/<filename>` — real files
- `_meta.json` per item — original filename, type, added_at, etc.
- Element's `image_url` field is separate from the media grid (it's the API's canonical primary image).
- "Set local file as image_url" is a future feature requiring an upload-to-third-party (imgur, etc.) — Phase 3.5.

---

## UI — Three-Pane Shell + Room Model

```
┌─────────┬─────────────────────────────────┬─────────────────────────┐
│ 19%     │ 51%                             │ 30%                     │
│ SIDEBAR │ MIDDLE                          │ RIGHT                   │
│         │ ┌─────────────────────────────┐ │                         │
│ [Worlds │ │ 🏠 ✎ 🕓 ⌕ ⬆ ⬇ 🧩 ⚙       │ │ [Maps | <map tabs>]    │
│  Elem]  │ │ ← room nav strip (~32px)   │ │                         │
│         │ ├─────────────────────────────┤ │ leaflet canvas per map  │
│ filter  │ │                             │ │ with lifecycle cache    │
│ chips   │ │   <room content>            │ │                         │
│ search  │ │                             │ │                         │
│ list    │ │   home / element / writing  │ │                         │
│         │ │   knowledge / charts /      │ │                         │
│         │ │   share / import / settings │ │                         │
│         │ │   (search+templates dormant)│ │                         │
│ ⚙       │ │                             │ │                         │
└─────────┴─└─────────────────────────────┘─┴─────────────────────────┘
```

**Sidebar (~19%)**: 2 modes (Worlds | Elements). Top toggle, footer gear → settings.

**Middle (~51%)**: split into two stacked regions —
- **Room nav strip** (~32px, top): persistent icon strip when a world is active. Click any icon → navigate to that room. Hidden on the welcome screen (no world).
- **Room content** (flex 1, below): the active room renders here.

**Right (~30%)**: tab bar (Map Index pinned + per-map tabs) + leaflet canvas.

**Ratios** persisted to `localStorage.atlas_shell_ratios_v2`.

---

## Rooms

A **room** is a top-level mode of the middle pane. The room nav strip is always visible when a world is active; clicking an icon navigates to that room.

| Room | Route | Content | Status |
|---|---|---|---|
| `welcome` | `#/` | First-launch atlas-root setup CTA | shipped |
| `home` | `#/w/<id>` | World home — identity, stats, charts (timeline-bar) preview, recent, quick actions. **Default landing for active worlds.** | shipped |
| `element` | `#/w/<id>/element/<eid>` | Schema-driven element detail | shipped |
| `writing` | `#/w/<id>/writing[/<narrativeId>]` | Book/chapter/scene/draft authorship (any tier; ancestry derived from `parent_narrative`). See `DESIGN_WRITING.md`. Legacy long-form URL still parsed. | shipped |
| `knowledge` | `#/w/<id>/knowledge[/<entryId>\|/new\|/knower/<id>]` | Knowledge entries — who knows what. [Entries \| Knowers] tabs, draft editor (persists nothing until create), embedded TipTap prose w/ mentions, known-view per knower. See `DESIGN_KNOWLEDGE.md` | shipped (phase 1) |
| `timeline` (the **Charts** room) | `#/w/<id>/timeline[/<id>]` | **Charts** — chart views of the world along chosen axes (time first): type-icon identity, degree-ranked anchor beats, density-fan layout, LOD, unified select=focus (focus in the URL, Back walks the chain). Route key stays `timeline`; room title + nav read "Charts". See `DESIGN_CHARTS.md`. | shipped |
| `search` | `#/w/<id>/search?q=<query>` | Global search across name + description + supertype + subtype | **removed from nav pre-release (240)** — route/file dormant; replacement = Cmd+K palette (see "Search" above) |
| `share` | `#/w/<id>/share[/<pageId>]` | Sharing pages — list + block builder (heading/prose/element-card/circle/collection/map/chart) + themes + payload-true visitor preview + LIVE publish/republish/revoke (contract v0.3). Legacy `/publish` URLs alias here. See `DESIGN_SHARING.md` | shipped + live |
| `import` | `#/w/<id>/import` | **Import & export room** — bring in (full-world/loose JSON → new world or merge, validation + fix-prompt) / take out (ow.com-shape export, by-type subset). See `DESIGN_IMPORT.md` | shipped (241) |
| `templates` | `#/w/<id>/templates` | Element creation templates (atlas-local) | **removed from nav pre-release (240)** — route/file dormant |
| `settings` | `#/w/<id>/settings[/<tab>]` | Account / storage / editing (atlas-wide) · world / writing / context (per-world) | shipped |

**Default route**: bare `#/w/<id>` resolves to `home` (was `timeline` pre-session-223). Welcome stays at root `#/` with no active world.

**Room nav strip** (`src/middle/room-nav.ts`) reads `state.active` + parsed route, highlights the active room icon. Hover → tooltip with sentence-case room name.

**Element selection lives WITHIN the element room** — selecting an element navigates to `#/w/<id>/element/<eid>` (the element room). The element header appears BELOW the room nav strip with element-specific actions (delete, publish, pin, etc.).

**Deselect convention**: **Esc** clears `selectedElementId` and navigates to home — when an element is selected, no modal/overlay is open, and the route is NOT `writing`/`knowledge` (those rooms own their keyboards; see convention #32 + #46). Click-row-toggle was considered and dropped (session 223) — Esc is the canonical deselect.

**Room header model — the two-tier rule (convention #80, session 240).** Every middle-pane view opens with ONE of two header shapes, chosen by level:
- **Room landing** (home, knowledge list, share list, timeline, settings, import, writing-with-no-narrative) → `.atlas-room-header`: a **22px white** `<h1>` + optional `.atlas-room-subtitle`, with the primary action in an `.atlas-room-actions` row below. Section headings within are **sentence-case** (match the share room), never uppercase.
- **A single named entity** (element, knowledge entry, share page, knower, an open writing narrative) → the compact 36px `.atlas-middle-header` band: `back · kind icon · 15px click-to-edit title · actions`. The title IS the editable name — there is **no separate "Name" field**. Click-to-edit is the shared `makeEditableTitle` helper (`src/middle/editable-title.ts`), used by element-detail-header + knowledge-room + share-room.

Rule of thumb: **big title = you're in a room; compact band = you're looking at one thing.** Titles are white; cyan is for accents/links, not headings.

**Search** (session 240): the dedicated search ROOM was removed pre-release — it was the weakest search surface. Interim search is the elements-sidebar name filter. The planned replacement is a **Cmd+K / "/" command palette**: an overlay summonable from any room that searches name + description + supertype + subtype and jumps to a result (with a "see all →" path). `search.ts` + the `/search` route stay dormant until the palette ships (re-add the `room-nav.ts` entry to restore the old room). **Templates** room likewise removed pre-release (not built before launch; route + `templates-room.ts` dormant).

Per-room design docs:
- World Home: `DESIGN_HOME.md`
- Writing: `DESIGN_WRITING.md`
- Knowledge: `DESIGN_KNOWLEDGE.md`
- Sharing: `DESIGN_SHARING.md` (supersedes `DESIGN_PUBLISHING.md`)
- Maps (right pane): `DESIGN_MAPS.md`
- Zones (right pane): `DESIGN_ZONES.md`

---

## State Shape

`src/core/state.ts` is the source of truth — the shape below is a reference, kept high-level to avoid drift. `middleMode` is the room (rooms model, session 223+); navigational/world-specific prefs live on the registry or URL, app-level UI prefs in `ui-prefs.ts` (NOT in `UiState`).

```ts
interface AppState {
  registry: WorldsRegistry;              // localStorage-persisted
  atlasRoot: AtlasRootRef | null;        // creation-default root container
  atlasRootRecoverable: AtlasRootRecoverableRef | null;  // orphan-handle recovery
  active: ActiveWorldRef | null;         // currently-open world
  middleMode: MiddleMode;                // active room (home/element/writing/timeline/settings/…)
  data: DataState;                       // elements/maps/pins/zones/markers in memory
  ui: UiState;                           // selection, filters, right tabs, transient flags
  sync: SyncSummaryState;                // per-world sync engine summary for UI
  busy: boolean;
}

interface UiState {
  sidebarMode: 'worlds' | 'elements';
  selectedElementId: string | null;
  elementFilters: Set<ElementType>;      // empty = show all
  search: string;
  rightTabs: RightTabRef[];              // [context, map-index, ...maps]
  rightActiveIndex: number;
  pinPlacement: { elementId: string } | null;
  zoneEditing: { zoneId: string; mapId: string } | null;
  sidebarWritingOverride: boolean;       // transient, in-session only
}

interface SyncSummaryState {
  byWorld: Record<string, SyncEngineState>;
  activeSync: SyncEngineState | null;       // convenience pointer to active world's engine
}
```

The `state.sync` slice is populated by `attachSyncEngine(entry, folder)` (singleton in `src/sync/sync-attach.ts`). The helper:

1. No-ops for `local-only` worlds (and detaches any prior engine).
2. For `api-linked` worlds: constructs `OnlyWorldsClient` from `entry.api.api_key` + `registry.pin`, wraps in `OwClientAdapter`, instantiates `SyncEngine`, wires `onStateChange → patchSlice('sync', ...)`.
3. Detaches the previous world's engine on switch — at most one active at a time.
4. Exposed: `getCurrentSyncEngine()` for autosave callers, `requestPushIfLinked()` as a fire-and-forget convenience.

`attachSyncEngine` is called from:
- `worlds-sidebar.activateWorld` — every world activation.
- `atlas-root-flow.createWorldInRoot` — fresh local world (detaches prior engine).
- `atlas-root-flow.linkExistingApiWorldInRoot` — after initial download.
- `make-online-modal` — after registry transition to api-linked.

UI prefs (`sidebarMode`, `defaultCreateType`) → `localStorage.atlas_ui_prefs` (see `core/ui-prefs.ts`).
Navigation state (active world, selection, open maps, room) → URL hash.

---

## Routing (URL hash)

Hash-based, no server rewrites needed (Cloudflare Pages friendly).

**Sidebar mode routes** (worlds | elements):
```
#/                                          → no world (welcome)
#/w/<worldId>/worlds                        → Worlds sidebar mode
#/w/<worldId>/elements                      → Elements sidebar mode
```

**Room routes** (active room = mode of middle pane):
```
#/w/<worldId>                               → home room (DEFAULT for active world)
#/w/<worldId>/element/<elementId>           → element room
#/w/<worldId>/writing                       → writing room (no narrative selected)
#/w/<worldId>/writing/<narrativeId>         → narrative selected (any tier; ancestry derived from parent_narrative)
                                              (legacy long form /writing/book/<b>[/chapter/<c>[/scene/<s>]] still parses)
#/w/<worldId>/knowledge                     → knowledge room ([Entries | Knowers] tabs)
#/w/<worldId>/knowledge/new                 → knowledge draft editor (nothing persists until create)
#/w/<worldId>/knowledge/<entryId>           → knowledge entry editor (embedded TipTap prose)
#/w/<worldId>/knowledge/knower/<knowerId>   → known-view (the world as a character/circle knows it)
#/w/<worldId>/timeline                      → full timeline room
#/w/<worldId>/search?q=<query>              → search room
#/w/<worldId>/share                         → share room (page list)
#/w/<worldId>/share/<pageId>                → share room, page builder
                                              (legacy /publish[/<id>] still parses as an alias)
#/w/<worldId>/import                        → import room
#/w/<worldId>/templates                     → templates room
#/w/<worldId>/settings                      → settings (default tab)
#/w/<worldId>/settings/<tab>                → settings deep-link (account/storage/editing/world/writing/context; legacy keys alias)
```

**Right-pane map composition** (orthogonal to room — maps live in the right pane, room lives in middle):
```
#/w/<worldId>/map/<mapId>                   → opens map tab in right pane; middle stays on home/last room
#/w/<worldId>/map/<mapId>/element/<eid>     → map open + element selected (element room in middle)
```

**Deep-link helpers** in `core/router.ts`:
- `homeHash(worldId)`
- `elementHash(worldId, elementId)`
- `elementsHash(worldId)` (sidebar mode)
- `worldsHash(worldId)` (sidebar mode)
- `writingHash(worldId, narrativeId?)`
- `knowledgeHash(worldId, knowledgeId?)` / `knowledgeKnowerHash(worldId, knowerId)`
- `timelineHash(worldId)`
- `searchHash(worldId, query?)`
- `shareHash(worldId, pageId?)`
- `importHash(worldId)`
- `templatesHash(worldId)`
- `settingsHash(worldId, tab?)`
- `mapHash(worldId, mapId)` / `mapElementHash(worldId, mapId, elementId)`

---

## Critical Conventions

Inherited from legacy (hard-won; preserve in new code):

1. **State is truth** — UI reads from `store.get()`, writes via `store.patchSlice()`, router mediates URL ↔ state.
2. **Force re-render idiom** — patch `data.elements` with a new reference. Patching `ui` with same content does NOT trigger selectors (slice-select compares strict equality on selected value).
3. **Shell pane non-mutation** — renderers must wrap content in a child div, never set `.atlas-middle` / `.atlas-right` cssText or className. Touching the shell pane wipes its `flex: 0 0 X%` and breaks the layout.
4. **`min-width: 0` on flex children** — without it, wide content forces parent past flex-basis.
5. **SDK-shape-agnostic relationships** — scan all array fields whose items have `id`; don't hardcode `_ids` suffix detection (SDK may rewrite field names).
6. **Acronym-aware field labels** — `humanizeFieldName('image_url')` → `Image URL` via ACRONYMS set (URL, ID, API, UI, IP, HTML, HTTP, DNS, UUID, SDK, PIN, GPS).
7. **ui-prefs vs URL state** — UX preferences in localStorage; navigation state in URL hash. Don't conflate.
8. **Pin write SDK bypass** — `prepareRelations` mis-handles `element_id` (would convert to `element_id_id`). Use `client.request('POST'|'PATCH', '/pin/...')` directly with the wire-shape body.
9. **CSS class + data-active for visibility** — never inline `display: none` toggled by JS. Use opacity transition on a class. Debug-hostile otherwise.
10. **Pane scroll preservation** — module-level `Map<contentId, scrollTop>`; capture before re-render via data attribute; restore via queueMicrotask.

**New for folder-first**:

11. **FolderStore stamps `local_updated_at` on every write**. Callers never set this field. SyncEngine stamps `server_updated_at` on successful sync; FolderStore preserves it on round-trip.
12. **Tombstones append before file unlink**. If the process dies mid-delete, the tombstone is durable; next sync still pushes the delete.
13. **One writer at a time per folder**. Lock file (`.atlas/lock`) guards against multi-tab races. Format: `{ tab_id, started_at, last_heartbeat }`. The active tab refreshes `last_heartbeat` every 30s. A peer tab that finds a lock with `last_heartbeat` older than 90s treats it as stale and takes it (warning shown). Second writer with a fresh lock gets read-only mode with a warning.
14. **Element files are the schema**. The `type` field on disk is authoritative. SDK responses get `type` stamped at the adapter boundary (server doesn't echo it on per-type endpoints).
15. **One engine, attached at world activation**. `attachSyncEngine` is a module-level singleton — at most one `SyncEngine` exists at a time. Switching worlds detaches the previous engine (`stop()` cancels pending debounced push, slice resets). Avoids cross-world push contamination.
16. **Modal chrome lives in `BaseModal.buildModalShell`**. All modals (`create-world`, `element-create`, `element-picker`, `map-create`, `link-world`, `make-online`) share the same overlay+panel+title+body via `buildModalShell({title?, panelClass?, dataModal?})`. Title is optional (picker skips it for a custom title-row). Future modals MUST use this helper — never build overlay/panel from scratch.
17. **Folder writes from the UI call `requestPushIfLinked()`**. After any successful `FolderStore.update/create/delete` from a UI handler, call `requestPushIfLinked()` so the autosave debounce fires. No-op for local-only worlds. Without this, edits to api-linked worlds wouldn't sync until the user manually triggered a push.
18. **Element-detail scroll position is preserved across re-renders** via a module-level `Map<elementId, scrollTop>`. Captured before `target.innerHTML = ''`, restored via `queueMicrotask` after layout, live-tracked via passive scroll listener. Reset on world switch via `resetElementDetailScrollMemory()`. Without this, field edits/link toggles dump the user back to the top of the panel.

19. **Pin writes require `element_type`** (server rule, surfaced by Bout V.5 smoke). Every code path that creates a pin MUST populate `element_type` from the referenced element. UI: map-tab placement looks it up from `state.data.elements`; the contextual-create flow receives `(id, type)` from `ElementCreateModal.onCreated`. Engine: `pushPhase` self-heals legacy pins missing this field by looking up the referenced element's type and writing back. Fakes (MSW + FakeOwApiClient) enforce the rule — any new code path forgetting it fails its tests immediately.

20. **Encode real-server validation rules in fakes BEFORE fixing the caller**. When live OW returns a 4xx with a clear message that fakes didn't catch (Bout V.5's pin element_type rule was the canonical example), first add the rule to `statefulOwHandlers` AND `FakeOwApiClient`, then fix the caller. The fix lands with a regression test that locks the rule in, and future test code violating the rule fails immediately. This is how fakes get more faithful over time without contract-testing infrastructure.

21. **Clear fields with `null` (relations / numbers) or `''` (text), never `undefined`.** `JSON.stringify` drops `undefined` keys at disk-write AND at wire serialization, so a PATCH body built around `undefined` omits the field — and real PATCH semantics treat a missing key as "no change to this field." The server then silently keeps the old value despite the user clicking × on a chip or blanking a popover. Verified by `tests/integration/sync-engine.fieldClear.test.ts`: the "trap" tests document what undefined does, the "contract" tests prove null/'' propagate. The fakes (`FakeOwApiClient`) also strip undefined to mirror JSON-wire behavior — same fakes-mirror-real discipline as #20. UI write sites that mean "clear" must pass the right sentinel: see `element-detail.ts` single-link `×` and `field-edit-popover.ts` empty-input handling.

22. **Auth failure bails the round + transitions to `error` state.** When push or pull encounters 401/403 (PIN changed, api_key revoked, world deleted server-side — all surface the same way), the engine MUST: (a) stop iterating immediately, since every subsequent op would fail the same way against the dead key; (b) set `paused = true` so the autosave debounce no longer fires against the dead endpoint; (c) transition state to `{kind: 'error', message: 'authentication failed...', recoverable: true}` so the pill goes red. The `SyncResult.auth_blocked` flag tells `sync-attach` to emit a dedicated toast instead of the generic "couldn't sync N change(s)" message. Recovery is a fresh engine — changing PIN in settings calls `attachSyncEngine` which constructs a new `SyncEngine` instance (the error state doesn't bleed across instances). Without this convention, an auth-failed push round still set state to `idle`, the pill went "saving → synced," and the user thought everything was fine while changes silently failed (the "lying pill" class). Verified by `tests/integration/sync-engine.authBlocked.test.ts`.

23. **CREATEs push in FK dependency order.** `pushPhase` topologically sorts the never-synced batch before iterating: an element whose FK fields reference another element in the same batch goes AFTER its dependencies. Without this, Make-Online-Route-1 (or any first push of a chained local world) produces real-OW `400 Invalid FK: <field> — referenced X with id 'Y' does not exist` when the dependent fires first. The chain self-heals via the next round's `rewriteIdReferences`, but the console noise is alarming and convergence takes the autosave window (~5s) to settle. Topo-sort (Kahn's algorithm, scanning every string + string-array field for matches against other batch members — schema-agnostic) eliminates the class. Genuine cycles (A references B AND B references A) fall back to input order and self-heal as before; that's a rare data shape and the safety remains intact. Verified by `tests/integration/sync-engine.createOrder.test.ts`.

24. **Unlink severs the sync history — `FolderStore.resetSyncBaseline()` is non-optional.** When the user unlinks from an api world, the folder is conceptually no longer associated with that api world. Every shred of sync metadata must be invalidated: every element's `server_updated_at`, every pending tombstone, the `sync-state.json` last_*_at + conflicts + server_deletes, and `world.json.api`. Without this, lingering baselines from the deleted api world make a subsequent Make-Online Route 1 treat every element as an UPDATE against the new world — pre-update GETs 404 → all routed to server_deletes → the new world appears online but empty. The settings unlink handler calls `resetSyncBaseline()` AFTER `detachSyncEngine()` (so no in-flight round mutates files mid-reset) and BEFORE the registry write (so the world flips to local-only with a clean folder). Verified by `tests/integration/folder-store.resetSyncBaseline.test.ts`. Note: `Forget World` is DIFFERENT — it removes the registry entry but doesn't touch the folder; reopening that folder later re-imports with its existing sync history intact.

25. **Flush-on-attach runs BEFORE pull-on-activate.** Both paths fire from `attachSyncEngine` and both grab the engine's shared `inFlight` lock — without explicit sequencing they race, and the loser silently returns the winner's promise (in practice the pull always won, so flush's `pushOnce()` returned the pull's no-push result, no "synced N pending change(s)" toast fired, and stranded edits never reached the server until the next user write re-armed the autosave debounce). The async IIFE in `attachSyncEngine` awaits flush first, then pull. Order rationale: pending writes encode older user intent (typed in a prior session, lost the debounce to a reload) and should land server-side before pull-on-activate looks for newer remote changes. Flush is unconditional when pending exist; pull-on-activate is opt-in. Verified by `tests/integration/sync-attach.flushBeforePull.test.ts`.

26. **Engine preserves `last_sync_at` across pause/resume.** `pause()` transitions to a `paused` state that doesn't carry the timestamp; without preservation, `resume()` would emit `{kind:'idle', last_sync_at: null}` and the pill's "synced X min ago" tooltip would briefly read "never synced" between resume and the post-resume push completing. The engine keeps a private `lastSyncAt` field updated by `setState` on every idle transition with a non-null timestamp; `resume()` reads it back so the brief idle window post-resume carries the prior value. A successful sync afterwards stamps a fresher value normally. Verified by `tests/integration/sync-engine.resumePreservesLastSyncAt.test.ts`.

27. **Sidebar mode toggle label reads URL + registry, NOT `state.active`.** The right-tab label is the active world's name. `state.active` only fills in AFTER the slow FS work in `activateWorld` (handle resolve, permission re-grant, `store.open`, `listElements`); during that window the registry entry exists but `state.active` is still null or stale. Reading `state.active.meta.name` in the toggle would lag the UI ~500ms behind the click. Reading `registry.worlds.find(w => w.id === route.worldId).name` flips the label synchronously in the same frame as the click — the "instant-feel world switch" depends on it. The same principle applies to any UI whose visible identity should match the URL: source from registry+URL, not from store state that catches up async. `activateWorld` clears `data.elements` + `selectedElementId` and navigates synchronously BEFORE the FS work for the same reason; failure paths revert URL to the priorHash.

    **Note (session 223 decoupling)**: the *active state* of the sidebar mode buttons reads from `state.ui.sidebarMode` (not URL). The toggle's *label* still comes from URL+registry. Two independent reads — that's intentional.

31. **Middle pane is a flex column with room nav strip + content.** `app-shell.middle` is split into `shell.middleRoomNav` (~32px, top, fixed) and `shell.middleContent` (flex 1, bottom). Room nav strip mounts to `middleRoomNav`; every room component (welcome, home, element-detail, writing, timeline, search, publish, import, templates, settings) mounts to `middleContent`. The room nav strip is hidden (display:none via data-active="false") when no world is active — welcome owns the full middle pane during first launch. **Renderers must NEVER touch `shell.middle` directly** (would break the column flex) — always target `shell.middleContent`. This extends convention #3 (shell pane non-mutation) to the new sub-structure.

32. **Esc clears element selection + navigates to home.** When an element is selected (`state.ui.selectedElementId` is set) and no modal/popover/inline-editor is open, pressing Esc clears the selection and navigates to `homeHash(worldId)`. This makes "exit element detail back to my world overview" a one-key operation and matches the room model's "element is a room you enter, home is the room you exit to." The Esc handler must check `!hasOpenModal()` AND no non-modal overlay (field-edit popover, visual settings popover, shortcuts popover) is active so it doesn't steal Esc from those handlers. **Click-row-toggle was considered + dropped (session 223 e2e fallout)** — re-clicking the selected row toggling off conflicts with common UX/test patterns where re-clicking a row is meant to refocus. Esc is the canonical deselect.

33. **Writing tier labels live in `registry.worlds[i].writing_labels` (l1-l4)** and ARE the `supertype` storage value on each Narrative. Defaults `{l1: 'Book', l2: 'Chapter', l3: 'Scene', l4: 'Draft'}`. UI reads via `getWritingLabels(worldId)`. **No canonical/display split** — storage matches display 1:1. Renaming a label triggers `applyLabelRenameMigration` which rewrites every existing narrative's supertype so data + UI stay consistent. Convention #38 covers the membership filter; convention #39 covers the migration trigger.

34. **Atlas writing has three structured tiers (l1/l2/l3) + one flexible (l4=Draft).** l1 forbids parent; l2 requires l1 parent; l3 requires l2 parent; l4 has no parent constraints (drafts can root, sit under any tier, or nest other drafts). The writing-room create flow enforces these; element-detail field edits don't (user can override at their discretion). External narratives nested below depth 3 are PROMOTED to Draft tier (`l4`) during initial setup.

35. **SUPERSEDED (session 234).** Was: showcase_config `atlas_*` extensions — built on the dead write-tool-prototype publishing model. Sharing is redesigned in `DESIGN_SHARING.md` (pages + blocks + theme tokens; backend contract with Anchor pending). Number retained so cross-references stay stable.

36. **SUPERSEDED (session 234).** Was: "showcases are immutable, republish creates new." The current snapshot-vs-live model (Pages = frozen snapshot, World Showcase = live, republish semantics) lives in `DESIGN_SHARING.md`.

37. **Sidebar mode and room are independent dimensions** (session 223 decoupling). `state.ui.sidebarMode` is pure UI state, persisted to localStorage via `core/ui-prefs.ts`. Toggle clicks update state directly — no URL navigation. Room navigation (top-of-middle nav strip + room URLs) is orthogonal. Previously the URL's "elements" route forced sidebar to elements mode via `syncModeFromRoute`; that auto-coupling was removed because it caused inconsistent behavior across room transitions ("some top tabs open the worlds part, others open elements"). The two dimensions now move independently — user picks sidebar mode via the toggle, picks room via the top strip. `activateWorld` navigates to `worldHash(id)` (home), not `elementsHash(id)`, so sidebar mode is not perturbed on world switch. The `/elements` route still exists for backward compat (rare bookmarks, test code) — it resolves to middle=home with the Home icon highlighted in room nav.

38. **A Narrative belongs to the writing tree iff `supertype` matches one of `registry.worlds[i].writing_labels` (l1-l4)** for the world. Detection via `isWritingNarrative(el, worldId)`; tier classification via `getTierForNarrative(el, worldId)` (returns `'l1'`/`'l2'`/`'l3'`/`'l4'`/`null`). Setting supertype to anything outside the four labels removes the narrative from the writing tree (still visible in elements list / search / timeline). Setting supertype to one of the four labels via element-detail effectively PROMOTES that narrative into the tree.

39. **Label renames trigger immediate supertype migration on existing narratives.** When the user changes any of l1-l4 in Settings → Writing or the writing setup screen, `applyLabelRenameMigration(folder, elements, oldLabels, newLabels)` walks every narrative and rewrites supertype values that match an old label to the new value. Keeps storage and display 1:1 — no canonical/display split. Settings → Writing wires the migration into the per-input change event; the setup screen wires it into the Save handler. Both surface a toast with the migrated count.

40. **Writing-room sidebar takeover** (session 224). When the route is `writing` and `state.ui.sidebarWritingOverride === false`, the sidebar body shows the writing tree (`mountWritingBody` in `src/sidebar/writing-sidebar.ts`) instead of worlds/elements. Clicking the worlds/world-name toggle while in writing sets `sidebarWritingOverride: true` — that escape sticks until the route leaves+re-enters writing OR the user clicks the writing icon in the room nav (which clears it). The two-band sidebar header mirrors the elements-sidebar layout EXACTLY (filter-strip slot becomes create row, search-row slot reused with tune in the `+` position). Middle pane in writing mode is single-column — just element-detail. Bands and tree are appended directly to `.atlas-sidebar-content` (no wrapping flex div) so the shell-level scrollbar gutter aligns between writing and elements sidebars.

41. **`.atlas-middle-header` is locked at 36px.** Every height channel — `height`, `min-height`, `max-height`, `flex: 0 0 36px` — set with `!important`. Plus `overflow: hidden; flex-wrap: nowrap`. Plus defensive `.atlas-middle-header > * { max-height: 100%; flex-shrink: 0 }` so no descendant can grow the band. Tier badge + child-create buttons for writing-tree narratives live inside this header (no separate toolbar slot above element-detail). One stable band across all elements and rooms. (Iterated 64 → 48 → 46 → 36 across session 224's polish day; 36 is final.)

42. **Optimistic close on `openFieldEditPopover` saves.** The overlay calls `cleanup()` BEFORE awaiting `opts.onSave`, then catches any rejection and surfaces it via toast. UI stays interactive during persistence (sidebar clicks, chevrons, navigation all responsive). Pattern: saves whose failure is rare and survivable should not block the UI. Convention #42 is the popover-level expression; same principle drives the "save registry first, then promote" ordering in `writing-setup.ts`.

43. **Narrative deletes cascade through `parent_narrative` chains.** `FolderStore.findDependents` for `target.type === 'narrative'` BFS-walks the chain and collects: every descendant narrative + every pin referencing the target or any descendant. `deleteElement` tombstones all in dependency-safe order. Without this, deleting a book would orphan its chapters with a dangling FK and resurface them as loose roots in the writing tree. Cascade-by-default is the safer UX; the count appears in the confirm dialog. Implemented in both `folder-store-fs.ts` and `mock-folder-store.ts` (test fixture parity).

44. **Last-edited narrative is restored from the writing icon.** `WorldRegistryEntry.last_writing_narrative_id?: string` is written every time the writing room's active narrative changes (deferred via `queueMicrotask` to avoid render thrash). Clicking the writing icon in the room nav reads this and navigates via `writingHashForNarrative(worldId, id, elements)` — the helper walks `parent_narrative` to build the full `/writing/book/<b>/chapter/<c>/scene/<s>` URL. Falls back to bare writing path when no memory or the narrative no longer exists. Combined with element-detail's module-level scroll memory (keyed by element id), returning to writing restores both selection and scroll position.

45. **Selected-element chip on the room-nav strip** (session 226). The right edge of `.atlas-room-nav-strip` carries a persistent `.atlas-room-nav-selected` chip whenever `state.ui.selectedElementId` is set. Shape: `[icon] [truncated name] [×]`. Click body → `navigate(elementHash(worldId, selectedId))`. Click × → clear `selectedElementId`. The chip styling mirrors `.atlas-room-nav-btn` (transparent default chrome; cyan-tint pill when active) — `.active` is added iff `route.mode === 'element'`, so the chip lights up only when its own destination is the current room. Gives the always-something-highlighted invariant: when the user views an element, the chip is the highlighted room indicator (element isn't a room button itself). Name truncates at 22 chars. Icon + × scoped under `.atlas-room-nav-selected` for two-class specificity to outrank `.material-symbols-outlined` from the `material-symbols` package.

46. **Writing room derives target element from URL, NOT from `state.ui.selectedElementId`.** `element-detail.ts:getSelectedElement` branches: when `route.mode === 'writing'`, it returns `route.sceneId ?? route.chapterId ?? route.bookId` (each is a narrative id by URL contract). Otherwise it falls back to `route.elementId ?? state.ui.selectedElementId`. Writing room's `mountEditor` MUST NOT patch `state.ui.selectedElementId` on narrative navigation — that would clobber the user's persisted global selection. The URL is the single source of truth for writing-room navigation; `state.ui.selectedElementId` is the global selection that persists across rooms (and feeds the convention #45 chip). Writing tree highlighting in the sidebar also reads URL, not `selectedElementId`. Without this decoupling, opening writing erases whatever element you had selected — the chip would mirror the active narrative instead of preserving the prior context. Implemented session 226 alongside convention #45 chip; previously writing.ts mirrored the URL into `selectedElementId` for element-detail's benefit, which leaked the writing selection across rooms.

Related: convention #32 (Esc clears selection + nav home) is **gated to NOT fire when route is `writing`, `knowledge`, OR `share`** — those rooms own their keyboards (editing surfaces + URL-owned navigation); pulling the user out AND clearing their persisted global selection on one Esc keystroke surprised more than it helped. `hotkeys.ts:'deselect-to-home'` skips when the hash includes `/writing`, `/knowledge`, or `/share` (knowledge added session 235; share added session 237).

47-57. **Writing conventions** — codified in `DESIGN_WRITING.md` (richtext storage, ow:// link scheme, atlas_aliases, UNION-on-save, workspace replacement gate, material-symbols scoping, autolink rules, sticky bar, ambient word count, add-to-cast unification, compiled view). See that doc for details. Numbering reserved for cross-doc consistency.

58. **Context tab is permanent + route-driven** (session 231). The right-pane Context tab lives at index 0 of `state.ui.rightTabs` for every world, alongside Maps and per-map tabs. Its content is derived from the URL: writing route → narrative subject + Cast/Potentials lists; element route → element subject + preview card; any other route → empty state with helpful copy. The pane's content reacts to hash changes via `onHashChange`; in-pane click-to-recenter and graph-node selection stay pane-local (no URL change). Subject is NEVER stored on the RightTabRef — the tab is a stable shell, the URL is the focus source of truth. `context-tab-lifecycle.ts` enforces the at-index-0 invariant defensively.

59. **Context pane prefs flow one direction**: registry → orchestrator → graph → toolbar (session 231). Toolbar callbacks ONLY persist via `patchWorldEntry`; never call graph methods directly. The orchestrator's `syncPrefsToGraph` watches state, diffs against last-applied prefs, and propagates changes to the graph + toolbar. Settings page edits land via the same path — same registry write, same propagation. Single source of truth (registry), single propagation channel, no duplicate-update races. Toolbar `onToggleType` / `onSetHop` / `onToggleLockLayout` callbacks fire `patchWorldEntry({...})` only — the subscriber takes it from there.

60. **Diff-aware setter calls + ordering matter for graphs with sims** (session 231). When a setter has side effects beyond state mutation — `setHiddenTypes` calls `renderForCenter` which runs the physics sim — spurious "no-op" calls aren't no-ops. They wobble node positions by re-running the sim, breaking the lock-layout "no jumping" guarantee. `syncPrefsToGraph` compares each pref against `lastAppliedPrefs` and only calls the setter when the field actually changed. Setters with prerequisite flags (e.g. `setLockLayout` toggles the flag that subsequent `setHiddenTypes` reads to decide sim-vs-paint) MUST be called first in the propagation order.

61. **Window-level capture phase for browser-default mouse buttons** (session 231). Mouse buttons 3 (back) and 4 (forward) trigger browser history navigation. To suppress: listen on `mousedown` AND `mouseup` AND `auxclick` at window level in capture phase (`{ capture: true }` or `addEventListener(t, fn, true)`). Bubble-phase listeners on a child element may run AFTER Chrome's gesture handler initiates `history.back()`. preventDefault on all three to maximize browser coverage. Scope the suppression with `host.contains(e.target)` — when cursor is outside the relevant pane, browser nav works normally. Trigger the in-pane action only on `mousedown` (avoid triple-firing).

62. **Per-ring caps keep multi-hop graphs readable** (session 231). The context-pane graph supports hop depth 1-4. Ring 1 (direct cast) is uncapped; outer rings are score-and-capped: ring 2 = 12 (chapter 6 / book 4 under tier density), ring 3 = 8, ring 4 = 6. Each ring's candidates are scored by edges back to the PREVIOUS ring (mirrors the cast → adjacent scoring at ring 2). Without per-ring caps, hop=4 in a dense world produces 100+ nodes — unreadable in a small pane. Implementation in `context-pane-graph.ts:renderForCenter` ring-walk loop.

63. **CSS-JS coupling needs a code-level reminder** (session 231). When CSS sets a variant size for a special node (e.g. `.atlas-context-graph-node.is-center { width: 44px }` overriding the default `36px`), the JS positioning code MUST use the matching diameter when computing the top-left offset for that node. Otherwise the variant sits off-center relative to other geometry (the center node sat 4px down-right of the edge crossings until fixed). Pattern: declare paired constants in the JS (`NODE_DIAMETER` + `CENTER_NODE_DIAMETER`) with a comment "MUST match CSS .is-center width/height"; provide a tiny `diameterFor(node)` helper used at every position-set site. Same principle: any time CSS and JS share a magic number, the JS side gets a constant with a comment pointing at the CSS rule.

64. **Settings tabs are scope-grouped; `editor_settings` is the element-editor pref home** (session 232). `SETTINGS_TAB_GROUPS` (`router.ts`) splits the settings rail into ATLAS-wide (`account`, `storage`, `editing`) and per-world (`world`, `writing`, `context`) groups, each rendered with an icon + label header; per-world tabs disable when no world is active. `storage` merges the old atlas-folder + sync tabs (two sections within one tab); `editing` is the home for element-editor/detail display prefs stored in `registry.editor_settings` (`field_edit_mode`, `refs_group_by_field`, `confirm_before_delete`). When renaming or merging settings route keys, add old→new in `parseSettingsTab`'s `LEGACY_SETTINGS_TABS` so existing deep-links + the stored last-tab still resolve.

65. **Settings tabs are per-tab `render*`/`wire*` module pairs; `settings-panel.ts` is a thin orchestrator** (session 233). Each tab lives in `src/middle/settings-<tab>.ts` (`settings-account`, `-storage`, `-editing`, `-world`, `-writing`, `-context`), exporting a `renderXTab(...) → string` and `wireXTab(...)`. `settings-panel.ts` owns only the shell: nav rail, last-tab restore, and dispatch via `renderTab`/`wireTabHandlers` switches. Public surface (`mountSettingsPanel`) is unchanged, so `app.ts` doesn't care. Flat `settings-*.ts` files (not a subfolder) match the established split convention (`writing-workspace-*.ts`, `map-tab-*.ts`) and keep import depth identical. Add a new tab = new module + two switch arms + a `SETTINGS_TABS`/`SETTINGS_TAB_GROUPS` entry. Per-world settings handlers use `updateWorldEntry(reg, worldId, patch)` (registry.ts) for one-off field merges rather than hand-rolling `findIndex` + `worlds.map`.

66. **`defaultCreateType` is a `ui-prefs` pref, not URL/registry state** (session 233). The element-create modal preselects `loadUiPrefs().defaultCreateType` when opened without an explicit `initialType` (sidebar +, home, hotkey, writing inline-create, map contextual). It's an app-level persistent pref (localStorage via `core/ui-prefs.ts`), set from Settings → Editing. The DESIGN sketch once placed it on `UiState`; ui-prefs is the correct home (same migration as `sidebarMode` in session 223 — app-level + persistent, neither navigational nor world-specific). The modal re-validates the preselected type against the effective (post-`excludeTypes`) set in `buildModal`, so an excluded default (e.g. 'map' in the map contextual flow) can't stick — it falls back to the first offered type. `ui-prefs` setters must load-merge-save (`{ ...loadUiPrefs(), <field>: v }`) so adding a field doesn't clobber siblings.

67-72. **Knowledge conventions** — codified in `DESIGN_KNOWLEDGE.md` (knowledge entry = Narrative subtype, about vs held-by field split + the mention-derive `collectives` exclusion, knowing is computed, the text is the knowledge, fidelity = separate entries, Circle = a Collective acting as knower). Numbering reserved for cross-doc consistency, same as 47-57.

73-78. **Sharing conventions** — codified in `DESIGN_SHARING.md` (page = Narrative subtype 'page' + the narrative-kind seam, blocks are truth / story is a derived mirror, the refs mirror for id-swap-safe card bindings, page prose never derives relations, per-room serialized page writes, `share-page-render.ts` stays store-free). Numbering reserved for cross-doc consistency.

79. **Element writes serialize per-id at the FolderStore boundary** (session 238). `updateElement` and `deleteElement` queue through a `PerIdWriteChain` (`src/store/write-chain.ts`) in BOTH stores (FsFolderStore + MockFolderStore, fixture parity): same-id operations run strictly in submission order; different ids stay concurrent. Kills the lost-update class — two read-merge-writes interleave, the second call's read predates the first call's write, and the merge silently reverts its fields (found live by the share e2e, session 237; knowledge-room's `patchEntry` was still exposed) — for EVERY caller instead of per-room defenses. A delete queued behind an update waits for it, so late writes never throw "element not found". **What the chain can't fix**: a patch COMPUTED from a stale in-memory snapshot (e.g. a whole blocks array built before a prior write refreshed state) — callers doing read-compute-write over arrays still need await discipline (share-room's chain, convention #77, stays for exactly this). The mock's updateElement carries a deliberate microtask yield between read and merge so an unserialized regression manifests in vitest (convention #20: fakes encode real failure modes). Verified by `tests/unit/write-chain.test.ts`, `tests/integration/folder-store.serializedWrites.test.ts`, and a real-FS concurrent-update e2e in `folder-store-fs.spec.ts`.

*(#80 = the two-tier room-header model, documented in the Rooms section. #81-85 = import conventions, in `DESIGN_IMPORT.md`.)*

86. **Sync-state mutations go through `updateSyncState(mutate)`** (2026-07-03). Every patch COMPUTED FROM the current sync-state (conflict/server-delete list edits, dedupe-appends) uses `FolderStore.updateSyncState(mutate)` — the mutator receives the CURRENT state inside a store-global chain and returns a partial patch. Never split into `readSyncState()` + `writeSyncState()`: the audit found resolveConflict/pushPhase/pullPhase computing whole-array patches from snapshots taken BEFORE network I/O, so a concurrent round's entries got silently clobbered. `writeSyncState(patch)` remains for whole-field replacement and rides the same chain. All five engine read-modify-write sites migrated; regression suite `tests/integration/folder-store.syncStateChain.test.ts`.

87. **Filenames: sticky runtime writes, converging open-time tidy, lowercase equivalence** (2026-07-03, gate-hardened). The full contract is the "File naming" table in On-Disk Layout (the Folder Format spec source). The load-bearing halves: (a) a RUNTIME write keeps the file's current name whenever it's any valid form for the element's name, compared via `sameFsName` (lowercase) — case-folding filesystems (NTFS/APFS) make a case-variant pair the SAME physical entry, so write-new + delete-old self-destructs; OPFS-based tests cannot see this. (b) The open-time tidy is the ONLY converger: id-sorted (deterministic layouts), FULL occupancy view computed before any write (an incremental view lets an early id overwrite a later sibling's live file — 3-lens-convergent gate finding), never touches unreadable files. Index is built from file BODIES; `parseIdFromFilename` is diagnostics, never identity.

---

## Context Pane (session 231 tool-global rewrite)

The right-pane Context tab is a tool-global surface — graph + details, route-driven content. Replaces the writing-only ephemeral context tab introduced in session 229.

### Tab structure

| Index | Kind | Behavior |
|---|---|---|
| 0 | `context` (permanent) | Always present per world; never closed; toggled active by user |
| 1 | `map-index` (permanent) | Maps overview |
| 2..N | `map` (per opened map) | Each open map is its own closable tab |

`context-tab-lifecycle.ts` ensures the invariant on boot + defensively on every state tick.

### Content per route

| Route | Subject | Details slot |
|---|---|---|
| `/writing/<narrativeId>` | the narrative | `context-pane-lists`: Cast + Potentials |
| `/element/<elementId>` | the element | `context-pane-preview`: subject preview card (swaps to whichever node user clicks in graph) |
| Anything else (home / timeline / settings / map / search) | none | Empty state with route-specific copy |

The orchestrator's `resolveSubject(route, elements)` derives `{element, detailsMode}` from the URL. Subject-changes via URL trigger a full re-render (new graph mount); in-pane clicks (recenter, select) stay pane-local.

### Graph capabilities

- **Subject-centered force-directed layout** (synchronous sim → stable positions; ~290 LOC, no library)
- **Neighbors = ALL outgoing links** — the Involves multi-links AND single-link fields (narrator, birthplace, protagonist, …) via a generic id-shaped scan, double-gated by element lookup; `parent_narrative` deliberately excluded (tree hierarchy ≠ graph material). Session 235 — single links were previously invisible.
- **Click-to-recenter**: clicking a non-subject node re-runs sim with that node as center; pushes to breadcrumb stack
- **Ctrl/Cmd+click**: navigates URL to that element → context pane re-renders with new subject
- **Recent-centers breadcrumb** at top of graph: `[Home] › [Recent] › current` (clickable chips pop the stack)
- **Mouse-back button** (over pane): pops breadcrumb; falls through to browser history when outside pane
- **Free zoom + pan**: wheel zooms anchored at cursor, drag pans, double-click resets, fit-to-view button appears when transform is non-identity
- **Hover-fade non-connected nodes**, **right-click node menu** (Open as element / Copy ID / Add to story in writing mode)
- **Hop depth 1-4** with per-ring caps (Convention #62); tier-derived default (scene/draft = 2, chapter/book = 1)
- **Type filter chips** at top of pane; persist per-world; chips persist even when their type is hidden
- **Lock-layout mode**: when on, filter toggles hide via CSS without re-running sim (surviving nodes stay put)
- **Edge type coloring** (opt-in): edges take the non-center node's element-type color at 0.45 alpha

### Per-world registry fields

- `context_filters_off?: ElementType[]`
- `context_hop_depth?: 1 | 2 | 3 | 4` (absent = tier-derived)
- `context_lock_layout?: boolean`
- `context_edge_color?: boolean`

Element-type palette (`ELEMENT_TYPE_COLORS` in `core/constants.ts`) shared with future cross-tool surfaces; sourced from the dcc-viewer / element-viewer-trial palette.

### Module layout

```
src/tabs/right/
├── context-tab.ts              # Orchestrator (route → subject, unified onSelect, syncPrefsToGraph)
├── context-tab-lifecycle.ts    # Permanent-tab invariant
├── context-pane-graph.ts       # Force-sim graph + breadcrumb + zoom/pan + right-click menu
├── context-pane-toolbar.ts     # Type chips + lock + hop pill
├── context-pane-lists.ts       # Writing-mode Cast + Potentials
└── context-pane-preview.ts     # Element preview card (writing OR element mode)
```

---

## Test Strategy

**Run cadence** (Captain's call, session 235 — err sparse): per-edit = typecheck; per-bout = typecheck + full vitest (~3s) + only the AFFECTED e2e spec file(s); full Playwright suite ONCE at session close / pre-commit. The cost table + speedup experiments live in the `atlas-tool` skill ("Test Cadence").

Four layers:

### Unit (Vitest)
Pure logic: diff computation, conflict detection, tombstone application, URL parsing, field schema resolution, sanitization. Fast, deterministic. Run on save in watch mode.

### Integration (Vitest + MSW + mock FolderStore)
End-to-end loops with mocked filesystem and mocked OW API. Test the SyncEngine's push/pull/diff/policy/pause behavior against MSW handlers and an in-memory FolderStore.

Key targets:
- Empty folder + empty server → no-op sync
- Local-only changes → push only
- Server-only changes → pull only
- Both-sides changes (no overlap) → push + pull
- Conflict (same element, both sides changed) → policy-dependent behavior
- Tombstone push → server DELETE → tombstone cleared
- Temp-disconnect mid-push → re-attempt on resume
- Initial download for link-existing → full hydration

### E2E (Playwright)
Real browser, real File System Access API, real dev server, MSW intercepting API calls. Each critical user flow as a spec:

- W1 create local
- W2 link existing api
- W3 make online route 1
- W4 make online route 2 (per policy)
- W5 edit online
- W6 edit offline (paused)
- W7 resume sync
- W8 conflict surfacing
- W9 delete cascade
- W11 reopen world (handle re-permission flow)

### Smoke (manual against real OW)
Dedicated test world (Captain provided: `5474990854`). Periodic manual runs to verify:
- create-world-external endpoint
- create / update / delete round-trip
- UUID preservation
- Real conflict on concurrent edit (open web app + atlas, edit same element)
- Real network failure recovery

Smoke results recorded in a `tests/smoke-log.md` (date, what we ran, what we observed).

---

## File Layout

The **live file map** (accurate per-module tree) lives in the `atlas-tool` skill's "Critical Code Locations" — it's the load-on-start reference and is kept current. High-level directory roles:

```
src/
├── core/          # types, observable state, router, constants, ui-prefs, hotkeys, map-view/camera prefs, dom-utils, active-store
├── store/         # FolderStore interface + FsFolderStore, fs-utils, handle-vault, idb (handle-vault only)
├── sync/          # sync-engine, sync-attach (singleton), ow-client-adapter, make-online, auto-pull-scheduler
├── registry/      # localStorage registry + per-world helpers
├── layout/        # 3-pane app-shell
├── sidebar/       # sidebar driver + worlds / elements / writing bodies
├── middle/        # rooms: element-detail(+header/fields/refs), world-home, writing-workspace(+modules), knowledge-room(+editor), share-room(+editor/+page-render), timeline, search, settings-panel(+per-tab modules)
├── tabs/right/    # map-index, map-tab(+concern modules), context-tab(+graph/toolbar/lists/preview), zone-drawing/edit, ghost-pins
├── visualization/ # leaflet-2d (Leaflet2DManager, ZoneOverlay, ZoneGeometry) + timeline-bar
├── editor/        # field-schema (SDK adapter) + field-descriptions
├── ui/            # modals (create/picker/map-create/make-online/link/conflict/server-delete/zone-create), popovers, toast-manager, modal-base
├── setup/         # atlas-root-flow
├── styles/        # atlas.css (conventions #1-30 codified)
├── app.ts         # orchestration   main.ts  # boot + Chromium gate
tests/             # unit (vitest) · integration (vitest+MSW+mock store) · e2e (Playwright)
```

Root: `DESIGN.md` (+ per-room `DESIGN_*.md`), `PROGRESS.md` (operational log), `SYNC_NOTES.md` (sync lessons), `PORTED.md` (port log), `README.md`, build config (`vite`/`vitest`/`playwright`/`tsconfig`), `index.html`.

---

## Build History

All phases (0 → 6 + 3.5) shipped by session 221; rooms model + writing system (223-228); context pane (229-231); maintenance splits (232-233); Knowledge phase 1 (234-236); Sharing S1-S7 + contract + LIVE backend + show viewer deployed (237-239); UI consistency + quick wins (240); **import & export** (241); **Charts** (timeline reframe, charts #1-#2, save/gallery/share-block, all gated; 242-245); **release-prep correctness** (filename contract conv #87, sync-state serialization conv #86, pin disclosure B6, edited-dot B1 — all gated; 246); **release design pass** (UI workplan D1-D12 all decided; 247, 2026-07-05→07). Cutover happened — atlas lives at `github.com/OnlyWorlds/atlas` (repo private for launch; D12); `tools/atlas-deprecated/` is retained as UI/UX reference only. See `docs-archive/PROGRESS-history.md` for session-by-session detail. Sync soft-edges live in `SYNC_NOTES.md`.

### Release-prep decision layer (2026-07, pointers)

The v1 launch shape was settled in two passes and lives OUTSIDE this doc (this doc stays architecture):
- **`Forge/Notes/2026-07-03-atlas-release-plan.md`** — the Comms-session decision record (strategy, A/B/C batches, Captain's lane).
- **`Forge/Notes/2026-07-05-atlas-ui-workplan.md`** — the full UI/UX design pass: D1 unification (Capitalized underline room-tabs + `‹ Room` drill-in prefix bands) · D2 home cover-page×study-desk hybrid (+ D2b protagonist/home favorites) · D3 context-pane rule ("graph of the focused thing + per-room details") · D4 knowledge WHO/WHAT/ABOUT · **D5 intent picker REMOVED for v1** (`atlas_page_intent` stays in the model, hidden) · D6 take-out list · D8 help layers + per-room `?` overlay · D9 custom fields = post-launch (D9b supertype/subtype program is v1) · D10 bundled sample world · D11 Settings→"OnlyWorlds" page + waypoints · D12 dev story (closed source for launch, open everything around it).
- **`BUILD_BRIEF.md`** — the execution pickup for the build sessions.
When these ship, fold the durable outcomes back into this doc's conventions (expect new conventions for: room-tab pattern, drill-in band, waypoint hooks, favorites registry fields).

---

## Tradeoffs Accepted

- **Chromium-only forever**. File System Access API is Chromium. Worth it for local-first integrity. If Firefox/Safari ever ship FS Access, we get them automatically.
- **Permission re-prompt every session**. FS API requires user gesture per session for write access. Mitigations: `navigator.storage.persist()` (some help), "open all" button in worlds list, eventual remember-this-session UX.
- **Initial download for link-existing**. One-time wait when first linking a world. Show progress.
- **Multi-tab same-world risk**. Lock file detects, warns; user accepts at their own risk.
- **Folder location is user's responsibility**. If they move/rename the folder outside Atlas, the handle invalidates. UX: "Re-link folder" recovery action.

---

## Atlas-Specific Fields & Features

Atlas extends OnlyWorlds with capabilities that don't (yet) live in the OW schema. This section catalogs them so we can take stock once the tool is mature — some may warrant council motions to migrate into core schema; others stay atlas-only forever (visual prefs, UI state).

**Strip discipline**: all element-level atlas-only fields are listed in `ATLAS_LOCAL_EXTENSION_FIELDS` (in `core/constants.ts`). The adapter strips them on API push; `applyServerRecord` preserves them when overlaying server responses. Both fakes (FakeOwApiClient + MSW handler) reject them in write bodies to lock in the discipline (convention #20).

### Element-level atlas-only fields (candidates for future schema discussion)

| Field | On element types | Purpose | Council-motion candidate? |
|---|---|---|---|
| `image_media_id` | Any element with `image_url` | Local binding to atlas media folder for non-URL image sources | Maybe — if OW adds local-media support to schema |
| `atlas_color` | Zone | Hex color override for zone fill | Probably not — visual pref |
| `atlas_opacity` | Zone | 0..1 fill opacity | Probably not — visual pref |
| `atlas_label_visible` | Zone | Whether zone label renders on map | Probably not — visual pref |
| `atlas_shape` | Zone | `'polygon' \| 'line'` shape kind | **Yes** — fundamental zone geometry data |
| `atlas_richtext_json` | Narrative | TipTap JSON for the richtext story body | Maybe — if OW adds richtext-on-story support |
| `atlas_aliases` | Any element | `string[]` of name aliases for linking | **Yes** — broadly useful (writers want it; pickers want it; search wants it) |

### Semantic reinterpretations (candidates for first-class schema)

Beyond atlas-only *fields*, atlas also reinterprets canon fields in ways other OW tools can't see. These are tracked here as schema-requirement candidates — same pipeline as `atlas_shape`/`atlas_aliases`, but the motion would add new fields rather than promote an `atlas_*` one:

| Reinterpretation | Where | Motion shape | Status |
|---|---|---|---|
| Narrative `narrator` + `collectives` read as **knowledge holders** when `subtype: "knowledge"` | `DESIGN_KNOWLEDGE.md` (conventions #67-72, "De-hiding path") | First-class `held_by_characters` / `held_by_collectives` on Narrative, then migrate off the reinterpretation | Logged 2026-06-07 (session 236). Draft the council motion once Knowledge proves out in real use. |

### Sharing/page extensions (as built, session 237 — per DESIGN_SHARING.md)

Stored on Narrative elements with `subtype: "page"`; all in `ATLAS_LOCAL_EXTENSION_FIELDS`:

| Field | Purpose | Council-motion candidate? |
|---|---|---|
| `atlas_page_blocks` | The page's block stack (source of truth; heading/prose/element-card/circle) | No — composition is presentation config |
| `atlas_page_refs` | Flat element-id mirror of the element-bearing block bindings (card elementIds + circle knowerIds; id-swap safety via `rewriteIdReferences`; `blocksOf()` heals nested ids) | No — internal mechanics |
| `atlas_page_intent` | show / reference / publish | Probably not — sharing metadata |
| `atlas_page_theme` | Reserved for the S3 theme tokens | Probably not — visual pref |
| `atlas_page_pub` | Published-state mirror `{id, slug, published_at, updated_at, revoked, content_sig}` from the sharing backend (display cache; the API rows are truth; `content_sig` = hash at publish time driving the edited-since-publish dot, B1). Mirrors are per-folder — two atlas instances on copies of one world each keep their own (S2/V1b, 2026-07-05) | No — sharing metadata |

The published artifact is a frozen snapshot in a new Django model — see `SHARING_CONTRACT.md` (drafted session 237, Anchor pending). The canonical `story` field on a page carries a derived plain-markdown compilation of the blocks (synced, readable by other tools, regenerated on every blocks save — never hand-edited).

### World-level / per-world atlas-only state (atlas-only forever)

Stored in atlas's localStorage `WorldRegistryEntry`, not in any element file:

- `writing_labels` (l1-l4 tier label config)
- `writing_initialized` (whether setup flow was completed)
- `writing_tree_collapsed[]` (sidebar tree expand state)
- `last_writing_narrative_id` (room-nav restore target)
- `notes` (per-world freeform notes, accessible via overlay)
- `showcases[]` (per-world published showcase registry)
- `sync_debounce_ms` (autosave delay, per-world preference)
- Various sync state (last_pull_at, last_push_at, pending baselines)

### Per-tool / per-browser atlas-only state

- `atlas_ui_prefs` — sidebarMode etc.
- `atlas_shell_ratios_v2` — three-pane resize ratios
- `atlas_right_tabs` — right-pane open tabs and active index
- `atlas_map_view_defaults`, `atlas_map_view_prefs` — map visual prefs
- `atlas_map_camera_state` — per-map camera (center + zoom)

### Why track this

Atlas is a primary OnlyWorlds tool, and the boundary between "atlas innovates" and "OnlyWorlds standardizes" should be a conscious decision, not an accident. Periodically we should:

1. Review the `ATLAS_LOCAL_EXTENSION_FIELDS` list and ask: which of these would benefit other OW tools if they migrated into the OW schema?
2. Draft council motions for the strong candidates (currently `atlas_shape` and `atlas_aliases`).
3. After motion + amendment, plan a migration: stop stripping the field on push, ensure schema validation passes server-side, migrate existing local data into the canonical field name (drop the `atlas_` prefix if the council chose a different name).

Atlas innovating is healthy. Atlas innovating *and* feeding learnings back to OnlyWorlds is the design intent.

---

## Open Questions

1. **Multi-image API support** — deferred until OW schema supports it (current model has one `image_url`). When schema lands, design a media-grid → primary-image UX. Open implementation candidates (server-delete-on-pull UX, unlink confirmation, conflict log review, etc.) are tracked in `PROGRESS.md`. Per-world conflict policy override was explicitly dropped session 221.

---

## Reference

- **Legacy reference**: `tools/atlas-deprecated/` (UI/UX only; architecture is fully replaced). See its `DEPRECATED.md` for the port list.
- **OW SDK patterns**: `Knowledge/Technical/onlyworlds.md` (handles SDK quirks, relationship fields, schema reference).
- **Create-world endpoint reference**: `Development/OnlyWorlds/obsidian-plugin/Commands/CreateWorldCommand.ts`.
- **Field schema source**: SDK FIELD_SCHEMA + ELEMENT_SECTIONS.
- **Test world for smoke**: `5474990854` (Captain's messworld).

---

**Doc cadence**: this DESIGN.md is the stable architectural reference. Operational state (what's done, what's next, rough edges) lives in `PROGRESS.md` once Phase 1 starts. Port decisions get logged in `PORTED.md`.
