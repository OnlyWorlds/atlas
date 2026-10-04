# Atlas: Sync

**Updated**: 2026-09-29 (S366 split from DESIGN.md; the pre-split text, including the old workflow list W1-W12, is `docs-archive/DESIGN-2026-09-29-pre-split.md`).
**Job**: how an api-linked world talks to keel, as the code runs today. The lessons and the bug classes behind these rules live in `SYNC_NOTES.md`; the numbered rules in `DESIGN_LAWS.md`; the wire contract in `Forge/Notes/Archive/2026-07-12-v2-probed-facts.md`.

---

## The shape

The folder is the world; the API is a sync target. A `SyncEngine` exists only for an `api-linked` world, at most one at a time (conv. 15), and talks the keel v2 dialect through `OwV2ClientAdapter` (`src/sync/ow-v2-client-adapter.ts`, a thin fetch; the SDK is used only for `FIELD_SCHEMA` statics). World routes send `API-Key` plus `API-Pin` on writes; a view-only world sends no PIN header.

Local-first by default: pushes follow user intent (you typed, it saves), pulls are opt-in (pull-on-activate and the cadence both default off; the manual refresh is always there).

## Attaching the engine

`attachSyncEngine(entry, folder)` in `src/sync/sync-attach.ts` is the one place an engine is made. It no-ops (and detaches any prior engine) for a local-only world. For an api-linked world it builds the adapter from `world.json`'s key and the registry PIN, creates the engine with `onStateChange` publishing into `state.sync`, applies the registry's `sync_debounce_ms`, adopts a persisted big-batch hold (conv. 111) BEFORE anything can push, pauses when `sync_pause_all` or the world's `sync_paused` is set, and then runs, in order: the flush-on-attach, then pull-on-activate (conv. 25). A view-only world skips the flush and always pulls on activate.

Callers: `activateWorld` (`src/sidebar/worlds-sidebar.ts`), the root flows in `src/setup/atlas-root-flow.ts` (create, import, link), both Make Online routes and the new-api-world modal (with `justLinked`), the tour world, and the PIN change in `src/middle/settings-account.ts` (a fresh engine is the recovery from an auth error). Exposed: `getCurrentSyncEngine()`, `requestPushIfLinked()`, `detachSyncEngine()`.

## The engine surface

The class is `src/sync/sync-engine.ts`; its state and result types are `SyncEngineState` and `SyncResult` in `src/core/types.ts`. Read those for signatures; this is the map.

- **Rounds** (all share one `inFlight` promise, so a concurrent call gets the round already running):
  - `pushOnce()`: meta step, then push. The debounce, the flush, resume, a hold's release and Make Online all end here.
  - `pullNow()`: meta step, then pull. The refresh surfaces, the cadence and pull-on-activate.
  - `syncNow()`: meta step, then push, then pull (the pull skips ids the push conflicted on). No production caller today.
- **Triggers**: `requestPush()` arms the autosave debounce (default 5000 ms, `setDebounceMs`, user-set in Settings → Storage); `flushPendingPush()` fires an armed debounce now; `getPendingPush()` feeds the pill's decay ring.
- **Control**: `pause(reason)`, `resume()`, `isPaused()`, `isNetworkPaused()`, `hold(reason)` returning a one-shot release (conv. 107), `isHeld()`, `stop()` (detach: cancels timers, aborts the round's writes), `setPolicy()`.
- **Review**: `resolveConflict`, `resolveServerDelete`, `resolveMetaConflict` and their `list*` readers.
- **Constructor options** (callbacks are options, not subscriptions): `folder`, `client`, `policy`, `readOnly`, `apiWorldId`, `onStateChange`, `onConflict`, `onPushProgress`, `onSyncResult`.
- **State**: `idle { last_sync_at }` · `syncing { phase, progress? }` · `paused { reason: manual | network | held, held_for?: rekey | disk, pending_changes }` · `error { message, recoverable }`. `pending_changes` is always 0 today, so the pill shows no count.
- **Result**: pushed and pulled counts, `conflicts`, `failures`, `pulled_ids`, `auth_blocked` + `auth_reason`, `transient_blocked` + `transient_reason` + `retry_after_ms`, `meta_pushed`, `meta_pulled`.

## A round

Every round checks, in order: blocked (paused or held) returns an empty result; a re-key journal on disk refuses the round and publishes "held" (conv. 105); then the **meta step** (below). A push round skips the `GET /world` when a baseline exists and local meta equals it.

**Push** (`pushPhase`):
1. Take every dirty element (`listLocallyChangedSince(null)`: `local_updated_at` newer than `server_updated_at`, or never synced) and every tombstone.
2. CREATEs (no `server_updated_at`) land before UPDATEs. Two or more creates go through `POST /bulk`: one atomic request, keel resolves in-batch links as a fixpoint including cycles, one retry of the survivors on a partial failure, then timestamp backfill (never the client clock) (conv. 23). A single create, or a client without `bulkCreate`, uses the per-element path ordered by the Kahn topo-sort.
3. UPDATEs: a server copy newer than the baseline is a conflict, handled per policy. A 404 routes the element to the server-delete review.
4. Tombstones become DELETEs; success or a 404 clears the entry.
5. Each success stamps `server_updated_at` passing the sent `local_updated_at`, so an edit made during the request stays dirty (conv. 96). A pin missing `element_type` is healed from its element first (conv. 19). An `invalid_link` routes the dangling peer to the server-delete review. A create refused because another world holds the id is recorded as foreign, on evidence only (conv. 108).
6. Errors: a per-element 4xx or validation failure is recorded and the loop goes on. 401/403 bails the round and turns the engine red (conv. 22). 429, 503 or a network failure ENDS the round (`transient_blocked`), nothing pauses, and one retry is scheduled after `Retry-After` or 30 s (conv. 100).

**Pull** (`pullPhase`):
- The production path is `pullPhaseChanges`: a walk of the per-world `/changes` feed from `changes_cursor` (continuation `since=`, never `cursor=`). Deletions arrive as explicit ops and go to the server-delete review (`sync_confirm_server_deletes`, default on). An upsert revives its id. A `head` below `changes_last_seq` means a restore from backup: drop the cursor and cold-walk once. The cursor advances only together with the side effects it caused.
- `pullPhaseFullList` is the fallback for a client without `pullChanges`: a per-type list walk with absence-inferred deletes, suppressed for any type whose walk was incomplete.
- Per element: server moved and local did not, so apply through `applyServerRecordIfUnchanged` (the check reads the DISK stamp inside the write chain, conv. 99); both moved, so it is a conflict per policy; ids the push conflicted on this round are skipped. Wire extension fields land from the server; local-only fields are kept from the file (`ATLAS_FIELDS.md`).

**Policies** (registry `sync_default_policy`, global):

| Policy | Push conflict | Pull conflict | Surface |
|---|---|---|---|
| **`local-wins`** (default) | push local anyway | skip the server change, then push to converge | one toast per round; nothing persisted |
| **`pause-and-review`** | skip, persist | skip, persist | badge on the pill; the conflict-review modal resolves each row (mine / theirs), world-meta fields included |

There is no `server-wins`: a destructive implicit overwrite of local edits is the wrong default; "pull (theirs wins)" is an explicit per-row action. Legacy values (`drain-blind`, `pause-on-conflict`, `ask`) migrate in `loadRegistry`.

## Push triggers (all of them)

1. **Autosave**: every UI folder write calls `requestPushIfLinked()` (conv. 17), which arms the debounce.
2. **The pill**: a click while a debounce is armed calls `flushPendingPush()`; otherwise the click is a pull.
3. **Flush-on-attach**: pending writes from an earlier session push on attach, before pull-on-activate (conv. 25). More than 50 changed elements with no persisted question hold instead and ask (conv. 117).
4. **Resume**: `resume()` pushes. It runs when the user turns off "stay offline" or pause-all, and when the `online` event finds the engine network-paused.
5. **A hold's release** pushes when no other hold or pause remains.
6. **The local-wins convergence push** after a pull conflict (`sync-attach.ts`, deferred past the in-flight round and dropped if the world changed).
7. **Server-delete review, Keep**: clears the baseline and pushes at once (`src/ui/server-delete-modal.ts`).
8. **The live folder**: a pass that finds stamped outside edits calls `requestPushIfLinked()`; more than 50 hold the engine and ask (conv. 111).
9. **The transient retry**: one timed `pushOnce` after a busy or unreachable server.

Make Online Route 1 also runs `pushOnce()` on its own transient engine.

## Pull triggers

Pulls never happen unasked:
- **Manual**: the pill (when nothing is armed), Settings, the worlds sidebar refresh, and a per-type refresh from a filter chip's context menu.
- **Pull-on-activate**: `registry.sync_pull_on_activate`, default off; always on for view-only worlds.
- **Cadence**: `registry.sync_cadence_ms`, default off (`src/sync/auto-pull-scheduler.ts`). The interval keeps running while the tab is hidden and those ticks skip; on becoming visible after a missed window it fires one catch-up pull. Ticks skip while the engine is paused, syncing or in error, or under pause-all.
- The `online` event does NOT pull; it only resumes a network-paused engine, which pushes.

## Pause, hold, offline, error

- **Stay offline**: `pause('manual')` is engine memory only. The persisted choice is the registry: per-world `sync_paused` (Settings → World) and global `sync_pause_all`, applied at attach. The pill reads "Paused · local edits queued"; local writes continue normally.
- **Network**: the `offline` event pauses with reason `network` ("Offline"); `online` resumes only when `isNetworkPaused()` says so, asking the engine and never the pill.
- **Hold** (conv. 107): a counter separate from `paused`, used by the re-key and by a big batch of outside edits (`held_for: 'rekey' | 'disk'`). `hold()` clears timers and waits for the round in flight; `resume()` cannot release it; the release republishes an auth or network pause that stood underneath.
- **Auth error**: 401/403 sets `paused` and the red error state; a revoked key and a read-only key get their own copy (`auth_reason`). Recovery is a fresh engine (a PIN change re-attaches) or unlinking.
- **Detach**: `stop()` on every world switch and unlink.

## Creating and linking worlds

**Create a local world**: the create modal asks for a name only (`src/ui/create-world-modal.ts`) and the world lands in `<root>/<slug>-<id8>`; with no root, the home-folder question comes first (`ensureAtlasRoot`). Atlas writes `world.json` (with `format_version`), `.atlas/`, `elements/<type>/` for all 22 and `media/`, registers the world local-only, and opens its home room.

**Link an existing api world** (sidebar link icon, an account world's open, the view-only door): the root is ensured first. The link modal takes an API key, the PIN (prefilled) and an optional display name; it validates with `getWorld()` on a v2 adapter (`buildV2Adapter` in `src/sync/make-online.ts`), refuses a world already linked here (`findLinkedWorld`), then downloads every element into a new root subfolder with progress. Three exits: **Cancel link** removes the new folder and keeps nothing; **Stop and keep what's here** registers the partial world, and Refresh from API brings the rest; an error leaves nothing registered. Registration comes after the download, so a linked world is either whole on disk or explicitly partial.

**View-only worlds** are a flag on api-linked, not a third state: `api.read_only` (registry and `world.json`). Linked with a READ key and no PIN. The double wall: the engine is pull-only (`readOnly`: every push trigger dies at `pushOnce`/`requestPush`, the meta step never PATCHes) and the store throws "This world is view-only" at every UI mutator (`setViewOnly`), while the engine's channels bypass it. SYNC_NOTES "Read-only engines".

**Unlink** (Settings → World): detach the engine, then `resetSyncBaseline()` (every element's `server_updated_at`, the tombstones, sync-state, `world.json.api`), then flip the registry (conv. 24). The server world id is remembered as `former_api_world_id`, so the account list knows the world is already here.

## Make Online

The only entry is Settings → World → "Make online", shown for a local-only active world. It refuses the tour world and a world already online. One modal, two tabs (`src/ui/make-online-modal.ts`).

**Route 1, "Create new"**: name, email and PIN are required and checked before any call. `createApiWorld` (`src/sync/make-online.ts`): signed in, `POST /api/v2/account/worlds` with the PIN dance (omit `pin` first; a fresh account answers 422 `param=pin`, retry with the PIN, which becomes the account PIN); signed out, the v1 `create-world-external` endpoint. Then a transient engine's `pushOnce()` uploads everything ("Uploading N of M"). When that round returns the registry flips, `world.json` gets the api block (and loses the demo flag), and the long-running engine attaches with `justLinked`, EVEN WITH per-element failures: the toast says "<name> is online." plus why they failed, and they retry on later rounds. The world stays local-only only if the flow throws.

**Route 2, "Link to existing"**: API key, PIN and a merge policy for elements matched on both sides: **(b)** push, local content wins; **(c)** keep the server's version, whose record lands locally (local edits to matched elements are lost, the local rich text with them, and a page's local blocks: they are rebuilt as one prose block from the server's `story` when the server's copy is a page, so the next save compiles the online text back, trimmed; a page the server holds as a scene keeps no page fields, gate A9; the modal warns). Atlas's own bindings (map image, aliases) survive both. There is deliberately no "wipe the server" policy. Rebuilt S367 onto the re-key kernel (conv. 122; design `Forge/Notes/2026-09-29-s365-orient/lane-a-route2.md` §3 Option A as amended by `Forge/Notes/2026-09-29-s366-orient/lane-b-route2-recheck.md` §4). The modal validates with `getWorld()`, refuses a double link, then hands over to the runner, `src/sync/make-online-run.ts`:
- **The runner** holds the id-move single flight shared with the Settings re-key (`withIdMoveLock` in `rekey-run.ts`: one id move app-wide, a live-folder pass in flight is waited out, `isRekeyRunning()` answers for both so the live folder and activation recovery stand down), makes the app `inert`, flushes the rooms, refuses an open zone edit, runs the merge, and on a kernel failure finishes it from its journal and merges again. The modal's link step (registry, `world.json`, attach with `justLinked`) runs INSIDE the lock; then the element list is reloaded from disk.
- **The merge** (`mergeLocalIntoApi`): refuses first when a re-key journal exists (`MergeRefusedError`, nothing read or written); lists the server; plans with `planMerge` (`src/sync/plan-merge.ts`, pure: per type, ids first over every local, then names among what is left, compared NFC + trimmed + lowercased; an empty name never matches; a name shared by two or more on one side is NOT matched but reported in `MergeResult.ambiguous`, Captain's ruling; a server id already held locally under another type is an `idClashes` entry, never downloaded; a map or zone whose name matches but that both sides have children on, pins or markers on the map or markers on the zone, is NOT matched and is reported in `childClashes`, Captain's ruling A4/A5 2026-10-04, while children on one side only still match). Then the journaled kernel moves each name-matched local O onto its server id N (`startRekey` with `pairs`, `allowStaleBaseline`, `origin: 'merge'`): every link, `ow://` prose link, chip, page block and media file follows, and `onRekeyed` lets the app follow at once (`rekeyLiveUi`). Only then the server phase, every decision same-id: downloads, creates (`/bulk` when two or more; bodies read from disk after the kernel; sent stamps on every stamp), matched elements (b: PATCH then the full response lands; c: the server record lands with `dropLocal: ['atlas_richtext_json']`).
- **Crash points**: before the kernel nothing is written; inside it the journal stays and the server is untouched (recovery at the next open or the runner's retry, then a rerun matches by id); in the server phase a rerun matches everything by id. A duplicate on the server cannot be made: O and N coexist only inside the journal's window, and nothing matches against a world while a journal exists. An interrupted link's journal says `origin: 'merge'`, so the Settings row, the activation toasts (on the silent boot path too) and a twice-failed run's error say to finish it and run Make online again with the same key (no key is stored before linking). Ids a merge created before it stopped are kept in sync-state `route2_created` until a link succeeds, so a policy-c rerun treats them as the user's own uploads, not duplicates. A planned create's stale baseline is cleared before anything is sent; matched policy-b bodies are read from disk and their response lands through `applyServerRecordIfUnchanged` (conv. 96).
- After the merge returns: the failure set registered as shown (`failureToastOnce`, so the attach's retry does not repeat it), engine attach with `justLinked` (no big-batch question for its own failures), then "Linked to {world} · N pushed, N updated, N downloaded, N failed", the names left unmatched (`ambiguousLine`), the maps and zones left unmatched (`childClashLine`), and why any failed.
- Guards: `tests/integration/make-online.kernel.test.ts` (real store: the hazards, a crash matrix over the kernel's five element and media calls in both id-tail orders and both policies, the first `/changes` round), `tests/integration/route2-gate/` (the gate's crash-and-reopen runs over every kernel write and every server-phase call, sent stamps, stale baselines, the policy-c rerun), `tests/integration/make-online-run.test.ts`, `tests/unit/plan-merge.test.ts`, `tests/e2e/route2-merge.spec.ts` (the modal end to end against a page.route keel).

## Ids

Local creates use `crypto.randomUUID()` (v4). Captain ruled 2026-09-28 that tools we control should DEFAULT to v7 for element ids (keel mints v7; v4 stays valid forever). Queued, with its trap: `newId()` is shared with media, whose filename collision suffix keys on the first 8 characters (a timestamp in v7), so element ids get their own `newElementId()`.

**keel preserves client ids** (v1 and v2, probed live 2026-07-12): the id atlas mints is the server's id forever. A duplicate POST is 409 `id_conflict`; v2 `PUT /{type}/{id}` is create-or-replace. A server that reassigns an id on create is a contract violation and a loud per-element failure (nothing stamped, retried). The engine's old create-path id swap and its `onIdSwap` hook are gone; Route 2's name matches move ids through the re-key kernel (above). History: the pre-keel server assigned its own v7 on create (SYNC_NOTES "Server-assigned ids").

keel refuses a create whose id lives in ANOTHER world. Those ids are recorded as foreign on evidence (conv. 108) and the re-key gives them new ids.

## The re-key kernel

Giving elements new ids (a copied folder, a world taken online twice) is one journaled kernel, `src/store/rekey.ts`, with `src/store/rekey-body.ts` as its reference transform (conv. 105, 106). The app side is `src/sync/rekey-run.ts` (hold the engine, flush the rooms, the app-only guards, the kernel, one live pass, release; single-flight; Settings is the only launcher, behind a locked modal) and `src/sync/rekey-route.ts` (the URL after ids change). Route 2 is the kernel's second caller (`sync/make-online-run.ts`, caller-supplied pairs; the journal records `origin`). Step 5b remaps `.atlas/world-prefs.json`'s cast and calendar lens, inverse in Discard. The engine refuses every round while a journal exists and holds with `held_for: 'rekey'` during a run (conv. 107). Lessons: SYNC_NOTES "Foreign ids, the hold, and the re-key".

## Account mode (S260; design and gate record `Forge/Notes/Archive/2026-07-13-account-mode-design.md`)

Atlas can hold an OnlyWorlds **account token** (`ow_a_`, minted in the portal's Tokens UI, pasted in Settings → OnlyWorlds). The token is a key-minting authority, never a sync credential: sync always runs on per-world keys in `world.json`.

- **Sign-in**: validated with `GET /api/v2/account` (the username is cached for display). The registry stores `account_token` and `account_username`, the same trust posture as the PIN. Forget drops both; opened worlds keep their own keys.
- **"On OnlyWorlds" sidebar section** (`renderRemote` in the worlds sidebar, `src/sync/account-worlds.ts`): account worlds not represented locally (by live `api.world_id` or remembered `former_api_world_id`) render dimmed below the local list. An owned row's click runs the open flow: preconditions first (home folder, PIN, prompted by `PinPromptModal` and saved if absent), then mint a WRITE key (`POST /account/worlds/{id}/keys` named by `deviceKeyName()`, "atlas · <platform>"), then the link pipeline (`linkExistingApiWorldInRoot` with `knownWorld` skipping re-validation) on the activation chain, then home plus the ecosystem waypoint. Collaborator rows take the link-by-key path (minting is owner-only). Offline-first: the account fetch can only ADD a section; local rendering never waits on it.
- **The activation chain** (`src/core/activation-chain.ts`): one serializer for everything that touches the shared active store. Activations are supersedable; link and download flows never are.
- **Auth split** (keel, pinned 2026-07-13): account routes use `Authorization: Bearer ow_a_...`; world routes use `API-Key` (+ `API-Pin` on writes). A revoked world key has its own toast ("reopen from the sidebar", not "check your PIN").
- **Deferred**: watched worlds (`ow_r_`), device-code sign-in.

## World-meta sync (S262; design and gate record `Forge/Notes/Archive/2026-07-13-worldmeta-sync-design.md`)

The eight OnlyWorlds world fields in `world.json` (`description`, `image_url`, `time_basic_unit`, `time_format_names`, `time_format_equivalents`, `time_range_min`, `time_range_max`, `time_current`) sync through keel's `GET|PATCH /api/v2/world`, so the now-line travels between devices. **`name` is deliberately NOT synced**: the local world name and the server world name are separate identities (`api.world_name` is a display mirror).

- **The meta step** (`executeMetaStep`) opens every round: ONE `GET /world` (meta never enters `/changes`; `updated_at` is a skip hint only), then a per-field three-way against `meta_baseline` in sync-state. Server-only changes apply to disk; local-only changes go out as ONE partial PATCH of the changed fields; contested fields follow the policy (local-wins pushes; pause-and-review skips both ways, persists `meta_conflicts`, and the conflict modal gains world-settings rows resolved by `resolveMetaConflict`).
- **An absent baseline is a seed round, never a PATCH**: adopt the server's values as baseline, fill locally EMPTY fields from the server, push nothing. Locally set fields push next round.
- **Canonical equality**: disk `undefined` equals the wire empties (`''`, `[]`, `null`); the encoder sends typed empties, so a cleared now goes out as `time_range_current: null`. Kernel: `src/sync/world-meta-sync.ts` (pure, unit-locked; owns the one disk/wire rename `time_current` to `time_range_current`).
- **The baseline advances per field** (fields the PATCH sent plus fields the pull applied), so a concurrent server change to an untouched field still surfaces. `resetSyncBaseline` clears it.
- `writeWorldMeta` is serialized store-wide; pull-applied meta reaches `state.active.meta` through `refreshMetaCache`. Meta-only rounds surface honestly (`meta_pushed`/`meta_pulled`, "Pulled world settings").
- keel validates types, not lengths: atlas guards `image_url` at 1024 and `time_basic_unit` at 128 characters before the wire. A read-only key's 403 has its own reason (`read_only_key`).

## Multiple places, one world

- **Separate folders, same credentials** (two machines, or atlas plus the web app): each place has its own FolderStore and engine and they reconcile through the server; conflicts follow the policy.
- **One folder through Dropbox or similar**: not supported. The lock (conv. 13) keeps two atlas tabs of one browser apart, but a file-sync service racing two machines is outside what atlas can see.
- **Other tools writing the folder** (an AI agent, a text editor, git): their edits survive atlas's writes (conv. 92) and are shown by the live folder (conv. 111). Whether an outside edit syncs is decided by its `local_updated_at`; the manifest with content hashes is designed, not built (`Forge/Notes/2026-09-28-shared-surface-design.md`).

## Tests and known edges

The engine suites are `tests/integration/sync-engine.*.test.ts` over `FakeOwApiClient` (`tests/fixtures/fake-ow-client.ts`, which speaks `/changes` by default since S365) and the MSW handlers in `tests/msw-handlers.ts`; kernel tests run the real store on `tests/fixtures/fake-fs.ts`; `dev/fake-keel.mjs` serves manual live checks. The open soft edges (event-once `skipIds` on `/changes`, list items missing `updated_at`, the cascade-delete crash window, stuck pins, the open-editor meta race) are listed in SYNC_NOTES "Known soft-edges".
