/**
 * Emits the static ./changelog.html from the typed CHANGELOG data.
 * Run via `npm run changelog` (vite-node handles the TS + imports). Wired into
 * `npm run build` so the deployed page is always regenerated from source.
 *
 * The output is a second Vite entry (see vite.config.ts rollupOptions.input),
 * so `vite build` carries it into dist/ and dev serves it at /changelog.html.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHANGELOG } from '../src/changelog/changelog.data';
import { renderChangelog } from '../src/changelog/render-changelog';

const outPath = fileURLToPath(new URL('../changelog.html', import.meta.url));
const html = renderChangelog(CHANGELOG);
writeFileSync(outPath, html, 'utf8');

const entries = CHANGELOG.reduce((n, r) => n + r.entries.length, 0);
console.log(`changelog: wrote ${outPath} (${CHANGELOG.length} releases, ${entries} entries)`);
