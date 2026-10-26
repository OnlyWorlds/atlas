/**
 * The hidden mark said on the element (folder spec §4.8, conv. 170; keel #537;
 * `src/core/hidden-mark.ts`): Atlas is a viewer, so the holder sees a hidden
 * element with the mark in every world. A linked element keel has says who on
 * OnlyWorlds can see it; any other (a folder world, an unlinked one, a linked
 * element not yet sent) says it is left out of a published page. The glyph sits
 * beside the agent mark in all three headers that carry it (the element page,
 * Knowledge's entry, a page), its line as label; the word "Hidden" in the list's
 * row and Home's Recent row; a pull that unhides it takes the glyph away
 * without a rebuild.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { patchSlice } from '../../src/core/state';
import { setActiveStore } from '../../src/core/active-store';
import { defaultRegistry } from '../../src/core/types';
import type { Element, WorldRegistryEntry } from '../../src/core/types';
import type { ToastManager } from '../../src/ui/toast-manager';
import { knowledgeHash, shareHash } from '../../src/core/router';
import { mountKnowledgeRoom } from '../../src/middle/knowledge-room';
import { mountShareRoom } from '../../src/middle/share-room';
import { renderHeader } from '../../src/middle/element-detail-header';
import { hiddenMarkLine, hiddenRowWord, isHiddenMark, HIDDEN_MARK_LINE, HIDDEN_FOLDER_LINE } from '../../src/core/hidden-mark';

const WORLD = 'w-hidden';
const SYNCED = { server_updated_at: '2026-10-19T09:00:00.000Z' };
const toasts = { info() {}, error() {}, success() {}, warning() {} } as unknown as ToastManager;

function el(id: string, extra: Record<string, unknown>): Element {
  return { id, type: 'narrative', name: 'The debt', local_updated_at: '2026-10-19T10:00:00.000Z', ...extra } as unknown as Element;
}
function openWorld(state: 'api-linked' | 'local-only', elements: Element[]): void {
  const entry = {
    id: WORLD, name: 'Shared', state,
    ...(state === 'api-linked' ? { api: { world_id: 's1', api_key: 'k' } } : {}),
  } as unknown as WorldRegistryEntry;
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
  patchSlice('active', { worldId: WORLD, meta: { name: 'Shared' } } as never);
  patchSlice('data', { elements } as never);
}

let unmounts: Array<() => void> = [];
afterEach(() => {
  for (const u of unmounts) u();
  unmounts = [];
  document.body.innerHTML = '';
  window.location.hash = '';
  setActiveStore(null);
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
  patchSlice('data', { elements: [] } as never);
});

describe('the rule', () => {
  it('any mark but absent, null or false is hidden (the SDK\'s and Python\'s reading)', () => {
    // "false" and 0 count too: SDK 4.70.0's writeWorldFile leaves them out of a share, so Atlas reads them alike.
    for (const v of [true, 'true', 1, 'yes', {}, 'false', 0]) expect(isHiddenMark({ hidden: v })).toBe(true);
    for (const v of [false, null, undefined]) expect(isHiddenMark({ hidden: v })).toBe(false);
    expect(isHiddenMark({})).toBe(false);
    expect(isHiddenMark(null)).toBe(false);
  });

  it('a linked element keel has says who on OnlyWorlds sees it; any other, the folder line', () => {
    expect(hiddenMarkLine({ hidden: true, ...SYNCED }, 'api-linked')).toBe(HIDDEN_MARK_LINE);
    expect(hiddenMarkLine({ hidden: true }, 'api-linked')).toBe(HIDDEN_FOLDER_LINE);
    expect(hiddenMarkLine({ hidden: true, ...SYNCED }, 'local-only')).toBe(HIDDEN_FOLDER_LINE);
    expect(hiddenMarkLine({ hidden: 'true' }, undefined)).toBe(HIDDEN_FOLDER_LINE);
    for (const v of [false, null, undefined]) expect(hiddenMarkLine({ hidden: v, ...SYNCED }, 'api-linked')).toBeNull();
  });

  it('the words say who can see it, and no em-dash', () => {
    expect(HIDDEN_MARK_LINE).toBe('Hidden on OnlyWorlds: only the owner, co-builders and whoever made it can see it.');
    expect(HIDDEN_FOLDER_LINE).toBe('Hidden: shown to you here, and left out of a published page.');
    expect(HIDDEN_MARK_LINE + HIDDEN_FOLDER_LINE).not.toMatch(/—/);
  });

  it('the row word is text, with the line as its title; nothing for a shown element', () => {
    const word = hiddenRowWord({ hidden: true }, 'local-only');
    expect(word).toContain('>Hidden<');
    expect(word).toContain(`title="${HIDDEN_FOLDER_LINE}"`);
    expect(hiddenRowWord({ name: 'Ana' }, 'local-only')).toBe('');
  });
});

describe('the element page header', () => {
  const mark = (h: HTMLElement) => h.querySelector('[data-role="hidden-mark"]');
  it('a hidden element carries the glyph with its line in a synced world and in a folder; a shown one, none', () => {
    const hidden = el('n1', { subtype: 'story', hidden: true, ...SYNCED });
    openWorld('api-linked', [hidden]);
    const h = renderHeader(hidden);
    expect(mark(h)!.getAttribute('aria-label')).toBe(HIDDEN_MARK_LINE);
    expect(mark(h)!.querySelector('.material-symbols-outlined')!.textContent).toBe('visibility_off');
    expect(mark(renderHeader(el('n2', { subtype: 'story', ...SYNCED })))).toBeNull();
    openWorld('local-only', [hidden]);
    expect(mark(renderHeader(hidden))!.getAttribute('aria-label')).toBe(HIDDEN_FOLDER_LINE);
  });

  it('the element page says it in a sentence instead, so its header leaves the glyph out (Seethe 2026-10-23)', () => {
    const hidden = el('n1', { subtype: 'story', hidden: true, ...SYNCED });
    openWorld('local-only', [hidden]);
    expect(mark(renderHeader(hidden, { hiddenNote: true }))).toBeNull();
    expect(mark(renderHeader(hidden))).not.toBeNull();
  });
});

const ROOMS = [
  { name: 'Knowledge', subtype: 'knowledge', mount: mountKnowledgeRoom, hash: knowledgeHash, header: '.atlas-knowledge-entry-header' },
  { name: 'Pages', subtype: 'page', mount: mountShareRoom, hash: shareHash, header: '.atlas-share-detail-header' },
] as const;

for (const room of ROOMS) {
  describe(`the hidden mark in ${room.name}`, () => {
    function open(state: 'api-linked' | 'local-only', hidden: boolean): HTMLElement {
      openWorld(state, [el('n1', { subtype: room.subtype, story: 'Owed.', ...SYNCED, ...(hidden ? { hidden: true } : {}) })]);
      window.location.hash = room.hash(WORLD, 'n1');
      const target = document.createElement('div');
      document.body.appendChild(target);
      unmounts.push(room.mount(target, toasts));
      return target;
    }
    const mark = (t: HTMLElement) => t.querySelector(`${room.header} [data-role="hidden-mark"]`);

    it('a hidden element is marked in a synced world and in a folder; a shown one is not', () => {
      expect(mark(open('api-linked', true))!.getAttribute('aria-label')).toBe(HIDDEN_MARK_LINE);
      for (const u of unmounts) u();
      unmounts = [];
      expect(mark(open('api-linked', false))).toBeNull();
      for (const u of unmounts) u();
      unmounts = [];
      expect(mark(open('local-only', true))!.getAttribute('aria-label')).toBe(HIDDEN_FOLDER_LINE);
    });

    it('a pull that unhides it takes the mark away on the tick, and a hide brings it, beside the agent mark', () => {
      const t = open('api-linked', true);
      expect(mark(t)).not.toBeNull();
      patchSlice('data', { elements: [el('n1', { subtype: room.subtype, story: 'Owed.', ...SYNCED })] } as never);
      expect(mark(t)).toBeNull();
      patchSlice('data', { elements: [el('n1', { subtype: room.subtype, story: 'Owed.', ...SYNCED, hidden: true, changed_via: 'mcp' })] } as never);
      expect(mark(t)).not.toBeNull();
      expect(t.querySelector(`${room.header} [data-role="agent-mark"]`)).not.toBeNull();
    });
  });
}
