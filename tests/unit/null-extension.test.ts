/**
 * A null extension key (x_…) on an element file, as the platform leaves one after a PATCH with null: what Atlas reads
 * and what it writes back. On read the key is kept as it came, present and holding null; on write the null survives an
 * edit of another field, a null Atlas is handed is written as null, and the wire body to keel carries it. Atlas makes no
 * null of its own on an extension key, and drops no key because it holds null.
 */

import { describe, it, expect } from 'vitest';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { memoryDirectoryWith } from '../../src/store/memory-dir';
import { toV2WireShape } from '../../src/sync/ow-v2-client-adapter';

const enc = (s: string) => new TextEncoder().encode(s);
const WORLD = enc(JSON.stringify({ id: '0192b000-0000-7000-8000-000000002355', name: 'Nulls' }));
const KIRA_ID = '0192b000-0000-7000-8000-000000000001';
const KIRA = enc(JSON.stringify({ id: KIRA_ID, type: 'character', name: 'Kira', x_note: null, x_properties: null, x_mood: 'grim' }));

async function fileBody(dir: FileSystemDirectoryHandle, id: string): Promise<Record<string, unknown>> {
  const chars = await (await dir.getDirectoryHandle('elements')).getDirectoryHandle('character');
  for await (const [name, h] of (chars as unknown as AsyncIterable<[string, FileSystemFileHandle]>)) {
    if (!name.endsWith('.json')) continue;
    const body = JSON.parse(await (await h.getFile()).text()) as Record<string, unknown>;
    if (body.id === id) return body;
  }
  throw new Error(`no file for ${id}`);
}

describe('a null extension key (the folder format)', () => {
  it('is read as it came: present, holding null', async () => {
    const dir = await memoryDirectoryWith([{ path: 'world.json', data: WORLD }, { path: 'elements/character/kira--00000001.json', data: KIRA }]);
    const store = new FsFolderStore({ disableHeartbeat: true });
    await store.open(dir);
    const el = (await store.getElement(KIRA_ID)) as unknown as Record<string, unknown>;
    expect('x_note' in el && el.x_note === null).toBe(true);
    expect('x_properties' in el && el.x_properties === null).toBe(true);
  });

  it('survives an edit of another field, written back as null', async () => {
    const dir = await memoryDirectoryWith([{ path: 'world.json', data: WORLD }, { path: 'elements/character/kira--00000001.json', data: KIRA }]);
    const store = new FsFolderStore({ disableHeartbeat: true });
    await store.open(dir);
    await store.updateElement(KIRA_ID, { name: 'Kira B' });
    const body = await fileBody(dir, KIRA_ID);
    expect(body.name).toBe('Kira B');
    expect('x_note' in body && body.x_note === null).toBe(true);
    expect('x_properties' in body && body.x_properties === null).toBe(true);
    expect(body.x_mood).toBe('grim');
  });

  it('is written as null when Atlas is handed one, and goes to keel as null', async () => {
    const dir = await memoryDirectoryWith([{ path: 'world.json', data: WORLD }]);
    const store = new FsFolderStore({ disableHeartbeat: true });
    await store.open(dir);
    const made = await store.createElement('character', { name: 'Ana', x_note: null } as never);
    const body = await fileBody(dir, made.id);
    expect('x_note' in body && body.x_note === null).toBe(true);
    for (const op of ['create', 'update'] as const) {
      const wire = toV2WireShape({ id: made.id, name: 'Ana', x_note: null, x_gone: undefined }, 'character', op);
      expect('x_note' in wire && wire.x_note === null).toBe(true);
      expect('x_gone' in wire).toBe(false);
    }
  });
});
