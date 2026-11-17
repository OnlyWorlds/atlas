/**
 * The roads where what the web host can refuse is a one-line name the person typed say the
 * host's cause without a code block (1.124.13): Make online and New online world (the world's
 * name) and a join (a player's name). A source guard, so dropping `oneLine` from one reddens.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROADS: [string, string][] = [
  ['src/ui/make-online-modal.ts', "doing: 'creating the world online', oneLine: true"],
  ['src/ui/new-api-world-modal.ts', "doing: 'creating the world online', where, oneLine: true"],
  ['src/ui/join-world-modal.ts', "doing: 'joining the world', oneLine: true"],
  ['src/sync/invite-link.ts', "doing: 'making the invite link', oneLine: true"],
];

describe('one-line name roads pass oneLine', () => {
  for (const [file, call] of ROADS) {
    it(file, () => {
      const src = readFileSync(resolve(__dirname, '../..', file), 'utf8');
      expect(src).toContain(call);
    });
  }
});
