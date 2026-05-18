/**
 * UI preferences — small object persisted to localStorage, independent of the
 * registry (worlds data) and URL routes. Session 223 introduced this so the
 * sidebar mode is no longer derived from the URL — it's a user preference.
 *
 * Currently tracks:
 *   - sidebarMode: 'worlds' | 'elements'
 *
 * Add new prefs here as they emerge. Keep the surface tiny — anything
 * world-specific belongs on the registry entry; anything navigational belongs
 * in the URL hash; anything truly app-level + ephemeral belongs here.
 */

import { UI_PREFS_STORAGE_KEY } from './constants';
import type { SidebarMode } from './state';

export interface UiPrefs {
  sidebarMode: SidebarMode;
}

const DEFAULT_PREFS: UiPrefs = {
  sidebarMode: 'worlds',
};

export function loadUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(UI_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    const sidebarMode: SidebarMode =
      parsed.sidebarMode === 'elements' || parsed.sidebarMode === 'worlds'
        ? parsed.sidebarMode
        : DEFAULT_PREFS.sidebarMode;
    return { sidebarMode };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveUiPrefs(prefs: UiPrefs): void {
  try {
    localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota */
  }
}

export function setSidebarModePref(mode: SidebarMode): void {
  saveUiPrefs({ sidebarMode: mode });
}
