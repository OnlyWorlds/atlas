/**
 * Find-and-replace bar for the writing workspace.
 *
 * Floats anchored to the top-right of the prose area. Opens in two modes:
 *   - `find`     (Ctrl+F)  — replace input hidden
 *   - `replace`  (Ctrl+H)  — replace input + buttons visible
 *
 * The bar drives the search plugin (`writing-workspace-search`) via the
 * `SearchController` returned by the editor handle. The plugin owns match
 * detection + highlighting; the bar is pure UI + keymap glue.
 */

import type { SearchController } from './writing-workspace-editor';

export type FindBarMode = 'find' | 'replace';

export interface FindBarOpts {
  search: SearchController;
  /** Called when the bar requests close (Esc or × click). */
  onClose: () => void;
  /**
   * "Link to element…" (S355): the workspace opens the picker and links every
   * match. Resolves when the doc has settled so the bar can recount.
   */
  onLinkMatches?: () => Promise<void>;
}

export interface FindBarOpenOptions {
  /**
   * The surface behind the bar cannot be edited in place (the compiled view).
   * Replace is hidden whatever mode was asked for; linking still works
   * because it writes the source narratives, not the rendering.
   */
  readOnly?: boolean;
  /** Seed the find box (the editor's selection, by convention). Whitespace-only is ignored. */
  prefill?: string;
}

export interface FindBarHandle {
  /** Show the bar in find or replace mode. Focuses the find input. */
  open(mode: FindBarMode, opts?: FindBarOpenOptions): void;
  /** Hide the bar and clear the search highlight. */
  close(): void;
  /** True iff the bar is currently visible. */
  isOpen(): boolean;
  /** Remove from DOM + detach listeners. */
  destroy(): void;
}

export function createFindBar(container: HTMLElement, opts: FindBarOpts): FindBarHandle {
  const { search, onClose } = opts;

  const bar = document.createElement('div');
  bar.className = 'atlas-find-bar';
  bar.setAttribute('role', 'search');
  bar.dataset.mode = 'find';
  bar.dataset.state = 'hidden';
  bar.innerHTML = `
    <div class="atlas-find-bar-row">
      <input
        class="atlas-input atlas-find-bar-input"
        type="text"
        placeholder="Find"
        aria-label="find"
        data-role="find-input"
      />
      <span class="atlas-find-bar-count" data-role="count">0 of 0</span>
      <button type="button" class="atlas-icon-btn-sm" data-role="prev" title="Previous match (Shift+Enter)">
        <span class="material-symbols-outlined">keyboard_arrow_up</span>
      </button>
      <button type="button" class="atlas-icon-btn-sm" data-role="next" title="Next match (Enter)">
        <span class="material-symbols-outlined">keyboard_arrow_down</span>
      </button>
      <button
        type="button"
        class="atlas-icon-btn-sm atlas-find-bar-toggle"
        data-role="case-toggle"
        aria-pressed="false"
        title="Match case"
      >Aa</button>
      <button
        type="button"
        class="atlas-icon-btn-sm atlas-find-bar-toggle"
        data-role="word-toggle"
        aria-pressed="false"
        title="Whole word"
      >ab|</button>
      <button
        type="button"
        class="atlas-btn-ghost atlas-find-bar-link"
        data-role="link-matches"
        title="Turn every match into a link to an element you pick"
        disabled
      >Link to element…</button>
      <button type="button" class="atlas-icon-btn-sm" data-role="close" title="Close (Esc)">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
    <div class="atlas-find-bar-row atlas-find-bar-replace-row" data-role="replace-row">
      <input
        class="atlas-input atlas-find-bar-input"
        type="text"
        placeholder="Replace with"
        aria-label="replace"
        data-role="replace-input"
      />
      <button type="button" class="atlas-btn-ghost" data-role="replace-one">Replace</button>
      <button type="button" class="atlas-btn-ghost" data-role="replace-all">Replace all</button>
    </div>
  `;
  container.appendChild(bar);

  const findInput = bar.querySelector<HTMLInputElement>('[data-role="find-input"]')!;
  const replaceInput = bar.querySelector<HTMLInputElement>('[data-role="replace-input"]')!;
  const countSpan = bar.querySelector<HTMLElement>('[data-role="count"]')!;
  const caseToggle = bar.querySelector<HTMLButtonElement>('[data-role="case-toggle"]')!;
  const wordToggle = bar.querySelector<HTMLButtonElement>('[data-role="word-toggle"]')!;
  const linkBtn = bar.querySelector<HTMLButtonElement>('[data-role="link-matches"]')!;

  let caseSensitive = false;
  let wholeWord = false;
  let open = false;

  function refreshCount(): void {
    const info = search.getInfo();
    if (info.total === 0) {
      countSpan.textContent = info.query ? 'No matches' : '0 of 0';
    } else {
      countSpan.textContent = `${info.currentIndex} of ${info.total}`;
    }
    linkBtn.disabled = info.total === 0 || !opts.onLinkMatches;
  }

  function applyQuery(resetIndex = true): void {
    search.setQuery({
      query: findInput.value,
      caseSensitive,
      wholeWord,
      resetIndex,
    });
    refreshCount();
  }

  findInput.addEventListener('input', () => applyQuery(true));
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) search.prev();
      else search.next();
      refreshCount();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      doClose();
    }
  });
  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      search.replaceCurrent(replaceInput.value);
      refreshCount();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      doClose();
    }
  });

  bar.querySelector<HTMLElement>('[data-role="prev"]')!.addEventListener('click', () => {
    search.prev();
    refreshCount();
  });
  bar.querySelector<HTMLElement>('[data-role="next"]')!.addEventListener('click', () => {
    search.next();
    refreshCount();
  });
  bar.querySelector<HTMLElement>('[data-role="close"]')!.addEventListener('click', doClose);
  linkBtn.addEventListener('click', () => {
    if (linkBtn.disabled || !opts.onLinkMatches) return;
    linkBtn.disabled = true;
    void opts.onLinkMatches().finally(() => {
      // Linked text is chip label now, not text, so the count drops on its
      // own; the recount also re-enables the button when matches remain.
      applyQuery(true);
    });
  });
  bar.querySelector<HTMLElement>('[data-role="replace-one"]')!.addEventListener('click', () => {
    search.replaceCurrent(replaceInput.value);
    refreshCount();
  });
  bar.querySelector<HTMLElement>('[data-role="replace-all"]')!.addEventListener('click', () => {
    search.replaceAll(replaceInput.value);
    refreshCount();
  });

  caseToggle.addEventListener('click', () => {
    caseSensitive = !caseSensitive;
    caseToggle.setAttribute('aria-pressed', String(caseSensitive));
    caseToggle.classList.toggle('is-active', caseSensitive);
    applyQuery(true);
  });
  wordToggle.addEventListener('click', () => {
    wholeWord = !wholeWord;
    wordToggle.setAttribute('aria-pressed', String(wholeWord));
    wordToggle.classList.toggle('is-active', wholeWord);
    applyQuery(true);
  });

  function doOpen(mode: FindBarMode, openOpts: FindBarOpenOptions = {}): void {
    bar.dataset.mode = openOpts.readOnly ? 'find' : mode;
    bar.dataset.readonly = openOpts.readOnly ? 'true' : 'false';
    bar.dataset.state = 'shown';
    open = true;
    // A selection seeds the box (S355, the editor convention); otherwise the
    // last query stays for a quick re-search.
    const seed = (openOpts.prefill ?? '').trim();
    if (seed) {
      findInput.value = seed;
      applyQuery(true);
    } else {
      refreshCount();
    }
    // Focus + select existing text for fast overtype.
    findInput.focus();
    findInput.select();
  }

  function doClose(): void {
    if (!open) return;
    bar.dataset.state = 'hidden';
    open = false;
    search.clear();
    onClose();
  }

  return {
    open: doOpen,
    close: doClose,
    isOpen: () => open,
    destroy: () => {
      bar.remove();
    },
  };
}
