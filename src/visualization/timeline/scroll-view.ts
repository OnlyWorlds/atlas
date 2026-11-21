/**
 * The scroll view (2C) — the world's history as a scrolling document.
 * Down = later; a center spine carries the dots; cards alternate sides; era
 * seams section the document; the now is a gold seam you scroll across; a
 * sticky readout speaks the date under the viewport's center through the
 * active calendar lens.
 *
 * Native scroll + DOM, deliberately (design C1/C2): the document is static
 * content animated BY scrolling — no GSAP, no canvas. Implements the same
 * handle surface the room already drives (`mountTimelineView`'s), so the
 * render-mode swap is a mount swap.
 */

import type { TimelineNode } from './types';
import type { TimelineViewExtras, TimelineViewHandle } from './timeline-view';
import { layoutScroll, type ScrollLayout } from './scroll-layout';
import { ELEMENT_ICONS } from '../../core/constants';
import { escapeText, installRowKeydownActivation } from '../../core/dom-utils';
import { lastPressWasKey } from '../../ui/input-kind';
import { capitalise, openWords, theUnnamed } from '../../core/type-words';

/**
 * A card's name as its head and its Open say it: a missing or blank one is
 * "The unnamed event" at the head (`start`), "the unnamed event" inside "Open …".
 */
function shownName(node: TimelineNode, start = false): string {
  if (!node.unnamed && node.name.trim()) return node.name;
  const words = theUnnamed(node.elementType);
  return start ? capitalise(words) : words;
}
import { formatStep, formatDuration, type CalendarConfig } from '@onlyworlds/sdk';

export interface ScrollViewOptions {
  /** Peek — same grammar as the canvas view; null dismisses. */
  onSelect: (elementId: string | null) => void;
  /** The explicit narrowing verb (URL-backed). */
  onFocus: (elementId: string) => void;
  /** Open the element room. */
  onOpenElement: (elementId: string) => void;
}

/** Chips shown on an expanded card before the honest "+N more". */
const CHIP_BUDGET = 6;

export function mountScrollView(target: HTMLElement, opts: ScrollViewOptions): TimelineViewHandle {
  target.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'atlas-scroll-view';
  target.appendChild(container);

  const doc = document.createElement('div');
  doc.className = 'atlas-scroll-doc';
  container.appendChild(doc);

  const dateBox = document.createElement('div');
  dateBox.className = 'atlas-scroll-datebox';
  container.appendChild(dateBox);

  let layout: ScrollLayout | null = null;
  let calendar: CalendarConfig | null = null;
  let now: number | null = null;
  let focusId: string | null = null;
  let selectedId: string | null = null;
  let nodes: TimelineNode[] = [];
  let raf = 0;
  let destroyed = false;

  const speak = (date: number): string =>
    calendar ? formatStep(calendar, Math.round(date)) : String(Math.round(date));

  function rebuild(): void {
    layout = layoutScroll(nodes, { now, calendar });
    // Focus in a card survives the rebuild (Focus narrows the chart and redraws it).
    const from = focusedCardId();
    doc.innerHTML = '';
    doc.style.height = `${Math.ceil(layout.totalHeight)}px`;

    const spine = document.createElement('div');
    spine.className = 'atlas-scroll-spine';
    doc.appendChild(spine);

    for (const item of layout.items) {
      if (item.kind === 'node') {
        doc.appendChild(buildCard(item.node, item.y, item.side));
      } else if (item.kind === 'era') {
        const el = document.createElement('div');
        el.className = 'atlas-scroll-era';
        el.style.top = `${Math.round(item.y)}px`;
        el.textContent = item.name;
        doc.appendChild(el);
      } else if (item.kind === 'gap') {
        const el = document.createElement('div');
        el.className = 'atlas-scroll-gap';
        el.style.top = `${Math.round(item.y)}px`;
        const span = calendar ? formatDuration(calendar, item.steps) : String(Math.round(item.steps));
        el.textContent = `· ${span} pass ·`;
        doc.appendChild(el);
      } else {
        const el = document.createElement('div');
        el.className = 'atlas-scroll-now';
        el.style.top = `${Math.round(item.y)}px`;
        el.innerHTML = `<span class="atlas-scroll-now-chip">now</span>`;
        doc.appendChild(el);
      }
    }
    applySelection();
    if (from) headBack([from, focusId]);
    onScroll();
  }

  function buildCard(node: TimelineNode, y: number, side: 'left' | 'right'): HTMLElement {
    const card = document.createElement('div');
    card.className = 'atlas-scroll-card';
    card.dataset.id = node.id;
    card.dataset.side = side;
    if (node.id === focusId) card.classList.add('focused');
    card.style.top = `${Math.round(y)}px`;

    const icon = node.glyph ?? (ELEMENT_ICONS as Record<string, string>)[node.elementType] ?? 'category';
    const dateLine = node.endDate != null && node.endDate > node.startDate
      ? `${speak(node.startDate)} → ${node.endDate != null ? speak(node.endDate) : ''}`
      : node.openEnded && now != null && now > node.startDate
        ? `${speak(node.startDate)} → now`
        : speak(node.startDate);

    card.innerHTML =
      `<span class="atlas-scroll-card-dot" style="color:${escapeText(node.color)}"></span>` +
      `<div class="atlas-scroll-card-body">` +
      // The head is the card's press for a keyboard: it opens the card (its
      // links, Focus and Open) and closes it again.
      `<div class="atlas-scroll-card-head" role="button" tabindex="0" aria-expanded="false" aria-label="${escapeText(`${shownName(node, true)}, ${dateLine.replace(/\s*→\s*/g, ' to ')}`)}">` +
      `<span class="material-symbols-outlined" style="color:${escapeText(node.color)}">${escapeText(icon)}</span>` +
      `<span class="atlas-scroll-card-name">${escapeText(shownName(node, true))}</span>` +
      `</div>` +
      `<div class="atlas-scroll-card-date">${escapeText(dateLine)}</div>` +
      (node.snippet ? `<div class="atlas-scroll-card-snippet">${escapeText(node.snippet)}</div>` : '') +
      `<div class="atlas-scroll-card-more"></div>` +
      `</div>`;

    card.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onSelect(node.id === selectedId ? null : node.id);
    });
    installRowKeydownActivation(card);
    return card;
  }

  /** The card that holds focus, if focus is in the document. */
  function focusedCardId(): string | null {
    const a = document.activeElement;
    if (!(a instanceof HTMLElement) || !doc.contains(a)) return null;
    return a.closest<HTMLElement>('.atlas-scroll-card')?.dataset.id ?? null;
  }

  /**
   * A press that took its own control away (a card's link chip, Focus) leaves
   * focus on a card's head: the card it opened, else the one it was in.
   */
  function headBack(ids: Array<string | null>): void {
    // A key press only: after a mouse click focus goes as it always did.
    if (!lastPressWasKey()) return;
    const a = document.activeElement;
    if (a && a !== document.body && a.isConnected) return;
    for (const id of ids) {
      if (!id) continue;
      const head = doc.querySelector<HTMLElement>(`.atlas-scroll-card[data-id="${CSS.escape(id)}"] .atlas-scroll-card-head`);
      if (head) { head.focus(); return; }
    }
  }

  /** Expanded content (chips + actions) for the selected card only. */
  function applySelection(): void {
    const from = focusedCardId();
    for (const card of doc.querySelectorAll<HTMLElement>('.atlas-scroll-card')) {
      const id = card.dataset.id!;
      const selected = id === selectedId;
      card.classList.toggle('selected', selected);
      card.querySelector('.atlas-scroll-card-head')?.setAttribute('aria-expanded', String(selected));
      const more = card.querySelector<HTMLElement>('.atlas-scroll-card-more');
      if (!more) continue;
      if (!selected) { more.innerHTML = ''; continue; }
      const node = nodes.find(n => n.id === id);
      if (!node) { more.innerHTML = ''; continue; }
      more.innerHTML = '';

      if (node.links.length > 0) {
        const chips = document.createElement('div');
        chips.className = 'atlas-scroll-card-chips';
        for (const link of node.links.slice(0, CHIP_BUDGET)) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'atlas-scroll-card-chip';
          // Its name is what a press does, never the glyph's word, and its tooltip says the same, one
          // string: "Open Ada", "Open the unnamed character". The chip row already sits under its field.
          const opens = openWords(link);
          chip.title = opens;
          chip.setAttribute('aria-label', opens);
          chip.innerHTML =
            `<span class="material-symbols-outlined" aria-hidden="true">${escapeText((ELEMENT_ICONS as Record<string, string>)[link.type] ?? 'category')}</span>` +
            `<span>${escapeText(link.name)}</span>`;
          chip.addEventListener('click', (e) => { e.stopPropagation(); opts.onSelect(link.id); });
          chips.appendChild(chip);
        }
        if (node.links.length > CHIP_BUDGET) {
          const rest = document.createElement('span');
          rest.className = 'atlas-scroll-card-chip-rest';
          rest.textContent = `+${node.links.length - CHIP_BUDGET}`;
          chips.appendChild(rest);
        }
        more.appendChild(chips);
      }

      const actions = document.createElement('div');
      actions.className = 'atlas-scroll-card-actions';
      const focusBtn = document.createElement('button');
      focusBtn.type = 'button';
      focusBtn.className = 'atlas-btn-ghost';
      focusBtn.textContent = 'Focus';
      focusBtn.title = "Narrow the chart to this element's neighbourhood";
      focusBtn.addEventListener('click', (e) => { e.stopPropagation(); opts.onFocus(id); });
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'atlas-btn-ghost';
      openBtn.textContent = 'Open';
      // Every open card has an Open: its name says which element it opens, and
      // one with no name in the form every control says it ("Open the unnamed event").
      openBtn.title = `Open ${shownName(node)}`;
      openBtn.setAttribute('aria-label', openBtn.title);
      openBtn.addEventListener('click', (e) => { e.stopPropagation(); opts.onOpenElement(id); });
      if (id !== focusId) actions.appendChild(focusBtn);
      actions.appendChild(openBtn);
      more.appendChild(actions);
    }
    if (from) headBack([selectedId, from]);
  }

  /** Scroll-driven ambience: the sticky readout + the gentle recede. */
  function onScroll(): void {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (destroyed || !layout) return;
      const viewH = container.clientHeight;
      const center = container.scrollTop + viewH / 2;
      const date = layout.dateForY(center);
      dateBox.textContent = date != null ? speak(date) : '';
      dateBox.classList.toggle('empty', date == null);
      // Recede: cards dim gently toward the viewport edges. Only touch what
      // is near the viewport; everything else keeps its last value unseen.
      const lo = container.scrollTop - 200;
      const hi = container.scrollTop + viewH + 200;
      for (const card of doc.querySelectorAll<HTMLElement>('.atlas-scroll-card')) {
        const y = parseFloat(card.style.top);
        if (y < lo || y > hi) continue;
        const dist = Math.abs(y - center) / (viewH / 2 + 1);
        // A custom property, never the card's own opacity: the stylesheet moves the fade off a head
        // that shows its focus ring, so the ring keeps its colour.
        card.style.setProperty('--atlas-scroll-fade', Math.max(0.55, 1 - Math.max(0, dist - 0.55) * 0.9).toFixed(3));
      }
    });
  }

  container.addEventListener('scroll', onScroll, { passive: true });
  container.addEventListener('click', () => opts.onSelect(null)); // empty space dismisses
  const ro = new ResizeObserver(onScroll);
  ro.observe(container);

  return {
    setNodes(scoped: TimelineNode[], _universe?: TimelineNode[], extras?: TimelineViewExtras): void {
      nodes = scoped;
      if (extras) {
        if (extras.now !== undefined) now = extras.now;
        if (extras.calendar !== undefined) calendar = extras.calendar ?? null;
        if (extras.focusId !== undefined) focusId = extras.focusId;
      }
      rebuild();
    },
    setSelection(elementId: string | null): void {
      selectedId = elementId;
      applySelection();
    },
    revealDate(date: number): void {
      if (!layout) return;
      const y = layout.yForDate(date);
      const viewH = container.clientHeight;
      if (y > container.scrollTop + 40 && y < container.scrollTop + viewH - 40) return; // already visible
      container.scrollTo({ top: Math.max(0, y - viewH / 2), behavior: 'smooth' });
    },
    redraw(): void {
      rebuild();
    },
    destroy(): void {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      target.innerHTML = '';
    },
  };
}
