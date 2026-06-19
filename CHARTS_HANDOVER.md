# Charts — Next-Session Handover

*Running-start pickup for the Charts arc. Load this FIRST when resuming charts work, then `DESIGN_CHARTS.md` for the full design. Written end of session 243.*

## Where it stands

**Chart #1 (the temporal chart) is SHIPPED, gated, and self-inspected.** A chart = a saveable/shareable view of the world along chosen axes (time first); the room is at `#/w/<id>/timeline` (room title "Charts"). 890 vitest + 154 e2e + typecheck + build green. Nothing committed (Captain's hand on git).

**What works now:** recipe-picked default scope (opens on the Story spine / Events / etc., not the full wall) · type-toggle control bar · click-event → role-grouped molecule card (chips by role) + right-pane context graph focuses the same element · card **Focus** = filter-by-element (re-scope + auto-fit) · proximity-reveal labels (dots at rest; reveal near cursor; flip left at the right edge) · wheel-zoom + drag-pan · compact home `timeline-bar.ts` untouched.

**What Captain saw needs work (→ chart #2, design LOCKED):** on a real-density world it's a *uniform scatter of identical blue dots, walled on the right edge, unlabelled* — no identity, no hierarchy. The fix is the **visual system + navigation model** (DESIGN_CHARTS "Chart #2 — The Landing").

## The locked plan for next session (DESIGN_CHARTS "Chart #2 — The Landing")

Build, in order (keeper build — presentation + nav, NO adversarial gate needed; ChartConfig is already gated):
1. **Nav refactor** — focus lives in the URL (`/timeline/<id>` = focus, derived each render, not room-local); **select = focus**; back-button walks the focus chain; "show all" → broad. (This is why chip→focus wasn't a quick fix — the back button needs URL-sourced scope.)
2. **Identity + significance** — nodes become **category icons** (Material Symbols on canvas, craft #18); rank by **graph degree**; top-N "anchor beats" get bigger icon + **always-on label** + halo.
3. **LOD** — overview = small marks + anchor labels only; zoom in → icons + more labels (dense right-edge spreads).
4. **Context-graph anchor default** — when nothing focused, focus the most-significant in-scope node so the right pane is never empty.
5. Self-inspect + verify.

## ⚠ ONE decision to get from Captain before building step B (nav)
**Unified select=focus** (every click narrows to that element's neighbourhood, back-out-able) — recommended, makes it a true bounded explorer — **vs** keep "peek" (click selects/shows card without narrowing) + a separate explicit Focus (needs dual URL state). Confirm, then build the nav refactor.

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
save → gallery → chart-as-share-block → **forward-half** (Simmer's wedge-behind-the-wedge: render owed/coming/due, now-line as the seam) → now-line(s) + reconciler → Narrative lanes → fuzzy/relative dates → map-chart + scrubber → 3D. And still open across atlas: **F1** (element-detail duplicate Name field, conv #80 — approved, not done) + the Cmd+K palette.
