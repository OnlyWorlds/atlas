/**
 * #855, the help room by room: the room's lines lead, the shortcut groups the
 * room uses are open, and every other group folds under "Shortcuts in other
 * rooms". A room names its groups by the reference's own labels, so a renamed
 * group would fold everything silently: the first test holds the names.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { installHotkeys, uninstallHotkeys } from '../../src/core/hotkeys';
import { buildShortcutsContent } from '../../src/ui/shortcuts-content';
import { HELP_CONTENT } from '../../src/ui/help-content';
import { openHelpOverlay } from '../../src/ui/help-overlay';

afterEach(() => { uninstallHotkeys(); document.body.innerHTML = ''; });

function labels(root: Element | null): string[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll(':scope > .atlas-shortcuts-section > .atlas-shortcuts-section-header'))
    .map(h => h.textContent ?? '');
}

describe('the help, room by room', () => {
  it('every room names groups the reference has, Global first', () => {
    installHotkeys();
    const all = labels(buildShortcutsContent().querySelector('[data-role="help-room-keys"]'));
    expect(all).toEqual(expect.arrayContaining(['Global', 'Editor', 'Writing', 'Map', 'Charts', 'Mouse']));
    for (const [room, help] of Object.entries(HELP_CONTENT)) {
      expect(help.keys[0], room).toBe('Global');
      for (const key of help.keys) expect(all, `${room}: ${key}`).toContain(key);
    }
    // And the other way: a group no room claims would sit folded everywhere.
    const claimed = new Set(Object.values(HELP_CONTENT).flatMap(h => h.keys));
    for (const label of all) expect(claimed.has(label), `no room opens ${label}`).toBe(true);
  });

  it("Writing: the room's lines first, its three groups open, the rest folded", () => {
    installHotkeys();
    openHelpOverlay('writing');
    const modal = document.querySelector('[data-modal="help-overlay"]')!;
    const room = modal.querySelector('[data-role="help-room"]')!;
    const keys = modal.querySelector('[data-role="help-keys"]')!;
    expect(room.compareDocumentPosition(keys) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(labels(modal.querySelector('[data-role="help-room-keys"]'))).toEqual(['Global', 'Editor', 'Writing']);
    const more = modal.querySelector<HTMLDetailsElement>('[data-role="help-more-keys"]')!;
    expect(more.open).toBe(false);
    expect(more.querySelector('summary')?.textContent).toBe('Shortcuts in other rooms');
    expect(labels(more.querySelector('.atlas-shortcuts-groups'))).toEqual(['Map', 'Charts', 'Mouse']);
  });

  it('Home opens only Global', () => {
    installHotkeys();
    openHelpOverlay('home');
    const modal = document.querySelector('[data-modal="help-overlay"]')!;
    expect(labels(modal.querySelector('[data-role="help-room-keys"]'))).toEqual(['Global']);
    expect(labels(modal.querySelector('[data-role="help-more-keys"] .atlas-shortcuts-groups')))
      .toEqual(['Editor', 'Writing', 'Map', 'Charts', 'Mouse']);
  });

  it('with no room (the welcome) every group is open and nothing folds', () => {
    installHotkeys();
    openHelpOverlay('welcome-nowhere');
    const modal = document.querySelector('[data-modal="help-overlay"]')!;
    expect(modal.querySelector('[data-role="help-room"]')).toBeNull();
    expect(labels(modal.querySelector('[data-role="help-room-keys"]')).length).toBe(6);
    expect(modal.querySelector('[data-role="help-more-keys"]')).toBeNull();
  });
});
