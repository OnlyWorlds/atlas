# Atlas — Next session pickup

*Updated 2026-05-14, session 205 close.*

---

## Where we are

Phase 3.5 sync engine is feature-complete + hardened across five sessions of live-smoke + regression-test work:
- **Session 201** — Phase 3.5 mega smoke: two-policy redesign + 19+ interlocking sync fixes.
- **Session 202** — Bouts V + V.5: pre-smoke verification-exo + pin element_type wire fix.
- **Session 203** — Bout W round 1: pin-drag autosave + orphan tombstones + worldId-capture test + cadence visibility unstick.
- **Session 204** — Bouts 7–9b: pull toast + log cleanup + paused-cloud icon (B7), keep-pushes-now + UPDATE-404 → server_deletes routing (B8), id-swap UI propagation + atomic state transition (B9 + B9b).
- **Session 205** (this) — Bouts S/T/U: pressure-test pass, then three smoke-discovered fixes.
  - **Bout S** — Field-clear propagation (H1+H2 from pressure-test): UI clear actions send `null` / `''` instead of `undefined`, so the server sees the clear via the PATCH body. Fakes encode JSON-wire `stripUndefined` semantics.
  - **Bout T** — Auth-failed rounds bail + surface: 401/403 from any push or pull bails the round immediately, transitions engine to `error` state, fires dedicated toast. Recovery is a fresh engine (PIN change in settings). Smoke-validated against real OW (Captain deleted a world server-side, atlas correctly stopped lying).
  - **Bout U** — Topo-sort CREATEs by FK dependency: Kahn's algorithm orders CREATEs so dependencies push before references. Eliminates the `400 Invalid FK` chain that previously self-healed but produced alarming console noise. Smoke-validated.

**Tests**: 258 vitest passing (was 234 at session 204 close — **+24 net new tests** this session across 3 new test files).
**Build + typecheck**: clean.
**Bundle**: 346.96 KB JS / 96.46 KB gzipped.

## First moves next chat

1. **`/wake atlas-tool`** — loads identity + tool context.
2. **Read `BOUT_R_SMOKE.md`** — Tier 1-4 structure. Bout-S (field-clear), Bout-T (auth), Bout-U (Make-Online chain) verification checks are folded into the right tiers.
3. **Resume smoke** — Tier 1 hasn't been formally run end-to-end this session. Captain ran ad-hoc Make-Online flows during Bout T/U validation; that doesn't substitute for the structured tier walkthrough.
4. If T1 passes: T2, T3, T4, then cutover.

## Bout closures (session 205)

### Bout S — Field-clear propagation
- ~~Single-link clear (× chip) silently kept on server~~ — `element-detail.ts:289` now passes `null` (not `undefined`).
- ~~Text/number clear (empty popover) silently kept~~ — `field-edit-popover.ts:108/115` keeps `''` for text, sends `null` for number.
- ~~Fakes masked the bug~~ — `FakeOwApiClient` strips undefined to mirror JSON-wire semantics.
- New tests: `tests/integration/sync-engine.fieldClear.test.ts` (7 — trap + contract).
- Convention #21 in DESIGN.md.

### Bout T — Auth-failed rounds
- ~~"Lying pill" (saving → synced when nothing synced)~~ — engine transitions to `error` state, `paused=true`, dedicated toast.
- ~~No-retry-storm~~ — `pushPhase` / `pullPhase` track `authBlocked` flag and break out of the loop on first 401.
- ~~`flushPendingOnAttach` failures silent~~ — now toasts.
- ~~Pull-non-auth throw left state stuck at `syncing`~~ — `runPullOnly` / `runSync` wrap in try/catch to restore idle before re-throw.
- New: `isAuthError(err)` helper (exported), `setAuthError()` engine method, `SyncResult.auth_blocked` field, `FakeOwApiClient.__inject_auth_failure()`, `statefulOwHandlers({authState: {blocked}})`.
- New tests: `tests/integration/sync-engine.authBlocked.test.ts` (12).
- Convention #22 in DESIGN.md.

### Bout U — Topo-sort CREATEs
- ~~`400 Invalid FK` during Make-Online when local Character referenced local Location~~ — `sortCreatesByDependencies` orders dependencies before references using Kahn's algorithm on scan-all-strings adjacency.
- Cycles fall back to input order (rare; safety preserved).
- Schema-agnostic (mirrors `rewriteIdReferences`).
- New tests: `tests/integration/sync-engine.createOrder.test.ts` (5).
- Convention #23 in DESIGN.md.

## Pending commit (session 205)

3 logical commits:

- **Bout S** (`H1+H2 field-clear`):
  - `src/middle/element-detail.ts` (one-line: undefined → null in × handler)
  - `src/ui/field-edit-popover.ts` (preserve '' for text; null for number)
  - `src/sync/sync-engine.ts` (NOTE comment near stripSyncFields)
  - `tests/fixtures/fake-ow-client.ts` (stripUndefined)
  - `tests/integration/sync-engine.fieldClear.test.ts` (new)
  - `DESIGN.md` (convention #21)
  - `SYNC_NOTES.md` ("Clearing a field" section)

- **Bout T** (`auth-failed-rounds`):
  - `src/core/types.ts` (`SyncResult.auth_blocked` field)
  - `src/sync/sync-engine.ts` (isAuthError, setAuthError, pushPhase/pullPhase tracking, runPushOnly/runPullOnly/runSync transitions)
  - `src/sync/sync-attach.ts` (emitConflictToasts auth path, flushPendingOnAttach failure toast)
  - `tests/fixtures/fake-ow-client.ts` (`__inject_auth_failure`)
  - `tests/msw-handlers.ts` (`authState.blocked` option)
  - `tests/integration/sync-engine.authBlocked.test.ts` (new)
  - `DESIGN.md` (convention #22)
  - `SYNC_NOTES.md` ("Auth-failed rounds" section)

- **Bout U** (`topo-sort-creates`):
  - `src/sync/sync-engine.ts` (`sortCreatesByDependencies`, pushPhase call)
  - `tests/integration/sync-engine.createOrder.test.ts` (new)
  - `DESIGN.md` (convention #23)
  - `SYNC_NOTES.md` ("CREATE order: topo-sort" section)
  - `PROGRESS.md` (bout S/T/U entries)

Captain reserves the push action.

## Pressure-test deferred items (session 205)

The pressure-test pass surfaced 17 candidate concerns. Five-agent cross-check
resolved them as:
- **Fixed this session**: H1, H2 (Bout S). T-class fix surfaced in smoke and shipped (Bout T). U-class fix surfaced in smoke and shipped (Bout U).
- **Refuted**: M6 (pushPhase doesn't apply server response — by design, not a bug).
- **Path 12 false positive**: existing world-id guard works.
- **Skeptic's Issue B**: benign promise sharing.

**Still deferred — backlog for 3.6+ or later polish**:

| Item | Severity | Confidence | Fix scope | Notes |
|---|---|---|---|---|
| **H3** — Map id-swap doesn't migrate `state.ui.rightTabs[].mapId` or `state.ui.pinPlacement.elementId` | MEDIUM | 85% | ~8 LOC in `sync-attach.handleIdSwap` | Only reachable if user has a map tab open during Make-Online Route 1 or first push of a locally-created map. Not in current smoke paths. |
| **M1+M7** — `engine.resume()` doesn't flush pending writes + erases `last_sync_at` | MEDIUM (M1) / LOW (M7) | 80% / 95% | ~10 LOC at four resume callsites OR in the engine itself | Recovery exists (next user edit re-arms debounce, OR reload triggers `flushPendingOnAttach`). M7 is one-line cosmetic. |
| **M2** — Pill click during debounced push returns push-shaped result, toasts "already up to date" misleadingly | MEDIUM (UX) | 70% | ~3 LOC: check `result.pushed.creates + updates + deletes > 0` | Benign — single-user smoke unlikely to surface. |
| **M3** — User edit during pullPhase race-overwrites | MEDIUM (narrow race) | 60% | ~10 LOC: re-read element before `applyServerRecord` | Window is single `await` (~1-5ms). Defer unless smoke surfaces. |
| **M4** — Stale conflicts persist after policy flip to local-wins | MEDIUM (UX) | 80% | ~5 LOC: settings-panel policy-change clears persisted conflicts | Easy fix, defer until backlog round. |
| **M5** — Modal actions silent no-op on world switch mid-modal | LOW-MEDIUM (reachability low) | 60% | ~3 LOC: capture worldId at modal open, validate before resolving | Modal overlay blocks worlds-sidebar so reachability is genuinely low. |
| **Path 10** (invariant agent) — Cascade-delete loop crash leaves inconsistent state | LOW (recovery exists) | 70% | Pre-collect tombstones into one write before unlinking files | FS Access API has no transactions. Worst case is "confusing server-delete modal on next sync." |
| **L1–L7** | LOW (cosmetic/log) | mixed | minor | E.g., L1 log inconsistency `'drain-blind'` vs `'local-wins'`; L3 1-frame "not found" flash on delete. |

None are blockers for cutover. Pick whichever feels right when energy is back.

## Known soft-edges still deferred to 3.6+ (cumulative)

Carried from prior sessions:
- **Full pagination** — safety guard prevents data loss but `>200 elements/type` worlds only see first page.
- **Per-world conflict policy override** — global only today.
- **"Last synced X min ago" on the pill** — currently only in title attribute.
- **Visual indicator on auto-pulled elements** — toast covers the count; per-element flash would be polish.
- **Stuck-pin auto-cleanup** — repeated `Map not found` 404s currently require manual delete.
- **`getElement` perf** — O(types) directory probe per lookup.
- **Drag-from-element-list pin drop** — right-click + create covers primary spatial flow.
- **`resolveConflict` CREATE path id-swap** — corner case; resolve-conflict on never-synced element doesn't swap if server returns different id. Not tripped in practice.
- **`pushPhase` UPDATE doesn't apply server response back to local** (refuted-by-design from pressure-test; revisit only if OW server starts normalizing fields).

## Diagnostics affordances (cumulative)

- **`logWireError`** (V.5) — every `_id` / `_ids` / `_type` field in failed-write body prints inline.
- **`[auto-pull]` transitional logs** (B6) — scheduling / stopping / tick: firing / tick: skipping {reason}.
- **`[atlas:sync] push detected server-side delete`** (B8) — fires for every UPDATE 404 routed to server_deletes.
- **`[atlas:sync] push hit auth error — bailing round`** (Bout T) — fires on 401/403 from push.
- **`[atlas:sync] pull hit auth error — bailing round`** (Bout T) — fires on 401/403 from pull.
- **`[atlas:sync] FK cycle detected in CREATE batch — falling back to input order`** (Bout U) — fires if CREATEs have a true cycle.

---

*Session 205 close. Phase 3.5 ready for resumed smoke per `BOUT_R_SMOKE.md`. After smoke + cutover, archive `PHASE3.5_BRIEF.md`.*
