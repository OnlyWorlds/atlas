/**
 * Mark as this world's charter, guide or a domain (the charter profile,
 * schema-dist serial 83): a reading aid counts only when it carries the mark
 * `x_charter_of`, so a world whose Charter Law, Guide or Domain Constructs were
 * made without it shows none of them at its door. A keeper gets the one write
 * that sets it, on the element's own page, never at the world's door (the
 * profile's rule 2) and never on their behalf (a tool never marks lore on its
 * own).
 *
 * Offered on an unmarked Law whose supertype is Charter, or the Law world.json's
 * `charter` names (§4.6 (a)), whose press writes the supertype too, since the
 * pair and the mark together make the aid; on an unmarked Construct whose
 * supertype is Guide or Domain. While another Charter or Guide leads, the offer
 * says which, and that Home then offers to retire it (one Charter and one Guide
 * at a time; 1.101's G7). Only where the press can be written: not a view-only
 * world (a read key, a copy), not a member's, a Character's or the public view
 * on disk, and on a linked world only the owner or a co-builder (keel answers
 * anyone else 403 `keeper_only`).
 *
 * Retire (Skeld's ruling, 2026-10-28): a superseded Charter or Guide is not
 * deleted; the keeper's press sets its mark to null in one write, so it stays
 * in the world as lore and can be marked again.
 */
import { handsOnAsProposed } from '@onlyworlds/sdk';
import type { Element, WorldRegistryEntry } from '../core/types';
import { aidKind, findCharter, isReadingAid, leadingGuideId, readingAids, type AidKind } from '../core/charter';
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

/** Whether the person here may set or clear the mark at all. */
export function canMarkCharter(entry: WorldRegistryEntry | undefined, meta: unknown, worldId: string): boolean {
  if (worldIsViewOnly(worldId)) return false;
  return readsWholeWorld(entry, meta);
}

/** What the press on this element would make it, and which one leads now (null when none). */
export interface MarkOffer { kind: AidKind; leading: Element | null }

export function markOfferFor(el: Element, meta: unknown, elements: readonly Element[] = []): MarkOffer | null {
  if (handsOnAsProposed(el) || isReadingAid(el)) return null;
  const named = (meta as { charter?: unknown } | null | undefined)?.charter;
  let kind = aidKind(el);
  // world.json's `charter` may name a Law of another supertype: it becomes a Charter by the press.
  if (!kind && el.type === 'law' && typeof named === 'string' && named === el.id) kind = 'charter';
  if (!kind) return null;
  let leading: Element | null = null;
  if (kind === 'charter') leading = findCharter(elements, named);
  else if (kind === 'guide') {
    const id = leadingGuideId(elements);
    leading = id ? elements.find(e => e.id === id) ?? null : null;
  }
  return { kind, leading };
}

/** Whether this element is one the press is offered on. */
export function offersCharterMark(el: Element, meta: unknown, elements: readonly Element[] = []): boolean {
  return markOfferFor(el, meta, elements) !== null;
}

const nameOf = (el: Element, fallback: string): string => (typeof el.name === 'string' && el.name.trim() ? el.name.trim() : fallback);

/** The offer's line: what the press does, and that the element then leaves the lists (1.101's G11). */
function offerLine(el: Element, offer: MarkOffer): string {
  const leaves = 'The lists then leave it out while the reading aids are hidden (Show them on Home).';
  if (offer.kind === 'domain') return `Not one of this world's domains yet. Once it is marked, Home lists it under the world's charter, with its first line. ${leaves}`;
  const word = offer.kind === 'charter' ? 'charter' : 'guide';
  const what = offer.kind === 'charter' ? 'AI readers follow it as the house rules' : 'it is the first thing a newcomer reads';
  if (offer.leading) {
    return `This world's ${word} is ${nameOf(offer.leading, word)}. Marking this one makes it the ${word}, and Home then offers to retire ${nameOf(offer.leading, word)}. ${leaves}`;
  }
  if (offer.kind === 'charter' && aidKind(el) !== 'charter') {
    return `This world's own record names this Law as its charter. Marking it also sets its supertype to Charter; then Home shows it first and ${what}. ${leaves}`;
  }
  return `Not this world's ${word} yet. Once it is marked, Home shows it first and ${what}. ${leaves}`;
}

function buttonLabel(kind: AidKind): string {
  if (kind === 'domain') return 'Mark as one of this world\'s domains';
  return kind === 'charter' ? 'Mark as this world\'s charter' : 'Mark as this world\'s guide';
}

export function buildCharterMarkOffer(el: Element, entry: WorldRegistryEntry | undefined, meta: unknown, worldId: string, elements: readonly Element[] = []): HTMLElement | null {
  if (!canMarkCharter(entry, meta, worldId)) return null;
  const offer = markOfferFor(el, meta, elements);
  if (offer) {
    const box = document.createElement('div');
    box.className = 'atlas-charter-mark';
    box.dataset.role = 'charter-mark';
    box.dataset.aid = offer.kind;
    const line = document.createElement('p');
    line.className = 'atlas-charter-mark-line';
    line.textContent = offerLine(el, offer);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-btn atlas-btn--secondary atlas-charter-mark-btn';
    btn.dataset.role = 'charter-mark-btn';
    btn.textContent = buttonLabel(offer.kind);
    btn.addEventListener('click', () => { void markAid(el, offer.kind, charterMarkValue(entry, meta, worldId), btn); });
    box.append(line, btn);
    return box;
  }
  return buildRetireOffer(el, meta, elements);
}

/** On a marked Charter or Guide that does not lead: say which leads, and offer the retire (D6). */
function buildRetireOffer(el: Element, meta: unknown, elements: readonly Element[]): HTMLElement | null {
  if (!isReadingAid(el)) return null;
  const kind = aidKind(el);
  if (kind !== 'charter' && kind !== 'guide') return null;
  const { charters, guides } = readingAids(elements);
  const leadId = kind === 'charter'
    ? findCharter(elements, (meta as { charter?: unknown } | null | undefined)?.charter)?.id ?? null
    : leadingGuideId(elements);
  if (!leadId || leadId === el.id || !(kind === 'charter' ? charters : guides).includes(el.id)) return null;
  const leading = elements.find(e => e.id === leadId);
  const word = kind === 'charter' ? 'charter' : 'guide';
  const box = document.createElement('div');
  box.className = 'atlas-charter-mark';
  box.dataset.role = 'aid-retire-offer';
  const line = document.createElement('p');
  line.className = 'atlas-charter-mark-line';
  line.textContent = `Marked as a ${word}, but this world's ${word} is ${leading ? nameOf(leading, word) : 'another'}. Retiring this one takes its mark off: it stays in the world as an ordinary ${el.type === 'law' ? 'Law' : 'Construct'}, and you can mark it again later.`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'atlas-btn atlas-btn--secondary';
  btn.dataset.action = 'aid-retire';
  btn.textContent = 'Retire it';
  btn.addEventListener('click', () => { void retireAid(el, btn); });
  box.append(line, btn);
  return box;
}

async function writeMark(el: Element, patch: Record<string, unknown>, btn: HTMLButtonElement, doing: string): Promise<void> {
  const store = getActiveStore();
  if (!store) { toastManager.error(WORLD_NOT_OPEN); return; }
  btn.disabled = true;
  try {
    await store.updateElement(el.id, patch as Partial<Element>);
    await refreshElementsAfterWrite(store);
  } catch (err) {
    btn.disabled = false;
    console.error('[charter-mark] write failed:', err);
    showProblem(err, { doing });
  }
}

async function markAid(el: Element, kind: AidKind, value: string, btn: HTMLButtonElement): Promise<void> {
  // One write: the pair and the mark together (the profile's writer rule).
  const patch: Record<string, unknown> = { x_charter_of: value };
  if (kind === 'charter' && aidKind(el) !== 'charter') patch.supertype = 'Charter';
  const doing = kind === 'domain' ? 'marking this as one of the world\'s domains' : `marking this world's ${kind}`;
  await writeMark(el, patch, btn, doing);
}

/** The retire: the mark to null, one write (Skeld's ruling); the element stays as lore. */
export async function retireAid(el: Element, btn: HTMLButtonElement): Promise<void> {
  await writeMark(el, { x_charter_of: null }, btn, 'retiring this one');
}
