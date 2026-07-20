# Atlas — Guided Tour Design

**Version**: 2.4 (2026-07-20, S299 — the resilience contract, 3-lens gated;
supersedes v2.3)
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
  stamps `<body data-tour-stage>` (0 bare · 1 shell + worlds sidebar ·
  2 elements era · 3 + right pane/maps · 4 + writing icon · 5 + charts icon ·
  6 everything); atlas.css hides the rest per stage. The sidebar footer stays
  hidden for the whole tour. At stage 1 the worlds sidebar shows its TRUE
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
  PRE-SPACED from step 1 as a dim ghost and LIT (pop-in) when its step
  arrives — zero reflow. (The finale's neutral fill of connective words was
  CUT in S298 — only element words ever color.)
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
   way; the consul step shows plain Next only after he exists. The stage-1
   sidebar toggle also keeps its final geometry: a locked ghost segment
   holds the place the world name will take.
2. **Create the Consul** (step 2): the REAL element modal, type grid locked
   to character, name "The Consul" readonly. During this beat EVERY create
   door is scripted — the elements-sidebar + opens the same locked modal
   until the Consul exists; after that the sandbox is free.
3. **Place the pin** (step 9, S299 — reworked to use the ACTUAL control,
   Captain's round): the step routes to the combined map+element view (map
   open right, Consul selected middle) so the Consul's REAL +pin button
   shows; the `atlas-tour-pinstep` body class pulses it cyan. The user clicks
   that real button (arming `ui.pinPlacement` — the app-wide placement
   feedback then fires: lit button, a "Click the map to place …" banner over
   the map, crosshair cursor, Esc to cancel), then clicks the map; the pin
   lands THERE with the bundle pin's locked identity (name + id, via
   `tourPinBake`). Position is the user's to keep (heal never touches x/y —
   C3). NO dock button — single-route, gated: Next appears only once the pin
   exists; the pin glyph lights on the create. The app-wide placement
   feedback lives in `src/tabs/right/map-placement-hint.ts` (installed at
   boot) + the `[data-action="pin-element"].active` style; Esc-owns-placement
   is a skip in the deselect-to-home hotkey guard.
4. **Set up your folder** (step 17, finale): the real `setupAtlasRoot`
   picker; success ends the tour. On OPFS-only browsers Finish is primary
   and no folder button renders.

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

## Acts (17 steps — the intro was cut in S298; the tour opens on create-world)

1. **Elements** (6): create the world (carries the framing; opens the tour) · create the Consul ·
   Hegemony institution · title · objects (balcony parent_object spaceship) ·
   linking payoff (objects BEFORE linking so the Consul's page carries real
   chips when the copy says "everything connects"; deeper: two-way links,
   Web, Knowledge).
2. **Maps** (4): Planet Hyperion location · the map (bundled art, right pane
   appears) · the balcony-seat pin (HANDS-ON, S299: the user places it) ·
   The Swamps zone + saurians/species/pack.
3. **Writing** (2): Chapter 1 = the sentence VERBATIM with 9 live chips
   (baked Book "Hyperion" + "Chapter 1") · the two events (+ Rachmaninov +
   the Prelude — chip targets must exist by chapter time).
4. **Time** (1): the chart; events at years 7/12, zoom-out finds the gold
   now at 15 (deeper: drag-to-date, saved charts, calendars).
5. **Your world** (4): the sweep · where-it-lives (files
   story; Web-tab cameo via `webTab`; deeper: folder-is-the-world, offline) ·
   online (demo key 0000000000; deeper: sync, read keys, ecosystem;
   Captain's Hyperion share-page link joins when it exists) · finale.

**Cut from the tour** (stay as waypoints): knowledge room visit, import.

## Mechanics (`src/tour/`)

- **`tour-data.ts`** — sentence + step script + `tourStageFor`. Steps
  reference bundle elements as `"type:Name"`; spans are word-index ranges +
  element type. Route kinds: home · elements · element · map · writing ·
  chart; flags `webTab`, `meta`, `deeper`,
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

## Open work (reconciled S299)

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

`tests/e2e/tour.spec.ts` (7): full 17-step walk (staged chrome, locked
modals incl. the sidebar + door, the real-button pin placement + locked
identity, chips, alias timing, web cameo, teardown + emphasis swap) ·
single-route create beats · the resilience mess-walk (delete/unlink/wreck →
heal, user link + media + cached-tab zone overlay) · armed-pin-disarms-on-nav
(no stray pin) · resume-after-reload · exit-teardown · OPFS-only boot.
Kernel: `tests/unit/tour-heal.test.ts` (9) +
`tests/integration/folder-store.updateElementWith.test.ts` (4). App-wide
placement feedback: `tests/e2e/phase5-maps.spec.ts` (banner + crosshair +
Esc-cancel). Per-zone share curation: `tests/e2e/share.spec.ts` +
`tests/unit/sharing.test.ts` (mirror count-aware heal).
