/**
 * #347: the quiet mark reads keel's door of the last write (#299). Agent-made
 * is seat, mcp or declared; every other door, and no door at all, is a
 * person's (or unknown), and carries nothing.
 */
import { describe, it, expect } from 'vitest';
import type { OwMember } from '@onlyworlds/sdk';
import { agentMarkFor } from '../../src/core/agent-mark';
import type { Element } from '../../src/core/types';

const SEAT = 'b1c2d3e4-0000-4000-8000-000000000001';
const CHAR = 'c1c2d3e4-0000-4000-8000-000000000002';
const el = (extra: Record<string, unknown>): Element =>
  ({ id: 'e1', type: 'character', name: 'Rhea', ...extra }) as unknown as Element;
const roster: OwMember[] = [
  { id: null, kind: 'owner', role: 'owner', character: null, status: 'active' },
  { id: SEAT, kind: 'agent', role: 'contributor', character: CHAR, status: 'active', name: 'Skeld' },
];
const names = (id: string) => (id === CHAR ? 'The Boatswain' : undefined);

describe('agentMarkFor', () => {
  it('a person\'s door, or none, carries no mark', () => {
    for (const via of ['api', 'v1', 'sync', 'server', null, undefined, 42]) {
      expect(agentMarkFor(el({ changed_via: via, changed_by: SEAT }), roster, names)).toBeNull();
    }
    expect(agentMarkFor(el({}), roster, names)).toBeNull();
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

  it('MCP and a declared client say their door, never a person\'s name', () => {
    expect(agentMarkFor(el({ changed_via: 'mcp', changed_by: null }), roster, names)?.line)
      .toBe('Last changed by an agent, through MCP');
    expect(agentMarkFor(el({ changed_via: 'declared', changed_by: SEAT }), roster, names)?.line)
      .toBe('Last changed by an agent (the tool said so)');
  });
});
