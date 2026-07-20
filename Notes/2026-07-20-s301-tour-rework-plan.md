# The tour rework — digestion, positions, questions, plan

**Written**: 2026-07-20 ~18:30 (S301)
**Source**: Captain's dump, 2026-07-20. This doc is my read-back: what I take as settled, where I'd change the sketch and why, what I need from him, and how I'd sequence the build.
**Status**: PLAN. Nothing built yet.

---

## 1. The architecture call: phases, derived from world state

Captain asked: phases (A/B per step) or make every state its own step? **My answer: phases, and they must be DERIVED from the world, never stored.**

The decisive reason is not taste. A phase like "the Hegemony now exists" is a fact about the world, and the tour already heals the world on every step-enter (v2.4 resilience). If the phase were a stored index, it would be a second source of truth that can disagree with the world: reload, back-nav, or a user deleting the element mid-step would leave the stored phase lying. Derived phases self-heal for free and compose with the heal contract. This is the one-source-of-truth law, and the mirror is always the bug.

```
interface TourPhase {
  body: string;
  meta?: string;
  deeper?: string;
  /** Phase applies when this reads true of the current world. */
  when?: (w: TourWorldView) => boolean;
  /** Next appears only when this reads true. Absent = Next always available. */
  advanceWhen?: (w: TourWorldView) => boolean;
}
```

A step holds `phases: TourPhase[]`; the engine picks the LAST phase whose `when` passes (so phase order reads top-to-bottom as the world fills in). `TourWorldView` is a small pure projection over the elements slice (`has('institution:The Hegemony')`, `pinPlacedInZone()`, `linkCount(narrative) >= 3`), which makes every predicate unit-testable without a browser.

**One piece of plumbing this design needs, found by the fleet**: `tour-bar` today re-renders only on the tour's own `onTourChange` emit — it does not subscribe to core state. That is why the shipped pin beat needed a bespoke `notifyTourPinPlaced()` call wired into the map click path. If we keep that pattern, every new hands-on beat (create-in-charts, date an element, drag to re-date, set the now, link three words) needs its own notify call threaded into an app write path, which is five new couplings between the tour and rooms that should not know about it. **Instead, bout 2 makes tour-bar subscribe to the elements/active slices, and phases re-evaluate naturally.** The existing notify call then becomes redundant and comes out. This single change is what makes derived phases cheap rather than viral.

**For discussion and debugging** we get the best of Captain's other option for free: the panel stamps `data-tour-step="4"` + `data-tour-phase="b"`, the counter reads "Step 4 of 14" for the user, and we say "4b" to each other. E2e addresses `4b` directly.

**Why not all-states-as-steps**: Back/Next would fight reality. You cannot navigate "back" to before the Hegemony existed, because it exists. Half the steps would be un-returnable, which is exactly the kind of state the resilience contract was built to avoid.

---

## 2. Settled — executing without further discussion

**Landing page**: logo click opens onlyworlds.com in a new tab · titles cut · boxes cut · buttons smaller/tighter/lowercase-aligned with the tool · moved to sit centered with the subtext. I will build BOTH placements (above / below the subtext) and screenshot them for the pick rather than guess.

**Tour chrome**:
- Ghost glyphs go effectively invisible when unlit (opacity ~0.06, spacing preserved so there is still zero reflow). Trade-off named: Skeld's "the ghosts promise the journey" effect dies. I think the promise is worth less than the calm.
- Sentence size constant across all dock steps (drop the `.is-fresh` font-size override, keep a brightness difference only). With the new step 0 carrying the big center-stage sentence, the dock gets one size forever.
- Dead space right of the sentence: `max-width: 75ch` → panel-governed width.
- Parsed-word underline removed AND the type colour moved into the text (the colour currently lives only in the border, so removing the border alone would delete the colour language).
- The "real element dialog, locked to the tour's script this once…" meta line: cut.
- Create-X buttons removed from the widget entirely. The widget narrates; the app is where you act.
- Tooltips enabled in tour mode on the greyed sidebar icons, with tour-specific copy.

**The occlusion fix** (not in the dump, but it is the mechanism behind the dead-space complaints): the shell reserves 180px while the dock occupies 306px. Reserve becomes dock-height-driven, so app content ends above the narrator and maps resize instead of hiding. This removes most of the need for a "dodge".

**The residue bug**: teardown prunes `atlas_right_tabs` + `atlas_map_camera_state` for the tour world, and DESIGN_TOUR's residue clause names every key. Rides the first bout.

---

## 3. Where I would change the sketch (positions, with reasons)

### 3a. The silent "+ mints an element" — I want one change
Captain: after the Consul, no more modals; the user clicks + and elements appear one after another.

I am with the intent (the user builds the world, the rhythm is the reward). My worry is that a + click which silently mints "The Hegemony" teaches a gesture that does something *different* in their own world, and the user may not connect click to result.

**My lean**: keep the silent mint, but make the result legible — the new row flashes into the sidebar and the narrator's phase-B text names what just landed ("The Hegemony is now an institution in your world"). The body text before the click already says what the + will add, so intent is set before the gesture.

**The alternative if you want maximum honesty**: the real modal, PREFILLED and locked, user hits Create. Costs one extra click per element and would make the three-object run feel like paperwork. I recommend against it for repeats, and note it is the safer teaching choice for the FIRST of each new type.
//i think the extra click is too disruptive. i do agree a nice visual would help. plus yous ee it pop up in the sentence. should be satisfying. 


### 3b. Pin-must-land-in-the-zone: soft, not blocked
Captain wants placement refused with an X until the pin is over the swamp.

A refusal loop (click, denied, click, denied) is the one interaction in the tour that could read as punishment, and it fights the app's real behaviour, which allows a pin anywhere. **My lean**: allow the placement, and if it lands outside the zone the narrator says so and offers "try again" (the pin is draggable, so the correction is itself a lesson in dragging pins). Same teaching, no wall. If you want the hard block, I will build it, but I would put the soft one in front of you first.
//yea fair. good idea. next is tehre once pni is over zone. 

### 3c. The chart's degenerate state — a good beat that needs a real fix first (I was wrong at first pass)
My instinct was that two events at the same date makes a beautiful teaching moment: two things at one moment is not yet a timeline, and when Rachmaninov's birth lands centuries earlier, the axis suddenly means something.

**Then I had the axis code read, and the render refutes the pretty version.** With one dated element the range calculator forces `max = min + 100` and pads 2%, so the single dot lands at about **1.9% across — jammed against the left edge** with the whole width empty to its right. Two elements at the same date do the same thing and the beeswarm stacks them vertically in that same left corner. So Captain's build-it-up-one-at-a-time sequence would show the user's first proud creation squashed into a corner, twice, before anything looks right.

**Revised position**: the beat is still the best teaching moment in the charts act, but it is conditional on a **one-node / zero-span axis fix** (a degenerate range should center as `[d-50, d+50]` rather than left-pin). That fix is small, lives in `axis-calculator.ts`, and benefits every real user with a young world, not just the tour. If we do not do it, we should not lean on the degenerate state at all.
//uuhm well i am ok spoofing things for the tour. but if tehres smth we can imrpove for reuglar app, hen would priortise that !! worth taking time for.

### 3d. The event-or-narrative choice is the best beat in the plan, and it is the first real BRANCH
Letting the user decide whether "The Primal Performance" is an event or a narrative teaches OnlyWorlds' actual ambiguity better than any paragraph could. Flagging the architectural cost honestly: every element in the tour so far is a fixed bundle id, and the reveal/heal system keys on ids. A branch needs two bundle entries sharing one logical slot, and the heal kernel must treat "the slot is filled by either" as satisfied. It is real work in the load-bearing kernel, not content work. I think it is worth it. Naming it so it is not a surprise mid-bout.
// yes i udnerstand it is complex if you're game, let's try it. 

### 3e. The share detour — CONFIRMED blocked, and the honest version is better anyway
Publishing is gated on `entry.api.api_key` AND a registry PIN; without both, `sharingClientForActiveWorld()` returns null and the Publish section renders **nothing but a "link an account" hint — no slug field, no button**. The tour world is created with no api block at all, and the tour never asks for an account. So a real publish is impossible without either faking the client (breaks the everything-is-real principle the tour has held for 17 steps) or walking a beginner through linking a real account mid-tour (breaks the residue contract and the no-user-data rule).

**My recommendation, and I think it is better than the original idea**: build the page, add the chart block, see the payload-true preview — all of which work locally — and then let the user hit the real, honest account wall with the narrator naming it: publishing is where a free account starts to matter. That teaches the local/online boundary at exactly the moment it becomes concrete, using the real UI, with zero invention. It also sets up the 'online' step instead of competing with it.
hmm why dont we jsut spoof it? let them publish; and then click the url; and we just.. pre create the url? no pin needed? spoof it all?

Prerequisite worth knowing: the chart block **requires a saved chart to already exist**, so this detour only works positioned after the charts act saves one. That ordering is already what Captain sketched.

### 3f. The import detour — my honest scoping vote: cut it, with one real hazard if kept
It is the weakest payoff per minute in a tour that is already doubling in length. If kept, two constraints from the code: it must use **merge-into-current-world mode only**, because "import as a new world" creates a SECOND world that the residue contract does not track and would leak past teardown; and it needs a new `import` route kind in the step union. The room itself needs no changes (import is fully local, no account, and it already fires an observable completion signal).

If you want it, my proposal stands: after the finale, optional, never in the main line.
// uuhm we COULD add it as option at the end, or .. mayeb just as more information foldout somewhere? 

### 3g. Length is the real risk, and it needs an escape hatch
Every new beat is gated on a user action, so nobody can click through any more. That is right for engagement and wrong for the person who has seen enough at minute 12. **I want a permanently visible, quiet "explore on my own" exit** that ends the tour cleanly and leaves the world (or tears it down, your call). Without it, forced-create turns a good tour into a trap.

// huh hmm yes this is a good idea. what we could add is a nice small modal that, on exit, shows what you've seen, and waht you havent, a confirms creen , for an impression of the app, clearly scoped to rooms, to sort of clarify the app more. worth trying?

---

## 3h. The demo-key finding: the link path is a 3-line fix, the view path may not be atlas's bug at all

Investigated with file:line evidence. Summary:

- **Nothing in atlas rejects a demo key by format.** There is no key-format validation anywhere in `src/` (the only shape check is on account tokens, `ow_a_`). So "atlas refuses demo keys" is not what is happening.
- **The link path fails on exactly one line**: `atlas-root-flow.ts:632` — `if (!apiPin && !opts.readOnly) throw new Error('PIN is required')`. Demo worlds have no PIN, so link demands one it can never have.
- **There is a worse bug hiding behind that one.** The link modal PREFILLS a saved PIN. With a PIN present, a demo key sails past line 632 and registers a fully **writable** world. Keel then 403s the first push and the user lands in the read-only error pill. So today link either refuses with a misleading message or silently creates a broken world. That second outcome is the real defect.
- **The write-blocking machinery is entirely shipped** — the view-only flag is mirrored in registry + `world.json` + the runtime store, with guards at four depths (8 store mutators behind `assertWritable`, `requestPush`/`pushOnce`/`syncNow` in the engine, the attach path, and arming order on activation). **Zero new write-blocking code needed.**
- **The server is a hard backstop**: keel resolves the `0000000000`–`0000000009` range to READ scope, so a demo key cannot write on any route regardless of what atlas does. Read-only is enforced twice over.

**The fix**: one predicate (`isDemoKey`) plus normalizing `const readOnly = !!opts.readOnly || isDemoKey(apiKey)` at the top of `linkExistingApiWorldInRoot`. Every downstream guard then fires correctly with no further edits, and the writable-world trap closes with it. Optional cosmetic: hide the PIN field when the typed key is demo-range.

**But the view path shows no client-side rejection at all**, which means the failure Captain saw is server-side or data-side. The most likely explanation, and it is not an atlas bug: **the Hyperion world may not exist on production under `0000000000`**. The tour's final step asserts it; nothing verifies it. **Before I write any code here, the cheap decisive step is Captain pasting `0000000000` into "View a world" and reading the literal error**: "API key or PIN invalid" means 401/403 (likely `public_read` not set on the production row, a Skeld question), "No world found for that API key" means the world is not there at all (a content task, and the tour copy is currently making a false claim). One probe collapses this.
// oops sorry;; ia rleady ahd the wrold.. that was the error on view;; it works !! but if you did find any bugs or oprtimzies, feel free to scope in!

## 3i. The calendar: canon gives us exactly enough, and no more

Researched against the novel text, not memory. Confirmed in-text, from a single passage of Father Duré's journal:

- **"By Hegemony Standard, it is October 12, 589 PC."** — `PC` is the real, printed, numbered calendar of the setting. What PC *stands for* is never spelled out in the books (the common "Present Calendar" gloss is fan conjecture), so we use the suffix and never gloss it.
- Hyperion the planet keeps a **local calendar of seven 40-day months**, the last named **Lycius**, and dates as **A.D.C.** — which the text itself expands as **"after dropship crash"**, a local colony epoch, not a Hegemony one.
- **No general month, week, or festival structure exists in the books.** That is a real negative finding.

**So**: a full atlas calendar (named months) would require inventing six month names. That crosses into invention, so I am not doing it. **Recommendation**: give the tour world a bare year count with the era label **PC**, which is canon-exact and still teaches the era/lens layer.

**One editorial choice worth your ruling**: Captain wants Rachmaninov created with a birth date "way back" so the axis gains a span. He is a real composer, born 1873 CE, while the Consul's story sits at ~589 PC, and the two calendars have no confirmable conversion (the PC epoch is fan-reconstructed, not stated). My proposal: keep one number line, give the world two era bands — **Old Earth** (a genuine in-text term) and **PC** — and document the epoch offset in `_bake_notes` as an editorial choice, exactly as the bundle already documents its other deviations. The user never sees a claim of canon, the era bands get taught, and the "time suddenly means something" beat lands hard. If you would rather not carry even that much invention, the fallback is bare years with no era bands.
// interesting point. yes def not invent stuff. but so..we ahve a two calendar system here. is this smtht he app actually supports? if not, that we SHOULD support ? same fora bove: if it's wroth building proper, then let's do that.. we can also port over SOME work to another session..

## 3j. What the charts and writing acts actually need (mapped, so bout 4 has no surprises)

**Charts — already scriptable**: the room route exists as a step directive · the "+ Element" control opens the SAME element-create modal the tour already locks (`lockAll` + `initialName` + `initialType` + `overrideCreate`) · that modal already has a charts-context mode with a required date field · every control carries a stable `data-action` hook so highlight/hide is pure CSS · the empty room draws a real axis and was designed for exactly this.

**Charts — needs new code** (six items, all small, none scary):
1. A tour seam on the "+ Element" click handler — it hardcodes its modal options with no override point.
2. A filter on the undated rail if we want it showing one named item instead of fifteen (no predicate seam today; hiding it entirely is free CSS).
3. The one-node/zero-span axis fix from 3c.
4. Drop `time_current` from the bundle world — it currently ships `15`, which is why the "set now time" button never appears. The user cannot set a now that is already set.
5. Trim the two pre-baked event dates (7 and 12) if the user is meant to date them.
6. Hide the canvas/document mode toggle during the drag beats: scroll mode has **no rail and no drag-to-date**, so a user who wanders into it finds the gestures we just taught them missing.

**Writing — the good news**: the room's setup screen ALREADY is Captain's "have them choose their tiers" idea. It offers four labels (defaults Book / Chapter / Scene / Draft) with detected-value suggestions. For the tour we simplify it to two tiers and let the user pick. That is a hide-fields job, not a new screen.

**Writing — needs new code**: a new hands-on kind for "link a word" (the union is currently create-world / create-consul / place-pin / setup-folder), plus bundle data shaped so the chapter arrives with **unlinked** words for the user to link live (today all nine chips are baked). Detection is a chip count, already available as a helper. Both linking gestures are real and teachable: `@` then Enter/Tab, or select text and right-click to link to an existing element.

---

## 4. Questions that actually change the work

1. **Silent mint vs prefilled modal** (3a) — my lean is silent + legible feedback.
2. **Pin block: hard X or soft correction?** (3b) — my lean is soft.
3. **Share detour**: if publishing is impossible for a local throwaway world, do you want the honest preview version, or cut the detour? (3e)
4. **Import detour**: cut, or optional-after-finale? (3f)
5. **The escape hatch** (3g): on exit, does the world stay or fold away? The residue contract currently says fold away, always.// just discard, i already clarified it in the world create hint bar anyway.
6. **Tour length target**: what is your ceiling in minutes? It changes how much of charts/writing survives. I would rather cut a room than rush all of them. // i would say: complte, concise, effective, but DO include core stuff. so it is ok if it alsts a while. the exit button was a good idea. ideally.. hey, is tis feasible; that, for people, we STORE their tour - whatevr they do, it is localstored; sesiostored, hatever works best; and then if they RESUME the tour, they can resume it.. and if theyve comptled it, canv revisit.. but NOT as wrold folder, just as 'tour state' .. is that feasible? 
7. **Numbering for our conversations**: confirm "4b" style works for you.
// not sure what this is 
---

## 5. Copy draft: step 0 (the activation)

Written against the voice file (colons doing the work, concrete before abstract, no marketing words, no em-dashes, no "not X but Y", trusts the reader).

**Variant A (my pick)**
> One sentence from *Hyperion*, a novel by Dan Simmons (1989).
> Read it once and decide what you would keep: which people, places, objects, and events are worth naming. Then we build them, one at a time, and you do the building.
dont love using people and palces wjhich is not ow lingo. but also dont want to preprime per se on ow. though. tricky. do we goa s far as: what things do you see, and what KINDS are these - people or characters, locations or places? a bit wordy, but introduces the concept. 
**Variant B (more direct address)**
> This is the first sentence of *Hyperion*, a novel by Dan Simmons (1989).
> Before anything gets made: look at it and count the things you would give a name to. A person, a ship, a swamp, a piece of music. Everything you spot is about to become part of a world.
//uuh OK , still long, dont like that alst sentence, drop that sorta tone tnirely pls, feels salesy, 'this is what you'll experience!!!'

**Variant C (shortest)**
> The first sentence of *Hyperion*, by Dan Simmons (1989).
> Read it, and decide what in it is worth naming. We will build every one of those together, starting with the world that holds them.
// not bad.. short and clear is good.

The cite carries the wiki link, as now.

---

## 6. How I would sequence the build

Honest scoping first: **this dump is not one bout.** It is roughly four sessions of real work. The sequencing below gets something coherent and green at every boundary, and puts the load-bearing kernel behind an adversarial gate before any content rides on it.

**Bout 1 — the small wins + the bugs** (no dependencies, ships immediately)
Landing page rework (both variants screenshotted) · glyph fade · sentence size constant · sentence width · underline-to-colour · meta line cut · widget create-buttons removed · tour tooltips · the shell-reserve occlusion fix · residue-contract cleanup + e2e lock · **the demo-key link fix** (the `isDemoKey` normalization, which also closes the writable-world trap) · the one-node axis centering fix from 3c, which stands on its own merit for any young world.

**Bout 2 — the engine reshape, GATED** (the enabling foundation)
Phases with derived predicates + advance gating · the scripted + door (silent mint) · branch support in the reveal/heal kernel · `TourWorldView` as a pure, unit-tested projection · the new step 0 and the sentence handoff into the dock.
*This gets a 3-lens adversarial gate on the CONTRACT before it is built* — it is a merge over user and system data with new gating semantics, which is exactly the class where my own tests encode my blind spots.

**Bout 3 — acts 1 and 2 restructured**
Combined institution+title step with the Consul page held in view · locations and the map BEFORE objects (so "sat" lights in sentence order) · zone revealed with the map · the pin beat · phase-B map explainer + the free saurian pack · the forced object run (spaceship, balcony, piano) with per-create text and the two council-motion "more information" panels.

**Bout 4 — writing and charts** (the two biggest new designs; may split)
Writing: the room explained, tiers chosen in a simplified UI, the prefilled sentence, three user-made links.
Charts: the empty room, the forced event, the event-or-narrative choice, the degenerate-then-spanning axis, the drag, the now-line, the saved chart.

**Bout 5 — detours + close** (only what survives the questions above)
Share preview or cut · import or cut · full copy pass over every phase body · e2e suite rewritten to the phase contract · close gate over the whole diff · commit + redeploy briefing.

**Standing through all of it**: every bout ends green (typecheck + vitest + the affected e2e), the full suite runs at bout boundaries, and I self-inspect with Playwright before calling any of it done.

// i suspect you overestime the nr of sessions. can do a lot in one or two. so, don't aim low. but def don't do it all this session. just whatever is most foundational, good to do with current context, etc; see what feels right. 

---

## 7. What I still owe this plan

Four investigations are running: demo-key view/link feasibility · Hyperion's in-universe calendar (bare year + era label if the books do not define months — no invention) · the charts room's scriptable surfaces · writing/share/import tour-mode seams. Their findings fold into sections 3e, 3f, and bout 4 before anything gets built.
