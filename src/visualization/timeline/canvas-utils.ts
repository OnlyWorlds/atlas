/**
 * Shared canvas helpers for the chart renderers — the interactive room view
 * (timeline-view.ts) and the static share renderer (chart-static.ts, copied
 * into the show viewer). Extracted to kill the byte-identical duplication the
 * audit flagged (applyAlpha lived in two files, ensureIconFont in two more).
 */

/** Material Symbols font-ready guard — load once, callers redraw on resolve. */
let iconFontReady: Promise<void> | null = null;
export function ensureIconFont(): Promise<void> {
  if (iconFontReady) return iconFontReady;
  iconFontReady = (async () => {
    try {
      if ((document as any).fonts?.load) {
        await (document as any).fonts.load('16px "Material Symbols Outlined"', 'category');
        await (document as any).fonts.ready;
      }
    } catch {
      // ignore — glyphs simply stay blank until the font is available
    }
  })();
  return iconFontReady;
}

/** Hex (`#rgb` or `#rrggbb`) → `rgba()` string; returns the input unchanged if not hex. */
export function applyAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith('#')) return hex;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
