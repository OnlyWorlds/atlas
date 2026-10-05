/**
 * `opfsStatus` says WHY browser storage cannot be used (1.17, contract §1.2,
 * gate B20): a full origin reads as full, never as a private window, and is
 * never cached (freeing space must be able to change the answer); a refusal
 * is cached for the page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { opfsStatus, opfsUsable, __resetOpfsStatusForTests } from '../../src/core/capabilities';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createWritable: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getDirectory: any;

beforeEach(() => {
  __resetOpfsStatusForTests();
  createWritable = vi.fn(async () => ({ write: async () => {}, close: async () => {} }));
  const root = { getFileHandle: async () => ({ createWritable }), removeEntry: async () => {} };
  getDirectory = vi.fn(async () => root);
  (navigator as unknown as { storage: unknown }).storage = { getDirectory };
  (window as unknown as { FileSystemFileHandle: unknown }).FileSystemFileHandle = { prototype: { createWritable() {} } };
});
afterEach(() => {
  delete (navigator as unknown as { storage?: unknown }).storage;
  delete (window as unknown as { FileSystemFileHandle?: unknown }).FileSystemFileHandle;
  __resetOpfsStatusForTests();
});

describe('opfsStatus', () => {
  it('ok when the probe write lands', async () => {
    expect(await opfsStatus()).toBe('ok');
    expect(await opfsUsable()).toBe(true);
  });

  it('absent without the API', async () => {
    delete (window as unknown as { FileSystemFileHandle?: unknown }).FileSystemFileHandle;
    expect(await opfsStatus()).toBe('absent');
  });

  it('refused (a private window) is cached for the page', async () => {
    getDirectory.mockRejectedValueOnce(new DOMException('no', 'SecurityError'));
    expect(await opfsStatus()).toBe('refused');
    expect(await opfsStatus()).toBe('refused');
    expect(getDirectory).toHaveBeenCalledTimes(1);
  });

  it('full is its own answer, and is asked again next time', async () => {
    createWritable.mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));
    expect(await opfsStatus()).toBe('full');
    expect(await opfsUsable()).toBe(true); // space freed: the probe ran again
    expect(getDirectory).toHaveBeenCalledTimes(2);
  });
});
