/**
 * FakeOwApiClient — in-memory adapter that satisfies the OwApiClient interface
 * the SyncEngine expects. Tests can either use this directly (clean assertions
 * on captured calls) or route to MSW handlers via a real SDK client (more
 * faithful but heavier).
 *
 * For Phase 0 / 1 unit tests, this is enough.
 *
 * v2 dialect (Bout 5, 2026-07-12): the fake now speaks keel v2 —
 *   - wire-extension fields (`atlas_*` visual prefs) round-trip instead of
 *     being rejected (see rejectAtlasLocalFields split below);
 *   - `bulkCreate` implements `/bulk` (opt-in via `__enable_bulk()` so the
 *     per-element createOrder tests still exercise the fallback path);
 *   - `pullChanges` implements `/changes` over an internal commit-ordered op
 *     log (every create/update/bulk/delete/__server_mutate appends an op);
 *     opt-in via `__enable_changes()` for the same reason as bulkCreate — the
 *     engine dispatches its pull phase on the method's mere presence.
 */

import type { OwApiClient, BulkItem, BulkResult, ChangesPage, WorldMetaWire } from '../../src/sync/sync-engine';
import type { ElementType } from '../../src/core/types';
import { ATLAS_LOCAL_ONLY_FIELDS } from '../../src/core/constants';

interface ServerRecord {
  id: string;
  type: ElementType;
  updated_at: string;
  [field: string]: unknown;
}

/** One entry of the internal `/changes` op log (commit-ordered by `seq`). */
interface ChangeOp {
  op: 'upsert' | 'delete';
  type: ElementType;
  id: string;
  /** Dense, monotonic, gap-free per-world commit sequence (keel T1). */
  seq: number;
  updated_at?: string;
  deleted_at?: string;
  /** Full element snapshot AT COMMIT TIME (upsert ops only). */
  element?: ServerRecord;
}

/** Standard keel v2 error envelope inner object. */
interface V2ItemError {
  code: string;
  message: string;
  param: string | null;
}

export class FakeOwApiClient implements OwApiClient {
  private clock = () => new Date().toISOString();
  private byType = new Map<ElementType, Map<string, ServerRecord>>();
  /** Test seam: per-id-and-operation error injection. */
  private injectedFailures = new Map<string, { msg: string }>();
  /** Test seam: per-id forced /bulk item failure (one-shot). */
  private injectedBulkFailures = new Map<string, V2ItemError>();
  /**
   * Commit-ordered change feed backing `pullChanges`. Every create, update,
   * bulk-persisted item, delete, and __server_mutate appends one op. Cursor
   * format mirrors keel: `"<seq>:<id>"`.
   */
  private opLog: ChangeOp[] = [];
  private opSeq = 0;
  /**
   * Test seam: when true, CREATE ignores client-sent `id` and assigns a fresh
   * uuid (simulating real OW server behavior that enforces v7 format).
   * Tests covering the id-swap path on CREATE should enable this.
   *
   * NOTE: `/bulk` always preserves client ids regardless of this flag — the
   * engine's bulk backfill re-reads each element by its client id, and the
   * bulk path has no id-swap handling (probed contract: client ids preserved).
   */
  assignServerIds = false;
  /**
   * Test seam: types reported as paginated via getPaginatedTypes(). Lets
   * server-delete tests simulate "server has more elements than our first
   * page returned" without actually paginating responses.
   */
  private forcedPaginatedTypes = new Set<ElementType>();
  /**
   * Test seam: when true, EVERY CRUD operation throws 401. Mirrors real-OW
   * behavior when credentials go dead — bad PIN, revoked api_key, or world
   * deleted server-side (which invalidates the api_key). Engine should
   * detect via isAuthError and transition to error state.
   */
  private authBlocked = false;
  /**
   * Optional typed code carried by the injected 401. When set, the thrown
   * Error is duck-typed as an OwV2Error (status 401 + code) so sync-engine's
   * `typedError` picks up `key_revoked` and threads it into SyncResult.auth_reason.
   * Null = the historical plain-Error 401 (message-only), unchanged.
   */
  private authBlockedCode: 'invalid_credentials' | 'key_revoked' | null = null;
  /**
   * Test seam: when true, every WRITE (createElement, updateElement,
   * deleteElement, bulkCreate, patchWorldMeta) throws a duck-typed 403
   * permission_error, while every READ still succeeds. Models a read-only key
   * (keel returns 403 "This key is read-only …" on any write). Toggle via
   * __inject_write_permission_error.
   */
  private writePermissionBlocked = false;
  /**
   * World-meta store in DISK names (`time_current`, not the wire's
   * `time_range_current`). getWorldMeta returns this; patchWorldMeta mutates it
   * under the same validation rules as the server but on disk names. Defaults:
   * canonical empties, a fixed epoch updated_at (deterministic; setClock drives
   * bumps on write).
   */
  private worldMeta: WorldMetaWire = {
    id: '00000000-0000-4000-8000-00000fake1d',
    name: 'fake world',
    description: '',
    image_url: '',
    time_basic_unit: '',
    time_format_names: [],
    time_format_equivalents: [],
    time_range_min: null,
    time_range_max: null,
    time_current: null,
    public_read: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  // Capture of every call for assertion.
  calls: Array<
    | { method: 'create'; type: ElementType; body: Record<string, unknown> }
    | { method: 'update'; type: ElementType; id: string; body: Record<string, unknown> }
    | { method: 'delete'; type: ElementType; id: string }
    | { method: 'list'; type: ElementType }
    | { method: 'get'; type: ElementType; id: string }
    | { method: 'bulk'; items: number; atomic: boolean }
    | { method: 'getWorldMeta' }
    | { method: 'patchWorldMeta'; body: Record<string, unknown> }
  > = [];

  setClock(fn: () => string): void { this.clock = fn; }

  private bucket(type: ElementType): Map<string, ServerRecord> {
    let m = this.byType.get(type);
    if (!m) { m = new Map(); this.byType.set(type, m); }
    return m;
  }

  /** Append an upsert op carrying the element snapshot at commit time. */
  private appendUpsert(record: ServerRecord): void {
    this.opSeq += 1;
    this.opLog.push({
      op: 'upsert',
      type: record.type,
      id: record.id,
      seq: this.opSeq,
      updated_at: record.updated_at,
      element: { ...record },
    });
  }

  /** Append a delete op (no element body — mirrors keel's delete op). */
  private appendDelete(type: ElementType, id: string): void {
    this.opSeq += 1;
    this.opLog.push({
      op: 'delete',
      type,
      id,
      seq: this.opSeq,
      deleted_at: this.clock(),
    });
  }

  async createElement(type: ElementType, body: Record<string, unknown>): Promise<ServerRecord> {
    this.throwIfAuthBlocked();
    this.throwIfWritePermission();
    // Mirror real-OW wire semantics: JSON.stringify drops undefined values,
    // so any field set to `undefined` in the body never reaches the server.
    // Without this, FakeOwApiClient would mask UI bugs that pass `undefined`
    // for "clear this field" (real OW would interpret the missing key as
    // "no change", FakeOwApiClient would otherwise apply it as "clear").
    const wireBody = stripUndefined(body);
    this.calls.push({ method: 'create', type, body: { ...wireBody } });
    // Mirror real OW: pin requires element_type whenever element_id is set.
    // Throwing here lets engine/merge tests catch regressions of this rule.
    if (type === 'pin' && wireBody.element_id && !wireBody.element_type) {
      throw new Error('API Error 400: element_type must be provided when element_id is specified');
    }
    // Mirror real OW field-validator: unknown / atlas-local fields trigger
    // 400 on the wire. Captain session 221 hit this with `atlas_shape` on
    // zone — the field was stored locally but never stripped, so live OW
    // rejected the zone CREATE and dependent markers FK-failed. Tests
    // silently passed because the prior fake spread unknown fields into
    // its store.
    rejectAtlasLocalFields(type, wireBody, 'create');
    // Convention #8 invariant: spatial element bodies (pin, marker) carry
    // wire-shape relation fields directly (map_id, zone_id, element_id).
    // Running them through prepareRelations double-suffixes the field to
    // map_id_id / zone_id_id / element_id_id — the server then 4xx's. The
    // fake encodes the invariant so any code path violating it fails its
    // tests immediately (Convention #20). The fix is to bypass
    // prepareRelations in the adapter for these types.
    rejectDoubleSuffix(type, wireBody, 'create');
    // Real OW behavior: ignore client-sent id when assignServerIds=true.
    const id = this.assignServerIds ? cryptoRandomId() : (wireBody.id as string) ?? cryptoRandomId();
    this.throwIfInjected('create', id);
    // Mirror keel (convention #20, S361): a POST for an id the world already
    // holds is 409 `id_conflict`, never a silent overwrite. The engine's
    // adopt path (gate F3) is only testable against a fake that says so.
    if (!this.assignServerIds && this.bucket(type).has(id)) {
      throw new Error(`API Error 409: id_conflict: ${type} ${id} already exists`);
    }
    const record: ServerRecord = { ...wireBody, id, type, updated_at: this.clock() };
    this.bucket(type).set(id, record);
    this.appendUpsert(record);
    return { ...record };
  }

  async updateElement(type: ElementType, id: string, body: Record<string, unknown>): Promise<ServerRecord> {
    this.throwIfAuthBlocked();
    this.throwIfWritePermission();
    // Same wire-semantics rule as createElement: drop undefined before the
    // spread-merge. Real PATCH treats a missing key as "no change"; only an
    // explicit `null` (or a new value) overwrites the field.
    const wireBody = stripUndefined(body);
    this.calls.push({ method: 'update', type, id, body: { ...wireBody } });
    this.throwIfInjected('update', id);
    rejectDoubleSuffix(type, wireBody, 'update');
    rejectAtlasLocalFields(type, wireBody, 'update');
    const m = this.bucket(type);
    const existing = m.get(id);
    // Mirror real OW: PATCH on a deleted/unknown id returns 404 with the
    // "X not found in this world" body. The engine treats this as a
    // server-side delete and routes via the same review modal as pull-time
    // detection — see pushPhase / resolveConflict.
    if (!existing) throw new Error(`API Error 404: ${id} not found in this world.`);
    const next: ServerRecord = { ...existing, ...wireBody, id, type, updated_at: this.clock() };
    m.set(id, next);
    this.appendUpsert(next);
    return { ...next };
  }

  async deleteElement(type: ElementType, id: string): Promise<void> {
    this.throwIfAuthBlocked();
    this.throwIfWritePermission();
    this.calls.push({ method: 'delete', type, id });
    this.throwIfInjected('delete', id);
    // v2 contract: DELETE is IDEMPOTENT — a missing id returns 204, same as
    // success (probed 2026-07-12). The engine's 404 catch-arm survives as
    // legacy tolerance; tests that want to exercise it inject a 404 via
    // __inject_failure instead of relying on the fake's default behavior.
    const m = this.bucket(type);
    if (!m.has(id)) return;
    m.delete(id);
    this.appendDelete(type, id);
  }

  async listElements(type: ElementType): Promise<ServerRecord[]> {
    this.throwIfAuthBlocked();
    this.calls.push({ method: 'list', type });
    return Array.from(this.bucket(type).values()).map(r => ({ ...r }));
  }

  async getElement(type: ElementType, id: string): Promise<ServerRecord | null> {
    this.throwIfAuthBlocked();
    this.calls.push({ method: 'get', type, id });
    const r = this.bucket(type).get(id);
    return r ? { ...r } : null;
  }

  /**
   * GET /world — the full 13-field body in DISK names (world-meta sync, S262).
   * A READ: succeeds under a read-only key (only writes 403). Returns a clone
   * so callers can't mutate internal state through the arrays.
   */
  async getWorldMeta(): Promise<WorldMetaWire> {
    this.throwIfAuthBlocked();
    this.calls.push({ method: 'getWorldMeta' });
    return this.cloneWorldMeta();
  }

  /**
   * PATCH /world — partial write in DISK names. Mirrors the keel contract but
   * on disk names (so `time_current`, not the wire's `time_range_current`):
   *   - stripUndefined first (a missing key = "no change"; a buggy caller that
   *     passes `undefined` to "clear" gets the real resurrect behavior);
   *   - unknown field → 422 param throw; wrong type → 422; name non-empty;
   *     int-or-null with booleans rejected — validated across ALL keys before
   *     any mutation (keel aborts the whole PATCH on one stray field);
   *   - empty body after strip → return current body, NO updated_at bump;
   *   - any applied field (even same value) bumps updated_at (keel doesn't diff).
   * Returns the full refreshed body (keel echoes GET /world after the write).
   */
  async patchWorldMeta(fields: Record<string, unknown>): Promise<WorldMetaWire> {
    this.throwIfAuthBlocked();
    this.throwIfWritePermission();
    const wireBody = stripUndefined(fields);
    this.calls.push({ method: 'patchWorldMeta', body: { ...wireBody } });
    const keys = Object.keys(wireBody);
    // Unknown-field pass first (whole PATCH aborts), then per-field type.
    for (const k of keys) {
      if (!(k in DISK_WORLD_META_WRITABLE)) {
        throw metaError(k, `Unknown field '${k}'.`);
      }
    }
    for (const k of keys) {
      const msg = validateDiskWorldMetaField(k, wireBody[k]);
      if (msg) throw metaError(k, msg);
    }
    if (keys.length === 0) return this.cloneWorldMeta(); // no bump
    for (const k of keys) (this.worldMeta as unknown as Record<string, unknown>)[k] = wireBody[k];
    this.worldMeta.updated_at = this.clock();
    return this.cloneWorldMeta();
  }

  private cloneWorldMeta(): WorldMetaWire {
    return {
      ...this.worldMeta,
      time_format_names: [...this.worldMeta.time_format_names],
      time_format_equivalents: [...this.worldMeta.time_format_equivalents],
    };
  }

  /**
   * POST /bulk — atomic multi-element create with server-side FK-order
   * resolution (cycles included). Opt-in via `__enable_bulk()`: left
   * undefined by default so the per-element createOrder tests still exercise
   * the engine's topo-sort fallback (the engine routes ≥2 creates through
   * /bulk only when `typeof client.bulkCreate === 'function'`).
   *
   * Faithful to the probed contract (Notes/2026-07-12-v2-probed-facts.md):
   *   - HTTP 200 always; consult `errors` + per-item `status`.
   *   - Success items → status 201, id preserved, NO `updated_at` (the engine
   *     backfills authoritative timestamps via GET / list walk).
   *   - `atomic:true` + any failure → `errors:true`, NOTHING persisted
   *     (rollback verified live); per-item 201s still reported as
   *     would-have-succeeded.
   *   - `atomic:false` + failure → good items persist, bad items carry errors.
   */
  bulkCreate?: (items: BulkItem[], opts?: { atomic?: boolean; idempotencyKey?: string }) => Promise<BulkResult>;

  private async runBulkCreate(
    items: BulkItem[],
    opts?: { atomic?: boolean; idempotencyKey?: string },
  ): Promise<BulkResult> {
    this.throwIfAuthBlocked();
    this.throwIfWritePermission();
    const atomic = opts?.atomic ?? false;
    this.calls.push({ method: 'bulk', items: items.length, atomic });

    // Snapshot the resolvable id-space for the dangling-reference check:
    // everything already stored PLUS every id in THIS batch (in-batch cycles
    // resolve server-side, per the probed contract).
    const existingIds = new Set<string>();
    for (const bucket of this.byType.values()) {
      for (const rid of bucket.keys()) existingIds.add(rid);
    }
    const batchIds = new Set<string>();
    for (const it of items) {
      const eid = it.element.id;
      if (typeof eid === 'string') batchIds.add(eid);
    }

    // Validate each item positionally (never throw — produce a per-item
    // result). Stash the wire body of the successes so we can persist them
    // after the atomic decision.
    const results: BulkResult['items'] = [];
    const wireBodies: Array<Record<string, unknown> | null> = [];
    let anyError = false;
    for (const it of items) {
      const wireBody = stripUndefined(it.element);
      const id = (wireBody.id as string) ?? cryptoRandomId();
      // Injection seam takes priority over intrinsic validation.
      const err = this.takeInjectedBulkError(id)
        ?? validateBulkItem(it.type, wireBody, id, existingIds, batchIds);
      if (err) {
        anyError = true;
        results.push({ status: 400, id, error: err });
        wireBodies.push(null);
      } else {
        results.push({ status: 201, id });
        wireBodies.push(wireBody);
      }
    }

    // atomic rollback: any failure → persist NOTHING (verified live). The
    // per-item 201 statuses still report which items WOULD have succeeded.
    if (atomic && anyError) {
      return { errors: true, items: results };
    }

    // Persist the successes (all of them under atomic-success; the good ones
    // under non-atomic). Records land exactly like createElement so a
    // subsequent getElement / listElements returns them with a server
    // `updated_at` from the clock. Success slots ECHO that timestamp
    // (keel D46, deployed 2026-07-12) unless the pre-D46 seam is on — the
    // engine stamps baselines from the echo and only read-back-backfills
    // items lacking it.
    for (let i = 0; i < items.length; i++) {
      const wireBody = wireBodies[i];
      if (!wireBody) continue;
      const type = items[i].type;
      const id = results[i].id;
      const record: ServerRecord = { ...wireBody, id, type, updated_at: this.clock() };
      this.bucket(type).set(id, record);
      this.appendUpsert(record);
      if (!this.omitBulkTimestamps) results[i].updatedAt = record.updated_at;
    }
    return { errors: anyError, items: results };
  }

  /**
   * Test seam: simulate a pre-D46 server whose /bulk items carry no
   * timestamp echo — keeps the engine's read-back backfill fallback covered.
   */
  private omitBulkTimestamps = false;
  __omit_bulk_timestamps(enabled = true): void {
    this.omitBulkTimestamps = enabled;
  }

  /**
   * GET /changes — one page of the internal commit-ordered op log. OPT-IN via
   * `__enable_changes()`, mirroring `__enable_bulk`: the engine's pullPhase
   * DISPATCHES on `typeof client.pullChanges === 'function'`, so an
   * always-present method would reroute every legacy pull test (including the
   * absence-inference pagination-guard trio in sync-engine.serverDelete)
   * through the cursor path. Off by default keeps the full-list fallback
   * exercised; changes-pull tests call `__enable_changes()`.
   */
  pullChanges?: (since: string | null, limit?: number) => Promise<ChangesPage>;

  /** Test seam: attach (or detach) the optional `/changes` method. */
  __enable_changes(enabled = true): void {
    this.pullChanges = enabled
      ? (since, limit) => this.runPullChanges(since, limit)
      : undefined;
  }

  /**
   * `since` is the opaque `"<seq>:<id>"` cursor from the previous page
   * (null = from the world epoch). Returns ops with `seq > sinceSeq` up to
   * `limit`, mapped to the engine's ChangesPage shape. The cursor is the last
   * returned op's `"<seq>:<id>"`, or the `since` value verbatim when the page
   * is empty.
   */
  private async runPullChanges(since: string | null, limit = 100): Promise<ChangesPage> {
    this.throwIfAuthBlocked();
    const sinceSeq = since ? parseInt(since.split(':')[0], 10) : 0;
    const pending = this.opLog.filter(o => o.seq > sinceSeq);
    const returned = pending.slice(0, limit);
    const hasMore = pending.length > returned.length;
    const last = returned[returned.length - 1];
    const cursor = last ? `${last.seq}:${last.id}` : since;
    const changes: ChangesPage['changes'] = returned.map(o =>
      o.op === 'upsert'
        ? {
            op: 'upsert' as const,
            type: o.type,
            id: o.id,
            changeSeq: o.seq,
            updatedAt: o.updated_at ?? '',
            element: { ...(o.element as ServerRecord) },
          }
        : {
            op: 'delete' as const,
            type: o.type,
            id: o.id,
            changeSeq: o.seq,
            deletedAt: o.deleted_at ?? '',
          },
    );
    // `head` = the world's current change_seq (v2 tail) — the engine's rewind
    // detector compares it against its persisted last-applied seq.
    const head = this.opLog.reduce((m, o) => Math.max(m, o.seq), 0);
    return { cursor, hasMore, head, changes };
  }

  /**
   * Test seam: simulate a server restore-from-backup (the one legal rewind
   * path). Drops every op with `seq > maxSeq` AND removes the corresponding
   * records from element state — the world literally IS its earlier self.
   * After this, /changes serves `head = maxSeq` and the engine's rewind
   * detector should fire on any client holding a later cursor.
   */
  __rewind_op_log(maxSeq: number): void {
    const dropped = this.opLog.filter(o => o.seq > maxSeq);
    this.opLog = this.opLog.filter(o => o.seq <= maxSeq);
    this.opSeq = maxSeq; // the restored server continues from here
    for (const op of dropped) {
      if (op.op === 'upsert') {
        // A post-rewind world has no memory of the upsert; drop the record
        // unless a SURVIVING op re-establishes it (then restore that snapshot).
        const surviving = [...this.opLog].reverse().find(o => o.id === op.id && o.op === 'upsert');
        if (surviving && surviving.op === 'upsert') {
          this.bucket(op.type).set(op.id, { ...(surviving.element as ServerRecord) });
        } else {
          this.bucket(op.type).delete(op.id);
        }
      }
    }
  }

  /** Engine reads this to learn which types are paginated. */
  getPaginatedTypes(): ReadonlySet<ElementType> {
    return this.forcedPaginatedTypes;
  }

  /** Test seam: mark a type as paginated for the engine's safety check. */
  __force_paginated(type: ElementType, enabled = true): void {
    if (enabled) this.forcedPaginatedTypes.add(type);
    else this.forcedPaginatedTypes.delete(type);
  }

  /**
   * Test seam: attach (or detach) the optional `/bulk` method. Off by default
   * so the engine's per-element topo-sort path stays exercised by the
   * createOrder tests; bulk-path tests call this to opt in.
   */
  __enable_bulk(enabled = true): void {
    this.bulkCreate = enabled
      ? (items, opts) => this.runBulkCreate(items, opts)
      : undefined;
  }

  /**
   * Test seam: force a specific /bulk item to fail with the given error
   * envelope (one-shot). Lets bulk tests drive a per-item failure without
   * crafting a dangling reference.
   */
  __inject_bulk_item_failure(id: string, error: V2ItemError): void {
    this.injectedBulkFailures.set(id, error);
  }

  private takeInjectedBulkError(id: string): V2ItemError | null {
    const f = this.injectedBulkFailures.get(id);
    if (f) { this.injectedBulkFailures.delete(id); return { ...f }; } // one-shot
    return null;
  }

  /**
   * Test seam: simulate dead credentials. When enabled, ALL CRUD ops throw
   * 401. Toggle off to simulate "PIN was fixed in settings" (which in
   * production triggers attachSyncEngine to spin up a fresh engine with new
   * creds — engine error state clears on the new instance).
   */
  __inject_auth_failure(
    enabled = true,
    code?: 'invalid_credentials' | 'key_revoked',
  ): void {
    this.authBlocked = enabled;
    this.authBlockedCode = enabled ? (code ?? null) : null;
  }

  private throwIfAuthBlocked(): void {
    if (this.authBlocked) {
      const err = new Error('API Error 401: Unauthorized');
      // With a code, mimic a real OwV2Error so typedError() classifies the
      // bail as key_revoked (vs the message-only default that stays untyped).
      if (this.authBlockedCode) {
        (err as Error & { status?: number; code?: string }).status = 401;
        (err as Error & { status?: number; code?: string }).code = this.authBlockedCode;
      }
      throw err;
    }
  }

  /** Server-side mutation that doesn't show up in `calls` — for setting up
   *  conflict scenarios in tests without polluting the call log. Still
   *  appends a change-feed op (a real out-of-band edit would). */
  __server_mutate(type: ElementType, id: string, patch: Record<string, unknown>): void {
    const m = this.bucket(type);
    const existing = m.get(id);
    if (!existing) throw new Error(`__server_mutate: ${type}/${id} not found`);
    const next: ServerRecord = { ...existing, ...patch, id, type, updated_at: this.clock() };
    m.set(id, next);
    this.appendUpsert(next);
  }

  /**
   * Out-of-band server-side world-meta edit (DISK names). Bumps updated_at and,
   * unlike patchWorldMeta, does NOT log a call — mirrors __server_mutate for
   * elements. Used to set up meta pull/conflict scenarios. No validation (a
   * real server edit is trusted).
   */
  __server_mutate_world_meta(patch: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(patch)) (this.worldMeta as unknown as Record<string, unknown>)[k] = v;
    this.worldMeta.updated_at = this.clock();
  }

  /**
   * Test seam: model a read-only key. When enabled, every WRITE throws a
   * duck-typed 403 permission_error; every READ still succeeds. Needed for the
   * engine's R1 (read-only-key auth-bail) tests.
   */
  __inject_write_permission_error(enabled = true): void {
    this.writePermissionBlocked = enabled;
  }

  /**
   * Test introspection: a copy of the internal DISK-named world-meta object, no
   * call logged. Lets engine suites assert on server-side meta state directly
   * (e.g. __get_world_meta_state().time_current after a push).
   */
  __get_world_meta_state(): Record<string, unknown> {
    return this.cloneWorldMeta() as unknown as Record<string, unknown>;
  }

  private throwIfWritePermission(): void {
    if (this.writePermissionBlocked) {
      const err = new Error('API Error 403: This key is read-only and cannot write to this world.') as
        Error & { status?: number; code?: string; param?: string | null };
      err.status = 403;
      err.code = 'permission_error';
      err.param = null;
      throw err;
    }
  }

  /**
   * Inject a failure for a specific (operation, id). The next call to that
   * operation on that id will throw with the given message instead of
   * succeeding. Used to verify the engine tolerates per-element errors.
   */
  __inject_failure(op: 'create' | 'update' | 'delete', id: string, msg = 'injected failure'): void {
    this.injectedFailures.set(`${op}:${id}`, { msg });
  }

  private throwIfInjected(op: 'create' | 'update' | 'delete', id: string): void {
    const key = `${op}:${id}`;
    const f = this.injectedFailures.get(key);
    if (f) {
      this.injectedFailures.delete(key); // one-shot
      throw new Error(f.msg);
    }
  }

  // Test introspection
  __server_count(type: ElementType): number { return this.bucket(type).size; }
  __server_get(type: ElementType, id: string): ServerRecord | undefined { return this.bucket(type).get(id); }
  /** Directly drop a record from the store WITHOUT a call/op — simulates an
   *  out-of-band server delete for dangling-link routing tests. */
  __server_evict(type: ElementType, id: string): void { this.bucket(type).delete(id); }
}

function cryptoRandomId(): string {
  // Mirror the engine's behavior. In tests we expect callers to provide ids.
  return crypto.randomUUID();
}

/** Matches a canonical 36-char UUID (any version). Used to decide whether a
 *  string field VALUE looks like a relation reference — never applied to
 *  names/descriptions (they don't match this shape). */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Validate a single /bulk item the way createElement validates a write, but
 * return a keel error envelope object instead of throwing. `null` = the item
 * is accepted. Checks, in order: pin element_type rule, atlas-local rejection,
 * double-suffix rule, then the dangling-reference check.
 */
function validateBulkItem(
  type: ElementType,
  wireBody: Record<string, unknown>,
  id: string,
  existingIds: Set<string>,
  batchIds: Set<string>,
): V2ItemError | null {
  // pin requires element_type whenever element_id is set.
  if (type === 'pin' && wireBody.element_id && !wireBody.element_type) {
    return {
      code: 'invalid_request',
      message: 'element_type must be provided when element_id is specified',
      param: 'element_type',
    };
  }
  // atlas-local (never-synced) fields the server rejects. Wire-extension
  // fields are NOT in this set — v2 round-trips them.
  for (const k of Object.keys(wireBody)) {
    if (ATLAS_LOCAL_REJECT.includes(k as (typeof ATLAS_LOCAL_REJECT)[number])) {
      return { code: 'invalid_request', message: `Unknown field: ${k}`, param: k };
    }
  }
  // Double-suffixed relation fields on spatial types (prepareRelations leak).
  if (type === 'pin' || type === 'marker') {
    for (const k of Object.keys(wireBody)) {
      if (k.endsWith('_id_id') || k.endsWith('_ids_ids')) {
        return {
          code: 'invalid_request',
          message: `body contains double-suffixed relation field "${k}"`,
          param: k,
        };
      }
    }
  }
  // Dangling-reference check: a uuid-shaped VALUE that resolves to no stored
  // record and no in-batch id. Only uuid-shaped strings qualify (never
  // names/descriptions). Multi-link fields report the FIRST dangling id.
  const isDangling = (v: unknown): v is string =>
    typeof v === 'string' && UUID_RE.test(v) && v !== id
    && !existingIds.has(v) && !batchIds.has(v);
  for (const [key, value] of Object.entries(wireBody)) {
    if (key === 'id' || key === 'type') continue;
    if (isDangling(value)) return danglingErr(key, value);
    if (Array.isArray(value)) {
      for (const v of value) {
        if (isDangling(v)) return danglingErr(key, v);
      }
    }
  }
  return null;
}

/** Keel v2 dangling-reference envelope. refType is a capitalized placeholder
 *  ('Element') since the dangling id resolves to nothing to look up. */
function danglingErr(field: string, refId: string): V2ItemError {
  return {
    code: 'invalid_link',
    message: `${field} references Element '${refId}' which does not exist.`,
    param: field,
  };
}

/**
 * Strip keys with `undefined` value. Mirrors what JSON.stringify does to a
 * request body on the way out of fetch — undefined fields don't cross the
 * network, so the server never sees them. Real PATCH treats a missing key
 * as "no change to this field"; an explicit `null` is "clear this field".
 *
 * Without this stripping, FakeOwApiClient would silently apply
 * `{ field: undefined }` via spread-merge — masking UI bugs that pass
 * undefined when they mean "clear" (those bugs would surface only against
 * MSW or real OW).
 */
/**
 * PATCH /world writable fields in DISK names → kind. This fake implements
 * OwApiClient (adapter-level), so it speaks disk names: `time_current`, NOT the
 * wire's `time_range_current` (a caller passing the wire name gets an
 * unknown-field 422, proving the disk boundary). Mirror of the server-side
 * writable set in msw-handlers.ts, one rename apart.
 */
const DISK_WORLD_META_WRITABLE: Readonly<Record<string, 'text' | 'list' | 'int'>> = {
  name: 'text',
  description: 'text',
  image_url: 'text',
  time_basic_unit: 'text',
  time_format_names: 'list',
  time_format_equivalents: 'list',
  time_range_min: 'int',
  time_range_max: 'int',
  time_current: 'int',
};

/** First type-validation problem for a DISK-named meta field, or null if ok. */
function validateDiskWorldMetaField(field: string, v: unknown): string | null {
  const kind = DISK_WORLD_META_WRITABLE[field];
  if (kind === 'text') {
    if (typeof v !== 'string') return `'${field}' must be a string.`;
    if (field === 'name' && v.trim() === '') return 'name must be a non-empty string.';
    return null;
  }
  if (kind === 'list') {
    if (!Array.isArray(v) || !v.every(x => typeof x === 'string')) return `'${field}' must be a list of strings.`;
    return null;
  }
  // int: integer or null; booleans explicitly rejected.
  if (v === null) return null;
  if (typeof v === 'boolean' || typeof v !== 'number' || !Number.isInteger(v)) {
    return `'${field}' must be an integer or null.`;
  }
  return null;
}

/**
 * Build a duck-typed OwV2Error for a 422 world-meta validation failure — same
 * shape sync-engine's typedError() reads (.status/.code/.param, message
 * prefixed "API Error 422: …"), mirroring the authBlockedCode pattern above.
 */
function metaError(param: string, detail: string): Error & { status: number; code: string; param: string | null } {
  const err = new Error(`API Error 422: ${detail}`) as Error & { status: number; code: string; param: string | null };
  err.status = 422;
  err.code = 'invalid_request';
  err.param = param;
  return err;
}

function stripUndefined(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    // Mirror OwV2ClientAdapter's SERVER_MANAGED_FIELDS strip for change_seq:
    // legacy disk files written before the adaptV2Record drop can still carry
    // keel's per-element commit counter, and the real adapter silently strips
    // it before the wire. Without this mirror the fake would store + echo it,
    // moving tests off the production path.
    if (k === 'change_seq') continue;
    out[k] = v;
  }
  return out;
}

/**
 * Throw on double-suffixed relation fields for pin/marker bodies. These
 * spatial types carry wire-shape relation names (map_id, zone_id, element_id)
 * on disk; the adapter must bypass prepareRelations for them. If any
 * `*_id_id` or `*_ids_ids` key appears, the bypass is broken — reject so the
 * regression is caught in tests rather than only at runtime against real OW.
 *
 * See ow-client-adapter.ts:244 (bypass set) and DESIGN_ZONES.md §8.1.
 */
function rejectDoubleSuffix(
  type: ElementType,
  body: Record<string, unknown>,
  op: 'create' | 'update',
): void {
  if (type !== 'pin' && type !== 'marker') return;
  for (const k of Object.keys(body)) {
    if (k.endsWith('_id_id') || k.endsWith('_ids_ids')) {
      throw new Error(
        `API Error 400: ${op} ${type} body contains double-suffixed relation field "${k}". ` +
          `The adapter must bypass prepareRelations for ${type}; see ow-client-adapter.ts:244.`,
      );
    }
  }
  // Marker.order is write-allowed as of 2026-05-16 (Anchor migration).
  // No rejection rule here.
}

/**
 * The set of extension fields the v2 server still rejects on a write: the
 * atlas LOCAL-ONLY fields (never synced) plus the sync-internal timestamps.
 *
 * v2 split (2026-07-12, gate 10.3): ATLAS_WIRE_EXTENSION_FIELDS (`atlas_*`
 * zone visual prefs) now ride the wire via keel's extension passthrough and
 * round-trip verbatim, so they are NO LONGER rejected — the fake accepts and
 * stores them like any normal field. Only ATLAS_LOCAL_ONLY_FIELDS
 * (image_media_id, atlas_richtext_json, sharing composition, …) stay local
 * and 400 if they reach the wire.
 */
const ATLAS_LOCAL_REJECT = [...ATLAS_LOCAL_ONLY_FIELDS, 'local_updated_at', 'server_updated_at'] as const;

/**
 * Reject atlas LOCAL-ONLY fields appearing in write bodies — these are stored
 * on local disk only; the OW server doesn't know them and rejects the request
 * 400. Wire-extension fields are intentionally NOT rejected (see the comment
 * on ATLAS_LOCAL_REJECT: v2 round-trips them).
 *
 * Captain session 221: zone CREATE was carrying `atlas_shape: 'polygon'` to
 * the v1 server, which 400'd; markers then FK-failed against the absent zone.
 * Under v2 `atlas_shape` is a wire-extension and rides through fine; this
 * guard now catches only genuinely local fields (image_media_id, richtext,
 * sharing composition) that must never reach the wire.
 */
function rejectAtlasLocalFields(
  type: ElementType,
  body: Record<string, unknown>,
  op: 'create' | 'update',
): void {
  for (const k of Object.keys(body)) {
    if (ATLAS_LOCAL_REJECT.includes(k as (typeof ATLAS_LOCAL_REJECT)[number])) {
      throw new Error(
        `API Error 400: ${op} ${type} body contains atlas-local field "${k}" which the server rejects. ` +
          `Add to ATLAS_LOCAL_ONLY_FIELDS in core/constants.ts so toWireShape strips it.`,
      );
    }
  }
}
