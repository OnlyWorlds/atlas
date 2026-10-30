/**
 * The + square's make (the home that grows): a name typed in place, Enter
 * keeps it. The same write the create dialog makes (the store's create, the
 * list refreshed, a push asked for a synced world) and the same gesture
 * reported to the guide; it never navigates, since the square stays on Home.
 */

import type { Element, ElementType } from '../core/types';
import { getState, patchSlice } from '../core/state';
import { getActiveStore } from '../core/active-store';
import { requestPushIfLinked } from '../sync/sync-attach';
import { TEMPORAL_TYPE_FIELDS } from '../visualization/timeline/temporal-fields';
import { reportGesture } from './guide-note';
import { worldIsViewOnly } from '../core/view-only';

export interface Made { id: string; type: ElementType }

/** Make an element of `type` named `name`; an Event takes `year` in its start field when given. Null when no world is open. */
export async function makeFromSquare(type: ElementType, name: string, year?: number | null): Promise<Made | null> {
  const store = getActiveStore();
  // A view-only world draws no + square; this is the write's own refusal too.
  if (!store || !getState().active || worldIsViewOnly()) return null;
  const start = TEMPORAL_TYPE_FIELDS[type]?.start;
  const dated = start && typeof year === 'number' && Number.isFinite(year) ? { [start]: year } : {};
  const el = await store.createElement(type, { ...dated, name } as Partial<Element>);
  patchSlice('data', { elements: await store.listElements() });
  requestPushIfLinked();
  reportGesture({ kind: 'created', id: el.id });
  return { id: el.id, type };
}
