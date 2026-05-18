/**
 * Pin tooltip HTML — built on hover, populates the floating tooltip overlay
 * tracked on each map-tab cache entry.
 *
 * Extracted from map-tab.ts. Pure: takes an Element, returns escaped HTML.
 */

import type { Element } from '../../core/types';

export function buildPinTooltipHtml(el: Element): string {
  const parts: string[] = [];
  parts.push(`<div class="atlas-pin-tooltip-name">${escapeHtml(el.name || '(unnamed)')}</div>`);
  const subBits: string[] = [];
  const supertype = (el as any).supertype;
  const subtype = (el as any).subtype;
  if (supertype) subBits.push(sentenceCase(String(supertype)));
  if (subtype) subBits.push(sentenceCase(String(subtype)));
  const typeLine = subBits.length > 0 ? subBits.join(' · ') : sentenceCase(String(el.type));
  parts.push(`<div class="atlas-pin-tooltip-type">${escapeHtml(typeLine)}</div>`);
  const desc = typeof (el as any).description === 'string' ? (el as any).description.trim() : '';
  if (desc) {
    const clipped = desc.length > 140 ? desc.slice(0, 140) + '…' : desc;
    parts.push(`<div class="atlas-pin-tooltip-desc">${escapeHtml(clipped)}</div>`);
  }
  return parts.join('');
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ));
}

/**
 * Capitalize the first letter; rest preserved. Used for tooltip type lines —
 * supertype/subtype are free user text and often arrive lowercase.
 */
function sentenceCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
