/**
 * Every step that sends a world's `API-Pin` and words its refusal through `problemFor` or `showProblem`
 * says which world it was for (`worldId`) or whose credential it sent (`who`), so the line names the
 * World PIN or the seat secret. Only a step that cannot know it (an unhandled rejection) is left to the
 * line that names both; a step that sends no PIN names none (tests/unit/no-pin-steps.test.ts).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry, type Element, type WorldRegistryEntry } from '../../src/core/types';
import { OwV2Error } from '../../src/sync/ow-v2-client-adapter';
import type { ToastManager } from '../../src/ui/toast-manager';

vi.mock('../../src/sync/media-upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/media-upload')>()),
  uploadPicture: vi.fn(),
  removePicture: vi.fn(),
}));
import { uploadPicture, removePicture } from '../../src/sync/media-upload';
import { buildPictureUploadRow } from '../../src/middle/element-detail-picture';

const KEY = 'u/w-seat/01a12531-f898-7eb3-9048-28f63d4d5773.webp';
const SEAT = {
  id: 'local-seat', name: 'Seated', state: 'api-linked',
  folder: { handle_key: 'k', folder_name: 'seated' },
  api: { world_id: 'w-seat', api_key: 'ow_w_' + 's'.repeat(32), seat: { role: 'contributor' }, seat_secret: 'ow_s_' + 'a'.repeat(24) },
} as unknown as WorldRegistryEntry;
const pinRefused = () => new OwV2Error(401, { code: 'invalid_credentials', message: 'Incorrect PIN.', param: 'API-Pin' }, '');

function fakeToasts(): { toasts: ToastManager; sentences: string[] } {
  const sentences: string[] = [];
  const toasts = {
    problem: (p: { sentence: string }) => { sentences.push(p.sentence); },
    info: vi.fn(), success: vi.fn(), error: vi.fn(),
  } as unknown as ToastManager;
  return { toasts, sentences };
}

const settle = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  patchSlice('registry', { ...defaultRegistry(), worlds: [SEAT] });
  patchSlice('active', { worldId: SEAT.id } as never);
});

describe('a picture\'s upload and removal name the world\'s own credential', () => {
  it('a refused upload on a seat world names its seat secret', async () => {
    vi.mocked(uploadPicture).mockRejectedValueOnce(pinRefused());
    const { toasts, sentences } = fakeToasts();
    const el = { id: 'e1', type: 'character', name: 'Ada' } as unknown as Element;
    const row = buildPictureUploadRow(el, SEAT, toasts);
    const input = row.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.webp', { type: 'image/webp' })] });
    input.dispatchEvent(new Event('change'));
    await settle();
    expect(sentences).toEqual(['OnlyWorlds did not accept this seat secret, so Atlas could not finish uploading the picture.']);
  });

  it('a refused removal on a seat world names its seat secret', async () => {
    vi.mocked(removePicture).mockRejectedValueOnce(pinRefused());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { toasts, sentences } = fakeToasts();
    const el = { id: 'e1', type: 'character', name: 'Ada', image_url: `https://media.onlyworlds.com/${KEY}` } as unknown as Element;
    const row = buildPictureUploadRow(el, SEAT, toasts);
    (row.querySelector('[data-action="remove-picture"]') as HTMLButtonElement).click();
    await settle();
    expect(sentences).toEqual(['OnlyWorlds did not accept this seat secret, so Atlas could not finish removing the picture.']);
  });
});

/** The call that words `doing` in `file`, as written (one call per site). */
function callAt(file: string, doing: string): string {
  const src = readFileSync(join(__dirname, '..', '..', 'src', file), 'utf8');
  const calls = [...src.matchAll(/\b(?:showProblem|problemFor)\((?:[^()]|\([^()]*\))*\)/g)].map(m => m[0]).filter(c => c.includes(`'${doing}'`));
  expect(calls.length, `${file} ${doing}`).toBeGreaterThan(0);
  return calls.join('\n');
}

describe('the census: each site that holds the world says it', () => {
  // The sites whose step sends a world's API-Pin (a write, GET /me, a legacy key's read) and holds that world.
  const SITES: Array<[file: string, doing: string, says: RegExp]> = [
    ['middle/element-detail-picture.ts', 'uploading the picture', /worldId: entry\.id/],
    ['middle/element-detail-picture.ts', 'removing the picture', /worldId: entry\.id/],
    ['ui/conflict-review-modal.ts', 'resolving the conflict', /this\.problemWorld\(\)/],
    ['ui/make-online-modal.ts', 'creating the world online', /who: isSeatSecret\(pin\)/],
    ['ui/bring-down-again-modal.ts', 'downloading the world', /worldId: w\.id/],
  ];
  for (const [file, doing, says] of SITES) {
    it(`${file}, ${doing}`, () => {
      for (const call of callAt(file, doing).split('\n')) expect(call).toMatch(says);
    });
  }
});
