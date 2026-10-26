/**
 * App theme (light-mode Phase 0). Device-local, like shell ratios: a
 * plain localStorage key, never synced, never in world data. The mechanism is
 * one attribute — `<html data-theme="light">` — which atlas.css answers with
 * the ow-house-light token block; absent attribute = dark (the default, and
 * the only value older builds know).
 *
 * index.html carries a tiny pre-paint reader of the SAME key so a light-mode
 * user never sees a black flash; this module is the runtime source of truth
 * for reads/writes after boot. The share page's per-page `data-mode` axis is
 * deliberately orthogonal (published artifacts keep their own look).
 */

export type AtlasTheme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'atlas_theme';

/** Browser-tab chrome colours (the <meta name="theme-color"> values). */
const META_THEME_COLOR: Record<AtlasTheme, string> = {
  dark: '#0a0a0a',
  light: '#fbfbfa',
};

export function getTheme(): AtlasTheme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Stamp the current (or given) theme onto the document. Idempotent. */
export function applyTheme(theme: AtlasTheme = getTheme()): void {
  const root = document.documentElement;
  if (theme === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', META_THEME_COLOR[theme]);
}

export function setTheme(theme: AtlasTheme): void {
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* private mode */ }
  applyTheme(theme);
}
