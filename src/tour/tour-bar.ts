/**
 * Tour bar — the guided tour's ONE narrator component, ONE position:
 * docked bottom-center from step 1 (the centered vignette opener was retired
 * 2026-07-19, Titus's round — the dock IS the narrator from the first
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
 * exception: it renders the sentence bare, with no glyph slots at all,
 * so the first screen is undamaged text; the slots arrive with the dock.
 *
 * The ✦ deeper content opens as a scrollable FLYOUT above the panel — the
 * dock's height never changes (Titus's rule).
 *
 * The bar stamps <body class="atlas-tour-cap-*"> per unlocked capability —
 * atlas.css hides not-yet-earned app chrome (the progressive build-up).
 */

import { hasFolderMode } from '../core/capabilities';
import { showProblem } from '../ui/problem-fixes';
import { requestPersistOnFirstBrowserWorld } from '../setup/world-parent';
import { confirmExitTour } from './tour-exit-modal';
import { showTourPane, tourPaneFor } from './tour-pane';
import { ELEMENT_ICONS, ELEMENT_TYPE_COLORS } from '../core/constants';
import { typeName } from '../core/type-words';
import { getState, subscribe } from '../core/state';
import type { ElementType } from '../core/types';
import {
  capabilitiesUpTo, finaleMeta, previewRefsFor,
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
  keepTourWorld,
  readTourState,
  refToIdSync,
  tourIsSettling,
  tourWorldIsLegacy,
  tourWorldExists,
  tourWorldIsActive,
} from './tour-engine';
import {
  buildTourWorldView, canAdvance, countPresent, hasAll, phaseCopy, resolvePhase,
  type TourPhase, type TourWorldView,
} from './tour-view';
import { isCoarsePointer } from '../core/pointer';

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
/**
 * The dock's collapsed state (Titus): the − control top-right hides
 * the panel to a small floating + pill so the app underneath is fully
 * visible; + brings it back. Pure CSS via a body class — the click handlers
 * toggle directly (no re-render needed), and render re-applies from this
 * flag so a mid-collapse state tick cannot silently expand the dock.
 */
let dockCollapsed = false;

function setDockCollapsed(v: boolean): void {
  dockCollapsed = v;
  document.body.classList.toggle('atlas-tour-collapsed', v);
}

/** The Web pane's sticky unlock — true once the writing beat has been
 *  reached this run; back-navigation keeps the pane. Reset on unmount. */
let webSeen = false;

/** The narrow-window pane last shown for a step; applied only when it changes. Reset on unmount. */
let lastPaneKey: string | null = null;

export function ensureTourBar(container: HTMLElement): void {
  if (isTourActive() && !root) mount(container);
  else if (!isTourActive() && root) unmount();
}

/**
 * Escape closes an open "more information" flyout (it once ignored Escape
 * and sat over the page through later actions). Bound for the life of the
 * bar, but it only acts when a flyout is actually open, and it stands aside
 * whenever something else owns Escape: an open modal (its own handler closes
 * it), or focus in an editable field (field editors cancel on Escape). The
 * narrow shape the opener-Escape note below asks for.
 *
 * Window CAPTURE, and the key stops here when it closed a flyout: the open
 * flyout is the topmost thing, and the global "deselect to home" hotkey
 * otherwise took the same Escape first (it prevents the default, so this
 * handler stood aside and the step's element was deselected instead).
 */
let deeperEscapeHandler: ((e: KeyboardEvent) => void) | null = null;

function closeDeeperFlyout(): boolean {
  const open = root?.querySelector<HTMLElement>('.atlas-tour-deeper:not([hidden])');
  if (!open) return false;
  open.hidden = true;
  flyoutOpenFor = null;
  flyoutScrollTop = 0;
  return true;
}

function bindDeeperEscape(): void {
  if (deeperEscapeHandler) return;
  deeperEscapeHandler = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.querySelector('.atlas-modal-overlay')) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (closeDeeperFlyout()) { e.preventDefault(); e.stopPropagation(); }
  };
  window.addEventListener('keydown', deeperEscapeHandler, true);
}

function unbindDeeperEscape(): void {
  if (!deeperEscapeHandler) return;
  window.removeEventListener('keydown', deeperEscapeHandler, true);
  deeperEscapeHandler = null;
}

function mount(container: HTMLElement): void {
  root = document.createElement('div');
  root.className = 'atlas-tour-root';
  container.appendChild(root);
  document.body.classList.add('atlas-touring');
  lastSignature = null;
  bindDeeperEscape();
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
  unbindDeeperEscape();
  root?.remove();
  root = null;
  dockCollapsed = false;
  webSeen = false;
  lastPaneKey = null;
  document.body.classList.remove('atlas-touring', 'atlas-tour-prezone', 'atlas-tour-preweb',
    'atlas-tour-pinstep', 'atlas-tour-createstep', 'atlas-tour-nowstep', 'atlas-tour-finalstep',
    'atlas-tour-collapsed', 'atlas-tour-basefull');
  for (const cap of TOUR_CAPABILITIES) document.body.classList.remove(`atlas-tour-cap-${cap}`);
  document.getElementById(FIELD_HL_STYLE_ID)?.remove();
}

/** The tour world's name, for the finale's button titles. */
function tourWorldName(): string {
  const id = readTourState()?.worldId;
  return getState().registry.worlds.find(w => w.id === id)?.name || 'Hyperion';
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
 * the gaps holding them read as damage rather than as promise (Titus).
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
      span.title = `${typeName(fill.type)} · jump to that step`;
      span.addEventListener('click', () => { void enterStep(fill.step); });
    }
    if (activeWords.has(w)) span.classList.add('active');
    sentence.appendChild(span);
    for (const g of bare ? [] : glyphs.get(w) ?? []) {
      // A ref-carrying glyph waits for the ELEMENT, not the step-enter — the
      // light is the payoff of the user's gesture (a nuance first
      // found on one create, generalized to every scripted create).
      const lit = glyphLit(g, idx, view);
      // UNLIT GLYPHS ARE NOT RENDERED AT ALL (Titus).
      //
      // They used to be emitted at opacity 0.05 so their WIDTH was reserved
      // and lighting one caused zero reflow. A later round changed the decision —
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
      glyph.title = typeName(g.type);
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
    // exactly what left the hands-on gate uncovered before (close gate).
    step.handsOn === 'set-now' ? String(view.nowIsSet) : '',
    // Same reasoning for the writing beat: each Tab-link changes only the
    // chapter's `story`, which moves no ref, no glyph and no `creates`
    // progress. Without this term the FIRST link would not repaint (no Next,
    // no phase b) and every later link would be invisible — a memo bug
    // seen once already. Carried as the count, so 1 -> 7 each repaint.
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
  // Step-scoped precision: zone chrome waits for the swamps step, the
  // Web tab for yours-to-keep — an act-level marker can't distinguish steps
  // inside one act.
  //
  // This used to read `'where-it-lives'`, a step id since MERGED into
  // `yours-to-keep`. findIndex returned -1, so `idx < -1` was false for every
  // step and `atlas-tour-preweb` never applied — the Web tab has been visible
  // from step 5 since that merge, while two copy decisions (withholding its name at
  // `linking`, introducing it here) are written on the premise it is hidden.
  // A renamed step id silently disables the gate that keys on it.
  // Zone chrome arrives WITH the map (Titus: "add zone drawing right
  // away — might as well let people try it"): the prezone boundary moved from
  // the-swamps to the-map. Draw buttons show as soon as a map exists.
  const mapIdx = TOUR_STEPS.findIndex(s => s.id === 'the-map');
  // The Web tab arrives WITH the writing room (Titus) and then STAYS
  // for the rest of the run — including back-navigation, which is why the
  // boundary is STICKY (a bare idx comparison would re-hide the pane the
  // moment the user steps back before the writing beat). Reset on unmount.
  const webIdx = TOUR_STEPS.findIndex(s => s.id === 'the-writing');
  if (idx >= webIdx) webSeen = true;
  document.body.classList.toggle('atlas-tour-prezone', idx < mapIdx);
  document.body.classList.toggle('atlas-tour-preweb', idx < webIdx && !webSeen);
  // Highlight the REAL +pin button on the Consul during the pin beat (until
  // placed) — the "use the actual control, highlighted" flow (Titus).
  document.body.classList.toggle('atlas-tour-pinstep',
    step.handsOn === 'place-pin' && !handsOnDone);
  // Same flow for a scripted run: the copy says "the + above the element
  // list", and the sidebar's own pulse only fires on an EMPTY world,
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
  // The finale un-hides the sidebar footer: its copy names the help icon that
  // lives there, and copy naming a control is a behavioural claim.
  document.body.classList.toggle('atlas-tour-finalstep', idx === TOUR_STEPS.length - 1);
  // Base shows its FULL field set only on the consul step — the copy
  // there teaches the shared base fields; element-detail reads this class.
  document.body.classList.toggle('atlas-tour-basefull', step.id === 'the-consul');
  // Field rows the step narrates glow subtly (Titus) — injected as a
  // style tag so detail re-renders can never wipe the highlight.
  applyFieldHighlights(step);
  // A narrow window shows the pane the step points at: its drawers
  // start closed, so step 1's icon and the map beats were out of reach.
  const pane = tourPaneFor(step, handsOnDone, step.creates ? hasAll(step.creates)(view) : true);
  const paneKey = `${idx}|${pane}`;
  if (paneKey !== lastPaneKey) {
    lastPaneKey = paneKey;
    showTourPane(pane);
  }
  // Re-assert the collapse state (the handlers toggle it directly; render
  // must agree with the flag after any state tick).
  document.body.classList.toggle('atlas-tour-collapsed', dockCollapsed);
  const opener = idx === 0;

  root.innerHTML = '';
  const panel = document.createElement('div');
  // The panel has TWO positions again: step 0 is the centre-stage
  // opener (`is-opener`) — the sentence at vignette scale on black, no shell
  // behind it — and it hands off into the docked narrator on "Begin". The dock
  // is one fixed shape for every step after. Only the FIRST docked step (step 2,
  // idx 1) reads bright (`is-fresh`); from step 3 on the sentence dims into the
  // progress surface (Titus — the grey used to start a step too late).
  panel.className = 'atlas-tour-bar'
    + (opener ? ' is-opener' : '')
    + (idx === 1 ? ' is-fresh' : '');
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
  const words = phaseCopy(phase, isCoarsePointer());
  renderBodyText(body, words.body);
  copy.appendChild(body);
  panel.appendChild(copy);
  // THE FOOT SLOT: "more information" and the meta line live at the
  // far BOTTOM-LEFT of the dock — inside the controls row, in the flex slot
  // the step counter used to hold (the counter is gone, Titus's cut; the
  // e2e contract stays on data-tour-step). Bulb and meta can COEXIST (the
  // merged map step carries both): bulb first, meta text beside it. Built
  // here, mounted into the controls row below; the opener renders neither.
  const extras = document.createElement('div');
  extras.className = 'atlas-tour-extras atlas-tour-spacer';
  if (words.deeper) {
    const bulb = document.createElement('button');
    bulb.type = 'button';
    bulb.className = 'atlas-tour-deeper-toggle';
    bulb.dataset.tourControl = 'deeper';
    bulb.innerHTML = '<span class="material-symbols-outlined">emoji_objects</span> More information';
    const deeper = document.createElement('div');
    deeper.className = 'atlas-tour-deeper';
    // Paragraph breaks (\n\n in the step data) render as real paragraphs —
    // a wall of text defeats the point of going deeper. Paragraphs get the
    // same token pass as bodies (Titus links council motions here).
    for (const para of words.deeper.split('\n\n')) {
      const p = document.createElement('p');
      renderBodyText(p, para);
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
  // Meta rides BESIDE the bulb (no more exclusivity; the opener shows
  // neither: its copy carries the book link inline).
  if (!opener && phase.meta) {
    const meta = document.createElement('p');
    meta.className = 'atlas-tour-meta';
    // The same token pass as bodies — the hegemony meta names *issuer* and
    // *holders*, which rendered as literal asterisks under textContent
    // (own-eyes).
    // The finale's line says what its buttons do, and they differ by browser
    // and by where the tour world lives (contract §7.7).
    renderBodyText(meta, step.handsOn === 'keep-world' ? finaleMeta({ folderMode: hasFolderMode(), legacy: tourWorldIsLegacy() }) : phase.meta);
    extras.appendChild(meta);
  }

  // Row 3 — controls.
  const controls = document.createElement('div');
  controls.className = 'atlas-tour-controls';

  // The opener (step 0): the sentence has no world yet, so the phase-`advance`
  // path can't render a forward control (`canAdvance` is false with no active
  // tour world — it reads as suspended). "Start" is the explicit hand-off into
  // the dock. No counter, no Back.
  //
  // And NO EXIT (Titus). Exit is "leave the thing you are inside", but
  // nobody is inside anything yet — the opener is a cover, and the way out of a
  // cover is the door you came through. Offering to exit a tour that has not
  // started reads as a mistake. One control, one decision.
  if (opener) {
    const begin = document.createElement('button');
    begin.type = 'button';
    begin.className = 'atlas-btn-primary';
    begin.dataset.tourControl = 'next';
    begin.textContent = 'Start';
    begin.addEventListener('click', () => { void nextStep(); });
    controls.appendChild(begin);
    bindOpenerEscape();
    panel.appendChild(controls);
    root!.appendChild(panel);
    restoreFocus(focusedAction);
    return;
  }

  // Past the opener: the visible Exit control is back, so the opener-only
  // Escape binding has nothing left to serve.
  unbindOpenerEscape();

  // The foot slot leads the controls row, bottom-left: the deeper
  // bulb + meta line took the counter's spacer role. (The visible step
  // counter was cut — Titus; data-tour-step remains the test contract.)
  controls.appendChild(extras);

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
  // sit over the zone (Titus's ruling). `handsOnDone` (pin exists) still
  // drives the +pin highlight release; this only gates whether Next appears,
  // so a wrong drop shows the correction phase with no Next until it is
  // dragged onto the swamps.
  const pinInZoneOk = step.placeInZone
    ? view.pinInZone(step.placeInZone.pinRef, step.placeInZone.zoneRef)
    : true;
  const handsOnGate = step.handsOn && step.handsOn !== 'keep-world'
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
  // The preview stack (Titus — the semantics flip): a right-anchored
  // column of type icons showing what the NEXT click of Next brings into the
  // world (the following step's reveals and creates, quiet machinery
  // excluded). Titus's refinement: the stack renders ONLY while a
  // LIVE Next exists — seeing "what Next brings" before Next can be pressed
  // read as confusion on the hands-on beats. It rides the same conditions as
  // the live forward control, so the icons and the button appear together.
  const forwardLive = advance
    && !(step.handsOn && step.handsOn !== 'keep-world' && !handsOnGate);
  const previewStack = forwardLive && !opener ? buildPreviewStack(idx) : null;
  // When a stack exists, the copy reserves the right-hand lane the icons
  // occupy — long bodies never collide with the column.
  panel.classList.toggle('has-create-stack', Boolean(previewStack));
  if (previewStack) panel.appendChild(previewStack);
  const mountForward = (btn: HTMLElement) => { controls.appendChild(btn); };

  if (step.handsOn && step.handsOn !== 'keep-world' && !handsOnGate) {
    // No LIVE forward control: the gesture is the way. But the SLOT stays —
    // see ghostNext below (Titus).
    mountForward(ghostNext());
  } else if (step.handsOn === 'keep-world') {
    // The finale (1.17, contract §7.1): Keep this world · Save it to a folder
    // (with the folder picker) · Start fresh. A 1.16 tour world still running
    // across the upgrade lives outside the browser home: Start fresh only.
    // The bar sits outside `.atlas-shell`, so the keep dialog's `inert` does
    // not reach it: every button is disabled for the run (lane K K0).
    const legacy = tourWorldIsLegacy();
    const name = tourWorldName();
    // Back too (own eyes): a Back queued behind the keep is a no-op
    // once it commits, but a live button the run will ignore is a lie.
    const lockAll = (locked: boolean) => {
      controls.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = locked; });
    };
    const add = (label: string, title: string, cls: string, control: string, onClick: () => Promise<unknown>) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.title = title;
      b.textContent = label;
      b.dataset.tourControl = control;
      b.addEventListener('click', () => {
        // Before anything else: the browser is asked to keep worlds only
        // inside the click, never awaited (contract §2.3, invariant 10).
        // Save it to a folder too: a move that fails leaves the kept world in
        // this browser.
        if (control === 'keep' || control === 'save') {
          requestPersistOnFirstBrowserWorld(line => { void import('../ui/toast-manager').then(({ toastManager }) => toastManager.info(line, 10_000)); });
        }
        lockAll(true);
        void onClick()
          .catch((err: unknown) => {
            console.warn('[tour] finale action failed:', err);
            showProblem(err, { doing: control === 'save' ? 'saving the tour world to a folder' : 'keeping the tour world' });
          })
          .finally(() => { if (b.isConnected) lockAll(false); });
      });
      controls.appendChild(b);
    };
    add('Start fresh', 'End the tour and delete the tour world', 'atlas-btn-ghost', 'start-fresh', () => exitTour());
    if (!legacy && hasFolderMode()) {
      add('Save it to a folder', `Keep ${name} as a folder on your drive`, 'atlas-btn-ghost', 'save', () => import('./tour-keep').then(m => m.saveTourWorldToFolder()));
    }
    if (!legacy) {
      add('Keep this world', `Keep ${name} and everything you made in it`, 'atlas-btn-primary', 'keep', () => keepTourWorld());
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
    mountForward(next);
  } else {
    // A `creates` run mid-progress, or a phased step whose `advanceWhen` has
    // not passed yet — no live Next either, so the slot is reserved here too.
    // (The first cut only ghosted the handsOn branch; the mintObjectRun e2e
    // assertion caught Back still shifting on the objects step.)
    mountForward(ghostNext());
  }

  appendExit(controls);
  panel.appendChild(controls);
  // The collapse control (Titus): a quiet − in the dock's top-right;
  // when collapsed, the panel hides entirely and a floating + pill (on the
  // ROOT, so it survives the panel's display:none) brings it back.
  const collapse = document.createElement('button');
  collapse.type = 'button';
  collapse.className = 'atlas-tour-collapse';
  collapse.title = 'Hide the tour panel';
  collapse.setAttribute('aria-label', 'Hide the tour panel');
  collapse.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">remove</span>';
  collapse.addEventListener('click', () => setDockCollapsed(true));
  panel.appendChild(collapse);
  const restore = document.createElement('button');
  restore.type = 'button';
  restore.className = 'atlas-tour-restore';
  restore.title = 'Show the tour panel';
  restore.setAttribute('aria-label', 'Show the tour panel');
  // A word, not a "+" (every other + in Atlas means create).
  restore.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">expand_less</span><span>Show the tour</span>';
  restore.addEventListener('click', () => setDockCollapsed(false));
  root!.appendChild(restore);
  root!.appendChild(panel);
  restoreFocus(focusedAction);
}

/**
 * The preview stack (Titus): one dim type icon per element the NEXT
 * step brings — `previewRefsFor` holds the rule (next step's reveals ∪
 * creates, minus markers and the calendar construct). "It is what you are
 * about to create": the icons are always the not-yet state, because the
 * moment those elements exist the tour is on their step and the stack shows
 * the step after. Returns null when the next step brings nothing (or there
 * is no next step), so the dock stays bare everywhere else.
 */
function buildPreviewStack(idx: number): HTMLElement | null {
  const refs = previewRefsFor(idx);
  if (refs.length === 0) return null;
  const stack = document.createElement('div');
  stack.className = 'atlas-tour-create-stack';
  // Capped so a step that previews many elements (the-rest: seven) stays a
  // short column, not a tower — the rest fold into a "+N" chip.
  const overflow = refs.length > CREATE_STACK_MAX ? refs.length - (CREATE_STACK_MAX - 1) : 0;
  const shown = overflow ? refs.slice(0, CREATE_STACK_MAX - 1) : refs;
  for (const ref of shown) {
    const [type, name] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined atlas-tour-create-glyph';
    icon.textContent = ELEMENT_ICONS[type as ElementType] ?? 'circle';
    icon.title = `${name} (${typeName(type)}) · up next`;
    icon.style.setProperty('--tour-glyph-color', ELEMENT_TYPE_COLORS[type as ElementType] ?? '#22d3ee');
    stack.appendChild(icon);
  }
  if (overflow) {
    const more = document.createElement('span');
    more.className = 'atlas-tour-create-more';
    more.textContent = `+${overflow}`;
    more.title = `${overflow} more`;
    stack.appendChild(more);
  }
  return stack;
}

const CREATE_STACK_MAX = 5;

/**
 * The step's narrated-field highlight (Titus). One injected style tag
 * keyed off the step script: `field` entries match the `data-field` attribute
 * every detail row renders; `section:` entries match a detail section by its
 * `data-section` name ("Referenced by"). A style tag rather than stamped
 * classes because the detail pane re-renders on every state tick and would
 * wipe any class the tour put on its rows. Names are whitelisted to a safe
 * character set — the script is static, but a selector is still a selector.
 */
const FIELD_HL_STYLE_ID = 'atlas-tour-field-hl';

function applyFieldHighlights(step: TourStep): void {
  const names = (step.highlightFields ?? []).filter(n => /^[A-Za-z0-9_: -]+$/.test(n));
  let tag = document.getElementById(FIELD_HL_STYLE_ID) as HTMLStyleElement | null;
  if (names.length === 0) { tag?.remove(); return; }
  if (!tag) {
    tag = document.createElement('style');
    tag.id = FIELD_HL_STYLE_ID;
    document.head.appendChild(tag);
  }
  tag.textContent = names.map(n => {
    const sel = n.startsWith('section:')
      ? `body.atlas-touring .atlas-detail-section[data-section="${n.slice('section:'.length)}"]`
      : `body.atlas-touring .atlas-field[data-field="${n}"]`;
    // Quiet: the wash alone (the left accent bar obscured row text).
    return `${sel} { background: rgba(var(--atlas-accent-rgb), 0.07); border-radius: 4px; }`;
  }).join('\n');
}

/**
 * The reserved forward slot (Titus). Whenever no LIVE forward control
 * renders — a hands-on beat, a `creates` run mid-progress, an unmet
 * `advanceWhen` — an invisible Next holds the geometry, so Back and Exit
 * never move when Next comes and goes: a fast Next-Next-Next click chain
 * used to land on Back and bounce the tour backwards. Identical text and
 * classes to the real button, so the width cannot drift from it. The opener
 * and the finale keep their own layouts (no ghost).
 */
function ghostNext(): HTMLElement {
  const ghost = document.createElement('button');
  ghost.type = 'button';
  ghost.className = 'atlas-btn-primary atlas-tour-next-ghost';
  ghost.textContent = 'Next';
  ghost.disabled = true;
  ghost.tabIndex = -1;
  ghost.setAttribute('aria-hidden', 'true');
  return ghost;
}

/**
 * The copy token pass (bold, italic and links), shared by phase
 * bodies and deeper paragraphs. `\n` becomes a real line break via
 * `white-space: pre-line`; `**bold**` marks the control you click; `*italic*`
 * marks a field name; `[text](url)` becomes a link. Everything is built from
 * text nodes and elements — never innerHTML; the copy is copy, not markup.
 * A URL must be parenthesis-free (percent-encode them). Unbalanced markers
 * fall back to plain text for their segment rather than guessing.
 */
const COPY_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

function renderBodyText(host: HTMLElement, text: string): void {
  let last = 0;
  for (const m of text.matchAll(COPY_LINK_RE)) {
    if (m.index! > last) appendEmphasis(host, text.slice(last, m.index));
    const a = document.createElement('a');
    a.className = 'atlas-tour-copy-link';
    a.href = m[2];
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = m[1];
    host.appendChild(a);
    last = m.index! + m[0].length;
  }
  if (last < text.length) appendEmphasis(host, text.slice(last));
}

/** `**bold**` then `*italic*` within a link-free segment. */
function appendEmphasis(host: HTMLElement, text: string): void {
  const parts = text.split('**');
  if (parts.length % 2 === 0) { appendItalic(host, text); return; }
  parts.forEach((part, i) => {
    if (!part) return;
    if (i % 2 === 1) {
      const b = document.createElement('strong');
      b.textContent = part;
      host.appendChild(b);
    } else {
      appendItalic(host, part);
    }
  });
}

function appendItalic(host: HTMLElement, text: string): void {
  const parts = text.split('*');
  if (parts.length % 2 === 0) { appendCategoryText(host, text); return; }
  parts.forEach((part, i) => {
    if (!part) return;
    if (i % 2 === 1) {
      const em = document.createElement('em');
      em.textContent = part;
      host.appendChild(em);
    } else {
      appendCategoryText(host, part);
    }
  });
}

/**
 * Category words in plain copy get their FAMILY colour (Titus): the
 * copy teaches by naming categories, and tinting the words visually links
 * them to the preview icons and the sentence glyphs — SOME indication that
 * these are categories, in the 4-family scheme. The word list is built from
 * the categories the TOUR actually brings (its reveal/creates refs plus the
 * two hands-on elements), so generic English words that happen to be type
 * names elsewhere in the schema ("relation", "family", "law") are never
 * painted. Longest alternative first, so plurals win over contained
 * singulars. Plain text segments only — words inside *field names*,
 * **controls** and [links] stay unpainted.
 */
const CATEGORY_WORDS: ReadonlyMap<string, ElementType> = (() => {
  const types = new Set<string>(['character', 'pin']); // the hands-on pair
  for (const step of TOUR_STEPS) {
    for (const ref of [...(step.reveal ?? []), ...(step.creates ?? [])]) {
      types.add(ref.slice(0, ref.indexOf(':')));
    }
  }
  const map = new Map<string, ElementType>();
  for (const t of types) {
    // The tour's copy is written in the standard's words, whatever world is open.
    if (!(t in ELEMENT_ICONS)) continue;
    map.set(typeName(t, { world: null }).toLowerCase(), t as ElementType);
    map.set(typeName(t, { world: null, many: true }).toLowerCase(), t as ElementType);
  }
  return map;
})();

const CATEGORY_RE = new RegExp(
  '\\b(' + [...CATEGORY_WORDS.keys()].sort((a, b) => b.length - a.length).join('|') + ')\\b',
  'gi',
);

function appendCategoryText(host: HTMLElement, text: string): void {
  let last = 0;
  for (const m of text.matchAll(CATEGORY_RE)) {
    const type = CATEGORY_WORDS.get(m[1].toLowerCase());
    if (!type) continue;
    if (m.index! > last) host.appendChild(document.createTextNode(text.slice(last, m.index)));
    const span = document.createElement('span');
    span.className = 'atlas-tour-cat';
    span.style.setProperty('--tour-cat-color', ELEMENT_TYPE_COLORS[type] ?? '#22d3ee');
    span.textContent = m[1];
    host.appendChild(span);
    last = m.index! + m[0].length;
  }
  if (last < text.length) host.appendChild(document.createTextNode(text.slice(last)));
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

/**
 * Escape leaves the OPENER, and only the opener.
 *
 * Titus asked for the opener to carry a single control: Start. Doing
 * exactly that removes the only way off the cover screen — a visitor who clicks
 * "take the tour" from the landing to see what it is would be committed to
 * starting it. Escape restores the way out without putting chrome back on a
 * screen whose whole point is one sentence and one button.
 *
 * DELIBERATELY NOT GLOBAL ACROSS THE TOUR. Mid-tour there is a visible Exit
 * control, so a global handler would be pure duplication — and this app has
 * already been bitten by exactly that: a review found a globally-captured Escape in
 * zone edit mode with no target check, which reverted every committed vertex
 * drag when a user pressed it to dismiss a field. Escape is crowded here (field
 * editors, modals, pin placement, the exit confirm itself); binding it only
 * where nothing else can serve is the narrow, safe version.
 */
let openerEscapeHandler: ((e: KeyboardEvent) => void) | null = null;

function bindOpenerEscape(): void {
  if (openerEscapeHandler) return;
  openerEscapeHandler = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    // Only while the opener is the live step — the bar re-renders per step and
    // unbinds below, but guard anyway so a stray listener can never fire late.
    if (currentStepIndex() !== 0) return;
    e.preventDefault();
    confirmExitTour(currentStepIndex(), () => { void exitTour(); });
  };
  document.addEventListener('keydown', openerEscapeHandler);
}

function unbindOpenerEscape(): void {
  if (!openerEscapeHandler) return;
  document.removeEventListener('keydown', openerEscapeHandler);
  openerEscapeHandler = null;
}

function appendExit(controls: HTMLElement): void {
  const exit = document.createElement('button');
  exit.type = 'button';
  exit.className = 'atlas-btn-ghost atlas-tour-exit';
  exit.title = 'Leave the tour and delete the tour world';
  exit.textContent = 'Exit tour';
  // Exit goes through the confirm (Titus): every beat is gated on a
  // gesture, so leaving early is a legitimate move that deserves a real door —
  // and the door doubles as a map of the rooms the tour never reached. The
  // finale's Finish deliberately does NOT route through here.
  exit.addEventListener('click', () => {
    confirmExitTour(currentStepIndex(), () => { void exitTour(); });
  });
  controls.appendChild(exit);
}

// (The watch-mode Next beside a hands-on primary was REMOVED 2026-07-19,
// Titus's call: two forward buttons at the first hands-on beats read as a
// fork. The create dialogs are locked one-click affairs — the gesture IS the
// route. Watch-mode Next survives everywhere else via the plain else-branch;
// after the Consul exists the consul step shows plain Next to move on.)
