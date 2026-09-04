/**
 * Atlas-root registry helpers + slug utility.
 */

import { describe, it, expect } from 'vitest';
import { defaultRegistry } from '../../src/core/types';
import { setAtlasRoot, clearAtlasRoot } from '../../src/registry/registry';
import { slugify, linkedWorldMeta } from '../../src/setup/atlas-root-flow';

describe('setAtlasRoot / clearAtlasRoot', () => {
  it('records the atlas root with handle_key, folder_name, set_at', () => {
    const reg = defaultRegistry();
    const next = setAtlasRoot(reg, { handleKey: 'handle-x', folderName: 'atlas' });
    expect(next.atlas_root?.handle_key).toBe('handle-x');
    expect(next.atlas_root?.folder_name).toBe('atlas');
    expect(next.atlas_root?.set_at).toBeTruthy();
  });

  it('returns a new registry object (immutable update)', () => {
    const reg = defaultRegistry();
    const next = setAtlasRoot(reg, { handleKey: 'h', folderName: 'f' });
    expect(next).not.toBe(reg);
    expect(reg.atlas_root).toBeUndefined();
  });

  it('clearAtlasRoot strips the field entirely', () => {
    const reg = setAtlasRoot(defaultRegistry(), { handleKey: 'h', folderName: 'f' });
    const cleared = clearAtlasRoot(reg);
    expect(cleared.atlas_root).toBeUndefined();
  });

  it('setAtlasRoot overwrites a previous root', () => {
    const reg = setAtlasRoot(defaultRegistry(), { handleKey: 'h1', folderName: 'f1' });
    const next = setAtlasRoot(reg, { handleKey: 'h2', folderName: 'f2' });
    expect(next.atlas_root?.handle_key).toBe('h2');
    expect(next.atlas_root?.folder_name).toBe('f2');
  });
});

describe('slugify', () => {
  it('lowercases and replaces non-alphanumerics with hyphens', () => {
    expect(slugify('My First World')).toBe('my-first-world');
    expect(slugify('  Hello World!!  ')).toBe('hello-world');
    expect(slugify('Carl & the Dungeon')).toBe('carl-the-dungeon');
  });

  it('caps length and falls back to "world" on empty input', () => {
    expect(slugify('')).toBe('world');
    expect(slugify('!!!')).toBe('world');
    const long = 'a'.repeat(100);
    expect(slugify(long).length).toBe(32);
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello');
    expect(slugify(' / world / ')).toBe('world');
  });
});

describe('linkedWorldMeta (folder-format §4.1, ruled 2026-09-04)', () => {
  it('a linked folder carries the SERVER world id as `id`, equal to api.world_id', () => {
    const meta = linkedWorldMeta({
      serverWorldId: 'srv-0001', displayName: 'My copy', apiKey: 'ow_w_x', serverWorldName: 'Sikelia',
    });
    expect(meta.id).toBe('srv-0001');
    expect(meta.api?.world_id).toBe(meta.id);
    expect(meta.name).toBe('My copy');
    expect(meta.api?.world_name).toBe('Sikelia');
    expect(meta.api?.read_only).toBeUndefined();
  });

  it('mirrors view-only into the api block and omits an absent server name', () => {
    const meta = linkedWorldMeta({ serverWorldId: 's', displayName: 'n', apiKey: 'ow_r_x', readOnly: true });
    expect(meta.api).toEqual({ world_id: 's', api_key: 'ow_r_x', read_only: true });
  });
});
