/**
 * #24 (S390): "Named in the text" under Potentials. The context pane lists
 * the elements a narrative names but does not link, by the autolink kernel's
 * own first-mention pass, and links one of them alone (`only`), while the
 * full index keeps scanning so a longer name still wins its match.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildAutolinkIndex, autolinkMarkdown, autolinkRichtext } from '../../src/core/prose-autolink';
import { mountContextLists, namedInText } from '../../src/tabs/right/context-pane-lists';
import { patchSlice } from '../../src/core/state';
import type { Element } from '../../src/core/types';

function el(id: string, type: string, name: string, extra: Record<string, unknown> = {}): Element {
  return { id, type, name, ...extra } as unknown as Element;
}

const STRAHD = el('c1', 'character', 'Strahd');
const ZAROVICH = el('c2', 'character', 'Strahd von Zarovich');
const IREENA = el('c3', 'character', 'Ireena');
const BARovia = el('l1', 'location', 'Barovia');

describe('autolinkMarkdown / autolinkRichtext with only', () => {
  const index = buildAutolinkIndex([STRAHD, ZAROVICH, IREENA, BARovia]);

  it('chips that one element alone, its first mention', () => {
    const r = autolinkMarkdown('Ireena left Barovia. Ireena wept.', index, 'c3');
    expect(r.story).toBe('[Ireena](ow://character/c3) left Barovia. Ireena wept.');
    expect(r.linked.map(c => c.id)).toEqual(['c3']);
  });

  it('a longer name still wins its match: "Strahd" never chips inside "Strahd von Zarovich"', () => {
    const r = autolinkMarkdown('Strahd von Zarovich smiled. Later, Strahd.', index, 'c1');
    expect(r.story).toBe('Strahd von Zarovich smiled. Later, [Strahd](ow://character/c1).');
  });

  it('richtext: the same rule', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ireena left Barovia.' }] }] };
    const r = autolinkRichtext(doc, index, 'l1');
    expect(r.linked.map(c => c.id)).toEqual(['l1']);
    const para = (r.doc as { content: Array<{ content: Array<{ type: string; attrs?: { id?: string }; text?: string }> }> }).content[0].content;
    expect(para.map(n => n.type === 'elementChip' ? `[${n.attrs!.id}]` : n.text).join('')).toBe('Ireena left [l1].');
  });
});

describe('namedInText', () => {
  it('lists the named, unlinked elements; a linked one and the narrative itself are not named', () => {
    const scene = el('n1', 'narrative', 'Arrival', { story: 'Ireena met [Strahd](ow://character/c1) in Barovia. Strahd bowed.' });
    const world = [STRAHD, IREENA, BARovia, scene];
    expect(namedInText(scene, world).map(e => e.id)).toEqual(['c3', 'l1']);
  });

  it('an empty story names nothing', () => {
    expect(namedInText(el('n2', 'narrative', 'Blank'), [IREENA])).toEqual([]);
  });
});

describe('the Potentials column', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('shows the named elements first, each with a Link action, and no empty line', () => {
    const scene = el('n1', 'narrative', 'Arrival', { story: 'Ireena left Barovia.' });
    patchSlice('data', { elements: [IREENA, BARovia, scene] });
    const host = document.createElement('div');
    mountContextLists({ host, narrative: scene, onSelect: () => {} });
    const rows = [...host.querySelectorAll<HTMLElement>('.atlas-context-pane-list-suggested [data-named]')];
    expect(rows.map(r => r.dataset.elementId)).toEqual(['c3', 'l1']);
    expect(rows.every(r => r.querySelector('[data-action="link-named"]'))).toBe(true);
    expect(rows[0].textContent).toContain('in the text');
    expect(host.querySelector('.atlas-context-pane-list-suggested .atlas-context-pane-empty')).toBeNull();
  });
});
