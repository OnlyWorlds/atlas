/**
 * The quiet agent mark in Knowledge's entry and Pages' page headers (#350,
 * the rest of #347's ruling): an agent's last write shows the mark, a
 * person's shows none, and a tick that drops the agent's write (the person's
 * own edit, `dropLastWriter`) takes it away without a rebuild.
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

const WORLD = 'w-mark';
const toasts = { info() {}, error() {}, success() {}, warning() {} } as unknown as ToastManager;

function el(id: string, name: string, extra: Record<string, unknown>): Element {
  return { id, type: 'narrative', name, local_updated_at: '2026-10-19T10:00:00.000Z', ...extra } as unknown as Element;
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

const ROOMS = [
  { name: 'Knowledge', subtype: 'knowledge', mount: mountKnowledgeRoom, hash: knowledgeHash, header: '.atlas-knowledge-entry-header' },
  { name: 'Pages', subtype: 'page', mount: mountShareRoom, hash: shareHash, header: '.atlas-share-detail-header' },
] as const;

for (const room of ROOMS) {
  describe(`the agent mark in ${room.name}`, () => {
    function open(state: 'api-linked' | 'local-only', via: string | undefined): HTMLElement {
      const item = el('n1', 'The debt', { subtype: room.subtype, story: 'Owed.', ...(via ? { changed_via: via } : {}) });
      openWorld(state, [item]);
      window.location.hash = room.hash(WORLD, 'n1');
      const target = document.createElement('div');
      document.body.appendChild(target);
      unmounts.push(room.mount(target, toasts));
      return target;
    }
    const mark = (t: HTMLElement) => t.querySelector(`${room.header} [data-role="agent-mark"]`);

    it('an agent\'s last write is marked, with its line', () => {
      const t = open('api-linked', 'mcp');
      expect(mark(t)).not.toBeNull();
      expect(mark(t)!.getAttribute('aria-label')).toBe('Last changed by an agent, through MCP');
    });

    it('control: a person\'s write, no write door, or a world kept on disk carries none', () => {
      expect(mark(open('api-linked', 'api'))).toBeNull();
      for (const u of unmounts) u();
      unmounts = [];
      expect(mark(open('api-linked', undefined))).toBeNull();
      for (const u of unmounts) u();
      unmounts = [];
      expect(mark(open('local-only', 'mcp'))).toBeNull();
    });

    it('the person\'s own edit takes it away on the next tick, and a pulled agent write brings it', () => {
      const t = open('api-linked', 'mcp');
      expect(mark(t)).not.toBeNull();
      patchSlice('data', { elements: [el('n1', 'The debt', { subtype: room.subtype, story: 'Owed, paid.' })] } as never);
      expect(mark(t)).toBeNull();
      patchSlice('data', { elements: [el('n1', 'The debt', { subtype: room.subtype, story: 'Owed again.', changed_via: 'declared' })] } as never);
      expect(mark(t)!.getAttribute('aria-label')).toBe('Last changed by an agent (the tool said so)');
    });
  });
}
