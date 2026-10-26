/**
 * The v2 adapter carries a profile's x_ keys and the world's origin,
 * through the MSW stand-in for keel's GET and PATCH /world: an x_ key goes as
 * given and null removes it, origin comes back as served, and an atlas_ key
 * or a stray field never rides a PATCH.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';

const V2 = 'https://test-ow.local/api/v2';
let t = 0;
const clock = () => new Date(Date.UTC(2026, 9, 23, 7, 0, t++)).toISOString();
let server: ReturnType<typeof statefulV2Handlers>;
let adapter: OwV2ClientAdapter;

const NAMES = { character: { singular: 'Employee', plural: 'Employees' } };

beforeEach(() => {
  server = statefulV2Handlers({ baseUrl: V2, clock });
  mswServer.use(...server.handlers);
  adapter = new OwV2ClientAdapter({ apiKey: 'k', apiPin: '1234', baseUrl: V2 });
});

describe('the adapter carries x_ keys and origin', () => {
  it('reads origin as served, both members null when keel knows none', async () => {
    const meta = await adapter.getWorldMeta() as unknown as Record<string, unknown>;
    expect(meta.origin).toEqual({ source: null, producer: null });
  });

  it('sends an x_ key as given, reads it back by name, and null removes it', async () => {
    const echo = await adapter.patchWorldMeta({ x_names: NAMES }) as unknown as Record<string, unknown>;
    expect(echo.x_names).toEqual(NAMES);
    expect((await adapter.getWorldMeta() as unknown as Record<string, unknown>).x_names).toEqual(NAMES);
    await adapter.patchWorldMeta({ x_names: null });
    expect(await adapter.getWorldMeta()).not.toHaveProperty('x_names');
  });

  it('never sends an atlas_ key or a stray field (keel would refuse the whole body)', async () => {
    const echo = await adapter.patchWorldMeta({ description: 'd', atlas_local: 1, origin: { source: null }, nope: 2 });
    expect(echo.description).toBe('d');
    expect(echo).not.toHaveProperty('atlas_local');
  });
});
