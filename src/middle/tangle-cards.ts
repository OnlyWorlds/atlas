/**
 * Tangle record cards (the atlas half of the tangle→atlas seam, 2026-07-19).
 *
 * Tactical Tangle records battles into the world as elements carrying
 * structured extensions (registered in Skeld's tangle-conventions):
 *   - Event.x_tangle_battle  — { engineVersion, seed, durationSeconds,
 *       winner|null, sides: [{name, fallen}], units: [{name, side, type,
 *       started, remaining, outcome}] }
 *   - Object.x_tangle_trope  — { x, y } (the tropaion's turning point)
 *
 * These render as READ-ONLY cards in the element detail's custom-fields
 * section, replacing the generic structured-JSON row. Defensive by rule:
 * the value is another tool's output — every field is re-checked and any
 * shape surprise returns null so the caller falls back to the generic row.
 * Never editable (the [object Object] destruction class stays closed).
 */

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

interface BattleSide { name: string; fallen: number }
interface BattleUnit { name: string; side: string; type: string; started: number; remaining: number; outcome: string }

function parseBattle(value: unknown): {
  winner: string | null;
  sides: BattleSide[];
  units: BattleUnit[];
  seed: number | null;
  durationSeconds: number | null;
  engineVersion: string | null;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.sides)) return null;
  const sides: BattleSide[] = [];
  for (const s of v.sides) {
    if (!s || typeof s !== 'object') return null;
    const name = str((s as Record<string, unknown>).name);
    const fallen = num((s as Record<string, unknown>).fallen);
    if (name == null || fallen == null) return null;
    sides.push({ name, fallen });
  }
  if (sides.length === 0) return null;
  const units: BattleUnit[] = [];
  if (Array.isArray(v.units)) {
    for (const u of v.units) {
      if (!u || typeof u !== 'object') continue; // tolerate odd rows, keep the good ones
      const r = u as Record<string, unknown>;
      const name = str(r.name); const side = str(r.side); const type = str(r.type);
      const started = num(r.started); const remaining = num(r.remaining); const outcome = str(r.outcome);
      if (name == null || side == null || type == null || started == null || remaining == null || outcome == null) continue;
      units.push({ name, side, type, started, remaining, outcome });
    }
  }
  return {
    winner: str(v.winner),
    sides,
    units,
    seed: num(v.seed),
    durationSeconds: num(v.durationSeconds),
    engineVersion: str(v.engineVersion),
  };
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * One-line outcome for a battle payload (plain TEXT, not HTML) — the war-record
 * strip's summary. Shares parseBattle + the wording of the card's outcome line
 * so the two surfaces can't drift. Null when the shape surprises.
 */
export function battleOutcomeLine(value: unknown): string | null {
  const b = parseBattle(value);
  if (!b) return null;
  return b.winner ? `${b.winner} held the field` : 'The armies parted without decision';
}

/** Battle card for Event.x_tangle_battle, or null when the shape surprises. */
export function renderTangleBattleCard(value: unknown): HTMLElement | null {
  const b = parseBattle(value);
  if (!b) return null;

  const card = document.createElement('div');
  card.className = 'atlas-tangle-card';

  const outcome = esc(battleOutcomeLine(value) ?? '');
  const sidesHtml = b.sides.map(s =>
    `<div class="atlas-tangle-side${b.winner === s.name ? ' atlas-tangle-side-winner' : ''}">
       <span class="atlas-tangle-side-name">${esc(s.name)}</span>
       <span class="atlas-tangle-side-fallen">${s.fallen.toLocaleString()} fallen</span>
     </div>`).join('<div class="atlas-tangle-vs">vs</div>');

  const unitRows = b.units.map(u => {
    const lost = Math.max(0, u.started - u.remaining);
    return `<tr>
      <td>${esc(u.name)}</td>
      <td class="atlas-tangle-unit-side">${esc(u.side)}</td>
      <td class="atlas-tangle-unit-type">${esc(u.type)}</td>
      <td class="atlas-tangle-unit-count">${u.remaining} / ${u.started}${lost > 0 ? `<span class="atlas-tangle-unit-lost">−${lost}</span>` : ''}</td>
      <td class="atlas-tangle-unit-outcome" data-outcome="${esc(u.outcome)}">${esc(u.outcome)}</td>
    </tr>`;
  }).join('');

  const footerBits: string[] = [];
  if (b.durationSeconds != null) {
    const m = Math.floor(b.durationSeconds / 60);
    const s = Math.round(b.durationSeconds % 60);
    footerBits.push(`fought in ${m > 0 ? `${m}m ` : ''}${s}s`);
  }
  if (b.seed != null) footerBits.push(`seed ${b.seed.toString(16)}`);
  if (b.engineVersion) footerBits.push(`engine ${esc(b.engineVersion)}`);

  card.innerHTML = `
    <div class="atlas-tangle-card-head">
      <span class="material-symbols-outlined">swords</span>
      <span class="atlas-tangle-card-title">Battle record</span>
      <span class="atlas-tangle-card-source">from Tactical Tangle</span>
    </div>
    <div class="atlas-tangle-outcome">${outcome}</div>
    <div class="atlas-tangle-sides">${sidesHtml}</div>
    ${unitRows ? `<table class="atlas-tangle-units"><tbody>${unitRows}</tbody></table>` : ''}
    ${footerBits.length ? `<div class="atlas-tangle-card-foot">${footerBits.join(' · ')}</div>` : ''}
  `;
  return card;
}

/** Small card for Object.x_tangle_trope (the tropaion's turning point). */
export function renderTangleTropeCard(value: unknown): HTMLElement | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const x = num(v.x); const y = num(v.y);
  if (x == null || y == null) return null;
  const card = document.createElement('div');
  card.className = 'atlas-tangle-card';
  card.innerHTML = `
    <div class="atlas-tangle-card-head">
      <span class="material-symbols-outlined">flag</span>
      <span class="atlas-tangle-card-title">Tropaion</span>
      <span class="atlas-tangle-card-source">from Tactical Tangle</span>
    </div>
    <div class="atlas-tangle-outcome">Raised where the battle turned: ${x}m, ${y}m on the field.</div>
  `;
  return card;
}

/** Registry: field name → card renderer. The custom-fields section consults
 *  this before falling back to the generic structured-JSON row. */
export const TANGLE_CARD_RENDERERS: Record<string, (value: unknown) => HTMLElement | null> = {
  x_tangle_battle: renderTangleBattleCard,
  x_tangle_trope: renderTangleTropeCard,
};
