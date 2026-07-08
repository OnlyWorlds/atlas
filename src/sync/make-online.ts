/**
 * Make-Online helpers — used by the Make-Online modal (Bouts F+G).
 *
 * Route 1 (create new api world): POST to /worldsync/create-world-external/
 * (outside the worldapi prefix; not exposed by the SDK), then push all
 * local elements to the new api world as CREATEs.
 *
 * Route 2 (link existing api world): validate creds, list all server
 * elements, build a per-element diff against the local folder, apply
 * the diff per the chosen merge policy:
 *   - (b) overwrite-on-match: matched → UPDATE server with local; unmatched → CREATE.
 *   - (c) push-only-new: matched → skip + stamp local baseline; unmatched → CREATE.
 *
 * Both routes leave the folder state coherent (every locally-present
 * element has a `server_updated_at` baseline set on success).
 */

import { OnlyWorldsClient } from '@onlyworlds/sdk';
import { OwClientAdapter } from './ow-client-adapter';
import type { FolderStore } from '../store/folder-store';
import { ALL_ELEMENT_TYPES } from '../core/types';
import type { Element, ElementType, PerElementFailure } from '../core/types';

const DEFAULT_OW_BASE = 'https://www.onlyworlds.com/api/worldapi';

/** Test seam: override the OW base URL (worldapi). The worldsync path is derived. */
export function setMakeOnlineBaseUrl(url: string): void {
  // Stored at module level so tests can swap before invoking createApiWorld.
  // Production code never calls this — base defaults to onlyworlds.com.
  overriddenBase = url;
}

let overriddenBase: string | null = null;

function getWorldsyncUrl(): string {
  const base = overriddenBase ?? DEFAULT_OW_BASE;
  const worldsyncBase = base.endsWith('/worldapi') ? base.replace(/\/worldapi$/, '/worldsync') : base;
  return `${worldsyncBase}/create-world-external/`;
}

// ---------------------------------------------------------------------------
// Route 1: create new api world
// ---------------------------------------------------------------------------

export interface CreateApiWorldOpts {
  name: string;
  email: string;
  pin: string;
}

export interface CreateApiWorldResult {
  apiKey: string;
}

/**
 * Calls the create-world-external endpoint outside the worldapi prefix.
 * Returns the new world's api_key. The server-side world_id is fetched
 * separately by the caller via `client.worlds.get()` once the api_key is known.
 *
 * Throws on validation failure, rate limit, network error — the caller
 * surfaces these as inline error messages.
 */
export async function createApiWorld(opts: CreateApiWorldOpts): Promise<CreateApiWorldResult> {
  const name = opts.name.trim();
  const email = opts.email.trim();
  const pin = opts.pin.trim();
  if (!name) throw new Error('Name is required');
  if (!email) throw new Error('Email is required');
  if (!pin) throw new Error('PIN is required');

  const response = await fetch(getWorldsyncUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, pin }),
  });

  if (response.status === 400) {
    // Parse OUTSIDE the throw: a `throw` inside the try lands in the catch, which
    // would swallow the server's specific `message` and re-throw the generic one.
    const text = await response.text();
    let serverMessage: string | undefined;
    try {
      const data = JSON.parse(text) as { message?: unknown };
      if (typeof data.message === 'string' && data.message.trim()) serverMessage = data.message;
    } catch {
      // Non-JSON body — fall through to the generic message.
    }
    throw new Error(serverMessage ?? 'Invalid email or PIN. Verify your onlyworlds.com account');
  }
  if (response.status === 429) {
    throw new Error('Too many requests. Try again later');
  }
  if (!response.ok) {
    throw new Error(`Server error ${response.status}; unable to create world`);
  }
  const data = await response.json() as { success?: boolean; api_key?: string; message?: string };
  if (!data.success || !data.api_key) {
    throw new Error(data.message ?? 'Server reported failure creating world');
  }
  return { apiKey: data.api_key };
}

// ---------------------------------------------------------------------------
// Route 2: merge diff against existing api world
// ---------------------------------------------------------------------------

export type MergePolicy = 'b' | 'c';

export interface MergeProgress {
  done: number;
  total: number;
  phase: 'list' | 'apply';
}

export interface MergeResult {
  /** Local-only elements pushed to server. */
  creates: number;
  /** Matched elements whose local content overwrote server (policy b only). */
  updates: number;
  /** Matched elements where server kept its version (policy c only). */
  skipped: number;
  /** Server-only elements downloaded to local. Same for both policies. */
  downloaded: number;
  failures: PerElementFailure[];
}

/**
 * Bidirectional merge between a local folder and an existing api world.
 *
 * Three buckets after matching by id-or-name+type:
 *   - **Local-only**: no server counterpart → CREATE on server.
 *   - **Server-only**: no local counterpart → DOWNLOAD to local
 *     (enforces local-representation invariant).
 *   - **Matched**: name+type or id match → apply policy:
 *     - Policy (b) — overwrite duplicates: local content wins, server[server_id]
 *       gets UPDATEd with local body. If local.id ≠ server.id, local file is
 *       re-saved at server.id (id swap) and references are rewritten across
 *       all other local elements.
 *     - Policy (c) — skip duplicates: server content wins. Local file at
 *       server.id (overwrites prior local content). Local edits to matched
 *       elements are LOST. Same id-swap discipline as (b) when ids differ.
 *
 * Per-element write errors are non-fatal and recorded in `failures`.
 */
export interface MergeOpts {
  /**
   * Whether to treat same-name elements as duplicates. Default true (existing
   * behavior). When false, only exact id matches count as duplicates — name
   * collisions are pushed as fresh elements. Useful for worlds with
   * intentional name collisions ("John the merchant" + "John the bandit").
   */
  matchByName?: boolean;
  onProgress?: (p: MergeProgress) => void;
  /**
   * Fires whenever a local id is replaced by a server id during the merge.
   * Two vectors produce swaps:
   *
   *   1. **Match phase** — a local element matches an api element by name+type
   *      but has a different id. The server's id wins; the local file is
   *      re-saved at the server's id later in the apply phase.
   *   2. **CREATE phase** — server enforces UUID v7 and returns a fresh id
   *      different from the client v4 we sent.
   *
   * UI callers wire this to migrate `state.ui.selectedElementId` + URL hash so
   * the user doesn't see "element <old-id> not found in this world" after the
   * modal closes. The Route 1 transient engine plugs into the same UI
   * propagation via its `onIdSwap` option — keeping Route 1 and Route 2
   * symmetric for the user. Without this callback the merge still works
   * server-side; only the post-merge UI state is left stale.
   */
  onIdSwap?: (swap: { old_id: string; new_id: string; type: ElementType }) => void;
}

export async function mergeLocalIntoApi(
  folder: FolderStore,
  adapter: OwClientAdapter,
  policy: MergePolicy,
  optsOrProgress?: MergeOpts | ((p: MergeProgress) => void)
): Promise<MergeResult> {
  // Back-compat: callers can still pass a progress callback as the 4th arg.
  const opts: MergeOpts = typeof optsOrProgress === 'function'
    ? { onProgress: optsOrProgress }
    : (optsOrProgress ?? {});
  const matchByName = opts.matchByName ?? true;
  const onProgress = opts.onProgress;
  const onIdSwap = opts.onIdSwap;
  /**
   * Map of every (localId → serverId) replacement that happens during the
   * merge. Drives both the file-level `rewriteIdReferences` passes (so other
   * local elements' FKs follow the swap) and the in-memory
   * `applyIdSwapsToBody` (so CREATE bodies dispatched mid-phase carry
   * up-to-date refs). Declared early so `recordIdSwap` can close over it.
   */
  const idSwaps = new Map<string, string>(); // oldLocalId → serverId
  /**
   * Record a swap into the rewrite map AND notify the caller (UI) so
   * selectedElementId + URL hash migrate atomically. Centralizing this keeps
   * every swap site honest — adding a future swap path elsewhere just calls
   * `recordIdSwap` and the UI propagation comes for free.
   */
  const recordIdSwap = (oldId: string, newId: string, type: ElementType): void => {
    idSwaps.set(oldId, newId);
    if (onIdSwap) onIdSwap({ old_id: oldId, new_id: newId, type });
  };
  // 1. List all server elements (one fetch per type).
  const serverByType = new Map<ElementType, Array<{ id: string; updated_at: string } & Record<string, unknown>>>();
  let serverTotalForList = 0;
  for (const type of ALL_ELEMENT_TYPES) {
    onProgress?.({ done: 0, total: serverTotalForList, phase: 'list' });
    const records = await adapter.listElements(type);
    serverByType.set(type, records);
    serverTotalForList += records.length;
  }

  // 2. List all local elements (single call, then group by type).
  const allLocal = await folder.listElements();
  const localByType = new Map<ElementType, Element[]>();
  for (const e of allLocal) {
    if (!localByType.has(e.type)) localByType.set(e.type, []);
    localByType.get(e.type)!.push(e);
  }

  // 3. Match phase — decide what each element does without touching anything yet.
  type LocalDecision =
    | { kind: 'create'; local: Element; type: ElementType }
    | { kind: 'matched-same-id'; local: Element; server: ServerRec; type: ElementType }
    | { kind: 'matched-swap'; local: Element; server: ServerRec; type: ElementType };
  type DownloadDecision = { kind: 'download'; server: ServerRec; type: ElementType };

  const localDecisions: LocalDecision[] = [];
  const downloadDecisions: DownloadDecision[] = [];

  for (const type of ALL_ELEMENT_TYPES) {
    const serverList = serverByType.get(type) ?? [];
    const locals = localByType.get(type) ?? [];

    const matchedServerIds = new Set<string>();

    for (const local of locals) {
      const byId = serverList.find(r => r.id === local.id);
      if (byId) {
        matchedServerIds.add(byId.id);
        localDecisions.push({ kind: 'matched-same-id', local, server: byId, type });
        continue;
      }
      const byName = (matchByName && local.name)
        ? serverList.find(r =>
            !matchedServerIds.has(r.id) &&
            typeof r.name === 'string' &&
            r.name.trim().toLowerCase() === local.name.trim().toLowerCase()
          )
        : undefined;
      if (byName) {
        matchedServerIds.add(byName.id);
        localDecisions.push({ kind: 'matched-swap', local, server: byName, type });
        // Notify caller now (UI propagation happens immediately); the actual
        // file/rewrite happens in the apply phase below. handleIdSwap is
        // idempotent in the rare case the swap is later re-recorded.
        recordIdSwap(local.id, byName.id, type);
        continue;
      }
      localDecisions.push({ kind: 'create', local, type });
    }

    // Server-only — anything not matched.
    for (const server of serverList) {
      if (!matchedServerIds.has(server.id)) {
        downloadDecisions.push({ kind: 'download', server, type });
      }
    }
  }

  // 4. Apply phase.
  const total = localDecisions.length + downloadDecisions.length;
  let done = 0;
  let creates = 0;
  let updates = 0;
  let skipped = 0;
  let downloaded = 0;
  const failures: PerElementFailure[] = [];

  // 4a. Downloads first — guarantees server-only elements are present before
  // any id-swap rewrite walks them.
  for (const d of downloadDecisions) {
    try {
      const { updated_at, ...body } = d.server;
      await folder.applyServerRecord(d.type, body, updated_at);
      downloaded++;
    } catch (err) {
      failures.push({
        element_id: d.server.id,
        type: d.type,
        operation: 'create',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      done++;
      onProgress?.({ done, total, phase: 'apply' });
    }
  }

  // 4b. Matched elements FIRST — populates idSwaps for any name+type matches
  //     so subsequent CREATEs can reference the server's id, not the stale
  //     local one. Without this ordering, a new local Character with
  //     `friends: [matchedCharLocalId]` would send the local id to the
  //     server's CREATE — server stores stale FK, local later rewrites only
  //     its OWN file, server stays wrong.
  const matchedDecisions = localDecisions.filter(d => d.kind !== 'create');
  const createDecisions = localDecisions.filter(d => d.kind === 'create');

  async function processDecision(dec: LocalDecision): Promise<void> {
    try {
      const { local, type } = dec;
      // Always re-fetch local before sending to server. Picks up any in-loop
      // rewrites from previous decisions (e.g. matched-swap registered a swap
      // and rewriteIdReferences updated this element's FKs).
      //
      // BUT: re-fetching the FILE isn't enough for CREATE-references-CREATE
      // chains in phase 4b-2. Between iterations of the CREATE loop, no
      // file-level rewrite runs, so a Carol whose friends pointed at Bob's
      // local id would still send Bob's stale id in her CREATE body even if
      // Bob's CREATE in the prior iteration produced an idSwap. We therefore
      // ALSO apply current idSwaps to the in-memory body before sending —
      // belt-and-suspenders on top of the per-iteration re-fetch.
      const current = await folder.getElement(local.id);
      if (!current) {
        // Silently removed by an in-loop swap targeting this id. Defensive.
        done++;
        onProgress?.({ done, total, phase: 'apply' });
        return;
      }
      if (dec.kind === 'create') {
        const { local_updated_at: _l, server_updated_at: _s, ...rawBody } = current;
        const body = applyIdSwapsToBody(rawBody, idSwaps);
        const response = await adapter.createElement(type, body);
        if (response.id !== local.id) {
          // Server assigned its own id (UUID v7 enforcement). Re-key the local
          // file to the server's id so refs and the next pull's seenLocalIds
          // check line up — otherwise pull would flag the old local id as
          // "vanished from server" and fire the server-delete review modal.
          console.info('[atlas:sync] merge: server assigned new id on create', {
            type, localId: local.id, serverId: response.id,
          });
          const swapped = { ...body, id: response.id };
          await folder.applyServerRecord(type, swapped, response.updated_at);
          await folder.deleteElement(local.id, { silent: true });
          recordIdSwap(local.id, response.id, type);
        } else {
          await folder.stampServerUpdatedAt(local.id, type, response.updated_at);
        }
        creates++;
      } else if (dec.kind === 'matched-same-id') {
        if (policy === 'b') {
          const { local_updated_at: _l, server_updated_at: _s, ...rawBody } = current;
          // Apply current idSwaps defensively. By the time matched UPDATEs run
          // (phase 4b-4, after 4b-3 rewrote local files), the body's FKs should
          // already be correct — but body-level rewrite is idempotent and adds
          // defense in depth at negligible cost.
          const body = applyIdSwapsToBody(rawBody, idSwaps);
          const response = await adapter.updateElement(type, dec.server.id, body);
          // Apply the SERVER's full post-PATCH response to local. PATCH is
          // partial — fields the user didn't set locally stay on server.
          // To make local reflect actual server state (so the UI shows the
          // merged truth, not just what user typed), use the response body.
          const { updated_at: _ts, ...fullBody } = response;
          await folder.applyServerRecord(type, fullBody, response.updated_at);
          updates++;
        } else {
          // Policy c: overwrite local with server's full record.
          const { updated_at, ...serverBody } = dec.server;
          await folder.applyServerRecord(type, serverBody, updated_at);
          skipped++;
        }
      } else {
        // matched-swap: local.id !== server.id; server.id wins.
        const serverId = dec.server.id;
        if (policy === 'b') {
          // UPDATE server with local body (server keeps server.id).
          const { id: _lid, local_updated_at: _l, server_updated_at: _s, ...rawBody } = current;
          const body = applyIdSwapsToBody(rawBody, idSwaps);
          const response = await adapter.updateElement(type, serverId, body);
          // Apply server's full post-PATCH response (not just our local body)
          // so the local file reflects everything server has — including the
          // fields server kept untouched. Without this, the merged local would
          // be missing every field local didn't explicitly set.
          const { updated_at: _ts, ...fullBody } = response;
          await folder.applyServerRecord(type, fullBody, response.updated_at);
          // Remove the old local file silently — never had a server counterpart.
          await folder.deleteElement(local.id, { silent: true });
          updates++;
        } else {
          // Policy c: pull server's full content into local at server.id.
          const { updated_at, ...serverBody } = dec.server;
          await folder.applyServerRecord(type, serverBody, updated_at);
          // Remove the old local file silently.
          await folder.deleteElement(local.id, { silent: true });
          skipped++;
        }
      }
    } catch (err) {
      failures.push({
        element_id: dec.local.id,
        type: dec.type,
        operation: dec.kind === 'create' ? 'create' : 'update',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      done++;
      onProgress?.({ done, total, phase: 'apply' });
    }
  }

  // Phase ordering — circular FK dependency between matched + new locals:
  //   - Matched element (e.g. Splashworth) may reference new locals (Bob, Carol)
  //     via FK fields like friends/rivals
  //   - New locals may reference the matched element
  //
  // To get both directions right server-side, we must:
  //
  //   1. Rewrite local files with the match-phase idSwaps (so any local that
  //      references the matched-old-id now references the matched-server-id).
  //   2. CREATE the new locals. Their body now correctly references the
  //      matched-server-id. Their CREATE may produce more idSwaps (server-
  //      assigned UUID v7).
  //   3. Rewrite again with CREATE-time swaps (so the matched element's local
  //      file now references the new locals' server-assigned ids).
  //   4. UPDATE the matched elements with the now-correct refs in their bodies.
  //   5. Final rewrite to catch any remaining propagation.

  // 4b-1: Rewrite for match-phase swaps (matched-swap entries built idSwaps
  // during the match phase already).
  if (idSwaps.size > 0) {
    await rewriteIdReferences(folder, idSwaps);
  }

  // 4b-2: Process CREATEs. Re-fetched local already has the post-rewrite FKs.
  for (const dec of createDecisions) {
    await processDecision(dec);
  }

  // 4b-3: Rewrite again — picks up any CREATE-time server-assigned ids so the
  // matched elements' local files now reference the new server ids.
  if (idSwaps.size > 0) {
    await rewriteIdReferences(folder, idSwaps);
  }

  // 4b-4: Process matched UPDATEs. Re-fetched local body now has the new
  // server ids for any references to created elements.
  for (const dec of matchedDecisions) {
    await processDecision(dec);
  }

  // 4b-5: Final rewrite — catches anything not yet propagated.
  if (idSwaps.size > 0) {
    await rewriteIdReferences(folder, idSwaps);
  }

  return { creates, updates, skipped, downloaded, failures };
}

type ServerRec = { id: string; updated_at: string } & Record<string, unknown>;

/**
 * Apply id-swaps to a single in-memory body just before sending to the server.
 * Closes the chain-CREATE FK gap: within phase 4b-2's CREATE loop, file-level
 * rewriteIdReferences only runs AFTER the loop (phase 4b-3). Without body-level
 * rewrite, iteration 2 (e.g. Carol whose friends references iteration 1's Bob)
 * would send Bob's stale local id to the server even after Bob's CREATE
 * produced an idSwap.
 *
 * Idempotent — if the body has no fields referencing keys in idMap, it returns
 * the original body unchanged. Safe to call on UPDATE bodies too as defense
 * in depth (local file should already be rewritten by phase 4b-3, but if a
 * timing window opened, this catches it).
 *
 * Walks scalar string fields AND string-array fields. Other shapes (objects,
 * numbers) pass through. Doesn't touch nested objects — atlas writes never
 * nest relations (the adapter and FIELD_SCHEMA both use bare names or _id
 * suffixes at the top level).
 */
function applyIdSwapsToBody(
  body: Record<string, unknown>,
  idMap: Map<string, string>
): Record<string, unknown> {
  if (idMap.size === 0) return body;
  let modified = false;
  const result: Record<string, unknown> = { ...body };
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string') {
      const next = idMap.get(value);
      if (next !== undefined) {
        result[key] = next;
        modified = true;
      }
    } else if (Array.isArray(value)) {
      let arrChanged = false;
      const newArr = value.map(v => {
        if (typeof v === 'string') {
          const next = idMap.get(v);
          if (next !== undefined) {
            arrChanged = true;
            return next;
          }
        }
        return v;
      });
      if (arrChanged) {
        result[key] = newArr;
        modified = true;
      }
    }
  }
  return modified ? result : body;
}

/**
 * Walk every local element and rewrite any field value (string OR array of
 * strings) whose value matches a key in `idMap`. Updates via updateElement so
 * `local_updated_at` advances — these rewrites are real local edits the engine
 * will push on next sync (the server already has the new ids, so push will
 * succeed cleanly).
 */
async function rewriteIdReferences(folder: FolderStore, idMap: Map<string, string>): Promise<void> {
  const SKIP = new Set(['id', 'type', 'name', 'local_updated_at', 'server_updated_at']);
  const all = await folder.listElements();
  for (const el of all) {
    let modified = false;
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(el)) {
      if (SKIP.has(key)) continue;
      if (typeof value === 'string' && idMap.has(value)) {
        patch[key] = idMap.get(value);
        modified = true;
      } else if (Array.isArray(value)) {
        let changed = false;
        const newArr = value.map(v => {
          if (typeof v === 'string' && idMap.has(v)) {
            changed = true;
            return idMap.get(v)!;
          }
          return v;
        });
        if (changed) { patch[key] = newArr; modified = true; }
      }
    }
    if (modified) {
      await folder.updateElement(el.id, patch);
    }
  }
}

// ---------------------------------------------------------------------------
// Helper to construct a client for a given (apiKey, pin) pair.
// ---------------------------------------------------------------------------

export function buildOwClient(apiKey: string, apiPin: string, baseUrl?: string): OnlyWorldsClient {
  return new OnlyWorldsClient({
    apiKey: apiKey.trim(),
    apiPin: apiPin.trim(),
    baseUrl: baseUrl ?? (overriddenBase ?? undefined),
  });
}
