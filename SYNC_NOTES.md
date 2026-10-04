# Atlas Sync — Architecture Notes

Companion to `DESIGN_SYNC.md` (how the engine runs today). This file captures **lessons + patterns** from building the sync layer — the WHY behind decisions, the bug categories we've hit, and what to watch for. Read this before touching sync code.

**⚑ DIALECT NOTE (v2 port, 2026-07-12)**: atlas element CRUD now speaks the keel **v2** dialect through `OwV2ClientAdapter` (thin fetch, no SDK). The frozen wire contract lives in `Forge/Notes/Archive/2026-07-12-v2-probed-facts.md`; the /changes pull design + its adversarial-gate resolutions in `Forge/Notes/Archive/2026-07-12-v2-changes-pull-design.md`. Sections below marked HISTORY (v1) describe the retired v1 dialect — kept because the failure PATTERNS they teach still apply.

---

## The wire format vs disk format mismatch (most-bitten gotcha)

**v2 (current)**: the wire uses BARE schema names both directions — `{location: "<id>"}`, `{friends: ["<id>"]}` — which is exactly atlas's disk shape for content types. The only conversion left is the SPATIAL rename: atlas stores pin/marker with `map_id`/`zone_id` on disk while the schema (and wire) use bare `map`/`zone` (pin's `element_id`/`element_type` ARE the schema names, unchanged). The rename table is derived from `FIELD_SCHEMA` via `relationFieldsFor` (diskField vs schemaField) in `ow-v2-client-adapter.ts` — never hardcoded.

- **Read**: `adaptV2Record` stamps `type`, renames bare `map`→`map_id` / `zone`→`zone_id` for pin/marker, passes everything else through verbatim (including extension fields).
- **Write**: `toV2WireShape` strips server-managed fields + `ATLAS_LOCAL_ONLY_FIELDS` + sync stamps, renames the spatial fields the other way, and lets wire extensions + custom namespace fields ride.
- Old shapes are HARD errors now: `map_id` in a v2 write body → 422 "Unknown field: map_id". No silent ignoring.

**Extension fields ride the wire on v2**: `atlas_*` / `x_*` / `shadow_*` round-trip verbatim (keel extension passthrough). The strip discipline SPLIT accordingly — `ATLAS_LOCAL_ONLY_FIELDS` (page blocks, richtext, media bindings: stripped on write, preserved on pull) vs `ATLAS_WIRE_EXTENSION_FIELDS` (zone visual prefs: sent on write, server-value-lands on pull, preserved only when the server record lacks the field). Both stores' `applyServerRecord` implement the split; getting it wrong makes multi-device zone styling a silent one-way no-op.

HISTORY (v1): the old wire wanted `_id`/`_ids` suffixes via the SDK's `prepareRelations`, served nested `{id,name}` stubs on read, and 400'd on ALL extension fields. The v1 `OwClientAdapter` encoding those rules is retired.

If you ever touch the adapter, run `ow-v2-client-adapter.test.ts`.

---

## Server-assigned ids — DORMANT under keel (id-swap machinery kept dead-but-safe)

**Keel preserves client ids** (v1 AND v2, probed live 2026-07-12): `crypto.randomUUID()` v4 ids land verbatim; a duplicate POST returns 409 `id_conflict`; v2 PUT is create-or-replace upsert. **EXCISED (cleanup bout, 2026-07-12 evening)**: the engine's create-path swap branch and the engine `onIdSwap` hook are gone (`rewriteIdReferences` survived in Route 2's merge until S367 moved Route 2 onto the re-key kernel) — a server that reassigns an id on CREATE now produces a loud per-element failure (contract violation; nothing stamped, retried next round). Route 2's name matches (same name+type, different ids across machines) remain real; since S367 they move through the re-key kernel and `rekeyLiveUi`. The legacy v1 `OwClientAdapter` and its dedicated suites were retired in the same bout (its 5 flow suites migrated to `statefulV2Handlers`/the v2 adapter); the v1 `worldsync` create-world route stays (still v1 in production).

HISTORY (pre-keel): the old Django server assigned its OWN UUID v7 on CREATE, overriding client v4 ids — everything below was load-bearing then.

### Symptoms when not handled

History (pre-keel), no longer the code path. keel keeps client ids, so this cannot happen on the engine path today.

- Local file has Location at client-uuid-v4. Server has it at server-uuid-v7.
- Next pull: server lists at v7. Local file at v4 has `server_updated_at` set but isn't in seenLocalIds. → **Server-delete detection fires falsely** ("vanished from server" modal).
- Foreign keys in OTHER local elements still point at v4. Push of those elements 400s with "Invalid FK".

### The id-swap fix

History (pre-keel), no longer the code path. The engine's create-path swap was excised 2026-07-12; Route 2's name matches are the only id moves left besides the Settings re-key, and both run on the re-key kernel (DESIGN_SYNC "Make Online").

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

For Route 2 merge (`mergeLocalIntoApi`), bidirectional FK between matched + new locals once required a 5-phase order ("Merge phase ordering" below, now history). Since S367 the kernel moves ids first, so the server phase is plain: downloads, creates, matched updates.

---

## Merge phase ordering (the hardest piece)

History (S367), no longer the code path: Route 2 moves name-matched locals onto their server ids with the re-key kernel BEFORE any server call ("Route 2 on the re-key kernel" below), so every server decision is same-id and no rewrite runs between phases. What follows is why the old order existed.

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

The write pattern is `one writable → close → read-back verify` (S368: the old `write tmp → verify → write final → verify` doubled the window in which a file held by another program (OneDrive, antivirus) refuses the swap at `close()`, which Chromium reports as an `InvalidStateError`; such a refusal is retried whole for about two seconds, `isFileBusyError`). Two quirks shape it:

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

The server rejects PATCH/POST bodies that include any of these server-managed fields (v2: 422 `invalid_request`, "X is read-only."):
- `type` (immutable; server infers from URL path)
- `world` (server-side relation, can't be set by client)
- `created_at` (server stamps once)
- `updated_at` (server stamps every write)

Plus the sync metadata + LOCAL_ONLY extension fields:
- `local_updated_at`, `server_updated_at` (sync metadata)
- everything in `ATLAS_LOCAL_ONLY_FIELDS` (image_media_id, page blocks, richtext, …)

All stripped in `toV2WireShape`. WIRE extension fields (`ATLAS_WIRE_EXTENSION_FIELDS`) + custom namespace fields are NOT stripped — v2 round-trips them. `id` is the only nuanced one: KEPT on CREATE/PUT (client id preserved), STRIPPED on PATCH (path parameter).

If you see a 422, check the wire body (logged via `logWireError` on failure) and the error's `param` field — it names the offender.

---

## CREATE order: topo-sort by FK dependency (Bout U)

(Added Bout U, smoke-driven post-Bout-T. Captain hit it during a fresh
Make-Online: local Character with `birthplace` pointing at a local Location.
Character pushed first → real OW returned `400 Invalid FK: birthplace_id —
referenced Location with id '...' does not exist`. The chain self-healed
on the next round, but the console noise was alarming.)

### The contract

`pushPhase` runs Kahn's algorithm over the CREATE batch before iterating:

1. Scan every string + string-array field on each candidate (skip the meta
   fields: `id, type, name, local_updated_at, server_updated_at`).
2. Any value matching another candidate's id is a dep edge.
3. Topologically sort: dependency-free elements emit first; processing each
   element decrements its dependents' in-degrees.
4. Cycle fallback: anything not emitted by the sort is appended in original
   order. Logged via `console.info` so it's visible-but-not-alarming.

### Why scanning, not FIELD_SCHEMA

`FIELD_SCHEMA` from `@onlyworlds/sdk` gives strict knowledge of which fields
are relations. We don't use it — the scan-all-strings approach mirrors what
`rewriteIdReferences` does, which has worked across schema evolutions. If a
field's value happens to match another element's id, it's treated as a dep.
UUIDs are 36 chars; accidental collisions with descriptive strings are
astronomically unlikely.

### Doesn't fix the cycle case

If A references B and B references A (genuine FK cycle), neither can go
fully first. Atlas falls back to input order; ONE side still 400s on first
push, then `rewriteIdReferences` propagates the post-id-swap state, next
round retries. Same as pre-Bout-U behavior, scoped to the rare case.

### Combined with id-swap

History (pre-keel), no longer the code path. The server no longer reassigns ids, and CREATE batches of two or more go through `/bulk`.

The id-swap path (server enforces UUID v7, overrides client's v4) still
fires. After Location's CREATE produces a server-assigned id,
`rewriteIdReferences` updates Character's local file before Character's
push happens in the same round. Character's body carries the swapped id;
no FK error. Verified by the `assignServerIds` test case.

---

## Auth-failed rounds bail + surface (Bout T)

(Added Bout T, session 205. Smoke surfaced the "lying pill" case: Captain made a world online via Make-Online, then deleted it on onlyworlds.com web. Atlas's api_key became a dead reference. Subsequent edits hit 401, pill went `saving → synced`, user thought work was saved — wasn't.)

### The trap

The previous design had push collect per-element failures into `result.failures` without distinction. After the loop:
- Engine state → `idle` (regardless of failures).
- `onSyncResult` fired only for conflicts.
- Per-element failures got `console.warn`'d but never surfaced.

For mixed failures (one bad pin in a batch, otherwise healthy world) that's fine — the user fixes the bad data and moves on. For **systemic** failures like auth-down, every element fails the same way, the round produces zero successes, but the engine still showed "synced." That's the lying-pill class — silent in production, eventually surfaces as "wait, none of my edits are on the server."

### The contract

When `pushPhase` or `pullPhase` sees a 401/403:

1. **Bail the round.** Set `authBlocked = true` and `break` out of the loop. The next iteration's `if (authBlocked) break` short-circuits. The fakes throw on every CRUD op when `__inject_auth_failure(true)` is set, so the bail-after-first behavior is testable.
2. **Don't persist sync-state.** A partial round produces wrong derived state (server-delete detection would falsely flag types we didn't reach). Skip the `writeSyncState` call when auth-blocked.
3. **Surface via state.** Caller (runPushOnly / runPullOnly / runSync) checks `result.auth_blocked` and calls `setAuthError()` instead of transitioning to idle. `setAuthError` sets `paused=true` AND state to `{kind: 'error', message: 'authentication failed...', recoverable: true}`. The pill maps `error` to red display.
4. **Bail pull when push auth-blocks.** `runSync` skips the pull phase if push hit auth — same dead key would 401 there too.
5. **Surface via toast.** `sync-attach.emitConflictToasts` (despite the name) now checks `result.auth_blocked` first and fires the dedicated "sync paused: authentication failed..." error toast pointing to settings. The conflict-handling code stays below.
6. **Surface flush-on-attach failures.** Previously logged to console only. Now toasts "couldn't sync N pending change(s)" when post-attach push has failures with no successes. Auth case gets the dedicated toast; generic failures get the generic message. (S365: the success toast reads "Uploaded N change(s) that were waiting in the folder", neutral about who made them; above 50 changed elements the flush holds and asks instead, DESIGN_LAWS conv. 117.)

### Detection

`isAuthError(err)` matches the SDK's `API Error 401:` / `API Error 403:` prefixes plus generic 401/403/Unauthorized/Forbidden substrings, mirroring `isNotFoundError`. Exported so tests can assert.

### Recovery

Two paths:
- **PIN change in settings**: `wireIdentityTab` already calls `attachSyncEngine` on PIN change, which spins up a fresh `SyncEngine` instance. The new instance starts in idle. The old engine's error state doesn't bleed across.
- **Unlink from API**: settings → World tab → "unlink from api" calls `detachSyncEngine`. World becomes local-only. No more sync attempts.
- **Test connection** (existing): explicit `client.worlds.get()` call. Doesn't auto-recover — informs the user. If it succeeds, the original auth-error was likely transient; manual refresh from API would re-engage.

### What atlas CAN'T detect (server-side limitation)

When the OW server deletes a world, the api_key for it becomes invalid. Every subsequent call returns 401 — same response as wrong PIN or revoked key. Atlas can't distinguish "deleted" from "bad creds" without a server-side signal (e.g., a 410 Gone with `{"error": "world_deleted"}`). Worth asking Skeld for; for now we treat all three the same, because the recovery path is the same.

### Bail-the-round is not bail-the-engine

After auth failure, the engine is paused but the SyncEngine instance is alive. Test introspection methods (`listConflicts`, `listServerDeletes`, `getState`) still work — they just read disk. This matters for the conflict-review modal staying functional even when the world is auth-blocked (user might want to inspect what conflicts were pending before they unlink).

---

## Clearing a field — `null` or `''`, never `undefined`

(Added Bout S, post-pressure-test session 205. Closed both H1 and H2 from the audit.)

The natural way to say "this field has been cleared" in JS is `undefined`. **Don't.** `JSON.stringify` drops `undefined` keys silently at every layer atlas writes:

1. `FolderStore.updateElement` spreads `{...existing, ...patch}`, but `writeJsonAtomic` then runs `JSON.stringify` to disk — the field vanishes from the file.
2. Engine push re-reads the file (no field) and builds the PATCH body via `stripSyncFields` — body has no field either.
3. The adapter's `toWireShape` also explicitly drops undefined (`if (v === undefined) continue`).
4. Real PATCH semantics: a missing key means "no change to this field." Server keeps the old value.

Result: the UI shows the field cleared locally, the server keeps the relation/text/number, and the next time someone opens that world on a different device (or via the web app), the "removed" link is still there.

**The contract**:

- Single-link relations cleared via the `×` button → `null`. Adapter's `prepareRelations` maps it to `<field>_id: null`; the server clears.
- Multi-link relations cleared → `[]` (empty array). Already worked before this bout because JSON preserves arrays.
- Number fields blanked in the popover → `null`.
- Text-short / text-long fields blanked → `''` (empty string). The server applies the empty string as the new value.

**The fakes mirror this**: `FakeOwApiClient.createElement` and `updateElement` strip undefined from the body before the spread-merge, so unit tests match what real OW does over the JSON wire. Without this, the buggy UI path passed unit tests but failed against MSW + real OW.

**Verified by**: `tests/integration/sync-engine.fieldClear.test.ts`. The "trap" tests assert undefined doesn't propagate (documents the rule); the "contract" tests assert null/'' do. If anyone re-introduces undefined-as-clear in element-detail or field-edit-popover, the user-visible bug returns but unit tests stay green — so audit the UI write sites when working in this area. (A future Playwright spec asserting "click × on chip → field also cleared on server" would close the regression loop at the UI layer.)

---

## Pull-time conflict semantics

Pull detects a per-element conflict when:
- `remote.updated_at > local.server_updated_at` (server moved since our baseline)
- AND `local.local_updated_at > local.server_updated_at` (local moved since baseline)

HISTORY (pre-keel): the old Django server didn't bump `updated_at` on m2m_changed signals (`auto_now` skips them); Skeld shipped a signal-receiver fix in May 2026. That server was replaced by keel on 2026-07-11, so the receiver note no longer applies — whether keel bumps `updated_at` on m2m changes is UNVERIFIED (2026-07-12 sweep). If "server-side change not propagating" appears, probe keel's m2m semantics first.

Atlas-side workaround if the server ever under-bumps: edit a non-m2m field on the same element on web to force a bump, then refresh.

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
- `push detected server-side delete {id, type}` — pull-time AND push-time symmetric detection (Bout 8)
- `push hit auth error — bailing round {id, type, message}` — 401/403 from push, engine → error (Bout T)
- `pull hit auth error — bailing round {type, message}` — 401/403 from pull, engine → error (Bout T)
- `FK cycle detected in CREATE batch — falling back to input order {unsortedCount}` — genuine cycle in topo-sort (Bout U)
- `self-healed pin missing element_type {pinId, elementType}` — legacy pin fixed at push time (Bout V.5)
- `tombstone target already gone (404) — clearing` — 404-on-DELETE treated as success (Bout W)
- `post-pull-conflict push skipped: world switched during defer` — world-switch race guard fired (Bout V)
- `[atlas:folder] resetSyncBaseline complete {elementsCleared, apiStripped}` — unlink severed sync history (Bout Y)
- `[auto-pull]` prefix logs — scheduler lifecycle: `scheduling periodic pull / stopping scheduler / tick: firing / tick: skipping {reason} / became visible after a cadence window — firing catch-up pull`

`logWireError` in adapter prints the wire body on 4xx — invaluable when server rejects. Pin failures specifically extract `_id` / `_ids` / `_type` fields inline for quick diagnosis.

---

## Atlas-extension fields and the `applyServerRecord` overlay contract

Superseded in part by the v2 split: only `ATLAS_LOCAL_ONLY_FIELDS` are preserved from the local file on pull; for `ATLAS_WIRE_EXTENSION_FIELDS` the server value wins. `ATLAS_FIELDS.md` is the register.

(Added Bout V, session 202.)

Some fields live ONLY on local element files — the OW server has no concept of them. Today: `image_media_id`. Future: anything else atlas adds. The canonical list is `ATLAS_LOCAL_EXTENSION_FIELDS` in `src/core/constants.ts`. Two contracts depend on it:

1. **Adapter strips on WRITE** — but only the LOCAL-ONLY half. Under v2 (`OwV2ClientAdapter`, the production dialect since 2026-07-12) the list is split in `src/core/constants.ts`: `ATLAS_LOCAL_ONLY_FIELDS` are stripped, while `ATLAS_WIRE_EXTENSION_FIELDS` (the zone visuals) are SENT and round-trip through keel's extension passthrough. The retired v1 `OwClientAdapter.toWireShape` stripped the combined list, because that server 422'd on every unknown field; do not carry the v1 rule forward. *(Corrected 2026-07-26: this line named the dead adapter and stated the dead rule.)*
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

> **UPDATE (v2 port, 2026-07-12; noted S308):** superseded. The v2 adapter (`ow-v2-client-adapter.ts`) fully cursor-walks every page via `?cursor=`, and `getIncompleteListTypes()` suppresses server-delete detection only when a walk is genuinely incomplete. The "first-page-only" limitation above was a v1 constraint and no longer holds; a reader trusting it would re-implement pagination that already exists.

---

## Chain-CREATE FK gap in Route 2 merge (closed Bout V)

History (S367): `applyIdSwapsToBody` is gone with the old phase order; creates now read their bodies from disk after the kernel moved every id.

(Added Bout V, session 202.)

`mergeLocalIntoApi`'s phase 4b-2 processes all `createDecisions` sequentially. The five-phase comment claims phase 4b-3's `rewriteIdReferences` corrects any server-assigned-id mismatches before phase 4b-4's matched UPDATEs. True — but only for LOCAL files.

If two new locals reference each other (Bob, Carol with `Carol.friends = [bob.localId]`), iteration 1 (Bob) succeeds with server-assigned `srv-bob` and registers an idSwap. Iteration 2 (Carol) re-fetches Carol's local file — but no file-level rewrite has run between iterations, so Carol's body still has `friends: [bob.localId]`. Server receives the stale FK. Phase 4b-3 then rewrites Carol's LOCAL file to `[srv-bob]` — but the server stays stale.

Fix: `applyIdSwapsToBody` rewrites in-memory bodies before each adapter call, using the current `idSwaps` Map. Belt-and-suspenders on top of the per-iteration re-fetch — covers CREATE and (defensively) matched UPDATE branches. Idempotent for bodies whose FKs are already current.

**Why the engine's `pushPhase` doesn't need this** (History (pre-keel), no longer the code path; the engine no longer swaps ids at all): it called `rewriteIdReferences` INSIDE the iteration loop after each id-swap. The next iteration's `getElement` returns post-rewrite content. Merge's 5-phase ordering rewrites between phases instead, so the gap is unique to merge.

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

History, no longer the code path. The engine has no `onIdSwap` hook, and `handleIdSwap` / `applyIdSwapToUi` were deleted in S367 with their last caller: Route 2 now moves ids through the re-key kernel and the screen follows once through `rekeyLiveUi` (`sync/rekey-run.ts`), which reloads elements from disk instead of grafting (the graft below was rejected by the re-key gate, lens 3 F7).

(Added Bout 9, session 204.)

When push CREATE produces a server-assigned id different from the local one (id-swap path — real OW enforces UUID v7), the engine moves the local file `old_id` → `new_id`, rewrites every ref pointing at `old_id`, and silently deletes the old file. Without UI propagation, the user's `state.ui.selectedElementId` + URL hash still reference `old_id`, and the middle pane renders atlas's own empty-state message: **"element <old_id> not found in this world."** Looks like a server error; isn't.

**The rule**: engine emits an `onIdSwap({old_id, new_id, type})` callback at the moment of swap. `sync-attach.handleIdSwap` migrates:
- `state.ui.selectedElementId` (if equals `old_id`)
- URL hash `/element/<old>` → `/element/<new>` (preserves `/map/<mid>/` context if present)

**Atomic transition rule (Bout 9b)**: use `setState` to update BOTH `data.elements` (substituting the entry's id) AND `ui.selectedElementId` in a single state transition. Two separate `patchSlice` calls produce two renders — the in-between one has `ui.selectedElementId = new_id` but `data.elements` still has `old_id`, causing a brief empty-state flash before the engine's subsequent `refreshElementsCache` reconciles at idle.

The in-memory id-substitution carries the old entry's content with the new id grafted. This is fine: the CREATE body was what local already had; the on-disk file at `new_id` (via `applyServerRecord`) has identical content + stamped `server_updated_at`. `refreshElementsCache` at engine idle reconciles to the on-disk version shortly after, with no user-visible change.

Verified by a regression test that subscribes + counts notifications (dual-patch produces 2, atomic `setState` produces 1).

**Other id-swap call sites**: none since S367 (`mergeLocalIntoApi` lost `idSwaps` and `onIdSwap`; see "Route 2 on the re-key kernel"). `resolveConflict('overwrite-mine')`'s CREATE branch never id-swapped.

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

Updated through session 257. Listed by surface — none are cutover blockers.

### v2 close-gate deferrals (2026-07-12, documented not fixed)
- **skipIds on the /changes path is event-once**: an op for a push-conflicted id is skipped for the whole round and the cursor passes it; a genuinely newer third-party op for that id in the SAME round is never re-seen (the full-list pull re-derived it next round; the cursor path doesn't). Requires a 3-device same-round race; self-heals on any later edit to the element. Fix shape when it matters: scope the skip to ops at-or-below the conflict's seq, or drop skipIds on the changes path and rely on !serverChanged idempotence + conflict dedup.
- History (pre-keel), no longer the code path. CLOSED 2026-07-12: the v1 adapter and its dedicated suites were deleted and the flow suites moved to the v2 fake. Was: **~7 flow suites still drive the v1 OwClientAdapter** (initial-download, knowledge-sync, zoneMarkerOrder, sharing-sync, make-online legacy, ow-client-adapter*): their integration confidence for the v2 production dialect is partial (the v2 adapter has its own direct suite + the bulkMerge/bulkPush/changesPull suites). Migrate them to statefulV2Handlers / the v2 fake in the SAME named cleanup bout that deletes the v1 adapter + excises id-swap.
- **list items missing `updated_at`** are skipped-and-marked-incomplete (defensive, mirrors the /changes hardening); whether keel's list serializer can ever omit it is an open Skeld question.

### Sync engine internals
- ~~**Concurrent-edit race on autosave**~~ CLOSED: an edit landing while its push is in flight stays dirty (S360 H1, `store/sync-stamp.ts`, convention 96); a create adopted after a lost response compares content and stays dirty when it differs (S361, `adoptServerCopy`). Pull-apply rides the per-id chain with its race check inside the slot (S361, `applyServerRecordIfUnchanged`). Push still stamps only, never applies the response body (by design).
- **`pushPhase` UPDATE doesn't apply server response back to local**: refuted-by-design from session-205 pressure-test (push asserts local is correct). Revisit only if OW server starts normalizing fields server-side.
- History (pre-keel), no longer the code path. **`resolveConflict` CREATE path id-swap**: corner case — resolve-conflict on never-synced element doesn't swap if server returns a different id. Not tripped in practice.
- ~~**`rewriteIdReferences` bumps `local_updated_at`**~~ GONE (S367): the function went with the old Route 2. The kernel's referrer rewrites stamp too, and the server phase then uploads them (a referrer is created or matched in the same run).

### Reliability edges
- **Cascade-delete loop crash leaves inconsistent state** (pressure-test Path 10): FS Access API has no transactions. Pre-collect tombstones into one write before unlinking files would harden. Worst case today: "confusing server-delete modal on next sync."
- **Stuck-pin auto-cleanup**: repeated `Map not found` 404s when a pin's map was deleted server-side currently require manual delete. Auto-clear after N failures would help.

### Polish
- **Per-element refresh API method**: today's per-type refresh (right-click filter chip) is the workaround. A dedicated single-element refresh would be a precise escape hatch.
- **Drag-from-element-list pin drop**: right-click + create covers primary spatial flow.
- **`getElement` O(types) probe**: walks 22 directories per lookup. Cache id→type in FsFolderStore for hot-path operations. (Partly mitigated by session-220's `fileIndex` cache; cross-type cold lookups still iterate.)
- **Conflict log review UI for resolved/historical conflicts**: today's modal handles only active conflicts.

### Closed during sessions 205-207 (kept here for searchability)
- **H1+H2** — field-clear propagation → fixed by Bout S (`null`/`''` sentinels, fakes encode JSON-wire semantics).
- **T-class** — "lying pill" on auth failure → fixed by Bout T (bail-the-round + error state).
- **U-class** — `400 Invalid FK` chain noise → fixed by Bout U (topo-sort CREATEs).
- **C1** — Make-Online transient engine id-swap UI propagation → fixed by Bout X.
- **C2** — auto-pull scheduler doesn't recognise `error` state → fixed by Bout X.
- **Unlink leaves stale sync metadata** → fixed by Bout Y (new `resetSyncBaseline()`).
- **M1** — `engine.resume()` doesn't flush pending writes → fixed by Bout AA.
- **Api-vs-local name divergence invisible** → fixed by Bout Z (`api.world_name` cached + Settings row).
- **Pre-T2-smoke F1** — flush-on-attach raced pull-on-activate via shared inFlight lock, silently no-op'd → fixed by Bout BB (sequence flush BEFORE pull via single async IIFE in `attachSyncEngine`). Convention #25.
- **M7** — `engine.resume()` reset `last_sync_at` to null, pill briefly read "never synced" → fixed by Bout BB (engine tracks `lastSyncAt` privately, `resume()` restores). Convention #26.

### Closed during session 221
- **M2** — pill-click during debounced push toasted "already up to date" misleadingly → fixed by gating the toast on both `pulled.*` AND `pushed.*` counts.
- **M3** — user edit during pull race-overwrites → fixed by re-reading element before `applyServerRecord` in `pullPhase`.
- **M4** — stale conflicts persist after policy flip to local-wins → fixed by clearing persisted conflicts in the settings-panel policy-change handler.
- **M5** — modal actions silent no-op on world switch mid-modal → fixed by `capturedWorldId` snapshot in `ConflictReviewModal` and `ServerDeleteReviewModal`.
- **H3** — `pinPlacement.elementId` not migrated on id-swap → fixed in `handleIdSwap`. (rightTabs[].mapId migration was already in place.)
- **Pagination** — `listElements` now walks DRF pages by `?offset=N` until `count` is reached; safety cap at 100 pages.
- **L1-L6 cosmetic** — `'drain-blind'` references in `sync-attach.ts` default-policy fallback replaced with `'local-wins'`. Other legacy strings stay in registry-load migration paths intentionally.

### Engine-unavailable diagnosis (Bout 6 W3)

When a UI surface tries to run a sync action and `getCurrentSyncEngine()` returns null, the user needs an actionable message — generic "Engine not ready" misled Captain into thinking the bug was the api-link itself when the actual cause was a missing PIN.

`diagnoseSyncUnavailable()` in `sync-attach.ts` returns a structured reason:
- `'no-active-world'` — sidebar should pick a world
- `'local-only'` — sync isn't applicable
- `'pin-missing'` — api-linked world, PIN field empty in registry → user fixes in settings
- `'attached-but-paused'` — reserved for future use
- `'engine-not-ready'` — fallback (attach in flight, race during world switch, etc.)

`surfaceSyncUnavailable(toasts)` in `src/ui/sync-toasts.ts` consumes the reason and emits the right toast. For `pin-missing` it also `navigate(settingsHash(worldId, 'identity'))` to deep-link the user to the fix.

**Convention**: every UI surface that gates on `getCurrentSyncEngine()` should call `surfaceSyncUnavailable(toasts)` on the null path. Don't toast inline. Sites today: pill, worlds-sidebar refresh, settings refresh-from-API, conflict-review-modal open, server-delete-modal open, elements-sidebar filter-chip right-click.

### Atlas-local fields must be stripped on the wire (session 221 live bug)

History (pre-keel), no longer the code path. The v1 `OwClientAdapter` is gone, and the zone visuals now SYNC; the v2 rule is `ATLAS_FIELDS.md`. The lesson (fakes must reject what the real server rejects) stands.

Captain's bug: fresh world, drew zones, made online, push failed:
```
POST /marker/ 500 (Internal Server Error)
Failed to create Marker: (1452, '...foreign key constraint fails (`zone_id`)...')
```

Root cause: zone push was sending `atlas_shape: 'polygon'` to the server. Real OW has a strict field validator and rejected the body with 400. The zone failed silently (recorded in `result.failures`, but the CREATE never landed server-side). Markers then attempted CREATE with `zone_id` pointing at a zone that didn't exist on the server → MySQL FK constraint 1452.

Why tests didn't catch it: the fakes (FakeOwApiClient + MSW handlers) silently spread unknown fields into their in-memory bucket. atlas_shape leaked through, was stored, and FK lookups against the local server bucket succeeded. The bug only surfaced against real OW's strict validation.

**The contract**:
1. `ATLAS_LOCAL_EXTENSION_FIELDS` in `src/core/constants.ts` lists every field atlas stores locally but never sends to the server.
2. `OwClientAdapter.toWireShape` strips them via the `ATLAS_LOCAL_FIELDS` set (which includes the extension list).
3. The fakes (`statefulOwHandlers` LIST/CREATE/PATCH + `FakeOwApiClient`) MUST reject these fields with 400 — mirrors real OW so any new atlas-local field forgotten in the extension list fails its tests immediately.
4. Same on `applyServerRecord`: the extension fields must survive overlay on pull (the local file's stored value is preserved when server gives an update on that element).

When adding a new atlas-only field: append it to `ATLAS_LOCAL_EXTENSION_FIELDS`. Both ends (write-strip + pull-preserve) pick it up automatically. The fake guards (`rejectAtlasLocalFields` in `fake-ow-client.ts`, the ATLAS_LOCAL list in `msw-handlers.ts`) also need the field name added so regressions surface in tests.

Was verified by the v1 adapter's atlasLocal suite, deleted with the adapter; the v2 split is locked by `tests/integration/ow-v2-client-adapter.test.ts` ("LOCAL_ONLY stripped from writes").

### Dangling-link routing (invalid_link → server-delete review) — v2 rewrite of the old FK routing

Keel rejects any write referencing a nonexistent element with a STRUCTURED error: HTTP 400, `{error: {code: "invalid_link", param: "<field>", message: "<field> references <Type> '<id>' which does not exist."}}` (the /bulk non-atomic variant appends " in this world."). `parseInvalidLinkError` keys on the code and extracts the Type AND the exact dangling id **from the message itself** (gate 10.4 — never a body lookup: multi-link fields would need array disambiguation and wire/disk names differ on spatial types).

Atlas hits this when an element references a peer (zone, map, friend) that existed server-side at some prior point (locally baselined) but was deleted out-of-band. On match:
1. Look up the orphan peer by the message's id (`routeDanglingPeer`).
2. If the peer has `server_updated_at` set, route to `server_deletes` review (same UX as UPDATE-404 routing).
3. Record the child element as a `failure` with a clearer message so the user knows why it didn't land.

**Applies to CREATE, UPDATE, and /bulk item errors alike** — keel enforces links honestly on EVERY write. (The v1-era routing was CREATE-only because v1 silently dropped dangling multi-links on update; that silent-loss class is gone.)

User picks `keep + re-push` → peer re-CREATEs next round → child element succeeds. Or picks `delete locally` → orphan cleaned up.

HISTORY (pre-keel): the old server surfaced this as `500 (1452, 'foreign key constraint fails ...')` MySQL text; the old `parseFkConstraintError` matched that shape and went structurally dead at the keel cutover — the S256 sweep's one CONFIRMED break, fixed by this rewrite.

Verified by `tests/integration/sync-engine.fkConstraint.test.ts` (4 tests, incl. the new UPDATE case).

---

## /bulk CREATE path (v2) — atomic batches close the cyclic-push class

`pushPhase` routes CREATE batches of ≥2 through `POST /bulk` when the client supports it (`bulkCreate` on the OwApiClient seam): ONE atomic request, server-side fixpoint FK resolution INCLUDING CYCLES. The Sikelia class (152/196 locations in one cyclic reference web — per-element retries can never converge) lands in a single round-trip; 700 items probed fine. Route 2 merge's create phase does the same (`processBulkCreates` in make-online.ts).

Protocol (gate 10.6, rollback verified live):
- `errors: true` under atomic → NOTHING persisted server-side, even for items reporting 201. Stamp NOTHING; fail the bad items (invalid_link items get dangling-peer routing; id_conflict items self-heal by adopting the server baseline); retry the survivors ONCE atomically; then surface.
- Timestamp backfill (gate 10.1): /bulk items return `{status, id}` with no `updated_at` — NEVER stamp client now() (clock skew = mass spurious pulls or never-pulled elements). ≤20 creates → per-element GET; larger → one cursor list-walk per pushed type. Skeld ships a per-item `updated_at` echo next keel session; delete the backfill then.
- The Kahn topo-sort (`sortCreatesByDependencies`) survives ONLY as the fallback path's orderer (single creates + clients without bulkCreate).

## /changes cursor pull (v2) — explicit delete ops replace absence inference

`pullPhase` dispatches to `pullPhaseChanges` whenever the client has `pullChanges`: a cursor walk of the per-world change feed (`{cursor, changes, has_more}`, continuation via `since=`). Deletions arrive as EXPLICIT ops — the absence-inference server-delete detection (and its incomplete-list false-positive class) doesn't exist on this path. Full design + the 3-lens gate resolutions (delete-then-recreate revival, cursor/side-effect atomicity, the stop() abort latch, single-sourced timestamps, the non-advancing-cursor trap): `Forge/Notes/2026-07-12-v2-changes-pull-design.md`. The legacy full-list pull remains as the fallback and keeps the `getIncompleteListTypes` suppression guard.

**Test fakes speak /changes (S365)**: `FakeOwApiClient.pullChanges` is ON by default, because production's adapter always has it; 25 test files had been running a full-list pull no user gets. Tests of the full-list fallback opt out by name with `__enable_changes(false)` (the serverDelete pagination trio and dedupe case, one authBlocked case, the pullConflictPolicy dedupe case); they go when `pullPhaseFullList` does. `client.changesPulls` counts feed pages, so "no pull ran" is assertable without `list` calls. `__server_evict` drops a record WITHOUT a delete op (the feed never reports it).

⚠ The /changes continuation param is **`since=`**, not `cursor=`. HISTORY: keel originally ignored unknown query params silently (a wrong param name replayed page 1 forever with has_more:true); since Skeld's v2 tail (2026-07-12 evening) unknown params get a loud 422 naming the param, killing the trap at the root. The adapter's advance-verification stays as belt-and-suspenders. Both fakes encode the 422.

## Rewind guard + the v1 validation-lane retirement (v2 tail, 2026-07-12)

Skeld's v2 tail (all five S257 asks, live on production same day) closed the remaining v1 remnants and the last /changes soft-edge:

- **`GET /api/v2/world`** replaced the v1 SDK `worlds.get()` validation lane: all five validation sites (link modal, make-online both routes' fallbacks, new-api-world fallback, settings Test Connection, atlas-root link flow) now call `OwV2ClientAdapter.getWorld()` via `buildV2Adapter`. `buildOwClient` is deleted; the SDK survives ONLY for FIELD_SCHEMA statics. `OwV2Error` keeps the `API Error NNN:` message prefix, so the sites' status-regex error mapping was untouched.
- **Rewind guard**: every /changes response now carries `head` (the world's current change_seq). Normal operation never rewinds (§8 law); the one legal rewind is disaster restore-from-backup. The engine persists `changes_last_seq` (highest APPLIED seq, advanced in the same lockstep as the cursor) and, when a page's `head` is strictly below it, drops cursor + seq memory and cold-walks from the epoch (retention law makes the cold walk complete-state; upserts idempotent, deletes explicit). Single-reset-per-round latch prevents a pathological head from looping. Regression: `sync-engine.changesPull.test.ts` rewind describe-block; fake seam `__rewind_op_log(maxSeq)`.
- **Retention** is now written law (no compaction horizon) — the /changes cold-walk bootstrap for INITIAL DOWNLOAD is unblocked if we ever want it (currently initial download stays on the list walk; revisit only if it earns its keep).

## Read-only engines — view-only worlds (S264)

Worlds linked with a READ key (`api.read_only` in registry + world.json) run a
pull-only engine: `readOnly` in SyncEngineOptions. The double wall:

1. **Engine**: `pushOnce()` resolves empty immediately and `requestPush()` is a
   no-op — every push trigger funnels through those two (debounce, flush,
   resume, online-event, the local-wins convergence push), so ONE guard closes
   them all. `syncNow()` degrades to `pullNow()`. The meta step pull-applies
   but never PATCHes (`pushedNames` forced empty). Flush-on-attach is skipped;
   pull-on-activate runs UNCONDITIONALLY for view worlds (sync-attach).
2. **Store seam**: `setViewOnly(true)` on the store (armed at activation +
   link) throws "This world is view-only" from every UI mutator. The engine's
   channels bypass: `applyServerRecord`/stamps/sync-state (never guarded),
   `deleteElement` with `silent` (the server-delete channel), and
   `writeWorldMeta(patch, { fromSync: true })` (new opts param — all four
   engine meta-write sites pass it; both stores implement the guard).

The adapter omits the `API-Pin` header entirely when the pin is empty (keel
reads are keyless-PIN; an empty header is a malformed credential). Regression:
`sync-engine.readOnly.test.ts`. Live-verified against the fake keel: read-key
download + edit-block + a wire log with zero writes.

## World-meta sync — the meta step (S262, gated)

`world.json`'s eight OW wire fields sync via `GET|PATCH /world` (full design + all ten gate resolutions: `Forge/Notes/2026-07-13-worldmeta-sync-design.md`; the shipped shape is summarized in DESIGN_SYNC.md "World-meta sync"). Engine-side facts a future session needs:

- **`executeMetaStep()` opens every round** (all three run paths — a setNow debounce push must carry the now). Consequence for tests: every engine round now emits ONE `getWorldMeta` call; call-log assertions filter it (`sync-engine.push.test.ts` writeCalls) and dead-creds rounds bail AT THE META READ, before any element attempt (authBlocked/bulkPush suites re-locked to that truth; the element-loop first-bail is still covered via a per-element injected 401).
- **Baseline lives in sync-state** (`meta_baseline`, canonical snapshot; `meta_server_updated_at` informational; `meta_conflicts` under pause-and-review). Seed rule: absent baseline → adopt server + fill local-empties, NEVER PATCH that round.
- **Keel bump nuance** (source-dug): element writes NEVER bump world.updated_at (`update_fields=["change_seq"]`); v2 PATCH /world is the only runtime writer that names it — but a re-PATCH of IDENTICAL values still bumps (keel doesn't diff). Atlas's partial-diff means we never send identical values.
- **Soft-edges (documented, not built)**:
  - *Open-editor pull race*: a pull landing while the home description popover is open advances the baseline under the editor; the user's save then reads as a clean local change and overwrites the unseen server edit without a conflict flag (only matters under pause-and-review; window is seconds). Fix shape if it ever bites: capture baseline at popover-open, compare at save.
  - *Import dirties meta with no push trigger*: import writes wire fields but doesn't requestPush — the NEXT round's diff catches it (meta step runs every round), so it's only stuck if the user imports and never edits/syncs again. Accepted.
  - *MSW read-only-key modeling*: only FakeOwApiClient models the 403 write/read split (`__inject_write_permission_error`); MSW handlers model 401 blocking only.

## Extension fields carry any JSON shape verbatim (S267, source-verified)

The 2B contract's §5b flagged that every shipped wire-extension field was a
scalar and keel's passthrough had never been probed with a nested OBJECT
(`atlas_calendar` is one). Resolution, S267:

- **Live probe blocked**: keel-staging's `create-world-external` now 400s every
  unauthenticated payload variant (the endpoint moved under account auth
  hardening) — no disposable-world lane without real account credentials.
- **Answered from keel source instead** (keel@e64f270, the S262 precedent):
  `elements/serialize.py` takes namespaced fields verbatim (`extensions[key] =
  value`, zero shape validation), every element model stores them in
  `extensions = models.JSONField(default=dict)`, and the read path renders
  "extensions … as top-level fields, verbatim" (§4 one-shape). PATCH merges
  extensions per-KEY (whole-value replacement — fine, atlas always sends the
  full config).
- **Consequence**: nested objects round-trip by construction; calendars sync
  with zero new machinery. `readCalendarValue` still tolerates JSON-string
  configs from foreign tools.
- **Owed**: one live smoke (save a calendar on an api-linked world, pull on a
  second device) whenever real credentials are at hand — source truth is
  strong, wire truth is stronger.

## The body cache + parallel index (speed bout, 2026-07-19)

FsFolderStore keeps parsed element bodies in memory (`bodyCache`) from the
index pass on; `listElements`/`getElement` serve structuredClone copies
instead of re-walking disk (measured: 3.5s per call → 15ms at 1,500
elements; cold open 18.5s → ~3s). Load-bearing rules:

- **Every body write sink updates the cache** (createElement,
  writeElementAndRename, stampServerUpdatedAt, clearServerBaseline,
  resetSyncBaseline; unlinkElement deletes). The warm-vs-cold equivalence
  e2e (`folder-store-fs.spec.ts`) catches a missed sink by construction.
- **The cache owns its entries and serves clones** — callers can never
  mutate cache internals; write sinks store clones (`cacheSet`).
- The one-writer lock keeps other ATLAS tabs out; other TOOLS write the
  folder freely (an AI agent, a text editor, git), and the cache handles them
  in three layers: since S359 their edits SURVIVE atlas's writes (every write
  merges into the file as it is on disk, `readForWrite`, DESIGN_LAWS conv. 92);
  since S361 a file that will not parse is never written over
  (`CorruptFileError`); since S364 they are SHOWN (the live folder,
  `rescanDisk`, conv. 111: a stat pass against the stamps atlas recorded,
  on focus, visibility, revive and Ctrl+K "reload from disk"), and a pull
  checks the disk stamp before it overwrites (`applyServerRecordIfUnchanged`).
- **Index builds run concurrently** (64-way file reads from handles
  collected in one enumeration; types in parallel) with an in-flight
  promise guard per type. A closed store's in-flight build BAILS (zombie
  guard) — it must not repopulate cleared maps or tidy-write a folder
  whose lock was released. Activation supersede is guarded in
  worlds-sidebar (`stillActive`): the cache hit path can't throw post-
  close the way the disk path did, so a slow world's resolve would
  otherwise stomp the newly-activated world's state.

## Background tidy + parked locks (2026-07-19, revises the S246 open-time tidy)

The filename-convergence tidy no longer runs INSIDE the open path: Captain's
live find — a foreign folder (script-written names, 1,669 elements, OneDrive
disk) froze activation for its entire rename run, blocking the activation
chain. `buildIndexFor` now indexes/caches files AS THEY ARE (filenames are
presentation; body id is identity) and `scheduleTidy` converges names in the
background: same occupancy/id-sort/case-fold rules, each rename riding the
per-id write chain (serializes against user edits), `this.root` re-checked
per step, `awaitTidies()` for tests. Parked stores STALE their lock
heartbeat on park (epoch timestamp): a parked world is takeable by another
tab instantly, no 90s ghost-prompt after tab close; unpark still verifies
tab_id and cold-reopens on takeover. RESIDUAL (documented, accepted): the
lock claim/unpark read-then-write is a pre-existing TOCTOU with a
milliseconds window; a real fix needs atomic create-if-absent semantics the
FS Access API doesn't offer — the heartbeat-mismatch check catches the
aftermath within one beat.

## Meta step precheck on push rounds (2026-07-19, revises S262 cadence)

`runPushOnly` passes `skipIfLocalClean`: when a meta_baseline exists and
local disk meta equals it field-for-field (`metaEquals`), the round skips
the `GET /world` entirely — element autosaves no longer pay a serial
world-meta round-trip. Deliberate freshness narrowing: push rounds used to
opportunistically PULL server meta as a side effect; now meta freshness
belongs to pull/sync rounds only — the same opt-in-pull semantics elements
have always had. Seed rounds never skip (baseline absent); a precheck
error falls through to the full step; local-dirty meta always runs the
full step and pushes.

---

*Authored mid-session 201 (2026-05-13) after Phase 3.5 mega smoke. If you're reading this in a future chat, this is what the sync engine wanted you to know.*

## Foreign ids, the hold, and the re-key (S363, gated twice)

keel preserves client ids and refuses a create whose id lives in another world. Before S363 atlas could only say so (the S360 toast); now it records the refusal and can give the element a new id. DESIGN_LAWS conventions 105-108 hold the rules; the lessons that cost the most:

- **"Foreign" needs evidence.** A single POST 409s for a same-world id too (a create that landed while its response was lost), so a 409 is foreign only when the read-back ANSWERED "not here". The old classifier also counted a failed read-back (503, 401), and a re-key of such an element would have duplicated it on the server. /bulk upserts same-world ids, so a bulk `id_conflict` is foreign as keel says.
- **A foreign entry expires when the id is sent and not refused again**: the other world may have freed the id, and the create can land with its backfill failing (no baseline yet). Keeping it would have offered a re-key of an element already on this server.
- **`pause()` is not a hold.** A round in flight checks `stopped`, never `paused`, and `resume()` is one shared flag. `hold()` waits for the round and is its own counter. The way OUT of a hold needed as much care as the way in: republish an auth error (not "Paused"), let the network pause be lifted while held (ask the engine, not the pill), and never publish idle under a hold.
- **The journal gate is a round's first disk touch**, so its throw must settle like any round error or the pill sits on "Saving" for good.
- **The mock cannot see directories.** The crash matrix passed on MockFolderStore while the real store deleted loose media, left a body-type/directory mismatch on disk, and ignored a cross-layout shadow copy. The composition gate ran the REAL FsFolderStore on an in-memory FS (`tests/fixtures/fake-fs.ts`) to find them; keep a real-store variant of any kernel test.
- **Discard is an undo, not a forget.** Forgetting a journal left new elements naming new elements never written, and twins with nothing to say which to keep.

## Route 2 on the re-key kernel (S367)

The old Route 2 decided "local O is server N" from disk in a match phase, told the UI at once, and then walked a flat id rewrite between five server phases. Three lessons made the rebuild:

- **A matcher that re-derives identity from disk cannot read a half-done move.** A crash between writing N and removing O left both; on the rerun the id-tail order of the two filenames decided whether O re-matched or fell to a create, so the server got a second Alice about half the time (S365 lane A H9). The fix was not a smarter matcher but an order: the journaled kernel moves O onto N BEFORE any server call, nothing matches against a world while a journal exists, and after the kernel every server decision is keyed by an id that never changes again.
- **A one-pass matcher lets a same-named local steal an id match** (H10), and `'   '` is truthy (H11). `planMerge` runs ids over every local before names, and an empty normalised name never matches. A name shared on one side is skipped and reported, not guessed (Captain).
- **The UI moved before the disk** (H7): favourites, camera, URL and a grafted element on ids the folder never got when the merge then failed. Now nothing moves before the kernel; `onRekeyed` lets the screen follow the moment the disk has.

The runner shares the Settings re-key's single flight (`withIdMoveLock`), which also waits out a live-folder pass already running (`settleLivePass`), and runs the link step inside the lock. A kernel failure is finished from its journal and merged again; a second failure leaves a journal whose `origin: 'merge'` makes the copy say to run Make online again. Records: design `Forge/Notes/2026-09-29-s365-orient/lane-a-route2.md`, recheck `Forge/Notes/2026-09-29-s366-orient/lane-b-route2-recheck.md`, gate `Forge/Notes/2026-09-29-s367-gate/`.
