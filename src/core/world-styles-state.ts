/**
 * The world-styles slice's two verbs: load at world activation, save from
 * the zone panel (or anywhere a rule changes). The pure rule logic is in
 * `world-styles.ts`; this file is the only place `.atlas/styles.json` meets
 * `state.styles`.
 */

import { getState, patchSlice } from './state';
import { getActiveStore } from './active-store';
import type { FolderStore } from '../store/folder-store';
import { EMPTY_STYLES, type StyleRule, type WorldStyles } from './world-styles';

export function resetWorldStyles(): void {
  patchSlice('styles', { ...EMPTY_STYLES, rules: [] });
}

/** Read the active world's rules into state. Never throws: a broken file reads as no rules. */
export async function loadWorldStyles(store: FolderStore): Promise<void> {
  let styles: WorldStyles;
  try {
    styles = await store.readStyles();
  } catch (err) {
    console.warn('[world-styles] read failed, starting empty:', err);
    styles = { ...EMPTY_STYLES, rules: [] };
  }
  // Only land on the world the read was for.
  if (getActiveStore() === store) patchSlice('styles', styles);
}

/** Replace the rule list: state first (the map re-renders on the tick), then disk. */
export async function saveWorldStyleRules(rules: StyleRule[]): Promise<void> {
  const next: WorldStyles = { version: getState().styles.version, rules };
  patchSlice('styles', next);
  const store = getActiveStore();
  if (!store) return;
  try {
    await store.writeStyles(next);
  } catch (err) {
    console.warn('[world-styles] write failed:', err);
  }
}
