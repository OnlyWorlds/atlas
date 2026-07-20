# The tour phase system — contract for the adversarial gate

**Written**: 2026-07-20 (S301) · **Status**: CONTRACT, pre-build. Gate this before a line ships.
**Why gated**: this is a merge over user-driven and system-driven world state with new gating semantics, sitting under every future tour step. My own tests would encode my own blind spots here.

---

## 1. What changes and why

Today a `TourStep` carries one `body`/`meta`/`deeper` and is advanced by a plain Next. Captain's rework needs steps whose narration CHANGES as the user acts ("click + to add the Hegemony" → "there it is, and it links back to him"), and whose Next appears only once the deed is done.

**The rule: a phase is DERIVED from world state, never stored.** A stored phase index is a second source of truth that can disagree with the world after a reload, a back-nav, or a user deleting the element. The tour already heals the world on step-enter; derived phases compose with that for free.

## 2. The shape

```ts
interface TourPhase {
  /** 'a' | 'b' | 'c' — stamped as data-tour-phase; our shorthand ("4b"). */
  id: string;
  body: string;
  meta?: string;
  deeper?: string;
  /** Applies when true. Phases are declared in order; the LAST match wins. */
  when?: (w: TourWorldView) => boolean;
  /** Next renders only when true. Absent = always advanceable. */
  advanceWhen?: (w: TourWorldView) => boolean;
}

interface TourStep {
  id: string;
  act: number;
  phases: TourPhase[];        // replaces body/meta/deeper (min length 1)
  spans?: TourSpan[];
  reveal?: string[];          // system-revealed on step ENTER (unchanged)
  creates?: string[];         // ordered refs the USER mints via the + door
  route?: ...;                // unchanged
  webTab?: boolean;
  handsOn?: 'create-world' | 'create-consul' | 'place-pin' | 'setup-folder';
}
```

**Migration**: every existing step becomes `phases: [{ id: 'a', body, meta, deeper }]`. No behaviour change intended for shipped steps — the gate should check that claim.

## 3. TourWorldView — the pure projection

```ts
interface TourWorldView {
  worldExists: boolean;
  hasRef(ref: string): boolean;      // "institution:The Hegemony"
  countOfType(type: ElementType): number;
  pinPlaced: boolean;
  nowIsSet: boolean;                 // active.meta.time_current != null
}
```

Built by `buildTourWorldView(state, bundleIndex)` — a pure function of `{data.elements, active.meta, registry}` plus a synchronous bundle index. Unit-tested without a browser.

**The bundle-load window (known risk, want the gate's view)**: `hasRef` needs bundle ref→id resolution, and the bundle loads via dynamic `import()`. A module-level `bundleIndex` is populated on first load; **before it lands every `hasRef` reads false**, so a step could paint phase A for a frame before flipping to B on resume/reload. Planned mitigation: the bar re-renders when the bundle lands (revealUpTo ticks state), and phase A copy is written so a brief flash is not misleading. The gate should say whether this is acceptable or needs a "phases suspended until loaded" state.

## 4. The re-render model (the plumbing change)

`tour-bar` today re-renders ONLY on the tour's own `onTourChange` emit, which is why the shipped pin beat needed a bespoke `notifyTourPinPlaced()` wired into the map click path. Keeping that pattern would need a new notify for every gated beat (create-in-charts, date, drag, set-now, link-three-words) — five couplings into rooms that should not know the tour exists.

**Change**: `tour-bar` subscribes to core state as well.

To avoid re-rendering the panel on every unrelated state change (a keystroke in the prose editor ticks state), render computes a cheap **signature** and returns early when unchanged:

```
signature = `${stepIdx}|${phaseId}|${canAdvance}|${stageNum}|${handsOnGateBools}`
```

Invariants I am claiming, all of which the gate should try to break:
- `render()` never writes state (no patchSlice inside render), so no subscribe→render→patch→subscribe loop.
- The signature captures everything the panel's DOM depends on.
- The existing `patchSlice('ui', ...)` force-tick in `enterStepNow` becomes redundant but stays (harmless); removing it is out of scope.
- `notifyTourPinPlaced()` becomes redundant and is REMOVED in this bout.

## 5. The scripted create door (`creates`)

Captain's ruling: after the Consul, no more modals. The user clicks the app's real `+` and the next scripted element appears, one at a time, with a visual pop; only the final one enables Next.

- A step declares `creates: ['object:Ebony Spaceship', 'object:Spaceship Balcony', "object:The Consul's Steinway"]`.
- While the tour is on that step, the elements-sidebar `+` mints the **next un-minted ref in list order** instead of opening the create modal.
- `advanceWhen` = every ref in `creates` exists.
- Generalizes the shipped `HANDS_ON_REFS` mechanism: those refs must NOT auto-reveal on their own step, and MUST backfill once the tour moves strictly past (so back-nav, resume and watch-mode all stay consistent). `idsUpTo` grows to treat `creates` exactly as it treats hands-on refs today.

**Invariant claimed**: phases never reveal anything. Reveals stay keyed to the step index; phases are presentation + gating only. Content timeline stays step-keyed so `idsUpTo` and back-nav remain simple.

## 6. What the gate should hunt

Beyond finding its own angles:

1. **Dead ends.** Any world state where `advanceWhen` can never become true and the user is stuck with only Exit. Consider: user deletes a `creates` element after minting it; user deletes the Consul mid-objects-step; heal re-creates system elements but NOT user-minted ones — is that true, and does it strand anyone?
2. **Phase oscillation.** A `when` predicate whose truth flips back and forth as heal writes land mid-step-enter (heal fires several writes; each refreshes the elements slice; each triggers a subscriber render).
3. **The signature's completeness.** Name any panel-visible thing not captured by it.
4. **Re-render storms.** The heal loop patches `data.elements` per write. With the bar subscribed, how many renders does one step-enter cause, and does any of them run mid-teardown (store closing, `active` null)?
5. **Back-nav truth.** Stepping back into a step whose `creates` are all done: correct phase, correct Next, no re-mint. Stepping back BEFORE a create step: are those elements stripped, kept, or re-revealed, and is that coherent?
6. **The `+` door hijack.** While a `creates` step is active, the sidebar `+` no longer opens the modal. What happens if the user is NOT on the tour world (they switched worlds), or the tour is paused, or the step's creates are already complete? The door must fall back to normal behaviour, and the gate should check the guard covers every path.
7. **Migration fidelity**: single-phase steps behave exactly as today, including the hands-on branches, the finale's early return, and the glyph-lights-on-create nuance.
8. **The e2e contract**: `data-tour-step` is the existing test contract; adding `data-tour-phase` must not break the 8 shipped tour specs.

## 7. AMENDMENTS — the gate's findings, folded (this section SUPERSEDES the prose above)

3 opus lenses, ~292K, 21 findings: 3 BLOCKER · 8 HIGH · 8 MED · 2 LOW, plus ~15 upheld-with-evidence. **Two lenses converged independently on R1**, which is the fix-first signal. Build to THIS section where it disagrees with §1-6.

### R1 (BLOCKER ×2, convergent) — `creates` must join the revealed set the moment they exist
My §5 said a step's `creates` behave like `HANDS_ON_REFS`: excluded from `revealed` until the tour is strictly past. Both lenses showed that breaks the feature it exists for. The objects step teaches "the balcony's parent object is the spaceship" — but the balcony is minted while the ship is unrevealed, so `stripUnrevealed` deletes `parent_object`, and `healLinks` skips both (it `continue`s on unrevealed ids). The user reads the teaching sentence on a page with an empty Parent object, and the phase-B copy ("there it is, and it links back to him") is a lie until they press Next.

**Amendment**: `revealed` for the CURRENT step = `idsUpTo(step) ∪ {this step's creates whose bundle id is on disk}`. One definition, used identically by strip, heal and back-nav. After each mint, re-run `healLinks` with that augmented set so already-revealed subjects (the Consul's Possessions) backfill immediately.

**Consequence I accept consciously**: `idsUpTo` stops being a pure function of the step index — it becomes a function of (step index, what is on disk). That contradicts §5's "content timeline stays step-keyed". The contradiction resolves in favour of the world, which is the same philosophy as derived phases: state is truth, indices are hints.

### R2 (HIGH + MED) — back-nav must never strip a link whose target still exists
Re-entering a completed `creates` step (or clicking a coloured word to jump back) currently runs a DESTRUCTIVE heal: `mergeHealArray` removes ids that are no longer "revealed", so the Consul's Possessions chips the user just watched appear are deleted, and every back/forward across that boundary rewrites the file.

**Amendment**: the strip rule becomes **"never strip a link whose target is present on disk"**. A link to a present element is not dangling, which was the only reason stripping existed. Back-nav becomes non-destructive by construction and the reveal story is growing-only. R1's augmented set falls out of this rule for free.

### R3 (BLOCKER) — the render memo must not survive unmount
The signature is module-level; mount/unmount recreate `root` but never reset it. Exit at step 1 memoizes `0|a|false|1`; a later replay enters step 0 BEFORE the bar mounts, so the first render matches the stale signature and early-returns against an empty `root`. The user gets `atlas-touring` chrome with **no narrator, no Next, no Exit** — recoverable only by reload. No shipped spec covers relaunch-after-exit, so this would have gone out green.

**Amendment**: reset the memo in both `mount()` and `unmount()`, and treat `root === null` as an automatic cache miss. E2e: exit at step 1 → replay → assert the bar has controls.

### R4 (HIGH ×2, convergent) — phase resolution needs a tour-is-live gate
Nothing in §3 asks whether the tour's world is the ACTIVE one. After a mid-tour world switch (a returning user replaying from settings has a clickable world list), the view derives from the user's OWN world: every `hasRef` goes false so the dock collapses to phase A and tells them to create the Hegemony while they look at their own novel — and a `countOfType` predicate can resolve TRUE against foreign data, claiming a deed they never did. The same class fires during teardown: 4-6 notifies land while the flag is still set, so the panel visibly rewinds to phase A before unmounting.

**Amendment**: add `tourIsLive` (= `tourWorldIsActive()`) to `TourWorldView`. Phase resolution SUSPENDS when false: hold the current copy, force `canAdvance` false, and say "switch back to Hyperion to continue". Guard the state-subscription render on `isTourActive() && tourWorldIsActive()`, make the view builder null-safe on `active`, and set a `tearingDown` flag at the top of `exitTourNow` that suppresses renders until unmount.

### R5 + R6 (HIGH ×2) — the signature must see per-ref progress, and glyphs need refs
The proposed signature captures step/phase/canAdvance/stage. Minting #2 of 3 changes none of them, so render early-returns and the middle click produces **no feedback at all** — killing the one-at-a-time pop that is the whole point of the door. And the glyph-lights-on-create nuance cannot survive the migration: `TourSpan` has no ref, so either all three glyphs light on step-enter (declaring the objects done before a single click) or they light in span order, which is not mint order.

**Amendment**: add optional `ref?: string` to `TourSpan`. A glyph lights when `ref` is absent (today's step-keyed rule) or when `hasRef(span.ref)` is true. The two hard-coded `handsOn` names in `buildSentence` collapse into that one predicate, so consul, pin and creates beats finally share a rule. The signature's honest term is the joined lit-state of every glyph the step owns.

### R7 (HIGH) — a step may not `route` to an element it also `creates`
Otherwise the step opens on the app's raw "Element … not found in this world" error card with the dock underneath saying "click + to add it". **Amendment**: a unit test asserts no step routes to a ref in its own `creates`; `routeFor` additionally skips navigation when the resolved element is absent and lets the mint path route (as `createConsul` already does).

### R8 + R9 (HIGH + MED) — the `+` door needs a full guard and a serialized mint
World-blind today: its only proposed guard is a localStorage flag, so on the user's own world it hijacks, calls `revealOne`, hits the internal `tourWorldIsActive()` guard, and returns false — a **silently dead + button** with no modal and no toast. And two fast clicks both compute "next un-minted ref" against the same snapshot and mint the same element twice, so the third ref never lands and Next never appears.

**Amendment**: the door fires only when ALL hold — `isTourActive()` ∧ `tourWorldIsActive()` ∧ the step has `creates` ∧ they are not all present ∧ the bundle index resolved. Any miss falls through to the NORMAL create modal, never a no-op. Mints serialize through a promise chain with the next-ref computed INSIDE the chain (the `enqueueStep` idiom, for the same reason).

### R10 (MED) — phase selection is PREFIX, not last-match
"Last match wins" picks a contradictory phase when predicates overlap and the user deletes something (phase C's "all three are here" copy shows while the ship is gone). **Amendment**: the winning phase is the last one whose `when` holds AND all earlier phases' `when` also hold. That matches how an author writes them top-to-bottom.

### R11 (HIGH + MED) — the deeper flyout must survive a phase re-render
Mid-step re-renders are new in this bout; today the bar only re-renders on step change, where wiping the flyout is correct. Now a user reading "more information" on the pin step loses it the instant they place the pin. **Amendment**: hoist flyout open-state into a module variable keyed by step id, restore after render, clear on step change. Its scroll position is panel-visible too.

### R12 (MED) — my "the force-tick becomes redundant" claim was FALSE
On a step that reveals nothing and heals nothing (`the-chart`, or a re-entered `linking`), `revealUpTo` makes zero state writes and `routeFor` only navigates — so `patchSlice('ui')` at `enterStepNow` is the ONLY guaranteed re-render. **Amendment**: §4 is wrong; the tick is load-bearing. Comment it as such at the call site so a future keeper does not delete it on my say-so.

### R13 + R14 (MED ×2) — step-enter ordering and focus
The panel repaints the NEW step's copy while the old step's reveal is still writing and before `routeFor` navigates, so narration and surface desynchronize for the length of the slowest reveal (14 elements on the swamps step). **Amendment**: an `enteringStep` module flag suppresses state-driven renders for the duration of `enterStepNow`; the existing single emit at the end stays the authoritative post-step paint. Separately, preserve focus across renders by capturing a stable data-attribute of the focused control and restoring it, or an in-flight click on a rebuilt button is silently dropped.

### R15 + R16 (MED + LOW) — cover the finale BEFORE migrating, and a vacuous assertion
The finale's early return (Finish + folder button, no Exit) had zero coverage, so a migration could add a duplicate Exit beside Finish and stay green. And the OPFS spec asserted `hasText: 'Set up your folder'` — **a string the app has never rendered**, so it passed vacuously and would not have caught a picker button appearing on a browser with no picker. **Both fixed already, before any migration work**: the full walk now asserts the finale's control set positively, the OPFS spec uses the real label, and the two together make the string self-verifying.

### Upheld (do not re-verify)
`render()` never writes state, so subscribing cannot loop · removing `notifyTourPinPlaced()` is safe · the heal loop does not cause a render storm · deleting a revealed element does not strand the user (heal re-creates it) · the heal merge preserves user link additions and cannot churn · a user cannot jump forward past an ungated step into an unexplainable state · the `+` door cannot fire after the tour ends in a single tab.

---

## 8. Files

`src/tour/tour-data.ts` (shape + migration) · `src/tour/tour-engine.ts` (`idsUpTo`, creates backfill, view builder, notify removal) · `src/tour/tour-view.ts` (NEW — the pure projection + predicates) · `src/tour/tour-bar.ts` (phase resolution, signature, subscribe) · `src/sidebar/elements-sidebar.ts` (the `+` door hijack) · `tests/unit/tour-view.test.ts` (NEW) · `tests/e2e/tour.spec.ts`.
