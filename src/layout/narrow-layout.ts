/**
 * The narrow-window layer.
 *
 * Atlas is a three-pane desktop shell whose panes carry hard pixel floors:
 * sidebar 180 + middle 280 + right 240, plus two dividers, is a ~706px hard
 * requirement. Below that the row simply exceeded the viewport and
 * `overflow: hidden` clipped whatever fell off the right edge. There was no
 * horizontal scrollbar anywhere (html, body and .atlas-shell all hide
 * overflow), so the clipped content was not awkward, it was UNREACHABLE: at
 * 768 the map pane lost ~50px, at 640 the entire right pane was off-screen,
 * and at 390 the guided tour, which the landing page happily offers to phone
 * visitors, collapsed into unreadable overlap.
 *
 * Before this module the stylesheet held THREE media queries in ~14,800
 * lines, none of them touching the shell.
 *
 * The model: below a threshold a pane stops being a COLUMN and becomes a
 * DRAWER over the middle pane. Nothing is removed and no capability is
 * gated; the panes are reached by a toggle instead of by being permanently
 * on screen. Two thresholds, because the two panes stop fitting at different
 * widths:
 *
 *   <= 1100px   the right pane (web / maps / charts) becomes a drawer
 *   <= 820px    the sidebar also becomes a drawer
 *
 * Everything above 1100px is untouched, which is the common desktop case and
 * every existing screenshot.
 *
 * The toggles live in the room-nav strip (see room-nav.ts) and are CSS-gated,
 * so they cost nothing at desktop widths.
 */

export const NARROW_RIGHT_MAX = 1100;
export const NARROW_SIDEBAR_MAX = 820;

const CLASS_NARROW = 'atlas-narrow';
const CLASS_NARROW_SIDEBAR = 'atlas-narrow-sidebar';
const CLASS_RIGHT_OPEN = 'atlas-drawer-right-open';
const CLASS_SIDEBAR_OPEN = 'atlas-drawer-sidebar-open';

/** Which drawer, if either, is currently open. */
export type DrawerName = 'right' | 'sidebar';

type Listener = () => void;
const listeners = new Set<Listener>();

function width(): number {
  return typeof window === 'undefined' ? 1920 : window.innerWidth;
}

export function isNarrow(): boolean {
  return width() <= NARROW_RIGHT_MAX;
}

export function isNarrowSidebar(): boolean {
  return width() <= NARROW_SIDEBAR_MAX;
}

export function isDrawerOpen(name: DrawerName): boolean {
  const cls = name === 'right' ? CLASS_RIGHT_OPEN : CLASS_SIDEBAR_OPEN;
  return document.body.classList.contains(cls);
}

/**
 * Open one drawer, closing the other. Two overlapping drawers on a 390px
 * screen would leave no middle pane visible at all, which is the state this
 * whole module exists to prevent.
 */
export function openDrawer(name: DrawerName): void {
  document.body.classList.toggle(CLASS_RIGHT_OPEN, name === 'right');
  document.body.classList.toggle(CLASS_SIDEBAR_OPEN, name === 'sidebar');
  notify();
}

export function closeDrawers(): void {
  document.body.classList.remove(CLASS_RIGHT_OPEN, CLASS_SIDEBAR_OPEN);
  notify();
}

export function toggleDrawer(name: DrawerName): void {
  if (isDrawerOpen(name)) closeDrawers();
  else openDrawer(name);
}

/** Subscribe to breakpoint / drawer changes (the room-nav re-renders on these). */
export function onNarrowChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function notify(): void {
  for (const fn of listeners) {
    try { fn(); } catch (err) { console.error('[narrow-layout] listener failed', err); }
  }
}

let installed = false;

/**
 * Stamp the breakpoint classes and keep them current. Idempotent; safe to
 * call from boot.
 */
export function installNarrowLayout(): void {
  if (installed) return;
  installed = true;

  let lastNarrow: boolean | null = null;
  let lastNarrowSidebar: boolean | null = null;

  const apply = (): void => {
    const narrow = isNarrow();
    const narrowSidebar = isNarrowSidebar();
    if (narrow === lastNarrow && narrowSidebar === lastNarrowSidebar) return;

    document.body.classList.toggle(CLASS_NARROW, narrow);
    document.body.classList.toggle(CLASS_NARROW_SIDEBAR, narrowSidebar);

    // Leaving a breakpoint must not strand a drawer: at desktop width the
    // panes are columns again and an open-drawer class would only confuse the
    // next narrowing.
    if (!narrow) document.body.classList.remove(CLASS_RIGHT_OPEN);
    if (!narrowSidebar) document.body.classList.remove(CLASS_SIDEBAR_OPEN);

    lastNarrow = narrow;
    lastNarrowSidebar = narrowSidebar;
    notify();
  };

  apply();
  window.addEventListener('resize', apply);

  // The scrim: dims the middle pane behind an open drawer and gives the
  // drawer a dismissal target. Without it a drawer reads as a floating slab
  // over live content with no way out but the toggle it came from, which is
  // the "modal with no backdrop" mistake.
  const shell = document.querySelector('.atlas-shell');
  if (shell && !shell.querySelector('.atlas-drawer-scrim')) {
    const scrim = document.createElement('div');
    scrim.className = 'atlas-drawer-scrim';
    scrim.setAttribute('aria-hidden', 'true');
    // Full outside click, matching the app-wide modal discipline: a
    // drag that STARTS inside the drawer and releases on the scrim must not
    // dismiss it, or a text selection eats the panel.
    let downOnScrim = false;
    scrim.addEventListener('pointerdown', (e) => { downOnScrim = e.target === scrim; });
    scrim.addEventListener('pointerup', (e) => {
      if (downOnScrim && e.target === scrim) closeDrawers();
      downOnScrim = false;
    });
    shell.appendChild(scrim);
  }

  // Escape closes a drawer, matching every other dismissible surface in the
  // app. Not capture-phase: zone edit mode captures Escape for vertex work
  // and stealing it here would revert committed drags.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!isDrawerOpen('right') && !isDrawerOpen('sidebar')) return;
    closeDrawers();
  });

  // A drawer is a view of the CURRENT room; navigating away should not leave
  // it hanging over the new one. Except during the tour, which owns the
  // drawers: each step navigates and then opens the pane it
  // points at (tour-pane.ts), and this close, landing a tick after the
  // navigation, shut the drawer the step had just opened.
  window.addEventListener('hashchange', () => {
    if (document.body.classList.contains('atlas-touring')) return;
    if (isDrawerOpen('right') || isDrawerOpen('sidebar')) closeDrawers();
  });
}
