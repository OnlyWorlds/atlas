/**
 * Make-Online helpers — used by the Make-Online modal (Bouts F+G).
 *
 * Route 1 (create new api world): POST /api/v2/account/worlds on the
 * signed-in account, then push all local elements to the new api world as
 * CREATEs. Signed out, the forms sign in first (`ui/sign-in-fields.ts`).
 *
 * Route 2 (link existing api world): list all server elements, plan the
 * match (`plan-merge.ts`), move name-matched locals onto the server's ids
 * with the journaled re-key kernel, then apply the plan per policy:
 *   - (b) overwrite-on-match: matched → UPDATE server with local; unmatched → CREATE.
 *   - (c) keep-server: matched → the server's record lands locally; unmatched → CREATE.
 *
 * Both routes leave the folder state coherent (every locally-present
 * element has a `server_updated_at` baseline set on success).
 */

import { OwV2ClientAdapter, OwV2Error } from './ow-v2-client-adapter';
import { AccountClient, accountErrorMessage } from './account-client';
import { PlainError } from '../core/plain-error';
import { getState } from '../core/state';
import { devV2Base } from './dev-api-base';
import type { FolderStore } from '../store/folder-store';
import { ALL_ELEMENT_TYPES } from '../core/types';
import { planMerge, type ServerRec } from './plan-merge';
import { startRekey, type RekeyHooks } from '../store/rekey';
import { isPageNarrative, pageBlocksFromStory } from '../core/sharing';

import type { Element, ElementType, PerElementFailure } from '../core/types';
import type { OwApiClient, BulkItem } from './sync-engine';

/** Test seam: override the OW base URL; buildV2Adapter derives its /api/v2 from it. */
export function setMakeOnlineBaseUrl(url: string): void {
  // Stored at module level so tests can swap before building an adapter.
  // Production code never calls this — base defaults to onlyworlds.com.
  overriddenBase = url;
}

let overriddenBase: string | null = null;

// ---------------------------------------------------------------------------
// Route 1: create new api world
// ---------------------------------------------------------------------------

export interface CreateApiWorldOpts {
  name: string;
  pin: string;
}

export interface CreateApiWorldResult {
  apiKey: string;
  /**
   * Present when the server includes them in the create response (keel does:
   * `{success, world_id, name, version, api_key}` — probed 2026-07-12).
   * Callers use these directly and fall back to `client.worlds.get()` only
   * when absent.
   */
  worldId?: string;
  worldName?: string;
}

/**
 * Create a new api world on the signed-in account (session 260):
 * `POST /api/v2/account/worlds` with the PIN dance — try WITHOUT `pin` first
 * (an account that already has a PIN rejects one, even the correct value);
 * on 422 param=pin retry WITH the caller's PIN (fresh accounts require it,
 * and it becomes the account PIN). The 201 carries the world row + full
 * WRITE key in one round-trip.
 *
 * Signed out it refuses: the v1 `create-world-external` lane (name + email +
 * PIN) is retired (Keel #134, S432); the forms sign in first.
 *
 * Throws on validation failure, rate limit, network error — the caller
 * surfaces these as inline error messages.
 */
export async function createApiWorld(opts: CreateApiWorldOpts): Promise<CreateApiWorldResult> {
  const name = opts.name.trim();
  const pin = opts.pin.trim();
  if (!name) throw new Error('Name is required');

  const token = getState().registry.account_token;
  if (token) {
    const client = new AccountClient(token);
    let created;
    try {
      created = await client.createWorld(name);
    } catch (err) {
      if (err instanceof OwV2Error && err.status === 422 && err.param === 'pin') {
        // Fresh account: the PIN is required and becomes the account PIN.
        if (!pin) throw new PlainError('Enter your PIN first. A new account sets its PIN here.');
        created = await client.createWorld(name, pin);
      } else {
        // Only the account refusals Atlas has words for pass as refusals;
        // anything else keeps its kind and details (S369 gate B M6).
        const coded = err instanceof OwV2Error && (err.code === 'key_revoked' || err.status === 401 || err.code === 'rate_limited');
        throw coded ? new PlainError(accountErrorMessage(err)) : err;
      }
    }
    return { apiKey: created.key, worldId: created.id, worldName: created.name };
  }

  throw new PlainError('Sign in to OnlyWorlds first: the new world is made on your account.');
}

// ---------------------------------------------------------------------------
// Route 2: merge a local world into an existing api world
// ---------------------------------------------------------------------------

export type MergePolicy = 'b' | 'c';

export interface MergeProgress {
  done: number;
  total: number;
  /** 'ids' = local elements moving onto the server's ids (the re-key kernel). */
  phase: 'list' | 'ids' | 'apply';
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
  /** Names left unmatched because two or more on one side share them (per type). */
  ambiguous: Array<{ type: ElementType; name: string }>;
  /** Maps and zones left unmatched because both sides have pins or markers on them (gate A4/A5). */
  childClashes: Array<{ type: ElementType; name: string }>;
  /** Local id → server id, the elements that took the server's id. */
  rekeyed: Map<string, string>;
  /** Elements whose file could not be read, so their links still name old ids. */
  unrewritten: string[];
  /** Server records not downloaded because a local element of another type has the id. */
  idClashes: Array<{ id: string; localType: ElementType; serverType: ElementType }>;
}

export interface MergeOpts {
  /**
   * Whether same-name elements are the same element. Default true. When
   * false only exact id matches count, and name collisions upload as their
   * own elements ("John the merchant" + "John the bandit").
   */
  matchByName?: boolean;
  onProgress?: (p: MergeProgress) => void;
  /** The atlas world id, for the re-key journal. Default: world.json's id. */
  worldId?: string;
  /** Step 6p of the re-key: browser state that names element ids (the app passes `rekeyPersistedState`). */
  rekeyPersistedState?: RekeyHooks['rekeyPersistedState'];
  /**
   * Right after the local ids moved, before any server call: the app's
   * screen follows the disk here (`rekeyLiveUi`), so a later failure never
   * leaves the UI on ids the folder no longer has.
   */
  onRekeyed?: (map: ReadonlyMap<string, string>) => void | Promise<void>;
}

/** Route 2 will not start: nothing was read or written. The message is for the user. */
export class MergeRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MergeRefusedError';
  }
}

/**
 * Bidirectional merge between a local folder and an existing api world
 * (Route 2, rebuilt S367 onto the re-key kernel). Three buckets after
 * `planMerge` (per type: ids first, then unique names):
 *   - **Local-only**: CREATE on the server.
 *   - **Server-only**: DOWNLOAD into the folder.
 *   - **Matched**: policy (b) the local content goes up (PATCH, then the
 *     server's full response lands locally); policy (c) the server's record
 *     lands locally and the local content, rich text included, is given up;
 *     a page's blocks are its content, so they go too and are rebuilt from
 *     the server's story (gate A9). Atlas's own bindings (map image, aliases)
 *     survive both.
 *
 * The order is the design (`Forge/Notes/2026-09-29-s365-orient/lane-a-route2.md`
 * §3 Option A). A name match means a local element O IS server element N, so
 * FIRST the journaled kernel moves O onto N locally (every link, prose link,
 * chip, page block and media file), and only THEN does anything talk to the
 * server, with every decision keyed by an id that will not change again. The
 * old order re-derived "O is N" from disk and could not read a half-done
 * swap: a crash between writing N and removing O put a duplicate on the
 * server on the rerun. Now O and N coexist only inside the journal's window,
 * and nothing matches against a world while a journal exists.
 *
 * Crash points: before the kernel, nothing is written. Inside it, the journal
 * stays and the SERVER IS UNTOUCHED; the caller retries it as recovery, else
 * the next open finishes it, and a rerun matches by id. In the server phase,
 * a rerun matches everything by id (a created-but-unstamped element is in the
 * server list), so nothing duplicates.
 *
 * Per-element server errors, and per-element disk errors while stamping,
 * are non-fatal and recorded in `failures`. A kernel error throws with
 * nothing sent; a listing or planning error throws before anything is
 * written. The caller reloads the element list on any exit after the kernel
 * (`make-online-run.ts`).
 */
export async function mergeLocalIntoApi(
  folder: FolderStore,
  adapter: OwApiClient,
  policy: MergePolicy,
  optsOrProgress?: MergeOpts | ((p: MergeProgress) => void)
): Promise<MergeResult> {
  // Back-compat: callers can still pass a progress callback as the 4th arg.
  const opts: MergeOpts = typeof optsOrProgress === 'function'
    ? { onProgress: optsOrProgress }
    : (optsOrProgress ?? {});
  const matchByName = opts.matchByName ?? true;
  const onProgress = opts.onProgress;

  // 0. An unfinished id update owns this world until it is finished or
  // discarded: matching against a half-moved world is how duplicates were made.
  if (await folder.hasRekeyJournal()) {
    throw new MergeRefusedError('An id update in this world did not finish. In Settings, under This world, use Finish it or Undo it, then link again.');
  }

  // 1. List all server elements (one fetch per type).
  const serverByType = new Map<ElementType, ServerRec[]>();
  let serverTotalForList = 0;
  for (const type of ALL_ELEMENT_TYPES) {
    onProgress?.({ done: 0, total: serverTotalForList, phase: 'list' });
    const records = await adapter.listElements(type);
    serverByType.set(type, records);
    serverTotalForList += records.length;
  }

  // 2. Plan. Nothing is written yet.
  const plan = planMerge(await folder.listElements(), serverByType, { matchByName });

  // 3. Local ids onto the server's ids, journaled. A throw here leaves the
  // journal (the server has not been touched) and propagates.
  let rekeyed = new Map<string, string>();
  let unrewritten: string[] = [];
  if (plan.pairs.size > 0) {
    const worldId = opts.worldId ?? (await folder.readWorldMeta()).id;
    const r = await startRekey(
      folder,
      { worldId, pairs: plan.pairs, allowStaleBaseline: true, origin: 'merge' },
      {
        onProgress: (done, total) => onProgress?.({ done, total, phase: 'ids' }),
        rekeyPersistedState: opts.rekeyPersistedState,
      },
    );
    rekeyed = r.map;
    unrewritten = r.unrewritten;
    if (rekeyed.size > 0) await opts.onRekeyed?.(rekeyed);
  }

  // 4. The server phase. Every decision is same-id now: a renamed local
  // carries the server's id.
  //
  // A file the kernel could not rewrite still names old ids; its cached body
  // must not go up (S367 gate A6). It stays local, named in `unrewritten`.
  const unreadable = new Set(unrewritten);
  // A planned create carrying a stale baseline (a folder copied out of an api
  // world, an unlink without reset) would, if its create failed, read as
  // synced or as deleted on the server forever (gate A2). It never reached
  // THIS server, so it is never-synced before anything is sent.
  for (const c of plan.creates) {
    if (c.local.server_updated_at && !unreadable.has(c.local.id)) await folder.clearServerBaseline(c.local.id);
  }
  // Ids an earlier, unfinished run of this route created (gate A3): on a
  // rerun they meet their own upload as a same-id match.
  const ownUploads = new Set((await folder.readSyncState()).route2_created ?? []);
  type Matched = { id: string; local: Element; server: ServerRec; type: ElementType };
  const matched: Matched[] = [
    ...plan.sameId.map(m => ({ id: m.local.id, local: m.local, server: m.server, type: m.type })),
    ...plan.renamed.map(m => ({ id: m.server.id, local: m.local, server: m.server, type: m.type })),
  ];
  const creates = plan.creates.filter(c => !unreadable.has(c.local.id));
  const total = plan.downloads.length + creates.length + matched.length;
  let done = 0;
  const tick = () => { done++; onProgress?.({ done, total, phase: 'apply' }); };
  const counts = { creates: 0, updates: 0, skipped: 0, downloaded: 0 };
  const failures: PerElementFailure[] = [];
  for (const c of plan.creates) {
    if (unreadable.has(c.local.id)) {
      failures.push({ element_id: c.local.id, type: c.type, operation: 'create', message: 'its file could not be read, so it was not uploaded' });
    }
  }

  // 4a. Downloads first: a create or update may link to them.
  for (const d of plan.downloads) {
    try {
      const { updated_at, ...body } = d.server;
      await folder.applyServerRecord(d.type, body, updated_at);
      counts.downloaded++;
    } catch (err) {
      failures.push({ element_id: d.server.id, type: d.type, operation: 'create', message: errText(err) });
    } finally {
      tick();
    }
  }

  // 4b. Creates before matched updates: a matched element may link to a new one.
  // Bodies are read from disk now, after the kernel rewrote their links.
  // Read from DISK inside the element's chain (S367 gate A1): an outside
  // write no live pass adopted (the route holds the live folder off) must be
  // what goes up, not the cached body it would silently revert.
  const sendable = async (id: string): Promise<{ body: Record<string, unknown>; sent: string } | null> => {
    const current = await folder.updateElementWith(id, () => null);
    if (!current) return null;
    const { local_updated_at, server_updated_at: _s, ...body } = current;
    return { body, sent: local_updated_at };
  };

  async function createOne(c: { local: Element; type: ElementType }): Promise<void> {
    try {
      const s = await sendable(c.local.id);
      if (!s) return;
      const response = await adapter.createElement(c.type, s.body);
      if (response.id !== c.local.id) {
        // keel preserves client ids; a different id is a contract break, not
        // something to paper over with a second id move here.
        throw new Error(`the server gave it a different id (${response.id})`);
      }
      await folder.stampServerUpdatedAt(c.local.id, c.type, response.updated_at, s.sent);
      counts.creates++;
    } catch (err) {
      failures.push({ element_id: c.local.id, type: c.type, operation: 'create', message: errText(err) });
    } finally {
      tick();
    }
  }

  // v2: batches of 2+ go through /bulk, one atomic request with server-side
  // FK resolution INCLUDING CYCLES (a cyclic web of local-only elements, the
  // Sikelia class, could never land one at a time).
  async function processBulkCreates(decisions: Array<{ local: Element; type: ElementType }>, isRetry = false): Promise<void> {
    const batch: Array<{ dec: { local: Element; type: ElementType }; item: BulkItem; sent: string }> = [];
    for (const dec of decisions) {
      // A file that will not parse is that element's failure, not the batch's
      // (gate A7: the disk read is strict).
      let s: Awaited<ReturnType<typeof sendable>>;
      try {
        s = await sendable(dec.local.id);
      } catch (err) {
        failures.push({ element_id: dec.local.id, type: dec.type, operation: 'create', message: errText(err) });
        tick();
        continue;
      }
      if (!s) { tick(); continue; }
      batch.push({ dec, item: { type: dec.type, element: s.body }, sent: s.sent });
    }
    if (batch.length === 0) return;

    let result: Awaited<ReturnType<NonNullable<OwApiClient['bulkCreate']>>>;
    try {
      result = await adapter.bulkCreate!(batch.map(b => b.item), {
        atomic: true,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (err) {
      const message = errText(err);
      for (const b of batch) {
        failures.push({ element_id: b.dec.local.id, type: b.dec.type, operation: 'create', message });
        tick();
      }
      return;
    }

    if (!result.errors) {
      // Everything landed atomically. Stamp from the per-item timestamp echo
      // (keel D46) where present; only items lacking it fall to the read-back
      // backfill (small batch → per-element GET, large → one list walk per
      // pushed type). Never stamp client now().
      const needBackfill: typeof batch = [];
      for (let i = 0; i < batch.length; i++) {
        const echo = result.items[i]?.updatedAt;
        if (typeof echo === 'string' && echo) {
          // A stamp that throws (a file gone corrupt) is that element's
          // failure, never the whole merge's (S367 gate A7).
          try {
            await folder.stampServerUpdatedAt(batch[i].dec.local.id, batch[i].dec.type, echo, batch[i].sent);
            counts.creates++;
          } catch (err) {
            failures.push({
              element_id: batch[i].dec.local.id, type: batch[i].dec.type, operation: 'create',
              message: `created but its baseline could not be saved: ${errText(err)}`,
            });
          }
          tick();
        } else {
          needBackfill.push(batch[i]);
        }
      }
      if (needBackfill.length === 0) return;
      if (needBackfill.length <= 20) {
        for (const b of needBackfill) {
          const id = b.dec.local.id;
          try {
            const remote = await adapter.getElement(b.dec.type, id);
            if (!remote) throw new Error('created element missing on read-back');
            await folder.stampServerUpdatedAt(id, b.dec.type, remote.updated_at, b.sent);
            counts.creates++;
          } catch (err) {
            failures.push({
              element_id: id, type: b.dec.type, operation: 'create',
              message: `created but baseline backfill failed: ${errText(err)}`,
            });
          }
          tick();
        }
      } else {
        const byType = new Map<ElementType, typeof batch>();
        for (const b of needBackfill) {
          if (!byType.has(b.dec.type)) byType.set(b.dec.type, []);
          byType.get(b.dec.type)!.push(b);
        }
        for (const [type, group] of byType) {
          let remoteById = new Map<string, string>();
          try {
            const listed = await adapter.listElements(type);
            remoteById = new Map(listed.map(r => [r.id, r.updated_at]));
          } catch (err) {
            console.warn(`[atlas:sync] merge bulk backfill list walk failed for ${type}:`, err);
          }
          for (const b of group) {
            const id = b.dec.local.id;
            const ts = remoteById.get(id);
            if (ts) {
              try {
                await folder.stampServerUpdatedAt(id, type, ts, b.sent);
                counts.creates++;
              } catch (err) {
                failures.push({
                  element_id: id, type, operation: 'create',
                  message: `created but its baseline could not be saved: ${errText(err)}`,
                });
              }
            } else {
              failures.push({
                element_id: id, type, operation: 'create',
                message: 'created but baseline backfill failed: not present in post-bulk list walk',
              });
            }
            tick();
          }
        }
      }
      return;
    }

    // errors: true under atomic → server rolled EVERYTHING back. Fail the bad
    // items, retry the survivors once.
    const survivors: Array<{ local: Element; type: ElementType }> = [];
    result.items.forEach((it, i) => {
      const b = batch[i];
      if (!b) return;
      if (it.status < 400) {
        survivors.push(b.dec);
        return;
      }
      failures.push({
        element_id: b.dec.local.id,
        type: b.dec.type,
        operation: 'create',
        message: it.error?.message || 'bulk item failed',
      });
      tick();
    });
    if (isRetry || survivors.length === 0) {
      for (const s of survivors) {
        failures.push({
          element_id: s.local.id, type: s.type, operation: 'create',
          message: 'rolled back by failing peers in the atomic batch; retry exhausted',
        });
        tick();
      }
      return;
    }
    await processBulkCreates(survivors, /* isRetry */ true);
  }

  if (creates.length > 0) {
    const ids = creates.map(c => c.local.id);
    await folder.updateSyncState(st => ({ route2_created: [...new Set([...(st.route2_created ?? []), ...ids])] }));
  }
  if (typeof adapter.bulkCreate === 'function' && creates.length >= 2) {
    await processBulkCreates(creates);
  } else {
    for (const c of creates) await createOne(c);
  }

  // 4c. Matched elements.
  for (const m of matched) {
    try {
      if (unreadable.has(m.id)) {
        failures.push({ element_id: m.id, type: m.type, operation: 'update', message: 'its file could not be read, so it was not uploaded' });
        continue;
      }
      // An element this route itself uploaded on an earlier, unfinished run is
      // not a duplicate: its local copy wins whatever the policy (gate A3).
      if (policy === 'b' || ownUploads.has(m.id)) {
        const s = await sendable(m.id);
        if (!s) continue;
        const response = await adapter.updateElement(m.type, m.id, s.body);
        // The server's full post-PATCH record lands locally (PATCH is partial:
        // fields the local copy lacks stay on the server; the store keeps the
        // file's atlas-only fields). Guarded like every push stamp (conv. 96,
        // gate A1): if the file changed during the request, nothing lands and
        // the element stays dirty, so the next round sends the newer text.
        const { updated_at: _ts, ...fullBody } = response;
        const landed = await folder.applyServerRecordIfUnchanged(m.type, fullBody, response.updated_at, s.sent);
        // The edit that beat the response keeps its text; the baseline still
        // moves to the server's time, lifted past it (sync-stamp), so the
        // element reads dirty and the next round PATCHes the newer text.
        if (!landed) await folder.stampServerUpdatedAt(m.id, m.type, response.updated_at, s.sent);
        counts.updates++;
      } else {
        // Policy c: the server's record wins, and the local rich text goes
        // with the local prose it mirrored; atlas's bindings stay.
        const { updated_at, ...serverBody } = m.server;
        const dropLocal = ['atlas_richtext_json'];
        let body: Record<string, unknown> = serverBody;
        // A page's blocks are its text (`story` is compiled from them on
        // every save), so they go too, or the next save would put the local
        // page back over the server's (gate A9, Captain's ruling 2026-10-04).
        // Blocks are rebuilt only when the server's copy is a page: a local
        // page the server holds as a scene becomes that scene, with no page
        // fields left on it (gate lens B L2).
        if (m.type === 'narrative' && (isPageNarrative(m.local) || isPageNarrative(serverBody as unknown as Element))) {
          dropLocal.push('atlas_page_blocks', 'atlas_page_refs');
          if (isPageNarrative(serverBody as unknown as Element)) {
            body = { ...serverBody, ...pageBlocksFromStory(serverBody.story) };
          }
        }
        await folder.applyServerRecord(m.type, body, updated_at, { dropLocal });
        counts.skipped++;
      }
    } catch (err) {
      failures.push({ element_id: m.id, type: m.type, operation: 'update', message: errText(err) });
    } finally {
      tick();
    }
  }

  // `route2_created` stays until the caller's link succeeds
  // (`make-online-run.ts`): a link step that throws leaves a rerun to come.
  return {
    ...counts, failures, ambiguous: plan.ambiguous, childClashes: plan.childClashes,
    rekeyed, unrewritten, idClashes: plan.idClashes,
  };
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err); // raw-error-ok: failure records only (Route 2's result), never shown
}

// ---------------------------------------------------------------------------
// Client builder. buildV2Adapter — the thin v2 fetch adapter carrying all
// element CRUD, /bulk, /changes, AND credential validation via GET /world
// (the v1 SDK buildOwClient lane retired 2026-07-12 when Skeld shipped the
// /world endpoint; the SDK survives only for FIELD_SCHEMA statics).
// ---------------------------------------------------------------------------

export function buildV2Adapter(apiKey: string, apiPin: string, baseUrl?: string, opts: { readTimeoutMs?: number } = {}): OwV2ClientAdapter {
  // Test seam compat: `setMakeOnlineBaseUrl` stores a v1-worldapi-shaped base;
  // derive the /api/v2 sibling from its origin so MSW/staging overrides steer
  // both dialects together.
  const overriddenV2 = overriddenBase
    ? overriddenBase.replace(/\/api\/(worldapi|worldsync|v2)$/, '') + '/api/v2'
    : null;
  return new OwV2ClientAdapter({
    apiKey,
    apiPin,
    baseUrl: baseUrl ?? overriddenV2 ?? devV2Base() ?? undefined,
    readTimeoutMs: opts.readTimeoutMs,
  });
}
