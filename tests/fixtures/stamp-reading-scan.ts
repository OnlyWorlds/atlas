/**
 * Finds the lines of a source that ORDER a time read from an element's stamp
 * by its text: a `<`, `>`, `<=` or `>=` with a stamp on either side, a
 * `localeCompare` with a stamp as its receiver or argument, or a `Date.parse`
 * of a stamp. The stamp guard (`tests/unit/stamp-order-guard.test.ts`) runs it
 * over all of `src` (DESIGN_LAWS conv. 190).
 *
 * A stamp is an operand that reads a field (`local_updated_at`,
 * `server_updated_at`, `updated_at`, `deleted_at`, `created_at`, and the
 * adapter's `updatedAt`, `deletedAt`, `createdAt`), possibly behind a `??` or
 * `||` fallback, a cast or parentheses; a name that holds one in the same file
 * (`const baseline = local.server_updated_at ?? ''`, `{ updated_at: ts } =
 * remote`, followed to a fixpoint); or a name that says it is one
 * (`serverStamp`, `sentLocalUpdatedAt`, `baseline`). Names alias, so a search
 * for the field alone missed the change feed's `serverStamp > baseline`.
 *
 * Against accidents, not adversaries: a stamp passed through a function of
 * another name, or held in a name that says nothing about it and is set in
 * another file, is not followed. Comments are not code (block comments
 * tracked across lines).
 */

export const STAMP_FIELDS: readonly string[] = [
  'local_updated_at', 'server_updated_at', 'updated_at', 'deleted_at', 'created_at',
  'updatedAt', 'deletedAt', 'createdAt',
];

/** A name that says it holds a stamp. */
const STAMPISH_NAME = /^(?:[a-z_$][\w$]*(?:UpdatedAt|DeletedAt|CreatedAt|Stamp|Baseline)|(?:stamp|baseline)(?:[A-Z][\w$]*)?)$/;

export interface StampReading { line: number; kind: 'compare' | 'localeCompare' | 'Date.parse'; text: string }

/** Where a block comment opens on a line, skipping a `/*` inside a quoted string, or -1. */
function blockOpen(line: string): number {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
    if (c === '/' && line[i + 1] === '/') return -1;
    if (c === '/' && line[i + 1] === '*') return i;
  }
  return -1;
}

/** Each source line's code (comments out), by 0-based index; an empty string for a line with none. */
function codeByLine(source: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split('\n')) {
    let line = raw;
    let code = '';
    for (;;) {
      if (inBlock) {
        const close = line.indexOf('*/');
        if (close === -1) { line = ''; break; }
        line = line.slice(close + 2);
        inBlock = false;
      }
      const open = blockOpen(line);
      if (open === -1) { code += line; break; }
      code += line.slice(0, open);
      line = line.slice(open + 2);
      inBlock = true;
    }
    // A line comment after code: cut it, outside a string.
    let quote: string | null = null;
    let cut = code.length;
    for (let i = 0; i < code.length; i++) {
      const c = code[i];
      if (quote) { if (c === '\\') { i++; continue; } if (c === quote) quote = null; continue; }
      if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
      if (c === '/' && code[i + 1] === '/') { cut = i; break; }
    }
    out.push(code.slice(0, cut).replace(/\r$/, ''));
  }
  return out;
}

const OPENER: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
const CLOSER: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/** The operand ending just before `end`: a dotted name, a call, a bracketed group. */
function operandLeft(s: string, end: number): string {
  let i = end - 1;
  while (i >= 0 && s[i] === ' ') i--;
  const stop = i + 1;
  while (i >= 0) {
    const c = s[i];
    if (OPENER[c]) {
      let depth = 0;
      for (; i >= 0; i--) {
        if (s[i] === c) depth++;
        else if (s[i] === OPENER[c] && --depth === 0) break;
      }
      i--;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      const q = c; i--;
      while (i >= 0 && s[i] !== q) i--;
      i--;
      continue;
    }
    if (/[\w$.?!]/.test(c)) { i--; continue; }
    break;
  }
  return s.slice(i + 1, stop);
}

/** The operand starting at `start`: a dotted name, a call, a bracketed group, a string. */
function operandRight(s: string, start: number): string {
  let i = start;
  while (i < s.length && s[i] === ' ') i++;
  const from = i;
  while (i < s.length) {
    const c = s[i];
    if (CLOSER[c]) {
      let depth = 0;
      for (; i < s.length; i++) {
        if (s[i] === c) depth++;
        else if (s[i] === CLOSER[c] && --depth === 0) break;
      }
      i++;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      const q = c; i++;
      while (i < s.length && s[i] !== q) { if (s[i] === '\\') i++; i++; }
      i++;
      continue;
    }
    if (/[\w$.!]/.test(c) || (c === '?' && s[i + 1] === '.')) { i++; continue; }
    break;
  }
  return s.slice(from, i);
}

/** `e` split on a top-level `??` or `||` (outside brackets and strings). */
function splitFallbacks(e: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let from = 0;
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (quote) { if (c === '\\') { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
    if (CLOSER[c]) depth++;
    else if (OPENER[c]) depth--;
    else if (depth === 0 && ((c === '?' && e[i + 1] === '?') || (c === '|' && e[i + 1] === '|'))) {
      parts.push(e.slice(from, i));
      from = i + 2;
      i++;
    }
  }
  parts.push(e.slice(from));
  return parts;
}

/** Whether an operand is a stamp: a stamp field read, a stamp name, behind fallbacks, casts and parentheses. */
function isStampOperand(expr: string, names: ReadonlySet<string>): boolean {
  let e = expr.trim().replace(/^await\s+/, '');
  for (;;) {
    // Parentheses and a `String(…)` around a stamp are the stamp.
    const wrapped = e.match(/^(?:String)?\(/);
    if (!wrapped || operandRight(e, 0) !== e || !e.endsWith(')')) break;
    e = e.slice(wrapped[0].length, -1).trim();
  }
  const parts = splitFallbacks(e);
  if (parts.length > 1) return parts.some(p => isStampOperand(p, names));
  e = e.replace(/\s+as\s+[\w$<>[\]|. ]+$/, '').replace(/!+$/, '').trim();
  const quoted = e.match(/\[\s*['"`]([\w$]+)['"`]\s*\]$/);
  if (quoted) return STAMP_FIELDS.includes(quoted[1]);
  const m = e.match(/(?:^|\.|\?\.)([A-Za-z_$][\w$]*)$/);
  if (!m) return false;
  const last = m[1];
  if (STAMP_FIELDS.includes(last)) return true;
  if (e === last && names.has(last)) return true;
  return STAMPISH_NAME.test(last);
}

/** Names in one source that hold a stamp read in it, to a fixpoint. */
function stampNames(lines: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    const add = (n: string) => { if (!names.has(n)) { names.add(n); changed = true; } };
    for (const l of lines) {
      for (const m of l.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=(?![=>])([^;]*)/g)) {
        if (isStampOperand(m[2], names)) add(m[1]);
      }
      for (const m of l.matchAll(/\{([^{}]*)\}\s*(?::[^=]*)?=(?![=>])/g)) {
        for (const part of m[1].split(',')) {
          const pair = part.trim().match(/^([\w$]+)\s*:\s*([\w$]+)/);
          if (pair && STAMP_FIELDS.includes(pair[1])) add(pair[2]);
        }
      }
      // A plain assignment at the start of a statement (never a type annotation's `x: T = …`).
      const assign = l.match(/^\s*(?:this\.)?(?:[\w$]+\.)*([A-Za-z_$][\w$]*)\s*=(?![=>])([^;]*)/);
      if (assign && isStampOperand(assign[2], names)) add(assign[1]);
    }
  }
  return names;
}

/** The names one source holds a stamp in (for reading a guard's finding). */
export function stampNamesOf(source: string): Set<string> {
  return stampNames(codeByLine(source));
}

/** Every line of `source` that orders a stamp by its text, 1-based. */
export function stampReadings(source: string): StampReading[] {
  const lines = codeByLine(source);
  const names = stampNames(lines);
  const out: StampReading[] = [];
  lines.forEach((l, idx) => {
    if (!l.trim()) return;
    const hit = (kind: StampReading['kind']) => out.push({ line: idx + 1, kind, text: l.trim() });
    for (const m of l.matchAll(/Date\.parse\(/g)) {
      const arg = operandRight(l, m.index! + m[0].length - 1);
      if (isStampOperand(arg, names)) { hit('Date.parse'); return; }
    }
    for (const m of l.matchAll(/\.localeCompare\(/g)) {
      const recv = operandLeft(l, m.index!);
      const arg = operandRight(l, m.index! + m[0].length - 1);
      if (isStampOperand(recv, names) || isStampOperand(arg, names)) { hit('localeCompare'); return; }
    }
    for (const m of l.matchAll(/(?<![=<>!-])(<=|>=|<|>)(?![=<>])/g)) {
      const at = m.index!;
      const left = operandLeft(l, at);
      const right = operandRight(l, at + m[1].length);
      if (isStampOperand(left, names) || isStampOperand(right, names)) { hit('compare'); return; }
    }
  });
  return out;
}
