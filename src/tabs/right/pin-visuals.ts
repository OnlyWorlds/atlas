/**
 * Pin visuals — canvas-rendered Material Symbol icons on colored circle backgrounds.
 *
 * Generates a data URL per (type, color, tint) once, then caches forever. The
 * Material Symbols Outlined font is loaded via index.html; we wait for it
 * before first render.
 *
 * `tint` is per-map preference (DESIGN_MAPS.md §11): `type-color` uses the
 * category palette below; `accent` collapses all pins to atlas cyan; `muted`
 * collapses to neutral grey. Cache key includes tint so multiple maps with
 * different tints coexist without thrashing.
 */

import type { ElementType } from '../../core/types';
import { ELEMENT_ICONS } from '../../core/constants';
import type { PinTint, PinStyle } from '../../core/map-view-prefs';

const ACCENT_COLOR = '#22d3ee';
const MUTED_COLOR = '#6b7280';

const CATEGORY: Record<ElementType, string> = {
  // Agents — warm
  character: '#f97316',
  creature: '#ea580c',
  species: '#c2410c',
  family: '#fbbf24',
  collective: '#f59e0b',
  institution: '#d97706',

  // World — earth
  location: '#84cc16',
  object: '#a3a3a3',
  construct: '#78716c',

  // Abstract — cool
  ability: '#60a5fa',
  trait: '#3b82f6',
  title: '#8b5cf6',
  language: '#a78bfa',
  law: '#6366f1',

  // Temporal — pink/purple
  event: '#ec4899',
  narrative: '#db2777',
  phenomenon: '#be185d',
  relation: '#f472b6',

  // Spatial — cyan
  map: '#22d3ee',
  pin: '#06b6d4',
  marker: '#0891b2',
  zone: '#0e7490',
};

const cache = new Map<string, string>();
let fontReady: Promise<void> | null = null;

export interface PinVisual {
  color: string;
  iconUrl: string;
}

/**
 * Get a pin's visual. When `hasMapBadge` is true, a small map glyph is
 * baked into the bottom-right corner of the icon — telegraphs "this pin's
 * element has its own map(s); click-through is available" (DESIGN_MAPS.md §8).
 *
 * `tint` resolves the disc color:
 *   - 'type-color' (default): per-element-type palette (CATEGORY)
 *   - 'accent':                atlas cyan for all pins
 *   - 'muted':                 neutral grey for all pins
 *
 * `style` selects the shape variant:
 *   - 'icon':       full filled disc + centered icon glyph (default, original look)
 *   - 'round-icon': ring outline + smaller centered glyph (lighter visual weight,
 *                   icon more prominent against transparent center)
 *   - 'pin-shape':  classic teardrop pin head with glyph inside, pointing down
 *
 * Badge + tint + style are baked into the cache key so every combination
 * coexists cheaply at runtime.
 */
export function pinVisualFor(
  type: string,
  hasMapBadge: boolean = false,
  tint: PinTint = 'type-color',
  style: PinStyle = 'icon',
): PinVisual {
  const color = resolveColor(type, tint);
  const iconName = (ELEMENT_ICONS as Record<string, string>)[type] ?? 'place';
  const badgeSuffix = hasMapBadge ? '|mapbadge' : '';
  const styleSuffix = style === 'icon' ? '' : `|${style}`;
  const key = `${iconName}|${color}${badgeSuffix}${styleSuffix}`;

  const cached = cache.get(key);
  if (cached) return { color, iconUrl: cached };

  // Synchronous fallback (circle-only) while the async high-quality version is built.
  const fallback = svgCircleDataUrl(color);

  // Kick off async render once, then bulk-refresh pin visuals when ready.
  ensureFontLoaded().then(() => {
    const url = renderIcon(iconName, color, hasMapBadge, style);
    cache.set(key, url);
    notifyReady();
  });

  // Serve fallback this tick; callers will get the upgraded version next refresh.
  cache.set(key, fallback);
  return { color, iconUrl: fallback };
}

function resolveColor(type: string, tint: PinTint): string {
  if (tint === 'accent') return ACCENT_COLOR;
  if (tint === 'muted') return MUTED_COLOR;
  return (CATEGORY as Record<string, string>)[type] ?? ACCENT_COLOR;
}

// ---- Ready notification for live pin upgrades ----

type ReadyListener = () => void;
const readyListeners = new Set<ReadyListener>();

export function onPinVisualsReady(listener: ReadyListener): () => void {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

function notifyReady(): void {
  readyListeners.forEach(l => {
    try { l(); } catch (err) { console.error('[pin-visuals] listener error:', err); }
  });
}

// ---- Rendering ----

function ensureFontLoaded(): Promise<void> {
  if (fontReady) return fontReady;
  fontReady = (async () => {
    try {
      if ((document as any).fonts?.load) {
        await (document as any).fonts.load('24px "Material Symbols Outlined"', '\ue55f');
        await (document as any).fonts.ready;
      }
    } catch {
      // Best-effort — fallback icons still render.
    }
  })();
  return fontReady;
}

function renderIcon(iconName: string, color: string, hasMapBadge: boolean = false, style: PinStyle = 'icon'): string {
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return svgCircleDataUrl(color);

  if (style === 'pin-shape') {
    drawPinShape(ctx, size, color, iconName);
  } else if (style === 'round-icon') {
    drawRoundIcon(ctx, size, color, iconName);
  } else {
    drawFilledIcon(ctx, size, color, iconName);
  }

  if (hasMapBadge) {
    // Map-having badge — small cyan circle with a map glyph, bottom-right
    // corner of the pin. Telegraphs "this pin's element has maps; you can
    // drill in via the element-detail top bar." (DESIGN_MAPS.md §8.)
    const bx = size - 9;
    const by = size - 9;
    const br = 7;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = '#22d3ee';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.font = '10px "Material Symbols Outlined"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0a0a0a';
    ctx.fillText('map', bx, by + 1);
  }

  return canvas.toDataURL('image/png');
}

/**
 * Default style — JUST the icon glyph in the tint color, no background disc.
 * A wide DARK halo is painted UNDER the glyph for legibility against any
 * map background (works for both bright + dark map art). Captain feedback
 * session 219 wave 3: "make the border around the icon dark, not white."
 */
function drawFilledIcon(ctx: CanvasRenderingContext2D, size: number, color: string, iconName: string): void {
  const cx = size / 2;
  const cy = size / 2 + 1;

  ctx.font = '28px "Material Symbols Outlined"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  // Wide dark halo around the glyph — gives the icon a solid silhouette
  // against any map background. ~3.5px stroke at 90% black reads as a
  // crisp outline without dominating the glyph color.
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
  ctx.strokeText(iconName, cx, cy);

  // Glyph fill in the tint color.
  ctx.fillStyle = color;
  ctx.fillText(iconName, cx, cy);
}

/**
 * Ring outline + colored glyph in the center. Lighter visual weight — the
 * map background reads through the center, making the icon (not the disc)
 * the primary visual element. Good for dense maps.
 */
function drawRoundIcon(ctx: CanvasRenderingContext2D, size: number, color: string, iconName: string): void {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 3;

  // Faint translucent fill so it reads as a marker against the map, but
  // doesn't dominate.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fill();

  // Bright ring outline in the tint color.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Icon in the tint color, slightly larger to fill the visual hole.
  ctx.font = '24px "Material Symbols Outlined"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(iconName, cx, cy + 1);
}

/**
 * Classic teardrop pin shape — round head with a tapered point below.
 * The icon glyph sits inside the round head. The point is drawn so the
 * VISUAL tip lands near the bottom of the canvas, but the iconAnchor
 * stays centered (manager-level concern) — slight offset trade-off for
 * v1 in exchange for caller-side simplicity.
 */
function drawPinShape(ctx: CanvasRenderingContext2D, size: number, color: string, iconName: string): void {
  const cx = size / 2;
  const headCy = size * 0.36;
  const headR = size * 0.32;
  const tipY = size - 2;

  // Build the teardrop path: circular head + two tangent lines meeting at a point.
  // Compute the tangent angle from the head center to the tip.
  const dy = tipY - headCy;
  const tangentAngleFromVertical = Math.acos(headR / Math.hypot(headR, dy));
  // Symmetric left and right tangent points on the head circle.
  const leftAngle = Math.PI - Math.PI / 2 + tangentAngleFromVertical; // measured from +x axis
  const rightAngle = Math.PI / 2 - tangentAngleFromVertical;
  const leftX = cx + headR * Math.cos(leftAngle);
  const leftY = headCy + headR * Math.sin(leftAngle);
  const rightX = cx + headR * Math.cos(rightAngle);
  const rightY = headCy + headR * Math.sin(rightAngle);

  ctx.beginPath();
  ctx.moveTo(leftX, leftY);
  // Arc from left tangent over the top to the right tangent.
  ctx.arc(cx, headCy, headR, leftAngle, rightAngle, true);
  // Line down to the tip.
  ctx.lineTo(cx, tipY);
  ctx.closePath();

  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Dark glyph inside the round head — readable across the full type-color
  // palette (many of which are light: yellow, lime, pink). White-on-color
  // disappeared against the lighter tints (Captain smoke session 219).
  ctx.font = '18px "Material Symbols Outlined"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#0a0a0a';
  ctx.fillText(iconName, cx, headCy + 1);
}

function svgCircleDataUrl(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="${color}" stroke="#111" stroke-width="2"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
