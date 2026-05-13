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
  if (!name) throw new Error('name is required');
  if (!email) throw new Error('email is required');
  if (!pin) throw new Error('pin is required');

  const response = await fetch(getWorldsyncUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, pin }),
  });

  if (response.status === 400) {
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      throw new Error(data.message ?? 'invalid email or pin — verify your onlyworlds.com account');
    } catch {
      throw new Error('invalid email or pin — verify your onlyworlds.com account');
    }
  }
  if (response.status === 429) {
    throw new Error('too many requests — please try again later');
  }
  if (!response.ok) {
    throw new Error(`server error ${response.status} — unable to create world`);
  }
  const data = await response.json() as { success?: boolean; api_key?: string; message?: string };
  if (!data.success || !data.api_key) {
    throw new Error(data.message ?? 'server reported failure creating world');
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
export async function mergeLocalIntoApi(
  folder: FolderStore,
  adapter: OwClientAdapter,
  policy: MergePolicy,
  onProgress?: (p: MergeProgress) => void
): Promise<MergeResult> {
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
  const idSwaps = new Map<string, string>(); // oldLocalId → serverId

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
      const byName = local.name
        ? serverList.find(r =>
            !matchedServerIds.has(r.id) &&
            typeof r.name === 'string' &&
            r.name.trim().toLowerCase() === local.name.trim().toLowerCase()
          )
        : undefined;
      if (byName) {
        matchedServerIds.add(byName.id);
        localDecisions.push({ kind: 'matched-swap', local, server: byName, type });
        idSwaps.set(local.id, byName.id);
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

  // 4b. Local-side decisions.
  for (const dec of localDecisions) {
    try {
      const { local, type } = dec;
      if (dec.kind === 'create') {
        const { local_updated_at: _l, server_updated_at: _s, ...body } = local;
        const response = await adapter.createElement(type, body);
        await folder.stampServerUpdatedAt(local.id, type, response.updated_at);
        creates++;
      } else if (dec.kind === 'matched-same-id') {
        if (policy === 'b') {
          const { local_updated_at: _l, server_updated_at: _s, ...body } = local;
          const response = await adapter.updateElement(type, dec.server.id, body);
          await folder.stampServerUpdatedAt(local.id, type, response.updated_at);
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
          const { id: _lid, local_updated_at: _l, server_updated_at: _s, ...body } = local;
          const response = await adapter.updateElement(type, serverId, body);
          // Re-save local at the new id with local's content.
          await folder.applyServerRecord(type, { ...body, id: serverId }, response.updated_at);
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

  // 5. Rewrite id references across all remaining local elements.
  //    Any element that referenced a swapped local id should now point at the
  //    new server id. We scan every field of every element.
  if (idSwaps.size > 0) {
    await rewriteIdReferences(folder, idSwaps);
  }

  return { creates, updates, skipped, downloaded, failures };
}

type ServerRec = { id: string; updated_at: string } & Record<string, unknown>;

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
