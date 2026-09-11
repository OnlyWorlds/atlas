/**
 * The zone panel (S356): the toolbar's zones fold-out, grown from a flat list
 * of every zone into a browser and a legend.
 *
 * Kinds (world-styles `groupByKind`: one row per distinct supertype/subtype
 * pair) are collapsible groups. A kind row carries the rule's swatch (click =
 * colour picker, writes a world style rule), an eye (hide the kind on this
 * map, session-only), the count, a tune button (fill, weight, dash, label
 * priority, clear) and the caret to its zones. A zone row is the chip it
 * always was: shape glyph, colour dot, name, delete; hover lights the zone
 * on the map, click selects and pans, right-click opens the context menu.
 * A search box filters zones by name and opens the kinds that match.
 *
 * The container (`entry.zoneStrip`, class `atlas-zones-dropdown-panel`) and
 * the toolbar button are untouched: Captain liked the feel of the button
 * and the style of the panel, so the panel keeps both and only grows
 * inside. Rendering is a full innerHTML rebuild per sync (cheap at 300
 * zones); open/closed kinds, the search text and the tune target live on
 * the entry so a rebuild does not lose them.
 */

import { getState, patchSlice } from '../../core/state';
import { navigate, elementHash } from '../../core/router';
import { ELEMENT_LABELS } from '../../core/constants';
import { escapeText, escapeAttr } from '../../core/dom-utils';
import { getZoneShape } from './zone-derived';
import { mapTabCache, type MapTabCacheEntry } from './map-tab-cache';
import type { Zone } from '../../core/types';
import {
  groupByKind, kindLabel, resolveStyle, findRule, upsertRule, removeRule, ruleKey,
  type StyleRule, type Kind, type LineDash,
} from '../../core/world-styles';
import { saveWorldStyleRules } from '../../core/world-styles-state';
import { openColourPopover } from '../../ui/colour-popover';
import { panMapTabTo } from './map-tab';
import { refreshActiveMapZones } from './map-tab-zones';
import { markersForZoneOnMap } from './zone-derived';
import { partitionZonesAndMarkers } from './zone-derived';

const DEFAULT_ZONE_COLOR = '#22d3ee';

export interface ZonePanelState {
  openKinds: Set<string>;
  search: string;
  /** The kind whose tune form is open, if any. */
  tuning: string | null;
  /** The user has collapsed/opened at least once: stop auto-opening. */
  touched: boolean;
  /** A sync happened while the panel was closed; render on open. */
  stale: boolean;
}

const panelState = new WeakMap<MapTabCacheEntry, ZonePanelState>();
function stateFor(entry: MapTabCacheEntry): ZonePanelState {
  let s = panelState.get(entry);
  if (!s) { s = { openKinds: new Set(), search: '', tuning: null, touched: false, stale: true }; panelState.set(entry, s); }
  return s;
}

/** The rule a kind row edits: the (type, supertype, subtype) of the kind itself. */
function ruleProbe(kind: Kind<Zone>): Pick<StyleRule, 'type' | 'supertype' | 'subtype'> {
  return { type: 'zone', supertype: kind.supertype || undefined, subtype: kind.subtype || undefined };
}

/**
 * Render the panel for the zones on this map. `zones` is every zone on the
 * map (hidden kinds included: the panel is where they come back).
 */
export function renderZonePanel(entry: MapTabCacheEntry, zones: Zone[], selectedId?: string | null): void {
  const strip = entry.zoneStrip;
  const btn = entry.toolbar.querySelector<HTMLButtonElement>('[data-action="zones-dropdown"]');
  const countEl = btn?.querySelector<HTMLElement>('[data-role="zones-count"]');

  if (zones.length === 0) {
    strip.innerHTML = '';
    strip.style.display = 'none';
    strip.classList.remove('is-open');
    if (btn) { btn.style.display = 'none'; btn.classList.remove('is-open'); }
    return;
  }
  if (btn) {
    btn.style.display = '';
    if (countEl) countEl.textContent = String(zones.length);
  }
  strip.style.display = '';

  const ps = stateFor(entry);
  // A closed panel is not rebuilt (syncZones runs on every elements tick;
  // 300 rows of innerHTML for nobody). It renders on open instead.
  if (!strip.classList.contains('is-open')) { ps.stale = true; return; }
  ps.stale = false;
  const rules = getState().styles.rules;
  const kinds = groupByKind(zones);
  const q = ps.search.trim().toLowerCase();
  // One kind (a small hand-drawn world) opens itself: the panel reads as the
  // flat list it was. Many kinds start closed; the selected zone's kind opens.
  if (!ps.touched && kinds.length === 1) ps.openKinds.add(kinds[0].key);
  if (selectedId) {
    const k = kinds.find(k => k.members.some(z => z.id === selectedId));
    if (k) ps.openKinds.add(k.key);
  }

  // Preserve the search box's focus/caret across a rebuild.
  const hadFocus = document.activeElement === strip.querySelector('[data-role="zone-search"]');
  const caret = (strip.querySelector('[data-role="zone-search"]') as HTMLInputElement | null)?.selectionStart ?? null;

  const parts: string[] = [];
  parts.push(`
    <div class="atlas-zone-panel-head">
      <span class="material-symbols-outlined atlas-zone-panel-search-icon" aria-hidden="true">search</span>
      <input type="text" class="atlas-zone-panel-search" data-role="zone-search" placeholder="Find a zone" value="${escapeAttr(ps.search)}" />
      ${kinds.length > 1 ? `<span class="atlas-zone-panel-kinds">${kinds.length} kinds</span>` : ''}
    </div>`);

  for (const kind of kinds) {
    const members = [...kind.members].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    const matching = q ? members.filter(z => (z.name ?? '').toLowerCase().includes(q)) : members;
    if (q && matching.length === 0) continue;
    const open = q ? true : ps.openKinds.has(kind.key);
    const hidden = entry.hiddenZoneKinds.has(kind.key);
    const rule = findRule(rules, ruleProbe(kind));
    const resolved = resolveStyle(rules, { type: 'zone', supertype: kind.supertype, subtype: kind.subtype });
    const color = rule?.color ?? resolved.color ?? DEFAULT_ZONE_COLOR;
    const hasKind = Boolean(kind.supertype || kind.subtype);
    const tuning = ps.tuning === kind.key;
    parts.push(`
      <div class="atlas-zone-kind ${open ? 'is-open' : ''} ${hidden ? 'is-hidden' : ''}" data-kind-key="${escapeAttr(kind.key)}">
        <div class="atlas-zone-kind-row" data-action="toggle-kind">
          <span class="material-symbols-outlined atlas-zone-kind-caret" aria-hidden="true">${open ? 'expand_more' : 'chevron_right'}</span>
          ${hasKind
            ? `<button type="button" class="atlas-zone-kind-swatch" title="Colour for every ${escapeAttr(kindLabel(kind))} zone (a world style, saved with the folder)" data-action="swatch" data-color="${escapeAttr(color)}" aria-label="Colour for ${escapeAttr(kindLabel(kind))}">
                 <span class="atlas-zone-kind-swatch-dot" style="background:${escapeAttr(color)}"></span>
               </button>`
            : `<span class="atlas-zone-kind-swatch is-inert"><span class="atlas-zone-kind-swatch-dot" style="background:${escapeAttr(color)}"></span></span>`}
          <span class="atlas-zone-kind-name">${escapeText(kindLabel(kind))}</span>
          <span class="atlas-zone-kind-count">${matching.length}${q ? ` of ${members.length}` : ''}</span>
          ${hasKind ? `<button type="button" class="atlas-zone-kind-btn ${tuning ? 'is-active' : ''}" data-action="tune" title="Fill, line and label for this kind"><span class="material-symbols-outlined">tune</span></button>` : ''}
          <button type="button" class="atlas-zone-kind-btn atlas-zone-kind-eye" data-action="toggle-kind-visible" title="${hidden ? 'Show' : 'Hide'} these zones on this map"><span class="material-symbols-outlined">${hidden ? 'visibility_off' : 'visibility'}</span></button>
        </div>
        ${tuning && hasKind ? renderTune(kind, rule, resolved) : ''}
        <div class="atlas-zone-kind-members" ${open ? '' : 'hidden'}>
          ${matching.map(z => renderChip(z, selectedId, rules)).join('')}
        </div>
      </div>`);
  }
  if (q && parts.length === 1) parts.push(`<div class="atlas-zone-panel-empty">No zone matches "${escapeText(ps.search.trim())}"</div>`);

  strip.innerHTML = parts.join('');
  if (hadFocus) {
    const input = strip.querySelector<HTMLInputElement>('[data-role="zone-search"]');
    if (input) { input.focus(); if (caret !== null) input.setSelectionRange(caret, caret); }
  }
}

function renderChip(z: Zone, selectedId: string | null | undefined, rules: readonly StyleRule[]): string {
  const shapeIcon = getZoneShape(z) === 'line' ? 'show_chart' : 'hexagon';
  const own = (z as { atlas_color?: string }).atlas_color;
  const color = own ?? resolveStyle(rules, z).color ?? DEFAULT_ZONE_COLOR;
  return `
    <div class="atlas-zone-chip ${z.id === selectedId ? 'is-selected' : ''}" data-zone-id="${escapeAttr(z.id)}" title="${escapeAttr(`${ELEMENT_LABELS.zone.singular}: ${z.name}`)}">
      <span class="material-symbols-outlined atlas-zone-chip-shape">${shapeIcon}</span>
      <span class="atlas-zone-chip-dot ${own ? 'is-own' : ''}" style="background:${escapeAttr(color)}" title="${own ? 'This zone has its own colour' : ''}"></span>
      <span class="atlas-zone-chip-name">${escapeText(z.name || '(unnamed)')}</span>
      <button type="button" class="atlas-zone-chip-x" data-action="delete" title="Delete zone">
        <span class="material-symbols-outlined">delete</span>
      </button>
    </div>`;
}

function renderTune(kind: Kind<Zone>, rule: StyleRule | undefined, resolved: ReturnType<typeof resolveStyle>): string {
  const fill = rule?.fill_opacity ?? resolved.fill_opacity;
  const weight = rule?.weight ?? resolved.weight ?? 2;
  const dash: LineDash = rule?.dash ?? resolved.dash ?? 'solid';
  const prio = Boolean(rule?.label_priority ?? resolved.label_priority);
  const anyPolygon = kind.members.some(z => getZoneShape(z) === 'polygon');
  return `
    <div class="atlas-zone-tune" data-role="tune">
      ${anyPolygon ? `
      <label class="atlas-zone-tune-row">
        <span>Fill</span>
        <input type="range" min="0" max="100" value="${Math.round((fill ?? 0.4) * 100)}" data-action="tune-fill" />
        <span class="atlas-zone-tune-val" data-role="fill-val">${fill === undefined ? 'map' : `${Math.round(fill * 100)}%`}</span>
      </label>` : ''}
      <label class="atlas-zone-tune-row">
        <span>Line</span>
        <input type="range" min="1" max="6" value="${weight}" data-action="tune-weight" />
        <span class="atlas-zone-tune-val">${weight}px</span>
      </label>
      <label class="atlas-zone-tune-row">
        <span>Stroke</span>
        <select class="atlas-select" data-action="tune-dash">
          <option value="solid" ${dash === 'solid' ? 'selected' : ''}>solid</option>
          <option value="dashed" ${dash === 'dashed' ? 'selected' : ''}>dashed</option>
          <option value="dotted" ${dash === 'dotted' ? 'selected' : ''}>dotted</option>
        </select>
      </label>
      <label class="atlas-zone-tune-row atlas-zone-tune-check">
        <input type="checkbox" data-action="tune-priority" ${prio ? 'checked' : ''} />
        <span>Label first (with the pins)</span>
      </label>
      <div class="atlas-zone-tune-actions">
        <button type="button" class="atlas-btn-link" data-action="apply-to-zones" title="Write this colour into every zone of the kind, so other tools see it too">Write into zones</button>
        <button type="button" class="atlas-btn-link" data-action="clear-rule" ${rule ? '' : 'disabled'}>Clear</button>
      </div>
    </div>`;
}

/** Bind once per strip. Delegated; the panel is rebuilt per sync. */
export function wireZonePanel(entry: MapTabCacheEntry, handlers: {
  onDelete: (zoneId: string) => void;
  onContext: (zoneId: string, x: number, y: number) => void;
  onApplyToZones: (zones: Zone[], color: string) => void;
}): void {
  const strip = entry.zoneStrip;
  const ps = stateFor(entry);
  const zonesOnMap = (): Zone[] => {
    const { zones, markers } = partitionZonesAndMarkers(getState().data.elements);
    const ids = new Set<string>();
    for (const m of markers) if (m.map_id === entry.mapId && m.zone_id) ids.add(m.zone_id);
    return zones.filter(z => ids.has(z.id));
  };
  const kindOf = (key: string): Kind<Zone> | undefined => groupByKind(zonesOnMap()).find(k => k.key === key);
  const rerender = (): void => {
    renderZonePanel(entry, zonesOnMap(), getState().ui.selectedElementId);
  };
  const writeRule = (kind: Kind<Zone>, patch: Partial<StyleRule>): void => {
    const rules = getState().styles.rules;
    const existing = findRule(rules, ruleProbe(kind));
    const next = upsertRule(rules, { ...(existing ?? ruleProbe(kind)), ...patch } as StyleRule);
    void saveWorldStyleRules(next);
  };

  strip.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    e.stopPropagation();
    const kindEl = target.closest<HTMLElement>('.atlas-zone-kind');
    const kindKey = kindEl?.getAttribute('data-kind-key') ?? null;

    const swatch = target.closest<HTMLElement>('[data-action="swatch"]');
    if (swatch && kindKey) {
      const kind = kindOf(kindKey);
      if (!kind) return;
      openColourPopover({
        anchor: swatch,
        current: swatch.getAttribute('data-color') ?? DEFAULT_ZONE_COLOR,
        onApply: (hex) => writeRule(kind, { color: hex }),
      });
      return;
    }
    if (target.closest('[data-role="tune"]') && !target.closest('button')) return;

    if (kindKey && target.closest('[data-action="toggle-kind-visible"]')) {
      if (entry.hiddenZoneKinds.has(kindKey)) entry.hiddenZoneKinds.delete(kindKey);
      else entry.hiddenZoneKinds.add(kindKey);
      // Re-sync the overlay directly (it rebuilds this panel too).
      refreshActiveMapZones();
      return;
    }
    if (kindKey && target.closest('[data-action="tune"]')) {
      ps.tuning = ps.tuning === kindKey ? null : kindKey;
      rerender();
      return;
    }
    if (kindKey && target.closest('[data-action="clear-rule"]')) {
      const kind = kindOf(kindKey);
      if (!kind) return;
      void saveWorldStyleRules(removeRule(getState().styles.rules, ruleKey(ruleProbe(kind))));
      return;
    }
    if (kindKey && target.closest('[data-action="apply-to-zones"]')) {
      const kind = kindOf(kindKey);
      if (!kind) return;
      const color = resolveStyle(getState().styles.rules, { type: 'zone', supertype: kind.supertype, subtype: kind.subtype }).color;
      if (color) handlers.onApplyToZones(kind.members, color);
      return;
    }
    if (kindKey && target.closest('[data-action="toggle-kind"]')) {
      ps.touched = true;
      if (ps.openKinds.has(kindKey)) ps.openKinds.delete(kindKey); else ps.openKinds.add(kindKey);
      rerender();
      return;
    }

    const chip = target.closest<HTMLElement>('.atlas-zone-chip');
    if (!chip) return;
    const zoneId = chip.getAttribute('data-zone-id');
    if (!zoneId) return;
    if (target.closest('[data-action="delete"]')) { handlers.onDelete(zoneId); return; }
    // Select + navigate (parity with the canvas click) and pan to the zone.
    const worldId = getState().active?.worldId;
    patchSlice('ui', { ...getState().ui, selectedElementId: zoneId });
    if (worldId) navigate(elementHash(worldId, zoneId));
    const pts = markersForZoneOnMap(zoneId, entry.mapId, partitionZonesAndMarkers(getState().data.elements).markers);
    if (pts.length > 0) {
      const cx = pts.reduce((s, m) => s + m.x, 0) / pts.length;
      const cy = pts.reduce((s, m) => s + m.y, 0) / pts.length;
      void panMapTabTo(entry.mapId, cx, cy);
    }
  });

  strip.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    const action = target.getAttribute('data-action') ?? target.getAttribute('data-role');
    if (action === 'zone-search') {
      ps.search = target.value;
      rerender();
      return;
    }
    const kindKey = target.closest<HTMLElement>('.atlas-zone-kind')?.getAttribute('data-kind-key');
    const kind = kindKey ? kindOf(kindKey) : undefined;
    if (!kind) return;
    if (action === 'tune-fill') {
      const val = target.parentElement?.querySelector<HTMLElement>('[data-role="fill-val"]');
      if (val) val.textContent = `${target.value}%`;
    }
  });

  strip.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    const action = target.getAttribute('data-action');
    const kindKey = target.closest<HTMLElement>('.atlas-zone-kind')?.getAttribute('data-kind-key');
    const kind = kindKey ? kindOf(kindKey) : undefined;
    if (!kind || !action) return;
    if (action === 'tune-fill') writeRule(kind, { fill_opacity: Number(target.value) / 100 });
    else if (action === 'tune-weight') writeRule(kind, { weight: Number(target.value) });
    else if (action === 'tune-dash') writeRule(kind, { dash: target.value as LineDash });
    else if (action === 'tune-priority') writeRule(kind, { label_priority: (target as HTMLInputElement).checked || undefined });
  });

  // Hover a row → light the zone on the map, exactly as the cursor would.
  let hoveredId: string | null = null;
  const unhover = (): void => {
    if (hoveredId) entry.zoneOverlay?.setZoneHovered(hoveredId, false);
    hoveredId = null;
  };
  strip.addEventListener('mouseover', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('.atlas-zone-chip');
    const id = chip?.getAttribute('data-zone-id') ?? null;
    if (id === hoveredId) return;
    unhover();
    if (id) { hoveredId = id; entry.zoneOverlay?.setZoneHovered(id, true); }
  });
  strip.addEventListener('mouseleave', unhover);

  strip.addEventListener('contextmenu', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('.atlas-zone-chip');
    if (!chip) return;
    e.preventDefault();
    const zoneId = chip.getAttribute('data-zone-id');
    if (zoneId) handlers.onContext(zoneId, e.clientX, e.clientY);
  });

  // The toolbar announces the open; render then if a sync was skipped.
  strip.addEventListener('atlas:zone-panel-open', () => {
    if (stateFor(entry).stale) rerender();
  });

  strip.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (e.target as HTMLElement).matches('[data-role="zone-search"]') && ps.search) {
      ps.search = '';
      rerender();
      e.stopPropagation();
    }
  });
}

/** Test seam: the panel state for a mounted map. */
export function zonePanelStateFor(mapId: string): ZonePanelState | null {
  const entry = mapTabCache.get(mapId);
  return entry ? stateFor(entry) : null;
}
