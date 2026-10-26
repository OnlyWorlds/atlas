/**
 * Conv. 151: the words a role change says, once, and keel's 409
 * reason read off the wire. Design note: a role change keeps the copy.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { keptEditsLine, keptLine, memberRoleLine, roleChangeLine } from '../../src/sync/role-change';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';
import { isResyncRequired, resyncReason } from '../../src/sync/sync-engine';
import type { WorldRegistryEntry } from '../../src/core/types';

describe('roleChangeLine: said once per change (I4)', () => {
  it('first sight and no move say nothing', () => {
    expect(roleChangeLine('Ferry', undefined, 'guest', false)).toBeNull();
    expect(roleChangeLine('Ferry', 'guest', 'guest', false)).toBeNull();
  });

  it('lowered to guest: the copy keeps everything, and what is no longer seen stays here', () => {
    const line = roleChangeLine('Ferry', 'co_builder', 'guest', false)!;
    expect(line).toMatch(/^You are now a guest in Ferry\./);
    expect(line).toMatch(/Your copy keeps everything you had\./);
    expect(line).toMatch(/stays here/);
  });

  it('lowered to contributor keeps; raised to contributor says what it may do', () => {
    expect(roleChangeLine('Ferry', 'co_builder', 'contributor', false)).toMatch(/Your copy keeps everything you had\.$/);
    expect(roleChangeLine('Ferry', 'guest', 'contributor', false)).toBe('You are now a contributor in Ferry: you can add to it and change what you add.');
  });

  it('a raise on a copy opened to read points at a key that edits', () => {
    expect(roleChangeLine('Ferry', 'guest', 'co_builder', true)).toMatch(/Settings, This world can give it a key that edits\.$/);
    expect(roleChangeLine('Ferry', 'guest', 'co_builder', false)).toBe('You are now a co-builder in Ferry: you can change everything in it.');
  });

  it('a role keel may add later says nothing rather than something wrong', () => {
    expect(roleChangeLine('Ferry', 'guest', 'editor', false)).toBeNull();
    expect(roleChangeLine('Ferry', 'editor', 'guest', false)).toBeNull();
  });

  it('no em-dash in any line (voice)', () => {
    const lines = [
      roleChangeLine('W', 'co_builder', 'guest', false), roleChangeLine('W', 'guest', 'owner', true),
      keptEditsLine('W', 1), keptEditsLine('W', 3), keptLine('W', 1), keptLine('W', 4),
    ];
    for (const l of lines) expect(l).not.toMatch(/—/);
  });
});

describe('memberRoleLine: Settings says the role, not the scope alone (I5)', () => {
  const entry = (member_role?: string): WorldRegistryEntry => ({
    id: 'w', name: 'Ferry', state: 'api-linked', path: '', api: { world_id: 'x', api_key: 'k', ...(member_role ? { member_role } : {}) },
  } as unknown as WorldRegistryEntry);

  it('a guest, with what is kept counted', () => {
    expect(memberRoleLine(entry('guest'), 2)).toBe('You are a guest in this world: you can add to it and change what you made. 2 elements here are kept from before: OnlyWorlds no longer shows them to you, so they no longer sync.');
  });

  it('a copy opened to read promises no edits', () => {
    const reads = { ...entry('guest'), api: { ...entry('guest').api!, read_only: true } } as WorldRegistryEntry;
    expect(memberRoleLine(reads, 0)).toBe('You are a guest in this world.');
    expect(roleChangeLine('Ferry', 'co_builder', 'guest', true)).not.toMatch(/changes you make/);
    expect(roleChangeLine('Ferry', 'co_builder', 'guest', false)).toMatch(/changes you make to it stay here too/);
  });

  it('the owner and an unread role say nothing; a kept count still shows', () => {
    expect(memberRoleLine(entry('owner'), 0)).toBeNull();
    expect(memberRoleLine(entry(), 0)).toBeNull();
    expect(memberRoleLine(entry(), 1)).toMatch(/^1 element here is kept from before/);
  });
});

describe('keel\'s 409 reason, read off the wire (Skeld 2026-10-20)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  async function refusalFor(body: unknown): Promise<unknown> {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 409, headers: { 'Content-Type': 'application/json' } })));
    const adapter = new OwV2ClientAdapter({ apiKey: 'ow_test', apiPin: '', baseUrl: 'https://keel.test/api/v2' });
    try { await adapter.pullChanges('5:x'); } catch (err) { return err; }
    throw new Error('no refusal');
  }

  it('inside the envelope', async () => {
    const err = await refusalFor({ error: { type: 'invalid_request', code: 'resync_required', message: 'm', param: 'since', reason: 'role' } });
    expect(isResyncRequired(err)).toBe(true);
    expect(resyncReason(err)).toBe('role');
  });

  it('beside the envelope', async () => {
    const err = await refusalFor({ error: { type: 'invalid_request', code: 'resync_required', message: 'm', param: 'since' }, reason: 'view' });
    expect(resyncReason(err)).toBe('view');
  });

  it('absent (keel today), and an unknown value reads as role', async () => {
    expect(resyncReason(await refusalFor({ error: { code: 'resync_required', message: 'm' } }))).toBeNull();
    expect(resyncReason(await refusalFor({ error: { code: 'resync_required', message: 'm', reason: 'roster' } }))).toBe('role');
  });
});
