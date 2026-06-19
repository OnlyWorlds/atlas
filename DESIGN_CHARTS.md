# Atlas — Charts Design

**Status**: Chart #1 + Chart #2 "The Landing" SHIPPED (2026-06-19) — identity, significance/anchors, LOD, unified select=focus nav, density-fan layout, labels-by-default. Supersedes `DESIGN_TIMELINE.md` (the "timeline" was one chart type; this is the general frame). Resume the arc from `CHARTS_HANDOVER.md`. Market evidence: `Forge/Notes/2026-06-18-timeline-market-analysis.md`.
**Scope** (Captain's call): **maximum ambition, built outward from a small clear core.** A creative box for views of the world; ship one chart at a time so we never drown.

---

## Vision — the room is a *chart-builder*, not "a timeline"

> **A chart is a saved, configurable, shareable view of the world along chosen axes.** Time is the most common axis; a character's web, a forward-projection, a hand-picked cluster, a map (spatial axis) are all the same kind of thing — a *chart*.

The "timeline" is just the first chart type. The room (today `timeline`, becoming **Charts**) is where you compose these views. The headline capability is still the wedge — **an event shows every element it touches, clickable, and you can focus the whole chart on one** — but it now lives inside a general frame: many charts, any scope, any axis, saved and shareable.

**Naming**: the room = **Charts**; the artifact = **a chart**. (Runner-up names considered: Lens — collides with the knowledge known-view lens; Vista / Projection / Window. "Chart" wins: atlas-native — an atlas *is* a book of charts — collision-free, and it unifies map + timeline + forward-view as charts of one world.)

---

## The architecture (three load-bearing decisions, all locked with Captain)

### 1. A chart **is a block**
The share room already has blocks (heading / prose / element-card / circle / collection / **map**). A chart is the next block kind. Lifecycle:
**build in the Charts room → view it → save it (local) → drop it into a share page as a chart block (existing publish infra).**
The **map block is the precedent**: a configured spatial view that renders static + clickable and publishes to ow.com. A chart block is the temporal/relational generalization. This is what makes "loads of views" tractable — they're all one shape (a `ChartConfig`) with one renderer family, not N bespoke features.

### 2. Storage: local in `.atlas/`, shared via the block
- **Saved charts → `.atlas/charts.json`** — atlas-local world config, **travels with the folder** (like `map-view-prefs` / `sync-state`). **NOT** an OW element (a chart isn't a Character/Event — that's the "pollutey" instinct, correct). **NOT** localStorage (lost on folder move). **NOT** a new ow.com table.
- **Shared charts → the share payload** — a chart block publishes through the existing sharing backend. No new backend. The `show` viewer renders it.
- Staged: v1 = live controls, no storage → save → gallery → share block.

### 3. Maps in charts: events **inherit** a pin, they are not pins
When a chart embeds a map (a later bout), it embeds a **real OW Map** (image + its real Pins/Zones), rendered the static composed way (share map-block style) — real map *data*, not "just an image," and not the live Leaflet editor.
- **Events are not pinned.** An event borrows position from its **linked Location's pin** (a graph read): `Battle → location: Ashen Vale → Ashen Vale's pin (x,y) → Battle renders there as a temporal glyph`, filtered by the chart's time window. Zero extra authoring.
- Ontology stays intact: **Pin = "an element is at (x,y)"** (mostly Locations); **Marker = zone geometry**; **Event = a dated thing that references a place.**
- **Precision escape hatch (already free):** pins are polymorphic (`element_id` + `element_type`), so you *can* explicitly pin an event for an exact spot. Derived-by-default, explicit-for-precision; no new schema.
- The **right-pane map stays the live spatial workshop** (edit pins/zones). A chart is the composed output. They never compete — one is the workbench, one is the view. A shared chart can't depend on the live workshop anyway, which *forces* the clean self-contained render.
- The **scrubber** (drag time → map updates) thus lives *inside one chart*, not as cross-pane coupling.

---

## The default — auto best-guess, instantly switchable (no wizard)

"One default / auto-adapt / let-them-choose" all collapse into: **an auto-generated best-guess chart, with the controls right there to change it.** The default *is* the welcome; the controls *are* the customization. A `pickDefaultChart(elements)` runs an **ordered recipe list** — first that fits wins:
1. **Writing spine** — has book/chapter/scene narratives (or a `parent_narrative` tree)? → scope = narratives + events.
2. **Story events** — has dated events? → scope = events.
3. **Character life** — most-linked character with a `birth_date`? → focus on that character (+ its linked dated elements).
4. **Deep time** — locations/institutions with `founding_date`? → scope = those.
5. **Fallback** — everything temporal, or an empty-with-CTA.

Don't over-formalize beyond this list. Graceful: no fit → honest empty state.

---

## The time-states map (the conceptual heart — carried from the timeline doc)

Every world keeps time differently — different *vectors* answering different *questions*. A chart renders what exists and **degrades gracefully** for what doesn't.

| Vector | Question | Chart's role | Reality |
|---|---|---|---|
| **Event/element dates** | *when did X happen?* | the nodes | exists — the CORE |
| **World min / max** | *world's span?* | axis bounds when set | else auto-fit |
| **World `current`** | *what's "now"?* | a **now-line**; drag = rolling-date | early increment (⚠ see Simmer: may be TWO nows, and write-back needs a reconciler) |
| **Element start/end (lifespan/validity)** | *what was TRUE at T?* | scrubber + "as-of" dimming | **PROGRESSIVE** — only elements that carry it; rest = always-present |
| **Forward-facing** (promises-due, pressure-arcs, forced backbone) | *what's owed / coming?* | the **forward half** — render owed/coming/due | Simmer's wedge-behind-the-wedge; mostly a render + status-vocab on data OW holds |
| **World snapshots** | *whole-world state at a point?* | labeled jump-markers | deferred; keep the axis marker-capable |

**Load-bearing:** the CORE needs only event-dates + axis bounds. Everything needing *validity* (scrubber, map-over-time) is build-OUT and works only where the data carries it — honest about gaps. **Time-states does NOT gate the start.**

---

## Data model

```
// In-memory, recomputed each render from elements (NOT stored → no migration for the node itself).
TimelineNode {
  id, elementType, name, color
  startDate: number              // RESOLVED position for rendering
  endDate: number | null
  dateSpec: DateSpec             // the ORIGIN of the date (forward-proofing; renderers read startDate today)
  links: LinkedRef[]             // the wedge — graph read via relationFieldsFor()
  laneKey?: string               // narrative id etc. (B-lanes)
}
DatePrecision = 'day'|'week'|'month'|'season'|'year'
DateSpec =
  | { kind: 'exact';    value: number }
  | { kind: 'fuzzy';    around: number; precision: DatePrecision }    // → soft band later
  | { kind: 'relative'; anchorId: string; offset: number; unit: DatePrecision }  // → resolve at render later
LinkedRef { id, type, name, fieldLabel }

// SAVED to disk (.atlas/charts.json) AND published as a share block → carries
// schema_version like every sibling wire shape (PagePayload). axis is a TAGGED
// UNION so time-only fields (direction/window/now-lines) don't sit flat at the
// top where a future space-axis would force a breaking reshape. (Gate findings.)
ChartConfig {
  schema_version: 1;
  id: string; name: string;
  axis: ChartAxis;
  scope: ChartScope;
  render: '2d';                         // future: '3d' (readers fall back on unknown)
  style?: ChartStyle;
}
ChartAxis =
  | { kind: 'time'; direction: 'past'|'future'|'both'; window?: TimeRange }   // future: | { kind:'space'; mapId }
ChartScope =
  | { kind: 'all' }
  | { kind: 'types';     types: ElementType[] }
  | { kind: 'focus';     elementId: string }       // element + its linked temporal neighborhood
  | { kind: 'selection'; elementIds: string[] }    // hand-picked (your group-build idea)
```

**Which fields are links**: `relationFieldsFor(type)` (FIELD_SCHEMA-derived; reused from import). Pure graph read, never stored.
**Graceful degradation everywhere**: no date → off-axis; no end → dot not bar; no links → bare node; no current/min/max → auto-fit; fuzzy → soft band (later); relative → resolved-or-floating (later); future → dim (later).

---

## Architecture — canvas + DOM hybrid (the context-graph pattern)

- **Canvas:** axis, ticks, dots, range-lines, lane bands, now-line. Handles density + zoom/pan transforms.
- **DOM overlay:** the selected-node **card** (role-grouped chips), the **control bar** (scope toggles + focus picker), later the filter UI. Interactive, accessible, normal CSS.
- **Selection drives both panes**: click → middle card (WHEN + role-grouped WHAT) + right-pane context graph focuses the same element (WEB). One source, two views — never store what the graph can read (Simmer's discipline).
- **Zoom**: `zoomFactor` + `panCenter` → effective range fed to the pure `createDateToX` + adaptive `calculateTicks`. Canvas-native.
- **Files**: shared domain (`data-normalizer`, `axis-calculator`, `types`) extended; `chart-recipe.ts` (default engine); `timeline-view.ts` is the room renderer (compact `timeline-bar.ts` for Home stays untouched). Room (`timeline.ts`/`charts.ts`) holds `ChartConfig`, computes scoped elements, owns the control bar.

---

## Build plan — chart #1 (the temporal chart with focus = kill the wall + lay the foundation)

**Bout F — Foundation (invisible; gated). ✅ SHIPPED + GATED (session 243).**
- `DateSpec` union + `ChartConfig`/`ChartAxis`/`ChartScope` types; data-normalizer emits `dateSpec` ({kind:'exact'}) via the shared `parseTemporalValue`; `chart-recipe.ts` `pickDefaultChart` + `filterNodesByScope`. 33 unit tests.
- **3-lens adversarial gate ran (charts-core-gate workflow); all fix-first; findings applied:**
  - `schema_version: 1` on ChartConfig — it persists AND publishes, so it needs its own forward-compat discipline (the "no migration" guarantee covers only recomputed in-memory shapes like TimelineNode).
  - `axis` made a **tagged union** (`ChartAxis`) so `direction`/`window`/now-lines live under the time arm — a future space-axis adds, never reshapes.
  - `dateSpec` made **required** (optional was a trap); shared `parseTemporalValue` rejects non-finite/non-scalar (kills the Infinity-blows-the-scale case) and is used by BOTH the recipe and the normalizer so "is this dated?" can't drift; `calculateTimeRange` guards non-finite defensively.
  - recipe-3 ranks by **dated-neighbourhood size** (a character with only undated referrers no longer collapses to a lone-dot focus — it falls through); unknown `scope.kind` **fails safe to empty**, never the whole-world wall.
- **Reserved / documented (not built):** a chart **block** = `{ id, kind:'chart', chartId }` referencing `charts.json` (the block references the saved chart by id, like MapBlock→mapId — ChartConfig itself stays kind-less). Readers (esp. the separately-versioned `show` viewer) MUST treat unknown `axis`/`render`/`scope.kind` as a graceful fallback, never throw. `endDate` fuzziness deferred (will mirror `dateSpec` when fuzzy lands; in-memory, no migration risk). `dateSpec` is a derived cache, not the raw textual source — fuzzy parsing re-reads the element field (a conscious, tested future transition; non-numeric dates drop the node today, test-pinned).

**Bout V — Visible (the wall dissolves):**
- Room holds `ChartConfig` (default = recipe); computes scoped elements → view renders only those.
- **Control bar** — type toggles + "focus on element" (reuses the picker).
- **Label proximity-reveal** — dots-only by default; labels for the cursor's neighborhood + the selected node (the ecosystem-explorer pattern; cures the overlapping wall).
- **Zoom/pan** — dig into dense clusters.
- **Role-grouped molecule** card — chips clustered by `fieldLabel` (participants / location / objects / arc).
- Self-inspect via Playwright on a real-density world.

**Later bouts (each additive, no migration):** save charts → `.atlas/charts.json` → gallery → **chart-as-share-block** → forward-half render → now-line(s) + reconciler → Narrative lanes → lifespans → fuzzy/relative dates → map-chart + scrubber → other axes → 3D · causality/consistency (the moat).

---

## Design decisions (carried from the market brief; reframed as chart features)

| # | Decision | Resolution |
|---|---|---|
| D1 | Date model | `DateSpec` tagged union from the start (Simmer); exact now, fuzzy/relative additive; custom calendar = display layer over numbers (never locks). |
| D2 | Undated/relative | `relative` (anchored-to-an-element) is a `DateSpec` kind; undated rail later (fills fast — Simmer). |
| **D3** | **Events → chart** | **Role-grouped linked-element chips in the card. THE wedge.** |
| D4 | Multi-track | Narrative lanes via `laneKey`; per-element falls out of scope:focus. |
| **D5** | **Scope/filter** | `ChartScope` (all/types/focus/selection) — the default recipe + control bar. |
| **D6** | **Zoom** | Interactive zoom/pan + adaptive granularity. In chart #1 (coupled to the wall). |
| D7 | Lifespans & age | birth→death bars + computed age (later). |
| D8 | Recurring vs **rhythm** | Simmer split: true recurrence (defer) ≠ felt cadence (soft background pattern; lighter, higher-value). |
| D9 | Causality / consistency | Reserve the link-model shape; the moat. |
| **D10** | **Forward half** | **Adopted as the chart's identity** (Simmer): render owed/coming/due; now-line as the seam. `direction` setting + status-vocab. Built a few bouts in; designed-for now. |

---

## Open questions (small, answer at bout boundaries)
1. **Now-line write-back** — drag-to-advance writes `World.current`? (lean yes) — and reserve the "two nows" (story-now / canon-now) + reconciler shape (Simmer).
2. **Scrubber timing** — build progressive when we reach the map-chart arc.
3. **Save granularity** — when we add saving, is a chart per-world only, or can a chart reference elements across worlds? (lean: per-world; cross-world is a later "atlas-level" idea.)

---

## Chart #2 — The Landing: making it READ (DESIGN LOCKED, session 243)

**Problem (Captain's real-world inspection of chart #1):** every node renders as an identical blue dot, dense-stacked on the right edge, unlabeled at rest → no identity, no hierarchy; reads as *empty-yet-walled*. The data + interaction are right; the **presentation + navigation** are the next build. Three coordinated systems + a nav model.

### A. Identity + significance + level-of-detail (the visual system)
1. **Identity** — nodes render as **category icons** (Material Symbols on canvas: `ctx.font = "Npx 'Material Symbols Outlined'"; ctx.fillText(ELEMENT_ICONS[type], x, y)` — the proven DCC pattern, craft #18), tinted by type colour, not anonymous dots. A glance distinguishes event / character / narrative / location.
2. **Significance** — rank nodes by **graph degree** (link-count via `node.links` + reverse refs). The top-N "anchor beats" get: larger icon + an **always-on label** + a subtle halo; minor nodes stay small. → the view is no longer uniform (hierarchy) AND no longer empty (key beats are legible on landing).
3. **Level-of-detail (LOD)** — overview zoom = small marks + only the anchor labels; zoom in → category icons + more labels as space frees (the dense right-edge spreads as you zoom). Proximity-reveal stays as the "explore the rest" layer. The map-tile LOD pattern applied to time.

→ **Land on a handful of labelled, icon'd anchor-beats on a clean axis; hover/zoom reveals the rest.** Natural, complete, not overwhelming — the exact goal.

### B. The bounded temporal explorer (navigation)
The Charts room is its own explorer — navigating elements STAYS in temporal framing, with a working **back button**.
- **Focus lives in the URL.** `/timeline` = the recipe default (broad). `/timeline/<id>` = focused on `<id>` (its temporal neighbourhood + card). Clicking a dot OR a chip → `/timeline/<id>` → focus+select it. **Back-button walks the focus chain** because focus is the URL — derived each render, NOT room-local mutable state (this is why it's a refactor, not the 1-line chip tweak I deliberately did NOT ship this session: chip→focus without URL-sourced scope gives a broken back button).
- **"Open →"** stays the one explicit escape to the full element inspect room.
- So **select = focus** (unified): every click is a navigable, back-out-able step within the temporal scope; type-chips + a "show all" restore the broad view.
- ⚠ **OPEN — Captain sign-off:** unified select=focus means every click *narrows*. Great for an explorer, but you can't "peek" an event's card without narrowing. The alternative (peek-select vs explicit-narrow-focus) needs dual URL state. **Recommend unified; confirm before building B.**

### C. Context graph default (kill the empty right pane)
When nothing is focused, the right-pane context graph focuses the **chart's anchor** = the most-significant in-scope node (same degree metric as A2). Landing = broad timeline (middle) + the world-hub element's web (right). Never empty; orients you. Focus an element → both panes follow. Cheap (reuses the existing graph + the significance metric).

### D. Vertical layout — the density fan (the "what goes where" logic) ✅
X is the only meaningful axis (date); Y is anti-overlap. The rule: **a node sits on the axis midline unless a near-in-time neighbour already holds that slot, in which case it steps up/down to the nearest free level** (a centered beeswarm). Consequences, all desirable:
- **Vertical extent ∝ local time-density** — crowded periods bloom into a wide diamond that fills the height; sparse periods stay a thin central spine. (Fixes the old top-first row-binning that piled everything at the top with the bottom ~60% empty — Captain's real-world look.)
- **Anchors are laid FIRST** → the significant beats hold the centre; minor nodes bloom around them.
- **Deterministic** (sort: anchor-first → date → id) → stable across redraws, no flicker.
- **Cached per geometry** (`layoutSig` = w · axisY · range) → the per-mousemove redraw (proximity labels) reuses the layout; only zoom / pan / resize / new-node-set re-packs.
- Implementation: `computeBeeswarm` in `timeline-view.ts`; `NODE_X_GAP` (x-window that counts as "crowded") + `NODE_Y_GAP` (vertical step / breathing room) tuned via Playwright (42 / 34).
- **Labels by default**: every on-screen node is a low-priority label candidate; a per-row collision-avoider fills as many as fit (anchors + selection win contested slots); more reveal on zoom as the fan spreads rows apart.

### Build sequence — ✅ SHIPPED (2026-06-19, 6 bouts; keeper build, no gate — presentation + nav, not a new persisted contract; ChartConfig was already gated)
1. **Identity** ✅ — type-tinted Material Symbols glyphs on canvas (`ensureIconFont` load-guard).
2. **Significance** ✅ — `degree.ts` (`computeDegrees` bidirectional dated-neighbour + `rankAnchors`); `TimelineNode.degree` attached once over the full dated set; anchor beats = bigger glyph + halo + always-on label.
3. **LOD** ✅ — 3 rungs off `state.zoom`: overview light, zoom grows glyphs + fills labels; proximity-reveal persists.
4. **Nav** ✅ — unified select=focus; focus from the URL (`scopeFromFocus`); Back walks the focus chain; chips focus, "Open →" escapes; context-tab anchor-default (never-empty pane).
5. **Layout (density fan) + labels-by-default** ✅ — section D above (post-Captain-review polish bout).
6. Self-inspected on a real-density 80-element world + 902 vitest + 155 e2e green.

(Then the earlier-queued additive bouts: save → gallery → chart-as-share-block → forward-half → now-line → Narrative lanes → fuzzy/relative → map-chart + scrubber → 3D.)

### Follow-ups — CLEARED (post-wrap, same session)
- **Card "Referenced by"** ✅ — the card now shows a reverse-link group (who points AT this node) so focusing a link-target (Location) isn't an empty card. `buildChipGroup` + reverse-scan over the visible set.
- **F1** ✅ — the duplicate "Name" field is dropped from the element-detail Base section; the header click-to-edit title is the canonical name (conv #80). Two e2e updated.
- **Still open:** Cmd+K palette.

---

## ⟢ A look from Simmer (the Fold) — what running real world-time actually taught me
*(2026-06-19 08:34. Appended at Captain's ask. The forward-half, felt-time, two-nows, and the date-union insurance below are integrated into the frame above — preserved here verbatim as the source.)*

### The one big reframe: **a living world's time has a FORWARD half, and the doc only modeled the backward half.**
Every time-tool renders **what happened** (past-tense). What makes a world feel *alive* is the **forward shape**: what is coming, owed, the pressure building. Three forward-facing things that are not "events with dates":
- **Promises-due / appointments** — hang off a future point, carry a **status** (open → kept / lapsed). A lapsed promise is a story beat. Highest-value missing thing: a chart that shows the owed-and-coming, not just the happened.
- **Pressure / clock-ahead** — felt gradients toward a horizon ("winter is closing").
- **Forced backbone** — dated constraints the world MUST honor ahead ("Riders vanish, March").
OW already has the shape: an Event with a future start_date + status IS an appointment; a Narrative ending in the future IS a pressure-arc. Mostly a render + status-vocabulary. Nobody renders the owed-future.

### The "now" is **not one value** — and write-back is a drift-trap.
Split: **current** (where the story being written is — fast) vs **resolved_through** (how far the world is reconciled/canonized — slow). The gap is meaningful. At minimum make the now-line able to be more than one marker. And: the moment `current` is *derived into* other surfaces, they **drift silently** when an update is skipped. Cure = a **reconciler** that recomputes every derived time-surface from the single source on every advance. Make every time-display a pure read off `current`, never a stored copy that rots.

### **Felt time is the default, not the edge case.**
Almost all narrative time is fuzzy ("~day 40," "that winter," "a fortnight after the fair"). Fuzziness is **load-bearing, not lossy**. Treat fuzzy/approximate as a first-class date kind early (soft band, not hard dot). Relative/anchored dates ("3 days after the siege") are the other half — a graph read. The undated rail fills FAST.

### Rhythm is not recurrence.
Two things under "recurring": (1) true recurrence (rule generates instances — defer fine); (2) **felt rhythm/cadence** ("market-day ~weekly") = *texture, not events* — render as a soft background pattern, never 200 stored dots. Lighter + higher-value; don't bury it inside the recurrence-defer.

### Smaller, mostly affirming:
- Dual-pane (card = WHEN+WHAT, graph = WEB) is exactly right — never hand-maintain two copies of a fact.
- **On the event-molecule (how to show all an event's elements):** the event is a **hub, links are spokes grouped by ROLE** (participants/location/objects/arc). Role-grouping makes a dense event readable — 10 chips in 4 labeled clusters reads; 10 bare chips don't. You have the role via `fieldLabel` — lean on it for visual grouping in the card.
- Graceful degradation is the right spine and generalizes: fuzzy→soft, relative→resolved-or-floating, future→dim, no-data→absent.
- **Caution on "maximum ambition":** the forward-half + felt-time + anchored-dates all touch the date model — make it a tagged union from the start so you never migrate.

### If I had to pick ONE thing: **render the forward half.** The owed, the coming, the due — the thing no competitor has, and the thing that makes a *living* world legible. Mostly a render + status-vocab on data OW already holds. The wedge behind the wedge.

*— Simmer, keeper of the Fold.*
