/**
 * Element names in prose are found by the SDK's `nameFinder` (1.125.17,
 * conv. 197). Each block is one change the move makes on purpose, asked of
 * every path that finds names: the markdown transform (closed scenes, Named in
 * the text), the rich-text transform (closed scenes with a sidecar) and the
 * live editor's dotted hints (mounted, its decorations read).
 */
import { describe, it, expect } from 'vitest';
import { buildAutolinkIndex, autolinkMarkdown, autolinkRichtext } from '../../src/core/prose-autolink';
import { mountWorkspaceEditor } from '../../src/middle/writing-workspace-editor';
import { AUTOLINK_PLUGIN_KEY } from '../../src/middle/writing-workspace-autolink';
import type { Element } from '../../src/core/types';

const idOf = (n: number): string => `0193a1c2-7d3e-7f00-8a11-${n.toString(16).padStart(12, '0')}`;
const ADDRESS_ID = '019a1f3c-2b4e-7d10-8c3a-6f2e9b0d4a71';

function el(n: number, name: unknown, extra: Record<string, unknown> = {}): Element {
  return { id: idOf(n), type: 'character', name, ...extra } as unknown as Element;
}

interface RtNode { type: string; text?: string; attrs?: { id?: string; label?: string }; content?: RtNode[] }
const docOf = (...texts: string[]): RtNode => ({
  type: 'doc',
  content: texts.map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
});

/** What each path would link, as `label@offset` within its own text (one paragraph). */
function viaMarkdown(world: Element[], text: string): string[] {
  const r = autolinkMarkdown(text, buildAutolinkIndex(world));
  const out: string[] = [];
  const re = /\[([^\]]*)\]\(ow:\/\/[^)]*\)/g;
  let m: RegExpExecArray | null;
  let shift = 0;
  while ((m = re.exec(r.story)) !== null) {
    out.push(`${m[1]}@${m.index - shift}`);
    shift += m[0].length - m[1].length;
  }
  return out;
}

function viaRichtext(world: Element[], text: string): string[] {
  const r = autolinkRichtext(docOf(text), buildAutolinkIndex(world));
  const para = (r.doc as RtNode).content![0].content!;
  const out: string[] = [];
  let at = 0;
  for (const n of para) {
    if (n.type === 'elementChip') { out.push(`${n.attrs!.label}@${at}`); at += n.attrs!.label!.length; } else at += n.text!.length;
  }
  return out;
}

function viaLive(world: Element[], text: string): string[] {
  const h = mountWorkspaceEditor({
    target: document.createElement('div'),
    initialJson: docOf(text) as never,
    onUpdate: () => {},
    autolinkSeed: { elements: world },
  });
  const decos = AUTOLINK_PLUGIN_KEY.getState(h.editor.state)?.decorations.find() ?? [];
  const out = decos
    .sort((a, b) => a.from - b.from)
    .map(d => `${h.editor.state.doc.textBetween(d.from, d.to, '', '')}@${d.from - 1}`);
  h.destroy();
  return out;
}

const PATHS: Array<[string, (world: Element[], text: string) => string[]]> = [
  ['markdown', viaMarkdown],
  ['rich text', viaRichtext],
  ['live hints', viaLive],
];

/** Every path links exactly `expected` (label@offset) in `text`. */
function expectEveryPath(world: Element[], text: string, expected: string[]): void {
  for (const [label, path] of PATHS) expect.soft(path(world, text), label).toEqual(expected);
}

describe('a name with a letter outside ASCII at its edge is found', () => {
  it('Éowyn, Zoë, Οδυσσεύς', () => {
    expectEveryPath([el(1, 'Éowyn')], 'Then Éowyn rode.', ['Éowyn@5']);
    expectEveryPath([el(2, 'Zoë')], 'Zoë and Zoe.', ['Zoë@0']);
    expectEveryPath([el(3, 'Οδυσσεύς')], 'Ο Οδυσσεύς έφυγε.', ['Οδυσσεύς@2']);
  });
});

describe('a name with a mark at its edge is found before a space or the end', () => {
  it('C++ (old)', () => {
    expectEveryPath([el(1, 'C++ (old)')], 'We wrote C++ (old) code.', ['C++ (old)@9']);
  });
  it('Co. in "Acme Co. sold"', () => {
    expectEveryPath([el(1, 'Co.')], 'Acme Co. sold', ['Co.@5']);
  });
});

describe('a name is not found inside a word that goes on', () => {
  it('Ana is not found inside Anaïs', () => {
    expectEveryPath([el(1, 'Ana')], 'Anaïs rode.', []);
  });
  it('Kira is not found where a combining mark follows it', () => {
    expectEveryPath([el(1, 'Kira')], 'Kirá rode.', []);
  });
  it('a name ending in a mark is not found where a letter follows it at once (St. in St.Kilda, a loss)', () => {
    expectEveryPath([el(1, 'St.')], 'St.Kilda', []);
  });
});

describe('no cap on the names of a world', () => {
  it('name 2,001 is found like name 1', () => {
    const world = Array.from({ length: 2001 }, (_, i) => el(i + 1, `Name${String(i + 1).padStart(4, '0')}`));
    expectEveryPath(world, 'Name0001 met Name2001.', ['Name0001@0', 'Name2001@13']);
  });
});

describe('case is compared by simple case folding', () => {
  it('Straße is found written STRAẞE', () => {
    expectEveryPath([el(1, 'Straße')], 'On the STRAẞE.', ['STRAẞE@7']);
  });
  it('İstanbul finds itself (red before for its edge as well as its fold)', () => {
    expectEveryPath([el(1, 'İstanbul')], 'To İstanbul.', ['İstanbul@3']);
  });
  it('a name with a final sigma is found written with a medial one', () => {
    expectEveryPath([el(1, 'Lord Theoς Vane')], 'Then Lord Theoσ Vane spoke.', ['Lord Theoσ Vane@5']);
  });
});

describe('a literal link or a bare address in a text node is passed over', () => {
  it('a typed [Kira](x) is not hinted or linked; the later Kira is', () => {
    for (const [label, path] of PATHS.slice(1)) {
      expect.soft(path([el(1, 'Kira')], 'a [Kira](x) b Kira.'), label).toEqual(['Kira@14']);
    }
  });
  it('a name "Character" is not found inside a bare ow:// address', () => {
    expectEveryPath([el(1, 'Character', { type: 'object' })], `See ow://character/${ADDRESS_ID} there.`, []);
  });
});

describe('a name longer than 200 code points is not looked for', () => {
  const long = (n: number): string => 'K' + 'a'.repeat(n - 1);
  it('200 is found, 201 is not', () => {
    expectEveryPath([el(1, long(200))], `x ${long(200)} y`, [`${long(200)}@2`]);
    expectEveryPath([el(1, long(201))], `x ${long(201)} y`, []);
  });
  it('an alias over the cut is passed over; the element is still found by its name', () => {
    expectEveryPath([el(1, 'Kira', { atlas_aliases: [long(201)] })], `${long(201)} and Kira.`, [`Kira@${201 + 5}`]);
  });
});

describe('the losses a whole word brings, named', () => {
  it('a name starting with a mark is not found where a letter comes just before it (.NET in ASP.NET)', () => {
    expectEveryPath([el(1, '.NET')], 'We used ASP.NET here.', []);
  });
  it('a name ending in a mark is not found where a digit follows it (Co. in Co.5)', () => {
    expectEveryPath([el(1, 'Co.')], 'Pay Co.5 now', []);
  });
  it('a name is not found inside a longer word that goes on with a letter (Zoë in Zoëlle)', () => {
    expectEveryPath([el(1, 'Zoë')], 'Then Zoëlle rode.', []);
  });
});

describe('a name ending in a full stop is found before punctuation', () => {
  it('Co. before a comma and before a closing bracket', () => {
    expectEveryPath([el(1, 'Co.')], 'Acme Co., sold', ['Co.@5']);
    expectEveryPath([el(1, 'Co.')], '(Acme Co.)', ['Co.@6']);
  });
});
