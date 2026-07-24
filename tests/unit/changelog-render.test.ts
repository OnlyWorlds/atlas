import { describe, it, expect } from 'vitest';
import { renderChangelog, assertUniqueEntryIds } from '../../src/changelog/render-changelog';
import { CHANGELOG, type ChangelogRelease } from '../../src/changelog/changelog.data';

describe('renderChangelog — seed data', () => {
  const html = renderChangelog(CHANGELOG);

  it('renders every release and every entry with a stable anchor id', () => {
    for (const release of CHANGELOG) {
      expect(html).toContain(`v${release.version}`);
      for (const entry of release.entries) {
        // The :target anchor — a permalink into a specific change.
        expect(html).toContain(`id="${entry.id}"`);
        expect(html).toContain(entry.title);
      }
    }
  });

  it('renders a collaborator credit as shaped-with, never requested-by', () => {
    expect(html).toContain('with Freek');
    // A collaborator is shaped-with; only reddit/discord are "requested by".
    expect(html).not.toContain('requested by Freek');
  });

  it('is a complete standalone document with og + no external scripts', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('og:title');
    expect(html).toContain('atlas.onlyworlds.com/changelog');
    // Fully self-contained: no external <script src> / <link rel=stylesheet>.
    expect(html).not.toMatch(/<script[^>]*\ssrc=/);
    expect(html).not.toMatch(/rel="stylesheet"/);
  });
});

describe('renderChangelog — credit + escaping contract', () => {
  it('links a reddit thread with rel=ugc and the requested-by verb', () => {
    const fixture: ChangelogRelease[] = [{
      version: '9.9',
      date: '2026-08-01',
      theme: 'test',
      entries: [{
        id: 'req',
        title: 'A requested thing',
        tags: ['maps'],
        credit: { handle: 'u/worldsmith', platform: 'reddit', threadUrl: 'https://reddit.com/r/x/comments/abc' },
      }],
    }];
    const html = renderChangelog(fixture);
    expect(html).toContain('requested by u/worldsmith');
    expect(html).toContain('href="https://reddit.com/r/x/comments/abc"');
    expect(html).toContain('rel="ugc noopener"');
  });

  it('throws on a duplicate entry id (anchors are global permalinks)', () => {
    const dup: ChangelogRelease[] = [
      { version: '1.1', date: '2026-02-01', theme: 't', entries: [{ id: 'writing', title: 'A', tags: [] }] },
      { version: '1.0', date: '2026-01-01', theme: 't', entries: [{ id: 'writing', title: 'B', tags: [] }] },
    ];
    expect(() => assertUniqueEntryIds(dup)).toThrow(/duplicate entry id "writing"/);
    // The real seed data must be collision-free.
    expect(() => assertUniqueEntryIds(CHANGELOG)).not.toThrow();
  });

  it('escapes HTML in user-authored fields', () => {
    const fixture: ChangelogRelease[] = [{
      version: '1.0',
      date: '2026-01-01',
      theme: 'safe & <sound>',
      entries: [{
        id: 'x',
        title: '<script>alert(1)</script> & "quotes"',
        body: 'a < b & c > d',
        tags: ['<b>'],
      }],
    }];
    const html = renderChangelog(fixture);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('safe &amp; &lt;sound&gt;');
  });
});
