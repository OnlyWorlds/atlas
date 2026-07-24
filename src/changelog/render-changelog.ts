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
  const communityAttr = entry.credit ? ' data-community="1"' : '';
  return `
        <li class="cl-entry" id="${esc(entry.id)}"${communityAttr}>
          <div class="cl-entry-head">
            <a class="cl-entry-anchor" href="#${esc(entry.id)}" aria-label="link to this change">#</a>
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
    font-size: 26px; font-weight: 600; letter-spacing: -0.01em; text-transform: lowercase;
  }
  .cl-brand a { text-decoration: none; }
  .cl-brand .cl-slash { color: var(--cl-dim); font-weight: 400; margin: 0 2px; }
  .cl-brand .cl-word { color: var(--cl-cyan); }
  .cl-tagline { color: var(--cl-soft); margin: 10px 0 0; font-size: 14.5px; }

  .cl-toolbar {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    margin-top: 22px; padding-top: 20px; border-top: 1px solid var(--cl-line);
  }
  .cl-community-stat { color: var(--cl-soft); font-size: 13px; }
  .cl-community-stat b { color: var(--cl-ink); font-weight: 600; }
  .cl-filters { display: inline-flex; gap: 6px; margin-left: auto; }
  .cl-filter {
    appearance: none; border: 1px solid var(--cl-line); background: transparent;
    color: var(--cl-soft); font: inherit; font-size: 12.5px; text-transform: lowercase;
    padding: 4px 12px; border-radius: 999px; cursor: pointer; transition: all 120ms ease;
  }
  .cl-filter:hover { color: var(--cl-ink); border-color: var(--cl-soft); }
  .cl-filter[aria-pressed='true'] {
    color: var(--cl-cyan); border-color: var(--cl-cyan); background: var(--cl-cyan-soft);
  }

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

  /* Community filter (progressive enhancement; no JS => all entries show). */
  body.cl-filtered .cl-entry:not([data-community]) { display: none; }
  body.cl-filtered .cl-release:not(:has(.cl-entry[data-community])) { display: none; }

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

const FILTER_SCRIPT = `
  (function () {
    var buttons = document.querySelectorAll('.cl-filter');
    function apply(mode) {
      document.body.classList.toggle('cl-filtered', mode === 'community');
      buttons.forEach(function (b) {
        b.setAttribute('aria-pressed', b.dataset.filter === mode ? 'true' : 'false');
      });
    }
    buttons.forEach(function (b) {
      b.addEventListener('click', function () { apply(b.dataset.filter); });
    });
  })();
`;

export function renderChangelog(releases: ChangelogRelease[]): string {
  const communityCount = releases.reduce(
    (n, r) => n + r.entries.filter(e => e.credit).length,
    0,
  );
  const communityStat = communityCount > 0
    ? `<span class="cl-community-stat"><b>${communityCount}</b> ${communityCount === 1 ? 'change' : 'changes'} shaped with the community</span>`
    : '';
  const filters = communityCount > 0
    ? `<div class="cl-filters" role="group" aria-label="filter changes">
          <button class="cl-filter" data-filter="all" aria-pressed="true">all</button>
          <button class="cl-filter" data-filter="community" aria-pressed="false">community</button>
        </div>`
    : '';
  const toolbar = (communityStat || filters)
    ? `<div class="cl-toolbar">${communityStat}${filters}</div>`
    : '';

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
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="Atlas Changelog" />
  <meta name="twitter:description" content="${esc(desc)}" />
  <!-- og:image lands with the shared 1200x630 card asset (owed, Captain's pick). -->
  <style>${STYLE}</style>
</head>
<body>
  <main class="cl-wrap">
    <header class="cl-masthead">
      <div class="cl-brandrow">
        <div class="cl-brand"><a href="${SITE_URL}">atlas<span class="cl-slash">/</span><span class="cl-word">changelog</span></a></div>
      </div>
      <p class="cl-tagline">Every change to Atlas, newest first. Anything shaped by a request is credited.</p>
      ${toolbar}
    </header>
    ${body}
    <footer class="cl-foot">
      <a href="${SITE_URL}">atlas.onlyworlds.com</a> · a local-first OnlyWorlds world editor
    </footer>
  </main>
  <script>${FILTER_SCRIPT}</script>
</body>
</html>
`;
}
