/**
 * The element's sync dot says when the element is not syncing: an element
 * the last round failed to send (or to save from a pull) shows "Not syncing"
 * with Settings' own reason, opens Settings' rows on a click, and is redrawn
 * in place when the issues list moves, since a failed round changes nothing
 * about the element itself. Before, it kept "Pending sync; autosave will push
 * within a few seconds" for as long as the failure repeated.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Element, PerElementFailure, WorldRegistryEntry } from '../../src/core/types';
import { renderHeader, notSyncingTitle } from '../../src/middle/element-detail-header';
import { noteRoundIssues, issuesFor, __resetSyncIssues } from '../../src/sync/sync-issues';
import { syncIssueLine } from '../../src/middle/settings-world';

const WORLD = 'w-dot';
const EL = 'e-dot-1';

function el(extra: Record<string, unknown> = {}): Element {
  // Edited after the server's copy: what the dot reads as a change waiting.
  return {
    id: EL, type: 'character', name: 'Ada',
    local_updated_at: '2026-11-17T10:00:00.000Z', server_updated_at: '2026-11-17T09:00:00.000Z', ...extra,
  } as unknown as Element;
}
function openWorld(state: 'api-linked' | 'local-only', elements: Element[]): void {
  const entry = {
    id: WORLD, name: 'Linked', state,
    ...(state === 'api-linked' ? { api: { world_id: 's1', api_key: 'k' } } : {}),
  } as unknown as WorldRegistryEntry;
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
  patchSlice('active', { worldId: WORLD, meta: { name: 'Linked' } } as never);
  patchSlice('data', { elements } as never);
}
function fail(extra: Partial<PerElementFailure> = {}): PerElementFailure {
  return { element_id: EL, type: 'character', operation: 'update', message: 'boom', status: 500, source: 'server', ...extra };
}
const round = (failures: PerElementFailure[]) => ({ failures, auth_blocked: false, transient_blocked: false });
const dot = (): HTMLElement => document.querySelector<HTMLElement>('[data-role="element-sync-dot"]')!;

function mount(e: Element): void {
  document.body.appendChild(renderHeader(e));
}

afterEach(() => {
  document.body.innerHTML = '';
  window.location.hash = '';
  __resetSyncIssues();
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
  patchSlice('data', { elements: [] } as never);
});

describe('the sync dot and a failed element', () => {
  it('a change waiting with no failure still says Pending sync', () => {
    const e = el();
    openWorld('api-linked', [e]);
    mount(e);
    expect(dot().dataset.state).toBe('dirty');
    expect(dot().title).toMatch(/^Pending sync/);
  });

  it('a failed round turns the mounted dot into Not syncing, with Settings\' reason, in place', () => {
    const e = el();
    openWorld('api-linked', [e]);
    mount(e);
    noteRoundIssues(WORLD, 'push', round([fail()]));
    const d = dot();
    expect(d.tagName).toBe('BUTTON');
    expect(d.dataset.state).toBe('problem');
    expect(d.title).toBe('Not syncing. OnlyWorlds had a problem on its side. Atlas tries again with your next save. See it in Settings.');
    expect(d.getAttribute('aria-label')).toBe(d.title);
    expect(d.textContent).toContain('sync_problem');
  });

  it('a click opens This world in Settings, where the row and its fix are', () => {
    const e = el();
    openWorld('api-linked', [e]);
    noteRoundIssues(WORLD, 'push', round([fail()]));
    mount(e);
    dot().click();
    expect(window.location.hash).toBe(`#/w/${WORLD}/settings/world`);
  });

  it('a round that sends it clears the mark in place', () => {
    const e = el();
    openWorld('api-linked', [e]);
    noteRoundIssues(WORLD, 'push', round([fail()]));
    mount(e);
    expect(dot().dataset.state).toBe('problem');
    noteRoundIssues(WORLD, 'push', round([]));
    expect(issuesFor(WORLD)).toEqual([]);
    expect(dot().dataset.state).toBe('dirty');
  });

  it('a first busy file stays quiet, as the pill counts it; the second says so', () => {
    const e = el();
    openWorld('api-linked', [e]);
    mount(e);
    const busy = fail({ error_name: 'NoModificationAllowedError', status: undefined, source: 'disk', message: 'held' });
    noteRoundIssues(WORLD, 'push', round([busy]));
    expect(issuesFor(WORLD)[0]?.kind).toBe('file_busy');
    expect(dot().dataset.state).toBe('dirty');
    noteRoundIssues(WORLD, 'push', round([{ ...busy }]));
    expect(dot().dataset.state).toBe('problem');
  });

  it('a pull-side failure on an element with nothing waiting says so too', () => {
    const e = el({ local_updated_at: '2026-11-17T09:00:00.000Z' });
    openWorld('api-linked', [e]);
    mount(e);
    expect(dot().dataset.state).toBe('synced');
    noteRoundIssues(WORLD, 'pull', round([fail({ operation: 'read' })]));
    expect(dot().dataset.state).toBe('problem');
  });

  it('another element\'s failure leaves this dot alone', () => {
    const e = el();
    openWorld('api-linked', [e]);
    mount(e);
    noteRoundIssues(WORLD, 'push', round([fail({ element_id: 'someone-else' })]));
    expect(dot().dataset.state).toBe('dirty');
  });

  it('a world not linked keeps its saved dot', () => {
    const e = el();
    openWorld('local-only', [e]);
    noteRoundIssues(WORLD, 'push', round([fail()]));
    mount(e);
    expect(dot().dataset.state).toBe('local');
  });

  it('a failure that repeats keeps the same button, so focus survives the round', () => {
    const e = el();
    openWorld('api-linked', [e]);
    mount(e);
    noteRoundIssues(WORLD, 'push', round([fail()]));
    const first = dot();
    first.focus();
    expect(document.activeElement).toBe(first);
    noteRoundIssues(WORLD, 'push', round([fail()]));
    expect(issuesFor(WORLD)[0].rounds).toBe(2);
    expect(dot()).toBe(first);
    expect(document.activeElement).toBe(first);
  });

  it('the words stand alone on the element: no Settings button named as if it were here', () => {
    const titleOf = (f: PerElementFailure): string => {
      __resetSyncIssues();
      noteRoundIssues(WORLD, 'push', round([f]));
      return notSyncingTitle(issuesFor(WORLD)[0], 'folder');
    };
    const titles = [
      titleOf(fail({ status: 422, param: 'birth_date' })),
      titleOf(fail({ status: undefined, source: undefined })),
      titleOf(fail({ operation: 'read', error_name: 'InvalidStateError', status: undefined, source: 'disk' })),
    ];
    for (const t of titles) expect(t).not.toMatch(/Open it to check|Try again now|or copy the details|It could not sync/);
    // A line that already names Settings is not followed by a second pointer there.
    expect(titles[0]).toBe('Not syncing. OnlyWorlds did not accept it. The problem is in its birth date field. Settings can copy the details to report it.');
    for (const t of titles) {
      expect(t).not.toMatch(/\bclick\b/i);
      expect(t.match(/\bSettings\b/g)?.length).toBe(1);
    }
  });

  it('a disk failure says the step that failed, and "by itself" only where a timer is armed', () => {
    const lineOf = (f: PerElementFailure, where: 'folder' | 'browser' = 'folder'): { title: string; row: string } => {
      __resetSyncIssues();
      noteRoundIssues(WORLD, 'push', round([f]));
      const [issue] = issuesFor(WORLD);
      return { title: notSyncingTitle(issue, where), row: syncIssueLine(issue, where) };
    };
    const disk = (operation: PerElementFailure['operation'], local_step?: PerElementFailure['local_step']) =>
      fail({ operation, status: undefined, source: 'disk', error_name: 'NotAllowedError', ...(local_step ? { local_step } : {}) });
    // OnlyWorlds has the change (a create, an accepted proposal): never "Not syncing".
    for (const operation of ['create', 'update'] as const) {
      const { title, row } = lineOf(disk(operation, 'note'));
      expect(title).toBe('OnlyWorlds has the change, but Atlas could not note that in the folder. Atlas tries again with your next save. See it in Settings.');
      expect(row).toBe('OnlyWorlds has it, but Atlas could not note that in the folder. Atlas tries again with your next save.');
    }
    // A delete it has: the delete, never "OnlyWorlds has it" beside a deleted element's name.
    expect(lineOf(disk('delete', 'note')).row)
      .toBe('OnlyWorlds has the delete, but Atlas could not note that in the folder. Atlas tries again with your next save.');
    // An edit sent: the next round can read keel's newer stamp as a conflict, so no promise to resend.
    const edit = lineOf(disk('update', 'note_edit'));
    expect(edit.title).toBe('OnlyWorlds has the change, but Atlas could not note that in the folder, so the next sync may list it as a conflict. Both copies hold your change. See it in Settings.');
    expect(edit.row).not.toMatch(/tries again/);
    expect(lineOf(disk('delete', 'put_back'), 'browser').row)
      .toBe('OnlyWorlds kept it when it was deleted here, but Atlas could not put it back in this browser. Atlas tries again with your next save.');
    // No round redoes these two: no promise to try again.
    expect(lineOf(disk('update', 'restore_links')).title)
      .toBe('Not syncing. OnlyWorlds kept an element this one links to, but Atlas could not put that link back in the folder. Add the link again to keep it. See it in Settings.');
    expect(lineOf(disk('delete', 'remove')).row)
      .toBe('It is no longer in what OnlyWorlds shows you, but Atlas could not remove it from the folder.');
    expect(lineOf(disk('update')).row).toBe('Atlas could not write it in the folder. Atlas tries again with your next save.');
    for (const step of ['note', 'put_back', 'restore_links', 'remove', undefined] as const) {
      expect(lineOf(disk('update', step)).row).not.toMatch(/by itself/);
    }
    // A busy file does arm the timer, and keeps saying so.
    expect(lineOf(fail({ status: undefined, source: 'disk', error_name: 'NoModificationAllowedError' })).row)
      .toBe('Another program was using its file in the folder. Atlas tries again by itself.');
    // Except for the two steps no round redoes: busy or not, the step's own words.
    for (const step of ['restore_links', 'remove'] as const) {
      const busy = lineOf(fail({ operation: step === 'remove' ? 'delete' : 'update', status: undefined, source: 'disk', error_name: 'NoModificationAllowedError', local_step: step }), 'browser').row;
      expect(busy).not.toMatch(/by itself|tries again/);
      expect(busy).toBe(lineOf(disk(step === 'remove' ? 'delete' : 'update', step), 'browser').row);
    }
  });

  it('the foreign-id words stand alone: no "above" outside Settings', () => {
    noteRoundIssues(WORLD, 'push', round([fail({ status: 409, message: 'This id already exists in another world' })]));
    const [issue] = issuesFor(WORLD);
    expect(issue.kind).toBe('foreign_id');
    const t = notSyncingTitle(issue, 'folder');
    expect(t).not.toMatch(/above/);
    expect(t).toContain('Settings, under This world, can give it a new id.');
  });
});
