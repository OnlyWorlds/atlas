/**
 * Gate lens A harness: the REAL FsFolderStore over fake-fs, the production
 * v2 adapter over the stateful keel-v2 MSW (the make-online.kernel.test.ts
 * pattern), plus a "tab closed here" crash model: a wrapped call that never
 * settles, either BEFORE the real call runs or AFTER it (the server committed,
 * the response never arrived / the write landed, the tab died). The merge is
 * then abandoned and the folder reopened with a NEW store instance, the way a
 * reload does.
 */
import { mswServer } from '../../setup';
import { statefulV2Handlers } from '../../msw-handlers';
import { FakeDirHandle } from '../../fixtures/fake-fs';
import { FsFolderStore } from '../../../src/store/folder-store-fs';
import { OwV2ClientAdapter } from '../../../src/sync/ow-v2-client-adapter';
import { elementFilename } from '../../../src/store/fs-utils';

export const V2 = 'https://test-ow.local/api/v2';
export const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
let t = 0;
export const clock = () => new Date(Date.UTC(2026, 1, 1, 0, 0, t++)).toISOString();
export const LOCAL_T = '2026-01-01T00:00:00.000Z';
export const JOURNAL = '.atlas/rekey-journal.json';

export type Server = ReturnType<typeof statefulV2Handlers>;

export function freshServer(opts: Parameters<typeof statefulV2Handlers>[0] = {}): { server: Server; adapter: OwV2ClientAdapter } {
  const server = statefulV2Handlers({ baseUrl: V2, clock, ...opts });
  mswServer.use(...server.handlers);
  const adapter = new OwV2ClientAdapter({ apiKey: 'k', apiPin: '1234', baseUrl: V2 });
  return { server, adapter };
}

export function world(): FakeDirHandle {
  const root = new FakeDirHandle('w');
  root.put('world.json', j({ id: 'w1', name: 'W' }));
  return root;
}

export function putEl(root: FakeDirHandle, el: Record<string, unknown>): void {
  root.put(`elements/${el.type}/${elementFilename(el.id as string, el.name as string)}`, j({ local_updated_at: LOCAL_T, ...el }));
}

export function pathOf(root: FakeDirHandle, id: string): string | undefined {
  const tail = id.slice(-8);
  return root.list().find(p => (p.startsWith('elements/') || p.startsWith('spatial/')) && p.includes(tail) && p.endsWith('.json'));
}

export async function open(root: FakeDirHandle): Promise<FsFolderStore> {
  const s = new FsFolderStore({ clock, tabId: 't' + Math.random(), disableHeartbeat: true, forceTakeLock: true });
  await s.open(root as unknown as FileSystemDirectoryHandle);
  return s;
}

export function srv(server: Server, type: string): Map<string, Record<string, unknown>> {
  return (server.state.get(type) ?? new Map()) as Map<string, Record<string, unknown>>;
}
export function allServerRecords(server: Server): Array<Record<string, unknown>> {
  return [...server.state.values()].flatMap(m => [...m.values()] as Array<Record<string, unknown>>);
}

export const never = <T>(): Promise<T> => new Promise<T>(() => undefined);
export const tick = () => new Promise<void>(r => setTimeout(r, 0));

/**
 * Wrap `methods` on `target`. Every call is counted; the `nth` call of
 * `crash.method` never settles, before or after running the real call.
 * `crashed()` says whether the crash fired.
 */
export function instrumentHang(
  target: object,
  methods: readonly string[],
  crash?: { method: string; nth: number; mode: 'before' | 'after' },
): { counts: Record<string, number>; crashed: () => boolean; whenCrashed: Promise<void> } {
  const counts: Record<string, number> = Object.fromEntries(methods.map(m => [m, 0]));
  let fired = false;
  let signal: () => void = () => undefined;
  const whenCrashed = new Promise<void>(r => { signal = r; });
  const rec = target as Record<string, (...a: unknown[]) => unknown>;
  for (const m of methods) {
    const orig = rec[m];
    if (typeof orig !== 'function') continue;
    const bound = orig.bind(target);
    rec[m] = (...a: unknown[]) => {
      counts[m]++;
      if (fired) return never();
      if (crash && crash.method === m && counts[m] === crash.nth) {
        fired = true;
        if (crash.mode === 'before') { signal(); return never(); }
        return Promise.resolve(bound(...a)).then(() => { signal(); return never(); });
      }
      return bound(...a);
    };
  }
  return { counts, crashed: () => fired, whenCrashed };
}

/** Run until the merge settles or the crash fires (then let pending microtasks drain). */
export async function runUntilHangOrDone<T>(p: Promise<T>, whenCrashed: Promise<void>): Promise<{ done: true; value: T } | { done: false; error?: unknown }> {
  const out = await Promise.race([
    p.then(v => ({ done: true as const, value: v }), e => ({ done: false as const, error: e })),
    whenCrashed.then(() => ({ done: false as const })),
  ]);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  return out;
}
