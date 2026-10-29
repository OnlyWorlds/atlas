/**
 * An export carries what a non-member reader of the world is served (folder spec guidance,
 * 2026-10-29): who and which tool wrote each element (`created_by`, `changed_by`, `changed_via`,
 * `changed_client`, `doors`) describes the server's record for its members, so it stays in the
 * folder and leaves no export. keel's own stamps a public reader gets (`created_at`, `updated_at`)
 * travel as before.
 */
import { describe, it, expect } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { buildWorldExport } from '../../src/import/export-world';
import { SERVER_AUTHOR_FIELDS } from '../../src/core/constants';

describe('export leaves the author fields out', () => {
  it('every one of the five, from a pulled element, while the folder keeps them', async () => {
    const store = new MockFolderStore();
    await store.open(null);
    await store.writeWorldMeta({ name: 'Linked' } as never);
    const pulled = {
      id: '00000000-0000-4000-8000-0000000000f1', type: 'character', name: 'Strahd',
      created_by: 'm-1', changed_by: 'm-2', changed_via: 'mcp', changed_client: 'lantern',
      doors: { lantern: '2026-10-29T12:00:00Z' }, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-29T12:00:00Z',
    };
    await store.applyServerRecord('character', pulled, '2026-10-29T12:00:00Z');
    const onDisk = (await store.getElement(pulled.id)) as unknown as Record<string, unknown>;
    for (const f of SERVER_AUTHOR_FIELDS) expect(onDisk[f], f).toBeDefined();

    const data = await buildWorldExport(store) as Record<string, unknown>;
    const row = (data.elements as Record<string, Record<string, unknown>[]>).character[0];
    expect(row.name).toBe('Strahd');
    for (const f of SERVER_AUTHOR_FIELDS) expect(row, f).not.toHaveProperty(f);
    expect(row.created_at).toBe('2026-10-01T00:00:00Z');
  });
});
