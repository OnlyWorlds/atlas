/**
 * PROMOTED from the S365 composition gate (lens C, consumers): the grounded welcome names "add a world" when the icons are hidden.
 * Each asserts the fixed behaviour; red on the code before the gate fixes.
 */
import { describe, it, expect } from 'vitest';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { mountWelcomePanel } from '../../src/middle/welcome-panel';

describe('C3: grounded welcome, add-world icons hidden', () => {
  it('names the "add a world" button, not an icon that is hidden', () => {
    patchSlice('registry', { ...defaultRegistry(), worlds: [], worlds_add_icons: false });
    patchSlice('atlasRoot', { folderName: 'onlyworlds-atlas', pathHint: 'Docs/onlyworlds-atlas' });
    patchSlice('active', null);
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountWelcomePanel(host);
    const next = host.querySelector('.atlas-grounded-next')?.textContent ?? '';
    expect(getState().registry.worlds_add_icons).toBe(false);
    expect(next).toMatch(/add a world/i);
  });
});
