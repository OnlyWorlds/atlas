/**
 * The link-all corner button — the pill that sits in a prose panel's top-right
 * and links every unlinked mention in one transaction.
 *
 * DELIBERATELY STORE-FREE. Takes a host element and a view accessor; lifts
 * verbatim into any surface that mounts the workspace prose editor.
 *
 * WHY IT IS A MODULE (S310)
 * -------------------------
 * It shipped in S265 as a closure inside `writing-workspace.ts`, so the
 * KNOWLEDGE room — which mounts the same editor, with the same autolink
 * plugin, into a host that already reuses the same
 * `.atlas-writing-workspace-prose` class — never got it. That was logged in
 * the S308 sweep as one of five instances of the session-recurring class: a
 * decision applied to ONE surface.
 *
 * The affordance matters more than it looks: S306 found that copy had been
 * sending people to a right-click tree menu when there was a button with a
 * live count in the page they were already looking at, and that button is the
 * deterministic gesture the tour's own e2e now uses.
 */

import type { EditorView } from '@tiptap/pm/view';
import { countAutolinkHints, convertAllAutolinks } from './writing-workspace-autolink';
import type { ToastManager } from '../ui/toast-manager';

export interface LinkAllCornerController {
  /** Recompute the hint count and show/hide accordingly. Cheap; call per transaction. */
  refresh(): void;
  /** Hide the pill (editor torn down). Leaves the node for the next mount. */
  deactivate(): void;
  destroy(): void;
}

export function createLinkAllCorner(deps: {
  /** The prose panel. Must be position:relative — the pill rides its background. */
  getHost: () => HTMLElement | null;
  getView: () => EditorView | null | undefined;
  toasts: Pick<ToastManager, 'info'>;
}): LinkAllCornerController {
  const { getHost, getView, toasts } = deps;

  function findBtn(host: HTMLElement): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>(':scope > .atlas-writing-linkall-corner');
  }

  function refresh(): void {
    // Anchored INSIDE the prose panel's top-right (Captain, S265) — the panel
    // is position:relative; the pill rides its background, not the surface edge.
    const host = getHost();
    if (!host) return;
    let btn = findBtn(host);
    const view = getView();
    const count = view ? countAutolinkHints(view) : 0;
    if (count === 0) {
      btn?.setAttribute('data-active', 'false');
      return;
    }
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'atlas-writing-linkall-corner';
      btn.innerHTML = `
        <span class="material-symbols-outlined">link</span>
        <span class="atlas-writing-linkall-count"></span>
      `;
      btn.addEventListener('click', () => {
        const v = getView();
        if (!v) return;
        const n = convertAllAutolinks(v);
        if (n > 0) toasts.info(`Linked ${n} element${n === 1 ? '' : 's'} · Ctrl+Z undoes`);
      });
      host.appendChild(btn);
    }
    btn.setAttribute('data-active', 'true');
    btn.title = `Link ${count} mentioned element${count === 1 ? '' : 's'}`;
    const badge = btn.querySelector<HTMLElement>('.atlas-writing-linkall-count');
    if (badge) badge.textContent = String(count);
  }

  function deactivate(): void {
    const host = getHost();
    // The writing room's teardown searched the ROOT rather than the host, which
    // worked only because the pill is a descendant of both. Scoped here.
    host?.querySelector('.atlas-writing-linkall-corner')?.setAttribute('data-active', 'false');
  }

  return {
    refresh,
    deactivate,
    destroy(): void {
      const host = getHost();
      findBtn(host ?? document.createElement('div'))?.remove();
    },
  };
}
