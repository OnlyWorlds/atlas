/**
 * The in-line link buttons (`.atlas-btn-link`): drawn as links, so a screen
 * reader must hear a link wherever one takes the person somewhere (a page, a
 * room, the Web, Home's strand, Settings), and a button wherever one does
 * something in place (copy, undo, a toggle, a dialog, a write).
 *
 * The census below names every use in src, file by file:
 *   - `link`: the control navigates, and carries `role="link"` (Enter opens it,
 *     as a button's own Enter does);
 *   - `acts`: the control acts in place and stays a plain button;
 *   - `native`: already an `<a href>`.
 * Each entry is a token found on the control's own lines (its data-action, its
 * key, its label). A new `.atlas-btn-link` in a file changes that file's count
 * and reddens here until it is named in one of the three lists: the choice
 * between a link and a button is made once per control, never by default.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const SRC = join(ROOT, 'src');

interface Entry { link?: string[]; acts?: string[]; native?: string[] }

const CENSUS: Record<string, Entry> = {
  'src/middle/guide-room-bar.ts': { link: ["'guide-room-back'"] },
  'src/middle/home-grow.ts': {
    link: ["'grow-web'", 'r.link.role'],
    acts: ["'grow-bring'", "'grow-undo'"],
    native: ["'data-action', 'grow-open'"],
  },
  'src/middle/home-guide.ts': { acts: ["'guide-back'", "'data-create-any'"] },
  'src/middle/home-picture.ts': { link: ["'home-picture-see'"] },
  'src/middle/home-strand-box.ts': { link: ['`${slot}:open`', "'data-role', role"] },
  'src/middle/home-strand-card.ts': {
    link: ["'data-act', 'writing'"],
    acts: ["'Or pick one from your world'", "'atlas-btn-link atlas-home-strand-quiet'"],
  },
  'src/middle/home-strand-room.ts': { link: ["'data-line-link'"] },
  'src/middle/home-strand.ts': { acts: ["'atlas-btn-link atlas-home-strand-quiet'"] },
  'src/middle/import-room.ts': {
    acts: ['"convert-prompt"', '"example-copy"', '"example-download"'],
    native: ['"back-to-start"', 'More ways to convert'],
  },
  'src/middle/landing-account-worlds.ts': { link: ['"landing-worlds-settings"'], acts: ['"landing-worlds-retry"'] },
  'src/middle/settings-storage.ts': { acts: ['class="atlas-btn-link" data-action="change-atlas-root"'] },
  'src/middle/settings-world.ts': { acts: ['"first-steps-again"', '"invite-someone"'] },
  'src/middle/strand-offer.ts': { link: ["btn('Open it', 'strand-open'"], acts: ["'Clear the strand', 'strand-clear', ()"] },
  'src/middle/welcome-panel.ts': { acts: ['"setup-atlas"', 'atlas-landing-more-link" data-door'] },
  'src/middle/world-home.ts': { link: ['"demo-delete"'], acts: ["'aid-retire'", '"demo-start-own"'] },
  'src/tabs/right/context-strand-frame.ts': { link: ["'strand-pick-on-home'"] },
  'src/tabs/right/map-zone-panel.ts': { acts: ['"apply-to-zones"', '"clear-rule"'] },
  'src/middle/element-detail-zone-sections.ts': { acts: ['"use-kind-colour"'] },
  'src/ui/where-choice.ts': { acts: ['"where-folder"'] },
};

/** How many `.atlas-btn-link` controls each file draws (the class's own occurrences). */
const COUNTS: Record<string, number> = {
  'src/middle/guide-room-bar.ts': 1,
  'src/middle/home-grow.ts': 5,
  'src/middle/home-guide.ts': 2,
  'src/middle/home-picture.ts': 1,
  'src/middle/home-strand-box.ts': 2,
  'src/middle/home-strand-card.ts': 3,
  'src/middle/home-strand-room.ts': 1,
  'src/middle/home-strand.ts': 1,
  'src/middle/import-room.ts': 5,
  'src/middle/landing-account-worlds.ts': 2,
  'src/middle/settings-storage.ts': 1,
  'src/middle/settings-world.ts': 2,
  'src/middle/strand-offer.ts': 1,
  'src/middle/welcome-panel.ts': 2,
  'src/middle/world-home.ts': 3,
  'src/tabs/right/context-strand-frame.ts': 1,
  'src/tabs/right/map-zone-panel.ts': 2,
  'src/middle/element-detail-zone-sections.ts': 1,
  'src/ui/where-choice.ts': 1,
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const rel = (p: string): string => relative(ROOT, p).replace(/\\/g, '/');
const ROLE_LINK = /role', 'link'|role="link"/;
const NEXT_CONTROL = /createElement\(|<button|<a |atlas-btn-link/;

/** The control's own lines: the token's line, then on until the next control starts (at most 8). */
function controlLines(lines: string[], token: string, file: string): string {
  const at = lines.findIndex(l => l.includes(token));
  if (at < 0) throw new Error(`${file}: token ${token} not found; true the census`);
  const own = [lines[at]];
  for (let i = at + 1; i < Math.min(lines.length, at + 9); i++) {
    if (NEXT_CONTROL.test(lines[i])) break;
    own.push(lines[i]);
  }
  return own.join('\n');
}

describe('in-line link buttons: a link where it goes somewhere, a button where it acts', () => {
  const files = walk(SRC).map(p => ({ file: rel(p), text: readFileSync(p, 'utf8') }));

  it('every file that draws one is in the census, with its count', () => {
    const found: Record<string, number> = {};
    for (const { file, text } of files) {
      const n = (text.match(/atlas-btn-link/g) ?? []).length;
      if (n > 0) found[file] = n;
    }
    expect(found).toEqual(COUNTS);
    expect(Object.keys(CENSUS).sort()).toEqual(Object.keys(COUNTS).sort());
  });

  for (const [file, entry] of Object.entries(CENSUS)) {
    const lines = (): string[] => readFileSync(join(ROOT, file), 'utf8').split(/\r?\n/);
    for (const token of entry.link ?? []) {
      it(`${file} ${token} is heard as a link`, () => {
        expect(controlLines(lines(), token, file)).toMatch(ROLE_LINK);
      });
    }
    for (const token of entry.acts ?? []) {
      it(`${file} ${token} stays a button`, () => {
        expect(controlLines(lines(), token, file)).not.toMatch(ROLE_LINK);
      });
    }
    for (const token of entry.native ?? []) {
      it(`${file} ${token} is an anchor`, () => {
        const ls = lines();
        const at = ls.findIndex(l => l.includes(token));
        expect(at).toBeGreaterThanOrEqual(0);
        expect(ls.slice(Math.max(0, at - 3), at + 1).join('\n')).toMatch(/<a |createElement\('a'\)/);
      });
    }
  }

  it('the strand line link for Create a map opens a dialog, so it alone stays a button', () => {
    const text = readFileSync(join(ROOT, 'src/middle/home-strand-room.ts'), 'utf8');
    expect(text).toMatch(/if \(kind !== 'create-map'\) b\.setAttribute\('role', 'link'\)/);
  });
});
