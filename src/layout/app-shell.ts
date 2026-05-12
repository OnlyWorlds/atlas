/**
 * AppShell — three-pane layout: sidebar | middle | right.
 *
 * Sidebar (~18%): mode toggle area (empty until Phase 4), content, gear at bottom.
 * Middle  (~52%): welcome / element / settings / empty (mode controlled by caller).
 * Right   (~30%): tab bar + pane. Empty until Phase 5.
 *
 * Two draggable dividers. Ratios persist to localStorage.
 *
 * Ported nearly verbatim from `atlas-deprecated/src/layout/app-shell.ts`.
 * Only adaptation: constant rename (`SHELL_RATIO_KEY` → `SHELL_RATIOS_STORAGE_KEY`).
 */

import { SHELL_RATIOS_STORAGE_KEY } from '../core/constants';

export interface AppShell {
  root: HTMLElement;
  sidebar: HTMLElement;
  sidebarToggle: HTMLElement;
  sidebarContent: HTMLElement;
  sidebarFooter: HTMLElement;
  middle: HTMLElement;
  right: HTMLElement;
  rightTabBar: HTMLElement;
  rightPane: HTMLElement;
}

interface Ratios { sidebar: number; middle: number; }
const DEFAULT_RATIOS: Ratios = { sidebar: 0.18, middle: 0.52 };

function loadRatios(): Ratios {
  try {
    const raw = localStorage.getItem(SHELL_RATIOS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_RATIOS };
    const parsed = JSON.parse(raw) as Partial<Ratios>;
    const sidebar = clamp(parsed.sidebar ?? DEFAULT_RATIOS.sidebar, 0.12, 0.40);
    const middle = clamp(parsed.middle ?? DEFAULT_RATIOS.middle, 0.20, 0.70);
    if (sidebar + middle > 0.85) return { ...DEFAULT_RATIOS };
    return { sidebar, middle };
  } catch {
    return { ...DEFAULT_RATIOS };
  }
}

function saveRatios(r: Ratios): void {
  try { localStorage.setItem(SHELL_RATIOS_STORAGE_KEY, JSON.stringify(r)); } catch { /* ignore quota */ }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function mountAppShell(container: HTMLElement): AppShell {
  container.innerHTML = '';

  const shell = document.createElement('div');
  shell.className = 'atlas-shell';

  const sidebar = document.createElement('aside');
  sidebar.className = 'atlas-sidebar';

  const sidebarToggle = document.createElement('div');
  sidebarToggle.className = 'atlas-sidebar-toggle';
  sidebar.appendChild(sidebarToggle);

  const sidebarContent = document.createElement('div');
  sidebarContent.className = 'atlas-sidebar-content';
  sidebar.appendChild(sidebarContent);

  const sidebarFooter = document.createElement('div');
  sidebarFooter.className = 'atlas-sidebar-footer';
  sidebar.appendChild(sidebarFooter);

  const divider1 = document.createElement('div');
  divider1.className = 'atlas-divider';

  const middle = document.createElement('section');
  middle.className = 'atlas-middle';

  const divider2 = document.createElement('div');
  divider2.className = 'atlas-divider';

  const right = document.createElement('section');
  right.className = 'atlas-right';
  const rightTabBar = document.createElement('div');
  rightTabBar.className = 'atlas-right-tab-bar';
  right.appendChild(rightTabBar);
  const rightPane = document.createElement('div');
  rightPane.className = 'atlas-pane atlas-right-pane';
  right.appendChild(rightPane);

  shell.appendChild(sidebar);
  shell.appendChild(divider1);
  shell.appendChild(middle);
  shell.appendChild(divider2);
  shell.appendChild(right);
  container.appendChild(shell);

  let ratios = loadRatios();

  function applyRatios(): void {
    sidebar.style.flex = `0 0 ${(ratios.sidebar * 100).toFixed(3)}%`;
    middle.style.flex = `0 0 ${(ratios.middle * 100).toFixed(3)}%`;
    right.style.flex = `1 1 auto`;
  }
  applyRatios();

  attachDivider(divider1, shell, (clientX) => {
    const rect = shell.getBoundingClientRect();
    const fraction = (clientX - rect.left) / rect.width;
    ratios = { sidebar: clamp(fraction, 0.12, 0.40), middle: ratios.middle };
    if (ratios.sidebar + ratios.middle > 0.85) ratios.middle = 0.85 - ratios.sidebar;
    applyRatios();
  }, () => saveRatios(ratios));

  attachDivider(divider2, shell, (clientX) => {
    const rect = shell.getBoundingClientRect();
    const sidebarPx = rect.width * ratios.sidebar;
    const middlePx = clientX - rect.left - sidebarPx;
    const middleFraction = middlePx / rect.width;
    ratios = { sidebar: ratios.sidebar, middle: clamp(middleFraction, 0.20, 0.70) };
    if (ratios.sidebar + ratios.middle > 0.88) ratios.middle = 0.88 - ratios.sidebar;
    applyRatios();
  }, () => saveRatios(ratios));

  return { root: shell, sidebar, sidebarToggle, sidebarContent, sidebarFooter, middle, right, rightTabBar, rightPane };
}

function attachDivider(
  divider: HTMLElement,
  shell: HTMLElement,
  onMove: (clientX: number) => void,
  onEnd: () => void,
): void {
  let dragging = false;
  divider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    divider.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    onMove(e.clientX);
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    onEnd();
    window.dispatchEvent(new Event('resize'));
  });
}
