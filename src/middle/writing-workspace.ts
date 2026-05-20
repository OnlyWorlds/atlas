/**
 * Writing workspace — dedicated prose-centric editor for the writing room.
 *
 * Replaces the schema-driven element-detail when route.mode === 'writing' AND
 * an active narrative is in the URL hierarchy (book/chapter/scene). The
 * narrative's `story` field renders as a TipTap richtext surface (with the
 * full JSON document mirrored to the atlas-local `atlas_richtext_json`
 * field — convention #47). All other narrative fields collapse into a
 * "Details" disclosure below the prose; the existing "References" panel
 * collapses into its own disclosure.
 *
 * Conventions: #46 (URL → active narrative, no selectedElementId mirror),
 * #47 (atlas_richtext_json storage), #48 (ow:// markdown link format),
 * #49 (atlas_aliases for linking), #50 (auto-derive relations on save),
 * #51 (workspace replaces element-detail in writing mode).
 *
 * See DESIGN_WRITING.md v3.0 for full design.
 */

import { getState, patchSlice, subscribe } from '../core/state';
import { onHashChange, parseHash, writingHash, elementHash, navigate } from '../core/router';
import type { Element, ElementType } from '../core/types';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../core/constants';
import { getActiveStore } from '../core/active-store';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import { toastManager } from '../ui/toast-manager';
import { escapeText } from '../core/dom-utils';
import { renderHeader } from './element-detail-header';
import { renderSection } from './element-detail-fields';
import { renderReferencedBy } from './element-detail-refs';
import { sectionsFor } from '../editor/field-schema';
import {
  getWritingLabels,
  getTierForNarrative,
  buildNarrativeIndex,
  ancestorIds,
} from './writing-helpers';
import { mountWorkspaceEditor, type WorkspaceEditorHandle } from './writing-workspace-editor';
import { type MentionSuggestionItem } from './writing-workspace-mention';
import { computeRelationPatch } from './writing-workspace-derive';
import { createChipPreview, type ChipPreviewController } from './writing-workspace-chip-preview';
import { getRecents, pushRecent } from './writing-workspace-recents';
import { WRITING_FOCUS_TOGGLE_EVENT } from '../core/hotkeys';
import type { JSONContent } from '@tiptap/core';

/**
 * Per-narrative collapsed state for the Details / References disclosures.
 * Persists across re-renders (same module-level pattern as element-detail's
 * scrollMemory). Keyed by narrative id; cleared on world switch.
 */
const detailsCollapsed = new Map<string, boolean>();
const referencesCollapsed = new Map<string, boolean>();
// Default collapsed state for newly-visited narratives — see openDisclosure.
const DEFAULT_DETAILS_COLLAPSED = true;
const DEFAULT_REFERENCES_COLLAPSED = true;

export function resetWritingWorkspaceMemory(): void {
  detailsCollapsed.clear();
  referencesCollapsed.clear();
}

export function mountWritingWorkspace(target: HTMLElement): () => void {
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-writing-workspace';
  target.appendChild(root);

  // Apply per-world prose font size (registry pref → CSS var on root).
  applyProseFontSize(root);

  let editorHandle: WorkspaceEditorHandle | null = null;
  let mountedForId: string | null = null;
  let lastSavedMarkdown: string | null = null;
  let pendingSaveTimer: number | null = null;
  let pendingSnapshot: { markdown: string; json: JSONContent } | null = null;
  // Singleton chip preview controller for this workspace mount — hover +
  // sticky-on-click peek of linked elements (DESIGN_WRITING.md §Click + hover).
  const chipPreview: ChipPreviewController = createChipPreview(root);

  // Focus mode (Cmd+Shift+F via hotkeys.ts) — toggles a class on the workspace
  // root. Sibling chrome (sidebar, room-nav) hides via `.atlas-shell:has(...)`
  // selectors in atlas.css. Esc exits while in focus mode.
  const onFocusToggle = (): void => {
    root.classList.toggle('is-focus-mode');
  };
  const onFocusEsc = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && root.classList.contains('is-focus-mode')) {
      e.preventDefault();
      e.stopPropagation();
      root.classList.remove('is-focus-mode');
    }
  };
  document.addEventListener(WRITING_FOCUS_TOGGLE_EVENT, onFocusToggle);
  // Capture phase so we beat the editor's own Esc handlers.
  document.addEventListener('keydown', onFocusEsc, true);

  function getActiveNarrative(): Element | null {
    const state = getState();
    const route = parseHash(window.location.hash);
    const id = route.narrativeId ?? null;
    if (!id) return null;
    return state.data.elements.find(e => e.id === id) ?? null;
  }

  /** Match the existing sync debounce window — same UX as inline field edits. */
  function getSaveDebounceMs(): number {
    const reg = getState().registry;
    const ms = (reg as any).sync_debounce_ms;
    return typeof ms === 'number' && ms >= 200 ? ms : 1000;
  }

  function scheduleSave(snapshot: { markdown: string; json: JSONContent }): void {
    pendingSnapshot = snapshot;
    if (pendingSaveTimer !== null) {
      window.clearTimeout(pendingSaveTimer);
    }
    pendingSaveTimer = window.setTimeout(() => {
      pendingSaveTimer = null;
      const snap = pendingSnapshot;
      pendingSnapshot = null;
      if (snap) void persistSnapshot(snap);
    }, getSaveDebounceMs());
  }

  /** Flush any pending save immediately. Called on narrative switch / unmount. */
  async function flushPendingSave(): Promise<void> {
    if (pendingSaveTimer !== null) {
      window.clearTimeout(pendingSaveTimer);
      pendingSaveTimer = null;
    }
    if (pendingSnapshot) {
      const snap = pendingSnapshot;
      pendingSnapshot = null;
      await persistSnapshot(snap);
    }
  }

  async function persistSnapshot(snap: { markdown: string; json: JSONContent }): Promise<void> {
    const el = getActiveNarrative();
    if (!el || el.id !== mountedForId) return;
    const folder = getActiveStore();
    if (!folder) return;

    // Skip no-op writes — markdown unchanged from last save.
    if (lastSavedMarkdown !== null && snap.markdown === lastSavedMarkdown) return;

    const relationPatch = computeRelationPatch(el, snap.markdown);
    const patch: Partial<Element> = {
      story: snap.markdown,
      atlas_richtext_json: snap.json as any,
      ...relationPatch,
    };

    try {
      await folder.updateElement(el.id, patch as any);
      lastSavedMarkdown = snap.markdown;
      await refreshElementsAfterWrite(folder);
      requestPushIfLinked();
      updateSaveStateIndicator('saved');
    } catch (err: any) {
      console.error('[writing-workspace] save failed', err);
      toastManager.error('Save failed: ' + (err?.message ?? 'unknown error'));
      updateSaveStateIndicator('error');
    }
  }

  // ============================================================================
  // Layout — header + breadcrumb + date + prose + collapsibles + footer
  // ============================================================================

  function render(): void {
    const state = getState();
    if (!state.active) {
      root.innerHTML = '<div class="atlas-pane-empty">No active world.</div>';
      teardownEditor();
      return;
    }
    const el = getActiveNarrative();
    if (!el) {
      // Should not happen — writing.ts dispatches to empty state instead.
      root.innerHTML = '<div class="atlas-pane-empty">No narrative selected.</div>';
      teardownEditor();
      return;
    }

    if (mountedForId !== el.id) {
      void flushPendingSave().then(() => mountForNarrative(el));
      return;
    }
    // Same narrative — refresh non-editor surfaces (header, breadcrumb,
    // disclosures) without remounting the editor (would clobber cursor).
    refreshNonEditorSurfaces(el);

    // Live-apply prose font size in case Settings → Writing changed it.
    applyProseFontSize(root);

    // Live chip label sync — propagate any element renames into the editor's
    // chip nodes. No-op when nothing changed; a single state-driven tick.
    if (editorHandle) {
      const elements = getState().data.elements;
      const byId = new Map<string, string>();
      for (const e of elements) byId.set(e.id, e.name || '');
      editorHandle.syncChipLabels((id) => byId.get(id) ?? null);
    }
  }

  function mountForNarrative(el: Element): void {
    teardownEditor();
    root.innerHTML = '';
    mountedForId = el.id;
    lastSavedMarkdown = (el as any).story ?? null;

    // 1. Header (reuse element-detail-header for visual + behavioral consistency).
    root.appendChild(renderHeader(el));

    // 2. Body wrapper — scrollable, with section spacing.
    const body = document.createElement('div');
    body.className = 'atlas-writing-workspace-body';
    body.dataset.elementId = el.id;
    root.appendChild(body);

    // 3. Breadcrumb + date row.
    body.appendChild(renderBreadcrumbAndDate(el));

    // 4. Prose surface (TipTap mounts here).
    const proseHost = document.createElement('div');
    proseHost.className = 'atlas-writing-workspace-prose';
    body.appendChild(proseHost);

    const initialJson = parseRichtextJson((el as any).atlas_richtext_json);
    const initialMarkdown = typeof (el as any).story === 'string' ? (el as any).story : '';

    editorHandle = mountWorkspaceEditor({
      target: proseHost,
      initialJson,
      initialMarkdown,
      onUpdate: (snap) => {
        scheduleSave({ markdown: snap.markdown, json: snap.json });
        updateWordCountIndicator(snap.wordCount);
        updateSaveStateIndicator('pending');
      },
      mentionItems: (query) => buildMentionItems(query),
      onChipHover: (chip, id, type) => chipPreview.scheduleHoverShow(chip, id, type),
      onChipUnhover: () => chipPreview.scheduleHoverHide(),
      onChipClick: (chip, id, type) => {
        // Sticky preview: card stays open until click-outside or Esc. The
        // card has an explicit "Open as element →" link for full navigation
        // — writers stay in writing mode unless they choose to leave.
        chipPreview.showSticky(chip, id, type);
      },
      onMentionInserted: (id) => {
        const worldId = getState().active?.worldId;
        if (worldId) pushRecent(worldId, id);
      },
    });

    // Sync chip labels to current element names immediately on mount — covers
    // the case where atlas_richtext_json was stored when elements had different
    // names. The synchronous sync triggers onUpdate (transaction = docChange),
    // which schedules a save; that save persists the now-fresh labels.
    const elements = getState().data.elements;
    const byId = new Map<string, string>();
    for (const e of elements) byId.set(e.id, e.name || '');
    editorHandle.syncChipLabels((id) => byId.get(id) ?? null);

    // 5. Details (collapsed) — wraps schema-driven fields, story excluded.
    body.appendChild(renderDetailsDisclosure(el));

    // 6. References (collapsed) — wraps element-detail-refs output.
    body.appendChild(renderReferencesDisclosure(el));

    // 7. Footer — word count + reading time + save state + open-as-element.
    body.appendChild(renderFooter(el));
  }

  function refreshNonEditorSurfaces(el: Element): void {
    // Update header, breadcrumb, disclosures — but DON'T touch the editor.
    // For v1 simplicity, we replace everything except the prose host. The
    // editor's DOM remains because we never wipe `.atlas-writing-workspace-prose`'s
    // contents — the editor instance owns that subtree.
    const body = root.querySelector<HTMLElement>('.atlas-writing-workspace-body');
    if (!body) return;

    // Replace header (cheap — the renderHeader function is the same one
    // element-detail uses; works fine to re-render on every state change).
    const oldHeader = root.querySelector<HTMLElement>('.atlas-middle-header');
    const newHeader = renderHeader(el);
    if (oldHeader) oldHeader.replaceWith(newHeader);

    // Replace breadcrumb/date row.
    const oldCrumb = body.querySelector<HTMLElement>('.atlas-writing-workspace-crumb');
    const newCrumb = renderBreadcrumbAndDate(el);
    if (oldCrumb) oldCrumb.replaceWith(newCrumb);

    // Replace Details disclosure (re-renders the schema fields with current values).
    const oldDetails = body.querySelector<HTMLElement>('.atlas-writing-workspace-details');
    const newDetails = renderDetailsDisclosure(el);
    if (oldDetails) oldDetails.replaceWith(newDetails);

    // Replace References disclosure.
    const oldRefs = body.querySelector<HTMLElement>('.atlas-writing-workspace-refs');
    const newRefs = renderReferencesDisclosure(el);
    if (oldRefs) oldRefs.replaceWith(newRefs);

    // Replace footer.
    const oldFooter = body.querySelector<HTMLElement>('.atlas-writing-workspace-footer');
    const newFooter = renderFooter(el);
    if (oldFooter) oldFooter.replaceWith(newFooter);
  }

  function teardownEditor(): void {
    if (editorHandle) {
      editorHandle.destroy();
      editorHandle = null;
    }
    mountedForId = null;
    lastSavedMarkdown = null;
  }

  // ============================================================================
  // Sub-renderers
  // ============================================================================

  function renderBreadcrumbAndDate(el: Element): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'atlas-writing-workspace-crumb';

    const state = getState();
    const worldId = state.active!.worldId;
    const labels = getWritingLabels(worldId);
    const idx = buildNarrativeIndex(state.data.elements, worldId);
    const chain = ancestorIds(idx, el.id);

    const crumbs: Array<{ id: string; name: string }> = [];
    for (const ancestorId of chain) {
      const node = idx.byId.get(ancestorId);
      if (node) crumbs.push({ id: ancestorId, name: node.el.name || '(unnamed)' });
    }
    crumbs.push({ id: el.id, name: el.name || '(unnamed)' });

    const crumbsRow = document.createElement('div');
    crumbsRow.className = 'atlas-writing-workspace-crumbs';
    crumbs.forEach((c, i) => {
      const isLast = i === crumbs.length - 1;
      const seg = document.createElement(isLast ? 'span' : 'a');
      seg.className = 'atlas-writing-workspace-crumb-seg' + (isLast ? ' is-current' : '');
      seg.textContent = c.name;
      if (!isLast) {
        (seg as HTMLAnchorElement).href = '#' + buildCrumbHash(worldId, c.id);
        seg.addEventListener('click', (e) => {
          e.preventDefault();
          navigate(buildCrumbHash(worldId, c.id));
        });
      }
      crumbsRow.appendChild(seg);
      if (!isLast) {
        const sep = document.createElement('span');
        sep.className = 'atlas-writing-workspace-crumb-sep';
        sep.textContent = ' › ';
        crumbsRow.appendChild(sep);
      }
    });
    wrap.appendChild(crumbsRow);

    // Date row — show start_date / end_date if present.
    const start = (el as any).start_date;
    const end = (el as any).end_date;
    if (start != null || end != null) {
      const dateRow = document.createElement('div');
      dateRow.className = 'atlas-writing-workspace-date';
      const icon = document.createElement('span');
      icon.className = 'material-symbols-outlined';
      icon.textContent = 'event';
      dateRow.appendChild(icon);
      const dateText = document.createElement('span');
      if (start != null && end != null) {
        dateText.textContent = `${start} → ${end}`;
      } else if (start != null) {
        dateText.textContent = String(start);
      } else {
        dateText.textContent = `→ ${end}`;
      }
      dateRow.appendChild(dateText);
      wrap.appendChild(dateRow);
    }

    return wrap;
  }

  function buildCrumbHash(worldId: string, narrativeId: string): string {
    // After URL-scheme shortening (session 227), each crumb segment is just a
    // direct writing-room URL for that narrative. Ancestry is derived from
    // parent_narrative at render time.
    return writingHash(worldId, narrativeId);
  }

  function renderDetailsDisclosure(el: Element): HTMLElement {
    const wrap = document.createElement('details');
    wrap.className = 'atlas-writing-workspace-details';
    const collapsed = detailsCollapsed.get(el.id) ?? DEFAULT_DETAILS_COLLAPSED;
    if (!collapsed) wrap.setAttribute('open', '');

    const summary = document.createElement('summary');
    summary.className = 'atlas-writing-workspace-disclosure-summary';
    summary.textContent = 'Details';
    wrap.appendChild(summary);

    wrap.addEventListener('toggle', () => {
      detailsCollapsed.set(el.id, !wrap.open);
    });

    const body = document.createElement('div');
    body.className = 'atlas-writing-workspace-disclosure-body';
    wrap.appendChild(body);

    // Render every section, with story field filtered out (it's the prose surface).
    const sections = sectionsFor(el.type);
    sections.forEach((section, idx) => {
      const filtered = {
        ...section,
        fields: section.fields.filter(f => f.name !== 'story'),
      };
      if (filtered.fields.length === 0) return;
      const sectionEl = renderSection(filtered, el, false);
      if (sectionEl) body.appendChild(sectionEl);
    });

    return wrap;
  }

  function renderReferencesDisclosure(el: Element): HTMLElement {
    const wrap = document.createElement('details');
    wrap.className = 'atlas-writing-workspace-refs';
    const collapsed = referencesCollapsed.get(el.id) ?? DEFAULT_REFERENCES_COLLAPSED;
    if (!collapsed) wrap.setAttribute('open', '');

    const summary = document.createElement('summary');
    summary.className = 'atlas-writing-workspace-disclosure-summary';
    summary.textContent = 'References';
    wrap.appendChild(summary);

    wrap.addEventListener('toggle', () => {
      referencesCollapsed.set(el.id, !wrap.open);
    });

    const refsBody = renderReferencedBy(el);
    if (refsBody) {
      wrap.appendChild(refsBody);
    } else {
      const empty = document.createElement('div');
      empty.className = 'atlas-writing-workspace-disclosure-body';
      empty.innerHTML = '<p class="atlas-pane-empty-inline">No other elements link to this narrative.</p>';
      wrap.appendChild(empty);
    }

    return wrap;
  }

  function renderFooter(el: Element): HTMLElement {
    const footer = document.createElement('div');
    footer.className = 'atlas-writing-workspace-footer';

    const left = document.createElement('div');
    left.className = 'atlas-writing-workspace-footer-left';
    // Reading-mode toggle (placeholder — wires up in Bout G).
    const readBtn = document.createElement('button');
    readBtn.type = 'button';
    readBtn.className = 'atlas-icon-btn-sm';
    readBtn.title = 'Reading mode';
    readBtn.setAttribute('aria-pressed', 'false');
    readBtn.innerHTML = '<span class="material-symbols-outlined">menu_book</span>';
    readBtn.addEventListener('click', () => {
      const isOn = root.classList.toggle('is-reading-mode');
      readBtn.setAttribute('aria-pressed', String(isOn));
    });
    left.appendChild(readBtn);
    footer.appendChild(left);

    const right = document.createElement('div');
    right.className = 'atlas-writing-workspace-footer-right';

    const wordCount = editorHandle?.getWordCount() ?? 0;
    const readingMin = Math.max(1, Math.round(wordCount / 250));

    const wcSpan = document.createElement('span');
    wcSpan.className = 'atlas-writing-workspace-wc';
    wcSpan.textContent = `${wordCount.toLocaleString()} words`;
    right.appendChild(wcSpan);

    const dot = document.createElement('span');
    dot.className = 'atlas-writing-workspace-sep';
    dot.textContent = '·';
    right.appendChild(dot);

    const rmSpan = document.createElement('span');
    rmSpan.textContent = `${readingMin} min read`;
    right.appendChild(rmSpan);

    const dot2 = document.createElement('span');
    dot2.className = 'atlas-writing-workspace-sep';
    dot2.textContent = '·';
    right.appendChild(dot2);

    const saveSpan = document.createElement('span');
    saveSpan.className = 'atlas-writing-workspace-save';
    saveSpan.dataset.state = 'idle';
    saveSpan.textContent = 'saved';
    right.appendChild(saveSpan);

    const openLink = document.createElement('a');
    openLink.className = 'atlas-writing-workspace-open-link';
    openLink.href = '#' + elementHash(getState().active!.worldId, el.id);
    openLink.textContent = 'Open as element →';
    openLink.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(elementHash(getState().active!.worldId, el.id));
    });
    right.appendChild(openLink);

    footer.appendChild(right);
    return footer;
  }

  function updateSaveStateIndicator(state: 'pending' | 'saved' | 'error'): void {
    const span = root.querySelector<HTMLElement>('.atlas-writing-workspace-save');
    if (!span) return;
    span.dataset.state = state;
    span.textContent = state === 'pending' ? 'saving…' : state === 'error' ? 'save failed' : 'saved';
  }

  function updateWordCountIndicator(wordCount: number): void {
    const span = root.querySelector<HTMLElement>('.atlas-writing-workspace-wc');
    if (!span) return;
    span.textContent = `${wordCount.toLocaleString()} words`;
  }

  // ============================================================================
  // Mention items provider — alias-aware fuzzy match across the world
  // ============================================================================

  function buildMentionItems(query: string): MentionSuggestionItem[] {
    const state = getState();
    if (!state.active) return [];
    const worldId = state.active.worldId;
    const q = query.toLowerCase().trim();
    const elements = state.data.elements;
    const byId = new Map<string, Element>();
    for (const e of elements) byId.set(e.id, e);

    // Element types that shouldn't appear in the picker — they aren't
    // narrative-linkable entities. Markers and pins are map-internal
    // (anchors on maps, not story characters/places). Narratives can't
    // link to themselves. Maps are debatable but excluded for v1 to keep
    // the picker focused on world-building entities.
    const PICKER_EXCLUDED_TYPES = new Set(['narrative', 'pin', 'marker', 'map']);

    // Empty query → recently-edited elements (by local_updated_at desc),
    // with picker recents promoted to the top. "Recently-edited" matches
    // the writer's natural workflow ("I just touched X, now I'm writing
    // about it"). Once the user types, fuzzy match takes over.
    if (q === '') {
      const out: MentionSuggestionItem[] = [];
      const seen = new Set<string>();
      // First: explicit picker recents (the writer's intentional history).
      for (const id of getRecents(worldId)) {
        const el = byId.get(id);
        if (!el || PICKER_EXCLUDED_TYPES.has(el.type)) continue;
        seen.add(id);
        out.push(toItem(el));
      }
      // Then: recently-edited elements (whatever the writer touched lately
      // in element-detail elsewhere — Drizzle's description, etc.). Sorted
      // by local_updated_at desc. Pad up to 8.
      if (out.length < 8) {
        const byMtime = elements
          .filter(e => !PICKER_EXCLUDED_TYPES.has(e.type) && !seen.has(e.id))
          .slice()
          .sort((a, b) => {
            const aT = (a as any).local_updated_at ?? '';
            const bT = (b as any).local_updated_at ?? '';
            return aT < bT ? 1 : aT > bT ? -1 : 0;
          });
        for (const el of byMtime) {
          if (out.length >= 8) break;
          out.push(toItem(el));
        }
      }
      return out;
    }

    const scored: Array<{ score: number; item: MentionSuggestionItem }> = [];
    for (const el of elements) {
      if (PICKER_EXCLUDED_TYPES.has(el.type)) continue;
      const aliases = (el as any).atlas_aliases as string[] | undefined;
      const name = (el.name || '').toLowerCase();
      const aliasMatches = Array.isArray(aliases) ? aliases.map(a => a.toLowerCase()) : [];

      let score = 0;
      if (name.startsWith(q)) {
        score = 100;
      } else if (name.includes(q)) {
        score = 50;
      } else if (aliasMatches.some(a => a.startsWith(q))) {
        score = 80;
      } else if (aliasMatches.some(a => a.includes(q))) {
        score = 40;
      }
      if (score === 0) continue;

      scored.push({ score, item: toItem(el) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.item).slice(0, 50);
  }

  function toItem(el: Element): MentionSuggestionItem {
    const aliases = (el as any).atlas_aliases as string[] | undefined;
    return {
      id: el.id,
      type: el.type,
      name: el.name || '(unnamed)',
      subtitle: buildSubtitle(el),
      aliases,
    };
  }

  function buildSubtitle(el: Element): string | undefined {
    // For v1 keep it light — just the element-type label. Disambiguation by
    // parent location / family / etc. is a polish refinement.
    return ELEMENT_LABELS[el.type]?.singular;
  }

  /**
   * Read the per-world writing font-size preference and set it as a CSS
   * custom property on the workspace root. Called once at mount and again
   * via state subscription so Settings → Writing changes take effect live.
   */
  function applyProseFontSize(workspaceRoot: HTMLElement): void {
    const state = getState();
    const active = state.active;
    if (!active) return;
    const entry = state.registry.worlds.find(w => w.id === active.worldId);
    const raw = entry?.writing_font_size_px;
    const px = typeof raw === 'number' && raw >= 12 && raw <= 22 ? raw : 15;
    workspaceRoot.style.setProperty('--atlas-prose-font-size', `${px}px`);
  }

  function parseRichtextJson(raw: unknown): JSONContent | null {
    if (!raw) return null;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as JSONContent;
      } catch {
        return null;
      }
    }
    if (typeof raw === 'object') return raw as JSONContent;
    return null;
  }

  // ============================================================================
  // Lifecycle wiring
  // ============================================================================

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  render();

  return () => {
    // Flush pending save before tearing down (best effort — fire and forget;
    // the unmount path is rarely awaited).
    void flushPendingSave();
    unsubState();
    unsubHash();
    document.removeEventListener(WRITING_FOCUS_TOGGLE_EVENT, onFocusToggle);
    document.removeEventListener('keydown', onFocusEsc, true);
    chipPreview.destroy();
    teardownEditor();
  };
}
