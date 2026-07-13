/**
 * LoadingOverlay — a minimal blocking overlay for multi-second flows that
 * would otherwise freeze silently (account-mode world open, S260 Captain
 * smoke finding). Glass panel, spinner, title + live status line.
 *
 * Blocking is deliberate: the flows that show this (mint + initial download)
 * already serialize on the activation chain — the overlay makes the "don't
 * click other worlds right now" contract visible instead of mysterious.
 *
 * Usage:
 *   const overlay = showLoadingOverlay('Opening Emberwatch');
 *   overlay.update('Downloading 47 of 412 elements…');
 *   overlay.close();  // always in finally
 */

export interface LoadingOverlayHandle {
  update(status: string): void;
  close(): void;
}

export function showLoadingOverlay(title: string): LoadingOverlayHandle {
  const overlay = document.createElement('div');
  overlay.className = 'atlas-loading-overlay';
  overlay.setAttribute('data-role', 'loading-overlay');
  overlay.innerHTML = `
    <div class="atlas-loading-panel">
      <span class="atlas-loading-spinner"></span>
      <div class="atlas-loading-title"></div>
      <div class="atlas-loading-status" data-role="loading-status"></div>
    </div>
  `;
  overlay.querySelector('.atlas-loading-title')!.textContent = title;
  document.body.appendChild(overlay);
  // Force reflow so the CSS fade-in transition runs.
  overlay.offsetHeight;
  overlay.classList.add('visible');

  const statusEl = overlay.querySelector<HTMLElement>('[data-role="loading-status"]')!;
  let closed = false;
  return {
    update(status: string): void {
      if (!closed) statusEl.textContent = status;
    },
    close(): void {
      if (closed) return;
      closed = true;
      overlay.classList.remove('visible');
      // Match the CSS transition; remove after it completes.
      setTimeout(() => overlay.remove(), 220);
    },
  };
}
