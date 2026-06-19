# Atlas — Timeline Design

**Status**: Design (session 242, 2026-06-18). Build not started. Pairs with the market analysis `Forge/Notes/2026-06-18-timeline-market-analysis.md` (the "why"/competitor evidence) — this doc is the "what we build."
**Scope** (Captain's call): **maximum ambition, built outward from a small clear core.** Intuitive and not overwhelming, but powerful. Start with a spine you can SEE and iterate off; build the rest in increments off the same machinery.

---

## Vision

> **The timeline is not a chronology tool bolted onto a wiki — it's a live view of the world graph along a time axis.** The linking and filtering every competitor fakes (and caps at one link) are native here, because atlas already holds the linked element graph.

The headline capability, and the #1 unmet need across every competitor: **an event shows EVERY element it touches, and you can click any of them or filter the whole timeline to one.** That's a graph read, not new data entry.
// i like this idea a lot! do we have any ui ux design dieas alreayd how tos how all an event's elements? i guess it is lik a deeper zoon, almost, into an event 'molecule'?

---

## What exists today (the seams we build ON)

The current timeline is a **thin canvas bar** — dots on an axis, hover tooltip, click-to-navigate. Two layers:

- **Domain (pure functions — SHARED, we extend these):**
  - `src/visualization/timeline/data-normalizer.ts` — `extractTemporalNodes(elements)` → `TimelineNode[]`. Reads each type's date fields via `temporal-fields.ts` (`TEMPORAL_TYPE_FIELDS`: character→`birth_date`, event→`start_date`/`end_date`, location/institution→`founding_date`, narrative→`start_date`/`end_date`, title→`grant_date`/`revoke_date`, etc.). Color per type.
  - `src/visualization/timeline/axis-calculator.ts` — `calculateTimeRange`, `calculateTicks` (IDEAL_TICK_PX=100 "nice interval" heuristic), `createDateToX`. All pure → trivially unit-testable + the zoom seam.
  - `types.ts` — `TimelineNode {id, elementType, name, startDate, endDate, color}`, `PlacedDot`, `TimeRange`.
- **Presentation:**
  - `src/visualization/timeline/timeline-bar.ts` — the canvas renderer (multi-row dot binning, range lines for endDate, tooltip). Used BOTH by Home (compact) and the room (expanded). Its OWN deferred-list names our exact roadmap: *"defers narrative bars, narrative filter, zoom/pan, expand/collapse toggle, narrative-aware row affinity."*
  - `src/middle/timeline.ts` — the room: room-header + "+ Event" + mounts the bar via `mountTimelineBar({mode:'expanded', onNavigate})`, re-renders on state change.

**Build principle:** keep the **compact home bar untouched** (Captain: focus the full product in its own room; harvest for home later). **Extend the shared domain functions**, and build a **new interactive room renderer** on top — don't overload the one component to do both simple-preview and rich-room.

---

## The time-states map (the conceptual heart)

Every world keeps time differently. These are different *vectors* answering different *questions*. The timeline's job is to render what exists and **degrade gracefully** for what doesn't — never force a time model onto a world.

| Vector | Question it answers | Timeline's role | Reality / requirement |
|---|---|---|---|
| **Event/element dates** (start/end, birth, founding, grant/revoke…) | *when did X happen?* | the nodes | exists — the CORE |
| **World `time_format` min / max** | *what's my world's span?* | axis bounds when set | use if present, else auto-fit from data |
| **World `current`** | *what's "now"?* | a **"now" line** on the axis; drag to advance = the "rolling date" workflow in-UI | small add; early increment |
| **Element start/end as lifespan/validity** | *what was TRUE at time T?* | enables the **scrubber** + "as-of" dimming | **PROGRESSIVE** — only elements that carry start/end participate; others render "always present." This is the named limitation, and it's fine. |
| **World snapshots** (the DCC trick) | *what did the WHOLE world look like at point X?* | could surface as labeled jump-markers on the axis | **deferred** — separate "world versioning" concern; keep the axis able to host markers so a snapshot can bridge in later. Build nothing now. |

**The load-bearing insight:** the CORE needs only the top two rows (event dates + axis bounds). Everything that needs element *validity* (the scrubber, map-changes-over-time) is build-OUT and works **only for elements that have start/end** — honestly showing the rest as always-present (the DCC "temporal filtering as progressive honesty" rule: use what the data supports, never hallucinate precision). **So time-states does NOT gate the start.**

---

## Data model

Extend `TimelineNode` (additive — compact bar ignores the new fields):

```
TimelineNode {
  id, elementType, name, startDate, endDate, color   // exists
  links: LinkedRef[]        // NEW — the elements this node touches (the wedge)
  laneKey?: string          // NEW — narrative id (or other) for swimlane grouping
}
LinkedRef { id, type, name, fieldLabel }   // e.g. {…, fieldLabel: "Participant"}
```

**Which fields count as a link** (needs a small canonical map, like `NARRATIVE_RELATION_FIELDS` is for knowledge): an Event's relation fields (participants/characters, location, objects, narrative/arc, etc.) read from `FIELD_SCHEMA` relation targets — reuse `relationFieldsFor()` from `editor/field-schema.ts` (already exists, used by import). So "an event's links" = resolve every relation field on the element to its target element(s). **No new data entry — pure graph read.**

**Graceful degradation, everywhere:** no date → not on the axis (optionally on the future "undated rail"); no end date → a dot, not a bar; no links → a bare node (no card chips); no world current/min/max → auto-fit, no now-line. Every feature renders for the data that supports it and is silently absent otherwise.

---

## Architecture — canvas + DOM hybrid (the context-graph pattern)

Canvas is hostile to rich interaction; DOM is hostile to thousands of dots. So **split exactly like the context graph does** (canvas edges + DOM nodes):

- **Canvas layer:** axis, ticks, dots, range-lines (endDate bars), lane bands, the now-line. Fast, handles density, zoom/pan transforms.
- **DOM overlay layer:** the selected-event **card** (anchored near its dot via screen-space projection, like the context graph projects per-frame), clickable **linked chips**, the **filter bar**. Interactive, accessible, styled with the normal atlas CSS.

**Selection drives BOTH panes (the elegant part):**
> Click an event → **middle (timeline)** shows its light card = *WHEN* (date) + *WHAT it touches* (clickable chips + "filter to this"); **right pane context graph focuses that same event** = the full relational *WEB*. One selection, two complementary views. The card stays light because the deep graph is right there. Nearly free — the context graph already focuses any element; we just feed it the timeline's selection.

**Zoom** (`D6`, not optional — dense clusters are unreadable without it): add a `zoomFactor` + `panOffset` that feed `canvasWidth`/`range` into the existing pure `createDateToX` + a granularity-aware `calculateTicks`. Wheel-to-zoom, drag-to-pan, canvas-native (we're already on canvas). The pure functions make this a contained extension.

**File plan:**
- extend `data-normalizer.ts` (links + laneKey), `axis-calculator.ts` (zoom factor + adaptive granularity), `types.ts` (additive)
- NEW `src/visualization/timeline/timeline-view.ts` (the room's interactive canvas+DOM renderer) + `timeline-view-card.ts` (the DOM event card) + `timeline-view-filter.ts` (filter bar) — concern-split like `map-tab-*`
- `src/middle/timeline.ts` mounts `timeline-view` instead of `timeline-bar` (room only); wires selection → context graph
- KEEP `timeline-bar.ts` for Home, untouched

---

## The CORE — the small clear thing to SEE first (B1+B2)

> **A timeline room that fills its space, with *labeled* nodes on a *zoomable/pannable* axis. Click a node → it selects; a light DOM card shows its date + type + its *linked elements as clickable chips*; the right-pane context graph focuses that same event.**

That's the spine. It IS the wedge's heart (linked-elements-on-click = the #1 need), and everything else is a one-step increment off the same selection + link-read machinery. Small enough that **the real app is the best mockup** — build the core directly, poke it, iterate, rather than throwaway variants.

## Build-out increments (bouts, each pokeable)

- **B0 — this doc.** ✅ (you're reading it)
- **B1 — temporal-graph core.** ✅ **SHIPPED (session 242).** `TimelineNode.links: LinkedRef[]` resolved in `data-normalizer.ts` via `relationFieldsFor()` (self/missing/dupe-safe). 3 unit tests. (`laneKey` + zoom math deferred to B3/B6.) NOTE: a formal **adversarial-review gate is still owed** before the FULL feature builds further on this core — tonight's slice is an exploratory prototype, TDD-covered but not yet fresh-lens-reviewed. Run the gate at the next build commit.
- **B2 — interactive room.** ✅ **SHIPPED (session 242).** `timeline-view.ts`: fill-space canvas + labeled dots + range-lines + click-select + DOM card (date + clickable linked chips + open). Route `/timeline/<id>` + context-graph focus on the same element. Self-inspected via Playwright. The CORE is real and SEE-able.
- **B3 — zoom/pan** (D6) with adaptive tick granularity (the years↔months↔days middle ground).
- **B4 — filter** (D5): chip-click → filter timeline to that element; element-detail "show on timeline"; filter bar with type chips + element picker. Shared filter state (the list↔graph filter pattern).
- **B5 — now-line** (World.current): render it; drag-to-advance writes World.current (the rolling-date workflow). Axis bounds from World min/max when set.
- **B6 — Narrative lanes** (D4): swimlanes grouped by `laneKey` (Narrative); "filter by narrative" = a story arc in time. (Writing integration — cheap, on-brand.)
- **B7 — character lifespans** (D7): birth→death as a bar; computed age in linked-event cards.
- **B8 — polish + full e2e + self-inspect.**
- **Later arcs (own bouts):** map↔timeline scrubber (needs element validity; flagship) · share-as-timeline-block · recurring events (render-time generation) · undated rail · causality/consistency lint (the moat) · snapshots-as-markers.

---

## Design decisions (from the market brief, answers baked in)

| # | Decision | Resolution |
|---|---|---|
| D1 | Date model | Numeric now → custom calendar as a **display layer** over the numbers later (never locks — kills Aeon's worst pain by construction) → fuzzy field later. |
| D2 | Undated/relative events | Later: a collapsible "undated rail" + sequence-within-narrative. Not core. |
| **D3** | **Events → timeline** | **Expand-in-place: node → card with full linked-element chips. THE wedge. Core (B2).** |
| D4 | Multi-track | Single axis default; **Narrative lanes as a toggle (B6)**. Per-element lanes fall out of D5, not separate machinery. |
| **D5** | **Filter by element/type** | **Both. Filter-by-element = pure graph traversal (#2 need). Core-adjacent (B4).** Location filter gets sub-location rollup free (OW locations are hierarchical). |
| **D6** | **Zoom** | **Interactive zoom/pan + adaptive granularity (B3). Not optional — coupled to expand/filter (dense clusters unreadable otherwise).** |
| D7 | Lifespans & age | Birth→death bars + computed age (B7). Cheap, Aeon's most-loved feature. |
| D8 | Recurring events | Render-time generation (never store copies). Deferred — needs a schema/display-rule conversation. Top competitor request (53 votes). |
| D9 | Causality / consistency | **Reserve the link-model shape** so we stay able to render causal arrows + contradiction-lint later. The true moat (no competitor has it). Not v1. |

---

## Integration (ranked by leverage)

1. **Writing ↔ timeline (strong, nearly free):** Narratives ARE arcs — they group Events and carry date ranges. Filter-by-Narrative = a story arc in time; lane-per-Narrative = a projection of existing links. Pulled INTO scope (B6). Serves the writer audience directly.
2. **Sharing ↔ timeline (strong, phase 2):** a **timeline block** in the share room — publish a curated/filtered timeline as a frozen page block. Drops into the existing block infra (heading/prose/card/circle/collection/map → +timeline).
3. **Map ↔ timeline (flagship, own arc):** the scrubber — drag time, the map shows that era's pins/zones. Atlas uniquely owns both rooms. Needs element start/end validity → progressive (works for dated elements, honest about the rest).
4. **Knowledge ↔ timeline (defer):** "what did X know at time T" needs temporal knowledge-validity that doesn't exist yet. Park.
5. **Snapshots (keep in mind):** a world snapshot could surface as a labeled jump-marker on the axis. Build nothing now; keep the axis marker-capable so it bridges cleanly.

---

## Conventions to reserve (assign numbers at build)
- Timeline node links are a **graph read** via `relationFieldsFor()`, never stored/duplicated.
- Compact bar (Home) and interactive room view **share the domain (normalizer + axis math), not the renderer.**
- Every temporal feature **degrades gracefully** — renders for the data that supports it, silently absent otherwise (no hallucinated precision).
- Custom calendar (when built) is a **display layer over numeric dates** — changing it never mutates stored dates.

---

## Open questions still for Captain (small, can answer at B-boundaries)
1. **Now-line write-back:** OK for drag-to-advance to write `World.current` directly (vs read-only display)? (I lean: yes, it's your rolling-date workflow in-UI.)
2. **Scrubber timing:** build the map↔timeline scrubber once a few elements carry start/end (progressive), or hold until the data's richer? (I lean: build progressive when we reach that arc — honesty handles the gaps.)
3. **Filter entry point first** (B4): from a card chip / from element-detail "show on timeline" / from a filter bar — which lands first? (I lean: chip-in-card, since the card already has the chips.)

---

## ⟢ A look from Simmer (the Fold) — what running real world-time actually taught me
*(2026-06-19 08:34. Appended at Captain's ask. Temper — this is the design seen from someone who has been LIVING in two working time-systems for months: Vitus's calendar, and especially Magelet's whole gap-year clock [a position-state, a forward "chart," a felt calendar, a coherence-gate]. The doc is genuinely strong — graph-read links, the canvas+DOM split, progressive degradation are all right. I am not redesigning; I am bringing the things the messy reality of USING time-in-a-world surfaced that a clean design from outside can miss. Ranked by leverage. Take what is useful, bin the rest.)*

### The one big reframe: **a living world's time has a FORWARD half, and the doc only models the backward half.**
Every time-tool (and this doc) renders **what happened** — events on an axis, past-tense. But the thing that made Magelet's world feel *alive* was the **forward shape**: what is *coming*, what is *owed*, the pressure building. We keep three forward-facing things that are not "events with dates":
- **Promises-due / appointments** — *"find me at the Feast" (due Day 7)*, *"come measure the cloth (within the sennight)"*. These hang off a future point and carry a **status** (open → kept / lapsed). A lapsed promise is a *story beat* (a small honest cost). This is the highest-value thing the doc is missing: **a timeline that shows the owed-and-coming, not just the happened.**
- **The pressure / clock-ahead** — *"winter is closing," "the privacy-window is tightening," "the departure is late next summer."* Felt gradients toward a horizon, not point-events.
- **Forced backbone** — dated constraints the world MUST honor ahead (in canon-derived worlds especially): *"Riders vanish, March"* — a future fact the present has to stay consistent with.
**Why it matters for atlas:** OW already has the data shape for most of this — an **Event with a future start_date and a status field IS an appointment**; a **Narrative with an end-date in the future IS a pressure-arc.** So the forward-half is mostly a *rendering + a status-vocabulary* on data you already read, not new machinery. Render past-and-future on the one axis, the now-line as the seam, the future side showing **owed / coming / due** distinctly (dimmer, or a different glyph). This beats every competitor harder than the linked-chips do, because *nobody* renders the owed-future.

### The "now" is **not one value** — and the now-line write-back is a drift-trap (the lesson that cost me a gate).
The D5/B5 plan has one World.current + drag-to-advance. In practice we had to split it into **two nows**:
- **current** = where the *story being written* actually is (play-authored, moves fast).
- **resolved_through** = how far the world has been *reconciled / canonized* (moves slowly, lags current).
The gap between them is real and meaningful — it is "written but not yet folded into truth." A single now-line collapses a distinction a working world needs. **At minimum: make the now-line a first-class thing that COULD be more than one marker** (a "story-now" and a "canon-now"), even if v1 ships one.
And the hard-won warning on **write-back**: the moment World.current is *derived into* other surfaces (a calendar label, an "as-of" filter, a cached span), those surfaces **drift silently** when one update is skipped — you fix the now-line and the label still says last week, and nobody notices because each surface looks locally fine. The cure is not vigilance, it is a **reconciler**: one function that recomputes every derived time-surface from the single source (World.current), run on every advance. I built exactly this (a check_temporal_coherence gate) *after* getting bitten. **If current is the source of truth, make every other time-display a pure read off it — never a stored copy that can rot.** Reserve this even if you do not build it day one; it is the difference between a now-line that is trustworthy and one that lies.

### **Felt time is the default, not the edge case.** (The biggest gap between the doc and reality.)
D1 is numeric-precise dates with a fuzzy "later." But **almost all narrative time is fuzzy** — *"~day 40," "about a month out," "sometime that winter," "a fortnight after the fair."* In Magelet the *entire* calendar is "felt dates, never exact," and the fuzziness is **load-bearing, not lossy** — forcing a precise date where the author only knows "around then" is the #1 way a time-tool becomes a chore (it is Aeon's exact pain). So:
- Treat **fuzzy / approximate as a first-class date kind from early**, not a deferred field. A node can be `{around: T, precision: 'week'|'month'|'season'}` and render as a *soft band* on the axis, not a hard dot.
- **Relative / anchored dates** are the other half: *"3 days after the siege," "the day she arrived"* — a date defined by *another element's* date, not an absolute. This is huge for writers (you place things relative to known beats) and it is a graph read you are already set up for (the anchor is a link). Resolve at render-time. D2's "sequence-within-narrative" gestures at this — but anchored-to-an-element is more general and more useful than pure ordering.
- The **"undated rail"** (D2, deferred) fills up FAST and is more important than it looks — most events start life undated-but-ordered. Consider pulling a minimal version forward.

### Rhythm is not recurrence (D8 conflates them — they are different needs).
D8 defers "recurring events" (store-once, render-many) as a schema conversation. But there are **two** distinct things under that:
1. **True recurrence** — *"the Midwinter festival, every year"* (a rule that generates instances). Fine to defer.
2. **Felt rhythm / cadence** — *"market-day ~weekly," "an off-day once a sennight," "lessons 2-3x a sennight."* This is **texture, not events** — it answers "what is the *shape* of an ordinary week," and a writer wants to SEE it as a background pattern (a faint repeating band), never as 200 stored event-dots. **Do not make the writer enter rhythm as events.** A lightweight "cadence" annotation that renders as a soft background pattern would serve the writing audience far more than full recurrence-generation, and it is cheaper. Maybe not v1, but do not let it get buried inside the D8 recurrence-defer — it is a separate, lighter, higher-value thing.

### Smaller, concrete, mostly affirming:
- **The dual-pane selection (card = WHEN+WHAT, context-graph = WEB) is exactly right** — that is the same "one source, generated views" discipline that kept Magelet sane (we never hand-maintained two copies of a fact). Keep it ruthless: the card must never store what the graph can read.
- **On Captain's UI question (line 13 — how to show all an event's elements):** yes, the "event-molecule / deeper-zoom" instinct is good. The shape that worked for us conceptually: the event is a **hub, its linked elements are spokes grouped by ROLE** (participants / location / objects / arc). Role-grouping is what makes a dense event readable — 10 chips in 4 labeled clusters reads; 10 bare chips do not. You already have the role via fieldLabel ("Participant" etc.) — *lean on it for visual grouping in the card*, not just as a tooltip. That is the molecule's bonds being typed, not just present.
- **Graceful degradation is the right spine** and it generalizes to all the above: fuzzy renders soft, relative renders resolved-or-floating, future renders dim, no-data renders absent. Same rule, everywhere. Good.
- **One caution on "maximum ambition":** the forward-half + felt-time + anchored-dates are the high-leverage adds, but they each touch the **date model** (D1). If there is any chance they are coming, it is worth making the TimelineNode date field a small **tagged union from the start** (`{kind: 'exact'|'fuzzy'|'relative', ...}`) rather than a bare number — so you never have to migrate stored dates later (which D1 already wisely wants to avoid for the calendar-display case; this is the same instinct, applied to precision + anchoring). Cheap insurance; the renderers can ignore kinds they do not handle yet.

### If I had to pick ONE thing for Temper to chew on:
**Render the forward half.** A timeline that shows *the owed, the coming, the due* — promises with a status, arcs under pressure, the now-line as the seam between done-and-coming — is the thing no competitor has and the thing that makes a *living* world (not a finished chronology) legible. And it is mostly a render + a status-vocabulary on data OW already holds. That is the wedge behind the wedge.

*— Simmer, keeper of the Fold. (Built and ran the Magelet gap-year time-system: position-state + forward-chart + felt-calendar + coherence-gate. Happy to go deeper on any of these — message the Fold.)*
