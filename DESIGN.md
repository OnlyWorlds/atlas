# Atlas — Design Document

**Version**: 1.0 (2026-05-12) — folder-first rebuild
**Status**: Foundation in progress. Package skeleton + this doc + SyncEngine contract are the first deliverables.
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

User picks a root folder once per world (persisted via `FileSystemDirectoryHandle` in IndexedDB; the only IDB use case in atlas). Atlas writes:

```
<user-chosen-root>/atlas-worlds/
  <world-name>-<uuid-prefix>/
    world.json                       ← metadata + api credentials (if linked)
    .atlas/                          ← atlas internal state
      sync-state.json                ← last_synced_at per element, conflict log
      tombstones.json                ← deletion log (id, type, deleted_at)
      lock                           ← presence indicates a writer is active
    elements/
      character/                     ← one subfolder per element type
        <id>.json
      location/
        <id>.json
      institution/
        <id>.json
      ... (18 content element types)
    spatial/                         ← map artifacts (one file per element, like content)
      map/
        <id>.json
      pin/
        <id>.json
      zone/
        <id>.json
      marker/
        <id>.json
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

**World discovery on root setup**: after resolving the root, atlas scans its subfolders for any with a valid `world.json` and imports them into the registry (using `handle.isSameEntry()` to avoid duplicates). Critical when localStorage is wiped but the disk folder remains.

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
4. For folder elements missing on server that have NO tombstone AND `server_updated_at` is present (meaning they were synced before) → server deleted them; ask user (delete locally? restore on server? — Phase 3.5 polish, default behavior TBD).

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

**Client-side UUID generation. OW API accepts them.** Verified via `obsidian-plugin/Commands/CreateElementCommand.ts` which uses `uuidv7()` and passes the id through to the server.

Consequences:
- Local creates use `crypto.randomUUID()` (RFC 4122 v4) or `uuidv7`. We'll use `crypto.randomUUID()` (built-in, no dep).
- On push (CREATE), the local UUID is sent in the request body. Server accepts and persists it.
- Foreign key references (`species_ids`, `parent_id`, etc.) keep working through the local→server transition. No remap dance.

**Implications for Make-Online Route 2** (link to existing api world): name+type matching is still the primary match key (because elements created independently on different machines will have different UUIDs), but ID matching catches re-uploads from the same machine cleanly.

---

## Workflows

### W1 — Create local world

1. User clicks "+ Create Local" in sidebar Worlds mode (or Welcome CTA).
2. Modal asks for name; "Pick Folder" button opens the OS folder picker.
3. Atlas writes `world.json`, empty `elements/`, `spatial/`, `media/`, `.atlas/`.
4. Registry entry added with `state: 'local-only'`, folder handle stored in handle-vault.
5. World activated. Sidebar flips to elements mode. Middle shows timeline (empty state).

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

**Error handling**: if push fails mid-upload, the api world has partial data. Registry entry stays `local-only` until user retries or proceeds with partial state (a "finish upload" action would be Phase 3.5 polish).

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
3. Push phase runs: for each locally-changed element, push to server. Conflicts handled per policy (default drain-blind: local wins, toast fires).
4. Pull phase runs: fetch updates from server since `last_pull_at`. Apply non-conflicting; record conflicting.
5. Sync indicator returns to `synced` (or `error` if anything failed).

### W8 — Conflict surfacing

For Phase 1 (drain-blind default):
- Conflict detected during push (server changed since pre-edit baseline).
- Local change pushed anyway.
- Toast: "Server was updated externally — your save won. {N} field(s) overwritten."
- Conflict logged in `sync-state.json` for later review (read-only audit; no UI yet).

For Phase 3.5 polish:
- `ask` policy raises a modal with field-level diff + per-field keep-mine / keep-theirs / manual-merge.

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
- **Separate folders, same api credentials**: each machine has its own FolderStore + SyncEngine. They reconcile through the api server. Standard distributed-edit semantics — last writer wins on conflicts unless policy is `ask`.

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

## UI — Three-Pane Shell

(Port from `atlas-deprecated/src/layout/app-shell.ts` — the layout, state shape, and conventions are unchanged.)

```
┌─────────┬────────────────────────┬─────────────────────────┐
│ 18%     │ 52%                    │ 30%                     │
│ SIDEBAR │ MIDDLE                 │ RIGHT                   │
│         │                        │                         │
│ [Worlds │ Welcome / Timeline /   │ Map Index / open maps / │
│  Elements] mode toggle           │ Graph (placeholder)     │
│         │                        │                         │
│ Worlds  │ — or —                 │                         │
│ tree    │                        │                         │
│  OR     │ Element detail         │                         │
│ Elements│ (schema-driven)        │                         │
│ list    │                        │                         │
│         │ — or —                 │                         │
│ ⚙       │ Settings               │                         │
└─────────┴────────────────────────┴─────────────────────────┘
```

**Sidebar (~18%)**:
- Top toggle: `[OW · WorldName | Elements]`
- Body: world tree (Worlds mode) OR filter chips + search + element list (Elements mode)
- Footer: gear icon → Settings

**Middle (~52%)**:
- Modes: `empty` | `timeline` | `element` | `settings`
- Element detail: schema-driven; popover field edit; sections from SDK `ELEMENT_SECTIONS`

**Right (~30%)**:
- Tab bar: Map Index (pinned) + per-map tabs + Graph (placeholder)
- Leaflet canvas per map tab with lifecycle cache

**Ratios** persisted to `localStorage.atlas_shell_ratios_v2`.

(All conventions about pane styling, force-render idiom, etc. — see "Critical Conventions" below.)

---

## State Shape

```ts
interface AppState {
  registry: WorldsRegistry;          // localStorage-persisted
  data: DataState;                   // elements/maps/pins/zones/markers in memory
  ui: UiState;                       // mode toggles, selection, etc.
  sync: SyncSummaryState;            // per-world sync engine summary for UI
}

interface UiState {
  sidebarMode: 'worlds' | 'elements';
  middleMode: 'timeline' | 'element' | 'settings' | 'empty';
  rightTabs: RightTabRef[];
  rightActiveIndex: number;
  selectedElementId?: string;
  elementFilters: Set<ElementType>;
  search: string;
  showcaseMode: boolean;
  pinPlacement?: { elementId: string };
  defaultCreateType: ElementType;
  allowMultiPin: boolean;
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

UI prefs (sidebarMode default, showcaseMode, defaultCreateType, allowMultiPin) → `localStorage.atlas_ui_prefs`.
Navigation state (active world, selection, open maps) → URL hash.

---

## Routing (URL hash)

Same scheme as legacy, no server rewrites needed (Cloudflare Pages friendly):

```
#/
#/w/<worldId>/worlds
#/w/<worldId>/elements
#/w/<worldId>/element/<elementId>
#/w/<worldId>/settings
#/w/<worldId>/map/<mapId>
#/w/<worldId>/map/<mapId>/element/<eid>
```

---

## Critical Conventions

Inherited from legacy (hard-won; preserve in new code):

1. **State is truth** — UI reads from `store.get()`, writes via `store.patchSlice()`, router mediates URL ↔ state.
2. **Force re-render idiom** — patch `data.elements` with a new reference. Patching `ui` with same content does NOT trigger selectors (slice-select compares strict equality on selected value).
3. **Shell pane non-mutation** — renderers must wrap content in a child div, never set `.atlas-middle` / `.atlas-right` cssText or className. Touching the shell pane wipes its `flex: 0 0 X%` and breaks the layout.
4. **`min-width: 0` on flex children** — without it, wide content forces parent past flex-basis.
5. **SDK-shape-agnostic relationships** — scan all array fields whose items have `id`; don't hardcode `_ids` suffix detection (SDK may rewrite field names).
6. **Acronym-aware field labels** — `humanizeFieldName('image_url')` → `Image URL` via ACRONYMS set (URL, ID, API, UI, IP, HTML, HTTP, DNS, UUID, SDK).
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

27. **Sidebar mode toggle reads URL + registry, NOT `state.active`.** The right-tab label is the active world's name. `state.active` only fills in AFTER the slow FS work in `activateWorld` (handle resolve, permission re-grant, `store.open`, `listElements`); during that window the registry entry exists but `state.active` is still null or stale. Reading `state.active.meta.name` in the toggle would lag the UI ~500ms behind the click. Reading `registry.worlds.find(w => w.id === route.worldId).name` flips the label synchronously in the same frame as the click — the "instant-feel world switch" depends on it. The same principle applies to any UI whose visible identity should match the URL: source from registry+URL, not from store state that catches up async. `activateWorld` clears `data.elements` + `selectedElementId` and navigates synchronously BEFORE the FS work for the same reason; failure paths revert URL to the priorHash.

---

## Test Strategy

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

## File Layout (target)

```
tools/atlas/
├── src/
│   ├── core/
│   │   ├── types.ts                # Element, WorldMap, Pin, UiState, Conflict, etc.
│   │   ├── state.ts                # Observable store
│   │   ├── constants.ts            # storage keys, element labels
│   │   └── ui-prefs.ts             # localStorage UX prefs
│   ├── store/
│   │   ├── folder-store.ts         # THE store
│   │   ├── fs-utils.ts             # path helpers, atomic write
│   │   ├── handle-vault.ts         # FileSystemDirectoryHandle persistence (only IDB use)
│   │   └── idb.ts                  # promise-wrapped IDB primitives (handle-vault only)
│   ├── sync/
│   │   ├── sync-engine.ts          # the engine
│   │   ├── diff.ts                 # local↔server diff computation
│   │   ├── policy.ts               # drain-blind | server-wins | ask
│   │   └── ow-client-factory.ts    # per-(apiKey, pin) OnlyWorldsClient cache
│   ├── registry/
│   │   └── registry.ts             # localStorage registry + helpers
│   ├── layout/
│   │   ├── app-shell.ts            # 3-pane shell (port)
│   │   └── tab-bar.ts              # generic tab bar (port)
│   ├── sidebar/
│   │   ├── worlds.ts               # Worlds mode (port + simplify)
│   │   └── elements.ts             # Elements mode (port)
│   ├── middle/
│   │   ├── element-detail.ts       # schema-driven editor (port)
│   │   ├── timeline.ts             # event axis (port)
│   │   └── settings.ts             # PIN + email + sync section (rewrite parts)
│   ├── tabs/right/
│   │   ├── map-index-tab.ts        # (port)
│   │   ├── map-tab.ts              # leaflet canvas (port)
│   │   ├── pin-visuals.ts          # canvas icons (port)
│   │   └── edge-color.ts           # image edge sampling (port)
│   ├── visualization/leaflet-2d/
│   │   └── Leaflet2DManager.ts     # (port)
│   ├── media/
│   │   └── media-section.ts        # grid + drag-drop (port)
│   ├── editor/
│   │   └── field-schema.ts         # SDK FIELD_SCHEMA adapter (port)
│   ├── ui/
│   │   ├── element-create-modal.ts # (port)
│   │   ├── element-picker-modal.ts # (port)
│   │   ├── field-edit-popover.ts   # (port)
│   │   ├── map-create-modal.ts     # (port)
│   │   ├── link-world-modal.ts     # REWRITE (initial download flow)
│   │   ├── make-online-modal.ts    # NEW (Route 1 + Route 2)
│   │   ├── sync-indicator.ts       # REWRITE (attached to SyncEngine)
│   │   ├── modal-base.ts           # (port)
│   │   └── toast-manager.ts        # (port)
│   ├── styles/
│   │   └── atlas.css               # (port)
│   ├── router.ts                   # hash router (port)
│   ├── app.ts                      # orchestration
│   └── main.ts                     # boot + Chromium gate
├── tests/
│   ├── setup.ts                    # vitest + MSW + fake-idb
│   ├── msw-handlers.ts             # reusable mock OW handlers
│   ├── fixtures/
│   │   ├── mock-folder-store.ts    # in-memory FolderStore for tests
│   │   └── sample-worlds.ts        # sample data builders
│   ├── unit/
│   │   ├── diff.test.ts
│   │   ├── tombstones.test.ts
│   │   └── ...
│   ├── integration/
│   │   ├── sync-engine.push.test.ts
│   │   ├── sync-engine.pull.test.ts
│   │   ├── sync-engine.conflict.test.ts
│   │   ├── sync-engine.resume.test.ts
│   │   └── ...
│   └── e2e/
│       ├── create-local.spec.ts
│       ├── link-api.spec.ts
│       ├── make-online-route1.spec.ts
│       ├── make-online-route2.spec.ts
│       ├── edit-offline.spec.ts
│       ├── conflict.spec.ts
│       └── ...
├── public/
│   ├── favicon.ico
│   ├── favicon.png
│   └── owlogo.png
├── DESIGN.md                       # this doc
├── PROGRESS.md                     # operational log (created when build starts)
├── PORTED.md                       # log of what was ported from atlas-deprecated and how
├── README.md
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── playwright.config.ts
└── index.html
```

---

## Phased Build Plan

**Phase 0 — Foundation (this session)**
- Package skeleton ✅
- DESIGN.md ✅ (this file)
- SyncEngine + FolderStore interfaces + first integration test (Bout 4)

**Phase 1 — Core sync foundation**
- FolderStore implementation (File System Access API + fs-utils)
- Mock FolderStore for tests
- SyncEngine implementation (push, pull, diff, drain-blind policy)
- Handle vault (IDB)
- Registry (localStorage)
- Tests across all units + integration

**Phase 2 — Minimal UI to test foundation**
- App shell (port from legacy)
- Worlds sidebar (simplified)
- Settings panel with PIN + email
- Sync indicator (rewrite, attached to SyncEngine)
- Welcome panel with "+ Create Local" / "+ Link API" / "Make Online"

**Phase 3 — Upload flows**
- Link existing API world (initial download)
- Make Online Route 1 (create new api world)
- Make Online Route 2 (link existing with merge policy)
- E2E specs for each

**Phase 4 — Port content UI**
- Elements sidebar
- Element detail with schema editor + popover
- Element create modal
- Element picker

**Phase 5 — Port spatial UI**
- Maps + Leaflet manager
- Pins (place, drag, contextual create)
- Map index + tabs
- Edge color + pin visuals

**Phase 6 — Media + timeline + polish**
- Media section
- Timeline v1
- Stay-offline toggle
- Conflict policy setting
- Pre-flight cache warm (no longer needed — folder IS the cache)
- Autosave vs manual save (deferred from legacy session, optional)

**Phase 7 — Smoke + cutover**
- Smoke against real OW world (`5474990854`)
- Big push to existing atlas GitHub repo, overwrite legacy code
- Move `tools/atlas-deprecated/` → `tools/_archive_atlas-v3.x/`
- Cloudflare Pages auto-redeploys

---

## Tradeoffs Accepted

- **Chromium-only forever**. File System Access API is Chromium. Worth it for local-first integrity. If Firefox/Safari ever ship FS Access, we get them automatically.
- **Permission re-prompt every session**. FS API requires user gesture per session for write access. Mitigations: `navigator.storage.persist()` (some help), "open all" button in worlds list, eventual remember-this-session UX.
- **Initial download for link-existing**. One-time wait when first linking a world. Show progress.
- **Multi-tab same-world risk**. Lock file detects, warns; user accepts at their own risk.
- **Folder location is user's responsibility**. If they move/rename the folder outside Atlas, the handle invalidates. UX: "Re-link folder" recovery action.

---

## Open Questions

1. **Server-side DELETE detection on pull** — if a server element disappears (someone deleted it on the web app), how do we surface that? Currently the algorithm above suggests "ask user." Worth designing the UX for Phase 1 or deferring to 3.5?
2. **Email persistence scope** — global in Settings (single user identity) vs per-world (different OW accounts for different worlds)?
3. **`api-linked` → `local-only` detachment UX** — Settings → "Unlink from API"? Confirmation? Does the server entry get deleted (probably not — separate concern)?
4. **Pagination on initial download** — `fetchAllPages` cap at 50×200 = 10k per bucket. Document; design "load more" UX if real worlds exceed this.
5. **Conflict log review UI** — Phase 1 logs to `sync-state.json`. When do we surface this list? Phase 3.5 polish.
6. **Multi-image API support** — defer until OW schema supports it (current model has one `image_url`).
7. **Per-world sync policy override** — default global; expose per-world override when?

---

## Reference

- **Legacy reference**: `tools/atlas-deprecated/` (UI/UX only; architecture is fully replaced). See its `DEPRECATED.md` for the port list.
- **OW SDK patterns**: `Knowledge/Technical/onlyworlds.md` (handles SDK quirks, relationship fields, schema reference).
- **Create-world endpoint reference**: `Development/OnlyWorlds/obsidian-plugin/Commands/CreateWorldCommand.ts`.
- **Field schema source**: SDK FIELD_SCHEMA + ELEMENT_SECTIONS.
- **Test world for smoke**: `5474990854` (Captain's messworld).

---

**Doc cadence**: this DESIGN.md is the stable architectural reference. Operational state (what's done, what's next, rough edges) lives in `PROGRESS.md` once Phase 1 starts. Port decisions get logged in `PORTED.md`.
