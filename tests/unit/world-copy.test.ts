/**
 * A view-only copy's world.json (conv. 177; folder spec §4.2's snapshot
 * rule): a fresh id, `snapshot_of`, `snapshot_at` only from a time the file
 * said, `writable: false`, every other key kept, never a link.
 */
import { describe, expect, it } from 'vitest';
import { copyChip, copyLine, copyMarkOnOpen, copyOfMeta, copyWorldJson, sameCopy, worldIsCopiedBy } from '../../src/core/world-copy';
import { entryIsViewOnly } from '../../src/core/view-only';
import type { WorldRegistryEntry } from '../../src/core/types';

const WID = '0192a000-aaaa-7bbb-8ccc-000000000001';
const AT = '2026-10-24T03:30:00+00:00';

describe('copyWorldJson', () => {
  it('sets the four keys and keeps every other key verbatim', () => {
    const file = {
      id: WID, name: 'Hollow Reach', description: 'A reach.', time_format_names: ['Year'],
      source: { server: 'https://www.onlyworlds.com', world: WID, at: AT },
      producer: { tool: 'keel', version: 'abc', input: 'server' }, x_mood: { deep: [1, 2] },
    };
    const out = copyWorldJson(file, 'fresh');
    expect(out).toEqual({ ...file, id: 'fresh', snapshot_of: WID, snapshot_at: AT, writable: false });
    expect(out.name).toBe('Hollow Reach'); // the source's name, never decorated (§4.2)
  });

  it('never carries a link', () => {
    const out = copyWorldJson({ id: WID, name: 'H', api: { world_id: WID, api_key: 'k' } }, 'fresh');
    expect('api' in out).toBe(false);
  });

  it('a time only when the file said one: its own snapshot_at first, else source.at, else none', () => {
    expect(copyWorldJson({ id: WID, name: 'H' }, 'f')).not.toHaveProperty('snapshot_at');
    expect(copyWorldJson({ id: WID, name: 'H', source: { at: 'not a time' } }, 'f')).not.toHaveProperty('snapshot_at');
    expect(copyWorldJson({ id: WID, name: 'H', snapshot_at: AT, source: { at: '2020-01-01T00:00:00Z' } }, 'f').snapshot_at).toBe(AT);
  });

  it('a copy of a copy names the original, never the copy', () => {
    const first = copyWorldJson({ id: WID, name: 'H', source: { at: AT } }, 'copy-1');
    const second = copyWorldJson(first, 'copy-2');
    expect(second).toMatchObject({ id: 'copy-2', snapshot_of: WID, snapshot_at: AT, writable: false });
  });
});

describe('copyOfMeta', () => {
  it('is a copy only on writable: false, from whatever wrote it', () => {
    expect(copyOfMeta({ id: 'x', writable: false, snapshot_of: WID, snapshot_at: AT })).toEqual({ world_id: WID, at: AT });
    expect(copyOfMeta({ id: 'x', writable: false })).toEqual({});
    expect(copyOfMeta({ id: 'x', snapshot_of: WID })).toBeNull();
    expect(copyOfMeta({ id: 'x', writable: 'false' })).toBeNull();
    expect(copyOfMeta(null)).toBeNull();
    expect(copyOfMeta([{ writable: false }])).toBeNull();
  });
});

describe('copyMarkOnOpen: the registry mirror follows world.json, only when there is one to follow', () => {
  const MARK = { world_id: WID, at: AT };
  it('a world.json that says copy marks it, whatever the registry held', () => {
    expect(copyMarkOnOpen({ id: 'x', writable: false, snapshot_of: WID, snapshot_at: AT }, undefined)).toEqual(MARK);
  });
  it('a world.json read whole without the mark takes it away (its writer made it a world of its own)', () => {
    expect(copyMarkOnOpen({ id: 'x', name: 'Hollow Reach' }, MARK)).toBeUndefined();
  });
  it('an empty or missing world.json (read as no id) says nothing, so a copy stays a copy', () => {
    // A reload in the landing's last moment left a copy's world.json empty in Firefox (#959).
    expect(copyMarkOnOpen({ id: '', name: '' }, MARK)).toEqual(MARK);
    expect(copyMarkOnOpen({ id: '', name: '' }, undefined)).toBeUndefined();
  });
});

describe('the same copy, and the words', () => {
  it('two copies are the same only with the same world and the same time', () => {
    expect(sameCopy({ world_id: WID, at: AT }, { world_id: WID, at: AT })).toBe(true);
    expect(sameCopy({ world_id: WID, at: AT }, { world_id: WID, at: '2026-10-23T03:30:00Z' })).toBe(false);
    expect(sameCopy({ world_id: WID }, { world_id: WID })).toBe(false);
    expect(sameCopy(undefined, { world_id: WID, at: AT })).toBe(false);
  });

  it('says the day when it has one, and where the world itself is', () => {
    expect(copyLine('Hollow Reach', { world_id: WID }, false)).toBe('A copy of Hollow Reach, view only.');
    const dated = copyLine('Hollow Reach', { world_id: WID, at: AT }, true);
    expect(dated).toMatch(/^A copy of Hollow Reach from .*2026, view only\. The world itself is Hollow Reach in your list of worlds\.$/);
    expect(copyChip({})).toBe('copy');
    expect(copyChip({ at: AT })).toMatch(/^copy, /);
  });

  it('knows the world a copy copies by its own id or its link', () => {
    expect(worldIsCopiedBy({ folder: { handle_key: `world-${WID}` } }, { world_id: WID })).toBe(true);
    expect(worldIsCopiedBy({ folder: { handle_key: 'world-other' }, api: { world_id: WID } }, { world_id: WID })).toBe(true);
    expect(worldIsCopiedBy({ folder: { handle_key: `world-${WID}` } }, {})).toBe(false);
  });

  it('a copy is view-only here', () => {
    const base: WorldRegistryEntry = { id: 'c', name: 'H', state: 'local-only', created_at: AT, folder: { handle_key: 'world-c', folder_name: 'h' } };
    expect(entryIsViewOnly(base)).toBe(false);
    expect(entryIsViewOnly({ ...base, copy_of: {} })).toBe(true);
  });
});
