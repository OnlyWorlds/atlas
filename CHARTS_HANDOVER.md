# Charts — Handover (Chart #1 + #2 ✅ · SITDOWN HELD 2026-07-10 · trust-set Bout 1 ✅)

*Running-start pickup for the Charts arc. Load order: **`Forge/Notes/2026-07-10-charts-sitdown-decisions.md` FIRST** (S1-S15: the frame, the roadmap, every open call closed), then this file, then `DESIGN_CHARTS.md`.*

## ⚑ SESSION 252 OPENER (the live work)

**Bout 2 — smart default + label budget (S4/S5)**: Captain's protagonist flags first (header icon reportedly lights for non-protagonists — NOT reproduced, suspect stale header render on registry patch; add × unset on the home cast card) → `TimelineNode.contentMass` in the normalizer (description/prose length) → weight = degree + content mass + favorites (favorites ids passed via setNodes extras) → per-column label budget replacing the fill-all pri-3 tier in `drawLabels` (+N affordance, click = zoom to cluster) → protagonist-first default (explicit `favorites.protagonist_id` or inferred highest-degree character; implement as default WINDOW centered on their neighbourhood + label boost, NOT auto-focus URL — flag the deviation from S5's letter for Captain).
**Bout 3 — dock the card (S7)**: right-edge-in-room vs bottom strip, screenshot both, Captain picks. Content budget: chips capped per role group + "+N", description snippet, Open/Edit actions.
**Then**: home pass 2 → pipeline smoke (Captain's show push gates) → pre-flight.
**Banked forensics**: the OPFS rapid-reload activation hang (PROGRESS 2026-07-10 entry — first `listElements` after open never resolves when reloaded within seconds; bfcache write-lock hypothesis; 15s watchdog toast shipped).
**Captain's open**: icon pick (`Notes/ui-snapshots/2026-07-10/icons-{current,variant-a,variant-b}.png`) · poke the strip · show push.

## SHIPPED 2026-07-10 (session 251 — Bout 1 of the trust set)

**The window refactor + overview strip (S2/S3/S6)**: `zoom`+`panCenter` are GONE — the one viewport state is `window: {start,end}` in world-date units (`clampWindow`/`zoomWindow` pure + unit-locked; LOD derives from fitSpan/viewSpan). The **overview strip** (bottom 26px of the canvas) renders the FULL dated universe as density marks — the room passes `setNodes(scoped, allNodes)` — with a bright viewport band (drag = travel, edge-drag = resize, track-click = jump) and ONE fading ghost of the previous window. Focus jumps ANIMATE (280ms ease-out; single rAF driver). Axis dates brightened; **labels are click targets** (`state.labelBoxes`). Evidence: `Notes/ui-snapshots/2026-07-10/b1-*.png`.

## Where it stands — DONE

**Chart #1 (temporal chart) AND Chart #2 "The Landing" (incl. the density-fan layout polish) are SHIPPED, gated, and self-inspected.** A chart = a saveable/shareable view of the world along chosen axes (time first); the room is at `#/w/<id>/timeline` (title "Charts"). **902 vitest + 155 e2e + typecheck green** (clean). Nothing committed (Captain's git).

**What works now:** recipe-picked default broad scope (Story / Events / Foundings) · **type-tinted Material Symbols glyphs** per element type (identity) · **anchor beats** — top-7 by graph degree get bigger glyph + halo + always-on label (hierarchy) · **centered density-fan layout** (`computeBeeswarm`) — nodes bloom up/down from the axis midline ∝ local time-density, anchors hold the centre, sparse periods stay a thin spine (no more top-pile) · **labels by default** (collision-limited; more on zoom) · **LOD** — overview light, zoom grows glyphs + reveals labels · **unified select=focus** — clicking a dot OR a card chip focuses that element (`/timeline/<id>`), **browser Back walks the focus chain**, focus pill clears to broad · **context-graph anchor-default** — the landing right-pane focuses the highest-degree node (never empty) · proximity-reveal labels · wheel-zoom + drag-pan · compact home `timeline-bar.ts` untouched.

The layout logic ("what goes where") is documented in `DESIGN_CHARTS.md` §"D. Vertical layout — the density fan".

Build-plan + research synthesis: `Forge/Notes/2026-06-19-chart2-build-plan.md`. Per-bout details in `PROGRESS.md` CURRENT STATE. Significance lives in `src/visualization/timeline/degree.ts`; scope derivation in `chart-recipe.ts` `scopeFromFocus`.

## Loose ends — both CLEARED (post-wrap, same session)
- **Card "Referenced by"** ✅ — the selection card now shows a reverse-link group (who points AT this node), so focusing a link-target (e.g. a Location) is no longer an empty card. `buildChipGroup` + reverse-scan over the visible set in `timeline-view.ts`.
- **F1** ✅ — the duplicate "Name" field is gone from the element-detail Base section (the header click-to-edit title is the name, conv #80); two e2e updated to rename via the header.
- **Still open:** Cmd+K palette.

## SHIPPED since The Landing (2026-06-19, gated)
- **Save → `.atlas/charts.json`** (FolderStore.readCharts/writeCharts; pure `charts-store.ts`) + a **saved-chart gallery** in the Charts room (load/rename/delete/active-highlight). "Save chart" action.
- **Chart-as-share-block** `{kind:'chart', chartId}` — `chart-freeze.ts` `freezeChartBlock` (frozen identity nodes; scope = disclosure boundary; ref-when-carded), `chart-static.ts` `renderChartView` (static canvas, used by the atlas builder AND copied into the `show` viewer). share-room "+ chart" picker + chart editor + charts threaded into all 4 buildPagePayload sites. **3-lens gate ran** → fixed 2 blockers (show had no chart case → silent published hole; `rewriteChartScopeIds` was dead → wired into `handleIdSwap` + `atlas:charts-changed` event).

## Queued chart bouts (pick up here — additive, no migration)
**forward-half** render (Simmer's wedge: owed/coming/due, now-line as the seam; `ChartAxis.direction` already typed) → now-line(s) + reconciler → Narrative lanes (`laneKey`) → fuzzy/relative dates (`DateSpec` is a tagged union; freeze adds an OPTIONAL `dateSpec?`/band field — never reshape `date`) → map-chart + scrubber → 3D. And still open across atlas: the Cmd+K palette.

**Design-calls to confirm with Captain** (gate-surfaced): a published chart's scope is a LIVE RULE — republish re-snapshots membership (a later-added element joins; a focus chart discloses the whole neighbourhood). Consistent with the circle block; documented in `chart-freeze.ts`. Confirm that's the intended boundary vs. freezing the id-set at first publish (like map pinIds).

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
