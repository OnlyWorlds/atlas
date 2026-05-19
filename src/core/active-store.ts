/**
 * Active-FolderStore accessor.
 *
 * Previously lived in `ui/create-world-modal.ts` for historical reasons (that
 * was the first module that needed it). Moved to `core/` so consumers can
 * import it without pulling a modal class transitively.
 *
 * Lifecycle: set when a world is activated (`worlds-sidebar.activateWorld`,
 * `atlas-root-flow.createWorldInRoot`, `link-world-modal`), cleared when no
 * world is active.
 */

import type { FsFolderStore } from '../store/folder-store-fs';

let activeStore: FsFolderStore | null = null;

export function setActiveStore(store: FsFolderStore | null): void {
  activeStore = store;
}

export function getActiveStore(): FsFolderStore | null {
  return activeStore;
}
