/**
 * The one sentence the sidecar rule says (S365, `story-sidecar.ts`): a scene
 * or knowledge entry opened with text another program wrote while Atlas was
 * closed. Once per element per session: the stale copy stays on disk until
 * the next save, so the rule fires on every open until then, and a notice on
 * every open would be noise.
 */

import { toastManager } from '../ui/toast-manager';

const noted = new Set<string>();

export function noteOpenedFromStory(id: string, kind: 'scene' | 'entry'): void {
  if (noted.has(id)) return;
  noted.add(id);
  toastManager.info(`This ${kind === 'scene' ? 'scene' : 'knowledge entry'} changed outside Atlas. Showing the new text.`);
}
