/**
 * Shared element-image renderer — the ONE place an element's `image_url`
 * becomes an <img> in atlas chrome (element detail banner, context-pane
 * thumb). Share cards keep their own rendering (they're portable/store-free
 * and follow the payload's disclosure rules instead).
 *
 * Returns null when there's nothing renderable; the <img> self-removes on
 * load error so a dead URL never leaves a broken-image glyph in the layout.
 */

import type { Element } from '../core/types';

export type ElementImageVariant = 'banner' | 'thumb';

export function renderElementImage(el: Element, variant: ElementImageVariant): HTMLElement | null {
  const raw = (el as Record<string, unknown>).image_url;
  const url = typeof raw === 'string' ? raw.trim() : '';
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const img = document.createElement('img');
  img.className = `atlas-element-image is-${variant}`;
  img.src = url;
  img.alt = el.name || '';
  img.loading = 'lazy';
  img.addEventListener('error', () => img.remove(), { once: true });
  return img;
}
