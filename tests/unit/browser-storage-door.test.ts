/**
 * `browserStorageDoorOpen` (1.17, conv. 120; S374 gate F10): the synchronous
 * view of the storage probe that the palette and the chooser read. Unsettled
 * reads as open (the door says why on the click); a settled refusal or a full
 * origin closes it; a full origin is asked again, so freeing space reopens it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetOpfsStatusForTests, browserStorageDoorOpen, knownOpfsStatus, opfsStatus } from '../../src/core/capabilities';

let behaviour: 'ok' | 'refused' | 'full' = 'ok';
const realStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');
const fileHandleProto = { createWritable() {} };

function fakeRoot() {
  return {
    async getFileHandle() {
      if (behaviour === 'full') return { async createWritable() { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); } };
      return { async createWritable() { return { async write() {}, async close() {} }; } };
    },
    async removeEntry() {},
  };
}

beforeEach(() => {
  behaviour = 'ok';
  __resetOpfsStatusForTests();
  (globalThis as unknown as { FileSystemFileHandle: unknown }).FileSystemFileHandle = { prototype: fileHandleProto };
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: {
      async getDirectory() {
        if (behaviour === 'refused') throw Object.assign(new Error('nope'), { name: 'SecurityError' });
        return fakeRoot();
      },
    },
  });
});
afterEach(() => {
  __resetOpfsStatusForTests();
  delete (globalThis as unknown as { FileSystemFileHandle?: unknown }).FileSystemFileHandle;
  if (realStorage) Object.defineProperty(navigator, 'storage', realStorage);
  else delete (navigator as unknown as { storage?: unknown }).storage;
});

describe('browserStorageDoorOpen', () => {
  it('is open while the probe has not settled, and starts it', async () => {
    expect(knownOpfsStatus()).toBeNull();
    expect(browserStorageDoorOpen()).toBe(true);
    await opfsStatus();
    expect(knownOpfsStatus()).toBe('ok');
    expect(browserStorageDoorOpen()).toBe(true);
  });

  it('closes on a settled refusal (a private window)', async () => {
    behaviour = 'refused';
    await opfsStatus();
    expect(browserStorageDoorOpen()).toBe(false);
  });

  it('closes on a full origin, and reopens once space is freed (a full answer is asked again)', async () => {
    behaviour = 'full';
    await opfsStatus();
    expect(browserStorageDoorOpen()).toBe(false);
    behaviour = 'ok';
    await new Promise(r => setTimeout(r, 0));
    browserStorageDoorOpen();             // starts a fresh probe
    await opfsStatus();
    expect(browserStorageDoorOpen()).toBe(true);
  });

  it('is closed where the API is missing', () => {
    delete (globalThis as unknown as { FileSystemFileHandle?: unknown }).FileSystemFileHandle;
    expect(browserStorageDoorOpen()).toBe(false);
  });
});
