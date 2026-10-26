/**
 * Shortcuts overlay: every hotkey part renders as a kbd chip, Mac included
 * and Escape included.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { installHotkeys, uninstallHotkeys } from '../../src/core/hotkeys';
import { buildShortcutsContent } from '../../src/ui/shortcuts-content';

afterEach(() => uninstallHotkeys());

function rows(): Array<{ dt: string; kbds: string[] }> {
  const root = buildShortcutsContent();
  return Array.from(root.querySelectorAll('dt')).map(dt => ({
    dt: dt.textContent ?? '',
    kbds: Array.from(dt.querySelectorAll('kbd')).map(k => k.textContent ?? ''),
  }));
}

describe('shortcuts overlay chips', () => {
  it('Mac: Cmd+Shift+F renders three chips', () => {
    const ua = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent')!;
    Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)' });
    try {
      installHotkeys();
      const focus = rows().find(x => x.kbds.join('|') === '⌘|Shift|F');
      expect(focus).toBeDefined();
      expect(rows().find(x => x.kbds.join('|') === '⌘|E')).toBeDefined();
    } finally {
      Object.defineProperty(window.navigator, 'userAgent', { configurable: true, get: ua.get });
    }
  });

  it('Windows: the Escape binding gets a chip', () => {
    installHotkeys();
    expect(rows().find(x => x.kbds.join('|') === 'Escape')).toBeDefined();
  });

  it('Windows: Ctrl+E renders two chips', () => {
    installHotkeys();
    expect(rows().find(x => x.kbds.join('|') === 'Ctrl|E')).toBeDefined();
  });
});
