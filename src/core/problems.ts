/**
 * Problems: what went wrong, in the user's words (lane X stage 1).
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
import { isAuthError, isHostBlocked, isHostRefusal, isPinParam, isTransientError, memberRefusal } from '../sync/sync-engine';
import { waitWords } from '../sync/rate-wait';
import { hostRefusalCause } from '../sync/sync-failure-copy';
import { keyRefusalOf } from '../sync/world-key-lines';
import { getState } from './state';
import { hasFolderMode } from './capabilities';
import { filesWhereOf, type FilesWhere } from './browser-worlds';
import { pinWhoOf, type PinWho } from './seat';

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
  /** The web host in front of OnlyWorlds refused the request before OnlyWorlds saw it (a 403 with no API code, conv. 191). */
  | 'host-refused'
  | 'server'
  | 'cancelled'
  | 'refused'
  /** A member seat's refusal (#104): someone else's element, or the world's own settings. */
  | 'not-yours'
  | 'bug';

/** A button a problem can offer. Resolved to actions by `ui/problem-fixes.ts`. */
export type FixId =
  | 'retry'
  | 'allow-access'
  | 'new-ids'
  | 'open-settings'
  | 'reload-from-disk'
  | 'sync-issues'
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
  // Before the status read: the host's 403 carries no API code, so the status
  // read passes it by and it would fall to 'bug', Atlas blamed for the host.
  if (isHostRefusal(err)) return 'host-refused';
  const status = serverStatus(err);
  if (status !== null) {
    if (memberRefusal(err)) return 'not-yours';
    if (isAuthError(err)) return 'auth';
    if (isTransientError(err)) return 'server-busy';
    if (status >= 500) return 'server';
    if (status >= 400) return 'server-refused';
  }
  return 'bug';
}

const DEFAULT_DOING = 'doing that';

/**
 * This browser's storage is full (contract §2.2). Moving a world to a folder
 * is offered only where folders exist (desktop Chromium).
 */
export function browserStorageFullSentence(doing: string): string {
  const way = hasFolderMode() ? 'Free some space or move a world to a folder' : 'Free some space';
  return `This browser's storage for Atlas is full, so Atlas could not finish ${doing}. ${way}, then try again.`;
}

function sentenceFor(kind: ProblemKind, err: unknown, doing: string, opts: ProblemOpts, where: FilesWhere): string {
  // True only where the failed step was an upload of edits already on disk:
  // "your changes are saved" is false for signing in or linking.
  const inBrowser = where === 'browser' && opts.folder !== 'picked';
  const savedPlace = inBrowser ? 'in this browser' : 'in the folder';
  const saved = opts.savedLocally ? ` Your changes are saved ${savedPlace}.` : '';
  switch (kind) {
    case 'refused': return messageOf(err);
    case 'cancelled': return '';
    case 'disk-busy':
      // In this browser only another Atlas tab (or a stale writer) holds a
      // file; never OneDrive (1.17, census §3.1).
      return inBrowser
        ? `Another Atlas tab may be saving to this world, so Atlas could not finish ${doing}. Wait a moment, then try again.`
        : `Another program is using a file in this world's folder, so Atlas could not finish ${doing}. A cloud sync app such as OneDrive or Dropbox often does this. Wait a moment, then try again.`;
    case 'disk-permission':
      return opts.folder === 'picked'
        ? `The browser did not let Atlas use that folder, so it could not finish ${doing}. Try again, and choose Allow when the browser asks.`
        : inBrowser
          ? `This window does not let Atlas use browser storage, so it could not finish ${doing}. If it is a private window, open Atlas in a normal one.`
          : `Atlas does not have permission to change this world's folder, so it could not finish ${doing}. Allow access, then try again.`;
    case 'disk-missing':
      return inBrowser
        ? `Atlas could not find a file it needed while ${doing}. The browser may have cleared some of its storage. Your other worlds are fine.`
        : `Atlas could not find a file it needed while ${doing}. If this world's folder was moved or renamed, open it again from the sidebar. Your other worlds are fine.`;
    case 'disk-full':
      return inBrowser
        ? browserStorageFullSentence(doing)
        : `Your disk is full, so Atlas could not finish ${doing}. Free some space, then try again.`;
    case 'disk-damaged': {
      const file = (err as { fileName?: unknown }).fileName;
      return damagedFileSentence(typeof file === 'string' && file ? file : 'A file', inBrowser ? 'browser' : 'folder');
    }
    case 'tab-lock':
      return 'Another Atlas tab still has this world open. Close that tab, then try again.';
    case 'not-yours':
      return memberRefusal(err) === 'owner_only'
        ? `Only the world's owner can change its details on OnlyWorlds, so Atlas could not finish ${doing}.${saved}`
        : `This world lets Atlas change only what it made, and someone else made this, so Atlas could not finish ${doing}.${saved}`;
    case 'auth':
      // keel's 403 for a read key on a write: the key, never the PIN. Its code
      // (`permission_error`) is keel's generic one, so its words narrow it.
      if (keyRefusalOf(err) === 'read_only_key' && err instanceof Error && /read-only/i.test(err.message)) {
        return `This world's key can only read, so Atlas could not finish ${doing}.${saved} Put in a write key in Settings, This world.`;
      }
      // The step sent no `API-Pin` (an invite, an account call, a read key's or the demo's download): its
      // refusal is the step's, never a PIN's or a seat secret's. One that may have left something behind
      // makes no claim about what changed.
      if (opts.noPin) return opts.noPin === 'may-have-left' ? `OnlyWorlds did not allow ${doing}.` : `OnlyWorlds did not allow ${doing}. Nothing changed.`;
      // keel named the PIN (401 `invalid_credentials`, param `API-Pin`): the PIN's own sentence. A seat
      // world sends its seat secret there, never the World PIN (R1), and has no PIN to put in again; not
      // known whose, the line names both.
      if (keyRefusalOf(err) === 'pin') {
        const who = pinWhoFor(opts);
        return who === 'seat' ? `OnlyWorlds did not accept this seat secret, so Atlas could not finish ${doing}.${saved}`
          : who === 'account' ? `OnlyWorlds did not accept this World PIN. Atlas could not finish ${doing}.${saved} Check the World PIN in Settings, under OnlyWorlds.`
          : `OnlyWorlds did not accept the World PIN or seat secret. Atlas could not finish ${doing}.${saved} Check it in Settings, under OnlyWorlds.`;
      }
      {
        const who = pinWhoFor(opts);
        return who === 'seat' ? `OnlyWorlds did not accept this world's key or its seat secret, so Atlas could not finish ${doing}.`
          : who === 'account' ? `OnlyWorlds did not accept this world's key or the World PIN, so Atlas could not finish ${doing}. Check the World PIN in Settings, under OnlyWorlds.`
          : `OnlyWorlds did not accept this world's key, or its World PIN or seat secret, so Atlas could not finish ${doing}. Check them in Settings, under OnlyWorlds.`;
      }
    case 'offline':
      return `OnlyWorlds could not be reached while Atlas was ${doing}.${saved} Check your connection, then try again.`;
    case 'server-busy': {
      // A 429 is OnlyWorlds asking for a wait, by keel's `param`: its PIN wall (ten different wrong PINs on
      // one key), or any other throttle. Its Retry-After says how long, when it came.
      const e = err as { status?: unknown; param?: unknown; retryAfterMs?: unknown; retryAfter?: unknown } | null;
      if (e?.status === 429) {
        const ms = typeof e.retryAfterMs === 'number' ? e.retryAfterMs
          : typeof e.retryAfter === 'number' ? e.retryAfter * 1000 : null;
        const when = ms === null ? 'a minute' : waitWords(ms);
        if (!isPinParam(e.param)) return `OnlyWorlds asked Atlas to wait, so Atlas could not finish ${doing}.${saved} Try again in ${when}.`;
        // keel counts different wrong values of API-Pin on one key: a seat's are its seat secrets.
        const who = pinWhoFor(opts);
        const lead = who === 'seat'
          ? "OnlyWorlds refused too many different seat secrets for this world's key, so it takes none for a while"
          : who === 'account'
            ? "OnlyWorlds refused too many different World PINs for this world's key, so it takes none for a while"
            : "OnlyWorlds refused too many different World PINs or seat secrets for this world's key, so it takes none for a while";
        const wall = `${lead}, and Atlas could not finish ${doing}.${saved}`;
        return who === 'seat' ? `${wall} Try again in ${when}.`
          : who === 'account' ? `${wall} Check the World PIN in Settings; try again in ${when}.`
          : `${wall} Check the World PIN or seat secret in Settings; try again in ${when}.`;
      }
      return `OnlyWorlds is busy, so Atlas could not finish ${doing}.${saved} Try again in a minute.`;
    }
    case 'server-refused':
      return `OnlyWorlds did not accept something while Atlas was ${doing}.${opts.savedLocally ? (inBrowser ? ' It stays saved in this browser.' : ' It stays saved in your folder.') : ''}${opts.inline ? '' : ' If this keeps happening, send the details as feedback.'}`;
    case 'host-refused':
      return `The web host in front of OnlyWorlds refused this before it reached OnlyWorlds, so Atlas could not finish ${doing}.${saved}${isHostBlocked(err) ? ` ${hostRefusalCause('then try again', opts.oneLine === true)}` : ''}`;
    case 'server':
      return `OnlyWorlds had a problem on its side while Atlas was ${doing}.${saved} Try again in a while.`;
    case 'bug':
    default:
      return opts.inline
        ? `Atlas ran into a problem it did not expect while ${doing}. Try again; if it keeps happening, tell us at onlyworlds.com/feedback.`
        : `Atlas ran into a problem it did not expect while ${doing}. Send the details as feedback so it can be fixed.`;
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
  'host-refused': [],
  server: ['retry'],
  cancelled: [],
  refused: [],
  'not-yours': [],
  bug: ['retry', 'copy-details', 'send-feedback'],
};

const REPORTED = new Set<ProblemKind>(['disk-busy', 'disk-full', 'disk-damaged', 'server-refused', 'server', 'bug']);

export interface ProblemOpts {
  /** What Atlas was doing, a short lowercase gerund phrase. Never a name: it goes into a public report. */
  doing?: string;
  /** The failed step uploads edits already in the folder (a sync), so the sentence may say they are safe. */
  savedLocally?: boolean;
  /** `picked`: a folder the user was choosing, not the open world's (no Allow access button). */
  folder?: 'world' | 'picked';
  /** Shown as a line inside a dialog, with no Details to send (no "send the details"). */
  inline?: boolean;
  /** Nothing caught it: a browser refusal here is not about a folder, so it reads as unexpected. */
  unexpected?: boolean;
  /**
   * Where the world's files are (1.17, conv. 129): every disk sentence and
   * "saved" clause is true for it. Defaults to the open world's.
   */
  where?: FilesWhere;
  /** What the person typed for this step is a one-line name: the host's cause offers no code block. */
  oneLine?: boolean;
  /**
   * Whose credential the step sent as `API-Pin`, so a line about it names the World PIN or a seat's
   * secret (1.125.3): said by a caller that knows it (a seat's join, a link form's typed secret, a new
   * world on the account), or read from `worldId`'s entry. Neither given, the line names both (the World
   * PIN or seat secret): the
   * open world is not always the step's (a download or a link runs beside it).
   */
  who?: PinWho;
  /** The world the step was for: its entry says whose credential it sent, when `who` is not given. */
  worldId?: string;
  /**
   * The step sends no `API-Pin` at all (an invite's preview or redeem, an account call, a download by a key
   * that only reads, the demo's): a refusal names no World PIN or seat secret. `true` where nothing the
   * step made stays behind when it fails, so its line says nothing changed; `may-have-left` where
   * something can (a folder's half-made download, a key just made, a world made here first).
   */
  noPin?: boolean | 'may-have-left';
}

/**
 * A download's `noPin`: into this browser a failure removes what it made; into a folder its half-made
 * files can stay.
 */
export function downloadNoPin(where: string | undefined): true | 'may-have-left' {
  return where === 'browser' ? true : 'may-have-left';
}

/** Whose credential this problem's step sent: as the caller said, else the given world's, else not known. */
function pinWhoFor(opts: ProblemOpts): PinWho {
  if (opts.who) return opts.who;
  if (!opts.worldId) return 'unknown';
  return pinWhoOf(getState().registry.worlds.find(w => w.id === opts.worldId));
}

/** The open world's `where`, for a caller that did not say. */
function activeWhere(): FilesWhere {
  const s = getState();
  const id = s.active?.worldId;
  return filesWhereOf(id ? s.registry.worlds.find(w => w.id === id) : undefined);
}

export function problemFor(err: unknown, opts: ProblemOpts = {}): Problem {
  const doing = opts.doing?.trim() || DEFAULT_DOING;
  const classified = classifyError(err);
  // An uncaught clipboard or storage refusal is not the open
  // world's folder.
  const kind: ProblemKind = opts.unexpected && classified.startsWith('disk-') ? 'bug' : classified;
  const where = opts.where ?? activeWhere();
  // Allow access asks for a folder: never for a picked folder's refusal, and
  // never in this browser, whose storage has no permission to grant.
  const fixes = FIXES[kind].filter(f => !(f === 'allow-access' && (opts.folder === 'picked' || where === 'browser')));
  return {
    kind,
    sentence: sentenceFor(kind, err, doing, opts, where),
    fixes,
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
 *
 * A scrubber cannot know every shape a name takes (a server message can
 * quote an element name without quotes), so the details block never relies
 * on it alone: free error text goes in only for the `bug` kind, and
 * every other line is built from fields Atlas chose (`detailFields`).
 */
export function scrubForReport(text: string): string {
  // Cut first: the patterns below are not all linear, and
  // a long message would freeze the tab before the cap applied.
  let t = String(text ?? '').slice(0, REPORT_CAP * 4);
  t = t.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>');
  // ow_s_ is a seat's secret (held seats keep one in this browser).
  t = t.replace(/\bow_[wras]_\S+/gi, '<key>');
  // Paths carry folder and user names. A web address keeps its host only;
  // file:// URLs, drive, UNC and absolute paths, and any token with a slash
  // between its parts ("worlds/aldric") go entirely.
  t = t.replace(/\bfile:\/\/\S+/gi, '<path>');
  t = t.replace(/\b(https?):\/\/([^\s/?#"']+)[^\s"']*/gi, '$1://$2/…');
  t = t.replace(/(?:\b[A-Za-z]:|(?<![:\w/\\]))(?:[\\/]{1,2}[^\s\\/"'<>|]+)+[\\/]?/g, '<path>');
  t = t.replace(/(?<![:/\w])[\w.-]+(?:[\\/][\w.-]+)+/g, '<path>');
  t = t.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>');
  // Element files are named "<name slug>--<id tail>.json": the slug is the name.
  t = t.replace(/(?<![\w.-])[\w.-]*?\w--[\w.-]+/g, '<file>');
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
  /** Where the open world's files are (1.17): printed only for this browser. */
  where?: FilesWhere;
  syncPaused?: boolean;
  /** Further lines (already free of names): scrubbed again and capped. */
  extra?: string[];
  now?: Date;
  browser?: string;
}

function headerLines(ctx: DetailsContext): string[] {
  const base = ctx.world === 'linked' ? `linked, sync ${ctx.syncPaused ? 'paused' : 'on'}`
    : ctx.world === 'local' ? 'local'
    : 'none open';
  const world = ctx.world !== 'none' && ctx.where === 'browser' ? `${base}, browser` : base;
  return [
    `Atlas ${pkg.version}`,
    `Browser: ${ctx.browser ?? describeBrowser()}`,
    `World: ${world}`,
  ];
}

function timeLine(ctx: DetailsContext): string {
  return `Time: ${(ctx.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
}

/** An identifier-shaped token (an error name, a code): safe to print as is. */
const TOKEN = /^[A-Za-z][\w.-]{0,63}$/;
/** A schema field name; `x_` / `shadow_` names are the user's own words. */
const SCHEMA_FIELD = /^(?!x_|shadow_)[a-z][a-z0-9_]{0,63}$/;

function tokenOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && TOKEN.test(value) ? value : fallback;
}

/**
 * The structured facts about an error, each chosen by Atlas and none free
 * text: the error's class name, a server's error code, HTTP status and the
 * schema field it named. A custom field's name is the user's, so it shows as
 * "a custom field".
 */
export function detailFields(err: unknown): string[] {
  const e = (err ?? {}) as { code?: unknown; status?: unknown; param?: unknown };
  const lines = [`Error: ${tokenOr(nameOf(err), typeof err === 'object' && err !== null ? 'Error' : typeof err)}`];
  const status = serverStatus(err);
  if (status !== null) lines.push(`Status: ${status}`);
  if (typeof e.code === 'string' && TOKEN.test(e.code)) lines.push(`Code: ${e.code}`);
  if (typeof e.param === 'string' && e.param) {
    lines.push(`Field: ${SCHEMA_FIELD.test(e.param) ? e.param : 'a custom field'}`);
  }
  return lines;
}

/**
 * The error for the details block. Structured fields always; the error's own
 * text only when Atlas did not expect it (`bug`), scrubbed, because that is
 * the case where nobody can fix it without reading it. Every other kind is
 * fully described by its kind and fields, so its text (which can carry names
 * the scrubber cannot recognise) never leaves.
 */
export function errorLines(err: unknown, kind: ProblemKind): string[] {
  const lines = detailFields(err);
  if (kind === 'bug' && !isPlainError(err) && !REFUSAL_NAMES.has(nameOf(err))) {
    // The engine's own text up to its first quote: past it, browsers quote
    // the user's input (JSON.parse), with quotes inside that the pairwise
    // quote scrub cannot pair.
    const unquoted = messageOf(err).split(/["'“‘]/)[0];
    const text = maskCapitalisedWords(scrubForReport(unquoted)).trim();
    if (text) lines.push(`Message: ${text}`);
  }
  return lines;
}

/** Words an unexpected error's own text starts with; everything else capitalised may be a name. */
const ERROR_WORDS = new Set([
  'A', 'An', 'The', 'No', 'Not', 'Cannot', 'Could', 'Failed', 'Unexpected', 'Invalid', 'Maximum',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'DOMException',
  'JSON', 'API', 'URL', 'HTTP', 'NaN', 'Infinity', 'Atlas', 'OnlyWorlds', 'OPFS',
]);

/**
 * An unexpected error's message is the one free text the details keep, and
 * a name in it is usually Capitalised ("Moon Base not found"): every
 * capitalised word that is not an error word becomes "<name>" (a
 * PascalCase code name too: losing `FolderStore` is cheaper than a leak).
 * A name typed in lowercase can still pass; the person sees the whole block
 * on the feedback form before anything is sent.
 */
function maskCapitalisedWords(text: string): string {
  // Any capital, not only ASCII (Éowyn), and no camelCase pass (McAllister,
  // DeVries are names): only the error words stay.
  return text.replace(/(?<![\p{L}\p{N}_])\p{Lu}[\p{L}\p{N}'’-]*/gu, w => (ERROR_WORDS.has(w) ? w : '<name>'));
}

/** @deprecated kept for callers outside the details block; prefer `errorLines`. */
export function errorLine(err: unknown): string {
  return errorLines(err, classifyError(err)).join('; ');
}

export function buildDetails(problem: Problem, ctx: DetailsContext = {}): string {
  const lines = [
    ...headerLines(ctx),
    `While: ${scrubForReport(problem.doing)}`,
    `Kind: ${problem.kind}`,
    ...errorLines(problem.raw, problem.kind),
    ...(ctx.extra ?? []).map(scrubForReport),
    timeLine(ctx),
  ];
  return lines.join('\n');
}

/**
 * The same block for a sync round's per-element failures (at most three
 * listed): type, operation and the error's class name. The failure's message
 * stays out: it is server or browser text and can quote a name.
 */
export function buildFailureDetails(
  failures: readonly {
    type?: string; operation?: string; error_name?: string; message?: string;
    source?: string; status?: number; code?: string; param?: string;
  }[],
  ctx: DetailsContext & { doing?: string } = {},
): string {
  const listed = failures.slice(0, 3).map(f => {
    const what = [tokenOr(f.type, 'element'), tokenOr(f.operation, 'change')].join(' ');
    const why = [
      f.source === 'server' || f.source === 'disk' ? f.source : null,
      f.error_name && TOKEN.test(f.error_name) ? f.error_name : null,
      typeof f.status === 'number' && Number.isInteger(f.status) ? String(f.status) : null,
      f.code && TOKEN.test(f.code) ? f.code : null,
      f.param ? `field ${SCHEMA_FIELD.test(f.param) ? f.param : '(custom)'}` : null,
    ].filter(Boolean).join(', ');
    return `- ${what}${why ? `: ${why}` : ''}`;
  });
  const more = failures.length > 3 ? [`and ${failures.length - 3} more`] : [];
  return [
    ...headerLines(ctx),
    `While: ${scrubForReport(ctx.doing ?? 'syncing with OnlyWorlds')}`,
    `Failed: ${failures.length}`,
    ...listed,
    ...more,
    ...(ctx.extra ?? []).map(scrubForReport),
    timeLine(ctx),
  ].join('\n');
}
