# Atlas — Guided Tour Design

**Version**: 2.2 (2026-07-19, S297 — consolidated after Captain's four design
rounds; supersedes v1/v2 delta layers)
**Concept**: Freek + Captain, 2026-07-19. The opening sentence of *Hyperion*
by Dan Simmons becomes a small linked world, step by railroaded step,
teaching OnlyWorlds AND atlas at once — while the workspace BUILDS ITSELF
around the user. Successor to ecosystem-explorer's sentence tutorial (linked
at the 'online' step as the deeper schema story).

---

## The shape

- **The bare splash** (`body.atlas-preroot`): pre-setup, atlas shows NO shell
  chrome at all — just the Atlas mark and two side-by-side doors ("Take the
  tour" / "Set up a folder") on black. Settings stays live at the
  `#/settings` route. After a completed tour (`atlas_tour_done_v1`) the doors
  swap emphasis: folder primary, tour reads "Replay the tour".
- **One narrator, ONE position** (S298 — the centered opener was retired,
  Captain's round): a single glass panel (cyan top rail, tint, min-height
  272px so the dock NEVER changes shape between any two steps, opener
  included), docked bottom-center from the first second. Step 1 carries its
  framing in the meta channel: eyebrow ("One sentence, one world") left, the
  cite "Hyperion, Dan Simmons (1989)" right — the safe book-and-year form,
  no mortality claims, zero extra rows. The bare stage above it fills in on
  Next. z-index 900: a modal dialog ALWAYS outranks the narrator.
- **The progressive build-up**: chrome appears when it is taught. The bar
  stamps `<body data-tour-stage>` (0 bare · 1 shell + worlds sidebar ·
  2 elements era · 3 + right pane/maps · 4 + writing icon · 5 + charts icon ·
  6 everything); atlas.css hides the rest per stage. The sidebar footer stays
  hidden for the whole tour. At stage 1 the worlds sidebar shows its TRUE
  final structure — all five action icons in their real places — with only
  create-world live and the other four greyed (`.atlas-tour-locked`).
- **Panel rows**: the annotated sentence · hairline · body copy (+ the meta
  subtext channel, always rendered — nbsp when a step has none — so the shape
  holds; ✦ deeper; inline links) · act label "Elements · Step N of 18" +
  controls. Steps carry NO titles: the act label orients, the hairline
  divides material from narration.
- **The annotated sentence** (the progress bar, ow.com vignette grammar):
  serif italic (Crimson Text stack, Georgia fallback — bundling owed if the
  look is blessed); parsed words take their element-type color and click-jump
  to their step; every span's END word carries an inline element-type glyph,
  PRE-SPACED from step 1 as a dim ghost and LIT (pop-in) when its step
  arrives — zero reflow. The finale sweep paints remaining connectives a
  quiet neutral (`fillRest`).
- **✦ deeper**: real multi-paragraph content (`\n\n` renders as paragraphs)
  in a scrollable FLYOUT above the panel — the dock's height never changes.
  The explorer link shares the deeper toggle's exact metrics on the same row.

## Hands-on beats (the watch/do rule)

Every hands-on step offers the real gesture (primary button AND the real UI
surface itself) or a ghost Next that performs it silently. Esc closes a
dialog and stays on the step — never "back" (the panic-key rule). Names are
LOCKED — every user's tour is identical, and no user-typed data rides into a
throwaway world:

1. **Create the world** (step 2): the REAL create-world modal, name
   "Hyperion" readonly, the folder hint replaced by the teaching line
   ("normally this becomes a folder; the tour world stays in your browser").
   Create → the shell materializes on the world's home. The sidebar's own
   create-world icon opens the same locked modal. SINGLE ROUTE (S298): the
   create beats carry no watch-mode Next — the locked one-click modal is the
   way; the consul step shows plain Next only after he exists. The stage-1
   sidebar toggle also keeps its final geometry: a locked ghost segment
   holds the place the world name will take.
2. **Create the Consul** (step 3): the REAL element modal, type grid locked
   to character, name "The Consul" readonly. During this beat EVERY create
   door is scripted — the elements-sidebar + opens the same locked modal
   until the Consul exists; after that the sandbox is free.
3. **Set up your folder** (step 18, finale): the real `setupAtlasRoot`
   picker; success ends the tour. On OPFS-only browsers Finish is primary
   and no folder button renders.

## The residue contract

The tour leaves NOTHING behind. The world is created at step 2 (not boot)
and exit or Finish — anywhere, anytime — tears it down completely: registry
entry, handle, OPFS folder. Exit returns to the launch location
(`returnHash`: the landing for fresh users, the exact prior route for a
settings replay). `atlas_tour_done_v1` survives as the only trace, driving
the landing's emphasis swap.

## Acts (18 steps)

1. **Elements** (7): opener · create the world · create the Consul ·
   Hegemony institution · title · objects (balcony parent_object spaceship) ·
   linking payoff (objects BEFORE linking so the Consul's page carries real
   chips when the copy says "everything connects"; deeper: two-way links,
   Web, Knowledge).
2. **Maps** (4): Planet Hyperion location · the map (bundled art, right pane
   appears) · the balcony-seat pin · The Swamps zone + saurians/species/pack.
3. **Writing** (2): Chapter 1 = the sentence VERBATIM with 9 live chips
   (baked Book "Hyperion" + "Chapter 1") · the two events (+ Rachmaninov +
   the Prelude — chip targets must exist by chapter time).
4. **Time** (1): the chart; events at years 7/12, zoom-out finds the gold
   now at 15 (deeper: drag-to-date, saved charts, calendars).
5. **Your world** (4): the sweep (+ `fillRest`) · where-it-lives (files
   story; Web-tab cameo via `webTab`; deeper: folder-is-the-world, offline) ·
   online (demo key 0000000000; deeper: sync, read keys, ecosystem; explorer
   link; Captain's Hyperion share-page link joins when it exists) · finale.

**Cut from the tour** (stay as waypoints): knowledge room visit, import.

## Mechanics (`src/tour/`)

- **`tour-data.ts`** — sentence + step script + `tourStageFor`. Steps
  reference bundle elements as `"type:Name"`; spans are word-index ranges +
  element type. Route kinds: home · elements · element · map · writing ·
  chart; flags `webTab`, `fillRest`, `meta`, `deeper`,
  `handsOn: 'create-world' | 'create-consul' | 'setup-folder'`.
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

**The reveal system**: the world starts empty; each step writes its bundle
elements. Link values pointing at not-yet-revealed bundle ids are STRIPPED
at write time (never the element's own `id` — identity, not a link) and
HEALED when targets reveal. `atlas_aliases` defer the same way until the
CHAPTER reveals (they keep the prose chips word-exact; on a beginner's first
element page they are noise). A hands-on element only auto-reveals for steps
strictly past its own.

**Safety layer**: the tour world is `demo: true` (waypoint law holds); every
engine write path re-checks `tourWorldIsActive()`. While touring, the home
room's onboarding cards stay silent (S264 intersection class).

## The bundle (`src/demo/hyperion-world.json` + webps)

Baked from OnlyWorlds demo world (key `0000000000`), **36 elements**
(34 upstream-derived + minted Book/Chapter), offline; images ship as webp
and attach as LOCAL media at reveal. `_bake_notes` lists every editorial
deviation: zone-twin merge, event dates (7, 12), the link weave, pin rename,
book+chapter mint, atlas_aliases for the sentence's surface forms,
Rachmaninov's 1873 Earth birth_date removed (it stretched the chart axis).
The chapter's `story` is markdown with `ow://` chips and NO richtext
sidecar — the first sidecar-less narrative ever to hit the markdown-fallback
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

## Open work

- Captain's copy pass over all 18 bodies + meta lines + deeper paragraphs.
- Skeld's parallel HTML mocks (narrator/sentence/landing) — compare + graft.
- Captain's Hyperion share-page link on the 'online' step (URL owed).
- Crimson Text bundling if the serif look is blessed (Georgia fallback now).
- Glyph timing nuance: hands-on glyphs light on step-enter, not on-create.
- Bar polish: dodge when the right pane is the subject · reduced-height on
  small viewports.
- Real-Safari smoke (needs a Mac).

## Tests

`tests/e2e/tour.spec.ts` (5): full 18-step walk (staged chrome, locked
modals incl. the sidebar + door, chips, alias timing, rest-fill, web cameo,
teardown + emphasis swap) · watch-mode · resume-after-reload ·
exit-teardown · OPFS-only boot.
