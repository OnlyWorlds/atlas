/**
 * Mark as this world's charter (the charter profile, schema-dist serial 83):
 * a Charter counts only when it carries the mark `x_charter_of`, so a world
 * whose Charter Law was made without it shows no charter on Home. A keeper gets
 * the one write that sets it, on the Law's own page, never at the world's door
 * (the profile's rule 2) and never on their behalf (a tool never marks lore on
 * its own).
 *
 * Offered on an unmarked Law whose supertype is Charter, or the Law world.json's
 * `charter` names (§4.6 (a)); that press writes the supertype too, since the
 * pair and the mark together make the aid. Only where the press can be written:
 * not a view-only world (a read key, a copy), not a member's, a Character's or
 * the public view on disk, and on a linked world only the owner or a
 * co-builder (keel answers anyone else 403 `keeper_only`).
 */
import { handsOnAsProposed, isCharterElement } from '@onlyworlds/sdk';
import type { Element, WorldRegistryEntry } from '../core/types';
import { isCharter } from '../core/charter';
import { getActiveStore } from '../core/active-store';
import { worldIsViewOnly } from '../core/view-only';
import { readsWholeWorld } from './element-detail-message';
import { refreshElementsAfterWrite } from '../sync/sync-attach';
import { toastManager } from '../ui/toast-manager';
import { showProblem } from '../ui/problem-fixes';
import { WORLD_NOT_OPEN } from './element-detail-fields';

/** The world id the mark names: the account world's when linked, else the folder's own (the 1.100 contract gate's M4). */
export function charterMarkValue(entry: WorldRegistryEntry | undefined, meta: unknown, worldId: string): string {
  const linked = entry?.state === 'api-linked' ? entry.api?.world_id : undefined;
  if (typeof linked === 'string' && linked) return linked;
  const own = (meta as { id?: unknown } | null | undefined)?.id;
  return typeof own === 'string' && own ? own : worldId;
}

/** Whether the person here may set the mark at all. */
export function canMarkCharter(entry: WorldRegistryEntry | undefined, meta: unknown, worldId: string): boolean {
  if (worldIsViewOnly(worldId)) return false;
  return readsWholeWorld(entry, meta);
}

/** Whether this element is one the press is offered on. */
export function offersCharterMark(el: Element, meta: unknown): boolean {
  if (el.type !== 'law' || handsOnAsProposed(el) || isCharterElement(el as never)) return false;
  const named = (meta as { charter?: unknown } | null | undefined)?.charter;
  return isCharter(el) || (typeof named === 'string' && named === el.id);
}

export function buildCharterMarkOffer(el: Element, entry: WorldRegistryEntry | undefined, meta: unknown, worldId: string): HTMLElement | null {
  if (!offersCharterMark(el, meta) || !canMarkCharter(entry, meta, worldId)) return null;
  const box = document.createElement('div');
  box.className = 'atlas-charter-mark';
  box.dataset.role = 'charter-mark';
  const line = document.createElement('p');
  line.className = 'atlas-charter-mark-line';
  line.textContent = isCharter(el)
    ? 'Not this world\'s charter yet. Once it is marked, Home shows it first and AI readers follow it as the house rules.'
    : 'This world\'s own record names this Law as its charter. Once it is marked, Home shows it first and AI readers follow it as the house rules.';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'atlas-btn atlas-btn--secondary atlas-charter-mark-btn';
  btn.dataset.role = 'charter-mark-btn';
  btn.textContent = 'Mark as this world\'s charter';
  btn.addEventListener('click', () => { void markCharter(el, charterMarkValue(entry, meta, worldId), btn); });
  box.append(line, btn);
  return box;
}

async function markCharter(el: Element, value: string, btn: HTMLButtonElement): Promise<void> {
  const store = getActiveStore();
  if (!store) { toastManager.error(WORLD_NOT_OPEN); return; }
  btn.disabled = true;
  // One write: the pair and the mark together (the profile's writer rule).
  const patch: Record<string, unknown> = { x_charter_of: value };
  if (!isCharter(el)) patch.supertype = 'Charter';
  try {
    await store.updateElement(el.id, patch as Partial<Element>);
    await refreshElementsAfterWrite(store);
  } catch (err) {
    btn.disabled = false;
    console.error('[charter-mark] mark failed:', err);
    showProblem(err, { doing: 'marking this world\'s charter' });
  }
}
