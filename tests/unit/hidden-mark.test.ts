/**
 * keel's hidden mark said on the element (keel #537; `src/core/hidden-mark.ts`):
 * in a synced world, an element keel serves as `hidden: true` shows a quiet
 * glyph beside the agent mark in all three headers that carry it (the element
 * page, Knowledge's entry, a page), its line as label; nothing otherwise, and a
 * pull that unhides it takes the glyph away without a rebuild.
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
import { hiddenMarkLine, HIDDEN_MARK_LINE } from '../../src/core/hidden-mark';

const WORLD = 'w-hidden';
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
  it('only keel\'s own true, only in a synced world', () => {
    expect(hiddenMarkLine({ hidden: true }, 'api-linked')).toBe(HIDDEN_MARK_LINE);
    for (const v of [false, 'true', 1, null, undefined]) expect(hiddenMarkLine({ hidden: v }, 'api-linked')).toBeNull();
    expect(hiddenMarkLine({}, 'api-linked')).toBeNull();
    expect(hiddenMarkLine({ hidden: true }, 'local-only')).toBeNull();
    expect(hiddenMarkLine({ hidden: true }, undefined)).toBeNull();
  });

  it('the words say who can still see it', () => {
    expect(HIDDEN_MARK_LINE).toBe('Hidden on OnlyWorlds: only the owner, co-builders and whoever made it can see it.');
    expect(HIDDEN_MARK_LINE).not.toMatch(/—/);
  });
});

describe('the element page header', () => {
  const mark = (h: HTMLElement) => h.querySelector('[data-role="hidden-mark"]');
  it('a hidden element carries the glyph with its line; a shown one, or one in a folder, none', () => {
    const hidden = el('n1', { subtype: 'story', hidden: true });
    openWorld('api-linked', [hidden]);
    const h = renderHeader(hidden);
    expect(mark(h)!.getAttribute('aria-label')).toBe(HIDDEN_MARK_LINE);
    expect(mark(h)!.querySelector('.material-symbols-outlined')!.textContent).toBe('visibility_off');
    expect(mark(renderHeader(el('n2', { subtype: 'story' })))).toBeNull();
    openWorld('local-only', [hidden]);
    expect(mark(renderHeader(hidden))).toBeNull();
  });
});

const ROOMS = [
  { name: 'Knowledge', subtype: 'knowledge', mount: mountKnowledgeRoom, hash: knowledgeHash, header: '.atlas-knowledge-entry-header' },
  { name: 'Pages', subtype: 'page', mount: mountShareRoom, hash: shareHash, header: '.atlas-share-detail-header' },
] as const;

for (const room of ROOMS) {
  describe(`the hidden mark in ${room.name}`, () => {
    function open(state: 'api-linked' | 'local-only', hidden: boolean): HTMLElement {
      openWorld(state, [el('n1', { subtype: room.subtype, story: 'Owed.', ...(hidden ? { hidden: true } : {}) })]);
      window.location.hash = room.hash(WORLD, 'n1');
      const target = document.createElement('div');
      document.body.appendChild(target);
      unmounts.push(room.mount(target, toasts));
      return target;
    }
    const mark = (t: HTMLElement) => t.querySelector(`${room.header} [data-role="hidden-mark"]`);

    it('a hidden element is marked; a shown one or a folder world is not', () => {
      expect(mark(open('api-linked', true))!.getAttribute('aria-label')).toBe(HIDDEN_MARK_LINE);
      for (const u of unmounts) u();
      unmounts = [];
      expect(mark(open('api-linked', false))).toBeNull();
      for (const u of unmounts) u();
      unmounts = [];
      expect(mark(open('local-only', true))).toBeNull();
    });

    it('a pull that unhides it takes the mark away on the tick, and a hide brings it, beside the agent mark', () => {
      const t = open('api-linked', true);
      expect(mark(t)).not.toBeNull();
      patchSlice('data', { elements: [el('n1', { subtype: room.subtype, story: 'Owed.' })] } as never);
      expect(mark(t)).toBeNull();
      patchSlice('data', { elements: [el('n1', { subtype: room.subtype, story: 'Owed.', hidden: true, changed_via: 'mcp' })] } as never);
      expect(mark(t)).not.toBeNull();
      expect(t.querySelector(`${room.header} [data-role="agent-mark"]`)).not.toBeNull();
    });
  });
}
