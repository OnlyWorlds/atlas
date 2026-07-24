/**
 * Settings → General tab (S315). Tool-wide preferences that belong to no
 * feature area: appearance (the light/dark theme) and the about block.
 * First tab in the ATLAS group — the "where do I look first" surface; the
 * future public-changelog link lands here too.
 */

import { ToastManager } from '../ui/toast-manager';
import { getTheme, setTheme } from '../core/theme';
import pkg from '../../package.json';

export function renderGeneralTab(): string {
  const theme = getTheme();
  return `
    <section class="atlas-settings-section">
      <h3>Appearance</h3>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Theme</label>
        <div class="atlas-settings-radio-row">
          <label class="atlas-settings-radio"><input type="radio" name="app-theme" value="dark" ${theme === 'dark' ? 'checked' : ''}> dark</label>
          <label class="atlas-settings-radio"><input type="radio" name="app-theme" value="light" ${theme === 'light' ? 'checked' : ''}> light</label>
        </div>
      </div>
    </section>
    <section class="atlas-settings-section">
      <h3>About</h3>
      <p class="atlas-settings-hint">Atlas v${pkg.version} — the OnlyWorlds world browser and editor. Your worlds live as files on your own disk; syncing with onlyworlds.com is optional.</p>
      <div class="atlas-settings-row">
        <a class="atlas-settings-link" href="changelog.html" target="_blank" rel="noopener">what's new</a>
        <a class="atlas-settings-link" href="https://onlyworlds.com" target="_blank" rel="noopener">onlyworlds.com</a>
        <a class="atlas-settings-link" href="https://onlyworlds.github.io" target="_blank" rel="noopener">documentation</a>
        <a class="atlas-settings-link" href="https://github.com/OnlyWorlds/feedback" target="_blank" rel="noopener">report an issue</a>
      </div>
    </section>
  `;
}

export function wireGeneralTab(toasts: ToastManager): void {
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
