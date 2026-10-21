import { describe, expect, it } from 'vitest';
import { readPacket, packetHere } from '../../src/core/work-packet';
import type { Element } from '../../src/core/types';

const el = (extra: Record<string, unknown>): Element => ({ id: 'w1', type: 'relation', name: 'Check the coast', ...extra } as unknown as Element);

describe('a work packet (dist.36 packet profile)', () => {
  it("reads the producer's order, each reason, the source world and the producer", () => {
    const p = readPacket(el({
      x_packet_elements: [
        { type: 'Location', id: 'b', reason: 'Its river ends inland' },
        { type: 'character', id: 'a', reason: '' },
      ],
      x_packet_source: { server: 'https://www.onlyworlds.com', world: 'world-1' },
      x_packet_producer: { tool: 'onlyworlds doctor', version: '0.12.0' },
    }))!;
    expect(p.entries).toEqual([
      { type: 'location', id: 'b', reason: 'Its river ends inland' },
      { type: 'character', id: 'a', reason: '' },
    ]);
    expect(p.sourceWorld).toBe('world-1');
    expect(p.producer).toBe('onlyworlds doctor 0.12.0');
  });

  it('skips an entry with no id and a repeated id, and is no packet with nothing left', () => {
    const p = readPacket(el({ x_packet_elements: [{ id: 'a' }, { id: 'a', reason: 'twice' }, { reason: 'no id' }, null, 'b'] }))!;
    expect(p.entries.map(e => e.id)).toEqual(['a']);
    expect(readPacket(el({ x_packet_elements: [{ reason: 'no id' }] }))).toBeNull();
    expect(readPacket(el({ x_packet_elements: 'a,b' }))).toBeNull();
    expect(readPacket(el({}))).toBeNull();
  });

  it('a folder (server null) and no producer read as none', () => {
    const p = readPacket(el({ x_packet_elements: [{ id: 'a' }], x_packet_source: { server: null, world: '' } }))!;
    expect([p.sourceWorld, p.producer]).toEqual([null, null]);
  });

  it('splits what this world holds from what it does not, keeping the order', () => {
    const p = readPacket(el({ x_packet_elements: [{ id: 'a' }, { id: 'x' }, { id: 'b' }] }))!;
    const { found, missing } = packetHere(p, id => id !== 'x');
    expect(found.map(e => e.id)).toEqual(['a', 'b']);
    expect(missing.map(e => e.id)).toEqual(['x']);
  });
});
