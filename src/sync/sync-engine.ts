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

// ---- Adapter shape: the minimum we need from the OW SDK ----

/**
 * Subset of the OW SDK / client surface the engine needs.
 *
 * We don't import the SDK directly so tests can inject a thin client that
 * mirrors only the methods exercised. In production this is satisfied by a
 * thin adapter wrapping `OnlyWorldsClient`.
 */
export interface OwApiClient {
  createElement(type: ElementType, body: Record<string, unknown>): Promise<{ id: string; updated_at: string } & Record<string, unknown>>;
  updateElement(type: ElementType, id: string, body: Record<string, unknown>): Promise<{ id: string; updated_at: string } & Record<string, unknown>>;
  deleteElement(type: ElementType, id: string): Promise<void>;
  listElements(type: ElementType): Promise<Array<{ id: string; updated_at: string } & Record<string, unknown>>>;
  /** Fetch single element. Used by SyncEngine pre-update conflict check. */
  getElement(type: ElementType, id: string): Promise<({ id: string; updated_at: string } & Record<string, unknown>) | null>;
}

// ---- Policy ----

/**
 * What to do when push detects the server moved since our baseline.
 * - `drain-blind`: push our version anyway; server overwritten; conflict logged for info.
 * - `pause-on-conflict`: skip the push; local change preserved on disk; conflict logged;
 *   next sync will see the same conflict until the user resolves it manually
 *   (Phase 3.5: dedicated UI; today: log only).
 * - `ask`: alias for `pause-on-conflict` until Phase 3.5 ships the diff modal.
 */
export type ConflictPolicy = 'drain-blind' | 'pause-on-conflict' | 'ask';

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
}

// ---- The engine ----

export class SyncEngine {
  private folder: FolderStore;
  private client: OwApiClient;
  private policy: ConflictPolicy;
  private onConflict: (conflict: Conflict) => void;
  private onStateChange: (state: SyncEngineState) => void;
  private onPushProgress: (done: number, total: number) => void;
  private state: SyncEngineState = { kind: 'idle', last_sync_at: null };
  private paused = false;
  private pauseReason: 'manual' | 'network' | null = null;
  /** In-flight syncNow promise. Concurrent calls await the same result. */
  private inFlight: Promise<SyncResult> | null = null;
  /** Debounce timer for `requestPush()` autosave. Reset on each write. */
  private debouncePushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Debounce window for autosave pushes. ms. Configurable later. */
  private debouncePushMs = 5000;

  constructor(opts: SyncEngineOptions) {
    this.folder = opts.folder;
    this.client = opts.client;
    this.policy = opts.policy ?? 'drain-blind';
    this.onConflict = opts.onConflict ?? (() => {});
    this.onStateChange = opts.onStateChange ?? (() => {});
    this.onPushProgress = opts.onPushProgress ?? (() => {});
  }

  getState(): SyncEngineState {
    return this.state;
  }

  pause(reason: 'manual' | 'network' = 'manual'): void {
    this.paused = true;
    this.pauseReason = reason;
    this.setState({ kind: 'paused', reason, pending_changes: 0 });
  }

  resume(): void {
    this.paused = false;
    this.pauseReason = null;
    this.setState({ kind: 'idle', last_sync_at: null });
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
    if (this.paused) return;
    if (this.debouncePushTimer) clearTimeout(this.debouncePushTimer);
    this.debouncePushTimer = setTimeout(() => {
      this.debouncePushTimer = null;
      void this.pushOnce();
    }, this.debouncePushMs);
  }

  /** Test seam — override the debounce window. */
  setDebounceMs(ms: number): void {
    this.debouncePushMs = ms;
  }

  /** Stop the engine: cancel pending debounced push, pause. Used on detach. */
  stop(): void {
    if (this.debouncePushTimer) {
      clearTimeout(this.debouncePushTimer);
      this.debouncePushTimer = null;
    }
    this.paused = true;
    this.pauseReason = 'manual';
  }

  /**
   * Push local changes to server, then pull remote changes to folder.
   * Pull skips elements push already conflicted on (dedup by id).
   *
   * Concurrent calls share the in-flight promise rather than racing.
   */
  syncNow(): Promise<SyncResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runSync().finally(() => {
      this.inFlight = null;
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
    this.inFlight = this.runPushOnly().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runPushOnly(): Promise<SyncResult> {
    if (this.paused) return emptyResult();
    this.setState({ kind: 'syncing', phase: 'push' });
    const pushResult = await this.pushPhase();
    this.setState({ kind: 'idle', last_sync_at: nowIso() });
    return {
      pushed: pushResult.pushed,
      pulled: zero(),
      conflicts: pushResult.conflicts,
      failures: pushResult.failures,
    };
  }

  private async runSync(): Promise<SyncResult> {
    if (this.paused) {
      return emptyResult();
    }
    this.setState({ kind: 'syncing', phase: 'push' });
    const pushResult = await this.pushPhase();
    this.setState({ kind: 'syncing', phase: 'pull' });
    const handledIds = new Set(pushResult.conflicts.map(c => c.element_id));
    const pullResult = await this.pullPhase(handledIds);
    const result: SyncResult = {
      pushed: pushResult.pushed,
      pulled: pullResult.pulled,
      conflicts: [...pushResult.conflicts, ...pullResult.conflicts],
      failures: [...pushResult.failures, ...pullResult.failures],
    };
    this.setState({ kind: 'idle', last_sync_at: nowIso() });
    return result;
  }

  // ---- Phases ----

  private async pushPhase(): Promise<SyncResult> {
    const changed = await this.folder.listLocallyChangedSince(null);
    const tombstones = await this.folder.listTombstonesSince(null);
    const total = changed.length + tombstones.length;
    let done = 0;

    let creates = 0;
    let updates = 0;
    let deletes = 0;
    const conflicts: Conflict[] = [];
    const failures: PerElementFailure[] = [];

    for (const elem of changed) {
      const isCreate = !elem.server_updated_at;
      try {
        if (isCreate) {
          // Never synced before → CREATE on server.
          const body = stripSyncFields(elem);
          const response = await this.client.createElement(elem.type, body);
          await this.folder.stampServerUpdatedAt(elem.id, elem.type, response.updated_at);
          creates++;
        } else {
          // UPDATE path: pre-fetch server state to detect external changes since
          // our cached `server_updated_at` baseline.
          const remote = await this.client.getElement(elem.type, elem.id);
          const baseline = elem.server_updated_at!;
          const serverMoved = remote ? remote.updated_at > baseline : false;

          let skipPush = false;
          if (serverMoved && remote) {
            const conflict: Conflict = {
              element_id: elem.id,
              type: elem.type,
              detected_at: nowIso(),
              local_updated_at: elem.local_updated_at,
              server_updated_at: remote.updated_at,
              fields: diffFieldNames(elem, stripServerOnlyFields(remote)),
            };
            conflicts.push(conflict);
            this.onConflict(conflict);
            if (this.policy === 'pause-on-conflict' || this.policy === 'ask') {
              // Keep local change on disk; do NOT push. Baseline stays.
              skipPush = true;
            }
            // drain-blind: fall through and push our version anyway.
          }

          if (!skipPush) {
            const body = stripSyncFields(elem);
            const response = await this.client.updateElement(elem.type, elem.id, body);
            await this.folder.stampServerUpdatedAt(elem.id, elem.type, response.updated_at);
            updates++;
          }
        }
      } catch (err) {
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
      } finally {
        done++;
        this.onPushProgress(done, total);
      }
    }

    for (const tomb of tombstones) {
      try {
        await this.client.deleteElement(tomb.type, tomb.id);
        await this.folder.clearTombstone(tomb.id);
        deletes++;
      } catch (err) {
        failures.push({
          element_id: tomb.id,
          type: tomb.type,
          operation: 'delete',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        done++;
        this.onPushProgress(done, total);
      }
    }

    await this.folder.writeSyncState({ last_push_at: nowIso() });
    return { pushed: { creates, updates, deletes }, pulled: zero(), conflicts, failures };
  }

  private async pullPhase(skipIds: Set<string> = new Set()): Promise<SyncResult> {
    let creates = 0;
    let updates = 0;
    const conflicts: Conflict[] = [];

    const tombstones = await this.folder.listTombstonesSince(null);
    const tombstoneIds = new Set(tombstones.map(t => t.id));

    for (const type of ALL_ELEMENT_TYPES) {
      const serverElements = await this.client.listElements(type);

      for (const remote of serverElements) {
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
          continue;
        }

        // Local has it. Decide based on timestamps.
        const localBaseline = local.server_updated_at ?? '';
        const localChanged = local.local_updated_at > localBaseline;
        const serverChanged = remote.updated_at > localBaseline;

        if (!serverChanged) continue;

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
          // Don't overwrite local; preserve the user's change.
          continue;
        }

        // Server newer, local untouched → overwrite locally.
        await this.folder.applyServerRecord(type, remoteBody, remote.updated_at);
        updates++;
      }
    }

    const currentState = await this.folder.readSyncState();
    await this.folder.writeSyncState({
      last_pull_at: nowIso(),
      conflicts: [...currentState.conflicts, ...conflicts],
    });

    return { pushed: zero(), pulled: { creates, updates, deletes: 0 }, conflicts, failures: [] };
  }

  // ---- Internals ----

  private setState(state: SyncEngineState): void {
    this.state = state;
    this.onStateChange(state);
  }
}

// ---- Helpers ----

function stripSyncFields(elem: Element): Record<string, unknown> {
  const { local_updated_at, server_updated_at, ...rest } = elem;
  return rest;
}

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
