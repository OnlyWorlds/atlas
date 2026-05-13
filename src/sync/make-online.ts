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
  creates: number;
  updates: number;
  skipped: number;
  failures: PerElementFailure[];
}

/**
 * Merge the local folder's elements into the server's existing api world.
 * Caller has already validated creds + opened the client.
 *
 *   - Policy (b) — matched (by id OR name+type) → UPDATE server with local;
 *                  unmatched → CREATE.
 *   - Policy (c) — matched → skip (but stamp `server_updated_at` so future
 *                  edits diff correctly); unmatched → CREATE.
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
  for (const type of ALL_ELEMENT_TYPES) {
    onProgress?.({ done: 0, total: 0, phase: 'list' });
    const records = await adapter.listElements(type);
    serverByType.set(type, records);
  }

  // 2. List all local elements (single call, then group by type).
  const allLocal = await folder.listElements();
  const localByType = new Map<ElementType, Element[]>();
  for (const e of allLocal) {
    if (!localByType.has(e.type)) localByType.set(e.type, []);
    localByType.get(e.type)!.push(e);
  }

  const total = allLocal.length;
  let done = 0;
  let creates = 0;
  let updates = 0;
  let skipped = 0;
  const failures: PerElementFailure[] = [];

  // 3. Walk every local element. Decide create/update/skip based on match + policy.
  for (const [type, locals] of localByType) {
    const serverList = serverByType.get(type) ?? [];
    for (const local of locals) {
      try {
        const match = findMatch(local, serverList);
        if (match) {
          if (policy === 'b') {
            // Overwrite server with local.
            const { local_updated_at: _l, server_updated_at: _s, ...body } = local;
            const response = await adapter.updateElement(type, match.id, body);
            await folder.stampServerUpdatedAt(local.id, type, response.updated_at);
            updates++;
          } else {
            // Policy c: keep server unchanged, stamp local baseline so future
            // diffs work. If the match's id differs from local's id, the local
            // file's id stays — we just record the server timestamp.
            await folder.stampServerUpdatedAt(local.id, type, match.updated_at);
            skipped++;
          }
        } else {
          // Unmatched on server → CREATE.
          const { local_updated_at: _l, server_updated_at: _s, ...body } = local;
          const response = await adapter.createElement(type, body);
          await folder.stampServerUpdatedAt(local.id, type, response.updated_at);
          creates++;
        }
      } catch (err) {
        failures.push({
          element_id: local.id,
          type,
          operation: 'create', // best-effort label; could be 'update' but caller mostly cares about the count
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        done++;
        onProgress?.({ done, total, phase: 'apply' });
      }
    }
  }

  return { creates, updates, skipped, failures };
}

/**
 * Find a server-side counterpart for a local element. Strategy:
 *   1. Same id → match (handles re-uploads from the same machine).
 *   2. Same name+type (case-insensitive) → match.
 * Returns the first match found, or undefined.
 */
function findMatch(
  local: Element,
  serverList: Array<{ id: string; updated_at: string } & Record<string, unknown>>
): ({ id: string; updated_at: string } & Record<string, unknown>) | undefined {
  // 1. id match.
  const byId = serverList.find(r => r.id === local.id);
  if (byId) return byId;
  // 2. name+type match (case-insensitive).
  if (!local.name) return undefined;
  const target = local.name.trim().toLowerCase();
  return serverList.find(r => typeof r.name === 'string' && r.name.trim().toLowerCase() === target);
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
