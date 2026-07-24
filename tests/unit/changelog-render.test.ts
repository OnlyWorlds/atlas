import { describe, it, expect } from 'vitest';
import { renderChangelog } from '../../src/changelog/render-changelog';
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

  it('counts credited entries into the community stat', () => {
    const credited = CHANGELOG.reduce(
      (n, r) => n + r.entries.filter(e => e.credit).length,
      0,
    );
    // Seed carries exactly one collaborator credit (Freek); keep the stat honest.
    expect(credited).toBe(1);
    expect(html).toContain(`<b>${credited}</b>`);
    expect(html).toContain('with Freek');
    // A collaborator is shaped-with, never "requested by".
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
