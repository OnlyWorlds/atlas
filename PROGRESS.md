# Atlas — Progress Log

Operational state. Architecture in **DESIGN.md** (+ `DESIGN_MAPS.md`, `DESIGN_ZONES.md`). Sync lessons in **SYNC_NOTES.md**. Session-by-session history archived to `docs-archive/PROGRESS-history.md`.

---

## CURRENT STATE (handover snapshot, 2026-05-18)

Tool is in a tight, healthy state. **553/553 vitest + 93 Playwright e2e green.** Bundle 488 KB JS / 137 KB gzipped. Typecheck clean. Conventions list 1-30 (full text in DESIGN.md).

All phases (0 → 6 + 3.5) shipped. Foundation + sync engine + map subsystem + zone subsystem + UI polish all stable.

**Recent invariants worth knowing**:
- Sentence case throughout, slug-prefix filenames (`<slug>--<uuid>.json`)
- Hotkeys MVP wired (`Ctrl/Cmd+E`, `S`, `K`, `?`, map-tab `F`/`Z`/`L`)
- Map view persists per-map (`{center, zoom}` saved on `moveend`, restored at mount)
- Pin badge accurate (only on Locations that have a sub-map)
- Sync pill shows "synced 3m ago" live (30s tick)
- `atlas_shape` stripped on wire; both fakes (FakeOwApiClient + MSW) strictly reject atlas-local fields in write bodies
- Welcome panel is single CTA for atlas-root setup/recover
- All "engine not ready" toasts route through `surfaceSyncUnavailable` for PIN-aware messages + deep-links

---

## Three big projects ahead

Each needs its own design conversation upfront. Don't start coding without one.

- **Timeline** — Event date-axis viewer exists in middle pane (`src/middle/timeline.ts`); the bigger timeline experience is undesigned
- **Writing** — long-form text creation/editing flow (surface undefined)
- **Data import** — bringing external content into a world

---

## Items dropped (don't re-add without fresh design conversation)

Per-world conflict policy override, email per-world, zone-targets-map, cross-element pin rendering, map subtype visual filter, map locking via URL, "maps within" inverse search perf, picker keyboard shortcut, pin coord council motion (already in schema), snap-to-existing-vertex for pins (only relevant for markers, already done), repair pre-migration server markers, hotkey undo/redo.

---

## Last session — Validation + tuneup (2026-05-18)

Five planned bouts + 6 follow-ups + atlas_shape leak fix. Three rounds of Captain validation feedback landed cleanly.

**Live bugs**:
- **Marker FK push fail**: `parseFkConstraintError` + CREATE-catch routes orphan peer to `server_deletes` review modal. +3 tests in `sync-engine.fkConstraint.test.ts`.
- **`atlas_shape` leak** (the real cause of Captain's smoke FK error — discovered after B1 fix didn't take): `atlas_shape` added to `ATLAS_LOCAL_EXTENSION_FIELDS`; both fakes now strictly reject atlas-local fields in write bodies. Convention #20 applied retroactively. +4 tests in `ow-client-adapter.atlasLocal.test.ts`.
- F hotkey: `fitBounds` → `fitToCanvas`
- Pin badge: `getAssociatedMaps` → `hasLinkedSubMap` (only Locations with sub-maps)
- "Engine not ready" → PIN-aware via `surfaceSyncUnavailable`

**Maps + camera**:
- Visual settings popover persists across map switch (`retargetVisualSettingsPopover`)
- Map view preserve via `src/core/map-camera-persist.ts` — saves `{center, zoom}` per mapId; restored at mount before fit-to-canvas
- **fitToCanvas-after-restore gate** (W6 round 2): `manager.fitToCanvas(20)` at end of `entry.ready` was overwriting the W6 setView restore. Gated behind `!savedAtMount`.
- Camera state migrates on map id-swap (lives alongside rightTabs + selectedElementId + URL migration)

**UX polish**:
- "Synced 3m ago" live on pill (30s tick interval)
- Right-click filter chip → type-scoped pull
- Auto-pulled element flash via `atlas:pulled-ids` CustomEvent + `data-flash` survives sidebar re-render
- Sidebar setup/recover-atlas buttons removed; welcome panel is single CTA
- Make-Online modal pre-validates email + PIN before any server call
- Stronger unlink-from-API confirmation with element count
- Context-aware empty state in elements-sidebar

**Sync hardening (M-series + pagination)**:
- M2: pill click toast gated on push+pull deltas
- M3: pull race-overwrite — re-read element before `applyServerRecord`
- M4: stale conflicts cleared on `pause-and-review → local-wins` flip
- M5: modal `worldId` captured at open
- H3: `pinPlacement.elementId` migrated on id-swap
- P4: full pagination (`?offset=N` until count reached, 100-page cap)

**Lessons (durable)**:
- Wrong-root-cause fixes feel like real fixes. Tests passing for a fake scenario that doesn't match production = misleading. **When the test passes but production behavior doesn't change, the test is the suspect.**
- When adding a new step to an existing async chain, **audit everything AFTER your insertion point**. Finalizers can silently override earlier steps.
- Three rounds of Captain validation feedback isn't a failure — it's the system working. Each round caught something self-assessment couldn't.

---

## Previous session — Tuneup (2026-05-17)

Slug-prefix filenames (`<slug>--<uuid>.json`), hotkeys MVP dispatcher, sentence-case scrub (~250 user-visible strings), 14 stale Playwright tests fixed, docs hygiene (4 transitional docs archived). Conventions #28-30 added. See git log + `docs-archive/PROGRESS-history.md` for detail.
