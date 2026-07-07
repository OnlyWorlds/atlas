/**
 * Room-section tabs — THE pattern for major in-room sections (workplan D1).
 *
 * Generalizes the import room's underline+icon tabs into the app-wide
 * component: Capitalized labels, sized/weighted up so they read as main
 * sections (clearly bigger than filter chips), cyan underline on the active
 * tab. Call sites: knowledge [Entries | Knowers], import [Bring in | Take
 * out]; any future room inherits it.
 *
 * Styling lives in atlas.css under `.atlas-room-tabs` / `.atlas-room-tab`.
 */

export interface RoomTabSpec {
  key: string;
  /** Capitalized, per D1 ("Entries", "Bring in"). */
  label: string;
  /** Material Symbols glyph name (optional). */
  icon?: string;
}

export interface RoomTabsHandle {
  el: HTMLElement;
  /** Programmatically activate a tab (no onChange fire). */
  set(key: string): void;
  active(): string;
}

export function makeRoomTabs(
  tabs: readonly RoomTabSpec[],
  initial: string,
  onChange: (key: string) => void,
  opts?: { trailing?: HTMLElement },
): RoomTabsHandle {
  const row = document.createElement('div');
  row.className = 'atlas-room-tabs';
  row.setAttribute('role', 'tablist');

  let current = initial;
  const buttons = tabs.map(spec => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-room-tab';
    btn.dataset.tab = spec.key;
    btn.setAttribute('role', 'tab');
    if (spec.icon) {
      const ic = document.createElement('span');
      ic.className = 'material-symbols-outlined';
      ic.textContent = spec.icon;
      btn.appendChild(ic);
    }
    btn.appendChild(document.createTextNode(spec.label));
    btn.addEventListener('click', () => {
      if (spec.key === current) return;
      apply(spec.key);
      onChange(spec.key);
    });
    row.appendChild(btn);
    return btn;
  });

  if (opts?.trailing) {
    const spacer = document.createElement('span');
    spacer.className = 'atlas-room-tabs-spacer';
    row.appendChild(spacer);
    row.appendChild(opts.trailing);
  }

  function apply(key: string): void {
    current = key;
    buttons.forEach(b => {
      const isActive = b.dataset.tab === key;
      b.classList.toggle('is-active', isActive);
      b.setAttribute('aria-selected', String(isActive));
    });
  }
  apply(initial);

  return { el: row, set: apply, active: () => current };
}
