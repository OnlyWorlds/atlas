# Charts — Handover (Chart #1 + #2 ✅ · SITDOWN 2026-07-10 ✅ · trust-set Bouts 1 + 2 + 3 ✅)

*Running-start pickup for the Charts arc. Load order: **`DESIGN_CHARTS.md` FIRST** (holds the integrated S1-S15 layer + roadmap), then this file. The sitdown note (`Forge/Notes/2026-07-10-charts-sitdown-decisions.md`) is the dated decision record.*

## ⚑ OPENER (the live work)

**THE v1 TRUST SET IS SHIPPED (Bouts 1-3, sessions 251-252).** What remains before v1:
- **Captain's picks**: card dock variant (`b3-card-dock-right-final.png` vs `b3-card-dock-bottom.png`, switch = `localStorage.atlas_chart_card_dock`; loser code gets removed after the pick) · room icons (`icons-{current,variant-a,variant-b}.png`) · Bout E dim-rows keep/tune/drop · S7 "Edit" action call (shipped Open only — see PROGRESS flags).
- **Home pass 2** (S15: starred chart vs "coming up" strip) → **pipeline smoke** (GATED on Captain's show push + Boss redeploy) → **pre-flight** (`Forge/Notes/2026-07-03-atlas-release-plan.md`).
**Banked forensics**: the OPFS rapid-reload activation hang (PROGRESS 2026-07-10/S251 entry — first `listElements` after open never resolves when reloaded within seconds; bfcache write-lock hypothesis; 15s watchdog toast shipped). Post-v1 unless Captain hits it live.

## SHIPPED 2026-07-10 (session 252 — Bouts 2 + 3)

**Bout 2 (S4/S5)**: weight-ranked per-column label budget (`labelWeight` = degree + log-scaled `contentMass`; favorites always win) · "+N" cluster badges (merged runs, drawn over glyphs, click = animated zoom-to-cluster) · label position fallbacks (side/above/below) · **protagonist-first default window** (`protagonistWindow`: explicit favorite else link-tally inference; era = densest ~75% date cluster, outlier-robust; one-shot window, never auto-focus). Captain's flag bug was a CSS leak (`.atlas-middle-header` icon rule painted the favorite toggle cyan) — fixed with a direct-child scope; × unset added to the home cast card.
**Bout 3 (S7)**: the card DOCKS as a flex sibling of the canvas cell (canvas reflows; float positioning deleted) — description snippet + role groups capped at 5 + "+N more" + pinned Open; chips scroll.

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
