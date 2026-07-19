/**
 * Tour bar — the guided tour's ONE narrator component, ONE position:
 * docked bottom-center from step 1 (the centered vignette opener was retired
 * 2026-07-19, Captain's round — the dock IS the narrator from the first
 * second; the bare stage above it fills in on Next). min-height 272px keeps
 * the dock a single exact shape across all 18 steps; step 1 carries its
 * eyebrow + book cite in the always-rendered meta channel at zero extra rows.
 *
 * Rows: the annotated sentence · hairline · body copy (+ meta subtext,
 * ✦ deeper flyout) · controls. Steps carry no titles (v2.1): the act label
 * orients, the divider separates material from narration.
 *
 * The sentence is the progress bar (Skeld's grammar): parsed words carry
 * their element-type color; every span's end word carries an inline glyph,
 * PRE-SPACED from step 0 as a dim ghost and LIT (pop-in) when its step is
 * reached — zero reflow. Clicking a parsed word jumps to its step.
 *
 * The ✦ deeper content opens as a scrollable FLYOUT above the panel — the
 * dock's height never changes (Captain's rule).
 *
 * The bar stamps <body data-tour-stage="N"> — atlas.css hides not-yet-earned
 * app chrome per stage (the progressive build-up).
 */

import { ELEMENT_TYPE_COLORS, ELEMENT_ICONS } from '../core/constants';
import { hasFolderMode } from '../core/capabilities';
import type { ElementType } from '../core/types';
import {
  TOUR_SENTENCE, TOUR_STEPS, tourStageFor,
  TOUR_OPENER_EYEBROW, TOUR_ATTRIBUTION, TOUR_ATTRIBUTION_URL,
  type TourStep,
} from './tour-data';
import {
  onTourChange, isTourActive, currentStepIndex, consulCreated, tourWorldExists,
  nextStep, backStep, enterStep, exitTour, setupFolderFromTour,
} from './tour-engine';

let root: HTMLElement | null = null;
let unsub: (() => void) | null = null;

export function ensureTourBar(container: HTMLElement): void {
  if (isTourActive() && !root) mount(container);
  else if (!isTourActive() && root) unmount();
}

function mount(container: HTMLElement): void {
  root = document.createElement('div');
  root.className = 'atlas-tour-root';
  container.appendChild(root);
  document.body.classList.add('atlas-touring');
  unsub = onTourChange(() => {
    if (!isTourActive()) { unmount(); return; }
    render();
  });
  render();
}

function unmount(): void {
  unsub?.();
  unsub = null;
  root?.remove();
  root = null;
  document.body.classList.remove('atlas-touring');
  delete document.body.dataset.tourStage;
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
function glyphMap(): Map<number, Array<{ type: ElementType; step: number }>> {
  const map = new Map<number, Array<{ type: ElementType; step: number }>>();
  TOUR_STEPS.forEach((step, i) => {
    for (const span of step.spans ?? []) {
      const list = map.get(span.to) ?? [];
      list.push({ type: span.type, step: i });
      map.set(span.to, list);
    }
  });
  return map;
}

/**
 * Build the annotated sentence: serif italic words, type-colored fill for
 * parsed words, pre-spaced ghost glyphs lighting up as steps are reached.
 */
function buildSentence(idx: number, step: TourStep): HTMLElement {
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
    for (const g of glyphs.get(w) ?? []) {
      const glyph = document.createElement('span');
      // A hands-on step's own glyph waits for the CREATE, not the step-enter
      // — the light is the payoff of the user's gesture (banked S297 nuance).
      const handsOnPending = g.step === idx
        && step.handsOn === 'create-consul' && !consulCreated();
      const lit = g.step <= idx && !handsOnPending;
      glyph.className = 'material-symbols-outlined atlas-tour-glyph' + (lit ? ' lit' : '');
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

function render(): void {
  if (!root) return;
  const idx = currentStepIndex();
  const step = TOUR_STEPS[Math.min(idx, TOUR_STEPS.length - 1)];
  const stage = tourStageFor(idx);
  document.body.dataset.tourStage = String(stage);
  const opener = idx === 0;

  root.innerHTML = '';
  const panel = document.createElement('div');
  // ONE position for the panel — docked bottom from step 1 (Captain's round,
  // 2026-07-19: the centered vignette opener read as a different component;
  // now the dock IS the narrator from the first second, and the app builds
  // above it on Next).
  panel.className = 'atlas-tour-bar' + (idx <= 1 ? ' is-fresh' : '');
  // e2e locator contract: the visible act label is gone (Freek's round), the
  // step number rides a data attribute instead.
  panel.dataset.tourStep = String(idx + 1);

  panel.appendChild(buildSentence(idx, step));

  // Row 2 — step copy, under a hairline (the material/narration divider).
  const copy = document.createElement('div');
  copy.className = 'atlas-tour-copy';
  const body = document.createElement('div');
  body.className = 'atlas-tour-body';
  body.textContent = step.body;
  copy.appendChild(body);
  // The extras row (✦ deeper · inline links) ALWAYS renders — a step without
  // them shows an invisible placeholder at the same metrics, so the panel
  // keeps one shape whether or not a deeper widget exists (the constant-dock
  // law, extended to this row 2026-07-19: baseline-floating the bulb beside
  // the body let long bodies wrap it onto its own line on SOME steps only).
  const extras = document.createElement('div');
  extras.className = 'atlas-tour-extras';
  if (step.deeper) {
    const bulb = document.createElement('button');
    bulb.type = 'button';
    bulb.className = 'atlas-tour-deeper-toggle';
    bulb.innerHTML = '<span class="material-symbols-outlined">emoji_objects</span> more information';
    const deeper = document.createElement('div');
    deeper.className = 'atlas-tour-deeper';
    // Paragraph breaks (\n\n in the step data) render as real paragraphs —
    // a wall of text defeats the point of going deeper.
    for (const para of step.deeper.split('\n\n')) {
      const p = document.createElement('p');
      p.textContent = para;
      deeper.appendChild(p);
    }
    deeper.hidden = true;
    bulb.addEventListener('click', () => { deeper.hidden = !deeper.hidden; });
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
    const eyebrow = document.createElement('span');
    eyebrow.className = 'atlas-tour-eyebrow';
    eyebrow.textContent = TOUR_OPENER_EYEBROW;
    const attr = document.createElement('a');
    attr.className = 'atlas-tour-attribution';
    attr.href = TOUR_ATTRIBUTION_URL;
    attr.target = '_blank';
    attr.rel = 'noopener';
    attr.textContent = TOUR_ATTRIBUTION;
    meta.append(eyebrow, attr);
  } else {
    meta.textContent = step.meta ?? ' ';
  }
  copy.appendChild(meta);
  panel.appendChild(copy);

  // Row 3 — controls.
  const controls = document.createElement('div');
  controls.className = 'atlas-tour-controls';

  // (The act/step label was CUT in S298, Freek's round — the sentence IS the
  // progress; the step number survives as data-tour-step for tests.)
  const spacer = document.createElement('span');
  spacer.className = 'atlas-tour-spacer';
  controls.appendChild(spacer);

  if (idx > 0) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'atlas-btn-ghost';
    back.textContent = 'Back';
    back.addEventListener('click', () => { void backStep(); });
    controls.appendChild(back);
  }

  // Hands-on steps: the real gesture (primary) OR Next (watch-mode — the
  // engine performs the gesture and advances).
  if (step.handsOn === 'create-world' && !tourWorldExists()) {
    const doBtn = document.createElement('button');
    doBtn.type = 'button';
    doBtn.className = 'atlas-btn-primary';
    doBtn.setAttribute('data-tour-action', 'create-world');
    doBtn.textContent = 'Create the world';
    doBtn.addEventListener('click', () => {
      void (async () => {
        const [{ CreateWorldModal }, { toastManager }] = await Promise.all([
          import('../ui/create-world-modal'),
          import('../ui/toast-manager'),
        ]);
        const { createWorldFromTour } = await import('./tour-engine');
        new CreateWorldModal(toastManager, undefined, {
          lockedName: 'Hyperion',
          hint: 'Normally this becomes a folder inside your OnlyWorlds folder. The tour world stays in your browser and folds away when the tour ends.',
          overrideCreate: async () => { await createWorldFromTour(); },
        }).open();
      })();
    });
    controls.appendChild(doBtn);
  } else if (step.handsOn === 'create-consul' && !consulCreated()) {
    const doBtn = document.createElement('button');
    doBtn.type = 'button';
    doBtn.className = 'atlas-btn-primary';
    doBtn.setAttribute('data-tour-action', 'create-consul');
    doBtn.textContent = 'Create the Consul';
    doBtn.addEventListener('click', () => {
      void (async () => {
        const [{ ElementCreateModal }, { toastManager }] = await Promise.all([
          import('../ui/element-create-modal'),
          import('../ui/toast-manager'),
        ]);
        const { createConsul } = await import('./tour-engine');
        new ElementCreateModal(toastManager, {
          initialType: 'character',
          initialName: 'The Consul',
          lockAll: true,
          overrideCreate: async () => { await createConsul(); },
          suppressToast: true,
        }).open();
      })();
    });
    controls.appendChild(doBtn);
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
    return;
  } else {
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'atlas-btn-primary';
    next.textContent = 'Next';
    next.addEventListener('click', () => { void nextStep(); });
    controls.appendChild(next);
  }

  appendExit(controls);
  panel.appendChild(controls);
  root!.appendChild(panel);
}

function appendExit(controls: HTMLElement): void {
  const exit = document.createElement('button');
  exit.type = 'button';
  exit.className = 'atlas-btn-ghost atlas-tour-exit';
  exit.title = 'Leave the tour (the tour world folds away)';
  exit.textContent = 'Exit tour';
  exit.addEventListener('click', () => { void exitTour(); });
  controls.appendChild(exit);
}

// (The watch-mode Next beside a hands-on primary was REMOVED 2026-07-19,
// Captain's call: two forward buttons at the first hands-on beats read as a
// fork. The create dialogs are locked one-click affairs — the gesture IS the
// route. Watch-mode Next survives everywhere else via the plain else-branch;
// after the Consul exists the consul step shows plain Next to move on.)
