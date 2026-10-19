/**
 * Inline-editable entity title — the click-to-edit name pattern, generalized.
 *
 * Canon (the unified header): a single named entity (element, book/draft,
 * knowledge entry, share page) always shows its name as a 15px click-to-edit
 * `<h2 class="atlas-element-name">` inside a `.atlas-middle-header` band —
 * never a separate "Name" field. This is the same interaction the element
 * editor's header uses (`element-detail-header.startInlineNameEdit`); extracted
 * here so the knowledge + share editors share it instead of reinventing it.
 *
 * Click (or Enter/Space when focused) swaps the h2 for an input. Enter or blur
 * commits via `onCommit` (only when the value actually changed); Escape reverts.
 * The returned handle's `sync()` repaints the displayed name on a background
 * tick — a no-op while the user is actively editing.
 */

export interface EditableTitleHandle {
  /** The h2 host to place in the header. */
  el: HTMLElement;
  /** Update the displayed name from a data tick (ignored while editing). */
  sync(name: string): void;
}

export function makeEditableTitle(opts: {
  initial: string;
  placeholder?: string;
  ariaLabel?: string;
  /** Start directly in edit mode (e.g. a brand-new draft). */
  autoEdit?: boolean;
  /** Show the name only, never an input: a view-only world (conv. 149). */
  readOnly?: boolean;
  /** Fired on Enter/blur when the trimmed value changed from the last value. */
  onCommit: (next: string) => void;
}): EditableTitleHandle {
  const host = document.createElement('h2');
  host.className = 'atlas-element-name';
  if (!opts.readOnly) {
    host.tabIndex = 0;
    host.title = 'Click to rename';
  }

  let current = opts.initial;

  function renderDisplay(): void {
    host.innerHTML = '';
    if (current) {
      host.textContent = current;
      host.classList.remove('is-placeholder');
    } else if (opts.placeholder) {
      host.textContent = opts.placeholder;
      host.classList.add('is-placeholder');
    } else {
      host.textContent = '(unnamed)';
      host.classList.remove('is-placeholder');
    }
  }

  function startEdit(): void {
    if (opts.readOnly) return;
    if (host.querySelector('input')) return; // already editing
    const original = current;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'atlas-element-name-input';
    input.value = original;
    if (opts.ariaLabel) input.setAttribute('aria-label', opts.ariaLabel);
    if (opts.placeholder) input.placeholder = opts.placeholder;

    host.classList.remove('is-placeholder');
    host.innerHTML = '';
    host.appendChild(input);
    queueMicrotask(() => { input.focus(); input.select(); });

    let reverting = false;
    let committed = false;
    const commit = (): void => {
      if (committed) return;
      committed = true;
      const next = input.value.trim();
      if (next !== original) { current = next; opts.onCommit(next); }
      renderDisplay();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); reverting = true; input.blur(); }
    });
    // Ctrl/Cmd+S routes through the shared save event (mirrors element-detail).
    const onSaveRequest = (): void => { input.blur(); };
    document.addEventListener('atlas:save-request', onSaveRequest);
    input.addEventListener('blur', () => {
      document.removeEventListener('atlas:save-request', onSaveRequest);
      if (reverting) renderDisplay();
      else commit();
    });
  }

  host.addEventListener('click', () => startEdit());
  host.addEventListener('keydown', (e) => {
    // Only the title itself opens edit mode. An Enter pressed inside the input
    // commits and bubbles up here — ignore it, or it would immediately re-open
    // a fresh editor (input never appears to commit).
    if (e.target !== host) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit(); }
  });

  renderDisplay();
  if (opts.autoEdit) queueMicrotask(() => startEdit());

  return {
    el: host,
    sync(name: string) {
      if (host.querySelector('input')) return; // editing — don't clobber
      if (name === current) return;
      current = name;
      renderDisplay();
    },
  };
}
