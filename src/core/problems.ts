/**
 * Problems: what went wrong, in the user's words (S368, lane X stage 1).
 *
 * The rule: UI never reads `err.message`. It calls `problemFor(err, { doing })`
 * and renders the sentence and the fix buttons. Only a `PlainError` (a message
 * already written for users) passes through as its own sentence.
 *
 * Disk kinds switch on `err.name`: the File System Access DOMException names
 * are stable across browser versions and locales; their messages are not.
 * Server kinds lift the sync engine's typed checks rather than copying them.
 *
 * `buildDetails` / `scrubForReport` make the block behind "Details": it goes
 * into a PUBLIC feedback issue, so it carries no world name, element name,
 * field value, PIN or key. Pure: no DOM.
 */
import pkg from '../../package.json';
import { PlainError, isPlainError } from './plain-error';
import { damagedFileSentence, isFileBusyError } from '../store/fs-utils';
import { isAuthError, isTransientError } from '../sync/sync-engine';

export { PlainError, isPlainError };

export type ProblemKind =
  | 'disk-busy'
  | 'disk-permission'
  | 'disk-missing'
  | 'disk-full'
  | 'disk-damaged'
  | 'tab-lock'
  | 'auth'
  | 'offline'
  | 'server-busy'
  | 'server-refused'
  | 'server'
  | 'cancelled'
  | 'refused'
  | 'bug';

/** A button a problem can offer. Resolved to actions by `ui/problem-fixes.ts`. */
export type FixId =
  | 'retry'
  | 'allow-access'
  | 'new-ids'
  | 'open-settings'
  | 'reload-from-disk'
  | 'copy-details'
  | 'send-feedback';

export interface Problem {
  kind: ProblemKind;
  /** The sentence the user reads. Never contains the raw error text. */
  sentence: string;
  fixes: FixId[];
  /** The original error, for the details block and the console. */
  raw: unknown;
  /** What Atlas was doing, a short gerund phrase ("saving this scene"). */
  doing: string;
  /** Worth a details block (and a feedback report): the cause is not the user's to fix. */
  report: boolean;
  /** Nothing to say (the user cancelled). */
  quiet: boolean;
}

/**
 * Refusals whose class cannot extend `PlainError` from here (their module is
 * owned elsewhere) but whose messages are user copy all the same.
 */
const REFUSAL_NAMES = new Set(['MergeRefusedError']);

function nameOf(err: unknown): string {
  const n = (err as { name?: unknown } | null)?.name;
  return typeof n === 'string' ? n : '';
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  const m = (err as { message?: unknown } | null)?.message;
  return typeof m === 'string' ? m : String(err);
}

/** HTTP status from a typed server error, or from the legacy "API Error NNN:" prefix. */
function serverStatus(err: unknown): number | null {
  const s = (err as { status?: unknown } | null)?.status;
  if (typeof s === 'number' && typeof (err as { code?: unknown }).code === 'string') return s;
  if (!(err instanceof Error)) return null;
  const m = /^API Error (\d{3})\b/.exec(err.message);
  return m ? Number(m[1]) : null;
}

function isNetworkTypeError(err: unknown): boolean {
  return err instanceof TypeError && /fetch|network/i.test(err.message);
}

export function classifyError(err: unknown): ProblemKind {
  if (isPlainError(err) || REFUSAL_NAMES.has(nameOf(err))) return 'refused';
  const name = nameOf(err);
  if (name === 'AbortError') return 'cancelled';
  if (name === 'CorruptFileError') return 'disk-damaged';
  if (name === 'ELockHeld') return 'tab-lock';
  if (isFileBusyError(err) || name === 'InvalidModificationError') return 'disk-busy';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'disk-permission';
  if (name === 'NotFoundError') return 'disk-missing';
  if (name === 'QuotaExceededError') return 'disk-full';
  // A DOMException of any other name is the browser's, not the server's.
  if (typeof DOMException === 'function' && err instanceof DOMException) return 'bug';
  if (isNetworkTypeError(err)) return 'offline';
  const status = serverStatus(err);
  if (status !== null) {
    if (isAuthError(err)) return 'auth';
    if (isTransientError(err)) return 'server-busy';
    if (status >= 500) return 'server';
    if (status >= 400) return 'server-refused';
  }
  return 'bug';
}

const DEFAULT_DOING = 'doing that';

function sentenceFor(kind: ProblemKind, err: unknown, doing: string): string {
  switch (kind) {
    case 'refused': return messageOf(err);
    case 'cancelled': return '';
    case 'disk-busy':
      return `Another program is using a file in this world's folder, so Atlas could not finish ${doing}. A cloud sync app such as OneDrive or Dropbox often does this. Wait a moment, then try again.`;
    case 'disk-permission':
      return `Atlas does not have permission to change this world's folder, so it could not finish ${doing}. Allow access, then try again.`;
    case 'disk-missing':
      return `Atlas could not find a file it needed while ${doing}. If this world's folder was moved or renamed, open it again from the sidebar. Your other worlds are fine.`;
    case 'disk-full':
      return `Your disk is full, so Atlas could not finish ${doing}. Free some space, then try again.`;
    case 'disk-damaged': {
      const file = (err as { fileName?: unknown }).fileName;
      return damagedFileSentence(typeof file === 'string' && file ? file : 'A file');
    }
    case 'tab-lock':
      return 'Another Atlas tab still has this world open. Close that tab, then try again.';
    case 'auth':
      return `OnlyWorlds did not accept this world's key or your PIN, so Atlas could not finish ${doing}. Check your PIN in Settings, or reopen the world from the sidebar.`;
    case 'offline':
      return `OnlyWorlds could not be reached while Atlas was ${doing}. Your changes are saved in the folder. Check your connection, then try again.`;
    case 'server-busy':
      return `OnlyWorlds is busy, so Atlas could not finish ${doing}. Your changes are saved in the folder. Try again in a minute.`;
    case 'server-refused':
      return `OnlyWorlds did not accept a change while Atlas was ${doing}. It stays saved in your folder. If this keeps happening, send the details as feedback.`;
    case 'server':
      return `OnlyWorlds had a problem on its side while Atlas was ${doing}. Your changes are saved in the folder. Try again in a while.`;
    case 'bug':
    default:
      return `Atlas ran into a problem it did not expect while ${doing}. Send the details as feedback so it can be fixed.`;
  }
}

const FIXES: Record<ProblemKind, FixId[]> = {
  'disk-busy': ['retry'],
  'disk-permission': ['allow-access'],
  'disk-missing': [],
  'disk-full': ['retry'],
  'disk-damaged': ['reload-from-disk'],
  'tab-lock': ['retry'],
  auth: ['open-settings'],
  offline: ['retry'],
  'server-busy': ['retry'],
  'server-refused': ['copy-details', 'send-feedback'],
  server: ['retry'],
  cancelled: [],
  refused: [],
  bug: ['retry', 'copy-details', 'send-feedback'],
};

const REPORTED = new Set<ProblemKind>(['disk-busy', 'disk-full', 'disk-damaged', 'server-refused', 'server', 'bug']);

export function problemFor(err: unknown, opts: { doing?: string } = {}): Problem {
  const doing = opts.doing?.trim() || DEFAULT_DOING;
  const kind = classifyError(err);
  return {
    kind,
    sentence: sentenceFor(kind, err, doing),
    fixes: FIXES[kind].slice(),
    raw: err,
    doing,
    report: REPORTED.has(kind),
    quiet: kind === 'cancelled',
  };
}

// ---------------------------------------------------------------------------
// Shown once: a failure toasted at its source is not toasted again upstream.
// ---------------------------------------------------------------------------

const shown = new WeakSet<object>();

export function markProblemShown(err: unknown): void {
  if (err && typeof err === 'object') shown.add(err);
}

export function problemWasShown(err: unknown): boolean {
  return !!err && typeof err === 'object' && shown.has(err);
}

// ---------------------------------------------------------------------------
// Details: the block behind "Details", "Copy details" and "Send feedback".
// ---------------------------------------------------------------------------

export const REPORT_CAP = 600;

/**
 * Strip what could identify a world or a person from error text bound for a
 * public report. Errs on the side of removing too much.
 */
export function scrubForReport(text: string): string {
  let t = String(text ?? '');
  t = t.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>');
  t = t.replace(/\bow_[wra]_\S+/gi, '<key>');
  t = t.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>');
  // Element files are named "<name slug>--<id tail>.json": the slug is the name.
  t = t.replace(/[\w.-]*\w--[\w.-]+/g, '<file>');
  t = t.replace(/\?[^\s=&#]+=[^\s#]*/g, '?<query>');
  t = t.replace(/\d{10,}/g, '<number>');
  t = t.replace(/"[^"\n]*"/g, '"…"');
  t = t.replace(/'[^'\n]*'/g, '"…"');
  if (t.length > REPORT_CAP) t = t.slice(0, REPORT_CAP - 1) + '…';
  return t;
}

interface UaBrand { brand: string; version: string }
interface NavLike {
  userAgent?: string;
  userAgentData?: { brands?: UaBrand[]; platform?: string };
}

/** "Chrome 141, Windows": the browser and system, nothing finer. */
export function describeBrowser(nav: NavLike | undefined = globalThis.navigator as NavLike | undefined): string {
  if (!nav) return 'unknown';
  const ua = nav.userAgent ?? '';
  const brands = nav.userAgentData?.brands ?? [];
  const real = brands.filter(b => !/not.?a.?brand/i.test(b.brand));
  const named = real.find(b => b.brand !== 'Chromium') ?? real[0];
  let browser = named ? `${named.brand.replace(/^Google /, '')} ${named.version}` : '';
  if (!browser) {
    const m = /Edg\/(\d+)/.exec(ua) ? ['Edge', /Edg\/(\d+)/.exec(ua)![1]]
      : /Firefox\/(\d+)/.exec(ua) ? ['Firefox', /Firefox\/(\d+)/.exec(ua)![1]]
      : /Chrome\/(\d+)/.exec(ua) ? ['Chrome', /Chrome\/(\d+)/.exec(ua)![1]]
      : /Version\/(\d+).*Safari/.exec(ua) ? ['Safari', /Version\/(\d+)/.exec(ua)![1]]
      : null;
    browser = m ? `${m[0]} ${m[1]}` : 'unknown browser';
  }
  const platform = nav.userAgentData?.platform
    || (/Windows/.test(ua) ? 'Windows'
      : /Android/.test(ua) ? 'Android'
      : /iPhone|iPad/.test(ua) ? 'iOS'
      : /Mac OS/.test(ua) ? 'macOS'
      : /Linux/.test(ua) ? 'Linux'
      : '');
  return platform ? `${browser}, ${platform}` : browser;
}

export interface DetailsContext {
  /** The open world's kind: linked to OnlyWorlds, local only, or none open. */
  world?: 'linked' | 'local' | 'none';
  syncPaused?: boolean;
  /** Further lines (already free of names): scrubbed again and capped. */
  extra?: string[];
  now?: Date;
  browser?: string;
}

function headerLines(ctx: DetailsContext): string[] {
  const world = ctx.world === 'linked' ? `linked, sync ${ctx.syncPaused ? 'paused' : 'on'}`
    : ctx.world === 'local' ? 'local'
    : 'none open';
  return [
    `Atlas ${pkg.version}`,
    `Browser: ${ctx.browser ?? describeBrowser()}`,
    `World: ${world}`,
  ];
}

function timeLine(ctx: DetailsContext): string {
  return `Time: ${(ctx.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
}

/** The error as one scrubbed line. A refusal's text is user copy and can name things, so only its name goes. */
export function errorLine(err: unknown): string {
  const name = nameOf(err) || (typeof err === 'object' ? 'Error' : typeof err);
  if (isPlainError(err) || REFUSAL_NAMES.has(nameOf(err))) return `${name}`;
  return `${name}: ${scrubForReport(messageOf(err))}`;
}

export function buildDetails(problem: Problem, ctx: DetailsContext = {}): string {
  const lines = [
    ...headerLines(ctx),
    `While: ${problem.doing}`,
    `Kind: ${problem.kind}`,
    `Error: ${errorLine(problem.raw)}`,
    ...(ctx.extra ?? []).map(scrubForReport),
    timeLine(ctx),
  ];
  return lines.join('\n');
}

/** The same block for a sync round's per-element failures (at most three listed). */
export function buildFailureDetails(
  failures: readonly { type?: string; operation?: string; error_name?: string; message?: string }[],
  ctx: DetailsContext = {},
): string {
  const listed = failures.slice(0, 3).map(f =>
    `- ${f.type ?? 'element'} ${f.operation ?? 'change'}: ${f.error_name ? `${f.error_name}: ` : ''}${scrubForReport(f.message ?? '')}`);
  const more = failures.length > 3 ? [`and ${failures.length - 3} more`] : [];
  return [
    ...headerLines(ctx),
    'While: syncing with OnlyWorlds',
    `Failed: ${failures.length}`,
    ...listed,
    ...more,
    ...(ctx.extra ?? []).map(scrubForReport),
    timeLine(ctx),
  ].join('\n');
}
