/**
 * Share room — compose + manage sharing pages (Narratives, subtype 'page')
 * for this world (DESIGN_SHARING.md, Track B).
 *
 * Views (URL is the source of truth):
 *   - list   (`/share`)          — the world's pages; "+ new page".
 *   - detail (`/share/<pageId>`) — one page: name, intent, the block builder.
 *
 * The builder is an ordered single-column block stack (S2): heading + prose
 * (+ element-card, S2b). One block edits at a time — clicking a block swaps
 * its static render for an inline editor; structural actions (add / move /
 * delete) commit any open editor first. Every blocks save goes through
 * `pageBlocksPatch` so the refs mirror + the derived `story` compilation stay
 * in lockstep with the blocks (core/sharing.ts).
 *
 * Publishing (S4) is deliberately absent until the backend contract lands —
 * pages are composed and previewed locally; no dead "publish" affordance.
 *
 * Re-render discipline (same as knowledge-room): views build once; same-view
 * data ticks resync only what changed (title, block stack when NOT editing);
 * a missing page id renders an honest not-found interim that retries on data
 * ticks (deep-URL-before-load + id-swap transients self-resolve).
 */

import { getState, subscribe } from '../core/state';
import { navigate, shareHash, parseHash, onHashChange } from '../core/router';
import { getActiveStore } from '../core/active-store';
import { getEditorSettings } from '../registry/registry';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import { escapeText } from '../core/dom-utils';
import {
  PAGE_SUBTYPE, PAGE_INTENTS, PAGE_INTENT_HINTS, type PageIntent,
  isPageNarrative, listPages, pageIntentOf, blocksOf, blockSummary,
  findUniquePageName, newBlockId, pageBlocksPatch,
  type PageBlock, type HeadingBlock, type ProseBlock, type ElementCardBlock,
} from '../core/sharing';
import { renderBlockView, renderPageView, populatedCardFields } from './share-page-render';
import { humanizeFieldName } from './element-detail-fields';
import { pickElement } from '../ui/element-picker-modal';
import type { Element } from '../core/types';
import { ToastManager } from '../ui/toast-manager';
import type { JSONContent } from '@tiptap/core';
import type { ShareEditorHandle } from './share-editor';

export function mountShareRoom(target: HTMLElement, toasts: ToastManager): () => void {
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-share-room';
  target.appendChild(root);

  let mountedView: string | null = null;        // 'list' | '<pageId>' | null
  // Whether the mounted view found its target — false = not-found interim;
  // same-view ticks retry a full build (resolves load/id-swap transients).
  let mountedResolved = true;
  // Visitor preview toggle (detail view) — ephemeral, resets on view switch.
  let previewMode = false;
  // Elements ref at last build — same-view ticks skip work when the data
  // didn't change (hash-echo renders, ui-slice patches).
  let lastBuiltElementsRef: readonly Element[] | null = null;

  const wid = () => getState().active?.worldId ?? null;
  const elOf = (id: string): Element | undefined => getState().data.elements.find(e => e.id === id);
  const resolveName = (id: string): string | null => elOf(id)?.name || null;

  // ---- writes ---------------------------------------------------------------

  // Page writes are SERIALIZED through a promise chain. Two rapid edits on
  // the same page (name blur + intent change, or successive block edits)
  // would otherwise race inside FolderStore.updateElement's read-merge-write:
  // the second call's read snapshot predates the first call's write, so the
  // second write silently reverts the first field (lost update). The chain
  // guarantees each patch reads the previous patch's result.
  let writeChain: Promise<void> = Promise.resolve();

  function patchPage(id: string, patch: Record<string, unknown>): Promise<void> {
    writeChain = writeChain.then(async () => {
      const folder = getActiveStore();
      if (!folder) return;
      try {
        await folder.updateElement(id, patch as Partial<Element>);
        await refreshElementsAfterWrite(folder);
        requestPushIfLinked();
      } catch (err) {
        console.error('[share-room] update failed', err);
        toasts.error('Could not update page');
      }
    });
    return writeChain;
  }

  /** Every blocks mutation funnels here — refs mirror + story stay in lockstep. */
  function saveBlocks(pageId: string, next: readonly PageBlock[]): Promise<void> {
    return patchPage(pageId, pageBlocksPatch(next, resolveName));
  }

  /** "+ new page": create immediately with a unique name, land in the detail view. */
  async function createPage(): Promise<void> {
    const worldId = wid();
    const folder = getActiveStore();
    if (!worldId || !folder) return;
    try {
      const created = await folder.createElement('narrative', {
        name: findUniquePageName(getState().data.elements),
        subtype: PAGE_SUBTYPE,
        story: '',
        atlas_page_intent: 'show',
        atlas_page_blocks: [],
        atlas_page_refs: [],
      } as Partial<Element>);
      await refreshElementsAfterWrite(folder);
      requestPushIfLinked();
      navigate(shareHash(worldId, created.id));
    } catch (err) {
      console.error('[share-room] create failed', err);
      toasts.error('Could not create page');
    }
  }

  /**
   * Delete a page. Confirm gated by the Editing setting (same as
   * element-detail / knowledge); navigate to the list BEFORE the data tick so
   * the detail view never renders not-found for its own deletion.
   */
  async function deletePage(id: string): Promise<void> {
    const folder = getActiveStore();
    const worldId = wid();
    if (!folder || !worldId) return;
    const el = elOf(id);
    if (getEditorSettings(getState().registry).confirm_before_delete) {
      let dependentCount = 0;
      try {
        dependentCount = (await folder.findDependents(id)).length;
      } catch { /* fall through with 0 */ }
      const extra = dependentCount > 0
        ? ` This will also remove ${dependentCount} dependent element${dependentCount === 1 ? '' : 's'}.`
        : '';
      if (!window.confirm(`Delete "${el?.name || 'this page'}"?${extra}`)) return;
    }
    teardownEditSession();
    navigate(shareHash(worldId));
    try {
      await folder.deleteElement(id);
      await refreshElementsAfterWrite(folder);
      requestPushIfLinked();
      toasts.success(`Deleted ${el?.name || 'page'}`);
    } catch (err) {
      console.error('[share-room] delete failed', err);
      toasts.error('Could not delete page');
    }
  }

  // ---- block edit session -----------------------------------------------------

  let editingBlockId: string | null = null;
  let blocksHost: HTMLElement | null = null;
  let lastRenderedBlocksJson: string | null = null;

  // Prose editor session (one live editor at a time; lazy TipTap chunk).
  let proseMount: ShareEditorHandle | null = null;
  let proseMountToken = 0;
  let pendingProseTimer: number | null = null;
  let pendingProseSnap: { markdown: string; json: JSONContent } | null = null;
  let proseForBlockId: string | null = null;

  /** Debounce window matches inline field edits (registry pref, default 1s). */
  function getSaveDebounceMs(): number {
    const ms = getState().registry.sync_debounce_ms;
    return typeof ms === 'number' && ms >= 200 ? ms : 1000;
  }

  function scheduleProseSave(pageId: string, snap: { markdown: string; json: JSONContent }): void {
    pendingProseSnap = snap;
    if (pendingProseTimer !== null) window.clearTimeout(pendingProseTimer);
    pendingProseTimer = window.setTimeout(() => {
      pendingProseTimer = null;
      void flushProseSave(pageId);
    }, getSaveDebounceMs());
  }

  /** Fold the pending prose snapshot into the block stack and save. */
  async function flushProseSave(pageId: string): Promise<void> {
    if (pendingProseTimer !== null) {
      window.clearTimeout(pendingProseTimer);
      pendingProseTimer = null;
    }
    const snap = pendingProseSnap;
    pendingProseSnap = null;
    const blockId = proseForBlockId;
    if (!snap || !blockId) return;
    const page = elOf(pageId);
    if (!page) return;
    const blocks = blocksOf(page).map(b =>
      b.id === blockId && b.kind === 'prose'
        ? { ...b, markdown: snap.markdown, richtextJson: snap.json }
        : b,
    );
    await saveBlocks(pageId, blocks);
  }

  /** Commit whatever's open (prose flush / heading input), then close the editor. */
  async function commitOpenEdit(pageId: string): Promise<void> {
    if (!editingBlockId) return;
    // Heading commit: read the input value directly (it lives in the DOM).
    const headingInput = blocksHost?.querySelector<HTMLInputElement>('.atlas-share-heading-input');
    if (headingInput) {
      const blockId = editingBlockId;
      const level = headingInput.dataset.level === '2' ? 2 : 1;
      const text = headingInput.value.trim();
      const page = elOf(pageId);
      if (page) {
        const blocks = blocksOf(page).map(b =>
          b.id === blockId && b.kind === 'heading' ? { ...b, text: text || 'heading', level: level as 1 | 2 } : b,
        );
        await saveBlocks(pageId, blocks);
      }
    }
    if (proseMount && proseForBlockId) {
      // Capture the freshest content even if no transaction fired since the
      // last debounce reset.
      pendingProseSnap = { markdown: proseMount.getMarkdown(), json: proseMount.getJson() };
      await flushProseSave(pageId);
    }
    teardownEditSession();
  }

  function teardownEditSession(): void {
    if (pendingProseTimer !== null) {
      window.clearTimeout(pendingProseTimer);
      pendingProseTimer = null;
    }
    pendingProseSnap = null;
    proseMount?.destroy();
    proseMount = null;
    proseForBlockId = null;
    editingBlockId = null;
    proseMountToken++;
  }

  /**
   * Flush an open prose edit, then tear down. For paths that leave the detail
   * view without an explicit commit (direct URL change, room unmount).
   * `flushProseSave` reads its inputs before the first await, so the in-flight
   * write completes correctly even though teardown follows synchronously.
   */
  function flushAndTeardown(pageId: string | null): void {
    if (pageId && pageId !== 'list' && proseMount && proseForBlockId) {
      pendingProseSnap = { markdown: proseMount.getMarkdown(), json: proseMount.getJson() };
      void flushProseSave(pageId);
    }
    teardownEditSession();
  }

  const onPageHide = (): void => {
    // Flush an in-flight prose edit on tab close/reload (same idiom as the
    // knowledge room). The mountedView IS the pageId in detail view.
    if (proseMount && proseForBlockId && mountedView && mountedView !== 'list') {
      pendingProseSnap = { markdown: proseMount.getMarkdown(), json: proseMount.getJson() };
      void flushProseSave(mountedView);
    }
  };
  window.addEventListener('pagehide', onPageHide);

  // ---- structural block ops -----------------------------------------------------

  async function addBlock(pageId: string, kind: 'heading' | 'prose'): Promise<void> {
    await commitOpenEdit(pageId);
    const page = elOf(pageId);
    if (!page) return;
    const block: PageBlock = kind === 'heading'
      ? { id: newBlockId(), kind: 'heading', text: 'heading', level: 1 }
      : { id: newBlockId(), kind: 'prose', markdown: '', richtextJson: null };
    const blocks = [...blocksOf(page), block];
    await saveBlocks(pageId, blocks);
    // Open the new block for editing right away — add-then-type flow.
    editingBlockId = block.id;
    renderBlocks(pageId);
  }

  /** "+ element card": pick the element first, then add + open for configuring. */
  async function addElementCard(pageId: string): Promise<void> {
    await commitOpenEdit(pageId);
    const picked = await pickElement({ title: 'Add an element card' });
    if (!picked) return;
    const page = elOf(pageId);
    if (!page) return;
    const block: PageBlock = {
      id: newBlockId(), kind: 'element-card', elementId: picked.id, variant: 'compact', fields: [],
    };
    await saveBlocks(pageId, [...blocksOf(page), block]);
    editingBlockId = block.id;
    renderBlocks(pageId);
  }

  async function moveBlock(pageId: string, blockId: string, dir: -1 | 1): Promise<void> {
    await commitOpenEdit(pageId);
    const page = elOf(pageId);
    if (!page) return;
    const blocks = blocksOf(page);
    const i = blocks.findIndex(b => b.id === blockId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= blocks.length) return;
    const next = blocks.slice();
    [next[i], next[j]] = [next[j], next[i]];
    await saveBlocks(pageId, next);
    renderBlocks(pageId);
  }

  async function deleteBlock(pageId: string, blockId: string): Promise<void> {
    await commitOpenEdit(pageId);
    const page = elOf(pageId);
    if (!page) return;
    const blocks = blocksOf(page);
    const block = blocks.find(b => b.id === blockId);
    if (!block) return;
    // Prose with real content gets a confirm — saves are immediate, so there
    // is no undo. Headings/empty prose delete silently (trivially re-added).
    if (block.kind === 'prose' && block.markdown.trim().length > 0) {
      if (!window.confirm('Delete this text block? Its content is not recoverable.')) return;
    }
    await saveBlocks(pageId, blocks.filter(b => b.id !== blockId));
    renderBlocks(pageId);
  }

  // ---- block rendering ------------------------------------------------------------

  /** Static render of one block (display mode — delegates to the portable renderer). */
  function renderStaticBlock(block: PageBlock): HTMLElement {
    const content = document.createElement('div');
    content.className = 'atlas-share-block-content';
    if (block.kind === 'prose' && block.markdown.trim().length === 0) {
      // Builder-only affordance: an empty prose block invites a click.
      const empty = document.createElement('p');
      empty.className = 'atlas-share-block-placeholder';
      empty.textContent = 'empty text block — click to write';
      content.appendChild(empty);
      return content;
    }
    const byId = new Map(getState().data.elements.map(e => [e.id, e]));
    content.appendChild(renderBlockView(block, byId));
    return content;
  }

  /** Inline editor for a heading block. */
  function renderHeadingEditor(pageId: string, block: HeadingBlock): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'atlas-share-block-editing atlas-share-heading-edit';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'atlas-input atlas-share-heading-input';
    input.value = block.text;
    input.dataset.level = String(block.level);
    input.placeholder = 'heading…';
    wrap.appendChild(input);

    const levels = document.createElement('div');
    levels.className = 'atlas-share-heading-levels';
    for (const lvl of [1, 2] as const) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'atlas-share-heading-level' + (Number(input.dataset.level) === lvl ? ' is-active' : '');
      btn.textContent = `H${lvl}`;
      btn.title = lvl === 1 ? 'Section heading' : 'Subsection heading';
      // mousedown + preventDefault so clicking the toggle doesn't blur-commit
      // the input mid-choice.
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        input.dataset.level = String(lvl);
        levels.querySelectorAll('.atlas-share-heading-level').forEach((b, idx) => {
          b.classList.toggle('is-active', idx === lvl - 1);
        });
        input.focus();
      });
      levels.appendChild(btn);
    }
    wrap.appendChild(levels);

    const commit = () => { void commitThenRender(pageId); };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
    });
    input.addEventListener('blur', (e) => {
      // Level-toggle clicks preventDefault on mousedown so blur only fires
      // for genuine focus departures.
      const to = e.relatedTarget as HTMLElement | null;
      if (to && wrap.contains(to)) return;
      commit();
    });
    queueMicrotask(() => { input.focus(); input.select(); });
    return wrap;
  }

  /** Inline editor for a prose block — lazy TipTap mount. */
  function renderProseEditor(pageId: string, block: ProseBlock): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'atlas-share-block-editing atlas-share-prose-edit';

    const host = document.createElement('div');
    // Inherits the writing prose typography/chips/hints; the share-specific
    // class scopes the context menu. The writing-room :has() chrome rules key
    // off .atlas-writing-workspace, which has no ancestor here — no leakage.
    host.className = 'atlas-writing-workspace-prose atlas-share-prose-rich';
    host.innerHTML = '<div class="atlas-share-prose-loading">loading editor…</div>';
    wrap.appendChild(host);

    const doneRow = document.createElement('div');
    doneRow.className = 'atlas-share-block-edit-actions';
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'atlas-btn-ghost atlas-share-block-done';
    done.textContent = 'done';
    done.title = 'Save and close this block';
    done.addEventListener('click', () => { void commitThenRender(pageId); });
    doneRow.appendChild(done);
    wrap.appendChild(doneRow);

    const token = ++proseMountToken;
    void import('./share-editor').then(mod => {
      if (token !== proseMountToken || !root.contains(host)) return; // view moved on
      host.innerHTML = '';
      proseForBlockId = block.id;
      proseMount = mod.mountShareEditor({
        host,
        roomRoot: root,
        initialJson: (block.richtextJson && typeof block.richtextJson === 'object')
          ? block.richtextJson as JSONContent : null,
        initialMarkdown: block.markdown,
        toasts,
        onSnapshot: (snap) => scheduleProseSave(pageId, snap),
      });
      proseMount.focus();
    }).catch(err => {
      console.error('[share-room] editor chunk failed to load', err);
      host.innerHTML = '<div class="atlas-share-prose-loading">editor failed to load — reload to retry</div>';
    });

    return wrap;
  }

  async function commitThenRender(pageId: string): Promise<void> {
    await commitOpenEdit(pageId);
    renderBlocks(pageId);
  }

  /** Patch one card block's config (discrete clicks — no debounce needed). */
  async function patchCardBlock(
    pageId: string,
    blockId: string,
    change: Partial<Pick<ElementCardBlock, 'elementId' | 'variant' | 'fields'>>,
  ): Promise<void> {
    const page = elOf(pageId);
    if (!page) return;
    const blocks = blocksOf(page).map(b =>
      b.id === blockId && b.kind === 'element-card' ? { ...b, ...change } : b,
    );
    await saveBlocks(pageId, blocks);
    renderBlocks(pageId);
  }

  /** Inline editor for an element-card block: binding, variant, field choice. */
  function renderCardEditor(pageId: string, block: ElementCardBlock): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'atlas-share-block-editing atlas-share-card-edit';
    const el = elOf(block.elementId);

    // Live preview of the card as configured.
    const byId = new Map(getState().data.elements.map(e => [e.id, e]));
    const preview = renderBlockView(block, byId);
    preview.classList.add('atlas-share-card-edit-preview');
    wrap.appendChild(preview);

    // Binding row.
    const bindRow = document.createElement('div');
    bindRow.className = 'atlas-share-card-edit-row';
    const changeBtn = document.createElement('button');
    changeBtn.type = 'button';
    changeBtn.className = 'atlas-btn-ghost';
    changeBtn.textContent = el ? `element: ${el.name || '(unnamed)'} — change…` : 'pick element…';
    changeBtn.addEventListener('click', () => {
      void (async () => {
        const picked = await pickElement({ title: 'Bind card to…' });
        // Re-picking resets the field choice — the old element's fields
        // don't apply to the new one.
        if (picked) await patchCardBlock(pageId, block.id, { elementId: picked.id, fields: [] });
      })();
    });
    bindRow.appendChild(changeBtn);

    // Variant toggle.
    const variants = document.createElement('div');
    variants.className = 'atlas-share-card-edit-variants';
    for (const v of ['compact', 'full'] as const) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'atlas-share-heading-level' + (block.variant === v ? ' is-active' : '');
      btn.textContent = v;
      btn.title = v === 'compact' ? 'Identity row only' : 'Identity + chosen fields';
      btn.addEventListener('click', () => { void patchCardBlock(pageId, block.id, { variant: v }); });
      variants.appendChild(btn);
    }
    bindRow.appendChild(variants);
    wrap.appendChild(bindRow);

    // Field checklist (full variant) — the disclosure primitive: only the
    // checked fields appear on the card / in the published snapshot.
    if (block.variant === 'full' && el) {
      const fieldsWrap = document.createElement('div');
      fieldsWrap.className = 'atlas-share-card-edit-fields';
      const label = document.createElement('div');
      label.className = 'atlas-share-field-label';
      label.textContent = 'Visible fields';
      fieldsWrap.appendChild(label);
      const available = populatedCardFields(el);
      if (available.length === 0) {
        const none = document.createElement('p');
        none.className = 'atlas-share-section-hint';
        none.textContent = 'This element has no populated fields beyond its name.';
        fieldsWrap.appendChild(none);
      }
      for (const field of available) {
        const row = document.createElement('label');
        row.className = 'atlas-share-card-edit-fieldrow';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = block.fields.includes(field);
        cb.addEventListener('change', () => {
          const next = cb.checked
            ? [...block.fields, field]
            : block.fields.filter(f => f !== field);
          // Keep chosen-field order stable: disk order of the element.
          const ordered = available.filter(f => next.includes(f));
          void patchCardBlock(pageId, block.id, { fields: ordered });
        });
        row.appendChild(cb);
        const name = document.createElement('span');
        name.textContent = humanizeFieldName(field);
        row.appendChild(name);
        fieldsWrap.appendChild(row);
      }
      wrap.appendChild(fieldsWrap);
    }

    const doneRow = document.createElement('div');
    doneRow.className = 'atlas-share-block-edit-actions';
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'atlas-btn-ghost atlas-share-block-done';
    done.textContent = 'done';
    done.addEventListener('click', () => { void commitThenRender(pageId); });
    doneRow.appendChild(done);
    wrap.appendChild(doneRow);

    return wrap;
  }

  /** Rebuild the block stack UI (display + at most one inline editor). */
  function renderBlocks(pageId: string): void {
    if (!blocksHost) return;
    const page = elOf(pageId);
    if (!page) return;
    const blocks = blocksOf(page);
    lastRenderedBlocksJson = JSON.stringify((page as Record<string, unknown>).atlas_page_blocks ?? []);
    blocksHost.innerHTML = '';

    if (blocks.length === 0 && !editingBlockId) {
      const empty = document.createElement('p');
      empty.className = 'atlas-share-section-hint';
      empty.textContent = 'No blocks yet — the page is an ordered stack. Add a heading or text below.';
      blocksHost.appendChild(empty);
    }

    blocks.forEach((block, i) => {
      const row = document.createElement('div');
      row.className = 'atlas-share-block' + (editingBlockId === block.id ? ' is-editing' : '');
      row.dataset.blockId = block.id;
      row.dataset.blockKind = block.kind;

      if (editingBlockId === block.id) {
        if (block.kind === 'heading') row.appendChild(renderHeadingEditor(pageId, block));
        else if (block.kind === 'prose') row.appendChild(renderProseEditor(pageId, block));
        else row.appendChild(renderCardEditor(pageId, block));
      } else {
        const content = renderStaticBlock(block);
        content.classList.add('is-editable');
        content.title = 'Click to edit';
        content.addEventListener('click', () => {
          void (async () => {
            await commitOpenEdit(pageId);
            editingBlockId = block.id;
            renderBlocks(pageId);
          })();
        });
        row.appendChild(content);

        const controls = document.createElement('div');
        controls.className = 'atlas-share-block-controls';
        const up = controlBtn('keyboard_arrow_up', 'Move up', () => { void moveBlock(pageId, block.id, -1); });
        const down = controlBtn('keyboard_arrow_down', 'Move down', () => { void moveBlock(pageId, block.id, 1); });
        if (i === 0) up.disabled = true;
        if (i === blocks.length - 1) down.disabled = true;
        controls.appendChild(up);
        controls.appendChild(down);
        controls.appendChild(controlBtn('close', 'Delete block', () => { void deleteBlock(pageId, block.id); }));
        row.appendChild(controls);
      }
      blocksHost!.appendChild(row);
    });

    // Add-block menu.
    const addRow = document.createElement('div');
    addRow.className = 'atlas-share-block-add';
    addRow.appendChild(addBtn('title', '+ heading', () => { void addBlock(pageId, 'heading'); }));
    addRow.appendChild(addBtn('notes', '+ text', () => { void addBlock(pageId, 'prose'); }));
    addRow.appendChild(addBtn('badge', '+ element card', () => { void addElementCard(pageId); }));
    blocksHost.appendChild(addRow);
  }

  function controlBtn(icon: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'atlas-share-block-ctrl';
    b.title = title;
    b.innerHTML = `<span class="material-symbols-outlined">${icon}</span>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  function addBtn(icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'atlas-btn-ghost atlas-share-block-add-btn';
    b.innerHTML = `<span class="material-symbols-outlined">${icon}</span> ${escapeText(label)}`;
    b.addEventListener('click', onClick);
    return b;
  }

  // ---- not-found interim ------------------------------------------------------

  function renderNotFound(): void {
    const worldId = wid()!;
    root.innerHTML = '';
    blocksHost = null;
    mountedResolved = false;
    const header = document.createElement('header');
    header.className = 'atlas-room-header atlas-share-detail-header';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'atlas-btn-ghost atlas-share-back';
    back.innerHTML = `<span class="material-symbols-outlined">arrow_back</span> all pages`;
    back.addEventListener('click', () => navigate(shareHash(worldId)));
    header.appendChild(back);
    root.appendChild(header);
    const empty = document.createElement('div');
    empty.className = 'atlas-share-empty';
    empty.innerHTML = `
      <p class="atlas-share-empty-title">Page not found.</p>
      <p class="atlas-share-hint">It may still be loading, or it no longer exists in this world.</p>
    `;
    root.appendChild(empty);
  }

  // ---- list view ----------------------------------------------------------------

  function buildList(): void {
    const worldId = wid()!;
    root.innerHTML = '';
    blocksHost = null;
    mountedResolved = true;
    lastBuiltElementsRef = getState().data.elements;

    const header = document.createElement('header');
    header.className = 'atlas-room-header';
    header.innerHTML = `
      <h1>Share</h1>
      <p class="atlas-room-subtitle">
        Compose pages from your world — to show something off, hand a group
        exactly what they know, or publish a curated destination. Publishing
        to a public URL arrives with the OnlyWorlds backend.
      </p>
    `;
    root.appendChild(header);

    const actions = document.createElement('div');
    actions.className = 'atlas-share-actions';
    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'atlas-btn-ghost atlas-share-new';
    newBtn.title = 'Create a new page';
    newBtn.textContent = '+ new page';
    newBtn.addEventListener('click', () => { void createPage(); });
    actions.appendChild(newBtn);
    root.appendChild(actions);

    const pages = listPages(getState().data.elements)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    if (pages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'atlas-share-empty';
      empty.innerHTML = `
        <p class="atlas-share-empty-title">No pages yet.</p>
        <p class="atlas-share-hint">
          A page is a stack of blocks — headings, prose, element cards — built
          from your world's elements. Create one to start composing.
        </p>
      `;
      root.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'atlas-share-list';
    for (const page of pages) {
      const intent = pageIntentOf(page);
      const blocks = blocksOf(page);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'atlas-share-row';
      row.innerHTML = `
        <span class="material-symbols-outlined atlas-share-row-icon">article</span>
        <span class="atlas-share-row-main">
          <span class="atlas-share-row-name">${escapeText(page.name || '(untitled)')}</span>
          <span class="atlas-share-row-meta">${escapeText(blockSummary(blocks))}</span>
        </span>
        <span class="atlas-share-intent-chip" data-intent="${intent}">${intent}</span>
      `;
      row.addEventListener('click', () => navigate(shareHash(worldId, page.id)));
      list.appendChild(row);
    }
    root.appendChild(list);
  }

  // ---- detail view ----------------------------------------------------------------

  function buildDetail(pageId: string): void {
    const worldId = wid()!;
    const page = elOf(pageId);
    if (!page || !isPageNarrative(page)) {
      renderNotFound();
      return;
    }
    root.innerHTML = '';
    mountedResolved = true;
    lastBuiltElementsRef = getState().data.elements;

    const header = document.createElement('header');
    header.className = 'atlas-room-header atlas-share-detail-header';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'atlas-btn-ghost atlas-share-back';
    back.innerHTML = `<span class="material-symbols-outlined">arrow_back</span> all pages`;
    back.addEventListener('click', () => {
      void commitOpenEdit(pageId).then(() => navigate(shareHash(worldId)));
    });
    header.appendChild(back);

    const titleRow = document.createElement('div');
    titleRow.className = 'atlas-share-detail-titlerow';
    titleRow.innerHTML = `<h1>${escapeText(page.name || '(untitled)')}</h1>`;
    // Visitor preview toggle — render the page exactly as a reader would see
    // it (the portable renderer; same path the viewer tool will run).
    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'atlas-share-preview-toggle' + (previewMode ? ' is-active' : '');
    previewBtn.title = previewMode ? 'Back to the builder' : 'Preview as a visitor';
    previewBtn.innerHTML = previewMode
      ? `<span class="material-symbols-outlined">edit</span> edit`
      : `<span class="material-symbols-outlined">visibility</span> preview`;
    previewBtn.addEventListener('click', () => {
      void (async () => {
        await commitOpenEdit(pageId);
        previewMode = !previewMode;
        buildDetail(pageId);
      })();
    });
    titleRow.appendChild(previewBtn);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'atlas-share-delete';
    del.title = 'Delete this page';
    del.innerHTML = `<span class="material-symbols-outlined">delete</span>`;
    del.addEventListener('click', () => { void deletePage(page.id); });
    titleRow.appendChild(del);
    header.appendChild(titleRow);
    root.appendChild(header);

    // Preview mode: the reader's view, nothing else.
    if (previewMode) {
      const byId = new Map(getState().data.elements.map(e => [e.id, e]));
      root.appendChild(renderPageView({
        title: page.name || '(untitled)',
        blocks: blocksOf(page),
        elements: byId,
      }));
      return;
    }

    const body = document.createElement('div');
    body.className = 'atlas-share-detail';
    root.appendChild(body);

    // Name
    const nameField = document.createElement('div');
    nameField.className = 'atlas-share-field';
    nameField.innerHTML = `<label class="atlas-share-field-label">Name</label>`;
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'atlas-input atlas-share-name';
    nameInput.placeholder = 'page name…';
    nameInput.value = page.name || '';
    nameInput.addEventListener('blur', () => {
      const v = nameInput.value.trim();
      // Compare against CURRENT state, not the build-time snapshot (the
      // rename-revert lesson from the knowledge room).
      const current = elOf(pageId)?.name || '';
      if (v && v !== current) void patchPage(pageId, { name: v });
    });
    nameField.appendChild(nameInput);
    body.appendChild(nameField);

    // Intent
    const intentField = document.createElement('div');
    intentField.className = 'atlas-share-field';
    intentField.innerHTML = `<label class="atlas-share-field-label">Intent</label>`;
    const intentSelect = document.createElement('select');
    intentSelect.className = 'atlas-select atlas-share-intent';
    for (const i of PAGE_INTENTS) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${i} — ${PAGE_INTENT_HINTS[i]}`;
      intentSelect.appendChild(opt);
    }
    intentSelect.value = pageIntentOf(page);
    intentSelect.addEventListener('change', () => {
      const v = intentSelect.value as PageIntent;
      if ((PAGE_INTENTS as string[]).includes(v)) void patchPage(pageId, { atlas_page_intent: v });
    });
    intentField.appendChild(intentSelect);
    body.appendChild(intentField);

    // Blocks — the builder.
    const blocksSection = document.createElement('section');
    blocksSection.className = 'atlas-share-section';
    blocksSection.innerHTML = `<h2 class="atlas-share-section-title">Blocks</h2>`;
    blocksHost = document.createElement('div');
    blocksHost.className = 'atlas-share-blocks';
    blocksSection.appendChild(blocksHost);
    body.appendChild(blocksSection);
    renderBlocks(pageId);
  }

  /**
   * Same-view tick (detail): sync title; refresh chips inside a live prose
   * editor; re-render the block stack only when NOT editing and the stored
   * blocks actually changed (a pull, another device, an id-swap rewrite).
   * Never clobber an open editor — serialized writes mean our save lands last.
   */
  function refreshDetailData(pageId: string): void {
    const page = elOf(pageId);
    if (!page || !isPageNarrative(page)) {
      teardownEditSession();
      renderNotFound();
      return;
    }
    const h1 = root.querySelector('.atlas-share-detail-titlerow h1');
    const title = page.name || '(untitled)';
    if (h1 && h1.textContent !== title) h1.textContent = title;

    if (previewMode) return; // static reader view — rebuilt on toggle, not per tick
    if (editingBlockId) {
      proseMount?.refresh(getState().data.elements);
      return;
    }
    const blocksJson = JSON.stringify((page as Record<string, unknown>).atlas_page_blocks ?? []);
    if (blocksJson !== lastRenderedBlocksJson) renderBlocks(pageId);
  }

  // ---- render dispatch ------------------------------------------------------

  function render(): void {
    if (!wid()) {
      root.innerHTML = '<div class="atlas-pane-empty">No active world.</div>';
      teardownEditSession();
      mountedView = null;
      return;
    }
    const route = parseHash(window.location.hash);
    const pid = route.mode === 'share' ? route.pageId : undefined;
    const tgt = pid ?? 'list';

    if (tgt === mountedView) {
      if (!mountedResolved) {
        // Not-found interim — retry a full build on every tick.
        if (tgt === 'list') buildList();
        else buildDetail(tgt);
        return;
      }
      if (getState().data.elements !== lastBuiltElementsRef) {
        if (tgt === 'list') rebuildPreservingScroll(buildList);
        else refreshDetailData(tgt);
        lastBuiltElementsRef = getState().data.elements;
      }
      return;
    }

    // View switch — flush + tear down any live editor session (back-button
    // commits explicitly; this is the defensive path for direct URL changes).
    flushAndTeardown(mountedView);
    previewMode = false;
    mountedView = tgt;
    if (tgt === 'list') buildList();
    else buildDetail(tgt);
  }

  /** Full rebuild that keeps the scroll position (room root is the scroll container). */
  function rebuildPreservingScroll(build: () => void): void {
    const st = root.scrollTop;
    build();
    queueMicrotask(() => { root.scrollTop = st; });
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  return () => {
    flushAndTeardown(mountedView);
    window.removeEventListener('pagehide', onPageHide);
    unsubState();
    unsubHash();
  };
}
