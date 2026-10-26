/**
 * The tour's cleanup removes only tour worlds (lane A hazard H1).
 * Tour folders and a user's world called "Hyperion Tour" get the same folder
 * name from the same scaffold (`hyperion-tour-<uuid8>`), so the sweep decides
 * by content: `world.json` with `demo: true`, or no world.json at all.
 */
import { describe, it, expect } from 'vitest';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { sweepTourFolders } from '../../src/tour/tour-engine';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

describe('sweepTourFolders', () => {
  it('removes tour worlds and empty interrupted scaffolds, keeps a user world with the same name and a world.json-less folder holding elements', async () => {
    const root = new FakeDirHandle('opfs');
    root.put('hyperion-tour-aaaaaaaa/world.json', j({ id: 'a', name: 'Hyperion', demo: true }));
    root.put('hyperion-tour-bbbbbbbb/elements/character/.keep', ''); // no world.json yet, no element file
    root.put('hyperion-tour-ffffffff/elements/character/x.json', j({ id: 'x' })); // no world.json, but elements: keep
    root.put('hyperion-tour-cccccccc/world.json', j({ id: 'c', name: 'Hyperion Tour' })); // the user's
    root.put('hyperion-tour-dddddddd/world.json', '{ not json'); // unreadable: keep
    root.put('my-world-eeeeeeee/world.json', j({ id: 'e', name: 'Mine', demo: true })); // not nominated
    const removed = await sweepTourFolders(root as unknown as FileSystemDirectoryHandle);
    expect(removed.sort()).toEqual(['hyperion-tour-aaaaaaaa', 'hyperion-tour-bbbbbbbb']);
    expect(root.get('hyperion-tour-cccccccc/world.json')).not.toBeNull();
    expect(root.get('hyperion-tour-dddddddd/world.json')).not.toBeNull();
    expect(root.get('hyperion-tour-ffffffff/elements/character/x.json')).not.toBeNull();
    expect(root.get('my-world-eeeeeeee/world.json')).not.toBeNull();
  });
});
