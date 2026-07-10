# Charts — Handover (the v1 CHARTS ARC IS CLOSED · 2026-07-10, sessions 251-252)

*Load order: **`DESIGN_CHARTS.md` FIRST** (holds the integrated S1-S15 layer, every revision, and the Acts roadmap), then this file. The sitdown note (`Forge/Notes/2026-07-10-charts-sitdown-decisions.md`) is the dated decision record. Full build history: PROGRESS.md session-251/252 entries.*

## ⚑ OPENER — what remains before v1 (charts itself is DONE)

- **Pipeline smoke** (GATED on Captain's show push + Boss redeploy) → **pre-flight** (`Forge/Notes/2026-07-03-atlas-release-plan.md`) → **v1**.
- Captain's side: show push · S14 recipe-fit poke on his real worlds · commit the session-252 tail.
- Ungated bout candidates: **Cmd+K palette** (the one open feature-level item across atlas) · OPFS rapid-reload forensics (watchdog shipped; PROGRESS S251 entry has the trail — post-v1 lean) · og:image (blocked on Captain's card asset).
- **Banked test item**: an e2e locking the cast ASSIGNMENT MODE (ghost card → `ui.castAssign` → sidebar banner → matching row-click assigns + returns home; both kinds live-verified twice, not yet test-locked; the flow spans world-home.ts ghost click + elements-sidebar.ts banner/interception).

## What the closed arc contains (all in DESIGN_CHARTS.md; one-line map)

Window-is-the-camera + overview strip (S251) · weight-ranked label budget + "+N" zoom-to-cluster badges · docked-right card (snippet, capped chip groups, pinned actions) · **PEEK/FOCUS split** (peek reads free; Focus/Edit are the card's verbs; Back walks the focus chain) · **always-reserved rail** (ambient legend + cast rows; no reflow) · **THE TABLEAU as the landing** (no chips lit; `tableauScope` = cast + weighted essentials; all-chips-off returns to it; the home strip defaults to it too) · quiet cast signal (size boost + bright cyan label; `PayloadChartNode.cast` additive through freeze/static) · **cast assignment mode** (`ui.castAssign`) · +Event stays in the room · adaptive beeswarm gaps · ring-aware/y-bounded/below-first label placement.

## Shipped

**Chart #1 (temporal chart)** — recipe-picked default broad scope (Story / Events / Foundings) · type-tinted Material Symbols glyphs per element type · anchor beats (top-7 by graph degree get bigger glyph + halo + always-on label) · centered density-fan layout (`computeBeeswarm`) · unified select=focus (click dot or card chip → `/timeline/<id>`, browser Back walks the focus chain) · context-graph anchor-default (landing right-pane focuses highest-degree node, never empty). Layout logic in `DESIGN_CHARTS.md` §"D. Vertical layout — the density fan"; build-plan in `Forge/Notes/2026-06-19-chart2-build-plan.md`; significance in `src/visualization/timeline/degree.ts`; scope derivation in `chart-recipe.ts` `scopeFromFocus`.
**Chart #2 "The Landing"** — same session as above, density-fan layout polish, gated and self-inspected.
**Save / gallery / share-block** — Save → `.atlas/charts.json` (`FolderStore.readCharts/writeCharts`, pure `charts-store.ts`) + saved-chart gallery (load/rename/delete/active-highlight) in the Charts room. Chart-as-share-block `{kind:'chart', chartId}` via `chart-freeze.ts` `freezeChartBlock` (frozen identity nodes, scope = disclosure boundary) + `chart-static.ts` `renderChartView` (static canvas, used by atlas builder and `show`). 3-lens gate fixed 2 blockers (show had no chart case; `rewriteChartScopeIds` was dead, now wired into `handleIdSwap` + `atlas:charts-changed`).
**Loose ends cleared**: Card "Referenced by" (reverse-link group via `buildChipGroup` + reverse-scan in `timeline-view.ts`) · F1 duplicate "Name" field removed (header click-to-edit title is the name, conv #80).

**SHIPPED 2026-07-10 (session 251 — Bout 1 of the trust set): the window refactor + overview strip (S2/S3/S6)** — `zoom`+`panCenter` are GONE — the one viewport state is `window: {start,end}` in world-date units (`clampWindow`/`zoomWindow` pure + unit-locked; LOD derives from fitSpan/viewSpan). The **overview strip** (bottom 26px of the canvas) renders the FULL dated universe as density marks — the room passes `setNodes(scoped, allNodes)` — with a bright viewport band (drag = travel, edge-drag = resize, track-click = jump) and ONE fading ghost of the previous window. Focus jumps ANIMATE (280ms ease-out; single rAF driver). Axis dates brightened; labels are click targets (`state.labelBoxes`). Evidence: `Notes/ui-snapshots/2026-07-10/b1-*.png`.

## Current state
**1015 vitest + 167 e2e green** (session 252 close, EXIT=0). Committed through `f561b1e` "first bout" (Bout 0 + Bout 1); session 252's work (Bouts 2 + 3, docs consolidation, timeline-bar deletion, the CSS-leak fix, the watchdog toast) is UNCOMMITTED (Captain's git).

## Decisions already locked (don't re-litigate)
chart = block (referenced by `{kind:'chart', chartId}`) · storage `.atlas/charts.json` + share, never an OW element · **unified select=focus** (built) · maps-in-charts: embed real Map rendered static, **events inherit their location's pin (events are not pins)**, right pane stays the live spatial workshop · default = auto recipe, instantly switchable, no wizard · ChartConfig is versioned (schema_version) because it persists + crosses the share/viewer version boundary · Captain's chart-#2 nav calls: anchor-default ignores type chips · fixed ~7 anchors · accept rapid-click history · leave the context-pane mouse-back handler as-is.

## Bootstrap for self-inspection (the recipe that works)
`npm run dev` (3045) → Playwright: `resetAll()` → **re-nav** (reload so welcome shows `setup-atlas` — resetAll alone doesn't re-render) → `setNextDirectory(OPFS dir)` → click `setup-atlas` + `create-local` + fill `world-name` + `pick` → `store.createElement(type, data)` with **bare relation field names** (`birthplace`, `species`, `location`, `parent_narrative`, `characters`, `objects` — NOT `_id` suffixes; the editor/normalizer read bare on disk) → `api.patchData(await store.listElements())` → route via `location.hash` (NOT browser_navigate). A dense multi-type world (≈80 elements: events/chars/locations/narrative-tree/etc.) shows the wall + anchors; a 25-element world with a narrative tree + dated events + character births triggers the Story recipe. **The dev server gets evicted when heavy `npx vitest`/`playwright` spawn workers** — restart it after the close-gate suites. **Don't reload the inspection browser within a few seconds of opening a world** — that's the OPFS rapid-reload wedge (see Banked forensics above); wait for `listElements` to settle first. Edit source only when the inspection browser is idle (HMR collision).

## Key files (chart subsystem)
- `src/visualization/timeline/types.ts` — `DateSpec`, `ChartConfig` (schema_version + tagged `ChartAxis` + `ChartScope`), `TimelineNode` (required `dateSpec`, `links`, `laneKey`).
- `src/visualization/timeline/chart-recipe.ts` — `pickDefaultChart` (ordered recipes) + `filterNodesByScope` (unknown kind → fail-safe empty).
- `src/visualization/timeline/data-normalizer.ts` + `temporal-fields.ts` (`parseTemporalValue`) + `axis-calculator.ts` (non-finite guards).
- `src/visualization/timeline/timeline-view.ts` — the interactive renderer (canvas+DOM card; zoom/pan; proximity labels). **This is where the visual-system work lands.**
- `src/middle/timeline.ts` — the room (owns ChartConfig, control bar, the 3 callbacks). **The nav refactor lands here + in `router.ts` + `tabs/right/context-tab.ts`.**
- Tests: `tests/unit/timeline-axis.test.ts`, `tests/unit/chart-recipe.test.ts`. e2e: `tests/e2e/phase6-polish.spec.ts` (asserts `.atlas-timeline-view-canvas`).

## Queued post-launch
Roadmap (forward-half render, now-line + reconciler, Narrative lanes, fuzzy/relative dates, map-chart + scrubber, 3D, Cmd+K palette) lives in `DESIGN_CHARTS.md`'s roadmap — don't duplicate the Act structure here.
