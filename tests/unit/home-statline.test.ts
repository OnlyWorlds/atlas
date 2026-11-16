// @vitest-environment jsdom
// Home's count line: a separator rides at the end of the item before it, and one whose next item starts a
// new line is hidden (jsdom has no layout, so each item's top is stubbed as a wrap would set it).
import { describe, expect, it } from 'vitest';
import { hideLineEndSeps } from '../../src/middle/world-home';

function line(tops: number[]): HTMLElement {
  const el = document.createElement('div');
  tops.forEach((top, i) => {
    const item = document.createElement('span');
    item.className = 'atlas-home-statline-item';
    item.appendChild(document.createElement('button'));
    if (i < tops.length - 1) {
      const sep = document.createElement('span');
      sep.className = 'atlas-home-statline-sep';
      item.appendChild(sep);
    }
    item.getBoundingClientRect = () => ({ top, left: 0, right: 0, bottom: top + 18, width: 0, height: 18, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    el.appendChild(item);
  });
  return el;
}

const shown = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.atlas-home-statline-sep')].map((s) => s.style.visibility !== 'hidden');

describe('hideLineEndSeps', () => {
  it('hides only the separator whose next item starts the next line', () => {
    const el = line([0, 0, 0, 25, 25, 50]);
    hideLineEndSeps(el);
    expect(shown(el)).toEqual([true, true, false, true, false]);
  });

  it('shows every separator on one line', () => {
    const el = line([0, 0, 0]);
    hideLineEndSeps(el);
    expect(shown(el)).toEqual([true, true]);
  });

  it('shows a separator again when the line widens', () => {
    const el = line([0, 25]);
    hideLineEndSeps(el);
    expect(shown(el)).toEqual([false]);
    (el.children[1] as HTMLElement).getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 18, width: 0, height: 18, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    hideLineEndSeps(el);
    expect(shown(el)).toEqual([true]);
  });
});
