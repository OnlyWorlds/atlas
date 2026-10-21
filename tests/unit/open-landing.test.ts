/**
 * Where an open link lands (OW Parlor #487): the capture reads an element or a
 * packet after the world id, and the landing waits for that world, loaded, then
 * names what it found and what it did not.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { captureOpenWorld, takePendingOpen, takePendingOpenElements, OPEN_PACKET_MAX } from '../../src/core/open-capture';
import { landingStep, setOpenLanding, peekOpenLanding, clearOpenLanding, OPEN_LANDING_TTL_MS } from '../../src/core/open-landing';

const W = '33333333-4444-4555-8666-777777777777';
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';
const hist = { state: null, replaceState: () => {} };

describe('captureOpenWorld with a landing', () => {
  beforeEach(() => { takePendingOpen(); takePendingOpenElements(); });

  it('reads one element after the world', () => {
    expect(captureOpenWorld({ hash: `#/open/${W}/element/${A}` }, hist)).toBe(true);
    expect(takePendingOpen()).toBe(W);
    expect(takePendingOpenElements()).toEqual([A]);
    expect(takePendingOpenElements()).toEqual([]);
  });

  it('reads a packet in its order, each id once, capitals lowered, junk dropped', () => {
    captureOpenWorld({ hash: `#/open/${W}/elements/${B},${A.toUpperCase()},not-an-id,${B},${C}` }, hist);
    expect(takePendingOpen()).toBe(W);
    expect(takePendingOpenElements()).toEqual([B, A, C]);
  });

  it('an element link names one element, whatever follows', () => {
    captureOpenWorld({ hash: `#/open/${W}/element/${A},${B}` }, hist);
    expect(takePendingOpenElements()).toEqual([A]);
  });

  it('a malformed world id carries no landing', () => {
    captureOpenWorld({ hash: `#/open/nope/element/${A}` }, hist);
    expect(takePendingOpen()).toBe('');
    expect(takePendingOpenElements()).toEqual([]);
  });

  it('a bare world link still opens the world with no landing', () => {
    captureOpenWorld({ hash: `#/open/${W}` }, hist);
    expect(takePendingOpen()).toBe(W);
    expect(takePendingOpenElements()).toEqual([]);
  });

  it('a packet is cut at its cap', () => {
    const ids = Array.from({ length: OPEN_PACKET_MAX + 5 }, (_, i) => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`);
    captureOpenWorld({ hash: `#/open/${W}/elements/${ids.join(',')}` }, hist);
    expect(takePendingOpenElements()).toHaveLength(OPEN_PACKET_MAX);
  });
});

describe('landingStep', () => {
  const entry = { id: 'local-1', api: { world_id: W } } as never;
  const active = { worldId: 'local-1' };
  const els = [{ id: A }, { id: C }];
  const now = 1_000_000;

  beforeEach(() => clearOpenLanding());

  it('waits with no landing, no world, another world, a load in flight, or no elements yet', () => {
    expect(landingStep(null, active, entry, false, els, now)).toEqual({ kind: 'wait' });
    setOpenLanding(W, [A], now);
    const l = peekOpenLanding();
    expect(landingStep(l, null, entry, false, els, now).kind).toBe('wait');
    expect(landingStep(l, active, { id: 'local-1', api: { world_id: B } } as never, false, els, now).kind).toBe('wait');
    expect(landingStep(l, active, entry, true, els, now).kind).toBe('wait');
    expect(landingStep(l, active, entry, false, [], now).kind).toBe('wait');
  });

  it('lands on the world the link names, reading a world unlinked since by its former id', () => {
    setOpenLanding(W, [A], now);
    expect(landingStep(peekOpenLanding(), active, entry, false, els, now)).toEqual({ kind: 'land', localWorldId: 'local-1', found: [A], missing: 0 });
    const former = { id: 'local-1', former_api_world_id: W } as never;
    expect(landingStep(peekOpenLanding(), active, former, false, els, now).kind).toBe('land');
  });

  it('counts what the view does not hold, keeping the link order', () => {
    setOpenLanding(W, [C, B, A], now);
    expect(landingStep(peekOpenLanding(), active, entry, false, els, now)).toEqual({ kind: 'land', localWorldId: 'local-1', found: [C, A], missing: 1 });
  });

  it('expires, so a later open of the same world is never moved by an old link', () => {
    setOpenLanding(W, [A], now);
    expect(landingStep(peekOpenLanding(), active, entry, false, els, now + OPEN_LANDING_TTL_MS + 1).kind).toBe('expired');
  });

  it('a link with no elements sets no landing', () => {
    setOpenLanding(W, [], now);
    expect(peekOpenLanding()).toBeNull();
  });
});
