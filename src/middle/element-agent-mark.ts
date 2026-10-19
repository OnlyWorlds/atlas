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
      const mark = buildAgentMark(el);
      const line = mark?.getAttribute('aria-label') ?? null;
      if (line === shown && (mark === null) === (slot.firstChild === null)) return;
      shown = line;
      slot.replaceChildren(...(mark ? [mark] : []));
    },
  };
}

export function buildAgentMark(el: Element): HTMLElement | null {
  const state = getState();
  const entry = state.registry.worlds.find(w => w.id === state.active?.worldId);
  // A synced world only: a folder opened as it is, or a world unlinked since, can carry keel's
  // fields from another time, and its pushes no longer land anywhere (the S415 gate).
  if (entry?.state !== 'api-linked') return null;
  const nameOf = (id: string) => state.data.elements.find(e => e.id === id && e.type === 'character')?.name;
  const mark = agentMarkFor(el, rosterNow(entry), nameOf);
  if (!mark) return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'atlas-icon-btn-sm atlas-agent-mark';
  btn.dataset.role = 'agent-mark';
  const glyph = document.createElement('span');
  glyph.className = 'material-symbols-outlined';
  glyph.textContent = 'smart_toy';
  btn.appendChild(glyph);
  let line = '';
  const say = (m: AgentMark): void => {
    line = m.line;
    btn.title = line;
    btn.setAttribute('aria-label', line);
  };
  say(mark);
  btn.addEventListener('click', () => toastManager.info(line));

  // A seat the roster can name: ask once, then rename in place (no repaint).
  if ((el as Record<string, unknown>).changed_via === 'seat' && !rosterNow(entry)) {
    void rosterFor(entry).then(rows => {
      if (!rows || !btn.isConnected) return;
      const named = agentMarkFor(el, rows, nameOf);
      if (named) say(named);
    });
  }
  return btn;
}
