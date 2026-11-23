/**
 * A name holding `[`, `]` or a backslash is passed over by the markdown path
 * (closed scenes, Link mentions, Named in the text), so link-then-unlink gives
 * back the text it started from. The rich-text path and the open editor still
 * link it: their chip carries the label as an attribute, never as markdown.
 */
import { describe, it, expect } from 'vitest';
import {
  buildAutolinkIndex, autolinkMarkdown, autolinkRichtext, unlinkMarkdown,
} from '../../src/core/prose-autolink';
import { mountWorkspaceEditor } from '../../src/middle/writing-workspace-editor';
import { AUTOLINK_PLUGIN_KEY } from '../../src/middle/writing-workspace-autolink';
import type { Element } from '../../src/core/types';

const idOf = (n: number): string => `0193a1c2-7d3e-7f00-8a11-${n.toString(16).padStart(12, '0')}`;
const el = (n: number, name: string, extra: Record<string, unknown> = {}): Element =>
  ({ id: idOf(n), type: 'character', name, ...extra }) as unknown as Element;

interface RtNode { type: string; text?: string; attrs?: { id?: string; label?: string }; content?: RtNode[] }
const docOf = (text: string): RtNode =>
  ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

const UNSAFE: Array<[string, string]> = [
  ['Kira [the elder]', 'Then Kira [the elder] came, and Kira [the elder] left.'],
  ['[Old] Kira', 'Then [Old] Kira came.'],
  ['Kira\\', 'Then Kira\\ came.'],
  ['Ki]ra', 'Then Ki]ra came.'],
];

describe('the markdown path passes over a label it cannot carry', () => {
  for (const [name, story] of UNSAFE) {
    it(`leaves ${JSON.stringify(name)} as text, and unlink gives the story back`, () => {
      const index = buildAutolinkIndex([el(1, name)]);
      const r = autolinkMarkdown(story, index);
      expect(r.story).toBe(story);
      expect(r.linked).toEqual([]);
      expect(unlinkMarkdown(r.story).story).toBe(story);
      expect(autolinkMarkdown(story, index, idOf(1)).story).toBe(story);
    });

    it(`the open editor still hints ${JSON.stringify(name)}`, () => {
      const h = mountWorkspaceEditor({
        target: document.createElement('div'),
        initialJson: docOf(story) as never,
        onUpdate: () => {},
        autolinkSeed: { elements: [el(1, name)] },
      });
      const decos = AUTOLINK_PLUGIN_KEY.getState(h.editor.state)?.decorations.find() ?? [];
      const hinted = decos.map(d => h.editor.state.doc.textBetween(d.from, d.to, '', ''));
      h.destroy();
      expect(hinted).toEqual([name]);
    });

    it(`still links ${JSON.stringify(name)} through rich text`, () => {
      const r = autolinkRichtext(docOf(story), buildAutolinkIndex([el(1, name)]));
      const chips = ((r.doc as RtNode).content![0].content ?? []).filter(n => n.type === 'elementChip');
      expect(chips.length).toBe(1);
      expect(chips[0].attrs!.id).toBe(idOf(1));
      expect(chips[0].attrs!.label).toBe(name);
    });
  }

  it('a safe alias after the first mention is not reached: the finder gives one mention per element', () => {
    const story = 'Kira [the elder] came; later Kira left.';
    const index = buildAutolinkIndex([el(1, 'Kira [the elder]', { aliases: ['Kira'] })]);
    const r = autolinkMarkdown(story, index);
    expect(r.linked).toEqual([]);
    expect(r.story).toBe(story);
  });

  it('passes over one unsafe name and still links the others in the same story', () => {
    const story = 'Kira [the elder] met Éowyn.';
    const r = autolinkMarkdown(story, buildAutolinkIndex([el(1, 'Kira [the elder]'), el(2, 'Éowyn')]));
    expect(r.linked.map(c => c.id)).toEqual([idOf(2)]);
    expect(r.story).toBe(`Kira [the elder] met [Éowyn](ow://character/${idOf(2)}).`);
    expect(unlinkMarkdown(r.story).story).toBe(story);
  });

  it('leaves names without those characters exactly as before', () => {
    const story = 'Éowyn met Anaïs and Ana.';
    const world = [el(1, 'Éowyn'), el(2, 'Anaïs'), el(3, 'Ana')];
    const r = autolinkMarkdown(story, buildAutolinkIndex(world));
    expect(r.linked.length).toBe(3);
    expect(unlinkMarkdown(r.story).story).toBe(story);
  });
});
