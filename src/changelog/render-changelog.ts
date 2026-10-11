/**
 * Pure data -> HTML renderer for the public changelog. No DOM, no store; the
 * emit script (scripts/build-changelog.mts) feeds it CHANGELOG and writes the
 * result to ./changelog.html. Kept side-effect-free so it is unit-testable and
 * so the page is fully static (crawlable, renders on every browser, no app
 * boot, no Chromium gate).
 */

import type { ChangelogRelease, ChangelogEntry, ChangelogCredit } from './changelog.data';

const SITE_URL = 'https://atlas.onlyworlds.com';
const PAGE_URL = `${SITE_URL}/changelog`;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A short human date like "19 July 2026". */
function humanDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${d} ${months[m - 1]} ${y}`;
}

function renderCredit(credit: ChangelogCredit): string {
  // Honest verb per platform: a reddit/discord user REQUESTED it; a named
  // collaborator SHAPED it. Either way the person is credited, never profiled.
  const requested = credit.platform === 'reddit' || credit.platform === 'discord';
  const label = `${requested ? 'requested by' : 'with'} ${esc(credit.handle)}`;
  if (credit.threadUrl) {
    // Link the THREAD (the context), never a profile. rel=ugc + noopener.
    return `<a class="cl-credit" href="${esc(credit.threadUrl)}" target="_blank" rel="ugc noopener">${label}</a>`;
  }
  return `<span class="cl-credit">${label}</span>`;
}

function renderEntry(entry: ChangelogEntry): string {
  const tags = entry.tags
    .map(t => `<span class="cl-tag">${esc(t)}</span>`)
    .join('');
  const body = entry.body ? `<p class="cl-entry-body">${esc(entry.body)}</p>` : '';
  const credit = entry.credit ? `<div class="cl-entry-credit">${renderCredit(entry.credit)}</div>` : '';
  // No `data-community` hook: its only consumer was the unrendered filter,
  // removed in S323. The credit itself still renders, visibly, below.
  return `
        <li class="cl-entry" id="${esc(entry.id)}">
          <div class="cl-entry-head">
            <a class="cl-entry-anchor" href="#${esc(entry.id)}" aria-label="Link to this change">#</a>
            <h3 class="cl-entry-title">${esc(entry.title)}</h3>
            <span class="cl-tags">${tags}</span>
          </div>
          ${body}
          ${credit}
        </li>`;
}

function renderRelease(release: ChangelogRelease): string {
  const entries = release.entries.map(renderEntry).join('');
  return `
      <section class="cl-release">
        <header class="cl-release-head">
          <div class="cl-release-line">
            <span class="cl-version">v${esc(release.version)}</span>
            <span class="cl-release-theme">${esc(release.theme)}</span>
          </div>
          <time class="cl-release-date" datetime="${esc(release.date)}">${humanDate(release.date)}</time>
        </header>
        <ul class="cl-entries">${entries}</ul>
      </section>`;
}

const STYLE = `
  :root {
    --cl-bg: #0a0a0a;
    --cl-panel: #121212;
    --cl-ink: #ececec;
    --cl-soft: rgba(236, 236, 236, 0.66);
    --cl-dim: rgba(236, 236, 236, 0.4);
    --cl-cyan: #22d3ee;
    --cl-cyan-soft: rgba(34, 211, 238, 0.14);
    --cl-line: rgba(236, 236, 236, 0.1);
    --cl-warm: #eab308;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    background: var(--cl-bg);
    color: var(--cl-ink);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; }
  .cl-wrap { max-width: 760px; margin: 0 auto; padding: 64px 24px 120px; }

  .cl-masthead { margin-bottom: 40px; }
  .cl-brandrow { display: flex; align-items: baseline; gap: 12px; }
  .cl-brand {
    font-size: 26px; font-weight: 600; letter-spacing: -0.01em;
  }
  .cl-brand a { text-decoration: none; }
  .cl-brand .cl-slash { color: var(--cl-dim); font-weight: 400; margin: 0 2px; }
  .cl-brand .cl-word { color: var(--cl-cyan); }
  /* S323: the masthead toolbar (community stat + an all/community filter
     pair) had a full set of styles, a body.cl-filtered mechanism and a
     per-entry data-community hook, and was never rendered by any code path.
     Removed rather than built: there is one credited entry in the whole log,
     so a filter would be chrome standing in front of a single result. The
     styles are in git if community entries ever earn the toolbar back.
     NOTE: this block lives inside a template literal, so no backticks. */

  .cl-release { margin-top: 44px; }
  .cl-release-head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 16px;
    margin-bottom: 4px;
  }
  .cl-release-line { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
  .cl-version {
    font-size: 18px; font-weight: 600; color: var(--cl-cyan); letter-spacing: 0.01em;
  }
  .cl-release-theme { color: var(--cl-soft); font-size: 15px; text-transform: lowercase; }
  .cl-release-date { color: var(--cl-dim); font-size: 12.5px; white-space: nowrap; }

  .cl-entries { list-style: none; margin: 16px 0 0; padding: 0; }
  .cl-entry {
    background: var(--cl-panel); border: 1px solid var(--cl-line); border-radius: 10px;
    padding: 16px 18px; margin-bottom: 10px; scroll-margin-top: 24px;
    transition: border-color 240ms ease, box-shadow 240ms ease, background 240ms ease;
  }
  .cl-entry-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .cl-entry-anchor {
    color: var(--cl-dim); text-decoration: none; font-weight: 600; opacity: 0;
    transition: opacity 120ms ease; margin-left: -18px; width: 18px;
  }
  .cl-entry:hover .cl-entry-anchor, .cl-entry:target .cl-entry-anchor { opacity: 1; }
  .cl-entry-anchor:hover { color: var(--cl-cyan); }
  .cl-entry-title { margin: 0; font-size: 15.5px; font-weight: 600; }
  .cl-tags { display: inline-flex; gap: 6px; margin-left: auto; flex-wrap: wrap; }
  .cl-tag {
    font-size: 11px; text-transform: lowercase; color: var(--cl-cyan);
    background: var(--cl-cyan-soft); border-radius: 999px; padding: 2px 9px;
  }
  .cl-entry-body { margin: 8px 0 0; color: var(--cl-soft); font-size: 14px; }
  .cl-entry-credit { margin-top: 10px; }
  .cl-credit {
    display: inline-block; font-size: 12px; color: var(--cl-warm);
    text-decoration: none; border-bottom: 1px solid transparent;
  }
  a.cl-credit:hover { border-bottom-color: var(--cl-warm); }

  /* :target arrival glow — the whole point of shareable per-entry links. */
  .cl-entry:target {
    border-color: var(--cl-cyan);
    box-shadow: 0 0 0 1px var(--cl-cyan), 0 0 28px rgba(34, 211, 238, 0.22);
    animation: cl-glow 1.8s ease-out 1;
  }
  @keyframes cl-glow {
    0% { box-shadow: 0 0 0 1px var(--cl-cyan), 0 0 40px rgba(34, 211, 238, 0.5); }
    100% { box-shadow: 0 0 0 1px var(--cl-cyan), 0 0 28px rgba(34, 211, 238, 0.22); }
  }

  .cl-foot { margin-top: 56px; padding-top: 20px; border-top: 1px solid var(--cl-line); color: var(--cl-dim); font-size: 12.5px; }
  .cl-foot a { color: var(--cl-soft); text-decoration: none; }
  .cl-foot a:hover { color: var(--cl-cyan); }

  @media (max-width: 560px) {
    .cl-wrap { padding: 40px 18px 90px; }
    .cl-release-head { flex-direction: column; }
    .cl-tags { margin-left: 0; width: 100%; }
  }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    .cl-entry:target { animation: none; }
  }
`;

/**
 * Entry ids are global permalinks (#anchor). Two entries sharing an id would
 * make that anchor ambiguous (it jumps to whichever renders first), so the
 * build fails loudly here rather than shipping a silent collision. This is what
 * long-terms the anchors: a generic slug reused in a later release is a build
 * error naming both versions, not a duplicate nobody notices.
 */
export function assertUniqueEntryIds(releases: ChangelogRelease[]): void {
  const seen = new Map<string, string>();
  for (const r of releases) {
    for (const e of r.entries) {
      const prior = seen.get(e.id);
      if (prior) {
        throw new Error(
          `changelog: duplicate entry id "${e.id}" (in v${prior} and v${r.version}). ` +
          `Ids are permalinks and must be globally unique across all releases.`,
        );
      }
      seen.set(e.id, r.version);
    }
  }
}

/** RFC 822 date for RSS pubDate, from an ISO day (noon UTC — the changelog
 *  records days, not moments; a fixed hour keeps the output stable). */
function rfc822(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.toUTCString();
}

/**
 * RSS 2.0 feed — one item per ENTRY, so a combined ecosystem feed (Skeld's
 * what's-new, 2026-07-24) can interleave items across tools without
 * unpacking releases. Item shape, kept deliberately boring and shareable:
 * title = entry title, link + guid = the entry's permalink anchor,
 * description = body, category = tags, pubDate = the release day.
 * Pure like renderChangelog; the build script writes it to
 * public/changelog-feed.xml.
 */
export function renderChangelogFeed(releases: ChangelogRelease[]): string {
  assertUniqueEntryIds(releases);
  const items = releases.flatMap(r => r.entries.map(e => `
    <item>
      <title>${esc(e.title)}</title>
      <link>${PAGE_URL}.html#${esc(e.id)}</link>
      <guid isPermaLink="true">${PAGE_URL}.html#${esc(e.id)}</guid>
      <pubDate>${rfc822(r.date)}</pubDate>
      ${e.body ? `<description>${esc(e.body)}</description>` : ''}
      ${e.tags.map(t => `<category>${esc(t)}</category>`).join('')}
    </item>`));
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Atlas Changelog</title>
    <link>${PAGE_URL}.html</link>
    <atom:link href="${SITE_URL}/changelog-feed.xml" rel="self" type="application/rss+xml" />
    <description>What is new in Atlas, the local-first OnlyWorlds world editor. Every change, credited.</description>
    <language>en</language>
    ${releases.length ? `<lastBuildDate>${rfc822(releases[0].date)}</lastBuildDate>` : ''}
    ${items.join('')}
  </channel>
</rss>
`;
}

export function renderChangelog(releases: ChangelogRelease[]): string {
  assertUniqueEntryIds(releases);
  const body = releases.map(renderRelease).join('');
  const desc = 'What is new in Atlas, the local-first OnlyWorlds world editor. Every change, credited.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Changelog · Atlas · OnlyWorlds</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="icon" type="image/x-icon" href="/favicon.ico" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <meta name="theme-color" content="#0a0a0a" />
  <meta property="og:title" content="Atlas Changelog" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${PAGE_URL}" />
  <meta property="og:image" content="${SITE_URL}/og.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Atlas Changelog" />
  <meta name="twitter:description" content="${esc(desc)}" />
  <meta name="twitter:image" content="${SITE_URL}/og.png" />
  <link rel="alternate" type="application/rss+xml" title="Atlas Changelog" href="${SITE_URL}/changelog-feed.xml" />
  <style>${STYLE}</style>
</head>
<body>
  <main class="cl-wrap">
    <header class="cl-masthead">
      <div class="cl-brandrow">
        <div class="cl-brand"><a href="${SITE_URL}">Atlas<span class="cl-slash">/</span><span class="cl-word">changelog</span></a></div>
      </div>
    </header>
    ${body}
    <footer class="cl-foot">
      <a href="${SITE_URL}">atlas.onlyworlds.com</a> · a local-first OnlyWorlds world editor
    </footer>
  </main>
</body>
</html>
`;
}
