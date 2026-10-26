/**
 * Files on elements (keel #393): the cache, the three acts and their words
 * (`src/sync/element-files.ts`), through a fake SDK client.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OwApiError, OwNetworkError, type OwFileRow, type OwFileTicket, type OwMe } from '@onlyworlds/sdk';
import {
  addFile, addRefusal, fileLink, filesNow, formatBytes, formatQuota, mayRemove, onFilesChanged, refreshFiles, removeFile,
  resetFilesCache, setFileUploadOriginsForTests, setFilesClientFactoryForTests, type FilesClient,
} from '../../src/sync/element-files';
import { isPlainError } from '../../src/core/plain-error';
import type { WorldRegistryEntry, WorldsRegistry } from '../../src/core/types';

const entry = {
  id: 'local-1', name: 'Blood Meridian', state: 'api-linked',
  api: { world_id: 'w1', api_key: 'ow_k_test' },
} as unknown as WorldRegistryEntry;
const viewOnly = { ...entry, id: 'local-2', api: { ...entry.api!, read_only: true } } as WorldRegistryEntry;
const reg = { worlds: [entry], pin: '1234' } as unknown as WorldsRegistry;

const row = (id: string, over: Partial<OwFileRow> = {}): OwFileRow => ({
  id, name: `${id}.pdf`, kind: 'pdf', size: 1000, label: null,
  added_by: { name: 'crew-walk-a', membership: 'm-a', agent: false }, added_at: '2026-10-19T12:00:00Z', ...over,
});
const ticket = (fileId = 'f-new'): OwFileTicket => ({
  ticket: 't', upload_url: 'https://upload.test/v1/file', prefix: 'w/w1/e1/', key: `w/w1/e1/${fileId}.pdf`,
  max_bytes: 25 * 1024 * 1024, exp: 0, uses: 1, issued_to: { account: null, membership: null }, kind: 'file', file_id: fileId,
});
const apiErr = (status: number, code: string, extra: { param?: string; retryAfter?: number } = {}) =>
  new OwApiError(status, code, code, null, { error: code }, null, extra.param ?? null, extra.retryAfter ?? null);

interface Fake extends FilesClient { calls: string[]; pins: (string | undefined)[] }

function fake(over: Partial<FilesClient> = {}): Fake {
  const calls: string[] = [];
  const pins: (string | undefined)[] = [];
  const f = {
    calls, pins,
    listFiles: vi.fn(async () => { calls.push('list'); return [row('f1')]; }),
    worldFiles: vi.fn(async () => { calls.push('world'); return { data: [], used_bytes: 41 * 1024 * 1024, cap_bytes: 250 * 1024 * 1024 }; }),
    me: vi.fn(async () => { calls.push('me'); return { scope: 'write', role: 'owner', membership: null } as unknown as OwMe; }),
    createFileTicket: vi.fn(async () => { calls.push('ticket'); return ticket(); }),
    uploadFile: vi.fn(async (_t: string, _i: string, _f: unknown, o?: { onProgress?: (l: number, t: number) => void }) => {
      calls.push('upload'); o?.onProgress?.(500, 1000); o?.onProgress?.(1000, 1000);
      return { key: 'k', fid: 'f-new', bytes: 1000, type: 'application/pdf', etag: 'e' };
    }),
    fileDownloadLink: vi.fn(async () => { calls.push('link'); return { url: 'https://files.test/x', exp: 0, name: 'x', kind: 'pdf', size: 1 }; }),
    removeFile: vi.fn(async () => { calls.push('remove'); }),
    ...over,
  } as unknown as Fake;
  setFilesClientFactoryForTests((_key, pin) => { pins.push(pin); return f; });
  return f;
}

const file = (name = 'notes.pdf', size = 1000) => new File([new Uint8Array(size)], name);

beforeEach(() => {
  resetFilesCache();
  setFileUploadOriginsForTests(['https://upload.test']);
});
afterEach(() => {
  setFilesClientFactoryForTests(null);
  setFileUploadOriginsForTests(null);
  vi.useRealTimers();
});

describe('sizes', () => {
  it('reads as the mock prints them', () => {
    expect(formatBytes(2 * 1024)).toBe('2 KB');
    expect(formatBytes(12.4 * 1024 * 1024)).toBe('12.4 MB');
    expect(formatBytes(300)).toBe('300 bytes');
    expect(formatQuota(41 * 1024 * 1024, 250 * 1024 * 1024)).toBe('41 MB of 250 MB');
  });
});

describe('mayRemove: the owner, or whoever added it', () => {
  const me = (o: Partial<OwMe>) => ({ scope: 'write', role: 'contributor', membership: 'm-a', ...o }) as unknown as OwMe;
  it('follows keel\'s rule', () => {
    expect(mayRemove(row('f'), me({ role: 'owner', membership: null }), false)).toBe(true);
    expect(mayRemove(row('f'), me({}), false)).toBe(true);
    expect(mayRemove(row('f'), me({ membership: 'm-b' }), false)).toBe(false);
    expect(mayRemove(row('f'), me({ scope: 'read' }), false)).toBe(false);
    expect(mayRemove(row('f'), null, false)).toBe(false);
    expect(mayRemove(row('f'), me({ role: 'owner', membership: null }), true)).toBe(false);
  });
});

describe('refreshFiles', () => {
  it('reads once, keeps the answer, and tells the cards', async () => {
    const f = fake();
    const heard = vi.fn();
    onFilesChanged(heard);
    await refreshFiles(entry, 'character', 'e1');
    await refreshFiles(entry, 'character', 'e1');
    expect(f.calls.filter(c => c === 'list')).toHaveLength(1);
    const v = filesNow(entry, 'character', 'e1');
    expect(v.rows?.map(r => r.id)).toEqual(['f1']);
    expect([v.used, v.cap]).toEqual([41 * 1024 * 1024, 250 * 1024 * 1024]);
    expect(v.me?.role).toBe('owner');
    expect(heard).toHaveBeenCalled();
    // A read sends no PIN.
    expect(f.pins.every(p => p === undefined)).toBe(true);
  });

  it('reads again once a minute old', async () => {
    const f = fake();
    let t = 1_000_000;
    await refreshFiles(entry, 'character', 'e1', () => t);
    t += 61_000;
    await refreshFiles(entry, 'character', 'e1', () => t);
    expect(f.calls.filter(c => c === 'list')).toHaveLength(2);
  });

  it('a 404 is an element keel does not hold yet', async () => {
    fake({ listFiles: vi.fn(async () => { throw apiErr(404, 'not_found'); }) });
    await refreshFiles(entry, 'character', 'e1');
    expect(filesNow(entry, 'character', 'e1').missing).toBe(true);
  });

  it('any other failure is kept as failed, never thrown', async () => {
    fake({ listFiles: vi.fn(async () => { throw new OwNetworkError('down', null); }) });
    await expect(refreshFiles(entry, 'character', 'e1')).resolves.toBeUndefined();
    expect(filesNow(entry, 'character', 'e1').failed).toBe(true);
  });
});

describe('addFile', () => {
  it('a ticket, the bytes on that ticket with the PIN, progress for the cards, then the list again', async () => {
    let listed = [row('f1')];
    const f = fake({ listFiles: vi.fn(async () => listed) });
    const seen: number[] = [];
    onFilesChanged(() => { const u = filesNow(entry, 'character', 'e1').uploads[0]; if (u) seen.push(u.loaded); });
    f.uploadFile = vi.fn(async (_t, _i, _f, o) => {
      o?.onProgress?.(500, 1000);
      listed = [row('f-new'), row('f1')];
      return { key: 'k', fid: 'f-new', bytes: 1000, type: 'application/pdf', etag: 'e' };
    }) as FilesClient['uploadFile'];
    await addFile(entry, reg, 'character', 'e1', file(), 'Source');
    expect(f.createFileTicket).toHaveBeenCalledWith('character', 'e1', { name: 'notes.pdf', size: 1000, label: 'Source' });
    expect((f.uploadFile as ReturnType<typeof vi.fn>).mock.calls[0][3].ticket.file_id).toBe('f-new');
    expect(f.pins[0]).toBe('1234');
    expect(seen).toContain(500);
    const v = filesNow(entry, 'character', 'e1');
    expect(v.uploads).toHaveLength(0);
    expect(v.rows?.map(r => r.id)).toEqual(['f-new', 'f1']);
  });

  it('the new row and the new total reach the card in one step (a 20 MB row beside "0 bytes")', async () => {
    let listed = [row('f1')];
    let used = 1000;
    const f = fake({
      listFiles: vi.fn(async () => listed),
      worldFiles: vi.fn(async () => ({ data: [], used_bytes: used, cap_bytes: 250 * 1024 * 1024 })),
    });
    f.uploadFile = vi.fn(async () => {
      listed = [row('f-new'), row('f1')];
      used = 3000;
      return { key: 'k', fid: 'f-new', bytes: 2000, type: 'application/pdf', etag: 'e' };
    }) as FilesClient['uploadFile'];
    await refreshFiles(entry, 'character', 'e1');
    const torn: string[] = [];
    let phase: 'add' | 'remove' = 'add';
    onFilesChanged(() => {
      const v = filesNow(entry, 'character', 'e1');
      const shown = (v.rows ?? []).filter(r => !v.uploads.some(u => u.fileId === r.id)).map(r => r.id);
      if (phase === 'add' && shown.includes('f-new') && v.used !== 3000) torn.push(`add: ${shown} with ${v.used}`);
      if (phase === 'remove' && !shown.includes('f1') && v.used !== 2000) torn.push(`remove: ${shown} with ${v.used}`);
    });
    await addFile(entry, reg, 'character', 'e1', file(), null);
    expect(filesNow(entry, 'character', 'e1').used).toBe(3000);
    phase = 'remove';
    listed = [row('f-new')];
    used = 2000;
    await removeFile(entry, reg, 'character', 'e1', 'f1');
    expect(torn).toEqual([]);
    expect(filesNow(entry, 'character', 'e1').used).toBe(2000);
  });

  it('never sends the bytes to an address it does not know', async () => {
    const f = fake();
    setFileUploadOriginsForTests(['https://elsewhere.test']);
    await expect(addFile(entry, reg, 'character', 'e1', file(), null)).rejects.toThrow(/upload address Atlas does not know/);
    expect(f.uploadFile).not.toHaveBeenCalled();
    expect(filesNow(entry, 'character', 'e1').uploads).toHaveLength(0);
  });

  it('a spent ticket gets one fresh one; a second is a refusal', async () => {
    let n = 0;
    const f = fake({ uploadFile: vi.fn(async () => { n++; if (n === 1) throw apiErr(401, 'ticket_expired'); return { key: 'k', fid: 'f-new', bytes: 1, type: 't', etag: 'e' }; }) });
    await addFile(entry, reg, 'character', 'e1', file(), null);
    expect(f.createFileTicket).toHaveBeenCalledTimes(2);
  });

  it('the host\'s 409 exists means the file landed', async () => {
    fake({ uploadFile: vi.fn(async () => { throw apiErr(409, 'exists'); }) });
    await expect(addFile(entry, reg, 'character', 'e1', file(), null)).resolves.toBeUndefined();
  });

  it('a kind keel never takes is refused before anything is sent, in the SDK\'s list', async () => {
    const f = fake();
    const got = await addFile(entry, reg, 'character', 'e1', file('map.png'), null).catch(e => e);
    expect((got as Error).message).toMatch(/\.pdf .*\.zip\)\. This file is none of those/);
    expect(f.calls).toHaveLength(0);
  });

  it('a view-only world and a missing PIN are refused before anything is sent', async () => {
    const f = fake();
    await expect(addFile(viewOnly, reg, 'character', 'e1', file(), null)).rejects.toThrow(/view-only/);
    await expect(addFile(entry, { ...reg, pin: undefined } as WorldsRegistry, 'character', 'e1', file(), null)).rejects.toThrow(/PIN/);
    expect(f.calls).toHaveLength(0);
  });

  it('every refusal is a PlainError in its own words', async () => {
    const cases: Array<[unknown, RegExp]> = [
      [new TypeError('Cannot tell the kind'), /none of those/],
      [apiErr(413, 'file_too_large', { param: 'size' }), /up to 25 MB/],
      [apiErr(403, 'files_full'), /no room left/],
      [apiErr(429, 'quota_exceeded', { retryAfter: 7200 }), /today\. Try again in 2 hours/],
      [apiErr(403, 'not_author'), /elements you made/],
      [apiErr(401, 'invalid_credentials', { param: 'API-Pin' }), /did not accept that PIN/],
      [new OwNetworkError('down', null), /could not reach/],
    ];
    for (const [err, words] of cases) {
      fake({ createFileTicket: vi.fn(async () => { throw err; }) });
      const got = await addFile(entry, reg, 'character', 'e1', file(), null).catch(e => e);
      expect(isPlainError(got), String(words)).toBe(true);
      expect((got as Error).message).toMatch(words);
    }
    expect(addRefusal(apiErr(415, 'unsupported_type'), { size: 1 })).toMatch(/contents are not what its name says/);
  });
});

describe('fileLink', () => {
  it('asks at the click and hands back an https link', async () => {
    fake();
    await expect(fileLink(entry, 'character', 'e1', 'f1')).resolves.toBe('https://files.test/x');
  });
  it('refuses a link that is not https', async () => {
    fake({ fileDownloadLink: vi.fn(async () => ({ url: 'javascript:alert(1)', exp: 0, name: 'x', kind: 'pdf', size: 1 })) as FilesClient['fileDownloadLink'] });
    await expect(fileLink(entry, 'character', 'e1', 'f1')).rejects.toThrow(/no address/);
  });
});

describe('removeFile', () => {
  it('takes the row out and reads the world total again', async () => {
    const f = fake();
    await refreshFiles(entry, 'character', 'e1');
    await removeFile(entry, reg, 'character', 'e1', 'f1');
    expect(f.removeFile).toHaveBeenCalledWith('character', 'e1', 'f1');
    expect(filesNow(entry, 'character', 'e1').rows).toEqual([]);
  });
  it('a file already gone counts as removed; a 403 is said', async () => {
    fake({ removeFile: vi.fn(async () => { throw apiErr(404, 'not_found'); }) });
    await expect(removeFile(entry, reg, 'character', 'e1', 'f1')).resolves.toBeUndefined();
    fake({ removeFile: vi.fn(async () => { throw apiErr(403, 'permission_error'); }) });
    await expect(removeFile(entry, reg, 'character', 'e1', 'f1')).rejects.toThrow(/Only the person who added this file/);
    expect(filesNow(entry, 'character', 'e1').removing.size).toBe(0);
  });
});
