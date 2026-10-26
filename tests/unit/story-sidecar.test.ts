/**
 * The sidecar rule at open: `story` wins only when it holds text the
 * sidecar does not. The dangerous direction is a FALSE win (a scene nobody
 * edited outside loses its Atlas-only detail), so most cases here are
 * scenes that must keep their sidecar: Atlas's own save, cosmetic markdown
 * from another writer, and every Atlas transform that rewrites both halves.
 * (Premise measured first on Titus's real worlds: 20 of 20 sidecars
 * serialise to their story exactly.)
 */
import { describe, it, expect } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { storyOutranksSidecar } from '../../src/middle/story-sidecar';
import { serializeDocToMarkdown } from '../../src/middle/writing-workspace-markdown';
import {
  buildAutolinkIndex, autolinkMarkdown, autolinkRichtext, unlinkMarkdown, unlinkRichtext,
  linkTermMarkdown, linkTermRichtext,
} from '../../src/core/prose-autolink';
import { rekeyBody } from '../../src/store/rekey-body';
import type { Element } from '../../src/core/types';

const GIL = '00000000-0000-4000-8000-0000000000a1';
const GIL2 = '00000000-0000-4000-8000-0000000000b1';
const MARA = '00000000-0000-4000-8000-0000000000a2';

const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const t = (text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const chip = (id: string, label: string): JSONContent => ({ type: 'elementChip', attrs: { id, type: 'character', label } });

/** A scene with formatting, a chip, a heading and a list. */
const doc: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [t('The ferry')] },
    p(t('At dawn '), chip(GIL, 'Gil'), t(' met Mara by the '), t('river', [{ type: 'bold' }]), t(', and she was '), t('late', [{ type: 'italic' }]), t('.')),
    { type: 'bulletList', content: [
      { type: 'listItem', content: [p(t('a rope'))] },
      { type: 'listItem', content: [p(t('two oars'))] },
    ] },
  ],
};
const story = serializeDocToMarkdown(doc);
const elements = [
  { id: GIL, type: 'character', name: 'Gil' },
  { id: MARA, type: 'character', name: 'Mara' },
] as unknown as Element[];

describe('the sidecar is kept', () => {
  it("for Atlas's own save (serialize(sidecar) === story)", () => {
    expect(storyOutranksSidecar(doc, story)).toBe(false);
  });

  it('for the same text in another writer\'s markdown (trailing newline, * bullets)', () => {
    const cosmetic = `${story.replace(/^- /gm, '* ')}\n`;
    expect(cosmetic).not.toBe(story);
    expect(storyOutranksSidecar(doc, cosmetic)).toBe(false);
  });

  it('when story is empty or missing (a tool that dropped the field is not a user clearing the scene)', () => {
    expect(storyOutranksSidecar(doc, '')).toBe(false);
    expect(storyOutranksSidecar(doc, undefined)).toBe(false);
  });

  it('after bulk link and bulk unlink rewrote both halves', () => {
    const index = buildAutolinkIndex(elements);
    const md = autolinkMarkdown(story, index);
    const rt = autolinkRichtext(doc, index);
    expect(md.linked.length).toBeGreaterThan(0);
    expect(storyOutranksSidecar(rt.doc as JSONContent, md.story)).toBe(false);
    const umd = unlinkMarkdown(md.story);
    const urt = unlinkRichtext(rt.doc);
    expect(storyOutranksSidecar(urt.doc as JSONContent, umd.story)).toBe(false);
  });

  it('after find-and-link rewrote both halves', () => {
    const target = { id: MARA, type: 'character' as const, name: 'Mara' };
    const md = linkTermMarkdown(story, 'Mara', target as never);
    const rt = linkTermRichtext(doc, 'Mara', target as never);
    expect(md.linked).toBeGreaterThan(0);
    expect(rt.linked).toBe(md.linked);
    expect(storyOutranksSidecar(rt.doc as JSONContent, md.story)).toBe(false);
  });

  it('after a re-key rewrote both halves', () => {
    const body = { id: 'n1', type: 'narrative', name: 'The ferry', story, atlas_richtext_json: doc } as unknown as Element;
    const { body: next, changed } = rekeyBody(body, new Map([[GIL, GIL2]]));
    expect(changed).toBe(true);
    const r = next as unknown as { story: string; atlas_richtext_json: JSONContent };
    expect(r.story).toContain(GIL2);
    expect(storyOutranksSidecar(r.atlas_richtext_json, r.story)).toBe(false);
  });
});

describe('a rename between saves', () => {
  it('a chip whose label and story link text both say the old name: kept', () => {
    const d: JSONContent = { type: 'doc', content: [p(t('Then '), chip(GIL, 'Gil'), t(' left.'))] };
    // The element is now called "Gilgamesh"; neither half has been re-saved yet.
    expect(storyOutranksSidecar(d, serializeDocToMarkdown(d))).toBe(false);
  });
});

describe('story wins', () => {
  it('when an outside tool added a sentence', () => {
    expect(storyOutranksSidecar(doc, `${story}\n\nThe agent wrote this.`)).toBe(true);
  });

  it('when an outside tool changed one word', () => {
    expect(storyOutranksSidecar(doc, story.replace('two oars', 'three oars'))).toBe(true);
  });

  it('when an outside tool removed a link but kept the words', () => {
    const plain = story.replace(`[Gil](ow://character/${GIL})`, 'Gil');
    expect(plain).not.toBe(story);
    expect(storyOutranksSidecar(doc, plain)).toBe(true);
  });
});
