/**
 * Not online until it saves there (1.125.0, 2026-11-22, R3): one predicate, `waitsOnPin` (linked, writes, no PIN
 * kept), read wherever a person is told their world is held by OnlyWorlds: Home's keep-safe card, the
 * guide's copy dot, the sidebar's chip and cloud. The sync controls and every Make online offer stay on
 * the linked state.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry, type Element, type WorldRegistryEntry } from '../../src/core/types';
import { savesOnline, waitsOnPin } from '../../src/core/saves-online';
import { keepSafeCard, KEEPSAFE_THRESHOLD } from '../../src/middle/home-keepsafe';
import { guideDots } from '../../src/core/guide';
import { renderRow, PIN_WAITS_CHIP_TITLE } from '../../src/sidebar/worlds-sidebar';

const NOW = Date.parse('2026-11-22T12:00:00.000Z');

function linked(over: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry {
  return {
    id: 'w1', name: 'Tangle ground', state: 'api-linked', where: 'browser',
    api: { world_id: 'srv-1', api_key: 'ow_w_owner' },
    folder: { handle_key: 'world-srv-1', folder_name: 'tangle-ground-srv1-1a2b' },
    created_at: '2026-11-01T00:00:00.000Z',
    ...over,
  };
}
const chars = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `C${i}`, type: 'character', local_updated_at: new Date(NOW).toISOString() }) as unknown as Element);

afterEach(() => patchSlice('registry', defaultRegistry()));

describe('the predicate', () => {
  it('linked, writes, no PIN kept: waits; a PIN kept, a read key, a local world: does not', () => {
    const reg = defaultRegistry();
    expect(waitsOnPin(linked(), reg)).toBe(true);
    expect(savesOnline(linked(), reg)).toBe(false);
    expect(waitsOnPin(linked(), { ...reg, pin: '1234' })).toBe(false);
    expect(savesOnline(linked(), { ...reg, pin: '1234' })).toBe(true);
    expect(waitsOnPin(linked({ api: { world_id: 'srv-1', api_key: 'ow_r_x', read_only: true } }), reg)).toBe(false);
    expect(waitsOnPin(linked({ state: 'local-only', api: undefined }), reg)).toBe(false);
    // A seat waits on its own secret, never the account PIN.
    expect(waitsOnPin(linked({ api: { world_id: 'srv-1', api_key: 'ow_s_k', seat: {}, seat_secret: undefined } }), { ...reg, pin: '1234' })).toBe(true);
  });
});

describe('Home\'s keep-safe card', () => {
  it('a world waiting on the PIN gets the full card, never "Your OnlyWorlds account holds"', () => {
    expect(keepSafeCard({ entry: linked(), elements: chars(KEEPSAFE_THRESHOLD), loading: false, now: NOW })).toEqual({ reduced: 'online' });
    expect(keepSafeCard({ entry: linked(), elements: chars(KEEPSAFE_THRESHOLD), loading: false, now: NOW, waitsOnPin: true })).toEqual({ reduced: null });
  });

  it('a whole strand asks for a copy in a world waiting on the PIN, as in a world never online', () => {
    const strand = { story: null, whole: true };
    expect(keepSafeCard({ entry: linked(), elements: [], loading: false, now: NOW, strand })).toBeNull();
    expect(keepSafeCard({ entry: linked(), elements: [], loading: false, now: NOW, strand, waitsOnPin: true })).toEqual({ reduced: null });
  });
});

describe('the guide\'s copy dot', () => {
  it('dark for a browser world waiting on the PIN; lit once a PIN is kept', () => {
    patchSlice('registry', { ...defaultRegistry(), worlds: [linked()] });
    expect(guideDots([], linked()).copy).toBe(false);
    patchSlice('registry', { ...defaultRegistry(), pin: '1234', worlds: [linked()] });
    expect(guideDots([], linked()).copy).toBe(true);
  });
});

describe('the sidebar\'s row', () => {
  it('waiting on the PIN: its place for an icon and a chip that says it does not save yet; its sync controls stay', () => {
    patchSlice('registry', { ...defaultRegistry(), worlds: [linked()] });
    const waiting = renderRow(linked(), false, false, false);
    expect(waiting).toContain('not online yet');
    expect(waiting).toContain(PIN_WAITS_CHIP_TITLE.replace(/'/g, '&#39;').slice(0, 20));
    expect(waiting).not.toContain('>online<');
    expect(waiting).toMatch(/data-role="refresh-world"[^>]*>\s*<span class="material-symbols-outlined">web<\/span>/);
    expect(waiting).toContain('data-role="toggle-paused"');
    patchSlice('registry', { ...getState().registry, pin: '1234' });
    const saving = renderRow(linked(), false, false, false);
    expect(saving).toContain('>online<');
    expect(saving).toMatch(/<span class="material-symbols-outlined">cloud<\/span>/);
  });
});
