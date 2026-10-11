/**
 * Session word-count goal for the writing workspace.
 *
 * The goal is a small motivational target the writer sets at the start of a
 * session ("write 500 words today"). It lives in sessionStorage scoped by
 * (worldId, narrativeId) — explicitly NOT persisted across browser sessions,
 * since "session" is the natural unit. A new tab or reload clears it.
 *
 * UI shape: clicking the word count in the footer opens a tiny anchored
 * popover. Empty input → clears the goal. When a goal is set, the footer
 * renders a progress ring around the count.
 *
 * Atlas-local; never touches the folder or the API.
 */

const STORAGE_PREFIX = 'atlas_word_goal_';

function storageKey(worldId: string, narrativeId: string): string {
  return `${STORAGE_PREFIX}${worldId}_${narrativeId}`;
}

export function getWordGoal(worldId: string, narrativeId: string): number | null {
  if (!worldId || !narrativeId) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(worldId, narrativeId));
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
  } catch {
    return null;
  }
}

export function setWordGoal(worldId: string, narrativeId: string, goal: number): void {
  if (!worldId || !narrativeId) return;
  if (!Number.isFinite(goal) || goal <= 0) {
    clearWordGoal(worldId, narrativeId);
    return;
  }
  try {
    sessionStorage.setItem(storageKey(worldId, narrativeId), String(Math.floor(goal)));
  } catch {
    /* sessionStorage may be unavailable in private mode — silently ignore */
  }
}

export function clearWordGoal(worldId: string, narrativeId: string): void {
  if (!worldId || !narrativeId) return;
  try {
    sessionStorage.removeItem(storageKey(worldId, narrativeId));
  } catch {
    /* see setWordGoal */
  }
}

export interface GoalPopoverOpts {
  anchor: HTMLElement;
  currentGoal: number | null;
  onSet: (goal: number) => void;
  onClear: () => void;
}

/**
 * Open a small popover near the anchor. Returns a destroy function.
 *
 * The popover is a singleton-style ephemeral element (we destroy + recreate
 * on every open). Closes on Esc, click-outside, or after a successful set.
 */
export function openWordGoalPopover(opts: GoalPopoverOpts): () => void {
  const { anchor, currentGoal, onSet, onClear } = opts;

  const pop = document.createElement('div');
  pop.className = 'atlas-wc-goal-popover';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Set session word goal');
  pop.innerHTML = `
    <label class="atlas-wc-goal-label">Session goal</label>
    <div class="atlas-wc-goal-row">
      <input
        class="atlas-input"
        type="number"
        min="0"
        step="100"
        placeholder="e.g. 500"
        value="${currentGoal != null ? currentGoal : ''}"
      />
      <button type="button" class="atlas-btn-primary atlas-wc-goal-set">Set</button>
    </div>
    <button type="button" class="atlas-btn-ghost atlas-wc-goal-clear"
      ${currentGoal == null ? 'hidden' : ''}>
      Clear goal
    </button>
  `;
  document.body.appendChild(pop);

  // Position above the anchor (footer sits at the bottom of the workspace).
  const rect = anchor.getBoundingClientRect();
  pop.style.position = 'fixed';
  // Wait a microtask so we have the popover's real dimensions for clamping.
  queueMicrotask(() => {
    const popRect = pop.getBoundingClientRect();
    const top = Math.max(8, rect.top - popRect.height - 8);
    let left = rect.left;
    if (left + popRect.width > window.innerWidth - 8) {
      left = window.innerWidth - popRect.width - 8;
    }
    pop.style.top = `${top}px`;
    pop.style.left = `${Math.max(8, left)}px`;
  });

  const input = pop.querySelector<HTMLInputElement>('input')!;
  const setBtn = pop.querySelector<HTMLButtonElement>('.atlas-wc-goal-set')!;
  const clearBtn = pop.querySelector<HTMLButtonElement>('.atlas-wc-goal-clear')!;

  let alive = true;
  const destroy = (): void => {
    if (!alive) return;
    alive = false;
    document.removeEventListener('mousedown', onDocMouseDown, true);
    document.removeEventListener('keydown', onKey, true);
    pop.remove();
  };

  const submit = (): void => {
    const value = Number(input.value);
    if (!Number.isFinite(value) || value <= 0) {
      onClear();
    } else {
      onSet(Math.floor(value));
    }
    destroy();
  };

  setBtn.addEventListener('click', submit);
  clearBtn.addEventListener('click', () => {
    onClear();
    destroy();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      destroy();
    }
  });

  const onDocMouseDown = (e: MouseEvent): void => {
    const target = e.target as Node;
    if (pop.contains(target) || anchor.contains(target)) return;
    destroy();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') destroy();
  };
  document.addEventListener('mousedown', onDocMouseDown, true);
  document.addEventListener('keydown', onKey, true);

  queueMicrotask(() => input.focus());

  return destroy;
}

/**
 * Pure progress fraction (0..1, clamped). Single source of truth for the
 * ring's conic-gradient angle AND any future tooltip wording. Exported for
 * unit testing.
 */
export function goalProgress(wordCount: number, goal: number | null): number {
  if (goal == null || goal <= 0) return 0;
  if (wordCount <= 0) return 0;
  return Math.min(1, wordCount / goal);
}
