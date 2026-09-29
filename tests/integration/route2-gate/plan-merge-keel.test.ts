// Rows for pins and markers under a name-matched map or zone (gate A4/A5) stay in Forge/Notes/2026-09-29-s367-gate/probes/lens-a/f-plan-merge-keel.probe.test.ts until Captain rules which side survives.
/**
 * Promoted from the S367 composition gate (lens A).
 * Lens A attack 2: `planMerge` (and its composition with the kernel) against
 * keel reality.
 *
 * GREEN rows = upheld (listed in the lens A report so nobody re-checks them).
 * The pin row asserts the FIXED behaviour of a composition finding: pins are
 * unnamed (atlas creates them with no name), so they never match by name and
 * both sides' pins survive; but their MAP and ELEMENT do match by name, and
 * the kernel (verbatim, no pin guard) moves the local pin onto the server's
 * map and element. Result: one element, two pins, one map (the S306/S307 rule
 * `core/pin-uniqueness.ts`), on disk and on the server.
 */
import { describe, it, expect } from 'vitest';
import { planMerge, type ServerRec } from '../../../src/sync/plan-merge';
import { mergeLocalIntoApi } from '../../../src/sync/make-online';
import { SyncEngine } from '../../../src/sync/sync-engine';
import type { Element, ElementType } from '../../../src/core/types';
import { freshServer, world, putEl, open, srv } from './harness';

console.debug = () => undefined;
console.info = () => undefined;

const el = (id: string, type: ElementType, name: unknown): Element =>
  ({ id, type, name, local_updated_at: 'x' } as unknown as Element);
const rec = (id: string, name: unknown): ServerRec => ({ id, name, updated_at: 'x' } as ServerRec);
const ON = { matchByName: true };

describe('lens A attack 2: planMerge against keel reality (upheld rows)', () => {
  it('a server record named "" is downloaded, never a name target; a local named "" is created', () => {
    const p = planMerge([el('L', 'character', '')], new Map([['character', [rec('S', '')]]]), ON);
    expect(p.pairs.size).toBe(0);
    expect(p.creates.map(c => c.local.id)).toEqual(['L']);
    expect(p.downloads.map(d => d.server.id)).toEqual(['S']);
    expect(p.ambiguous).toEqual([]);
  });

  it('two server records differing only NFC vs NFD are one name: ambiguous, the local is created, both downloaded', () => {
    const nfc = 'Café', nfd = 'Café';
    const p = planMerge([el('L', 'location', nfc)], new Map([['location', [rec('S1', nfc), rec('S2', nfd)]]]), ON);
    expect(p.pairs.size).toBe(0);
    expect(p.ambiguous).toEqual([{ type: 'location', name: nfc }]);
    expect(p.downloads.map(d => d.server.id)).toEqual(['S1', 'S2']);
  });

  it('a local whose id is a server id of ANOTHER type still name-matches its own type; the other record is a clash, not downloaded', () => {
    const p = planMerge(
      [el('X', 'character', 'Alice')],
      new Map([['location', [rec('X', 'Ravenholm')]], ['character', [rec('N', 'Alice')]]]),
      ON,
    );
    expect([...p.pairs]).toEqual([['X', 'N']]);
    expect(p.idClashes).toEqual([{ id: 'X', localType: 'character', serverType: 'location' }]);
    expect(p.downloads).toEqual([]);
  });

  it('pins, markers and zones with no name never match by name (both sides kept)', () => {
    const p = planMerge(
      [el('LP', 'pin', ''), el('LM', 'marker', ''), el('LZ', 'zone', undefined)],
      new Map<ElementType, ServerRec[]>([['pin', [rec('SP', '')]], ['marker', [rec('SM', '')]], ['zone', [rec('SZ', null)]]]),
      ON,
    );
    expect(p.pairs.size).toBe(0);
    expect(p.creates.map(c => c.local.id)).toEqual(['LP', 'LM', 'LZ']);
    expect(p.downloads.map(d => d.server.id).sort()).toEqual(['SM', 'SP', 'SZ']);
  });

  it('a named pin DOES match a same-named server pin, whatever map either sits on (by design: per type, no spatial carve-out)', () => {
    const p = planMerge([el('LP', 'pin', 'Tavern')], new Map([['pin', [rec('SP', 'Tavern')]]]), ON);
    expect([...p.pairs]).toEqual([['LP', 'SP']]);
  });
});
