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
 * a later change split the middle pane into roomNav + content to support the
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
// Sidebar default at 20% — wide enough that the 22 type-filter chips sit in
// two rows of 11 on common window widths (Titus, 2026-07-10; was 19%,
// which wrapped them to a ragged third row).
const DEFAULT_RATIOS: Ratios = { sidebar: 0.20, middle: 0.51 };
// Prior default — a stored ratio equal to it means "never customized";
// upgrade those to the new default so the change actually reaches users.
const LEGACY_SIDEBAR_DEFAULT = 0.19;

function loadRatios(): Ratios {
  try {
    const raw = localStorage.getItem(SHELL_RATIOS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_RATIOS };
    const parsed = JSON.parse(raw) as Partial<Ratios>;
    if (parsed.sidebar != null && Math.abs(parsed.sidebar - LEGACY_SIDEBAR_DEFAULT) < 0.001) {
      parsed.sidebar = DEFAULT_RATIOS.sidebar;
    }
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

/**
 * The right pane's floor, in real pixels — it must match `.atlas-right`'s
 * `min-width` in atlas.css, plus the divider it sits behind.
 *
 * Why pixels: the dividers clamp in FRACTIONS while the pane clamps in
 * PIXELS, and the two disagree on any window narrow enough for the fraction
 * to fall below the min-width. Dragging the middle divider right on a 1280
 * laptop used to push the shell past the viewport — `overflow: hidden` then
 * clipped the map's right-anchored controls (the pin trash, the zones
 * dropdown) off-screen with no scrollbar and no cue, and the ratio persists,
 * so the broken state survived a reload.
 */
export const RIGHT_PANE_MIN_PX = 240 + 3;

/**
 * The largest middle fraction that still leaves the right pane its pixel
 * floor. Returns the caller's own cap when the window is wide enough for the
 * fraction limits to bind first.
 */
export function middleCapFor(shellWidthPx: number, sidebarFraction: number, fractionCap: number): number {
  if (shellWidthPx <= 0) return fractionCap;
  const available = shellWidthPx - shellWidthPx * sidebarFraction - RIGHT_PANE_MIN_PX;
  return Math.min(fractionCap, Math.max(0.2, available / shellWidthPx));
}

/**
 * The first Tab stop while a new world's first steps show (#972): one press past the chrome
 * (the toolbar, the rail's kind icons, the list) to the block's first control. Shown only while
 * the home holds the guide block (CSS `:has`, so it never outlives the block); unseen until focused.
 */
function buildGuideSkip(): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'atlas-guide-skip';
  b.setAttribute('data-role', 'guide-skip');
  b.textContent = 'Skip to the first steps';
  b.addEventListener('click', () => {
    const block = document.querySelector<HTMLElement>('[data-role="guide-block"]');
    if (!block) return;
    // In this order, never the head's Back or ×: a door, the card's first button, a way to bring a world in.
    const target = ['[data-grid-plus]', '[data-role="home-grid"] [data-grid-id][tabindex="0"]', '[data-guide-door]', '[data-role="guide-card"] [data-step-action]', '[data-bring-action]', 'button:not([disabled])']
      .map(s => block.querySelector<HTMLElement>(s)).find(Boolean);
    if (!target) return;
    target.focus({ preventScroll: true });
    block.scrollIntoView({ block: 'nearest' });
  });
  return b;
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

  // The guide's one note (ui/guide-note.ts): a zero-height row at the pane's
  // foot that the note floats up from, so it never reflows a room. An empty
  // live region from the start, so a note put in it is read out.
  const guideSlot = document.createElement('div');
  guideSlot.className = 'atlas-guide-slot';
  guideSlot.setAttribute('role', 'status');
  guideSlot.setAttribute('aria-live', 'polite');
  middle.appendChild(guideSlot);

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

  shell.appendChild(buildGuideSkip());
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

  // Both dividers end by squeezing the SAME pane, so both run the same pixel
  // cap. They used to carry different fraction guards (0.85 here, 0.88 below)
  // and neither knew about the right pane's 240px floor.
  attachDivider(divider1, shell, (clientX) => {
    const rect = shell.getBoundingClientRect();
    const fraction = (clientX - rect.left) / rect.width;
    const sidebarNext = clamp(fraction, 0.12, 0.40);
    ratios = {
      sidebar: sidebarNext,
      middle: Math.min(ratios.middle, middleCapFor(rect.width, sidebarNext, 0.70)),
    };
    applyRatios();
  }, () => saveRatios(ratios));

  attachDivider(divider2, shell, (clientX) => {
    const rect = shell.getBoundingClientRect();
    const sidebarPx = rect.width * ratios.sidebar;
    const middlePx = clientX - rect.left - sidebarPx;
    const middleFraction = middlePx / rect.width;
    ratios = {
      sidebar: ratios.sidebar,
      middle: clamp(middleFraction, 0.20, middleCapFor(rect.width, ratios.sidebar, 0.70)),
    };
    applyRatios();
  }, () => saveRatios(ratios));

  // A stored ratio that fits at 1920 can overflow at 1280, so re-clamp when
  // the window changes rather than only when a divider is dragged.
  window.addEventListener('resize', () => {
    const rect = shell.getBoundingClientRect();
    const capped = Math.min(ratios.middle, middleCapFor(rect.width, ratios.sidebar, 0.70));
    if (Math.abs(capped - ratios.middle) > 0.0005) {
      ratios = { sidebar: ratios.sidebar, middle: capped };
      applyRatios();
    }
  });

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
