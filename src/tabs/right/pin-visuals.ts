/**
 * Pin visuals — canvas-rendered Material Symbol icons on colored circle backgrounds.
 *
 * Generates a data URL per (type, color) once, then caches forever. The Material
 * Symbols Outlined font is loaded via index.html; we wait for it before first render.
 */

import type { ElementType } from '../../core/types';
import { ELEMENT_ICONS } from '../../core/constants';

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

export function pinVisualFor(type: string): PinVisual {
  const color = (CATEGORY as Record<string, string>)[type] ?? '#22d3ee';
  const iconName = (ELEMENT_ICONS as Record<string, string>)[type] ?? 'place';
  const key = `${iconName}|${color}`;

  const cached = cache.get(key);
  if (cached) return { color, iconUrl: cached };

  // Synchronous fallback (circle-only) while the async high-quality version is built.
  const fallback = svgCircleDataUrl(color);

  // Kick off async render once, then bulk-refresh pin visuals when ready.
  ensureFontLoaded().then(() => {
    const url = renderIcon(iconName, color);
    cache.set(key, url);
    notifyReady();
  });

  // Serve fallback this tick; callers will get the upgraded version next refresh.
  cache.set(key, fallback);
  return { color, iconUrl: fallback };
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

function renderIcon(iconName: string, color: string): string {
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return svgCircleDataUrl(color);

  // Background circle
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Material Symbol glyph
  ctx.font = '22px "Material Symbols Outlined"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(iconName, size / 2, size / 2 + 1);

  return canvas.toDataURL('image/png');
}

function svgCircleDataUrl(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="${color}" stroke="#111" stroke-width="2"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
