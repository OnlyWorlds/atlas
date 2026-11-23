/**
 * Before Publish, the page says what it shares (1.125.13): the Publish section
 * lists, from the payload the next Publish or Republish sends, each element that
 * sends a field or a picture, split by the block that sends it, each part with a
 * press that opens that block's editor. Mounted as share-room.republishMirror
 * mounts the room (an api-linked world with a PIN, MockFolderStore, the sharing
 * fakes). The text editor is a stand-in here: what matters is that a press flushes
 * an open text block before it opens another, not how TipTap types.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { mswServer } from '../setup';
import { statefulSharingHandlers } from '../msw-sharing-handlers';
import { SHARING_BASE_URL } from '../../src/sync/sharing-client';
import { mountShareRoom } from '../../src/middle/share-room';
import { setActiveStore } from '../../src/core/active-store';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setPin } from '../../src/registry/registry';
import { blocksOf, pageRefsFor, type PageBlock } from '../../src/core/sharing';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import type { WorldRegistryEntry, Element } from '../../src/core/types';
import type { ToastManager } from '../../src/ui/toast-manager';
import type { FsFolderStore } from '../../src/store/folder-store-fs';
import type { ChartConfig } from '../../src/visualization/timeline/types';

// The text block's editor, as a stand-in whose text the test sets.
const proseText = { current: '' };
vi.mock('../../src/middle/share-editor', () => ({
  mountShareEditor: (opts: { host: HTMLElement; initialMarkdown: string }) => {
    proseText.current = opts.initialMarkdown;
    const node = document.createElement('div');
    node.className = 'fake-prose';
    opts.host.appendChild(node);
    return {
      refresh: () => {}, getMarkdown: () => proseText.current, getJson: () => ({ type: 'doc' }),
      focus: () => {}, destroy: () => { node.remove(); },
    };
  },
}));

const picked: { next: Element | null } = { next: null };
vi.mock('../../src/ui/element-picker-modal', () => ({
  pickElement: async () => picked.next,
}));

beforeAll(() => {
  // A chart block draws on a canvas, which jsdom lacks.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };
  const noop = () => {};
  (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = () => new Proxy({}, {
    get: (_t, k) => (k === 'measureText' ? (s: string) => ({ width: s.length * 6 }) : noop),
    set: () => true,
  });
});

const WORLD_ID = 'w-share-list';
const ASH = 'a1000000-0000-0000-0000-000000000001';
const BRAM = 'a2000000-0000-0000-0000-000000000002';
const MAP = 'm1000000-0000-0000-0000-000000000001';
const PIN_ASH = 'p1000000-0000-0000-0000-000000000001';

function makeToasts() {
  return { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), show: vi.fn() };
}

function makeEntry(): WorldRegistryEntry {
  return {
    id: WORLD_ID,
    name: 'List world',
    state: 'api-linked',
    api: { world_id: 'srv-list', api_key: 'key-list' },
    folder: { handle_key: 'vault-list', folder_name: 'list-world' },
    created_at: '2026-01-01T00:00:00Z',
  };
}

describe('the Publish section lists what the page shares', () => {
  let store: MockFolderStore;
  let pageId: string;
  let toasts: ReturnType<typeof makeToasts>;
  let host: HTMLElement;
  let unmount: (() => void) | null = null;

  async function setup(blocks: PageBlock[], opts: { published?: boolean; charts?: ChartConfig[]; chartDelayMs?: number } = {}): Promise<void> {
    const fake = statefulSharingHandlers(SHARING_BASE_URL);
    mswServer.use(...fake.handlers);
    store = new MockFolderStore();
    await store.open(null as unknown as FileSystemDirectoryHandle);
    setActiveStore(store as unknown as FsFolderStore);
    await store.createElement('character', { id: ASH, name: 'Ash', description: 'A quiet smith.', x_mood: 'SECRET',
      image_url: 'https://img.example/ash.png' } as Partial<Element>);
    await store.createElement('character', { id: BRAM, name: 'Bram', description: 'The miller.' } as Partial<Element>);
    await store.createElement('map', { id: MAP, name: 'Realm', image_url: 'https://img.example/realm.png', width: 100, height: 100 } as Partial<Element>);
    await store.createElement('pin', { id: PIN_ASH, name: 'p', map_id: MAP, element_id: ASH, x: 10, y: 10 } as Partial<Element>);
    if (opts.charts) {
      const charts = opts.charts;
      const delay = opts.chartDelayMs ?? 0;
      store.readCharts = () => new Promise(resolve => setTimeout(() => resolve(charts.map(c => ({ ...c }))), delay));
    }
    const page = await store.createElement('narrative', {
      name: 'Primer', subtype: 'page', atlas_page_blocks: blocks, atlas_page_refs: pageRefsFor(blocks),
      ...(opts.published ? { atlas_page_pub: {
        id: 'srv-pg', slug: 'primer-page', published_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z', revoked: false,
      } } : {}),
    } as Partial<Element>);
    pageId = page.id;

    patchSlice('registry', setPin({ ...defaultRegistry(), worlds: [makeEntry()] }, '1234'));
    patchSlice('active', { worldId: WORLD_ID, meta: await store.readWorldMeta(), opened: true });
    patchSlice('data', { elements: await store.listElements() });
    window.location.hash = `#/w/${WORLD_ID}/share/${pageId}`;

    toasts = makeToasts();
    host = document.createElement('div');
    document.body.appendChild(host);
    unmount = mountShareRoom(host, toasts as unknown as ToastManager);
  }

  afterEach(() => {
    unmount?.();
    unmount = null;
    host?.remove();
    setActiveStore(null);
    patchSlice('active', null);
    patchSlice('data', { elements: [] });
    patchSlice('registry', defaultRegistry());
    window.location.hash = '';
    picked.next = null;
  });

  beforeEach(() => { proseText.current = ''; });

  function openPublish(): void {
    if (!host.querySelector('[data-role="publish-section"]')) {
      host.querySelector<HTMLButtonElement>('.atlas-share-meta-summary')!.click();
    }
  }
  const list = (): HTMLElement | null => host.querySelector('[data-role="share-shares"]');
  const rowOf = (id: string): HTMLElement | null => host.querySelector(`[data-role="share-shares"] [data-element-id="${id}"]`);
  const press = (id: string, kind: string): HTMLButtonElement | null =>
    rowOf(id)?.querySelector<HTMLButtonElement>(`[data-part-kind="${kind}"] button`) ?? null;
  async function storedBlocks(): Promise<PageBlock[]> {
    const page = (await store.listElements()).find(e => e.id === pageId)!;
    return blocksOf(page);
  }
  async function tick(): Promise<void> {
    patchSlice('data', { elements: await store.listElements() });
  }

  it('not yet published: the rows and the line sit above the address input', async () => {
    await setup([
      { id: 'k1', kind: 'element-card', elementId: ASH, variant: 'full', fields: ['description'] },
      { id: 'mb', kind: 'map', mapId: MAP, pinIds: [PIN_ASH], fullPinIds: [PIN_ASH] },
      { id: 'k2', kind: 'element-card', elementId: BRAM, variant: 'compact', fields: [] },
    ]);
    openPublish();
    const l = list();
    expect(l, 'the list is in the Publish section').toBeTruthy();
    expect(l!.closest('[data-role="publish-section"]')).toBeTruthy();
    expect(l!.textContent).toContain('What this page shares');
    // Above the address input.
    const slug = host.querySelector('.atlas-share-slug')!;
    expect(l!.compareDocumentPosition(slug) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const ash = rowOf(ASH)!;
    expect(ash.querySelector('bdi')!.textContent).toBe('Ash');
    expect(ash.querySelector('[data-part-kind="card"]')!.textContent).toContain('Description');
    const pin = ash.querySelector('[data-part-kind="map"]')!;
    expect(pin.textContent).toContain('Description');
    expect(pin.textContent).toContain('Mood');
    expect(rowOf(BRAM)).toBeNull();
    expect(host.querySelector('[data-role="share-shares-name-only"]')!.textContent).toContain('Bram');
    expect(host.querySelector('[data-role="share-shares-else"]')!.textContent).toContain('Maps share their picture');
  });

  it('published: the list sits above Republish', async () => {
    await setup([{ id: 'k1', kind: 'element-card', elementId: ASH, variant: 'full', fields: ['description'] }], { published: true });
    openPublish();
    const l = list();
    expect(l).toBeTruthy();
    const repub = host.querySelector('[data-action="republish"]')!;
    expect(l!.compareDocumentPosition(repub) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rowOf(ASH)).toBeTruthy();
  });

  it('Edit card, pressed with a text block open, keeps the text, opens that card and focuses its first checkbox', async () => {
    await setup([
      { id: 't1', kind: 'prose', markdown: 'Before.', richtextJson: null },
      { id: 'k1', kind: 'element-card', elementId: ASH, variant: 'full', fields: ['description'] },
    ]);
    openPublish();
    host.querySelector<HTMLElement>('[data-block-id="t1"] .atlas-share-block-content')!.click();
    await vi.waitFor(() => expect(host.querySelector('.fake-prose')).toBeTruthy());
    proseText.current = 'Kept words.';
    const btn = press(ASH, 'card')!;
    expect(btn.textContent).toBe('Edit card');
    btn.click();
    await vi.waitFor(() => expect(host.querySelector('[data-block-id="k1"] .atlas-share-card-edit')).toBeTruthy());
    const prose = (await storedBlocks()).find(b => b.id === 't1');
    expect(prose && prose.kind === 'prose' ? prose.markdown : null).toBe('Kept words.');
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(host.querySelector('[data-block-id="k1"] .atlas-share-card-edit-imgrow input')));
  });

  it("Edit map opens the map block's editor on this element's own pin", async () => {
    await setup([
      { id: 'k1', kind: 'element-card', elementId: ASH, variant: 'full', fields: [], showImage: false },
      { id: 'mb', kind: 'map', mapId: MAP, pinIds: [PIN_ASH] },
    ]);
    openPublish();
    const btn = press(ASH, 'map')!;
    expect(btn.textContent).toBe('Edit map');
    btn.click();
    await vi.waitFor(() => expect(host.querySelector('[data-block-id="mb"] .atlas-share-map-edit')).toBeTruthy());
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(host.querySelector(`[data-block-id="mb"] [data-pin-id="${PIN_ASH}"] input`)));
  });

  it("Edit collection focuses this element's chip, never a remove control, and says the remedy", async () => {
    await setup([{ id: 'col', kind: 'collection', elementIds: [BRAM, ASH] }]);
    openPublish();
    const part = rowOf(ASH)!.querySelector('[data-part-kind="collection"]')!;
    expect(part.textContent).toContain('remove it from the collection to stop sending its picture');
    const btn = press(ASH, 'collection')!;
    expect(btn.textContent).toBe('Edit collection');
    btn.click();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(host.querySelector(`[data-block-id="col"] .atlas-share-collection-member[data-element-id="${ASH}"]`)));
    const x = host.querySelector(`[data-block-id="col"] .atlas-share-collection-member[data-element-id="${ASH}"] button`)!;
    expect(x.getAttribute('aria-label')).toBe('Remove Ash from the collection');
  });

  it('a description emptied on a data tick drops from its row; the address input keeps its text and focus', async () => {
    await setup([{ id: 'k1', kind: 'element-card', elementId: ASH, variant: 'full', fields: ['description', 'x_mood'] }]);
    openPublish();
    const slug = host.querySelector<HTMLInputElement>('.atlas-share-slug')!;
    slug.focus();
    slug.value = 'typed-by-hand';
    expect(rowOf(ASH)!.textContent).toContain('Description');
    await store.updateElement(ASH, { description: '' } as Partial<Element>);
    await tick();
    await vi.waitFor(() => expect(rowOf(ASH)!.textContent).not.toContain('Description'));
    expect(rowOf(ASH)!.textContent).toContain('Mood');
    expect(host.querySelector('.atlas-share-slug')).toBe(slug);
    expect(slug.value).toBe('typed-by-hand');
    expect(document.activeElement).toBe(slug);
  });

  it('a chart that loads late adds its clause', async () => {
    const chart = { schema_version: 1, id: 'ch1', name: 'Years', axis: { kind: 'time', direction: 'both' },
      scope: { kind: 'all' }, render: '2d' } as ChartConfig;
    await setup([{ id: 'cb', kind: 'chart', chartId: 'ch1' }], { charts: [chart], chartDelayMs: 40 });
    openPublish();
    expect(list()).toBeTruthy();
    expect(host.querySelector('[data-role="share-shares-else"]')?.textContent ?? '').not.toContain('Charts share');
    await vi.waitFor(() =>
      expect(host.querySelector('[data-role="share-shares-else"]')?.textContent ?? '').toContain('Charts share'));
  });

  it("the first card deleted, its row's press opens the next card", async () => {
    await setup([
      { id: 'k1', kind: 'element-card', elementId: ASH, variant: 'full', fields: ['description'] },
      { id: 'k2', kind: 'element-card', elementId: ASH, variant: 'full', fields: ['description'] },
    ]);
    openPublish();
    expect(rowOf(ASH)!.querySelectorAll('[data-part-kind="card"]')).toHaveLength(2);
    host.querySelector<HTMLButtonElement>('[data-block-id="k1"] [aria-label="Delete block"]')!.click();
    await vi.waitFor(async () => expect((await storedBlocks()).map(b => b.id)).toEqual(['k2']));
    await vi.waitFor(() => expect(rowOf(ASH)!.querySelectorAll('[data-part-kind="card"]')).toHaveLength(1));
    press(ASH, 'card')!.click();
    await vi.waitFor(() => expect(host.querySelector('[data-block-id="k2"] .atlas-share-card-edit')).toBeTruthy());
  });

  it('a new card is full and shows its description (the default the list exists for)', async () => {
    await setup([]);
    picked.next = (await store.listElements()).find(e => e.id === ASH)!;
    const add = [...host.querySelectorAll<HTMLButtonElement>('.atlas-share-block-add-btn')].find(b => b.textContent?.includes('Element'))!;
    add.click();
    await vi.waitFor(async () => expect(await storedBlocks()).toHaveLength(1));
    const [b] = await storedBlocks();
    expect(b).toMatchObject({ kind: 'element-card', elementId: ASH, variant: 'full', fields: ['description'] });
  });
});
