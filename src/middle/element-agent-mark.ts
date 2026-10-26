/**
 * The quiet agent mark in an element's header band (#347): a small glyph
 * after the name when keel says an agent made the last write, and nothing
 * otherwise. The line ("Last changed by Skeld, an agent") is its label and
 * tooltip for a mouse, and a tap or click says it as a toast, since a touch
 * screen has no hover (conv. 141). The rule is `src/core/agent-mark.ts`; an
 * agent seat's name comes from the world's roster, read once and only when a
 * seat's mark is on screen (`src/sync/world-roster.ts`).
 */
import { getState } from '../core/state';
import type { Element } from '../core/types';
import { agentMarkFor, type AgentMark } from '../core/agent-mark';
import { hiddenMarkLine } from '../core/hidden-mark';
import { proposedLine, proposedMarkOf, proposedWord } from '../core/review-mark';
import { rosterFor, rosterNow } from '../sync/world-roster';
import { toastManager } from '../ui/toast-manager';

/**
 * The mark for a header that stays up across data ticks (Knowledge's entry,
 * Pages' page; #350): `sync` re-reads the element, so a pull that brings an
 * agent's write shows the mark and the person's own edit takes it away
 * without a rebuild. A rebuild only when the line changes, so an unchanged
 * tick leaves a focused mark alone.
 */
export function mountAgentMarkSlot(): { el: HTMLElement; sync(el: Element): void } {
  const slot = document.createElement('span');
  slot.className = 'atlas-agent-mark-slot';
  let shown: string | null = null;
  return {
    el: slot,
    sync(el: Element): void {
      const proposed = buildProposedMark(el);
      const mark = buildAgentMark(el);
      const hidden = buildHiddenMark(el);
      const marks = [proposed, mark, hidden].filter((m): m is HTMLElement => m !== null);
      const line = marks.map(m => m.getAttribute('aria-label') ?? m.dataset.role).join(' | ') || null;
      if (line === shown && marks.length === slot.childElementCount) return;
      shown = line;
      slot.replaceChildren(...marks);
    },
  };
}

/**
 * The review profile's proposed mark (`src/core/review-mark.ts`, conv. 168): a
 * word, never only a glyph, since a keeper has to see it to settle it. Its line
 * as label and tooltip, and said as a toast on a tap. In every world state: the
 * mark is the element's own data, and travels in every export. In a synced world
 * the proposer's name comes from the roster, asked once if it is not here yet.
 */
export function buildProposedMark(el: Element): HTMLElement | null {
  const mark = proposedMarkOf(el);
  if (!mark) return null;
  const state = getState();
  const entry = state.registry.worlds.find(w => w.id === state.active?.worldId);
  const linked = entry?.state === 'api-linked';
  const nameOf = (id: string) => state.data.elements.find(e => e.id === id && e.type === 'character')?.name;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'atlas-proposed-mark' + (mark.lapsed ? ' atlas-proposed-mark-lapsed' : '');
  btn.dataset.role = 'proposed-mark';
  // In a header the lapsed word is one word, so a phone keeps the name its room (Seethe,
  // 2026-10-23: "Proposed, lapsed" left a name 8 px of 68 at 390); the label carries the line.
  btn.textContent = mark.lapsed ? 'Lapsed' : proposedWord(mark);
  let line = '';
  const say = (roster: Parameters<typeof proposedLine>[1]): void => {
    line = proposedLine(mark, roster, nameOf);
    btn.title = line;
    btn.setAttribute('aria-label', line);
  };
  const roster = linked && entry ? rosterNow(entry) : null;
  say(roster);
  if (linked && entry && !roster && mark.by) {
    void rosterFor(entry).then(rows => { if (rows && btn.isConnected) say(rows); });
  }
  btn.addEventListener('click', () => toastManager.info(line));
  return btn;
}

/**
 * The proposed element's sentence for its page (conv. 168, Seethe 2026-10-23): the
 * header word's line, and what Atlas does and does not do with it. The roster's
 * name when it is already here; the header's word asks for it.
 */
export function proposedNoteFor(el: Element): string | null {
  const mark = proposedMarkOf(el);
  if (!mark) return null;
  const state = getState();
  const entry = state.registry.worlds.find(w => w.id === state.active?.worldId);
  const roster = entry?.state === 'api-linked' ? rosterNow(entry) : null;
  const nameOf = (id: string) => state.data.elements.find(e => e.id === id && e.type === 'character')?.name;
  // Only a linked world sends a change; a folder world saves it (Seethe 2026-10-23).
  const change = entry?.state === 'api-linked' ? 'sent' : 'saved';
  return `${proposedLine(mark, roster, nameOf)} A keeper accepts or declines it on OnlyWorlds; a change made here is ${change} as any other.`;
}

/**
 * keel's hidden mark beside the agent mark (`src/core/hidden-mark.ts`): the same
 * quiet glyph, its line as label and tooltip, and said as a toast on a tap.
 */
export function buildHiddenMark(el: Element): HTMLElement | null {
  const state = getState();
  const entry = state.registry.worlds.find(w => w.id === state.active?.worldId);
  const line = hiddenMarkLine(el, entry?.state);
  if (!line) return null;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'atlas-icon-btn-sm atlas-agent-mark';
  btn.dataset.role = 'hidden-mark';
  const glyph = document.createElement('span');
  glyph.className = 'material-symbols-outlined';
  glyph.textContent = 'visibility_off';
  btn.appendChild(glyph);
  btn.title = line;
  btn.setAttribute('aria-label', line);
  btn.addEventListener('click', () => toastManager.info(line));
  return btn;
}

export function buildAgentMark(el: Element): HTMLElement | null {
  const state = getState();
  const entry = state.registry.worlds.find(w => w.id === state.active?.worldId);
  // A synced world only: a folder opened as it is, or a world unlinked since, can carry keel's
  // fields from another time, and its pushes no longer land anywhere.
  if (entry?.state !== 'api-linked') return null;
  const nameOf = (id: string) => state.data.elements.find(e => e.id === id && e.type === 'character')?.name;
  const rec = el as Record<string, unknown>;
  const roster = rosterNow(entry);
  const mark = agentMarkFor(el, roster, nameOf);
  // The seat decides since 1.68.1, so a write that names a membership waits for the
  // roster before it is decided, whatever its door (a `server` write by an agent
  // stayed unmarked, since only a `seat` write ever asked; the roster is module state
  // and repaints nothing). Ask once; then draw, rename or remove in place.
  const ask = !roster && (typeof rec.changed_by === 'string' || rec.changed_via === 'seat');
  if (!mark && !ask) return null;

  let line = '';
  const button = (m: AgentMark): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-icon-btn-sm atlas-agent-mark';
    btn.dataset.role = 'agent-mark';
    const glyph = document.createElement('span');
    glyph.className = 'material-symbols-outlined';
    glyph.textContent = 'smart_toy';
    btn.appendChild(glyph);
    btn.addEventListener('click', () => toastManager.info(line));
    say(btn, m);
    return btn;
  };
  const say = (btn: HTMLElement, m: AgentMark): void => {
    line = m.line;
    btn.title = line;
    btn.setAttribute('aria-label', line);
  };
  // Undecided: an empty holder in the mark's place, filled when the roster answers.
  let holder: HTMLElement = mark ? button(mark) : document.createElement('span');
  if (!mark) holder.dataset.role = 'agent-mark-pending';

  if (ask) {
    void rosterFor(entry).then(rows => {
      if (!rows || !holder.isConnected) return;
      const decided = agentMarkFor(el, rows, nameOf);
      if (decided && holder.dataset.role === 'agent-mark') say(holder, decided);
      else if (decided) { const b = button(decided); holder.replaceWith(b); holder = b; }
      else holder.remove();
    });
  }
  return holder;
}
