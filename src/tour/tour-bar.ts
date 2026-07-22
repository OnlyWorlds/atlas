/**
 * Tour bar — the guided tour's ONE narrator component, ONE position:
 * docked bottom-center from step 1 (the centered vignette opener was retired
 * 2026-07-19, Captain's round — the dock IS the narrator from the first
 * second; the bare stage above it fills in on Next). min-height 272px keeps
 * the dock a single exact shape across every step; step 1 carries its
 * eyebrow + book cite in the always-rendered meta channel at zero extra rows.
 *
 * Rows: the annotated sentence · hairline · body copy (+ meta subtext,
 * ✦ deeper flyout) · controls. Steps carry no titles (v2.1): the act label
 * orients, the divider separates material from narration.
 *
 * The sentence is the progress bar (Skeld's grammar): parsed words carry
 * their element-type color; every span's end word carries an inline glyph,
 * PRE-SPACED as a dim ghost and LIT (pop-in) when its step is reached — zero
 * reflow. Clicking a parsed word jumps to its step. The OPENER is the one
 * exception (S306): it renders the sentence bare, with no glyph slots at all,
 * so the first screen is undamaged text; the slots arrive with the dock.
 *
 * The ✦ deeper content opens as a scrollable FLYOUT above the panel — the
 * dock's height never changes (Captain's rule).
 *
 * The bar stamps <body class="atlas-tour-cap-*"> per unlocked capability —
 * atlas.css hides not-yet-earned app chrome (the progressive build-up).
 */

import { hasFolderMode } from '../core/capabilities';
import { confirmExitTour } from './tour-exit-modal';
import { ELEMENT_ICONS, ELEMENT_TYPE_COLORS } from '../core/constants';
import { getState, subscribe } from '../core/state';
import type { ElementType } from '../core/types';
import {
  capabilitiesUpTo,
  TOUR_CAPABILITIES, TOUR_CHAPTER_REF,
  TOUR_SENTENCE, TOUR_STEPS,
  type TourStep,
} from './tour-data';
import {
  backStep,
  currentStepIndex,
  enterStep, exitTour,
  handsOnRefFor,
  isTourActive,
  nextStep,
  onTourChange,
  refToIdSync,
  setupFolderFromTour,
  tourIsSettling,
  tourWorldExists,
  tourWorldIsActive,
} from './tour-engine';
import {
  buildTourWorldView, canAdvance, countPresent, hasAll, resolvePhase,
  type TourPhase, type TourWorldView,
} from './tour-view';

let root: HTMLElement | null = null;
let unsub: (() => void) | null = null;
let unsubState: (() => void) | null = null;
/**
 * The render memo (gate R3). MUST be cleared on mount and unmount, and a null
 * root MUST count as a miss: exit at step 1 memoizes a signature, and a later
 * replay enters step 0 BEFORE the bar mounts, so a surviving memo would match
 * itself and early-return against a dead root — leaving `atlas-touring` chrome
 * with no narrator, no Next and no Exit, recoverable only by reload.
 */
let lastSignature: string | null = null;
/**
 * The ✦ flyout's open state, keyed by step id (gate R11). Mid-step re-renders
 * are new in this bout: without this, a user reading "more information" on the
 * pin step loses it the instant they place the pin. Cleared on step change,
 * because a new step's flyout should open closed.
 */
let flyoutOpenFor: string | null = null;
let flyoutScrollTop = 0;

export function ensureTourBar(container: HTMLElement): void {
  if (isTourActive() && !root) mount(container);
  else if (!isTourActive() && root) unmount();
}

function mount(container: HTMLElement): void {
  root = document.createElement('div');
  root.className = 'atlas-tour-root';
  container.appendChild(root);
  document.body.classList.add('atlas-touring');
  lastSignature = null;
  unsub = onTourChange(() => {
    if (!isTourActive()) { unmount(); return; }
    // Settling covers this listener too: `writeTourState` emits at the TOP of
    // a step-enter, so an unguarded render here repainted the new step's copy,
    // stage and highlight classes before the reveal wrote anything and before
    // `routeFor` navigated. The authoritative paint is the emit that fires
    // once the step has fully landed.
    if (tourIsSettling()) return;
    render();
  });
  // Phases derive from the WORLD, so the panel has to hear the world change:
  // without this every gated beat would need its own notify call threaded
  // into an app write path (five couplings into rooms that should not know
  // the tour exists). Guarded so it never speaks about a foreign world or
  // repaints mid-step; the memo keeps the common case free.
  unsubState = subscribe(() => {
    // NOT guarded on `tourWorldIsActive()` (close gate, 3-lens convergent): a
    // world switch IS the suspension trigger, so bailing on it made the whole
    // suspension contract unreachable — `resolvePhase` returning phase A,
    // `canAdvance` returning false, and the signature's live/suspended term
    // were all written for a render that could never be invoked. The panel
    // instead froze on tour-world narration, kept pulsing the tour's highlight
    // on the user's OWN sidebar, and left a live Next that advanced the tour
    // past a beat whose writes all no-op. The view layer suspends correctly;
    // render just has to be allowed to run.
    if (!isTourActive() || tourIsSettling()) return;
    render();
  });
  render();
}

function unmount(): void {
  unsub?.();
  unsub = null;
  unsubState?.();
  unsubState = null;
  lastSignature = null;
  flyoutOpenFor = null;
  flyoutScrollTop = 0;
  root?.remove();
  root = null;
  document.body.classList.remove('atlas-touring', 'atlas-tour-prezone', 'atlas-tour-preweb',
    'atlas-tour-pinstep', 'atlas-tour-createstep', 'atlas-tour-nowstep');
  for (const cap of TOUR_CAPABILITIES) document.body.classList.remove(`atlas-tour-cap-${cap}`);
}

/** The tour's view of the world, for phase predicates. Pure read. */
function buildView(): TourWorldView {
  const state = getState();
  return buildTourWorldView({
    elements: state.data.elements,
    worldExists: tourWorldExists(),
    tourIsLive: tourWorldIsActive(),
    timeCurrent: state.active?.meta?.time_current ?? null,
    refToId: refToIdSync,
  });
}

/** Word index → {type, stepIndex} for every step at or before `upTo`. */
function fillMap(upTo: number): Map<number, { type: ElementType; step: number }> {
  const map = new Map<number, { type: ElementType; step: number }>();
  for (let i = 0; i <= Math.min(upTo, TOUR_STEPS.length - 1); i++) {
    for (const span of TOUR_STEPS[i].spans ?? []) {
      for (let w = span.from; w <= span.to; w++) {
        map.set(w, { type: span.type, step: i });
      }
    }
  }
  return map;
}

/** Word index → glyphs anchored after it (every span's END word), all steps. */
function glyphMap(): Map<number, Array<{ type: ElementType; step: number; ref?: string }>> {
  const map = new Map<number, Array<{ type: ElementType; step: number; ref?: string }>>();
  TOUR_STEPS.forEach((step, i) => {
    for (const span of step.spans ?? []) {
      const list = map.get(span.to) ?? [];
      list.push({ type: span.type, step: i, ref: span.ref });
      map.set(span.to, list);
    }
  });
  return map;
}

/**
 * Is this span's glyph lit? (gate R6.)
 *
 * A span WITHOUT a ref keeps the original step-keyed rule: lit once its step
 * is reached. A span WITH one lights on that element's EXISTENCE, which is
 * what makes a scripted create pop one glyph per mint instead of lighting the
 * whole set the moment the step opens. This one predicate replaced the two
 * hard-coded `handsOn` names that used to live here, so the consul, the pin
 * and every future create beat finally share a rule.
 */
function glyphLit(
  g: { step: number; ref?: string },
  idx: number,
  view: TourWorldView,
): boolean {
  if (g.step > idx) return false;
  if (!g.ref) return true;
  // Past steps stay lit: their element was minted, and a user who deletes it
  // gets it back on the next step-enter heal anyway.
  if (g.step < idx) return true;
  return view.hasRef(g.ref);
}

/**
 * Build the annotated sentence: serif italic words, type-colored fill for
 * parsed words, pre-spaced ghost glyphs lighting up as steps are reached.
 */
/**
 * The annotated sentence.
 *
 * `bare` (the OPENER, step 0) renders the sentence as PLAIN TEXT: no glyph
 * slots at all. The pre-spaced ghosts exist to keep the dock reflow-free while
 * the reader's eye is on it, which is worth it there — but on the opening
 * screen, where the sentence IS the whole composition, a row of dim marks and
 * the gaps holding them read as damage rather than as promise (Captain, S306).
 * The slots appear on the hand-off into the dock, where the layout is changing
 * completely anyway, so the one reflow hides inside a transition the user is
 * already watching.
 */
function buildSentence(idx: number, step: TourStep, view: TourWorldView, bare = false): HTMLElement {
  const fills = fillMap(idx);
  const glyphs = glyphMap();
  const activeWords = new Set<number>();
  for (const span of step.spans ?? []) {
    for (let w = span.from; w <= span.to; w++) activeWords.add(w);
  }

  const sentence = document.createElement('div');
  sentence.className = 'atlas-tour-sentence';
  TOUR_SENTENCE.forEach((word, w) => {
    const span = document.createElement('span');
    span.className = 'atlas-tour-word';
    span.textContent = word;
    const fill = fills.get(w);
    if (fill) {
      span.classList.add('parsed');
      span.style.setProperty('--tour-word-color', ELEMENT_TYPE_COLORS[fill.type] ?? '#22d3ee');
      span.title = `${fill.type} · jump to that step`;
      span.addEventListener('click', () => { void enterStep(fill.step); });
    }
    if (activeWords.has(w)) span.classList.add('active');
    sentence.appendChild(span);
    for (const g of bare ? [] : glyphs.get(w) ?? []) {
      // A ref-carrying glyph waits for the ELEMENT, not the step-enter — the
      // light is the payoff of the user's gesture (banked S297 nuance,
      // generalized to every scripted create in S301).
      const lit = glyphLit(g, idx, view);
      // UNLIT GLYPHS ARE NOT RENDERED AT ALL (Captain, S307).
      //
      // They used to be emitted at opacity 0.05 so their WIDTH was reserved
      // and lighting one caused zero reflow. S306c changed the decision —
      // the opener renders bare and the sentence SHIFTS as glyphs appear,
      // because the reflow hides inside the dock transition — but that round
      // only applied it to step 0. Every later step still carried the
      // reserved slots, which is what put visible gaps between the words for
      // the whole rest of the tour. Applying the decision the rest of the way.
      if (!lit) continue;
      const glyph = document.createElement('span');
      glyph.className = 'material-symbols-outlined atlas-tour-glyph lit';
      if (lit && g.step === idx) glyph.classList.add('pop');
      glyph.textContent = ELEMENT_ICONS[g.type] ?? 'circle';
      glyph.style.setProperty('--tour-glyph-color', ELEMENT_TYPE_COLORS[g.type] ?? '#22d3ee');
      glyph.title = g.type;
      if (lit) glyph.addEventListener('click', () => { void enterStep(g.step); });
      sentence.appendChild(glyph);
    }
    sentence.appendChild(document.createTextNode(' '));
  });
  return sentence;
}

/**
 * Everything the panel's DOM depends on, as one cheap string (gate R5).
 *
 * The per-ref progress terms are load-bearing, not decoration: minting #2 of 3
 * changes neither the step, the phase, nor `canAdvance`, so without them the
 * render would early-return and the middle click of a three-element run would
 * produce no feedback at all — killing the one-at-a-time pop the whole
 * scripted door exists for. Same for the lit-glyph state.
 */
function signatureFor(
  idx: number, step: TourStep, phase: TourPhase, advance: boolean, caps: Set<string>,
  view: TourWorldView, handsOnDone: boolean,
): string {
  const stage = TOUR_CAPABILITIES.filter(c => caps.has(c)).join('+');
  const glyphs = (step.spans ?? []).map(s => (s.ref ? (view.hasRef(s.ref) ? '1' : '0') : '-')).join('');
  const created = step.creates ? countPresent(step.creates, view) : 0;
  const gates = [
    step.handsOn === 'create-world' ? String(tourWorldExists()) : '',
    // `handsOnDone` drives the pin highlight AND whether Next renders, and it
    // used to be captured only by COINCIDENCE: the two hands-on beats happen
    // to duplicate their ref into a sentence span, so the `glyphs` term moved
    // with them. A hands-on beat whose word is not in the sentence would have
    // had a Next that never appeared (close gate, MED).
    handsOnRefFor(step) ? String(handsOnDone) : '',
    // The pin's soft correction: dragging the placed pin into the zone changes
    // neither step, phase-id (both b and c are already possible), nor
    // `handsOnDone` — so without this term the drag would not re-render and
    // Next would never appear. The drag's `patchSlice('data')` fires the
    // subscription; this makes the signature notice the crossing.
    step.placeInZone ? String(view.pinInZone(step.placeInZone.pinRef, step.placeInZone.zoneRef)) : '',
    // The now beat's deed is a world-meta write, not an element: no ref, no
    // glyph, no `creates` progress. Carried explicitly rather than left to ride
    // on the phase id, because relying on a term moving "by coincidence" is
    // exactly what left the hands-on gate uncovered before (close gate, S302).
    step.handsOn === 'set-now' ? String(view.nowIsSet) : '',
    // Same reasoning for the writing beat: each Tab-link changes only the
    // chapter's `story`, which moves no ref, no glyph and no `creates`
    // progress. Without this term the FIRST link would not repaint (no Next,
    // no phase b) and every later link would be invisible — the S302 memo bug
    // exactly. Carried as the count, so 1 -> 7 each repaint.
    step.handsOn === 'link-word' ? String(view.chipCount(TOUR_CHAPTER_REF)) : '',
    view.tourIsLive ? 'live' : 'suspended',
  ].join(',');
  return [idx, phase.id, advance, stage, glyphs, created, gates].join('|');
}

function render(): void {
  // A null root is ALWAYS a cache miss, never a signature comparison (R3).
  if (!root) { lastSignature = null; return; }
  const idx = currentStepIndex();
  const step = TOUR_STEPS[Math.min(idx, TOUR_STEPS.length - 1)];
  const caps = capabilitiesUpTo(idx);
  const view = buildView();
  const phase = resolvePhase(step.phases, view);
  // A `creates` run gates its own Next, whatever the phase says. Making each
  // phase author remember an `advanceWhen` would mean one forgotten line lets
  // the user skip the run the step exists for; the gate belongs to the step.
  const advance = canAdvance(phase, view)
    && (step.creates ? hasAll(step.creates)(view) : true);
  // Has this step's hands-on gesture been performed? One question, one source
  // (the engine's HANDS_ON_REFS) — the bar used to ask it twice with two
  // bespoke helpers.
  const handsOnRef = handsOnRefFor(step);
  const handsOnDone = handsOnRef ? view.hasRef(handsOnRef) : false;

  const signature = signatureFor(idx, step, phase, advance, caps, view, handsOnDone);
  if (signature === lastSignature) return;
  // A step change closes any open flyout: it belonged to the old step.
  if (lastSignature !== null && lastSignature.split('|')[0] !== String(idx)) {
    flyoutOpenFor = null;
    flyoutScrollTop = 0;
  }
  lastSignature = signature;
  // Restore focus after the rebuild (gate R14): an in-flight click on a
  // button the render replaces is otherwise silently dropped.
  const focusedAction = document.activeElement instanceof HTMLElement
    && root.contains(document.activeElement)
    ? document.activeElement.dataset.tourControl ?? null
    : null;
  for (const cap of TOUR_CAPABILITIES) {
    document.body.classList.toggle(`atlas-tour-cap-${cap}`, caps.has(cap));
  }
  // Step-scoped precision (S299): zone chrome waits for the swamps step, the
  // Web tab for yours-to-keep — an act-level marker can't distinguish steps
  // inside one act.
  //
  // S308: this read `'where-it-lives'`, a step id S306c MERGED into
  // `yours-to-keep`. findIndex returned -1, so `idx < -1` was false for every
  // step and `atlas-tour-preweb` never applied — the Web tab has been visible
  // from step 5 since S306c, while two copy decisions (withholding its name at
  // `linking`, introducing it here) are written on the premise it is hidden.
  // A renamed step id silently disables the gate that keys on it.
  const swampsIdx = TOUR_STEPS.findIndex(s => s.id === 'the-swamps');
  const webIdx = TOUR_STEPS.findIndex(s => s.id === 'yours-to-keep');
  document.body.classList.toggle('atlas-tour-prezone', idx < swampsIdx);
  document.body.classList.toggle('atlas-tour-preweb', idx < webIdx);
  // Highlight the REAL +pin button on the Consul during the pin beat (until
  // placed) — the "use the actual control, highlighted" flow (Captain S299).
  document.body.classList.toggle('atlas-tour-pinstep',
    step.handsOn === 'place-pin' && !handsOnDone);
  // Same flow for a scripted run: the copy says "the + above the element
  // list", and the sidebar's own pulse only fires on an EMPTY world (S255v3),
  // so by the objects step the button it points at carries no signal at all.
  // Found by looking at the beat, not by a test.
  document.body.classList.toggle('atlas-tour-createstep',
    !!step.creates && !hasAll(step.creates)(view) && view.tourIsLive);
  // Same flow again for the charts act's now beat: highlight the room's REAL
  // "set now time" button until the clock is set. The CSS also parks the
  // canvas/document toggle for the beat, to keep one control in play while the
  // copy names one control — NOT because the other view lacks the button (it
  // does not; the control bar is a sibling of the view mount).
  document.body.classList.toggle('atlas-tour-nowstep',
    step.handsOn === 'set-now' && !view.nowIsSet && view.tourIsLive);
  const opener = idx === 0;

  root.innerHTML = '';
  const panel = document.createElement('div');
  // The panel has TWO positions again (S303 rework): step 0 is the centre-stage
  // opener (`is-opener`) — the sentence at vignette scale on black, no shell
  // behind it — and it hands off into the docked narrator on "Begin". The dock
  // is one fixed shape for every step after. The first two DOCKED steps read
  // bright (`is-fresh`) before the parsing dims the sentence into a progress
  // surface.
  panel.className = 'atlas-tour-bar'
    + (opener ? ' is-opener' : '')
    + (idx === 1 || idx === 2 ? ' is-fresh' : '');
  // e2e locator contract: the visible act label is gone (Freek's round), the
  // step number rides a data attribute instead.
  panel.dataset.tourStep = String(idx + 1);

  panel.dataset.tourPhase = phase.id;

  panel.appendChild(buildSentence(idx, step, view, opener));

  // Row 2 — step copy, under a hairline (the material/narration divider).
  const copy = document.createElement('div');
  copy.className = 'atlas-tour-copy';
  const body = document.createElement('div');
  body.className = 'atlas-tour-body';
  body.textContent = phase.body;
  copy.appendChild(body);
  // The extras row (✦ deeper · inline links) ALWAYS renders — a step without
  // them shows an invisible placeholder at the same metrics, so the panel
  // keeps one shape whether or not a deeper widget exists (the constant-dock
  // law, extended to this row 2026-07-19: baseline-floating the bulb beside
  // the body let long bodies wrap it onto its own line on SOME steps only).
  const extras = document.createElement('div');
  extras.className = 'atlas-tour-extras';
  if (phase.deeper) {
    const bulb = document.createElement('button');
    bulb.type = 'button';
    bulb.className = 'atlas-tour-deeper-toggle';
    bulb.dataset.tourControl = 'deeper';
    bulb.innerHTML = '<span class="material-symbols-outlined">emoji_objects</span> more information';
    const deeper = document.createElement('div');
    deeper.className = 'atlas-tour-deeper';
    // Paragraph breaks (\n\n in the step data) render as real paragraphs —
    // a wall of text defeats the point of going deeper.
    for (const para of phase.deeper.split('\n\n')) {
      const p = document.createElement('p');
      p.textContent = para;
      deeper.appendChild(p);
    }
    // Open-state survives a mid-step re-render (gate R11): placing the pin
    // used to snatch away the paragraph the user was reading.
    deeper.hidden = flyoutOpenFor !== step.id;
    if (!deeper.hidden) {
      requestAnimationFrame(() => { deeper.scrollTop = flyoutScrollTop; });
    }
    deeper.addEventListener('scroll', () => { flyoutScrollTop = deeper.scrollTop; });
    bulb.addEventListener('click', () => {
      deeper.hidden = !deeper.hidden;
      flyoutOpenFor = deeper.hidden ? null : step.id;
      if (deeper.hidden) flyoutScrollTop = 0;
    });
    extras.appendChild(bulb);
    panel.appendChild(deeper); // flyout anchors to the PANEL, above it
  }
  // (The ecosystem-explorer link was CUT in S298, Freek's round. Captain's
  // Hyperion share-page link can join this extras row when it exists.)
  if (extras.childElementCount === 0) {
    const ghost = document.createElement('span');
    ghost.className = 'atlas-tour-extras-ghost';
    ghost.innerHTML = '<span class="material-symbols-outlined">emoji_objects</span> more information';
    extras.appendChild(ghost);
  }
  copy.appendChild(extras);
  // The meta row ALWAYS renders (nbsp when the step has none) — steps with
  // and without subtext keep the exact same panel shape. Step 1 uses the
  // channel for its framing: eyebrow left, the book cite right — the opener
  // carries them at ZERO extra rows, so the panel never reshapes on the
  // first Next (Captain's docked-from-start round, 2026-07-19).
  const meta = document.createElement('p');
  meta.className = 'atlas-tour-meta';
  if (opener) {
    meta.classList.add('atlas-tour-meta-opener');
    // The "One sentence, one world" eyebrow was cut S299 (Captain: "why still
    // this blue header, remove it"). The grey book cite under it went the same
    // way in S306 — the opener's own copy already names Hyperion and its year,
    // so the link was a second, quieter statement of the same fact.
    // NOTE: this was the ONLY render of TOUR_ATTRIBUTION / _URL, so those two
    // constants are now unreferenced by any surface (checked, not assumed —
    // the finale does not cite the book either). Left defined in tour-data as
    // the canonical cite if a surface wants it again; if nothing claims them by
    // the next sweep, delete them rather than let them rot as decoration.
    meta.textContent = ' ';
  } else {
    meta.textContent = phase.meta ?? ' ';
  }
  copy.appendChild(meta);
  panel.appendChild(copy);

  // Row 3 — controls.
  const controls = document.createElement('div');
  controls.className = 'atlas-tour-controls';

  // The opener (step 0): the sentence has no world yet, so the phase-`advance`
  // path can't render a forward control (`canAdvance` is false with no active
  // tour world — it reads as suspended). "Begin" is the explicit hand-off into
  // the dock. No counter, no Back — just Begin and the ever-present Exit.
  if (opener) {
    const begin = document.createElement('button');
    begin.type = 'button';
    begin.className = 'atlas-btn-primary';
    begin.dataset.tourControl = 'next';
    begin.textContent = 'Start';
    begin.addEventListener('click', () => { void nextStep(); });
    controls.appendChild(begin);
    appendExit(controls);
    panel.appendChild(controls);
    root!.appendChild(panel);
    restoreFocus(focusedAction);
    return;
  }

  // Step counter (re-added S299 as a working aid — the visible label was cut
  // in the Freek round; the sentence is still the user-facing progress, this
  // is a quiet dev/collab reference. Takes the spacer's flex role so the
  // controls layout is unchanged). data-tour-step remains the test contract.
  const counter = document.createElement('span');
  counter.className = 'atlas-tour-spacer atlas-tour-stepcount';
  counter.textContent = `Step ${idx + 1} of ${TOUR_STEPS.length}`;
  controls.appendChild(counter);

  if (idx > 0) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'atlas-btn-ghost';
    back.dataset.tourControl = 'back';
    back.textContent = 'Back';
    back.addEventListener('click', () => { void backStep(); });
    controls.appendChild(back);
  }

  // The forward gate, in ONE place now. A hands-on beat is single-route: no
  // dock button, because the app's own control is the route (the worlds
  // sidebar's create icon, the elements +, the Consul's real +pin button,
  // each highlighted by the tour). Next appears only once the deed is done —
  // which is either the hands-on ref existing or, for a phased step, the
  // phase's own `advanceWhen`.
  // The pin beat's soft correction: placing the pin is not enough — it has to
  // sit over the zone (Captain's ruling). `handsOnDone` (pin exists) still
  // drives the +pin highlight release; this only gates whether Next appears,
  // so a wrong drop shows the correction phase with no Next until it is
  // dragged onto the swamps.
  const pinInZoneOk = step.placeInZone
    ? view.pinInZone(step.placeInZone.pinRef, step.placeInZone.zoneRef)
    : true;
  const handsOnGate = step.handsOn && step.handsOn !== 'setup-folder'
    ? (step.handsOn === 'create-world' ? tourWorldExists()
      : step.handsOn === 'place-pin' ? (handsOnDone && pinInZoneOk)
      // The now beat has no bundle element of its own: the deed is a world-meta
      // write, so it reads the clock rather than `handsOnDone` (which would be
      // permanently false here and leave the step with no forward control at
      // all — the default branch below is a trap for any refless hands-on kind).
      : step.handsOn === 'set-now' ? view.nowIsSet
      // Same shape as set-now: the writing beat's deed is a chip inside an
      // existing narrative, not a new element, so `handsOnDone` would be
      // permanently false. ONE chip opens Next — the user is never stuck at a
      // partly-linked sentence, and phases b/c narrate the rest.
      : step.handsOn === 'link-word' ? view.chipCount(TOUR_CHAPTER_REF) >= 1
      : handsOnDone)
    : true;
  if (step.handsOn && step.handsOn !== 'setup-folder' && !handsOnGate) {
    // No forward control: the gesture is the way.
  } else if (step.handsOn === 'setup-folder') {
    // The finale: Finish (ghost) ends the tour — the world folds away
    // (residue contract); the primary hands over to the real folder setup.
    // OPFS-only browsers (Safari/Firefox tour mode) have no folder picker:
    // Finish is the primary there.
    const folderMode = hasFolderMode();
    const finish = document.createElement('button');
    finish.type = 'button';
    finish.className = folderMode ? 'atlas-btn-ghost' : 'atlas-btn-primary';
    finish.title = 'End the tour (the tour world folds away)';
    finish.textContent = 'Finish';
    finish.addEventListener('click', () => { void exitTour(); });
    controls.appendChild(finish);

    if (folderMode) {
      const setup = document.createElement('button');
      setup.type = 'button';
      setup.className = 'atlas-btn-primary';
      setup.textContent = 'Set up a folder';
      setup.addEventListener('click', () => {
        setup.disabled = true;
        void setupFolderFromTour().finally(() => { setup.disabled = false; });
      });
      controls.appendChild(setup);
    }
    panel.appendChild(controls);
    root!.appendChild(panel);
    restoreFocus(focusedAction);
    return;
  } else if (advance) {
    // `advance` is the phase's own gate (absent `advanceWhen` = always true),
    // so a phased beat withholds Next until its deed is done without needing
    // a hands-on kind of its own.
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'atlas-btn-primary';
    next.dataset.tourControl = 'next';
    next.textContent = 'Next';
    next.addEventListener('click', () => { void nextStep(); });
    controls.appendChild(next);
  }

  appendExit(controls);
  panel.appendChild(controls);
  root!.appendChild(panel);
  restoreFocus(focusedAction);
}

/**
 * Put focus back on the control the user was on (gate R14). Without it, a
 * state tick that lands between mousedown and mouseup rebuilds the button
 * under the pointer and the click is silently dropped.
 */
function restoreFocus(control: string | null): void {
  if (!control || !root) return;
  const target = root.querySelector<HTMLElement>(`[data-tour-control="${control}"]`);
  target?.focus({ preventScroll: true });
}

function appendExit(controls: HTMLElement): void {
  const exit = document.createElement('button');
  exit.type = 'button';
  exit.className = 'atlas-btn-ghost atlas-tour-exit';
  exit.title = 'Leave the tour (the tour world folds away)';
  exit.textContent = 'Exit tour';
  // Exit goes through the confirm (Captain, S301): every beat is gated on a
  // gesture, so leaving early is a legitimate move that deserves a real door —
  // and the door doubles as a map of the rooms the tour never reached. The
  // finale's Finish deliberately does NOT route through here.
  exit.addEventListener('click', () => {
    confirmExitTour(currentStepIndex(), () => { void exitTour(); });
  });
  controls.appendChild(exit);
}

// (The watch-mode Next beside a hands-on primary was REMOVED 2026-07-19,
// Captain's call: two forward buttons at the first hands-on beats read as a
// fork. The create dialogs are locked one-click affairs — the gesture IS the
// route. Watch-mode Next survives everywhere else via the plain else-branch;
// after the Consul exists the consul step shows plain Next to move on.)
