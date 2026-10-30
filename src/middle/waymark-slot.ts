/**
 * The OnlyWorlds mark beside a name (the SDK's Waymark, #755): a slot of its
 * own after the heading, never inside it (both headings are click-to-rename),
 * holding the component's mark and fan-out. What it is given, and whether it
 * shows at all, is `waymarkFor`'s; this file mounts, disposes and reports the
 * fan-out's closing, so a page holds its redraw while it is open.
 */

import { mountWaymark } from '@onlyworlds/sdk/waymark';
import { getState } from '../core/state';
import { getTheme } from '../core/theme';
import { isCoarsePointer } from '../core/pointer';
import type { Element } from '../core/types';
import { isPublicReader, waymarkFor } from '../core/waymark-for';
import { ATLAS_CLIENT_NAME } from '../sync/ow-v2-client-adapter';
import { isKnownOf } from '../sync/known-of';
import { publicPageOnNow, readPublicPageOn } from '../sync/public-page';
import { isKeptHere } from '../sync/sync-attach';

export interface WaymarkSlot {
  readonly el: HTMLElement;
  dispose(): void;
}

/** A fan-out is open somewhere under `root`: a redraw there waits for it to close. */
export function waymarkOpenIn(root: ParentNode): boolean {
  return !!root.querySelector('.ow-waymark__mark[aria-expanded="true"]');
}

/** Focus is on a mark (or in its fan-out): a redraw that replaces the mark gives focus to the new one. */
export function waymarkHasFocus(slot: WaymarkSlot | null | undefined): boolean {
  return !!slot && slot.el.contains(document.activeElement);
}

/** Focus the slot's mark, when it drew one. */
export function focusWaymark(slot: WaymarkSlot | null | undefined): void {
  slot?.el.querySelector<HTMLElement>('.ow-waymark__mark')?.focus();
}

/** Once per world and element per session: a mount the component refused is said in the console, not on the page. */
const refusedSaid = new Set<string>();

/**
 * A slot for the open world's mark (`el` null) or an element's. `onClose` runs
 * when an open fan-out closes, however it closed (a row, a click outside,
 * Escape), so a redraw held for it can run.
 */
export function waymarkSlot(worldId: string, el: Element | null, onClose: () => void = () => {}): WaymarkSlot {
  const slot = document.createElement('span');
  slot.className = 'atlas-waymark';
  slot.setAttribute('data-role', 'waymark');
  let unmount: (() => void) | null = null;
  let gone = false;

  const draw = (): void => {
    if (gone || unmount) return;
    const s = getState();
    const entry = s.registry.worlds.find(w => w.id === worldId);
    const meta = s.active?.worldId === worldId ? s.active.meta : null;
    if (!entry || !meta) return;
    const plan = waymarkFor(entry, el, {
      meta: { name: meta.name, x_names: (meta as { x_names?: unknown }).x_names },
      kept: el ? isKeptHere(worldId, el.id) : false,
      stub: el ? isKnownOf(el) : false,
      publicPageOn: publicPageOnNow(entry),
    });
    if (!plan) {
      // A read key's world: its public page switch is read once, then the mark draws if the page is on.
      if (isPublicReader(entry) && publicPageOnNow(entry) === null) void readPublicPageOn(entry).then(draw);
      return;
    }
    try {
      unmount = mountWaymark(slot, {
        world: plan.world,
        element: plan.element,
        reader: plan.reader,
        tool: ATLAS_CLIENT_NAME,
        signedIn: null,
        phone: isCoarsePointer(),
        ground: getTheme() === 'light' ? 'paper' : 'dark',
        entry: 'mark',
      });
    } catch (err) {
      const k = `${worldId}/${el?.id ?? ''}`;
      if (!refusedSaid.has(k)) {
        refusedSaid.add(k);
        console.warn('[atlas:waymark] no mark beside this name', err);
      }
    }
  };

  // The fan-out's state is the mark's aria-expanded: its fall to false is the close, however it came.
  const watch = new MutationObserver(records => {
    for (const r of records) {
      const t = r.target as HTMLElement;
      if (r.attributeName === 'aria-expanded' && t.classList.contains('ow-waymark__mark') && t.getAttribute('aria-expanded') !== 'true') {
        onClose();
        return;
      }
    }
  });
  watch.observe(slot, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });

  draw();
  return {
    el: slot,
    dispose(): void {
      gone = true;
      watch.disconnect();
      unmount?.();
      unmount = null;
    },
  };
}
