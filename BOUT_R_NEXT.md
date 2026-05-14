# Bout R — Next session pickup

*Updated 2026-05-13, session 202 close. Supersedes earlier draf 

 

## After all of Tier B + C pass

Cutover:

1. `git status` in `tools/atlas/` — confirm working tree state. Session 202 has a sizable commit ready (see "Pending commit" below); make sure it's in.
2. `git push --force origin main`
3. Cloudflare Pages auto-redeploys
4. Update `Forge/tools.json` — note 3.5 milestone
5. Update memory `project_atlas.md`
6. Archive `PHASE3.5_BRIEF.md` (add SHIPPED marker at top)
7. Reflect (session-close) and tell Captain

## Pending commit (session 202)

20 files touched, 4 new test files. Conceptually one bout = one commit covering V + V.5. Captain reserves the push action; ask if not yet committed.

```
bout V + V.5: pre-smoke hardening + pin element_type wire fix

- applyServerRecord preserves atlas-extension fields (image_media_id)
- server-delete detection guards against pagination (paginated types skipped)
- merge chain-CREATE FK rewritten in-body (Carol→Bob refs land correct server-side)
- conflict-toast setTimeout captures worldId (no cross-world push race)
- pin element_type populated at write sites + engine self-heal
- fakes (MSW + FakeOwApiClient) enforce pin element_type rule
- logWireError shows FK refs inline for fast 4xx diagnosis
- 15 new regression tests; 194 vitest total
```

## Known-and-accepted (don't smoke for)

Closed by session 202:
- ~~Pin `element_type` missing on wire~~ — fixed Bout V.5, regression tests in place
- ~~Server-delete false positives on paginated types~~ — fixed Bout V, regression test in place
- ~~Atlas-local fields (image_media_id) lost on pull update~~ — fixed Bout V, regression test in place
- ~~Chain-CREATE FK stale server-side after merge~~ — fixed Bout V, regression test in place

Closed by session 203 (Bout W — pre-smoke hardening round 2):
- ~~Pin drag missing autosave~~ — `requestPushIfLinked()` now fires in the dragend handler. Regression test in `tests/unit/pin-drag.test.ts`.
- ~~Orphan tombstones for unknown ids (never-synced + out-of-band server delete + cascade-on-recent-create)~~ — engine clears tombstones on DELETE 404 as "already gone." Both fakes now mirror real-OW 404-on-unknown. Tests in `tests/integration/sync-engine.tombstone404.test.ts`.
- ~~World-switch race in conflict-toast defer~~ — Bout V fix is now covered by `tests/integration/sync-attach.worldIdCapture.test.ts`.
- ~~Stale comment claiming `engine.resume()` calls `syncNow`~~ — corrected in `auto-pull-scheduler.ts`. Resume only clears the pause flag; pending writes wait for the next debounce, pulls wait for cadence/manual.

Still deferred to 3.6+:
- **Full pagination** — Bout V added a SAFETY guard but atlas still only sees first page. Implement load-more / page-cursor when needed.
- **Multi-link changes on web propagate** via `updated_at` bump (Skeld's server fix; if regresses, atlas users edit a non-m2m field to force a bump).
- **Per-world conflict policy overrides** — only global setting today.
- **"Last synced X min ago" prominent display** — currently only in pill title attribute.
- **Stuck-pin auto-cleanup**: if pin push 404s "Map not found" repeatedly, currently the user must manually delete the orphan. Could add a tombstone-after-N-failures path. Surfaced V.5 smoke.
- **`getElement` perf** — O(types) directory probe per lookup. Cache id→type when load warrants.

## New diagnostic affordance (Bout V.5)

`logWireError` now extracts every `_id` / `_ids` / `_type` field from the request body and prints them inline:

```
[atlas:sync] POST /pin/ failed — API Error 404: Map not found.
  refs={"map_id":"c32d9401-...","element_id":"06a0445d-...","element_type":"location"}
```

Tells you immediately whether the failure is an orphan FK (local-only id), a stale-after-swap reference (v4 id when server expects v7), or a server-side deletion (v7 id that's gone). Speeds up smoke debugging considerably.

---

*Session 202 close. Hardening done; bug categories from this session are codified in SYNC_NOTES.md and DESIGN.md conventions #19, #20.*
