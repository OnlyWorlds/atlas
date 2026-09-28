/**
 * No API key leaves Atlas in an export (S362).
 *
 * The Data room's export offered "Include API key", checked by default, on both
 * Save to file and Copy JSON. Neither keel's import nor atlas's reads a key from
 * the file, and a prefixed write key reads a private world with no PIN, so the
 * option only ever made a shared file into a read pass. The room now never asks
 * `buildWorldExport` for credentials, and the builder's default leaves them out.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { buildWorldExport } from '../../src/import/export-world';

describe('export carries no API key', () => {
  it('the Data room never requests credentials from the export builder', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/middle/import-room.ts'), 'utf8');
    expect(src).not.toMatch(/includeCredentials\s*:/);
  });

  it('the builder leaves the key out of a linked world by default', async () => {
    const store = new MockFolderStore();
    await store.open(null);
    await store.writeWorldMeta({ name: 'Linked', api: { world_id: 'w1', api_key: 'ow_w_secret' } } as never);
    await store.createElement('character', { name: 'Strahd' });
    const data = await buildWorldExport(store);
    expect(JSON.stringify(data)).not.toContain('ow_w_secret');
    // The fixture really carries a key: asked for, it is there (the negative is not vacuous).
    expect(JSON.stringify(await buildWorldExport(store, { includeCredentials: true }))).toContain('ow_w_secret');
  });
});
