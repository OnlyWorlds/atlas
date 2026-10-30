/**
 * The OnlyWorlds mark beside a name (the SDK's Waymark, #755): a slot of its
 * own after the heading, never inside it (both headings are click-to-rename),
 * holding the component's mark and fan-out. What it is given, and whether it
 * shows at all, is `waymarkFor`'s; this file mounts, disposes and says when
 * the fan-out has settled, so a page holds its redraw while it is open or its
 * "Link copied" toast shows, and runs it only after the gesture that closed it
 * has landed, focus kept where the person moved it.
 */

import { mountWaymark } from '@onlyworlds/sdk/waymark';
import { getState } from '../core/state';
import { getTheme } from '../core/theme';
import { isCoarsePointer } from '../core/pointer';
import type { Element } from '../core/types';
import { readsByPublicPage, waymarkFor } from '../core/waymark-for';
import { ATLAS_CLIENT_NAME } from '../sync/ow-v2-client-adapter';
import { isKnownOf } from '../sync/known-of';
import { publicPageOnNow, publicPageStale, readPublicPageOn } from '../sync/public-page';
import { isKeptHere } from '../sync/sync-attach';

export interface WaymarkSlot {
  readonly el: HTMLElement;
  dispose(): void;
}

const OPEN = '.ow-waymark__mark[aria-expanded="true"], .ow-waymark__toast:not([hidden])';

/** A fan-out is open, or its toast shows, somewhere under `root`: a redraw there waits for it to settle. */
export function waymarkOpenIn(root: ParentNode): boolean {
  return !!root.querySelector(OPEN);
}

/** Focus is on a mark (or in its fan-out): a redraw that replaces the mark gives focus to the new one. */
export function waymarkHasFocus(slot: WaymarkSlot | null | undefined): boolean {
  return !!slot && slot.el.contains(document.activeElement);
}

/** Focus the slot's mark, when it drew one. */
export function focusWaymark(slot: WaymarkSlot | null | undefined): void {
  slot?.el.querySelector<HTMLElement>('.ow-waymark__mark')?.focus();
}

/** A selector that finds the focused control again after a rebuild, by what it does; null when it has no such name. */
function twinOf(el: Element | globalThis.Element | null): string | null {
  if (!el || el === document.body || !(el instanceof HTMLElement)) return null;
  if (el.closest('.ow-waymark')) return null; // the page gives focus back to its new mark itself
  for (const attr of ['data-action', 'data-role', 'data-step-action', 'data-field']) {
    const v = el.getAttribute(attr);
    if (v) return `[${attr}="${CSS.escape(v)}"]`;
  }
  return el.id ? `#${CSS.escape(el.id)}` : null;
}

/** Once per world and element per session: a mount the component refused is said in the console, not on the page. */
const refusedSaid = new Set<string>();

/**
 * A slot for the open world's mark (`el` null) or an element's. `onSettled`
 * runs once an open fan-out has closed and its toast is gone, after the
 * press that closed it has landed, so a redraw held for it can run.
 */
export function waymarkSlot(worldId: string, el: Element | null, onSettled: () => void = () => {}): WaymarkSlot {
  const slot = document.createElement('span');
  slot.className = 'atlas-waymark';
  slot.setAttribute('data-role', 'waymark');
  let unmount: (() => void) | null = null;
  let drawnOn: boolean | null = null;
  let gone = false;
  let asked = false;

  const entryNow = () => getState().registry.worlds.find(w => w.id === worldId);

  const draw = (): void => {
    if (gone || unmount) return;
    const s = getState();
    const entry = entryNow();
    const meta = s.active?.worldId === worldId ? s.active.meta : null;
    if (!entry || !meta) return;
    drawnOn = publicPageOnNow(entry);
    const plan = waymarkFor(entry, el, {
      meta: { name: meta.name, x_names: (meta as { x_names?: unknown }).x_names },
      kept: el ? isKeptHere(worldId, el.id) : false,
      stub: el ? isKnownOf(el) : false,
      publicPageOn: drawnOn,
    });
    if (plan) {
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
    }
    // A public-page reader's world: the switch is asked once per slot when not known or stale, and the
    // mark redrawn only when an answer came back and changed it (a failed read leaves things as they are).
    if (!asked && readsByPublicPage(entry) && publicPageStale(entry)) {
      asked = true;
      void readPublicPageOn(entry).then(on => {
        if (gone || on === null || on === drawnOn) return;
        if (waymarkOpenIn(slot)) return; // never under an open fan-out; the next mount reads it
        unmount?.();
        unmount = null;
        draw();
      });
    }
  };

  // A press that closes the fan-out: its click must land before the page rebuilds under it.
  // (A click inside the fan-out, on a row, has already landed when it closes: it clears the press first.)
  let pressing = false;
  let pointerIsDown = false;
  const onDown = (): void => { pressing = true; pointerIsDown = true; };
  const onUp = (): void => { pointerIsDown = false; };
  const onClick = (): void => { pressing = false; };
  // One close is one settle, however many records it brings (a failed copy's close hides the toast too).
  let waiting: (() => void) | null = null;
  let scheduled = false;

  const run = (): void => {
    scheduled = false;
    waiting = null;
    if (gone) return;
    // The press opened a text field (a rename, a name box): the redraw waits until the person leaves it,
    // by blur or by the field going away (a popover's cancel removes it, and Firefox sends no focusout then).
    const active = document.activeElement;
    if (active instanceof HTMLElement && !slot.contains(active)
      && (active.matches('input, textarea, select') || active.isContentEditable)) {
      scheduled = true;
      const left = (): boolean => !active.isConnected || document.activeElement !== active;
      const poll = (): void => { if (gone) return; if (left()) run(); else setTimeout(poll, 250); };
      setTimeout(poll, 250);
      return;
    }
    const twin = twinOf(document.activeElement);
    onSettled();
    // The page's rebuild runs on a microtask; look after it. Only a name that finds one control is followed.
    setTimeout(() => {
      if (!twin || (document.activeElement && document.activeElement !== document.body)) return;
      const found = document.querySelectorAll<HTMLElement>(twin);
      if (found.length === 1) found[0].focus();
    }, 0);
  };

  const settle = (): void => {
    if (gone || waiting || scheduled || waymarkOpenIn(slot)) return;
    if (!pressing) { scheduled = true; setTimeout(run, 0); return; }
    pressing = false;
    let done = false;
    let guard = 0;
    const once = (): void => {
      if (done) return;
      done = true;
      window.removeEventListener('click', once, true);
      window.removeEventListener('pointercancel', once, true);
      clearTimeout(guard);
      scheduled = true;
      waiting = null;
      setTimeout(run, 0);
    };
    window.addEventListener('click', once, true);
    window.addEventListener('pointercancel', once, true);
    // A press that never becomes a click (a drag off, a lost pointer): run once the pointer is up and a
    // moment has passed, however long the press is held.
    const check = (): void => { if (pointerIsDown) guard = window.setTimeout(check, 250); else once(); };
    guard = window.setTimeout(check, 1000);
    waiting = once;
  };

  // The fan-out's state is the mark's aria-expanded and the toast's hidden: watch both.
  const watch = new MutationObserver(records => {
    for (const r of records) {
      const t = r.target as HTMLElement;
      if (t.classList.contains('ow-waymark__mark') && r.attributeName === 'aria-expanded') {
        if (t.getAttribute('aria-expanded') === 'true') {
          pressing = false;
          window.addEventListener('pointerdown', onDown, true);
          window.addEventListener('pointerup', onUp, true);
          window.addEventListener('click', onClick, true);
        } else settle();
      } else if (t.classList.contains('ow-waymark__toast') && r.attributeName === 'hidden' && t.hidden) {
        settle();
      }
    }
  });
  watch.observe(slot, { subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'hidden'] });

  draw();
  return {
    el: slot,
    dispose(): void {
      gone = true;
      watch.disconnect();
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('click', onClick, true);
      waiting?.();
      unmount?.();
      unmount = null;
    },
  };
}
