/**
 * Waypoints (Bout OW, workplan D11c) — the OnlyWorlds learning track.
 *
 * Thirteen named waypoints (keep-a-copy since 1.17; story and knowledge since
 * #127, when the home's room cards merged into this track), each
 * dual-teaching one OnlyWorlds concept + one app surface. Completion hooks live at USER-GESTURE call sites only (button
 * clicks, field commits, explicit node clicks) — NEVER in FolderStore or any
 * data layer. Import-, sync- and demo-originated mutations can never complete
 * a waypoint because no hook exists on those paths.
 *
 * THE CONTRACT (hook table, gating class rule, demo-flag lifecycle):
 *   Forge/Notes/2026-07-07-atlas-waypoint-hookmap.md (v2, gate-settled)
 *
 * Gating class rule:
 * - World-data waypoints (first-element, taxonomy, links, maps, time, story,
 *   knowledge, share, keep-copy)
 *   are gated on the ACTIVE world being the demo world (`entry.demo`).
 * - Portability waypoints (first-world, import, ecosystem) + council are
 *   UNGATED: first-world's created world is non-demo by construction (never
 *   consult the active-world gate — after exploring the demo, the active
 *   world IS demo at click time); import/make-online/link are "leaving the
 *   sandbox" gestures and count by design (D11c: "linking the readonly demo
 *   world counts... never require an account action to light a learning
 *   waypoint").
 *
 * State is atlas-level localStorage — not per-world, not synced. Muted
 * suppresses TOASTS ONLY; completions still record so the OnlyWorlds page
 * stays honest.
 */

import { getState } from './state';
import { knowledgeHash, settingsHash, writingHash } from './router';

export type WaypointId =
  | 'first-world'
  | 'first-element'
  | 'taxonomy'
  | 'links'
  | 'maps'
  | 'time'
  | 'story'
  | 'knowledge'
  | 'import'
  | 'ecosystem'
  | 'share'
  | 'council'
  | 'keep-copy';

export interface WaypointDef {
  id: WaypointId;
  /** Benefit-voiced name (D11c v3, verbatim). */
  name: string;
  /**
   * One-line OW concept. Shown ONLY on the OnlyWorlds page (settings scope —
   * tech terms permitted there, not in toasts).
   */
  concept: string;
  /** One-line app action (the unmet row's invitation). */
  action: string;
  /** Toast line — benefit-voiced, tech-free (toasts appear app-wide). */
  toast: string;
  /** Material Symbols glyph for the grid row. */
  glyph: string;
  /** Deep link that OPENS the feature; null when no world is active. */
  link: (worldId: string | null) => string | null;
}

export const OW_COUNCIL_URL = 'https://council.onlyworlds.com';

export const WAYPOINTS: readonly WaypointDef[] = [
  {
    id: 'first-world',
    name: 'Your world, your files',
    // True for a world in this browser too (1.17, contract §6.2).
    concept: 'Your world is plain files in an open format, no account needed: in a folder on your drive any tool can read it, and a world in this browser can leave as one file any time.',
    action: 'Start your first world.',
    toast: 'Your world is plain files, and it can always leave.',
    glyph: 'description', // plain files, wherever they live: never a folder (S376 lens C C6)
    link: () => '#/',
  },
  {
    id: 'first-element',
    name: 'A place for everything',
    concept: 'Every OnlyWorlds tool speaks the same 22 element types, a shared vocabulary for whole worlds.',
    action: 'Create your first element and meet the type grid.',
    toast: 'Every piece of your world has a place.',
    glyph: 'category',
    link: (w) => (w ? `#/w/${w}/elements` : null),
  },
  {
    id: 'taxonomy',
    name: 'Label it your way',
    concept: 'Supertype and subtype are free labels on every element, with no fixed list.',
    action: 'Set a supertype and a subtype on any element.',
    toast: 'Labels are yours to invent.',
    glyph: 'sell',
    link: (w) => (w ? `#/w/${w}/elements` : null),
  },
  {
    id: 'links',
    name: 'Everything links',
    concept: 'Link fields tie elements into one world, and a link holds when a name changes.',
    action: 'Link one element to another, with a field or an @ mention.',
    toast: 'Your world is starting to connect.',
    glyph: 'hub',
    link: (w) => (w ? `#/w/${w}/elements` : null),
  },
  {
    id: 'maps',
    name: 'Places on maps',
    concept: 'Maps, pins and zones are world data too, in the same format.',
    action: 'Place a pin on a map.',
    toast: 'Your world has places now.',
    glyph: 'location_on',
    link: (w) => (w ? `#/w/${w}` : null),
  },
  {
    id: 'time',
    name: 'Your world through time',
    concept: 'Events and dates are structured data; a chart is one view of them.',
    action: 'Open the charts room and click a node.',
    toast: 'Your world has a timeline of its own.',
    glyph: 'timeline',
    link: (w) => (w ? `#/w/${w}/timeline` : null),
  },
  {
    // #127: the home's "Write" card, now a step of the one track.
    id: 'story',
    name: 'Tell it as a story',
    concept: 'A narrative is an element too, and its text can link the elements it mentions.',
    action: 'Start a book or a draft in the writing room.',
    toast: 'Your world has a story now.',
    glyph: 'menu_book',
    link: (w) => (w ? writingHash(w) : null),
  },
  {
    // #127: the home's "Know" card, now a step of the one track.
    id: 'knowledge',
    name: 'Who knows what',
    concept: 'What characters know is world data: a knowledge entry, the elements it is about, and who holds it.',
    action: 'Record something a character knows, in the knowledge room.',
    toast: 'Your world records who knows what.',
    glyph: 'psychology',
    link: (w) => (w ? knowledgeHash(w) : null),
  },
  {
    id: 'import',
    name: 'Turn messy notes into a world',
    concept: 'An AI assistant can turn most notes into JSON that Atlas imports.',
    action: 'Import anything, or copy the example JSON.',
    toast: 'Notes from anywhere can become a world.',
    glyph: 'import_export',
    link: (w) => (w ? `#/w/${w}/import` : null),
  },
  {
    id: 'ecosystem',
    name: 'One world, many tools',
    concept: 'Your world travels by API key and PIN: the same world in any OnlyWorlds tool.',
    action: 'Take a world online, or download one from OnlyWorlds.',
    toast: 'Your world can travel between tools.',
    glyph: 'cloud_sync',
    link: (w) => (w ? settingsHash(w, 'world') : null),
  },
  {
    id: 'share',
    name: 'Share your world as a page',
    concept: 'Publishing renders your existing elements at a public URL. No separate site needed.',
    action: 'Preview or publish a page in the pages room.',
    toast: 'Your world has a public face.',
    glyph: 'public',
    link: (w) => (w ? `#/w/${w}/share` : null),
  },
  {
    id: 'council',
    name: 'Help shape the format',
    concept: 'The schema is governed in the open: anyone can propose changes at the council.',
    action: 'Visit the council and see an open motion.',
    toast: 'You have seen where the format is shaped.',
    glyph: 'gavel',
    link: () => null, // external — the page renders the council URL directly
  },
  {
    // 1.17, contract §6.2: atlas-level, once ever; a world of the user's own.
    id: 'keep-copy',
    name: 'Keep a copy',
    concept: 'A world is plain files, so it can always leave whole: as one downloaded file, in a folder, or in your account.',
    action: 'Download your world, move it to a folder, or take it online.',
    toast: 'Your world has a copy outside this browser.',
    glyph: 'download',
    link: (w) => (w ? settingsHash(w, 'world') : null),
  },
] as const;

/** World-data waypoints — gated on the active world being the demo world. */
const DEMO_GATED: ReadonlySet<WaypointId> = new Set([
  'first-element',
  'taxonomy',
  'links',
  'maps',
  'time',
  'story',
  'knowledge',
  'share',
  'keep-copy',
]);

// ---- State ----

const STORAGE_KEY = 'atlas_waypoints_v1';

export interface WaypointsState {
  completed: Partial<Record<WaypointId, string>>;
  /** Toasts off. Completions STILL record — the page stays honest. */
  muted: boolean;
  firstToastShown: boolean;
  /** Taxonomy half-flags — supertype and subtype commits, any element. */
  taxonomySuper: boolean;
  taxonomySub: boolean;
}

function defaultState(): WaypointsState {
  return { completed: {}, muted: false, firstToastShown: false, taxonomySuper: false, taxonomySub: false };
}

export function loadWaypointsState(): WaypointsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<WaypointsState>;
    return { ...defaultState(), ...parsed, completed: { ...(parsed.completed ?? {}) } };
  } catch {
    return defaultState();
  }
}

function saveState(s: WaypointsState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Private-mode / quota failures degrade to session-only — acceptable.
  }
  document.dispatchEvent(new CustomEvent('atlas:waypoints-changed'));
}

export function completedCount(): number {
  const s = loadWaypointsState();
  return WAYPOINTS.filter((w) => !!s.completed[w.id]).length;
}

export function isMuted(): boolean {
  return loadWaypointsState().muted;
}

export function setMuted(muted: boolean): void {
  const s = loadWaypointsState();
  saveState({ ...s, muted });
}

/** Veteran path (OnlyWorlds page): stamp every waypoint, no toasts. */
export function markAllFamiliar(): void {
  const s = loadWaypointsState();
  const now = new Date().toISOString();
  const completed = { ...s.completed };
  for (const w of WAYPOINTS) if (!completed[w.id]) completed[w.id] = now;
  saveState({ ...s, completed, taxonomySuper: true, taxonomySub: true });
}

/** Is the ACTIVE world the bundled demo world? (registry `demo` flag) */
export function isDemoWorldActive(): boolean {
  const st = getState();
  const active = st.active;
  if (!active) return false;
  const entry = st.registry.worlds.find((w) => w.id === active.worldId);
  return entry?.demo === true;
}

/**
 * Complete a waypoint. EVERY call site must be a user gesture (button click,
 * field commit, explicit node click) — never a data path, never sync/import
 * internals. See the hook table in the contract doc before adding a caller.
 *
 * Demo gating: world-data waypoints silently no-op while the demo world is
 * active. Portability waypoints ('first-world', 'import', 'ecosystem') and
 * 'council' always count.
 */
export function completeWaypoint(id: WaypointId, opts: { toast?: string } = {}): void {
  const s = loadWaypointsState();
  if (s.completed[id]) return;
  if (DEMO_GATED.has(id) && isDemoWorldActive()) return;
  if (opts.toast) toastOverrides.set(id, opts.toast);
  const next: WaypointsState = {
    ...s,
    completed: { ...s.completed, [id]: new Date().toISOString() },
  };
  saveState(next);
  enqueueToast(id);
}

/**
 * Taxonomy is a two-half waypoint: one supertype commit AND one subtype
 * commit (any element, need not be the same one). Called from the element
 * editor's field-commit path only.
 */
export function completeTaxonomyHalf(half: 'supertype' | 'subtype'): void {
  const s = loadWaypointsState();
  if (s.completed['taxonomy']) return;
  if (isDemoWorldActive()) return;
  const next: WaypointsState = {
    ...s,
    taxonomySuper: s.taxonomySuper || half === 'supertype',
    taxonomySub: s.taxonomySub || half === 'subtype',
  };
  if (next.taxonomySuper && next.taxonomySub) {
    next.completed = { ...next.completed, taxonomy: new Date().toISOString() };
    saveState(next);
    enqueueToast('taxonomy');
    return;
  }
  saveState(next);
}

// ---- OW-page highlight handoff (toast click → page) ----

let pendingHighlight: WaypointId | null = null;

/** The page consumes (and clears) the waypoint a toast click asked to highlight. */
export function consumePendingHighlight(): WaypointId | null {
  const v = pendingHighlight;
  pendingHighlight = null;
  return v;
}

// ---- Toast queue ----
//
// Own renderer (ToastManager is message-only): one waypoint toast at a time,
// list-order priority, once-ever per waypoint (guaranteed by the completed
// stamp), suppressed while any modal is open or a text input / contenteditable
// has focus. Drain re-attempts on focusout, hashchange, document click and a
// microtask after each enqueue — no polling.

const queue: WaypointId[] = [];
let showing = false;

/**
 * The steps the mounted world home has shown since it opened this world
 * (#127): the core pair's first-world and first-element, and every line of
 * the next-steps list. Their toasts are dropped; the home clears the set when
 * it unmounts or changes world.
 */
let homeReceipts = new Set<WaypointId>();

export function addHomeReceipts(ids: Iterable<WaypointId>): void {
  for (const id of ids) homeReceipts.add(id);
}

export function clearHomeReceipts(): void {
  homeReceipts = new Set();
}
let drainWired = false;

const TOAST_MS = 7000;

/** A completion that says its own line (keep-copy by JSON export: "a copy of its own"). */
const toastOverrides = new Map<WaypointId, string>();

function enqueueToast(id: WaypointId): void {
  if (loadWaypointsState().muted) return;
  if (!queue.includes(id)) {
    queue.push(id);
    // List-order priority: drain in canonical waypoint order.
    queue.sort((a, b) => WAYPOINTS.findIndex((w) => w.id === a) - WAYPOINTS.findIndex((w) => w.id === b));
  }
  wireDrainTriggers();
  queueMicrotask(drain);
}

function wireDrainTriggers(): void {
  if (drainWired) return;
  drainWired = true;
  window.addEventListener('focusout', () => setTimeout(drain, 0));
  window.addEventListener('hashchange', () => setTimeout(drain, 0));
  document.addEventListener('click', () => setTimeout(drain, 0), { capture: true });
}

function suppressed(): boolean {
  if (document.querySelector('.atlas-modal-overlay')) return true;
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

function drain(): void {
  if (showing || queue.length === 0) return;
  if (loadWaypointsState().muted) {
    queue.length = 0;
    return;
  }
  if (suppressed()) return;
  // A step the world home showed is its own receipt (#127): no toast on top
  // of the list (or the core pair) that just ticked it off. Everything else
  // still toasts, wherever it was earned (gate S383 A1: a guess from the
  // route dropped toasts earned in a dialog that then landed on the home).
  while (queue.length > 0 && homeReceipts.has(queue[0])) queue.shift();
  if (queue.length === 0) return;
  const id = queue.shift()!;
  renderWaypointToast(id);
}

function renderWaypointToast(id: WaypointId): void {
  const def = WAYPOINTS.find((w) => w.id === id);
  const container = document.getElementById('toast-container');
  if (!def || !container) return;
  showing = true;

  const s = loadWaypointsState();
  const isFirst = !s.firstToastShown;
  if (isFirst) saveState({ ...s, firstToastShown: true });

  const el = document.createElement('div');
  el.className = 'ow-toast atlas-waypoint-toast';
  el.setAttribute('role', 'status');

  const body = document.createElement('button');
  body.type = 'button';
  body.className = 'atlas-waypoint-toast-body';
  body.innerHTML = `
    <img class="atlas-waypoint-toast-glyph" src="${import.meta.env.BASE_URL}owlogo.png" alt="" />
    <span class="atlas-waypoint-toast-text">
      <span class="atlas-waypoint-toast-name">${escapeText(def.name)}</span>
      <span class="atlas-waypoint-toast-line">${escapeText(toastOverrides.get(def.id) ?? def.toast)}</span>
    </span>
  `;
  body.addEventListener('click', () => {
    pendingHighlight = id;
    const worldId = getState().active?.worldId ?? null;
    window.location.hash = worldId ? settingsHash(worldId, 'onlyworlds') : '#/settings/onlyworlds';
    dismiss();
  });
  el.appendChild(body);

  if (isFirst) {
    const rider = document.createElement('div');
    rider.className = 'atlas-waypoint-toast-rider';
    const note = document.createElement('span');
    note.textContent = 'These are optional.';
    const seeAll = document.createElement('button');
    seeAll.type = 'button';
    seeAll.className = 'atlas-waypoint-toast-rider-btn';
    seeAll.textContent = 'see all';
    seeAll.addEventListener('click', (e) => {
      e.stopPropagation();
      const worldId = getState().active?.worldId ?? null;
      window.location.hash = worldId ? settingsHash(worldId, 'onlyworlds') : '#/settings/onlyworlds';
      dismiss();
    });
    const turnOff = document.createElement('button');
    turnOff.type = 'button';
    turnOff.className = 'atlas-waypoint-toast-rider-btn';
    turnOff.textContent = 'turn off';
    turnOff.addEventListener('click', (e) => {
      e.stopPropagation();
      setMuted(true);
      queue.length = 0;
      dismiss();
    });
    rider.append(note, seeAll, ' · ', turnOff);
    el.appendChild(rider);
  }

  container.appendChild(el);

  let dismissed = false;
  let timer = setTimeout(() => dismiss(), TOAST_MS);
  // Hover holds the toast open (S255v2, Captain): reading shouldn't race a
  // timer. The countdown restarts with a short grace when the cursor leaves.
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => {
    if (dismissed) return;
    clearTimeout(timer);
    timer = setTimeout(() => dismiss(), 2500);
  });
  function dismiss(): void {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    el.style.opacity = '0';
    el.style.transform = 'translateY(100%)';
    setTimeout(() => {
      el.remove();
      showing = false;
      setTimeout(drain, 0); // next in queue, re-checked against suppression
    }, 300);
  }
}

function escapeText(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
