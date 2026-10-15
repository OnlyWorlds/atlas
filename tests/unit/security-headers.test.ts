/**
 * The host's security headers (#302, Boss h57 #4741).
 *
 * `public/_headers` is the one home of the production policy: Cloudflare Pages
 * serves it, and `vite preview` serves its CSP line so a walk runs under it.
 * This guard holds three things a later change could break without a red:
 * - every origin Atlas fetches from is in connect-src (a new keel host or
 *   media edge left out would fail only on the live host, as a blocked fetch);
 * - the meta CSP in index.html (the dev server's guard, which serves no
 *   headers) never contradicts the header: both are enforced on the live page,
 *   so a looser header line would be silently overruled by the meta;
 * - the fetch call sites are counted, so a new one comes here first.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_V2_BASE } from '../../src/sync/ow-v2-client-adapter';

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

function headerBlock(path: string): Map<string, string> {
  const lines = read('public/_headers').split(/\r?\n/);
  const out = new Map<string, string>();
  let inBlock = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) { inBlock = line.trim() === path; continue; }
    if (!inBlock) continue;
    const i = line.indexOf(':');
    out.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }
  return out;
}

function directives(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out.set(name, sources);
  }
  return out;
}

const all = headerBlock('/*');
const csp = directives(all.get('content-security-policy') ?? '');

function tsFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((d) => {
    const p = `${dir}/${d.name}`;
    if (d.isDirectory()) return tsFiles(p);
    return d.name.endsWith('.ts') ? [p] : [];
  });
}

describe('public/_headers (#302)', () => {
  it('sends HSTS and a CSP on every path, and never noindex', () => {
    expect(all.get('strict-transport-security')).toMatch(/^max-age=\d{8,}/);
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('script-src')).toEqual(["'self'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(all.has('x-robots-tag')).toBe(false);
  });

  it('never lets a cache hold the service worker (Boss h11 #4978: the zone rewrote it to max-age=14400)', () => {
    expect(headerBlock('/sw.js').get('cache-control')).toBe('no-store');
  });

  it('draws a picture at any address, http included', () => {
    // A world's image_url can be any address. Firefox draws an http one on
    // today's page (it upgrades the request), but under `img-src https:` it
    // refuses it before the upgrade; Chromium upgrades first (S409 probe,
    // Notes/ui-snapshots/2026-10-15-s409/http-img-live.mjs, against live
    // Lantern's header).
    expect(csp.get('img-src')).toEqual(expect.arrayContaining(["'self'", 'data:', 'blob:', 'https:', 'http:']));
  });

  it('lets connect-src reach every origin Atlas fetches from', () => {
    const origins = [
      new URL(DEFAULT_V2_BASE).origin,
      // make-online's create-world-external and the media edge keep their
      // constants private: read them from the source.
      ...[...read('src/sync/make-online.ts').matchAll(/DEFAULT_OW_BASE = '([^']+)'/g)].map((m) => new URL(m[1]).origin),
      ...[...read('src/sync/media-upload.ts').matchAll(/EDGE_ORIGINS = \[([^\]]+)\]/g)]
        .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((s) => s[1])),
    ];
    expect(origins.length).toBe(3);
    const allowed = csp.get('connect-src') ?? [];
    for (const o of origins) expect(allowed, o).toContain(o);
  });

  it('agrees with the meta CSP on every directive the meta sets', () => {
    const meta = read('index.html').match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
    expect(meta).toBeTruthy();
    for (const [name, sources] of directives(meta!)) {
      expect(csp.get(name), name).toEqual(sources);
    }
  });

  it('counts the fetch call sites (a new one checks connect-src first)', () => {
    const sites = tsFiles('src').flatMap((f) =>
      read(f).split(/\r?\n/).filter((l) => /\bfetch\(/.test(l) && !/^\s*(\*|\/\/)/.test(l)).map((l) => `${f}: ${l.trim()}`));
    // eight today: keel v2 (adapter, account, join), worldsync, the media edge
    // twice, and the tour's own pictures twice (same origin).
    expect(sites, sites.join('\n')).toHaveLength(8);
  });
});
