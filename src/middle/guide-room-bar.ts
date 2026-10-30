/**
 * The guide's bar in a room (#975): when the home's card sends a person to the
 * chart or the writing room, the room says which step they are on and offers
 * the way back.
 *
 *   Read from the world on every tick, never from a press: the bar shows while
 *   the path shows and the card's current step is this room's, its dot lit,
 *   which is when the home would draw the card at that step. Nothing is
 *   recorded, so nothing goes stale, and the room's own moves (a focus pill, a
 *   narrative switch) keep it.
 *
 *   It names the step, never the element: a filter or a landing cannot make it
 *   false. It writes nothing; the visit is the room mount's (`noteRoomVisit`).
 *
 * Contract: a design note of 2026-10-30 (the card follows the person, draft 2).
 */

import { getState, subscribe } from '../core/state';
import { homeHash, navigate } from '../core/router';
import { DOTS, cardStep, type DotId } from '../core/guide';
import { noteRoomVisit, pathDots, pathShowing } from '../core/guide-path';
import { askFocusAfterHome } from './home-guide';

export type GuideRoom = 'timeline' | 'writing';

const ROOM_STEP: Record<GuideRoom, DotId> = { timeline: 'happened', writing: 'story' };

/** The step this room's bar speaks for in a world, or null when the bar is not drawn. */
export function roomBarStep(worldId: string | null | undefined, room: GuideRoom): DotId | null {
  if (!worldId) return null;
  const step = ROOM_STEP[room];
  // The card is read from the dots (the home that grows): the bar shows while this room's dot is lit
  // and the card stands at this step or the one after it, the step this room's line leads from.
  const entry = getState().registry.worlds.find(w => w.id === worldId);
  if (entry?.guide_step === 'done' || !pathShowing(worldId)) return null;
  const dots = pathDots(worldId);
  if (!dots[step]) return null;
  const at = cardStep(dots, entry?.guide_step);
  const i = DOTS.findIndex(d => d.id === step);
  return at === step || at === DOTS[i + 1]?.id ? step : null;
}

/**
 * The room seen, once its step is lit while it is mounted in a settled world: the mount's own write
 * gives up while the world is still loading, and a step lit inside the room comes after the mount
 * (the gate's G1). `noteRoomVisit` keeps its own checks and the two-tab merge.
 */
function seeRoom(worldId: string, room: GuideRoom): void {
  const s = getState();
  if (s.data.loading) return;
  const entry = s.registry.worlds.find(w => w.id === worldId);
  if (!entry || entry.guide_step === 'done' || (entry.guide_visited ?? []).includes(ROOM_STEP[room])) return;
  noteRoomVisit(room, worldId);
}

/** The step's words: its place in the path and its label. */
export function roomBarWords(step: DotId): string {
  const i = DOTS.findIndex(d => d.id === step);
  return `Step ${i + 1} of ${DOTS.length}, ${DOTS[i].label}`;
}

/** Prepend the bar to a room's host; it shows and hides itself. Returns its unmount. */
export function mountGuideRoomBar(host: HTMLElement, room: GuideRoom): () => void {
  const bar = document.createElement('nav');
  bar.className = 'atlas-guide-room-bar';
  bar.setAttribute('data-role', 'guide-room-bar');
  bar.setAttribute('data-room', room);
  bar.setAttribute('aria-label', 'Grow your world');
  bar.hidden = true;

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'atlas-btn-link atlas-guide-room-back';
  back.setAttribute('data-action', 'guide-room-back');
  back.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">chevron_left</span><span>Back to Grow your world</span>';
  const words = document.createElement('span');
  words.className = 'atlas-guide-room-step';
  // The line, then the way back: one row on a wide pane, stacked with a full-width button on a narrow one.
  bar.append(words, back);
  host.prepend(bar);

  let shownFor: string | null = null;
  const render = (): void => {
    const worldId = getState().active?.worldId ?? null;
    if (worldId) seeRoom(worldId, room);
    const step = roomBarStep(worldId, room);
    const key = step && worldId ? `${worldId}:${step}` : null;
    // The DOM moves only when the answer does: a tick never disturbs the room's focus.
    if (key === shownFor) return;
    shownFor = key;
    bar.hidden = !step;
    words.textContent = step ? roomBarWords(step) : '';
  };
  back.addEventListener('click', () => {
    const worldId = getState().active?.worldId;
    if (!worldId) return;
    askFocusAfterHome(worldId);
    navigate(homeHash(worldId));
  });

  render();
  const unsub = subscribe(render);
  return () => {
    unsub();
    bar.remove();
  };
}
