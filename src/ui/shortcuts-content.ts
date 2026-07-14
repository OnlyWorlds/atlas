/**
 * Shared "keyboard shortcuts + gestures" content.
 *
 * Consumers: the room-aware help overlay (`help-overlay.ts`, the live `?`
 * surface) and the dormant hotkey-reference-modal. Both call
 * `buildShortcutsContent()` so a single source of truth feeds them. (The
 * old sidebar-footer `?` popover was retired in S255v4.)
 *
 * Content has two kinds of rows:
 *   1. **Hotkey-table bindings** (auto) — pulled from `getInstalledBindings()`
 *      so adding a binding to the dispatcher's table surfaces it here for free.
 *   2. **Context-bound gestures** (hardcoded) — Esc / Enter / F / right-click /
 *      drag-to-trash, etc. These don't live in the central dispatcher because
 *      they're handled by individual modules (modal-base, map-tab, popover),
 *      but they're equally part of the user's keyboard + mouse vocabulary.
 */

import { formatCombo, getInstalledBindings } from '../core/hotkeys';

interface Row {
  /** kbd-rendered combo or affordance label (e.g. "Ctrl+E", "Right-click pin"). */
  combo: string;
  /** Plain-language description shown next to the combo. */
  description: string;
  /** Whether `combo` should render as a <kbd>-styled chip or plain text. */
  comboAsKbd: boolean;
}

interface Section {
  label: string;
  rows: Row[];
}

/**
 * Hardcoded gestures that aren't in the hotkeys.ts dispatcher table because
 * they're handled by individual modules. Listed here so they appear in the
 * reference UI alongside the auto-generated hotkeys.
 */
function gestureSections(): Section[] {
  return [
    {
      label: 'Editor',
      rows: [
        { combo: 'Esc', description: 'Cancel modal, popover, or zone drawing/edit', comboAsKbd: true },
        { combo: 'Enter', description: 'Finish zone draft · commit zone edit · save field popover', comboAsKbd: true },
      ],
    },
    {
      label: 'Map',
      rows: [
        { combo: 'F', description: 'Fit map to bounds (when map tab is focused)', comboAsKbd: true },
        { combo: 'Z', description: 'Start drawing a polygon zone', comboAsKbd: true },
        { combo: 'L', description: 'Start drawing a line zone', comboAsKbd: true },
        { combo: 'Shift + click', description: 'Snap to 45° axis while drawing a zone', comboAsKbd: true },
      ],
    },
    {
      label: 'Charts',
      rows: [
        { combo: 'Scroll on chart', description: 'Zoom around the cursor · drag empty space to pan · the bottom strip drags the whole window', comboAsKbd: false },
        { combo: 'Click a dot', description: 'Peek its card · click again to focus', comboAsKbd: false },
        { combo: 'Drag a dot', description: 'Re-date it · drag a range\'s end cap to stretch the end', comboAsKbd: false },
        { combo: 'Drag the gold line', description: "Move the world's now", comboAsKbd: false },
        { combo: 'Drag from Undated', description: 'Give an element its date', comboAsKbd: false },
      ],
    },
    {
      label: 'Mouse',
      rows: [
        { combo: 'Right-click pin', description: 'Toggle ghost pins around it', comboAsKbd: false },
        { combo: 'Right-click on map', description: 'Create element + drop pin (TAB-autocomplete to place existing)', comboAsKbd: false },
        { combo: 'Right-click vertex in edit', description: 'Delete that marker', comboAsKbd: false },
        { combo: 'Drag pin → trash', description: 'Delete pin (top-right of map canvas)', comboAsKbd: false },
      ],
    },
  ];
}

/**
 * Convert the installed hotkey bindings into reference rows, grouped by scope.
 * Scopes come out in declaration order; rows preserve binding order within each.
 */
function hotkeySections(): Section[] {
  const bindings = getInstalledBindings();
  const grouped = new Map<string, Row[]>();
  for (const b of bindings) {
    const row: Row = {
      combo: formatCombo(b),
      description: b.description,
      comboAsKbd: true,
    };
    const list = grouped.get(b.scope);
    if (list) list.push(row);
    else grouped.set(b.scope, [row]);
  }
  return Array.from(grouped, ([label, rows]) => ({ label, rows }));
}

/**
 * Build the full reference content as a DOM tree, ready to append to either
 * the popover or the modal body. Sections render in this order:
 *   1. Hotkey-table groups (Global, Editor, Sidebar, Map — driven by bindings)
 *   2. Gesture groups (context-bound: Editor, Map, Mouse)
 *
 * Where a label appears in both (e.g. "Editor", "Map"), the rows are merged
 * so the user sees a single grouped section per label.
 */
export function buildShortcutsContent(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'atlas-shortcuts-content';

  // Merge sections from both sources, preserving first-seen order.
  const merged = new Map<string, Row[]>();
  for (const s of [...hotkeySections(), ...gestureSections()]) {
    const existing = merged.get(s.label);
    if (existing) existing.push(...s.rows);
    else merged.set(s.label, [...s.rows]);
  }

  for (const [label, rows] of merged) {
    const section = document.createElement('div');
    section.className = 'atlas-shortcuts-section';

    const header = document.createElement('div');
    header.className = 'atlas-shortcuts-section-header';
    header.textContent = label;
    section.appendChild(header);

    const list = document.createElement('dl');
    list.className = 'atlas-shortcuts-list';
    for (const row of rows) {
      const dt = document.createElement('dt');
      if (row.comboAsKbd) {
        renderKbdCombo(dt, row.combo);
      } else {
        dt.textContent = row.combo;
      }
      list.appendChild(dt);

      const dd = document.createElement('dd');
      dd.textContent = row.description;
      list.appendChild(dd);
    }
    section.appendChild(list);
    root.appendChild(section);
  }

  return root;
}

/**
 * Render a combo like "Shift + click" or "Ctrl+E" with the keys as <kbd>
 * chips and the connectors (` + `, ` · `) as plain text.
 */
function renderKbdCombo(host: HTMLElement, combo: string): void {
  // Split on ` + ` or `+` (with or without spaces) into key tokens.
  // Plain-text connectors that aren't keys (like "click") are not wrapped.
  const KEY_LIKE = /^(Ctrl|Cmd|⌘|Shift|Alt|Esc|Enter|Tab|Space|Backspace|Delete|F\d?|[A-Z?])$/;
  const tokens = combo.split(/\s*(\+)\s*/).filter(t => t.length > 0);
  let needsSeparator = false;
  for (const tok of tokens) {
    if (tok === '+') continue; // we'll handle separators via spacing
    if (needsSeparator) host.appendChild(document.createTextNode(' + '));
    if (KEY_LIKE.test(tok)) {
      const kbd = document.createElement('kbd');
      kbd.textContent = tok;
      host.appendChild(kbd);
    } else {
      host.appendChild(document.createTextNode(tok));
    }
    needsSeparator = true;
  }
}
