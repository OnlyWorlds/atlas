/**
 * The tour heal merge kernel (resilience gate).
 *
 * The rule under lock: heal repairs the bundle's own weave and never eats
 * the user's work. Removal applies ONLY to bundle-authored unrevealed ids;
 * everything else on disk survives verbatim; missing revealed bundle ids
 * append at the end.
 */

import { describe, it, expect } from 'vitest';
import { mergeHealArray } from '../../src/tour/tour-heal';

const revealed = (...ids: string[]) => new Set(ids);

describe('mergeHealArray', () => {
  it('appends missing revealed bundle ids (the user unlinked → heal re-adds)', () => {
    const { merged, changed } = mergeHealArray(['a', 'b'], ['a'], revealed('a', 'b'));
    expect(merged).toEqual(['a', 'b']);
    expect(changed).toBe(true);
  });

  it('removes bundle-authored ids that are unrevealed (back-nav retracts the weave)', () => {
    const { merged, changed } = mergeHealArray(['a', 'b'], ['a', 'b'], revealed('a'));
    expect(merged).toEqual(['a']);
    expect(changed).toBe(true);
  });

  it('preserves user-added non-bundle ids, in disk order', () => {
    const { merged } = mergeHealArray(['a'], ['user-1', 'a', 'user-2'], revealed('a'));
    expect(merged).toEqual(['user-1', 'a', 'user-2']);
  });

  it("preserves a user's manual link to an UNREVEALED bundle element the bundle does not author here (the gate's headline)", () => {
    // Consul→Rachmaninov drawn by the user at step 12; back-nav to step 5
    // unreveals Rachmaninov ('r'). The bundle authors only ['a'] for this
    // field — 'r' is user data and must survive even though it is a bundle
    // id and currently unrevealed.
    const { merged, changed } = mergeHealArray(['a'], ['a', 'r'], revealed('a'));
    expect(merged).toEqual(['a', 'r']);
    expect(changed).toBe(false);
  });

  it('does not duplicate a bundle id already on disk', () => {
    const { merged, changed } = mergeHealArray(['a', 'b'], ['b', 'a'], revealed('a', 'b'));
    expect(merged).toEqual(['b', 'a']);
    expect(changed).toBe(false);
  });

  it('reports changed=false on an identical pass (no write churn)', () => {
    const { changed } = mergeHealArray(['a', 'b'], ['a', 'b'], revealed('a', 'b'));
    expect(changed).toBe(false);
  });

  it('rebuilds an emptied field from the bundle', () => {
    const { merged, changed } = mergeHealArray(['a', 'b'], [], revealed('a', 'b'));
    expect(merged).toEqual(['a', 'b']);
    expect(changed).toBe(true);
  });

  it('never appends unrevealed bundle ids (no resurrection of stripped links)', () => {
    const { merged, changed } = mergeHealArray(['a', 'b'], [], revealed('a'));
    expect(merged).toEqual(['a']);
    expect(changed).toBe(true);
  });

  it('ignores non-string bundle entries (no reference-equality churn loop)', () => {
    const weird = [{ odd: true }] as unknown[];
    const first = mergeHealArray(weird, [], revealed());
    expect(first.merged).toEqual([]);
    expect(first.changed).toBe(false);
  });
});
