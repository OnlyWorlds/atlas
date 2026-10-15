/**
 * The quiet mark on agent-made work (#347; the agents page §10,
 * `Orrery/council/2026-10-15-agents-in-worlds.md`: a fact about the record,
 * derived on read, shown in the tool's chrome, never a schema field).
 *
 * Keel records the door of every element write (#299, D104): `changed_via`
 * is `seat` (an agent seat), `mcp`, `declared` (a client that sent
 * X-OW-Agent), or a plain surface (`api`, `v1`, `sync`, `server`), and
 * `changed_by` the membership (null for the owner). Agent-made is the SDK's
 * `isAgentDoor`: seat, mcp or declared. Atlas itself never declares (it is a
 * person's tool; Kael's stitches guard fails if it sets `agent`).
 *
 * It describes the LAST write: a local edit drops both fields
 * (`dropLastWriter`, both stores), since the next push is this person's.
 * Pure: the roster and the element names come in (`nameOf` answers for a Character only).
 */
import { isAgentDoor, type OwMember, type OwWriteDoor } from '@onlyworlds/sdk';
import type { Element } from './types';

export interface AgentMark {
  /** The one line, for the label, the tooltip and the tap. */
  line: string;
}

export function agentMarkFor(
  el: Element,
  roster: readonly OwMember[] | null,
  nameOf: (id: string) => string | undefined,
): AgentMark | null {
  const rec = el as Record<string, unknown>;
  const via = rec.changed_via;
  if (typeof via !== 'string' || !isAgentDoor(via as OwWriteDoor)) return null;
  const by = typeof rec.changed_by === 'string' ? rec.changed_by : null;
  const who = via === 'seat' ? agentNameOf(by, roster, nameOf) : null;
  if (who) return { line: `Last changed by ${who}, an agent` };
  if (via === 'mcp') return { line: 'Last changed by an agent, through MCP' };
  if (via === 'declared') return { line: 'Last changed by an agent (the tool said so)' };
  return { line: 'Last changed by an agent' };
}

/** An agent seat's name: the roster's own, else its Character's, else none. */
function agentNameOf(
  membership: string | null,
  roster: readonly OwMember[] | null,
  nameOf: (id: string) => string | undefined,
): string | null {
  if (!membership || !roster) return null;
  const row = roster.find(m => m.id === membership);
  if (!row) return null;
  const own = typeof row.name === 'string' ? row.name.trim() : '';
  if (own) return own;
  const character = row.character ? nameOf(row.character)?.trim() : '';
  return character || null;
}
