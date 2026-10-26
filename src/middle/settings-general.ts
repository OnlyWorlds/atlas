/**
 * Settings → General tab. Tool-wide preferences that belong to no
 * feature area: appearance (the light/dark theme) and the about block.
 * First tab in the ATLAS group — the "where do I look first" surface; the
 * future public-changelog link lands here too.
 */

import { ToastManager } from '../ui/toast-manager';
import { getTheme, setTheme } from '../core/theme';
import pkg from '../../package.json';
import { getState, patchSlice } from '../core/state';
import { saveRegistry } from '../registry/registry';
import { hasFolderMode } from '../core/capabilities';

export function renderGeneralTab(): string {
  const theme = getTheme();
  return `
    <section class="atlas-settings-section">
      <h3>Appearance</h3>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Theme</label>
        <div class="atlas-settings-radio-row">
          <label class="atlas-settings-radio"><input type="radio" name="app-theme" value="dark" ${theme === 'dark' ? 'checked' : ''}> Dark</label>
          <label class="atlas-settings-radio"><input type="radio" name="app-theme" value="light" ${theme === 'light' ? 'checked' : ''}> Light</label>
        </div>
      </div>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="worlds-add-icons" ${getState().registry.worlds_add_icons === false ? '' : 'checked'} />
        <span>Show the row of add-world icons in the Worlds list (the "Add a world" button stays either way)</span>
      </label>
    </section>
    <section class="atlas-settings-section">
      <h3>About</h3>
      <p class="atlas-settings-hint">Atlas v${pkg.version}: the OnlyWorlds world browser and editor. ${hasFolderMode() ? 'Your worlds live as files, in a folder on your drive or in this browser' : 'Your worlds live as files in this browser'}; syncing with onlyworlds.com is optional.</p>
      <div class="atlas-settings-row">
        <a class="atlas-settings-link" href="https://onlyworlds.com" target="_blank" rel="noopener">onlyworlds.com</a>
        <a class="atlas-settings-link" href="https://onlyworlds.github.io" target="_blank" rel="noopener">Documentation</a>
      </div>
    </section>
    <section class="atlas-settings-section" data-role="help-feedback">
      <h3>Help and feedback</h3>
      <div class="atlas-settings-row">
        <a class="atlas-settings-link" data-link="feedback" href="https://onlyworlds.com/feedback?category=atlas" target="_blank" rel="noopener">Send feedback</a>
        <a class="atlas-settings-link" data-link="discord" href="https://discord.gg/twCjqvVBwb" target="_blank" rel="noopener">Discord</a>
        <a class="atlas-settings-link" data-link="changelog" href="changelog.html" target="_blank" rel="noopener">What's new</a>
      </div>
      <p class="atlas-settings-hint">Email: <a class="atlas-settings-link atlas-settings-email" data-link="email" href="mailto:info@onlyworlds.com">info@onlyworlds.com</a></p>
    </section>
  `;
}

export function wireGeneralTab(toasts: ToastManager): void {
  document.querySelector<HTMLInputElement>('.atlas-settings input[name="worlds-add-icons"]')
    ?.addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      const next = { ...getState().registry, worlds_add_icons: on ? undefined : false };
      saveRegistry(next);
      patchSlice('registry', next);
      toasts.info(on ? 'Add-world icons shown' : 'Add-world icons hidden');
    });
  // The app theme — device-local; applies instantly via the data-theme
  // attribute, no re-render needed.
  document.querySelectorAll<HTMLInputElement>('.atlas-settings input[name="app-theme"]')
    .forEach((inp) => {
      inp.addEventListener('change', () => {
        if (!inp.checked) return;
        setTheme(inp.value === 'light' ? 'light' : 'dark');
        toasts.info(`Theme: ${inp.value}`);
      });
    });
}
