/**
 * SyncEngine — reconciles a folder-backed world with the OnlyWorlds API.
 *
 * One engine per api-linked world. Reads `local_updated_at` / `server_updated_at`
 * timestamps on each element to compute the diff. No pending-ops queue: the
 * timestamps + tombstone log fully describe what's pending.
 */

import type { FolderStore } from '../store/folder-store';
import { nowIso } from '../store/folder-store';
import type {
  Conflict,
  Element,
  ElementType,
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
}

// ---- Policy ----

export type ConflictPolicy = 'drain-blind' | 'server-wins' | 'ask';

export interface SyncEngineOptions {
  folder: FolderStore;
  client: OwApiClient;
  policy?: ConflictPolicy;
  /** Called when a conflict is detected. */
  onConflict?: (conflict: Conflict) => void;
  /** Called whenever engine state changes (for UI). */
  onStateChange?: (state: SyncEngineState) => void;
}

// ---- The engine ----

export class SyncEngine {
  private folder: FolderStore;
  private client: OwApiClient;
  private policy: ConflictPolicy;
  private onConflict: (conflict: Conflict) => void;
  private onStateChange: (state: SyncEngineState) => void;
  private state: SyncEngineState = { kind: 'idle', last_sync_at: null };
  private paused = false;
  private pauseReason: 'manual' | 'network' | null = null;

  constructor(opts: SyncEngineOptions) {
    this.folder = opts.folder;
    this.client = opts.client;
    this.policy = opts.policy ?? 'drain-blind';
    this.onConflict = opts.onConflict ?? (() => {});
    this.onStateChange = opts.onStateChange ?? (() => {});
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
   * Push local changes to server, then pull remote changes to folder.
   */
  async syncNow(): Promise<SyncResult> {
    if (this.paused) {
      return emptyResult();
    }
    this.setState({ kind: 'syncing', phase: 'push' });
    const pushResult = await this.pushPhase();
    this.setState({ kind: 'syncing', phase: 'pull' });
    const pullResult = await this.pullPhase();
    const result: SyncResult = {
      pushed: pushResult.pushed,
      pulled: pullResult.pulled,
      conflicts: [...pushResult.conflicts, ...pullResult.conflicts],
    };
    this.setState({ kind: 'idle', last_sync_at: nowIso() });
    return result;
  }

  // ---- Phases ----

  private async pushPhase(): Promise<SyncResult> {
    const changed = await this.folder.listLocallyChangedSince(null);
    const tombstones = await this.folder.listTombstonesSince(null);

    let creates = 0;
    let updates = 0;
    let deletes = 0;
    const conflicts: Conflict[] = [];

    for (const elem of changed) {
      try {
        if (!elem.server_updated_at) {
          // Never synced before → CREATE on server.
          const body = stripSyncFields(elem);
          const response = await this.client.createElement(elem.type, body);
          await this.folder.stampServerUpdatedAt(elem.id, elem.type, response.updated_at);
          creates++;
        } else {
          // Previously synced → UPDATE on server.
          // Conflict detection is deferred to Phase 1.5; drain-blind just pushes.
          const body = stripSyncFields(elem);
          const response = await this.client.updateElement(elem.type, elem.id, body);
          await this.folder.stampServerUpdatedAt(elem.id, elem.type, response.updated_at);
          updates++;
        }
      } catch (err) {
        // Network errors abort the whole push; SDK 4xx errors will surface as
        // conflicts in Phase 1.5. For now, rethrow.
        throw err;
      }
    }

    for (const tomb of tombstones) {
      try {
        await this.client.deleteElement(tomb.type, tomb.id);
        await this.folder.clearTombstone(tomb.id);
        deletes++;
      } catch (err) {
        throw err;
      }
    }

    await this.folder.writeSyncState({ last_push_at: nowIso() });
    return { pushed: { creates, updates, deletes }, pulled: zero(), conflicts };
  }

  private async pullPhase(): Promise<SyncResult> {
    // Phase 1: minimal pull — fetch all elements per type, write any that are
    // new or have a newer server timestamp than what we have locally.
    // (Phase 2 adds smart "only since last_pull_at" diffing using server-side
    // filter once we wire it.)
    return { pushed: zero(), pulled: zero(), conflicts: [] };
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

function zero(): { creates: number; updates: number; deletes: number } {
  return { creates: 0, updates: 0, deletes: 0 };
}

function emptyResult(): SyncResult {
  return { pushed: zero(), pulled: zero(), conflicts: [] };
}
