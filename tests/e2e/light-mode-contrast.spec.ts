/**
 * Light-mode contrast guard (S323).
 *
 * Light mode has now shipped three separate instances of one defect class: a
 * foreground and a background that answer to DIFFERENT authorities. Either a
 * themed background pairs with a literal `#fff` foreground (the map's pin
 * labels were white-on-white on every map), or a literal dark background
 * pairs with a themed foreground (the share room's pin modal was dark ink on
 * near-black, including its close button). Both look perfect in dark mode,
 * which is why they keep shipping.
 *
 * This spec measures the OUTCOME — the actual contrast ratio a user gets —
 * for the surfaces that have failed or are built the same way. It works by
 * injecting a probe with the real class chain into the real stylesheet under
 * the light theme, so it exercises CSS token resolution, which is precisely
 * where the defect lives. It deliberately does NOT assert which token any
 * rule uses: that would restate the CSS instead of testing it.
 *
 * A new floating surface belongs here the day it is written.
 */

import { test, expect, Page } from '@playwright/test';

/** WCAG relative luminance of a computed `rgb()`/`rgba()` string. */
const LUMINANCE_FN = `(c) => {
  const m = c.match(/[\\d.]+/g);
  if (!m) return null;
  const chan = [+m[0], +m[1], +m[2]].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}`;

type Probe = {
  name: string;
  /** Outer-to-inner class chain; the LAST element is measured. */
  chain: string[];
  /** Minimum acceptable contrast ratio. 3:1 is the large/UI-chrome floor. */
  min?: number;
};

const PROBES: Probe[] = [
  // The map's own chrome: floats over the user's artwork, holds a dark chip
  // in both themes. This is the pair that shipped white-on-white.
  { name: 'map pin label', chain: ['atlas-map-pane', 'leaflet-2d-pin-label', 'pin-label-text'] },
  { name: 'map pin tooltip', chain: ['atlas-pin-tooltip'] },
  { name: 'map pin tooltip name', chain: ['atlas-pin-tooltip', 'atlas-pin-tooltip-name'] },
  // A deliberate dark island inside a light page: every descendant must be
  // re-pinned, not just the triplets.
  { name: 'share pin modal', chain: ['atlas-share-pin-modal'] },
  { name: 'share pin modal close', chain: ['atlas-share-pin-modal', 'atlas-share-pin-modal-close'] },
  { name: 'share pin modal desc', chain: ['atlas-share-pin-modal', 'atlas-share-pin-modal-desc'] },
  // Ordinary light-page chrome that carried literal white foregrounds.
  { name: 'unsupported heading', chain: ['atlas-unsupported', 'h1:atlas-unsupported-h1'] },
  { name: 'demo intro heading', chain: ['atlas-demo-overlay', 'atlas-demo-intro', 'h1:demo-h1'] },
  // Modal error box (S368): a literal pale-pink foreground on a pink wash over
  // the light theme's white panel. Body text, so the 4.5:1 floor.
  { name: 'modal error', chain: ['atlas-modal-panel', 'atlas-modal-error'], min: 4.5 },
];

/**
 * Contrast of the probe's own text against the nearest ancestor (including
 * itself) that actually paints a background. Transparent backgrounds are
 * skipped exactly the way the eye does.
 */
async function contrastOf(page: Page, probe: Probe): Promise<number> {
  return await page.evaluate(({ chain, lumSrc }) => {
    const luminance = eval(lumSrc) as (c: string) => number | null;
    let host: HTMLElement = document.body;
    const built: HTMLElement[] = [];
    for (const step of chain) {
      const isTag = step.startsWith('h1:');
      const el = document.createElement(isTag ? 'h1' : 'div');
      el.className = isTag ? step.slice(3) : step;
      el.textContent = 'Probe text';
      host.appendChild(el);
      built.push(el);
      host = el;
    }
    const target = built[built.length - 1];
    const fg = getComputedStyle(target).color;

    // Composite the background stack. A translucent layer must be blended
    // over what is behind it before it can be compared to anything: the close
    // button's own `rgba(ink, 0.06)` wash reads as near-white unblended, which
    // made an earlier version of this probe report 1.00:1 on a control that
    // is perfectly legible. A false failure costs as much as a false green.
    const layers: number[][] = [];
    let node: HTMLElement | null = target;
    while (node) {
      const c = getComputedStyle(node).backgroundColor;
      const m = c.match(/[\d.]+/g);
      if (m) {
        const a = m.length === 4 ? +m[3] : 1;
        if (a > 0) {
          layers.push([+m[0], +m[1], +m[2], a]);
          if (a >= 1) break; // fully opaque: nothing behind it shows through
        }
      }
      node = node.parentElement;
    }
    built[0].remove();

    if (!layers.length) return -1;
    // Back-to-front: start at the deepest opaque layer and paint forward.
    let composite = layers[layers.length - 1].slice(0, 3);
    for (let i = layers.length - 2; i >= 0; i--) {
      const [r, g, b, a] = layers[i];
      composite = [
        r * a + composite[0] * (1 - a),
        g * a + composite[1] * (1 - a),
        b * a + composite[2] * (1 - a),
      ];
    }
    const bg = `rgb(${composite[0]}, ${composite[1]}, ${composite[2]})`;

    const lf = luminance(fg);
    const lb = luminance(bg);
    if (lf === null || lb === null) return -1;
    const hi = Math.max(lf, lb);
    const lo = Math.min(lf, lb);
    return (hi + 0.05) / (lo + 0.05);
  }, { chain: probe.chain, lumSrc: LUMINANCE_FN });
}

test('floating chrome stays readable in light mode', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(() => {
    localStorage.setItem('atlas_theme', 'light');
    document.documentElement.setAttribute('data-theme', 'light');
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  const failures: string[] = [];
  for (const probe of PROBES) {
    const ratio = await contrastOf(page, probe);
    const min = probe.min ?? 3;
    if (!(ratio >= min)) failures.push(`${probe.name}: ${ratio.toFixed(2)}:1 (need ${min}:1)`);
  }
  expect(failures, `unreadable in LIGHT mode:\n${failures.join('\n')}`).toEqual([]);
});

test('the same chrome is still readable in dark mode', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(() => {
    localStorage.removeItem('atlas_theme');
    document.documentElement.removeAttribute('data-theme');
  });

  const failures: string[] = [];
  for (const probe of PROBES) {
    const ratio = await contrastOf(page, probe);
    const min = probe.min ?? 3;
    if (!(ratio >= min)) failures.push(`${probe.name}: ${ratio.toFixed(2)}:1 (need ${min}:1)`);
  }
  expect(failures, `unreadable in DARK mode:\n${failures.join('\n')}`).toEqual([]);
});
