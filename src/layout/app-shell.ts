/**
 * AppShell — three-pane layout: sidebar | middle | right.
 *
 * Sidebar (~18%): mode toggle area, content, gear at bottom.
 * Middle  (~52%): flex column with [room nav strip | room content].
 *                 Room nav strip is persistent across rooms when a world is
 *                 active (see DESIGN.md "Rooms"). Room content holds the
 *                 active room (welcome / home / element / writing / timeline /
 *                 search / publish / import / templates / settings).
 * Right   (~30%): tab bar (Map Index + per-map tabs) + leaflet canvas.
 *
 * Two draggable dividers between panes. Ratios persist to localStorage.
 *
 * Originally ported verbatim from `atlas-deprecated/src/layout/app-shell.ts`;
 * session 223 split the middle pane into roomNav + content to support the
 * rooms model. Convention #31.
 */

import { SHELL_RATIOS_STORAGE_KEY } from '../core/constants';

export interface AppShell {
  root: HTMLElement;
  sidebar: HTMLElement;
  sidebarToggle: HTMLElement;
  sidebarContent: HTMLElement;
  sidebarFooter: HTMLElement;
  /** Middle pane container — DO NOT mount into directly. Use middleContent. */
  middle: HTMLElement;
  /** Room nav strip (~32px, top of middle). Persistent when world is active. */
  middleRoomNav: HTMLElement;
  /** Room content target — mount the active room here. */
  middleContent: HTMLElement;
  right: HTMLElement;
  rightTabBar: HTMLElement;
  rightPane: HTMLElement;
  /**
   * Reset divider ratios to defaults and clear the persisted value.
   * Wired to the reset-layout button in the sidebar footer.
   */
  resetRatios: () => void;
}

interface Ratios { sidebar: number; middle: number; }
// Sidebar default at 19% — a touch wider than the original 18% so the footer
// fits gear + reset + sync pill without crowding, but tighter than 20% which
// took a noticeable bite out of the middle pane.
const DEFAULT_RATIOS: Ratios = { sidebar: 0.19, middle: 0.51 };

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

  // Middle pane: flex column. Top = room nav strip (~32px), bottom = room content.
  // Renderers MUST mount to middleContent, never to middle directly (would break
  // the column flex). See DESIGN convention #31.
  const middle = document.createElement('section');
  middle.className = 'atlas-middle';

  const middleRoomNav = document.createElement('div');
  middleRoomNav.className = 'atlas-middle-room-nav';
  middleRoomNav.setAttribute('data-active', 'false');
  middle.appendChild(middleRoomNav);

  const middleContent = document.createElement('div');
  middleContent.className = 'atlas-middle-content';
  middle.appendChild(middleContent);

  const divider2 = document.createElement('div');
  divider2.className = 'atlas-divider';

  const right = document.createElement('section');
  right.className = 'atlas-right';
  const rightTabBar = document.createElement('div');
  rightTabBar.className = 'atlas-tab-bar';
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

  function resetRatios(): void {
    ratios = { ...DEFAULT_RATIOS };
    applyRatios();
    try { localStorage.removeItem(SHELL_RATIOS_STORAGE_KEY); } catch { /* ignore */ }
    window.dispatchEvent(new Event('resize'));
  }

  return {
    root: shell,
    sidebar,
    sidebarToggle,
    sidebarContent,
    sidebarFooter,
    middle,
    middleRoomNav,
    middleContent,
    right,
    rightTabBar,
    rightPane,
    resetRatios,
  };
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
