/**
 * world-meta fakes — proving the test doubles encode the REAL keel PATCH/GET
 * /world contract BEFORE the production caller exists (convention #20). Pinned
 * from keel@83fe020 source dig 2026-07-13
 * (Notes/2026-07-13-worldmeta-sync-design.md, "Wire contract (PINNED)").
 *
 * Two doubles, two boundaries:
 *   - FakeOwApiClient is adapter-level → speaks DISK names (`time_current`).
 *   - statefulV2Handlers is the wire → speaks WIRE names (`time_range_current`).
 * The rename seam is proved from both sides: the disk name is unknown on the
 * wire, and the wire name is unknown to the adapter fake.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';

const TEST_BASE = 'https://test-ow.local/api/v2';

interface DuckError extends Error {
  status?: number;
  code?: string;
  param?: string | null;
}

// ---------------------------------------------------------------------------
// FakeOwApiClient — DISK-name contract, direct method calls
// ---------------------------------------------------------------------------

describe('FakeOwApiClient — patchWorldMeta validation (disk names)', () => {
  let fake: FakeOwApiClient;
  let clock: MonotonicClock;

  beforeEach(() => {
    fake = new FakeOwApiClient();
    clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
    fake.setClock(clock.next);
  });

  it('returns the full 16-field body in disk names and logs the read', async () => {
    const meta = await fake.getWorldMeta();
    expect(meta.name).toBe('fake world');
    expect(meta.time_current).toBeNull();
    expect(meta).toHaveProperty('time_current'); // disk name, NOT time_range_current
    expect(meta).not.toHaveProperty('time_range_current');
    expect(fake.calls[fake.calls.length - 1]).toEqual({ method: 'getWorldMeta' });
  });

  it('rejects an unknown field with a 422 duck-typed error naming the param', async () => {
    let caught: DuckError | undefined;
    await fake.patchWorldMeta({ nope: 'x' }).catch((e: DuckError) => { caught = e; });
    expect(caught).toBeDefined();
    expect(caught!.status).toBe(422);
    expect(caught!.code).toBe('invalid_request');
    expect(caught!.param).toBe('nope');
    expect(caught!.message).toBe("API Error 422: Unknown field 'nope'.");
  });

  it('rejects the WIRE name time_range_current as unknown (disk boundary)', async () => {
    await expect(fake.patchWorldMeta({ time_range_current: 5 }))
      .rejects.toMatchObject({ status: 422, param: 'time_range_current' });
  });

  it('rejects a boolean on an int field', async () => {
    await expect(fake.patchWorldMeta({ time_range_min: true as unknown as number }))
      .rejects.toMatchObject({ status: 422, param: 'time_range_min', message: "API Error 422: 'time_range_min' must be an integer or null." });
  });

  it('accepts an integer and explicit null on int fields', async () => {
    await fake.patchWorldMeta({ time_range_min: -50, time_current: 0 });
    let meta = await fake.getWorldMeta();
    expect(meta.time_range_min).toBe(-50);
    expect(meta.time_current).toBe(0);
    await fake.patchWorldMeta({ time_range_min: null });
    meta = await fake.getWorldMeta();
    expect(meta.time_range_min).toBeNull();
  });

  it('rejects an empty name (non-empty after trim)', async () => {
    await expect(fake.patchWorldMeta({ name: '   ' }))
      .rejects.toMatchObject({ status: 422, param: 'name', message: 'API Error 422: name must be a non-empty string.' });
  });

  it('rejects a non-string list element', async () => {
    await expect(fake.patchWorldMeta({ time_format_names: ['ok', 3 as unknown as string] }))
      .rejects.toMatchObject({ status: 422, param: 'time_format_names' });
  });

  it('empty body → no updated_at bump, returns current body', async () => {
    const before = (await fake.getWorldMeta()).updated_at;
    const echo = await fake.patchWorldMeta({});
    expect(echo.updated_at).toBe(before);
    expect((await fake.getWorldMeta()).updated_at).toBe(before);
  });

  it('a present field EQUAL to the current value still bumps updated_at (no diff)', async () => {
    const before = (await fake.getWorldMeta()).description; // ''
    const echo = await fake.patchWorldMeta({ description: before });
    // value unchanged...
    expect(echo.description).toBe(before);
    // ...but updated_at advanced.
    expect(echo.updated_at).not.toBe('2026-01-01T00:00:00Z');
  });

  it('undefined is stripped (missing key = no change), so an all-undefined body does not bump', async () => {
    const before = (await fake.getWorldMeta()).updated_at;
    const echo = await fake.patchWorldMeta({ description: undefined });
    expect(echo.updated_at).toBe(before); // stripped to {} → no bump
    // and the logged body is the stripped (empty) body
    expect(fake.calls[fake.calls.length - 1]).toEqual({ method: 'patchWorldMeta', body: {} });
  });

  it('a real value survives while an undefined sibling is stripped', async () => {
    await fake.patchWorldMeta({ description: 'kept', image_url: undefined });
    const meta = await fake.getWorldMeta();
    expect(meta.description).toBe('kept');
    expect(meta.image_url).toBe(''); // untouched, not cleared
  });

  it('the patch echo equals a subsequent GET (full refreshed body)', async () => {
    const echo = await fake.patchWorldMeta({ description: 'hi', time_current: 12 });
    const meta = await fake.getWorldMeta();
    expect(echo).toEqual(meta);
  });
});

describe('FakeOwApiClient — read-only key (write-permission seam)', () => {
  let fake: FakeOwApiClient;

  beforeEach(() => {
    fake = new FakeOwApiClient();
    fake.setClock(new MonotonicClock('2026-01-01T00:00:00.000Z').next);
    fake.__inject_write_permission_error();
  });

  it('writes throw a duck-typed 403 permission_error, reads still succeed', async () => {
    // patchWorldMeta (a write) blocked
    await expect(fake.patchWorldMeta({ description: 'x' }))
      .rejects.toMatchObject({ status: 403, code: 'permission_error', param: null });
    // element writes blocked too
    await expect(fake.createElement('character', { id: crypto.randomUUID(), name: 'x' }))
      .rejects.toMatchObject({ status: 403, code: 'permission_error' });
    await expect(fake.deleteElement('character', 'anything'))
      .rejects.toMatchObject({ status: 403 });
    // reads unaffected
    await expect(fake.getWorldMeta()).resolves.toBeDefined();
    await expect(fake.listElements('character')).resolves.toEqual([]);
  });

  it('the 403 message names the read-only reason', async () => {
    let caught: DuckError | undefined;
    await fake.patchWorldMeta({ name: 'x' }).catch((e: DuckError) => { caught = e; });
    expect(caught!.message).toBe('API Error 403: This key is read-only and cannot write to this world.');
  });
});

describe('FakeOwApiClient — __server_mutate_world_meta seam', () => {
  it('applies disk-named fields out of band, bumps updated_at, logs NO call', async () => {
    const fake = new FakeOwApiClient();
    fake.setClock(new MonotonicClock('2026-01-01T00:00:00.000Z').next);
    const before = (await fake.getWorldMeta()).updated_at;
    const callsBefore = fake.calls.length; // includes the getWorldMeta above
    fake.__server_mutate_world_meta({ description: 'from server', time_current: 99 });
    const meta = await fake.getWorldMeta();
    expect(meta.description).toBe('from server');
    expect(meta.time_current).toBe(99);
    expect(meta.updated_at).not.toBe(before);
    // only the trailing getWorldMeta was logged, the mutate itself was not
    expect(fake.calls.filter(c => c.method === 'patchWorldMeta')).toHaveLength(0);
    expect(fake.calls.length).toBe(callsBefore + 1);
  });
});

describe('FakeOwApiClient — __get_world_meta_state read seam', () => {
  it('reflects a push without logging a call, and returns a copy', async () => {
    const fake = new FakeOwApiClient();
    fake.setClock(new MonotonicClock('2026-01-01T00:00:00.000Z').next);
    await fake.patchWorldMeta({ time_current: 77, description: 'pushed' });
    const before = fake.calls.length;
    const state = fake.__get_world_meta_state();
    expect(state.time_current).toBe(77);
    expect(state.description).toBe('pushed');
    expect(fake.calls.length).toBe(before); // no call logged
    // mutating the returned copy does not touch internal state
    (state.time_format_names as string[]).push('leak');
    expect((await fake.getWorldMeta()).time_format_names).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// statefulV2Handlers — WIRE-name contract, real fetch through MSW
// ---------------------------------------------------------------------------

describe('statefulV2Handlers — GET/PATCH /world (wire names)', () => {
  let clock: MonotonicClock;

  beforeEach(() => {
    clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  });

  function mount(opts: Parameters<typeof statefulV2Handlers>[0] = {}) {
    const server = statefulV2Handlers({ baseUrl: TEST_BASE, clock: clock.next, ...opts });
    mswServer.use(...server.handlers);
    return server;
  }

  const getWorld = () => fetch(`${TEST_BASE}/world`);
  const patchWorld = (body: unknown) =>
    fetch(`${TEST_BASE}/world`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('GET returns the full body in wire names, origin with it', async () => {
    mount();
    const body = await (await getWorld()).json();
    expect(Object.keys(body).sort()).toEqual([
      'created_at', 'description', 'distance_unit', 'id', 'image_url', 'length_unit',
      'mass_unit', 'name', 'origin', 'public_read', 'time_basic_unit', 'time_format_equivalents', 'time_format_names',
      'time_range_current', 'time_range_max', 'time_range_min', 'updated_at',
    ]);
    expect(body).toHaveProperty('time_range_current'); // wire name
    expect(body).not.toHaveProperty('time_current');
  });

  it('PATCH happy path echoes the full refreshed body and bumps updated_at', async () => {
    mount();
    const before = await (await getWorld()).json();
    const res = await patchWorld({ description: 'a realm', time_range_current: 42 });
    expect(res.status).toBe(200);
    const echo = await res.json();
    expect(echo.description).toBe('a realm');
    expect(echo.time_range_current).toBe(42);
    expect(Object.keys(echo)).toHaveLength(17); // full body, origin included
    expect(echo.updated_at).not.toBe(before.updated_at); // bumped
    // and it persisted
    const after = await (await getWorld()).json();
    expect(after.description).toBe('a realm');
    expect(after.updated_at).toBe(echo.updated_at);
  });

  it('unknown field → 422 with the verbatim keel message + param, whole PATCH aborts', async () => {
    mount();
    const res = await patchWorld({ description: 'set me', public_read: true });
    expect(res.status).toBe(422);
    const { error } = await res.json();
    expect(error.code).toBe('invalid_request');
    expect(error.message).toBe("Unknown field 'public_read'.");
    expect(error.param).toBe('public_read');
    // aborted: the valid `description` in the same body did NOT persist
    const world = await (await getWorld()).json();
    expect(world.description).toBe('');
  });

  it('time_current is REJECTED as unknown on the wire (rename boundary)', async () => {
    mount();
    const res = await patchWorld({ time_current: 5 });
    expect(res.status).toBe(422);
    const { error } = await res.json();
    expect(error.message).toBe("Unknown field 'time_current'.");
    expect(error.param).toBe('time_current');
  });

  it('type errors per kind carry the right keel message', async () => {
    mount();
    const text = await (await patchWorld({ description: 5 })).json();
    expect(text.error.message).toBe("'description' must be a string.");

    const emptyName = await (await patchWorld({ name: '  ' })).json();
    expect(emptyName.error.message).toBe('name must be a non-empty string.');

    const list = await (await patchWorld({ time_format_names: [1, 2] })).json();
    expect(list.error.message).toBe("'time_format_names' must be a list of strings.");

    const int = await (await patchWorld({ time_range_max: 1.5 })).json();
    expect(int.error.message).toBe("'time_range_max' must be an integer or null.");

    const boolInt = await (await patchWorld({ time_range_min: true })).json();
    expect(boolInt.error.message).toBe("'time_range_min' must be an integer or null.");
  });

  it('empty body → no save, no updated_at bump, returns current body', async () => {
    mount();
    const before = await (await getWorld()).json();
    const res = await patchWorld({});
    expect(res.status).toBe(200);
    const echo = await res.json();
    expect(echo.updated_at).toBe(before.updated_at); // no bump
  });

  it('a same-value PATCH still bumps updated_at (keel does not diff)', async () => {
    mount();
    const before = await (await getWorld()).json();
    const echo = await (await patchWorld({ name: before.name })).json();
    expect(echo.name).toBe(before.name);
    expect(echo.updated_at).not.toBe(before.updated_at);
  });

  it('__mutate_world_meta is visible in the next GET and bumps updated_at', async () => {
    const server = mount();
    const before = await (await getWorld()).json();
    server.__mutate_world_meta({ description: 'out of band', time_range_max: 7 });
    const after = await (await getWorld()).json();
    expect(after.description).toBe('out of band');
    expect(after.time_range_max).toBe(7);
    expect(after.updated_at).not.toBe(before.updated_at);
  });

  it('options.worldMeta seeds initial wire-named values', async () => {
    mount({ worldMeta: { description: 'seeded', time_range_current: 3 } });
    const body = await (await getWorld()).json();
    expect(body.description).toBe('seeded');
    expect(body.time_range_current).toBe(3);
  });

  it('a blocked auth state 401s the PATCH', async () => {
    const authState = { blocked: true };
    mount({ authState });
    const res = await patchWorld({ description: 'x' });
    expect(res.status).toBe(401);
  });
});
