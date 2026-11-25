/**
 * 1.125.34: a link's label written and read escaped. The editor's chip writes
 * its label with `\`, `[` and `]` escaped, the find bar's "Link to element"
 * writes the span it links the same way, and every reader takes a link by one
 * grammar (`src/core/markdown-link-label.ts`) and draws its label unescaped.
 * One describe for each thing the change must hold (what the share scrub
 * must hold lives in `share-payload.test.ts`, beside the scrub's other forms).
 */
import { describe, it, expect } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { ElementChip } from '../../src/middle/writing-workspace-element-chip';
import { convertLinkMarksToChips } from '../../src/middle/writing-workspace-load';
import { serializeDocToMarkdown, storyForReaders } from '../../src/middle/writing-workspace-markdown';
import { storyOutranksSidecar } from '../../src/middle/story-sidecar';
import { authoritativeHalf } from '../../src/middle/writing-bulk-link';
import { renderProseFragment, buildCompiledTree, compiledWordCount } from '../../src/middle/writing-compiled';
import { markdownToPlainText } from '../../src/middle/writing-word-count';
import { buildPagePayload, type PayloadCircleBlock } from '../../src/core/share-payload';
import { renderPayloadCard } from '../../src/middle/share-page-render';
import type { ElementCardBlock } from '../../src/core/sharing';
import {
  autolinkMarkdown, buildAutolinkIndex, elementSpans, findSpansMarkdown, findTermSpansMarkdown,
  linkSpansMarkdown, linkTermMarkdown, unlinkMarkdown, MENTIONS_MARKDOWN,
} from '../../src/core/prose-autolink';
import type { Element } from '../../src/core/types';

const ID = '0193a1c2-7d3e-7f00-8a11-000000000001';
const ID2 = '0193a1c2-7d3e-7f00-8a11-000000000002';
const L = `ow://character/${ID}`;
const L2 = `ow://character/${ID2}`;

const el = (id: string, name: string, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: 'character', name, ...extra }) as unknown as Element;
const KIRA = el(ID2, 'Kira');
const onPage = new Map<string, Element>([[ID, el(ID, 'The elder')], [ID2, KIRA]]);

const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const t = (text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const chip = (label: string, id = ID): JSONContent => ({ type: 'elementChip', attrs: { id, type: 'character', label } });
const sceneOf = (label: string): JSONContent => ({ type: 'doc', content: [p(t('Then '), chip(label), t(' came.'))] });

/** What the editor reads a story as: its chips' labels and its text, in order. */
function editorRead(md: string): Array<{ chip: string } | { text: string }> {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit as never, Markdown, ElementChip as never],
    content: md,
    contentType: 'markdown',
  });
  try {
    const out: Array<{ chip: string } | { text: string }> = [];
    const walk = (n: JSONContent): void => {
      if (n.type === 'elementChip') out.push({ chip: String(n.attrs?.label) });
      else if (n.type === 'text') {
        const last = out[out.length - 1];
        if (last && 'text' in last) last.text += n.text ?? '';
        else out.push({ text: n.text ?? '' });
      }
      (n.content ?? []).forEach(walk);
    };
    walk(convertLinkMarksToChips(editor.getJSON()));
    return out;
  } finally {
    editor.destroy();
  }
}

/** The chips a drawn fragment holds, by their text. */
const chipsIn = (node: HTMLElement): string[] =>
  [...node.querySelectorAll('.atlas-element-chip')].map(c => c.textContent ?? '');

// From the fifth on, named like a link, or holding one (1.125.36): the editor read `[x](https://x.test)`, an
// autolink or an HTML tag in a label escaped only at its brackets as a web link inside the chip.
const LINK_SHAPED = [
  '[x](https://x.test)', 'a [x](https://x.test) b', '[x](<https://e.test>)', '<https://e.test>',
  '[x]<https://e.test>', '\\<https://e.test>', '<a href="https://e.test">x</a>', 'A < B and C > D',
];
const NAMES = ['Kira [the elder]', 'Kira\\', 'Ki]ra', 'Kira [the elder', ...LINK_SHAPED, 'f(x) and )('];

describe('done when 1: a chip whose name holds a bracket or a backslash comes back from its story alone', () => {
  for (const name of NAMES) {
    it(`${JSON.stringify(name)} reopens as that chip and unlinks to its name`, () => {
      const story = serializeDocToMarkdown(sceneOf(name));
      expect(editorRead(story)).toEqual([{ text: 'Then ' }, { chip: name }, { text: ' came.' }]);
      const unlinked = unlinkMarkdown(story);
      expect(unlinked.unlinked).toBe(1);
      // A known gap: unlinked, the editor autolinks the bare address inside an HTML-tag name (text and address
      // equal, up to the next space), which takes the backslash before `</a>`, so the tag is read and dropped.
      // Every other name comes back as its text.
      if (name.includes('</')) expect(editorRead(unlinked.story)).toEqual([{ text: 'Then <a href="https://e.test">x\\ came.' }]);
      else expect(editorRead(unlinked.story)).toEqual([{ text: `Then ${name} came.` }]);
    });
  }
});

describe('done when 2: a scene saved before 1.125.34 opens and publishes from its sidecar', () => {
  // The story 1b913e5's serializer wrote for this sidecar: the chip escaped `]` alone (forms B and C), and a
  // moment link's text not at all.
  const sidecar: JSONContent = {
    type: 'doc',
    content: [p(
      chip('Kira [the elder]'), t(' met '), t('Ki]ra', [{ type: 'link', attrs: { href: `${L}@5` } }]),
      t(' and '), chip('Kira\\'), t(' left.'),
    )],
  };
  const OLD = `[Kira [the elder\\]](${L}) met [Ki]ra](${L}@5) and [Kira\\](${L}) left.`;

  it('the story is Atlas\'s own save: storyOutranksSidecar false, authoritativeHalf "sidecar"', async () => {
    expect(storyOutranksSidecar(sidecar, OLD)).toBe(false);
    await expect(authoritativeHalf(OLD, sidecar)).resolves.toBe('sidecar');
  });

  it('a parenthesis is escaped only right after a bracket: "John (the younger)" is written as it always was', () => {
    expect(serializeDocToMarkdown(sceneOf('John (the younger)'))).toBe(`Then [John (the younger)](${L}) came.`);
    expect(serializeDocToMarkdown(sceneOf('[x](https://x.test)'))).toBe(`Then [\\[x\\]\\(https://x.test)](${L}) came.`);
  });

  // A chip named with parentheses, saved by an earlier escape, is still Atlas's own save (a guard for any
  // later change to which parentheses are escaped).
  it('a chip named with parentheses, saved by an earlier escape, keeps its sidecar', async () => {
    const parens: JSONContent = { type: 'doc', content: [p(chip('John (the younger)'), t(' and '), chip('Kira [the elder] (x)'), t(' left.'))] };
    const before134 = `[John (the younger)](${L}) and [Kira [the elder\\] (x)](${L}) left.`; // `]` alone
    const from134 = `[John (the younger)](${L}) and [Kira \\[the elder\\] (x)](${L}) left.`; // 1.125.34 and 1.125.35
    for (const story of [before134, from134]) {
      expect(storyOutranksSidecar(parens, story)).toBe(false);
      await expect(authoritativeHalf(story, parens)).resolves.toBe('sidecar');
    }
    // And the 1.125.34 form still opens whole from its story alone (a scene pulled from OnlyWorlds).
    expect(editorRead(from134)).toEqual([{ chip: 'John (the younger)' }, { text: ' and ' }, { chip: 'Kira [the elder] (x)' }, { text: ' left.' }]);
  });

  // The code gate's M1: 1.125.34 and 1.125.35 wrote a link-shaped chip with its brackets escaped alone. Such a
  // story is still Atlas's own save, and its readers draw the sidecar written now.
  for (const name of LINK_SHAPED) {
    it(`a chip named ${JSON.stringify(name)}, saved by 1.125.34, keeps its sidecar`, async () => {
      const scene = sceneOf(name);
      const story134 = `Then [${name.replace(/[\\[\]]/g, '\\$&')}](${L}) came.`;
      expect(storyOutranksSidecar(scene, story134)).toBe(false);
      await expect(authoritativeHalf(story134, scene)).resolves.toBe('sidecar');
      expect(storyForReaders(story134, scene)).toBe(serializeDocToMarkdown(scene));
    });
  }

  it('an escaped parenthesis or < in prose is drawn as the character (a label a page left off)', () => {
    const prose = 'Then \\[x\\]\\(https://x.test) and \\<b\\> came.';
    expect(renderProseFragment(prose, new Map()).textContent).toBe('Then [x](https://x.test) and <b\\> came.');
    expect(markdownToPlainText(prose)).toBe('Then [x](https://x.test) and <b\\> came.');
  });

  const CIRCLE = 'c1000000-0000-0000-0000-000000000001';
  const ENTRY = 'e1000000-0000-0000-0000-000000000001';
  const world = (): Element[] => [
    el(ID, 'The elder'),
    { id: CIRCLE, type: 'collective', name: 'the party', subtype: 'circle', characters: [] } as unknown as Element,
    { id: ENTRY, type: 'narrative', name: 'the meeting', subtype: 'knowledge', story: OLD,
      atlas_richtext_json: sidecar, collectives: [CIRCLE] } as unknown as Element,
  ];
  const page = (withCard: boolean): Element => ({
    id: 'p1000000-0000-0000-0000-000000000001', type: 'narrative', name: 'page', subtype: 'page',
    atlas_page_blocks: [
      { id: 'b1', kind: 'circle', knowerId: CIRCLE },
      ...(withCard ? [{ id: 'b2', kind: 'element-card', elementId: ID, variant: 'compact', fields: [] }] : []),
    ],
    atlas_page_refs: withCard ? [CIRCLE, ID] : [CIRCLE],
  } as unknown as Element);
  const published = (withCard: boolean): string => {
    const payload = buildPagePayload(page(withCard), world());
    return (payload.blocks[0] as PayloadCircleBlock).entries[0].markdown;
  };

  it('published with the element on the page: each chip whole', () => {
    const md = published(true);
    const drawn = renderProseFragment(md, new Map([[ID, el(ID, 'The elder')]]), { unresolved: 'text' });
    expect(chipsIn(drawn)).toEqual(['Kira [the elder]', 'Kira\\']);
    expect(drawn.textContent).toBe(`Kira [the elder] met [Ki]ra](${L}@5) and Kira\\ left.`);
  });

  it('published with the element left off: each label as text, no bracket moved, no address', () => {
    const md = published(false);
    expect(md).not.toContain(ID);
    const drawn = renderProseFragment(md, new Map(), { unresolved: 'text' });
    expect(chipsIn(drawn)).toEqual([]);
    expect(drawn.textContent).toBe('Kira [the elder] met [Ki]ra]() and Kira\\ left.');
  });

  // A card draws a field's text as written, Markdown marks and all (the code gate's S1: a plain field is not
  // Markdown, so nothing in it is unescaped); the story it holds is the sidecar written now.
  it('a full card of the scene: its story field reads the sidecar as written now, drawn as text', () => {
    const SCENE = 'd1000000-0000-0000-0000-000000000001';
    const elements = [
      el(ID, 'The elder'),
      { id: SCENE, type: 'narrative', name: 'the meeting', story: OLD, atlas_richtext_json: sidecar } as unknown as Element,
    ];
    const card = { id: 'b1', kind: 'element-card', elementId: SCENE, variant: 'full', fields: ['story'] };
    const payload = buildPagePayload({
      id: 'p2000000-0000-0000-0000-000000000001', type: 'narrative', name: 'page', subtype: 'page',
      atlas_page_blocks: [card], atlas_page_refs: [SCENE],
    } as unknown as Element, elements);
    expect(JSON.stringify(payload)).not.toContain(ID);
    const drawn = renderPayloadCard(payload.blocks[0] as ElementCardBlock, payload.elements);
    expect(drawn.querySelector('.atlas-share-card-field-value')?.textContent)
      .toBe('Kira \\[the elder\\] met [Ki]ra]() and Kira\\\\ left.');
  });

  it('the compiled view and its word count read the sidecar as written now', () => {
    const scene = { id: ENTRY, type: 'narrative', name: 's', story: OLD, atlas_richtext_json: sidecar } as unknown as Element;
    const tree = buildCompiledTree(scene, [scene], 'w');
    expect(chipsIn(renderProseFragment(tree.prose, onPage))).toEqual(['Kira [the elder]', 'Kira\\']);
    expect(compiledWordCount(scene, [scene], 'w')).toBe(8);
  });
});

describe('done when 3: no markdown path writes a link inside a link', () => {
  const INPUTS: Array<[string, string]> = [
    ['A', `[Kira \\[the elder\\]](${L})`],
    ['C', `[Kira\\\\](${L})`],
    ['D', `[Ki\\]ra](${L})`],
    ['E', `[Kira \\[the elder](${L})`],
    ['F', `A [note: [Kira](${L})`],
    ['a balanced label', '[Kira [1]](https://x.test)'],
    ['a titled link', `[Kira](${L} "t")`],
    ['a link inside a link', `[[Kira](${L})](https://x.test)`],
  ];
  const index = buildAutolinkIndex([KIRA]);
  const spans = elementSpans(KIRA)!;
  for (const [key, story] of INPUTS) {
    it(`${key}: autolink, the find bar and Link all leave it as it is`, () => {
      expect(autolinkMarkdown(story, index).story).toBe(story);
      expect(findTermSpansMarkdown(story, 'Kira')).toEqual([]);
      expect(linkTermMarkdown(story, 'Kira', { id: ID2, type: 'character' }).story).toBe(story);
      expect(findSpansMarkdown(story, spans, MENTIONS_MARKDOWN)).toEqual([]);
      expect(linkSpansMarkdown(story, spans, { id: ID2, type: 'character' }, MENTIONS_MARKDOWN).story).toBe(story);
    });
  }

  it('B is prose "[Kira " and a link "the elder]" to every reader, so its Kira is prose: the link written stands outside', () => {
    const story = `[Kira [the elder\\]](${L})`;
    expect(editorRead(story)).toEqual([{ text: '[Kira ' }, { chip: 'the elder]' }]);
    const linked = `[[Kira](${L2}) [the elder\\]](${L})`;
    expect(autolinkMarkdown(story, index).story).toBe(linked);
    expect(linkSpansMarkdown(story, spans, { id: ID2, type: 'character' }, MENTIONS_MARKDOWN).story).toBe(linked);
    expect(editorRead(linked)).toEqual([{ text: '[' }, { chip: 'Kira' }, { text: ' ' }, { chip: 'the elder]' }]);
  });

  it('a name after an escaping backslash is no span: "He saw \\_Vex ride."', () => {
    const story = 'He saw \\_Vex ride.';
    const vex = el(ID2, '_Vex');
    expect(autolinkMarkdown(story, buildAutolinkIndex([vex])).story).toBe(story);
    expect(findTermSpansMarkdown(story, '_Vex')).toEqual([]);
    expect(findSpansMarkdown(story, elementSpans(vex)!, MENTIONS_MARKDOWN)).toEqual([]);
  });

  // "Link to element" on a story with no sidecar: the span is written escaped, drawn as its text and unlinked to it.
  const TERMS: Array<[string, string, string | null]> = [
    ['Ki[ra', 'Then Ki[ra came.', `Then [Ki\\[ra](${L}) came.`],
    ['Ki]ra', 'Then Ki]ra came.', `Then [Ki\\]ra](${L}) came.`],
    // The story's `Kira\\` is the text "Kira\": the term's backslash escapes the next one, so it is passed over.
    ['Kira\\', 'Then Kira\\\\ came.', null],
  ];
  for (const [term, story, want] of TERMS) {
    it(`the term ${JSON.stringify(term)} through "Link to element"`, () => {
      const out = linkTermMarkdown(story, term, { id: ID, type: 'character' });
      if (want === null) {
        expect(out).toEqual({ story, linked: 0 });
        return;
      }
      expect(out.story).toBe(want);
      expect(editorRead(out.story)).toEqual([{ text: 'Then ' }, { chip: term }, { text: ' came.' }]);
      expect(chipsIn(renderProseFragment(out.story, onPage))).toEqual([term]);
      const back = unlinkMarkdown(out.story).story;
      expect(editorRead(back)).toEqual([{ text: `Then ${term} came.` }]);
      expect(renderProseFragment(back, onPage).textContent).toBe(`Then ${term} came.`);
    });
  }

  it('an escaped opener is no link: "Then \\[Kira](ow://…) came." to unlink and the compiled view', () => {
    const story = `Then \\[Kira](${L}) came.`;
    expect(unlinkMarkdown(story)).toEqual({ story, unlinked: 0 });
    const drawn = renderProseFragment(story, onPage);
    expect(chipsIn(drawn)).toEqual([]);
    expect(drawn.textContent).toBe(`Then [Kira](${L}) came.`);
  });
});

describe('done when 4: the drawing readers draw a label as its text', () => {
  const ALL = [...NAMES, '*Star*'];
  for (const name of ALL) {
    it(`a chip named ${JSON.stringify(name)}, on the page and left off`, () => {
      const story = serializeDocToMarkdown(sceneOf(name));
      const on = renderProseFragment(story, onPage);
      expect(chipsIn(on)).toEqual([name]);
      expect(on.querySelector('a, em, strong')).toBeNull();
      const off = renderProseFragment(story, new Map(), { unresolved: 'text' });
      expect(chipsIn(off)).toEqual([]);
      expect(off.querySelector('a, em, strong')).toBeNull();
      expect(off.textContent).toBe(`Then ${name} came.`);
      expect(markdownToPlainText(story)).toBe(`Then ${name} came.`);
    });
  }

  it('a code span keeps its backslash', () => {
    const drawn = renderProseFragment('see `a\\[b` here', onPage);
    expect(drawn.querySelector('code')?.textContent).toBe('a\\[b');
  });

  it('prose outside a link draws its escaped brackets and backslashes as the characters', () => {
    const story = serializeDocToMarkdown({ type: 'doc', content: [p(t('C:\\Users\\Titus'))] });
    expect(renderProseFragment(story, onPage).textContent).toBe('C:\\Users\\Titus');
    expect(renderProseFragment('Kira \\[the elder\\] came.', onPage).textContent).toBe('Kira [the elder] came.');
  });

  it('a web link whose text holds an escaped bracket draws it unescaped', () => {
    const drawn = renderProseFragment('see [a \\[b\\]](https://x.test) here', onPage);
    expect(drawn.querySelector('a')?.textContent).toBe('a [b]');
  });

  // The code gate's M1: an author's text that spells the renderer's held-piece marker (U+E000 n U+E001)
  // must never paste a drawn piece into an attribute, nor make the render throw.
  it('a forged marker in a link address stays inert: no handler attribute, no throw', () => {
    const M0 = '\uE0000\uE001';
    const md = `[a](https://a.test/onmouseover=alert(document.domain)//) and [b](https://b.test/${M0})`;
    for (const mode of ['chip', 'text'] as const) {
      const drawn = renderProseFragment(md, onPage, { unresolved: mode });
      const anchors = [...drawn.querySelectorAll('a')];
      expect(anchors.length).toBe(2);
      for (const a of anchors) expect([...a.attributes].map(x => x.name).sort()).toEqual(['href', 'rel', 'target']);
    }
    expect(() => renderProseFragment(`[b](https://b.test/${M0})`, onPage)).not.toThrow();
    expect(() => renderProseFragment(`\`x\` and [b](https://b.test/${M0})`, onPage)).not.toThrow();
  });
});
