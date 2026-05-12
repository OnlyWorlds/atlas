/**
 * Atlas — folder-first OnlyWorlds world browser and editor.
 *
 * This is a placeholder boot. Real shell wiring comes once DESIGN.md is locked
 * and the SyncEngine + FolderStore foundations are in place.
 */

function boot(): void {
  const root = document.getElementById('app');
  if (!root) {
    console.error('[atlas] #app element missing');
    return;
  }
  root.innerHTML = `
    <div class="atlas-placeholder">
      <h1>atlas</h1>
      <p>folder-first rebuild in progress.</p>
      <p class="hint">design doc &amp; sync engine are being wired up. nothing to do here yet.</p>
    </div>
  `;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
