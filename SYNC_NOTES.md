# Atlas Sync — Architecture Notes

Companion to `DESIGN.md`. This file captures **lessons + patterns** from building the sync layer — the WHY behind decisions, the bug categories we've hit, and what to watch for. Read this before touching sync code.

---

## The wire format vs disk format mismatch (most-bitten gotcha)

OnlyWorlds API wire format uses `_id` / `_ids` suffix on relation fields:
- `birthplace_id` (single_link, string)
- `species_ids` (multi_link, array of strings)
- Some fields are LITERALLY named with `_id` in `FIELD_SCHEMA` (e.g. pin's `element_id`).

Atlas disk format uses **bare names** matching `FIELD_SCHEMA`:
- `birthplace: 'id'`
- `species: ['a', 'b']`
- Pin is the exception: stored with `_id` suffix locally (matches wire).

### How the conversion lives

- **Read**: `OwClientAdapter.adaptRecord` collapses nested relation objects (`{birthplace: {id, name}}`) AND wire-shape (`{birthplace_id: 'id'}`) to bare names. Pin keeps suffix.
- **Write**: `OwClientAdapter.toWireShape` runs SDK's `OnlyWorldsClient.prepareRelations(body, type)` to add suffix. Pin SKIPS prepareRelations (would double-suffix `element_id` → `element_id_id`).

### Symptoms when this goes wrong

- "Link import doesn't work" — adapter wrote `_id` suffix on disk, UI reads bare names, finds nothing
- "Link write-back doesn't work" — body sent without prepareRelations, server doesn't recognize bare field names, silently ignores
- "Pin `element_id_id` double suffix" — running prepareRelations on pin

If you ever touch the adapter, run the entire `ow-client-adapter.test.ts` suite.

---

## Server-assigned ids (UUID v7 enforcement)

The OW server now assigns its OWN id on `POST /element/`, overriding the client-provided UUID. Probably enforcing UUID v7 format (newer than `crypto.randomUUID()` v4).

### Symptoms when not handled

- Local file has Location at client-uuid-v4. Server has it at server-uuid-v7.
- Next pull: server lists at v7. Local file at v4 has `server_updated_at` set but isn't in seenLocalIds. → **Server-delete detection fires falsely** ("vanished from server" modal).
- Foreign keys in OTHER local elements still point at v4. Push of those elements 400s with "Invalid FK".

### The id-swap fix

Both `pushPhase` and `mergeLocalIntoApi`'s CREATE branch do this:

```ts
const response = await client.createElement(type, body);
if (response.id !== local.id) {
  // Re-key local file: write at server's id with current content + stamps.
  await folder.applyServerRecord(type, { ...body, id: response.id }, response.updated_at);
  // Remove old file silently — no tombstone (server never had old id).
  await folder.deleteElement(local.id, { silent: true });
  // Rewrite refs to old id across all OTHER local elements.
  await rewriteIdReferences(folder, new Map([[local.id, response.id]]));
}
```

The `silent` deletes are critical — a tombstone would queue a DELETE for the old id on next push, which would 404 server-side (server never had that id).

Test fixtures simulate this via `assignsServerIds: true` on `statefulOwHandlers` and `FakeOwApiClient.assignServerIds = true`.

---

## Push order matters: CREATEs before UPDATEs

If you create Location locally and link a Character to it (`birthplace`), then push:
- Bad order: Character UPDATE first → server rejects ("Invalid FK: birthplace doesn't exist")
- Good order: Location CREATE first → server has it → Character UPDATE finds the FK

`pushPhase` partitions `changed` into [no-server-baseline (CREATEs)] then [has-server-baseline (UPDATEs)]. Within each partition, iteration order doesn't matter for non-chain cases.

For Route 2 merge (`mergeLocalIntoApi`), bidirectional FK between matched + new locals required a **5-phase order** — see "Merge phase ordering" below.

---

## Merge phase ordering (the hardest piece)

Route 2 merge has a unique circular-FK problem:
- Matched element (e.g. Splashworth on api) may reference new locals (Bob, Carol) via friends/rivals
- New locals may reference matched element

To make both directions land server-side correctly:

```
Phase 1: rewriteIdReferences with match-phase idSwaps
         (so any local that referenced matched-old-id now points at matched-server-id)
Phase 2: CREATEs (re-fetched local — body has post-rewrite FKs)
         Each CREATE may register MORE idSwaps (server assigns v7 ids)
Phase 3: rewriteIdReferences again (catches CREATE-time swaps, propagates to matched element's local refs)
Phase 4: Matched UPDATEs (re-fetched local — body has post-rewrite FKs)
Phase 5: Final rewriteIdReferences cleanup
```

Critical: **every decision step re-fetches its local element** before sending body. The original snapshot from listElements() carries stale ids if any in-loop rewrite touched its fields.

Regression test in `make-online.test.ts` — "matched element references new local elements via FK".

---

## Conflict policy semantics

**Two policies only** (post Phase 3.5 redesign — the three-policy model was muddled):

| Policy | Push conflict | Pull conflict | UI surface |
|---|---|---|---|
| `local-wins` (default) | Push local anyway, server overwritten | Skip applying server change for that element, local stays | One-shot toast per round. NO badge, NO modal. |
| `pause-and-review` | Skip push, persist conflict | Skip applying, persist conflict | ⚠ badge on pill. Click → modal with overwrite-mine / pull-theirs per row. |

**Symmetric across push and pull.** Same divergence, different direction.

**Under local-wins, pull-conflict triggers an immediate follow-up push** (via `setTimeout(0)` to defer past the in-flight pull). Without this, user sees "skipped pulling X" but never sees convergence happen — would have to wait 5s for next autosave.

**Conflicts are NOT persisted to sync-state under local-wins** — the divergence is already resolved (server overwritten). Persisting would falsely fire the badge.

**Legacy values** `drain-blind`, `pause-on-conflict`, `ask` are normalized to the new names. `registry.loadRegistry` migrates on read.

---

## State refresh post-sync (preventing UI staleness)

After any folder write, the in-memory `state.data.elements` cache must be refreshed for the UI to see the new state. Three call sites:

1. **UI handlers** (element-detail, modals): after `folder.updateElement` or `createElement`, call `folder.listElements()` and `patchSlice('data', { elements })`.
2. **`sync-attach.publishSyncState`**: when engine state becomes `idle` (after every sync round), fire `refreshElementsCache()` automatically. Catches id-swaps, pulled updates, etc.
3. **`pullNowAndRefresh`**: explicit refresh after manual pull. Also fires conflict count refresh and auto-opens server-delete modal if applicable.

The race risk: if user is mid-edit during a refresh, the cache snapshot might overwrite their in-flight DOM state. We avoid this by NOT re-rendering element-detail during a user edit (the popover owns its own field state).

---

## writeJsonAtomic — Chromium FS Access API quirks

The atomic write pattern is `write tmp → verify → write final → verify`. Two quirks make this necessary:

1. **createWritable doesn't always truncate by default** — explicitly call `await writer.truncate(0)` before `write(json)`. Without this, shorter new content leaves trailing bytes from old content, producing malformed JSON.

2. **close() can report success before content lands on disk** in some Chromium versions. We do a read-back verify (`await handle.getFile()).text()`) after close, comparing to the JSON we wrote. If they diverge, we throw with diagnostic — surfaces silent FS failures.

`applyServerRecord` ALSO does its own readback log (info-level) for forensic comparison.

---

## In-flight promise dedup gotcha

`SyncEngine.syncNow`, `pushOnce`, `pullNow` ALL share one `inFlight` field for dedup:

```ts
syncNow(): Promise<SyncResult> {
  if (this.inFlight) return this.inFlight;  // ← returns SAME promise regardless of method
  this.inFlight = this.runSync().finally(() => { this.inFlight = null; });
  return this.inFlight;
}
// pushOnce + pullNow have the same pattern
```

Symptom: if you're inside `runPullOnly` (e.g. inside `onSyncResult` callback) and try to call `pushOnce()`, it sees `inFlight` is still set (you're inside the pull) and returns the pull promise. The push never actually runs.

Fix: defer with `setTimeout(0)` past the `.finally` that clears inFlight:

```ts
setTimeout(() => {
  void engine.pushOnce().catch(...);
}, 0);
```

Used in `emitConflictToasts` for the auto-push-after-pull-conflict-under-local-wins flow.

---

## Server-managed fields in write bodies (server 422)

The OW server rejects PATCH/POST bodies that include any of these server-managed fields:
- `type` (immutable; server infers from URL path)
- `world` (server-side relation, can't be set by client)
- `created_at` (server stamps once)
- `updated_at` (server stamps every write)

Plus atlas-local fields the server doesn't know about:
- `local_updated_at`, `server_updated_at` (sync metadata)
- `image_media_id` (atlas extension)

All stripped in `toWireShape`. `id` is the only nuanced one: KEPT on CREATE (client UUID either preserved or overridden by server with swap), STRIPPED on UPDATE (path parameter).

If you see a 422, check the wire body (now logged via `logWireError` on failure).

---

## Pull-time conflict semantics

Pull detects a per-element conflict when:
- `remote.updated_at > local.server_updated_at` (server moved since our baseline)
- AND `local.local_updated_at > local.server_updated_at` (local moved since baseline)

The OW server has a known limitation: **`updated_at` doesn't bump on m2m_changed signals** by default (Django `auto_now` skips). Skeld shipped a server-side fix in May 2026 that explicitly bumps `updated_at` on m2m changes via a signal receiver. If you see "server-side change not propagating," verify the receiver is still wired server-side.

Atlas-side workaround if the receiver ever regresses: edit a non-m2m field on the same element on web to force a bump, then refresh.

---

## Double-link block (one local : one api world)

A single atlas instance never has two local worlds linked to the same api world. Use case for "two locals same api": multi-device (one atlas per device). Not "two atlas-managed locals on the same machine."

`findLinkedWorld(reg, apiWorldId)` checks the registry. Both `linkExistingApiWorldInRoot` and `MakeOnlineModal` (both routes) call it after `client.worlds.get()` validates creds. On hit: throw inline error pointing user to the existing world.

Excludes `active.worldId` from the check (so re-running make-online on the same world is a no-op rather than self-block — defensive).

---

## Debug log lines worth knowing

All sync-related console logs use `[atlas:sync]` prefix. Grep this in DevTools.

Useful sequences:
- `engine attached {world, apiWorldId, policy, ...}` — engine started up
- `push scheduled (debounce 5000ms)` — autosave timer set
- `debounce fired → pushOnce` — autosave firing
- `push complete {creates, updates, deletes, conflicts, failures}` — outcome
- `pull conflict TYPE/id {fields, baseline}` — divergence detected per element
- `local-wins: pull detected conflict, firing pushOnce to converge` — the auto-push
- `server assigned new id on create {type, localId, serverId}` — id-swap triggered
- `resolveConflict pull-theirs ... applying server record {descriptionPreview}` — modal action firing

`logWireError` in adapter prints the wire body on 4xx — invaluable when server rejects.

---

## Atlas-extension fields and the `applyServerRecord` overlay contract

(Added Bout V, session 202.)

Some fields live ONLY on local element files — the OW server has no concept of them. Today: `image_media_id`. Future: anything else atlas adds. The canonical list is `ATLAS_LOCAL_EXTENSION_FIELDS` in `src/core/constants.ts`. Two contracts depend on it:

1. **Adapter strips on WRITE** (`OwClientAdapter.toWireShape` via the local `ATLAS_LOCAL_FIELDS` Set). Otherwise the server 422s on unknown fields.
2. **Both stores preserve on `applyServerRecord`**. Read existing element first; preserve every field in `ATLAS_LOCAL_EXTENSION_FIELDS` that has a value; then overlay the server record. Otherwise pulling an update silently destroys the local binding — e.g. a Map's `image_media_id` would vanish on every server-side description edit, orphaning the local media file.

When adding a new atlas-only field: add it to `ATLAS_LOCAL_EXTENSION_FIELDS`. Both ends pick it up automatically (write strip + pull preservation). No per-field code changes needed elsewhere.

This contract protects: pull-phase updates, pull-phase creates over existing (defensive), `resolveConflict('pull-theirs')`, Route 2 merge `matched-same-id` policy b/c paths, Route 2 merge `matched-swap` policy b/c paths, and `initialDownloadAll`. One contract, six call sites — fixed by changing the contract.

---

## Server-delete detection requires pagination awareness

(Added Bout V, session 202.)

`pullPhase` builds `seenLocalIds` from `client.listElements(type)` returns. For any local element with `server_updated_at` set that's NOT in `seenLocalIds`, it records a server-delete and queues the auto-open review modal (default ON). Under default settings, the user is one click away from "delete locally" — a destructive action.

**If listElements is paginated, `seenLocalIds` is incomplete.** Page-2+ elements are alive on the server but absent from the set. Naive detection would falsely flag them as deleted → user prompted to destroy live data.

Atlas now guards: `OwApiClient.getPaginatedTypes()` (optional method) reports which types had `count > results.length` on their most recent list. `pullPhase` consults it and skips server-delete detection for those types. The guard is per-type: a single pull can have some types paginated (suppress detection) and others not (detect normally). When a type drops below the page cap (e.g. user deleted elements), detection resumes automatically on the next pull.

The `OwClientAdapter` maintains the paginated-types Set as part of its hot state. Each `listElements` call decides per-type whether the response was paginated. Test fakes can either implement `getPaginatedTypes()` or omit it (engine falls back to empty Set; useful when the fixture controls server state directly and pagination is irrelevant).

**Full pagination support (load page 2, 3, ...) is still deferred to 3.6+**. The Bout V fix is a SAFETY guard, not a feature — atlas only sees first-page data for paginated types, but at least it doesn't actively destroy what it can't see.

---

## Chain-CREATE FK gap in Route 2 merge (closed Bout V)

(Added Bout V, session 202.)

`mergeLocalIntoApi`'s phase 4b-2 processes all `createDecisions` sequentially. The five-phase comment claims phase 4b-3's `rewriteIdReferences` corrects any server-assigned-id mismatches before phase 4b-4's matched UPDATEs. True — but only for LOCAL files.

If two new locals reference each other (Bob, Carol with `Carol.friends = [bob.localId]`), iteration 1 (Bob) succeeds with server-assigned `srv-bob` and registers an idSwap. Iteration 2 (Carol) re-fetches Carol's local file — but no file-level rewrite has run between iterations, so Carol's body still has `friends: [bob.localId]`. Server receives the stale FK. Phase 4b-3 then rewrites Carol's LOCAL file to `[srv-bob]` — but the server stays stale.

Fix: `applyIdSwapsToBody` rewrites in-memory bodies before each adapter call, using the current `idSwaps` Map. Belt-and-suspenders on top of the per-iteration re-fetch — covers CREATE and (defensively) matched UPDATE branches. Idempotent for bodies whose FKs are already current.

**Why the engine's `pushPhase` doesn't need this**: it calls `rewriteIdReferences` INSIDE the iteration loop after each id-swap. The next iteration's `getElement` returns post-rewrite content. Merge's 5-phase ordering rewrites between phases instead, so the gap is unique to merge.

---

## Pin requires `element_type` on the wire (closed Bout V.5)

(Added Bout V.5, session 202.)

Real OW returns `400 — element_type must be provided when element_id is specified` on any `POST /pin/` body that has `element_id` but no `element_type`. The fakes didn't simulate this rule, so the gap was invisible until Captain's live smoke. Both fakes now enforce it (`statefulOwHandlers` + `FakeOwApiClient`).

**Three things to know when touching pin code**:

1. **Every pin write site MUST populate `element_type`** from the referenced element. The map-tab handlers in `map-tab.ts` look it up via `state.data.elements` (or store fallback). The contextual right-click create path receives the type from `ElementCreateModal.onCreated(id, type)`.

2. **Engine self-heal exists for legacy pins**. `pushPhase` checks for pin missing `element_type` before each CREATE, looks up the referenced element's type, writes it back via `folder.updateElement`, then pushes. Users with on-disk pins from old code don't need to re-place them.

3. **Pin-with-deleted-element-or-map fails gracefully**. If the referenced element is gone locally, self-heal can't resolve `element_type` — failure recorded, push continues with other elements. If the referenced map is gone server-side, the push 404s with "Map not found" and ends up in `failures`. Either way the system doesn't auto-corrupt — orphan pins surface as visible push failures the user can act on.

**Generalization — encode real-server validation rules in fakes when smoke surfaces them**: this is a permanent practice rule, not just a one-shot. When the live server returns a 4xx with a clear message that our fakes don't catch, the FIRST move is to encode the rule into `statefulOwHandlers` (MSW) AND `FakeOwApiClient` BEFORE fixing the caller. Two benefits: (a) the fix lands with a regression test that locks the rule in; (b) future test code that violates the rule fails immediately. The fakes get more faithful over time without expensive contract-testing infrastructure.

---

## UPDATE 404 means "server has lost it" — route to server_deletes (closed Bout 8)

(Added Bout 8, session 204. Companion to the DELETE 404 rule below.)

When push's pre-update GET returns null (adapter caught 404 → null) OR the PATCH itself throws 404 (race between GET and PATCH), the server doesn't have the record. Naive handling: try the PATCH anyway → 404 → record as `failures` → user sees raw error message + element keeps trying every subsequent push.

**The rule**: in `pushPhase` UPDATE branch, treat "server doesn't have it" symmetrically with pull-time server-delete detection. Add the element to `sync_state.server_deletes`. The same review modal that opens for pull-detected deletes also opens for push-detected ones — user picks `keep + re-push` (clears baseline, immediately pushes as CREATE) or `delete locally` (silently removes the file).

Three vectors produce this state:
1. Out-of-band server-side delete (another atlas instance, web app, admin).
2. Element previously synced to a NOW-defunct api world (e.g. world re-linked, baseline carried over from prior linkage).
3. Race between pre-update GET (200) and PATCH (404 — element deleted in the gap).

Same fix covers `resolveConflict('overwrite-mine')` — that path also does an UPDATE and is reachable if the user resolves a conflict on a server-deleted element. The catch routes to `server_deletes`, clears the conflict, returns silently.

**Fakes mirror real OW**: `FakeOwApiClient.updateElement` throws `API Error 404: <id> not found in this world.` on unknown id. MSW PATCH handler returns 404 with body. `isNotFoundError` regex (in `sync-engine.ts`) catches both. Same Bout V.5 fakes-mirror-real discipline.

**`keep + re-push` triggers immediate push**: the server-delete modal's `keep` action calls `engine.pushOnce()` right after `resolveServerDelete`. Without this, the cleared baseline sits until the next autosave trigger — could be never. Sharing the engine's `inFlight` lock makes this safe under concurrent triggers.

---

## ID-swap propagates to UI state + URL (closed Bouts 9 + 9b)

(Added Bout 9, session 204.)

When push CREATE produces a server-assigned id different from the local one (id-swap path — real OW enforces UUID v7), the engine moves the local file `old_id` → `new_id`, rewrites every ref pointing at `old_id`, and silently deletes the old file. Without UI propagation, the user's `state.ui.selectedElementId` + URL hash still reference `old_id`, and the middle pane renders atlas's own empty-state message: **"element <old_id> not found in this world."** Looks like a server error; isn't.

**The rule**: engine emits an `onIdSwap({old_id, new_id, type})` callback at the moment of swap. `sync-attach.handleIdSwap` migrates:
- `state.ui.selectedElementId` (if equals `old_id`)
- URL hash `/element/<old>` → `/element/<new>` (preserves `/map/<mid>/` context if present)

**Atomic transition rule (Bout 9b)**: use `setState` to update BOTH `data.elements` (substituting the entry's id) AND `ui.selectedElementId` in a single state transition. Two separate `patchSlice` calls produce two renders — the in-between one has `ui.selectedElementId = new_id` but `data.elements` still has `old_id`, causing a brief empty-state flash before the engine's subsequent `refreshElementsCache` reconciles at idle.

The in-memory id-substitution carries the old entry's content with the new id grafted. This is fine: the CREATE body was what local already had; the on-disk file at `new_id` (via `applyServerRecord`) has identical content + stamped `server_updated_at`. `refreshElementsCache` at engine idle reconciles to the on-disk version shortly after, with no user-visible change.

Verified by a regression test that subscribes + counts notifications (dual-patch produces 2, atomic `setState` produces 1).

**Other id-swap call sites not yet wired**: `mergeLocalIntoApi` accumulates `idSwaps` and applies file-level rewrites between phases, but doesn't emit `onIdSwap` for UI propagation. Merge runs inside the make-online modal — user typically isn't viewing a specific merged element when the modal closes. Defer wiring unless smoke surfaces a flash there. Same for `resolveConflict('overwrite-mine')` CREATE branch (also doesn't id-swap currently — separate corner case).

---

## DELETE 404 means "already gone" — clear the tombstone (closed Bout W)

(Added Bout W, session 203.)

Three vectors produce tombstones for ids the OW server never knew (or no longer knows):

1. **Never-synced create-then-delete** — user creates a local element, deletes it before any push. The tombstone carries a client-side id the server never received.
2. **Cascade-delete of never-synced dependents** — deleting a map cascades tombstones to its pins. If any pin was created within the autosave debounce window (5s) and immediately gets cascaded, its tombstone is also orphan.
3. **Out-of-band server delete** — another client / admin deleted the element while we were offline or between pulls.

Real OW (DRF default) returns 404 on `DELETE /element/{unknown_id}/`. Naive handling treats this as a hard failure and retains the tombstone → every subsequent push retries the same DELETE → 404 → tombstone retained → forever.

**The contract**: 404 on DELETE means "server doesn't have it" — that IS the desired post-condition of a DELETE. Treat it as success and clear the tombstone. `sync-engine.ts:pushPhase` checks `isNotFoundError(err)` in the tombstone-iteration catch block and clears the tombstone via the same path as 2xx success.

**Why fakes had hidden this for so long**: both `FakeOwApiClient.deleteElement` and the MSW DELETE handler silently no-op'd on unknown ids, returning 204 regardless of presence. Tests passed while real OW would accumulate orphans. Both fakes now mirror real-OW 404-on-unknown — any future code that mistakenly retains an unknown-id tombstone fails its tests immediately.

**Generalizes the Bout V.5 pin-element_type lesson**: whenever real-server smoke surfaces a 4xx that fakes don't catch, the FIRST move is encoding the rule into both fakes (`statefulOwHandlers` + `FakeOwApiClient`) BEFORE fixing the caller. The fix lands with a regression test that locks the rule in; future test code violating the rule fails immediately. The fakes get more faithful over time without expensive contract-testing infrastructure.

---

## Cross-world push race in conflict-toast defer (closed Bout V)

(Added Bout V, session 202.)

When pull-phase detects a conflict under `local-wins`, sync-attach defers a `pushOnce()` via `setTimeout(0)` to escape the engine's `inFlight` lock. The setTimeout callback reads `currentEngine` at fire time — so a world switch between schedule and fire would push on the new world's engine while the old world's local divergence stays unconverged.

Fix: capture `currentWorldId` at schedule time, compare to current at fire time. If they differ, log and bail. The original conflict will be re-detected on the next pull of the original world.

---

## Known soft-edges to revisit (3.6+)

Updated Bout V — pagination guard added; full pagination still deferred.

- **Concurrent-edit race on autosave**: applying server response post-push would catch normalization but risks overwriting user's mid-push edit. Today we stamp-only (eventually consistent via next pull).
- **Pagination (full)**: `listElements` reads the first page only. Bout V added a SAFETY guard so server-delete detection doesn't run on paginated types — but atlas still only sees first-page data. Implement load-more / page-cursor for worlds >200 elements per type.
- **Per-element refresh button**: useful escape hatch for "force pull this one element" especially around the m2m gotcha if the server fix regresses.
- **Per-world conflict policy override**: global only today. Settings → Sync sets default for everyone.
- **Server-delete confirm setting wiring**: setting exists, auto-modal exists, but a checkbox + UI to control might benefit from a "review later" affordance (currently just hides the modal but doesn't clear the badge).
- **`getElement` O(types) probe**: walks 22 directories per lookup. Cache id→type in FsFolderStore for hot-path operations.
- **`rewriteIdReferences` bumps `local_updated_at`**: causes harmless re-push on next sync after id-swap. Add a "rewrite without bumping" mode if the trailing-push cost ever shows up in profiling.

---

*Authored mid-session 201 (2026-05-13) after Phase 3.5 mega smoke. If you're reading this in a future chat, this is what the sync engine wanted you to know.*
