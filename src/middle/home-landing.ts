/**
 * The line a browser world's home shows while its files land behind it
 * (#865, contract L7'): how far, and to keep the tab open. It counts by
 * itself and goes when the landing does; a home redrawn meanwhile builds a
 * new one and the old one stops listening.
 */
import type { WorldRegistryEntry } from '../core/types';
import { isBrowserWorld } from '../core/browser-worlds';
import { liveLanding, type LandingProgress } from '../store/land-behind';

const words = (p: LandingProgress) => p.total > 0
  ? `Saving this world in this browser · ${p.done.toLocaleString()} of ${p.total.toLocaleString()} files. Keep this tab open until it finishes.`
  : 'Saving this world in this browser. Keep this tab open until it finishes.';

export function buildLandingLine(entry: WorldRegistryEntry | undefined): HTMLElement | null {
  const landing = entry && isBrowserWorld(entry) ? liveLanding(entry.folder.folder_name) : undefined;
  if (!landing || landing.state !== 'landing') return null;
  const line = document.createElement('p');
  line.className = 'atlas-home-landing';
  line.setAttribute('data-role', 'landing-line');
  line.setAttribute('role', 'status');
  line.textContent = words(landing.progress);
  const off = landing.onProgress(p => {
    if (!line.isConnected && line.dataset.shown) { off(); return; } // a redrawn home has its own
    line.dataset.shown = '1';
    line.textContent = words(p);
  });
  const done = () => { off(); line.remove(); };
  landing.landed.then(done, done);
  return line;
}
