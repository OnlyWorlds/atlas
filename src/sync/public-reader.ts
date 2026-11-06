/**
 * The public reader: a world anyone may read, read with no key (keel's
 * keyless door, api-v2-spec §3b). Every request is a GET naming the world as
 * `world=<id>`, through the SDK's keyless client (no `apiKey`, `world` set),
 * which refuses before sending anything but `list`, `get` and `getWorld`.
 * It sends no key, no PIN, no write, no `/changes` and no file read; the
 * writes below throw before anything is sent.
 *
 * Shaped as `OwApiClient` for `initialDownloadAll`, with the one element
 * decoder every keel read goes through (`adaptV2Record`) and the one world
 * decoder (`adaptWorldMetaBody`).
 *
 * The budget (keel: 60 keyless requests a minute per address): pages of
 * 1000, and a 429 pauses on its `Retry-After` (seconds; 30 when absent, 120 at most) and
 * sends the same request again, at most `PUBLIC_MAX_WAITS` times in one
 * reader's life (one open). The next 429 is `PublicWaitsSpent`.
 */
import { OwApiError, OwV2Client } from '@onlyworlds/sdk';
import type { ElementType } from '../core/types';
import type { OwApiClient, WorldMetaWire } from './sync-engine';
import { ATLAS_CLIENT_NAME, DEFAULT_V2_BASE, adaptV2Record, adaptWorldMetaBody } from './ow-v2-client-adapter';

type ServerRecord = { id: string; updated_at: string } & Record<string, unknown>;

/** keel's page cap for an element list. */
export const PUBLIC_PAGE_SIZE = 1000;
/** Pauses one open may take on keel's 429 before it stops. */
export const PUBLIC_MAX_WAITS = 3;
/** A 429 that names no wait waits this long (seconds). */
export const PUBLIC_DEFAULT_WAIT_S = 30;
/** The longest one pause waits, whatever keel asks (seconds). */
export const PUBLIC_MAX_WAIT_S = 120;
/** A keyless read that has not answered in this long is given up (as the demo's). */
export const PUBLIC_READ_TIMEOUT_MS = 30_000;
/** A cursor walk longer than this is no real world's type (1000 a page). */
const MAX_PAGES = 200;

/** The world as the public reads it: its own fields in disk names, and what the public may read of it. */
export interface PublicWorld {
  meta: WorldMetaWire;
  /** keel's `counts` on a keyless `GET /world`: `{total, types: {type: n}}`; null when not sent. */
  counts: { total: number; types: Record<string, number> } | null;
}

/** keel turned Atlas away more often than one open may wait. */
export class PublicWaitsSpent extends Error {
  constructor() {
    super('keel asked the public reader to wait more often than one open allows');
    this.name = 'PublicWaitsSpent';
  }
}

/** A list walk that cannot be whole (a cursor that did not move, an item with no id). */
export class PublicWalkBroken extends Error {
  constructor(type: string) {
    super(`the public list of ${type} did not walk whole`);
    this.name = 'PublicWalkBroken';
  }
}

export interface PublicReaderOpts {
  /** The /api/v2 base; production by default. */
  baseUrl?: string;
  /** Test seam: the fetch every request goes through. */
  fetch?: typeof globalThis.fetch;
  /** Told before each pause, with its length in whole seconds. */
  onWait?: (seconds: number) => void;
  /** Told when a pause has ended and the request goes again. */
  onResume?: () => void;
  /** Test seam: the pause itself. */
  sleep?: (ms: number) => Promise<void>;
  /** Pauses this reader may take (`PUBLIC_MAX_WAITS` by default; 0: a 429 is `PublicWaitsSpent` at once). */
  maxWaits?: number;
}

const sleepFor = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Each request its own time limit (one signal made up front would end every later request). */
function fetchWithin(base: typeof globalThis.fetch, limitMs: number): typeof globalThis.fetch {
  return (input, init) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), limitMs);
    return base(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(timer));
  };
}

/** A 404 from keel's keyless door: the world is private, unknown or not a world id (one answer for all three). */
export function isPublicNotFound(err: unknown): boolean {
  return err instanceof OwApiError && err.status === 404;
}

/**
 * A 401 on a keyless `?world=` read: keel's public reader is switched off
 * (`PUBLIC_READER`, its own switch: "Off: a keyless `world` is the `401`").
 * No world can be read without a key then.
 */
export function isPublicReaderOff(err: unknown): boolean {
  return err instanceof OwApiError && err.status === 401;
}

/** The public cannot read this world, now: a 404 (not public), or the reader switched off (401). */
export function isPublicClosed(err: unknown): boolean {
  return isPublicNotFound(err) || isPublicReaderOff(err);
}

export class PublicWorldReader implements OwApiClient {
  readonly worldId: string;
  private readonly client: OwV2Client;
  private readonly onWait?: (seconds: number) => void;
  private readonly onResume?: () => void;
  private readonly sleep: (ms: number) => Promise<void>;
  private waits = 0;
  private readonly maxWaits: number;

  constructor(worldId: string, opts: PublicReaderOpts = {}) {
    this.worldId = worldId;
    const base = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.client = new OwV2Client({
      baseUrl: opts.baseUrl ?? DEFAULT_V2_BASE,
      world: worldId,
      client: ATLAS_CLIENT_NAME,
      pageSize: PUBLIC_PAGE_SIZE,
      fetch: fetchWithin(base, PUBLIC_READ_TIMEOUT_MS),
    });
    this.onWait = opts.onWait;
    this.onResume = opts.onResume;
    this.sleep = opts.sleep ?? sleepFor;
    this.maxWaits = opts.maxWaits ?? PUBLIC_MAX_WAITS;
  }

  /** Pauses taken so far. */
  get waitsTaken(): number { return this.waits; }

  /** One request, sent again after each 429's wait while the open's pauses last. */
  private async paced<T>(send: () => Promise<T>): Promise<T> {
    for (;;) {
      try {
        return await send();
      } catch (err) {
        if (!(err instanceof OwApiError) || err.status !== 429) throw err;
        if (this.waits >= this.maxWaits) throw new PublicWaitsSpent();
        this.waits++;
        // keel's budget is per minute; a longer ask is capped (the overlay has no Cancel).
        const secs = Math.min(PUBLIC_MAX_WAIT_S, Math.max(1, Math.ceil(err.retryAfter ?? PUBLIC_DEFAULT_WAIT_S)));
        this.onWait?.(secs);
        await this.sleep(secs * 1000);
        this.onResume?.();
      }
    }
  }

  /** `GET /world?world=<id>`, keyless. Throws keel's 404 for a world the public cannot read. */
  async readWorld(): Promise<PublicWorld> {
    const raw = await this.paced(() => this.client.getWorld()) as unknown as Record<string, unknown>;
    if (!raw || typeof raw.id !== 'string') throw new Error('the public /world answer had no id');
    const c = raw.counts as { total?: unknown; types?: unknown } | undefined;
    const types = c && c.types && typeof c.types === 'object' && !Array.isArray(c.types) ? c.types as Record<string, unknown> : null;
    const counts = c && typeof c.total === 'number' && types && Object.values(types).every(n => typeof n === 'number')
      ? { total: c.total, types: types as Record<string, number> }
      : null;
    return { meta: adaptWorldMetaBody(raw), counts };
  }

  async getWorldMeta(): Promise<WorldMetaWire> {
    return (await this.readWorld()).meta;
  }

  async listElements(type: ElementType): Promise<ServerRecord[]> {
    const out: ServerRecord[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const at = cursor;
      const res = await this.paced(() => this.client.list(type, { limit: PUBLIC_PAGE_SIZE, ...(at ? { cursor: at } : {}) }));
      // Whole or nothing: an item that does not decode is no partial success here.
      for (const r of res.data ?? []) out.push(adaptV2Record(r, type));
      if (!res.has_more) return out;
      if (!res.next_cursor || res.next_cursor === cursor) throw new PublicWalkBroken(type);
      cursor = res.next_cursor;
    }
    throw new PublicWalkBroken(type);
  }

  async getElement(type: ElementType, id: string): Promise<ServerRecord | null> {
    try {
      return adaptV2Record(await this.paced(() => this.client.get(type, id)), type);
    } catch (err) {
      if (isPublicNotFound(err)) return null;
      throw err;
    }
  }

  // Nothing goes up, ever: every write refuses before anything is sent.
  async createElement(): Promise<ServerRecord> { throw refused('create'); }
  async updateElement(): Promise<ServerRecord> { throw refused('update'); }
  async deleteElement(): Promise<void> { throw refused('delete'); }
  async patchWorldMeta(): Promise<WorldMetaWire> { throw refused('patch the world'); }
}

function refused(what: string): Error {
  return new TypeError(`the public reader does not ${what}: it reads only`);
}
