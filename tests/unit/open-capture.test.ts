/**
 * The `#/open/<world id>` door's capture (#104, S416): the id leaves the
 * address bar at once, a malformed one is held as '' (the door says so), and
 * any other route is left alone.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { captureOpenWorld, hasPendingOpen, takePendingOpen } from '../../src/core/open-capture';

const ID = '33333333-4444-4555-8666-777777777777';

function fakeHistory() {
  const calls: string[] = [];
  return { calls, hist: { state: null, replaceState: (_s: unknown, _t: string, url?: string | URL | null) => { calls.push(String(url)); } } };
}

describe('captureOpenWorld', () => {
  beforeEach(() => { takePendingOpen(); });

  it('takes a world id out of the address bar and holds it once', () => {
    const { calls, hist } = fakeHistory();
    expect(captureOpenWorld({ hash: `#/open/${ID}` }, hist)).toBe(true);
    expect(calls).toEqual(['#/']);
    expect(hasPendingOpen()).toBe(true);
    expect(takePendingOpen()).toBe(ID);
    expect(takePendingOpen()).toBeNull();
  });

  it('reads an id in capitals as keel writes it, in lower case', () => {
    const { hist } = fakeHistory();
    captureOpenWorld({ hash: `#/open/${ID.toUpperCase()}` }, hist);
    expect(takePendingOpen()).toBe(ID);
  });

  it('holds a truncated or foreign id as malformed, still taken from the bar', () => {
    for (const hash of ['#/open/', '#/open', `#/open/${ID.slice(0, 20)}`, '#/open/ow_j_AAAAAAAAAAAAAAAAAAAA', `#/open/${ID}x`]) {
      const { calls, hist } = fakeHistory();
      expect(captureOpenWorld({ hash }, hist)).toBe(true);
      expect(calls).toEqual(['#/']);
      expect(takePendingOpen()).toBe('');
    }
  });

  it('leaves every other route alone', () => {
    for (const hash of ['', '#/', `#/w/${ID}`, `#/join/ow_j_${'E'.repeat(32)}`, `#/opening/${ID}`, `#/settings/onlyworlds`]) {
      const { calls, hist } = fakeHistory();
      expect(captureOpenWorld({ hash }, hist)).toBe(false);
      expect(calls).toEqual([]);
      expect(hasPendingOpen()).toBe(false);
    }
  });
});
