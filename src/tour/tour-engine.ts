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
 * THE RESIDUE CONTRACT (v2, Captain's ruling; 1.17 adds the keep): the tour
 * leaves NOTHING behind unless the user keeps its world. The world is created
 * at the first hands-on step (not at boot) and torn down on a mid-tour Exit
 * or the finale's Start fresh — registry entry, handle, directory, all of it.
 * Exit returns to wherever the tour was launched from. The finale's Keep
 * makes it the user's own instead (`keepTourWorld`, `tour-keep.ts`), and a
 * keep once begun is finished, never torn down (contract §7.2).
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
import { awaitEviction, evictParkedStore, getActiveStore, setActiveStore } from '../core/active-store';
import { navigate, elementHash, mapHash, writingHash, timelineHash } from '../core/router';
import { saveRegistry, deleteWorldEntry, updateWorldEntry } from '../registry/registry';
import { deleteHandle } from '../store/handle-vault';
import { detachSyncEngine } from '../sync/sync-attach';
import type { Element, ElementType, WorldRegistryEntry } from '../core/types';
import { isBrowserWorld, removeBrowserWorldDir, worldHandleFor } from '../core/browser-worlds';
import { isQuietRef, TOUR_MAP_REF, TOUR_PIN_REF, TOUR_STEPS, type TourStep } from './tour-data';
import { mergeHealArray } from './tour-heal';
import { flushBeforeLeavingWorld } from '../core/leave-flush';
import { PlainError } from '../core/plain-error';
import { rekeyRouteHash } from '../sync/rekey-route';

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

/**
 * The re-key (S363) moves ids; stored state follows. The saved return hash is
 * a stored URL and may name a re-keyed element; null from the router = leave.
 */
export function remapTourReturnHash(worldId: string, map: ReadonlyMap<string, string>): void {
  const p = readTourState();
  if (!p || typeof p.returnHash !== 'string') return;
  const next = rekeyRouteHash(p.returnHash, worldId, map);
  if (next === null || next === p.returnHash) return;
  writeTourState({ ...p, returnHash: next });
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

/**
 * The active world is the tour's demo world (write-safety precondition). Its
 * world.json mirror must say demo too: a keep un-demoes world.json first (K2)
 * and the registry last (K4), and between them no step may write a bundle id
 * into a world whose ids are moving (S375 gate K1). An unreadable world.json
 * mirrors no `demo` either, so the tour writes nothing into it.
 */
export function tourWorldIsActive(): boolean {
  const p = readTourState();
  const active = getState().active;
  if (!p || !p.worldId || !active?.opened || active.worldId !== p.worldId) return false;
  if (active.meta?.demo !== true) return false;
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

/** Media assets the bundle references via `x_tour_media`.
 *  ⚠ An x_tour_media filename NOT in this map is silently skipped — when the
 *  bundle gains or renames an asset, this registry moves in the same commit
 *  (S312: the re-snapshot's new map webp was missed until the resilience e2e
 *  caught the map healing back imageless). */
const TOUR_MEDIA_URLS: Record<string, () => string> = {
  'unnamed-planet.webp': () => new URL('../demo/unnamed-planet.webp', import.meta.url).href,
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
 * Heal the bundle's link weave on already-revealed elements: back-fill
 * previously-stripped links, re-assert bundle scalar links, re-add links the
 * user removed — while PRESERVING the user's own link additions (the merge
 * kernel, `tour-heal.ts`). The patch is computed INSIDE the per-id write
 * chain (updateElementWith), so a concurrent user edit is never reverted
 * from a stale snapshot. Returns how many elements were patched.
 */
async function healLinks(universe: Set<string>, revealed: Set<string>, aliasesOn: boolean): Promise<number> {
  const store = getActiveStore();
  if (!store || !tourWorldIsActive()) return 0;
  const bundle = await loadBundle();
  let patched = 0;
  for (const el of bundle.elements) {
    if (!revealed.has(el.id)) continue;
    // Per-write guard: exit/world-switch mid-loop stops the heal cold rather
    // than letting queued writes land on a closing store.
    if (!tourWorldIsActive() || getActiveStore() !== store) break;
    let wrote = false;
    await store.updateElementWith(el.id, (onDisk) => {
      const rec = onDisk as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(el)) {
        if (k === 'id' || k === 'type' || k === 'x_tour_media') continue;
        if (k === 'atlas_aliases') {
          if (aliasesOn && Array.isArray(v)
              && JSON.stringify(v) !== JSON.stringify(rec[k] ?? null)) {
            patch[k] = v;
          }
          continue;
        }
        if (typeof v === 'string' && universe.has(v) && revealed.has(v) && rec[k] !== v) {
          patch[k] = v;
        } else if (Array.isArray(v) && v.some(i => typeof i === 'string' && universe.has(i))) {
          const have = Array.isArray(rec[k]) ? rec[k] as unknown[] : [];
          const { merged, changed } = mergeHealArray(v, have, revealed);
          if (changed) patch[k] = merged;
        }
      }
      wrote = Object.keys(patch).length > 0;
      return wrote ? (patch as Partial<Element>) : null;
    });
    if (wrote) patched++;
  }
  return patched;
}

/**
 * Media heal: the two x_tour_media elements (map, location) whose element
 * survived but whose image is gone (image_media_id unset — a cache-cheap
 * predicate; listMedia would put OPFS dir enumeration on the hot per-step
 * path) get the asset re-fetched and re-attached. Absent elements are
 * revealOne's job (its create path attaches media). Returns writes made.
 */
async function healMedia(revealed: Set<string>): Promise<number> {
  const store = getActiveStore();
  if (!store || !tourWorldIsActive()) return 0;
  const bundle = await loadBundle();
  let patched = 0;
  for (const el of bundle.elements) {
    const asset = (el as Record<string, unknown>).x_tour_media;
    if (typeof asset !== 'string' || !TOUR_MEDIA_URLS[asset]) continue;
    if (!revealed.has(el.id)) continue;
    if (!tourWorldIsActive() || getActiveStore() !== store) break;
    const onDisk = await store.getElement(el.id);
    if (!onDisk || (onDisk as Record<string, unknown>).image_media_id) continue;
    try {
      const resp = await fetch(TOUR_MEDIA_URLS[asset]());
      const blob = await resp.blob();
      // Re-check AFTER the (arbitrarily slow) fetch (gate MED, S299): a
      // teardown from startTour/launchTour — not serialized behind the step
      // chain like exitTour — could have swapped the store while we awaited.
      // Writing to the captured, now-closed store would land on a dead world.
      if (!tourWorldIsActive() || getActiveStore() !== store) break;
      const file = new File([blob], asset, { type: 'image/webp' });
      const media = await store.addMedia(el.id, file, 'base-image');
      await store.updateElement(el.id, { image_media_id: media.id } as Partial<Element>);
      patched++;
    } catch (err) {
      console.warn('[tour] media heal failed:', err);
    }
  }
  return patched;
}

/** Bundle refs the USER creates on a hands-on step (never auto-revealed on
 *  their own step; backfilled once the tour is strictly past). */
const HANDS_ON_REFS: Partial<Record<NonNullable<TourStep['handsOn']>, string>> = {
  'create-consul': 'character:The Consul',
  'place-pin': "pin:The Consul’s balcony seat",
};

/**
 * The bundle ref a step's hands-on gesture produces, if any — the single
 * source for "has this beat been performed", so the bar no longer needs a
 * bespoke `consulCreated()`/`tourPinPlaced()` pair to ask the same question.
 */
export function handsOnRefFor(step: TourStep): string | undefined {
  return step.handsOn ? HANDS_ON_REFS[step.handsOn] : undefined;
}

/**
 * Synchronous ref → id, for the phase predicates (which run inside render and
 * cannot await). Reads the module bundle cache, so it answers `undefined`
 * until the bundle chunk has loaded — the documented bundle-load window. Every
 * `hasRef` therefore reads false for that instant, which is why an opening
 * phase must never claim a deed.
 */
export function refToIdSync(ref: string): string | undefined {
  if (!bundleCache) return undefined;
  const idx = ref.indexOf(':');
  const type = ref.slice(0, idx);
  const name = ref.slice(idx + 1);
  return bundleCache.elements.find(e => e.type === type && e.name === name)?.id;
}

/** Ids of everything revealed by steps 0..i (plus passed hands-on elements). */
async function idsUpTo(stepIndex: number): Promise<Set<string>> {
  const revealed = new Set<string>();
  for (let i = 0; i <= Math.min(stepIndex, TOUR_STEPS.length - 1); i++) {
    const step = TOUR_STEPS[i];
    // A hands-on element is created by the USER on its own step — the
    // generic reveal only backfills it once the tour has moved past
    // (watch-mode Next, resume after reload, back-then-forward navigation).
    const handsOnRef = step.handsOn && HANDS_ON_REFS[step.handsOn];
    if (handsOnRef && i < stepIndex) {
      const r = await resolveRef(handsOnRef);
      if (r) revealed.add(r.el.id);
    }
    // `creates` refs are the same shape one level up: the USER mints them via
    // the scripted + door on their own step, and the generic reveal backfills
    // them once the tour is strictly past.
    if (i < stepIndex) {
      for (const ref of step.creates ?? []) {
        const r = await resolveRef(ref);
        if (r) revealed.add(r.el.id);
      }
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

/**
 * The set of bundle ids a LINK may point at, which is NOT the same as the set
 * of elements this step creates (gate R1/R2, S301).
 *
 * Stripping exists for one reason: never render a chip pointing at something
 * that is not there. So the honest rule is **never strip a link whose target
 * is present on disk**, whoever put it there. Two bugs die with it:
 *
 *  - a user-minted element (the `creates` door) linked to another element
 *    minted seconds earlier had that link deleted, so the objects step
 *    taught "the balcony's parent object is the spaceship" on a page whose
 *    Parent object was empty;
 *  - stepping BACK into a completed step re-stripped links off elements that
 *    still exist, so the chips the user had just watched appear vanished and
 *    oscillated on every back/forward.
 *
 * The CREATE set stays strictly step-keyed (below) — this only widens what a
 * surviving link may reference.
 */
async function linkableIds(universe: Set<string>, revealed: Set<string>): Promise<Set<string>> {
  const store = getActiveStore();
  if (!store) return revealed;
  const effective = new Set(revealed);
  try {
    for (const el of await store.listElements()) {
      if (universe.has(el.id)) effective.add(el.id);
    }
  } catch { /* store closing mid-teardown — the step-keyed set still serves */ }
  return effective;
}

/** Idempotently ensure everything up to `stepIndex` is on disk, links healed. */
async function revealUpTo(stepIndex: number): Promise<void> {
  const universe = await bundleIds();
  const revealed = await idsUpTo(stepIndex);
  const linkable = await linkableIds(universe, revealed);
  const aliasesOn = await aliasesOnFor(linkable);
  const bundle = await loadBundle();
  let wrote = false;
  // Newly-written NON-QUIET elements flash in the sidebar (Captain, S316):
  // the preview stack promises them one step ahead, the flash marks their
  // arrival. Quiet machinery (markers, the calendar construct) lands silently.
  const flashIds: string[] = [];
  for (const el of bundle.elements) {
    // CREATION is step-keyed: a hands-on/creates element is the USER's to
    // make on its own step. `linkable` never widens what gets written.
    if (!revealed.has(el.id)) continue;
    if (await revealOne(el, universe, linkable, aliasesOn)) {
      wrote = true;
      if (!isQuietRef(`${el.type}:${el.name}`)) flashIds.push(el.id);
    }
  }
  const healed = await healLinks(universe, linkable, aliasesOn);
  const mediaHealed = await healMedia(linkable);
  // ANY heal write refreshes in the same step-enter (gate C5, two lenses
  // convergent on the media leg) — a healed link or re-attached image must
  // be visible on the surface the user is looking at, not next tick.
  if (wrote || healed > 0 || mediaHealed > 0) await refreshElements();
  // AFTER the refresh, so the rows exist when the highlight paints them.
  // S317 (Captain): not the 1.4s pulse — a SUBTLE, STICKY highlight that
  // stays on the step's new arrivals for as long as the step is live. The
  // dispatch is unconditional: a step that reveals nothing CLEARS the
  // previous step's set. The DOM event keeps the engine from importing UI
  // modules, same as sync-attach's dispatch.
  document.dispatchEvent(new CustomEvent('atlas:tour-fresh-ids', { detail: { ids: flashIds } }));
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
      // NOT-YET-REVEALED REF → NEUTRAL SURFACE, never "leave it as it was"
      // and never a dead element page (S307).
      //
      // Two traps here, and own-eyes caught the second one:
      //   1. The old code returned SILENTLY when a route could not be taken,
      //      leaving the PREVIOUS step's element on screen while the narrator
      //      talked about this one — the "jumping" Captain reported.
      //   2. `resolveRef` resolves against the BUNDLE, not the store, so it
      //      succeeds for every scripted element whether or not it has been
      //      revealed yet. Routing on that alone sent the hands-on consul
      //      beat to a raw uuid reading "not found in this world" — worse
      //      than the bug it replaced, and every e2e stayed green because
      //      none of them assert what the middle pane SHOWS at that step.
      //
      // So the gate is existence ON DISK. World home is the honest answer to
      // "that thing is not made yet".
      const onDisk = r ? getState().data.elements.some(e => e.id === r.el.id) : false;
      if (!onDisk) { navigate(`#/w/${worldId}`); }
      else if (r) {
        if (route.kind === 'map') {
          // Optional element selection (the pin beat): open the map AND show
          // the element's detail in the middle so its +pin button appears.
          const elRef = route.elementRef ? await resolveRef(route.elementRef) : null;
          if (elRef) {
            patchSlice('ui', { ...getState().ui, selectedElementId: elRef.el.id });
            navigate(mapHash(worldId, r.el.id, elRef.el.id));
          } else {
            navigate(mapHash(worldId, r.el.id));
          }
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
  // Exit can race the scaffold await (gate HIGH-1): if the tour was torn
  // down meanwhile, the just-created world would linger as a phantom demo
  // entry with isTourActive() false — the residue contract's one leak.
  // Teardown's demo+prefix sweep is exactly the rollback.
  const after = readTourState();
  if (!after?.active) {
    await teardownPriorTourWorld(entry.id);
    return;
  }
  writeTourState({ ...after, worldId: entry.id });
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

/**
 * Lifecycle flags the BAR reads to suppress state-driven renders (gate R4 +
 * R13). Both exist because the bar now subscribes to core state, so every
 * write inside a step-enter or a teardown would otherwise repaint the panel
 * mid-flight:
 *
 *  - `enteringStep`: the panel would paint the NEW step's copy while the OLD
 *    step's reveal is still writing and before `routeFor` navigates, so
 *    narration and surface desynchronize for the length of the slowest reveal
 *    (14 elements on the swamps step). The single emit at the end of
 *    `enterStepNow` stays the authoritative post-step paint.
 *  - `tearingDown`: teardown lands several state writes while the tour flag is
 *    still set, so the panel would visibly rewind to phase A before unmounting.
 */
let enteringStep = false;
let tearingDown = false;
/** A keep is running (contract §7.3 K0): ids move under the panel, which must not repaint. */
let keeping = false;
export function tourIsSettling(): boolean {
  return enteringStep || tearingDown || keeping;
}

async function enterStepNow(index: number): Promise<void> {
  const p = readTourState();
  if (!p) return;
  enteringStep = true;
  try {
    await enterStepInner(index);
  } finally {
    enteringStep = false;
  }
  // The single authoritative post-step paint, emitted AFTER the flag clears so
  // the bar's own listener is allowed through (close gate, MED): the flag used
  // to guard only the state subscription, while `writeTourState`'s emit at the
  // TOP of enterStepInner still repainted the new step's copy — and its stage
  // and highlight classes — before the reveal wrote anything and before
  // `routeFor` navigated. The comment claimed that desync was prevented; it
  // was not.
  emit();
}

async function enterStepInner(index: number): Promise<void> {
  const clamped = Math.max(0, Math.min(index, TOUR_STEPS.length - 1));
  // Watch-mode for the world beat: advancing past it creates the world.
  if (clamped > worldStepIndex() && !tourWorldExists()) {
    await createTourWorld();
  }
  writeTourState({ ...readTourState()!, step: clamped });
  // A pin placement armed on a prior step must not survive a navigation
  // (gate MED, S299): a leftover arm + a map click on a later map step mints
  // a SECOND consul pin (tourPinBake declines once the bundle pin exists).
  // Leaving the pin step disarms; re-entering it re-offers the button.
  if (getState().ui.pinPlacement) {
    patchSlice('ui', { ...getState().ui, pinPlacement: null });
  }
  await revealUpTo(clamped);
  await routeFor(TOUR_STEPS[clamped]);
  // Tour state lives in localStorage, invisible to state subscribers — tick
  // the ui slice so stage-dependent chrome (sidebar header, welcome panel)
  // re-renders each step (the force-render idiom, convention #2).
  patchSlice('ui', { ...getState().ui });
  // After the route's render lands, bring the step's narrated section on
  // screen (S309: the linking payoff sat below the dock). Fire-and-forget —
  // scrolling must never block or fail the step chain.
  const scrollTo = TOUR_STEPS[clamped].scrollToSection;
  if (scrollTo) void scrollSectionIntoView(scrollTo);
  // The writing beat autofocuses the editor (Captain, S317): hover+Tab only
  // works once the editor holds a selection, and asking a beginner to "click
  // in first" is exactly the confusion the beat teaches around. Tour-only —
  // app-wide autofocus would steal focus on every room switch.
  if (TOUR_STEPS[clamped].route?.kind === 'writing') void focusWritingEditor();
  // (The closing emit moved to enterStepNow, so it fires AFTER `enteringStep`
  // clears and the bar's own listener is allowed through.)
}

/**
 * Poll briefly for the named element-detail section, then scroll it into
 * view. The detail pane renders on the state tick AFTER the route lands, so
 * one immediate query would race it — a short bounded poll is the honest
 * form (no MutationObserver machinery for a one-shot cosmetic scroll).
 *
 * S312: this used a smooth `scrollIntoView` and the walk caught it landing at
 * scrollTop 0 — a step-enter heal re-renders the pane moments later and the
 * detail's scroll-preservation memory restores the STALE saved position,
 * silently undoing the animation. Setting the scroller's scrollTop directly
 * fires the scroll listener, so the memory records the tour's position and
 * later re-renders restore exactly it; the re-applies cover a heal that
 * rebuilds before the first assignment is recorded.
 */
async function scrollSectionIntoView(name: string): Promise<void> {
  const apply = () => {
    const target = document.querySelector<HTMLElement>(
      `.atlas-detail-section[data-section="${name}"]`,
    );
    if (!target) return;
    let s: HTMLElement | null = target.parentElement;
    while (s && s !== document.body) {
      const st = getComputedStyle(s);
      if (/(auto|scroll)/.test(st.overflowY) && s.scrollHeight > s.clientHeight + 1) break;
      s = s.parentElement;
    }
    if (!s || s === document.body) { target.scrollIntoView({ block: 'start' }); return; }
    s.scrollTop = target.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop;
  };
  for (let i = 0; i < 15; i++) {
    if (document.querySelector(`.atlas-detail-section[data-section="${name}"]`)) {
      apply();
      setTimeout(apply, 250);
      setTimeout(apply, 700);
      return;
    }
    await new Promise(r => setTimeout(r, 100));
  }
}

/**
 * Focus the writing editor once it mounts (bounded poll, same shape as
 * scrollSectionIntoView — the room renders on the state tick after the route
 * lands). Focusing the ProseMirror host gives it a real selection at the doc
 * start, which is what makes hover+Tab work without a click-in first.
 */
async function focusWritingEditor(): Promise<void> {
  for (let i = 0; i < 15; i++) {
    const pm = document.querySelector<HTMLElement>('.ProseMirror');
    if (pm) { pm.focus(); return; }
    await new Promise(r => setTimeout(r, 100));
  }
}

/**
 * Drain the step chain — the settle signal for tests.
 *
 * A step's own `data-tour-step` attribute is NOT a settle signal: the panel
 * re-renders from `writeTourState`'s emit, which fires BEFORE `revealUpTo`
 * heals and before `routeFor` navigates. A test that syncs on the attribute
 * therefore reads the world mid-step and can pass whatever the code does
 * (this is exactly how a back-navigation regression test passed against the
 * bug it was written for). Mirrors `FsFolderStore.awaitTidies`.
 */
export function awaitTourSettled(): Promise<void> {
  return stepChain.catch(() => { /* a failed step still settles */ });
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

// ---------------------------------------------------------------------------
// The place-pin hands-on beat (S299): rides the app's REAL pin-placement
// mode (ui.pinPlacement → map-click drops the pin) — the tour teaches the
// actual gesture, not a tour-only imitation. The tour's contribution is
// IDENTITY: the placed pin is the bundle pin (locked name + id, the
// reveal/heal system's handle), at the user's own coordinates (theirs to
// keep — C3, positions are user data).
// ---------------------------------------------------------------------------

/**
 * Baked identity for a tour placement: when the armed element is the consul
 * on the tour map and the bundle pin is absent, the created pin IS the
 * bundle pin. Null = ordinary placement (no override).
 */
export async function tourPinBake(
  elementId: string,
  mapId: string,
): Promise<{ id: string; name: string } | null> {
  if (!tourWorldIsActive()) return null;
  // Refs via the shared constants (S312): this held a hardcoded
  // 'map:Hyperion' literal, and when the map was renamed in the re-snapshot
  // the lookup failed OPEN — bake declined, and the pin beat minted a
  // nameless ordinary pin that could never satisfy hasRef(TOUR_PIN_REF).
  // The S308 dead-gate class, in engine clothing; the e2e caught it.
  const consul = await resolveRef('character:The Consul');
  const pin = await resolveRef(TOUR_PIN_REF);
  const map = await resolveRef(TOUR_MAP_REF);
  if (!consul || !pin || !map) return null;
  if (elementId !== consul.el.id || mapId !== map.el.id) return null;
  if (getState().data.elements.some(e => e.id === pin.el.id)) return null;
  return { id: pin.el.id, name: pin.el.name ?? '' };
}

/**
 * Mint the next un-minted ref of the current step's `creates` run.
 *
 * SERIALIZED, with the next ref computed INSIDE the chain (gate R9, the
 * `enqueueStep` idiom for the same reason): two fast clicks both computing
 * "next un-minted" against one pre-click snapshot mint the SAME element twice,
 * so the third ref never lands and Next never appears.
 *
 * Resolves false when there is nothing to mint — the caller then opens the
 * ordinary create modal rather than leaving a dead button (gate R8).
 */
let mintChain: Promise<void> = Promise.resolve();
export function mintNextCreate(): Promise<boolean> {
  let minted = false;
  mintChain = mintChain
    .catch(() => { /* a failed mint must not wedge the run */ })
    .then(async () => { minted = await mintNextCreateNow(); });
  return mintChain.then(() => minted);
}

async function mintNextCreateNow(): Promise<boolean> {
  if (!isTourActive() || !tourWorldIsActive()) return false;
  const step = currentStep();
  const refs = step.creates ?? [];
  if (refs.length === 0) return false;
  // The bundle index must be resolved before "un-minted" means anything:
  // pre-load every ref reads absent and we would mint the first one twice.
  await loadBundle();

  const present = new Set(getState().data.elements.map(e => e.id));
  const nextRef = refs.find(ref => {
    const id = refToIdSync(ref);
    return id !== undefined && !present.has(id);
  });
  if (!nextRef) return false; // the run is complete

  const resolved = await resolveRef(nextRef);
  if (!resolved) return false;

  const universe = await bundleIds();
  const revealed = await idsUpTo(currentStepIndex());
  // `linkableIds` reads what is ON DISK, so the sibling minted a moment ago is
  // already in the set — which is the whole of gate R1: the balcony keeps its
  // parent_object link to the spaceship the user made two clicks earlier,
  // instead of the objects step teaching that relationship on a page whose
  // Parent object is empty.
  const linkable = await linkableIds(universe, revealed);
  const aliasesOn = await aliasesOnFor(linkable);
  // revealOne declines if the store went away or the world switched during the
  // six awaits above, and reporting a mint that never landed is exactly the
  // dead + button gate R8 exists to prevent: the click would be swallowed with
  // nothing created and no modal (close gate, MED).
  const wrote = await revealOne(resolved.el, universe, linkable, aliasesOn);
  if (!wrote) return false;
  await refreshElements();

  // Re-heal against the NOW-wider set so already-revealed subjects backfill
  // immediately: the Consul's Possessions gain the object in the same beat the
  // user makes it, not on the next Next.
  //
  // Note for whoever prunes this later: the widened set is used TWICE here (at
  // write time above, and in the heal below), and the e2e locks the OUTCOME,
  // not each mechanism — reverting either one alone still leaves the balcony's
  // parent_object intact, because the other repairs it. Revert BOTH and the
  // link goes null, which is the gate's headline bug. So neither is dead code;
  // they cover different orders of arrival.
  const healed = await healLinks(universe, await linkableIds(universe, revealed), aliasesOn);
  if (healed > 0) await refreshElements();
  // Open the page of what was just made (Captain, S312) — a silent mint used
  // to leave the middle pane parked on the step's route (the Consul), so the
  // freshly created object was only visible as a sidebar row. Navigating is
  // the app's honest create behaviour, and with empty fields hidden the new
  // page shows exactly its links (the balcony's parent object, etc.). The
  // step's own route still fires on step-enter, so back-nav is unaffected.
  const tourWorldId = getState().active?.worldId;
  if (tourWorldId && tourWorldIsActive()) navigate(elementHash(tourWorldId, resolved.el.id));
  emit();
  return true;
}

// (`tourPinPlaced()` was DELETED in S302's close gate: its last caller went
// when the bar moved to `handsOnRefFor` + `view.hasRef`. Worse than unused, it
// was world-BLIND — no `tourWorldIsActive()` check — so a future caller
// reaching for the obvious-looking helper would have got a different answer
// than the bar's predicate on the user's own world.)

/**
 * The tour runs on a BARE STAGE, and until S307 `startTour` only ever
 * *assumed* one instead of establishing it. Every launch it had been tested
 * against — the first-launch landing, every e2e — arrived with no active
 * world, no atlas root and a `#/` route, so the assumption held by accident.
 *
 * The settings REPLAY row breaks all three at once: the user has their own
 * world open, a folder set up, and a route pointing at their own settings
 * page. None of it was cleared. Step 0 hid the evidence (no `unlocks`, so the
 * shell is masked); step 1 unlocked the shell and revealed the previous
 * world's settings page sitting under the tour dock, with that world still
 * open and still syncing.
 *
 * So: the stage is now MADE, not assumed. Every surface listed here is one a
 * replayer carried in.
 */
async function clearStageForTour(): Promise<void> {
  // The world the tour replaces may have a room save pending (S360 F1).
  await flushBeforeLeavingWorld();
  const store = getActiveStore();
  if (getState().active && store) {
    await store.close().catch(() => {});
    setActiveStore(null);
    detachSyncEngine();
  }
  patchSlice('active', null);
  patchSlice('data', { elements: [] });
  const ui = getState().ui;
  patchSlice('ui', {
    ...ui,
    // Only `createTourWorld` (step 2) used to set this, so steps 0-1 rendered
    // whatever mode the user was left in — and a FINISHED tour explicitly
    // leaves it on 'worlds', which is why the all-worlds list showed.
    sidebarMode: 'worlds',
    selectedElementId: null,
    // The previous world's map tabs were live under the dock. `[]` is not the
    // resting shape — the map index is always present (see createInitialState).
    rightTabs: [{ kind: 'map-index' as const }],
    rightActiveIndex: 0,
    pinPlacement: null,
  });
  // `routeFor` cannot do this: it is gated on a worldId that is '' by
  // construction until the create-world beat, and step 0 has no route at all.
  // Nothing else in the start path navigates, so the launching route survived.
  if (window.location.hash !== '#/') navigate('#/');
}

/**
 * Start (or restart) the tour: tear down any prior tour world, clear the
 * stage of whatever the launcher was doing, enter the bare stage at step 0.
 * The world is NOT created here — that is the first hands-on beat.
 */
export async function startTour(returnHash?: string): Promise<void> {
  // A keep that began and cannot finish yet is never replaced by a new tour:
  // its tour state stays, so the next boot finishes it (S375 gate K3).
  if (await teardownPriorTourWorld() === 'stays') {
    throw new PlainError('The last tour world is not kept yet. Reload Atlas to finish keeping it, then replay the tour.');
  }
  await clearStageForTour();
  writeTourState({ active: true, step: 0, worldId: '', returnHash });
  await enterStep(0);
}

/**
 * Start the tour AND mount its bar — the one entry point every launching
 * surface uses (landing door, settings replay row). Captures the launch
 * location so exit can return there.
 */
export async function launchTour(): Promise<void> {
  // Every door ends here (landing, Settings replay): a window that refuses
  // browser storage says so in one plain line instead of stalling at the
  // first create with a raw SecurityError (S366). A PlainError (S369): the
  // callers' showProblem shows it as its own sentence.
  const { opfsStatus, NO_BROWSER_STORAGE_LINE } = await import('../core/capabilities');
  const storage = await opfsStatus();
  if (storage === 'full') throw new PlainError((await import('../core/problems')).browserStorageFullSentence('starting the tour'));
  if (storage !== 'ok') throw new PlainError(NO_BROWSER_STORAGE_LINE);
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
    // A keep that began before the tab closed (world.json un-demoed, K2) is
    // finished, never re-entered as a step: a reveal would bring back bundle
    // ids beside the new ones (contract §7.2, lens A A5). The keep opens the
    // world itself and changes nothing when it cannot.
    if (isBrowserWorld(entry) && await entryFolderState(entry) === 'kept') {
      await keepTourWorld();
      return;
    }
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
export function exitTour(): Promise<void> {
  // Serialized behind any in-flight step (gate HIGH-1/MED-3): teardown never
  // interleaves a running reveal/heal — the step finishes (its per-write
  // guards see the flag flip and bail), THEN the world comes down.
  stepChain = stepChain
    .catch(() => { /* prior step failed — exit proceeds regardless */ })
    .then(() => exitTourNow());
  return stepChain;
}

async function exitTourNow(): Promise<void> {
  const p = readTourState();
  if (!p) return;
  // Suppress the bar's state-driven renders for the whole teardown (gate R4):
  // the several patchSlice calls below all land while the tour flag is still
  // set, so a subscribed panel would visibly rewind to phase A on its way out.
  tearingDown = true;
  try {
    await exitTourInner(p);
  } finally {
    tearingDown = false;
  }
}

async function exitTourInner(p: TourPersist): Promise<void> {
  const returnTo = p.returnHash || '#/';
  // Flag BEFORE teardown: the teardown's registry patch is the state tick
  // the landing re-renders on — set after, the emphasis swap misses it.
  const wasDone = tourWasCompleted();
  try { localStorage.setItem(TOUR_DONE_KEY, '1'); } catch { /* private mode */ }
  // A still-armed pin placement must not survive into the next world (a
  // stray map click there would toast "element not found").
  if (getState().ui.pinPlacement) {
    patchSlice('ui', { ...getState().ui, pinPlacement: null });
  }
  // A keep that had begun is finished, not deleted (contract §7.2): the
  // user stays in the kept world, or at the finale when it could not finish,
  // and then the tour is not done (S375 gate K2).
  const outcome = await teardownPriorTourWorld();
  if (outcome === 'stays' && !wasDone) {
    try { localStorage.removeItem(TOUR_DONE_KEY); } catch { /* private mode */ }
  }
  if (outcome !== 'gone') return;
  navigate(returnTo);
  // The teardown's state ticks ran while the tour flag was still set — tick
  // once more so tour-aware chrome (the bare splash, sidebar) settles on the
  // post-tour truth.
  patchSlice('ui', { ...getState().ui });
}

/**
 * Keep the tour world (1.17, contract §7.3): the finale's Keep and Save it to
 * a folder run here, ON the step chain like `exitTour`, so a queued Next,
 * Back or Finish finishes first and anything queued after finds no tour.
 * K0 lives here because it needs the engine's own chains: the `keeping` flag
 * (the bar stays mounted and must not repaint while ids move), the mint
 * chain drained (a mint that passed its checks before the click could write
 * a bundle id after the re-key, a twin), pin placement disarmed. The rest is
 * `tour-keep.ts`.
 */
export function keepTourWorld(opts: { quiet?: boolean } = {}): Promise<{ kind: 'kept' | 'refused' | 'gone'; entry?: WorldRegistryEntry }> {
  let outcome: { kind: 'kept' | 'refused' | 'gone'; entry?: WorldRegistryEntry } = { kind: 'gone' };
  stepChain = stepChain
    .catch(() => { /* prior step failed — the keep proceeds regardless */ })
    .then(async () => {
      const p = readTourState();
      if (!p?.active || !p.worldId) return;
      keeping = true;
      try {
        await mintChain.catch(() => { /* a failed mint wrote nothing */ });
        if (getState().ui.pinPlacement) {
          patchSlice('ui', { ...getState().ui, pinPlacement: null });
        }
        const { keepTourWorldNow } = await import('./tour-keep');
        outcome = await keepTourWorldNow(p.worldId, opts);
      } finally {
        keeping = false;
      }
      // A keep that did not finish leaves the tour at the finale: repaint it.
      if (outcome.kind !== 'kept') emit();
    });
  return stepChain.then(() => outcome);
}

/**
 * K4, the keep's commit (contract §7.3): one synchronous run, ordered so every
 * prefix a crash could leave is safe. (1) the done key; (2) the registry
 * entry loses `demo` (with TK still set, boot's resume finds no demo entry
 * and clears TK: a normal kept world); (3) TK goes, without emitting; (4) the
 * state learns it, then one emit, so no render sees half of it (TK on with
 * the registry off would drop the world from the touring list). REG before
 * TK: the other order leaves a demo world with no tour, hidden and sandboxed.
 */
export function commitTourKeep(worldId: string): void {
  try { localStorage.setItem(TOUR_DONE_KEY, '1'); } catch { /* private mode */ }
  const next = updateWorldEntry(getState().registry, worldId, { demo: undefined });
  saveRegistry(next);
  try { localStorage.removeItem(TOUR_STATE_KEY); } catch { /* private mode */ }
  patchSlice('registry', next);
  emit();
}

/**
 * The tour world was made by 1.16 or earlier (no `where`, its folder at the
 * OPFS root): its finale offers Start fresh only (contract §7.1, lens B B14),
 * since keeping it would leave a world outside the browser home.
 */
export function tourWorldIsLegacy(): boolean {
  const p = readTourState();
  if (!p?.worldId) return false;
  const entry = getState().registry.worlds.find(w => w.id === p.worldId);
  return !!entry && !entry.where;
}

/**
 * Forget the per-map UI state the tour world leaves in localStorage: its
 * right-pane map tabs and their saved cameras.
 *
 * The residue contract said "registry entry, handle, OPFS folder" and those
 * three were honoured, but two keys outlive them: `atlas_right_tabs` keeps a
 * map tab stamped with the tour world's id, and `atlas_map_camera_state`
 * keeps that map's camera. The visible cost is a ghost "Hyperion" tab on the
 * FIRST world a tour-finisher creates, reading "This map isn't in the current
 * world / It may have been deleted" — the first minute of real use, right
 * after a tour that promised to leave nothing behind.
 *
 * Bundle-driven rather than reading live state: teardown also runs on paths
 * where the elements slice is already gone (restart, resume-of-a-dead-world).
 */
async function forgetTourMapUiState(worldId: string): Promise<void> {
  try {
    const [{ dropPersistedTabsForWorld }, { clearCameraState }] = await Promise.all([
      import('../tabs/right/right-tabs-persistence'),
      import('../core/map-camera-persist'),
    ]);
    if (worldId) dropPersistedTabsForWorld(worldId);
    const bundle = await loadBundle();
    for (const el of bundle.elements) {
      if (el.type === 'map') clearCameraState(el.id);
    }
    // Drop the live tabs too: the persisted copy above is what survives a
    // reload, but the pane in front of the user right now reads from state.
    const ui = getState().ui;
    const tabs = ui.rightTabs.filter(t => !(t.kind === 'map' && t.worldId === worldId));
    if (tabs.length !== ui.rightTabs.length) {
      patchSlice('ui', {
        ...ui,
        rightTabs: tabs,
        rightActiveIndex: Math.max(0, Math.min(ui.rightActiveIndex, tabs.length - 1)),
      });
    }
  } catch (err) {
    console.warn('[tour] map ui cleanup failed:', err);
  }
}

/**
 * Is this browser-storage folder a tour world? Its world.json says
 * `demo: true`, or it has none (the scaffold was interrupted before the first
 * write). Anything else is somebody's world, whatever its name (S366).
 */
export async function isTourFolder(dir: FileSystemDirectoryHandle): Promise<boolean> {
  let text: string;
  try {
    text = await (await (await dir.getFileHandle('world.json')).getFile()).text();
  } catch (err) {
    return (err as { name?: string })?.name === 'NotFoundError';
  }
  try {
    return (JSON.parse(text) as { demo?: unknown })?.demo === true;
  } catch {
    return false; // unreadable: never delete what we cannot identify
  }
}

/**
 * What the tour world's own directory says it is (1.17, contract §7.2): the
 * keep un-demos world.json first (K2), so this is the one place that knows a
 * keep began. 'tour': world.json says demo, or is not written yet. 'kept':
 * it parses and does not say demo. 'unknown': empty (a crash inside the write,
 * lens A M5) or unreadable, and nothing is decided on it. Never read from
 * `active.meta`: an unreadable file falls back to `{ id: '', name: '' }`
 * there, which would read as kept.
 */
export type TourFolderState = 'tour' | 'kept' | 'unknown';
export async function tourFolderState(dir: FileSystemDirectoryHandle): Promise<TourFolderState> {
  let text: string;
  try {
    text = await (await (await dir.getFileHandle('world.json')).getFile()).text();
  } catch (err) {
    return (err as { name?: string })?.name === 'NotFoundError' ? 'tour' : 'unknown';
  }
  try {
    const meta = JSON.parse(text) as unknown;
    if (!meta || typeof meta !== 'object') return 'unknown';
    return (meta as { demo?: unknown }).demo === true ? 'tour' : 'kept';
  } catch {
    return 'unknown';
  }
}

/** `tourFolderState` of a browser tour world's registered directory; 'tour' when it is gone. */
async function entryFolderState(entry: WorldRegistryEntry): Promise<TourFolderState> {
  try {
    const found = await worldHandleFor(entry);
    return found.kind === 'ok' ? await tourFolderState(found.handle) : 'tour';
  } catch {
    return 'unknown';
  }
}

/**
 * A folder with no world.json that still holds element files is not provably
 * the tour's (a world whose world.json was lost): keep it (S370, lane C row i).
 * A tour folder WITH its world.json saying demo is the tour's whatever it holds.
 */
async function holdsUnclaimedElements(dir: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    await dir.getFileHandle('world.json');
    return false;
  } catch { /* no world.json: look for element files */ }
  try {
    const elements = await dir.getDirectoryHandle('elements');
    const types = (elements as unknown as { values(): AsyncIterable<FileSystemHandle> }).values();
    for await (const t of types) {
      if (t.kind !== 'directory') continue;
      const files = (t as unknown as { values(): AsyncIterable<FileSystemHandle> }).values();
      for await (const f of files) {
        if (f.kind === 'file' && f.name.endsWith('.json')) return true;
      }
    }
  } catch { /* no elements directory */ }
  return false;
}

/**
 * Remove prior tour folders from browser storage. A tour folder is named
 * `hyperion-tour-<uuid8>`, but so is a user's world called "Hyperion Tour"
 * (the same scaffold names both), so the NAME only nominates: a folder goes
 * only when `isTourFolder` says so. S366, the delete-by-name class S365's
 * gate found in "Delete world + folder".
 */
export async function sweepTourFolders(opfs: FileSystemDirectoryHandle): Promise<string[]> {
  const removed: string[] = [];
  const entries = (opfs as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
  for await (const [name, handle] of entries) {
    if (!name.startsWith(TOUR_FOLDER) || handle.kind !== 'directory') continue;
    if (await isTourFolder(handle as FileSystemDirectoryHandle) && !(await holdsUnclaimedElements(handle as FileSystemDirectoryHandle))) {
      await opfs.removeEntry(name, { recursive: true }).then(() => removed.push(name), () => {});
    }
  }
  return removed;
}

/**
 * Which registry entry is the tour's sandbox? (S370 gate A4/B13.) The one the
 * tour state names, but only while it is still demo (a kept world is not the
 * tour's to delete); else a demo world in browser storage (the scaffold-race
 * rollback runs with no tour state); else a 1.16 tour entry (no `where`, its
 * folder at the OPFS root under the old prefix).
 */
export function pickTourEntry(
  worlds: readonly WorldRegistryEntry[],
  priorWorldId: string | undefined | null,
): WorldRegistryEntry | undefined {
  if (priorWorldId) {
    const named = worlds.find(w => w.id === priorWorldId && w.demo === true);
    if (named) return named;
  }
  return worlds.find(w => w.demo === true && isBrowserWorld(w))
    ?? worlds.find(w => w.demo === true && !w.where && w.folder.folder_name.startsWith(TOUR_FOLDER));
}

/**
 * Remove the tour world entirely (registry entry + handle + its directory).
 * `knownId`: the scaffold-race rollback names the world it just made, since
 * the tour state has no world id then (lens A A4).
 *
 * A browser tour world's own world.json is read first (contract §7.2, lane K
 * headline 2): 'kept' means a keep began (K2 ran), so the keep is finished
 * (K3, K4, the world opened first) and nothing is deleted; when it cannot
 * finish, nothing changes and the next teardown or boot tries again.
 * 'unknown' deletes nothing either: the tour ends and the directory stays.
 */
async function teardownPriorTourWorld(knownId?: string): Promise<'gone' | 'kept' | 'stays'> {
  // Disarm any pending pin placement (gate MED scenario B, S299): a restart
  // that leaves it armed would toast "element not found" on the next run's
  // pre-consul map click.
  if (getState().ui.pinPlacement) {
    patchSlice('ui', { ...getState().ui, pinPlacement: null });
  }
  const prior = readTourState();
  const reg = getState().registry;
  const entry = pickTourEntry(reg.worlds, knownId ?? prior?.worldId);
  const state = entry && isBrowserWorld(entry) ? await entryFolderState(entry) : 'tour';
  if (entry && state === 'kept') {
    const { keepTourWorldNow } = await import('./tour-keep');
    return (await keepTourWorldNow(entry.id)).kind === 'kept' ? 'kept' : 'stays';
  }
  if (entry && state === 'unknown') {
    console.warn('[tour] the tour world\'s world.json is unreadable; it is left in place', entry.folder.folder_name);
    // Closed, not left open behind the landing (S375 gate K4).
    const store = getActiveStore();
    if (getState().active?.worldId === entry.id && store) {
      await store.close().catch(() => {});
      setActiveStore(null);
      detachSyncEngine();
      patchSlice('active', null);
      patchSlice('data', { elements: [] });
    }
    writeTourState(null);
    return 'gone';
  }
  if (entry) {
    const store = getActiveStore();
    if (getState().active?.worldId === entry.id && store) {
      await store.close().catch(() => {});
      setActiveStore(null);
      detachSyncEngine();
      patchSlice('active', null);
      patchSlice('data', { elements: [] });
    }
    // A tour world in the browser home goes by its registered entry, never by
    // name (contract §1.2); a parked store for it is closed first.
    if (isBrowserWorld(entry)) {
      evictParkedStore(entry.id);
      await awaitEviction(entry.id);
      await removeBrowserWorldDir(entry).catch(err => console.warn('[tour] could not remove the tour world', err));
    }
    const next = deleteWorldEntry(reg, entry.id);
    saveRegistry(next);
    patchSlice('registry', next);
    await deleteHandle(entry.folder.handle_key).catch(() => {});
    await forgetTourMapUiState(entry.id);
  }
  try {
    await sweepTourFolders(await navigator.storage.getDirectory());
  } catch { /* OPFS unavailable — nothing to clean */ }
  writeTourState(null);
  return 'gone';
}

export { TOUR_FOLDER };
