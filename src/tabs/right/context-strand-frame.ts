/**
 * The strand's frame beside its story (Atlas's contract S8): in the writing room, while the open
 * Narrative is the world's strand's story, the right pane's writing context leads with one block,
 * "This story is the world's strand", with Hero, Happening, Where it happened and Where the hero is
 * now, each a chip that opens its element. An empty one offers "Pick on Home" (the Strand tab) where
 * this person may fill it, and says "Empty" otherwise, or while the path shows (Home draws no tab
 * then: G5). The context tab redraws on the mark (`strandMarkKey` among its inputs, G4).
 */

import type { Element } from '../../core/types';
import { getState } from '../../core/state';
import { ELEMENT_ICONS, ELEMENT_TYPE_COLORS } from '../../core/constants';
import { openElementTarget } from '../../core/element-room';
import { pathShowing } from '../../core/guide-path';
import { hiddenRowWord } from '../../core/hidden-mark';
import { maySetSlot, SLOT_TYPE, type StrandSlot } from '../../core/strand';
import { openStrandTab, strandContext, SLOT_WORD } from '../../middle/home-strand';

const FRAME_SLOTS: readonly StrandSlot[] = ['character', 'event', 'location', 'now'];

/** The frame for `narrative`, or null when it is not the strand's story. */
export function buildStrandFrame(narrative: Element): HTMLElement | null {
  const worldId = getState().active?.worldId;
  // The shared reading: constant cost, no walk of the world per draw (the code gate's C7).
  const c = worldId ? strandContext(worldId) : null;
  if (!worldId || !c) return null;
  const { strand, entry, byId, meta } = c;
  if (strand.narrative?.id !== narrative.id) return null;
  const path = pathShowing(worldId);

  const block = document.createElement('section');
  block.className = 'atlas-context-strand';
  block.dataset.role = 'strand-frame';
  const title = document.createElement('h3');
  title.className = 'atlas-context-strand-title';
  title.textContent = "This story is the world's strand";
  block.appendChild(title);
  const list = document.createElement('ul');
  list.className = 'atlas-context-strand-slots';
  for (const slot of FRAME_SLOTS) {
    const type = SLOT_TYPE[slot];
    const li = document.createElement('li');
    li.className = 'atlas-context-strand-slot';
    li.dataset.slot = slot;
    li.style.setProperty('--type-color', ELEMENT_TYPE_COLORS[type]);
    const word = document.createElement('span');
    word.className = 'atlas-context-strand-word';
    word.textContent = SLOT_WORD[slot];
    li.appendChild(word);
    const filled = strand[slot];
    const el = filled ? byId.get(filled.id) : undefined;
    if (filled && el) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'atlas-context-strand-chip';
      chip.dataset.action = 'strand-open';
      chip.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true"></span><span class="atlas-context-strand-name"></span>`;
      chip.querySelector('.material-symbols-outlined')!.textContent = ELEMENT_ICONS[type] ?? 'category';
      chip.querySelector('.atlas-context-strand-name')!.textContent = filled.name.trim() || 'Unnamed';
      chip.addEventListener('click', () => openElementTarget(el, worldId));
      li.appendChild(chip);
      // Hidden here: others read this slot empty (G23, the code gate's C10).
      const hidden = hiddenRowWord(el, entry?.state);
      if (hidden) li.insertAdjacentHTML('beforeend', hidden);
    } else if (!path && maySetSlot(slot, entry, meta, strand, byId)) {
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'atlas-btn-link atlas-context-strand-pick';
      pick.dataset.action = 'strand-pick-on-home';
      pick.textContent = 'Pick on Home';
      pick.title = 'Opens Home on the Strand tab';
      pick.addEventListener('click', () => openStrandTab(worldId));
      li.appendChild(pick);
    } else {
      const empty = document.createElement('span');
      empty.className = 'atlas-context-strand-empty';
      empty.textContent = 'Empty';
      li.appendChild(empty);
    }
    list.appendChild(li);
  }
  block.appendChild(list);
  return block;
}
