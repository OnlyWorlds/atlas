# Atlas: Sync

**Updated**: 2026-09-29 (S366 split from DESIGN.md; the pre-split text, including the old workflow list W1-W12, is `docs-archive/DESIGN-2026-09-29-pre-split.md`).
**Job**: how an api-linked world talks to keel, as the code runs today. The lessons and the bug classes behind these rules live in `SYNC_NOTES.md`; the numbered rules in `DESIGN_LAWS.md`; the wire contract in `Forge/Notes/Archive/2026-07-12-v2-probed-facts.md`.

---

## The shape

The folder is the world; the API is a sync target. A `SyncEngine` exists only for an `api-linked` world, at most one at a time (conv. 15), and talks the keel v2 dialect through `OwV2ClientAdapter` (`src/sync/ow-v2-client-adapter.ts`, a thin fetch; the SDK is used only for `FIELD_SCHEMA` statics). World routes send `API-Key` plus `API-Pin` on writes; a view-only world sends no PIN header.

Local-first by default: pushes follow user intent (you typed, it saves), pulls are opt-in (pull-on-activate and the cadence both default off; the manual refresh is always there).

**Wire facts the rest of this file leans on** (probed; the frozen contract is the v2 probed-facts note above):
- Element `type`: the v2 wire DOES return it (probed 2026-07-28, a 43-field character body). The adapter re-stamps it from the path anyway, the same value. An older line in the atlas-tool skill said "the server omits it"; that was false and misled a folder-writer design in Assembly.
- `change_seq` rides read responses and must NEVER reach disk (`adaptV2Record` drops it; `SERVER_MANAGED_FIELDS` strips it from legacy files on push). `world` is not on the wire at all, so element files carry no world reference: that is what lets a folder snapshot take a fresh world id.
- `name: ""` passes on every type; an absent `name` KEY is a 422. Nothing in atlas gates unnamed elements.
- Extension namespaces (`atlas_*`, `x_*`, `shadow_*`) round-trip; a non-namespaced unknown field is a 422 naming it in `param`.
- Errors are `{error:{type,code,message,param}}`. Only `invalid_credentials`, `key_revoked` and a 401/403 count as auth (the round bails); `rate_limited` and 429 are NOT auth, they are transient (conv. 100).
- Lists ask `?limit=500` (the wire's max page) and walk `?cursor=`; an incomplete walk suppresses server-delete detection. `/changes` continues with `since=`, never `cursor=`.

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
7. **Server-delete review, Keep**: clears the baseline and pushes at once (`src/ui/server-delete-modal.ts`). Its "Delete all locally" never pushes: it only removes local copies, each guarded by the stamp the user saw (conv. 140).
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

**Seat worlds and the `#/join/` door** (S385, OW Infra #104, conv. 132): a world can be linked on an agent seat, its own `ow_w_` key and `ow_s_` secret, flagged `api.seat` (registry and `world.json`) with the secret on the registry entry only (`api.seat_secret`). Every call for that world reads `worldPin`, never the account PIN. The door: a link `atlas.onlyworlds.com/#/join/<code>` (keel's world page mints the code; keel's Open in Atlas button is Skeld's half, h37 #2285). `src/core/join-capture.ts` takes the code out of the address bar first; `src/ui/join-world-modal.ts` runs `POST /join/preview` (no API-Key: the code is the credential) and shows the confirm screen (the world, the owner's Character or the inviter quoted, the role, a Character the join would add, a same-name world here, the where-question); Open runs `POST /join` with the browser's agent name ("Atlas (Firefox)"), then `openJoinedWorld` (`src/setup/join-door.ts`): a world not here downloads through the link flow above with `seat`; one here already opens (the new seat is spare, said), and that includes an account world with no PIN in this browser and a view-only world; only a seat world that lost its secret adopts the new seat; one here from an earlier link opens as it is (the door never uploads, contract R7). A refused code is keel's one 404: the preview's refusal gets R5's first sentence, a redeem's refusal while the pass should be alive gets both. The seat held in memory lets a failed download retry without a second code. Member refusals (`not_author`, `owner_only`) are per-item failures, never an auth bail (conv. 22). Not built, waiting on keel: the world id on the preview (Q10, so "already here" comes before the code is spent), a seat retiring itself (Q5, so Disconnect is real), Make online's reverse handoff (5b, Q7).

**Pictures** (1.23, #154, Keel #59's last leg; brief `Forge/Notes/2026-10-10-s386-upload-button-brief.md`): an element of an online world this browser can write to has an Upload picture row under its image URL (`src/middle/element-detail-picture.ts`; hidden for local and view-only worlds and in the tour). `uploadPicture` (`src/sync/media-upload.ts`) asks keel for a one-use ticket (`POST /media/ticket`, the world key and `worldPin`, so a seat sends its own secret) and sends the bytes to the media edge with only the ticket as a Bearer token; the ticket goes only to a known edge origin, a spent ticket is replaced once, the size is checked against the ticket's `max_bytes` before sending, and keel's (`storage_full`, `quota_exceeded`, `media_unavailable`) and the edge's (`{ error: code }`: `too_large`, `unsupported_type`, `write_failed`) refusals have their own sentences. The returned URL is saved through `persistFieldPatch` like a typed one (the push; a map's dims), into the world the upload started in: if another world is open by then, the address is said instead. Pictures are public by link and never overwritten; the row says the first.

**Removing a picture** (1.26, Boss's removal contract h37 #2354, Keel #170, Skeld h20 #2496). When the element's image URL is a picture uploaded into this world (`uploadedPictureKey`: `https://media.onlyworlds.com/u/<server world id>/…`; nothing else is removable, keel answers not_found for the crew's batch uploads and other worlds), the row offers Remove picture. The question comes first and is counted from this browser's copy (`elementsShowing`: every element whose image URL is that picture), because keel holds a second removal ticket back for ten minutes. Then `removePicture`: `POST /media/remove-ticket` `{key}` with the world key and `worldPin` (the uploader or the world's owner may; anyone else gets its own sentence), one retry after a second (or Retry-After) on keel's 404 or `upload_pending` (the edge's upload report lands about 600 ms after its reply), `removal_in_flight` says how long to wait; then the edge's `POST /v1/remove` with only the ticket. An edge `not_found` is the end state asked for; `remove_failed` and a spent ticket are said, nothing claimed. Keel does not touch image URLs, by contract: Atlas clears every one here that showed the picture through `persistFieldPatch` (so they sync), in the world the removal started in, and says how many more keel counted than this copy has. The edge purges the cached copy when it can; otherwise the link keeps answering from the edge cache, for days (Boss, h11 #2538: measured on two real keys), and the question says so: removed from OnlyWorlds, not from the internet. Guards: `tests/integration/media-remove.test.ts`, `tests/e2e/picture-upload.spec.ts` (the remove test, red without the button).

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
- **"On OnlyWorlds" sidebar section** (`renderRemote` in the worlds sidebar, `src/sync/account-worlds.ts`): account worlds not represented locally (by live `api.world_id` or remembered `former_api_world_id`) render dimmed below the local list; before any world, the first screen lists the same rows under its doors (1.46, DESIGN_HOME "The landing"). Every row's click runs the open flow, owned or shared (#199, 1.44), one at a time from the first click (a module flag set before any await; the `opening` slice comes only after the where-question, and a double tap had started two opens, the S414 gate's L1): preconditions first (where it lands; the PIN, prompted by `PinPromptModal`, only for a row that opens to write), then mint this account's own key (`POST /account/worlds/{id}/keys` named by `deviceKeyName()`, "atlas · <platform>"; `mintOwnKey`), then the link pipeline (`linkExistingApiWorldInRoot` with `knownWorld` skipping re-validation) on the activation chain, then home plus the ecosystem waypoint. A shared row's key is bound to the membership (keel D72 R9): a co-builder or contributor mints WRITE and syncs on the account PIN, as an owner does, with keel's member refusals per element (conv. 22); a guest (`member_role: 'guest'`) mints READ and links view-only, no PIN asked; a member whose account has no PIN gets 409 `pin_required` on WRITE, then a READ key and a view-only link, and a PIN typed into the prompt is kept only when the write key was made. That copy stays view-only, and its line says the read key's way out (a write key from the world's page, Unlink, Make online); a swap in place is #198's key swap (not built).
- **A person's invitation** (keel #294's Atlas half, 1.45): the `#/join/` door reads the preview's `reader` (keel #212). An agent's code is the seat door (conv. 132). A person's opens `PersonJoinModal` (`src/ui/person-join-modal.ts`): signed in, Join accepts the code at `POST /account/join` with the account token (`AccountClient.joinWithLink`), then the world opens through `openAccountWorld` as a shared row (where, PIN, a key made for the member); `already_member` (409, the code not spent) says to open it from your worlds on OnlyWorlds. Signed out, Sign in holds the code in memory (`holdJoinForSignIn`, never stored) and goes to Settings, OnlyWorlds; the sign-in there runs the door again (`resumeJoinAfterSignIn`). A person's code never reaches the agent route, and a `reader` this Atlas does not know reaches neither (said, nothing spent). Once joined, an open that stops (the where-question or PIN cancelled, another open running) leaves one sticky toast with Open it, the way back from wherever they stand; Cancel is locked while the join is in flight. Guard: `tests/e2e/person-door.spec.ts` (signed in, signed out through the sign-in, a refused code, a cancelled open; each red with its mechanism removed). Offline-first: the account fetch can only ADD a section; local rendering never waits on it.
- **The activation chain** (`src/core/activation-chain.ts`): one serializer for everything that touches the shared active store. Activations are supersedable; link and download flows never are.
- **Auth split** (keel, pinned 2026-07-13): account routes use `Authorization: Bearer ow_a_...`; world routes use `API-Key` (+ `API-Pin` on writes). A revoked world key has its own toast ("reopen from the sidebar", not "check your PIN").
- **Deferred**: watched worlds (`ow_r_`), device-code sign-in.

## World-meta sync (S262; design and gate record `Forge/Notes/Archive/2026-07-13-worldmeta-sync-design.md`)

The eleven OnlyWorlds world fields in `world.json` (`description`, `image_url`, `time_basic_unit`, `time_format_names`, `time_format_equivalents`, `time_range_min`, `time_range_max`, `time_current`, and since 1.21 the units `length_unit`, `mass_unit`, `distance_unit`) sync through keel's `GET|PATCH /api/v2/world`, so the now-line travels between devices. **`name` is deliberately NOT synced**: the local world name and the server world name are separate identities (`api.world_name` is a display mirror).

- **The meta step** (`executeMetaStep`) opens every round: ONE `GET /world` (meta never enters `/changes`; `updated_at` is a skip hint only), then a per-field three-way against `meta_baseline` in sync-state. Server-only changes apply to disk; local-only changes go out as ONE partial PATCH of the changed fields; contested fields follow the policy (local-wins pushes; pause-and-review skips both ways, persists `meta_conflicts`, and the conflict modal gains world-settings rows resolved by `resolveMetaConflict`).
- **An absent baseline is a seed round, never a PATCH**: adopt the server's values as baseline, fill locally EMPTY fields from the server, push nothing. Locally set fields push next round.
- **Canonical equality**: disk `undefined` equals the wire empties (`''`, `[]`, `null`); the encoder sends typed empties, so a cleared now goes out as `time_range_current: null`. Kernel: `src/sync/world-meta-sync.ts` (pure, unit-locked; owns the one disk/wire rename `time_current` to `time_range_current`).
- **The baseline advances per field** (fields the PATCH sent plus fields the pull applied), so a concurrent server change to an untouched field still surfaces. `resetSyncBaseline` clears it.
- `writeWorldMeta` is serialized store-wide; pull-applied meta reaches `state.active.meta` through `refreshMetaCache`. Meta-only rounds surface honestly (`meta_pushed`/`meta_pulled`, "Pulled world settings").
- **The units compare trimmed** (kind `label`): keel trims them before storing, so an untrimmed local value (a hand edit) would never equal its echo and would re-PATCH every round. Labels only: the element view prints them after the nine numbers the standard gives a unit (`src/core/world-units.ts`), nothing converts.
- atlas guards lengths before the wire: `image_url` at 1024, `time_basic_unit` at 128, each unit at 64 after the trim (keel 422s past its caps). A read-only key's 403 has its own reason (`read_only_key`).

## Multiple places, one world

- **Separate folders, same credentials** (two machines, or atlas plus the web app): each place has its own FolderStore and engine and they reconcile through the server; conflicts follow the policy.
- **One folder through Dropbox or similar**: not supported. The lock (conv. 13) keeps two atlas tabs of one browser apart, but a file-sync service racing two machines is outside what atlas can see.
- **Other tools writing the folder** (an AI agent, a text editor, git): their edits survive atlas's writes (conv. 92) and are shown by the live folder (conv. 111). Whether an outside edit syncs is decided by its `local_updated_at`; the manifest with content hashes is designed, not built (`Forge/Notes/2026-09-28-shared-surface-design.md`).

## Tests and known edges

The engine suites are `tests/integration/sync-engine.*.test.ts` over `FakeOwApiClient` (`tests/fixtures/fake-ow-client.ts`, which speaks `/changes` by default since S365) and the MSW handlers in `tests/msw-handlers.ts`; kernel tests run the real store on `tests/fixtures/fake-fs.ts`; `dev/fake-keel.mjs` serves manual live checks. The open soft edges (event-once `skipIds` on `/changes`, list items missing `updated_at`, the cascade-delete crash window, stuck pins, the open-editor meta race) are listed in SYNC_NOTES "Known soft-edges".
