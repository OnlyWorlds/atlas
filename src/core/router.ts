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
 *     #/w/<id>/writing/<narrativeId>              → writing room with active narrative
 *                                                   (any tier — book / chapter / scene / draft.
 *                                                    Ancestry derived from parent_narrative chain at render time.)
 *     LEGACY (still parsed for back-compat, no longer emitted):
 *     #/w/<id>/writing/book/<bId>[/chapter/<cId>[/scene/<sId>]]
 *     #/w/<id>/timeline                           → full timeline room
 *     #/w/<id>/search?q=<query>                   → search room
 *     #/w/<id>/share                              → share room (page list)
 *     #/w/<id>/share/<pageId>                     → share room, page detail
 *     LEGACY (still parsed, no longer emitted):
 *     #/w/<id>/publish[/<id>]                     → aliases to /share[/<id>]
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
  | 'demo'
  | 'home'
  | 'settings'
  | 'elements'
  | 'element'
  | 'map'
  | 'timeline'
  | 'writing'
  | 'knowledge'
  | 'search'
  | 'share'
  | 'import'
  | 'templates';

export type SettingsTab = 'onlyworlds' | 'storage' | 'editing' | 'world' | 'writing' | 'context';

export const SETTINGS_TABS: SettingsTab[] = ['onlyworlds', 'storage', 'editing', 'world', 'writing', 'context'];

/**
 * Settings tabs grouped by scope for the nav rail. 'atlas' scope applies to
 * the whole tool / all worlds; 'world' scope follows the active world (those
 * tabs disable when no world is active).
 */
export const SETTINGS_TAB_GROUPS: ReadonlyArray<{ scope: 'atlas' | 'world'; tabs: SettingsTab[] }> = [
  { scope: 'atlas', tabs: ['onlyworlds', 'storage', 'editing'] },
  { scope: 'world', tabs: ['world', 'writing', 'context'] },
];

/** Legacy settings-tab keys → current keys (pre-session-232 deep links / stored last-tab; 'account' renamed to 'onlyworlds' in Bout OW). */
const LEGACY_SETTINGS_TABS: Record<string, SettingsTab> = {
  identity: 'onlyworlds',
  account: 'onlyworlds',
  atlas: 'storage',
  sync: 'storage',
  maps: 'editing',
  about: 'onlyworlds',
};

export interface Route {
  worldId: string | null;
  mode: RouteMode;
  elementId?: string;
  mapId?: string;
  /** Active settings tab when mode === 'settings'. Defaults to 'account'. */
  settingsTab?: SettingsTab;
  /**
   * Writing room active narrative id (any tier — book/chapter/scene/draft).
   * Ancestry is derived at render time by walking `parent_narrative`.
   * Legacy long-form URLs (`/writing/book/.../chapter/.../scene/...`) still
   * parse — parseHash picks the deepest segment as narrativeId.
   */
  narrativeId?: string;
  /** Knowledge room selected entry id (knowledge-subtype narrative). */
  knowledgeId?: string;
  /** Knowledge room known-view knower id (a Character or Circle/Collective). */
  knowerId?: string;
  /** Share room selected page id (page-subtype narrative). */
  pageId?: string;
  /** Search room query string. */
  searchQuery?: string;
}

function parseSettingsTab(s: string | undefined): SettingsTab {
  if (s && (SETTINGS_TABS as string[]).includes(s)) return s as SettingsTab;
  if (s && LEGACY_SETTINGS_TABS[s]) return LEGACY_SETTINGS_TABS[s];
  return 'onlyworlds';
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

  // /demo — the view-only sample-world presentation (no world, no registry).
  if (parts[0] === 'demo') {
    return { worldId: null, mode: 'demo' };
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
    if (sub === 'timeline') {
      // /timeline | /timeline/<elementId> (a selected event — keeps the room
      // mounted, focuses the right-pane context graph on the same element).
      return parts[3] ? { worldId, mode: 'timeline', elementId: parts[3] } : { worldId, mode: 'timeline' };
    }
    if (sub === 'knowledge') {
      // /knowledge | /knowledge/new | /knowledge/<entryId> | /knowledge/knower/<knowerId>
      if (parts[3] === 'knower' && parts[4]) {
        return { worldId, mode: 'knowledge', knowerId: parts[4] };
      }
      const knowledgeId = parts[3];
      return knowledgeId ? { worldId, mode: 'knowledge', knowledgeId } : { worldId, mode: 'knowledge' };
    }
    if (sub === 'search') return { worldId, mode: 'search', searchQuery: params.q ?? '' };
    if (sub === 'import') return { worldId, mode: 'import' };
    if (sub === 'templates') return { worldId, mode: 'templates' };

    if (sub === 'share' || sub === 'publish') {
      // 'publish' is the legacy route name (pre-Sharing-arc stub) — parsed
      // as an alias, never emitted. Old showcase deep links land on the
      // share room's not-found interim, which is honest.
      const pageId = parts[3];
      return pageId ? { worldId, mode: 'share', pageId } : { worldId, mode: 'share' };
    }

    if (sub === 'writing') {
      // New form: /writing/<narrativeId>
      // Legacy form: /writing/book/<bId>[/chapter/<cId>[/scene/<sId>]]
      const out: Route = { worldId, mode: 'writing' };
      if (parts[3] === 'book' && parts[4]) {
        // Legacy form — pick the deepest segment as narrativeId.
        if (parts[7] === 'scene' && parts[8]) out.narrativeId = parts[8];
        else if (parts[5] === 'chapter' && parts[6]) out.narrativeId = parts[6];
        else out.narrativeId = parts[4];
      } else if (parts[3]) {
        // New short form.
        out.narrativeId = parts[3];
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

/** Timeline room: `#/w/<worldId>/timeline[/<elementId>]` (selected event). */
export function timelineHash(worldId: string, elementId?: string): string {
  return elementId
    ? `#/w/${worldId}/timeline/${elementId}`
    : `#/w/${worldId}/timeline`;
}

/**
 * Emit the short writing-room URL: `#/w/<worldId>/writing[/<narrativeId>]`.
 *
 * Replaces the legacy `/writing/book/.../chapter/.../scene/...` form (still
 * parsed for back-compat in parseHash, but never emitted by atlas). Ancestry
 * is derived at render time from the parent_narrative chain.
 */
export function writingHash(worldId: string, narrativeId?: string): string {
  return narrativeId
    ? `#/w/${worldId}/writing/${narrativeId}`
    : `#/w/${worldId}/writing`;
}

/** Knowledge room: `#/w/<worldId>/knowledge[/<knowledgeId>]`. */
export function knowledgeHash(worldId: string, knowledgeId?: string): string {
  return knowledgeId
    ? `#/w/${worldId}/knowledge/${knowledgeId}`
    : `#/w/${worldId}/knowledge`;
}

/** Knowledge known-view: `#/w/<worldId>/knowledge/knower/<knowerId>`. */
export function knowledgeKnowerHash(worldId: string, knowerId: string): string {
  return `#/w/${worldId}/knowledge/knower/${knowerId}`;
}

export function searchHash(worldId: string, query?: string): string {
  const base = `#/w/${worldId}/search`;
  if (!query) return base;
  return `${base}?q=${encodeURIComponent(query)}`;
}

/** Share room: `#/w/<worldId>/share[/<pageId>]`. */
export function shareHash(worldId: string, pageId?: string): string {
  return pageId ? `#/w/${worldId}/share/${pageId}` : `#/w/${worldId}/share`;
}

export function importHash(worldId: string): string {
  return `#/w/${worldId}/import`;
}

export function onHashChange(fn: (route: Route) => void): () => void {
  const handler = () => fn(parseHash(window.location.hash));
  window.addEventListener('hashchange', handler);
  // Fire once on register for the current hash.
  handler();
  return () => window.removeEventListener('hashchange', handler);
}
