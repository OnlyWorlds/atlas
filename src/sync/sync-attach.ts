/**
 * Sync attachment — opens a SyncEngine for an api-linked world and wires its
 * state changes into `state.sync.activeSync` (consumed by the sync pill).
 *
 * Module-level singleton: at most one engine is attached at a time, matching
 * the "one active world" UI model. World switches detach the previous engine.
 *
 * Used by:
 * - `activateWorld` (worlds-sidebar.ts) when the activated entry is `api-linked`.
 * - `attachApi`-flipping flows (Make-Online, Link-Existing-API) after the
 *   registry state transitions.
 *
 * The PIN comes from `worldPin` (#104): the account PIN
 * (`state.registry.pin`), or for a world opened as an agent seat, that seat's
 * own secret. If it is missing when attach is called, we log + skip engine
 * creation; the UI surfaces this via the pill state.
 */

import { adoptPersistedDiskHold, forgetPersistedDiskHold, holdBigBatchAtOpen, isDiskHoldPersisted, BIG_BATCH } from '../core/live-folder';
import { OwV2ClientAdapter } from './ow-v2-client-adapter';
import { devV2Base } from './dev-api-base';
import { SyncEngine } from './sync-engine';
import { sameElements } from './same-elements';
import { patchSlice, getState, subscribe } from '../core/state';
import { getActiveStore, patchElementsFrom } from '../core/active-store';
import { askAboutPin, pinQuestionOut } from './pin-ask';
import { toastManager, type ToastAction } from '../ui/toast-manager';
import type { FolderStore } from '../store/folder-store';
import type { Element, WorldRegistryEntry, SyncEngineState } from '../core/types';
import { failureToastOnce, classifyFailure } from './sync-failure-copy';
import { noteRoundIssues } from './sync-issues';
import { buildFailureDetails, type FixId } from '../core/problems';
import { filesWhereOf, isBrowserWorld } from '../core/browser-worlds';
import { detailsContext, resolveFixes } from '../ui/problem-fixes';
import type { PerElementFailure } from '../core/types';
import { effectiveSyncPaused, saveRegistry, updateWorldEntry } from '../registry/registry';
import { isSeatWorld, worldPin } from '../core/seat';
import { waitsOnPin } from '../core/saves-online';
import { keyRefusalLine, seatRefusalLine } from './world-key-lines';
import { rosterFor } from './world-roster';
import { rosterIsShared, worldPullsOnOpen, worldSyncPolicy, type SyncPolicy } from './shared-world';
import { keptEditsLine, keptLine, roleChangeLine } from './role-change';
import { hiddenHeldLine, hiddenShownLine } from '../core/hidden-mark';
import { deleteRefusedLine, proposalAcceptedLine, proposalSentLine } from './proposal-lines';
import type { SyncResult } from '../core/types';
import { recordPinState } from '../registry/pin-proof';
import { rateWaitLine, waitWords } from './rate-wait';

let currentEngine: SyncEngine | null = null;
let currentWorldId: string | null = null;
/** The PIN the attached engine sends (the account's, or a seat's secret): what a refusal was of. */
let currentPin: string | undefined;
/** The attached engine's policy as its world stands now: read by `reapplySyncPolicy`. */
let currentPolicyNow: (() => SyncPolicy) | null = null;

/** A round re-reads the roster once its answer is this old (an invite accepted while the world is open). */
const ROUND_ROSTER_MAX_AGE_MS = 5 * 60_000;

/**
 * Attach a fresh SyncEngine to the given (api-linked) world's folder. Returns
 * the engine for callers that want to invoke `pushOnce()` etc. immediately,
 * or null if attachment isn't possible (not api-linked, missing PIN).
 *
 * Detaches the previous engine first (if any). Engines are not preserved
 * across world switches; if the user switches back, a fresh engine is built.
 *
 * Side effects (Phase 3.5+):
 *   - If `registry.sync_pause_all` is true OR `entry.sync_paused` is true,
 *     the engine starts paused (no autosave, no pulls).
 *   - If `registry.sync_pull_on_activate` is true AND not paused, fires a
 *     one-shot `pullNow()` after attach to catch up.
 *   - Default conflict policy comes from `registry.sync_default_policy` (or
 *     `local-wins` if not set).
 */
/**
 * `justLinked`: the attach Make Online itself performs. Its own failed
 * uploads are unstamped elements, which the big-batch rule would otherwise
 * report as "changed on disk" and hold for an answer, right after the user
 * clicked Link (and the foreign-id record waits on that answer). The link IS
 * the user's answer: flush unasked, report the failures.
 */
export function attachSyncEngine(
  entry: WorldRegistryEntry,
  folder: FolderStore,
  /** `justMoved`: the world just moved from this browser to a folder (1.17): what waits is the user's own editing. */
  opts: { justLinked?: boolean; justMoved?: boolean } = {},
): SyncEngine | null {
  // Always detach the previous engine first: at most one active at a time. The same world attached
  // again keeps its held-copy note: the count refresh at the end says it again, or takes it down.
  detachSyncEngine({ keepHeldNote: heldNoteWorld !== null && heldNoteWorld === entry.id });

  // A view-only copy (conv. 177) never syncs: its element ids are another
  // world's, and keel's ids are global.
  if (entry.state !== 'api-linked' || !entry.api || entry.copy_of) {
    closeHeldNote(); // no sync here now: nothing will count the note again
    return null;
  }

  const reg = getState().registry;
  const readOnly = !!entry.api.read_only;
  const pin = worldPin(entry, reg);
  // View-only worlds run on a READ key — no PIN exists or is needed
  // (keel reads are keyless-PIN; the engine never writes).
  if (!pin && !readOnly) {
    console.warn('[sync-attach] PIN missing — engine not attached for', entry.name);
    // The world waits on the PIN (an owner's open from onlyworlds.com, 1.125.0): a PIN that arrives,
    // from Settings here or another tab, attaches it (`watchRefusedPin`).
    watchRefusedPin();
    return null;
  }

  // v2 port: the engine talks the keel v2 dialect through the thin fetch
  // adapter — no SDK client in the sync path (the SDK survives only for
  // worlds.get validation at the link/settings surfaces).
  const adapter = new OwV2ClientAdapter({
    apiKey: entry.api.api_key,
    apiPin: readOnly ? '' : (pin as string),
    baseUrl: devV2Base() ?? undefined,
  });
  // Pause if either global or per-world pause flag is set.
  const shouldPause = effectiveSyncPaused(entry, reg); // one predicate
  // A linked world restored from a world file (1.17, contract §5.2): its
  // first round is reviewed whatever the policy, so the file's older edits
  // never overwrite newer ones on OnlyWorlds. Then the policy.
  let reviewFirst = entry.review_first_sync === true;
  // Whether others share this world decides its policy, and keel's
  // roster says so. Until keel has answered in this attach, nothing is
  // overwritten: the engine runs pause-and-review, the flush below waits for
  // the answer, and an edit made meanwhile meets the review. A paused world
  // asks nothing (it stays offline), so a resume pushes under the review and
  // its round asks; a world keel cannot answer for stays
  // under the review and asks again each round.
  let settling = !readOnly;
  const policyNow = (): SyncPolicy => worldSyncPolicy(
    getState().registry.worlds.find(w => w.id === entry.id) ?? entry,
    getState().registry,
    { reviewFirst, settling },
  );
  const engine = new SyncEngine({
    folder,
    client: adapter,
    readOnly,
    where: filesWhereOf(entry),
    apiWorldId: entry.api.world_id,
    seat: isSeatWorld(entry),
    // keel's 429 wait is the key's: a world opened again, or a PIN saved, finds the one still running.
    rateWaitKey: entry.api.api_key,
    policy: policyNow(),
    onStateChange: (s) => publishSyncState(entry.id, s),
    onSyncResult: (phase, result) => {
      // What this round said of the account PIN it sent (never a seat's secret, never beside a read key):
      // a write landed proves it; keel's refusal of the PIN says so.
      if (!readOnly && !isSeatWorld(entry) && currentEngine === engine) {
        const landed = result.pushed.creates + result.pushed.updates + result.pushed.deletes > 0;
        if (result.auth_blocked && result.auth_reason === 'pin') recordPinState(pin, 'refused');
        else if (landed) recordPinState(pin, 'proved');
      }
      // The review ends only after a round that really compared (not offline,
      // busy or refused) and left nothing open: a held conflict stays dirty,
      // and the next round under local-wins would push it.
      if (reviewFirst && !result.transient_blocked && !result.auth_blocked
        && result.conflicts.length === 0 && result.failures.length === 0) {
        void folder.readSyncState().then(st => {
          // A held world setting or x_ key holds the review too.
          if (!reviewFirst || (st.conflicts?.length ?? 0) > 0 || (st.meta_conflicts?.length ?? 0) > 0 || currentEngine !== engine) return;
          reviewFirst = false;
          engine.setPolicy(policyNow());
          const next = updateWorldEntry(getState().registry, entry.id, { review_first_sync: undefined });
          saveRegistry(next);
          patchSlice('registry', next);
        }).catch(() => {});
      }
      // A role that moved, and what this key no longer sees (conv. 151).
      if (currentEngine === engine) void noteRoleNews(entry.id, folder, result);
      // Hidden elements this key cannot put online, said once (conv. 170).
      if (currentEngine === engine) noteHiddenHeld(entry.id, result);
      // What keel took as proposals, and what it settled (conv. 163).
      if (currentEngine === engine) void noteProposalNews(entry.id, folder, result);
      // Someone joined or left while the world is open, or keel had not
      // answered yet: the next round runs under what the roster says now.
      if (!readOnly && !result.transient_blocked) void settle(ROUND_ROSTER_MAX_AGE_MS);
      // The list Settings → World and the pill read. Repaint the pill
      // when it moved: the sync slice is the pill's subscription.
      if (noteRoundIssues(entry.id, phase, result)) patchSlice('sync', { ...getState().sync });
      emitConflictToasts(phase, result, { worldId: entry.id, current: currentEngine === engine, policy: engine.getPolicy() });
    },
    // No onIdSwap hook: keel keeps client ids on CREATE (2026-07-12), and
    // Route 2 moves ids before any server call through the re-key kernel,
    // whose screen pass is `rekeyLiveUi`.
  });
  // Apply persisted debounce preference if the user configured one. Engine
  // default (5000ms) stands when registry has no value.
  if (typeof reg.sync_debounce_ms === 'number' && reg.sync_debounce_ms >= 0) {
    engine.setDebounceMs(reg.sync_debounce_ms);
  }

  currentEngine = engine;
  currentWorldId = entry.id;
  currentPin = pin;
  // "Kept here until you add your World PIN" is no longer true once an engine runs on a PIN.
  if (!readOnly) takeDownFirstChange(entry.id);
  currentPolicyNow = policyNow;
  watchRefusedPin();
  /** Ask the roster, and move the engine to what it says once keel has answered. */
  const settle = async (maxAgeMs: number): Promise<void> => {
    let answered = false;
    try {
      answered = await learnShared(entry.id, entry.api!.api_key, maxAgeMs);
    } catch (err) {
      console.warn('[atlas:sync] the roster read failed:', err);
    }
    if (currentEngine !== engine) return;
    if (answered) settling = false;
    await movePolicy(engine, folder, policyNow());
  };
  // A batch of outside edits that was waiting for the user's answer when the
  // world was left (or the page reloaded) keeps waiting:
  // the hold goes on BEFORE the flush-on-attach below, which would push it.
  // The link's own attach answers any question saved before it.
  if (opts.justLinked) forgetPersistedDiskHold(entry.id);
  // The account PIN keel already refused (`registry.pin_state`) is never sent again by itself: the engine
  // starts as that refusal left it (paused, the PIN's pill), and nothing below sends. A new PIN saved in
  // Settings, here or in another tab, clears the state and attaches afresh (`watchRefusedPin`). Never a
  // seat's secret or a read key (no account PIN). Before the disk hold: the refusal outlasts its answer.
  const pinRefused = !readOnly && !isSeatWorld(entry) && reg.pin_state === 'refused' && reg.pin === pin;
  if (pinRefused) engine.startRefused('pin');
  if (!readOnly) adoptPersistedDiskHold(entry.id, engine);
  currentFolder = folder;

  console.info('[atlas:sync] engine attached', {
    world: entry.name,
    worldId: entry.id,
    apiWorldId: entry.api.world_id,
    policy: engine.getPolicy(),
    settling,
    sharedWithOthers: entry.shared_with_others ?? null,
    pullOnActivate: !!reg.sync_pull_on_activate,
    cadenceMs: reg.sync_cadence_ms ?? null,
    globalPaused: !!reg.sync_pause_all,
    worldPaused: !!entry.sync_paused,
  });

  if (shouldPause) {
    engine.pause('manual');
  }

  // Seed the slice with the engine's initial state.
  publishSyncState(entry.id, engine.getState());
  void refreshKeptCount(entry.id, folder);
  // Refresh conflict count from sync-state.json — engine doesn't know yet.
  void refreshConflictsCount();

  // Sequence flush + pull-on-activate via a single async chain. Without this
  // ordering, both fire-and-forget and race for the engine's shared `inFlight`
  // lock: whichever loses the race silently returns the winner's promise. In
  // practice that meant `flushPendingOnAttach`'s `pushOnce()` returned the
  // pull's promise, `pushed.* === 0`, no "synced N pending" toast, and the
  // stranded edits never reached the server until the next user-driven write
  // re-armed the autosave debounce.
  //
  // Order: flush goes FIRST. Pending writes already encode user intent (they
  // typed in a prior session, lost the debounce to a reload) and should land
  // server-side before pull-on-activate looks for newer remote changes. Flush
  // is unconditional when pending exist; pull-on-activate is opt-in, except
  // in a world shared with others.
  //
  // Before the flush, the roster: the flush is the round most likely
  // to meet a collaborator's newer words (edits from a last session against a
  // world others kept writing), so its policy must be known before it runs.
  // The read is bounded (`world-roster.ts`, 15 s); offline or refused, the
  // world stays under the review until keel answers.
  if (!shouldPause && !pinRefused) {
    void (async () => {
      // Inside a 429's wait the roster is not asked (it goes on the same key); the world stays under the
      // review until a round after the wait asks it.
      if (!readOnly && !engine.rateWaitNow()) {
        await settle(0);
        if (currentEngine !== engine) return;
      }
      // View-only: nothing local can be pending (writes are blocked at the
      // store seam), so the flush is skipped — and the pull-on-activate runs
      // UNCONDITIONALLY: a viewer's whole intent is seeing the world's current
      // state, and the local-first push asymmetry doesn't apply (no pushes).
      if (!readOnly) {
        try {
          await flushPendingOnAttach(engine, folder, entry.name, entry.id, !!opts.justLinked, isBrowserWorld(entry) || !!opts.justMoved);
        } catch (err) {
          // flushPendingOnAttach swallows its own errors; outer catch is defense-
          // in-depth in case the helper is ever refactored to throw.
          console.warn('[sync-attach] flush-on-attach failed:', err);
        }
      }
      const now = getState().registry;
      if (readOnly || worldPullsOnOpen(now.worlds.find(w => w.id === entry.id), now)) {
        try {
          await pullNowAndRefresh({ auto: true });
        } catch (err) {
          console.warn('[sync-attach] pull-on-activate failed:', err);
        }
      }
    })();
  }

  return engine;
}

/**
 * Fire a pushOnce() iff the folder has any locally-changed elements or
 * pending tombstones. Surfaces a one-shot toast on recovery so the user can
 * see "we caught up writes that were stuck from your last session."
 *
 * Failure-tolerant: per-element errors are recorded in result.failures and
 * surfaced via the normal engine state path. A complete network failure
 * throws and we just log — next push attempt (autosave / cadence / manual)
 * will retry.
 */
async function flushPendingOnAttach(
  engine: SyncEngine,
  folder: FolderStore,
  worldName: string,
  worldId: string,
  justLinked = false,
  inBrowser = false,
): Promise<void> {
  try {
    const changed = await folder.listLocallyChangedSince(null);
    const tombstones = await folder.listTombstonesSince(null);
    const pending = changed.length + tombstones.length;
    // World settings waiting in world.json count as pending too: Make online's
    // first round only seeds them, and another tool can write them into the
    // folder while Atlas is closed; without this they waited for an
    // unrelated element edit (the pull at open is off by default). One state of
    // them is sent at open once, so a refusal is not resent at every open.
    if (pending === 0 && !(await engine.claimWorldSettingsAtOpen())) return;
    // A batch too big to upload unasked waits for the user, as it would with
    // the window open (`holdBigBatchAtOpen`). A hold already persisted
    // was adopted before this ran and refuses the round by itself. Never for
    // a world kept in this browser (1.17): nothing outside Atlas can
    // write its files, so what waits is the user's own offline editing.
    if (!justLinked && !inBrowser && changed.length > BIG_BATCH && !isDiskHoldPersisted(worldId)) {
      holdBigBatchAtOpen(worldId, changed.length, engine);
      return;
    }
    console.info('[atlas:sync] flush-on-attach: pending writes found', {
      world: worldName,
      changed: changed.length,
      tombstones: tombstones.length,
    });
    const result = await engine.pushOnce();
    const synced = result.pushed.creates + result.pushed.updates + result.pushed.deletes;
    if (synced > 0) {
      // Notify the user — these writes were stuck from a prior session.
      // Neutral about WHO made them: the user's own offline
      // edits, or another tool's while Atlas was closed.
      toastManager.success(`Uploaded ${synced} ${synced === 1 ? 'change that was' : 'changes that were'} waiting in ${inBrowser ? 'this browser' : 'the folder'}`);
    }
    if (result.failures.length > 0) {
      console.warn('[atlas:sync] flush-on-attach: some writes failed', result.failures);
      // Surface to user — silent failures here are how Titus hit the "lying
      // pill" bug: pending writes from a prior session bounced off a dead
      // world (deleted server-side / bad PIN), failures collected but never
      // shown. Auth failures get their own dedicated toast via emitRoundToasts
      // below (pill also goes red); skip the generic warning in that case.
      if (!result.auth_blocked && !result.transient_blocked) {
        toastFailuresOnce(result.failures, engine, worldId);
      }
    }
  } catch (err) {
    console.warn('[atlas:sync] flush-on-attach failed:', err);
  }
}

/**
 * The fixes a round's failure toast carries: new ids for an id another world or a membership holds, a retry
 * for a held file, else the list of what is not syncing.
 */
export function failureFixIds(failures: readonly PerElementFailure[]): FixId[] {
  const kinds = new Set(failures.map(classifyFailure));
  const newIds = kinds.has('foreign_id') || kinds.has('id_in_use');
  const fixIds: FixId[] = [];
  if (newIds) fixIds.push('new-ids');
  if (kinds.has('file_busy')) fixIds.push('retry');
  // Give new ids already leads to the same Settings tab.
  if (!newIds) fixIds.push('sync-issues');
  return fixIds;
}

/**
 * The failure toast for a round: the plain sentence from
 * `failureToastOnce`, a button for the fix it names (Give new ids for a
 * foreign id, Retry now for a held file), and the causes behind Details,
 * scrubbed, for Copy details and Send feedback. Nothing when this set was
 * already shown.
 */
function toastFailuresOnce(
  failures: readonly PerElementFailure[],
  engine: SyncEngine | null,
  worldId: string | null,
): void {
  if (failures.length === 0) return;
  const text = failureToastOnce(failures, filesWhereOf(getState().registry.worlds.find(w => w.id === worldId)));
  if (!text) return;
  const fixIds = failureFixIds(failures);
  // A round is safe to repeat; only on the engine (and world) that failed. A
  // full sync, so a held file on the pull side is retried too.
  const retry = engine ? () => {
    if (currentEngine !== engine || sayRateWait()) return;
    void engine.syncNow().catch(err => console.warn('[atlas:sync] retry sync failed:', err));
  } : undefined;
  toastManager.show(text, 'error', 8000, {
    actions: resolveFixes(fixIds, { worldId, retry }),
    details: buildFailureDetails(failures, detailsContext()),
  });
}

/** Kept elements per world (conv. 151), for Settings and an element's sync mark: read at attach and after a round with kept news. */
const keptSets: Record<string, ReadonlySet<string>> = {};
/** `<world>:<element>` whose kept edit was said this session. */
const keptEditsSaid = new Set<string>();
/** `<world>:<element>` whose hold (a hidden element this key cannot put online, conv. 170) was said this session. */
const hiddenHeldSaid = new Set<string>();

function noteHiddenHeld(worldId: string, result: SyncResult): void {
  const name = getState().registry.worlds.find(w => w.id === worldId)?.name ?? 'this world';
  const fresh = (ids: readonly string[], kind: string): boolean => {
    if (!ids.some(id => !hiddenHeldSaid.has(`${worldId}:${kind}:${id}`))) return false;
    for (const id of ids) hiddenHeldSaid.add(`${worldId}:${kind}:${id}`);
    return true;
  };
  const held = result.hidden_held_ids ?? [];
  if (fresh(held, 'held')) toastManager.show(hiddenHeldLine(name, held.length), 'info', 12000);
  const shown = result.hidden_shown_ids ?? [];
  if (fresh(shown, 'shown')) toastManager.show(hiddenShownLine(shown.length), 'info', 12000);
}
/**
 * The role a push's 404 said this session, per world, until the resync after
 * it: that round's kept count is what the role line already promised
 * ("what you no longer see online stays here"), so it is not said again.
 */
const roleSaidBeforeResync: Record<string, string> = {};

export function keptCountFor(worldId: string): number {
  return keptSets[worldId]?.size ?? 0;
}

/** True when this element is kept here, outside the key's view (conv. 151). */
export function isKeptHere(worldId: string, elementId: string): boolean {
  return keptSets[worldId]?.has(elementId) ?? false;
}

/** The kept set itself, a new object only when it changed: a render gate's part for a page that reads `isKeptHere`. */
export function keptSetOf(worldId: string): ReadonlySet<string> | undefined {
  return keptSets[worldId];
}

async function refreshKeptCount(worldId: string, folder: FolderStore): Promise<void> {
  try {
    const ids = (await folder.readSyncState()).kept_outside_view ?? [];
    const before = keptSets[worldId];
    if (before && before.size === ids.length && ids.every(id => before.has(id))) return;
    keptSets[worldId] = new Set(ids);
    patchSlice('sync', { ...getState().sync });
  } catch { /* Settings shows no count; the next round reads again */ }
}

/**
 * A round's role and kept news (conv. 151): the key's role recorded
 * on the entry, a move from a known role said once; elements a resync kept,
 * said when no role line did; edits that stay here, once per element.
 */
async function noteRoleNews(worldId: string, folder: FolderStore, result: SyncResult): Promise<void> {
  const entry = getState().registry.worlds.find(w => w.id === worldId);
  if (!entry?.api) return;
  let roleSaid = false;
  const roleMoved = result.own_role !== undefined && result.own_role !== entry.api.member_role;
  // The key's own membership, beside its role: what `created_by` holds for what this key makes (`may-change.ts`).
  const membershipMoved = result.own_membership !== undefined && result.own_membership !== entry.api.membership;
  if (roleMoved || membershipMoved) {
    const api = {
      ...entry.api,
      ...(roleMoved ? { member_role: result.own_role } : {}),
      ...(membershipMoved ? { membership: result.own_membership } : {}),
    };
    const next = updateWorldEntry(getState().registry, worldId, { api });
    if (saveRegistry(next)) patchSlice('registry', next);
  }
  if (roleMoved && result.own_role !== undefined) {
    const line = roleChangeLine(entry.name, entry.api.member_role, result.own_role, !!entry.api.read_only);
    if (line) {
      toastManager.show(line, 'info', 12000);
      roleSaid = true;
      if (!result.kept && (result.kept_edit_ids?.length ?? 0) > 0) roleSaidBeforeResync[worldId] = result.own_role;
      else delete roleSaidBeforeResync[worldId];
    }
  }
  if (result.kept && !roleSaid && roleSaidBeforeResync[worldId] !== entry.api.member_role) {
    toastManager.show(keptLine(entry.name, result.kept), 'info', 10000);
  }
  // The promise covers the one resync after it, whatever that resync kept.
  if (!roleSaid && (result.kept || result.own_role !== undefined)) delete roleSaidBeforeResync[worldId];
  const edits = result.kept_edit_ids ?? [];
  if (edits.some(id => !keptEditsSaid.has(`${worldId}:${id}`))) {
    for (const id of edits) keptEditsSaid.add(`${worldId}:${id}`);
    // A role line said this round already says "changes you make to it stay here too".
    if (!roleSaid) toastManager.show(keptEditsLine(entry.name, edits.length), 'info', 10000);
  }
  if (result.kept || edits.length > 0 || result.own_role !== undefined) await refreshKeptCount(worldId, folder);
}

/** Elements keel holds as proposals, per world (conv. 163): the element page's sync mark reads it. */
const proposedSets: Record<string, ReadonlySet<string>> = {};
/** `<world>:<element>:<local stamp>` whose proposal was said this session: a version is said once. */
const proposalsSaid = new Set<string>();

/** True while keel holds this element's edit as a proposal (conv. 163). */
export function isProposedHere(worldId: string, elementId: string): boolean {
  return proposedSets[worldId]?.has(elementId) ?? false;
}

/** The proposed set itself, a new object only when it changed: the element page's gate part for its sync mark
 *  (a proposal leaves the element's file as it was, so no elements patch redraws the page). */
export function proposedSetOf(worldId: string): ReadonlySet<string> | undefined {
  return proposedSets[worldId];
}

/** Test-only: read the world's proposed set from its sync state, as a round does. */
export function __test_refreshProposedSet(worldId: string, folder: FolderStore): Promise<void> {
  return refreshProposedSet(worldId, folder);
}

async function refreshProposedSet(worldId: string, folder: FolderStore): Promise<void> {
  try {
    const ids = ((await folder.readSyncState()).proposed ?? []).map(e => e.element_id);
    const before = proposedSets[worldId];
    if (before && before.size === ids.length && ids.every(id => before.has(id))) return;
    proposedSets[worldId] = new Set(ids);
    patchSlice('sync', { ...getState().sync });
  } catch { /* no mark this time; the next round reads again */ }
}

/**
 * A round's proposal news (conv. 163): edits sent for review, each version
 * said once; what the keeper accepted; deletes keel kept, with the element
 * back. A declined one goes to the review, which says why.
 */
async function noteProposalNews(worldId: string, folder: FolderStore, result: SyncResult): Promise<void> {
  const entry = getState().registry.worlds.find(w => w.id === worldId);
  if (!entry?.api) return;
  const sent = result.proposed_ids ?? [];
  if (sent.length > 0) {
    const elements = getState().data.elements;
    const fresh = sent.filter(id => {
      const key = `${worldId}:${id}:${elements.find(e => e.id === id)?.local_updated_at ?? ''}`;
      if (proposalsSaid.has(key)) return false;
      proposalsSaid.add(key);
      return true;
    });
    if (fresh.length > 0) toastManager.show(proposalSentLine(entry.name, fresh.length), 'info', 10000);
  }
  const accepted = result.proposals_accepted ?? [];
  if (accepted.length > 0) toastManager.show(proposalAcceptedLine(entry.name, accepted.length), 'success', 6000);
  const refused = result.delete_refused ?? [];
  if (refused.length > 0) {
    // Mid-line: "Only this world's keeper can delete the unnamed character, so it is back."
    toastManager.show(deleteRefusedLine(refused), 'info', 10000);
  }
  if (sent.length > 0 || accepted.length > 0 || result.conflicts.some(c => c.proposal) || proposedSets[worldId] === undefined) {
    await refreshProposedSet(worldId, folder);
  }
  // The elements keel gave back or settled, read from the folder (no push: nothing here is new).
  if (accepted.length > 0 || refused.length > 0) {
    try { patchElementsFrom(folder, await folder.listElements()); } catch { /* the next round reads them */ }
  }
}

/**
 * Detach the current engine: pause it, clear the world's slice entry, and
 * reset `activeSync` to null. Safe to call when no engine is attached.
 */
export function detachSyncEngine(opts: { keepHeldNote?: boolean } = {}): void {
  if (currentWorldId !== null) {
    currentEngine?.stop();
    const sync = getState().sync;
    const byWorld = { ...sync.byWorld };
    delete byWorld[currentWorldId];
    patchSlice('sync', { byWorld, activeSync: null, activeConflictsCount: 0 });
  }
  currentEngine = null;
  currentWorldId = null;
  currentPin = undefined;
  currentFolder = null;
  currentPolicyNow = null;
  // The note that copies wait was about this world's review (kept only for the same world attached again).
  if (!opts.keepHeldNote) closeHeldNote();
}

/**
 * Ask keel's roster whether others share this world, and keep the answer on
 * its registry entry. Resolves whether keel answered; no answer
 * (offline, refused, timed out) changes nothing. `maxAgeMs` 0 reads afresh.
 * The answer is kept only while the world is still linked with the key it
 * was read with (a re-link during the read).
 */
async function learnShared(worldId: string, apiKey: string, maxAgeMs: number): Promise<boolean> {
  const entry = getState().registry.worlds.find(w => w.id === worldId);
  if (!entry || entry.state !== 'api-linked' || entry.api?.read_only || entry.api?.api_key !== apiKey) return false;
  // A legacy key reads a private world only with its PIN.
  const rows = await rosterFor(entry, Date.now, { maxAgeMs, pin: worldPin(entry, getState().registry) ?? undefined });
  if (!rows) return false;
  const shared = rosterIsShared(rows);
  const reg = getState().registry;
  const now = reg.worlds.find(w => w.id === worldId);
  if (!now || now.api?.api_key !== apiKey) return false;
  if (now.shared_with_others !== shared) {
    const next = updateWorldEntry(reg, worldId, { shared_with_others: shared });
    saveRegistry(next);
    patchSlice('registry', next);
  }
  return true;
}

/**
 * Move a running engine to the policy its world calls for, as the world
 * changes on its own (keel answered, someone joined or left, a first review
 * ended). Toward the review it moves at once. Away from it, only once nothing
 * is held: an element held for the person to choose stays held until they
 * have chosen, and the move waits for a round after.
 * Only a choice the person makes in Settings clears what is held
 * (`reapplySyncPolicy`).
 */
async function movePolicy(engine: SyncEngine, folder: FolderStore, target: SyncPolicy): Promise<void> {
  if (target === 'local-wins' && engine.getPolicy() === 'pause-and-review') {
    const held = await folder.readSyncState().then(st => st.conflicts?.length ?? 0, () => 1);
    if (held > 0 || currentEngine !== engine) return;
  }
  engine.setPolicy(target);
}

/**
 * Re-apply the attached engine's policy after a setting it reads changed
 * (Settings, Storage's default; This world's shared switch). When that takes
 * the world from pause-and-review to local-wins, the held conflicts are
 * cleared and pushed at once: under the v2 cursor nothing re-detects them,
 * so without the push the divergence would sit invisible until the next edit
 * on either side (SYNC_NOTES M4; 2026-07-12). A shared world
 * whose rule holds never takes this path from the default's change.
 */
export function reapplySyncPolicy(): void {
  const engine = currentEngine;
  const folder = currentFolder;
  if (!engine || !currentPolicyNow) return;
  const before = engine.getPolicy();
  engine.setPolicy(currentPolicyNow());
  if (before !== 'pause-and-review' || engine.getPolicy() !== 'local-wins' || !folder) return;
  void folder.writeSyncState({ conflicts: [] })
    .then(() => refreshConflictsCount())
    .then(() => {
      if (currentEngine !== engine) return;
      return engine.pushOnce().then(() => undefined).catch((err) => {
        console.warn('[atlas:sync] post-policy-flip convergence push failed:', err);
      });
    })
    .catch((err) => console.warn('[atlas:sync] clear conflicts failed:', err));
}

/**
 * Convenience helper for UI callers that just want to schedule a debounced
 * push after a folder write. No-ops if no engine is attached (local-only world
 * or engine startup failed). Used by element-detail.ts after every save.
 *
 * Every caller is a person's write (1.125.0's census): with no engine because the world waits on the
 * World PIN (`pin-missing`), the first change says once a session per world that it is kept here and
 * how it reaches OnlyWorlds. A toast with an action takes no focus and stays until closed.
 */
export function requestPushIfLinked(): void {
  if (currentEngine) { currentEngine.requestPush(); return; }
  const why = diagnoseSyncUnavailable();
  if (why?.kind !== 'pin-missing' || toldPinWaits.has(why.worldId)) return;
  toldPinWaits.add(why.worldId);
  const worldId = why.worldId;
  const name = getState().registry.worlds.find(w => w.id === worldId)?.name ?? 'this world';
  // The line is this world's: its Add PIN asks for this world only, and it goes when another world opens.
  toastManager.show(firstChangeLine(name), 'info', 0, {
    dedupeKey: firstChangeKey(worldId),
    actions: [{ label: 'Add PIN', run: () => { void import('../ui/world-pin-modal').then(m => m.askWorldPin(toastManager, worldId)); } }],
  });
  firstChangeShownFor = worldId;
  if (!firstChangeWatch) {
    firstChangeWatch = subscribe(() => {
      if (firstChangeShownFor && getState().active?.worldId !== firstChangeShownFor) takeDownFirstChange(firstChangeShownFor);
    });
  }
}

/** The world whose first-change line is up, if one is, and the watch that takes it down on a switch. */
let firstChangeShownFor: string | null = null;
let firstChangeWatch: (() => void) | null = null;

/** Take down `worldId`'s first-change line (a switch to another world, or its attach on a PIN). */
function takeDownFirstChange(worldId: string): void {
  toastManager.dismiss(firstChangeKey(worldId));
  if (firstChangeShownFor === worldId) firstChangeShownFor = null;
}

/** The first-change line's key: taken down once the world attaches, when it is no longer true. */
function firstChangeKey(worldId: string): string {
  return `pin-waits:${worldId}`;
}

/** What the first change in a world waiting on the World PIN says (once a session per world). */
export function firstChangeLine(name: string): string {
  return `Your change to "${name}" is kept here. Add your World PIN to save it to OnlyWorlds.`;
}

/** The worlds whose first change waiting on the PIN was said in this session. */
const toldPinWaits = new Set<string>();

/** Tests: no first change said yet. */
export function __resetFirstChangeToldForTests(): void {
  toldPinWaits.clear();
  firstChangeShownFor = null;
}

/**
 * After a question about the account PIN (Settings' field, the watch below): the open world attaches on
 * it, whatever keel answered, since a refusal recorded first starts the engine stopped and sending nothing
 * (law 193). Re-read here, after the question's await: only the world asked about, while it is still the
 * open one, still linked, writes and is not a seat, with `pin` still the kept PIN and no engine already
 * running on it (a PIN saved again unchanged leaves a running engine as it is). Null when nothing attached.
 */
export function attachOnPinAnswer(worldId: string | null, pin: string, opts: { onlyIfNone?: boolean } = {}): SyncEngine | null {
  const s = getState();
  if (!worldId || s.active?.worldId !== worldId || s.registry.pin !== pin) return null;
  const entry = s.registry.worlds.find(w => w.id === worldId);
  const folder = getActiveStore();
  if (!entry || entry.state !== 'api-linked' || !entry.api || entry.api.read_only || entry.copy_of || isSeatWorld(entry) || !folder) return null;
  if (currentEngine && (opts.onlyIfNone || (currentWorldId === worldId && currentPin === pin))) return null;
  return attachSyncEngine(entry, folder);
}

/**
 * The account PIN removed in Settings: the open world's engine on it goes, so the pill says Add PIN and
 * every reader agrees the world does not save to OnlyWorlds (gate 4 S3). A seat's or a read key's engine
 * stays: it sends no account PIN.
 */
export function detachOnPinRemoved(): void {
  if (!currentEngine) return;
  const reg = getState().registry;
  const entry = reg.worlds.find(w => w.id === currentWorldId);
  if (!entry || entry.api?.read_only || isSeatWorld(entry) || worldPin(entry, reg)) return;
  detachSyncEngine();
}

/**
 * Refresh `state.data.elements` from disk + schedule a debounced push.
 *
 * Standard post-write pattern: after `store.createElement` / `updateElement` /
 * `deleteElement`, the caller wants the in-memory cache to reflect the new
 * state AND wants the change to flow to the server (for api-linked worlds).
 * This three-liner used to appear at ~25 call sites — see SWEEP-2026-05-20.md
 * F8. Returns the fresh element list so callers that need it (e.g. for
 * building a writingHash from the new state) can chain; null when the store's world is no longer on
 * screen (nothing was patched: a caller selects, navigates or focuses only on a non-null result).
 */
export async function refreshElementsAfterWrite(store: FolderStore): Promise<Element[] | null> {
  const elements = await store.listElements();
  // A world switched while the write ran: this store's world is no longer on screen, and its elements
  // must not become the open world's (they would show in its lists and pickers until the next refresh).
  if (!patchElementsFrom(store, elements)) return null;
  requestPushIfLinked();
  return elements;
}

/** Currently-attached engine, or null. Used by element-edit autosave wiring. */
export function getCurrentSyncEngine(): SyncEngine | null {
  return currentEngine;
}

/** Currently-attached engine's world id, or null. */
export function getCurrentSyncWorldId(): string | null {
  return currentWorldId;
}

/** Currently-attached folder store, or null. Set by attachSyncEngine. */
let currentFolder: FolderStore | null = null;
/** "in this browser" or "in the folder": where the syncing world keeps its edits (1.17). */
function savedPlaceOfSyncWorld(): string {
  const id = getCurrentSyncWorldId();
  return filesWhereOf(getState().registry.worlds.find(w => w.id === id)) === 'browser' ? 'in this browser' : 'in the folder';
}

/**
 * What a toggle says when unticking a pause cannot resume the attached engine: a refused key or PIN
 * stopped it, and only a new one brings it back. Null when it resumed (or nothing is attached).
 */
export function refusedEngineLine(): string | null {
  if (!currentEngine?.isAuthRefused()) return null;
  const reason = currentEngine.authRefusal();
  const entry = getState().registry.worlds.find(w => w.id === currentWorldId);
  return isSeatWorld(entry) ? seatRefusalLine(reason) : keyRefusalLine(reason);
}

/**
 * The attached engine stopped on the account PIN comes back when that PIN changes or keel's word on it
 * is no longer a refusal: a save in Settings here re-attaches by itself, and another tab's save or proof
 * reaches this tab through the registry's storage event. The same refused PIN saved again changes
 * neither, so nothing is sent. Checked a task later, so a save's own re-attach (or a round recording its
 * refusal) is seen first.
 */
let refusedPinWatch: (() => void) | null = null;
function watchRefusedPin(): void {
  if (refusedPinWatch) return;
  let seen = getState().registry;
  refusedPinWatch = subscribe(() => {
    const reg = getState().registry;
    if (reg === seen) return;
    const was = seen;
    seen = reg;
    const engine = currentEngine;
    // The account PIN removed (another tab's Settings): this tab's engine on it goes too.
    if (engine && was.pin && !reg.pin) { detachOnPinRemoved(); return; }
    if (engine?.authRefusal() === 'pin') {
      setTimeout(() => { void reviveRefusedEngine(engine); }, 0);
      return;
    }
    // No engine, and a PIN arrived (this tab's Settings, another tab's save): the open world that waited
    // on it attaches, once keel has been asked (1.125.0).
    if (!engine && reg.pin && reg.pin !== was.pin) setTimeout(() => { void attachWhenPinArrives(reg.pin!); }, 0);
  });
}

/**
 * A PIN arrived for an open world with no engine: ask keel about it, sharing a question already out (Settings'
 * own, registered before this task), unless it is recorded already; then attach by `attachOnPinAnswer`'s rule,
 * only if no engine attached meanwhile (the dialog's or Settings' own attach stands).
 */
async function attachWhenPinArrives(pin: string): Promise<void> {
  const worldId = getState().active?.worldId ?? null;
  if (currentEngine || !worldId || getState().registry.pin !== pin) return;
  const entry = getState().registry.worlds.find(w => w.id === worldId);
  if (!entry || entry.state !== 'api-linked' || !entry.api || entry.api.read_only || isSeatWorld(entry) || !getActiveStore()) return;
  if (!getState().registry.pin_state) await askAboutPin(pin);
  attachOnPinAnswer(worldId, pin, { onlyIfNone: true });
}

/** Re-attach `engine`, still the attached one and refused on the PIN, when the account PIN moved on. */
async function reviveRefusedEngine(engine: SyncEngine): Promise<void> {
  // A question about the new PIN still out (Settings asks before it attaches): wait on its answer, so the
  // revived engine never sends the PIN beside it, and Settings' own attach after it stands.
  const out = pinQuestionOut(getState().registry.pin);
  if (out) await out.catch(() => null);
  const now = getState().registry;
  const entry = now.worlds.find(w => w.id === currentWorldId);
  if (currentEngine !== engine || engine.authRefusal() !== 'pin' || !entry || !currentFolder || isSeatWorld(entry) || entry.api?.read_only) return;
  if (!now.pin) return;
  // A new PIN: always. The same PIN recorded proved (another tab, maybe beside another account's key,
  // whose answer is recorded against this one PIN): once per PIN by the watch, so two tabs never
  // ping-pong a resend; a person's own press that proves it gives that try back (`pinProvedByPress`).
  const changed = now.pin !== currentPin;
  if (!changed && (now.pin_state !== 'proved' || samePinRevived.has(now.pin))) return;
  if (!changed) samePinRevived.add(now.pin);
  attachSyncEngine(entry, currentFolder);
}

/** The refused PINs the watch already tried once more because they were recorded proved elsewhere. */
const samePinRevived = new Set<string>();

/**
 * A person's own press proved `pin` (Test connection, Settings' save): its try is given back, and an
 * engine refused on that PIN comes back now, though the registry may already have read proved.
 */
export function pinProvedByPress(pin: string | undefined): void {
  if (!pin) return;
  samePinRevived.delete(pin);
  const engine = currentEngine;
  if (engine?.authRefusal() === 'pin') setTimeout(() => { void reviveRefusedEngine(engine); }, 0);
}

/** Tests: no PIN's try spent. */
export function __resetSamePinRevivedForTests(): void {
  samePinRevived.clear();
}

/**
 * A person's press of Sync now or refresh inside a 429's wait sends nothing: it says the wait, in the
 * toast's own words, and answers true. False when no wait runs on the attached engine (the press goes on).
 */
export function sayRateWait(): boolean {
  const engine = currentEngine;
  const wait = engine?.rateWaitNow();
  if (!engine || !wait) return false;
  // A paused, offline or held engine sends nothing at the wait's end either: its own state is what is
  // true, never "tries again in".
  const state = engine.getState();
  if (state.kind === 'paused') toastManager.info(pausedPressLine(state));
  else if (state.kind === 'error') toastManager.error(refusedEngineLine() ?? state.message);
  else toastManager.info(rateWaitLine(wait.pin, wait.leftMs, savedPlaceOfSyncWorld()));
  return true;
}

/** What a press of the pill, refresh or Sync now says of an engine paused, offline or held: why nothing goes. */
export function pausedPressLine(state: Extract<SyncEngineState, { kind: 'paused' }>): string {
  if (state.reason === 'network') return 'Offline, so nothing was refreshed.';
  if (state.reason === 'held' && state.held_for === 'disk') return 'Files changed on disk are waiting for your answer in the element list.';
  if (state.reason === 'held' && state.held_for === 'move') return 'This world is being moved to a folder. Refresh when that finishes.';
  if (state.reason === 'held' && state.held_for === 'download') return 'This world is being saved as one file. Refresh when that finishes.';
  if (state.reason === 'held') return 'Ids are being updated in this world. Refresh when that finishes.';
  return 'Sync is paused. Turn off Pause sync or Pause all sync in Settings to refresh.';
}

export function getCurrentSyncFolder(): FolderStore | null {
  return currentFolder;
}

/**
 * Diagnose why the sync engine isn't available right now. UI surfaces use
 * this when a sync action (pull, refresh, conflict resolve, etc.) would no-op
 * because `getCurrentSyncEngine()` returns null. The original toasts were
 * generic ("Engine not ready" / "Refresh is only available on API-linked
 * worlds") which misled users — by far the most common cause is a missing
 * PIN on an otherwise-valid api-linked world. This helper returns a
 * structured reason so callers can pick the right toast and (if applicable)
 * deep-link the user to the right settings tab.
 *
 * Returns null if the engine should be considered ready by any UI surface
 * (i.e. an engine is attached). Callers should still gate on the engine
 * pointer itself; this helper only diagnoses the absence.
 */
export type SyncUnavailableReason =
  | { kind: 'no-active-world' }
  | { kind: 'local-only'; worldId: string }
  | { kind: 'pin-missing'; worldId: string }
  /** A seat world whose secret this browser no longer has (#104): opened again from onlyworlds.com. */
  | { kind: 'seat-secret-missing'; worldId: string }
  // ('attached-but-paused' removed — declared here and handled in
  //  sync-toasts, but never CONSTRUCTED by the function below, so the branch
  //  was unreachable and its toast had never fired. A definition with no
  //  producer is not a feature.)
  | { kind: 'engine-not-ready' };

export function diagnoseSyncUnavailable(): SyncUnavailableReason | null {
  if (currentEngine) return null;
  const state = getState();
  const worldId = state.active?.worldId;
  if (!worldId) return { kind: 'no-active-world' };
  const entry = state.registry.worlds.find((w) => w.id === worldId);
  if (!entry) return { kind: 'engine-not-ready' };
  if (entry.state !== 'api-linked') return { kind: 'local-only', worldId };
  // The one predicate every "online" reader shares (`core/saves-online.ts`).
  if (waitsOnPin(entry, state.registry) || (!entry.api && !worldPin(entry, state.registry))) {
    return isSeatWorld(entry) ? { kind: 'seat-secret-missing', worldId } : { kind: 'pin-missing', worldId };
  }
  return { kind: 'engine-not-ready' };
}

/**
 * Pull-now wrapper that also refreshes `state.data.elements` from the folder
 * after a successful pull. Use this from UI surfaces (pill click, refresh
 * button, periodic scheduler) so the UI reflects newly-pulled elements.
 *
 * Post-pull side effects (3.5+):
 *   - Refresh conflict + server-delete counts on `state.sync`.
 *   - If `registry.sync_confirm_server_deletes` is true (default) AND there
 *     are server-deleted records detected this pull, auto-open the review
 *     modal so the user can decide.
 *
 * Returns the SyncResult or null if no engine is attached. Throws on failure
 * — callers surface as toast.
 */
export async function pullNowAndRefresh(
  /** `auto`: a pull nobody pressed for (the cadence, the open's pull): inside a 429's wait it is silent. */
  opts: { auto?: boolean } = {},
): Promise<import('../core/types').SyncResult | null> {
  if (!currentEngine || !currentFolder) {
    console.info('[atlas:sync] pullNowAndRefresh: no engine attached');
    return null;
  }
  // Inside a 429's wait nothing is sent: a press says the wait, and its answer is the wait (never "up to date").
  const wait = currentEngine.rateWaitNow();
  if (wait) {
    // Carried: the retry at the wait's end runs a full round, its pull included.
    currentEngine.holdPull();
    if (!opts.auto) sayRateWait();
    const none = { creates: 0, updates: 0, deletes: 0 };
    return {
      pushed: { ...none }, pulled: { ...none }, conflicts: [], failures: [],
      transient_blocked: true, transient_reason: 'rate_limited', retry_after_ms: wait.leftMs,
      ...(wait.pin ? { rate_limited_pin: true as const } : {}),
    };
  }
  console.info('[atlas:sync] pull starting');
  const result = await currentEngine.pullNow();
  console.info('[atlas:sync] pull complete', {
    creates: result.pulled.creates,
    updates: result.pulled.updates,
    conflicts: result.conflicts.length,
  });
  // Re-read folder elements to reflect any creates/updates from the pull. A pull that changed
  // nothing (the open's pull, every cadence tick of a quiet world) keeps the store's array, so
  // nothing redraws under a click in flight (same-elements.ts).
  const pulledFolder = currentFolder;
  try {
    const elements = await pulledFolder.listElements();
    if (!sameElements(getState().data.elements, elements)) patchElementsFrom(pulledFolder, elements);
  } catch (err) {
    console.warn('[sync-attach] refresh-after-pull failed:', err);
  }
  await refreshConflictsCount();
  await maybeAutoOpenServerDeleteModal();
  // Surface a count toast when scheduled / pull-on-activate / catch-up pulls
  // actually land changes. Without this, automatic pulls are silent and the
  // user can't tell if their web-app edits propagated. Conflict toasts are
  // handled separately by emitConflictToasts under local-wins (don't
  // double-toast). Pill-click handler does its own "already up to date" toast
  // for the manual case — that's intentionally only fired on user-initiated
  // pulls so cadence ticks don't spam.
  const totalUpdates = result.pulled.creates + result.pulled.updates;
  if (totalUpdates > 0 && result.conflicts.length === 0) {
    const parts: string[] = [];
    if (result.pulled.creates > 0) parts.push(`${result.pulled.creates} new`);
    if (result.pulled.updates > 0) parts.push(`${result.pulled.updates} updated`);
    if (result.meta_pulled?.length) parts.push('world settings');
    toastManager.info(`Pulled ${parts.join(' + ')} from OnlyWorlds`);
  } else if ((result.meta_pulled?.length ?? 0) > 0 && result.conflicts.length === 0) {
    // Meta-only round: the element counters are zero but
    // something real changed — say so, or the pull reads as a silent no-op.
    toastManager.info('Pulled world settings from OnlyWorlds');
  }
  return result;
}

/**
 * If the active world has pending server-delete records AND the user has
 * "confirm before deleting locally" enabled (default), open the review modal.
 * Idempotent — modal class handles the "no records" case as a no-op.
 *
 * Uses a dynamic import to avoid circular dep with the UI layer.
 */
let serverDeleteModalOpen = false;
async function maybeAutoOpenServerDeleteModal(): Promise<void> {
  if (!currentEngine) return;
  if (serverDeleteModalOpen) return;
  const reg = getState().registry;
  // Default true; only skip when explicitly disabled.
  if (reg.sync_confirm_server_deletes === false) return;
  try {
    const records = await currentEngine.listServerDeletes();
    if (records.length === 0) return;
    // `open()` returns once the dialog shows, so the flag alone let every pull
    // stack another review over the first: one on screen is enough.
    if (document.querySelector('[data-modal="server-delete-review"]')) return;
    const { ServerDeleteReviewModal } = await import('../ui/server-delete-modal');
    serverDeleteModalOpen = true;
    const modal = new ServerDeleteReviewModal(toastManager);
    try {
      await modal.open();
    } finally {
      serverDeleteModalOpen = false;
    }
  } catch (err) {
    console.warn('[sync-attach] auto-open server-delete modal failed:', err);
  }
}

function publishSyncState(worldId: string, engineState: SyncEngineState): void {
  const sync = getState().sync;
  patchSlice('sync', {
    byWorld: { ...sync.byWorld, [worldId]: engineState },
    activeSync: engineState,
    activeConflictsCount: sync.activeConflictsCount,
  });
  // Engine just transitioned to idle → push/pull just finished.
  // Refresh data.elements + conflicts so the UI catches id-swaps and pulled
  // updates without a page reload. refreshMetaCache re-reads world.json into
  // state.active.meta (world-meta sync R2/D7) — the charts room's nowValue()
  // and the home identity strip read that slice live, so a pull-applied
  // time_current moves the now-line without a reload.
  if (engineState.kind === 'idle') {
    void refreshConflictsCount();
    void refreshElementsCache();
    void refreshMetaCache();
  }
}

/**
 * Emit one-shot toasts summarizing the outcome of a sync round.
 *
 * Three concerns surface here, in priority order:
 *   1. Auth-blocked round: pill already went to red `error` (engine
 *      transitioned via setAuthError). One sticky-ish toast points the user
 *      at recovery. No retry-spam — engine is paused until PIN change or
 *      detach re-attaches a fresh engine.
 *   2. Non-auth per-element failures with NO successes: pill stays idle but
 *      the round produced nothing. Without a toast the user thinks "synced"
 *      because the spinner went idle. This is the "lying pill" class. Toast
 *      that something failed and link them to settings.
 *   3. Conflicts:
 *      - `pause-and-review`: stay silent. Badge + modal handle it.
 *      - `local-wins` push: server overwritten. Confirm.
 *      - `local-wins` pull: trigger follow-up push so local converges now
 *        (don't wait for the 5s autosave debounce).
 *      - `local-wins` sync: emit summary.
 */
function emitConflictToasts(
  phase: 'push' | 'pull' | 'sync',
  result: import('../core/types').SyncResult,
  /** The world whose engine ran the round, and whether that engine is still
   *  the attached one (a stopped engine's late refusal
   *  must never act on the world open now). */
  from: { worldId: string | null; current: boolean; policy?: SyncPolicy } = { worldId: currentWorldId, current: true },
): void {
  // Auth-blocked: one clear toast. Engine state is already 'error' so the
  // pill carries the persistent signal; this toast is the moment-it-happened
  // notification. Skip if the round had successes (mixed-blocked is rare and
  // the engine still went to error — keep the surfacing single).
  // Busy, rate limited or offline: one plain sentence with
  // the wait, instead of a wall of per-element failures.
  if (result.transient_blocked) {
    const waitMs = result.retry_after_ms ?? 30_000;
    const when = waitWords(waitMs);
    toastManager.info(
      result.transient_reason === 'rate_limited'
        ? rateWaitLine(result.rate_limited_pin === true, waitMs, savedPlaceOfSyncWorld())
        : result.transient_reason === 'offline'
          ? `OnlyWorlds could not be reached. Your changes are saved ${savedPlaceOfSyncWorld()}, and Atlas tries again in ${when}.`
          : `OnlyWorlds is busy. Your changes are saved ${savedPlaceOfSyncWorld()}, and Atlas tries again in ${when}.`
    );
    return;
  }

  if (result.auth_blocked) {
    // A seat (#104) has no PIN to check: removed on onlyworlds.com, it comes
    // back only through the world's page.
    // A replaced engine's refusal is about a key no longer in use (a swap, a
    // world switch): its world's own engine speaks for it.
    if (!from.current) return;
    if (isSeatWorld(getState().registry.worlds.find(w => w.id === from.worldId))) {
      toastManager.error(seatRefusalLine(result.auth_reason));
      return;
    }
    // Say the cause keel named (#198): a revoked or unknown key is never "check
    // your PIN". Signed in, a key the account can replace is replaced in
    // place, once per world and session; otherwise the line says where a new
    // key goes in.
    const entry = getState().registry.worlds.find(w => w.id === from.worldId);
    const reason = result.auth_reason;
    void import('./world-key')
      .then(({ recoverRefusedKey }) => entry ? recoverRefusedKey(entry, reason) : null)
      .catch((err) => { console.warn('[sync-attach] key recovery failed:', err); return null; }) // raw-error-ok: a log
      .then((said) => {
        if (!said) toastManager.error(keyRefusalLine(reason));
        else if (said.ok) toastManager.success(said.line);
        else toastManager.error(said.line);
      });
    return;
  }

  // Non-auth failures with no successes: the round produced zero progress.
  // This is the "lying pill" guard — without a toast here, the user sees the
  // pill go saving → idle and assumes everything synced.
  const synced =
    result.pushed.creates + result.pushed.updates + result.pushed.deletes +
    result.pulled.creates + result.pulled.updates +
    (result.meta_pushed?.length ?? 0) + (result.meta_pulled?.length ?? 0);
  // Say WHY, and say it once per distinct set. A persistent failure (an
  // id owned by another world, an oversized element) used to be silent when
  // anything else synced, and when nothing did, the advice was "test
  // connection", which passes.
  if (result.failures.length > 0) {
    toastFailuresOnce(
      synced === 0 ? result.failures : result.failures.filter(f => classifyFailure(f) !== 'other'),
      currentEngine,
      currentWorldId,
    );
    // Fall through — there might be conflicts to surface too.
  }

  // Dispatch a non-bubbling CustomEvent listing the ids the pull just applied
  // to local. The elements sidebar listens and briefly flashes matching rows
  // (P3) so the user sees that something changed under their nose. Decoupling
  // via a DOM event keeps sync-attach from importing UI modules. No-op when
  // there's nothing to flash.
  if (result.pulled_ids && result.pulled_ids.length > 0) {
    document.dispatchEvent(new CustomEvent('atlas:pulled-ids', {
      detail: { ids: result.pulled_ids.slice() },
    }));
  }


  // A proposal the keeper did not take is no overwrite under any policy: it
  // waits in the review, which says why (conv. 163). Nor is a copy with no record
  // of what OnlyWorlds held (conv. 192): it waits in the review under every policy.
  const plain = result.conflicts.filter(c => !c.proposal && !c.no_baseline);
  // The engine's own policy, never the default: a shared world runs
  // pause-and-review whatever Settings names.
  const policy = from.policy ?? currentEngine?.getPolicy() ?? getState().registry.sync_default_policy ?? 'local-wins';
  const heldIds = result.conflicts.filter(c => c.no_baseline).map(c => c.element_id);
  // Under local-wins nothing else says a row waits: said here (pause-and-review's badge says it).
  if (heldIds.length > 0 && policy !== 'pause-and-review' && from.current) sayHeldCopies(heldIds, from.worldId);
  if (plain.length === 0) return;
  if (policy === 'pause-and-review') return; // badge + modal handle it

  const n = plain.length;

  // Pull-phase conflicts under local-wins: trigger an immediate push so the
  // local version actually propagates without waiting for the autosave timer.
  // The push's own onSyncResult callback emits the user-facing toast — quieter
  // and more accurate than a "will push later" message.
  //
  // CRITICAL: defer to next macrotask. The engine's `inFlight` is still set
  // here (we're called from inside runPullOnly, before `.finally` clears it).
  // Calling pushOnce() synchronously would return the in-flight PULL promise
  // and silently no-op. setTimeout(0) yields until inFlight is cleared.
  if (phase === 'pull') {
    // Capture the world id at schedule time. If the user switches worlds
    // between scheduling and firing (sub-millisecond, but possible via
    // user-driven nav), `currentEngine` will be the new world's engine and
    // pushing on it would propagate the WRONG conflict's intent — and worse,
    // would leave the original world's local divergence un-converged. Bail
    // gracefully if the world has changed.
    const scheduledWorldId = currentWorldId;
    setTimeout(() => {
      const engine = currentEngine;
      if (!engine) return;
      if (currentWorldId !== scheduledWorldId) {
        console.info('[atlas:sync] post-pull-conflict push skipped: world switched during defer', {
          scheduledWorldId,
          currentWorldId,
        });
        return;
      }
      console.info('[atlas:sync] local-wins: pull detected conflict, firing pushOnce to converge');
      engine.pushOnce().catch(err => {
        console.warn('[atlas:sync] post-pull-conflict push failed:', err);
      });
    }, 0);
    return;
  }

  // Push or sync phase: server was overwritten — confirm.
  const message = phase === 'push'
    ? `Your version replaced the online one for ${n} element${n === 1 ? '' : 's'}`
    : `Your version replaced the online one for ${n} element${n === 1 ? '' : 's'}`;
  toastManager.info(message);
}

/**
 * conv. 192: copies with no record of what OnlyWorlds held, waiting for the person (said under local-wins).
 * The sentence names no button: the toast carries the press itself (`reviewAction`).
 */
export function heldCopyLine(n: number): string {
  return n === 1
    ? 'One element waits for you to choose: this copy has no record of what OnlyWorlds held, so Atlas cannot tell which is newer. Nothing was sent.'
    : `${n} elements wait for you to choose: these copies have no record of what OnlyWorlds held, so Atlas cannot tell which is newer. Nothing was sent.`;
}

/** One such toast on screen at a time: a later round's count is said in it, in place. */
export const HELD_COPY_TOAST = 'held-copy-waits';

/**
 * What the held-copy note counts: the held rows of the review, as far as Atlas knows them. A round adds
 * its ids; each count refresh (after a round, a resolve, the review opening) sets them to the review's own.
 * The note (sticky: it carries a press) always says this count, and goes when it is 0, when the engine
 * detaches (a world switch attaches another) and when its world is no longer the open one.
 */
let heldNoteIds = new Set<string>();
let heldNoteWorld: string | null = null;
let heldNoteWatched = false;

function sayHeldCopies(ids: string[], worldId: string | null): void {
  if (heldNoteWorld !== worldId) heldNoteIds = new Set();
  const before = heldNoteIds.size;
  for (const id of ids) heldNoteIds.add(id);
  heldNoteWorld = worldId;
  watchHeldNoteWorld();
  const line = heldCopyLine(heldNoteIds.size);
  if (toastManager.update(HELD_COPY_TOAST, line)) return;
  // Not on screen (closed by the person, or never said): it comes back only for a row not counted yet.
  if (heldNoteIds.size === before && before > 0) return;
  toastManager.show(line, 'info', 12000, { actions: [reviewAction(worldId)], dedupeKey: HELD_COPY_TOAST });
}

/** The review's held rows, read at a count refresh: the note says them, or goes when none is left. */
function recountHeldNote(rows: ReadonlyArray<{ element_id: string; no_baseline?: true }>): void {
  if (heldNoteWorld === null || heldNoteWorld !== currentWorldId) return;
  const ids = rows.filter(c => c.no_baseline).map(c => c.element_id);
  if (ids.length === 0) { closeHeldNote(); return; }
  heldNoteIds = new Set(ids);
  toastManager.update(HELD_COPY_TOAST, heldCopyLine(ids.length));
}

function closeHeldNote(): void {
  // No note said: nothing to take down (a detach runs often, and with no toasts at all in some rooms).
  if (heldNoteWorld === null) return;
  heldNoteIds = new Set();
  heldNoteWorld = null;
  toastManager.dismiss(HELD_COPY_TOAST);
}

/** Leaving the note's world (another opened, or none) takes the note down: it spoke of that world's review. */
function watchHeldNoteWorld(): void {
  if (heldNoteWatched) return;
  heldNoteWatched = true;
  subscribe(() => {
    if (heldNoteWorld !== null && getState().active?.worldId !== heldNoteWorld) closeHeldNote();
  });
}

/**
 * A toast's press that opens the review, the same opener the pill's badge calls. Pressed after another
 * world was opened, it opens nothing and says so, as the review does on a world switch.
 */
export function reviewAction(worldId: string | null): ToastAction {
  return {
    label: 'Review conflicts',
    run: async () => {
      if (getState().active?.worldId !== worldId) {
        toastManager.info('Another world is open now. Switch back to review its conflicts.');
        return;
      }
      const { openConflictReview } = await import('../ui/conflict-review-modal');
      await openConflictReview(toastManager);
    },
  };
}

/**
 * Test-only: invoke the conflict-toast emitter with a synthetic SyncResult.
 * Used to verify the setTimeout(0) world-switch race guard without standing
 * up a full conflict scenario through MSW.
 */
export function __test_emitConflictToasts(
  phase: 'push' | 'pull' | 'sync',
  result: import('../core/types').SyncResult,
  from?: { worldId: string | null; current: boolean; policy?: SyncPolicy },
): void {
  emitConflictToasts(phase, result, from);
}

/** Re-prime `state.data.elements` from the active folder. Fire-and-forget. */
async function refreshElementsCache(): Promise<void> {
  const folder = currentFolder;
  if (!folder) return;
  try {
    const elements = await folder.listElements();
    // Every round ends here: a round that wrote nothing keeps the store's array (same-elements.ts).
    if (!sameElements(getState().data.elements, elements)) patchElementsFrom(folder, elements);
  } catch (err) {
    console.warn('[sync-attach] refresh elements cache failed:', err);
  }
}

/**
 * Re-read world.json into `state.active.meta` after a sync round (world-meta
 * sync). Without this, a pull-applied time_current/description changes
 * the DISK but every consumer keeps rendering the stale slice until reload —
 * the exact gap a handover flagged. Guards: the active world must
 * still be the world this engine belongs to (world switches race idle
 * transitions), and a no-change read patches nothing (avoids spurious
 * re-renders mid-interaction).
 */
async function refreshMetaCache(): Promise<void> {
  if (!currentFolder) return;
  try {
    const active = getState().active;
    if (!active || active.worldId !== currentWorldId) return;
    const meta = await currentFolder.readWorldMeta();
    const prev = JSON.stringify(active.meta);
    if (JSON.stringify(meta) === prev) return;
    const nowActive = getState().active;
    if (!nowActive || nowActive.worldId !== currentWorldId) return;
    patchSlice('active', { ...nowActive, meta });
  } catch (err) {
    console.warn('[sync-attach] refresh meta cache failed:', err);
  }
}

/**
 * Refresh the conflict badge count from the folder's sync-state.json.
 * Fire-and-forget — called after any sync transition + after resolveConflict.
 */
export async function refreshConflictsCount(): Promise<void> {
  if (!currentEngine) {
    const sync = getState().sync;
    if (sync.activeConflictsCount !== 0) {
      patchSlice('sync', { ...sync, activeConflictsCount: 0 });
    }
    closeHeldNote();
    return;
  }
  // The engine asked: a world switch during a read leaves its answer unsaid (the new world's own refresh counts).
  const engine = currentEngine;
  try {
    const list = await engine.listConflicts();
    if (currentEngine !== engine) return;
    recountHeldNote(list);
    // World-meta contested fields count toward the badge too —
    // they're the same "decide later" obligation, just world-shaped.
    const metaList = await engine.listMetaConflicts();
    if (currentEngine !== engine) return;
    const total = list.length + metaList.length;
    const sync = getState().sync;
    if (sync.activeConflictsCount !== total) {
      patchSlice('sync', { ...sync, activeConflictsCount: total });
    }
  } catch (err) {
    console.warn('[sync-attach] refresh conflicts failed:', err);
  }
}

/**
 * Public wrapper for the meta-slice refresh — the conflict modal calls it
 * after resolving a world-settings row (the resolve may have rewritten
 * world.json via 'theirs').
 */
export async function refreshMetaCacheNow(): Promise<void> {
  return refreshMetaCache();
}
