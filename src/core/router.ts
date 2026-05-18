/**
 * Hash-based router (no server rewrites needed — Cloudflare Pages friendly).
 *
 * URL scheme (session 223+ rooms model — see DESIGN.md "Rooms"):
 *
 *   Sidebar-mode signals (independent of middle room):
 *     #/                                          → welcome, no world
 *     #/w/<id>                                    → home room, sidebar: worlds
 *     #/w/<id>/elements                           → home room, sidebar: elements
 *
 *   Room routes (middle pane):
 *     #/w/<id>/element/<eid>                      → element room
 *     #/w/<id>/writing                            → writing room (no narrative)
 *     #/w/<id>/writing/book/<bId>                 → book
 *     #/w/<id>/writing/book/<bId>/chapter/<cId>   → chapter
 *     #/w/<id>/writing/book/<bId>/chapter/<cId>/scene/<sId>  → scene
 *     #/w/<id>/timeline                           → full timeline room
 *     #/w/<id>/search?q=<query>                   → search room
 *     #/w/<id>/publish                            → publish home
 *     #/w/<id>/publish/<showcaseId>               → publish detail
 *     #/w/<id>/import                             → import room
 *     #/w/<id>/templates                          → templates room
 *     #/w/<id>/settings[/<tab>]                   → settings room
 *
 *   Right-pane map composition (orthogonal — map lives in right pane):
 *     #/w/<id>/map/<mid>                          → opens map tab
 *     #/w/<id>/map/<mid>/element/<eid>            → map + element selected
 *
 *   Settings without an active world (first-launch convenience):
 *     #/settings[/<tab>]
 *
 * Routing is a thin layer: it reads the hash and tells the orchestrator which
 * world to activate / which middle room to mount. Navigate via `navigate('#/...')`.
 */

export type RouteMode =
  | 'welcome'
  | 'home'
  | 'settings'
  | 'elements'
  | 'element'
  | 'map'
  | 'timeline'
  | 'writing'
  | 'search'
  | 'publish'
  | 'publish-detail'
  | 'import'
  | 'templates';

export type SettingsTab = 'identity' | 'atlas' | 'sync' | 'maps' | 'world' | 'writing' | 'about';

export const SETTINGS_TABS: SettingsTab[] = ['identity', 'atlas', 'sync', 'maps', 'world', 'writing', 'about'];

export interface Route {
  worldId: string | null;
  mode: RouteMode;
  elementId?: string;
  mapId?: string;
  /** Active settings tab when mode === 'settings'. Defaults to 'identity'. */
  settingsTab?: SettingsTab;
  /** Writing room hierarchy ids. */
  bookId?: string;
  chapterId?: string;
  sceneId?: string;
  /** Publish detail room. */
  showcaseId?: string;
  /** Search room query string. */
  searchQuery?: string;
}

function parseSettingsTab(s: string | undefined): SettingsTab {
  if (s && (SETTINGS_TABS as string[]).includes(s)) return s as SettingsTab;
  return 'identity';
}

function splitHashAndQuery(input: string): { path: string; query: string } {
  const i = input.indexOf('?');
  if (i < 0) return { path: input, query: '' };
  return { path: input.slice(0, i), query: input.slice(i + 1) };
}

function parseQuery(query: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!query) return out;
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const k = decodeURIComponent(eq >= 0 ? pair.slice(0, eq) : pair);
    const v = eq >= 0 ? decodeURIComponent(pair.slice(eq + 1)) : '';
    out[k] = v;
  }
  return out;
}

export function parseHash(hash: string): Route {
  const stripped = hash.replace(/^#?\/?/, '');
  const { path, query } = splitHashAndQuery(stripped);
  if (!path) return { worldId: null, mode: 'welcome' };
  const parts = path.split('/');
  const params = parseQuery(query);

  // /settings[/:tab] (no world)
  if (parts[0] === 'settings') {
    return { worldId: null, mode: 'settings', settingsTab: parseSettingsTab(parts[1]) };
  }

  // /w/<id>...
  if (parts[0] === 'w' && parts[1]) {
    const worldId = parts[1];
    const sub = parts[2];

    // Bare `/w/<id>` → home (DEFAULT for active world, sidebar in worlds mode).
    if (!sub) return { worldId, mode: 'home' };

    if (sub === 'settings') {
      return { worldId, mode: 'settings', settingsTab: parseSettingsTab(parts[3]) };
    }
    if (sub === 'elements') return { worldId, mode: 'elements' };
    if (sub === 'timeline') return { worldId, mode: 'timeline' };
    if (sub === 'search') return { worldId, mode: 'search', searchQuery: params.q ?? '' };
    if (sub === 'import') return { worldId, mode: 'import' };
    if (sub === 'templates') return { worldId, mode: 'templates' };

    if (sub === 'publish') {
      const showcaseId = parts[3];
      if (showcaseId) return { worldId, mode: 'publish-detail', showcaseId };
      return { worldId, mode: 'publish' };
    }

    if (sub === 'writing') {
      // /writing[/book/<bId>[/chapter/<cId>[/scene/<sId>]]]
      const out: Route = { worldId, mode: 'writing' };
      if (parts[3] === 'book' && parts[4]) {
        out.bookId = parts[4];
        if (parts[5] === 'chapter' && parts[6]) {
          out.chapterId = parts[6];
          if (parts[7] === 'scene' && parts[8]) {
            out.sceneId = parts[8];
          }
        }
      }
      return out;
    }

    if (sub === 'element' && parts[3]) return { worldId, mode: 'element', elementId: parts[3] };

    if (sub === 'map' && parts[3]) {
      // map route can carry an element selection too: /w/<id>/map/<mid>/element/<eid>
      const elementId = parts[4] === 'element' ? parts[5] : undefined;
      return { worldId, mode: 'map', mapId: parts[3], elementId };
    }

    // Unrecognised sub-route under an active world → fall back to home so the
    // user lands somewhere sensible instead of an empty state.
    return { worldId, mode: 'home' };
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

// ===========================================================================
// Deep-link helpers
// ===========================================================================

export function worldHash(worldId: string): string {
  return `#/w/${worldId}`;
}

/** Alias of worldHash — the canonical "world home" URL is the bare worldId path. */
export function homeHash(worldId: string): string {
  return worldHash(worldId);
}

export function settingsHash(worldId: string | null, tab?: SettingsTab): string {
  const base = worldId ? `#/w/${worldId}/settings` : '#/settings';
  return tab ? `${base}/${tab}` : base;
}

export function elementsHash(worldId: string): string {
  return `#/w/${worldId}/elements`;
}

export function elementHash(worldId: string, elementId: string): string {
  return `#/w/${worldId}/element/${elementId}`;
}

export function mapHash(worldId: string, mapId: string, elementId?: string): string {
  const base = `#/w/${worldId}/map/${mapId}`;
  return elementId ? `${base}/element/${elementId}` : base;
}

export function timelineHash(worldId: string): string {
  return `#/w/${worldId}/timeline`;
}

export function writingHash(
  worldId: string,
  bookId?: string,
  chapterId?: string,
  sceneId?: string,
): string {
  let path = `#/w/${worldId}/writing`;
  if (bookId) {
    path += `/book/${bookId}`;
    if (chapterId) {
      path += `/chapter/${chapterId}`;
      if (sceneId) {
        path += `/scene/${sceneId}`;
      }
    }
  }
  return path;
}

export function searchHash(worldId: string, query?: string): string {
  const base = `#/w/${worldId}/search`;
  if (!query) return base;
  return `${base}?q=${encodeURIComponent(query)}`;
}

export function publishHash(worldId: string): string {
  return `#/w/${worldId}/publish`;
}

export function publishDetailHash(worldId: string, showcaseId: string): string {
  return `#/w/${worldId}/publish/${showcaseId}`;
}

export function importHash(worldId: string): string {
  return `#/w/${worldId}/import`;
}

export function templatesHash(worldId: string): string {
  return `#/w/${worldId}/templates`;
}

export function onHashChange(fn: (route: Route) => void): () => void {
  const handler = () => fn(parseHash(window.location.hash));
  window.addEventListener('hashchange', handler);
  // Fire once on register for the current hash.
  handler();
  return () => window.removeEventListener('hashchange', handler);
}
