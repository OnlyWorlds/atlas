/**
 * UI preferences — small object persisted to localStorage, independent of the
 * registry (worlds data) and URL routes. Session 223 introduced this so the
 * sidebar mode is no longer derived from the URL — it's a user preference.
 *
 * Currently tracks:
 *   - sidebarMode: 'worlds' | 'elements'
 *   - defaultCreateType: the element type the create modal preselects when
 *     opened without an explicit type (sidebar +, home "New element", hotkey)
 *
 * Add new prefs here as they emerge. Keep the surface tiny — anything
 * world-specific belongs on the registry entry; anything navigational belongs
 * in the URL hash; anything truly app-level + ephemeral belongs here.
 */

import { UI_PREFS_STORAGE_KEY } from './constants';
import type { SidebarMode } from './state';
import { CONTENT_ELEMENT_TYPES, type ElementType } from './types';

export interface UiPrefs {
  sidebarMode: SidebarMode;
  defaultCreateType: ElementType;
  /** Where the user last chose to put a new world (1.17); only read with no home folder. */
  newWorldWhere?: 'folder' | 'browser';
}

/** Types the create modal can default to — content types plus 'map'. */
const CREATABLE_TYPES: ElementType[] = [...CONTENT_ELEMENT_TYPES, 'map'];

const DEFAULT_PREFS: UiPrefs = {
  sidebarMode: 'worlds',
  defaultCreateType: 'character',
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
    const defaultCreateType: ElementType =
      parsed.defaultCreateType && CREATABLE_TYPES.includes(parsed.defaultCreateType)
        ? parsed.defaultCreateType
        : DEFAULT_PREFS.defaultCreateType;
    const newWorldWhere = parsed.newWorldWhere === 'folder' || parsed.newWorldWhere === 'browser' ? parsed.newWorldWhere : undefined;
    return { sidebarMode, defaultCreateType, ...(newWorldWhere ? { newWorldWhere } : {}) };
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
  saveUiPrefs({ ...loadUiPrefs(), sidebarMode: mode });
}

export function setNewWorldWherePref(where: 'folder' | 'browser'): void {
  saveUiPrefs({ ...loadUiPrefs(), newWorldWhere: where });
}

export function setDefaultCreateTypePref(type: ElementType): void {
  saveUiPrefs({ ...loadUiPrefs(), defaultCreateType: type });
}
