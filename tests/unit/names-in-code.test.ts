/**
 * A name inside code is left as it is on every path that finds names, as a
 * markdown story's code spans are (1.125.42): the editor keeps code as a
 * `code` mark or a `codeBlock` node, so the rich-text transform (Link all on a
 * scene with a sidecar) and the live editor's dotted hints each skip them.
 */
import { describe, it, expect } from 'vitest';
import { buildAutolinkIndex, autolinkRichtext } from '../../src/core/prose-autolink';
import { mountWorkspaceEditor } from '../../src/middle/writing-workspace-editor';
import { AUTOLINK_PLUGIN_KEY } from '../../src/middle/writing-workspace-autolink';
import type { Element } from '../../src/core/types';

const KIRA: Element = { id: '0193a1c2-7d3e-7f00-8a11-00000000c0de', type: 'character', name: 'Kira' } as unknown as Element;

interface RtNode { type: string; text?: string; marks?: Array<{ type: string }>; attrs?: { label?: string }; content?: RtNode[] }

/** One paragraph: "Ask " then Kira inside a code mark, then a code block holding Kira, then Kira plain. */
const doc = (): RtNode => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Ask ' }, { type: 'text', text: 'Kira', marks: [{ type: 'code' }] }] },
    { type: 'codeBlock', content: [{ type: 'text', text: 'Kira waits' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Then Kira came.' }] },
  ],
});

const chips = (n: RtNode): string[] =>
  n.type === 'elementChip' ? [n.attrs?.label ?? ''] : (n.content ?? []).flatMap(chips);

describe('a name inside code', () => {
  it('rich text: Link all links the plain Kira only', () => {
    const r = autolinkRichtext(doc(), buildAutolinkIndex([KIRA]));
    const out = r.doc as RtNode;
    expect(chips(out)).toEqual(['Kira']);
    expect(chips(out.content![2])).toEqual(['Kira']);
    expect(out.content![0].content![1]).toEqual({ type: 'text', text: 'Kira', marks: [{ type: 'code' }] });
    expect(out.content![1]).toEqual({ type: 'codeBlock', content: [{ type: 'text', text: 'Kira waits' }] });
  });

  it('the live editor: a hint on the plain Kira only', () => {
    const h = mountWorkspaceEditor({
      target: document.createElement('div'),
      initialJson: doc() as never,
      onUpdate: () => {},
      autolinkSeed: { elements: [KIRA] },
    });
    const decos = AUTOLINK_PLUGIN_KEY.getState(h.editor.state)?.decorations.find() ?? [];
    const hinted = decos.map(d => h.editor.state.doc.resolve(d.from).parent.textContent);
    h.destroy();
    expect(hinted).toEqual(['Then Kira came.']);
  });
});
