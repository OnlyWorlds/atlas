/**
 * The span writers behind the context pane's Link all: the closed scene's
 * rich text and the open editor each chip what the element's own finder
 * finds, never inside a web link, never inside a chip; and the count over a
 * large world stays linear in its text.
 */
import { describe, it, expect } from 'vitest';
import { elementSpans, linkSpansRichtext } from '../../src/core/prose-autolink';
import { findUnlinkedMentions } from '../../src/core/unlinked-mentions';
import { linkSpansInEditor, mountWorkspaceEditor } from '../../src/middle/writing-workspace-editor';
import type { Element } from '../../src/core/types';

const ID = '0193a1c2-7d3e-7f00-8a11-000000000001';
const eowyn = { id: ID, type: 'character', name: 'Éowyn' } as unknown as Element;
const target = { id: ID, type: 'character' };

interface RtNode { type: string; text?: string; marks?: unknown[]; attrs?: Record<string, unknown>; content?: RtNode[] }
const para = (...content: RtNode[]): RtNode => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
const text = (s: string, marks?: unknown[]): RtNode => ({ type: 'text', text: s, ...(marks ? { marks } : {}) });
const webLink = [{ type: 'link', attrs: { href: 'https://example.com' } }];
const chip: RtNode = { type: 'elementChip', attrs: { id: ID, type: 'character', label: 'Éowyn' } };

describe('linkSpansRichtext', () => {
  it('chips every span of a text node, leaves a web link and a chip alone, and never mutates its input', () => {
    const doc = para(text('Éowyn rode '), text('Éowyn', webLink), text(' past '), chip, text(' and ÉOWYN.'));
    const before = JSON.stringify(doc);
    const r = linkSpansRichtext(doc, elementSpans(eowyn)!, target);
    expect(r.linked).toBe(2);
    const out = (r.doc as RtNode).content![0].content!;
    expect(out.filter(n => n.type === 'elementChip').map(n => n.attrs!.label)).toEqual(['Éowyn', 'Éowyn', 'ÉOWYN']);
    expect(out.find(n => n.marks)?.text).toBe('Éowyn');
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('linkSpansInEditor', () => {
  it('chips the spans of the live doc in one transaction, passing over a linked node', () => {
    const h = mountWorkspaceEditor({
      target: document.createElement('div'),
      initialJson: para(text('Éowyn rode, Éowyn sang, '), text('Éowyn', webLink), text('.')) as never,
      onUpdate: () => {},
    });
    try {
      let dispatches = 0;
      const dispatch = h.editor.view.dispatch.bind(h.editor.view);
      h.editor.view.dispatch = (tr) => { dispatches++; dispatch(tr); };
      expect(linkSpansInEditor(h.editor, elementSpans(eowyn)!, target)).toBe(2);
      expect(dispatches).toBe(1);
      const chips: string[] = [];
      h.editor.state.doc.descendants(n => { if (n.type.name === 'elementChip') chips.push(String(n.attrs.label)); });
      expect(chips).toEqual(['Éowyn', 'Éowyn']);
      expect(h.editor.state.doc.textContent).toContain('Éowyn.');
    } finally {
      h.destroy();
    }
  });

  it('leaves a code block whole', () => {
    const doc = { type: 'doc', content: [
      { type: 'codeBlock', content: [text('Éowyn in code, Éowyn again')] },
      { type: 'paragraph', content: [text('Then Éowyn.')] },
    ] };
    const h = mountWorkspaceEditor({ target: document.createElement('div'), initialJson: doc as never, onUpdate: () => {} });
    try {
      expect(linkSpansInEditor(h.editor, elementSpans(eowyn)!, target)).toBe(1);
      const json = h.editor.getJSON();
      expect(json.content?.map(n => n.type)).toEqual(['codeBlock', 'paragraph']);
      expect((json.content?.[0].content?.[0] as { text?: string } | undefined)?.text).toBe('Éowyn in code, Éowyn again');
    } finally {
      h.destroy();
    }
  });
});

describe('the count on a large world is linear in its text', () => {
  /** The best of three runs: load on a shared machine only ever adds time. */
  const timed = (f: () => unknown): number => {
    let best = Infinity;
    for (let i = 0; i < 3; i++) { const t = performance.now(); f(); best = Math.min(best, performance.now() - t); }
    return best;
  };
  // An alias of 200 code points of repeating words: the finder's worst ordinary shape.
  const longAlias = 'the '.repeat(50).slice(0, 196) + ' end';
  const subject = { id: ID, type: 'character', name: 'Éowyn', atlas_aliases: [longAlias] } as unknown as Element;
  const story = ('the rider and the end of the road, Éowyn said. '.repeat(520)).slice(0, 25_000);
  const worldOf = (n: number): Element[] => [subject, ...Array.from({ length: n }, (_, i) =>
    ({ id: `n${i}`, type: 'narrative', name: `Scene ${i}`, story }) as unknown as Element)];

  it('200 scenes of 25 KB (5 MB) against 50', () => {
    const small = worldOf(50);
    const big = worldOf(200);
    expect(findUnlinkedMentions(subject, small).total).toBeGreaterThan(1000);
    // A fresh array each run: the count is cached per elements array.
    const a = Math.max(timed(() => findUnlinkedMentions(subject, [...small])), 5);
    const b = timed(() => findUnlinkedMentions(subject, [...big]));
    expect(b, `${b.toFixed(0)} ms at 5 MB`).toBeLessThan(1_500);
    expect(b / a, `grew ${(b / a).toFixed(1)}x for 4x the text (${a.toFixed(0)} ms, ${b.toFixed(0)} ms)`).toBeLessThan(8);
  }, 60_000);
});
