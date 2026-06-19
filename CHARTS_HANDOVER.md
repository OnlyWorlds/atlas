# Charts — Handover (Chart #1 + #2 "The Landing" ✅ DONE)

*Running-start pickup for the Charts arc. Load this FIRST when resuming charts work, then `DESIGN_CHARTS.md` for the full design. Updated end of the chart-#2 + layout-polish session (2026-06-19). **The Chart #2 plan is fully shipped — this section is now history; the live work is "Queued chart bouts" below.***

## Where it stands — DONE

**Chart #1 (temporal chart) AND Chart #2 "The Landing" (incl. the density-fan layout polish) are SHIPPED, gated, and self-inspected.** A chart = a saveable/shareable view of the world along chosen axes (time first); the room is at `#/w/<id>/timeline` (title "Charts"). **902 vitest + 155 e2e + typecheck green** (clean). Nothing committed (Captain's git).

**What works now:** recipe-picked default broad scope (Story / Events / Foundings) · **type-tinted Material Symbols glyphs** per element type (identity) · **anchor beats** — top-7 by graph degree get bigger glyph + halo + always-on label (hierarchy) · **centered density-fan layout** (`computeBeeswarm`) — nodes bloom up/down from the axis midline ∝ local time-density, anchors hold the centre, sparse periods stay a thin spine (no more top-pile) · **labels by default** (collision-limited; more on zoom) · **LOD** — overview light, zoom grows glyphs + reveals labels · **unified select=focus** — clicking a dot OR a card chip focuses that element (`/timeline/<id>`), **browser Back walks the focus chain**, focus pill clears to broad · **context-graph anchor-default** — the landing right-pane focuses the highest-degree node (never empty) · proximity-reveal labels · wheel-zoom + drag-pan · compact home `timeline-bar.ts` untouched.

The layout logic ("what goes where") is documented in `DESIGN_CHARTS.md` §"D. Vertical layout — the density fan".

Build-plan + research synthesis: `Forge/Notes/2026-06-19-chart2-build-plan.md`. Per-bout details in `PROGRESS.md` CURRENT STATE. Significance lives in `src/visualization/timeline/degree.ts`; scope derivation in `chart-recipe.ts` `scopeFromFocus`.

## Loose ends — both CLEARED (post-wrap, same session)
- **Card "Referenced by"** ✅ — the selection card now shows a reverse-link group (who points AT this node), so focusing a link-target (e.g. a Location) is no longer an empty card. `buildChipGroup` + reverse-scan over the visible set in `timeline-view.ts`.
- **F1** ✅ — the duplicate "Name" field is gone from the element-detail Base section (the header click-to-edit title is the name, conv #80); two e2e updated to rename via the header.
- **Still open:** Cmd+K palette.

## Queued chart bouts (additive, no migration — pick up here)
save charts → `.atlas/charts.json` → gallery → **chart-as-share-block** (the share-room block kind `{kind:'chart', chartId}`, reserved + gated) → **forward-half** render (Simmer's wedge: owed/coming/due, now-line as the seam) → now-line(s) + reconciler → Narrative lanes (`laneKey`) → fuzzy/relative dates (`DateSpec` already a tagged union) → map-chart + scrubber → 3D. And still open across atlas: the Cmd+K palette.

## Decisions already locked (don't re-litigate)
chart = block (referenced by `{kind:'chart', chartId}`) · storage `.atlas/charts.json` + share, never an OW element · **unified select=focus** (built) · maps-in-charts: embed real Map rendered static, **events inherit their location's pin (events are not pins)**, right pane stays the live spatial workshop · default = auto recipe, instantly switchable · ChartConfig is versioned (schema_version) because it persists + crosses the share/viewer version boundary. Captain's chart-#2 nav calls: anchor-default ignores type chips · fixed ~7 anchors · accept rapid-click history · leave the context-pane mouse-back handler as-is.

## Bootstrap for self-inspection (the recipe that works)
`npm run dev` (3045) → Playwright: `resetAll()` → **re-nav** (reload so welcome shows `setup-atlas` — resetAll alone doesn't re-render) → `setNextDirectory(OPFS dir)` → click `setup-atlas` + `create-local` + fill `world-name` + `pick` → `store.createElement(type, data)` with **bare relation field names** (`birthplace`, `species`, `location`, `parent_narrative` — NOT `_id`) → `api.patchData(await store.listElements())` → route via `location.hash` (NOT browser_navigate). A dense multi-type world (≈80 elements: events/chars/locations/narrative-tree/etc.) shows the wall + anchors. **The dev server gets evicted when heavy `npx vitest`/`playwright` spawn workers — restart it after the close-gate suites.** Edit source only when the inspection browser is idle (HMR collision).

## Key files (chart subsystem)
- `src/visualization/timeline/types.ts` — `DateSpec`, `ChartConfig` (schema_version + tagged `ChartAxis` + `ChartScope`), `TimelineNode` (required `dateSpec`, `links`, `laneKey`).
- `src/visualization/timeline/chart-recipe.ts` — `pickDefaultChart` (ordered recipes) + `filterNodesByScope` (unknown kind → fail-safe empty).
- `src/visualization/timeline/data-normalizer.ts` + `temporal-fields.ts` (`parseTemporalValue`) + `axis-calculator.ts` (non-finite guards).
- `src/visualization/timeline/timeline-view.ts` — the interactive renderer (canvas+DOM card; zoom/pan; proximity labels). **This is where the visual-system work lands.**
- `src/middle/timeline.ts` — the room (owns ChartConfig, control bar, the 3 callbacks). **The nav refactor lands here + in `router.ts` + `tabs/right/context-tab.ts`.**
- Tests: `tests/unit/timeline-axis.test.ts`, `tests/unit/chart-recipe.test.ts`. e2e: `tests/e2e/phase6-polish.spec.ts` (asserts `.atlas-timeline-view-canvas`).

## Bootstrap for self-inspection (the recipe that works)
`npm run dev` (3045) → Playwright: `resetAll()` → re-nav → setNextDirectory(OPFS) → click `setup-atlas` + `create-local` + fill `world-name` + `pick` → `store.createElement(type, data)` with **bare relation field names** (`birthplace`, `species`, `characters`, `objects`, `parent_narrative` — NOT `_id` suffixes; the editor/normalizer read bare on disk) → `api.patchData(await store.listElements())` → route via `location.hash` (NOT browser_navigate). A 25-element world with a narrative tree + dated events + character births triggers the Story recipe. Edit source only when the inspection browser is idle (HMR collision).

## Decisions already locked (don't re-litigate)
chart = block (referenced by `{kind:'chart', chartId}`) · storage `.atlas/charts.json` + share, never an OW element · maps-in-charts: embed real Map rendered static, **events inherit their location's pin (events are not pins)**, right pane stays the live spatial workshop · default = auto recipe, instantly switchable, no wizard · ChartConfig is versioned (schema_version) because it persists + crosses the share/viewer version boundary.

## Other queued (after The Landing)
save → gallery → chart-as-share-block → **forward-half** (Simmer's wedge-behind-the-wedge: render owed/coming/due, now-line as the seam) → now-line(s) + reconciler → Narrative lanes → fuzzy/relative dates → map-chart + scrubber → 3D. And still open across atlas: the Cmd+K palette. (Card "Referenced by" + F1 dup-Name-field both CLEARED — see "Loose ends" above.)
