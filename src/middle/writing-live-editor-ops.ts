/**
 * Live-editor operation registry (S265). The writing workspace registers its
 * bulk link/unlink closures here while an editor is mounted; the tree-level
 * bulk operation consults it so the OPEN narrative runs through the live
 * TipTap transaction (undoable, autosaved) instead of a disk write the
 * editor's next autosave would silently revert.
 */

export interface LiveEditorOps {
  narrativeId: string;
  /** Convert every autolink hint in the live doc. Returns count. */
  linkAll(): number;
  /** Replace every chip in the live doc with its label. Returns count. */
  unlinkAll(): number;
}

let current: LiveEditorOps | null = null;

export function setLiveEditorOps(ops: LiveEditorOps | null): void {
  current = ops;
}

export function getLiveEditorOps(): LiveEditorOps | null {
  return current;
}
