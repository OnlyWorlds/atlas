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
 * Publishing (S4, live): the Publish section drives publish / republish /
 * revoke through `sync/sharing-client.ts` (contract v0.3, slug-addressed
 * mutations) and mirrors the served state into `atlas_page_pub`.
 *
 * Re-render discipline (same as knowledge-room): views build once; same-view
 * data ticks resync only what changed (title, block stack when NOT editing);
 * a missing page id renders an honest not-found interim that retries on data
 * ticks (deep-URL-before-load + id-swap transients self-resolve).
 */

import { getState, subscribe } from '../core/state';
import { navigate, shareHash, elementHash, settingsHash, parseHash, onHashChange } from '../core/router';
import { getActiveStore } from '../core/active-store';
import { getEditorSettings } from '../registry/registry';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import { completeWaypoint } from '../core/waypoints';
import { escapeText } from '../core/dom-utils';
import {
  PAGE_SUBTYPE,
  isPageNarrative, listPages, pageIntentOf, blocksOf, blockSummary,
  findUniquePageName, newBlockId, pageBlocksPatch, pagePubOf, pageContentSig,
  pageThemeOf, PAGE_THEME_ACCENTS, PAGE_THEME_FONTS, type PageTheme,
  type PageBlock, type HeadingBlock, type ProseBlock, type ElementCardBlock,
} from '../core/sharing';
import { renderBlockView, renderPayloadPage, populatedCardFields, setBuilderCharts } from './share-page-render';
import type { ChartConfig } from '../visualization/timeline/types';
import { buildPagePayload } from '../core/share-payload';
import {
  SharingClient, SharingApiError, sharingErrorMessage,
  isValidSlug, suggestSlug, publicUrlFor, type SharedPageRow,
} from '../sync/sharing-client';
import { humanizeFieldName } from './element-detail-fields';
import { pickElement } from '../ui/element-picker-modal';
import type { Element } from '../core/types';
import { ToastManager } from '../ui/toast-manager';
import type { JSONContent } from '@tiptap/core';
import type { ShareEditorHandle } from './share-editor';
import { makeEditableTitle, type EditableTitleHandle } from './editable-title';
import { makeDrillInPrefix } from '../ui/drill-in';

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
  // T-S7 meta row (Theme + Publish) expanded state — ephemeral, collapsed by
  // default so Blocks lead; resets on view switch.
  let metaExpanded = false;
  // Elements ref at last build — same-view ticks skip work when the data
  // didn't change (hash-echo renders, ui-slice patches).
  let lastBuiltElementsRef: readonly Element[] | null = null;
  let pageTitleHandle: EditableTitleHandle | null = null;  // detail header title (sync on tick)

  const wid = () => getState().active?.worldId ?? null;
  const elOf = (id: string): Element | undefined => getState().data.elements.find(e => e.id === id);
  const resolveName = (id: string): string | null => elOf(id)?.name || null;

  // The world's saved charts (.atlas/charts.json) — kept warm for chart blocks:
  // the builder freezes them live (setBuilderCharts) and publish/preview pass
  // them into buildPagePayload. Reloaded on mount + on the id-swap signal.
  let pageCharts: ChartConfig[] = [];
  async function refreshCharts(): Promise<void> {
    const folder = getActiveStore();
    pageCharts = folder ? await folder.readCharts() : [];
    setBuilderCharts(pageCharts);
    // Chart blocks freeze from pageCharts — force a block rebuild once warm so a
    // page opened directly (URL) with a chart block doesn't stay "chart not
    // found". renderBlocks bypasses render()'s same-elements skip-optimization.
    if (mountedView && mountedView !== 'list') renderBlocks(mountedView);
  }

  // ---- writes ---------------------------------------------------------------

  // Page writes are SERIALIZED through a promise chain. Two rapid edits on
  // the same page (name blur + intent change, or successive block edits)
  // would otherwise race inside FolderStore.updateElement's read-merge-write:
  // the second call's read snapshot predates the first call's write, so the
  // second write silently reverts the first field (lost update). The chain
  // guarantees each patch reads the previous patch's result.
  let writeChain: Promise<void> = Promise.resolve();

  /** Resolves true when the write landed — publish uses this to avoid toasting
   *  success over a failed mirror write. The chain itself never rejects. */
  function patchPage(id: string, patch: Record<string, unknown>): Promise<boolean> {
    const step = writeChain.then(async () => {
      const folder = getActiveStore();
      if (!folder) return false;
      try {
        await folder.updateElement(id, patch as Partial<Element>);
        await refreshElementsAfterWrite(folder);
        requestPushIfLinked();
        return true;
      } catch (err) {
        console.error('[share-room] update failed', err);
        toasts.error('Could not update page');
        return false;
      }
    });
    writeChain = step.then(() => undefined);
    return step;
  }

  /** Every blocks mutation funnels here — refs mirror + story stay in lockstep. */
  function saveBlocks(pageId: string, next: readonly PageBlock[]): Promise<boolean> {
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
      // Waypoint: page creation bypasses the element-create modal (hookmap wp2).
      completeWaypoint('first-element');
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

    // Published-page guard: deleting the element destroys the only mirror of
    // the slug — without a revoke-first, the server row would stay live and
    // count against the quota with NO recovery path in the UI. Always confirm
    // (regardless of the confirm_before_delete setting — this is a public,
    // destructive action) and take the public page down before the local delete.
    const pub = el ? pagePubOf(el) : null;
    let publishConfirmed = false;
    if (pub && !pub.revoked) {
      const client = sharingClientForActiveWorld();
      const url = publicUrlFor(pub.slug);
      const msg = client
        ? `"${el?.name || 'This page'}" is published at ${url}. Deleting it also takes the public page down. Continue?`
        : `"${el?.name || 'This page'}" is published at ${url}, but atlas can't reach the sharing server for this world. The public page would stay up with no way to revoke it from here. Delete anyway?`;
      if (!window.confirm(msg)) return;
      publishConfirmed = true;
      if (client) {
        try {
          await client.revoke(pub.slug);
        } catch (err) {
          if (!(err instanceof SharingApiError && err.code === 'not_found')) {
            surfaceSharingError(err, 'Could not take the public page down; page not deleted');
            return; // abort: retry the delete once the server is reachable
          }
          // not_found = already gone server-side; the delete may proceed.
        }
      }
    }

    if (!publishConfirmed && getEditorSettings(getState().registry).confirm_before_delete) {
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
    // Route the delete through the same chain as page writes — a queued
    // name/intent/block patch lands (or fails) before the file disappears,
    // instead of throwing "element not found" into a misleading error toast.
    writeChain = writeChain.then(async () => {
      try {
        await folder.deleteElement(id);
        await refreshElementsAfterWrite(folder);
        requestPushIfLinked();
        toasts.success(`Deleted ${el?.name || 'page'}`);
      } catch (err) {
        console.error('[share-room] delete failed', err);
        toasts.error('Could not delete page');
      }
    });
    await writeChain;
  }

  // ---- block edit session -----------------------------------------------------

  let editingBlockId: string | null = null;
  let blocksHost: HTMLElement | null = null;

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

  /**
   * Read an open heading editor's input (it lives in the DOM) and fold it
   * into the block stack. Returns the save promise, or null when no heading
   * edit is open. No teardown — callers decide.
   */
  function captureHeadingEdit(pageId: string): Promise<unknown> | null {
    if (!editingBlockId) return null;
    const headingInput = blocksHost?.querySelector<HTMLInputElement>('.atlas-share-heading-input');
    if (!headingInput) return null;
    const blockId = editingBlockId;
    const level = headingInput.dataset.level === '2' ? 2 : 1;
    const text = headingInput.value.trim();
    const page = elOf(pageId);
    if (!page) return null;
    const blocks = blocksOf(page).map(b =>
      b.id === blockId && b.kind === 'heading' ? { ...b, text: text || 'heading', level: level as 1 | 2 } : b,
    );
    return saveBlocks(pageId, blocks);
  }

  /** Commit whatever's open (prose flush / heading input), then close the editor. */
  async function commitOpenEdit(pageId: string): Promise<void> {
    if (!editingBlockId) return;
    const headingSave = captureHeadingEdit(pageId);
    if (headingSave) await headingSave;
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
   * Flush an open edit (prose OR heading), then tear down. For paths that
   * leave the detail view without an explicit commit (direct URL change, room
   * unmount). `flushProseSave` / `captureHeadingEdit` read their inputs before
   * the first await, so the in-flight write completes correctly even though
   * teardown follows synchronously.
   */
  function flushAndTeardown(pageId: string | null): void {
    if (pageId && pageId !== 'list') {
      if (proseMount && proseForBlockId) {
        pendingProseSnap = { markdown: proseMount.getMarkdown(), json: proseMount.getJson() };
        void flushProseSave(pageId);
      } else {
        void captureHeadingEdit(pageId); // null when no heading edit is open
      }
    }
    teardownEditSession();
  }

  const onPageHide = (): void => {
    // Flush an in-flight edit (prose or heading) on tab close/reload — same
    // idiom as the knowledge room. The mountedView IS the pageId in detail view.
    if (!mountedView || mountedView === 'list') return;
    if (proseMount && proseForBlockId) {
      pendingProseSnap = { markdown: proseMount.getMarkdown(), json: proseMount.getJson() };
      void flushProseSave(mountedView);
    } else {
      void captureHeadingEdit(mountedView); // best-effort, same as prose
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
    // A page can't card itself — exclude it from the pick.
    const picked = await pickElement({ title: 'Add an element', excludeIds: [pageId] });
    if (!picked) return;
    const page = elOf(pageId);
    if (!page) return;
    // Default = full + description: a bare identity row surprised the first
    // real publisher ("only shows pic and name?", Captain's smoke S254).
    // The editor's field picker narrows from here; compact stays available.
    const block: PageBlock = {
      id: newBlockId(), kind: 'element-card', elementId: picked.id, variant: 'full', fields: ['description'],
    };
    await saveBlocks(pageId, [...blocksOf(page), block]);
    editingBlockId = block.id;
    renderBlocks(pageId);
  }

  /**
   * "+ circle": pick the knower first (Circles = Collectives; lone-character
   * knowers arrive via the Knowledge room's "create page from this view"
   * bridge), then add + open for review.
   */
  async function addCircleBlock(pageId: string): Promise<void> {
    await commitOpenEdit(pageId);
    const picked = await pickElement({
      restrictToType: 'collective',
      title: 'Whose knowledge? (a circle)',
    });
    if (!picked) return;
    const page = elOf(pageId);
    if (!page) return;
    const block: PageBlock = { id: newBlockId(), kind: 'circle', knowerId: picked.id };
    await saveBlocks(pageId, [...blocksOf(page), block]);
    editingBlockId = block.id;
    renderBlocks(pageId);
  }

  /**
   * "+ map": pick the map, then add with ALL its current pins included
   * (include-list — pins placed later never auto-join a published page).
   */
  async function addMapBlock(pageId: string): Promise<void> {
    await commitOpenEdit(pageId);
    const picked = await pickElement({ restrictToType: 'map', title: 'Which map?' });
    if (!picked) return;
    const page = elOf(pageId);
    if (!page) return;
    const allPins = getState().data.elements
      .filter(e => e.type === 'pin' && (e as Record<string, unknown>).map_id === picked.id)
      .map(e => e.id);
    // Zones on the map = distinct zones referenced by a marker on this map
    // (markers are the only spatial truth). Initialized all-in like pins, so
    // new zones never auto-join a curated map.
    const allZones = [...new Set(getState().data.elements
      .filter(e => e.type === 'marker' && (e as Record<string, unknown>).map_id === picked.id)
      .map(e => (e as Record<string, unknown>).zone_id)
      .filter((z): z is string => typeof z === 'string' && z.length > 0))];
    const block: PageBlock = { id: newBlockId(), kind: 'map', mapId: picked.id, pinIds: allPins, zoneIds: allZones };
    await saveBlocks(pageId, [...blocksOf(page), block]);
    editingBlockId = block.id;
    renderBlocks(pageId);
  }

  /** "+ collection": pick the first member, then add + open for growing. */
  async function addCollectionBlock(pageId: string): Promise<void> {
    await commitOpenEdit(pageId);
    const picked = await pickElement({ title: 'Start a collection with…', excludeIds: [pageId] });
    if (!picked) return;
    const page = elOf(pageId);
    if (!page) return;
    const block: PageBlock = { id: newBlockId(), kind: 'collection', elementIds: [picked.id] };
    await saveBlocks(pageId, [...blocksOf(page), block]);
    editingBlockId = block.id;
    renderBlocks(pageId);
  }

  /** "+ chart": add a saved chart as a block (pick which one in the editor). */
  async function addChartBlock(pageId: string): Promise<void> {
    await commitOpenEdit(pageId);
    if (pageCharts.length === 0) {
      toasts.show('Save a chart in the Charts room first, then add it here.', 'info');
      return;
    }
    const page = elOf(pageId);
    if (!page) return;
    const block: PageBlock = { id: newBlockId(), kind: 'chart', chartId: pageCharts[0].id };
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
      empty.textContent = 'empty text block · click to write';
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
      // Escape commits (same semantics as Enter/blur) rather than leaving the
      // edit hanging — no discard affordance exists elsewhere in the builder.
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); commit(); }
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
      host.innerHTML = '';
      const fail = document.createElement('div');
      fail.className = 'atlas-share-prose-loading';
      fail.textContent = 'editor failed to load.';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'atlas-btn-ghost';
      retry.textContent = 'try again';
      retry.addEventListener('click', () => renderBlocks(pageId));
      host.appendChild(fail);
      host.appendChild(retry);
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
    change: Partial<Pick<ElementCardBlock, 'elementId' | 'variant' | 'fields' | 'showImage'>>,
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
    changeBtn.textContent = el ? `element: ${el.name || '(unnamed)'} · change…` : 'pick element…';
    changeBtn.addEventListener('click', () => {
      void (async () => {
        const picked = await pickElement({ title: 'Change card to…', excludeIds: [pageId] });
        // Re-picking resets the field choice to the same default a new card
        // gets — the old element's fields don't apply to the new one.
        if (picked) await patchCardBlock(pageId, block.id, { elementId: picked.id, fields: ['description'] });
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

    // Image toggle — only offered when the element actually has an image_url.
    // Off keeps the image out of the payload entirely (when no other card
    // wants it); compact renders it as a head avatar, full as a banner.
    const cardImageUrl = el ? (el as unknown as Record<string, unknown>).image_url : undefined;
    if (typeof cardImageUrl === 'string' && cardImageUrl.trim().length > 0) {
      const imgRow = document.createElement('label');
      imgRow.className = 'atlas-share-card-edit-fieldrow atlas-share-card-edit-imgrow';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = block.showImage !== false;
      cb.addEventListener('change', () => {
        void patchCardBlock(pageId, block.id, { showImage: cb.checked });
      });
      imgRow.appendChild(cb);
      const label = document.createElement('span');
      label.textContent = block.variant === 'compact' ? 'Show image (avatar)' : 'Show image';
      imgRow.appendChild(label);
      wrap.appendChild(imgRow);
    }

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
    done.title = 'Save and close this block';
    done.addEventListener('click', () => { void commitThenRender(pageId); });
    doneRow.appendChild(done);
    wrap.appendChild(doneRow);

    return wrap;
  }

  /** Inline editor for a circle block: live compiled preview + rebind. */
  function renderCircleEditor(pageId: string, block: Extract<PageBlock, { kind: 'circle' }>): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'atlas-share-block-editing atlas-share-circle-edit';
    const knower = elOf(block.knowerId);

    // Live preview of the compiled knowledge as configured.
    const byId = new Map(getState().data.elements.map(e => [e.id, e]));
    const preview = renderBlockView(block, byId);
    preview.classList.add('atlas-share-card-edit-preview');
    wrap.appendChild(preview);

    const bindRow = document.createElement('div');
    bindRow.className = 'atlas-share-card-edit-row';
    const changeBtn = document.createElement('button');
    changeBtn.type = 'button';
    changeBtn.className = 'atlas-btn-ghost';
    changeBtn.textContent = knower ? `circle: ${knower.name || '(unnamed)'} · change…` : 'pick circle…';
    changeBtn.addEventListener('click', () => {
      void (async () => {
        const picked = await pickElement({ restrictToType: 'collective', title: 'Whose knowledge? (a circle)' });
        if (!picked) return;
        const page = elOf(pageId);
        if (!page) return;
        const blocks = blocksOf(page).map(b =>
          b.id === block.id && b.kind === 'circle' ? { ...b, knowerId: picked.id } : b,
        );
        await saveBlocks(pageId, blocks);
        renderBlocks(pageId);
      })();
    });
    bindRow.appendChild(changeBtn);
    wrap.appendChild(bindRow);

    const hint = document.createElement('p');
    hint.className = 'atlas-share-section-hint';
    hint.textContent = 'Publishes a frozen copy of everything this circle holds; later knowledge edits never leak until you republish.';
    wrap.appendChild(hint);

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
    return wrap;
  }

  /** Drag-reorder: move blockId to sit at targetIndex (after removal). */
  async function moveBlockTo(pageId: string, blockId: string, targetIndex: number): Promise<void> {
    const page = elOf(pageId);
    if (!page) return;
    const blocks = blocksOf(page);
    const from = blocks.findIndex(b => b.id === blockId);
    if (from < 0) return;
    const next = blocks.slice();
    const [moved] = next.splice(from, 1);
    const to = Math.max(0, Math.min(targetIndex > from ? targetIndex - 1 : targetIndex, next.length));
    if (to === from) { renderBlocks(pageId); return; }
    next.splice(to, 0, moved);
    await saveBlocks(pageId, next);
    renderBlocks(pageId);
  }

  /** Inline editor for a map block: live preview + pin include-checklist. */
  function renderMapEditor(pageId: string, block: Extract<PageBlock, { kind: 'map' }>): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'atlas-share-block-editing atlas-share-map-edit';
    const map = elOf(block.mapId);

    // Live preview (frozen from world data — shows the unpublishable hint
    // when the map lacks image_url / dimensions).
    const byId = new Map(getState().data.elements.map(e => [e.id, e]));
    const preview = renderBlockView(block, byId);
    preview.classList.add('atlas-share-card-edit-preview');
    wrap.appendChild(preview);

    const bindRow = document.createElement('div');
    bindRow.className = 'atlas-share-card-edit-row';
    const changeBtn = document.createElement('button');
    changeBtn.type = 'button';
    changeBtn.className = 'atlas-btn-ghost';
    changeBtn.textContent = map ? `map: ${map.name || '(unnamed)'} · change…` : 'pick map…';
    changeBtn.addEventListener('click', () => {
      void (async () => {
        const picked = await pickElement({ restrictToType: 'map', title: 'Which map?' });
        if (!picked) return;
        const page = elOf(pageId);
        if (!page) return;
        // Re-picking resets the include-list to the new map's full pin set.
        const allPins = getState().data.elements
          .filter(e => e.type === 'pin' && (e as Record<string, unknown>).map_id === picked.id)
          .map(e => e.id);
        const blocks = blocksOf(page).map(b =>
          b.id === block.id && b.kind === 'map' ? { ...b, mapId: picked.id, pinIds: allPins } : b,
        );
        await saveBlocks(pageId, blocks);
        renderBlocks(pageId);
      })();
    });
    bindRow.appendChild(changeBtn);
    wrap.appendChild(bindRow);

    const patchMapBlock = async (change: Partial<Extract<PageBlock, { kind: 'map' }>>): Promise<void> => {
      const page = elOf(pageId);
      if (!page) return;
      const blocks = blocksOf(page).map(b =>
        b.id === block.id && b.kind === 'map' ? { ...b, ...change } : b,
      );
      await saveBlocks(pageId, blocks);
      renderBlocks(pageId);
    };

    // Labels toggle — always-visible pin labels (default on; off = hover-only).
    const labelsRow = document.createElement('label');
    labelsRow.className = 'atlas-share-card-edit-fieldrow atlas-share-card-edit-imgrow';
    const labelsCb = document.createElement('input');
    labelsCb.type = 'checkbox';
    labelsCb.checked = block.showLabels !== false;
    labelsCb.addEventListener('change', () => {
      void patchMapBlock({ showLabels: labelsCb.checked });
    });
    labelsRow.appendChild(labelsCb);
    const labelsText = document.createElement('span');
    labelsText.textContent = 'Show pin labels (off = on hover only)';
    labelsRow.appendChild(labelsText);
    wrap.appendChild(labelsRow);

    // Zone checklist (S299) — per-zone include-list, mirroring the pin
    // checklist. A zone "on this map" is one a marker on this map references.
    // block.zoneIds absent = all shown (legacy/friendly default); the first
    // toggle materializes the explicit list. Only rendered when the map
    // carries zones.
    const mapZones = (() => {
      const zoneIdsOnMap = new Set(getState().data.elements
        .filter(e => e.type === 'marker' && (e as Record<string, unknown>).map_id === block.mapId)
        .map(e => (e as Record<string, unknown>).zone_id)
        .filter((z): z is string => typeof z === 'string' && z.length > 0));
      return getState().data.elements.filter(e => e.type === 'zone' && zoneIdsOnMap.has(e.id));
    })();
    if (mapZones.length > 0) {
      const zoneAllIds = mapZones.map(z => z.id);
      const isZoneIncluded = (id: string): boolean =>
        block.zoneIds === undefined || block.zoneIds.includes(id);
      const zonesWrap = document.createElement('div');
      zonesWrap.className = 'atlas-share-card-edit-fields';
      const zLabelRow = document.createElement('div');
      zLabelRow.className = 'atlas-share-field-label';
      zLabelRow.textContent = 'Visible zones';
      const zAllBtn = document.createElement('button');
      zAllBtn.type = 'button';
      zAllBtn.className = 'atlas-share-map-pins-toggle';
      const zAllOn = zoneAllIds.every(isZoneIncluded);
      zAllBtn.textContent = zAllOn ? 'none' : 'all';
      zAllBtn.addEventListener('click', () => {
        void patchMapBlock({ zoneIds: zAllOn ? [] : [...zoneAllIds] });
      });
      zLabelRow.appendChild(zAllBtn);
      zonesWrap.appendChild(zLabelRow);
      for (const zone of mapZones) {
        const row = document.createElement('label');
        row.className = 'atlas-share-card-edit-fieldrow';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = isZoneIncluded(zone.id);
        cb.addEventListener('change', () => {
          // Materialize the explicit list from the current effective set.
          const current = block.zoneIds ?? zoneAllIds;
          const next = cb.checked
            ? [...new Set([...current, zone.id])]
            : current.filter(id => id !== zone.id);
          void patchMapBlock({ zoneIds: next });
        });
        row.appendChild(cb);
        const name = document.createElement('span');
        name.textContent = zone.name || '(unnamed zone)';
        row.appendChild(name);
        zonesWrap.appendChild(row);
      }
      wrap.appendChild(zonesWrap);
    }

    // Pin checklist — the disclosure primitive for maps: only checked pins
    // appear on the published snapshot.
    const mapPins = getState().data.elements
      .filter(e => e.type === 'pin' && (e as Record<string, unknown>).map_id === block.mapId);
    if (mapPins.length > 0) {
      const fieldsWrap = document.createElement('div');
      fieldsWrap.className = 'atlas-share-card-edit-fields';
      const labelRow = document.createElement('div');
      labelRow.className = 'atlas-share-field-label';
      labelRow.textContent = 'Visible pins';
      labelRow.title = 'Included pins share their element\'s name, type, description and image on the published page. Toggle "full" on a pin to share every populated field of that element.';
      // Visible, not tooltip-only: the full toggle went unfound in the
      // release smoke (Captain, S254). One line states the disclosure rule.
      const disclosureHint = document.createElement('p');
      disclosureHint.className = 'atlas-share-hint atlas-share-map-disclosure-hint';
      disclosureHint.textContent = 'Checked pins share name, type, description and image. Click full on a pin to share its whole profile.';
      const allBtn = document.createElement('button');
      allBtn.type = 'button';
      allBtn.className = 'atlas-share-map-pins-toggle';
      const allOn = mapPins.every(p => block.pinIds.includes(p.id));
      allBtn.textContent = allOn ? 'none' : 'all';
      allBtn.addEventListener('click', () => {
        // "none" also clears the full-profile opt-ins (B6 resting state).
        void patchMapBlock(allOn
          ? { pinIds: [], fullPinIds: [] }
          : { pinIds: mapPins.map(p => p.id), fullPinIds: block.fullPinIds ?? [] });
      });
      labelRow.appendChild(allBtn);
      fieldsWrap.appendChild(labelRow);
      fieldsWrap.appendChild(disclosureHint);
      for (const pin of mapPins) {
        const target = elOf((pin as Record<string, unknown>).element_id as string);
        const row = document.createElement('label');
        row.className = 'atlas-share-card-edit-fieldrow';
        const included = block.pinIds.includes(pin.id);
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = included;
        cb.addEventListener('change', () => {
          const next = cb.checked
            ? [...block.pinIds, pin.id]
            : block.pinIds.filter(id => id !== pin.id);
          // Un-including a pin also clears its full-profile opt-in — the
          // stricter default is the resting state (B6).
          const nextFull = cb.checked
            ? (block.fullPinIds ?? [])
            : (block.fullPinIds ?? []).filter(id => id !== pin.id);
          void patchMapBlock({ pinIds: next, fullPinIds: nextFull });
        });
        row.appendChild(cb);
        const name = document.createElement('span');
        name.textContent = target?.name || '(pin without element)';
        row.appendChild(name);
        if (included) {
          const isFull = (block.fullPinIds ?? []).includes(pin.id);
          const fullBtn = document.createElement('button');
          fullBtn.type = 'button';
          fullBtn.className = 'atlas-share-pin-full-toggle' + (isFull ? ' is-on' : '');
          fullBtn.textContent = 'full';
          fullBtn.title = isFull
            ? 'Sharing every populated field of this element. Click to share only name, type, description and image'
            : 'Sharing name, type, description and image. Click to share every populated field of this element';
          fullBtn.addEventListener('click', (e) => {
            e.preventDefault(); // inside a <label> — don't toggle the checkbox
            const curr = block.fullPinIds ?? [];
            const nextFull = isFull ? curr.filter(id => id !== pin.id) : [...curr, pin.id];
            void patchMapBlock({ fullPinIds: nextFull });
          });
          row.appendChild(fullBtn);
        }
        fieldsWrap.appendChild(row);
      }
      wrap.appendChild(fieldsWrap);
    } else {
      const none = document.createElement('p');
      none.className = 'atlas-share-section-hint';
      none.textContent = 'This map has no pins; it publishes as the image alone.';
      wrap.appendChild(none);
    }

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
    return wrap;
  }

  /** Inline editor for a collection block: member chips + add/remove. */
  function renderChartEditor(pageId: string, block: Extract<PageBlock, { kind: 'chart' }>): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'atlas-share-block-editing atlas-share-chart-edit';

    const setChart = async (chartId: string): Promise<void> => {
      const page = elOf(pageId);
      if (!page) return;
      const blocks = blocksOf(page).map(b =>
        b.id === block.id && b.kind === 'chart' ? { ...b, chartId } : b,
      );
      await saveBlocks(pageId, blocks);
      renderBlocks(pageId);
    };

    if (pageCharts.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'atlas-share-hint';
      hint.textContent = 'No saved charts yet. Save one in the Charts room, then pick it here.';
      wrap.appendChild(hint);
    } else {
      const label = document.createElement('div');
      label.className = 'atlas-share-editor-label';
      label.textContent = 'Which chart?';
      wrap.appendChild(label);

      const picker = document.createElement('div');
      picker.className = 'atlas-share-chart-picker';
      for (const c of pageCharts) {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'atlas-share-chart-option' + (c.id === block.chartId ? ' selected' : '');
        opt.textContent = c.name;
        opt.addEventListener('click', () => { void setChart(c.id); });
        picker.appendChild(opt);
      }
      wrap.appendChild(picker);

      const byId = new Map(getState().data.elements.map(e => [e.id, e]));
      const preview = renderBlockView(block, byId);
      preview.classList.add('atlas-share-card-edit-preview');
      wrap.appendChild(preview);
    }

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
    return wrap;
  }

  function renderCollectionEditor(pageId: string, block: Extract<PageBlock, { kind: 'collection' }>): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'atlas-share-block-editing atlas-share-collection-edit';

    // Live preview of the grid as configured.
    const byId = new Map(getState().data.elements.map(e => [e.id, e]));
    const preview = renderBlockView(block, byId);
    preview.classList.add('atlas-share-card-edit-preview');
    wrap.appendChild(preview);

    const saveMembers = async (next: string[]): Promise<void> => {
      const page = elOf(pageId);
      if (!page) return;
      const blocks = blocksOf(page).map(b =>
        b.id === block.id && b.kind === 'collection' ? { ...b, elementIds: next } : b,
      );
      await saveBlocks(pageId, blocks);
      renderBlocks(pageId);
    };

    // Member chips with remove.
    const chips = document.createElement('div');
    chips.className = 'atlas-share-collection-members';
    for (const id of block.elementIds) {
      const el = elOf(id);
      const chip = document.createElement('span');
      chip.className = 'atlas-share-card-chip atlas-share-collection-member';
      chip.append(el?.name || '(missing)');
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'atlas-share-collection-member-x';
      x.title = 'Remove from collection';
      x.textContent = '×';
      x.addEventListener('click', () => {
        void saveMembers(block.elementIds.filter(m => m !== id));
      });
      chip.appendChild(x);
      chips.appendChild(chip);
    }
    wrap.appendChild(chips);

    const row = document.createElement('div');
    row.className = 'atlas-share-card-edit-row';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'atlas-btn-ghost';
    addBtn.textContent = '+ add element';
    addBtn.addEventListener('click', () => {
      void (async () => {
        const picked = await pickElement({
          title: 'Add to collection',
          excludeIds: [pageId, ...block.elementIds],
        });
        if (picked) await saveMembers([...block.elementIds, picked.id]);
      })();
    });
    row.appendChild(addBtn);
    wrap.appendChild(row);

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
    return wrap;
  }

  /** Rebuild the block stack UI (display + at most one inline editor). */
  function renderBlocks(pageId: string): void {
    if (!blocksHost) return;
    const page = elOf(pageId);
    if (!page) return;
    const blocks = blocksOf(page);
    blocksHost.innerHTML = '';

    if (blocks.length === 0 && !editingBlockId) {
      const empty = document.createElement('p');
      empty.className = 'atlas-share-section-hint';
      empty.textContent = 'No blocks yet. A page is an ordered stack: add a heading, text, card, collection, map, chart, or circle below.';
      blocksHost.appendChild(empty);
    }

    blocks.forEach((block, i) => {
      const row = document.createElement('div');
      row.className = 'atlas-share-block' + (editingBlockId === block.id ? ' is-editing' : '');
      row.dataset.blockId = block.id;
      row.dataset.blockKind = block.kind;
      row.dataset.blockIndex = String(i);

      // Drag-reorder (display rows only — an open editor opts out so text
      // selection inside it never starts a drag). Arrow buttons remain the
      // keyboard/precision path.
      if (editingBlockId !== block.id) {
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
          // Any open editor commits first; the drag carries the block id.
          void commitOpenEdit(pageId);
          e.dataTransfer?.setData('text/atlas-block', block.id);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
          row.classList.add('is-dragging');
        });
        row.addEventListener('dragend', () => {
          row.classList.remove('is-dragging');
          blocksHost?.querySelectorAll('.is-drop-above, .is-drop-below').forEach(n =>
            n.classList.remove('is-drop-above', 'is-drop-below'));
        });
        row.addEventListener('dragover', (e) => {
          if (!e.dataTransfer?.types.includes('text/atlas-block')) return;
          e.preventDefault();
          const rect = row.getBoundingClientRect();
          const below = e.clientY > rect.top + rect.height / 2;
          row.classList.toggle('is-drop-above', !below);
          row.classList.toggle('is-drop-below', below);
        });
        row.addEventListener('dragleave', () => {
          row.classList.remove('is-drop-above', 'is-drop-below');
        });
        row.addEventListener('drop', (e) => {
          const draggedId = e.dataTransfer?.getData('text/atlas-block');
          if (!draggedId) return;
          e.preventDefault();
          const rect = row.getBoundingClientRect();
          const below = e.clientY > rect.top + rect.height / 2;
          row.classList.remove('is-drop-above', 'is-drop-below');
          if (draggedId === block.id) return;
          void moveBlockTo(pageId, draggedId, below ? i + 1 : i);
        });
      }

      if (editingBlockId === block.id) {
        if (block.kind === 'heading') row.appendChild(renderHeadingEditor(pageId, block));
        else if (block.kind === 'prose') row.appendChild(renderProseEditor(pageId, block));
        else if (block.kind === 'circle') row.appendChild(renderCircleEditor(pageId, block));
        else if (block.kind === 'collection') row.appendChild(renderCollectionEditor(pageId, block));
        else if (block.kind === 'map') row.appendChild(renderMapEditor(pageId, block));
        else if (block.kind === 'chart') row.appendChild(renderChartEditor(pageId, block));
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
        // Element-bearing blocks: jump to the element itself (builder-only
        // affordance — clicking the block body opens the block EDITOR, so the
        // navigation lives on an explicit control).
        if (block.kind === 'element-card' || block.kind === 'circle' || block.kind === 'map') {
          const targetId = block.kind === 'element-card' ? block.elementId
            : block.kind === 'circle' ? block.knowerId : block.mapId;
          const open = controlBtn('open_in_new', 'Open element', () => {
            const worldId = wid();
            if (worldId && elOf(targetId)) navigate(elementHash(worldId, targetId));
          });
          if (!elOf(targetId)) open.disabled = true;
          controls.appendChild(open);
        }
        const up = controlBtn('keyboard_arrow_up', 'Move up', () => { void moveBlock(pageId, block.id, -1); });
        const down = controlBtn('keyboard_arrow_down', 'Move down', () => { void moveBlock(pageId, block.id, 1); });
        if (i === 0) up.disabled = true;
        if (i === blocks.length - 1) down.disabled = true;
        controls.appendChild(up);
        controls.appendChild(down);
        controls.appendChild(controlBtn('delete', 'Delete block', () => { void deleteBlock(pageId, block.id); }));
        row.appendChild(controls);
      }
      blocksHost!.appendChild(row);
    });

    // Add-block menu.
    const addRow = document.createElement('div');
    addRow.className = 'atlas-share-block-add';
    addRow.appendChild(addBtn('title', '+ heading', () => { void addBlock(pageId, 'heading'); }, 'A section or subsection heading'));
    addRow.appendChild(addBtn('notes', '+ text', () => { void addBlock(pageId, 'prose'); }, 'A rich-text block with @-mentions'));
    addRow.appendChild(addBtn('badge', '+ element', () => { void addElementCard(pageId); }, 'One element: identity plus the fields you choose'));
    addRow.appendChild(addBtn('grid_view', '+ collection', () => { void addCollectionBlock(pageId); }, 'A grid of several elements (identity only)'));
    addRow.appendChild(addBtn('map', '+ map', () => { void addMapBlock(pageId); }, 'A map image with the pins you include'));
    addRow.appendChild(addBtn('show_chart', '+ chart', () => { void addChartBlock(pageId); }, 'A saved chart from the Charts room'));
    addRow.appendChild(addBtn('groups', '+ circle', () => { void addCircleBlock(pageId); }, 'A frozen snapshot of what a circle knows'));
    blocksHost.appendChild(addRow);

    // Embeddable-suggestions (D5b): a quiet discoverability line — what the
    // world already offers as blocks. Only non-zero kinds; hidden when none.
    const els = getState().data.elements;
    const circleCount = els.filter(e => e.type === 'collective'
      && String((e as Record<string, unknown>).subtype ?? '').toLowerCase() === 'circle').length;
    const mapCount = els.filter(e => e.type === 'map'
      && typeof (e as Record<string, unknown>).image_url === 'string'
      && ((e as Record<string, unknown>).image_url as string).trim()).length;
    const chartCount = pageCharts.length;
    const parts: string[] = [];
    if (circleCount) parts.push(`${circleCount} circle${circleCount === 1 ? '' : 's'}`);
    if (chartCount) parts.push(`${chartCount} saved chart${chartCount === 1 ? '' : 's'}`);
    if (mapCount) parts.push(`${mapCount} map${mapCount === 1 ? '' : 's'}`);
    if (parts.length > 0) {
      const hint = document.createElement('p');
      hint.className = 'atlas-share-embeddable-hint';
      hint.textContent = `from your world: ${parts.join(' · ')}`;
      blocksHost.appendChild(hint);
    }
  }

  /**
   * S3 — open a payload-true full-page preview in a NEW TAB as a standalone
   * document. Styles are serialized from the live document (vite injects
   * <style> tags in dev; the built CSS <link> is same-origin in prod — both
   * are readable via cssRules), so the blob page renders exactly like the
   * in-app preview with zero routing or shell changes. Cross-origin sheets
   * (Google Fonts) can't be read — their <link> tags are copied instead.
   */
  function openFullPagePreview(page: Element): void {
    const payload = buildPagePayload(page, getState().data.elements, pageCharts);
    const pageEl = renderPayloadPage(payload);
    let css = '';
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules)) css += rule.cssText + '\n';
      } catch { /* cross-origin — covered by the copied <link>s below */ }
    }
    const fontLinks = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"], link[rel="preconnect"]'))
      .filter(l => l.href.includes('fonts.googleapis') || l.href.includes('fonts.gstatic'))
      .map(l => l.outerHTML).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeText(page.name || 'page preview')}</title>${fontLinks}<style>${css}</style></head><body class="atlas-share-fullpreview">${pageEl.outerHTML}</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000); // tab has loaded by then
  }

  /** Inline link to a Settings tab — used by the Publish prerequisite hints (A6). */
  function settingsLink(worldId: string | null, tab: 'world' | 'onlyworlds', label: string): HTMLAnchorElement {
    const a = document.createElement('a');
    a.href = settingsHash(worldId, tab);
    a.className = 'atlas-share-settings-link';
    a.textContent = label;
    a.addEventListener('click', (e) => { e.preventDefault(); navigate(settingsHash(worldId, tab)); });
    return a;
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

  function addBtn(icon: string, label: string, onClick: () => void, title?: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'atlas-btn-ghost atlas-share-block-add-btn';
    if (title) b.title = title;
    b.innerHTML = `<span class="material-symbols-outlined">${icon}</span> ${escapeText(label)}`;
    b.addEventListener('click', onClick);
    return b;
  }

  // ---- publish (S4 — SHARING_CONTRACT v0.3, as-built) ---------------------------

  /** The sharing client for the active world, or null when not api-linked. */
  function sharingClientForActiveWorld(): SharingClient | null {
    const worldId = wid();
    const reg = getState().registry;
    const entry = reg.worlds.find(w => w.id === worldId);
    if (!entry?.api?.api_key || !reg.pin) return null;
    return new SharingClient({ apiKey: entry.api.api_key, pin: reg.pin });
  }

  function surfaceSharingError(err: unknown, fallback: string): void {
    if (err instanceof SharingApiError) toasts.error(sharingErrorMessage(err));
    else toasts.error(fallback);
    console.error('[share-room] sharing api', err);
  }

  /** Publish (or revive a tombstoned slug) → write the mirror → rebuild. */
  async function publishPage(pageId: string, slug: string): Promise<void> {
    const client = sharingClientForActiveWorld();
    if (!client) return;
    await commitOpenEdit(pageId);
    // A just-blurred name/intent patch is still queued in the write chain
    // (blur fires on the publish click's mousedown) — let it land before
    // reading the page, or the payload ships the stale title.
    await writeChain;
    const page = elOf(pageId);
    if (!page) return;
    try {
      const res = await client.publish({
        slug,
        title: page.name || '(untitled)',
        intent: pageIntentOf(page),
        payload: buildPagePayload(page, getState().data.elements, pageCharts),
      });
      const stamp = new Date().toISOString();
      const mirrored = await patchPage(pageId, {
        atlas_page_pub: {
          id: res.id, slug: res.slug, published_at: stamp, updated_at: stamp, revoked: false,
          content_sig: pageContentSig(page),
        },
      });
      if (mirrored) {
        toasts.success(`Published at ${publicUrlFor(res.slug)}`);
      } else {
        // The page IS live; only the local record failed. Don't claim success,
        // don't lose the URL.
        toasts.error(`Published at ${publicUrlFor(res.slug)}, but atlas couldn't record it locally. Keep that URL.`);
      }
      completeWaypoint('share'); // hookmap wp9 — the publish gesture succeeded
      if (mountedView === pageId) rebuildPreservingScroll(() => buildDetail(pageId));
    } catch (err) {
      surfaceSharingError(err, 'Could not publish page');
    }
  }

  /** Republish the current composition to the existing slug. */
  async function republishPage(pageId: string): Promise<void> {
    const client = sharingClientForActiveWorld();
    if (!client) return;
    await commitOpenEdit(pageId);
    await writeChain; // same stale-title guard as publishPage
    const page = elOf(pageId);
    const pub = page ? pagePubOf(page) : null;
    if (!page || !pub) return;
    try {
      // Mutations are slug-addressed (as-built) — pub.id stays in the mirror
      // for display/debugging but the slug is the wire address.
      const row = await client.republish(pub.slug, {
        title: page.name || '(untitled)',
        intent: pageIntentOf(page),
        payload: buildPagePayload(page, getState().data.elements, pageCharts),
      });
      const mirrored = await patchPage(pageId, {
        atlas_page_pub: {
          ...pub,
          updated_at: row?.updated_at ?? new Date().toISOString(),
          content_sig: pageContentSig(page),
        },
      });
      if (mirrored) {
        toasts.success('Republished; the public page is up to date');
      } else {
        // Same rule as publishPage: the public page IS updated; only the
        // local record failed. Don't claim the mirror is current.
        toasts.error('Republished; the public page is up to date, but atlas couldn\'t record it locally.');
      }
      if (mountedView === pageId) rebuildPreservingScroll(() => buildDetail(pageId));
    } catch (err) {
      if (err instanceof SharingApiError && err.code === 'not_found') {
        // Stale mirror — the server no longer has the row (reset, takedown
        // cleanup). Clear the mirror so the page returns to a publishable
        // state instead of a permanent dead-end.
        await patchPage(pageId, { atlas_page_pub: null });
        toasts.info('The sharing server no longer has this page. Publish it again.');
        if (mountedView === pageId) rebuildPreservingScroll(() => buildDetail(pageId));
        return;
      }
      surfaceSharingError(err, 'Could not republish page');
    }
  }

  /** Revoke — tombstone on the server; the mirror keeps the slug for revival. */
  async function revokePage(pageId: string): Promise<void> {
    const client = sharingClientForActiveWorld();
    if (!client) return;
    const page = elOf(pageId);
    const pub = page ? pagePubOf(page) : null;
    if (!page || !pub) return;
    if (!window.confirm(`Revoke "${page.name || 'this page'}"? The public link will show "no longer shared". You keep the slug and can republish it later.`)) return;
    try {
      await client.revoke(pub.slug);
      await patchPage(pageId, {
        atlas_page_pub: { ...pub, revoked: true, updated_at: new Date().toISOString() },
      });
      toasts.success('Revoked; the link no longer serves this page');
      if (mountedView === pageId) rebuildPreservingScroll(() => buildDetail(pageId));
    } catch (err) {
      if (err instanceof SharingApiError && err.code === 'not_found') {
        // Already gone server-side — the goal state is reached; record it.
        await patchPage(pageId, {
          atlas_page_pub: { ...pub, revoked: true, updated_at: new Date().toISOString() },
        });
        toasts.info('Already gone on the server; marked revoked here.');
        if (mountedView === pageId) rebuildPreservingScroll(() => buildDetail(pageId));
        return;
      }
      surfaceSharingError(err, 'Could not revoke page');
    }
  }

  /**
   * The Theme section (S3) — curated token pickers, collapsed behind a
   * summary row by default (most pages keep the OnlyWorlds defaults).
   * Every change patches `atlas_page_theme` whole (validated on read).
   */
  function buildThemeSection(page: Element): HTMLElement {
    const theme = pageThemeOf(page);
    const section = document.createElement('section');
    section.className = 'atlas-share-section atlas-share-theme';
    section.innerHTML = `<h2 class="atlas-share-section-title">Theme</h2>`;

    const patchTheme = (change: Partial<PageTheme>): void => {
      const next: Record<string, unknown> = { ...pageThemeOf(elOf(page.id) ?? page), ...change };
      for (const k of Object.keys(next)) {
        if (next[k] === undefined) delete next[k];
      }
      void patchPage(page.id, { atlas_page_theme: next }).then(() => {
        // Rebuild only this section — an open block editor must survive.
        const fresh = elOf(page.id);
        if (fresh && root.contains(section)) section.replaceWith(buildThemeSection(fresh));
      });
    };

    const grid = document.createElement('div');
    grid.className = 'atlas-share-theme-grid';

    // Accent swatches.
    const accentRow = document.createElement('div');
    accentRow.className = 'atlas-share-theme-row';
    accentRow.innerHTML = `<span class="atlas-share-field-label">Accent</span>`;
    const swatches = document.createElement('div');
    swatches.className = 'atlas-share-theme-swatches';
    const activeAccent = theme.accent ?? PAGE_THEME_ACCENTS[0].hex;
    for (const a of PAGE_THEME_ACCENTS) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'atlas-share-theme-swatch' + (a.hex === activeAccent ? ' is-active' : '');
      sw.style.setProperty('--swatch', a.hex);
      sw.title = a.name;
      sw.addEventListener('click', () => {
        patchTheme({ accent: a.hex === PAGE_THEME_ACCENTS[0].hex ? undefined : a.hex });
      });
      swatches.appendChild(sw);
    }
    accentRow.appendChild(swatches);
    grid.appendChild(accentRow);

    // Three-button / select token rows share one builder.
    const choiceRow = <T extends string>(
      label: string,
      options: ReadonlyArray<{ value: T; label: string }>,
      active: T,
      defaultValue: T,
      apply: (v: T | undefined) => void,
    ): HTMLElement => {
      const row = document.createElement('div');
      row.className = 'atlas-share-theme-row';
      row.innerHTML = `<span class="atlas-share-field-label">${escapeText(label)}</span>`;
      const opts = document.createElement('div');
      opts.className = 'atlas-share-theme-options';
      for (const o of options) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'atlas-share-heading-level' + (o.value === active ? ' is-active' : '');
        btn.textContent = o.label;
        btn.addEventListener('click', () => {
          apply(o.value === defaultValue ? undefined : o.value);
        });
        opts.appendChild(btn);
      }
      row.appendChild(opts);
      return row;
    };

    grid.appendChild(choiceRow('Font',
      PAGE_THEME_FONTS.map(f => ({ value: f.key, label: f.label })),
      theme.font ?? 'clean', 'clean', v => patchTheme({ font: v })));
    grid.appendChild(choiceRow('Mode',
      [{ value: 'dark', label: 'dark' }, { value: 'light', label: 'light' }] as const,
      theme.mode ?? 'dark', 'dark', v => patchTheme({ mode: v as PageTheme['mode'] })));
    grid.appendChild(choiceRow('Density',
      [{ value: 'compact', label: 'compact' }, { value: 'cozy', label: 'cozy' }, { value: 'airy', label: 'airy' }] as const,
      theme.density ?? 'cozy', 'cozy', v => patchTheme({ density: v as PageTheme['density'] })));
    grid.appendChild(choiceRow('Width',
      [{ value: 'narrow', label: 'narrow' }, { value: 'regular', label: 'regular' }, { value: 'wide', label: 'wide' }] as const,
      theme.width ?? 'regular', 'regular', v => patchTheme({ width: v as PageTheme['width'] })));

    // Cover image URL.
    const coverRow = document.createElement('div');
    coverRow.className = 'atlas-share-theme-row';
    coverRow.innerHTML = `<span class="atlas-share-field-label">Cover</span>`;
    const coverInput = document.createElement('input');
    coverInput.type = 'text';
    coverInput.className = 'atlas-input atlas-share-theme-cover';
    coverInput.placeholder = 'https://… image URL (optional banner)';
    coverInput.value = theme.cover ?? '';
    coverInput.addEventListener('blur', () => {
      const v = coverInput.value.trim();
      if (v === (theme.cover ?? '')) return;
      if (v && !/^https:\/\//i.test(v)) {
        toasts.error('Cover must be an https:// image URL');
        return;
      }
      patchTheme({ cover: v || undefined });
    });
    coverRow.appendChild(coverInput);
    grid.appendChild(coverRow);

    section.appendChild(grid);
    const hint = document.createElement('p');
    hint.className = 'atlas-share-section-hint';
    hint.textContent = 'Applies to the visitor preview and the published page. Defaults are the OnlyWorlds look.';
    section.appendChild(hint);
    return section;
  }

  /** The Publish section of the detail view (three states; see DESIGN_SHARING). */
  function buildPublishSection(page: Element): HTMLElement {
    const section = document.createElement('section');
    section.className = 'atlas-share-section atlas-share-publish';
    section.dataset.role = 'publish-section';
    section.innerHTML = `<h2 class="atlas-share-section-title">Publish</h2>`;

    const worldId = wid();
    const entry = getState().registry.worlds.find(w => w.id === worldId);
    const pub = pagePubOf(page);

    // State 1 — local-only world: publishing needs api credentials.
    if (!entry?.api?.api_key) {
      const hint = document.createElement('p');
      hint.className = 'atlas-share-section-hint atlas-share-publish-hint';
      hint.append('Publishing to a public URL needs an online world. Use ');
      hint.appendChild(settingsLink(worldId, 'world', '"Make online" in Settings → World'));
      hint.append(' first.');
      section.appendChild(hint);
      return section;
    }
    if (!getState().registry.pin) {
      const hint = document.createElement('p');
      hint.className = 'atlas-share-section-hint atlas-share-publish-hint';
      hint.append('Set your PIN in ');
      hint.appendChild(settingsLink(worldId, 'onlyworlds', 'Settings → OnlyWorlds'));
      hint.append(' to publish.');
      section.appendChild(hint);
      return section;
    }

    // State 3 — published and live.
    if (pub && !pub.revoked) {
      const row = document.createElement('div');
      row.className = 'atlas-share-publish-row';
      const url = publicUrlFor(pub.slug);
      const link = document.createElement('a');
      link.className = 'atlas-share-publish-url';
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = url;
      row.appendChild(link);
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'atlas-share-block-ctrl';
      copy.title = 'Copy public link';
      copy.innerHTML = `<span class="material-symbols-outlined">content_copy</span>`;
      copy.addEventListener('click', () => {
        void navigator.clipboard.writeText(url)
          .then(() => toasts.success('Link copied'))
          .catch(() => toasts.info(url));
      });
      row.appendChild(copy);
      section.appendChild(row);

      const meta = document.createElement('p');
      meta.className = 'atlas-share-section-hint';
      const fmt = (iso: string) => iso ? new Date(iso).toLocaleString() : '?';
      meta.textContent = `Frozen snapshot, published ${fmt(pub.published_at)} · updated ${fmt(pub.updated_at)}. World edits don't leak until you republish.`;
      section.appendChild(meta);

      // B1 (2026-07-03): content-signature drift = the public copy is behind.
      // A pre-B1 mirror has no sig and shows nothing — the next republish
      // stamps one.
      if (pub.content_sig && pageContentSig(page) !== pub.content_sig) {
        const stale = document.createElement('p');
        stale.className = 'atlas-share-section-hint atlas-share-publish-stale';
        const dot = document.createElement('span');
        dot.className = 'atlas-share-stale-dot';
        stale.appendChild(dot);
        stale.appendChild(document.createTextNode(
          'edited since publish; republish to update the public copy'));
        section.appendChild(stale);
      }

      const actions = document.createElement('div');
      actions.className = 'atlas-share-publish-actions';
      const repub = document.createElement('button');
      repub.type = 'button';
      repub.className = 'atlas-btn-ghost';
      repub.dataset.action = 'republish';
      repub.textContent = 'republish';
      repub.title = 'Push the current composition to the public URL';
      repub.addEventListener('click', () => {
        repub.disabled = true; // in-flight guard (same as publish)
        void republishPage(page.id).finally(() => { repub.disabled = false; });
      });
      actions.appendChild(repub);
      const rev = document.createElement('button');
      rev.type = 'button';
      rev.className = 'atlas-btn-ghost';
      rev.dataset.action = 'revoke';
      rev.textContent = 'revoke';
      rev.title = 'Take the page down. The link shows "no longer shared"; you keep the slug';
      rev.addEventListener('click', () => {
        rev.disabled = true;
        void revokePage(page.id).finally(() => { rev.disabled = false; });
      });
      actions.appendChild(rev);
      section.appendChild(actions);
      return section;
    }

    // State 2 — not published yet (or revoked → revival path, slug locked in).
    const hint = document.createElement('p');
    hint.className = 'atlas-share-section-hint';
    hint.textContent = pub?.revoked
      ? 'Revoked. Republishing restores this URL with the current composition.'
      : 'Publish a frozen snapshot to a public URL. Only what the blocks include is shared.';
    section.appendChild(hint);

    const row = document.createElement('div');
    row.className = 'atlas-share-publish-row';
    const prefix = document.createElement('span');
    prefix.className = 'atlas-share-publish-prefix';
    prefix.textContent = publicUrlFor('').replace(/^https?:\/\//, '');
    row.appendChild(prefix);
    const slugInput = document.createElement('input');
    slugInput.type = 'text';
    slugInput.className = 'atlas-input atlas-share-slug';
    slugInput.placeholder = 'your-page-url';
    slugInput.value = pub?.revoked ? pub.slug : suggestSlug(page.name || '');
    slugInput.disabled = Boolean(pub?.revoked); // revival reuses the owned slug
    row.appendChild(slugInput);
    const publishBtn = document.createElement('button');
    publishBtn.type = 'button';
    publishBtn.className = 'atlas-btn-primary atlas-share-publish-btn';
    publishBtn.dataset.action = 'publish';
    publishBtn.textContent = pub?.revoked ? 'republish' : 'publish';
    publishBtn.addEventListener('click', () => {
      const slug = slugInput.value.trim();
      if (!isValidSlug(slug)) {
        toasts.error('Slug must be 4–40 chars: a–z, 0–9, hyphens (not at the edges).');
        slugInput.focus();
        return;
      }
      publishBtn.disabled = true;
      void publishPage(page.id, slug).finally(() => { publishBtn.disabled = false; });
    });
    row.appendChild(publishBtn);
    section.appendChild(row);

    // A5: slug rules as a standing hint, not only an error toast on submit.
    if (!slugInput.disabled) {
      const slugHint = document.createElement('p');
      slugHint.className = 'atlas-share-section-hint atlas-share-slug-hint';
      slugHint.textContent = '4–40 characters: lowercase letters, numbers, hyphens (not at the start or end).';
      section.appendChild(slugHint);
    }

    // Revival locks the input to the owned slug — but an admin-locked slug
    // (or a deliberate rename) needs an escape hatch to a fresh URL. The old
    // tombstone stays owned; the mirror adopts the new slug on success.
    if (pub?.revoked) {
      const change = document.createElement('button');
      change.type = 'button';
      change.className = 'atlas-btn-ghost atlas-share-slug-change';
      change.textContent = 'use a different URL';
      change.title = 'Publish under a new slug instead of reviving this one';
      change.addEventListener('click', () => {
        slugInput.disabled = false;
        slugInput.focus();
        slugInput.select();
        publishBtn.textContent = 'publish';
        change.remove();
      });
      section.appendChild(change);
    }
    return section;
  }

  // ---- list-reconcile (mirror healing from server truth) -----------------------

  // Once per world per room-mount: the `atlas_page_pub` mirrors are display
  // caches; the sharing API rows are the truth. Reconcile heals drift from
  // other devices, backend resets, and admin takedowns. Quiet by design —
  // failure (offline, server down) leaves the mirrors as-is.
  const reconciledWorlds = new Set<string>();

  async function reconcilePubMirrors(worldId: string): Promise<void> {
    const client = sharingClientForActiveWorld();
    if (!client) return;
    let rows: SharedPageRow[];
    try {
      rows = await client.listForWorld(worldId);
    } catch {
      reconciledWorlds.delete(worldId); // retry on next room entry
      return;
    }
    const byId = new Map(rows.map(r => [r.id, r]));
    let healed = 0;
    for (const page of listPages(getState().data.elements)) {
      const pub = pagePubOf(page);
      if (!pub) continue;
      const row = byId.get(pub.id);
      if (!row) {
        // Server no longer has the row — the page is publishable again.
        if (await patchPage(page.id, { atlas_page_pub: null })) healed++;
        continue;
      }
      if (row.revoked !== pub.revoked || row.updated_at !== pub.updated_at || row.slug !== pub.slug) {
        const ok = await patchPage(page.id, {
          atlas_page_pub: {
            id: row.id, slug: row.slug, published_at: row.published_at,
            updated_at: row.updated_at, revoked: row.revoked,
          },
        });
        if (ok) healed++;
      }
    }
    if (healed > 0) {
      toasts.info(`Publish state refreshed from the server (${healed} page${healed === 1 ? '' : 's'})`);
    }
  }

  // ---- not-found interim ------------------------------------------------------

  function renderNotFound(): void {
    const worldId = wid()!;
    root.innerHTML = '';
    blocksHost = null;
    mountedResolved = false;
    const header = document.createElement('header');
    // Compact entity band, matching the resolved detail view (conv #80: a
    // single named entity gets .atlas-middle-header, not the room landing h1).
    header.className = 'atlas-middle-header atlas-share-detail-header';
    // D1 drill-in prefix — same affordance as the entity headers.
    header.appendChild(makeDrillInPrefix('Pages', () => navigate(shareHash(worldId))));
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

    // Background mirror-heal, once per world per mount (quiet on failure).
    if (!reconciledWorlds.has(worldId)) {
      reconciledWorlds.add(worldId);
      void reconcilePubMirrors(worldId);
    }

    const header = document.createElement('header');
    header.className = 'atlas-room-header';
    header.innerHTML = `
      <h1>Pages</h1>
      <p class="atlas-room-subtitle">Build pages from your world to share with anyone.</p>
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
          A page is a stack of blocks: headings, prose, elements, built
          from your world's elements. Create one to start composing.
        </p>
        <p class="atlas-share-empty-examples">a character showcase · a player handout · a world landing page</p>
        <p class="atlas-share-hint atlas-share-example-line"><a href="#/demo" class="atlas-welcome-demo-link">See an example page</a> · built from a real world, view only</p>
      `;
      root.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'atlas-share-list';
    for (const page of pages) {
      const blocks = blocksOf(page);
      const pub = pagePubOf(page);
      // Edited-since-publish, ON THE LIST (S309): the signal was computed and
      // shown only after opening the page — the list is where you scan for it.
      // Same sig comparison as the editor banner; string-concatenated because
      // pubBadge is an HTML string (escapeText, never appendChild here).
      const stale = pub && !pub.revoked && pub.content_sig && pageContentSig(page) !== pub.content_sig
        ? `<span class="atlas-share-row-stale" title="Edited since last publish">edited</span>`
        : '';
      const pubBadge = pub && !pub.revoked
        ? `<span class="atlas-share-row-pub" title="${escapeText(publicUrlFor(pub.slug))}"><span class="material-symbols-outlined">public</span>live</span>${stale}`
        : pub?.revoked
          ? `<span class="atlas-share-row-pub is-revoked" title="Revoked; slug ${escapeText(pub.slug)} held">revoked</span>`
          : '';
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'atlas-share-row';
      row.innerHTML = `
        <span class="material-symbols-outlined atlas-share-row-icon">article</span>
        <span class="atlas-share-row-main">
          <span class="atlas-share-row-name">${escapeText(page.name || '(untitled)')}</span>
          <span class="atlas-share-row-meta">${escapeText(blockSummary(blocks))}</span>
        </span>
        ${pubBadge}
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

    // Unified entity header (canon): compact band + click-to-edit title.
    const header = document.createElement('div');
    header.className = 'atlas-middle-header atlas-share-detail-header';
    // D1 drill-in: the clickable room-name prefix IS the back affordance.
    header.appendChild(makeDrillInPrefix('Pages', () => {
      void commitOpenEdit(pageId).then(() => navigate(shareHash(worldId)));
    }));

    const picon = document.createElement('span');
    picon.className = 'material-symbols-outlined';
    picon.textContent = 'article';
    picon.title = 'Page';
    header.appendChild(picon);

    pageTitleHandle = makeEditableTitle({
      initial: page.name || '',
      placeholder: 'page name…',
      ariaLabel: 'Page name',
      onCommit: (next) => {
        const current = elOf(pageId)?.name || '';
        if (next && next !== current) void patchPage(pageId, { name: next });
      },
    });
    header.appendChild(pageTitleHandle.el);

    const spacer = document.createElement('div');
    spacer.className = 'atlas-middle-spacer';
    header.appendChild(spacer);

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
        // Waypoint (hookmap wp9): only the flip INTO preview counts —
        // an explicit visitor-view gesture, not the auto-rendered pane.
        if (previewMode) completeWaypoint('share');
        buildDetail(pageId);
      })();
    });
    header.appendChild(previewBtn);
    // S3: full-page preview in its OWN tab — payload-true, standalone document.
    const fullPreview = document.createElement('button');
    fullPreview.type = 'button';
    fullPreview.className = 'atlas-share-preview-toggle';
    fullPreview.dataset.action = 'full-preview';
    fullPreview.title = 'Open a full-page preview in a new tab';
    fullPreview.innerHTML = `<span class="material-symbols-outlined">open_in_new</span> full page`;
    fullPreview.addEventListener('click', () => {
      void (async () => {
        await commitOpenEdit(pageId);
        await writeChain; // pending edits land before the snapshot
        const current = elOf(pageId);
        if (current) {
          openFullPagePreview(current);
          completeWaypoint('share'); // hookmap wp9 — explicit preview gesture
        }
      })();
    });
    header.appendChild(fullPreview);
    // Copy the §5 publish payload — inspection/debugging affordance (and the
    // concrete artifact for backend contract review).
    const copyPayload = document.createElement('button');
    copyPayload.type = 'button';
    copyPayload.className = 'atlas-share-preview-toggle';
    copyPayload.dataset.action = 'copy-payload';
    copyPayload.title = 'Copy this page as JSON (for the show viewer or manual sharing)';
    copyPayload.innerHTML = `<span class="material-symbols-outlined">data_object</span> copy JSON`;
    copyPayload.addEventListener('click', () => {
      void (async () => {
        await commitOpenEdit(pageId);
        await writeChain; // pending name/intent patches land before the snapshot
        const current = elOf(pageId);
        if (!current) return;
        const json = JSON.stringify(buildPagePayload(current, getState().data.elements, pageCharts), null, 2);
        try {
          await navigator.clipboard.writeText(json);
          toasts.success('Page JSON copied');
        } catch {
          console.info('[share-room] page JSON (clipboard unavailable):\n' + json);
          toasts.info('Clipboard unavailable; page JSON logged to console');
        }
      })();
    });
    header.appendChild(copyPayload);
    // The publish action, headlined. The T-S7 collapse buried publishing so
    // well its own designer hunted for it (Captain's smoke, S254) — the verb
    // belongs in the header; the button expands the meta and lands you there.
    const publishBtn = document.createElement('button');
    publishBtn.type = 'button';
    publishBtn.className = 'atlas-share-preview-toggle atlas-share-publish-cta';
    publishBtn.dataset.action = 'open-publish';
    const pubNow = pagePubOf(page);
    publishBtn.title = pubNow && !pubNow.revoked
      ? 'Publish settings: republish or take the live page down'
      : 'Publish this page to a public link';
    publishBtn.innerHTML = `<span class="material-symbols-outlined">public</span> ${pubNow && !pubNow.revoked ? 'published' : 'publish'}`;
    publishBtn.addEventListener('click', () => {
      void (async () => {
        await commitOpenEdit(pageId);
        if (previewMode) previewMode = false;
        metaExpanded = true;
        buildDetail(pageId);
        root.querySelector('[data-role="publish-section"]')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      })();
    });
    header.appendChild(publishBtn);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'atlas-share-delete';
    del.title = 'Delete this page';
    del.innerHTML = `<span class="material-symbols-outlined">delete</span>`;
    del.addEventListener('click', () => { void deletePage(page.id); });
    header.appendChild(del);
    root.appendChild(header);

    // Preview mode: the reader's view, rendered FROM THE PUBLISH PAYLOAD —
    // disclosure-true (contract §5.1). What the author sees here is exactly
    // what `GET /pages/<slug>/` will serve: non-included elements render as
    // plain text, included ones chip/link.
    if (previewMode) {
      root.appendChild(renderPayloadPage(buildPagePayload(page, getState().data.elements, pageCharts)));
      return;
    }

    const body = document.createElement('div');
    body.className = 'atlas-share-detail';
    root.appendChild(body);

    // (Name lives in the header as the editable title — no separate field.)

    // D5 (v1): the intent PICKER is removed — the three intents were
    // behaviorally identical and confused their own designer. The FIELD
    // stays: `atlas_page_intent` is still defaulted on create and still
    // ships on the wire (publish/republish send pageIntentOf — the fakes
    // and the server expect it). Hidden ≠ deleted; it returns WITH real
    // behavior post-launch.

    // T-S7: Theme + Publish collapse behind a slim summary row so Blocks —
    // the actual content — start on the first screenful.
    body.appendChild(buildMetaSummary(page, pageId));
    if (metaExpanded) {
      // Theme — S3 (curated tokens; applies to preview + published page).
      body.appendChild(buildThemeSection(page));
      // Publish — S4 (api-linked worlds; frozen-only per contract v0.3).
      body.appendChild(buildPublishSection(page));
    }

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
   * T-S7 — the slim meta row: accent swatch + theme words + publish state,
   * click to expand/collapse the full Theme + Publish sections. Collapsed by
   * default so the page opens on its content.
   */
  function buildMetaSummary(page: Element, pageId: string): HTMLElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'atlas-share-meta-summary' + (metaExpanded ? ' is-open' : '');
    row.title = metaExpanded ? 'Collapse theme and publish settings' : 'Theme and publish settings';

    const theme = pageThemeOf(page);
    const accent = theme.accent ?? PAGE_THEME_ACCENTS[0].hex;
    const swatch = document.createElement('span');
    swatch.className = 'atlas-share-meta-swatch';
    swatch.style.background = accent;
    row.appendChild(swatch);

    const themeWords = document.createElement('span');
    themeWords.className = 'atlas-share-meta-words';
    themeWords.textContent = `${theme.font ?? 'clean'} · ${theme.mode ?? 'dark'}`;
    row.appendChild(themeWords);

    const pub = pagePubOf(page);
    const pubState = document.createElement('span');
    pubState.className = 'atlas-share-meta-pub';
    if (pub && !pub.revoked) {
      pubState.textContent = `live · /${pub.slug}`;
      pubState.dataset.state = 'live';
    } else if (pub?.revoked) {
      pubState.textContent = 'revoked';
      pubState.dataset.state = 'revoked';
    } else {
      pubState.textContent = 'not published';
      pubState.dataset.state = 'none';
    }
    row.appendChild(pubState);

    const chev = document.createElement('span');
    chev.className = 'material-symbols-outlined atlas-share-meta-chevron';
    chev.textContent = metaExpanded ? 'expand_less' : 'expand_more';
    row.appendChild(chev);

    row.addEventListener('click', () => {
      metaExpanded = !metaExpanded;
      rebuildPreservingScroll(() => buildDetail(pageId));
    });
    return row;
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
    // Sync the header title (no-op while the user is editing it).
    pageTitleHandle?.sync(page.name || '');

    if (previewMode) return; // static reader view — rebuilt on toggle, not per tick
    if (editingBlockId) {
      proseMount?.refresh(getState().data.elements);
      return;
    }
    // Blocks render FROM world elements (map pins, card fields, circle
    // members, collection names), not only from the page's own block stack —
    // so every element-data tick re-renders them. Before 2026-07-19 this
    // gated on the block-stack JSON alone, and a pin dragged on the map tab
    // never moved on an open page's map block (Captain's live find). This
    // branch only runs when data.elements got a new reference, so the
    // rebuild cost rides real writes, never idle ticks.
    renderBlocks(pageId);
  }

  // ---- render dispatch ------------------------------------------------------

  function render(): void {
    if (!wid()) {
      root.innerHTML = '<div class="atlas-pane-empty">No active world.</div>';
      flushAndTeardown(mountedView); // best-effort flush, same as a view switch
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
    metaExpanded = false;
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

  void refreshCharts();
  const onChartsChanged = () => { void refreshCharts(); };
  window.addEventListener('atlas:charts-changed', onChartsChanged);
  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  return () => {
    flushAndTeardown(mountedView);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('atlas:charts-changed', onChartsChanged);
    unsubState();
    unsubHash();
  };
}
