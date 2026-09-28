/**
 * Truncated text shows its whole text on hover (S360, lane A A12). About forty
 * ellipsis rules cut names in lists, tabs and headers with no way to read the
 * rest. One delegated listener gives any clipped element a native tooltip the
 * first time the pointer rests on it; an element with its own title keeps it.
 */
export function installTruncationTitles(): void {
  document.addEventListener('mouseover', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement) || t.title) return;
    if (t.scrollWidth <= t.clientWidth) return;
    if (getComputedStyle(t).textOverflow !== 'ellipsis') return;
    const text = t.textContent?.trim();
    if (text) t.title = text;
  }, { passive: true });
}
