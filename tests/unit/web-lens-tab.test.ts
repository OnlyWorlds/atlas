/**
 * The Web's lens, mounted as the right pane mounts it (#841's code gate):
 * Read this lens names no subject on the lens's own page (C2); an Escape
 * that closes the chip's list leaves the preview where it was (C3); an
 * element this copy keeps outside the key's view is offered no lens, and a
 * lens is never written on one the sync state holds back (C1); a lens already
 * there is chosen and said as itself (C7).
 */
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { patchSlice } from '../../src/core/state';
import type { Element, WorldsRegistry } from '../../src/core/types';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HELD = id(7);

vi.mock('../../src/sync/sync-attach', async (orig) => ({
  ...(await orig<typeof import('../../src/sync/sync-attach')>()),
  isKeptHere: (_w: string, eid: string) => eid === HELD,
}));

const { mountContextTab } = await import('../../src/tabs/right/context-tab');
const { keepLensField, keepLensOn } = await import('../../src/core/web-lens');
const { PlainError } = await import('../../src/core/plain-error');

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

const el = (n: number, type: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id: id(n), type, name, ...extra }) as unknown as Element;
const ada = el(1, 'character', 'Ada');
const keep = el(3, 'location', 'Hollow Keep', { characters: [id(1)] });
const cy = el(5, 'character', 'Cy', { locations: [id(3)] });
const heir = el(7, 'character', 'Secret Heir');
const lens = el(10, 'construct', "Ada's world", { supertype: 'Lens', characters: [id(1)] });
const world = [ada, keep, cy, heir, lens];
const toasts = { success: vi.fn(), error: vi.fn(), show: vi.fn() } as never;

function setWorld(entry: Record<string, unknown> = {}): void {
  patchSlice('data', { elements: world } as never);
  patchSlice('active', { worldId: 'w1', meta: {} } as never);
  patchSlice('registry', { version: 1, worlds: [{ id: 'w1', name: 'W', ...entry }] } as unknown as WorldsRegistry);
}

function mountAt(hash: string): () => void {
  window.location.hash = hash;
  const pane = document.createElement('div');
  document.body.appendChild(pane);
  return mountContextTab({ pane, toasts });
}

afterEach(() => { document.body.innerHTML = ''; window.location.hash = ''; });

describe('the Web through a lens, mounted', () => {
  it('Read this lens: the lens\'s own page names no subject in the line (C2)', () => {
    setWorld({ context_lens: lens.id });
    const unmount = mountAt(`#/w/w1/element/${lens.id}`);
    const line = document.querySelector('[data-role="lens-line"]')?.textContent ?? '';
    expect(line).toMatch(/^Ada's world keeps \d+\./);
    expect(line).not.toMatch(/is not in this lens/);
    unmount();
  });

  it('a subject outside the lens is still named', () => {
    setWorld({ context_lens: lens.id });
    const unmount = mountAt(`#/w/w1/element/${heir.id}`);
    expect(document.querySelector('[data-role="lens-line"]')?.textContent).toMatch(/Secret Heir is not in this lens\.$/);
    unmount();
  });

  it('an Escape that closes the list leaves the preview on the element pressed (C3)', async () => {
    setWorld();
    const unmount = mountAt(`#/w/w1/element/${ada.id}`);
    document.querySelector<HTMLElement>(`.atlas-context-graph-node[data-element-id="${keep.id}"]`)!.click();
    const previewName = () => document.querySelector('.atlas-context-pane-preview-host .atlas-context-preview-name')?.textContent ?? '';
    expect(previewName()).toBe('Hollow Keep');
    document.querySelector<HTMLButtonElement>('[data-role="lens-chip"]')!.click();
    await Promise.resolve();
    expect(document.querySelector('[data-role="lens-menu"]')).not.toBeNull();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    (document.activeElement ?? document.body).dispatchEvent(esc);
    expect(document.querySelector('[data-role="lens-menu"]')).toBeNull();
    expect(previewName()).toBe('Hollow Keep');
    unmount();
  });
});

describe('Keep a lens, on what this copy holds back (C1) and on a lens already there (C7)', () => {
  it('is not offered on an element kept outside the key\'s view', () => {
    setWorld();
    expect(keepLensField('w1', heir, true)).toBeNull();
    expect(keepLensField('w1', ada, true)).toBe('characters');
  });

  it('refuses in words when the sync state holds the element back, and writes nothing', async () => {
    setWorld();
    for (const held of ['kept_outside_view', 'left_view', 'hidden_held']) {
      const store = { listElements: vi.fn(async () => world), createElement: vi.fn(), readSyncState: vi.fn(async () => ({ [held]: [cy.id] })) };
      await expect(keepLensOn('w1', cy, 'characters', store as never, async () => {})).rejects.toBeInstanceOf(PlainError);
      expect(store.createElement).not.toHaveBeenCalled();
    }
  });

  it('a lens already there is chosen and said by its own name', async () => {
    setWorld();
    const renamed = el(11, 'construct', 'Ada up close', { supertype: 'Lens', characters: [id(1)] });
    const store = { listElements: vi.fn(async () => [...world.filter(e => e.id !== lens.id), renamed]), createElement: vi.fn() };
    expect(await keepLensOn('w1', ada, 'characters', store as never, async () => {})).toEqual({ id: renamed.id, name: 'Ada up close', made: false });
  });
});
