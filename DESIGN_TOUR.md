# Atlas — Guided Tour Design

**Version**: 3.2 (2026-07-21, S307 — the consul beat is ROUTED (its view was
a side effect of the create, so back-navigation showed a later step's
element); unlit glyphs are no longer rendered, completing the S306c
sentence-shift decision; the finale copy no longer promises a folder picker
that OPFS-only browsers never get; the maps step explains where a map image
comes from. Prior 3.1 header below.)

**Version**: 3.1 (2026-07-21, S306c — Captain's smoke round: the opener renders
the sentence BARE (no glyph slots on the first screen; they arrive with the
dock), the grey book cite under it cut, Begin -> Start, sentence colours
reassigned one word per element (The=title, Hegemony=institution, Consul stays
character), the consul step acknowledges its own create, the false "zone you
traced" line corrected, the Consul alias list trimmed to ['Consul'], and the old
`where-it-lives` + `online` steps MERGED into one `yours-to-keep` close --
**17 steps**. The writing beat's copy now says CLICK a dotted word (hovering
places no cursor, so Tab could never fire -- Captain hit this live) and points
at the prose panel's link-all corner button rather than the tree's right-click
menu). Prior: 3.0 (S306 — THE WRITING BEAT: Chapter 1 baked as plain prose and
linked BY THE USER via autolink's Tab; the tier choice cut as unreachable and
the selection bubble cut as unnecessary; `Mr. Steinway` renamed out of an
autolink key collision; the act table, step count, bundle count, test count and
the "STILL TO BUILD" list all corrected against the code — every one was stale,
and STILL-TO-BUILD was naming three things that had already shipped). Prior: 2.9
(S305 — THE CHARTS ACT: one shared event date, the now beat, deep time + two
eras; the event-vs-narrative branch CUT by Captain in favour of a "more
information" note, which removed the reveal-slot kernel change entirely). Prior:
2.8 (S304 — THE ACT RESTRUCTURE: step-0 opener, maps before objects,
institution+title merged, the pin's soft correction; supersedes v2.7). Prior:
S303 capability-class staging + landing captions; S302 phases WIRED + the
scripted create door. The full rework this serves is Captain's dump of
2026-07-20: plan + positions in `Notes/2026-07-20-s301-tour-rework-plan.md`,
contract + gate amendments in `Notes/2026-07-20-s301-phase-contract.md`.

**SOURCE-TEXT CHRONOLOGY** (S306, five-agent read of the whole novel):
`Notes/2026-07-21-hyperion-source-chronology.md`. Read it before any dating or
calendar work. Headline: the book is a RELATIVE-time novel (five absolute years
in 19,000 lines), the Consul's tenure is a sourced ELEVEN YEARS, the Steinway is
"Pre-Hegira", Rachmaninov is named exactly once and never dated -- and **the
opening scene is NOT on Hyperion** (an unnamed world; keeper-verified at L307).

**Concept**: Freek + Captain, 2026-07-19. The opening sentence of *Hyperion*
by Dan Simmons becomes a small linked world, step by railroaded step,
teaching OnlyWorlds AND atlas at once — while the workspace BUILDS ITSELF
around the user. Successor to ecosystem-explorer's sentence tutorial (linked
at the 'online' step as the deeper schema story).

---

## The shape

- **The opener** (step 0, S304 — `data-tour-step="1"`): the tour opens on the
  Hyperion sentence CENTRE-STAGE at vignette scale on black. The step declares
  no `unlocks`, so `body.atlas-touring:not(.atlas-tour-cap-shell)` hides the
  whole shell behind it; the bar renders with `.is-opener` (screen-centered,
  auto height, the sentence at 22px). A single "Begin" hands off into the docked
  narrator (the shell materializes on the create-world beat that follows). Begin
  is a special case in the bar because `canAdvance` is false with no active
  world — the opener is pre-world, not suspended. Copy is Captain's shorter
  variant (rides his copy pass). The bare splash below is the pre-tour landing;
  the opener is the tour's own first beat.
- **The bare splash** (`body.atlas-preroot`): pre-setup, atlas shows NO shell
  chrome at all — just the Atlas mark and two side-by-side doors ("Take the
  tour" / "Set up a folder") on black. Settings stays live at the
  `#/settings` route. After a completed tour (`atlas_tour_done_v1`) the doors
  swap emphasis: folder primary, tour reads "Replay the tour".
- **One narrator, ONE position** (S298 — the centered opener was retired,
  Captain's round): a single glass panel (cyan top rail, tint), docked
  bottom-center from the first second. FIXED height 290px (S299 — was
  min-height 272; the one 4-line step grew past it, so a fixed height keeps
  the dock the exact same size on every step; drops when the copy pass evens
  body lengths). Step 1 carries its framing in the meta channel: just the
  cite "Hyperion, Dan Simmons (1989)" (the "One sentence, one world" eyebrow
  was cut S299 — Captain: "why still this blue header"; the sentence frames
  itself), zero extra rows. The bare stage above it fills in on Next.
  z-index 900: a modal dialog ALWAYS outranks the narrator.
- **The progressive build-up**: chrome appears when it is taught. The bar
  stamps CUMULATIVE capability classes on `<body>` (`atlas-tour-cap-shell` /
  `-rightpane` / `-writing` / `-charts` / `-allrooms`), declared per step via
  `TourStep.unlocks`; atlas.css hides chrome whose capability is not yet
  present. This replaced an ordinal `data-tour-stage` number (S303) that was
  derived from `step.act` and would have gone non-monotonic once the act
  restructure interleaves acts — a capability, once unlocked, only grows. The sidebar footer stays
  hidden for the whole tour. On the create-world step the worlds sidebar shows its TRUE
  final structure — all five action icons in their real places — with only
  create-world live and the other four greyed (`.atlas-tour-locked`).
- **Panel rows**: the annotated sentence · hairline · body copy (+ the meta
  subtext channel, always rendered — nbsp when a step has none — so the shape
  holds; ✦ deeper; inline links) · controls (the ACT label stays cut — the
  sentence IS the user's progress; a quiet muted "Step N of 17" counter was
  re-added S299 as a working/collab reference at Captain's ask,
  `.atlas-tour-stepcount`; `data-tour-step` on the panel remains the test
  contract). The
  hairline divides material from narration; the sentence renders BRIGHT on
  the first two steps (`.is-fresh`).
- **The annotated sentence** (the progress bar, ow.com vignette grammar):
  serif italic (Crimson Text stack, Georgia fallback — bundling owed if the
  look is blessed); parsed words take their element-type color and click-jump
  to their step; every span's END word carries an inline element-type glyph,
  rendered ONLY once lit (pop-in) when its step arrives. **The sentence
  reflows as glyphs appear, deliberately** (S307, completing the S306c
  decision): glyphs used to be PRE-SPACED from step 1 as invisible ghosts so
  lighting one caused zero reflow, but the reserved width is what spaced the
  words apart for the whole tour. S306c made the opener bare and accepted the
  shift; S307 applied that to every later step. (The finale's neutral fill of
  connective words was CUT in S298 — only element words ever color.)
- **"more information"** (the ✦ bulb, relabeled S298): real multi-paragraph
  content (`\n\n` renders as paragraphs) in a scrollable FLYOUT above the
  panel — the dock's height never changes. The extras row always renders
  (ghost placeholder when a step has neither bulb nor link); Captain's
  Hyperion share-page link joins it on the 'online' step when it exists.
  (The ecosystem-explorer link was cut in S298.)

## Hands-on beats (the watch/do rule)

Every hands-on step offers the real gesture (primary button AND the real UI
surface itself) or a ghost Next that performs it silently. Esc closes a
dialog and stays on the step — never "back" (the panic-key rule). Names are
LOCKED — every user's tour is identical, and no user-typed data rides into a
throwaway world:

1. **Create the world** (step 1 — the tour OPENS here): the REAL create-world modal, name
   "Hyperion" readonly, the folder hint replaced by the teaching line
   ("normally this becomes a folder; the tour world stays in your browser").
   Create → the shell materializes on the world's home. The sidebar's own
   create-world icon opens the same locked modal. SINGLE ROUTE (S298): the
   create beats carry no watch-mode Next — the locked one-click modal is the
   way; the consul step shows plain Next only after he exists. The
   create-world sidebar toggle also keeps its final geometry: a locked ghost
   segment holds the place the world name will take.
2. **Create the Consul** (step 2): the REAL element modal, type grid locked
   to character, name "The Consul" readonly. During this beat every create
   door is scripted — and as of S302 that sentence is finally TRUE: it was
   written when only the elements-sidebar + carried the branch, while `Ctrl+E`
   and the Charts room opened a free-form modal right beside it. All three now
   go through `create-element-door.ts`. After the Consul exists the sandbox is
   free again.
3. **Place the pin** (step 6 in the S304 order; S299 real-control, S304 soft
   correction): the step routes to the combined map+element view (map open
   right, Consul selected middle) so the Consul's REAL +pin button shows; the
   `atlas-tour-pinstep` body class pulses it cyan. The user clicks that real
   button (arming `ui.pinPlacement` — the app-wide placement feedback fires: lit
   button, a "Click the map to place …" banner, crosshair, Esc to cancel), then
   clicks the map; the pin lands THERE with the bundle pin's locked identity
   (name + id, via `tourPinBake`). Position is the user's to keep (heal never
   touches x/y — C3).
   - **The soft correction (S304, Captain's ruling: never refuse a placement).**
     The pin can be dropped anywhere. `TourStep.placeInZone: {pinRef, zoneRef}`
     drives the forward gate: Next appears only once the pin sits INSIDE the
     swamps zone (`TourWorldView.pinInZone`, the zone polygon from its markers ×
     `ZoneGeometry.pointInPolygon`). A drop outside shows phase `b` — "drag the
     pin onto the swamps" — with no Next; dragging it in resolves phase `c` and
     opens Next. The `atlas-tour-pinstep` +pin highlight releases as soon as the
     pin EXISTS (the gesture is done); the correction is a drag, not a re-click.
     The phase `when`s are prefix-nested (b: `hasRef(pin)`, c:
     `hasRef(pin) && pinInZone`) so `resolvePhase` never breaks early. On
     watch-mode/resume the pin is minted at its baked coords, which sit inside
     the zone (locked by a bundle-geometry unit test), so those paths do not
     dead-end.
   - **The zone had to stop eating the click.** A zone polygon is `interactive`
     and `stopPropagation`s clicks (to select the zone). With the zone now drawn
     during the pin beat, a click on the swamps selected the region instead of
     placing the pin. `ZoneOverlay.setClickFallsThrough(() => !!ui.pinPlacement)`
     (wired in map-tab.ts): while a pin is being placed, a zone click falls
     THROUGH to the map's placement handler and does not select the zone.
     Correct app-wide, not just for the tour.
   NO dock button — single-route, gated. The app-wide placement feedback lives
   in `src/tabs/right/map-placement-hint.ts` + the `[data-action="pin-element"]`
   active style (armed = crosshair cursor, an outcome asserted in e2e since
   S318 — the rule existed from S299 but lost the cascade to the S219 default
   cursor for three months); Esc-owns-placement is a skip in the
   deselect-to-home guard.
   **BOTH copy gestures satisfy the gate (S318)**: the +pin click AND the
   drag-from-sidebar drop each route through `tourPinBake`, so either way the
   placed pin IS the bundle pin. The drop path missed the bake until S318 —
   a dragged-in pin was nameless, the gate never opened, and +pin (hidden
   once the element is pinned) left no retry; revert-checked e2e locks it.
4. **Set up your folder** (step 16, finale): the real `setupAtlasRoot`
   picker; success ends the tour. On OPFS-only browsers Finish is primary
   and no folder button renders. The finale ROUTES to `object:Ebony
   Spaceship` (Captain, S318): the closing view is the sentence's grandest
   object, links radiating back. The exit confirm carries no title and ends
   with "Replay the tour any time from the settings."

## The residue contract

The tour leaves NOTHING behind. The world is created at step 1 (not boot)
and exit or Finish — anywhere, anytime — tears it down completely. Exit
returns to the launch location (`returnHash`: the landing for fresh users,
the exact prior route for a settings replay). `atlas_tour_done_v1` survives
as the only trace, driving the landing's emphasis swap.

**Teardown is a checklist, and the checklist is the contract** (S301): the
first version of this clause said "registry entry, handle, OPFS folder" and
those three were honoured, while two keys nobody had enumerated outlived the
world — `atlas_right_tabs` kept a map tab stamped with the tour world's id,
and `atlas_map_camera_state` kept that map's camera. The visible cost was a
ghost "Hyperion" tab on the FIRST world a tour-finisher created, reading
"This map isn't in the current world". Every store the tour can write must be
named here, or the next one leaks the same way:

| what | where | cleaned by |
|---|---|---|
| registry entry | `atlas_worlds_registry` | `deleteWorldEntry` |
| directory handle | handle vault (IDB) | `deleteHandle` |
| world folder | OPFS `hyperion-tour-*` | `removeEntry(recursive)` |
| right-pane map tabs | `atlas_right_tabs` | `dropPersistedTabsForWorld` |
| per-map cameras | `atlas_map_camera_state` | `clearCameraState` per bundle map |
| tour step state | `atlas_tour_v1` | `writeTourState(null)` |

The persisted tabs are pruned by writing localStorage DIRECTLY, not by
patching `ui.rightTabs` and trusting the render-time persist: right-pane
returns early when no world is active, which is exactly the state teardown
leaves behind, so that subscriber never fires. Both halves run (live slice
for the pane in front of the user, storage for the next boot). E2e-locked in
`tour.spec.ts` with a precondition assert, so the test cannot pass by never
having created the tab.

## Acts (17 steps — S306c; `data-tour-step` = step number below)

The reorder (Captain's dump): the sentence gets its own opener, the maps act
comes BEFORE the objects so the pin's "sat" (word 3) lights in reading order
ahead of "balcony"/"spaceship", the institution and title merge into one step,
and the zone reveals WITH the map (the pin's soft correction needs the region
already drawn).

0. **Opener** (step 1): the sentence centre-stage; "Begin" hands off.
1. **Elements** (steps 2-4): create the world (opens the shell) · create the
   Consul · **Hegemony institution + title (merged)** — both reveal, the copy
   teaches the distinction, routes to the Hegemony.
2. **Maps** (steps 5-8): the **Unnamed Planet** location (right pane appears —
   S312: the unnamed-world resolution; the opening scene is NOT on Hyperion,
   hyperion.txt L307, so Captain rebuilt the spatial layer live and the bundle
   adopted it) · the map "Map of Unnamed planet" (bundled art; renamed live by Captain, adopted S318) **+ the Swamps zone
   drawn on it** (zone name is now `Swamps`, 6 markers) · the balcony-seat pin
   (HANDS-ON, **soft correction**: place anywhere, Next only over the swamps) ·
   the swamps' living things (2 creatures, species, Pack of Bellowing Saurians).
3. **Objects & links** (steps 9-10): the scripted object run (spaceship,
   balcony, Steinway — one + click each) · linking payoff (objects BEFORE
   linking so the Consul's page carries real chips; deeper: two-way links, Web,
   Knowledge).
4. **Writing** (step 11): Chapter 1 = the sentence VERBATIM, baked as PLAIN
   prose with NO chips (S306). **HANDS-ON** (`link-word`): autolink underlines
   the surface forms it can resolve and the user presses Tab to link one; Next
   appears at the first chip. Only SEVEN of the nine phrases are linkable here
   (`TOUR_WRITING_LINKABLE`) because Rachmaninov and his Prelude arrive at
   `deep-time`, three steps later; phase c says so instead of promising a fully
   linked sentence. Phase b points at the tree's right-click "Link mentions in
   this chapter" for the rest.
5. **Time** (steps 12-14): the events, BOTH at the shared year **12** (he plays
   while they surge) · the chart = the **now beat** (HANDS-ON `set-now`; the
   bundle ships no `time_current`, so the room's real button is pressable) ·
   deep time (Rachmaninov **-270** and his Prelude **-251** in the Old Earth
   era). **Dates are SOURCE-DERIVED since S312**: title grant_date 1 + events
   at 12 = the Consul's sourced eleven-year tenure (L327/L3823); deep time via
   the L1130 epoch (AD 2732 = 589 P.C. → P.C. 0 ≈ AD 2143 → 1873 = -270,
   1892 = -251). The old "no Earth↔PC conversion asserted" rule is RETIRED —
   the deep-time deeper states the derivation honestly.
6. **Your world** (steps 15-17): the sweep · **yours-to-keep** (S306c MERGE of
   the old where-it-lives + online: the files story and the OnlyWorlds story, a
   sentence each, detail in the flyout; carries the Web tab's only introduction
   via `webTab`, so it is NOT named earlier) · finale.

**Cut from the tour** (stay as waypoints): knowledge room visit, import.

## Mechanics (`src/tour/`)

- **`tour-data.ts`** — sentence + step script + `capabilitiesUpTo` (the
  cumulative capability set per step; replaced the ordinal `tourStageFor` in
  S303). Steps reference bundle elements as `"type:Name"`; spans are word-index
  ranges + element type. Route kinds: home · elements · element · map · writing ·
  chart; flags `webTab`, `unlocks`, `creates`, `placeInZone`,
  `handsOn: 'create-world' | 'create-consul' | 'place-pin' | 'setup-folder'`.
  `TOUR_PIN_REF` / `TOUR_SWAMPS_ZONE_REF` are the pin beat's refs.
- **`tour-engine.ts`** — state (localStorage `atlas_tour_v1`:
  active/step/worldId/returnHash), boot/resume/exit, the reveal system,
  `launchTour()` (the ONE entry point: landing + settings replay).
  **Step entry is SERIALIZED** (`enqueueStep` chain, target index computed
  in-chain): rapid Next clicks queue rather than race. Each step ticks the
  ui slice (force-render idiom) so stage-dependent chrome re-renders; exit
  ticks once more after the flag clears. Boot/resume set
  `sidebarMode: 'elements'` (state only, never the pref).
- **`tour-world.ts`** — scaffolds the OPFS demo world via
  `scaffoldWorldInRoot`'s parentOverride (no picker, no permission).
- **`tour-bar.ts`** — the panel (both positions), the annotated sentence,
  the hands-on buttons. Mounted by welcome/app-boot/settings-replay.
- **`tour-flag.ts`** — pure localStorage read for chrome that must know "is
  the tour running" without importing the tour chunk (welcome, world-home,
  worlds-sidebar, elements-sidebar).

**The resilience contract (v2.4, S299 — "pop back cheeky")**: users can mess
with the sandbox (delete, unlink, wreck fields) and the world heals on every
step-enter. Clauses: (C1) revealed-but-absent bundle elements re-create
(spatial included, media re-attached); (C2) link heal MERGES via the pure
kernel `tour-heal.ts` — remove only bundle-AUTHORED unrevealed ids, preserve
everything else on disk verbatim (a user's manual link to an unrevealed
bundle element survives back-nav), append missing revealed ids; the patch is
computed INSIDE the per-id write chain (`FolderStore.updateElementWith`, the
gate's TOCTOU fix); (C3) user edits to non-bundle-link fields survive
(names, descriptions, dates, pin positions); (C4) the two `x_tour_media`
elements re-attach their image when `image_media_id` is unset (a cache-cheap
predicate — no OPFS enumeration on the hot path); (C5) ANY heal write
refreshes `state.data.elements` in the same step-enter; (C6) per-write
`tourWorldIsActive()` guards — exit/world-switch mid-loop bails the heal.
Exit is serialized behind the step chain (a mid-create exit rolls the
scaffold back — no phantom demo world). Accepted limits (gated, documented):
a media re-attach re-fits the map camera (the image just arrived; fitting is
correct); writing-room prose chips are static in the doc and don't re-resolve
on a live heal (the railroad heals before the room mounts, so targets always
exist by mount time).

**The reveal system**: the world starts empty; each step writes its bundle
elements. Link values pointing at absent bundle ids are STRIPPED at write
time (never the element's own `id` — identity, not a link) and HEALED when
targets arrive. `atlas_aliases` defer the same way until the CHAPTER reveals
(they keep the prose chips word-exact; on a beginner's first element page
they are noise). A hands-on element only auto-reveals for steps strictly past
its own.

**TWO SETS, NOT ONE (S301, gate R1/R2 — convergent from two lenses)**: the
set of elements a step CREATES is step-keyed, but the set a surviving LINK
may point at is `step-keyed ∪ whatever is on disk` (`linkableIds`). The rule
is **never strip a link whose target is present on disk**, because stripping
only ever existed to stop a chip dangling, and a link to a present element
cannot dangle. Consequence accepted deliberately: the reference set is no
longer a pure function of the step index. That resolves in favour of the
world, which is the same philosophy as derived phases — state is truth,
indices are hints. Two bugs die with it:
- user-minted elements (the coming `creates` door) losing links to EACH OTHER,
  which would have had the objects step teach "the balcony's parent object is
  the spaceship" on a page whose Parent object was empty;
- back-navigation *deleting* links off elements that still exist, so the
  payoff chips the user had just watched appear vanished and oscillated on
  every back/forward.

## The scripted create door (S302)

A step can declare `creates: string[]` — ordered bundle refs the USER mints
with the app's real `+`, one per click, no dialog (Captain's ruling: the
narrator narrates, the app is where you act, and three modals for three
objects reads as paperwork). `advanceWhen` is implicit: **the step gates its
own Next on all of them existing**, enforced by the bar rather than by each
phase author, because one forgotten `advanceWhen` would let the user skip the
run the step exists for.

**One funnel, not one branch per door.** Every free-create entry point goes
through `src/ui/create-element-door.ts` (elements sidebar `+`, `Ctrl+E`, the
Charts room's `+ Element`), which asks `tour-door.ts` first and falls through
to the ordinary modal on any decline. Before S302 the tour branch lived only
in the sidebar handler while this doc claimed "EVERY create door is scripted"
— `Ctrl+E` and the Charts room opened a free-form modal right beside the
locked one. Contextual creates (from-selection, for-this-link-field) stay
outside the funnel deliberately: they answer a question the user already
asked.

The guard is the feature (gate R8): tour active ∧ tour world active ∧ the step
has creates ∧ they are not all present ∧ the bundle index resolved. Any miss
opens the normal modal. **A silently dead `+` is worse than an unscripted
one**, and a world-blind hijack produces exactly that the moment the user
switches to their own world. Mints serialize with the next ref computed inside
the chain (R9), or two fast clicks mint the same element twice and the run can
never complete.

The run's copy points at the sidebar `+`, so `body.atlas-tour-createstep`
highlights it the way the pin beat highlights the real +pin button — the
sidebar's own pulse only fires on an EMPTY world, so by the objects step it
pointed at a control carrying no signal at all.

## Phases (S301 kernel, S302 wired)

A step's narration changes as the user acts, and its forward control appears
only once the deed is done. **A phase is DERIVED from world state, never
stored**: a stored phase index would be a second source of truth that can
disagree with the world after a reload, a back-nav, or a deletion, and the
tour already heals the world on every step-enter.

`src/tour/tour-view.ts` is the kernel: store-free, DOM-free, unit-tested.
- **Prefix semantics**: the winning phase is the last one whose `when` holds
  AND all earlier phases' `when` also hold. Plain last-match picks a
  contradictory phase when the user deletes something mid-step (phase C's
  "all three are here" copy while the ship is gone).
- **Suspension**: when the tour's world is not the ACTIVE world (`tourIsLive`
  false — a mid-tour world switch, or teardown), resolution holds the opening
  phase and `canAdvance` is forced false. Without it the narration reads the
  user's OWN world: collapsing to "create the Hegemony" while they look at
  their own novel, or resolving TRUE against foreign data and claiming a deed
  they never did.
- **Shorthand**: `data-tour-step` + `data-tour-phase` are stamped on the
  panel, so a step's second state is "4b" in conversation and in e2e.
- **The bar subscribes to core state** (S302): phases derive from the world,
  so the panel has to hear the world change. The alternative was a bespoke
  notify call threaded into every gated beat — five couplings into rooms that
  should not know the tour exists. `notifyTourPinPlaced` was the first of
  those and is now deleted. A signature memo keeps the common case free, and
  it MUST include per-ref progress and lit-glyph state: minting #2 of 3 moves
  neither step nor phase nor `canAdvance`, so without those terms the middle
  click of a run renders nothing at all.
- **The memo resets on mount AND unmount, and a null root is always a miss**
  (gate R3). Otherwise exit-at-step-1 memoizes a signature, the replay enters
  step 0 before the bar mounts, and the first render matches its own stale
  signature and early-returns against a dead root: `atlas-touring` chrome with
  no narrator, no Next, no Exit, recoverable only by reload.
- **Two engine flags suppress mid-flight repaints**: `enteringStep` (the panel
  would paint the new step's copy while the old step's reveal is still writing
  and before `routeFor` navigates) and `tearingDown` (teardown's state writes
  land while the tour flag is still set, so the panel would visibly rewind to
  phase A on its way out).

**`data-tour-step` IS NOT A SETTLE SIGNAL.** The panel re-renders from
`writeTourState`'s emit, which fires BEFORE `revealUpTo` heals and before
`routeFor` navigates. A test that syncs on the attribute reads the world
mid-step and will pass whatever the code does — this is exactly how the first
draft of the back-nav regression passed against the bug it was written for.
Use `__atlasTestApi.awaitTourSettled()` (mirrors `awaitTidies`).

**Safety layer**: the tour world is `demo: true` (waypoint law holds); every
engine write path re-checks `tourWorldIsActive()`. While touring, the home
room's onboarding cards stay silent (S264 intersection class).

## The bundle (`src/demo/hyperion-world.json` + webps)

Baked from OnlyWorlds demo world (key `0000000000`), **34 elements** since the
S312 re-snapshot (Captain's live spatial rebuild adopted wholesale: map
"Map of Unnamed planet" (so named since his S318 live rename) with his art baked to `unnamed-planet.webp`, zone `Swamps`
with 6 named markers, his pin; the old map/zone/9-markers are gone, and the
LIVE world was aligned back — curly names, aliases, dates, book/chapter/
calendar pushed, orphan zone deleted). ⚠ `TOUR_MEDIA_URLS` in tour-engine must
name every `x_tour_media` asset or the attach silently skips (S312's e2e
catch). Offline; images ship as webp and attach as LOCAL media at reveal. `_bake_notes` lists every editorial
deviation: zone-twin merge, the SHARED event date (both at 7, S305), the link
weave, pin rename, book+chapter mint, atlas_aliases for the sentence's surface
forms, Rachmaninov's 1873 Earth birth_date removed (it stretched the chart axis),
and the S306 writing-beat bake (below).
**S306**: the character `Steinway` was renamed **`Mr. Steinway`** because the bare
key collided with the `Steinway` alias on `The Consul's Steinway`, and both
autolink and bulk-link skip any key with 2+ candidates — that word could never
have linked, silently. `Story of the old piano` gained `supertype: 'Draft'` so it
is visible in the writing tree at all (a narrative with no writing-label
supertype is filtered out by `getTierForNarrative`); it is not revealed during
the tour. Both changes were mirrored to the live world.
The chapter's `story` is markdown and carries **NO** `ow://` chips (the user
links them) with NO richtext sidecar — the first sidecar-less narrative ever to
hit the markdown-fallback
path (which was silently broken until it did; fixed with
`contentType: 'markdown'`).
**Skeld asks owed**: adopt link weave + event dates server-side; freeze
0000000000 as tour source.

## Browser support

`src/core/capabilities.ts`: `hasFolderMode()` (showDirectoryPicker) vs
`hasOpfsMode()` (storage.getDirectory + createWritable — Safari 18.2+,
Firefox 111+). Boot admits folder-mode fully, OPFS-only in tour-capable mode
(landing folder door becomes an honest line; finale drops the folder
button), neither → the unsupported page (recommends Chrome/Brave, names the
tour for Safari/Firefox). Feature-detection only, no UA sniffing. e2e locks
the OPFS-only path by deleting showDirectoryPicker pre-boot; Playwright's
Windows WebKit has no OPFS at all, so real-Safari verification is owed on a
Mac. Full Safari support = the browser-storage-worlds project (banked,
post-launch).

## The rework (S301 → S304, and what remains)

Captain's dump restructured the whole tour. **LANDED through S304**: the phase
kernel (S301) + scripted `+` door (S302) + capability-class staging (S303), and
now (S304) the ACT RESTRUCTURE — the step-0 sentence opener that hands off into
the dock, the maps act moved BEFORE the objects (lighting "sat" in reading
order), institution+title merged, the zone revealed with the map, and the pin's
soft correction (place anywhere, Next only over the swamps, drag to fix).

**LANDED S305**: the charts act — the events share ONE date (he plays WHILE they
surge), the chart step became a hands-on NOW beat (`handsOn: 'set-now'`, single
route: the bundle ships no `time_current`, so the room's real button is
pressable, and setting the clock both draws the gold line and gives the Consul's
open-ended title an end to run to), and a new `deep-time` step puts Rachmaninov
and his Prelude in the Old Earth era. The bundle bakes a two-era calendar
(`Hegemony Standard`, Old Earth counting down / PC counting up, sharing pivot 0);
no conversion to Earth's calendar is asserted anywhere. Two APP defaults were
fixed on the way: the chart's default window is outlier-aware (a wide span with a
tight cluster no longer smears; the strip and the pannable bounds still cover
everything), and a world holding exactly one calendar now speaks it instead of
falling back to bare numbers.

Schema limits found while designing it, worth knowing before proposing any
chart beat: **objects are not dateable at all**, and **characters carry
`birth_date` with no death field**, so neither an object nor a character can
render a range. `title` is the only type with open-end semantics (grant to now,
fade cap), which is why the Consul's title is the act's range subject.

**ALL LANDED** (this list previously named four things as unbuilt while three of
them had already shipped in the very session the doc claimed to document — a doc
asserting intent as fact, which is exactly how a future session builds the wrong
thing):

- the CHARTS act, element by element — **LANDED S305** (the event-vs-narrative
  branch was CUT by Captain in favour of a "more information" note, which removed
  the reveal-slot kernel change entirely; no gate was needed)
- the two-era Old Earth/PC calendar baked into the bundle — **LANDED S305**
- the EXIT MODAL showing which rooms you saw — **LANDED S305**
  (`tour-exit-summary.ts` + `tour-exit-modal.ts`)
- the WRITING beat — **LANDED S306**, though not as this list imagined it. The
  tier choice was CUT: `isWritingInitialized` (writing-helpers.ts) correctly
  suppresses the setup screen when every chain member's supertype matches a
  writing label, which the bundle's Book/Chapter do, so the screen cannot appear
  without baking a world that misrepresents itself. The selection bubble was
  also dropped as unnecessary: the gesture is autolink's **Tab-on-hover** (with
  right-click as the alternate), both of which the writing room already had. No
  unlinked chapter variant was needed either — Chapter 1 itself is baked plain.

Positions, rulings and open questions live in the plan note; the phase contract
carries the engineering.

**STILL OPEN**: resume-after-exit (below), and the reverted chart-framing fix
(spec in the S305 handover addendum).

Standing decisions from that round:
- Create buttons never return to the widget: the narrator narrates, the app
  is where you act.
- A pin landing outside the swamps gets a soft correction, not a refusal
  loop; Next appears once it sits over the zone.
- The tour world still folds away on exit. RESUME is wanted, and is cheap
  because `revealUpTo` is idempotent: persist the step + a small choices
  record (pin position, branch choice, dates, tier labels) and rebuild.
- **The share detour is CUT** (Captain, S302). It was the one beat that could
  not be built honestly: publishing needs an api key AND a registry PIN, and
  seeding fake ones would make the tour issue REAL authenticated requests to
  production (`reconcilePubMirrors` fires on every share-room mount; republish
  and revoke would hit a live slug) and arm the sync engine on a throwaway
  world. The display half was nearly free — `atlas_page_pub` is a local mirror
  — but the account half was not, so the whole beat goes.
- **The import detour is CUT** as well; at most a "more information" foldout
  later. It has no tour integration today, its mode radios are not individually
  addressable, and a full-world paste defaults to creating a SECOND world that
  the residue contract does not track.
- Dates: one monthless calendar with two eras (**Old Earth** counting down to
  a pivot at 0, **PC** counting up from it — both in-text terms), baked into
  the bundle rather than taught as a step (Captain, S302). `CalendarEra`
  already supports up/down eras sharing a pivot (unit-tested against a Dune
  B.G./A.G. pair), so there is nothing to build. **No conversion is ever
  asserted**: the books never state the PC epoch, so Rachmaninov sits in the
  Old Earth era on the world's own line and the narrator says "centuries
  before", never a mapped year. No invented month names.
  - Known gap, banked: calendar-worded date ENTRY exists only in the charts
    room's drag popover. On an element's own page a date is a raw integer.

## Open work (reconciled S301)

- Captain's copy pass over the 17 bodies + meta lines + deeper paragraphs
  (flag sheet `Notes/2026-07-19-s298-tour-flag-sheet.md`).
- Captain's Hyperion share-page link on the 'online' step (URL owed).
- Charts-step redesign (design round with Captain first — held).
- Crimson Text bundling if the serif look is blessed (Georgia fallback now).
- Bar polish: dodge when the right pane is the subject · reduced-height on
  small viewports (held — re-measures the fixed dock; wants copy settled).
- Staggered reveals (held, same reason).
- Precision-audit proposals for Captain's bless (`Notes/2026-07-20-s299-precision-audit.md`).
- Real-Safari smoke (needs a Mac).
- DONE S299 (was open): resilience heal · real-control pin beat + placement
  feedback · precision staging (empty-section hide, zone/web chrome) · fixed
  290px dock · eyebrow cut · glyph-on-create · step counter re-added.

## Tests

`tests/e2e/tour.spec.ts` (17, S306 order — count with `grep -c '^test('`, never
from this line): the centre-stage opener + Begin hand-off · full 18-step walk
(staged chrome, locked modals incl. the sidebar + door, the real-button pin
placement + locked identity, alias timing, web cameo, teardown + emphasis swap) ·
**the pin SOFT correction** (place outside → phase b, no Next; drag onto the
swamps → phase c, Next) · **the writing beat** (plain prose, no Next until a
chip; a REAL click + `keyboard.press('Tab')`, never a synthetic KeyboardEvent) ·
single-route create beats · the resilience mess-walk (delete/unlink/wreck → heal,
user link + media + cached-tab zone overlay) · armed-pin-disarms-on-nav (no stray
pin) · resume-after-reload · exit-teardown · the exit confirm · OPFS-only boot.

**Trap for the writing beat's gesture**: `handleKeyDown` promotes the decoration
containing the CURSOR, so the press only lands once the click's selection has
actually been applied. Waiting on `ProseMirror-focused` is NOT enough — that
resolves from a cached snapshot without a round-trip, and the key then arrives
before the selection exists. Wait on the selection sitting inside an
`.atlas-autolink-hint`, and retry the click+Tab pair (under 4 workers a single
attempt is not reliable).
Unit: `tour-view.test.ts` adds `pinInZone` (synthetic geometry incl.
order-sensitivity + foreign-zone markers); `tour-data.test.ts` adds the
baked-pin-in-swamps guard + a "zone revealed no later than its place-pin step"
invariant.
Kernel: `tests/unit/tour-heal.test.ts` (9) +
`tests/integration/folder-store.updateElementWith.test.ts` (4). App-wide
placement feedback: `tests/e2e/phase5-maps.spec.ts` (banner + crosshair +
Esc-cancel). Per-zone share curation: `tests/e2e/share.spec.ts` +
`tests/unit/sharing.test.ts` (mirror count-aware heal).
