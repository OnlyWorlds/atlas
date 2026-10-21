/**
 * A work packet (schema-dist `profiles/packet.md`, dist.36; Skeld h66 #9663):
 * a Work item Relation's `x_packet_elements`, each `{type, id, reason}` in the
 * producer's order, with `x_packet_source` naming the world the ids are from
 * and `x_packet_producer` the tool that made it. The Relation's typed links
 * carry the same elements for a tool that knows nothing of the profile; this
 * reads the list so Atlas can step through it with each reason (OW Parlor #487).
 * Pure: the element page and the packet bar call it.
 */
import type { Element } from './types';

export interface PacketEntry {
  type: string;
  id: string;
  reason: string;
}

export interface WorkPacket {
  entries: PacketEntry[];
  /** The world the ids are from, when the packet names one. */
  sourceWorld: string | null;
  /** "onlyworlds doctor 0.12.0", when a tool made it. */
  producer: string | null;
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** The packet on an element, or null when it carries none (or one with no usable entry). */
export function readPacket(el: Element): WorkPacket | null {
  const rec = el as unknown as Record<string, unknown>;
  const raw = rec.x_packet_elements;
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const entries: PacketEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = text(r.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    entries.push({ id, type: text(r.type).toLowerCase(), reason: text(r.reason) });
  }
  if (entries.length === 0) return null;
  const source = rec.x_packet_source && typeof rec.x_packet_source === 'object' ? rec.x_packet_source as Record<string, unknown> : null;
  const producer = rec.x_packet_producer && typeof rec.x_packet_producer === 'object' ? rec.x_packet_producer as Record<string, unknown> : null;
  const tool = text(producer?.tool);
  const version = text(producer?.version);
  return {
    entries,
    sourceWorld: text(source?.world) || null,
    producer: tool ? (version ? `${tool} ${version}` : tool) : null,
  };
}

/** The entries split by whether this world holds them, in the packet's order. */
export function packetHere(packet: WorkPacket, has: (id: string) => boolean): { found: PacketEntry[]; missing: PacketEntry[] } {
  const found: PacketEntry[] = [];
  const missing: PacketEntry[] = [];
  for (const e of packet.entries) (has(e.id) ? found : missing).push(e);
  return { found, missing };
}
