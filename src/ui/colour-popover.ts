/**
 * The atlas colour popover (S356): a small anchored picker that replaces the
 * browser's native colour dialog where a colour is a WORLD decision (the
 * zone panel's kind swatch). The native dialog commits on every drag with
 * no confirm, cannot be styled, and painted a stray white box under the
 * swatch; Captain asked for a confirm button and a look that belongs.
 *
 * Presets (the four-family palette plus a cartographer's row: water,
 * forest, road, sand, stone, danger) commit on click. The hex field commits
 * on Apply or Enter. Escape, outside click and Cancel dismiss without a
 * write. One popover at a time.
 */

export interface ColourPopoverOpts {
  anchor: HTMLElement;
  current: string;
  onApply: (hex: string) => void;
  /** Optional: fires as the hex field changes, for live preview. */
  onPreview?: (hex: string) => void;
  onCancel?: () => void;
}

const PRESETS: Array<{ hex: string; name: string }> = [
  { hex: '#22d3ee', name: 'atlas cyan' },
  { hex: '#3b82f6', name: 'water' },
  { hex: '#1d4ed8', name: 'deep water' },
  { hex: '#22c55e', name: 'forest' },
  { hex: '#84cc16', name: 'meadow' },
  { hex: '#f59e0b', name: 'sand' },
  { hex: '#f97316', name: 'ember' },
  { hex: '#ef4444', name: 'danger' },
  { hex: '#ec4899', name: 'rose' },
  { hex: '#a855f7', name: 'violet' },
  { hex: '#a3a3a3', name: 'road' },
  { hex: '#737373', name: 'stone' },
  { hex: '#e5e5e5', name: 'chalk' },
  { hex: '#78350f', name: 'earth' },
];

let openPopover: HTMLElement | null = null;
let closeOpen: (() => void) | null = null;

export function closeColourPopover(): void {
  closeOpen?.();
}

function isHex(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v);
}

export function openColourPopover(opts: ColourPopoverOpts): void {
  closeColourPopover();
  const { anchor } = opts;
  // `current` can arrive from styles.json via a decoded data-color attribute,
  // and it is interpolated into style and value below: hex or the default
  // (S360). The opts object is rebound so the handlers see the same value.
  opts = { ...opts, current: isHex(opts.current) ? opts.current : '#22d3ee' };
  const pop = document.createElement('div');
  pop.className = 'atlas-colour-popover';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Pick a color');
  pop.innerHTML = `
    <div class="atlas-colour-presets">
      ${PRESETS.map(p => `<button type="button" class="atlas-colour-preset ${p.hex.toLowerCase() === opts.current.toLowerCase() ? 'is-current' : ''}" data-hex="${p.hex}" title="${p.name}" aria-label="${p.name} ${p.hex}" style="background:${p.hex}"></button>`).join('')}
    </div>
    <div class="atlas-colour-hex-row">
      <span class="atlas-colour-hex-dot" style="background:${opts.current}"></span>
      <input type="text" class="atlas-colour-hex" value="${opts.current}" maxlength="7" spellcheck="false" aria-label="Hex color" />
      <button type="button" class="atlas-btn-primary atlas-colour-apply" data-action="apply">Apply</button>
      <button type="button" class="atlas-btn-ghost atlas-colour-cancel" data-action="cancel">Cancel</button>
    </div>`;

  // Anchored under the swatch, inside the nearest positioned ancestor the
  // panel already scrolls in; clamp to the viewport's right edge.
  const host = (anchor.closest('.atlas-map-tab-wrapper') as HTMLElement | null) ?? document.body;
  host.appendChild(pop);
  const a = anchor.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  const width = 232;
  let left = a.left - h.left;
  if (left + width > h.width - 8) left = Math.max(8, h.width - width - 8);
  pop.style.left = `${left}px`;
  pop.style.top = `${a.bottom - h.top + 6}px`;
  pop.style.width = `${width}px`;

  const hexInput = pop.querySelector<HTMLInputElement>('.atlas-colour-hex')!;
  const dot = pop.querySelector<HTMLElement>('.atlas-colour-hex-dot')!;

  const close = (): void => {
    pop.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    if (openPopover === pop) { openPopover = null; closeOpen = null; }
  };
  const cancel = (): void => { close(); opts.onCancel?.(); };
  const apply = (hex: string): void => {
    if (!isHex(hex)) { hexInput.classList.add('is-invalid'); return; }
    close();
    opts.onApply(hex.toLowerCase());
  };
  const onOutside = (e: MouseEvent): void => {
    if (pop.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
    cancel();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
  };
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);

  pop.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    e.stopPropagation();
    const preset = t.closest<HTMLElement>('.atlas-colour-preset');
    if (preset) { apply(preset.getAttribute('data-hex') ?? ''); return; }
    if (t.closest('[data-action="apply"]')) { apply(hexInput.value.trim()); return; }
    if (t.closest('[data-action="cancel"]')) { cancel(); return; }
  });
  pop.addEventListener('mousedown', (e) => e.stopPropagation());
  hexInput.addEventListener('input', () => {
    const v = hexInput.value.trim();
    hexInput.classList.toggle('is-invalid', !isHex(v));
    if (isHex(v)) { dot.style.background = v; opts.onPreview?.(v); }
  });
  hexInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); apply(hexInput.value.trim()); }
  });

  openPopover = pop;
  closeOpen = close;
  hexInput.focus();
  hexInput.select();
}
