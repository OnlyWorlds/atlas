/**
 * Tour engine — boot, reveal, and step state for the guided Hyperion tour.
 *
 * THE SAFETY LAYER: the tour only ever writes to the demo world it booted
 * (registry `demo: true`, mirrored in world.json — the Bout OW contract that
 * also keeps demo gestures from completing waypoints). Every mutation goes
 * through the ordinary FolderStore of the ACTIVE world, and every write-path
 * entry point re-checks that the active world is the tour's demo world —
 * if the user activates another world mid-tour, the tour pauses rather than
 * touch it.
 *
 * THE RESIDUE CONTRACT (v2, Captain's ruling): the tour leaves NOTHING
 * behind. The world is created at the first hands-on step (not at boot) and
 * torn down on exit or finish — registry entry, handle, OPFS folder, all of
 * it. Exit returns to wherever the tour was launched from.
 *
 * Reveal model: the world starts empty; steps write elements from the baked
 * bundle (`src/demo/hyperion-world.json`) as the user advances. Link fields
 * pointing at not-yet-revealed bundle elements are STRIPPED at write time and
 * patched in when their target reveals — the link web grows with the world,
 * and no dangling chips ever render. `atlas_aliases` are deferred the same
 * way until the CHAPTER reveals (they exist to keep the prose chips
 * word-exact; on a beginner's first element page they are noise).
 *
 * Hands-on steps run in two modes (the watch/do rule): the user performs the
 * real gesture, or presses Next and the engine does it for them.
 */

import { getState, patchSlice } from '../core/state';
import { getActiveStore, setActiveStore } from '../core/active-store';
import { navigate, elementHash, mapHash, writingHash, timelineHash } from '../core/router';
import { saveRegistry, deleteWorldEntry } from '../registry/registry';
import { deleteHandle } from '../store/handle-vault';
import { detachSyncEngine } from '../sync/sync-attach';
import type { Element, ElementType } from '../core/types';
import { TOUR_STEPS, type TourStep } from './tour-data';

const TOUR_STATE_KEY = 'atlas_tour_v1';
const TOUR_DONE_KEY = 'atlas_tour_done_v1';
const TOUR_FOLDER = 'hyperion-tour';

interface TourPersist {
  active: boolean;
  step: number;
  /** Registry id of the tour world — '' until the create-world step runs. */
  worldId: string;
  /** Where exit returns to (hash captured at launch). */
  returnHash?: string;
}

interface Bundle {
  world: { name: string; description?: string; [k: string]: unknown };
  elements: Array<Record<string, unknown> & { id: string; type: string; name?: string }>;
}

type Listener = () => void;
const listeners = new Set<Listener>();
export function onTourChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function emit(): void {
  for (const cb of listeners) cb();
}

let bundleCache: Bundle | null = null;
async function loadBundle(): Promise<Bundle> {
  if (!bundleCache) {
    bundleCache = (await import('../demo/hyperion-world.json')).default as unknown as Bundle;
  }
  return bundleCache;
}

export function readTourState(): TourPersist | null {
  try {
    const raw = localStorage.getItem(TOUR_STATE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as TourPersist;
    return typeof p.step === 'number' && typeof p.worldId === 'string' ? p : null;
  } catch {
    return null;
  }
}

function writeTourState(p: TourPersist | null): void {
  try {
    if (p === null) localStorage.removeItem(TOUR_STATE_KEY);
    else localStorage.setItem(TOUR_STATE_KEY, JSON.stringify(p));
  } catch { /* private mode — tour just won't resume */ }
  emit();
}

export function isTourActive(): boolean {
  const p = readTourState();
  return !!p?.active;
}

/** A completed/exited tour happened on this device (landing emphasis swap). */
export function tourWasCompleted(): boolean {
  try { return localStorage.getItem(TOUR_DONE_KEY) === '1'; } catch { return false; }
}

export function currentStepIndex(): number {
  return readTourState()?.step ?? 0;
}

export function currentStep(): TourStep {
  return TOUR_STEPS[Math.min(currentStepIndex(), TOUR_STEPS.length - 1)];
}

/** The tour world exists in the registry (created at the hands-on step). */
export function tourWorldExists(): boolean {
  const p = readTourState();
  if (!p?.worldId) return false;
  return getState().registry.worlds.some(w => w.id === p.worldId && w.demo === true);
}

/** The active world is the tour's demo world (write-safety precondition). */
export function tourWorldIsActive(): boolean {
  const p = readTourState();
  const active = getState().active;
  if (!p || !p.worldId || !active?.opened || active.worldId !== p.worldId) return false;
  const entry = getState().registry.worlds.find(w => w.id === p.worldId);
  return entry?.demo === true;
}

/** Resolve a "type:Name" step ref against the bundle. */
async function resolveRef(ref: string): Promise<{ type: ElementType; el: Bundle['elements'][0] } | null> {
  const idx = ref.indexOf(':');
  const type = ref.slice(0, idx) as ElementType;
  const name = ref.slice(idx + 1);
  const bundle = await loadBundle();
  const el = bundle.elements.find(e => e.type === type && e.name === name);
  return el ? { type, el } : null;
}

/** All bundle element ids — the universe link-stripping checks against. */
async function bundleIds(): Promise<Set<string>> {
  const bundle = await loadBundle();
  return new Set(bundle.elements.map(e => e.id));
}

/**
 * Strip link values pointing at bundle elements that are not yet on disk.
 * Non-bundle ids pass through untouched (there are none today; defensive).
 * `atlas_aliases` are held back until aliasesOn (the chapter's step) — they
 * keep prose chips word-exact but read as noise on early element pages.
 */
function stripUnrevealed(
  data: Record<string, unknown>,
  universe: Set<string>,
  revealed: Set<string>,
  aliasesOn: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    // The element's own id is identity, not a link — never strip it (it IS
    // a bundle uuid, so the generic check below would eat it and the store
    // would mint a fresh id, orphaning every cross-reference).
    if (k === 'id') { out[k] = v; continue; }
    if (k === 'atlas_aliases' && !aliasesOn) continue;
    if (typeof v === 'string' && universe.has(v) && !revealed.has(v)) continue;
    if (Array.isArray(v)) {
      const kept = v.filter(item => !(typeof item === 'string' && universe.has(item) && !revealed.has(item)));
      if (kept.length === 0 && v.length > 0 && k !== 'atlas_aliases') continue;
      out[k] = kept;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** Media assets the bundle references via `x_tour_media`. */
const TOUR_MEDIA_URLS: Record<string, () => string> = {
  'hyperion-map.webp': () => new URL('../demo/hyperion-map.webp', import.meta.url).href,
  'hyperion-location.webp': () => new URL('../demo/hyperion-location.webp', import.meta.url).href,
};

/**
 * Write one bundle element to the active (tour) store if absent. Returns
 * true when a write happened. Strips `x_tour_media` (a bake instruction, not
 * a field) and attaches the referenced asset as local media.
 */
async function revealOne(
  el: Bundle['elements'][0],
  universe: Set<string>,
  revealed: Set<string>,
  aliasesOn: boolean,
): Promise<boolean> {
  const store = getActiveStore();
  if (!store || !tourWorldIsActive()) return false;
  if (await store.getElement(el.id)) return false;

  const { type, x_tour_media, ...rest } = el as Record<string, unknown> & { type: string; x_tour_media?: string };
  const data = stripUnrevealed(rest, universe, revealed, aliasesOn);
  await store.createElement(type as ElementType, data as Partial<Element>);

  if (typeof x_tour_media === 'string' && TOUR_MEDIA_URLS[x_tour_media]) {
    try {
      const resp = await fetch(TOUR_MEDIA_URLS[x_tour_media]());
      const blob = await resp.blob();
      const file = new File([blob], x_tour_media, { type: 'image/webp' });
      const media = await store.addMedia(el.id, file, 'base-image');
      await store.updateElement(el.id, { image_media_id: media.id } as Partial<Element>);
    } catch (err) {
      console.warn('[tour] media attach failed:', err);
    }
  }
  return true;
}

/**
 * Back-fill previously-stripped links (and, once aliasesOn, aliases) on
 * already-revealed elements once their targets exist. Cheap at tour scale.
 */
async function healLinks(universe: Set<string>, revealed: Set<string>, aliasesOn: boolean): Promise<void> {
  const store = getActiveStore();
  if (!store || !tourWorldIsActive()) return;
  const bundle = await loadBundle();
  for (const el of bundle.elements) {
    if (!revealed.has(el.id)) continue;
    const onDisk = await store.getElement(el.id);
    if (!onDisk) continue;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(el)) {
      if (k === 'type' || k === 'x_tour_media') continue;
      if (k === 'atlas_aliases') {
        if (aliasesOn && Array.isArray(v)
            && JSON.stringify(v) !== JSON.stringify((onDisk as Record<string, unknown>)[k] ?? null)) {
          patch[k] = v;
        }
        continue;
      }
      if (typeof v === 'string' && universe.has(v) && revealed.has(v) && (onDisk as Record<string, unknown>)[k] !== v) {
        patch[k] = v;
      } else if (Array.isArray(v) && v.some(i => typeof i === 'string' && universe.has(i))) {
        const want = v.filter(i => !(typeof i === 'string' && universe.has(i) && !revealed.has(i)));
        const have = (onDisk as Record<string, unknown>)[k];
        if (JSON.stringify(want) !== JSON.stringify(have ?? [])) patch[k] = want;
      }
    }
    if (Object.keys(patch).length > 0) {
      await store.updateElement(el.id, patch as Partial<Element>);
    }
  }
}

/** Ids of everything revealed by steps 0..i (plus the hands-on consul). */
async function idsUpTo(stepIndex: number): Promise<Set<string>> {
  const revealed = new Set<string>();
  for (let i = 0; i <= Math.min(stepIndex, TOUR_STEPS.length - 1); i++) {
    const step = TOUR_STEPS[i];
    // A hands-on element is created by the USER on its own step — the
    // generic reveal only backfills it once the tour has moved past
    // (watch-mode Next, resume after reload, back-then-forward navigation).
    if (step.handsOn === 'create-consul' && i < stepIndex) {
      const r = await resolveRef('character:The Consul');
      if (r) revealed.add(r.el.id);
    }
    for (const ref of step.reveal ?? []) {
      const r = await resolveRef(ref);
      if (r) revealed.add(r.el.id);
    }
  }
  return revealed;
}

/** Aliases unlock when the chapter (their reason to exist) is revealed. */
async function aliasesOnFor(revealed: Set<string>): Promise<boolean> {
  const chapter = await resolveRef('narrative:Chapter 1');
  return !!chapter && revealed.has(chapter.el.id);
}

/** Idempotently ensure everything up to `stepIndex` is on disk, links healed. */
async function revealUpTo(stepIndex: number): Promise<void> {
  const universe = await bundleIds();
  const revealed = await idsUpTo(stepIndex);
  const aliasesOn = await aliasesOnFor(revealed);
  const bundle = await loadBundle();
  let wrote = false;
  for (const el of bundle.elements) {
    if (!revealed.has(el.id)) continue;
    if (await revealOne(el, universe, revealed, aliasesOn)) wrote = true;
  }
  await healLinks(universe, revealed, aliasesOn);
  if (wrote) await refreshElements();
}

async function refreshElements(): Promise<void> {
  const store = getActiveStore();
  if (!store) return;
  patchSlice('data', { elements: await store.listElements() });
}

/** Navigate per the step's route directive. */
async function routeFor(step: TourStep): Promise<void> {
  const p = readTourState();
  if (!p) return;
  const worldId = p.worldId;
  if (step.route && worldId) {
    const route = step.route;
    if (route.kind === 'home') { navigate(`#/w/${worldId}`); }
    else if (route.kind === 'elements') { navigate(`#/w/${worldId}/elements`); }
    else if (route.kind === 'chart') { navigate(timelineHash(worldId)); }
    else {
      const r = await resolveRef(route.ref);
      if (r) {
        if (route.kind === 'map') {
          navigate(mapHash(worldId, r.el.id));
        } else if (route.kind === 'writing') {
          navigate(writingHash(worldId, r.el.id));
        } else {
          patchSlice('ui', { ...getState().ui, selectedElementId: r.el.id });
          navigate(elementHash(worldId, r.el.id));
        }
      }
    }
  }
  if (step.webTab) focusWebTab();
}

/** Switch the right pane to the Web (context) tab — the act-5 graph cameo. */
function focusWebTab(): void {
  const ui = getState().ui;
  const idx = ui.rightTabs.findIndex(t => t.kind === 'context');
  if (idx >= 0 && ui.rightActiveIndex !== idx) {
    patchSlice('ui', { ...ui, rightActiveIndex: idx });
  }
}

/** The index of the create-world hands-on step. */
function worldStepIndex(): number {
  return TOUR_STEPS.findIndex(s => s.handsOn === 'create-world');
}

/**
 * Create the tour world (the first hands-on beat, or its watch-mode). Safe
 * to call twice — a live tour world short-circuits.
 */
export async function createTourWorld(): Promise<void> {
  if (tourWorldExists()) return;
  const p = readTourState();
  if (!p) return;
  const { scaffoldTourWorld } = await import('./tour-world');
  const { entry } = await scaffoldTourWorld();
  writeTourState({ ...readTourState()!, worldId: entry.id });
  // The tour narrates elements appearing in the left sidebar — elements mode
  // (UI state only, never the persisted pref). Land on the world's home: the
  // shell materializing IS the payoff of the create.
  patchSlice('ui', { ...getState().ui, sidebarMode: 'elements' });
  navigate(`#/w/${entry.id}`);
}

/**
 * Enter a step: reveal its world, then travel to its surface.
 *
 * Serialized: rapid Next clicks queue rather than race — without this, a
 * slow step's reveal (the 14-element swamps step) could finish AFTER the
 * next step's, landing the earlier step's route last (found by the e2e's
 * fast clicking; a quick-fingered user hits the same race).
 */
let stepChain: Promise<void> = Promise.resolve();
function enqueueStep(compute: () => number): Promise<void> {
  // The target index computes INSIDE the chain — two rapid Next clicks must
  // advance twice, not both resolve against the same pre-click step.
  stepChain = stepChain
    .catch(() => { /* prior step failed — the chain keeps serving */ })
    .then(() => enterStepNow(compute()));
  return stepChain;
}
export function enterStep(index: number): Promise<void> {
  return enqueueStep(() => index);
}

async function enterStepNow(index: number): Promise<void> {
  const p = readTourState();
  if (!p) return;
  const clamped = Math.max(0, Math.min(index, TOUR_STEPS.length - 1));
  // Watch-mode for the world beat: advancing past it creates the world.
  if (clamped > worldStepIndex() && !tourWorldExists()) {
    await createTourWorld();
  }
  writeTourState({ ...readTourState()!, step: clamped });
  await revealUpTo(clamped);
  await routeFor(TOUR_STEPS[clamped]);
  // Tour state lives in localStorage, invisible to state subscribers — tick
  // the ui slice so stage-dependent chrome (sidebar header, welcome panel)
  // re-renders each step (the force-render idiom, convention #2).
  patchSlice('ui', { ...getState().ui });
  emit();
}

export function nextStep(): Promise<void> {
  return enqueueStep(() => currentStepIndex() + 1);
}
export function backStep(): Promise<void> {
  return enqueueStep(() => currentStepIndex() - 1);
}

/**
 * The create-world hands-on DONE path (tour create-world modal submit):
 * create the world, then advance — the shell materializing IS the next step.
 */
export async function createWorldFromTour(): Promise<void> {
  await createTourWorld();
  await enterStep(worldStepIndex() + 1);
}

/**
 * The hands-on Consul create (real element modal, locked). Writes the baked
 * character and shows his page; the step stays (the payoff is looking at
 * what you made — Next moves on).
 */
export async function createConsul(): Promise<void> {
  const p = readTourState();
  if (!p) return;
  const r = await resolveRef('character:The Consul');
  if (r) {
    const universe = await bundleIds();
    const revealed = await idsUpTo(currentStepIndex());
    await revealOne(r.el, universe, revealed, false);
    await refreshElements();
    patchSlice('ui', { ...getState().ui, selectedElementId: r.el.id });
    navigate(elementHash(p.worldId, r.el.id));
  }
  emit();
}

export function consulCreated(): boolean {
  // Cheap sync check for the bar: the consul is in the elements slice.
  const p = readTourState();
  if (!p) return false;
  return getState().data.elements.some(e => e.id === bundleCache?.elements.find(
    b => b.type === 'character' && b.name === 'The Consul')?.id);
}

/**
 * Start (or restart) the tour: tear down any prior tour world, enter the
 * bare stage at step 0. The world is NOT created here — that is the first
 * hands-on beat.
 */
export async function startTour(returnHash?: string): Promise<void> {
  await teardownPriorTourWorld();
  writeTourState({ active: true, step: 0, worldId: '', returnHash });
  await enterStep(0);
}

/**
 * Start the tour AND mount its bar — the one entry point every launching
 * surface uses (landing door, settings replay row). Captures the launch
 * location so exit can return there.
 */
export async function launchTour(): Promise<void> {
  const here = window.location.hash;
  // Launching from the tour's own world (shouldn't happen) or from nowhere →
  // return to the landing.
  await startTour(here && here !== '#' ? here : '#/');
  const { ensureTourBar } = await import('./tour-bar');
  ensureTourBar(document.body);
}

/** Resume a persisted tour (app boot). Steps 0-1 have no world yet. */
export async function resumeTour(): Promise<void> {
  const p = readTourState();
  if (!p?.active) return;
  if (p.worldId) {
    const entry = getState().registry.worlds.find(w => w.id === p.worldId && w.demo === true);
    if (!entry) { writeTourState(null); return; }
    const [{ activateWorld }, { toastManager }] = await Promise.all([
      import('../sidebar/worlds-sidebar'),
      import('../ui/toast-manager'),
    ]);
    await activateWorld(entry.id, toastManager);
    patchSlice('ui', { ...getState().ui, sidebarMode: 'elements' });
  }
  await enterStep(p.step);
}

/**
 * Exit or finish: the tour leaves NOTHING behind. Tear the world down
 * (registry + handle + OPFS), remember completion for the landing's
 * emphasis swap, and return to wherever the tour was launched from.
 */
export async function exitTour(): Promise<void> {
  const p = readTourState();
  if (!p) return;
  const returnTo = p.returnHash || '#/';
  // Flag BEFORE teardown: the teardown's registry patch is the state tick
  // the landing re-renders on — set after, the emphasis swap misses it.
  try { localStorage.setItem(TOUR_DONE_KEY, '1'); } catch { /* private mode */ }
  await teardownPriorTourWorld();
  navigate(returnTo);
  // The teardown's state ticks ran while the tour flag was still set — tick
  // once more so tour-aware chrome (the bare splash, sidebar) settles on the
  // post-tour truth.
  patchSlice('ui', { ...getState().ui });
}

/**
 * The finale's "Set up your folder" — runs the ordinary atlas-root setup
 * (the click's user gesture carries through to the picker), then ends the
 * tour on success: world torn down (the residue contract), sidebar on
 * Worlds where the create-a-world actions now live. A cancelled picker
 * leaves the tour exactly where it was.
 */
export async function setupFolderFromTour(): Promise<boolean> {
  const [{ setupAtlasRoot }, { toastManager }] = await Promise.all([
    import('../setup/atlas-root-flow'),
    import('../ui/toast-manager'),
  ]);
  const result = await setupAtlasRoot();
  if (!result) return false;
  await exitTour();
  patchSlice('ui', { ...getState().ui, sidebarMode: 'worlds' });
  toastManager.success(
    result.imported > 0
      ? `OnlyWorlds folder set up: found ${result.imported} existing world${result.imported === 1 ? '' : 's'}`
      : 'Folder ready: create your first world from the Worlds sidebar'
  );
  return true;
}

/** Remove the tour world entirely (registry entry + handle + OPFS folder). */
async function teardownPriorTourWorld(): Promise<void> {
  const prior = readTourState();
  const reg = getState().registry;
  const entry = reg.worlds.find(w => (prior && prior.worldId && w.id === prior.worldId) || (w.demo === true && w.folder.folder_name.startsWith(TOUR_FOLDER)));
  if (entry) {
    const store = getActiveStore();
    if (getState().active?.worldId === entry.id && store) {
      await store.close().catch(() => {});
      setActiveStore(null);
      detachSyncEngine();
      patchSlice('active', null);
      patchSlice('data', { elements: [] });
    }
    const next = deleteWorldEntry(reg, entry.id);
    saveRegistry(next);
    patchSlice('registry', next);
    await deleteHandle(entry.folder.handle_key).catch(() => {});
  }
  try {
    const opfs = await navigator.storage.getDirectory();
    // Remove any prior tour folders (name is `hyperion-tour-<uuid8>`).
    for await (const [name] of (opfs as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
      if (name.startsWith(TOUR_FOLDER)) {
        await opfs.removeEntry(name, { recursive: true }).catch(() => {});
      }
    }
  } catch { /* OPFS unavailable — nothing to clean */ }
  writeTourState(null);
}

export { TOUR_FOLDER };
