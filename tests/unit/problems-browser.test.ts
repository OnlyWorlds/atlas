/**
 * Every problem sentence is true for where the world keeps its files (1.17,
 * conv. 129; contract §8, §9 invariant 3; census §3.1): a world kept in this
 * browser never hears about its folder, its disk or OneDrive, and is never
 * offered Allow access (its storage has no permission to grant). The open
 * world's `where` is the default; a caller can say it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry, type PerElementFailure, type WorldRegistryEntry } from '../../src/core/types';
import { buildDetails, problemFor, type ProblemOpts } from '../../src/core/problems';
import { damagedFileSentence, CorruptFileError } from '../../src/store/fs-utils';
import { describeFailures } from '../../src/sync/sync-failure-copy';
import { syncIssueLine } from '../../src/middle/settings-world';
import type { SyncIssue } from '../../src/sync/sync-issues';

const FOLDER_WORDS = /folder|drive|disk|OneDrive|Dropbox|antivirus|git merge/i;

const entry = (over: Partial<WorldRegistryEntry>): WorldRegistryEntry => ({
  id: 'w1', name: 'Hollow Reach', state: 'local-only', created_at: '2026-10-05T00:00:00.000Z',
  folder: { handle_key: 'world-w1', folder_name: 'hollow-reach-w1-ab12' }, ...over,
});
const open = (e: WorldRegistryEntry) => {
  patchSlice('registry', { ...defaultRegistry(), worlds: [e] });
  patchSlice('active', { worldId: e.id, meta: { id: e.id, name: e.name }, opened: true } as never);
};
const dom = (name: string) => new DOMException('raw browser text', name);
const corrupt = () => { const e = new CorruptFileError('World.json', 'x'); return e; };

const DISK_ERRORS: Array<[string, () => unknown]> = [
  ['disk-busy', () => dom('NoModificationAllowedError')],
  ['disk-permission', () => dom('SecurityError')],
  ['disk-missing', () => dom('NotFoundError')],
  ['disk-full', () => dom('QuotaExceededError')],
  ['disk-damaged', corrupt],
];

beforeEach(() => open(entry({ where: 'browser' })));

describe('problemFor for a world kept in this browser', () => {
  for (const [kind, make] of DISK_ERRORS) {
    it(`${kind}: no folder words, no Allow access`, () => {
      const p = problemFor(make(), { doing: 'saving this scene' });
      expect(p.kind).toBe(kind);
      expect(p.sentence).not.toMatch(FOLDER_WORDS);
      expect(p.fixes).not.toContain('allow-access');
    });
  }

  it('the "saved" clauses say this browser', () => {
    const opts: ProblemOpts = { doing: 'syncing', savedLocally: true };
    expect(problemFor(new TypeError('Failed to fetch'), opts).sentence).toContain('Your changes are saved in this browser.');
    const refused = Object.assign(new Error('API Error 400: bad'), { status: 400, code: 'invalid' });
    expect(problemFor(refused, opts).sentence).toContain('It stays saved in this browser.');
  });

  it('the tour sandbox (demo) counts as this browser too', () => {
    open(entry({ demo: true }));
    expect(problemFor(dom('NoModificationAllowedError'), { doing: 'saving' }).sentence).not.toMatch(FOLDER_WORDS);
  });

  it('a caller can say where, over the open world', () => {
    open(entry({}));
    expect(problemFor(dom('QuotaExceededError'), { doing: 'saving', where: 'browser' }).sentence)
      .toContain("This browser's storage for Atlas is full");
  });

  it('a folder world keeps its folder sentences and Allow access', () => {
    open(entry({}));
    const p = problemFor(dom('SecurityError'), { doing: 'saving' });
    expect(p.sentence).toContain("this world's folder");
    expect(p.fixes).toContain('allow-access');
    expect(problemFor(dom('NoModificationAllowedError'), { doing: 'saving' }).sentence).toContain('OneDrive');
  });

  it('a picked folder is a folder wherever the open world lives', () => {
    expect(problemFor(dom('SecurityError'), { doing: 'choosing a folder', folder: 'picked' }).sentence).toContain('that folder');
  });
});

describe('the other sentence sources', () => {
  it('damagedFileSentence', () => {
    expect(damagedFileSentence('World.json', 'browser')).not.toMatch(FOLDER_WORDS);
    expect(damagedFileSentence('World.json')).toContain("this world's folder");
  });

  it('describeFailures', () => {
    const f = (over: Partial<PerElementFailure>): PerElementFailure => ({ element_id: 'e1', type: 'character', operation: 'update', message: '', ...over });
    const failures = [
      f({ element_id: 'a', message: 'already exists in another world' }),
      f({ element_id: 'b', error_name: 'NoModificationAllowedError' }),
      f({ element_id: 'c', error_name: 'NoModificationAllowedError', operation: 'read' }),
    ];
    const text = describeFailures(failures, 'browser');
    expect(text).not.toMatch(FOLDER_WORDS);
    expect(text).toContain('another Atlas tab');
    expect(describeFailures(failures)).toContain('OneDrive');
  });

  it('syncIssueLine', () => {
    const issue = (kind: SyncIssue['kind'], failure: Partial<PerElementFailure>): SyncIssue =>
      ({ kind, element_id: 'e', type: 'character', operation: 'update', failure: { element_id: 'e', type: 'character', operation: 'update', message: '', ...failure } } as SyncIssue);
    for (const i of [issue('file_busy', { operation: 'read' }), issue('file_busy', {}), issue('other', { source: 'disk' })]) {
      expect(syncIssueLine(i, 'browser')).not.toMatch(FOLDER_WORDS);
      expect(syncIssueLine(i)).toMatch(/folder/);
    }
  });

  it('the details header says browser, never a name', () => {
    const p = problemFor(dom('UnknownError'), { doing: 'opening this world' });
    const text = buildDetails(p, { world: 'local', where: 'browser' });
    expect(text).toContain('World: local, browser');
    expect(text).not.toContain('Hollow Reach');
  });
});
