/**
 * A pasted OnlyWorlds address (src/core/open-address.ts): read by the SDK's
 * parseOwLink, handed to the #/open door as its hash, or refused in words;
 * the palette's one row for it; and which pastes stay a field's.
 */

import { describe, it, expect } from 'vitest';
import {
  ADDRESS_BROKEN_LINE, ADDRESS_NO_WORLD_LINE, ADDRESS_SLUG_LINE,
  addressIn, openHashOfAddress, pasteIsForAField,
} from '../../src/core/open-address';
import { paletteRows } from '../../src/ui/command-palette';
import { captureOpenWorld, takePendingOpen, takePendingOpenElements } from '../../src/core/open-capture';

const WORLD = '0aaa0000-0000-4000-8000-000000000001';
const EL = '0eee0000-0000-4000-8000-000000000001';
const SITE = 'https://www.onlyworlds.com/w/';

describe('a pasted OnlyWorlds address', () => {
  it('the site link to a world, and to an element, is the door\'s hash', () => {
    expect(openHashOfAddress(`${SITE}${WORLD}`)).toEqual({ hash: `#/open/${WORLD}` });
    expect(openHashOfAddress(`${SITE}${WORLD}/character/${EL}`)).toEqual({ hash: `#/open/${WORLD}/element/${EL}` });
  });
  it('the ow:// text form with its world reads the same', () => {
    expect(openHashOfAddress(`ow://${WORLD}/location/${EL}`)).toEqual({ hash: `#/open/${WORLD}/element/${EL}` });
    expect(openHashOfAddress(`ow://${WORLD}`)).toEqual({ hash: `#/open/${WORLD}` });
  });
  it('the hash is one the door takes, at the element', () => {
    const r = openHashOfAddress(`${SITE}${WORLD}/character/${EL}`) as { hash: string };
    expect(captureOpenWorld({ hash: r.hash }, { replaceState: () => {}, state: null })).toBe(true);
    expect(takePendingOpen()).toBe(WORLD);
    expect(takePendingOpenElements()).toEqual([EL]);
  });
  it('found inside a message, without the punctuation after it', () => {
    expect(openHashOfAddress(`Look at her (${SITE}${WORLD}/character/${EL}).`)).toEqual({ hash: `#/open/${WORLD}/element/${EL}` });
    expect(addressIn(`see ${SITE}${WORLD}, then`)).toBe(`${SITE}${WORLD}`);
  });
  it('a moment and a lens are set aside: the element opens', () => {
    expect(openHashOfAddress(`${SITE}${WORLD}/character/${EL}@12?lens=${EL}`)).toEqual({ hash: `#/open/${WORLD}/element/${EL}` });
  });
  it('hex in capitals reads lower case, as keel writes it', () => {
    expect(openHashOfAddress(`${SITE}${WORLD.toUpperCase()}/character/${EL.toUpperCase()}`)).toEqual({ hash: `#/open/${WORLD}/element/${EL}` });
  });
  it('a world named by its page name is refused in words, never guessed', () => {
    expect(openHashOfAddress(`${SITE}hyperion/character/${EL}`)).toEqual({ refused: ADDRESS_SLUG_LINE });
  });
  it('an element with no world is refused', () => {
    expect(openHashOfAddress(`ow://character/${EL}`)).toEqual({ refused: ADDRESS_NO_WORLD_LINE });
  });
  it('a link cut short, an unknown type or a type in capitals is refused, never opened as the world', () => {
    for (const s of [`${SITE}${WORLD}/character`, `${SITE}${WORLD}/`, `${SITE}${WORLD}/hero/${EL}`, `${SITE}${WORLD}/Character/${EL}`, `${SITE}${WORLD.slice(0, 20)}`, `HTTPS://WWW.ONLYWORLDS.COM/w/${WORLD}`]) {
      expect(openHashOfAddress(s), s).toEqual({ refused: ADDRESS_BROKEN_LINE });
    }
  });
  it('text with no address is not one: an invite, another site, plain words', () => {
    for (const s of ['https://www.onlyworlds.com/join#ow_j_abc', `https://example.com/w/${WORLD}`, 'Ada', '']) {
      expect(openHashOfAddress(s), s).toBeNull();
    }
  });
});

describe('the palette', () => {
  it('an address is one row, Open this link, carrying the door\'s hash', () => {
    const rows = paletteRows(`${SITE}${WORLD}/character/${EL}`, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'action', id: 'open-link', name: 'Open this link', link: { hash: `#/open/${WORLD}/element/${EL}` } });
  });
  it('a refused address says why on its row', () => {
    const rows = paletteRows(`${SITE}hyperion`, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ link: { refused: ADDRESS_SLUG_LINE }, snippet: ADDRESS_SLUG_LINE });
  });
  it('a plain query is searched as before', () => {
    expect(paletteRows('settings', []).some(r => r.link)).toBe(false);
  });
});

describe('which paste is the door\'s', () => {
  const at = (tag: string, attrs: Record<string, string> = {}) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    const inner = document.createElement('span');
    el.appendChild(inner);
    document.body.appendChild(el);
    return inner;
  };
  it('a field keeps its paste: an input, a textarea, an editable', () => {
    expect(pasteIsForAField(document.createElement('input'))).toBe(true);
    expect(pasteIsForAField(document.createElement('textarea'))).toBe(true);
    expect(pasteIsForAField(at('div', { contenteditable: 'true' }))).toBe(true);
    expect(pasteIsForAField(at('div', { contenteditable: '' }))).toBe(true);
  });
  it('anywhere else is the door\'s', () => {
    expect(pasteIsForAField(document.body)).toBe(false);
    expect(pasteIsForAField(at('div', { contenteditable: 'false' }))).toBe(false);
    expect(pasteIsForAField(null)).toBe(false);
  });
});
