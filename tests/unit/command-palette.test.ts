/**
 * Command palette search ranking (pure half of src/ui/command-palette.ts).
 *
 * Tiers: name-prefix (100) > name-substring (80) > alias (70) >
 * supertype/subtype (60) > description (40, with context snippet).
 * Rooms match by name (prefix 90 / substring 55). Caps: 12 elements, 3 rooms.
 */

import { describe, it, expect } from 'vitest';
import { paletteRows, searchPalette } from '../../src/ui/command-palette';
import type { Element } from '../../src/core/types';

let n = 0;
function el(data: Record<string, unknown>): Element {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    type: 'character',
    name: '',
    local_updated_at: '2026-07-12T10:00:00.000Z',
    ...data,
  } as Element;
}

describe('searchPalette ranking', () => {
  it('empty query returns nothing', () => {
    expect(searchPalette('', [el({ name: 'Aldric' })])).toEqual([]);
    expect(searchPalette('   ', [el({ name: 'Aldric' })])).toEqual([]);
  });

  it('name prefix beats substring beats alias beats taxonomy beats description', () => {
    const elements = [
      el({ name: 'The Aldwood', description: '' }),           // substring (80)
      el({ name: 'Aldric', description: '' }),                // prefix (100)
      el({ name: 'Marta', atlas_aliases: ['Alda'] }),         // alias (70)
      el({ name: 'Keep', supertype: 'Aldstone fort' }),       // taxonomy (60)
      el({ name: 'Brenn', description: 'Guards the ald road east of town.' }), // description (40)
    ];
    const results = searchPalette('ald', elements).filter(r => r.kind === 'element');
    expect(results.map(r => r.name)).toEqual(['Aldric', 'The Aldwood', 'Marta', 'Keep', 'Brenn']);
  });

  it('description matches carry a context snippet; others do not', () => {
    const results = searchPalette('dragon', [
      el({ name: 'Dragon' }),
      el({ name: 'Brenn', description: 'x'.repeat(100) + ' slew the dragon of the vale ' + 'y'.repeat(100) }),
    ]);
    const byName = new Map(results.map(r => [r.name, r]));
    expect(byName.get('Dragon')?.snippet).toBeUndefined();
    expect(byName.get('Brenn')?.snippet).toContain('dragon of the vale');
    expect(byName.get('Brenn')?.snippet).toMatch(/^…/);
  });

  it('matching is case-insensitive; unnamed elements surface via description as (unnamed)', () => {
    const results = searchPalette('HARBOR', [
      el({ name: 'old harbor' }),
      el({ name: '', description: 'A quiet harbor town.' }),
    ]);
    expect(results.map(r => r.name)).toEqual(['old harbor', '(unnamed)']);
  });

  it('rooms match by name; an element name-prefix outranks them, but rooms beat weaker tiers', () => {
    const results = searchPalette('wri', [el({ name: 'Wright the Smith' })]);
    // Element prefix (100) > room prefix (90) — the palette's long tail is
    // elements; rooms are always one nav click away.
    expect(results[0]).toMatchObject({ kind: 'element', name: 'Wright the Smith' });
    expect(results[1]).toMatchObject({ kind: 'room', name: 'Writing' });

    const weaker = searchPalette('wri', [el({ name: 'Marta', description: 'A skilled wright of barrels.' })]);
    expect(weaker[0]).toMatchObject({ kind: 'room', name: 'Writing' });
  });

  it('caps element results at 12', () => {
    const many = Array.from({ length: 30 }, (_, i) => el({ name: `Torch ${i}` }));
    const results = searchPalette('torch', many);
    expect(results.filter(r => r.kind === 'element')).toHaveLength(12);
  });

  it('element hint carries type and taxonomy', () => {
    const [r] = searchPalette('vael', [el({ name: 'Vaelin', supertype: 'Noble', subtype: 'Exile' })]);
    expect(r.hint).toBe('character · Noble · Exile');
  });

  /**
   * S308 — the Data room. It is BRANDED "Data" (nav tooltip, help overlay, tour
   * exit summary, waypoints) but still ROUTES on the segment `import`. The
   * palette used to key on the segment word, so the one word a user would type
   * after reading the UI found nothing.
   *
   * A present/absent PAIR (the S301 law): asserting only that "data" works
   * would go quietly green again if someone dropped the aliases and renamed the
   * label back, and asserting only "import" would not have caught the original
   * bug at all. Both halves, so a regression breaks one loudly.
   */
  describe('the Data room is reachable by its label AND its legacy names', () => {
    const roomOf = (q: string) =>
      searchPalette(q, []).find(r => r.kind === 'room' && r.id === 'import');

    it('finds it by the branded label the UI everywhere else shows', () => {
      expect(roomOf('data')).toBeTruthy();
    });

    it('still finds it by the words a user actually types', () => {
      expect(roomOf('import')).toBeTruthy();
      expect(roomOf('export')).toBeTruthy();
    });

    it('DISPLAYS the branded label whichever word was typed', () => {
      // Typing the old word should find the room and then teach its new name.
      expect(roomOf('import')!.name).toBe('Data');
      expect(roomOf('data')!.name).toBe('Data');
    });
  });
});

describe('searchPalette: commands (S364)', () => {
  it('finds "reload from disk" by its name and its aliases, and not by a stray letter pair', () => {
    for (const q of ['reload', 'rel', 'rescan', 'refresh from', 'files', 'from disk']) {
      expect(searchPalette(q, []).some(r => r.kind === 'action' && r.id === 'reload-disk'), q).toBe(true);
    }
    expect(searchPalette('di', []).some(r => r.kind === 'action')).toBe(false);
  });
});

describe('searchPalette: Sentence-case labels, lowercase queries (1.32.0)', () => {
  it('finds every room by its displayed label, typed in any case', () => {
    for (const label of ['Home', 'Writing', 'Knowledge', 'Charts', 'Pages', 'Data', 'Settings']) {
      for (const q of [label, label.toLowerCase(), label.slice(0, 3).toLowerCase()]) {
        expect(searchPalette(q, []).some(r => r.kind === 'room' && r.name === label), q).toBe(true);
      }
    }
  });

  it('finds a command by a lowercase prefix and substring of its label', () => {
    expect(searchPalette('reload from', []).some(r => r.kind === 'action' && r.name === 'Reload from disk')).toBe(true);
    expect(searchPalette('from disk', []).some(r => r.kind === 'action' && r.name === 'Reload from disk')).toBe(true);
  });
});

describe('paletteRows: the create row (S369)', () => {
  it('offers one create row, first, when the query names nothing', () => {
    const rows = paletteRows('Zephyrine', [el({ name: 'Aldric' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'create', id: 'Zephyrine', name: 'Create "Zephyrine" as…' });
  });

  it('carries the trimmed query as the name to prefill', () => {
    expect(paletteRows('  Old Mill  ', []).find(r => r.kind === 'create')?.id).toBe('Old Mill');
  });

  it('comes after room and command matches, so they keep Enter', () => {
    const rows = paletteRows('reload', []);
    expect(rows[0].kind).toBe('action');
    expect(rows[rows.length - 1].kind).toBe('create');
  });

  it('is not offered when an element matches, or for an empty query', () => {
    expect(paletteRows('ald', [el({ name: 'Aldric' })]).some(r => r.kind === 'create')).toBe(false);
    expect(paletteRows('   ', [el({ name: 'Aldric' })])).toEqual([]);
  });
});
