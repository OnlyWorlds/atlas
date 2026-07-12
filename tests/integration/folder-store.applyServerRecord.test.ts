/**
 * folder-store applyServerRecord — atlas-local field preservation.
 *
 * Regression test for the silent-data-loss vector verified in Bout V (session 202):
 * `applyServerRecord` used to overlay the server record without consulting the
 * existing local file, so atlas-extension fields (image_media_id and any future
 * additions in ATLAS_LOCAL_EXTENSION_FIELDS) were destroyed on every pull that
 * touched the element. The server doesn't know about these fields, so its
 * response never carries them — preservation must come from the existing file.
 *
 * Two store implementations honor the same contract: FsFolderStore (real, FS
 * Access API) and MockFolderStore (in-memory test fixture). This test exercises
 * MockFolderStore; FsFolderStore is exercised via Playwright e2e elsewhere.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MonotonicClock } from '../fixtures/monotonic-clock';

let folder: MockFolderStore;
let clock: MonotonicClock;

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
});

describe('applyServerRecord — atlas-local field preservation', () => {
  it('preserves image_media_id when overlaying a server update on a map', async () => {
    // Create a Map locally with a local image binding.
    const map = await folder.createMap({ name: 'Barovia', image_media_id: 'media-local-123' });
    // Establish a server baseline so this looks like a previously-synced element.
    await folder.stampServerUpdatedAt(map.id, 'map', '2026-01-01T01:00:00.000Z');

    // Simulate a pull: server returns an update (new description) but no
    // image_media_id — the server has no concept of it.
    await folder.applyServerRecord(
      'map',
      { id: map.id, name: 'Barovia', description: 'A dark land of mists' },
      '2026-01-01T02:00:00.000Z'
    );

    const after = await folder.getMap(map.id);
    expect(after).not.toBeNull();
    expect(after!.image_media_id).toBe('media-local-123');
    expect(after!.description).toBe('A dark land of mists');
    // Sync metadata stamped to server's authoritative value.
    expect(after!.server_updated_at).toBe('2026-01-01T02:00:00.000Z');
    expect(after!.local_updated_at).toBe('2026-01-01T02:00:00.000Z');
  });

  it('preserves image_media_id across multiple pull updates', async () => {
    const map = await folder.createMap({ name: 'Borca', image_media_id: 'media-7' });
    await folder.stampServerUpdatedAt(map.id, 'map', '2026-01-01T01:00:00.000Z');

    // First update.
    await folder.applyServerRecord(
      'map',
      { id: map.id, name: 'Borca', description: 'first' },
      '2026-01-01T02:00:00.000Z'
    );
    // Second update — image_media_id should STILL be preserved (read from the
    // post-first-update local file).
    await folder.applyServerRecord(
      'map',
      { id: map.id, name: 'Borca', description: 'second' },
      '2026-01-01T03:00:00.000Z'
    );

    const after = await folder.getMap(map.id);
    expect(after!.image_media_id).toBe('media-7');
    expect(after!.description).toBe('second');
  });

  it('does NOT preserve image_media_id when the local file lacks it', async () => {
    // Defensive: no existing file means nothing to preserve. The server's
    // record passes through unmodified (server doesn't supply image_media_id,
    // so it stays undefined).
    await folder.applyServerRecord(
      'map',
      { id: 'fresh-map-id', name: 'NewMap', description: 'never local before' },
      '2026-01-01T01:00:00.000Z'
    );

    const after = await folder.getMap('fresh-map-id');
    expect(after).not.toBeNull();
    expect(after!.image_media_id).toBeUndefined();
    expect(after!.description).toBe('never local before');
  });

  it('does not let server response override image_media_id if both present', async () => {
    // Edge case: if server somehow returns a value for image_media_id (it
    // shouldn't, but adapter strips on write so the field never leaves local),
    // we still preserve the local value. Preservation order: server record
    // first, then preserved overrides — local wins.
    const map = await folder.createMap({ name: 'Forlorn', image_media_id: 'local-real' });
    await folder.stampServerUpdatedAt(map.id, 'map', '2026-01-01T01:00:00.000Z');

    await folder.applyServerRecord(
      'map',
      {
        id: map.id,
        name: 'Forlorn',
        description: 'updated',
        image_media_id: 'server-ghost-value', // shouldn't happen, but if it does
      },
      '2026-01-01T02:00:00.000Z'
    );

    const after = await folder.getMap(map.id);
    expect(after!.image_media_id).toBe('local-real');
  });

  it('preservation also kicks in via resolveConflict pull-theirs path', async () => {
    // pull-theirs uses applyServerRecord — same fix, same protection.
    // We don't drive a full SyncEngine here; just verify the underlying
    // contract: when applyServerRecord is invoked on an existing map with
    // image_media_id set, the field survives even if the caller is the
    // explicit pull-theirs conflict resolution.
    const map = await folder.createMap({ name: 'Hazlan', image_media_id: 'local-X' });
    await folder.updateMap(map.id, { description: 'local-edit-pending' });
    await folder.stampServerUpdatedAt(map.id, 'map', '2026-01-01T01:00:00.000Z');

    // User invoked pull-theirs — server's record overlays local edit but
    // atlas-local fields stay put.
    await folder.applyServerRecord(
      'map',
      { id: map.id, name: 'Hazlan', description: 'server-version' },
      '2026-01-01T02:00:00.000Z'
    );

    const after = await folder.getMap(map.id);
    expect(after!.description).toBe('server-version'); // server won as user asked
    expect(after!.image_media_id).toBe('local-X');     // but local image binding survives
  });

  // Future-proofing: when ATLAS_LOCAL_EXTENSION_FIELDS grows, this test still
  // works because the preservation loop walks the list dynamically. No
  // explicit per-field test needed — the contract is "every field in the
  // ATLAS_LOCAL_EXTENSION_FIELDS list is preserved if present locally."

  it('preserves atlas_page_blocks (a different LOCAL_ONLY field) across a server update that lacks it', async () => {
    const page = await folder.createElement('narrative', { name: 'Chapter One', subtype: 'page' });
    await folder.updateElement(page.id, { atlas_page_blocks: [{ kind: 'text', value: 'intro' }] });
    await folder.stampServerUpdatedAt(page.id, 'narrative', '2026-01-01T01:00:00.000Z');

    // Server pull carries the synced `story` field but never atlas_page_blocks
    // — the API doesn't know about it.
    await folder.applyServerRecord(
      'narrative',
      { id: page.id, name: 'Chapter One', story: 'intro' },
      '2026-01-01T02:00:00.000Z'
    );

    const after = await folder.getElement(page.id);
    expect(after!.atlas_page_blocks).toEqual([{ kind: 'text', value: 'intro' }]);
  });
});

describe('applyServerRecord — WIRE extension field split (gate 10.3)', () => {
  it('server value wins when the server record carries atlas_shape', async () => {
    const zone = await folder.createZone({ name: 'Border Forest', atlas_shape: 'polygon' });
    await folder.stampServerUpdatedAt(zone.id, 'zone', '2026-01-01T01:00:00.000Z');

    await folder.applyServerRecord(
      'zone',
      { id: zone.id, name: 'Border Forest', atlas_shape: 'line' },
      '2026-01-01T02:00:00.000Z'
    );

    const after = await folder.getZone(zone.id);
    expect(after!.atlas_shape).toBe('line');
  });

  it('preserves local atlas_shape when the server record omits the field entirely', async () => {
    const zone = await folder.createZone({ name: 'Border Forest', atlas_shape: 'polygon' });
    await folder.stampServerUpdatedAt(zone.id, 'zone', '2026-01-01T01:00:00.000Z');

    // No atlas_shape at all — e.g. a v1-era or non-atlas client wrote this record.
    await folder.applyServerRecord(
      'zone',
      { id: zone.id, name: 'Border Forest' },
      '2026-01-01T02:00:00.000Z'
    );

    const after = await folder.getZone(zone.id);
    expect(after!.atlas_shape).toBe('polygon');
  });

  it('lands an explicit server null for atlas_color instead of resurrecting the local value', async () => {
    const zone = await folder.createZone({ name: 'Village Square', atlas_color: '#ff0000' });
    await folder.stampServerUpdatedAt(zone.id, 'zone', '2026-01-01T01:00:00.000Z');

    await folder.applyServerRecord(
      'zone',
      { id: zone.id, name: 'Village Square', atlas_color: null },
      '2026-01-01T02:00:00.000Z'
    );

    const after = await folder.getZone(zone.id);
    // `field in record` is true for an explicit null, so the WIRE branch
    // treats the field as present and does NOT fall back to local — the
    // server's clear lands as-is rather than being resurrected.
    expect(after!.atlas_color).toBeNull();
  });

  it('LOCAL_ONLY field still wins even if a misbehaving server record carries it (edge case, gate 10.3)', async () => {
    // This is the SAME contract as "does not let server response override
    // image_media_id if both present" above, re-verified here for a second
    // LOCAL_ONLY field so the new ATLAS_LOCAL_ONLY_FIELDS constant is locked
    // on more than one member.
    //
    // Implementation verdict (read from folder-store-fs.ts / mock-folder-store.ts
    // applyServerRecord): the LOCAL_ONLY preserve loop has no `field in record`
    // guard — it unconditionally copies the existing local value into
    // `preserved` whenever it's defined, and `preserved` is spread AFTER
    // `...record` in the final object. So local wins even when the server
    // carries a value for a field it isn't supposed to know about.
    const page = await folder.createElement('narrative', { name: 'Chapter Two', subtype: 'page' });
    await folder.updateElement(page.id, { atlas_page_blocks: ['local-block'] });
    await folder.stampServerUpdatedAt(page.id, 'narrative', '2026-01-01T01:00:00.000Z');

    await folder.applyServerRecord(
      'narrative',
      { id: page.id, name: 'Chapter Two', atlas_page_blocks: ['server-ghost-block'] },
      '2026-01-01T02:00:00.000Z'
    );

    const after = await folder.getElement(page.id);
    expect(after!.atlas_page_blocks).toEqual(['local-block']);
  });
});
