/**
 * Ctrl+K's world doors per browser (1.17, contract §8, conv. 120): "add a
 * world" where either a folder or browser storage works, "open a world file"
 * wherever browser storage works, "open a world folder" with the folder
 * picker only. A door that needs browser storage asks the probe, never the
 * API's shape: a Firefox private window has the shape and refuses the call.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const caps = vi.hoisted(() => ({ folder: true, opfs: true as boolean }));
vi.mock('../../src/core/capabilities', async (orig) => ({
  ...(await orig<typeof import('../../src/core/capabilities')>()),
  hasFolderMode: () => caps.folder,
  browserStorageDoorOpen: () => caps.opfs,
}));

import { searchPalette } from '../../src/ui/command-palette';

const offered = (q: string) => searchPalette(q, []).filter(r => r.kind === 'action').map(r => r.id);

afterEach(() => { caps.folder = true; caps.opfs = true; });

describe('the palette\'s world doors', () => {
  it('Chromium: add a world, open a world folder, open a world file', () => {
    expect(offered('open a world')).toEqual(expect.arrayContaining(['open-world-folder', 'open-world-file']));
    expect(offered('add')).toContain('add-world');
    expect(offered('zip')).toEqual(['open-world-file']);
  });

  it('Firefox and Safari: add a world and open a world file, no folder door', () => {
    caps.folder = false;
    expect(offered('open a world')).toEqual(['open-world-file']);
    expect(offered('add')).toContain('add-world');
  });

  it('a window that refuses browser storage: no file door; add a world only where a folder works', () => {
    caps.opfs = false;
    expect(offered('open a world file')).not.toContain('open-world-file');
    expect(offered('add')).toContain('add-world');
    caps.folder = false;
    expect(offered('add')).not.toContain('add-world');
    expect(offered('open')).toEqual([]);
  });
});
