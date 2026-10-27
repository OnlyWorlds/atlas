/**
 * #347: the quiet mark on agent-made work. Since 1.68.1 the SEAT decides, not
 * the door (Skeld 2026-10-21: keel's MCP takes a person's own key): with the
 * roster, the row for changed_by decides and the door is said beside it; a seat
 * and a declared client are agents by definition; only without a roster, or
 * for a membership it does not hold yet, does the door decide alone.
 */
import { describe, it, expect } from 'vitest';
import type { OwMember } from '@onlyworlds/sdk';
import { agentMarkFor } from '../../src/core/agent-mark';
import type { Element } from '../../src/core/types';

const SEAT = 'b1c2d3e4-0000-4000-8000-000000000001';
const CHAR = 'c1c2d3e4-0000-4000-8000-000000000002';
const PERSON = 'd1c2d3e4-0000-4000-8000-000000000003';
const el = (extra: Record<string, unknown>): Element =>
  ({ id: 'e1', type: 'character', name: 'Rhea', ...extra }) as unknown as Element;
const roster: OwMember[] = [
  { id: null, kind: 'owner', role: 'owner', character: null, status: 'active', lenses: [] },
  { id: SEAT, kind: 'agent', role: 'contributor', character: CHAR, status: 'active', lenses: [], name: 'Skeld' },
  { id: PERSON, kind: 'person', role: 'co_builder', character: null, status: 'active', lenses: [] },
];
const names = (id: string) => (id === CHAR ? 'The Boatswain' : undefined);

describe('agentMarkFor', () => {
  it('a person\'s or the owner\'s write carries no mark, through any door', () => {
    for (const via of ['api', 'v1', 'sync', 'server', 'mcp']) {
      expect(agentMarkFor(el({ changed_via: via, changed_by: PERSON }), roster, names)).toBeNull();
      expect(agentMarkFor(el({ changed_via: via, changed_by: null }), roster, names)).toBeNull();
    }
    for (const via of [null, undefined, 42]) {
      expect(agentMarkFor(el({ changed_via: via, changed_by: SEAT }), roster, names)).toBeNull();
    }
    expect(agentMarkFor(el({}), roster, names)).toBeNull();
  });

  it('an agent\'s membership marks through any door, the door said beside it', () => {
    expect(agentMarkFor(el({ changed_via: 'api', changed_by: SEAT }), roster, names)?.line)
      .toBe('Last changed by Skeld, an agent, through the API');
    expect(agentMarkFor(el({ changed_via: 'mcp', changed_by: SEAT }), roster, names)?.line)
      .toBe('Last changed by Skeld, an agent, through MCP');
    expect(agentMarkFor(el({ changed_via: 'server', changed_by: SEAT }), roster, names)?.line)
      .toBe('Last changed by Skeld, an agent');
  });

  it('an agent seat is named from the roster', () => {
    expect(agentMarkFor(el({ changed_via: 'seat', changed_by: SEAT }), roster, names)?.line)
      .toBe('Last changed by Skeld, an agent');
  });

  it('a seat with no name of its own is named by its Character', () => {
    const r = [{ ...roster[1], name: undefined }];
    expect(agentMarkFor(el({ changed_via: 'seat', changed_by: SEAT }), r, names)?.line)
      .toBe('Last changed by The Boatswain, an agent');
  });

  it('a seat the roster does not hold yet, or no roster, still marks', () => {
    expect(agentMarkFor(el({ changed_via: 'seat', changed_by: SEAT }), null, names)?.line)
      .toBe('Last changed by an agent');
    expect(agentMarkFor(el({ changed_via: 'seat', changed_by: 'x' }), roster, names)?.line)
      .toBe('Last changed by an agent');
  });

  it('without a roster the door decides alone, and says itself', () => {
    expect(agentMarkFor(el({ changed_via: 'mcp', changed_by: null }), null, names)?.line)
      .toBe('Last changed by an agent, through MCP');
    expect(agentMarkFor(el({ changed_via: 'api', changed_by: SEAT }), null, names)).toBeNull();
  });

  it('a declared client is an agent by definition, even on a person\'s key, and never takes the person\'s name', () => {
    expect(agentMarkFor(el({ changed_via: 'declared', changed_by: PERSON }), roster, names)?.line)
      .toBe('Last changed by an agent (the tool said so)');
    expect(agentMarkFor(el({ changed_via: 'declared', changed_by: SEAT }), roster, names)?.line)
      .toBe('Last changed by Skeld, an agent (the tool said so)');
  });
});
