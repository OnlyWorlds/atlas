/**
 * The quiet mark on agent-made work (#347; the agents page §10,
 * `Orrery/council/2026-10-15-agents-in-worlds.md`: a fact about the record,
 * derived on read, shown in the tool's chrome, never a schema field).
 *
 * Keel records the door of every element write (#299, D104): `changed_via`
 * is `seat` (an agent seat), `mcp`, `declared` (a client that sent
 * X-OW-Agent), or a plain surface (`api`, `v1`, `sync`, `server`), and
 * `changed_by` the membership (null for the owner). Atlas itself never
 * declares (it is a person's tool; Kael's stitches guard fails if it sets `agent`).
 *
 * Who decides, since 1.68.1 (Skeld's ruling, h66 #9630, on Seethe's #9592):
 * the SEAT, not the door. keel's MCP takes a person's own key, so a door says
 * how a write came in, not who made it. With the roster readable, the row for
 * `changed_by` decides (`kind` agent marks; a person, a player or the owner,
 * `changed_by` null, does not), and the door is said in words beside it. A
 * seat (`seat`) and a client that declared itself (`declared`) are agents by
 * definition. Only without a roster, or for a membership it does not hold
 * yet, does the door decide alone (the SDK's `isAgentDoor`).
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
  const via = typeof rec.changed_via === 'string' ? (rec.changed_via as OwWriteDoor) : null;
  if (!via) return null;
  const by = typeof rec.changed_by === 'string' ? rec.changed_by : null;
  const row = roster && by ? roster.find(m => m.id === by) ?? null : null;
  const agentByDefinition = via === 'seat' || via === 'declared';
  let agent: boolean;
  if (agentByDefinition) agent = true;
  else if (roster && row) agent = row.kind === 'agent';
  else if (roster && by === null) agent = false; // the owner's own write, through any door
  else agent = isAgentDoor(via);
  if (!agent) return null;
  const who = row && row.kind === 'agent' ? memberNameOf(by, roster, nameOf) : null;
  const door = doorWords(via);
  if (who) return { line: `Last changed by ${who}, an agent${door}` };
  return { line: `Last changed by an agent${door}` };
}

/** The door in words, beside the mark: a seat is an agent's own door and says nothing more. */
function doorWords(via: OwWriteDoor): string {
  switch (via) {
    case 'mcp': return ', through MCP';
    case 'declared': return ' (the tool said so)';
    case 'api': case 'v1': case 'sync': return ', through the API';
    default: return '';
  }
}

/** A member's name: the roster's own, else its Character's, else none. */
export function memberNameOf(
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
