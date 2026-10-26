/**
 * The mark waits for the roster whatever the door. Since 1.68.1 the seat
 * decides, but only a `seat` write ever asked for the roster, so a `server`
 * write by an agent stayed unmarked until something else had read it (found by
 * the live walk on a work world, `walk-mark.mjs`). The roster is module state and
 * repaints nothing, so the holder is filled, renamed or removed in place.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OwMember } from '@onlyworlds/sdk';

let cached: OwMember[] | null = null;
let answer: (rows: OwMember[] | null) => void = () => {};
vi.mock('../../src/sync/world-roster', () => ({
  rosterNow: () => cached,
  rosterFor: () => new Promise<OwMember[] | null>(res => { answer = res; }),
}));

import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Element, WorldRegistryEntry } from '../../src/core/types';
import { buildAgentMark } from '../../src/middle/element-agent-mark';

const AGENT = 'a0000000-0000-4000-8000-000000000001';
const PERSON = 'b0000000-0000-4000-8000-000000000002';
const roster: OwMember[] = [
  { id: null, kind: 'owner', role: 'owner', character: null, status: 'active' },
  { id: AGENT, kind: 'agent', role: 'co_builder', character: null, status: 'active', name: 'Skeld' },
  { id: PERSON, kind: 'person', role: 'co_builder', character: null, status: 'active' },
];
const el = (via: string, by: string | null) =>
  ({ id: 'e1', type: 'character', name: 'Harbour master', changed_via: via, changed_by: by }) as unknown as Element;
const tick = () => new Promise(r => setTimeout(r, 0));

function mount(e: Element): HTMLElement {
  const header = document.createElement('div');
  document.body.appendChild(header);
  const m = buildAgentMark(e);
  if (m) header.appendChild(m);
  return header;
}
const line = (h: HTMLElement) => h.querySelector('[data-role="agent-mark"]')?.getAttribute('aria-label') ?? null;

beforeEach(() => {
  cached = null;
  const entry = { id: 'w', name: 'BB', state: 'api-linked', api: { world_id: 's', api_key: 'k' } } as unknown as WorldRegistryEntry;
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
  patchSlice('active', { worldId: 'w', meta: { name: 'BB' } } as never);
  patchSlice('data', { elements: [] } as never);
});
afterEach(() => { document.body.innerHTML = ''; patchSlice('active', null); });

describe('the agent mark before the roster has answered', () => {
  it("an agent's write through the server door is marked once the roster answers", async () => {
    const h = mount(el('server', AGENT));
    expect(line(h)).toBeNull();
    answer(roster);
    await tick();
    expect(line(h)).toBe('Last changed by Skeld, an agent');
  });

  it("a person's write through MCP loses the door's guess once the roster answers", async () => {
    const h = mount(el('mcp', PERSON));
    expect(line(h)).toBe('Last changed by an agent, through MCP');
    answer(roster);
    await tick();
    expect(line(h)).toBeNull();
    expect(h.children).toHaveLength(0);
  });

  it('a seat is renamed in place, the same button', async () => {
    const h = mount(el('seat', AGENT));
    const before = h.querySelector('[data-role="agent-mark"]');
    expect(line(h)).toBe('Last changed by an agent');
    answer(roster);
    await tick();
    expect(h.querySelector('[data-role="agent-mark"]')).toBe(before);
    expect(line(h)).toBe('Last changed by Skeld, an agent');
  });

  it('control: with the roster known, nothing waits', () => {
    cached = roster;
    expect(line(mount(el('server', AGENT)))).toBe('Last changed by Skeld, an agent');
    expect(mount(el('api', PERSON)).children).toHaveLength(0);
  });
});
