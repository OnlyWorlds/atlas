import { describe, it, expect } from 'vitest';
import { renderChangelog, renderChangelogFeed, assertUniqueEntryIds } from '../../src/changelog/render-changelog';
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

describe('renderChangelogFeed — the RSS half (S318)', () => {
  const feed = renderChangelogFeed(CHANGELOG);

  it('is RSS 2.0 with one item per entry, permalink guids', () => {
    expect(feed.startsWith('<?xml version="1.0"')).toBe(true);
    expect(feed).toContain('<rss version="2.0"');
    const entryCount = CHANGELOG.reduce((n, r) => n + r.entries.length, 0);
    expect((feed.match(/<item>/g) ?? []).length).toBe(entryCount);
    for (const r of CHANGELOG) {
      for (const e of r.entries) {
        expect(feed).toContain(`changelog.html#${e.id}`);
      }
    }
    expect(feed).toContain('<guid isPermaLink="true">');
  });

  it('carries RFC822 pubDates from the release day', () => {
    // 2026-07-24 is a Friday; a wrong date-mapping breaks this loudly.
    expect(feed).toContain('Fri, 24 Jul 2026');
  });

  it('escapes markup in fed content', () => {
    const fixture: ChangelogRelease[] = [{
      version: '9.9', date: '2026-01-01', theme: 't',
      entries: [{ id: 'esc', title: 'a < b & c', tags: ['<b>'], body: '"q"' }],
    }];
    const xml = renderChangelogFeed(fixture);
    expect(xml).toContain('a &lt; b &amp; c');
    expect(xml).not.toContain('<b>');
  });

  it('the seed data is the fresh v1: exactly one release, launch-dated', () => {
    // Captain's S318 ruling — one clean v1.0 block, ready to changelog on
    // top of. A second release reappearing here should be a conscious act.
    expect(CHANGELOG.length).toBe(1);
    expect(CHANGELOG[0].version).toBe('1.0');
    expect(CHANGELOG[0].date).toBe('2026-07-24');
  });
});
