/**
 * SyncEngine — reconciles a folder-backed world with the OnlyWorlds API.
 *
 * One engine per api-linked world. Reads `local_updated_at` / `server_updated_at`
 * timestamps on each element to compute the diff. No pending-ops queue: the
 * timestamps + tombstone log fully describe what's pending.
 */

import { PlainError } from '../core/plain-error';
import type { FolderStore } from '../store/folder-store';
import { nowIso } from '../store/folder-store';
import {
  META_SYNC_FIELDS,
  META_SYNC_FIELD_NAMES,
  EXT_MAX_BYTES,
  canonicalExtValue,
  canonicalMetaValue,
  encodeMetaFieldsForPush,
  extBytesAfter,
  extDirty,
  isMetaEmpty,
  isWorldExtensionKey,
  metaEquals,
  metaFieldLengthError,
  pickExtensionBaseline,
  pickSyncedMeta,
  setExtBaseline,
  threeWayExtDiff,
  threeWayMetaDiff,
} from './world-meta-sync';
import {
  ALL_ELEMENT_TYPES,
} from '../core/types';
import { ATLAS_LOCAL_ONLY_FIELDS, SERVER_AUTHOR_FIELDS, SERVER_MARK_FIELDS } from '../core/constants';
import { keptOnCreate } from '../core/review-mark';
import { CorruptFileError, damagedFileSentence, isFileBusyError } from '../store/fs-utils';
import { restoredLinkPatch } from '../store/scrub-links';
import { mergeForeignIds } from './foreign-ids';
import { keyRefusalOf, keyRefusalPill } from './world-key-lines';
import { hiddenHeldOf } from './hidden-held';
import { hiddenKeptOf, hiddenWordOf, HIDDEN_SHOWN_ONLINE, isHiddenMark } from '../core/hidden-mark';
import { withKeptLinks, withoutKeptLinks } from './kept-links';
import { isKnownOf, knownOfMove, stubShape } from './known-of';
import type {
  Conflict,
  Element,
  ElementType,
  KeyRefusal,
  PerElementFailure,
  ProposedEdit,
  SyncEngineState,
  SyncHoldReason,
  SyncResult,
} from '../core/types';
import { alreadyProposed, isOwProposed, isProposedOnly, settle, withProposed } from './proposals';

// ---- Adapter shape: the minimum the engine needs from the API client ----

/** One /bulk item: an element in DISK shape; the adapter wire-converts. */
export interface BulkItem {
  type: ElementType;
  element: Record<string, unknown>;
}

/** /bulk response, positional with the input items. */
export interface BulkResult {
  /** True when ANY item failed. Under atomic mode: NOTHING was persisted. */
  errors: boolean;
  items: Array<{
    status: number;
    id: string;
    /**
     * Server-authoritative timestamp echo (keel D46, deployed 2026-07-12) —
     * byte-stable with subsequent GET/list serialization. Present on success
     * slots; absent on error slots and on pre-D46 servers (the engine falls
     * back to the read-back backfill for any item lacking it). NEVER trust
     * these on an `errors: true` atomic response (counterfactual echoes).
     */
    updatedAt?: string;
    error?: { code: string; message: string; param: string | null };
  }>;
}

/**
 * World-meta body in DISK names (`time_current`, not the wire's
 * `time_range_current` — the adapter owns the rename both directions).
 * Returned by both getWorldMeta (GET /world) and patchWorldMeta (PATCH echo:
 * keel returns the full refreshed body). Canonical empties: '' / [] / null.
 */
export interface WorldMetaWire {
  id: string;
  name: string;
  description: string;
  image_url: string;
  time_basic_unit: string;
  time_format_names: string[];
  time_format_equivalents: Array<string | number>;
  time_range_min: number | null;
  time_range_max: number | null;
  time_current: number | null;
  length_unit: string;
  mass_unit: string;
  distance_unit: string;
  public_read?: boolean;
  created_at?: string;
  updated_at: string;
  /** The world's first import, as keel serves it: kept, never sent. */
  origin?: Record<string, unknown>;
  /** A profile's keys on the World (`x_names`), as served; synced key by key. */
  [key: `x_${string}`]: unknown;
}

/** One page of the /changes feed (ops in commit order, adapted to disk shape). */
export interface ChangesPage {
  cursor: string | null;
  hasMore: boolean;
  /** World's current change_seq (v2 tail, 2026-07-12). null/absent when the server predates it. */
  head?: number | null;
  changes: Array<
    | { op: 'upsert'; type: ElementType; id: string; changeSeq: number; updatedAt: string; element: { id: string; updated_at: string } & Record<string, unknown> }
    | { op: 'delete'; type: ElementType; id: string; changeSeq: number; deletedAt: string; reason?: string }
  >;
}

/**
 * Subset of the API client surface the engine needs.
 *
 * We don't import the adapter directly so tests can inject a thin client that
 * mirrors only the methods exercised. In production this is satisfied by
 * `OwV2ClientAdapter` (thin fetch, keel v2 dialect).
 */
export interface OwApiClient {
  createElement(type: ElementType, body: Record<string, unknown>): Promise<{ id: string; updated_at: string } & Record<string, unknown>>;
  updateElement(type: ElementType, id: string, body: Record<string, unknown>): Promise<{ id: string; updated_at: string } & Record<string, unknown>>;
  deleteElement(type: ElementType, id: string): Promise<void>;
  /** keel's hide (conv. 173). Absent: a mark added after the element went online stays here only. */
  hideElement?(type: ElementType, id: string): Promise<void>;
  listElements(type: ElementType): Promise<Array<{ id: string; updated_at: string } & Record<string, unknown>>>;
  /** Fetch single element. Used by SyncEngine pre-update conflict check. */
  getElement(type: ElementType, id: string): Promise<({ id: string; updated_at: string } & Record<string, unknown>) | null>;
  /**
   * World-meta read — GET /world's 13-field body in DISK names (world-meta
   * sync). REQUIRED, not optional: an optional method would silently
   * reroute every legacy suite off the meta path (the
   * coverage-migrates-onto-fallbacks law); there are exactly two implementers
   * (OwV2ClientAdapter + FakeOwApiClient), so required is cheap.
   */
  getWorldMeta(): Promise<WorldMetaWire>;
  /**
   * World-meta partial write — PATCH /world with ONLY the given DISK-named
   * fields (the adapter whitelists + renames time_current→time_range_current).
   * Returns the full refreshed body (keel echoes GET /world after the write).
   * Cleared ints must arrive as explicit null — keel treats a missing key as
   * "no change".
   */
  patchWorldMeta(fields: Record<string, unknown>): Promise<WorldMetaWire>;
  /**
   * Optional: atomic multi-element create with server-side FK-order resolution
   * (cycles included) — keel v2 `/bulk`. When present, pushPhase routes CREATE
   * batches of ≥2 through it (the cyclic-Make-Online fix); when absent, the
   * engine falls back to the per-element topo-sorted loop.
   */
  bulkCreate?(items: BulkItem[], opts?: { atomic?: boolean; idempotencyKey?: string }): Promise<BulkResult>;
  /**
   * Optional: one page of the per-world change feed — keel v2 `/changes`.
   * When present, pullPhase uses cursor-delta pull with EXPLICIT delete ops
   * instead of full-list absence inference. `since` is the opaque cursor from
   * the previous page (null = from the world's epoch).
   */
  pullChanges?(since: string | null, limit?: number): Promise<ChangesPage>;
  /** GET /me: the key's role (conv. 151). Absent: the role is unknown, and a resync keeps. */
  me?(): Promise<{ role: string }>;
  /** keel #519's queue, the caller's own rows (conv. 163, P5). Absent: entries stay until it is. */
  listProposals?(): Promise<{ rows: import('./proposals').ProposalRow[]; complete: boolean }>;
  /** The proposer withdraws its own open row (conv. 163, P3). */
  withdrawProposal?(type: ElementType, id: string, proposalId: string): Promise<void>;
  /**
   * Optional: report which element types' most recent listElements() walk may
   * be INCOMPLETE (cursor walk aborted / capped / not advancing). The engine
   * suppresses server-delete detection for those types — an incomplete
   * seenLocalIds would falsely flag unfetched elements as "vanished from
   * server" and prompt a destructive local delete (this backstop
   * survives the v2 port; only its trigger changed from offset pagination to
   * cursor-walk incompleteness).
   *
   * Implementations that always return the full set (test fakes) can omit this.
   * `getPaginatedTypes` is the legacy name for the same contract; the engine
   * consults both.
   */
  getIncompleteListTypes?(): ReadonlySet<ElementType>;
  /** @deprecated legacy name for getIncompleteListTypes — still consulted. */
  getPaginatedTypes?(): ReadonlySet<ElementType>;
}

// ---- Policy ----

/**
 * Conflict resolution policy (Phase 3.5+, simplified).
 *
 * - `local-wins` (default): local edits always win.
 *   - Push: server overwritten; one toast.
 *   - Pull: skip applying server changes for elements local also edited; one toast.
 *   - No badge, no modal, no sync-state entries persisted.
 *
 * - `pause-and-review`: nothing auto-resolves.
 *   - Push: skipped on conflict. Conflict persisted to sync-state.
 *   - Pull: skip applying. Conflict persisted to sync-state.
 *   - ⚠ badge on pill. Modal lets user pick overwrite vs pull per element.
 *
 * Legacy values `drain-blind` / `pause-on-conflict` / `ask` are accepted for
 * backward compatibility — `drain-blind` maps to `local-wins`, the other two
 * map to `pause-and-review`. The engine normalizes internally.
 */
export type ConflictPolicy =
  | 'local-wins'
  | 'pause-and-review'
  // legacy aliases — engine maps these to the new names
  | 'drain-blind'
  | 'pause-on-conflict'
  | 'ask';

/** Internal canonical form after normalizing legacy aliases. */
type CanonicalPolicy = 'local-wins' | 'pause-and-review';

function normalizePolicy(p: ConflictPolicy | undefined): CanonicalPolicy {
  if (p === 'pause-and-review' || p === 'pause-on-conflict' || p === 'ask') {
    return 'pause-and-review';
  }
  // default + 'local-wins' + 'drain-blind' all map to local-wins
  return 'local-wins';
}

export interface SyncEngineOptions {
  folder: FolderStore;
  client: OwApiClient;
  policy?: ConflictPolicy;
  /**
   * View-only world (linked with a READ key, no PIN). The engine never
   * pushes: every push trigger (autosave debounce, flushPendingPush, syncNow's
   * push half, the local-wins convergence push) dies at the `pushOnce` /
   * `requestPush` boundary, and the meta step is pull-apply only (no PATCH).
   */
  readOnly?: boolean;
  /** Where the world's files are (1.17): the pill's damaged-file sentence says it. */
  where?: 'folder' | 'browser';
  /**
   * The api world this engine pushes to. Scopes the recorded foreign ids
   * (sync-state `foreign`): ids refused by one world say nothing about another.
   */
  apiWorldId?: string | null;
  /** Called when a conflict is detected. */
  onConflict?: (conflict: Conflict) => void;
  /** Called whenever engine state changes (for UI). */
  onStateChange?: (state: SyncEngineState) => void;
  /**
   * Per-iteration progress callback during push. Fires after each element
   * (success OR failure). Used by Make-Online flows for an upload progress bar.
   */
  onPushProgress?: (done: number, total: number) => void;
  /**
   * Fires after each sync round completes. `phase` distinguishes push-only
   * (`autosave`), pull-only (`refresh`), and combined (`sync`). UI uses this
   * to emit toasts under `local-wins` policy (no badge/modal in that mode).
   */
  onSyncResult?: (
    phase: 'push' | 'pull' | 'sync',
    result: SyncResult
  ) => void;
}

// ---- The engine ----

export class SyncEngine {
  private folder: FolderStore;
  private client: OwApiClient;
  private policy: CanonicalPolicy;
  /** View-only engine: pull-only, no push of any kind. */
  private readOnly = false;
  private where: 'folder' | 'browser' = 'folder';
  private apiWorldId: string | null = null;
  private onConflict: (conflict: Conflict) => void;
  private onStateChange: (state: SyncEngineState) => void;
  private onPushProgress: (done: number, total: number) => void;
  private onSyncResult: (phase: 'push' | 'pull' | 'sync', result: SyncResult) => void;
  private state: SyncEngineState = { kind: 'idle', last_sync_at: null };
  private paused = false;
  private pauseReason: 'manual' | 'network' | null = null;
  /** In-flight syncNow promise. Concurrent calls await the same result. */
  private inFlight: Promise<SyncResult> | null = null;
  /**
   * What the in-flight promise IS (push/pull/sync). Lets `requestPush`'s
   * debounce re-arm behind an unrelated in-flight PULL instead of silently
   * losing the trigger — the shared inFlight lock returns the pull's promise
   * to pushOnce, and long v2 /changes walks widened that lost-trigger window
   * from milliseconds to whole seconds (2026-07-12).
   */
  private inFlightKind: 'push' | 'pull' | 'sync' | null = null;
  /**
   * Set by stop() (detach/unlink). An in-flight pull round checks this before
   * every local write AND before its terminal sync-state persist — without
   * the check, a walk that outlives detachSyncEngine re-stamps baselines that
   * resetSyncBaseline just cleared and resurrects the cleared changes_cursor,
   * which a later re-link to a DIFFERENT world would inherit (silently
   * skipping that world's history below the stale watermark) (2026-07-12).
   * Engines are never restarted after stop() — a fresh engine is
   * built per attach — so this latch never needs resetting.
   */
  private stopped = false;
  /**
   * The world-meta fields keel last refused as `owner_only` (a co-builder or
   * contributor changed the world's own details), with the failure it raised.
   * While the dirty fields are exactly these, the meta step does not PATCH
   * again: it reports the SAME failure object, which `failureToastOnce` has
   * already decided, so the change stays honest in the status and is told once
   * (Kael's collaborator walk 2026-10-18: it was re-sent and
   * re-told on every round). A new edit changes the fields and tries again.
   */
  private metaOwnerRefusal: { sig: string; failure: PerElementFailure } | null = null;
  /** The x_ keys' body keel last refused (or Atlas found too big), by content. */
  private extRefusal: { sig: string; failure: PerElementFailure } | null = null;
  /** Debounce timer for `requestPush()` autosave. Reset on each write. */
  private debouncePushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Debounce window for autosave pushes. ms. Configurable via setDebounceMs. */
  private debouncePushMs = 5000;
  /**
   * When the currently-scheduled push will fire (epoch ms), null when no
   * debounce is armed. Exposed via `getPendingPush()` and broadcast via the
   * `atlas:pending-push` CustomEvent so the sync pill can render a decay
   * ring around the dot during the debounce window.
   */
  private pendingPushScheduledAt: number | null = null;
  /**
   * Most recent `last_sync_at` we've reported via state. Survives pause/resume
   * so the pill's "synced X min ago" tooltip doesn't reset to "never synced"
   * the moment the user toggles stay-offline. `setState` writes this whenever
   * an idle transition carries a non-null timestamp; `resume()` reads it back.
   */
  private lastSyncAt: string | null = null;

  constructor(opts: SyncEngineOptions) {
    this.folder = opts.folder;
    this.client = opts.client;
    this.readOnly = !!opts.readOnly;
    this.where = opts.where ?? 'folder';
    this.apiWorldId = opts.apiWorldId ?? null;
    this.policy = normalizePolicy(opts.policy);
    this.onConflict = opts.onConflict ?? (() => {});
    this.onStateChange = opts.onStateChange ?? (() => {});
    this.onPushProgress = opts.onPushProgress ?? (() => {});
    this.onSyncResult = opts.onSyncResult ?? (() => {});
  }

  getState(): SyncEngineState {
    return this.state;
  }

  /**
   * Live-update the policy on a running engine. Called from settings when the
   * user flips the radio so the change takes effect immediately without
   * detaching/re-attaching the engine (which would interrupt in-flight syncs).
   */
  setPolicy(p: ConflictPolicy): void {
    this.policy = normalizePolicy(p);
  }

  /** The policy this engine runs now (a shared world's may differ from the default). */
  getPolicy(): CanonicalPolicy {
    return this.policy;
  }

  pause(reason: 'manual' | 'network' = 'manual'): void {
    this.paused = true;
    this.pauseReason = reason;
    // Under a hold the pill keeps saying what is happening; the release
    // republishes this pause.
    if (this.holds > 0) return;
    this.setState({ kind: 'paused', reason, pending_changes: 0 });
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Paused because the browser went offline: what the `online` listener lifts.
   *  Read from the engine, never from the published state, which says `held`
   *  during a re-key (once, the network pause outlived the network). */
  isNetworkPaused(): boolean {
    return this.paused && this.pauseReason === 'network';
  }

  /** A round that ends during a hold leaves the state to the hold. */
  private settleIdle(lastSyncAt: string | null): void {
    if (lastSyncAt) this.lastSyncAt = lastSyncAt;
    if (this.holds > 0) return;
    this.setState({ kind: 'idle', last_sync_at: lastSyncAt });
  }

  /**
   * Holds taken by an exclusive local operation (the re-key). Separate
   * from `paused` on purpose: `resume()` cannot
   * release a hold, and releasing one cannot clear a user, auth or corrupt
   * pause. Every round entry and push trigger reads `blocked`.
   */
  private holds = 0;
  /** Why each standing hold was taken, oldest first: the pill names the newest. */
  private holdReasons: SyncHoldReason[] = [];

  private get blocked(): boolean {
    return this.paused || this.holds > 0;
  }

  isHeld(): boolean {
    return this.holds > 0;
  }

  /**
   * Stop all sync for an exclusive local operation. Clears the debounce and
   * retry timers, then waits until no round is in flight, so nothing reaches
   * the server between this resolving and `release()`. `pause()` alone does
   * neither: a running round checks `stopped`, never `paused`, and would keep
   * creating and stamping (probed). The returned release works once;
   * it pushes only when no other hold or pause remains (a world the user set to
   * stay offline stays offline).
   */
  async hold(reason: SyncHoldReason): Promise<() => void> {
    this.holds++;
    this.holdReasons.push(reason);
    if (this.debouncePushTimer) {
      clearTimeout(this.debouncePushTimer);
      this.debouncePushTimer = null;
    }
    if (this.transientRetryTimer) {
      clearTimeout(this.transientRetryTimer);
      this.transientRetryTimer = null;
    }
    this.setPendingPush(null);
    while (this.inFlight) await this.inFlight.catch(() => {});
    // What the world said before the hold: an auth or corrupt-file error keeps
    // its red pill and its message afterwards.
    const before = this.state;
    // `held_for` is what the pill says: a re-key and a big batch of
    // outside edits waiting for the user's answer are different sentences.
    this.setState({ kind: 'paused', reason: 'held', pending_changes: 0, held_for: reason });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds--;
      const at = this.holdReasons.indexOf(reason);
      if (at >= 0) this.holdReasons.splice(at, 1);
      if (this.stopped) return;
      if (this.holds > 0) {
        // Another hold still stands: the pill says ITS sentence.
        this.setState({ kind: 'paused', reason: 'held', pending_changes: 0, held_for: this.holdReasons[this.holdReasons.length - 1] });
        return;
      }
      if (this.paused) {
        if (before.kind === 'error') this.setState(before);
        else this.setState({ kind: 'paused', reason: this.pauseReason ?? 'manual', pending_changes: 0 });
        return;
      }
      this.setState({ kind: 'idle', last_sync_at: this.lastSyncAt });
      void this.pushOnce().catch(err => console.warn('[atlas:sync] push after hold failed:', err));
    };
  }

  /** Resolving a conflict writes to the server directly; never during a hold. */
  private async assertNotHeld(): Promise<void> {
    if (this.holds > 0 || await this.folder.hasRekeyJournal()) {
      throw new PlainError('Ids are being updated in this world. Try again when that finishes.');
    }
  }

  /**
   * A re-key journal on disk means an id update is unfinished (a crash, a
   * failed run): no round may start until it completes, on any engine attached
   * by any path.
   */
  /** The gate is the round's first disk touch: a throw must settle like any
   *  other round error, never leave the pill on "Saving". */
  private async rekeyPendingGuarded(): Promise<boolean> {
    try {
      return await this.rekeyPending();
    } catch (err) {
      this.settleThrownRound(err);
      throw err;
    }
  }

  private async rekeyPending(): Promise<boolean> {
    if (!(await this.folder.hasRekeyJournal())) return false;
    this.setState({ kind: 'paused', reason: 'held', pending_changes: 0, held_for: 'rekey' });
    return true;
  }

  resume(): void {
    this.paused = false;
    this.pauseReason = null;
    // A hold outlives a resume: the holder's release does the push.
    if (this.holds > 0) return;
    // Preserve last_sync_at from before pause — toggling stay-offline off
    // shouldn't erase the pill's "synced X min ago" tooltip. The push round
    // below (or a subsequent successful sync) will stamp a fresher value if
    // anything actually moves.
    this.setState({ kind: 'idle', last_sync_at: this.lastSyncAt });
    // Flush pending writes immediately. Without this, edits the user made
    // during the pause window sit on disk indefinitely: `requestPush()`
    // early-returned while paused (no debounce timer was scheduled), so
    // `resume()` clearing the flag alone doesn't have a queued push to fire.
    // The next user edit would re-arm autosave and eventually carry them up,
    // but the smoke-observable behavior is "edit, pause, unpause → no push" —
    // confusing and silently broken.
    //
    // pushOnce is async + idempotent: shares the inFlight lock so concurrent
    // callers don't race, and emits the normal SyncResult through
    // onSyncResult so toasts + auth handling + conflict surfacing all fire
    // through the existing pipeline. Failures (network, auth) transition the
    // engine the same way an autosave failure would.
    //
    // Three callers benefit: per-world "stay offline" uncheck, global
    // pause-all uncheck, and the `online` event listener (network return).
    void this.pushOnce().catch(err => {
      console.warn('[atlas:sync] resume-flush push failed:', err);
    });
  }

  /**
   * Mark the engine as auth-blocked. Called when a push or pull round bails
   * out due to 401/403 — there's no point retrying with the same dead key,
   * and the user needs to know via the pill.
   *
   * Sets `paused = true` so `requestPush()` short-circuits and the autosave
   * debounce stops firing against a dead endpoint. Transitions state to
   * `error` so the pill renders red with the recovery message in the tooltip.
   *
   * Recovery: changing PIN in settings re-attaches a fresh engine (see
   * `sync-attach.attachSyncEngine`). The new engine starts at idle. The user
   * can also unlink the world from settings → World tab.
   */
  /**
   * A round threw. The pill must not stay on "Saving...", so it goes
   * back to idle, EXCEPT for a sync file that exists and will not parse:
   * then the engine pauses and the pill turns red with the
   * file's own message ("fix or remove the file"). Before, a corrupt
   * sync-state.json replayed the whole world every round, failed at the
   * persist, and said nothing anywhere.
   */
  private transientRetryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Push rounds in a row that met a held file: caps the busy retries. */
  private busyRounds = 0;
  /**
   * Proposals keel took whose sync-state entry could not be written (a held
   * file): kept here until a write lands, and read with the
   * file's entries, so no retry round proposes the same version again.
   */
  private unwrittenProposals: ProposedEdit[] = [];

  /**
   * The key's role from keel's `GET /me` (conv. 151): read when a
   * resync or a guest's 404 needs it, kept for the engine's life, read again
   * after every 409. Undefined: not read yet; null: unknown (no `me`, or the
   * read failed), and an unknown role keeps.
   */
  private roleRead: Promise<string | null> | null = null;

  /** The kept set as the running push or resolve read it: links to these never go out (`kept-links.ts`). */
  private roundKept: ReadonlySet<string> = new Set();
  /** What the running push found out of a guest's view (a 404, a peer keel says does not exist): kept at its end. */
  private roundKeptAdd: string[] = [];
  /** Creates keel refused with `hidden_not_allowed` this round (conv. 170): held, never a failure. */
  private roundHiddenRefused: string[] = [];
  /** Hidden locals whose id OnlyWorlds shows (conv. 170): not adopted, said once. */
  private roundHiddenShown: string[] = [];
  /** The role as the running push read it, afresh once per round: a lowering while open moves it. */
  private roundRole: Promise<string | null> | null = null;

  private roundRoleNow(): Promise<string | null> {
    this.roundRole ??= this.ownRole(true);
    return this.roundRole;
  }

  /** Ids whose links never go out: the kept set and what left the view (`left_view`, keel's one-rule §3). */
  private roundLinkHeld: ReadonlySet<string> = new Set();

  /** An element's body as sent: sync stamps off, links to kept or left elements left out (keel keeps them). */
  private outgoing(elem: Element): Record<string, unknown> {
    return withoutKeptLinks(elem.type, stripSyncFields(elem), this.roundLinkHeld);
  }

  /**
   * Whether keel may have marked this key's new elements proposed (conv. 168): a key that is not a
   * keeper (an agent seat is a contributor). The owner's and a co-builder's writes are settled.
   */
  private async marksPossible(): Promise<boolean> {
    const role = await this.roundRoleNow();
    return role !== null && role !== 'owner' && role !== 'co_builder';
  }

  /** conv. 170: the never-sent elements this key cannot put online, when it cannot hide; none otherwise, or while the role is unknown (keel's 403 then says it). */
  private async hiddenHeldNow(creates: Element[]): Promise<Set<string>> {
    if (!creates.some(isHiddenMark)) return new Set();
    if (!hiddenCanBeDenied(await this.roundRoleNow())) return new Set();
    return hiddenHeldOf(creates);
  }

  /** Ids keel refused to hide for this key this session (conv. 173): never asked again until the role moves. */
  private hideRefused = new Set<string>();
  private hideRefusedRole: string | null = null;

  /**
   * conv. 173 (folder spec 4.8, Skeld 2026-10-24): keel's hide for an element online that the file
   * marks hidden, by the owner's or a co-builder's key only. `hidden` on keel's 204. `not-sent` for
   * another role, a client without the route, keel's 403 or its 404 (the route off, or the element
   * gone: the write after it says which): the copy keeps today's word and line. `role-unknown` when the
   * role could not be read: the caller holds the write for the next round.
   * A 401, 429, 503 or a lost network throws, as the write after it would. `role` defaults to the round's.
   */
  private async hideOnline(type: ElementType, id: string, role?: string | null): Promise<'hidden' | 'not-sent' | 'role-unknown'> {
    if (typeof this.client.hideElement !== 'function') return 'not-sent';
    const r = role === undefined ? await this.roundRoleNow() : role;
    if (r === null) return 'role-unknown';
    if (r !== 'owner' && r !== 'co_builder') return 'not-sent';
    if (r !== this.hideRefusedRole) { this.hideRefused.clear(); this.hideRefusedRole = r; }
    if (this.hideRefused.has(id)) return 'not-sent';
    try {
      await this.client.hideElement(type, id);
    } catch (err) {
      const t = typedError(err);
      if (t?.status !== 403 && !isNotFoundError(err)) throw err;
      if (t?.status === 403) this.hideRefused.add(id);
      console.info('[atlas:sync] keel did not hide it for this key — it stays hidden here only', { id, type, status: t?.status });
      return 'not-sent';
    }
    console.info('[atlas:sync] hidden on OnlyWorlds: the file marks it hidden', { id, type });
    return 'hidden';
  }

  /**
   * conv. 173, the clean copies: an element on the server that the file marks hidden, with keel's
   * last word that it shows it (1.86.2's `atlas_hidden_shown_online`) and no edit waiting, gets the
   * hide, then a read back; when keel's answer carries the mark the copy takes it as a pull would,
   * which drops the word. The file is read again right before the hide, an edit
   * landing after wins and goes up next round, and a round asks at most `HIDE_SWEEP_CAP`.
   */
  private async hideShownCopies(skip: ReadonlySet<string>): Promise<void> {
    const owes = (e: Element) =>
      typeof e.server_updated_at === 'string' && isHiddenMark(e)
      && (e as Record<string, unknown>)[HIDDEN_SHOWN_ONLINE] === true
      && !(e.local_updated_at > e.server_updated_at) && !skip.has(e.id) && !isKnownOf(e);
    const owed = (await this.folder.listElements()).filter(owes).slice(0, HIDE_SWEEP_CAP);
    for (const listed of owed) {
      if (this.stopped) return;
      const e = await this.folder.getElement(listed.id);
      if (!e || !owes(e)) continue;
      if (await this.hideOnline(e.type, e.id) !== 'hidden') continue;
      const remote = await this.client.getElement(e.type, e.id);
      if (!remote || !isHiddenMark(remote) || this.stopped) continue;
      await this.folder.applyServerRecordIfUnchanged(
        e.type, withKeptLinks(e.type, stripServerOnlyFields(remote), e, this.roundLinkHeld), remote.updated_at, e.local_updated_at ?? null);
    }
  }

  private ownRole(fresh = false): Promise<string | null> {
    if (fresh || !this.roleRead) {
      const me = this.client.me?.bind(this.client);
      this.roleRead = me
        ? me().then(r => r.role, (err: unknown) => {
          console.info('[atlas:sync] the key\'s role could not be read', err);
          this.roleRead = null;
          return null;
        })
        : Promise.resolve(null);
    }
    return this.roleRead;
  }

  /** One retry after a busy/unreachable round, never a loop: the timer is
   *  single, and a round that fails again schedules the next one itself. */
  private scheduleTransientRetry(ms: number | undefined): void {
    if (this.transientRetryTimer) clearTimeout(this.transientRetryTimer);
    const delay = Math.min(Math.max(ms ?? TRANSIENT_RETRY_DEFAULT_MS, 1000), 15 * 60_000);
    this.transientRetryTimer = setTimeout(() => {
      this.transientRetryTimer = null;
      if (this.stopped || this.blocked) return;
      // A pull in flight would hand pushOnce its own promise and the retry
      // would never push: wait for it, then push.
      const retry = (): void => {
        if (this.stopped || this.blocked) return;
        void this.pushOnce().catch(err => console.warn('[atlas:sync] transient retry failed:', err));
      };
      if (this.inFlight && this.inFlightKind === 'pull') void this.inFlight.then(retry, retry);
      else retry();
    }, delay);
  }

  private settleThrownRound(err: unknown): void {
    if (err instanceof CorruptFileError) {
      this.paused = true;
      this.pauseReason = 'manual';
      // The pill title is user copy: the file and the fix, not JSON.parse's text.
      this.setState({ kind: 'error', message: damagedFileSentence(err.fileName, this.where), recoverable: true });
      return;
    }
    this.setState({ kind: 'idle', last_sync_at: null });
  }

  private setAuthError(): void {
    this.paused = true;
    this.pauseReason = 'manual';
    this.setState({
      kind: 'error',
      message: keyRefusalPill(this.lastAuthReason),
      recoverable: true,
    });
  }

  /**
   * Cause of the most recent auth bail, when the typed error distinguished it
   * (`keyRefusalOf`, #198): a revoked key, a key keel no longer knows, a
   * refused PIN, a read key (403 permission_error: "check your PIN" would be
   * the wrong advice). Null for an untyped 401. Read into
   * SyncResult's `auth_reason` and setAuthError's pill copy; reset at each
   * bail site.
   */
  private lastAuthReason: KeyRefusal | null = null;

  private noteAuthBail(err: unknown): void {
    this.lastAuthReason = keyRefusalOf(err);
  }

  /**
   * Request a debounced push. Called by element-detail after every folder
   * write (popover save, link/delink, delete). The timer resets on each call,
   * so a burst of edits coalesces into one push N seconds after the last edit.
   *
   * No-op while paused — the user is intentionally offline.
   *
   * Override the debounce window for tests via `setDebounceMs`.
   */
  requestPush(): void {
    if (this.readOnly) return; // view-only world — nothing ever pushes
    if (this.blocked) {
      console.info('[atlas:sync] push requested but engine paused — skipping');
      return;
    }
    if (this.debouncePushTimer) clearTimeout(this.debouncePushTimer);
    this.debouncePushTimer = setTimeout(() => {
      this.debouncePushTimer = null;
      this.setPendingPush(null);
      // If a PULL is in flight, calling pushOnce now would return the pull's
      // promise via the shared inFlight lock and the push would silently
      // never run (the debounce timer is already consumed). Re-arm behind
      // the in-flight round instead of dropping the user's edit trigger.
      if (this.inFlight && this.inFlightKind === 'pull') {
        console.info('[atlas:sync] debounce fired during in-flight pull — re-arming push behind it');
        void this.inFlight.finally(() => {
          if (!this.blocked) this.requestPush();
        });
        return;
      }
      console.info('[atlas:sync] debounce fired → pushOnce');
      void this.pushOnce().then(r => {
        console.info('[atlas:sync] push complete', {
          creates: r.pushed.creates,
          updates: r.pushed.updates,
          deletes: r.pushed.deletes,
          conflicts: r.conflicts.length,
          failures: r.failures.length,
        });
        if (r.failures.length > 0) {
          console.warn('[atlas:sync] push failures:', r.failures);
        }
      }).catch(err => {
        console.error('[atlas:sync] push errored:', err);
      });
    }, this.debouncePushMs);
    this.setPendingPush(Date.now() + this.debouncePushMs);
    console.info('[atlas:sync] push scheduled (debounce', this.debouncePushMs, 'ms)');
  }

  /**
   * Live debounce window setter. Settings → Sync's "Autosave delay" slider
   * calls this on change; sync-attach also calls it after constructing the
   * engine using the user's persisted preference. Does NOT re-arm any
   * in-flight debounce — the new value applies to the NEXT `requestPush()`.
   */
  setDebounceMs(ms: number): void {
    this.debouncePushMs = Math.max(0, Math.floor(ms));
  }

  /** Current debounce window (ms). Used by Settings UI to render the slider value. */
  getDebounceMs(): number {
    return this.debouncePushMs;
  }

  /**
   * Returns the current pending-push window, or null when no debounce timer
   * is armed. Caller can compute `scheduledAt - Date.now()` for time-left.
   * Used by the sync pill to render its decay ring.
   */
  getPendingPush(): { scheduledAt: number; debounceMs: number } | null {
    if (this.pendingPushScheduledAt === null) return null;
    return { scheduledAt: this.pendingPushScheduledAt, debounceMs: this.debouncePushMs };
  }

  /**
   * Cancel the pending debounce timer and fire `pushOnce()` immediately.
   * The sync pill calls this when the user clicks during a pending window
   * ("push now, don't wait"). No-op if no debounce is armed or while paused.
   *
   * Same lost-trigger guard as `requestPush`: when a
   * PULL is in flight, a bare pushOnce() would return the pull's promise via
   * the shared inFlight lock and the user's explicit "push now" would
   * silently do nothing — chain the push behind the pull instead.
   */
  flushPendingPush(): Promise<SyncResult> | null {
    if (this.blocked) return null;
    if (!this.debouncePushTimer) return null;
    clearTimeout(this.debouncePushTimer);
    this.debouncePushTimer = null;
    this.setPendingPush(null);
    if (this.inFlight && this.inFlightKind === 'pull') {
      console.info('[atlas:sync] flush-pending-push during in-flight pull — chaining push behind it');
      const chained = this.inFlight.then(() => {
        if (this.blocked) return emptyResult();
        return this.pushOnce();
      });
      return chained;
    }
    return this.pushOnce();
  }

  /**
   * Update pendingPushScheduledAt and broadcast via a DOM event so the sync
   * pill (which subscribes to `state.sync.activeSync` for kind-level changes,
   * not millisecond updates) can react without polluting the engine state
   * union with timestamps.
   */
  private setPendingPush(scheduledAt: number | null): void {
    this.pendingPushScheduledAt = scheduledAt;
    if (typeof document === 'undefined') return;
    try {
      document.dispatchEvent(new CustomEvent('atlas:pending-push', {
        detail: scheduledAt === null
          ? { scheduledAt: null, debounceMs: this.debouncePushMs }
          : { scheduledAt, debounceMs: this.debouncePushMs },
      }));
    } catch { /* document not available in some test environments */ }
  }

  /** Stop the engine: cancel pending debounced push, pause, and flag any
   *  in-flight round to abort its writes + terminal persist. Used on detach. */
  stop(): void {
    if (this.debouncePushTimer) {
      clearTimeout(this.debouncePushTimer);
      this.debouncePushTimer = null;
    }
    if (this.transientRetryTimer) {
      clearTimeout(this.transientRetryTimer);
      this.transientRetryTimer = null;
    }
    this.setPendingPush(null);
    this.paused = true;
    this.pauseReason = 'manual';
    this.stopped = true;
  }

  /**
   * Resolve a pending conflict (3.5+). Removes the conflict from sync-state
   * and applies the chosen action:
   *   - `overwrite-mine`: re-push local element to server. Server's content
   *             is overwritten with local's. Stamps `server_updated_at` on
   *             local. Bypasses pre-update GET (the user explicitly asked).
   *   - `pull-theirs`: fetch server's current state, write to local folder.
   *             Local's pending edit to this element is LOST (the user
   *             explicitly asked).
   *
   * Throws on network/server error so the UI can show a row-level error.
   */
  async resolveConflict(
    id: string,
    action: 'overwrite-mine' | 'pull-theirs'
  ): Promise<void> {
    await this.assertNotHeld();
    console.info(`[atlas:sync] resolveConflict ${action} ${id}`);
    const syncState = await this.folder.readSyncState();
    const conflict = syncState.conflicts.find(c => c.element_id === id);
    if (!conflict) {
      console.info(`[atlas:sync] resolveConflict: no conflict entry for ${id} — already cleared`);
      return;
    }
    // Kept elements (conv. 151): neither side can reach keel for this key, and
    // links to them never go out.
    this.roundKept = new Set(syncState.kept_outside_view ?? []);
    this.roundLinkHeld = linkHeld(syncState);
    const keepHere = async (): Promise<void> => {
      await this.folder.updateSyncState(s => ({
        conflicts: s.conflicts.filter(c => c.element_id !== id),
        kept_outside_view: [...new Set([...(s.kept_outside_view ?? []), id])],
      }));
    };

    // keel's stub is never sent (conv. 155, I4): keeping mine takes theirs.
    if (action === 'overwrite-mine' && isKnownOf(await this.folder.getElement(id))) {
      console.info('[atlas:sync] resolveConflict overwrite-mine on a known-of stub: never sent, taking theirs', { id });
      action = 'pull-theirs';
    }
    if (action === 'overwrite-mine') {
      const local = await this.folder.getElement(id);
      if (!local) throw new Error(`element ${id} not found locally`);
      if (this.roundKept.has(id)) {
        console.info('[atlas:sync] resolveConflict overwrite-mine: kept outside this key\'s view — stays here', { id });
        await keepHere();
        return;
      }
      // conv. 173: keeping mine sends the edit, so a mark keel does not hold goes
      // as its hide first, by a role read now; a role that cannot be read sends nothing.
      if (local.server_updated_at && isHiddenMark(local)) {
        const remote = await this.client.getElement(local.type, id);
        if (remote && !isHiddenMark(remote)
          && await this.hideOnline(local.type, id, await this.ownRole(true)) === 'role-unknown') {
          throw new PlainError('OnlyWorlds did not say what this key may do, so nothing was sent. Try again in a moment.');
        }
      }
      const body = this.outgoing(local);
      console.info(`[atlas:sync] resolveConflict overwrite-mine: pushing local to server`, {
        id, type: local.type, hasServerBaseline: !!local.server_updated_at,
      });
      try {
        const response = local.server_updated_at
          ? await this.client.updateElement(local.type, id, body)
          : await this.client.createElement(local.type, body);
        await this.folder.stampServerUpdatedAt(id, local.type, response.updated_at, local.local_updated_at,
          keptFrom(response, !local.server_updated_at));
        console.info(`[atlas:sync] resolveConflict overwrite-mine: stamped baseline ${response.updated_at}`);
      } catch (err) {
        // Keep mine on a reviewed world proposes again (conv. 163, P5): the
        // conflict goes and the new proposal waits for the keeper.
        if (isOwProposed(err) && local.server_updated_at) {
          const entry: ProposedEdit = { element_id: id, type: local.type, proposal_id: err.proposal.id, local_updated_at: local.local_updated_at, at: nowIso() };
          // Recorded as any proposal is, withdrawing the open row it replaces.
          await this.recordProposal(entry);
          await this.folder.updateSyncState(s => ({ conflicts: s.conflicts.filter(c => c.element_id !== id) }));
          console.info('[atlas:sync] resolveConflict overwrite-mine: keel took it as a proposal', { id, proposal: err.proposal.id });
          return;
        }
        if (local.server_updated_at && isNotFoundError(err) && await this.ownRole(true) === 'guest') {
          // A guest's 404 is out of view, not deleted (conv. 151): kept here.
          console.info('[atlas:sync] resolveConflict overwrite-mine: a guest\'s 404 — kept here', { id });
          await keepHere();
          return;
        }
        if (local.server_updated_at && isNotFoundError(err)) {
          // Server deleted this element between the conflict and our resolve.
          // Don't surface as a raw error — clear the conflict, route to
          // server_deletes for review. Same UX as pull-time detection.
          console.info('[atlas:sync] resolveConflict overwrite-mine: server has lost element — routing to server-delete review', {
            id, type: local.type,
          });
          // Fresh read inside the store's sync-state chain — the snapshot
          // taken before our network I/O may be stale by now (a concurrent
          // round can have added conflicts/server-deletes meanwhile).
          await this.folder.updateSyncState(s => ({
            conflicts: s.conflicts.filter(c => c.element_id !== id),
            server_deletes: [
              ...(s.server_deletes ?? []),
              { id, type: local.type, detected_at: nowIso(), name: local.name },
            ],
          }));
          return;
        }
        throw err;
      }
    } else if (action === 'pull-theirs') {
      console.info(`[atlas:sync] resolveConflict pull-theirs: fetching ${conflict.type}/${id}`);
      const remote = this.roundKept.has(id) ? null : await this.client.getElement(conflict.type, id);
      if (!remote && (this.roundKept.has(id) || await this.ownRole(true) === 'guest')) {
        // Nothing online this key may read: the copy keeps its own (conv. 151).
        console.info('[atlas:sync] resolveConflict pull-theirs: outside this key\'s view — the copy keeps its own', { id });
        await keepHere();
        return;
      }
      if (!remote) throw new Error(`element ${id} not found on server (already deleted?)`);
      const local = await this.folder.getElement(id);
      const { updated_at, ...fetched } = remote;
      const body = local ? withKeptLinks(conflict.type, fetched, local, this.roundLinkHeld) : fetched;
      console.info(`[atlas:sync] resolveConflict pull-theirs: applying server record`, {
        id,
        type: conflict.type,
        server_updated_at: updated_at,
        fieldCount: Object.keys(body).length,
        descriptionPreview: typeof body.description === 'string'
          ? (body.description as string).slice(0, 60)
          : undefined,
      });
      await this.folder.applyServerRecord(conflict.type, body, updated_at);
      console.info(`[atlas:sync] resolveConflict pull-theirs: applied; local file now reflects server`);
    }

    // Clear the conflict regardless of action. Computed from the CURRENT
    // state inside the chain — not the pre-network snapshot above.
    await this.folder.updateSyncState(s => ({
      conflicts: s.conflicts.filter(c => c.element_id !== id),
    }));
  }

  /** List currently-recorded conflicts. Reads from sync-state.json. */
  async listConflicts(): Promise<import('../core/types').Conflict[]> {
    const s = await this.folder.readSyncState();
    return [...s.conflicts];
  }

  /** List pending server-deleted records awaiting user review. */
  async listServerDeletes(): Promise<import('../core/types').ServerDeleteRecord[]> {
    const s = await this.folder.readSyncState();
    return [...(s.server_deletes ?? [])];
  }

  /** Contested world-meta fields under pause-and-review. */
  async listMetaConflicts(): Promise<string[]> {
    const s = await this.folder.readSyncState();
    return [...(s.meta_conflicts ?? [])];
  }

  /**
   * Resolve one contested world-meta field (conflict-review modal).
   * 'mine' force-pushes the local value; 'theirs' applies the server value
   * locally. Either way the field's baseline advances and it leaves
   * meta_conflicts.
   */
  /**
   * A CREATE came back "id already on the server" (a lost response, a
   * backfill miss): adopt the server's copy as the baseline. The bug fixed:
   * adopting used to stamp clean unconditionally, so an edit made while the
   * lost create was in flight read as synced (its `local_updated_at` sorts
   * below the server's commit) and never uploaded. Now the bodies are
   * compared: when the local content differs from what the server holds, the
   * element stays dirty and goes out as an UPDATE next round. The comparison
   * errs toward "differs" (one redundant UPDATE), never toward "same" (a lost
   * edit).
   */
  /**
   * The round-end conflict write: a held sync-state file is
   * a world failure like the other round-end writes; anything else settles
   * the state (never a pill stuck on 'Saving') and ends the round.
   */
  private async persistConflictsGuarded(conflicts: Conflict[], failures: PerElementFailure[]): Promise<void> {
    try {
      await this.persistConflicts(conflicts);
    } catch (err) {
      if (isFileBusyError(err)) {
        failures.push({ ...failureOf('world', 'world', 'update', err), source: 'disk' });
        return;
      }
      this.settleThrownRound(err);
      throw err;
    }
  }

  private async adoptServerCopy(local: Element, served: { updated_at: string } & Record<string, unknown>): Promise<void> {
    // conv. 173: the owner's or a co-builder's key hides it there first, and keel's read back is the
    // copy adopted. A failed hide sends nothing: today's way, and the next round asks again.
    let remote = served;
    if (isHiddenMark(local) && !isHiddenMark(served)
      && await this.hideOnline(local.type, local.id).catch(() => 'not-sent' as const) === 'hidden') {
      const back = await this.client.getElement(local.type, local.id).catch(() => null);
      if (back) remote = back;
    }
    // conv. 170: a hidden local whose id OnlyWorlds shows is not adopted, or its content would go up as
    // an update onto what every member sees. It stays here, said once, until hidden there.
    if (isHiddenMark(local) && !isHiddenMark(remote) && !sameWireContent(local, remote)) {
      this.roundHiddenShown.push(local.id);
      console.info('[atlas:sync] a hidden element here is shown online under its id — not adopted, nothing sent', { id: local.id });
      return;
    }
    await this.folder.stampServerUpdatedAt(
      local.id, local.type as ElementType, remote.updated_at,
      sameWireContent(local, remote) ? (local.local_updated_at as string | undefined) : null,
      hiddenWordOf(remote),
    );
  }

  /**
   * A pull-side local write. A file another program holds
   * (OneDrive, antivirus) is a per-element failure and the pull goes on, as
   * the push's `localStep` does; anything else still ends the round.
   */
  private async pullWrite(
    failures: PerElementFailure[],
    id: string,
    type: ElementType,
    step: () => Promise<unknown>,
  ): Promise<boolean> {
    try {
      await step();
      return true;
    } catch (err) {
      if (!isFileBusyError(err)) throw err;
      failures.push({ ...failureOf(id, type, 'read', err), source: 'disk' });
      return false;
    }
  }

  /**
   * A never-stamped local the server holds with the SAME content is our own
   * create whose stamp a held file refused: adopt the
   * server's stamp instead of reporting a conflict with ourselves. Returns
   * true when the element was handled (adopted, or the adopt was refused by a
   * held file and recorded).
   */
  private async adoptOwnCreate(
    failures: PerElementFailure[],
    local: Element,
    type: ElementType,
    remoteBody: Record<string, unknown>,
    serverStamp: string,
  ): Promise<'no' | 'adopted' | 'held'> {
    if (local.server_updated_at || !sameWireContent(local, remoteBody)) return 'no';
    const wrote = await this.pullWrite(failures, local.id, type, () =>
      this.folder.stampServerUpdatedAt(local.id, type, serverStamp, local.local_updated_at as string | undefined, hiddenWordOf(remoteBody)));
    if (!wrote) return 'held'; // the /changes walk must not pass it
    console.info(`[atlas:sync] pull: ${type}/${local.id} is our own create with an unrecorded stamp; baseline adopted`);
    return 'adopted';
  }

  async resolveMetaConflict(field: string, choice: 'mine' | 'theirs'): Promise<void> {
    await this.assertNotHeld();
    if (isWorldExtensionKey(field)) return this.resolveExtConflict(field, choice);
    const kind = META_SYNC_FIELDS[field];
    if (!kind) throw new Error(`resolveMetaConflict: unknown meta field '${field}'`);
    let baselineValue: unknown;
    if (choice === 'mine') {
      const local = await this.folder.readWorldMeta({ strict: true });
      const resp = await this.client.patchWorldMeta(
        encodeMetaFieldsForPush({ [field]: (local as unknown as Record<string, unknown>)[field] }),
      );
      baselineValue = canonicalMetaValue(kind, (resp as unknown as Record<string, unknown>)[field]);
    } else {
      const server = await this.client.getWorldMeta();
      const value = canonicalMetaValue(kind, (server as unknown as Record<string, unknown>)[field]);
      if (this.stopped) return;
      await this.folder.writeWorldMeta({ [field]: value }, { fromSync: true });
      baselineValue = value;
    }
    if (this.stopped) return;
    await this.folder.updateSyncState(current => ({
      meta_baseline: { ...(current.meta_baseline ?? {}), [field]: baselineValue },
      meta_conflicts: (current.meta_conflicts ?? []).filter(f => f !== field),
    }));
  }

  /** A contested x_ key: mine sends the folder's value (or its absence), theirs takes keel's. */
  private async resolveExtConflict(key: string, choice: 'mine' | 'theirs'): Promise<void> {
    let agreed: unknown;
    if (choice === 'mine') {
      if (this.readOnly) throw new PlainError('This world is view-only here, so its settings cannot be sent to OnlyWorlds.');
      const local = await this.folder.readWorldMeta({ strict: true }) as unknown as Record<string, unknown>;
      const resp = await this.client.patchWorldMeta(encodeMetaFieldsForPush({ [key]: local[key] ?? null }));
      agreed = (resp as unknown as Record<string, unknown>)[key];
    } else {
      const server = await this.client.getWorldMeta();
      agreed = (server as unknown as Record<string, unknown>)[key];
      if (this.stopped) return;
      await this.folder.writeWorldMeta({ [key]: agreed ?? undefined }, { fromSync: true });
    }
    if (this.stopped) return;
    await this.folder.updateSyncState(current => {
      const ext = { ...(current.meta_ext_baseline ?? {}) };
      setExtBaseline(ext, key, agreed);
      return {
        meta_ext_baseline: ext,
        meta_conflicts: (current.meta_conflicts ?? []).filter(f => f !== key),
      };
    });
  }

  /**
   * THE META STEP (world-meta sync). One per sync round, from
   * all three run paths. GET-first three-way diff per field against the
   * canonical baseline in sync-state:
   *   server-only change → apply to disk (pull), local-only change → PATCH
   *   (push, partial body), contested → policy (local-wins pushes; pause-and-
   *   review skips + persists meta_conflicts).
   * NEVER PATCHes on an absent baseline — that round SEEDS the baseline from
   * the server and fills locally-empty fields (the 3-lens convergent
   * blocker: push-before-pull would blank a link-existing world's real meta).
   * Baseline advances PER-FIELD (sent + applied only), so server changes to
   * fields we didn't touch still surface next round.
   */
  /**
   * The meta step, with the same idle-restore the push and pull phases carry.
   *
   * `executeMetaStep` does real disk I/O (readSyncState, readWorldMeta,
   * writeWorldMeta, updateSyncState), all of which throw when the directory
   * handle dies. It ran outside any try on all three round entry points, so a
   * throw left `activeSync` pinned at 'syncing' for the life of the session:
   * the pill reads "Saving…" forever, the manual pull button silently no-ops
   * on `cur?.kind === 'syncing'`, and the auto-pull scheduler skips every
   * tick as busy. The code named this hole itself and deferred it days before
   * release; this closes it.
   *
   * The throw still propagates — callers decide what to surface. Only the
   * stuck STATE is fixed.
   */
  private async executeMetaStepGuarded(opts?: { skipIfLocalClean?: boolean }): Promise<{
    meta_pushed: string[];
    meta_pulled: string[];
    failures: PerElementFailure[];
    auth_blocked: boolean;
  }> {
    try {
      return await this.executeMetaStep(opts);
    } catch (err) {
      // A held `.atlas/sync-state.json` (or `world.json`) past the writer's
      // retries is a failure of this step, not of the round: the element
      // push still runs and the busy retry still arms.
      if (isFileBusyError(err)) {
        return { meta_pushed: [], meta_pulled: [], failures: [failureOf('world', 'world', 'update', err)], auth_blocked: false };
      }
      this.settleThrownRound(err);
      throw err;
    }
  }

  private async executeMetaStep(opts?: { skipIfLocalClean?: boolean }): Promise<{
    meta_pushed: string[];
    meta_pulled: string[];
    failures: PerElementFailure[];
    auth_blocked: boolean;
  }> {
    const empty = { meta_pushed: [], meta_pulled: [], failures: [], auth_blocked: false };
    if (this.stopped || this.blocked) return empty;

    // PUSH-round precheck (2026-07-19): a push round's meta duty
    // is carrying LOCAL meta edits out — that dirtiness is decidable from
    // disk + baseline alone, no server read. When local meta is baseline-
    // clean, skip the GET /world entirely (it added a serial round-trip to
    // every debounced autosave). Pull/sync rounds never pass this flag: pull
    // freshness IS the meta GET (world-meta design). An absent
    // baseline never skips — the seed round must run.
    if (opts?.skipIfLocalClean) {
      try {
        const syncState = await this.folder.readSyncState();
        const baseline = syncState.meta_baseline ?? null;
        const extBaseline = syncState.meta_ext_baseline ?? null;
        if (baseline && extBaseline) {
          const local = await this.folder.readWorldMeta({ strict: true }) as unknown as Record<string, unknown>;
          const dirty = META_SYNC_FIELD_NAMES.some(
            f => !metaEquals(META_SYNC_FIELDS[f], local[f], baseline[f])
          ) || extDirty(local, extBaseline);
          if (!dirty) return empty;
        }
      } catch (err) {
        // Precheck failure falls through to the normal step — never let an
        // optimization turn into a skipped push.
        console.warn('[atlas:sync] meta precheck failed — running full meta step', err);
      }
    }

    const metaFailure = (operation: 'read' | 'update', err: unknown): PerElementFailure =>
      failureOf('world', 'world', operation, err);

    let server: WorldMetaWire;
    try {
      server = await this.client.getWorldMeta();
    } catch (err) {
      if (isAuthError(err)) {
        this.noteAuthBail(err);
        return { ...empty, auth_blocked: true };
      }
      console.warn('[atlas:sync] meta step: GET /world failed — skipping meta this round', err);
      return { ...empty, failures: [metaFailure('read', err)] };
    }
    if (this.stopped) return empty;

    const serverRec = server as unknown as Record<string, unknown>;
    // STRICT: a world.json that will not parse must stop the
    // meta step. The tolerant read returns an empty default, which the diff
    // below reads as "every field cleared locally" and PATCHes blank over the
    // server's world meta, then carries the blanks to every other device.
    let local: Record<string, unknown>;
    try {
      local = await this.folder.readWorldMeta({ strict: true }) as unknown as Record<string, unknown>;
    } catch (err) {
      console.warn('[atlas:sync] meta step: world.json unreadable — skipping meta this round', err);
      return { ...empty, failures: [metaFailure('read', err)] };
    }
    const syncState = await this.folder.readSyncState();
    const baseline = syncState.meta_baseline ?? null;
    // A profile's x_ keys: their own three-way, beside the fields.
    const ext = this.planExtStep(local, serverRec, syncState.meta_ext_baseline ?? null);
    // The world's first import, kept in the folder as keel serves it (folder
    // spec 0.3.16, §4.2): read-only on the server, so only ever pulled, and
    // written only when it differs, so a world's folder takes it once.
    const origin = server.origin && canonicalExtValue(server.origin) !== canonicalExtValue(local.origin)
      ? { origin: server.origin }
      : {};

    // SEED round: adopt server as baseline, fill locally-empty fields from
    // the server, PATCH nothing.
    if (!baseline) {
      const seeded = pickSyncedMeta(serverRec);
      const pulls: Record<string, unknown> = {};
      for (const field of META_SYNC_FIELD_NAMES) {
        if (isMetaEmpty(field, local[field]) && !isMetaEmpty(field, seeded[field])) {
          pulls[field] = seeded[field];
        }
      }
      Object.assign(pulls, ext.pullKeys);
      if (this.stopped) return empty;
      if (Object.keys(pulls).length > 0 || 'origin' in origin) {
        await this.folder.writeWorldMeta({ ...pulls, ...origin }, { fromSync: true });
      }
      if (this.stopped) return empty;
      await this.folder.updateSyncState(() => ({
        meta_baseline: seeded,
        meta_ext_baseline: ext.baselineNext,
        meta_server_updated_at: server.updated_at || null,
        ...(ext.contested.length > 0 ? { meta_conflicts: ext.contested } : {}),
      }));
      return { ...empty, meta_pulled: Object.keys(pulls) };
    }

    const diff = threeWayMetaDiff(local, serverRec, baseline);
    const pushFields: Record<string, unknown> = { ...diff.pushFields, ...ext.pushKeys };
    let contested = diff.contested;
    if (contested.length > 0 && this.policy === 'local-wins') {
      // Local wins the contested fields: push them, nothing persists.
      for (const f of contested) pushFields[f] = canonicalMetaValue(META_SYNC_FIELDS[f], local[f]);
      contested = [];
    }
    contested = [...contested, ...ext.contested];

    const baselineNext = { ...baseline };
    for (const f of diff.converged) {
      baselineNext[f] = canonicalMetaValue(META_SYNC_FIELDS[f], serverRec[f]);
    }
    const extBaselineNext = ext.baselineNext;

    // Pull-apply server-only changes, then advance those baselines.
    const pullWrites = { ...diff.pullFields, ...ext.pullKeys };
    const pulled = Object.keys(pullWrites);
    if (pulled.length > 0 || 'origin' in origin) {
      if (this.stopped) return empty;
      await this.folder.writeWorldMeta({ ...pullWrites, ...origin }, { fromSync: true });
      for (const f of Object.keys(diff.pullFields)) baselineNext[f] = diff.pullFields[f];
    }

    // The x_ keys travel in a PATCH of their own, after the settings:
    // keel refuses a body whole, so a key it will not take (over
    // 64 KB of keys in all) must never stop the now or a description.
    const extPush: Record<string, unknown> = {};
    for (const k of Object.keys(pushFields)) {
      if (isWorldExtensionKey(k)) { extPush[k] = pushFields[k]; delete pushFields[k]; }
    }

    // Length guard (keel never length-validates; overflow raw-500s).
    // Overlong fields become honest per-field failures and stay dirty.
    const failures: PerElementFailure[] = [];
    for (const [f, v] of Object.entries(pushFields)) {
      const lenErr = metaFieldLengthError(f, v);
      if (lenErr) {
        failures.push(metaFailure('update', new Error(lenErr)));
        delete pushFields[f];
      }
    }

    // Push local-only changes as ONE partial PATCH. Baseline advances only
    // for the fields actually sent — from the response echo
    // (adopting the full body would swallow concurrent server-side changes).
    // View-only: never PATCH — local meta can't legitimately diverge
    // (the store guard blocks UI writes), so anything here stays unpushed.
    let pushedNames = this.readOnly ? [] : Object.keys(pushFields);
    let serverUpdatedAt = server.updated_at || null;
    const persistOnBail = async (): Promise<void> => {
      if (this.stopped) return;
      await this.folder.updateSyncState(current => ({
        meta_baseline: baselineNext,
        meta_ext_baseline: extBaselineNext,
        meta_server_updated_at: serverUpdatedAt,
        meta_conflicts: this.policy === 'pause-and-review'
          ? contested
          : (current.meta_conflicts ?? []),
      }));
    };
    const pushSig = JSON.stringify(pushedNames.slice().sort().map(f => [f, pushFields[f]]));
    if (pushedNames.length > 0 && this.metaOwnerRefusal?.sig === pushSig) {
      failures.push(this.metaOwnerRefusal.failure);
      pushedNames = [];
    }
    if (pushedNames.length > 0) {
      try {
        const resp = await this.client.patchWorldMeta(encodeMetaFieldsForPush(pushFields));
        const respRec = resp as unknown as Record<string, unknown>;
        for (const f of pushedNames) {
          if (isWorldExtensionKey(f)) setExtBaseline(extBaselineNext, f, respRec[f]);
          else baselineNext[f] = canonicalMetaValue(META_SYNC_FIELDS[f], respRec[f]);
        }
        serverUpdatedAt = resp.updated_at || serverUpdatedAt;
      } catch (err) {
        if (isAuthError(err)) {
          this.noteAuthBail(err);
          // Persist what the round already learned (pull-applies + converged)
          // before bailing — the pushed fields stay dirty and retry.
          await persistOnBail();
          return { meta_pushed: [], meta_pulled: pulled, failures, auth_blocked: true };
        }
        console.warn('[atlas:sync] meta step: PATCH /world failed — fields stay dirty', err);
        const failure = metaFailure('update', err);
        failures.push(failure);
        let refusedSig = pushSig;
        pushedNames = []; // nothing landed; baselines for them unchanged
        // A co-builder may send the world's now alone, and keel
        // refuses a mixed body whole. So a refused body that held the now sends
        // the now by itself once; the rest stays refused (Kael 2026-10-19).
        if (memberRefusal(err) === 'owner_only' && 'time_current' in pushFields && Object.keys(pushFields).length > 1) {
          try {
            const resp = await this.client.patchWorldMeta(encodeMetaFieldsForPush({ time_current: pushFields.time_current }));
            baselineNext.time_current = canonicalMetaValue(META_SYNC_FIELDS.time_current, (resp as unknown as Record<string, unknown>).time_current);
            serverUpdatedAt = resp.updated_at || serverUpdatedAt;
            pushedNames = ['time_current'];
            const rest = Object.keys(pushFields).filter(f => f !== 'time_current').sort();
            refusedSig = JSON.stringify(rest.map(f => [f, pushFields[f]]));
          } catch (nowErr) {
            console.warn('[atlas:sync] meta step: the now alone was refused too', nowErr);
          }
        }
        if (memberRefusal(err) === 'owner_only') this.metaOwnerRefusal = { sig: refusedSig, failure };
      }
    }

    // The x_ keys' own PATCH. A body keel refused (a 4xx: too big, not this
    // seat's to write) is remembered by its content and not sent again until
    // the folder's keys change, as the owner-only refusal is; a body over
    // keel's 64 KB is refused here without a round trip.
    const extNames = this.readOnly ? [] : Object.keys(extPush).sort();
    if (extNames.length > 0) {
      const extSig = JSON.stringify(extNames.map(k => [k, canonicalExtValue(extPush[k])]));
      if (this.extRefusal?.sig === extSig) {
        failures.push(this.extRefusal.failure);
      } else if (extBytesAfter(serverRec, extPush) > EXT_MAX_BYTES) {
        const failure = metaFailure('update', new Error(`The world's x_ keys would pass OnlyWorlds' ${EXT_MAX_BYTES}-byte limit`));
        failures.push(failure);
        this.extRefusal = { sig: extSig, failure };
      } else {
        try {
          const resp = await this.client.patchWorldMeta(encodeMetaFieldsForPush(extPush));
          const respRec = resp as unknown as Record<string, unknown>;
          for (const k of extNames) setExtBaseline(extBaselineNext, k, respRec[k]);
          serverUpdatedAt = resp.updated_at || serverUpdatedAt;
          pushedNames = [...pushedNames, ...extNames];
        } catch (err) {
          if (isAuthError(err)) {
            this.noteAuthBail(err);
            await persistOnBail();
            return { meta_pushed: [...pushedNames], meta_pulled: pulled, failures, auth_blocked: true };
          }
          console.warn('[atlas:sync] meta step: PATCH /world of x_ keys failed — they stay dirty', err);
          const failure = metaFailure('update', err);
          failures.push(failure);
          const status = (err as { status?: unknown } | null)?.status;
          if (typeof status === 'number' && status >= 400 && status < 500) this.extRefusal = { sig: extSig, failure };
        }
      }
    }

    if (this.stopped) return empty; // unlink raced us — never resurrect cleared state
    await this.folder.updateSyncState(() => ({
      meta_baseline: baselineNext,
      meta_ext_baseline: extBaselineNext,
      meta_server_updated_at: serverUpdatedAt,
      meta_conflicts: this.policy === 'pause-and-review' ? contested : [],
    }));
    return { meta_pushed: [...pushedNames], meta_pulled: pulled, failures, auth_blocked: false };
  }

  /**
   * The x_ keys' share of a meta round: what to send, what to
   * write locally, what is contested, and the baseline after the pulls and
   * the converged keys (sent keys advance from the PATCH echo). An absent
   * baseline seeds, as the fields do: the server's keys become the baseline,
   * a key the folder lacks comes down, nothing goes up this round.
   */
  private planExtStep(
    local: Record<string, unknown>,
    server: Record<string, unknown>,
    baseline: Record<string, string> | null,
  ): { pushKeys: Record<string, unknown>; pullKeys: Record<string, unknown>; contested: string[]; baselineNext: Record<string, string> } {
    if (!baseline) {
      const pullKeys: Record<string, unknown> = {};
      const baselineNext = pickExtensionBaseline(server);
      const contested: string[] = [];
      for (const [k, v] of Object.entries(server)) {
        if (!isWorldExtensionKey(k)) continue;
        const s = canonicalExtValue(v);
        const l = canonicalExtValue(local[k]);
        if (s !== null && l === null) pullKeys[k] = v;
        // Both sides hold the key and differ: no side is the change, so no
        // baseline is taken for it (a seed to the server's
        // value made the folder's read as an edit, pushed unasked). The next
        // three-way sees both changed; under pause-and-review it is held now.
        if (s !== null && l !== null && s !== l) {
          delete baselineNext[k];
          if (this.policy === 'pause-and-review') contested.push(k);
        }
      }
      return { pushKeys: {}, pullKeys, contested, baselineNext };
    }
    const d = threeWayExtDiff(local, server, baseline);
    const pushKeys = { ...d.pushKeys };
    let contested = d.contested;
    if (contested.length > 0 && this.policy === 'local-wins') {
      for (const k of contested) pushKeys[k] = canonicalExtValue(local[k]) === null ? null : local[k];
      contested = [];
    }
    const baselineNext = { ...baseline };
    for (const k of [...d.converged, ...Object.keys(d.pullKeys)]) setExtBaseline(baselineNext, k, server[k]);
    return { pushKeys, pullKeys: d.pullKeys, contested, baselineNext };
  }

  /**
   * Resolve a server-deleted entry (3.5+). Two actions:
   *   - `delete-locally`: remove the local file silently (no tombstone — the
   *                       server already deleted it).
   *   - `keep`: clear `server_updated_at` on local. Next push will re-CREATE
   *             the element on the server.
   *
   * Clears the entry from sync-state regardless of which action was chosen.
   */
  async resolveServerDelete(
    id: string,
    action: 'delete-locally' | 'keep'
  ): Promise<void> {
    await this.assertNotHeld();
    const syncState = await this.folder.readSyncState();
    const list = syncState.server_deletes ?? [];
    const target = list.find(d => d.id === id);
    if (!target) return; // already cleared

    if (action === 'delete-locally') {
      await this.folder.deleteElement(id, { silent: true });
    } else {
      // `keep` — clear server baseline. Next push treats this as never-synced
      // and CREATEs it on the server again.
      await this.folder.clearServerBaseline(id);
    }

    await this.folder.updateSyncState(s => ({
      server_deletes: (s.server_deletes ?? []).filter(d => d.id !== id),
    }));
  }

  /**
   * The review's rows with what the bulk step needs (#122): each record's
   * local stamp as read now, and whether the copy holds edits never synced
   * (the push's own test: never synced, or `local_updated_at` past
   * `server_updated_at`). A copy already gone reads as clean.
   */
  async reviewServerDeletes(): Promise<import('../core/types').ServerDeleteReviewRow[]> {
    const records = await this.listServerDeletes();
    const unsynced = new Set((await this.folder.listLocallyChangedSince(null)).map(e => e.id));
    const rows: import('../core/types').ServerDeleteReviewRow[] = [];
    for (const r of records) {
      const local = await this.folder.getElement(r.id);
      rows.push({
        ...r,
        local_updated_at: local?.local_updated_at ?? null,
        server_updated_at: local?.server_updated_at ?? null,
        unsynced: unsynced.has(r.id),
      });
    }
    return rows;
  }

  /**
   * "Delete all locally" (#122): the silent delete of `resolveServerDelete`
   * for many rows, each guarded by both stamps the user saw (conv. 140). A
   * row whose copy changed since (an edit, an outside write, a Keep, a push)
   * is kept, entry and all, and comes back in `kept`; a row whose delete
   * throws comes back in `failed` and the rest still run. Each entry is
   * cleared right after its file goes, so a stop part way leaves only rows
   * still to review. A hold or an unlink stops the loop where it is.
   */
  async deleteServerDeletesLocally(
    rows: Array<{ id: string; local_updated_at: string | null; server_updated_at: string | null }>,
  ): Promise<{ deleted: string[]; kept: string[]; failed: string[] }> {
    await this.assertNotHeld();
    const deleted: string[] = [];
    const kept: string[] = [];
    const failed: string[] = [];
    for (const row of rows) {
      // A world switch, an unlink, or a move or re-key begun meanwhile: the rest stay to review.
      if (this.stopped || this.holds > 0) break;
      // Read per row: a Keep or a per-row delete may have resolved it since.
      const pending = ((await this.folder.readSyncState()).server_deletes ?? []).some(d => d.id === row.id);
      if (!pending) continue;
      try {
        if (!(await this.folder.deleteSilentlyIfUnchanged(row.id, row))) {
          kept.push(row.id);
          continue;
        }
      } catch (err) {
        console.warn(`[atlas:sync] delete all locally: ${row.id} failed`, err);
        failed.push(row.id);
        continue;
      }
      await this.folder.updateSyncState(s => ({
        server_deletes: (s.server_deletes ?? []).filter(d => d.id !== row.id),
      }));
      deleted.push(row.id);
    }
    return { deleted, kept, failed };
  }

  /**
   * Push local changes to server, then pull remote changes to folder.
   * Pull skips elements push already conflicted on (dedup by id).
   *
   * Concurrent calls share the in-flight promise rather than racing.
   */
  syncNow(): Promise<SyncResult> {
    if (this.readOnly) return this.pullNow(); // view-only: sync means refresh
    if (this.inFlight) return this.inFlight;
    this.inFlightKind = 'sync';
    this.inFlight = this.runSync().finally(() => {
      this.inFlight = null;
      this.inFlightKind = null;
    });
    return this.inFlight;
  }

  /**
   * Push-only path with progress reporting. Used by Make-Online flows that
   * want to upload everything in one go without running a pull. Best-effort:
   * per-element failures accumulate in result.failures but do NOT abort the
   * iteration. Caller decides what to surface (toast count, retry UX).
   */
  pushOnce(): Promise<SyncResult> {
    // View-only: the push boundary. Every trigger funnels here (the
    // debounce, flushPendingPush, resume, the local-wins convergence push) —
    // one guard closes them all.
    if (this.readOnly) return Promise.resolve(emptyResult());
    if (this.inFlight) return this.inFlight;
    this.inFlightKind = 'push';
    this.inFlight = this.runPushOnly().finally(() => {
      this.inFlight = null;
      this.inFlightKind = null;
    });
    return this.inFlight;
  }

  /**
   * Pull-only path. Used by "Refresh from API" button and periodic auto-pull.
   * Pulls server changes to local without pushing local edits up. No-op while
   * paused. Concurrent calls share the in-flight promise.
   *
   * Push-then-pull (`syncNow`) is what runs after a debounced edit because the
   * user's intent is to sync everything. `pullNow` is the one-direction read
   * for "show me what others did."
   */
  pullNow(): Promise<SyncResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlightKind = 'pull';
    this.inFlight = this.runPullOnly().finally(() => {
      this.inFlight = null;
      this.inFlightKind = null;
    });
    return this.inFlight;
  }

  private async runPushOnly(): Promise<SyncResult> {
    if (this.blocked) return emptyResult();
    this.setState({ kind: 'syncing', phase: 'push' });
    if (await this.rekeyPendingGuarded()) return emptyResult();
    // The meta step rides EVERY round (world-meta sync R2) — a setNow-triggered
    // debounce push is exactly the round that must carry the now to the server.
    // skipIfLocalClean: when local meta matches the baseline there is nothing
    // to carry, and the server GET is skipped (element-edit autosaves are the
    // overwhelmingly common push round).
    const meta = await this.executeMetaStepGuarded({ skipIfLocalClean: true });
    if (meta.auth_blocked) {
      this.setAuthError();
      const result: SyncResult = {
        pushed: zero(), pulled: zero(), conflicts: [], failures: meta.failures,
        auth_blocked: true, auth_reason: this.lastAuthReason ?? undefined,
      };
      this.onSyncResult('push', result);
      return result;
    }
    let pushResult: Awaited<ReturnType<SyncEngine['pushPhase']>>;
    try {
      pushResult = await this.pushPhase();
    } catch (err) {
      // Mirrors runPullOnly. The pull path has carried this guard, with
      // a comment saying why, since it was written; the push path never got it,
      // so ANY throw here left the pill reading 'Saving…' forever — on the path
      // every single user edit takes (element save -> requestPushIfLinked).
      // Hardening applied to one side of a symmetric surface is a defect class,
      // not a fix.
      this.settleThrownRound(err);
      throw err;
    }
    // Only persist under pause-and-review. Under local-wins, conflicts are
    // informational (server already overwritten) — persisting would falsely
    // fire the badge for resolved divergence.
    if (this.policy === 'pause-and-review') {
      await this.persistConflictsGuarded(pushResult.conflicts, pushResult.failures);
    }
    if (pushResult.auth_blocked) {
      this.setAuthError();
    } else {
      this.settleIdle(nowIso());
    }
    if (pushResult.transient_blocked) this.scheduleTransientRetry(pushResult.retry_after_ms);
    const result: SyncResult = {
      pushed: pushResult.pushed,
      pulled: zero(),
      conflicts: pushResult.conflicts,
      failures: [...meta.failures, ...pushResult.failures],
      auth_blocked: pushResult.auth_blocked,
      auth_reason: pushResult.auth_blocked ? this.lastAuthReason ?? undefined : undefined,
      transient_blocked: pushResult.transient_blocked,
      transient_reason: pushResult.transient_reason,
      retry_after_ms: pushResult.retry_after_ms,
      meta_pushed: meta.meta_pushed.length ? meta.meta_pushed : undefined,
      meta_pulled: meta.meta_pulled.length ? meta.meta_pulled : undefined,
      ...keptFields(pushResult),
    };
    this.onSyncResult('push', result);
    return result;
  }

  private async runPullOnly(): Promise<SyncResult> {
    if (this.blocked) return emptyResult();
    this.setState({ kind: 'syncing', phase: 'pull' });
    if (await this.rekeyPendingGuarded()) return emptyResult();
    const meta = await this.executeMetaStepGuarded();
    if (meta.auth_blocked) {
      this.setAuthError();
      const result: SyncResult = {
        pushed: zero(), pulled: zero(), conflicts: [], failures: meta.failures,
        auth_blocked: true, auth_reason: this.lastAuthReason ?? undefined,
      };
      this.onSyncResult('pull', result);
      return result;
    }
    let pullResult: SyncResult;
    try {
      pullResult = await this.pullPhase();
    } catch (err) {
      // Non-auth pull failures (network, 5xx) propagate to caller for toast
      // surfacing — but we MUST restore idle state first or the pill stays
      // stuck at 'fetching...' forever.
      this.settleThrownRound(err);
      throw err;
    }
    // A refresh settles what keel decided too (conv. 163, P5): a pull-only
    // round is how a person asks "what happened online?".
    const settled = !pullResult.auth_blocked && !this.stopped
      ? await this.settleProposals(pullResult.failures) : { accepted: [] as string[], refused: [] as Conflict[] };
    if (pullResult.auth_blocked) {
      this.setAuthError();
    } else {
      this.settleIdle(nowIso());
    }
    const result: SyncResult = {
      pushed: zero(),
      pulled: pullResult.pulled,
      conflicts: [...pullResult.conflicts, ...settled.refused],
      ...(settled.accepted.length > 0 ? { proposals_accepted: settled.accepted } : {}),
      failures: [...meta.failures, ...pullResult.failures],
      pulled_ids: pullResult.pulled_ids,
      auth_blocked: pullResult.auth_blocked,
      auth_reason: pullResult.auth_blocked ? this.lastAuthReason ?? undefined : undefined,
      meta_pushed: meta.meta_pushed.length ? meta.meta_pushed : undefined,
      meta_pulled: meta.meta_pulled.length ? meta.meta_pulled : undefined,
      ...keptFields(pullResult),
    };
    this.onSyncResult('pull', result);
    return result;
  }

  private async runSync(): Promise<SyncResult> {
    if (this.blocked) {
      return emptyResult();
    }
    this.setState({ kind: 'syncing', phase: 'push' });
    if (await this.rekeyPendingGuarded()) return emptyResult();
    const meta = await this.executeMetaStepGuarded();
    if (meta.auth_blocked) {
      this.setAuthError();
      const result: SyncResult = {
        pushed: zero(), pulled: zero(), conflicts: [], failures: meta.failures,
        auth_blocked: true, auth_reason: this.lastAuthReason ?? undefined,
      };
      this.onSyncResult('sync', result);
      return result;
    }
    // Settled like runPushOnly's: a throw here left the
    // pill on 'Saving' forever on the full-sync path.
    let pushResult: Awaited<ReturnType<SyncEngine['pushPhase']>>;
    try {
      pushResult = await this.pushPhase();
    } catch (err) {
      this.settleThrownRound(err);
      throw err;
    }
    // Persist push conflicts BEFORE pull phase (so pull's currentState read
    // sees them when computing the union). Under local-wins, skip — server
    // is already in our state, the entries would be misleading.
    if (this.policy === 'pause-and-review') {
      await this.persistConflictsGuarded(pushResult.conflicts, pushResult.failures);
    }
    // If push bailed for auth, skip pulling — same dead key would 401 there
    // too. Surface via error state + result.auth_blocked.
    if (pushResult.auth_blocked) {
      this.setAuthError();
      const result: SyncResult = {
        pushed: pushResult.pushed,
        pulled: zero(),
        conflicts: pushResult.conflicts,
        failures: pushResult.failures,
        auth_blocked: true,
        auth_reason: this.lastAuthReason ?? undefined,
      };
      this.onSyncResult('sync', result);
      return result;
    }
    // A busy or unreachable server ends the round here too: the pull would
    // meet the same wait. Retry once later.
    if (pushResult.transient_blocked) {
      this.settleIdle(null);
      this.scheduleTransientRetry(pushResult.retry_after_ms);
      const result: SyncResult = {
        pushed: pushResult.pushed,
        pulled: zero(),
        conflicts: pushResult.conflicts,
        failures: [...meta.failures, ...pushResult.failures],
        transient_blocked: true,
        transient_reason: pushResult.transient_reason,
        retry_after_ms: pushResult.retry_after_ms,
        ...keptFields(pushResult),
      };
      this.onSyncResult('sync', result);
      return result;
    }
    this.setState({ kind: 'syncing', phase: 'pull' });
    const handledIds = new Set(pushResult.conflicts.map(c => c.element_id));
    let pullResult: SyncResult;
    try {
      pullResult = await this.pullPhase(handledIds);
    } catch (err) {
      this.settleThrownRound(err);
      throw err;
    }
    const result: SyncResult = {
      pushed: pushResult.pushed,
      pulled: pullResult.pulled,
      conflicts: [...pushResult.conflicts, ...pullResult.conflicts],
      failures: [...meta.failures, ...pushResult.failures, ...pullResult.failures],
      pulled_ids: pullResult.pulled_ids,
      auth_blocked: pushResult.auth_blocked || pullResult.auth_blocked,
      auth_reason: (pushResult.auth_blocked || pullResult.auth_blocked) ? this.lastAuthReason ?? undefined : undefined,
      meta_pushed: meta.meta_pushed.length ? meta.meta_pushed : undefined,
      meta_pulled: meta.meta_pulled.length ? meta.meta_pulled : undefined,
      ...keptFields(pushResult, pullResult),
    };
    // A raise in this round's pull gave back what its push had kept: those
    // edits no longer stay here.
    if (result.kept_edit_ids && pullResult.own_role !== undefined) {
      const keptAfter = new Set((await this.folder.readSyncState().catch(() => null))?.kept_outside_view ?? result.kept_edit_ids);
      const still = result.kept_edit_ids.filter(id => keptAfter.has(id));
      if (still.length > 0) result.kept_edit_ids = still;
      else delete result.kept_edit_ids;
    }
    if (pullResult.auth_blocked) {
      this.setAuthError();
    } else {
      this.settleIdle(nowIso());
    }
    this.onSyncResult('sync', result);
    return result;
  }

  /**
   * FALLBACK-PATH ONLY since the v2 port: CREATE batches of ≥2 go through
   * `/bulk` (server-side fixpoint ordering, cycles included) when the client
   * supports it. This topo-sort orders the per-element loop used when
   * bulkCreate is unavailable (legacy fakes, degraded clients).
   *
   * Order CREATE candidates so each element's FK dependencies are pushed
   * BEFORE the element itself. Without this ordering, the server returns a
   * dangling-link 400 for elements pushed before their references — which
   * then get retried on the next round. Topo-sort eliminates that ping-pong:
   * dependencies go first, references resolve within the same round.
   *
   * Builds the graph by scanning every string + string-array field on each
   * candidate; any value matching another candidate's id becomes a dep edge.
   * Schema-agnostic — doesn't need FIELD_SCHEMA.
   *
   * Cycles fall back to input order (rare in OW data; the user can clean up
   * by removing one side of the cycle). The first push round in a cycle
   * still produces an FK error, then self-heals as before.
   */
  private sortCreatesByDependencies(creates: Element[]): Element[] {
    if (creates.length < 2) return creates;
    const SKIP = new Set(['id', 'type', 'name', 'local_updated_at', 'server_updated_at']);
    const candidateIds = new Set(creates.map(e => e.id));

    // For each element: which other candidates does it reference?
    const dependsOn = new Map<string, Set<string>>();
    for (const el of creates) {
      const refs = new Set<string>();
      for (const [key, value] of Object.entries(el)) {
        if (SKIP.has(key)) continue;
        if (typeof value === 'string' && candidateIds.has(value) && value !== el.id) {
          refs.add(value);
        } else if (Array.isArray(value)) {
          for (const v of value) {
            if (typeof v === 'string' && candidateIds.has(v) && v !== el.id) refs.add(v);
          }
        }
      }
      dependsOn.set(el.id, refs);
    }

    // Reverse adjacency: who depends on me?
    const dependents = new Map<string, Set<string>>();
    for (const el of creates) dependents.set(el.id, new Set());
    for (const [id, refs] of dependsOn) {
      for (const r of refs) dependents.get(r)?.add(id);
    }

    // Kahn's algorithm: start with elements that depend on nothing.
    const inDegree = new Map<string, number>();
    for (const [id, refs] of dependsOn) inDegree.set(id, refs.size);
    const idToCreate = new Map<string, Element>();
    for (const el of creates) idToCreate.set(el.id, el);

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }
    const sorted: Element[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const el = idToCreate.get(id);
      if (el) sorted.push(el);
      for (const dep of dependents.get(id) ?? []) {
        const next = (inDegree.get(dep) ?? 0) - 1;
        inDegree.set(dep, next);
        if (next === 0) queue.push(dep);
      }
    }
    // Cycle in the FK graph — emit any leftovers in original order. They'll
    // still produce a 400 on first push and self-heal via the next round.
    if (sorted.length < creates.length) {
      const seen = new Set(sorted.map(e => e.id));
      for (const el of creates) {
        if (!seen.has(el.id)) sorted.push(el);
      }
      console.info('[atlas:sync] FK cycle detected in CREATE batch — falling back to input order', {
        unsortedCount: creates.length - seen.size,
      });
    }
    return sorted;
  }

  /** Append new conflicts to sync-state.json (dedupe by element_id). */
  private async persistConflicts(conflicts: import('../core/types').Conflict[]): Promise<void> {
    if (conflicts.length === 0) return;
    await this.folder.updateSyncState(curr => {
      const existingIds = new Set(curr.conflicts.map(c => c.element_id));
      const fresh = conflicts.filter(c => !existingIds.has(c.element_id));
      if (fresh.length === 0) return {};
      return { conflicts: [...curr.conflicts, ...fresh] };
    });
  }

  // ---- Phases ----

  /**
   * Route a dangling-link error's missing PEER to the server-delete review
   * modal — but only when the peer exists locally with a server baseline
   * (it was synced once; the server lost it out-of-band). Returns true when
   * routed. Shared by the per-element catch and the /bulk item-error path.
   */
  private async routeDanglingPeer(
    parsed: { field: string; refType: string; refId: string },
    child: { id: string; type: ElementType },
    serverDeletesDetected: import('../core/types').ServerDeleteRecord[]
  ): Promise<boolean> {
    // A kept peer is out of this key's view, not deleted (conv. 151): never a
    // review row. For a guest, keel's "does not exist" says the same of a peer
    // it once gave (a stamp) and not kept yet (probed): it joins the kept
    // set, and the next round sends the child without the link, which keel
    // keeps. A peer never sent is a local create, not out of view;
    // the role is this round's.
    if (this.roundLinkHeld.has(parsed.refId)) return false;
    const peer = await this.folder.getElement(parsed.refId);
    if (peer?.server_updated_at && await this.roundRoleNow() === 'guest') {
      this.roundKeptAdd.push(parsed.refId);
      return false;
    }
    if (peer && peer.server_updated_at) {
      if (!serverDeletesDetected.some(d => d.id === peer.id)) {
        serverDeletesDetected.push({
          id: peer.id,
          type: peer.type,
          detected_at: nowIso(),
          name: peer.name,
        });
      }
      console.warn('[atlas:sync] dangling link — peer was deleted server-side; routing peer to server-delete review', {
        child_id: child.id, child_type: child.type,
        peer_id: peer.id, peer_type: peer.type,
        fk_field: parsed.field,
      });
      return true;
    }
    console.warn('[atlas:sync] dangling link but could not resolve missing peer locally', {
      id: child.id, type: child.type, fk_field: parsed.field, ref_id: parsed.refId,
    });
    return false;
  }

  /**
   * Push all never-synced elements through `/bulk` in ONE atomic request.
   * The server resolves in-batch FK order — cycles included — so no client
   * ordering is needed and the cyclic-Make-Online class is closed for good.
   *
   * Failure protocol (verified live: atomic rollback is real):
   *   - `errors: true` under atomic → NOTHING persisted server-side, even for
   *     items reporting 201 ("would have succeeded"). Stamp NOTHING.
   *   - Failed items → per-element failures (+ dangling-peer routing for
   *     invalid_link items); surviving items retried ONCE atomically.
   *   - A thrown auth error bails the round like everywhere else.
   *
   * Timestamp backfill: /bulk items return `{status, id}` with no
   * `updated_at` (Skeld ships the echo next keel session — delete this then).
   * NEVER stamp client now(): clock skew yields mass spurious pulls or
   * silently-never-pulled elements. Small batches → per-element GET; large
   * batches (Make-Online scale) → one cursor list-walk per pushed type.
   */
  private async bulkCreatePhase(
    candidates: Element[],
    failures: PerElementFailure[],
    serverDeletesDetected: import('../core/types').ServerDeleteRecord[],
    onItemDone: () => void,
    isRetry = false,
    foreign: Array<{ id: string; type: ElementType }> = [],
    attempted: Set<string> = new Set(),
  ): Promise<{ created: number; authBlocked: boolean; transient?: unknown }> {
    // Re-fetch each candidate from disk (freshness) + pin element_type
    // self-heal, mirroring the per-element loop's pre-send discipline.
    const items: BulkItem[] = [];
    /** The `local_updated_at` each sent body carried (an edit during the request stays dirty). */
    const sentStamps = new Map<string, string>();
    for (const elem of candidates) {
      let current = await this.folder.getElement(elem.id);
      if (!current) { onItemDone(); continue; }
      if (
        current.type === 'pin' &&
        typeof current.element_id === 'string' &&
        !current.element_type
      ) {
        const pinned = await this.folder.getElement(current.element_id);
        if (pinned) {
          current = await this.folder.updateElement(current.id, { element_type: pinned.type });
          console.info('[atlas:sync] self-healed pin missing element_type', {
            pinId: current.id, elementType: pinned.type,
          });
        }
      }
      items.push({ type: current.type, element: this.outgoing(current) });
      sentStamps.set(current.id, current.local_updated_at);
    }
    if (items.length === 0 || this.stopped) return { created: 0, authBlocked: false };

    console.info(`[atlas:sync] bulk CREATE ${items.length} element(s)${isRetry ? ' (retry)' : ''}`);
    for (const it of items) attempted.add(it.element.id as string);
    let result: BulkResult;
    try {
      result = await this.client.bulkCreate!(items, {
        atomic: true,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (err) {
      const auth = isAuthError(err);
      const message = err instanceof Error ? err.message : String(err); // raw-error-ok: internal, classified below; never shown
      for (const it of items) {
        // failureOf carries keel's status and code, so a whole-request member
        // refusal reads as not_yours like a per-item one.
        failures.push(failureOf(it.element.id as string, it.type, 'create', err));
        onItemDone();
      }
      if (auth) {
        this.noteAuthBail(err);
        console.warn('[atlas:sync] bulk CREATE hit auth error — bailing round', { message });
      } else {
        console.warn('[atlas:sync] bulk CREATE request failed', { message });
      }
      return { created: 0, authBlocked: auth, transient: !auth && isTransientError(err) ? err : null };
    }

    if (!result.errors) {
      // Everything landed. Stamp baselines from the per-item timestamp echo
      // (keel D46) where present; anything lacking it (pre-D46 server, fake
      // without the seam) falls back to the read-back backfill.
      let stamped = 0;
      const needBackfill: BulkItem[] = [];
      // keel's /bulk slot echoes the time but not the review mark it may have written (conv. 168):
      // a key that is not a keeper reads its new elements back, so the mark lands.
      const readBack = await this.marksPossible();
      // Three held files in a row means the folder is held, not one file:
      // the rest are recorded at once rather than each waiting out its own
      // retries (500 creates once cost ~15 minutes). They
      // stay dirty; the next round's re-POST answers 409 and adopts.
      let heldInARow = 0;
      for (let i = 0; i < items.length; i++) {
        if (this.stopped) break;
        const echo = result.items[i]?.updatedAt;
        if (typeof echo === 'string' && echo && !readBack) {
          const sentId = items[i].element.id as string;
          if (heldInARow >= 3) {
            const last = failures[failures.length - 1];
            failures.push({ ...last, element_id: sentId, type: items[i].type, operation: 'create' });
            continue;
          }
          if (await this.localStep(failures, sentId, items[i].type, 'create',
            () => this.folder.stampServerUpdatedAt(sentId, items[i].type, echo, sentStamps.get(sentId)))) {
            stamped++;
            heldInARow = 0;
          } else if (isFileBusyError({ name: failures[failures.length - 1]?.error_name })) {
            heldInARow++;
          }
        } else {
          needBackfill.push(items[i]);
        }
      }
      if (needBackfill.length > 0 && !this.stopped) {
        stamped += await this.backfillBulkTimestamps(needBackfill, failures, sentStamps);
      }
      for (const _ of items) onItemDone();
      return { created: stamped, authBlocked: false };
    }

    // errors: true under atomic → server rolled EVERYTHING back. Split by
    // per-item status (positional with input), fail the bad ones, retry the
    // survivors once.
    const failedIdx = new Set<number>();
    result.items.forEach((it, i) => { if (it.status >= 400) failedIdx.add(i); });
    const survivors: Element[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const res = result.items[i];
      if (!failedIdx.has(i)) {
        const local = candidates.find(c => c.id === item.element.id);
        if (local) survivors.push(local);
        continue;
      }
      const errObj = res?.error ?? { code: 'unknown', message: 'bulk item failed', param: null };
      // id_conflict item: already on the server (prior backfill miss). Adopt
      // the baseline instead of failing — same self-heal as the POST path;
      // without it the bulk batch re-fails this item every round forever.
      if (errObj.code === 'id_conflict') {
        const id = item.element.id as string;
        const remote = await this.client.getElement(item.type, id).catch(() => null);
        const local = candidates.find(c => c.id === id);
        if (remote && local) {
          if (await this.localStep(failures, id, item.type, 'create', () => this.adoptServerCopy(local, remote))) {
            console.info('[atlas:sync] bulk item id_conflict — element already on server; baseline adopted', {
              id, type: item.type,
            });
          }
          onItemDone();
          continue;
        }
        // /bulk upserts ids of THIS world, so an id_conflict nothing here
        // could adopt belongs to another world.
        foreign.push({ id, type: item.type });
      }
      // keel would not make it hidden for this key (conv. 170): held, never a failure.
      if (errObj.code === 'hidden_not_allowed') {
        this.roundHiddenRefused.push(item.element.id as string);
        console.info('[atlas:sync] bulk item hidden_not_allowed — held here', { id: item.element.id });
        onItemDone();
        continue;
      }
      // A 404 item names an id hidden from this key (keel's /bulk, Skeld,
      // 2026-10-20): kept, never sent again.
      if ((res?.status === 404 || errObj.code === 'not_found') && hiddenCanBeDenied(await this.roundRoleNow())) {
        this.roundKeptAdd.push(item.element.id as string);
        console.info('[atlas:sync] bulk item 404 — an id hidden from this key, kept here', { id: item.element.id });
        onItemDone();
        continue;
      }
      const parsed = parseInvalidLinkItem(errObj);
      let routed = false;
      if (parsed) {
        routed = await this.routeDanglingPeer(
          parsed,
          { id: item.element.id as string, type: item.type },
          serverDeletesDetected
        );
      }
      failures.push({
        element_id: item.element.id as string,
        type: item.type,
        operation: 'create',
        message: parsed
          ? (routed
              ? `referenced ${parsed.refType} was deleted on the server; review in sync panel`
              : `referenced ${parsed.refType} not found on the server`)
          : errObj.message || 'bulk item failed',
        ...(typeof res?.status === 'number' ? { status: res.status } : {}),
        ...(errObj.code ? { code: errObj.code } : {}),
        ...(errObj.param ? { param: errObj.param } : {}),
        source: 'server',
      });
      onItemDone();
    }

    if (isRetry || survivors.length === 0) {
      // Retry exhausted (or nothing survived): the survivors of THIS attempt
      // were rolled back and get surfaced as failures rather than retried
      // again — one retry is the protocol, not a loop.
      for (const s of survivors) {
        failures.push({
          element_id: s.id,
          type: s.type,
          operation: 'create',
          message: 'rolled back by failing peers in the atomic batch; retry exhausted',
        });
        onItemDone();
      }
      return { created: 0, authBlocked: false };
    }

    // A survivor that links to a refused element (directly or through another
    // survivor that does) fails the atomic retry too, and used to take every
    // independent survivor down with it, every round.
    // Hold those back as failures; the rest go through.
    const refused = new Set<string>();
    result.items.forEach((it, i) => { if (it.status >= 400) refused.add(items[i].element.id as string); });
    const { ready, blocked } = splitByRefusedLinks(survivors, refused);
    for (const s of blocked) {
      failures.push({
        element_id: s.id,
        type: s.type,
        operation: 'create',
        message: 'waits for an element OnlyWorlds refused in the same upload',
      });
      onItemDone();
    }
    if (ready.length === 0) return { created: 0, authBlocked: false };
    console.info(`[atlas:sync] bulk CREATE retrying ${ready.length} survivor(s) after atomic rollback (${blocked.length} held back)`);
    return this.bulkCreatePhase(ready, failures, serverDeletesDetected, onItemDone, /* isRetry */ true, foreign, attempted);
  }

  /**
   * Post-bulk timestamp backfill: fetch the server's authoritative
   * `updated_at` for every created element and stamp the local baseline.
   * ≤20 elements → per-element GET; larger → one list walk per pushed type.
   * Returns the count successfully stamped; misses become failures (they'll
   * re-push next round — CREATE turns into 409/id_conflict territory, which
   * surfaces loudly rather than silently corrupting baselines).
   */
  /**
   * A local write after the server already answered (a baseline stamp, an
   * adopt, a tombstone clear), run so a refusal stays with its element.
   * Before, a file another program held made the stamp throw out of
   * the round: the rest of the elements, the tombstones and the sync state
   * were skipped. The element stays dirty, so the next round redoes it (a
   * CREATE re-POST answers 409 and adopts). A damaged file still ends the
   * round, which pauses the engine with the file named (conv. 99).
   */
  private async localStep(
    failures: PerElementFailure[],
    id: string,
    type: ElementType,
    operation: PerElementFailure['operation'],
    step: () => Promise<unknown>,
  ): Promise<boolean> {
    try {
      await step();
      return true;
    } catch (err) {
      if (err instanceof CorruptFileError) throw err;
      failures.push({ ...failureOf(id, type, operation, err), source: 'disk' });
      return false;
    }
  }

  private async backfillBulkTimestamps(
    items: BulkItem[],
    failures: PerElementFailure[],
    sentStamps: ReadonlyMap<string, string> = new Map(),
  ): Promise<number> {
    let stamped = 0;
    if (items.length <= 20) {
      for (const it of items) {
        if (this.stopped) break; // detach/unlink — never stamp past a reset
        const id = it.element.id as string;
        try {
          const remote = await this.client.getElement(it.type, id);
          if (!remote) throw new Error('created element missing on read-back');
          await this.folder.stampServerUpdatedAt(id, it.type, remote.updated_at, sentStamps.get(id), keptFrom(remote, true));
          stamped++;
        } catch (err) {
          if (err instanceof CorruptFileError) throw err;
          failures.push(failureOf(id, it.type, 'create', err, 'created but baseline backfill failed: '));
        }
      }
      return stamped;
    }
    const byType = new Map<ElementType, BulkItem[]>();
    for (const it of items) {
      if (!byType.has(it.type)) byType.set(it.type, []);
      byType.get(it.type)!.push(it);
    }
    for (const [type, group] of byType) {
      let remoteById = new Map<string, { id: string; updated_at: string } & Record<string, unknown>>();
      try {
        const listed = await this.client.listElements(type);
        remoteById = new Map(listed.map(r => [r.id, r]));
      } catch (err) {
        console.warn(`[atlas:sync] bulk backfill list walk failed for ${type}:`, err);
      }
      for (const it of group) {
        if (this.stopped) break; // detach/unlink — never stamp past a reset
        const id = it.element.id as string;
        const remote = remoteById.get(id);
        if (remote) {
          if (await this.localStep(failures, id, type, 'create',
            () => this.folder.stampServerUpdatedAt(id, type, remote.updated_at, sentStamps.get(id), keptFrom(remote, true)))) {
            stamped++;
          }
        } else {
          failures.push({
            element_id: id, type, operation: 'create',
            message: 'created but baseline backfill failed: not present in post-bulk list walk',
          });
        }
      }
    }
    return stamped;
  }

  private async pushPhase(): Promise<SyncResult> {
    // keel's answer to the proposals still open (conv. 163, P5), read first
    // in every round one is pending: an accept moves keel's stamp, and an
    // edit made since must go out on the new baseline, not meet it as a
    // conflict. Before the changed list, which the settle can change.
    // Entries a held file kept in memory are written first.
    for (const e of [...this.unwrittenProposals]) if (!this.stopped) await this.recordProposal(e);
    const settleFailures: PerElementFailure[] = [];
    const settled = this.stopped ? { accepted: [] as string[], refused: [] as Conflict[] } : await this.settleProposals(settleFailures);
    const allChanged = await this.folder.listLocallyChangedSince(null);
    const tombstones = await this.folder.listTombstonesSince(null);
    // Partition: CREATEs (never-synced) vs UPDATEs. New elements MUST land
    // server-side before any UPDATE references them as a foreign key.
    //
    // CREATE batches of ≥2 route through `/bulk` when the client supports it:
    // one atomic request, server-side fixpoint FK resolution INCLUDING cycles
    // (the class the per-element loop can never converge on — 152/196 Sikelia
    // locations form a cyclic web). Retires the topo-sort on this path.
    //
    // Fallback (no bulkCreate, or a single create): the per-element loop with
    // Kahn topo-sort ordering, exactly the pre-v2 behavior. Cycles there fall
    // back to input order and self-heal across rounds for the acyclic part.
    // A kept id with no baseline (a hidden element's copy after a Keep, or a
    // create keel answered 404) is never sent: it is not a
    // create, it is something this key may no longer see.
    this.roundRole = null;
    this.roundHiddenRefused = [];
    this.roundHiddenShown = [];
    const stateAtStart = await this.folder.readSyncState();
    const keptAtStart = new Set(stateAtStart.kept_outside_view ?? []);
    // keel's stub is never pushed (conv. 155, I4): the store never lists one as changed.
    const keptCreates = allChanged.filter(e => !e.server_updated_at && keptAtStart.has(e.id));
    // A hidden element this key cannot put online (folder spec §4.8, conv. 170) is held with what is
    // anchored on it: worked out from the key's role each round, never sent, said once.
    const hiddenHeld = await this.hiddenHeldNow(allChanged.filter(e => !e.server_updated_at && !keptAtStart.has(e.id)));
    const allCreates = allChanged.filter(e => !e.server_updated_at && !keptAtStart.has(e.id) && !hiddenHeld.has(e.id));
    // A version keel holds as a proposal is sent once (conv. 163, P3): an edit after it is a new version.
    // A proposal keel did not take waits in the review: its edit is not sent again on its own (P5).
    const inProposalReview = new Set((stateAtStart.conflicts ?? []).filter(c => c.proposal).map(c => c.element_id));
    const heldAsProposed = allChanged.filter(e => !!e.server_updated_at
      && (alreadyProposed(this.proposedNow(stateAtStart.proposed), e.id, e.local_updated_at) || inProposalReview.has(e.id)));
    const updatesOnly = allChanged.filter(e => !!e.server_updated_at && !heldAsProposed.includes(e));
    const useBulk = typeof this.client.bulkCreate === 'function' && allCreates.length >= 2;
    const changed = useBulk
      ? updatesOnly
      : [...this.sortCreatesByDependencies(allCreates), ...updatesOnly];
    const total = allChanged.length + tombstones.length;
    let done = 0;

    let creates = 0;
    let updates = 0;
    let deletes = 0;
    const conflicts: Conflict[] = [...settled.refused];
    const failures: PerElementFailure[] = [...settleFailures];
    /**
     * Server-side deletes detected DURING push (pre-update GET returned null,
     * or PATCH returned 404). Symmetric to pullPhase server-delete detection.
     * Persisted into sync_state.server_deletes at end of pushPhase so the
     * review modal can offer keep / delete-locally for each one — same UX as
     * pull-detected server deletes. This prevents UPDATE 404s from leaking up
     * as raw error toasts and getting stuck in a retry loop.
     */
    const serverDeletesDetected: import('../core/types').ServerDeleteRecord[] = [];
    /**
     * Set when any operation throws 401/403. After the first auth failure we
     * bail the round — every subsequent op would fail the same way, and we
     * want to surface the auth state once via the pill, not as a wall of
     * per-element failure toasts. Caller transitions engine to `error` state.
     */
    let authBlocked = false;
    /** The first 429/503/network error: ends the round
     *  without pausing, so a busy server costs one request, not one per
     *  pending element. */
    let transient: unknown = null;
    /** Creates refused because their id lives in another world (sync-state `foreign`). */
    const roundForeign: Array<{ id: string; type: ElementType }> = [];
    /** Every create actually SENT this round: one that is not refused as foreign again leaves the list. */
    const attemptedCreates = new Set<string>();
    /**
     * Elements this key no longer sees (conv. 151): an edit to one stays
     * here, unsent and never offered for deletion. `keptAdd`: a guest's 404
     * or out-of-view peer this round, kept (keel answers a guest's out-of-view
     * element exactly as a deleted one, and the ruling keeps both).
     */
    const pushState = await this.folder.readSyncState();
    const kept = new Set(pushState.kept_outside_view ?? []);
    this.roundKept = kept;
    // This round's hold, not the last round's: a raise sends them now, links and all.
    this.roundLinkHeld = linkHeld({ ...pushState, hidden_held: [...hiddenHeld] });
    this.roundKeptAdd = [];
    const keptAdd = this.roundKeptAdd;
    const keptEdits: string[] = keptCreates.map(e => e.id);
    done += keptCreates.length + heldAsProposed.length + hiddenHeld.size;
    /** Elements whose edit keel took as a proposal this round (conv. 163, P2), for the round's report. */
    const proposedIds: string[] = [];
    /** Deletes keel refused as `proposed_only`, each element back from keel (P6). */
    const refusedDeletes: Array<{ id: string; type: ElementType; name?: string }> = [];
    /** Ids this round's 404s left for the next round: the role could not be read. */
    const roleUnknown: string[] = [];
    /** A 404 on an element someone else may still see: a guest keeps it, anyone else reviews it, an unknown role waits. */
    const keepsOn404 = async (id: string): Promise<boolean> => {
      // The role, read afresh once per push round: a lowering while the world is open moves the next 404.
      const role = await this.roundRoleNow();
      if (role === null) {
        roleUnknown.push(id);
        console.info('[atlas:sync] push: a 404 and the key\'s role unknown — left for the next round', { id });
        return true;
      }
      if (role !== 'guest') return false;
      keptAdd.push(id);
      keptEdits.push(id);
      console.info('[atlas:sync] push: a guest\'s 404 — outside this key\'s view, kept here', { id });
      return true;
    };

    if (useBulk) {
      const bulk = await this.bulkCreatePhase(allCreates, failures, serverDeletesDetected, () => {
        done++;
        this.onPushProgress(done, total);
      }, false, roundForeign, attemptedCreates);
      creates += bulk.created;
      if (bulk.authBlocked) authBlocked = true;
      if (bulk.transient) transient = bulk.transient;
    }

    /**
     * Creates refused this round. An UPDATE whose links name one would be
     * refused whole by keel (`invalid_link`), taking its other edits down
     * with it; it waits instead (a re-keyed
     * element refused on upload must not drag every referrer's PATCH along).
     */
    // A create whose only failure was a held file WAS accepted by the server
    // (the refusal was the local stamp after it), so it blocks nobody (its
    // referrers once waited under "OnlyWorlds refused" copy).
    const acceptedButHeld = (f: PerElementFailure) => isFileBusyError({ name: f.error_name });
    const refusedCreates = new Set<string>(
      failures.filter(f => f.operation === 'create' && !acceptedButHeld(f)).map(f => f.element_id),
    );

    for (const elem of changed) {
      // `stopped` (detach/unlink) aborts the push loop like the pull walk —
      // a stampServerUpdatedAt landing after resetSyncBaseline would
      // resurrect a baseline the unlink just cleared (the G-C latch
      // was pull-only).
      if (authBlocked || transient || this.stopped) break;
      const isCreate = !elem.server_updated_at;
      const failuresBefore = failures.length;
      /** The version the update sent: a proposal names it, not the round-start snapshot. */
      let sentStamp = elem.local_updated_at;
      if (!isCreate && kept.has(elem.id)) {
        keptEdits.push(elem.id);
        done++;
        this.onPushProgress(done, total);
        continue;
      }
      if (!isCreate && refusedCreates.size > 0 && splitByRefusedLinks([elem], refusedCreates).blocked.length > 0) {
        failures.push({
          element_id: elem.id,
          type: elem.type,
          operation: 'update',
          message: 'waits for an element OnlyWorlds refused in the same upload',
        });
        done++;
        this.onPushProgress(done, total);
        continue;
      }
      try {
        if (isCreate) {
          // Never synced before → CREATE on server. The server may assign its
          // own id (e.g., enforcing UUID v7 format) regardless of what we
          // sent. If so, we id-swap the local file to match the server's id
          // and rewrite any references — otherwise foreign-key fields pointing
          // at the OLD local id would fail on subsequent pushes ("Invalid FK").
          //
          // Re-fetch current state in case an in-loop id-swap on a previously
          // processed CREATE rewrote one of this element's reference fields.
          // The snapshot `elem` would otherwise carry stale ids.
          let current = await this.folder.getElement(elem.id);
          if (!current) {
            // Was silently removed by an earlier in-loop swap targeting this id
            // — nothing to push.
            continue;
          }
          // Self-heal pins missing `element_type` (legacy bug — creation paths
          // once didn't set it). Real OW returns 400 with
          // "element_type must be provided when element_id is specified" if
          // absent. Resolve from the referenced element's type and persist
          // back so subsequent pushes/pulls see a complete pin.
          if (
            current.type === 'pin' &&
            typeof current.element_id === 'string' &&
            !current.element_type
          ) {
            const pinned = await this.folder.getElement(current.element_id);
            if (pinned) {
              current = await this.folder.updateElement(current.id, { element_type: pinned.type });
              console.info('[atlas:sync] self-healed pin missing element_type', {
                pinId: current.id,
                elementType: pinned.type,
              });
            }
          }
          const body = this.outgoing(current);
          attemptedCreates.add(current.id);
          const response = await this.client.createElement(current.type, body);
          if (response.id !== current.id) {
            // Contract-impossible under keel (client ids PRESERVED — probed
            // 2026-07-12; the pre-keel Django server's v7 reassignment was the
            // reason the excised id-swap machinery existed). If a server ever
            // reassigns again, fail LOUDLY per-element rather than silently
            // re-keying the user's world; the element retries next round.
            console.error('[atlas:sync] server returned a DIFFERENT id on create — contract violation, element not stamped', {
              type: current.type, localId: current.id, serverId: response.id,
            });
            failures.push({
              element_id: current.id,
              type: current.type,
              operation: 'create',
              message: `server reassigned id on create (${current.id} → ${response.id}): v2 contract violation`,
            });
            continue;
          }
          // keel marks a seat's new element proposed on a reviewed world (conv. 168): the copy keeps it.
          await this.folder.stampServerUpdatedAt(current.id, current.type, response.updated_at, current.local_updated_at, keptFrom(response, true));
          creates++;
        } else {
          // UPDATE path: re-fetch element from folder in case an in-loop
          // id-swap rewrote one of its reference fields (e.g., a Character
          // whose location_id was rewritten after the Location's CREATE swap).
          // The original `elem` snapshot would still carry the stale old id.
          const current = await this.folder.getElement(elem.id);
          if (!current) {
            // Could happen if elem was silently removed by an id-swap (unlikely
            // for an UPDATE path since UPDATE implies server_updated_at present,
            // but defensive).
            continue;
          }

          // Pre-update server check: detect concurrent external changes OR
          // server-side delete. `getElement` returns null on 404 (adapter
          // catches it); a null remote with a non-null local baseline means
          // the server lost this element — route to server_deletes for review.
          const remote = await this.client.getElement(current.type, current.id);
          const baseline = current.server_updated_at!;

          if (!remote) {
            // Server doesn't have this element anymore (deleted via web app,
            // admin, another atlas instance, or never landed despite a local
            // baseline). PATCH would 404 — skip it. Add to server_deletes;
            // the review modal will offer keep + re-push (clears baseline)
            // or delete-locally. A guest's 404 is kept instead (conv. 151).
            if (await keepsOn404(current.id)) continue;
            serverDeletesDetected.push({
              id: current.id,
              type: current.type,
              detected_at: nowIso(),
              name: current.name,
            });
            console.info('[atlas:sync] push detected server-side delete', {
              id: current.id, type: current.type,
            });
            continue;
          }

          const serverMoved = remote.updated_at > baseline;

          let skipPush = false;
          if (serverMoved) {
            const conflict: Conflict = {
              element_id: current.id,
              type: current.type,
              detected_at: nowIso(),
              local_updated_at: current.local_updated_at,
              server_updated_at: remote.updated_at,
              fields: diffFieldNames(current, stripServerOnlyFields(remote)),
            };
            conflicts.push(conflict);
            this.onConflict(conflict);
            if (this.policy === 'pause-and-review') {
              // Keep local change on disk; do NOT push. Baseline stays.
              skipPush = true;
            }
            // local-wins: fall through and push our version anyway.
          }

          if (!skipPush) {
            // conv. 173: a mark the file gained while keel shows the element goes as keel's hide FIRST,
            // so the edit never reaches members between the two; the PATCH's answer then carries it.
            // A role not read this round holds the edit for the next.
            if (isHiddenMark(current) && !isHiddenMark(remote)
              && await this.hideOnline(current.type, current.id) === 'role-unknown') {
              roleUnknown.push(current.id);
              console.info('[atlas:sync] push: a mark to send and the key\'s role unknown — left for the next round', { id: current.id });
              continue;
            }
            const body = this.outgoing(current);
            sentStamp = current.local_updated_at;
            const response = await this.client.updateElement(current.type, current.id, body);
            // The body sent carried `current.local_updated_at`; an edit that
            // landed while this request was in flight keeps the element dirty
            // (it used to be stamped clean and never uploaded).
            // keel takes the mark on a create only: its answer says whether it shows the element,
            // and a mark taken out here comes back with it, since keel keeps hiding it (conv. 173).
            await this.folder.stampServerUpdatedAt(current.id, current.type, response.updated_at, current.local_updated_at, hiddenKeptOf(response));
            updates++;
          }
        }
      } catch (err) {
        // keel took the edit as a proposal (conv. 163, P1, P2): the element did
        // not change, nothing is stamped, and the edit stays here. Not a failure.
        if (isOwProposed(err) && !isCreate) {
          // Recorded the moment keel answers: an auth bail or a
          // busy sync-state later in the round must not lose it, or the next
          // round proposes the same version again.
          const entry: ProposedEdit = { element_id: elem.id, type: elem.type, proposal_id: err.proposal.id, local_updated_at: sentStamp, at: nowIso() };
          proposedIds.push(elem.id);
          await this.recordProposal(entry);
          console.info('[atlas:sync] push: keel took the edit as a proposal', { id: elem.id, type: elem.type, proposal: err.proposal.id });
        }
        // Auth failure (401/403): bail the round. Every subsequent element
        // would 401 with the same dead credentials; no point hammering the
        // server. Record the element as failed so the user knows the round
        // produced no progress; caller (runPushOnly/runSync) transitions
        // engine state to `error` based on the auth_blocked flag.
        // keel would not make it hidden for this key (conv. 170): held here, said once, never a failure.
        else if (isCreate && isHiddenRefusal(err)) {
          this.roundHiddenRefused.push(elem.id);
          console.info('[atlas:sync] push: keel will not make a hidden element for this key — held here', { id: elem.id });
        }
        else if (isAuthError(err)) {
          authBlocked = true;
          this.noteAuthBail(err);
          failures.push(failureOf(elem.id, elem.type, isCreate ? 'create' : 'update', err));
          console.warn('[atlas:sync] push hit auth error — bailing round', {
            id: elem.id, type: elem.type, message: err instanceof Error ? err.message : String(err), // raw-error-ok: inside a console.warn object
          });
        }
        else if (isTransientError(err)) {
          transient = err;
          failures.push(failureOf(elem.id, elem.type, isCreate ? 'create' : 'update', err));
          console.warn('[atlas:sync] push hit a busy or unreachable server — ending the round', {
            id: elem.id, type: elem.type, message: err instanceof Error ? err.message : String(err), // raw-error-ok: inside a console.warn object
          });
        }
        // 404 on a non-CREATE means the server lost the element between our
        // pre-GET (which succeeded) and our PATCH. Race or out-of-band delete.
        // Route to server_deletes — same UX as the inline detection above.
        // Don't add to failures (would surface as a raw error elsewhere).
        // A create answered 404, for a key that can be denied a hidden element
        // (a contributor or a guest; owners and co-builders see them all),
        // names an id hidden from it (keel's create, Skeld 2026-10-20: never
        // id_conflict, nothing made). Kept, never sent again.
        else if (isCreate && isNotFoundError(err) && hiddenCanBeDenied(await this.roundRoleNow())) {
          keptAdd.push(elem.id);
          keptEdits.push(elem.id);
          console.info('[atlas:sync] push: a create answered 404 — an id hidden from this key, kept here', { id: elem.id });
        }
        else if (!isCreate && isNotFoundError(err)) {
          if (await keepsOn404(elem.id)) continue;
          serverDeletesDetected.push({
            id: elem.id,
            type: elem.type,
            detected_at: nowIso(),
            name: elem.name,
          });
          console.info('[atlas:sync] push UPDATE 404 — routing to server-delete review', {
            id: elem.id, type: elem.type,
          });
        }
        // Dangling-link failure (keel "invalid_link") means a peer this
        // element references (zone, map, friend, etc.) was deleted server-side
        // while atlas still has it as "synced" locally. Applies to CREATE and
        // UPDATE alike — keel enforces links honestly on every write (v1 only
        // hard-failed single links; the CREATE-only routing was a v1 artifact).
        // Surface the orphan peer for review: user picks keep + re-push (peer
        // re-CREATEs next round, this element succeeds) or delete-locally.
        //
        // Record the CURRENT element as a failure with a clearer message so
        // the user knows why it didn't land, AND queue the missing peer for
        // the server-delete review modal. The dangling id comes from the
        // error message itself — no body lookup.
        else if (parseInvalidLinkError(err)) {
          const parsed = parseInvalidLinkError(err)!;
          const routedPeer = await this.routeDanglingPeer(parsed, elem, serverDeletesDetected);
          // A peer just found out of a guest's view: no failure, the element
          // stays changed and the next round sends it without that link. A
          // create stays refused this round, so nothing links it yet (H2).
          if (!routedPeer && this.roundKeptAdd.includes(parsed.refId)) {
            if (isCreate) refusedCreates.add(elem.id);
            continue;
          }
          failures.push({
            element_id: elem.id,
            type: elem.type,
            operation: isCreate ? 'create' : 'update',
            message: routedPeer
              ? `referenced ${parsed.refType} was deleted on the server; review in sync panel`
              : `referenced ${parsed.refType} not found on the server`,
          });
        }
        // 409 id_conflict on CREATE: the server already has this id (backfill
        // miss on a prior /bulk, or a re-push after an interrupted round).
        // Adopt the server's timestamp as baseline instead of failing forever;
        // any pending local divergence flows as UPDATE next round.
        else if (isCreate && isIdConflictError(err)) {
          // The read-back is guarded: a network error, 503
          // or 401 here used to escape the loop, skipping the rest of the
          // round, the tombstones and the server_deletes persist. Auth bails the
          // round as the loop does; anything else is a per-element failure.
          let remote: Awaited<ReturnType<OwApiClient["getElement"]>> = null;
          let readErr: unknown = null;
          try {
            remote = await this.client.getElement(elem.type, elem.id);
          } catch (err) {
            readErr = err;
            if (isAuthError(err)) {
              authBlocked = true; // the loop's top check ends the round
              this.noteAuthBail(err);
            }
          }
          if (remote) {
            if (await this.localStep(failures, elem.id, elem.type, 'create', () => this.adoptServerCopy(elem, remote))) {
              console.info('[atlas:sync] CREATE 409 id_conflict — element already on server; baseline adopted', {
                id: elem.id, type: elem.type,
              });
            }
          } else if (readErr === null) {
            // A single POST 409s for a same-world id too, so only a read-back
            // that ANSWERED "not here" proves the id belongs to another world.
            roundForeign.push({ id: elem.id, type: elem.type });
            failures.push({
              element_id: elem.id, type: elem.type, operation: 'create',
              message: 'this id already exists in another world',
            });
          } else {
            // A read-back that failed proves nothing (a 409 plus a 503 used to read as foreign and would have been
            // offered a re-key, duplicating a same-world element).
            failures.push(failureOf(elem.id, elem.type, 'create', readErr, 'id_conflict, and checking it failed: '));
          }
        } else {
          // Per-element failure (4xx, validation, transient network) is non-fatal:
          // record and continue. Caller inspects result.failures to decide what
          // to surface. This matters most for Make-Online flows uploading dozens
          // of elements — one bad element shouldn't abort the rest.
          failures.push(failureOf(elem.id, elem.type, isCreate ? 'create' : 'update', err));
        }
      } finally {
        done++;
        this.onPushProgress(done, total);
        if (isCreate && failures.slice(failuresBefore).some(f => f.element_id === elem.id && !acceptedButHeld(f))) {
          refusedCreates.add(elem.id);
        }
      }
    }

    for (const tomb of tombstones) {
      if (authBlocked || transient || this.stopped) break;
      try {
        await this.client.deleteElement(tomb.type, tomb.id);
        await this.folder.clearTombstone(tomb.id);
        deletes++;
      } catch (err) {
        // A seat on a reviewed world deletes only what it made (conv. 163, P6):
        // keel's 403 `proposed_only` is not a dead key. The element comes back
        // from keel and the tombstone goes.
        if (isProposedOnly(err)) {
          // The element comes back from keel's copy. A read that fails keeps the
          // tombstone for the next round (clearing it would leave
          // the element on keel and gone here, with "it is back" said).
          let remote: Awaited<ReturnType<OwApiClient['getElement']>> | undefined;
          try { remote = await this.client.getElement(tomb.type, tomb.id); } catch { remote = undefined; }
          if (remote === undefined) {
            console.info('[atlas:sync] push: proposed_only, and keel\'s copy could not be read — the delete waits for the next round', { id: tomb.id });
          } else {
            const back = await this.localStep(failures, tomb.id, tomb.type, 'delete', async () => {
              if (remote) {
                const { updated_at, ...body } = remote;
                await this.folder.applyServerRecord(tomb.type, body, updated_at);
              }
              await this.folder.clearTombstone(tomb.id);
            });
            if (back && remote) refusedDeletes.push({ id: tomb.id, type: tomb.type, ...(typeof remote.name === 'string' ? { name: remote.name } : {}) });
            console.info('[atlas:sync] push: keel keeps this delete for the keeper (proposed_only) — the element is back', { id: tomb.id, type: tomb.type });
          }
        }
        // Auth failure here behaves identically to the elements loop: bail.
        else if (isAuthError(err)) {
          authBlocked = true;
          this.noteAuthBail(err);
          failures.push(failureOf(tomb.id, tomb.type, 'delete', err));
          console.warn('[atlas:sync] push (tombstone) hit auth error — bailing round', {
            id: tomb.id, type: tomb.type,
          });
        }
        else if (isTransientError(err)) {
          transient = err;
          failures.push(failureOf(tomb.id, tomb.type, 'delete', err));
        }
        // 404 means "server doesn't have it" — that IS the desired post-
        // condition of a DELETE, so we treat it as success and clear the
        // tombstone. Without this, three vectors produce orphan tombstones
        // that retry forever:
        //   1. Never-synced create-then-delete (id never existed server-side).
        //   2. Cascade-delete writing tombstones for never-synced dependents.
        //   3. Out-of-band server-side delete (another client / admin).
        // The fakes (FakeOwApiClient + msw-handlers) now mirror real-OW 404
        // on unknown ids, so this contract is locked in by tests.
        else if (isNotFoundError(err)) {
          console.info('[atlas:sync] tombstone target already gone (404) — clearing', {
            id: tomb.id, type: tomb.type,
          });
          if (await this.localStep(failures, tomb.id, tomb.type, 'delete', () => this.folder.clearTombstone(tomb.id))) {
            deletes++;
          }
        } else {
          failures.push(failureOf(tomb.id, tomb.type, 'delete', err));
        }
      } finally {
        done++;
        this.onPushProgress(done, total);
      }
    }

    // conv. 173: the clean copies keel still shows though the file marks them hidden, after the
    // person's own writes.
    if (!authBlocked && !transient && !this.stopped) {
      try {
        await this.hideShownCopies(kept);
      } catch (err) {
        if (isAuthError(err)) { authBlocked = true; this.noteAuthBail(err); }
        else if (isTransientError(err)) transient = err;
        else if (isFileBusyError(err)) failures.push({ ...failureOf('world', 'world', 'update', err), source: 'disk' });
        else console.warn('[atlas:sync] the hide of a copy marked hidden failed — tried again next round', {
          message: err instanceof Error ? err.message : String(err), // raw-error-ok: inside a console.warn object
        });
      }
    }

    // The delete's link scrub went out first, as unlink proposals keel now
    // holds for the keeper: withdrawn, and the links put back.
    if (refusedDeletes.length > 0 && !authBlocked && !transient && !this.stopped) {
      const withdrawn = await this.restoreRefusedLinks(new Set(refusedDeletes.map(d => d.id)), failures);
      for (let i = proposedIds.length - 1; i >= 0; i--) if (withdrawn.has(proposedIds[i])) proposedIds.splice(i, 1);
    }

    // Persist server-side deletes detected during push. Append + dedup with
    // any pre-existing entries (e.g. from a prior pull) so the review modal
    // sees the union. Symmetric with pullPhase's persistence pattern.
    //
    // SKIP if the round was auth-blocked — we can't trust any state derived
    // from a half-aborted round. The fresh engine post-recovery will detect
    // any real server-deletes via its first pull. SKIP likewise when stopped
    // (detach/unlink) — a post-reset write would resurrect cleared state.
    if (!authBlocked && !this.stopped) {
      // Foreign ids: the stored list, this round's evidence, and only
      // what is STILL here and never synced (formula: sync/foreign-ids.ts).
      const stillUnsynced = new Set(
        (await this.folder.listLocallyChangedSince(null)).filter(e => !e.server_updated_at).map(e => e.id),
      );
      const roundNow = nowIso();
      try {
        await this.folder.updateSyncState(curr => {
          const foreignNext = {
            ...(curr.foreign || roundForeign.length > 0
              ? { foreign: mergeForeignIds(curr.foreign, this.apiWorldId, roundForeign, stillUnsynced, roundNow, attemptedCreates) }
              : {}),
          };
          // The kept set: this round's guest 404s in, deleted-here ids out.
          const deletedHere = new Set(tombstones.map(t => t.id));
          const keptNext = [...new Set([...(curr.kept_outside_view ?? []), ...keptAdd])].filter(id => !deletedHere.has(id));
          const keptPart = keptNext.length > 0 || (curr.kept_outside_view?.length ?? 0) > 0 ? { kept_outside_view: keptNext } : {};
          // No review row for a kept element, whatever wrote it (1.59.1's own, a side path's).
          const keptIds = new Set(keptNext);
          const existing = (curr.server_deletes ?? []).filter(d => !keptIds.has(d.id));
          const existingIds = new Set(existing.map(d => d.id));
          const fresh = serverDeletesDetected.filter(d => !existingIds.has(d.id) && !keptIds.has(d.id));
          const deletesPart = fresh.length > 0 || existing.length !== (curr.server_deletes ?? []).length
            ? { server_deletes: [...existing, ...fresh] } : {};
          const heldNow = [...new Set([...hiddenHeld, ...this.roundHiddenRefused])];
          const heldPart = heldNow.length > 0 || (curr.hidden_held?.length ?? 0) > 0 ? { hidden_held: heldNow } : {};
          return { last_push_at: roundNow, ...foreignNext, ...keptPart, ...deletesPart, ...heldPart };
        });
      } catch (err) {
        // A cloud client re-uploading `.atlas/sync-state.json` each round
        // holds it exactly now: the throw used to drop every
        // failure of the round, toast nothing and arm no retry. What this
        // write records is found again next round (a 404 re-detects a server
        // delete, a refusal re-proves a foreign id), so it waits with the rest.
        if (!isFileBusyError(err)) throw err;
        failures.push(failureOf('world', 'world', 'update', err));
      }
    }
    // A file another program held past the writer's own retries: the
    // element stays dirty, so try again shortly instead of waiting for the
    // user's next edit (the Discord report: it healed only on the next save).
    // Five rounds in a row at most: a file that never frees up (read-only,
    // locked for good) stops costing a round every 30 s.
    const busy = failures.some(f => isFileBusyError({ name: f.error_name }));
    this.busyRounds = busy ? this.busyRounds + 1 : 0;
    if (busy && !transient && !authBlocked && !this.stopped && this.busyRounds <= 5) {
      this.scheduleTransientRetry(undefined);
    }
    // The role this round read, reported so Settings moves with the first
    // kept 404, not at the next pull's resync. A round that never
    // asked reports nothing; an unknown role is not news.
    const roundRole = this.roundRole ? await this.roundRole : null;
    return {
      pushed: { creates, updates, deletes },
      pulled: zero(),
      conflicts,
      failures,
      auth_blocked: authBlocked || undefined,
      ...(transient ? transientFields(transient) : {}),
      ...(keptEdits.length > 0 ? { kept_edit_ids: keptEdits } : {}),
      ...hiddenHeldReport(allChanged, hiddenHeld, this.roundHiddenRefused),
      ...(this.roundHiddenShown.length > 0 ? { hidden_shown_ids: [...new Set(this.roundHiddenShown)] } : {}),
      ...(roundRole !== null ? { own_role: roundRole } : {}),
      ...(proposedIds.length > 0 ? { proposed_ids: proposedIds } : {}),
      ...(refusedDeletes.length > 0 ? { delete_refused: refusedDeletes } : {}),
      ...(settled.accepted.length > 0 ? { proposals_accepted: settled.accepted } : {}),
    };
  }

  /**
   * conv. 163, P2 and P3: record one proposal's entry the moment keel answers,
   * the newest per element, and withdraw the open row it replaces, so the
   * keeper reviews the newest only (best effort: a decided row's 404 or 422
   * stays). A held sync-state file keeps the entry in memory
   * (`unwrittenProposals`) until a later round's write lands.
   */
  private async recordProposal(entry: ProposedEdit): Promise<void> {
    const unwrittenBefore = this.unwrittenProposals.find(e => e.element_id === entry.element_id && e.proposal_id !== entry.proposal_id);
    let replaced: ProposedEdit | undefined;
    try {
      await this.folder.updateSyncState(s => {
        replaced = (s.proposed ?? []).find(e => e.element_id === entry.element_id && e.proposal_id !== entry.proposal_id);
        return { proposed: withProposed(s.proposed, entry) };
      });
    } catch (err) {
      if (!isFileBusyError(err)) throw err;
      this.unwrittenProposals = withProposed(this.unwrittenProposals, entry);
      if (unwrittenBefore) await this.client.withdrawProposal?.(unwrittenBefore.type, unwrittenBefore.element_id, unwrittenBefore.proposal_id).catch(() => undefined);
      return;
    }
    this.unwrittenProposals = this.unwrittenProposals.filter(e => e.element_id !== entry.element_id);
    for (const old of [replaced, unwrittenBefore]) {
      if (old) await this.client.withdrawProposal?.(old.type, old.element_id, old.proposal_id).catch(() => undefined);
    }
  }

  /**
   * A delete keel refused (P6) brought its element back, but the delete's
   * scrub (conv. 101) had already cut the links to it from every referrer,
   * and those edits went out first, as proposals a keeper could accept for a
   * delete that never happened (TC, 2026-10-22). For each
   * changed element whose keel copy still links to an id in `back`: withdraw
   * its open proposal and put the links back. A copy that then matches keel's
   * takes keel's record (nothing left to send); one with other edits stays
   * changed and proposes them again, without the unlink. A referrer keel's
   * copy no longer links (an unlink already accepted) has nothing to restore.
   * Returns the ids whose proposals were withdrawn.
   */
  private async restoreRefusedLinks(back: ReadonlySet<string>, failures: PerElementFailure[]): Promise<Set<string>> {
    const withdrawn = new Set<string>();
    const withdrawnPids = new Set<string>();
    const pending = this.proposedNow((await this.folder.readSyncState()).proposed);
    const changed = (await this.folder.listLocallyChangedSince(null)).filter(e => e.server_updated_at && !back.has(e.id));
    for (const el of changed) {
      if (this.stopped) break;
      let remote: Awaited<ReturnType<OwApiClient['getElement']>>;
      try {
        remote = await this.client.getElement(el.type, el.id);
      } catch {
        continue; // unread: its proposal stays for the keeper, as before
      }
      if (!remote) continue;
      const { updated_at, ...body } = remote;
      const server = stripServerOnlyFields(remote) as unknown as Element;
      if (!restoredLinkPatch(el, server, back)) continue;
      const entry = pending.find(e => e.element_id === el.id);
      if (entry) {
        await this.client.withdrawProposal?.(entry.type, entry.element_id, entry.proposal_id).catch(() => undefined);
        withdrawnPids.add(entry.proposal_id);
        withdrawn.add(el.id);
      }
      await this.localStep(failures, el.id, el.type, 'update', async () => {
        const restored = await this.folder.updateElementWith(el.id, onDisk => restoredLinkPatch(onDisk, server, back));
        if (restored && sameWireContent(restored, server as unknown as Record<string, unknown>)) {
          await this.folder.applyServerRecordIfUnchanged(el.type, body, updated_at, restored.local_updated_at ?? null);
        }
      });
      console.info('[atlas:sync] push: a refused delete\'s unlink withdrawn, the link put back', { id: el.id, proposal: entry?.proposal_id });
    }
    if (withdrawnPids.size > 0) {
      this.unwrittenProposals = this.unwrittenProposals.filter(e => !withdrawnPids.has(e.proposal_id));
      try {
        await this.folder.updateSyncState(s => ({ proposed: (s.proposed ?? []).filter(e => !withdrawnPids.has(e.proposal_id)) }));
      } catch (err) {
        // A held file keeps the entry; the next settle reads its row gone and
        // reviews it, the link already back here.
        if (!isFileBusyError(err)) throw err;
        failures.push(failureOf('world', 'world', 'update', err));
      }
    }
    return withdrawn;
  }

  /** The proposals a round reads: the file's entries and any still waiting to be written. */
  private proposedNow(fromFile: ProposedEdit[] | undefined): ProposedEdit[] {
    return this.unwrittenProposals.reduce((list, e) => withProposed(list, e), fromFile ?? []);
  }

  /**
   * conv. 163, P5: settle each open entry by keel's queue (the caller's own
   * rows). Accepted: the keeper's write holds the proposal, so the copy takes
   * the server's (or, when edited since, only its stamp: the newer edit is
   * sent on). Declined, lapsed or withdrawn: the edit is not in the world, and
   * it goes to the review with keel's reason, whatever the conflict policy.
   * A queue that cannot be read leaves every entry for the next round.
   */
  private async settleProposals(failures: PerElementFailure[]): Promise<{ accepted: string[]; refused: Conflict[] }> {
    const none = { accepted: [] as string[], refused: [] as Conflict[] };
    const entries = (await this.folder.readSyncState()).proposed ?? [];
    if (entries.length === 0 || typeof this.client.listProposals !== 'function') return none;
    let queue: Awaited<ReturnType<NonNullable<OwApiClient['listProposals']>>>;
    try {
      queue = await this.client.listProposals();
    } catch (err) {
      console.info('[atlas:sync] proposals: the queue could not be read — entries wait for the next round', {
        message: err instanceof Error ? err.message : String(err), // raw-error-ok: inside a console.info object
      });
      return none;
    }
    const accepted: string[] = [];
    const refused: Conflict[] = [];
    const goneOnline: import('../core/types').ServerDeleteRecord[] = [];
    const settledPids = new Set<string>();
    for (const entry of entries) {
      if (this.stopped) break;
      const outcome = settle(entry, queue.rows, queue.complete);
      if (outcome.kind === 'open') continue;
      const local = await this.folder.getElement(entry.element_id);
      if (!local) { settledPids.add(entry.proposal_id); continue; }
      let remote: Awaited<ReturnType<OwApiClient['getElement']>>;
      try {
        remote = await this.client.getElement(entry.type, entry.element_id);
      } catch {
        continue; // unreachable now: settled on a later round
      }
      if (!remote) {
        // Deleted online (keel drops an element's undecided rows with it): the
        // server-delete review, never a proposal row whose Pull would throw.
        goneOnline.push({ id: entry.element_id, type: entry.type, detected_at: nowIso(), name: local.name });
      } else if (outcome.kind === 'accepted') {
        const { updated_at, ...body } = remote;
        const ok = await this.localStep(failures, entry.element_id, entry.type, 'update', async () => {
          const landed = local.local_updated_at === entry.local_updated_at
            && await this.folder.applyServerRecordIfUnchanged(entry.type, body, updated_at, local.local_updated_at ?? null);
          // Edited since (before the settle, or during it): the newer edit stays
          // and goes out on the new baseline.
          if (!landed) await this.folder.stampServerUpdatedAt(entry.element_id, entry.type, updated_at, entry.local_updated_at, hiddenWordOf(body));
        });
        if (!ok) continue;
        accepted.push(entry.element_id);
      } else {
        refused.push({
          element_id: entry.element_id,
          type: entry.type,
          detected_at: nowIso(),
          local_updated_at: local.local_updated_at,
          server_updated_at: remote.updated_at,
          fields: diffFieldNames(local, stripServerOnlyFields(remote)),
          proposal: outcome.proposal,
        });
      }
      settledPids.add(entry.proposal_id);
    }
    if (settledPids.size === 0) return none;
    await this.folder.updateSyncState(s => {
      const refusedIds = new Set(refused.map(c => c.element_id));
      const deleteIds = new Set((s.server_deletes ?? []).map(d => d.id));
      const freshGone = goneOnline.filter(d => !deleteIds.has(d.id));
      return {
        proposed: (s.proposed ?? []).filter(e => !settledPids.has(e.proposal_id)),
        conflicts: [...(s.conflicts ?? []).filter(c => !refusedIds.has(c.element_id)), ...refused],
        ...(freshGone.length > 0 ? { server_deletes: [...(s.server_deletes ?? []), ...freshGone] } : {}),
      };
    });
    console.info('[atlas:sync] proposals settled', { accepted: accepted.length, refused: refused.length });
    return { accepted, refused };
  }

  /**
   * Pull dispatch: cursor-delta /changes walk when the client supports it
   * (v2), else the legacy full-list pull (fakes mid-migration, degraded
   * clients). Same SyncResult contract either way.
   */
  private async pullPhase(skipIds: Set<string> = new Set()): Promise<SyncResult> {
    // An element keel holds as a proposal is settled by keel's queue, never by
    // the pull (conv. 163, P5): the keeper's accept moves its stamp while the
    // edit is still here, and that is not a conflict.
    for (const e of this.proposedNow((await this.folder.readSyncState()).proposed)) skipIds.add(e.element_id);
    if (typeof this.client.pullChanges === 'function') {
      return this.pullPhaseChanges(skipIds);
    }
    return this.pullPhaseFullList(skipIds);
  }

  /**
   * The v2 delta pull — walks the per-world /changes feed from the persisted
   * cursor (cold start = the world's epoch, a complete-state replay).
   *
   * Structural win over the full-list pull: deletions arrive as EXPLICIT ops,
   * so the absence-inference server-delete detection (and its incomplete-list
   * false-positive class — a destructive prompt) doesn't exist on this path.
   *
   * Hardened (2026-07-12):
   *   - An upsert REVIVES its id: it cancels any pending server-delete review
   *     entry for that id, in-round and persisted (delete-then-recreate must
   *     never leave a destructive prompt on a live element).
   *   - Delete ops carry a staleness guard (deleted_at <= local baseline →
   *     superseded, skip).
   *   - The cursor and the round's derived side-effects (server_deletes,
   *     conflicts) persist ATOMICALLY — including on a non-auth mid-walk
   *     throw. The cursor never advances past ops whose side-effects were
   *     dropped.
   *   - `this.stopped` (detach/unlink) aborts applies and the terminal
   *     persist, so resetSyncBaseline's cleared cursor stays cleared.
   *   - A non-advancing cursor with hasMore aborts the walk (the silent
   *     replay trap — unknown query params are ignored server-side).
   *   - Timestamps: the op's embedded element.updated_at is used for BOTH the
   *     serverChanged comparison and the stamped baseline (probed byte-equal
   *     across every endpoint; single-sourcing makes skew impossible).
   */
  private async pullPhaseChanges(skipIds: Set<string> = new Set()): Promise<SyncResult> {
    let creates = 0;
    let updates = 0;
    const conflicts: Conflict[] = [];
    const newServerDeletes: import('../core/types').ServerDeleteRecord[] = [];
    /** Ids proven ALIVE by an upsert — cancel any delete-review entry. */
    const revivedIds = new Set<string>();
    const pulledIds: string[] = [];
    let authBlocked = false;

    const syncState = await this.folder.readSyncState();
    let cursor: string | null = syncState.changes_cursor ?? null;
    /** Cursor of the last FULLY-APPLIED page — the only value ever persisted. */
    let lastAppliedCursor: string | null = cursor;
    /**
     * Rewind memory (v2 tail): highest change_seq ever applied. Advanced in
     * the same lockstep as the cursor; compared against each page's `head`.
     */
    let lastAppliedSeq: number | null = syncState.changes_last_seq ?? null;
    let rewindDetected = false;
    /**
     * A guest's view moved (keel core/changes.py: a role, a Character given or
     * taken, the roster: every player who joins moves it): the old cursor
     * answers 409 `resync_required`, and keel's word is to pull again from 0.
     * Once per round. The ids the fresh walk names are what this reader may
     * see now; in a view-only world whatever else is here has left its view
     * and goes without a review (#416: a player world in Atlas).
     */
    let resynced = false;
    const seenInResync = new Set<string>();
    /** keel's word on why the view moved, when it said (conv. 151). */
    let resyncWhy: 'role' | 'view' | null = null;
    /** Kept elements the feed named again: back in view, so they sync again (conv. 151 I8). */
    const revealed = new Set<string>();
    /** Elements this round's resync found outside the view and kept. */
    const keptNow: string[] = [];
    /** The role the folder was walked whole under this round, when read. */
    let walkedAs: string | undefined;
    /** What earlier role changes kept, as this round began. */
    const keptBefore = new Set(syncState.kept_outside_view ?? []);
    /** Links held in the copy on a redacted read: kept and left ids (I4). */
    const linkHeldBefore = linkHeld(syncState);
    /** Ids that left the view this round (I2, I3) and ids the feed named again (I5), in feed order. */
    const leftAdd = new Set<string>();
    const leftDel = new Set<string>();
    /** Whole copies kept as last known against keel's stub (conv. 155, I3): before, added, and named whole again. */
    const keptWholeBefore = new Set(syncState.kept_whole ?? []);
    const keptWholeAdd = new Set<string>();
    const keptWholeDel = new Set<string>();
    /** A hidden element's copy with an edit never sent: kept, never sent again (I2). */
    const keptHidden = new Set<string>();
    let hiddenDrops = 0;
    /** Each element as it was before this round applied the server's copy: links to what left this round are put back from it. */
    const preApply = new Map<string, Element>();
    let walkComplete = false;
    /** Local writes another program's hold refused: per element, not the round. */
    const failures: PerElementFailure[] = [];
    /** A held file stopped the walk mid-page: the cursor must not pass it. */
    let heldStop = false;

    const tombstones = await this.folder.listTombstonesSince(null);
    const tombstoneIds = new Set(tombstones.map(t => t.id));
    const knownTypes = new Set<string>(ALL_ELEMENT_TYPES);

    /**
     * One atomic persist for cursor + side-effects, shared by every exit path
     * (complete, aborted-incomplete, non-auth throw). Skipped when stopped
     * (detached mid-walk) or auth-blocked (half-round state untrustworthy).
     */
    const persistRound = async (): Promise<void> => {
      if (this.stopped || authBlocked) return;
      await this.folder.updateSyncState(curr => {
        const existing = (curr.server_deletes ?? []).filter(d => !revivedIds.has(d.id));
        const existingIds = new Set(existing.map(d => d.id));
        const fresh = newServerDeletes.filter(d => !existingIds.has(d.id));
        let persistedConflicts = curr.conflicts;
        if (this.policy === 'pause-and-review') {
          const ids = new Set(curr.conflicts.map(c => c.element_id));
          persistedConflicts = [...curr.conflicts, ...conflicts.filter(c => !ids.has(c.element_id))];
        }
        const keptBefore = curr.kept_outside_view ?? [];
        const keptNext = [...new Set([...keptBefore.filter(id => !revealed.has(id)), ...keptNow, ...keptHidden])];
        // A kept element is neither deleted nor reachable: no review row and
        // no conflict holds it. Nor is one that left.
        const keptIds = new Set(keptNext);
        const leftBefore = curr.left_view ?? [];
        const leftNext = [...new Set([...leftBefore.filter(id => !leftDel.has(id)), ...leftAdd])];
        const gone = new Set([...keptNext, ...leftAdd]);
        const wholeBefore = curr.kept_whole ?? [];
        const wholeNext = [...new Set([...wholeBefore.filter(id => !keptWholeDel.has(id)), ...keptWholeAdd])];
        return {
          ...(wholeBefore.length > 0 || wholeNext.length > 0 ? { kept_whole: wholeNext } : {}),
          ...(walkComplete ? { last_pull_at: nowIso() } : {}),
          changes_cursor: lastAppliedCursor,
          changes_last_seq: lastAppliedSeq,
          conflicts: persistedConflicts.filter(c => !gone.has(c.element_id)),
          server_deletes: [...existing, ...fresh].filter(d => !gone.has(d.id)),
          ...(keptBefore.length > 0 || keptNext.length > 0 ? { kept_outside_view: keptNext } : {}),
          ...(leftBefore.length > 0 || leftNext.length > 0 ? { left_view: leftNext } : {}),
          ...(walkedAs !== undefined ? { walked_as_role: walkedAs } : {}),
        };
      });
    };

    const SAFETY_CAP_PAGES = 500;
    try {
      for (let page = 0; page < SAFETY_CAP_PAGES; page++) {
        if (this.stopped) {
          console.info('[atlas:sync] changes walk aborted — engine stopped');
          break;
        }
        let pageResult;
        try {
          pageResult = await this.client.pullChanges!(cursor, 500);
        } catch (err) {
          if (isAuthError(err)) {
            authBlocked = true;
            this.noteAuthBail(err);
            console.warn('[atlas:sync] changes walk hit auth error — bailing round', {
              message: err instanceof Error ? err.message : String(err), // raw-error-ok: inside a console.warn object
            });
            break;
          }
          if (!resynced && isResyncRequired(err)) {
            resyncWhy = resyncReason(err);
            console.info('[atlas:sync] /changes answered resync_required — this reader\'s view moved; walking again from 0', { reason: resyncWhy });
            resynced = true;
            cursor = null;
            lastAppliedCursor = null;
            lastAppliedSeq = null;
            continue;
          }
          throw err;
        }

        // Rewind guard (v2 tail): normal operation never rewinds; `head`
        // below our last-applied seq means the server was restored from
        // backup. Re-baseline: drop the cursor + seq memory and cold-walk
        // from the epoch (retention law makes the cold walk complete-state;
        // upserts are idempotent, deletes explicit). One reset per round —
        // a head that's STILL behind after reset would mean a server bug,
        // not a rewind, and must not loop.
        if (!rewindDetected
            && typeof pageResult.head === 'number'
            && lastAppliedSeq !== null
            && pageResult.head < lastAppliedSeq) {
          console.warn('[atlas:sync] /changes head below last-applied seq — server rewind detected; re-baselining with a cold walk', {
            head: pageResult.head, lastAppliedSeq,
          });
          rewindDetected = true;
          cursor = null;
          lastAppliedCursor = null;
          lastAppliedSeq = null;
          continue; // refetch from the epoch; this page's ops are discarded
        }

        for (const op of pageResult.changes) {
          if (this.stopped) break;
          if (!knownTypes.has(op.type)) {
            console.info(`[atlas:sync] changes: skipping op for unknown type "${op.type}"`);
            continue;
          }
          if (resynced && op.op === 'upsert') seenInResync.add(op.id);
          const hiddenRow = op.op === 'delete' && op.reason === 'hidden';
          if (op.op === 'upsert') {
            revealed.add(op.id);
            leftDel.add(op.id);
            leftAdd.delete(op.id);
            keptHidden.delete(op.id); // back in view in the same window
          }
          if (tombstoneIds.has(op.id)) continue; // pending local delete owns this id
          // A push conflict holds an ordinary row; a hide is still a hide.
          if (skipIds.has(op.id) && !hiddenRow) continue;

          if (op.op === 'upsert') {
            // The element demonstrably exists server-side — cancel any pending
            // delete-review entry (in-round now; persisted list at round end).
            revivedIds.add(op.id);
            const idx = newServerDeletes.findIndex(d => d.id === op.id);
            if (idx >= 0) newServerDeletes.splice(idx, 1);

            const serverStamp = op.element.updated_at;
            const local = await this.folder.getElement(op.id);
            // keel's read leaves out links this key may not see; the copy keeps them (conv. 151).
            const remoteBody = local
              ? withKeptLinks(op.type, stripServerOnlyFields(op.element), local, linkHeldBefore)
              : stripServerOnlyFields(op.element);
            if (!local) {
              if (!await this.pullWrite(failures, op.id, op.type, () =>
                this.folder.applyServerRecord(op.type, remoteBody, serverStamp))) { heldStop = true; continue; }
              creates++;
              pulledIds.push(op.id);
              console.info(`[atlas:sync] changes create ${op.type}/${op.id} (server: ${serverStamp})`);
              continue;
            }
            // keel's stub (conv. 155) keeps the element's stamp, so a change of shape
            // is read here, before the stamp test: a stub arriving whole is applied
            // (I2); a whole copy meets a stub as rule 5 says (I3).
            const keptWhole = keptWholeBefore.has(op.id) && !keptWholeDel.has(op.id);
            const move = knownOfMove(local, remoteBody, resynced && resyncWhy === 'view', keptWhole);
            if (!isKnownOf(remoteBody)) { keptWholeDel.add(op.id); keptWholeAdd.delete(op.id); }
            if (move === 'keep') {
              if (isKnownOf(remoteBody)) keptWholeAdd.add(op.id);
              continue;
            }
            if (move === 'apply') {
              let applied = false;
              if (!await this.pullWrite(failures, op.id, op.type, async () => {
                applied = await this.folder.applyServerRecordIfUnchanged(
                  op.type, remoteBody, serverStamp, local.local_updated_at ?? null);
              })) { heldStop = true; continue; }
              if (applied) {
                if (!preApply.has(op.id)) preApply.set(op.id, local);
                updates++;
                pulledIds.push(op.id);
              }
              continue;
            }
            const baseline = local.server_updated_at ?? '';
            const serverChanged = serverStamp > baseline;
            // keel's stub holds no edit of its own here, so the server always wins it (conv. 155, I5).
            const localChanged = !isKnownOf(local) && local.local_updated_at > baseline;
            if (!serverChanged) continue; // own echo or stale replay — idempotent skip
            if (localChanged) {
              const adopt = await this.adoptOwnCreate(failures, local, op.type, remoteBody, serverStamp);
              if (adopt === 'held') heldStop = true;
              if (adopt !== 'no') continue;
              conflicts.push({
                element_id: op.id,
                type: op.type,
                detected_at: nowIso(),
                local_updated_at: local.local_updated_at,
                server_updated_at: serverStamp,
                fields: diffFieldNames(local, remoteBody),
              });
              console.warn(`[atlas:sync] changes conflict ${op.type}/${op.id}`, {
                local_updated_at: local.local_updated_at,
                server_updated_at: serverStamp,
                baseline,
              });
              continue; // preserve the user's local change
            }
            // M3 race guard, INSIDE the per-id chain: the check and
            // the write are one slot, so a save cannot land between them.
            if (this.stopped) break;
            let applied = false;
            if (!await this.pullWrite(failures, op.id, op.type, async () => {
              applied = await this.folder.applyServerRecordIfUnchanged(
                op.type, remoteBody, serverStamp, local.local_updated_at ?? null);
            })) { heldStop = true; continue; }
            if (!applied) {
              console.info(`[atlas:sync] changes skip ${op.type}/${op.id} — local edited during round`);
              continue;
            }
            if (!preApply.has(op.id)) preApply.set(op.id, local);
            updates++;
            pulledIds.push(op.id);
          } else {
            // delete op — explicit server-side deletion.
            const local = await this.folder.getElement(op.id);
            // A hide (keel's one-rule §3): the row says drop the copy and never
            // offer to keep it, so it never reaches the review, whose Keep
            // would send it back as a create (I1). Unchanged, it leaves
            // silently; with an edit never sent, or no baseline (a Keep from
            // an earlier review), it is kept and never sent (I2);
            // what a role change kept stays kept (conv. 151). Already gone
            // (a replay after a round whose save was skipped): remembered
            // as left, so its links still never go out.
            if (hiddenRow) {
              revivedIds.delete(op.id);
              const queued = newServerDeletes.findIndex(d => d.id === op.id);
              if (queued >= 0) newServerDeletes.splice(queued, 1);
              if (!local) {
                leftAdd.add(op.id);
                leftDel.delete(op.id);
                continue;
              }
              if (keptBefore.has(op.id)) continue;
              if (!local.server_updated_at || (local.local_updated_at ?? '') > local.server_updated_at) {
                keptHidden.add(op.id);
                continue;
              }
              let gone = false;
              if (!await this.pullWrite(failures, op.id, op.type, async () => {
                gone = await this.folder.deleteSilentlyIfUnchanged(op.id, {
                  local_updated_at: local.local_updated_at ?? null,
                  server_updated_at: local.server_updated_at ?? null,
                });
              })) { heldStop = true; continue; }
              if (gone) {
                hiddenDrops++;
                leftAdd.add(op.id);
                leftDel.delete(op.id);
                console.info(`[atlas:sync] changes: ${op.type}/${op.id} was hidden from this key — removed from the copy`);
              } else {
                keptHidden.add(op.id);
              }
              continue;
            }
            if (!local) continue; // already gone locally
            if (!local.server_updated_at) {
              // Never-synced local sharing the id (uuid collision territory).
              // Never destroy a never-synced local from a feed op.
              console.warn(`[atlas:sync] changes: delete op for never-synced local ${op.type}/${op.id} — skipping`);
              continue;
            }
            // Staleness guard: a delete that predates our baseline was
            // superseded by a newer server state we already hold.
            if (op.deletedAt && op.deletedAt <= local.server_updated_at) {
              console.info(`[atlas:sync] changes: stale delete op for ${op.type}/${op.id} — skipping`);
              continue;
            }
            revivedIds.delete(op.id);
            if (!newServerDeletes.some(d => d.id === op.id)) {
              newServerDeletes.push({
                id: op.id,
                type: op.type,
                detected_at: nowIso(),
                name: local.name,
              });
              console.info('[atlas:sync] changes: server-side delete queued for review', {
                id: op.id, type: op.type,
              });
            }
          }
        }
        // A held file: the rest of its page still
        // applies, so one locked file does not stop every other element's
        // news; then the walk stops with the cursor before this page, which
        // is replayed next pull (replays are idempotent).
        if (this.stopped || heldStop) break;

        // Page fully applied — its cursor is now a safe resume point.
        const nextCursor = pageResult.cursor ?? null;
        if (pageResult.hasMore && (!nextCursor || nextCursor === cursor)) {
          console.warn('[atlas:sync] changes walk: hasMore with a non-advancing cursor — aborting as incomplete');
          break;
        }
        if (nextCursor) lastAppliedCursor = nextCursor;
        // Advance the rewind memory in the same lockstep as the cursor.
        const pageMaxSeq = pageResult.changes.reduce((m, op) => Math.max(m, op.changeSeq), 0);
        if (pageMaxSeq > 0 && pageMaxSeq > (lastAppliedSeq ?? 0)) lastAppliedSeq = pageMaxSeq;
        cursor = nextCursor ?? cursor;
        if (!pageResult.hasMore) {
          walkComplete = true;
          break;
        }
      }
    } catch (err) {
      // Non-auth mid-walk failure: cursor + already-derived side-effects
      // persist AS A UNIT (never a cursor-only write — that would advance the
      // watermark past delete/conflict events and lose them forever), then
      // rethrow for the caller's toast + idle-state restore.
      await persistRound().catch(persistErr => {
        console.warn('[atlas:sync] changes walk: persist-on-error failed:', persistErr);
      });
      throw err;
    }

    if (authBlocked) {
      return {
        pushed: zero(),
        pulled: zero(),
        conflicts: [],
        failures: [],
        auth_blocked: true,
      };
    }

    // After a resync, what the fresh walk did not name left this key's view.
    // A role change never takes from the copy (Titus 2026-10-20;
    // conv. 151): it is kept, marked, and stops syncing. Only keel's own word
    // that the view moved (`view`), or a role Atlas knows did not move, drops
    // it, and then only in a view-only world, where nothing can have been
    // edited; never what an earlier role change kept. Only on a complete
    // walk, and only what the server once gave (a stamp).
    let deletes = 0;
    if (walkComplete && !this.stopped && !heldStop && (resynced || syncState.walked_as_role === undefined)) {
      const role = await this.ownRole(resynced);
      if (role !== null) walkedAs = role;
    }
    const roleMoved = walkedAs === undefined || syncState.walked_as_role === undefined || walkedAs !== syncState.walked_as_role;
    // A writable world drops only on keel's own `view` (one-rule §3, I3): a
    // guess from the role is for a view-only world, where nothing is edited.
    const drops = this.readOnly
      ? resyncWhy === 'view' || (resyncWhy === null && !roleMoved)
      : resyncWhy === 'view';
    // What waits in the delete review is the person's to decide, in a writable
    // world: a resync never decides it for them.
    const inReview = new Set([...(syncState.server_deletes ?? []), ...newServerDeletes].map(d => d.id).filter(id => !revivedIds.has(id)));
    if (resynced && walkComplete && !this.stopped && !heldStop) {
      for (const el of await this.folder.listElements()) {
        if (this.stopped) break;
        if (seenInResync.has(el.id) || !el.server_updated_at) continue;
        if (keptBefore.has(el.id)) continue;
        // Only a drop waits for the person; a keep supersedes the row (conv. 151).
        if (!this.readOnly && drops && inReview.has(el.id)) continue;
        // An edit never sent stays here, kept, never sent again (conv. 151).
        if (!drops || (el.local_updated_at ?? '') > el.server_updated_at) {
          keptNow.push(el.id);
          continue;
        }
        try {
          if (await this.folder.deleteSilentlyIfUnchanged(el.id, {
            local_updated_at: el.local_updated_at ?? null,
            server_updated_at: el.server_updated_at,
          })) {
            deletes++;
            leftAdd.add(el.id);
            leftDel.delete(el.id);
          }
        } catch (err) {
          console.warn(`[atlas:sync] resync: ${el.type}/${el.id} left the view but could not be removed`, err);
          failures.push({ ...failureOf(el.id, el.type, 'delete', err), source: 'disk' });
        }
      }
      if (deletes > 0) console.info(`[atlas:sync] resync: ${deletes} element(s) left this reader's view and were removed`);
    }

    // An element applied this round while its peer left (keel's read leaves
    // the link out, before or after the row) gets the link back from its copy as it was:
    // the copy keeps links to what left (I4). Through the
    // server channel, so the stamps stay and nothing reads as an edit.
    if (leftAdd.size > 0 && !this.stopped) {
      for (const [id, before] of preApply) {
        const current = await this.folder.getElement(id);
        if (!current?.server_updated_at) continue;
        const body = stripSyncFields(current);
        const merged = withKeptLinks(current.type, body, before, leftAdd);
        if (merged === body) continue;
        await this.pullWrite(failures, id, current.type, () => this.folder.applyServerRecordIfUnchanged(
          current.type, merged, current.server_updated_at!, current.local_updated_at ?? null));
      }
    }

    // A held sync-state file leaves the cursor where it was: the next pull
    // replays from there, never the round's end.
    try {
      await persistRound();
    } catch (err) {
      if (!isFileBusyError(err)) throw err;
      failures.push({ ...failureOf('world', 'world', 'read', err), source: 'disk' });
    }
    if (keptNow.length > 0) console.info(`[atlas:sync] resync: ${keptNow.length} element(s) left this key's view and are kept here`, { reason: resyncWhy, role: walkedAs ?? null });
    return {
      pushed: zero(), pulled: { creates, updates, deletes: deletes + hiddenDrops }, conflicts, failures, pulled_ids: pulledIds,
      ...(walkedAs !== undefined ? { own_role: walkedAs } : {}),
      ...(keptNow.length > 0 ? { kept: keptNow.length } : {}),
      // A hidden element's copy with an edit: said as a kept edit is.
      ...(keptHidden.size > 0 ? { kept_edit_ids: [...keptHidden] } : {}),
    };
  }

  private async pullPhaseFullList(skipIds: Set<string> = new Set()): Promise<SyncResult> {
    let creates = 0;
    let updates = 0;
    const conflicts: Conflict[] = [];
    const newServerDeletes: import('../core/types').ServerDeleteRecord[] = [];
    /**
     * Element ids the pull actually applied to local (creates + updates).
     * Surfaced in SyncResult.pulled_ids so the UI can flash recently-changed
     * rows. Conflicts and skipped-due-to-local-edit do NOT land here.
     */
    const pulledIds: string[] = [];
    /**
     * Set if any listElements throws 401/403. Bail the rest of the round;
     * a half-pulled view would let server-delete detection falsely flag
     * the un-pulled types as "vanished from server."
     */
    let authBlocked = false;
    /** Local writes another program's hold refused: per element, not the round. */
    const failures: PerElementFailure[] = [];

    const tombstones = await this.folder.listTombstonesSince(null);
    const tombstoneIds = new Set(tombstones.map(t => t.id));
    // Track which previously-synced local elements were SEEN on the server
    // this pull; any unseen ones (with server_updated_at set) were deleted.
    const seenLocalIds = new Set<string>();

    for (const type of ALL_ELEMENT_TYPES) {
      if (authBlocked) break;
      let serverElements;
      try {
        serverElements = await this.client.listElements(type);
      } catch (err) {
        if (isAuthError(err)) {
          authBlocked = true;
          this.noteAuthBail(err);
          console.warn('[atlas:sync] pull hit auth error — bailing round', {
            type, message: err instanceof Error ? err.message : String(err), // raw-error-ok: inside a console.warn object
          });
          break;
        }
        // Non-auth errors propagate. Caller's runPullOnly/runSync wraps in
        // try/catch to restore idle state so the pill doesn't stay stuck
        // at 'fetching...'.
        throw err;
      }

      for (const remote of serverElements) {
        seenLocalIds.add(remote.id);
        // Skip elements pending local delete — they'll be DELETEd by next push.
        if (tombstoneIds.has(remote.id)) continue;
        // Skip elements push already conflicted on (avoid double-reporting).
        if (skipIds.has(remote.id)) continue;

        const local = await this.folder.getElement(remote.id);
        const remoteBody = stripServerOnlyFields(remote);

        if (!local) {
          // New on server → write locally with both timestamps = server's.
          if (!await this.pullWrite(failures, remote.id, type, () =>
            this.folder.applyServerRecord(type, remoteBody, remote.updated_at))) continue;
          creates++;
          pulledIds.push(remote.id);
          console.info(`[atlas:sync] pull create ${type}/${remote.id} (server: ${remote.updated_at})`);
          continue;
        }

        // A change of shape (keel's stub, conv. 155) first: no reset here, so a
        // whole copy meeting a stub is kept (I3); a stub arriving whole lands (I2).
        const move = knownOfMove(local, remoteBody, false);
        if (move === 'keep') continue;
        if (move === 'apply') {
          let applied = false;
          if (!await this.pullWrite(failures, remote.id, type, async () => {
            applied = await this.folder.applyServerRecordIfUnchanged(
              type, remoteBody, remote.updated_at, local.local_updated_at ?? null);
          })) continue;
          if (applied) { updates++; pulledIds.push(remote.id); }
          continue;
        }

        // Local has it. Decide based on timestamps.
        const localBaseline = local.server_updated_at ?? '';
        const localChanged = !isKnownOf(local) && local.local_updated_at > localBaseline;
        const serverChanged = remote.updated_at > localBaseline;

        if (!serverChanged) {
          // Server matches our baseline — nothing to pull for this element.
          // Surface only when a local change is pending so user knows it's
          // queued for push (otherwise this is just noise).
          if (localChanged) {
            console.info(`[atlas:sync] pull skip ${type}/${remote.id} — server unchanged since baseline, local edit pending push`);
          }
          continue;
        }

        if (localChanged) {
          if (await this.adoptOwnCreate(failures, local, type, remoteBody, remote.updated_at) !== 'no') continue;
          // Both sides changed since last sync → conflict.
          conflicts.push({
            element_id: remote.id,
            type,
            detected_at: nowIso(),
            local_updated_at: local.local_updated_at,
            server_updated_at: remote.updated_at,
            fields: diffFieldNames(local, remoteBody),
          });
          console.warn(`[atlas:sync] pull conflict ${type}/${remote.id}`, {
            local_updated_at: local.local_updated_at,
            server_updated_at: remote.updated_at,
            baseline: localBaseline,
            divergedFields: diffFieldNames(local, remoteBody),
          });
          // Don't overwrite local; preserve the user's change.
          continue;
        }

        // Server newer, local untouched → overwrite locally.
        //
        // Race guard (SYNC_NOTES M3): between the getElement() above and
        // this applyServerRecord, the user could have typed into the field
        // (UI save path runs through FolderStore.updateElement, bumping
        // local_updated_at). Without re-checking, the overwrite would clobber
        // the in-flight edit and the user's keystroke would silently vanish.
        // Re-read and bail if local has moved; the next pull (or autosave-
        // triggered push) reconciles cleanly.
        // The re-check now happens INSIDE the per-id chain.
        let applied = false;
        if (!await this.pullWrite(failures, remote.id, type, async () => {
          applied = await this.folder.applyServerRecordIfUnchanged(
            type, remoteBody, remote.updated_at, local.local_updated_at ?? null);
        })) continue;
        if (!applied) {
          console.info(`[atlas:sync] pull skip ${type}/${remote.id} — local edited during round, deferring to next sync`);
          continue;
        }
        updates++;
        pulledIds.push(remote.id);
        console.info(`[atlas:sync] pull update ${type}/${remote.id}`, {
          before: localBaseline,
          after: remote.updated_at,
        });
      }
    }

    // Auth-blocked: skip everything below — server-delete detection AND
    // sync-state persistence. A partial pull would produce wrong derived
    // state (types we didn't reach would look "vanished").
    if (authBlocked) {
      return {
        pushed: zero(),
        pulled: zero(),
        conflicts: [],
        failures: [],
        auth_blocked: true,
      };
    }

    // Detect server-side deletes: local elements that have server_updated_at
    // set (meaning they were once on the server) but didn't appear in any
    // list this pass.
    //
    // CRITICAL SAFETY: skip detection for any type whose list was paginated.
    // For paginated types, `seenLocalIds` is incomplete — it only contains the
    // first page. Page-2+ elements ARE on the server but absent from our set,
    // so naive detection would falsely flag them as "deleted on server" and
    // prompt the user to delete them locally → silent data loss for elements
    // alive on the server. The pagination flag is per-type, so types we DID
    // see fully still get server-delete detection.
    const paginatedTypes = this.client.getIncompleteListTypes?.()
      ?? this.client.getPaginatedTypes?.()
      ?? new Set<ElementType>();
    const allLocal = await this.folder.listElements();
    for (const elem of allLocal) {
      if (!elem.server_updated_at) continue; // never synced
      if (seenLocalIds.has(elem.id)) continue; // still on server
      if (tombstoneIds.has(elem.id)) continue; // pending local delete already
      if (paginatedTypes.has(elem.type)) continue; // can't trust seenLocalIds for this type
      newServerDeletes.push({
        id: elem.id,
        type: elem.type,
        detected_at: nowIso(),
        name: elem.name,
      });
    }

    // Persist pull-time conflicts to sync-state ONLY under pause-and-review.
    // Under local-wins, pull-conflicts are skipped silently; toast count is
    // surfaced by sync-attach via onSyncResult.
    //
    // Dedup by element_id — without this, repeated refreshes would append the
    // same conflict over and over (Titus caught this growing 1 → 2 → 3).
    // Computed inside the store's sync-state chain so a concurrent round's
    // entries survive this round's write.
    //
    // Skipped when the engine was stopped mid-round (detach/unlink): a
    // post-reset write would resurrect state resetSyncBaseline just cleared.
    if (this.stopped) {
      return { pushed: zero(), pulled: { creates, updates, deletes: 0 }, conflicts, failures, pulled_ids: pulledIds };
    }
    try {
      await this.folder.updateSyncState(currentState => {
        const existingServerDeletes = currentState.server_deletes ?? [];
        const existingDeleteIds = new Set(existingServerDeletes.map(d => d.id));
        const freshServerDeletes = newServerDeletes.filter(d => !existingDeleteIds.has(d.id));
        let persistedConflicts = currentState.conflicts;
        if (this.policy === 'pause-and-review') {
          const existingIds = new Set(currentState.conflicts.map(c => c.element_id));
          const fresh = conflicts.filter(c => !existingIds.has(c.element_id));
          persistedConflicts = [...currentState.conflicts, ...fresh];
        }
        return {
          last_pull_at: nowIso(),
          conflicts: persistedConflicts,
          server_deletes: [...existingServerDeletes, ...freshServerDeletes],
        };
      });
    } catch (err) {
      // A held sync-state file: the next pull derives the same again.
      if (!isFileBusyError(err)) throw err;
      failures.push({ ...failureOf('world', 'world', 'read', err), source: 'disk' });
    }

    return { pushed: zero(), pulled: { creates, updates, deletes: 0 }, conflicts, failures, pulled_ids: pulledIds };
  }

  // ---- Internals ----

  private setState(state: SyncEngineState): void {
    this.state = state;
    // Capture the most recent successful-sync timestamp so it survives
    // pause/resume. `last_sync_at` only lives on idle states; non-idle
    // transitions don't overwrite the captured value.
    if (state.kind === 'idle' && state.last_sync_at) {
      this.lastSyncAt = state.last_sync_at;
    }
    this.onStateChange(state);
  }
}

// ---- Helpers ----

/**
 * A per-element failure from a thrown error, keeping its `name`: the
 * toast classifies on it, because a held file's message is Chromium's stock
 * text and says nothing a user can act on.
 */
function failureOf(
  element_id: string,
  type: ElementType | 'world',
  operation: PerElementFailure['operation'],
  err: unknown,
  prefix = '',
): PerElementFailure {
  const name = (err as { name?: unknown } | null)?.name;
  const typed = typedError(err);
  return {
    element_id, type, operation,
    message: prefix + (err instanceof Error ? err.message : String(err)), // raw-error-ok: the failure record; Details print its fields, never this
    ...(typeof name === 'string' && name !== 'Error' ? { error_name: name } : {}),
    // What the details block may print: the server's status and code,
    // never its message, which can quote a name.
    ...(typed ? { status: typed.status, code: typed.code, ...(typed.param ? { param: typed.param } : {}), source: 'server' as const } : {}),
  };
}

function stripSyncFields(elem: Element): Record<string, unknown> {
  const { local_updated_at, server_updated_at, ...rest } = elem;
  return rest;
}

// NOTE on clearing fields: `null` is the correct sentinel for "this field has
// been cleared." `undefined` gets silently dropped by JSON.stringify (at disk
// AND at the wire), so the PATCH body omits the field and the server keeps
// its old value. UI code paths that mean "clear this field" must pass null
// (relations, numbers) or '' (text), never undefined. See
// sync-engine.fieldClear.test.ts for the rule and DESIGN convention #21.

/**
 * Strip fields that are server-managed (updated_at) before writing to folder.
 * The server's authoritative timestamp gets stamped separately via
 * applyServerRecord / stampServerUpdatedAt.
 */
function stripServerOnlyFields(record: Record<string, unknown>): Record<string, unknown> {
  // keel's stub is compared and written in its own shape, its unset fields left out (conv. 155, I1).
  const { updated_at, ...rest } = isKnownOf(record) ? stubShape(record) : record;
  return rest;
}

/**
 * Names of fields that differ between a local element and a remote record.
 * Used for conflict reporting. Ignores sync-internal fields.
 *
 * Uses an order-independent deep-equal so that semantically equal objects with
 * different key order don't show up as diverged (the API doesn't guarantee key
 * ordering, and JSON.stringify is order-sensitive).
 */
/** Same content on the wire's terms: server stamps and atlas's local-only fields do not count. */
/** What keel's answer leaves in the copy with the stamp: a create's proposed mark (conv. 168) and keel's word on the hidden mark (conv. 170). */
function keptFrom(answer: unknown, onCreate: boolean): Record<string, unknown> | undefined {
  const kept = { ...(onCreate ? keptOnCreate(answer) : undefined), ...hiddenKeptOf(answer) };
  return Object.keys(kept).length > 0 ? kept : undefined;
}

function sameWireContent(local: Element, remote: Record<string, unknown>): boolean {
  // Who wrote it never reaches here: diffFieldNames skips SERVER_AUTHOR_FIELDS.
  const ignore = new Set<string>(['created_at', 'change_seq', 'world', ...ATLAS_LOCAL_ONLY_FIELDS]);
  return !diffFieldNames(local, remote).some(k => !ignore.has(k));
}

export function diffFieldNames(local: Element, remote: Record<string, unknown>): string[] {
  // Who wrote it (created_by, changed_by, changed_via) is server-authored and
  // read-only: a local file that never saw a pull lacks it, and every server
  // write moves the last two, which is not a difference anyone made. keel's
  // hidden mark is said to some readers only: not a difference either.
  const SKIP = new Set<string>(['id', 'type', 'local_updated_at', 'server_updated_at', 'updated_at', HIDDEN_SHOWN_ONLINE, ...SERVER_AUTHOR_FIELDS, ...SERVER_MARK_FIELDS]);
  const keys = new Set<string>([...Object.keys(local), ...Object.keys(remote)]);
  const diff: string[] = [];
  for (const key of keys) {
    if (SKIP.has(key)) continue;
    if (!deepEqual((local as Record<string, unknown>)[key], remote[key])) {
      diff.push(key);
    }
  }
  return diff;
}

/**
 * Deep, order-independent value equality for diff comparison.
 * Handles primitives, arrays (positionally), and plain objects (key-set sensitive,
 * key-order insensitive). NaN compares unequal (matches `===` semantics).
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const aRec = a as Record<string, unknown>;
  const bRec = b as Record<string, unknown>;
  const aKeys = Object.keys(aRec);
  const bKeys = Object.keys(bRec);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!(k in bRec)) return false;
    if (!deepEqual(aRec[k], bRec[k])) return false;
  }
  return true;
}

/** A round's role and kept news (conv. 151), carried from its push and pull phases into the round's result; the latest phase's role wins. */
function keptFields(...parts: SyncResult[]): Pick<SyncResult, 'own_role' | 'kept' | 'kept_edit_ids' | 'proposed_ids' | 'delete_refused' | 'proposals_accepted' | 'hidden_held_ids' | 'hidden_shown_ids'> {
  const role = parts.map(p => p.own_role).filter(r => r !== undefined).pop();
  const kept = parts.reduce((n, p) => n + (p.kept ?? 0), 0);
  const edits = [...new Set(parts.flatMap(p => p.kept_edit_ids ?? []))];
  // The round's proposal news rides the same way (conv. 163).
  const proposed = [...new Set(parts.flatMap(p => p.proposed_ids ?? []))];
  const refused = parts.flatMap(p => p.delete_refused ?? []);
  const accepted = [...new Set(parts.flatMap(p => p.proposals_accepted ?? []))];
  const hiddenHeld = [...new Set(parts.flatMap(p => p.hidden_held_ids ?? []))];
  const hiddenShown = [...new Set(parts.flatMap(p => p.hidden_shown_ids ?? []))];
  return {
    ...(role !== undefined ? { own_role: role } : {}),
    ...(kept > 0 ? { kept } : {}),
    ...(edits.length > 0 ? { kept_edit_ids: edits } : {}),
    ...(proposed.length > 0 ? { proposed_ids: proposed } : {}),
    ...(refused.length > 0 ? { delete_refused: refused } : {}),
    ...(accepted.length > 0 ? { proposals_accepted: accepted } : {}),
    ...(hiddenHeld.length > 0 ? { hidden_held_ids: hiddenHeld } : {}),
    ...(hiddenShown.length > 0 ? { hidden_shown_ids: hiddenShown } : {}),
  };
}

function zero(): { creates: number; updates: number; deletes: number } {
  return { creates: 0, updates: 0, deletes: 0 };
}

function emptyResult(): SyncResult {
  return { pushed: zero(), pulled: zero(), conflicts: [], failures: [] };
}

/**
 * Duck-typed view of the v2 adapter's typed error (OwV2Error). Checked
 * structurally so the engine stays decoupled from the adapter module and
 * so errors that crossed a module boundary still qualify.
 */
function typedError(err: unknown): { status: number; code: string; param: string | null; message: string } | null {
  if (!(err instanceof Error)) return null;
  const e = err as Error & { status?: unknown; code?: unknown; param?: unknown };
  if (typeof e.status !== 'number' || typeof e.code !== 'string') return null;
  return { status: e.status, code: e.code, param: typeof e.param === 'string' ? e.param : null, message: e.message };
}

/**
 * keel's 409 `resync_required` on /changes (core/changes.py): a guest's cursor
 * from before its view moved. The answer is a fresh walk from 0.
 */
export function isResyncRequired(err: unknown): boolean {
  const t = typedError(err);
  return !!t && t.status === 409 && t.code === 'resync_required';
}

/** A role keel can hide an element from (one-rule §1: every reader but the owner, the co-builders and its creator). */
function hiddenCanBeDenied(role: string | null): boolean {
  return role === 'contributor' || role === 'guest';
}

/** The ids whose links stay in the copy and never go out: kept (conv. 151), left the view (`left_view`), and held hidden (conv. 170). */
function linkHeld(s: { kept_outside_view?: string[]; left_view?: string[]; hidden_held?: string[] }): Set<string> {
  return new Set([...(s.kept_outside_view ?? []), ...(s.left_view ?? []), ...(s.hidden_held ?? [])]);
}

/** keel's refusal to make an element hidden for this key (403 `hidden_not_allowed`, keel #587; conv. 170). */
export function isHiddenRefusal(err: unknown): boolean {
  const t = typedError(err);
  return !!t && t.status === 403 && t.code === 'hidden_not_allowed';
}

/** The hidden elements a round held (the anchored ones ride along unsaid), for the line said once (conv. 170). */
function hiddenHeldReport(changed: readonly Element[], held: ReadonlySet<string>, refused: readonly string[]): Pick<SyncResult, 'hidden_held_ids'> {
  const ids = [...new Set([...changed.filter(e => held.has(e.id) && isHiddenMark(e)).map(e => e.id), ...refused])];
  return ids.length > 0 ? { hidden_held_ids: ids } : {};
}

/**
 * Why keel moved this reader (one-rule §3, Skeld 2026-10-20): `view` (a delete,
 * a hide, a Character change: drop what the walk no longer names) or `role`
 * (a role or roster move: keep). Null when keel did not say; any other value
 * reads as `role`, Titus's side of the error (conv. 151).
 */
export function resyncReason(err: unknown): 'role' | 'view' | null {
  const r = (err as { reason?: unknown } | null)?.reason;
  if (typeof r !== 'string') return null;
  return r === 'view' ? 'view' : 'role';
}

/**
 * keel's two member refusals (403, #104): `not_author` (a contributor or guest
 * changed, relinked or deleted an element someone else made) and `owner_only`
 * (a member, even a co-builder, changed the world's own settings). Null for
 * anything else.
 */
export function memberRefusal(err: unknown): 'not_author' | 'owner_only' | null {
  const t = typedError(err);
  if (!t || t.status !== 403) return null;
  return t.code === 'not_author' || t.code === 'owner_only' ? t.code : null;
}

/**
 * Detect a 404 / "not found" server response from an arbitrary thrown error.
 * Typed check first (v2 envelope: status 404 / code "not_found"), then the
 * legacy substring fallback so string-throwing fakes keep working during the
 * dialect transition.
 */
function isNotFoundError(err: unknown): boolean {
  const t = typedError(err);
  if (t) return t.status === 404 || t.code === 'not_found';
  if (!(err instanceof Error)) return false;
  return /api error 404/i.test(err.message) || /\b404\b/.test(err.message) || /not found/i.test(err.message);
}

/**
 * Detect an authentication failure. Vectors:
 *   1. PIN changed on the server but atlas still has the old PIN in registry
 *      (v2: 401 code "invalid_credentials").
 *   2. api_key was revoked (v2: distinct code "key_revoked" — keel T6).
 *   3. The world was deleted server-side — its api_key goes dead; all CRUD 401.
 *
 * Explicitly NOT auth: "rate_limited" / HTTP 429 — that's transient back-off
 * territory, and pausing the engine over it would strand pending writes
 * behind a wall that clears by itself. Typed check first; legacy substring
 * fallback second (with a rate-limit exclusion so a message mentioning 429
 * never lands here).
 *
 * When this fires from inside a push or pull, the engine bails the round
 * early (no point retrying every element with the same dead key) and
 * transitions to `error` state. See `setAuthError`.
 */
export function isAuthError(err: unknown): boolean {
  const t = typedError(err);
  if (t) {
    if (t.code === 'rate_limited' || t.status === 429) return false;
    // A member's refusal is about one element or the world's settings, not
    // the key (#104): a contributor seat changing someone else's element, any
    // seat changing the world's details. The round goes on without it.
    if (memberRefusal(err)) return false;
    // keel would not make one element hidden for this key (conv. 170): about the element, not the key.
    if (t.code === 'hidden_not_allowed') return false;
    return t.status === 401 || t.status === 403
      || t.code === 'invalid_credentials' || t.code === 'key_revoked';
  }
  if (!(err instanceof Error)) return false;
  return /api error 401/i.test(err.message)
    || /api error 403/i.test(err.message)
    || /\b401\b/.test(err.message)
    || /\b403\b/.test(err.message)
    || /unauthor/i.test(err.message)
    || /forbidden/i.test(err.message);
}

/**
 * Parse a keel v2 dangling-reference failure (HTTP 400, code "invalid_link"):
 *
 *   { error: { code: "invalid_link", param: "<field>",
 *     message: "<field> references <Type> '<id>' which does not exist." } }
 *
 * The /bulk non-atomic variant appends " in this world." — the regex is
 * suffix-tolerant. The DANGLING ID comes from the message itself,
 * never from a body lookup (multi-link fields would need array disambiguation
 * and the wire/disk field names can differ on spatial types).
 *
 * Atlas hits this when an element references a peer (zone, map, friend, etc.)
 * that existed server-side at some prior point (so locally has
 * `server_updated_at`) but was deleted out-of-band (web app, admin, another
 * atlas). The caller routes that peer to server_deletes review so the user
 * can pick `keep + re-push` (clears baseline, re-CREATEs the peer next round)
 * or `delete locally` (removes the orphan).
 *
 * Applies to CREATE, UPDATE, and /bulk item errors alike — keel enforces
 * links honestly on every write (v1 silently dropped dangling multi-links,
 * which is why the old routing was CREATE-only).
 */
export function parseInvalidLinkError(
  err: unknown,
): { field: string; refType: string; refId: string } | null {
  const t = typedError(err);
  const code = t?.code;
  const message = t?.message ?? (err instanceof Error ? err.message : null); // raw-error-ok: parsed for the dangling id, never shown
  if (!message) return null;
  // Typed path requires the code; legacy fallback requires the exact message
  // shape (fakes throwing plain Errors during the transition).
  if (t && code !== 'invalid_link') return null;
  const m = message.match(/(\S+) references (\w+) '([0-9a-fA-F-]{36})' which does not exist/);
  if (!m) return null;
  return { field: t?.param ?? m[1], refType: m[2].toLowerCase(), refId: m[3] };
}

/**
 * Detect a duplicate-id CREATE rejection (keel 409 `id_conflict`). The classic
 * vector: a /bulk landed server-side but its timestamp backfill failed, so the
 * local baseline stayed unstamped and the next round re-CREATEs an element the
 * server already has. Without special handling this loops forever
 * (2026-07-12); with it, the engine adopts the server's timestamp as
 * baseline and the element self-heals (pending local edits flow as UPDATE on
 * the following round).
 */
/**
 * Split bulk survivors into those that can be retried and those that link,
 * directly or through another held-back survivor, to an id the server refused.
 * Link detection scans top-level string and string-array values, the shape
 * every atlas link field takes. Pure.
 */
export function splitByRefusedLinks(
  survivors: Element[],
  refusedIds: ReadonlySet<string>,
): { ready: Element[]; blocked: Element[] } {
  const bad = new Set(refusedIds);
  const blocked = new Set<string>();
  // Wire fields only: a page's `atlas_page_refs` or a
  // narrative's dismissed suggestions never reach keel, so an id there cannot
  // get the element refused, and holding it back on that basis stopped the
  // element's real edits from uploading for as long as the other stayed refused.
  const refersToBad = (el: Element): boolean => Object.entries(el).some(([k, v]) =>
    !NOT_ON_THE_WIRE.has(k) && (typeof v === 'string' ? bad.has(v) : Array.isArray(v) && v.some(x => typeof x === 'string' && bad.has(x))));
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of survivors) {
      if (blocked.has(s.id) || !refersToBad(s)) continue;
      blocked.add(s.id);
      bad.add(s.id);
      changed = true;
    }
  }
  return {
    ready: survivors.filter(s => !blocked.has(s.id)),
    blocked: survivors.filter(s => blocked.has(s.id)),
  };
}

const NOT_ON_THE_WIRE = new Set<string>(['id', 'local_updated_at', 'server_updated_at', ...ATLAS_LOCAL_ONLY_FIELDS]);

const TRANSIENT_RETRY_DEFAULT_MS = 30_000;
/** The clean copies one push round hides at most (conv. 173): a backlog spreads over rounds, never a burst. */
const HIDE_SWEEP_CAP = 20;

/**
 * A server that is busy (503 `server_busy`), rate limiting (429, e.g. a PIN
 * lockout after ten wrong tries) or unreachable (fetch's network TypeError).
 * Not an auth failure: nothing is wrong with the key, and nothing pauses.
 */
export function isTransientError(err: unknown): boolean {
  const t = typedError(err);
  if (t) return t.status === 429 || t.status === 503 || t.code === 'server_busy' || t.code === 'rate_limited';
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) return true;
  if (!(err instanceof Error)) return false;
  return /api error (429|503)/i.test(err.message);
}

function transientFields(err: unknown): Pick<SyncResult, 'transient_blocked' | 'transient_reason' | 'retry_after_ms'> {
  const t = typedError(err);
  const retry = (err as { retryAfterMs?: unknown }).retryAfterMs;
  const reason: SyncResult['transient_reason'] = !t ? 'offline'
    : (t.status === 429 || t.code === 'rate_limited') ? 'rate_limited' : 'busy';
  return {
    transient_blocked: true,
    transient_reason: reason,
    retry_after_ms: typeof retry === 'number' ? retry : TRANSIENT_RETRY_DEFAULT_MS,
  };
}

export function isIdConflictError(err: unknown): boolean {
  const t = typedError(err);
  // The CODE, not the status: keel's idempotency_error is
  // a 409 too.
  if (t) return t.code === 'id_conflict';
  if (!(err instanceof Error)) return false;
  return /api error 409/i.test(err.message) || /id_conflict/i.test(err.message);
}

/** Same parse applied to a /bulk per-item error object (not a thrown Error). */
export function parseInvalidLinkItem(
  item: { code: string; message: string; param: string | null },
): { field: string; refType: string; refId: string } | null {
  if (item.code !== 'invalid_link') return null;
  const m = item.message.match(/(\S+) references (\w+) '([0-9a-fA-F-]{36})' which does not exist/);
  if (!m) return null;
  return { field: item.param ?? m[1], refType: m[2].toLowerCase(), refId: m[3] };
}
