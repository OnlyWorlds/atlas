/**
 * Chip preview card — hover-to-peek + click-to-stick floating card showing
 * the linked element's name, type, and a one-line description excerpt.
 *
 * Two modes:
 *   - Hover (transient): shows after a 200ms delay; hides when the mouse
 *     leaves both the chip and the card.
 *   - Sticky (click): stays until the user clicks outside or presses Esc.
 *     Card shows an explicit "Open as element →" link for full navigation.
 *
 * Writers stay in writing mode — the card never changes the URL by itself.
 * "Open as element" is the explicit escape hatch.
 *
 * One singleton card per workspace mount, reused across all chips.
 */

import { getState } from '../core/state';
import { navigate, elementHash } from '../core/router';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../core/constants';
import type { Element, ElementType } from '../core/types';
import { escapeText } from '../core/dom-utils';

// A longer open delay (Captain, S313) — the card popped a touch eagerly at
// 220ms while reading past linked words; 480ms waits for a deliberate rest.
const HOVER_OPEN_DELAY_MS = 480;
const HOVER_CLOSE_DELAY_MS = 140;

export interface ChipPreviewController {
  /** Hook chip mouseenter to schedule a hover-open after the delay. */
  scheduleHoverShow: (chip: HTMLElement, elementId: string, elementType: string) => void;
  /** Hook chip mouseleave to schedule a hide (unless mouse moved into the card). */
  scheduleHoverHide: () => void;
  /** Hook chip click to open the sticky variant (Esc / click-outside closes). */
  showSticky: (chip: HTMLElement, elementId: string, elementType: string) => void;
  /** Hide immediately (called on editor teardown). */
  hideNow: () => void;
  /** Remove the card from the DOM and detach all listeners. */
  destroy: () => void;
}

export function createChipPreview(workspaceRoot: HTMLElement): ChipPreviewController {
  const card = document.createElement('div');
  card.className = 'atlas-chip-preview';
  card.setAttribute('role', 'tooltip');
  card.dataset.state = 'hidden';
  document.body.appendChild(card);

  let openTimer: number | null = null;
  let closeTimer: number | null = null;
  let sticky = false;
  let currentChip: HTMLElement | null = null;

  function clearTimers(): void {
    if (openTimer !== null) { window.clearTimeout(openTimer); openTimer = null; }
    if (closeTimer !== null) { window.clearTimeout(closeTimer); closeTimer = null; }
  }

  function paint(el: Element | null, fallbackType: string): void {
    if (!el) {
      card.innerHTML = `
        <div class="atlas-chip-preview-empty">
          <span class="material-symbols-outlined">link_off</span>
          <span>Linked element not found.</span>
        </div>
      `;
      return;
    }
    const icon = ELEMENT_ICONS[el.type] ?? 'category';
    const typeLabel = ELEMENT_LABELS[el.type]?.singular ?? fallbackType;
    const desc = el.description;
    const excerpt = desc ? excerptOf(desc, 220) : '';
    const imageUrl = el.image_url;

    const active = getState().active;
    const worldId = active?.worldId ?? '';
    const elHref = worldId ? elementHash(worldId, el.id) : '#';

    card.innerHTML = `
      <div class="atlas-chip-preview-header">
        <span class="material-symbols-outlined atlas-chip-preview-icon">${escapeText(icon)}</span>
        <span class="atlas-chip-preview-name">${escapeText(el.name || '(unnamed)')}</span>
        <span class="atlas-chip-preview-type">${escapeText(typeLabel)}</span>
      </div>
      ${imageUrl ? `<img class="atlas-chip-preview-image" src="${escapeText(imageUrl)}" alt="" />` : ''}
      ${excerpt ? `<p class="atlas-chip-preview-desc">${escapeText(excerpt)}</p>` : '<p class="atlas-chip-preview-desc atlas-chip-preview-desc-empty">No description.</p>'}
      <a class="atlas-chip-preview-open" href="${escapeText(elHref)}">Open as element →</a>
    `;

    const openLink = card.querySelector<HTMLAnchorElement>('.atlas-chip-preview-open');
    openLink?.addEventListener('click', (e) => {
      e.preventDefault();
      if (!worldId) return;
      hide();
      navigate(elementHash(worldId, el.id));
    });
  }

  function position(anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    // Show above the chip if there's room; otherwise below.
    const cardHeight = card.offsetHeight || 200;
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const showAbove = spaceAbove > cardHeight + 12 && spaceBelow < cardHeight + 12;
    const top = showAbove ? rect.top - cardHeight - 8 : rect.bottom + 6;
    let left = rect.left;
    // Keep within viewport horizontally.
    const cardWidth = card.offsetWidth || 320;
    if (left + cardWidth > window.innerWidth - 8) left = window.innerWidth - cardWidth - 8;
    if (left < 8) left = 8;
    card.style.left = `${left}px`;
    card.style.top = `${Math.max(8, top)}px`;
  }

  function show(chip: HTMLElement, elementId: string, elementType: string, stickyMode: boolean): void {
    clearTimers();
    currentChip = chip;
    sticky = stickyMode;
    const el = getState().data.elements.find(e => e.id === elementId) ?? null;
    paint(el, elementType);
    card.dataset.state = 'shown';
    card.dataset.mode = stickyMode ? 'sticky' : 'hover';
    position(chip);
  }

  function hide(): void {
    clearTimers();
    card.dataset.state = 'hidden';
    sticky = false;
    currentChip = null;
  }

  function scheduleHoverShow(chip: HTMLElement, elementId: string, elementType: string): void {
    if (sticky && currentChip === chip) return; // Already shown for this chip.
    if (closeTimer !== null) { window.clearTimeout(closeTimer); closeTimer = null; }
    if (openTimer !== null) window.clearTimeout(openTimer);
    openTimer = window.setTimeout(() => {
      openTimer = null;
      show(chip, elementId, elementType, false);
    }, HOVER_OPEN_DELAY_MS);
  }

  function scheduleHoverHide(): void {
    if (sticky) return; // Stays open until explicitly dismissed.
    if (openTimer !== null) { window.clearTimeout(openTimer); openTimer = null; }
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      closeTimer = null;
      hide();
    }, HOVER_CLOSE_DELAY_MS);
  }

  function showSticky(chip: HTMLElement, elementId: string, elementType: string): void {
    show(chip, elementId, elementType, true);
  }

  // Keep card open if the mouse moves into it (hover stays alive).
  card.addEventListener('mouseenter', () => {
    if (closeTimer !== null) { window.clearTimeout(closeTimer); closeTimer = null; }
  });
  card.addEventListener('mouseleave', () => {
    if (!sticky) scheduleHoverHide();
  });

  // Click-outside closes sticky mode.
  const onDocClick = (e: MouseEvent) => {
    if (!sticky) return;
    const target = e.target as Node;
    if (card.contains(target)) return;
    if (currentChip && currentChip.contains(target)) return;
    hide();
  };
  document.addEventListener('mousedown', onDocClick, true);

  // Esc closes.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && card.dataset.state === 'shown') {
      hide();
    }
  };
  document.addEventListener('keydown', onKey, true);

  // Right-click lets the context menu win (Captain, S313). The preview sits at
  // z-index 9500, the prose context menu at 1000 — so a hover/sticky card drew
  // OVER the "Unlink" menu and hid it. On any contextmenu outside the card
  // itself, dismiss the preview so the menu is never obscured. Capture phase so
  // it fires before the menu builds.
  const onContextMenu = (e: MouseEvent) => {
    if (card.contains(e.target as Node)) return; // right-clicking inside the card is fine
    hide();
  };
  document.addEventListener('contextmenu', onContextMenu, true);

  // Hide when the workspace unmounts (the workspace owns the controller).
  return {
    scheduleHoverShow,
    scheduleHoverHide,
    showSticky,
    hideNow: hide,
    destroy: () => {
      clearTimers();
      document.removeEventListener('mousedown', onDocClick, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('contextmenu', onContextMenu, true);
      card.remove();
    },
  };
}

function excerptOf(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max).trimEnd() + '…';
}
