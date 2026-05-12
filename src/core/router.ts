/**
 * Hash-based router (no server rewrites needed — Cloudflare Pages friendly).
 *
 * URL scheme (Phase 2 + Bout A):
 *   #/                          → empty welcome (no active world)
 *   #/settings                  → settings panel (no active world required)
 *   #/w/<worldId>               → welcome with active world (sidebar: worlds)
 *   #/w/<worldId>/settings      → settings panel scoped to active world (sidebar: worlds)
 *   #/w/<worldId>/elements      → welcome with active world (sidebar: elements)
 *   #/w/<worldId>/element/<eid> → element detail (sidebar: elements)
 *
 * Routing is a thin layer: it reads the hash and tells the orchestrator which
 * world to activate / which mode to show. Navigation is `navigate('#/w/abc')`.
 */

export type RouteMode = 'welcome' | 'settings' | 'elements' | 'element' | 'map' | 'timeline';

export interface Route {
  worldId: string | null;
  mode: RouteMode;
  elementId?: string;
  mapId?: string;
}

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#?\/?/, '');
  if (!clean) return { worldId: null, mode: 'welcome' };
  const parts = clean.split('/');
  // /settings (no world)
  if (parts[0] === 'settings') return { worldId: null, mode: 'settings' };
  // /w/<id>...
  if (parts[0] === 'w' && parts[1]) {
    const worldId = parts[1];
    const sub = parts[2];
    if (sub === 'settings') return { worldId, mode: 'settings' };
    if (sub === 'elements') return { worldId, mode: 'elements' };
    if (sub === 'timeline') return { worldId, mode: 'timeline' };
    if (sub === 'element' && parts[3]) return { worldId, mode: 'element', elementId: parts[3] };
    if (sub === 'map' && parts[3]) {
      // map route can carry an element selection too: /w/<id>/map/<mid>/element/<eid>
      const elementId = parts[4] === 'element' ? parts[5] : undefined;
      return { worldId, mode: 'map', mapId: parts[3], elementId };
    }
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

export function elementsHash(worldId: string): string {
  return `#/w/${worldId}/elements`;
}

export function elementHash(worldId: string, elementId: string): string {
  return `#/w/${worldId}/element/${elementId}`;
}

export function mapHash(worldId: string, mapId: string): string {
  return `#/w/${worldId}/map/${mapId}`;
}

export function timelineHash(worldId: string): string {
  return `#/w/${worldId}/timeline`;
}

export function onHashChange(fn: (route: Route) => void): () => void {
  const handler = () => fn(parseHash(window.location.hash));
  window.addEventListener('hashchange', handler);
  // Fire once on register for the current hash.
  handler();
  return () => window.removeEventListener('hashchange', handler);
}
