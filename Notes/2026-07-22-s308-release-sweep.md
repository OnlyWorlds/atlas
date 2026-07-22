# S308 — the release sweep: findings + proposed bout

**Written**: 2026-07-22 09:4x (session open). Atlas ships in days.
**Shape**: a nine-lane read-only fleet (each lane refute-verified by an opus
skeptic) running beside a keeper own-eyes pass on the live app.

---

## Method, and its honest gaps

- **Nine lanes commissioned, five returned on the first pass.** Four
  (`visual-system`, `voice-copy`, `docs-truth`, `failure-paths`) died on API
  529 Overloaded — infrastructure, not brief quality. Relaunched via
  `resumeFromRunId`; the cached prefix replayed free. **Anything in this
  document from those four lanes is marked PENDING.**
- **Every lane's findings were attacked by an opus refuter** whose default was
  REFUTED. Tally on the five returned lanes: **38 CONFIRMED · 17 NARROWED ·
  2 REFUTED**. The NARROWED column is the valuable one — it is where a real
  thing was described inaccurately, and several proposed fixes were wrong.
- **The keeper drove the live app** (dev server + Playwright, 1366×768) for
  everything visual, because agents cannot see pixels. Where a lane's claim and
  my own eyes disagreed, my eyes won and it is noted.
- **Three of my own suspicions were refuted by running the thing**, and they are
  recorded below as upheld-for-the-tool, because a sweep that only reports
  defects is lying about the tool's condition.

---

## THE HEADLINE — a dead gate that has been shipping since S306c

**`atlas-tour-preweb` can never fire. The Web tab has been visible from step 5
of 17 for the tour's entire post-S306 life.**

Chain, keeper-verified line by line:

1. `tour-bar.ts:349` — `TOUR_STEPS.findIndex(s => s.id === 'where-it-lives')`
2. S306c **merged `where-it-lives` + `online` into `yours-to-keep`** (PROGRESS
   says so in its own S306 block). The 17 live ids are `the-sentence,
   the-world, the-consul, the-hegemony, the-planet, the-map, the-pin,
   the-swamps, objects, linking, the-writing, the-events, the-chart, deep-time,
   the-rest, yours-to-keep, finale`. **`where-it-lives` is not among them.**
3. So `webIdx === -1`, and `idx < webIdx` is false for every step, since
   `idx >= 0` always.
4. So `body.atlas-tour-preweb` is never toggled on, and `atlas.css:2016`
   (`body.atlas-touring.atlas-tour-preweb .atlas-right [data-tab-kind="context"]`)
   never matches.
5. Two copy decisions are written on the premise that the tab is hidden:
   `tour-data.ts:441-445` deliberately withholds the Web tab's NAME at
   `linking`, citing the rule "naming a tab the user cannot see yet is a promise
   the chrome does not keep"; and `yours-to-keep` introduces it as arriving.
6. The comment at `tour-bar.ts:346` still reads "the Web tab for
   where-it-lives".

**Fix**: one word — `'where-it-lives'` → `'yours-to-keep'` at `tour-bar.ts:349`,
plus the comment at :346. **Test contract**: a pair — the context tab is ABSENT
at `linking` and PRESENT at `yours-to-keep`. Assert both halves so a future
rename breaks one loudly instead of quietly disarming the other (the S301
string-pair law). `grep -rn "preweb|where-it-lives" tests/` currently returns
nothing.

Same family as S302's suspension contract: a merge cut the trigger and left the
machinery green. `swampsIdx` on the line above is fine — `the-swamps` still
exists — so only this one rotted, which is exactly why nobody saw it.

---

## THE CONVERGENCE — found independently by two lanes

**Primary browse rows declare `role="button" tabindex="0"` and register no
`keydown` handler anywhere.** Reported separately by `cross-room` and
`queue-rot`. Convergence across independent lenses is the fix-first signal.

- `elements-sidebar.ts:675`, `worlds-sidebar.ts:406,473`,
  `map-index-tab.ts:409-413,429`
- A keyboard user Tabs into the list, hears "button, Emberwatch", presses
  Enter, and nothing happens. The role *promises* it works, which is worse than
  no tabindex at all.
- **The published share-page renderer gets this right**
  (`share-page-render.ts:291,474`) — so the artifact strangers see is more
  accessible than the app the author uses.
- **Refuter's narrowing, which matters**: "world activation is unreachable by
  keyboard" is FALSE — `worlds-sidebar.ts:468` renders a real `<button
  data-role="refresh-world">` inside every api-linked row whose delegated
  handler activates the world. So the hole is real but smaller than claimed.
- **Fix**: one delegated keydown per list root. `import-room.ts:641` already
  ships the exact shape — lift it, do not invent a variant. Scope to the two
  div-row files only; writing-sidebar rows are real `<button>`s and must not be
  double-handled.

---

## TIER 1 — do before release

Ordered by user-harm × cheapness. Every one is trivial or small.

| # | id | what | files | effort |
|---|----|------|-------|--------|
| 1 | `preweb-gate-dead` | the headline above | `tour-bar.ts:349` | trivial |
| 2 | `possessions-affiliations` | **The tour's payoff step names sections the app does not render.** `linking` tells the user to look at "Possessions" and "Affiliations"; the page renders **Objects** and **Institutions** under a **World** heading. Three of the four things that step points at are named wrong. | `tour-data.ts:398,412,432,434` | trivial |
| 3 | `referenced-by-hyphen` | Copy writes "Referenced-by" ×3; the app renders "Referenced by". Same defect family as #2, same page, same breath. | `tour-data.ts:434,440,481` | trivial |
| 4 | `keyboard-dead-tabstops` | the convergence above | 2 sidebar files | small |
| 5 | `swamps-all-linked` | "all linked to the swamps zone" is **false for 2 of the 4 elements** the step reveals, and schema-impossible for one (a collective cannot sit in a zone). The step's whole job is making the link web feel real. | `tour-data.ts:364` | trivial |
| 6 | `esc-unmounts-import-paste` | Esc in the Import room navigates home and **destroys an unsaved pasted payload**. No draft persistence, no confirm, no undo anywhere in atlas. Refuter's caveat: usually still on the clipboard, so HIGH only if the user edited the JSON in place. | `hotkeys.ts:254-282` | small |
| 7 | `icon-ligature-a11y` (keeper) | **253 Material Symbols render sites, 6 `aria-hidden` in the whole codebase.** Read off the live a11y tree, not inferred: buttons announce as `"add cloud_upload"`, `"wall_art pages"`, `"import_export import"`, `"home home"`. A blind user hears "add cloud upload" for "create a new API world". | app-wide | small |
| 8 | `emdash-user-copy` (keeper) | **13 user-visible em-dashes**, against the zero-em-dash voice law. Concentrated in `timeline.ts` (5) and `worlds-sidebar.ts` (4). Honest denominator: 54 string-literal hits total, but **39 are developer console logs** (`[atlas:sync]`, `[auto-pull]`, `[ow-v2]`) where the law does not apply, and `element-detail.ts:245` is `'—'` as a null placeholder, which is legitimate typography. | 8 files | trivial |
| 9 | `room-nav-native-disabled` (keeper) | The six zero-world room-nav buttons use the **native `disabled` attribute, so the browser fires no hover** — no tooltip can ever explain them. `opacity:1`, `cursor:default`, no `title`, no `aria-disabled`. **S301 already hit and fixed this exact mechanism on the four greyed sidebar icons.** The fix never reached the room nav. | `room-nav.ts` | trivial |
| 10 | `demo-586` (keeper) | `demo-view.ts:60` hardcodes "586 elements" on the **showcase page**. Derived from nothing; the payload's element map holds 196; Sikelia is recorded elsewhere as 588. No test guards it. A rotting number is worse than none. | `demo-view.ts:60` | trivial |

**Tier 1 total: ~10 items, all trivial/small, no architecture touched.**

---

## TIER 2 — high value, still cheap, take if the runway holds

- `new-pane-just-opened` — `the-map` says "a new pane just opened on the right"
  **one step after it actually opened** (`unlocks:['rightpane']` is on
  `the-planet`). The largest piece of chrome in the build-up arrives unnarrated
  and gets credited to the wrong cause. Cleanest fix: move `unlocks` to
  `the-map`; nothing between the two steps reads the capability.
- `back-on-the-consuls-page` — `linking` opens "Back on the Consul's page" but
  the previous step never left it. Also frees two words in a 290px dock.
- `pin-deeper-precedes-objects` — the pin step's deeper argues "the pin holds
  the Consul, not his spaceship" **two steps before the spaceship exists**.
  Residue of the S304 reorder.
- `pin-phase-b-hedges` — "If it is not over the swamps" hedges at the one moment
  the engine demonstrably knows it is not (Next vanished for that reason). The
  phase system exists so copy can be definite.
- `finale-replay-from-settings` — narrowed and worth reading: the sentence is
  TRUE on the main Chromium path (`settings-panel.ts:113-114` ships a live
  "Replay the tour" chip) and false only for pre-root / OPFS-only finishers.
- `skipper-gets-no-next-step` — **verifies the banked zero-worlds CTA item and
  sharpens it.** Guidance is not missing from the codebase, it is missing from
  the highest-traffic path: the tour FINISHER gets "Folder ready: create your
  first world from the Worlds sidebar" (`tour-engine.ts:921`); the SKIPPER gets
  "OnlyWorlds folder is set up" — a receipt with no next step. Both toasts
  auto-dismiss in 4s. Fix: give the skipper the finisher's sentence, and make
  the reserved detail zone's default state a persistent line instead of empty.
- `hover-only-teaching` — the zero-worlds pane teaches only on mouseenter; add
  `focus`/`blur` to the same loop. Refuter found it is **four** buttons, not
  five: `open-folder` has no DETAILS entry, so it is untaught on *every* input
  path including hover.
- `double-hash-href-writing` — writing breadcrumbs build `'#' + elementHash(...)`
  → `##/w/...`; ctrl-click and middle-click open a new tab on the welcome
  screen. Drop the `'#' +` at two sites.
- `demo-opfs-dead-cta` — on OPFS-only browsers the demo footer keeps the one
  button that cannot work and swallows the throw in a bare `catch {}`.
  **Narrowed**: the top-band exit still works, so nobody is stranded — it is a
  silent dead CTA, not a trap.
- `settings-folder-btn-ungated` — third instance of the capability class.
- **Keeper visual set**: the two landing doors differ by **0.83px** (identical
  padding/border/font-size; `line-height: normal` vs an explicit `17.5px`) and
  differ in weight+colour while sharing background and border — 90% identical,
  10% arbitrarily different, which reads as drift rather than hierarchy. The
  landing tagline is **after** both doors in the DOM and only above them via a
  CSS `order` flip, so a screen reader announces the buttons before it says what
  Atlas is. The hero sentence renders `Rachmaninov's` with a **straight**
  apostrophe while body copy inches below renders `Consul’s` **curly** — visible
  at 22px serif italic, one character to fix.

---

## TIER 3 — after launch, named so the runway stops carrying them

`chart-framing-redo` (its own gate documented six preconditions — **do not
attempt before release**; say so in PROGRESS so the line stops reading like a
small pending fix) · `tour-create-gesture-rework` (correctly unbuilt; move to a
named post-release sheet) · `applychart-calendar-ratchet` (self-recoverable from
a visible menu) · `zone-cancel-4-field-restore` · `zone-rebuildhandles-mid-drag`
— **and read the refuter on this one: the proposed fix is wrong and would ship a
regression.** `isMidDragSuppression` is not a drag-in-progress flag, it is a
150ms time-window read. · `writing-room-no-delete` (medium; real, but a room-level
capability decision, not a release patch) · `confirm-setting-covers-three-of-ten`
(narrowed hard — the label is already element-scoped and honest).

---

## OPPORTUNITIES — what is still worth building

Ranked by payoff ÷ cost. The scout was told to be ruthless and to name what it
rejected; it rejected six things with reasons, which is why I trust the list.

1. **`story-tier-search` (small, best of the set).** Search **never looks at
   prose.** `scoreElementMatch` has name/description/type tiers and no `story`
   tier, and the writing tree bypasses the shared kernel entirely for a
   name-only substring match. A writer with 40 chapters cannot find a phrase
   they wrote. Fix is ~5 lines inside a kernel that already has both callers.
   *Refuter's caveat, worth keeping*: an in-document find bar exists for the
   OPEN narrative — what is missing is **cross-document** prose search. Perf on
   a 588-element world is unquantified; measure before shipping.
2. **`knowledge-linkall-corner` (small).** The knowledge editor has live
   autolink hints and Tab-to-link but **no link-all button** — verbatim the gap
   S306 found and fixed once in writing. Refuter narrows it honestly: the
   knowledge editor declares a deliberately trimmed surface, and link-all is
   *not* on that exclusion list, so this is an omission rather than a decision.
3. **`share-list-stale-dot` (trivial).** "Edited since publish" is already
   computed but only visible after you open the page. Three lines — but note the
   refuter: `pubBadge` is an HTML string, so concatenate + `escapeText`, not
   `appendChild`.
4. **`element-footer-timestamps` (trivial).** Raw locale timestamps where a
   tested `relativeTime` helper sits one caller away; the same element reads
   "2d ago" on home and a full timestamp on its own page. Merge must preserve
   right-pane's future-timestamp `null` guard.
5. `writing-tree-word-counts` (medium) · `notes-button-no-state` (trivial) ·
   `waypoints-progress-buried` — **narrowed hard: "runs invisibly" is false**,
   waypoints ship a full app-wide toast surface. The real gap is only that
   aggregate progress lives in a settings tab.
6. **Rejected, with reason** (from the scout, and I agree): undo — "building
   undo days before release is not an opportunity, it is a project."
   Arrow-key list nav — the elements list is an `innerHTML` blob rebuilt on
   every state tick, so roving focus is real risk days before a release; if
   taken at all, do the writing tree first, whose rows are already `<button>`s.

---

## UPHELD — stop re-verifying these

The point of the upheld column is to name what is sound so it never gets
re-checked. Highlights:

- **"the late Dan Simmons" is CORRECT.** Both the lane and I flagged it as
  unverifiable; I checked the web. He died 21 Feb 2026, after my training
  cutoff. Had I trusted instinct I would have reported a correct line as an
  error. *(There remains a real register question — `tour-data.ts:46` annotates
  the cite constant "no mortality claims" — but that is a Captain call, not a
  defect.)*
- **No unguarded destructive path.** 19 `window.confirm` sites checked against
  every delete; every cascading confirm states its count.
- **No room renders a void when empty** — every room's empty state names a next
  action.
- **No em-dash anywhere in tour copy.** The lane expected some and found none;
  independently matches my extractor, whose 13 hits are all outside the tour.
- **No release BLOCKER in the banked queue.** Nothing strands a user or loses
  data; the two data-loss classes were closed in S307.
- **The 429 gap does not exist** — `make-online.ts:129` has an explicit 429
  branch. This is a **premise correction to my own brief**, which had carried
  the item forward from the S307 handover on trust. A banked line is a claim,
  and this one had rotted.
- **8 banked items are already DONE**, four still carried as open in
  PROGRESS/S307.
- **My own a11y suspicion was refuted by the run**: the 11 shell buttons on the
  landing looked focusable from `offsetParent: null` + `visibility: visible`;
  a real focusability walk found only 3 focusable nodes. They sit inside a
  `display:none` ancestor. The tool is correct; my instrument was wrong.
- **The tour dock's "unused right column" was refuted by measurement**: content
  reaches 1141px of a 1163px dock. The apparent void is body copy correctly
  constrained to a ~540px reading measure.

---

## THE FOUR RECOVERED LANES (all 18 agents home, 0 errors)

They carried the best material of the nine. New items promoted into the tiers
above; the headlines:

### Release-grade, new

- **`nameless-element-crashes-sidebar` (HIGH/trivial, CONFIRMED) — promote to
  Tier 1.** `elements-sidebar.ts:537` sorts on `a.name.localeCompare(b.name)`
  with **no null guard — the one sort site in the codebase that skipped the
  pattern every other one uses** (`writing-sidebar.ts:119`,
  `worlds-sidebar.ts:360`, `context-pane-lists.ts:195,209` all guard). Atlas's
  own writers always default `name` to `''`, so an undefined name can only
  arrive from **outside** atlas — which the Folder Format explicitly invites.
  One hand-edited or foreign-tool file permanently breaks the element sidebar.
  Fix: `(a.name ?? '').localeCompare(b.name ?? '')`.
- **`dual-element-color-palette` (HIGH/small) — the visual headline.** The same
  22 element types are colour-coded **twice, by unrelated palettes**:
  `core/constants.ts:21-44 ELEMENT_TYPE_COLORS` vs
  `pin-visuals.ts:19-54 CATEGORY`. A Character pin on the map is orange
  `#f97316`; the same Character in Charts is gold `#ffd700`. The refuter
  confirmed the two are visible **simultaneously in the ordinary three-pane
  view** (chart nodes middle, map pins right). Fix: fall pin-visuals' lookup
  through to `ELEMENT_TYPE_COLORS` (6 importers vs 1), keeping its finer
  pin/marker/zone distinctions.
- **`data-import-label-drift` (HIGH/trivial).** The import room was rebranded
  **Data** everywhere (tooltip, help, exit summary, waypoints) *except* the two
  places that print it as running text: `room-nav.ts` carries a stale
  label-shortener in both render paths, and `command-palette.ts:53` still keys
  it on `'import'` — so **searching "data" in Cmd+K returns nothing**, and one
  control's tooltip says "Data" while its label says "import". Same family as
  Web/context.
- **`no-fetch-timeout` (HIGH/medium).** **No AbortController, AbortSignal, or
  timeout anywhere under `src/sync`** (grepped explicitly). A hung request
  leaves the pill spinning with no recourse but a page reload, and the pill's
  click handler explicitly no-ops while syncing so there is no cancel.
- **`push-phase-stuck-pill` (HIGH/small).** `runPullOnly` wraps its phase in
  try/catch-and-restore-idle **with a comment saying why**; `runPushOnly` does
  not. Any throw leaves the pill reading "Saving…" forever. Asymmetric
  hardening — the S257 defect class, again.

### Docs (a whole lane's worth, all trivial)

`design-import-header-vs-body` — DESIGN_IMPORT.md's header says the room is
unbuilt while its own body says B1-B4 shipped, and the room is called **Data**
in code · `dead-link-design-publishing` — DESIGN_WRITING.md and DESIGN_HOME.md
still link DESIGN_PUBLISHING.md, which is in `docs-archive/` ·
`sync-notes-pagination-stale` — SYNC_NOTES.md says atlas "only sees first-page
data"; the v2 adapter fully cursor-walks · `readme-chromium-only-incomplete` —
README says "Chromium-only", so a Safari/Firefox reader bounces without learning
**the tour works for them**.

### A release question only Captain can answer

The docs lane raised it as an uncertainty and it is worth surfacing: **this repo
contains `Notes/` (session handovers, "Captain" references, session numbers),
`PROGRESS.md`, and internal Carrier-ecosystem material.** If the GitHub repo
goes public at release, all of that ships with it. Not a defect — a decision.

### Refuted, and one that would have shipped a regression

- `maps-room-header-outlier` **REFUTED** — no outlier; a 22px middle-pane h1
  would be oversized in the right pane, and the 10px eyebrow is the correct
  sidebar treatment.
- `cmdk-picker-fixed-width` **REFUTED, and the proposed fix was dangerous**: the
  panels are already responsive via `max-width:92vw`, and the suggested change
  would have **removed the viewport cap** and let them touch the screen edges on
  narrow viewports. A gate finding is evidence, not a patch.
- `token-drift` narrowed hard: `var(--atlas-*)` is used **958 times against 795
  raw rgba occurrences** — tokens are the majority path, not the exception. The
  real, smaller finding is under-coverage at the alpha extremes.
- `MUTED_COLOR` narrowed: `#6b7280` differing from `--atlas-text-muted` is
  **correct**, not drift — one is translucent white over the app background, the
  other an opaque disc fill over an arbitrary map image.

### Dead CSS, now enumerated

~105 classes with zero references: a whole **Search room** (~85 lines, its own
comment cites a file that no longer exists), a **Media gallery** (fully
interaction-detailed, never wired — and the refuter established the image slot
it would have filled **already shipped** under `.atlas-element-image-wrap`, so
the fix is *delete*, not wire), and **three superseded room redesigns** (World
Home ~283 lines, Landing, old Timeline). Plus `.atlas-btn-danger`, a designed
destructive-button modifier with zero call sites while ~3-4 real delete buttons
hand-roll their own hover-red. One concrete z-index note:
`.atlas-edit-popover-backdrop` sits at **z900, exactly tied with
`.atlas-tour-bar`**.

### Keeper convergence worth recording

The visual lane inferred the tour dock is a fixed 290px with no viewport
adaptation **from the CSS**; I measured it **live at 1366×768** and got the same
number, with ~87px of empty space between the last copy line and the footer on
light steps. Its refuter wrote "to settle it in one action: run the app, resize
to 1366×768, advance to the map step" — which is exactly the pass I had already
run. Source-read and own-eyes agreeing independently is the strongest form this
finding could take.

Likewise the em-dash count: the voice lane said nine, **its own refuter
corrected it to 13-14**, and my independent extractor said 13. Three routes, one
number.

---

## THE SESSION'S REAL THEME

**Five separate instances of a decision made once and applied to one surface:**

1. S301 fixed `disabled` → `aria-disabled` on four sidebar icons; the room nav
   still uses native `disabled`, so no hover fires and no tooltip can explain it
2. S300 fixed the filter strip to count>0 types — inside the tour only; outside,
   20 chips of which 8 have counts
3. S306 added the link-all button to writing; the knowledge editor still sends
   people to a right-click menu
4. The **Data** rename reached the tooltip, help, exit summary and waypoints but
   not the nav label or Cmd+K
5. `runPullOnly` got its try/catch-and-restore; `runPushOnly` did not

This is not five patches. It is a missing close-gate step: **when a call changes
a rule, sweep every surface the rule touches in the same bout** — my own craft
file already states it, and it has now cost five separate defects.

---

## PROPOSED BOUT

**Bout 0 — the ten-minute pass, do this first regardless.**
`nameless-element-crashes-sidebar` (one line, prevents a permanent sidebar
break from any externally-authored file) · `preweb-gate-dead` (one word) ·
`data-import-label-drift` (Cmd+K currently cannot find the Data room) ·
`push-phase-stuck-pill` (mirror the pull path's existing try/catch). Four fixes,
four files, every one of them a defect a real user can hit and none of them
touching a design decision.

**Bout A — the copy-and-truth pass (half a session, no architecture).**
Tier 1 items 1,2,3,5,8,10 plus Tier 2's tour copy set. Every one is a string or
a one-word change, all in `tour-data.ts` / `demo-view.ts` / 8 toast sites. Gate:
the preweb pair-test, plus a full e2e run because #1 changes what renders.
**This is the bout to run before Captain's copy read**, so his pass lands on
corrected ground instead of re-finding these.

**Bout B — the accessibility sweep (half a session).** Tier 1 items 4,7,9 —
delegated keydown lifted from `import-room.ts:641`, a boot-time `aria-hidden`
stamp for the 253 icon sites (a MutationObserver at the boundary beats editing
253 call sites days before a release; introduce a real `icon()` helper after
launch), and `aria-disabled` on the room nav to finish the S301 decision. Gate:
an a11y-tree assertion per surface.

**Bout C — the skipper's landing (half a session).** Tier 2's
`skipper-gets-no-next-step` + `hover-only-teaching` + the keeper landing-visual
set. This is the screen every tour-skipper lands on and the weakest surface in
the tool. Captain's S255v2 call, so **his to greenlight before I touch it.**

**Bout D — opportunities, pick two.** `story-tier-search` and
`share-list-stale-dot`. The first is the highest-payoff thing in the codebase
and the second is three lines.

**Not in the bout**: everything in Tier 3, and undo.
