/**
 * The Sign in with OnlyWorlds button (contract R1, R2, R5): in Settings'
 * signed-out block and above the sign-in fields of Make online and New world
 * on OnlyWorlds. Offered only on the registered origin. A press saves what is
 * pending, parks the route, the open door and what waited for a sign-in, and
 * sends the tab to onlyworlds.com.
 */

import { canSignInWithOnlyWorlds, beginOnlyWorldsSignIn, dropStaleResume, type SignInDoor, type SignInResume } from '../sync/onlyworlds-sign-in';
import { flushBeforeUnloading } from '../core/reload-offer';
import { problemFor } from '../core/problems';
import type { ToastManager } from './toast-manager';
import { devV2Base } from '../sync/dev-api-base';
import { isTourFlagActive } from '../tour/tour-flag';

const LABEL = 'Sign in with OnlyWorlds';

/**
 * The button and the line under it, or '' where the round trip cannot come
 * back here: off the registered origin, with the dev API override set (the
 * rest of Atlas would talk to another keel), and during the tour.
 */
export function onlyWorldsSignInButtonHtml(orLine: string): string {
  if (!canSignInWithOnlyWorlds() || devV2Base() || isTourFlagActive()) return '';
  return `
    <div class="atlas-signin-ow" data-role="sign-in-onlyworlds">
      <button type="button" class="atlas-btn-primary" data-action="sign-in-onlyworlds">${LABEL}</button>
      <p class="atlas-settings-hint atlas-signin-ow-or">${orLine}</p>
    </div>`;
}

/** Wire the button inside `root`, if it is there. */
export function wireOnlyWorldsSignIn(root: ParentNode, toasts: ToastManager, door?: SignInDoor): void {
  const btn = root.querySelector<HTMLButtonElement>('[data-action="sign-in-onlyworlds"]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    // A form signing in with the password, or making the world, holds its
    // inputs disabled: leaving the page then would cut it off (the gate's G7).
    if (btn.closest('[data-role="sign-in-fields"]')?.querySelector('input:disabled')) return;
    btn.disabled = true;
    btn.textContent = 'Opening OnlyWorlds…';
    void (async () => {
      try {
        const [{ openHeldForSignIn }, { joinHeldForSignIn }] = await Promise.all([
          import('../setup/open-door'), import('../setup/join-door'),
        ]);
        const resume: SignInResume = { hash: location.hash || '#/' };
        if (door) resume.door = door;
        const open = openHeldForSignIn();
        if (open) resume.open = open;
        const join = joinHeldForSignIn();
        if (join) resume.join = join;
        await flushBeforeUnloading();
        // Back from onlyworlds.com can bring this very page back from the
        // browser's cache: the button works again and the parked resume goes.
        window.addEventListener('pageshow', (e) => {
          if (!e.persisted) return;
          dropStaleResume();
          btn.disabled = false;
          btn.textContent = LABEL;
        }, { once: true });
        await beginOnlyWorldsSignIn(resume);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = LABEL;
        toasts.error(problemFor(err, { inline: true, doing: 'signing in' }).sentence);
      }
    })();
  });
}
