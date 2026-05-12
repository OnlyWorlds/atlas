/**
 * Hash-based router (no server rewrites needed — Cloudflare Pages friendly).
 *
 * URL scheme (only Phase 2 routes are wired today; later phases extend):
 *   #/                          → empty welcome (no active world)
 *   #/settings                  → settings panel (no active world required)
 *   #/w/<worldId>               → welcome with active world
 *   #/w/<worldId>/settings      → settings panel scoped to active world
 *
 * Routing is a thin layer: it reads the hash and tells the orchestrator which
 * world to activate / which mode to show. Navigation is `navigate('#/w/abc')`.
 */

export interface Route {
  worldId: string | null;
  mode: 'welcome' | 'settings';
}

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#?\/?/, '');
  if (!clean) return { worldId: null, mode: 'welcome' };
  const parts = clean.split('/');
  // /settings (no world)
  if (parts[0] === 'settings') return { worldId: null, mode: 'settings' };
  // /w/<id> or /w/<id>/settings
  if (parts[0] === 'w' && parts[1]) {
    const worldId = parts[1];
    const sub = parts[2];
    if (sub === 'settings') return { worldId, mode: 'settings' };
    return { worldId, mode: 'welcome' };
  }
  return { worldId: null, mode: 'welcome' };
}

export function navigate(hash: string): void {
  if (window.location.hash === hash) {
    // No-op browser navigation; fire a hashchange event manually so subscribers
    // re-resolve their current state (matters for re-clicks).
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  window.location.hash = hash;
}

export function worldHash(worldId: string): string {
  return `#/w/${worldId}`;
}

export function settingsHash(worldId: string | null): string {
  return worldId ? `#/w/${worldId}/settings` : '#/settings';
}

export function onHashChange(fn: (route: Route) => void): () => void {
  const handler = () => fn(parseHash(window.location.hash));
  window.addEventListener('hashchange', handler);
  // Fire once on register for the current hash.
  handler();
  return () => window.removeEventListener('hashchange', handler);
}
