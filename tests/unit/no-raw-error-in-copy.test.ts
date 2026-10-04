/**
 * The error-copy ratchet (S368, lane X): user copy never carries a caught
 * error's raw text, and never the vague or jargon phrases the census found.
 *
 * The rule the UI follows is `showProblem(err, { doing })` / `problemFor`:
 * the error is classified and worded, never read out. Fixing sites one by
 * one closes sites; this closes the class, a step at a time:
 *
 *   - A file's count may never RISE, and a new file may not appear.
 *   - A count that FALLS must be lowered in the baseline in the same change,
 *     so progress is locked in and cannot quietly slide back.
 *
 * Counted per line (comments and console.* lines are exempt; so is
 * `core/problems.ts`, which is where errors are allowed to be read):
 *   - a template interpolation reading `.message` (`${err.message}`),
 *   - `+ err.message` / `+ (e?.message ...` concatenation,
 *   - a toast call, or a textContent / title assignment, given `.message`
 *     or `String(err)`,
 *   - a string literal saying "check the console", "see console",
 *     "unknown error", "went wrong", "Engine not ready" or "active store".
 *
 * To lower the baseline after routing sites: run this file with
 * UPDATE_RAW_ERROR_BASELINE=1, then read the diff of the JSON.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const SCAN_DIRS = ['ui', 'middle', 'sidebar', 'tabs', 'setup', 'sync', 'core'].map(d => join(ROOT, 'src', d));
const BASELINE_PATH = join(ROOT, 'tests', 'unit', 'raw-error-baseline.json');
const EXEMPT_FILES = new Set(['src/core/problems.ts']);

const ERR = String.raw`(?:err|e|e2|err2|error|ex|reason|cause)`;
const RULES: RegExp[] = [
  /\$\{[^}`]*\.message\b[^}`]*\}/,
  /\+\s*\(*\s*\w+\??\.message\b/,
  new RegExp(String.raw`(?:toast\w*|toasts|toastManager)\.\w+\(.*(?:\b${ERR}\??\.message\b|String\(${ERR}\))`),
  new RegExp(String.raw`(?:textContent|innerText|\.title)\s*=.*(?:\b${ERR}\??\.message\b|String\(${ERR}\))`),
  // The census's commonest shape: the text read out into a variable or an argument.
  /instanceof Error\s*\?\s*\w+\.message\b/,
  /\(\s*\w+\s+as\s+Error\s*\)\??\.message\b/,
  new RegExp(String.raw`=\s*String\(${ERR}\)`),
  /check (?:the )?console|see console|unknown error|went wrong|engine not ready|active store/i,
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (s.isFile() && full.endsWith('.ts') && !full.endsWith('.test.ts')) yield full;
  }
}

/** Lines of one source that put raw error text (or a banned phrase) in front of a user. */
export function countRawErrorLines(source: string): number {
  let n = 0;
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
    if (line.includes('console.')) continue;
    // A trailing line comment is developer prose.
    const code = line.replace(/\s\/\/\s.*$/, '');
    if (RULES.some(r => r.test(code))) n++;
  }
  return n;
}

function scan(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const dir of SCAN_DIRS) {
    for (const file of walk(dir)) {
      const rel = relative(ROOT, file).split('\\').join('/');
      if (EXEMPT_FILES.has(rel)) continue;
      const n = countRawErrorLines(readFileSync(file, 'utf-8'));
      if (n > 0) counts[rel] = n;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

describe('raw error text never reaches user copy (ratchet)', () => {
  it('the patterns find the census shapes', () => {
    expect(countRawErrorLines("toasts.error(err instanceof Error ? err.message : String(err));")).toBe(1);
    expect(countRawErrorLines("toastManager.error('Save failed: ' + (err?.message ?? 'nope'));")).toBe(1);
    expect(countRawErrorLines("toastManager.error('Save failed: ' + ((err as Error)?.message ?? ''));")).toBe(1);
    expect(countRawErrorLines('toasts.error(`Failed to open ${entry.name}: ${err instanceof Error ? err.message : String(err)}`);')).toBe(1);
    expect(countRawErrorLines("statusEl.textContent = String(err);")).toBe(1);
    expect(countRawErrorLines("toasts.info('Engine not ready');")).toBe(1);
    expect(countRawErrorLines("toastManager.error('No active store');")).toBe(1);
    // Exempt: console lines and comments.
    expect(countRawErrorLines("console.warn('failed', err.message);")).toBe(0);
    expect(countRawErrorLines("// toasts.error(err.message) was the old way")).toBe(0);
    expect(countRawErrorLines("showProblem(err, { doing: 'saving this scene' });")).toBe(0);
  });

  it('no file rises above its baseline, and every fall is locked in', () => {
    const counts = scan();
    if (process.env.UPDATE_RAW_ERROR_BASELINE) {
      writeFileSync(BASELINE_PATH, JSON.stringify(counts, null, 2) + '\n', 'utf-8');
    }
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as Record<string, number>;
    const problems: string[] = [];
    for (const [file, n] of Object.entries(counts)) {
      const was = baseline[file];
      if (was === undefined) problems.push(`${file}: ${n} new raw-error line(s). Use showProblem(err, { doing }) instead.`);
      else if (n > was) problems.push(`${file}: ${n} raw-error lines, baseline ${was}. Use showProblem(err, { doing }) instead.`);
      else if (n < was) problems.push(`${file}: down to ${n} from ${was}. Lower the baseline to lock it in.`);
    }
    for (const [file, was] of Object.entries(baseline)) {
      if (!(file in counts)) problems.push(`${file}: down to 0 from ${was}. Remove it from the baseline.`);
    }
    expect(problems).toEqual([]);
  });
});
