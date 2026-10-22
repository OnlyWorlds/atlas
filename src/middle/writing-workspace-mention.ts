/**
 * Mention suggestion UI — the @ picker for the writing workspace.
 *
 * Provides the `render` callback for @tiptap/extension-mention. The popover
 * floats next to the cursor, shows a fuzzy-filtered list of atlas elements
 * (across all 22 types) ranked recents-first, and inserts the selected
 * element as a chip on Enter.
 *
 * Item shape: see MentionSuggestionItem below. Workspace owns the data source
 * (atlas store, recents tracking, alias-aware fuzzy match).
 */

import type { ElementType } from '../core/types';
import { ELEMENT_ICONS } from '../core/constants';
import { typeName } from '../core/type-words';
import { escapeText } from '../core/dom-utils';

export interface MentionSuggestionItem {
  /** Element UUID. */
  id: string;
  /** Element type (one of the 22 OW types). */
  type: ElementType;
  /** Canonical name. */
  name: string;
  /** Disambiguating subtitle (parent location, family, etc.) — rendered after the type pill. */
  subtitle?: string;
  /** Aliases — the matcher feeds these in along with `name` for filtering. */
  aliases?: string[];
}

/**
 * Render callback compatible with @tiptap/suggestion's render API.
 *
 * Returns an object with `onStart`, `onUpdate`, `onKeyDown`, `onExit` — TipTap
 * calls each at the right moment during the suggestion lifecycle. The popover
 * lives in the document body (escape from any overflow:hidden ancestors) and
 * is positioned via getBoundingClientRect of the editor's cursor.
 */
export function renderMentionSuggestion() {
  let popover: HTMLElement | null = null;
  let selectedIndex = 0;
  let items: MentionSuggestionItem[] = [];
  let currentCommand: ((item: MentionSuggestionItem) => void) | null = null;

  function render(props: any): void {
    items = (props.items ?? []) as MentionSuggestionItem[];
    currentCommand = props.command;
    selectedIndex = 0;

    if (!popover) {
      popover = document.createElement('div');
      popover.className = 'atlas-mention-popover';
      document.body.appendChild(popover);
    }
    paint();
    position(props);
  }

  function paint(): void {
    if (!popover) return;
    if (items.length === 0) {
      popover.innerHTML = '<div class="atlas-mention-empty">No matches.</div>';
      return;
    }
    popover.innerHTML = items
      .map((it, i) => {
        const icon = ELEMENT_ICONS[it.type] ?? 'category';
        const typeLabel = typeName(it.type);
        const subtitle = it.subtitle ? ` · ${escapeText(it.subtitle)}` : '';
        return `
          <div class="atlas-mention-item${i === selectedIndex ? ' is-selected' : ''}" data-index="${i}">
            <span class="material-symbols-outlined atlas-mention-item-icon">${escapeText(icon)}</span>
            <span class="atlas-mention-item-name">${escapeText(it.name)}</span>
            <span class="atlas-mention-item-meta">${escapeText(typeLabel)}${subtitle}</span>
          </div>
        `;
      })
      .join('');

    // Bind click handlers.
    popover.querySelectorAll<HTMLElement>('.atlas-mention-item').forEach((row) => {
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const i = Number(row.dataset.index);
        if (!Number.isNaN(i)) commit(i);
      });
    });
  }

  function position(props: any): void {
    if (!popover) return;
    // @tiptap/suggestion gives us a `clientRect` getter for the trigger position.
    const rect = props.clientRect?.();
    if (!rect) {
      popover.style.left = '50%';
      popover.style.top = '50%';
      return;
    }
    // Position below the trigger by default; flip up if near viewport bottom.
    const popoverHeight = popover.offsetHeight || 280;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= popoverHeight + 8
      ? rect.bottom + 4
      : Math.max(8, rect.top - popoverHeight - 4);
    popover.style.left = `${rect.left}px`;
    popover.style.top = `${top}px`;
  }

  function commit(i: number): void {
    const item = items[i];
    if (!item || !currentCommand) return;
    // Mention extension expects { id, label } (and any extra attrs we add).
    currentCommand({ id: item.id, label: item.name, type: item.type } as any);
  }

  function move(delta: number): void {
    if (items.length === 0) return;
    selectedIndex = (selectedIndex + delta + items.length) % items.length;
    paint();
  }

  function destroy(): void {
    popover?.remove();
    popover = null;
    items = [];
    currentCommand = null;
  }

  return {
    onStart: render,
    onUpdate: render,
    onKeyDown(props: any): boolean {
      const key = props.event.key;
      if (key === 'ArrowDown') {
        move(1);
        return true;
      }
      if (key === 'ArrowUp') {
        move(-1);
        return true;
      }
      if (key === 'Enter' || key === 'Tab') {
        // Tab matches NovelCrafter / Obsidian / Slack convention — accept the
        // selected suggestion. Without intercepting here, Tab would shift
        // focus out of the editor.
        commit(selectedIndex);
        return true;
      }
      if (key === 'Escape') {
        destroy();
        return true;
      }
      return false;
    },
    onExit: destroy,
  };
}
