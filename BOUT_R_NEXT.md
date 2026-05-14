# Atlas — Next session pickup

*Updated 2026-05-14, session 204 close.*

---

## Where we are

Phase 3.5 sync engine is feature-complete + hardened across four sessions of live-smoke + regression-test work:
- **Session 201** — Phase 3.5 mega smoke: two-policy redesign + 19+ interlocking sync fixes.
- **Session 202** — Bouts V + V.5: pre-smoke verification-exo + pin element_type wire fix.
- **Session 203** — Bout W: pin-drag autosave + orphan tombstones + worldId-capture test + cadence visibility unstick.
- **Session 204** (THIS) — Bouts 7–9b: pull toast + log cleanup + paused-cloud icon (B7), keep-pushes-now + UPDATE-404 → server_deletes routing (B8), id-swap UI propagation + atomic state transition (B9 + B9b).

**Tests**: 234 vitest passing (was 194 at session 202 close — **+40 net new tests** across 4 sessions).
**Build + typecheck**: clean.
**Bundle**: ~343 KB JS / ~95 KB gzipped.

## First moves next chat

1. **`/wake atlas-tool`** — loads identity + tool context.
2. **Read `BOUT_R_SMOKE.md`** — the rewritten smoke doc with Tier 1-4 structure. ~20 min to run if everything's green.
3. **Run Tier 1 (core lifecycle)** — bootstrap → local-only loop → link existing → edit + autosave → manual pull → make-online Route 1.
4. If T1 passes: Tier 2 (UI + recent-fix surface) — paused cloud icon, pin lifecycle, flush-on-attach recovery, server-delete keep+push + id-swap silent migration.
5. If T2 passes: Tier 3 spot-checks (Route 2, conflict, cadence, multi-world).
6. If T3 passes: optional Tier 4, then cutover.

## Bout closures by session

### Closed by session 202 (V + V.5)
- ~~Pin `element_type` missing on wire~~
- ~~Server-delete false positives on paginated types~~
- ~~Atlas-local fields (image_media_id) lost on pull update~~
- ~~Chain-CREATE FK stale server-side after merge~~

### Closed by session 203 (W round 1)
- ~~Pin drag missing autosave~~ — `requestPushIfLinked()` in dragend (`tests/unit/pin-drag.test.ts`)
- ~~Orphan tombstones for unknown ids~~ — engine clears tombstones on DELETE 404; fakes mirror real-OW 404-on-unknown (`tests/integration/sync-engine.tombstone404.test.ts`)
- ~~World-switch race in conflict-toast defer~~ — Bout V fix now regression-tested (`tests/integration/sync-attach.worldIdCapture.test.ts`)
- ~~Stale `engine.resume()` comment~~ — corrected

### Closed by session 204 (W round 2)
- ~~Pending writes lost on reload~~ (Bout 5) — `attachSyncEngine` fires `pushOnce` if `listLocallyChangedSince(null)` non-empty (`tests/integration/sync-attach.flushOnAttach.test.ts`)
- ~~Auto-pull cadence killed by visibility-change~~ (Bout 6) — timer keeps running while hidden, ticks skip when hidden, catch-up pull on becoming visible after cadence-window-elapsed (updated `tests/integration/auto-pull-scheduler.test.ts`)
- ~~Auto-pull silent on cadence-driven pulls~~ (Bout 7) — `pullNowAndRefresh` now toasts `pulled N updated from api` for any pull (manual or scheduled)
- ~~Spammy `[auto-pull] reconcile` log~~ (Bout 7) — removed unconditional entry log; kept transitional ones
- ~~Paused worlds lacked obvious sidebar signal~~ (Bout 7) — cloud icon swaps to `cloud_off` when world or global paused
- ~~Server-delete `keep + re-push` didn't actually push~~ (Bout 8) — modal triggers `pushOnce` immediately after resolve
- ~~UPDATE 404 leaked as raw error~~ (Bout 8) — push pre-GET-null AND PATCH-throws-404 both route to `sync_state.server_deletes`; same review modal as pull-time detection (`tests/integration/sync-engine.pushUpdate404.test.ts`)
- ~~"element not found in this world" flash after id-swap~~ (Bouts 9 + 9b) — engine emits `onIdSwap` callback; sync-attach migrates `selectedElementId` + URL hash in a single atomic `setState` (one render, both slices consistent) (`tests/integration/sync-engine.idSwapCallback.test.ts`, `tests/integration/sync-attach.idSwap.test.ts`)

## Pending commit (session 204)

Multiple bouts of work; logical commits:
- B5 + B6 + B7 (recovery + cadence-fix + toast + cloud-icon + log cleanup)
- B8 (UPDATE-404 routing + keep-pushes-now)
- B9 + B9b (id-swap propagation + atomic transition)

Or one bout-W2 commit. Captain reserves the push.

## Known soft-edges still deferred to 3.6+

Same as session 203 — none are blockers:
- **Full pagination** — safety guard prevents data loss but `>200 elements/type` worlds only see first page.
- **Per-world conflict policy override** — global only today.
- **"Last synced X min ago" on the pill** — currently only in title attribute.
- **Visual indicator on auto-pulled elements** — toast covers the count; per-element flash would be polish.
- **Stuck-pin auto-cleanup** — repeated `Map not found` 404s currently require manual delete.
- **`getElement` perf** — O(types) directory probe per lookup.
- **Drag-from-element-list pin drop** — right-click + create covers primary spatial flow.
- **`resolveConflict` CREATE path id-swap** — corner case; resolve-conflict on never-synced element doesn't swap if server returns different id. Not tripped in practice.

## Diagnostics affordances (cumulative)

- **`logWireError`** (V.5) — every `_id` / `_ids` / `_type` field in failed-write body prints inline:
  `[atlas:sync] POST /pin/ failed — API Error 404: Map not found. refs={"map_id":"c32d9401-...","element_id":"06a0445d-...","element_type":"location"}`
- **`[auto-pull]` transitional logs** (B6) — scheduling / stopping / tick: firing / tick: skipping {reason}. Used to diagnose B6 cadence visibility bug; left in for future smoke triage.
- **`[atlas:sync] push detected server-side delete`** (B8) — fires for every UPDATE 404 routed to server_deletes. Confirms the routing path runs.

---

*Session 204 close. Phase 3.5 ready for smoke per `BOUT_R_SMOKE.md`. After smoke + cutover, archive `PHASE3.5_BRIEF.md`.*
