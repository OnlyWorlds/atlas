# Atlas — Charts Design

**Status** (2026-07-10, session 252): Chart #1 + Chart #2 "The Landing" + **save/gallery + chart-as-share-block** + the FULL **v1 trust set** — Bout 1 (window refactor + overview strip), Bout 2 (weight-ranked label budget + "+N" cluster badges + protagonist-first default window), Bout 3 (docked selection card, right/bottom variants awaiting Captain's pick) — all **SHIPPED**. The **2026-07-10 sitdown (S1-S15)** is integrated below — every open call is closed.
**Scope** (Captain's call): **maximum ambition, built outward from a small clear core.** A creative box for views of the world; ship one chart at a time so we never drown.
**Pointers**: pickup → `CHARTS_HANDOVER.md` (⚑ SESSION 252 OPENER). Decision record → `Forge/Notes/2026-07-10-charts-sitdown-decisions.md` (do not edit — the authoritative sitdown layer). Market evidence → `Forge/Notes/2026-06-18-timeline-market-analysis.md`. Scroll-view technique dig → `Forge/Notes/2026-07-10-owcom-scroll-technique.md`.

---

## Vision — the room is a *chart-builder*, not "a timeline"

> **A chart is a saved, configurable, shareable view of the world along chosen axes.** Time is the most common axis; a character's web, a forward-projection, a hand-picked cluster, a map (spatial axis) are all the same kind of thing — a *chart*.

The "timeline" is just the first chart type. The room (route `timeline`, titled **Charts**) is where you compose these views. The headline capability is still the wedge — **an event shows every element it touches, clickable, and you can focus the whole chart on one** — but it now lives inside a general frame: many charts, any scope, any axis, saved and shareable.

**The room has three jobs (the sitdown frame):**
- **orient** — the landing shows the shape of the world's history (built; sharpened by Bout 1's strip + Bout 2's smart default).
- **investigate** — the focus-chain wedge (built).
- **compose** — save / share views (built, still quiet; home tie-in deferred to home pass 2).

**Naming**: the room = **Charts**; the artifact = **a chart**. ("Chart" wins: atlas-native — an atlas *is* a book of charts — collision-free, and it unifies map + timeline + forward-view as charts of one world.)

---

## The architecture (three load-bearing decisions, all locked with Captain)

### 1. A chart **is a block** — ✅ SHIPPED (2026-06-19, 3-lens gated)
The share room already has blocks (heading / prose / element-card / circle / collection / **map**). A chart is the next block kind. Lifecycle:
**build in the Charts room → view it → save it (local) → drop it into a share page as a chart block (existing publish infra).**
The **map block is the precedent**: a configured spatial view that renders static + clickable and publishes to ow.com. A chart block is the temporal/relational generalization. This is what makes "loads of views" tractable — they're all one shape (a `ChartConfig`) with one renderer family, not N bespoke features.

**As built**: block `{ kind:'chart', chartId }` in `core/sharing.ts` — deliberately NOT in the refs mirror (chartId is atlas-local, never id-swaps; the chart's *scope* element ids migrate via `rewriteChartScopeIds` wired into `handleIdSwap`, firing `atlas:charts-changed`). `freezeChartBlock` (`visualization/timeline/chart-freeze.ts`) snapshots the scope → identity nodes (name/type/date/anchor; `ref` ONLY when the element is also carded — the scope IS the disclosure boundary) → `PayloadChartBlock`. `renderChartView` (`chart-static.ts`) draws a static density-fan, shared by the atlas builder + COPIED into the `show` viewer (`payload-types.ts` parse + `render.ts`). Freeze-at-publish + re-snapshot-on-republish — a published chart's scope is a **live rule** (S12 confirmed; aligned with circle/sharing semantics).

### 2. Storage: local in `.atlas/`, shared via the block
- **Saved charts → `.atlas/charts.json`** — atlas-local world config, **travels with the folder** (like `map-view-prefs` / `sync-state`). **NOT** an OW element (a chart isn't a Character/Event — that's the "pollutey" instinct, correct). **NOT** localStorage (lost on folder move). **NOT** a new ow.com table. Shipped: `FolderStore.readCharts/writeCharts` + pure `charts-store.ts`; the chart-scope migration is serialized (module-level RMW chain, same lost-update class closed for sync-state).
- **Shared charts → the share payload** — a chart block publishes through the existing sharing backend. No new backend. The `show` viewer renders it.

### 3. Maps in charts: events **inherit** a pin, they are not pins
When a chart embeds a map (a later act), it embeds a **real OW Map** (image + its real Pins/Zones), rendered the static composed way (share map-block style) — real map *data*, not "just an image," and not the live Leaflet editor.
- **Events are not pinned.** An event borrows position from its **linked Location's pin** (a graph read): `Battle → location: Ashen Vale → Ashen Vale's pin (x,y) → Battle renders there as a temporal glyph`, filtered by the chart's time window. Zero extra authoring.
- Ontology stays intact: **Pin = "an element is at (x,y)"** (mostly Locations); **Marker = zone geometry**; **Event = a dated thing that references a place.**
- **Precision escape hatch (already free):** pins are polymorphic (`element_id` + `element_type`), so you *can* explicitly pin an event for an exact spot. Derived-by-default, explicit-for-precision; no new schema.
- The **right-pane map stays the live spatial workshop** (edit pins/zones). A chart is the composed output. They never compete — one is the workbench, one is the view. The **scrubber** (drag time → map updates) thus lives *inside one chart*, not as cross-pane coupling.

---

## The viewport model — the window IS the camera (Bout 1, ✅ SHIPPED 2026-07-10)

**There is no camera.** The old `zoomFactor` + `panCenter` zoom state is GONE. The one viewport state is a **window** — `window: { start, end }` in **world-date units**. Everything else derives.

- **The overview strip IS the camera.** The bottom **26px** of the canvas renders the FULL dated universe as density marks (the room passes `setNodes(scoped, allNodes)` so the strip sees every dated element, not just the scoped set). A **bright viewport band** over the strip marks the current window. The band is a **control, not a display**:
  - **drag the band** = slide the window (travel through time).
  - **edge-drag the band** = resize the window (zoom).
  - **click the track** = jump the window there.
  - **ONE fading ghost** of the previous window lingers for constancy.
- **Wheel** resizes the window around the **cursor date**; **drag** on the main axis slides it. Vertical never zooms (the fan is layout, not scale). `clampWindow` / `zoomWindow` are pure + unit-tested (9 unit tests).
- **LOD derives from `fitSpan / viewSpan`** (how much of the universe the window shows) — overview = light marks + anchor labels only; zoomed-in = category glyphs + more labels as space frees.
- **Focus jumps animate** as camera travel: 280ms ease-out window animation on scope change, single rAF driver for travel + ghost. The main axis **re-fits per focus** (not locked); the strip provides the constancy (band slides, ghost lingers).
- **Axis date text brightened** (0.30 → 0.55, 11px). **Labels are click targets** (`state.labelBoxes` hit-test) — clicking a label focuses that element, same as clicking its glyph.

**Architecture — canvas + DOM hybrid** (the context-graph pattern):
- **Canvas:** axis, ticks, glyphs, range-lines, the density fan, the overview strip + band + ghost. Handles density + the window→x transform.
- **DOM overlay:** the selected-node **card** (role-grouped chips), the **control bar** (scope toggles + focus picker), the saved-chart gallery.
- **Selection drives both panes**: click → middle card (WHEN + role-grouped WHAT) + right-pane context graph focuses the same element (WEB). One source, two views — never store what the graph can read (Simmer's discipline).
- **Files**: shared domain (`data-normalizer`, `axis-calculator`, `types`); `chart-recipe.ts` (default engine + `scopeFromFocus`); `degree.ts` (significance); `timeline-view.ts` is the interactive room renderer (window state, fan, strip, proximity labels); `chart-static.ts` (frozen render, shared with `show`); the room `middle/timeline.ts` holds `ChartConfig`, computes scoped elements, owns the control bar. The compact home `timeline-bar.ts` was DELETED 2026-07-10 per S15 (its successor is the strip / chart-static).

---

## The sitdown decisions (2026-07-10 design layer, S1-S15)

*Folded from `Forge/Notes/2026-07-10-charts-sitdown-decisions.md` — the authoritative record of the D7 sitdown. Status tags reflect session 252.*

| # | Decision | Call | Status |
|---|---|---|---|
| S1 | The label wall | It is a SCALE problem, not a label problem: the default fit (year 0–457) puts ~24 years ≈ 42px = one fan column. Fix = smart default window + overview strip + weight-ranked label budget. Restores chart #2's original LOD intent (labels-by-default overrode it). | strip ✅ / budget in Bout 2 |
| S2 | Overview strip | IN — the room's anchor mechanism. Thin full-span density strip; bright band = current viewport; band draggable/resizable (a control, not a display). ONE fading ghost of the previous window. Era bands + now-line markers live here later. Signature element: gets real design care. | ✅ SHIPPED (Bout 1) |
| S3 | Zoom model | There is no camera: the viewport IS the band. One state `{start,end}` in world-time replaces `zoom`+`panCenter`. Wheel resizes the band around the cursor date; drag slides it. Vertical never zooms (fan = layout). | ✅ SHIPPED (Bout 1) |
| S4 | Label budget | Weight = graph degree + content mass (description/prose length) + favorites (always win). Budget per fan column proportional to space; "+N" affordance where dropped (click = zoom to cluster). | ✅ SHIPPED (Bout 2, S252) — plus label position fallbacks (side/above/below) |
| S5 | Default recipe | NEW step 0: protagonist-first. Cast-slot discoverability hint on home. | ✅ SUPERSEDED BY THE TABLEAU (S252, Captain's call): the LANDING is the tableau — no chips lit, cast + weighted essentials across categories, cast marks make the protagonist central. The interim protagonist-WINDOW implementation was deleted same-session. |
| S6 | Focus jumps | Main axis re-fits per focus (not locked), ANIMATED as camera travel; the strip provides constancy. Clickable labels (not just glyphs). Axis date text brighter. | ✅ SHIPPED (Bout 1) |
| S7 | The card | Docked (right-edge-in-room vs bottom strip: prototype both, Captain picks from screenshots), content-budgeted (chips capped per role group + "+N", description snippet), clear Open/Edit actions. Never floats over data. | ✅ SHIPPED + PICKED — RIGHT dock (bottom variant deleted, switch removed; re-confirmed by Captain S268). Shipped Open only (element room IS the edit surface) |
| S8 | Per-type element charts | ✅ SHIPPED (Act 2A, S261) as **two mechanisms + vocabulary**, not four bespoke renderers (schema check collapsed the archetypes: no death field exists, family has no dates): **(1) recorded open-ended spans** — `title` has `openEnd` semantics in `TEMPORAL_TYPE_FIELDS`; grant with no revoke renders grant→now with a fade-out cap (the fade IS the honesty), in EVERY view, lane-claimed to the effective end; engages only when `time_current` is set and ahead of the grant. Inverted revoke stays a point (recorded bad data ≠ ongoing). **(2) focus-inferred spans** — `extras.focusId` marks the chart's SUBJECT: it places first (holds the centre spine, its span claims the lane), its span draws THICK, and a focused character/creature born before the now gets a DOTTED birth→now life-line (dotted = inference; the schema records no death, so alive-to-now is presumption, focus-only because in broad view every living character's bar converges on the now-line as noise). Arcs/beats fall out free: a focused narrative = thick straddle-split ribbon with its involved elements beeswarmed along it. **(3) card vocabulary** — `temporalMetaLine`: `granted 12 · revoked 31 · held 19` / `granted 28 · held 10 so far` / `born 5 · age 33` / `founded 8` / `formed 3`; durations unitless until the S9 calendar. Kernels pure + unit-locked (`effectiveEndDate`, `focusInferredEnd`, `extendRangeForOpenEnds`, `temporalMetaLine`); card meta e2e in `tenure.spec.ts`. | ✅ SHIPPED (Act 2A, S261) |
| S9 | Calendars | ✅ **SHIPPED (2B arc, S266-S267)** — binding contract `Forge/Notes/2026-07-14-calendar-design-final.md` (3-lens gated, Skeld-passed). World owns the clock (`basic_unit` = grain via the world clock GATE; `time_current` = now; `range_min/max` = extent), calendars own the language. **A calendar = a Construct with supertype `calendar`** (display convention), config in the `atlas_calendar` wire-extension field, **detection by FIELD PRESENCE, never supertype**; syncs/exports via the element pipeline (keel stores extension fields verbatim in a JSONField — source-verified S267, live smoke owed). Lens model: at most one active per room (registry `active_calendar_id`), saved charts remember theirs (`ChartConfig.calendarId`, id-swap-rewritten), dangling refs degrade to bare numbers. **S266**: pure kernel `core/calendar.ts` (format/parse/era/leap/intercalary/weekday, 45 tests) · builder modal with live preview · clock-above-create menu ruling · full surfaces sweep incl. typed calendar-word entry with resolves-to hint. **S267**: `core/calendar-axis.ts` boundary ticks with rung labels (era landmark "1 FT" / round era-local years "450 KR" / month names / day "11 Greening 454" / festival glints; label-box pruning) · era bands on plot + strip · season wash (LOUD prototype, Captain's eye pending) · deep-zoom floor (`MIN_WINDOW_STEPS` beats the 200× ratio cap on day-grain worlds) · legacy-field mint offer (4 gates, defensive seed parse, clear-on-mint + crash self-heal) · publish bake (`PayloadChartNode.label`/`endLabel` + `axisTicks`, additive; `date` numeric forever; show re-lift owed) · calendars excluded from the undated rail. | ✅ SHIPPED (S266-S267) |
| S10 | Manipulation (passive → active) | "Map room edits space; charts room edits time." Gesture grammar: drag from an **undated rail** (the WORK QUEUE) onto the axis = assign date; drag now-line = advance `time_current` (write-back YES); drag dot/range endpoints = re-date. All drops: snapped guide-line showing the calendar-aware date → inline popover pre-filled → Enter commits. | ✅ SHIPPED across Act 1 + S264: rail drag-to-date (Bout 1.2) · now-line drag (Bout 1.0) · **glyph re-dating (S264)** — drag a PLACED dot; Captain's ruling revised the endpoint grammar: **a range's end is ANCHORED**, dragging moves the start, live-clamped at the end (`glyphDropDate`); **end-cap stretch SHIPPED (S265)** — drag a recorded END cap (grip order dot > cap > label; 12px), edge-aware confirm ("End date") writes the end field, inversions rejected on both edges. Threshold preserves click=peek/re-click=focus; `revealDate` pans when a popover-typed date lands off-window |
| S11 | Forward-half staging | v1 of the feature is FIELDLESS: ahead-of-now renders hollow/dim, the now-line is the seam. No status vocabulary until lapse-tracking lands. No `time_current` → forward half simply doesn't engage. Undated owed things (pressure) out of scope. Two-nows reserved, not built. | POST-LAUNCH (Act 1) |
| S12 | Republish disclosure | CONFIRMED: a published chart's scope is a live rule; republish re-snapshots membership. Aligned with circle/sharing semantics. (Closes the gate-surfaced confirm.) | ✅ CONFIRMED |
| S13 | The scroll view (Captain + Susie) | `render: 'scroll'` as the third arm of the ChartConfig render union. Vertical time: scroll = travel; events surface/linger/recede; narrative ribbons along margins; lifespans accompany you; now-line = a seam you scroll across. Same band state, same freeze machinery → publishes as a share block. | ✅ **SHIPPED (S268)** — design `Forge/Notes/2026-07-14-s268-scroll-design.md` (C1-C13): native scroll + DOM (no GSAP — ours is data-driven, not authored scrollytelling), center spine, down = later, content-paced with named gap seams ("· 132 years pass ·", lens-formatted), era section seams, gold now seam, sticky date readout, in-place card expansion (chips + Focus/Open). Kernel `scroll-layout.ts` (pure, 14 tests) + `scroll-view.ts` behind the same handle surface as the canvas; control-bar toggle; `ChartConfig.render` widened additively. Publishes as the existing STATIC block (payload carries no render field); the show-side scrolling embed is a future deliberate bout. v1 cuts (named): no rail/drag-to-date, no minimap strip, no lifespan rails/ribbons, no season wash. |
| S14 | Recipe fit check | Pending on real worlds. After the folder-lock fix, Captain flips recipes on real worlds; findings feed S5. | PENDING (Captain) |
| S15 | Home tie-in | Starred chart vs "coming up" strip: DEFERRED to home pass 2. `timeline-bar.ts` deleted this arc regardless (its successor is chart-static or the strip). | DEFERRED (home pass 2) |

---

## The time-states map (the conceptual heart — carried from the timeline doc)

Every world keeps time differently — different *vectors* answering different *questions*. A chart renders what exists and **degrades gracefully** for what doesn't.

| Vector | Question | Chart's role | Reality |
|---|---|---|---|
| **Event/element dates** | *when did X happen?* | the nodes | exists — the CORE |
| **World min / max** | *world's span?* | axis + strip bounds when set (S9: `range_min/max`) | else auto-fit |
| **World `time_current`** | *what's "now"?* | a **now-line**; drag = advance/write-back (S10) | Act 1 (⚠ Simmer: may be TWO nows; write-back needs a reconciler) |
| **Element start/end (lifespan/validity)** | *what was TRUE at T?* | scrubber + "as-of" dimming; tenure bars (S8) | **PROGRESSIVE** — only elements that carry it; rest = always-present |
| **Forward-facing** (owed/coming/due) | *what's owed / coming?* | the **forward half** — hollow/dim ahead of now, now-line as the seam | S11: fieldless first; status vocab when lapse-tracking lands |
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
  degree: number                 // REQUIRED — significance (degree.ts), attached once over the full dated set
  contentMass: number            // REQUIRED — S4 weight input (description + story chars; raw count, weight applies log)
  laneKey?: string               // narrative id etc. (B-lanes, later)
}
DatePrecision = 'day'|'week'|'month'|'season'|'year'
DateSpec =
  | { kind: 'exact';    value: number }
  | { kind: 'fuzzy';    around: number; precision: DatePrecision }    // → soft band later
  | { kind: 'relative'; anchorId: string; offset: number; unit: DatePrecision }  // → resolve at render later
LinkedRef { id, type, name, fieldLabel }

// SAVED to disk (.atlas/charts.json) AND published as a share block → carries
// schema_version like every sibling wire shape. axis is a TAGGED UNION so time-only
// fields (direction/window/now-lines) don't sit flat where a future space-axis
// would force a breaking reshape. (Gate findings.)
ChartConfig {
  schema_version: 1;
  id: string; name: string;
  axis: ChartAxis;
  scope: ChartScope;
  render: '2d' | 'scroll';              // 'scroll' = the document view (S13, S268); future: '3d' — readers fall back on unknown
  style?: ChartStyle;
}
ChartAxis =
  | { kind: 'time'; direction: 'past'|'future'|'both'; window?: TimeRange }   // future: | { kind:'space'; mapId }
ChartScope =
  | { kind: 'all' }
  | { kind: 'types';     types: ElementType[] }
  | { kind: 'focus';     elementId: string }       // element + its linked temporal neighborhood
  | { kind: 'selection'; elementIds: string[] }    // hand-picked
```

**`ChartAxis.window?: TimeRange`** is the persisted saved-view window. Note the **live room viewport is now a window too** — the same `{start, end}` shape (see the viewport model above); saving a chart captures the current window, loading it restores it.
**Which fields are links**: `relationFieldsFor(type)` (FIELD_SCHEMA-derived; reused from import). Pure graph read, never stored.
**Graceful degradation everywhere**: no date → off-axis; no end → dot not bar; no links → bare node; no bounds → auto-fit; fuzzy → soft band (later); relative → resolved-or-floating (later); future → dim (later). Readers (esp. the separately-versioned `show` viewer) MUST treat unknown `axis` / `render` / `scope.kind` as a graceful fallback, never throw.

---

## The default — the TABLEAU (revised S252, Captain's call)

**The Charts room LANDS on the tableau**: no type chips lit (neutral state), `tableauScope` composing the world at a glance — protagonist + nexus always in (lead character + location stand in when unset), then the top-weighted essentials across categories (per-type cap 4, total 22, weight = degree + log content-mass, deterministic). Cast marks + the sparse-set spacing make the protagonist central and the view breathable. Ticking chips narrows to those types; all-off returns to the tableau (the old empty-filter → "everything" inversion is closed).

`pickDefaultChart(elements)` (the ordered recipe list: Story → Events → Character life → Foundings → all) still names/scopes the **home chart strip** default and remains available for future recipes:
1. **Writing spine** — a `parent_narrative` tree + dated content → narratives + events.
2. **Story events** — dated events → events.
3. **Character life** — most-linked character by **dated-neighbourhood size** (no lone-dot collapse).
4. **Deep time** — dated locations/institutions.
5. **Fallback** — everything temporal, or an honest empty-with-CTA.

Unknown `scope.kind` **fails safe to empty**, never the whole-world wall. S14: real-world recipe fit is pending Captain's pass.

---

## D. Vertical layout — the density fan (the "what goes where" logic) ✅

X is the only meaningful axis (date); Y is anti-overlap. The rule: **a node sits on the axis midline unless a near-in-time neighbour already holds that slot, in which case it steps up/down to the nearest free level** (a centered beeswarm). Consequences, all desirable:
- **Vertical extent ∝ local time-density** — crowded periods bloom into a wide diamond that fills the height; sparse periods stay a thin central spine.
- **Anchors are laid FIRST** → the significant beats hold the centre; minor nodes bloom around them.
- **Deterministic** (sort: anchor-first → date → id) → stable across redraws, no flicker.
- **Cached per geometry** (`layoutSig` = w · axisY · range) → the per-mousemove redraw (proximity labels) reuses the layout; only zoom / pan / resize / new-node-set re-packs.
- Implementation: `computeBeeswarm` in `timeline-view.ts`; `NODE_X_GAP` (42) + `NODE_Y_GAP` (34) tuned via Playwright.

**Identity + significance + LOD (the visual system, shipped with The Landing):**
1. **Identity** — nodes render as **type-tinted Material Symbols glyphs** on canvas (`ELEMENT_ICONS[type]`, the DCC pattern), not anonymous dots. A glance distinguishes event / character / narrative / location.
2. **Significance** — rank nodes by **graph degree** (`degree.ts` `computeDegrees` bidirectional + `rankAnchors`, cap 7). Anchor beats get: larger glyph + always-on label + subtle halo. Minor nodes stay small.
3. **LOD** — overview = small marks + anchor labels only; zoom in → glyphs + more labels as space frees. Now derived from `fitSpan / viewSpan` (Bout 1). Proximity-reveal persists as the "explore the rest" layer.

⚠ **Superseded:** the original Landing shipped **labels-by-default** (every on-screen node a low-priority candidate, a collision-avoider filling as many as fit). S1 reframed the wall as a SCALE problem and S4 replaces fill-all with a **weight-ranked per-column budget** (degree + content mass + favorites; "+N" where dropped) — landing in Bout 2. Labels-by-default was overriding chart #2's own LOD intent.

**Navigation — PEEK/FOCUS split (2026-07-10; REVISES the original "unified select=focus", which Captain reopened after real use — every click narrowing made reading expensive):**
- **PEEK** — clicking a glyph, label, or card chip shows that element's card in the reserved right rail. No routing, no scope change; re-click, ×, or another click moves it. Reading is free.
- **FOCUS** — the card's Focus action (and the room's fallback for out-of-scope chip targets) routes to `/timeline/<id>`: scope narrows to the temporal neighbourhood, the pill shows, **browser Back walks the focus chain**. A focus navigation auto-peeks its element. **Edit** on the card opens the element inspect room.
- **The rail is ALWAYS reserved** (no canvas reflow on peek — the "jump" complaint): nothing peeked → ambient content (cast rows, type legend with counts, interaction hint).
- **The TABLEAU**: all type chips off = the world's default view, NOT everything — `tableauScope` picks the cast (protagonist/nexus; lead character + location stand in) plus weighted essentials across categories (per-type cap 4, total 22). The old empty-filter → 'all' inversion is closed. Cast glyphs carry a persistent cyan ring + pin badge at every scope/zoom.
- The right-pane context graph anchor-defaults to the highest-degree in-scope node (never empty).

---

## Roadmap

**v1 remainder:**
- ~~Bout 2~~ ✅ · ~~Bout 3~~ ✅ · ~~timeline-bar deletion~~ ✅ (all session 252; evidence `Notes/ui-snapshots/2026-07-10/b2-*/b3-*.png`).
- **Captain's picks**: card dock variant (right vs bottom) · room icons · Bout E dim-rows · the S7 "Edit" action call.
- **Then** — home pass 2 (S15) → pipeline smoke (GATED on Captain's `show` push + Boss redeploy) → pre-flight → **v1**. **No Act-1 work sneaks into v1** (scope discipline, Captain-agreed).

**Post-launch charts arc:**
- **Act 1 — the work queue**: undated rail (undated elements of dateable types, grouped by type, collapsible) · drag-to-date · now-line drag + write-back · fieldless forward render (S10/S11).
- **Act 2 — depth**: ~~per-type charts (S8)~~ ✅ SHIPPED (Act 2A, S261 — the two-mechanism model, see S8 row) · ~~calendar layer (S9)~~ ✅ SHIPPED (S266-S267) · ~~the scroll view (S13)~~ ✅ SHIPPED (S268) · status/lapse vocabulary.
- **Act 3 — reach**: map-chart + scrubber · narrative lanes (`laneKey`) · fuzzy/relative dates (`DateSpec` is a tagged union — additive) · multi-calendar · 3D · causality/consistency (the moat).
- Interleaved: keel waves (reference-client poke → compat → engine v2 → syncable custom fields). See memory + Skeld's 2026-07-10 message.

---

## Decision log (carried from the market brief; reframed as chart features)

| # | Decision | Resolution |
|---|---|---|
| D1 | Date model | `DateSpec` tagged union from the start (Simmer); exact now, fuzzy/relative additive; custom calendar = display layer over numbers (S9, never locks). |
| D2 | Undated/relative | `relative` (anchored-to-an-element) is a `DateSpec` kind; undated rail = the work queue (Act 1; fills fast — Simmer). |
| **D3** | **Events → chart** | **Role-grouped linked-element chips in the card. THE wedge.** |
| D4 | Multi-track | Narrative lanes via `laneKey`; per-element falls out of scope:focus. |
| **D5** | **Scope/filter** | `ChartScope` (all/types/focus/selection) — the default recipe + control bar. |
| **D6** | **Zoom** | Superseded by S3: the window IS the camera. Wheel resizes the window around the cursor; the strip band is the control. |
| D7 | Lifespans & age | ✅ SHIPPED (Act 2A, S261) — REVISED by schema: no death field exists, so the life-line is birth→now (dotted inference, focus-only) + computed age in the card; tenure bars are the recorded-span kind (grant→revoke / grant→now). |
| D8 | Recurring vs **rhythm** | Simmer split: true recurrence (defer) ≠ felt cadence (soft background pattern; lighter, higher-value). |
| D9 | Causality / consistency | Reserve the link-model shape; the moat (Act 3). |
| **D10** | **Forward half** | **Adopted as the chart's identity** (Simmer): render owed/coming/due; now-line as the seam. S11 stages it fieldless-first; status vocab when lapse-tracking lands. |

**Locked earlier, still true (don't re-litigate):** chart = saveable view + share block, never an OW element · `.atlas/charts.json` + versioned `ChartConfig` · events inherit their location's pin (events are not pins) · auto recipe default · anchor cap 7 · `DateSpec` tagged union (fuzzy/relative additive). **Revised 2026-07-10**: "unified select=focus" → the PEEK/FOCUS split (see Navigation above); Back still walks the focus chain.

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

---

## S256 charts-polish layer (2026-07-12 — decided live with Captain via the fixture-world lab, all shipped + e2e-gated)

Lab: 6 fixture worlds (`Forge/Notes/2026-07-12-charts-lab-notes.md` has shapes + rebuild recipe). The durable rules:

- **The tableau fill (tableauScope, chart-recipe.ts)**: cast (uncapped) → lead character+location → ONE SEAT PER PRESENT TYPE (fairness round-robin — no dateable type with members renders zero) → per-type-capped weight fill (diversity wins early slots) → OVERFLOW fill by weight regardless of type up to the 22 total. Rationale: in a world that is mostly events, events ARE the world; the total cap alone guards the wall. A 14-dated world shows all 14; a 63-dated world spends the whole budget.
- **Range lines are occupied lanes** (computeBeeswarm): range-bearing nodes reserve their full x-span at their row, so point-events never sit exactly ON a range line — on-the-line used to fake membership by coincidence of the midline rule. (Room renderer only; chart-static's copy inherits at the next show re-lift.)
- **Click progression**: click = peek · click the peeked node again = FOCUS · click empty canvas / Esc / card × = dismiss. Revises the 2026-07-10 re-click-deselects lock, reopened by its own locker in live use.
- **Selection mark**: two rings (soft type-color halo + crisp near-white inner) — the old single 0.55-alpha ring was invisible. Hit radius 14px (the whole drawn circle, not the icon).
- **Room-stable world switch**: switching worlds keeps the room KIND at landing level (charts→charts etc.); element/map fall to home. Generalizes the settings-keeps-its-tab precedent.
- **The home chart strip = ALWAYS the tableau** (one mental model: home previews exactly what the room opens to). Saved charts are chips below, never the strip itself (savedCharts[0] used to hijack it — "home charts feel random"). `pickDefaultChart` (the pre-tableau ordered-recipe engine) is DELETED — it was consumer-less. The strip renders via `renderChartView(…, {layout:'strip'})`: label-aware row occupancy, every node tries for a label (bare-dot fallback when rows fill), edge-flipping labels reserve leftward. Additive option — the show viewer's chart-static copy is behaviorally untouched until the next deliberate re-lift.
- **Banked**: deterministic label-side priority in the room renderer (right-of-dot → below → left).
