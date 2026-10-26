/**
 * Live-editor operation registry. The writing workspace registers its
 * bulk link/unlink closures here while an editor is mounted; the tree-level
 * bulk operation consults it so the OPEN narrative runs through the live
 * TipTap transaction (undoable, autosaved) instead of a disk write the
 * editor's next autosave would silently revert.
 */

import type { TermLinkTarget, TermMatchOptions } from '../core/prose-autolink';

export interface LiveEditorOps {
  narrativeId: string;
  /** Convert every autolink hint in the live doc (or only `only`'s). Returns count. */
  linkAll(only?: string): number;
  /** Replace every chip in the live doc with its label. Returns count. */
  unlinkAll(): number;
  /** Chip every match of `term` to `target` in the live doc. Returns count. */
  linkTerm(term: string | readonly string[], target: TermLinkTarget, opts: TermMatchOptions): number;
}

let current: LiveEditorOps | null = null;

export function setLiveEditorOps(ops: LiveEditorOps | null): void {
  current = ops;
}

export function getLiveEditorOps(): LiveEditorOps | null {
  return current;
}
