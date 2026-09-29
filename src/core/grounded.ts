/**
 * Is Atlas SET UP? (S365) It used to mean "has a home folder" (the atlas
 * root), and every first-launch surface asked `!atlasRoot`. Since a world
 * folder can be opened in place on a first visit, a user can have worlds and
 * no home folder; they must then get the sidebar and the world list, not the
 * landing splash again. Grounded = a home folder, or any world of the user's
 * own (the tour's sandbox does not count).
 */

import { getState } from './state';

export function isAtlasGrounded(state = getState()): boolean {
  return !!state.atlasRoot || state.registry.worlds.some(w => !w.demo);
}
