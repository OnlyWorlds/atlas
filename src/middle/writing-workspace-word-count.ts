/**
 * Ambient word-count widget for the writing workspace.
 *
 * A bottom-right corner button showing the live word count + an optional
 * session goal with a progress ring. Click → goal popover. Extracted from
 * writing-workspace.ts (session 232) as a factory that closes over the
 * workspace root + an editor-handle accessor, so it tracks the live editor
 * without the main file owning the render details.
 */

import { getState } from '../core/state';
import type { Element } from '../core/types';
import type { WorkspaceEditorHandle } from './writing-workspace-editor';
import {
  getWordGoal,
  setWordGoal,
  clearWordGoal,
  openWordGoalPopover,
  goalProgress,
} from './writing-workspace-word-goal';

export interface WordCountController {
  /** Build the corner widget for `el` (anchored on the workspace root). */
  renderWidget(el: Element): HTMLElement;
  /** Repaint the existing widget's count after a prose edit. */
  updateIndicator(wordCount: number): void;
}

export function createWordCount(deps: {
  root: HTMLElement;
  getEditorHandle: () => WorkspaceEditorHandle | null;
  getMountedForId: () => string | null;
}): WordCountController {
  const { root, getEditorHandle, getMountedForId } = deps;

  function renderWidget(el: Element): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'atlas-writing-workspace-wc-corner';

    const wordCount = getEditorHandle()?.getWordCount() ?? 0;
    const worldId = getState().active!.worldId;
    const goal = getWordGoal(worldId, el.id);

    const wcBtn = document.createElement('button');
    wcBtn.type = 'button';
    wcBtn.className = 'atlas-writing-workspace-wc-btn';
    wcBtn.title = goal != null
      ? `${wordCount.toLocaleString()} / ${goal.toLocaleString()} words — click to change goal`
      : 'Click to set session word goal';
    if (goal != null) wcBtn.dataset.hasGoal = 'true';
    renderWordCountInto(wcBtn, wordCount, goal);
    wcBtn.addEventListener('click', () => {
      openWordGoalPopover({
        anchor: wcBtn,
        currentGoal: getWordGoal(worldId, el.id),
        onSet: (next) => {
          setWordGoal(worldId, el.id, next);
          const liveCount = getEditorHandle()?.getWordCount() ?? 0;
          renderWordCountInto(wcBtn, liveCount, next);
          wcBtn.dataset.hasGoal = 'true';
        },
        onClear: () => {
          clearWordGoal(worldId, el.id);
          const liveCount = getEditorHandle()?.getWordCount() ?? 0;
          renderWordCountInto(wcBtn, liveCount, null);
          delete wcBtn.dataset.hasGoal;
        },
      });
    });
    wrap.appendChild(wcBtn);
    return wrap;
  }

  function updateIndicator(wordCount: number): void {
    const btn = root.querySelector<HTMLElement>('.atlas-writing-workspace-wc-btn');
    if (!btn) return;
    const worldId = getState().active?.worldId;
    const narrId = getMountedForId();
    const goal = worldId && narrId ? getWordGoal(worldId, narrId) : null;
    renderWordCountInto(btn, wordCount, goal);
  }

  return { renderWidget, updateIndicator };
}

/**
 * Paint the word-count button's contents — optional progress ring + count +
 * optional `/ goal` suffix. Pure DOM write, doesn't read state, so the caller
 * controls whether the goal is current.
 */
function renderWordCountInto(btn: HTMLElement, wordCount: number, goal: number | null): void {
  const formatted = wordCount.toLocaleString();
  const goalText = goal != null ? ` / ${goal.toLocaleString()}` : '';
  const fraction = goalProgress(wordCount, goal);
  const ringHtml = goal != null
    ? `<span class="atlas-writing-workspace-wc-ring" style="--progress: ${fraction.toFixed(3)};" data-complete="${fraction >= 1 ? 'true' : 'false'}"></span>`
    : '';
  btn.innerHTML = `
    ${ringHtml}
    <span class="atlas-writing-workspace-wc">${formatted} words</span>
    ${goal != null ? `<span class="atlas-writing-workspace-wc-goal">${goalText}</span>` : ''}
  `;
}
