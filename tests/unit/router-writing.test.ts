/**
 * Router tests for the writing room URL scheme.
 *
 * The URL was shortened from
 *   /writing/book/<bId>[/chapter/<cId>[/scene/<sId>]]
 * to
 *   /writing/<narrativeId>
 *
 * The parser still accepts the legacy form for back-compat and picks the
 * deepest segment as the active narrative id.
 */

import { describe, it, expect } from 'vitest';
import { parseHash, writingHash } from '../../src/core/router';

describe('parseHash — writing room (new short form)', () => {
  it('parses /writing with no narrative', () => {
    const r = parseHash('#/w/w1/writing');
    expect(r.mode).toBe('writing');
    expect(r.worldId).toBe('w1');
    expect(r.narrativeId).toBeUndefined();
  });

  it('parses /writing/<narrativeId>', () => {
    const r = parseHash('#/w/w1/writing/abc-123');
    expect(r.mode).toBe('writing');
    expect(r.worldId).toBe('w1');
    expect(r.narrativeId).toBe('abc-123');
  });

  it('parses /writing/<uuid-v7-style>', () => {
    const r = parseHash('#/w/w1/writing/06a0c1b2-3aa5-79b9-8000-65ae95fdeaaf');
    expect(r.narrativeId).toBe('06a0c1b2-3aa5-79b9-8000-65ae95fdeaaf');
  });
});

describe('parseHash — writing room (legacy long form back-compat)', () => {
  it('parses /writing/book/<bId> as narrativeId=bId', () => {
    const r = parseHash('#/w/w1/writing/book/b-1');
    expect(r.mode).toBe('writing');
    expect(r.narrativeId).toBe('b-1');
  });

  it('parses /writing/book/<bId>/chapter/<cId> as narrativeId=cId', () => {
    const r = parseHash('#/w/w1/writing/book/b-1/chapter/c-1');
    expect(r.narrativeId).toBe('c-1');
  });

  it('parses /writing/book/<bId>/chapter/<cId>/scene/<sId> as narrativeId=sId', () => {
    const r = parseHash('#/w/w1/writing/book/b-1/chapter/c-1/scene/s-1');
    expect(r.narrativeId).toBe('s-1');
  });
});

describe('writingHash emits the short form', () => {
  it('emits the bare writing URL without a narrative', () => {
    expect(writingHash('w1')).toBe('#/w/w1/writing');
  });

  it('emits /writing/<narrativeId>', () => {
    expect(writingHash('w1', 'abc-123')).toBe('#/w/w1/writing/abc-123');
  });

  it('emits the short form regardless of the narrative id format', () => {
    expect(writingHash('w1', '06a0c1b2-3aa5-79b9-8000-65ae95fdeaaf')).toBe(
      '#/w/w1/writing/06a0c1b2-3aa5-79b9-8000-65ae95fdeaaf',
    );
  });

  it('NEVER emits the legacy /book/.../chapter/... form', () => {
    const hash = writingHash('w1', 'some-id');
    expect(hash).not.toContain('/book/');
    expect(hash).not.toContain('/chapter/');
    expect(hash).not.toContain('/scene/');
  });
});

describe('parseHash + writingHash round-trip', () => {
  it('round-trips the short form', () => {
    const original = writingHash('w1', 'abc-123');
    const parsed = parseHash(original);
    expect(parsed.mode).toBe('writing');
    expect(parsed.worldId).toBe('w1');
    expect(parsed.narrativeId).toBe('abc-123');
    expect(writingHash(parsed.worldId!, parsed.narrativeId)).toBe(original);
  });

  it('migrates legacy URLs to short form on re-emit', () => {
    const legacy = '#/w/w1/writing/book/b-1/chapter/c-1/scene/s-1';
    const parsed = parseHash(legacy);
    expect(parsed.narrativeId).toBe('s-1');
    // Re-emitting from the parsed state gives the short form (legacy → short migration).
    expect(writingHash(parsed.worldId!, parsed.narrativeId)).toBe('#/w/w1/writing/s-1');
  });
});
