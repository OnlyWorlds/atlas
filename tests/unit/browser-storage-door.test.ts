/**
 * `browserStorageDoorOpen` (1.17, conv. 120): the synchronous
 * view of the storage probe that the palette and the chooser read. Unsettled
 * reads as open (the door says why on the click); a settled refusal or a full
 * origin closes it; a full origin is asked again, so freeing space reopens it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetOpfsStatusForTests, browserStorageDoorOpen, knownOpfsStatus, opfsStatus } from '../../src/core/capabilities';

let behaviour: 'ok' | 'refused' | 'full' | 'raced-once' | 'raced' = 'ok';
const probeNames: string[] = [];
let failures = 0;
const realStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');
const fileHandleProto = { createWritable() {} };

function fakeRoot() {
  return {
    async getFileHandle(name: string) {
      probeNames.push(name);
      if (behaviour === 'full') return { async createWritable() { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); } };
      if (behaviour === 'raced' || (behaviour === 'raced-once' && failures === 0)) {
        // Another tab removed the file between the handle and the write.
        return { async createWritable() { failures++; throw Object.assign(new Error('gone'), { name: 'NotFoundError' }); } };
      }
      return { async createWritable() { return { async write() {}, async close() {} }; } };
    },
    async removeEntry() {},
  };
}

beforeEach(() => {
  behaviour = 'ok';
  probeNames.length = 0;
  failures = 0;
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

  it('only a SecurityError is a refusal: a write raced by another tab is retried, never cached as a private window', async () => {
    behaviour = 'raced-once';
    expect(await opfsStatus()).toBe('ok');
    expect(failures).toBe(1);
    expect(probeNames).toHaveLength(2); // the probe and its retry, inside one ask
    expect(knownOpfsStatus()).toBe('ok');
    // The retry settled it: a sure answer is kept, never probed again.
    await new Promise(r => setTimeout(r, 0));
    await opfsStatus();
    expect(probeNames).toHaveLength(2);
  });

  it('an error that persists past the retry keeps the door and is asked again next time', async () => {
    behaviour = 'raced';
    expect(await opfsStatus()).not.toBe('refused');
    expect(failures).toBe(2); // the probe and its one retry
    behaviour = 'refused';
    await new Promise(r => setTimeout(r, 0));
    expect(await opfsStatus()).toBe('refused'); // not cached: the next ask probed again
  });

  it('each probe writes its own file name, so two tabs never race one file', async () => {
    await opfsStatus();
    __resetOpfsStatusForTests();
    await opfsStatus();
    expect(probeNames).toHaveLength(2);
    expect(probeNames[0]).toMatch(/^\.atlas-storage-probe-[0-9a-f]{8}$/);
    expect(probeNames[0]).not.toBe(probeNames[1]);
  });

  it('is closed where the API is missing', () => {
    delete (globalThis as unknown as { FileSystemFileHandle?: unknown }).FileSystemFileHandle;
    expect(browserStorageDoorOpen()).toBe(false);
  });
});
