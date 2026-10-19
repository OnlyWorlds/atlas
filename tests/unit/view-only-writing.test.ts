/**
 * A view-only world reads its writing, knowledge and pages (conv. 149, S436):
 * the prose mounts read-only, and no surface offers a create, link, rename,
 * reorder, delete or publish the store would refuse. Each case runs on a
 * writable world too, the control: the same mount offers what the view-only
 * one withholds.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { patchSlice } from '../../src/core/state';
import { setActiveStore } from '../../src/core/active-store';
import { defaultRegistry } from '../../src/core/types';
import type { Element, WorldRegistryEntry } from '../../src/core/types';
import type { ToastManager } from '../../src/ui/toast-manager';
import { defaultBindings } from '../../src/core/hotkeys';
import { writingHash, knowledgeHash, shareHash } from '../../src/core/router';
import { mountWorkspaceEditor } from '../../src/middle/writing-workspace-editor';
import { createFindBar } from '../../src/middle/writing-workspace-find-bar';
import type { SearchController } from '../../src/middle/writing-workspace-editor';
import { handleAddToCast } from '../../src/middle/writing-workspace-add-to-cast';
import { createProseContextMenu } from '../../src/middle/writing-workspace-context-menu';
import { mountKnowledgeEditor } from '../../src/middle/knowledge-editor';
import { linkSelectionToExisting } from '../../src/middle/prose-link-existing';
import type { Editor } from '@tiptap/core';
import { mountContextLists } from '../../src/tabs/right/context-pane-lists';
import { mountContextPreview } from '../../src/tabs/right/context-pane-preview';
import { makeEditableTitle } from '../../src/middle/editable-title';
import { renderWritingTab } from '../../src/middle/settings-writing';
import { mountWritingBody } from '../../src/sidebar/writing-sidebar';
import { mountWriting } from '../../src/middle/writing';
import { mountWritingSetup } from '../../src/middle/writing-setup';
import { mountKnowledgeRoom } from '../../src/middle/knowledge-room';
import { mountShareRoom } from '../../src/middle/share-room';

const WORLD = 'w-view';

function entryFor(readOnly: boolean): WorldRegistryEntry {
  return {
    id: WORLD, name: 'Shared', state: 'api-linked',
    api: { world_id: 's1', api_key: 'k', read_only: readOnly },
  } as unknown as WorldRegistryEntry;
}

function openWorld(readOnly: boolean, elements: Element[] = []): void {
  patchSlice('registry', { ...defaultRegistry(), worlds: [entryFor(readOnly)] });
  patchSlice('active', { worldId: WORLD, meta: { name: 'Shared' } } as never);
  patchSlice('data', { elements } as never);
}

const toasts = { info() {}, error() {}, success() {}, warning() {} } as unknown as ToastManager;

function el(id: string, type: string, name: string, extra: Record<string, unknown> = {}): Element {
  return { id, type, name, local_updated_at: '2026-10-19T10:00:00.000Z', ...extra } as unknown as Element;
}

const IREENA = el('c3', 'character', 'Ireena', { objects: ['o1'] });
const LOCKET = el('o1', 'object', 'Locket');
const BAROVIA = el('l1', 'location', 'Barovia');

let unmounts: Array<() => void> = [];
afterEach(() => {
  for (const u of unmounts) u();
  unmounts = [];
  document.body.innerHTML = '';
  window.location.hash = '';
  setActiveStore(null);
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
  patchSlice('data', { elements: [] } as never);
});

describe('the prose editor', () => {
  it('mounts read-only when asked, and editable by default (the control)', () => {
    const a = mountWorkspaceEditor({ target: document.createElement('div'), initialMarkdown: 'Hi', onUpdate: () => {}, editable: false });
    const b = mountWorkspaceEditor({ target: document.createElement('div'), initialMarkdown: 'Hi', onUpdate: () => {} });
    expect(a.editor.isEditable).toBe(false);
    expect(b.editor.isEditable).toBe(true);
    a.destroy(); b.destroy();
  });

  it('"Add to story" puts no chip in a view-only world\'s prose; a writable one takes it', async () => {
    const detail = { id: 'c3', type: 'character', name: 'Ireena' };
    for (const readOnly of [true, false]) {
      openWorld(readOnly, [IREENA]);
      const h = mountWorkspaceEditor({ target: document.createElement('div'), initialMarkdown: 'She came.', onUpdate: () => {} });
      await handleAddToCast(detail, h.editor);
      expect(h.getMarkdown().includes('ow://character/c3')).toBe(!readOnly);
      h.destroy();
    }
  });
});

describe('the writing workspace', () => {
  // A scene whose chip label is a pre-rename name: the mount's chip-label
  // sync rewrites it, and that transaction is what the autosave hears.
  const scene = el('n1', 'narrative', 'Arrival', {
    story: '[Old name](ow://character/c3) arrives.', characters: ['c3'],
  });

  async function workspace(readOnly: boolean): Promise<{ root: HTMLElement; writes: unknown[] }> {
    openWorld(readOnly, [IREENA, scene]);
    patchSlice('registry', { ...defaultRegistry(), sync_debounce_ms: 200, worlds: [entryFor(readOnly)] });
    const writes: unknown[] = [];
    setActiveStore({
      updateElement: async (id: string, patch: unknown) => { writes.push({ id, patch }); },
      listElements: async () => [IREENA, scene],
    } as never);
    window.location.hash = writingHash(WORLD, 'n1');
    const target = document.createElement('div');
    document.body.appendChild(target);
    const { mountWritingWorkspace } = await import('../../src/middle/writing-workspace');
    unmounts.push(mountWritingWorkspace(target));
    await Promise.resolve(); // the narrative mounts after its flush resolves
    await Promise.resolve();
    return { root: target.querySelector<HTMLElement>('.atlas-writing-workspace')!, writes };
  }

  it('on a view-only world: prose read-only, nothing saved, find without replace or link', async () => {
    const { root, writes } = await workspace(true);
    expect(root.querySelector('.ProseMirror')!.getAttribute('contenteditable')).toBe('false');
    await new Promise(r => setTimeout(r, 350));
    expect(writes).toHaveLength(0);
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true }));
    const bar = root.querySelector<HTMLElement>('.atlas-find-bar')!;
    expect(bar.dataset.mode).toBe('find');
    expect(bar.querySelector<HTMLButtonElement>('[data-role="link-matches"]')!.hidden).toBe(true);
  });

  it('control: a writable world edits, saves the synced label, and replaces and links', async () => {
    const { root, writes } = await workspace(false);
    expect(root.querySelector('.ProseMirror')!.getAttribute('contenteditable')).toBe('true');
    await new Promise(r => setTimeout(r, 350));
    expect(writes).toHaveLength(1);
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true }));
    const bar = root.querySelector<HTMLElement>('.atlas-find-bar')!;
    expect(bar.dataset.mode).toBe('replace');
    expect(bar.querySelector<HTMLButtonElement>('[data-role="link-matches"]')!.hidden).toBe(false);
  });
});

describe('the prose right-click menus', () => {
  /** A real editor in a prose host, with "She came" selected. */
  function proseWithSelection(hostClass: string): { root: HTMLElement; handle: ReturnType<typeof mountWorkspaceEditor> } {
    const root = document.createElement('div');
    const host = document.createElement('div');
    host.className = hostClass;
    root.appendChild(host);
    document.body.appendChild(root);
    const handle = mountWorkspaceEditor({ target: host, initialMarkdown: 'She came home.', onUpdate: () => {} });
    handle.editor.commands.setTextSelection({ from: 1, to: 9 });
    unmounts.push(() => handle.destroy());
    return { root, handle };
  }
  const rightClick = (root: HTMLElement): void => {
    root.querySelector('.ProseMirror')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  };

  it('the writing room\'s menu stays shut on a view-only world and opens on a writable one', () => {
    for (const readOnly of [true, false]) {
      openWorld(readOnly);
      const { root, handle } = proseWithSelection('atlas-writing-workspace-prose');
      const menu = createProseContextMenu({ root, getEditorHandle: () => handle, getActiveNarrative: () => null });
      rightClick(root);
      expect(document.querySelector('.atlas-prose-context-menu') !== null).toBe(!readOnly);
      menu.destroy();
    }
  });

  it('the knowledge editor mounts read-only with no menu on a view-only world; the control edits', () => {
    for (const readOnly of [true, false]) {
      openWorld(readOnly);
      const roomRoot = document.createElement('div');
      const host = document.createElement('div');
      host.className = 'atlas-knowledge-prose-rich';
      roomRoot.appendChild(host);
      document.body.appendChild(roomRoot);
      const k = mountKnowledgeEditor({
        host, roomRoot, initialJson: null, initialMarkdown: 'She came home.',
        onSnapshot: () => {}, toasts, getEntry: () => null,
      });
      const dom = host.querySelector('.ProseMirror') as HTMLElement & { editor: Editor };
      expect(dom.getAttribute('contenteditable')).toBe(readOnly ? 'false' : 'true');
      dom.editor.commands.setTextSelection({ from: 1, to: 9 });
      rightClick(roomRoot);
      expect(document.querySelector('.atlas-prose-context-menu') !== null).toBe(!readOnly);
      document.querySelector('.atlas-prose-context-menu')?.remove();
      k.destroy();
    }
  });

  it('"Link to existing element" opens no picker on a view-only world; the control opens it', async () => {
    openWorld(true);
    const a = proseWithSelection('atlas-writing-workspace-prose');
    expect(await linkSelectionToExisting(() => a.handle)).toBe(false);
    expect(document.querySelector('.atlas-modal-overlay')).toBeNull();
    openWorld(false);
    const b = proseWithSelection('atlas-writing-workspace-prose');
    void linkSelectionToExisting(() => b.handle);
    await Promise.resolve();
    expect(document.querySelector('.atlas-modal-overlay')).not.toBeNull();
  });
});

describe('the find bar', () => {
  const search = {
    setQuery() {}, next() {}, prev() {}, replaceCurrent: () => false, replaceAll: () => 0,
    linkAllMatches: () => 0, clear() {},
    getInfo: () => ({ total: 2, currentIndex: 1, query: 'x', caseSensitive: false, wholeWord: false }),
  } as SearchController;

  it('shows no "Link to element" without a link handler (view-only); shows it with one', () => {
    const a = document.createElement('div');
    createFindBar(a, { search, onClose() {} });
    const b = document.createElement('div');
    createFindBar(b, { search, onClose() {}, onLinkMatches: async () => {} });
    expect(a.querySelector<HTMLButtonElement>('[data-role="link-matches"]')!.hidden).toBe(true);
    expect(b.querySelector<HTMLButtonElement>('[data-role="link-matches"]')!.hidden).toBe(false);
  });
});

describe('the writing context pane', () => {
  const scene = el('n1', 'narrative', 'Arrival', { story: 'Barovia waits.', characters: ['c3'] });

  function lists(readOnly: boolean): HTMLElement {
    openWorld(readOnly, [IREENA, LOCKET, BAROVIA, scene]);
    const host = document.createElement('div');
    mountContextLists({ host, narrative: scene, onSelect: () => {} });
    return host;
  }

  it('lists the named and the potentials with no Link or dismiss on a view-only world', () => {
    const host = lists(true);
    expect(host.querySelector('[data-named][data-element-id="l1"]')).not.toBeNull();
    expect(host.querySelector('[data-element-id="o1"]')).not.toBeNull();
    expect(host.querySelector('[data-action="link-named"]')).toBeNull();
    expect(host.querySelector('.atlas-context-pane-row-dismiss')).toBeNull();
  });

  it('control: a writable world offers both', () => {
    const host = lists(false);
    expect(host.querySelector('[data-action="link-named"]')).not.toBeNull();
    expect(host.querySelector('.atlas-context-pane-row-dismiss')).not.toBeNull();
  });

  function preview(readOnly: boolean): HTMLElement {
    const other = el('n2', 'narrative', 'Later', { story: 'Ireena wept.' });
    openWorld(readOnly, [IREENA, scene, other]);
    const host = document.createElement('div');
    const p = mountContextPreview({ host, subject: scene, mode: 'writing', onClose: () => {} });
    p.show(IREENA);
    unmounts.push(() => p.destroy());
    return host;
  }

  it('the preview keeps "Mentioned, unlinked" but offers no "Link all" and no "Add to story" (view-only)', () => {
    const host = preview(true);
    expect(host.querySelector('.atlas-context-preview-mentions')).not.toBeNull();
    expect(host.querySelector('[data-action="link-mentions"]')).toBeNull();
    expect([...host.querySelectorAll('button')].some(b => b.textContent?.includes('Add to story'))).toBe(false);
  });

  it('control: the writable preview offers both', () => {
    const host = preview(false);
    expect(host.querySelector('[data-action="link-mentions"]')).not.toBeNull();
    expect([...host.querySelectorAll('button')].some(b => b.textContent?.includes('Add to story'))).toBe(true);
  });
});

describe('the writing hotkeys', () => {
  it('create-from-selection and split are unbound on a view-only world, bound on a writable one', () => {
    window.location.hash = writingHash(WORLD, 'n1');
    const when = (id: string) => defaultBindings().find(b => b.id === id)!.when!();
    openWorld(true);
    expect(when('writing-inline-create')).toBe(false);
    expect(when('writing-split-at-cursor')).toBe(false);
    openWorld(false);
    expect(when('writing-inline-create')).toBe(true);
    expect(when('writing-split-at-cursor')).toBe(true);
  });
});

describe('a read-only title', () => {
  it('opens no input and does not invite a rename; the editable one does', () => {
    const ro = makeEditableTitle({ initial: 'Arrival', readOnly: true, onCommit: () => {} });
    const rw = makeEditableTitle({ initial: 'Arrival', onCommit: () => {} });
    document.body.append(ro.el, rw.el);
    ro.el.click();
    rw.el.click();
    expect(ro.el.querySelector('input')).toBeNull();
    expect(ro.el.title).toBe('');
    expect(rw.el.querySelector('input')).not.toBeNull();
    expect(rw.el.title).toBe('Click to rename');
  });
});

describe('Settings, Writing', () => {
  it('locks the tier labels on a view-only world and says why; a writable world edits them', () => {
    const tab = (readOnly: boolean): HTMLElement => {
      openWorld(readOnly);
      const div = document.createElement('div');
      div.innerHTML = renderWritingTab(entryFor(readOnly));
      return div;
    };
    const ro = tab(true);
    expect(ro.querySelector<HTMLInputElement>('[data-setting="writing_l1"]')!.disabled).toBe(true);
    expect(ro.querySelector('[data-role="writing-labels-view-only"]')).not.toBeNull();
    const rw = tab(false);
    expect(rw.querySelector<HTMLInputElement>('[data-setting="writing_l1"]')!.disabled).toBe(false);
    expect(rw.querySelector('[data-role="writing-labels-view-only"]')).toBeNull();
  });
});

describe('the writing tree', () => {
  const book = el('b1', 'narrative', 'The book', { supertype: 'Book', order: 0 });
  const chapter = el('ch1', 'narrative', 'One', { supertype: 'Chapter', parent_narrative: 'b1', order: 0 });

  function tree(readOnly: boolean): HTMLElement {
    openWorld(readOnly, [book, chapter]);
    window.location.hash = writingHash(WORLD);
    const content = document.createElement('div');
    document.body.appendChild(content);
    unmounts.push(mountWritingBody({ content, toasts }));
    return content;
  }

  it('navigates and offers no create, no row +, no drag and no right-click menu (view-only)', () => {
    const c = tree(true);
    const row = c.querySelector<HTMLElement>('.atlas-writing-tree-row')!;
    expect(row).not.toBeNull();
    expect(c.querySelector('.atlas-writing-sidebar-create-row')).toBeNull();
    expect(c.querySelector('.atlas-writing-tree-row-add')).toBeNull();
    expect(row.draggable).toBe(false);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(document.querySelector('.atlas-prose-context-menu')).toBeNull();
  });

  it('control: a writable tree offers all of them', () => {
    const c = tree(false);
    const row = c.querySelector<HTMLElement>('.atlas-writing-tree-row')!;
    expect(c.querySelector('.atlas-writing-sidebar-create-row')).not.toBeNull();
    expect(c.querySelector('.atlas-writing-tree-row-add')).not.toBeNull();
    expect(row.draggable).toBe(true);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(document.querySelector('.atlas-prose-context-menu')).not.toBeNull();
  });

  it('an empty view-only tree states it plainly; a writable one invites the button', () => {
    for (const readOnly of [true, false]) {
      openWorld(readOnly, []);
      window.location.hash = writingHash(WORLD);
      const content = document.createElement('div');
      const u = mountWritingBody({ content, toasts });
      expect(content.querySelector('.atlas-writing-sidebar-empty')!.textContent)
        .toBe(readOnly ? 'No books in this world.' : 'No books yet. Use the button above to create one.');
      u();
    }
  });
});

describe('the writing room', () => {
  function room(readOnly: boolean, elements: Element[]): HTMLElement {
    openWorld(readOnly, elements);
    window.location.hash = writingHash(WORLD);
    const target = document.createElement('div');
    document.body.appendChild(target);
    unmounts.push(mountWriting(target, toasts));
    return target;
  }

  it('an empty view-only world offers no New book or New draft, nor the labels edit', () => {
    const t = room(true, []);
    expect(t.querySelector('.atlas-writing-editor-empty-actions')).toBeNull();
    expect(t.textContent).not.toContain('Start writing');
    expect(t.querySelector('.atlas-writing-landing-labels-edit')).toBeNull();
  });

  it('control: a writable world offers them', () => {
    const t = room(false, []);
    expect(t.querySelectorAll('.atlas-writing-editor-empty-actions button')).toHaveLength(2);
    expect(t.querySelector('.atlas-writing-landing-labels-edit')).not.toBeNull();
  });

  // A chained tree under labels Atlas does not know yet: the setup screen.
  const tome = el('t1', 'narrative', 'Saga', { supertype: 'Tome' });
  const part = el('p1', 'narrative', 'Opening', { supertype: 'Part', parent_narrative: 't1' });

  function setup(readOnly: boolean): HTMLElement {
    openWorld(readOnly, [tome, part]);
    const target = document.createElement('div');
    document.body.appendChild(target);
    unmounts.push(mountWritingSetup(target, toasts, () => {}));
    return target;
  }

  it('the setup on a view-only world takes the labels the narratives carry and offers no promote or skip', () => {
    const t = setup(true);
    expect(t.querySelector<HTMLInputElement>('[data-label-key="l1"]')!.value).toBe('Tome');
    expect(t.querySelector<HTMLInputElement>('[data-label-key="l2"]')!.value).toBe('Part');
    expect(t.querySelector('[data-role="promote-toggle"]')).toBeNull();
    expect(t.querySelector('[data-action="skip"]')).toBeNull();
    expect(t.querySelector('[data-action="save"]')!.textContent).toBe('Use these labels');
  });

  it('control: a writable setup starts at the defaults and offers promote and skip', () => {
    const t = setup(false);
    expect(t.querySelector<HTMLInputElement>('[data-label-key="l1"]')!.value).toBe('Book');
    expect(t.querySelector('[data-role="promote-toggle"]')).not.toBeNull();
    expect(t.querySelector('[data-action="skip"]')).not.toBeNull();
  });
});

describe('the knowledge room', () => {
  const entry = el('k1', 'narrative', 'The secret', { subtype: 'knowledge', story: '', narrator: 'c3' });

  function room(readOnly: boolean, hash: string): HTMLElement {
    openWorld(readOnly, [IREENA, entry]);
    window.location.hash = hash;
    const target = document.createElement('div');
    document.body.appendChild(target);
    unmounts.push(mountKnowledgeRoom(target, toasts));
    return target;
  }

  it('home: no new entry on a view-only world; the control has one', () => {
    expect(room(true, knowledgeHash(WORLD)).querySelector('.atlas-knowledge-new')).toBeNull();
    for (const u of unmounts) u();
    unmounts = [];
    expect(room(false, knowledgeHash(WORLD)).querySelector('.atlas-knowledge-new')).not.toBeNull();
  });

  it('an entry on a view-only world: holder shown, no remove or add, no delete, no rename', () => {
    const t = room(true, knowledgeHash(WORLD, 'k1'));
    expect(t.querySelector('.atlas-knowledge-zone-who .atlas-knowledge-chip')).not.toBeNull();
    expect(t.querySelector('.atlas-knowledge-chip-remove')).toBeNull();
    expect(t.querySelector('.atlas-knowledge-add')).toBeNull();
    expect(t.querySelector('.atlas-knowledge-delete')).toBeNull();
    expect(t.querySelector<HTMLElement>('.atlas-knowledge-entry-header .atlas-element-name')!.title).toBe('');
  });

  it('control: a writable entry offers them', () => {
    const t = room(false, knowledgeHash(WORLD, 'k1'));
    expect(t.querySelector('.atlas-knowledge-chip-remove')).not.toBeNull();
    expect(t.querySelector('.atlas-knowledge-add')).not.toBeNull();
    expect(t.querySelector('.atlas-knowledge-delete')).not.toBeNull();
    expect(t.querySelector<HTMLElement>('.atlas-knowledge-entry-header .atlas-element-name')!.title).toBe('Click to rename');
  });
});

describe('the pages room', () => {
  const page = el('pg1', 'narrative', 'Handout', {
    subtype: 'page', story: '', atlas_page_intent: 'show', atlas_page_blocks: [], atlas_page_refs: [],
  });

  function room(readOnly: boolean, hash: string): HTMLElement {
    openWorld(readOnly, [page]);
    window.location.hash = hash;
    const target = document.createElement('div');
    document.body.appendChild(target);
    unmounts.push(mountShareRoom(target, toasts));
    return target;
  }

  it('list: no new page on a view-only world; the control has one', () => {
    expect(room(true, shareHash(WORLD)).querySelector('.atlas-share-new')).toBeNull();
    for (const u of unmounts) u();
    unmounts = [];
    expect(room(false, shareHash(WORLD)).querySelector('.atlas-share-new')).not.toBeNull();
  });

  it('a page on a view-only world opens as the visitor sees it: no builder, publish, delete or rename', () => {
    const t = room(true, shareHash(WORLD, 'pg1'));
    expect(t.querySelector('.atlas-share-blocks')).toBeNull();
    expect(t.querySelector('[data-action="open-publish"]')).toBeNull();
    expect(t.querySelector('.atlas-share-delete')).toBeNull();
    expect(t.querySelector('[data-action="full-preview"]')).not.toBeNull();
    expect(t.querySelector<HTMLElement>('.atlas-share-detail-header .atlas-element-name')!.title).toBe('');
  });

  it('a page whose blocks stayed on its maker\'s machine reads its story (S437, the live walk\'s "no content yet")', () => {
    for (const u of unmounts) u();
    unmounts = [];
    openWorld(true, [el('pg2', 'narrative', 'Wanted poster', { subtype: 'page', story: 'The Kid, for crossing the river.' })]);
    window.location.hash = shareHash(WORLD, 'pg2');
    const target = document.createElement('div');
    document.body.appendChild(target);
    unmounts.push(mountShareRoom(target, toasts));
    expect(target.textContent).toContain('The Kid, for crossing the river.');
    expect(target.textContent).not.toContain('This page has no content yet.');
  });

  it('control: a writable page opens in the builder with publish and delete', () => {
    const t = room(false, shareHash(WORLD, 'pg1'));
    expect(t.querySelector('.atlas-share-blocks')).not.toBeNull();
    expect(t.querySelector('[data-action="open-publish"]')).not.toBeNull();
    expect(t.querySelector('.atlas-share-delete')).not.toBeNull();
  });
});
