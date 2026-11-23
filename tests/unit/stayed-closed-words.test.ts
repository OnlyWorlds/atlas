/**
 * The world lock's words (1.125.3): the take-over question says "tab", so the stayed-closed lines say
 * "tab" too, one word for one thing; the held line names what to press, with nothing left to find; the
 * wait on another tab says what it checks.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stayedClosedHere, stayedClosedWhileBusy, openElsewhereNow, checkingOtherTabLine, CHECKING_OTHER_TAB_AFTER_MS } from '../../src/sidebar/worlds-sidebar';

describe('the world lock says tab, and names what to press', () => {
  it('the held line: close that tab and open again, or open again and take it over', () => {
    expect(stayedClosedHere('Saltmere')).toBe('"Saltmere" stayed closed here. Another Atlas tab may still have it open. Close that tab and open the world again here, or open it again and choose to take it over.');
  });

  it('the moving line keeps its own second sentence, with tab', () => {
    expect(stayedClosedWhileBusy('Saltmere')).toBe('"Saltmere" stayed closed here. Another Atlas tab may still have it open, or be moving it. Open it again here once that tab is done.');
  });

  it('a world another tab took is named in quotes; one with no name is said plainly, never a phrase in quotes', () => {
    expect(openElsewhereNow('Saltmere')).toBe('"Saltmere" was closed here: another Atlas tab may have it open now. Open it again to take it back.');
    for (const none of [undefined, '', '   ']) {
      expect(openElsewhereNow(none)).toBe('The world you were on was closed here: another Atlas tab may have it open now. Open it again to take it back.');
    }
  });

  it('neither says page, as the take-over question does not', () => {
    for (const line of [stayedClosedHere('X'), stayedClosedWhileBusy('X')]) expect(line).not.toMatch(/\bpage\b/);
    const src = readFileSync(join(__dirname, '..', '..', 'src', 'sidebar', 'worlds-sidebar.ts'), 'utf8');
    expect(src).toContain('appears to be open in another Atlas tab');
  });

  it('the wait says what it checks, after a second', () => {
    expect(checkingOtherTabLine('Saltmere')).toBe('Checking whether another tab has "Saltmere" open…');
    expect(CHECKING_OTHER_TAB_AFTER_MS).toBe(1_000);
  });
});
