/**
 * PerIdWriteChain — per-id write serialization semantics (convention #79).
 *
 * The chain is the store-boundary fix for the lost-update class: same-id ops
 * run strictly in submission order, different ids stay concurrent, and a
 * rejected op surfaces to its caller without poisoning the queue.
 */

import { describe, it, expect } from 'vitest';
import { PerIdWriteChain } from '../../src/store/write-chain';

/** Flush enough microtasks for any ready continuation to run. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function gate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>(r => { release = r; });
  return { promise, release };
}

describe('PerIdWriteChain', () => {
  it('serializes same-id ops in submission order', async () => {
    const chain = new PerIdWriteChain();
    const order: string[] = [];
    const a = gate();

    const first = chain.run('x', async () => { order.push('a-start'); await a.promise; order.push('a-end'); });
    const second = chain.run('x', async () => { order.push('b'); });

    await flushMicrotasks();
    expect(order).toEqual(['a-start']); // b queued behind the open gate
    a.release();
    await Promise.all([first, second]);
    expect(order).toEqual(['a-start', 'a-end', 'b']);
  });

  it('different ids run concurrently — no global lock', async () => {
    const chain = new PerIdWriteChain();
    const order: string[] = [];
    const a = gate();

    const slow = chain.run('x', async () => { order.push('x-start'); await a.promise; order.push('x-end'); });
    const fast = chain.run('y', async () => { order.push('y'); });

    await fast; // y completes while x is still gated
    expect(order).toEqual(['x-start', 'y']);
    a.release();
    await slow;
  });

  it('a rejection surfaces to its caller and does not block the next op', async () => {
    const chain = new PerIdWriteChain();
    const boom = chain.run('x', async () => { throw new Error('boom'); });
    const after = chain.run('x', async () => 'ok');

    await expect(boom).rejects.toThrow('boom');
    await expect(after).resolves.toBe('ok');
  });

  it('returns the op result', async () => {
    const chain = new PerIdWriteChain();
    await expect(chain.run('x', async () => 42)).resolves.toBe(42);
  });
});
