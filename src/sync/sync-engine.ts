/**
 * SyncEngine — reconciles a folder-backed world with the OnlyWorlds API.
 *
 * One engine per api-linked world. Reads `local_updated_at` / `server_updated_at`
 * timestamps on each element to compute the diff. No pending-ops queue: the
 * timestamps + tombstone log fully describe what's pending.
 */

import type { FolderStore } from '../store/folder-store';
import { nowIso } from '../store/folder-store';
import {
  ALL_ELEMENT_TYPES,
} from '../core/types';
import type {
  Conflict,
  Element,
  ElementType,
  PerElementFailure,
  SyncEngineState,
  SyncResult,
} from '../core/types';

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
    error?: { code: string; message: string; param: string | null };
  }>;
}

/** One page of the /changes feed (ops in commit order, adapted to disk shape). */
export interface ChangesPage {
  cursor: string | null;
  hasMore: boolean;
  changes: Array<
    | { op: 'upsert'; type: ElementType; id: string; changeSeq: number; updatedAt: string; element: { id: string; updated_at: string } & Record<string, unknown> }
    | { op: 'delete'; type: ElementType; id: string; changeSeq: number; deletedAt: string }
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
  listElements(type: ElementType): Promise<Array<{ id: string; updated_at: string } & Record<string, unknown>>>;
  /** Fetch single element. Used by SyncEngine pre-update conflict check. */
  getElement(type: ElementType, id: string): Promise<({ id: string; updated_at: string } & Record<string, unknown>) | null>;
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
  /**
   * Optional: report which element types' most recent listElements() walk may
   * be INCOMPLETE (cursor walk aborted / capped / not advancing). The engine
   * suppresses server-delete detection for those types — an incomplete
   * seenLocalIds would falsely flag unfetched elements as "vanished from
   * server" and prompt a destructive local delete (gate 10.5: this backstop
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
  /**
   * Fires when push CREATE produces a server-assigned id different from the
   * local one (id-swap). UI uses this to migrate `state.ui.selectedElementId`
   * and the URL hash when the swap affects the currently-viewed element —
   * without it, the user sees a confusing "element <old-id> not found in this
   * world" empty state because the URL still references the pre-swap id.
   */
  onIdSwap?: (swap: { old_id: string; new_id: string; type: ElementType }) => void;
}

// ---- The engine ----

export class SyncEngine {
  private folder: FolderStore;
  private client: OwApiClient;
  private policy: CanonicalPolicy;
  private onConflict: (conflict: Conflict) => void;
  private onStateChange: (state: SyncEngineState) => void;
  private onPushProgress: (done: number, total: number) => void;
  private onSyncResult: (phase: 'push' | 'pull' | 'sync', result: SyncResult) => void;
  private onIdSwap: (swap: { old_id: string; new_id: string; type: ElementType }) => void;
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
   * from milliseconds to whole seconds (gate finding, 2026-07-12).
   */
  private inFlightKind: 'push' | 'pull' | 'sync' | null = null;
  /**
   * Set by stop() (detach/unlink). An in-flight pull round checks this before
   * every local write AND before its terminal sync-state persist — without
   * the check, a walk that outlives detachSyncEngine re-stamps baselines that
   * resetSyncBaseline just cleared and resurrects the cleared changes_cursor,
   * which a later re-link to a DIFFERENT world would inherit (silently
   * skipping that world's history below the stale watermark). Gate finding,
   * 2026-07-12. Engines are never restarted after stop() — a fresh engine is
   * built per attach — so this latch never needs resetting.
   */
  private stopped = false;
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
    this.policy = normalizePolicy(opts.policy);
    this.onConflict = opts.onConflict ?? (() => {});
    this.onStateChange = opts.onStateChange ?? (() => {});
    this.onPushProgress = opts.onPushProgress ?? (() => {});
    this.onSyncResult = opts.onSyncResult ?? (() => {});
    this.onIdSwap = opts.onIdSwap ?? (() => {});
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

  pause(reason: 'manual' | 'network' = 'manual'): void {
    this.paused = true;
    this.pauseReason = reason;
    this.setState({ kind: 'paused', reason, pending_changes: 0 });
  }

  resume(): void {
    this.paused = false;
    this.pauseReason = null;
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
  private setAuthError(): void {
    this.paused = true;
    this.pauseReason = 'manual';
    this.setState({
      kind: 'error',
      message: 'authentication failed. Verify pin in settings, test connection, or unlink',
      recoverable: true,
    });
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
    if (this.paused) {
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
          if (!this.paused) this.requestPush();
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
   * Same lost-trigger guard as `requestPush` (close-gate finding): when a
   * PULL is in flight, a bare pushOnce() would return the pull's promise via
   * the shared inFlight lock and the user's explicit "push now" would
   * silently do nothing — chain the push behind the pull instead.
   */
  flushPendingPush(): Promise<SyncResult> | null {
    if (this.paused) return null;
    if (!this.debouncePushTimer) return null;
    clearTimeout(this.debouncePushTimer);
    this.debouncePushTimer = null;
    this.setPendingPush(null);
    if (this.inFlight && this.inFlightKind === 'pull') {
      console.info('[atlas:sync] flush-pending-push during in-flight pull — chaining push behind it');
      const chained = this.inFlight.then(() => {
        if (this.paused) return emptyResult();
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
    console.info(`[atlas:sync] resolveConflict ${action} ${id}`);
    const syncState = await this.folder.readSyncState();
    const conflict = syncState.conflicts.find(c => c.element_id === id);
    if (!conflict) {
      console.info(`[atlas:sync] resolveConflict: no conflict entry for ${id} — already cleared`);
      return;
    }

    if (action === 'overwrite-mine') {
      const local = await this.folder.getElement(id);
      if (!local) throw new Error(`element ${id} not found locally`);
      const body = stripSyncFields(local);
      console.info(`[atlas:sync] resolveConflict overwrite-mine: pushing local to server`, {
        id, type: local.type, hasServerBaseline: !!local.server_updated_at,
      });
      try {
        const response = local.server_updated_at
          ? await this.client.updateElement(local.type, id, body)
          : await this.client.createElement(local.type, body);
        await this.folder.stampServerUpdatedAt(id, local.type, response.updated_at);
        console.info(`[atlas:sync] resolveConflict overwrite-mine: stamped baseline ${response.updated_at}`);
      } catch (err) {
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
      const remote = await this.client.getElement(conflict.type, id);
      if (!remote) throw new Error(`element ${id} not found on server (already deleted?)`);
      const { updated_at, ...body } = remote;
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
   * Push local changes to server, then pull remote changes to folder.
   * Pull skips elements push already conflicted on (dedup by id).
   *
   * Concurrent calls share the in-flight promise rather than racing.
   */
  syncNow(): Promise<SyncResult> {
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
    if (this.paused) return emptyResult();
    this.setState({ kind: 'syncing', phase: 'push' });
    const pushResult = await this.pushPhase();
    // Only persist under pause-and-review. Under local-wins, conflicts are
    // informational (server already overwritten) — persisting would falsely
    // fire the badge for resolved divergence.
    if (this.policy === 'pause-and-review') {
      await this.persistConflicts(pushResult.conflicts);
    }
    if (pushResult.auth_blocked) {
      this.setAuthError();
    } else {
      this.setState({ kind: 'idle', last_sync_at: nowIso() });
    }
    const result: SyncResult = {
      pushed: pushResult.pushed,
      pulled: zero(),
      conflicts: pushResult.conflicts,
      failures: pushResult.failures,
      auth_blocked: pushResult.auth_blocked,
    };
    this.onSyncResult('push', result);
    return result;
  }

  private async runPullOnly(): Promise<SyncResult> {
    if (this.paused) return emptyResult();
    this.setState({ kind: 'syncing', phase: 'pull' });
    let pullResult: SyncResult;
    try {
      pullResult = await this.pullPhase();
    } catch (err) {
      // Non-auth pull failures (network, 5xx) propagate to caller for toast
      // surfacing — but we MUST restore idle state first or the pill stays
      // stuck at 'fetching...' forever.
      this.setState({ kind: 'idle', last_sync_at: null });
      throw err;
    }
    if (pullResult.auth_blocked) {
      this.setAuthError();
    } else {
      this.setState({ kind: 'idle', last_sync_at: nowIso() });
    }
    const result: SyncResult = {
      pushed: zero(),
      pulled: pullResult.pulled,
      conflicts: pullResult.conflicts,
      failures: pullResult.failures,
      pulled_ids: pullResult.pulled_ids,
      auth_blocked: pullResult.auth_blocked,
    };
    this.onSyncResult('pull', result);
    return result;
  }

  private async runSync(): Promise<SyncResult> {
    if (this.paused) {
      return emptyResult();
    }
    this.setState({ kind: 'syncing', phase: 'push' });
    const pushResult = await this.pushPhase();
    // Persist push conflicts BEFORE pull phase (so pull's currentState read
    // sees them when computing the union). Under local-wins, skip — server
    // is already in our state, the entries would be misleading.
    if (this.policy === 'pause-and-review') {
      await this.persistConflicts(pushResult.conflicts);
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
      this.setState({ kind: 'idle', last_sync_at: null });
      throw err;
    }
    const result: SyncResult = {
      pushed: pushResult.pushed,
      pulled: pullResult.pulled,
      conflicts: [...pushResult.conflicts, ...pullResult.conflicts],
      failures: [...pushResult.failures, ...pullResult.failures],
      pulled_ids: pullResult.pulled_ids,
      auth_blocked: pushResult.auth_blocked || pullResult.auth_blocked,
    };
    if (pullResult.auth_blocked) {
      this.setAuthError();
    } else {
      this.setState({ kind: 'idle', last_sync_at: nowIso() });
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
   * Schema-agnostic — doesn't need FIELD_SCHEMA — matches the same approach
   * `rewriteIdReferences` uses.
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

  /**
   * Rewrite a single id reference across every local element. Used when the
   * server assigns its own id on CREATE — any local element that referenced
   * the old client-side id must be updated to point at the server's id.
   *
   * Walks every string + string-array field (skipping schema-irrelevant fields
   * like name/timestamps). Updates elements via folder.updateElement so the
   * change is durable and they'll be picked up on the next push pass.
   */
  private async rewriteIdReferences(oldId: string, newId: string): Promise<void> {
    const SKIP = new Set(['id', 'type', 'name', 'local_updated_at', 'server_updated_at']);
    const all = await this.folder.listElements();
    for (const el of all) {
      let modified = false;
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(el)) {
        if (SKIP.has(key)) continue;
        if (typeof value === 'string' && value === oldId) {
          patch[key] = newId;
          modified = true;
        } else if (Array.isArray(value)) {
          let changed = false;
          const newArr = value.map(v => {
            if (typeof v === 'string' && v === oldId) {
              changed = true;
              return newId;
            }
            return v;
          });
          if (changed) { patch[key] = newArr; modified = true; }
        }
      }
      if (modified) {
        await this.folder.updateElement(el.id, patch);
        console.info(`[atlas:sync] rewrote id reference ${oldId} → ${newId} in ${el.type}/${el.id}`);
      }
    }
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
    const peer = await this.folder.getElement(parsed.refId);
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
   * Failure protocol (gate 10.6, verified live: atomic rollback is real):
   *   - `errors: true` under atomic → NOTHING persisted server-side, even for
   *     items reporting 201 ("would have succeeded"). Stamp NOTHING.
   *   - Failed items → per-element failures (+ dangling-peer routing for
   *     invalid_link items); surviving items retried ONCE atomically.
   *   - A thrown auth error bails the round like everywhere else.
   *
   * Timestamp backfill (gate 10.1): /bulk items return `{status, id}` with no
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
    isRetry = false
  ): Promise<{ created: number; authBlocked: boolean }> {
    // Re-fetch each candidate from disk (freshness) + pin element_type
    // self-heal, mirroring the per-element loop's pre-send discipline.
    const items: BulkItem[] = [];
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
      items.push({ type: current.type, element: stripSyncFields(current) });
    }
    if (items.length === 0 || this.stopped) return { created: 0, authBlocked: false };

    console.info(`[atlas:sync] bulk CREATE ${items.length} element(s)${isRetry ? ' (retry)' : ''}`);
    let result: BulkResult;
    try {
      result = await this.client.bulkCreate!(items, {
        atomic: true,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (err) {
      const auth = isAuthError(err);
      const message = err instanceof Error ? err.message : String(err);
      for (const it of items) {
        failures.push({
          element_id: it.element.id as string,
          type: it.type,
          operation: 'create',
          message,
        });
        onItemDone();
      }
      if (auth) {
        console.warn('[atlas:sync] bulk CREATE hit auth error — bailing round', { message });
      } else {
        console.warn('[atlas:sync] bulk CREATE request failed', { message });
      }
      return { created: 0, authBlocked: auth };
    }

    if (!result.errors) {
      // Everything landed. Backfill authoritative server timestamps.
      const stamped = await this.backfillBulkTimestamps(items, failures);
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
        if (remote) {
          await this.folder.stampServerUpdatedAt(id, item.type, remote.updated_at);
          console.info('[atlas:sync] bulk item id_conflict — element already on server; baseline adopted', {
            id, type: item.type,
          });
          onItemDone();
          continue;
        }
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

    console.info(`[atlas:sync] bulk CREATE retrying ${survivors.length} survivor(s) after atomic rollback`);
    return this.bulkCreatePhase(survivors, failures, serverDeletesDetected, onItemDone, /* isRetry */ true);
  }

  /**
   * Post-bulk timestamp backfill: fetch the server's authoritative
   * `updated_at` for every created element and stamp the local baseline.
   * ≤20 elements → per-element GET; larger → one list walk per pushed type.
   * Returns the count successfully stamped; misses become failures (they'll
   * re-push next round — CREATE turns into 409/id_conflict territory, which
   * surfaces loudly rather than silently corrupting baselines).
   */
  private async backfillBulkTimestamps(
    items: BulkItem[],
    failures: PerElementFailure[]
  ): Promise<number> {
    let stamped = 0;
    if (items.length <= 20) {
      for (const it of items) {
        if (this.stopped) break; // detach/unlink — never stamp past a reset
        const id = it.element.id as string;
        try {
          const remote = await this.client.getElement(it.type, id);
          if (!remote) throw new Error('created element missing on read-back');
          await this.folder.stampServerUpdatedAt(id, it.type, remote.updated_at);
          stamped++;
        } catch (err) {
          failures.push({
            element_id: id, type: it.type, operation: 'create',
            message: `created but baseline backfill failed: ${err instanceof Error ? err.message : String(err)}`,
          });
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
      let remoteById = new Map<string, string>();
      try {
        const listed = await this.client.listElements(type);
        remoteById = new Map(listed.map(r => [r.id, r.updated_at]));
      } catch (err) {
        console.warn(`[atlas:sync] bulk backfill list walk failed for ${type}:`, err);
      }
      for (const it of group) {
        if (this.stopped) break; // detach/unlink — never stamp past a reset
        const id = it.element.id as string;
        const ts = remoteById.get(id);
        if (ts) {
          await this.folder.stampServerUpdatedAt(id, type, ts);
          stamped++;
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
    const allCreates = allChanged.filter(e => !e.server_updated_at);
    const updatesOnly = allChanged.filter(e => !!e.server_updated_at);
    const useBulk = typeof this.client.bulkCreate === 'function' && allCreates.length >= 2;
    const changed = useBulk
      ? updatesOnly
      : [...this.sortCreatesByDependencies(allCreates), ...updatesOnly];
    const total = allChanged.length + tombstones.length;
    let done = 0;

    let creates = 0;
    let updates = 0;
    let deletes = 0;
    const conflicts: Conflict[] = [];
    const failures: PerElementFailure[] = [];
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

    if (useBulk) {
      const bulk = await this.bulkCreatePhase(allCreates, failures, serverDeletesDetected, () => {
        done++;
        this.onPushProgress(done, total);
      });
      creates += bulk.created;
      if (bulk.authBlocked) authBlocked = true;
    }

    for (const elem of changed) {
      // `stopped` (detach/unlink) aborts the push loop like the pull walk —
      // a stampServerUpdatedAt landing after resetSyncBaseline would
      // resurrect a baseline the unlink just cleared (close-gate finding:
      // the G-C latch was pull-only).
      if (authBlocked || this.stopped) break;
      const isCreate = !elem.server_updated_at;
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
          // didn't set it before session 202). Real OW returns 400 with
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
          const body = stripSyncFields(current);
          const response = await this.client.createElement(current.type, body);
          if (response.id !== current.id) {
            console.info(`[atlas:sync] server assigned new id on create`, {
              type: current.type, localId: current.id, serverId: response.id,
            });
            // Write local file at the server's id (current content + stamped).
            const swapped = {
              ...stripSyncFields(current),
              id: response.id,
            };
            await this.folder.applyServerRecord(current.type, swapped, response.updated_at);
            // Remove old local file silently — there's no server counterpart
            // at the old id, so no DELETE should propagate.
            await this.folder.deleteElement(current.id, { silent: true });
            // Rewrite refs to old id across all local elements.
            await this.rewriteIdReferences(current.id, response.id);
            // Notify the UI so it can migrate selectedElementId / URL hash if
            // the swap affects the currently-viewed element. Without this,
            // the user sees a confusing "element <old-id> not found in this
            // world" empty state because the URL still references the pre-
            // swap id.
            this.onIdSwap({ old_id: current.id, new_id: response.id, type: current.type });
          } else {
            await this.folder.stampServerUpdatedAt(current.id, current.type, response.updated_at);
          }
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
            // or delete-locally.
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
            const body = stripSyncFields(current);
            const response = await this.client.updateElement(current.type, current.id, body);
            await this.folder.stampServerUpdatedAt(current.id, current.type, response.updated_at);
            updates++;
          }
        }
      } catch (err) {
        // Auth failure (401/403): bail the round. Every subsequent element
        // would 401 with the same dead credentials; no point hammering the
        // server. Record the element as failed so the user knows the round
        // produced no progress; caller (runPushOnly/runSync) transitions
        // engine state to `error` based on the auth_blocked flag.
        if (isAuthError(err)) {
          authBlocked = true;
          failures.push({
            element_id: elem.id,
            type: elem.type,
            operation: isCreate ? 'create' : 'update',
            message: err instanceof Error ? err.message : String(err),
          });
          console.warn('[atlas:sync] push hit auth error — bailing round', {
            id: elem.id, type: elem.type, message: err instanceof Error ? err.message : String(err),
          });
        }
        // 404 on a non-CREATE means the server lost the element between our
        // pre-GET (which succeeded) and our PATCH. Race or out-of-band delete.
        // Route to server_deletes — same UX as the inline detection above.
        // Don't add to failures (would surface as a raw error elsewhere).
        else if (!isCreate && isNotFoundError(err)) {
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
        // error message itself (gate 10.4) — no body lookup.
        else if (parseInvalidLinkError(err)) {
          const parsed = parseInvalidLinkError(err)!;
          const routedPeer = await this.routeDanglingPeer(parsed, elem, serverDeletesDetected);
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
          const remote = await this.client.getElement(elem.type, elem.id);
          if (remote) {
            await this.folder.stampServerUpdatedAt(elem.id, elem.type, remote.updated_at);
            console.info('[atlas:sync] CREATE 409 id_conflict — element already on server; baseline adopted', {
              id: elem.id, type: elem.type,
            });
          } else {
            failures.push({
              element_id: elem.id, type: elem.type, operation: 'create',
              message: 'server reported id_conflict but the element could not be read back',
            });
          }
        } else {
          // Per-element failure (4xx, validation, transient network) is non-fatal:
          // record and continue. Caller inspects result.failures to decide what
          // to surface. This matters most for Make-Online flows uploading dozens
          // of elements — one bad element shouldn't abort the rest.
          failures.push({
            element_id: elem.id,
            type: elem.type,
            operation: isCreate ? 'create' : 'update',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        done++;
        this.onPushProgress(done, total);
      }
    }

    for (const tomb of tombstones) {
      if (authBlocked || this.stopped) break;
      try {
        await this.client.deleteElement(tomb.type, tomb.id);
        await this.folder.clearTombstone(tomb.id);
        deletes++;
      } catch (err) {
        // Auth failure here behaves identically to the elements loop: bail.
        if (isAuthError(err)) {
          authBlocked = true;
          failures.push({
            element_id: tomb.id,
            type: tomb.type,
            operation: 'delete',
            message: err instanceof Error ? err.message : String(err),
          });
          console.warn('[atlas:sync] push (tombstone) hit auth error — bailing round', {
            id: tomb.id, type: tomb.type,
          });
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
          await this.folder.clearTombstone(tomb.id);
          deletes++;
        } else {
          failures.push({
            element_id: tomb.id,
            type: tomb.type,
            operation: 'delete',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        done++;
        this.onPushProgress(done, total);
      }
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
      await this.folder.updateSyncState(curr => {
        if (serverDeletesDetected.length === 0) return { last_push_at: nowIso() };
        const existing = curr.server_deletes ?? [];
        const existingIds = new Set(existing.map(d => d.id));
        const fresh = serverDeletesDetected.filter(d => !existingIds.has(d.id));
        return { last_push_at: nowIso(), server_deletes: [...existing, ...fresh] };
      });
    }
    return {
      pushed: { creates, updates, deletes },
      pulled: zero(),
      conflicts,
      failures,
      auth_blocked: authBlocked || undefined,
    };
  }

  /**
   * Pull dispatch: cursor-delta /changes walk when the client supports it
   * (v2), else the legacy full-list pull (fakes mid-migration, degraded
   * clients). Same SyncResult contract either way.
   */
  private async pullPhase(skipIds: Set<string> = new Set()): Promise<SyncResult> {
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
   * Gate-hardened (3-lens pass, 2026-07-12 — design + resolutions in
   * Notes/2026-07-12-v2-changes-pull-design.md):
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
    let walkComplete = false;

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
        return {
          ...(walkComplete ? { last_pull_at: nowIso() } : {}),
          changes_cursor: lastAppliedCursor,
          conflicts: persistedConflicts,
          server_deletes: [...existing, ...fresh],
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
            console.warn('[atlas:sync] changes walk hit auth error — bailing round', {
              message: err instanceof Error ? err.message : String(err),
            });
            break;
          }
          throw err;
        }

        for (const op of pageResult.changes) {
          if (this.stopped) break;
          if (!knownTypes.has(op.type)) {
            console.info(`[atlas:sync] changes: skipping op for unknown type "${op.type}"`);
            continue;
          }
          if (tombstoneIds.has(op.id)) continue; // pending local delete owns this id
          if (skipIds.has(op.id)) continue;      // push already conflicted on it

          if (op.op === 'upsert') {
            // The element demonstrably exists server-side — cancel any pending
            // delete-review entry (in-round now; persisted list at round end).
            revivedIds.add(op.id);
            const idx = newServerDeletes.findIndex(d => d.id === op.id);
            if (idx >= 0) newServerDeletes.splice(idx, 1);

            const remoteBody = stripServerOnlyFields(op.element);
            const serverStamp = op.element.updated_at;
            const local = await this.folder.getElement(op.id);
            if (!local) {
              await this.folder.applyServerRecord(op.type, remoteBody, serverStamp);
              creates++;
              pulledIds.push(op.id);
              console.info(`[atlas:sync] changes create ${op.type}/${op.id} (server: ${serverStamp})`);
              continue;
            }
            const baseline = local.server_updated_at ?? '';
            const serverChanged = serverStamp > baseline;
            const localChanged = local.local_updated_at > baseline;
            if (!serverChanged) continue; // own echo or stale replay — idempotent skip
            if (localChanged) {
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
            // M3 race guard: bail if the user edited during this round.
            const fresh = await this.folder.getElement(op.id);
            if (fresh && fresh.local_updated_at !== local.local_updated_at) {
              console.info(`[atlas:sync] changes skip ${op.type}/${op.id} — local edited during round`);
              continue;
            }
            if (this.stopped) break;
            await this.folder.applyServerRecord(op.type, remoteBody, serverStamp);
            updates++;
            pulledIds.push(op.id);
          } else {
            // delete op — explicit server-side deletion.
            const local = await this.folder.getElement(op.id);
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
        if (this.stopped) break;

        // Page fully applied — its cursor is now a safe resume point.
        const nextCursor = pageResult.cursor ?? null;
        if (pageResult.hasMore && (!nextCursor || nextCursor === cursor)) {
          console.warn('[atlas:sync] changes walk: hasMore with a non-advancing cursor — aborting as incomplete');
          break;
        }
        if (nextCursor) lastAppliedCursor = nextCursor;
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

    await persistRound();
    return { pushed: zero(), pulled: { creates, updates, deletes: 0 }, conflicts, failures: [], pulled_ids: pulledIds };
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
          console.warn('[atlas:sync] pull hit auth error — bailing round', {
            type, message: err instanceof Error ? err.message : String(err),
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
          await this.folder.applyServerRecord(type, remoteBody, remote.updated_at);
          creates++;
          pulledIds.push(remote.id);
          console.info(`[atlas:sync] pull create ${type}/${remote.id} (server: ${remote.updated_at})`);
          continue;
        }

        // Local has it. Decide based on timestamps.
        const localBaseline = local.server_updated_at ?? '';
        const localChanged = local.local_updated_at > localBaseline;
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
        const fresh = await this.folder.getElement(remote.id);
        if (fresh && fresh.local_updated_at !== local.local_updated_at) {
          console.info(`[atlas:sync] pull skip ${type}/${remote.id} — local edited during round, deferring to next sync`);
          continue;
        }
        await this.folder.applyServerRecord(type, remoteBody, remote.updated_at);
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
    // same conflict over and over (Captain caught this growing 1 → 2 → 3).
    // Computed inside the store's sync-state chain so a concurrent round's
    // entries survive this round's write.
    //
    // Skipped when the engine was stopped mid-round (detach/unlink): a
    // post-reset write would resurrect state resetSyncBaseline just cleared.
    if (this.stopped) {
      return { pushed: zero(), pulled: { creates, updates, deletes: 0 }, conflicts, failures: [], pulled_ids: pulledIds };
    }
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

    return { pushed: zero(), pulled: { creates, updates, deletes: 0 }, conflicts, failures: [], pulled_ids: pulledIds };
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
  const { updated_at, ...rest } = record;
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
function diffFieldNames(local: Element, remote: Record<string, unknown>): string[] {
  const SKIP = new Set(['id', 'type', 'local_updated_at', 'server_updated_at', 'updated_at']);
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
 * suffix-tolerant. Gate 10.4: the DANGLING ID comes from the message itself,
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
  const message = t?.message ?? (err instanceof Error ? err.message : null);
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
 * server already has. Without special handling this loops forever (gate
 * finding, 2026-07-12); with it, the engine adopts the server's timestamp as
 * baseline and the element self-heals (pending local edits flow as UPDATE on
 * the following round).
 */
export function isIdConflictError(err: unknown): boolean {
  const t = typedError(err);
  if (t) return t.status === 409 || t.code === 'id_conflict';
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
