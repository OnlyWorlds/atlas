/**
 * A world's folder that gains world.json, elements/ or spatial/ in other
 * capitals after it opened (made in another app) cannot be downloaded: the
 * SDK's writer refuses it (`name_case`, SDK 4.212.3), and the download says so
 * in a writer's words, naming the folder, never the reader's "unzip it".
 */
import { describe, it, expect } from 'vitest';
import { zipWorld, writeNameCaseSentence } from '../../src/store/world-file';

const enc = (s: string) => new TextEncoder().encode(s);
const WORLD = { path: 'world.json', data: enc(JSON.stringify({ id: '0192a000-0000-7000-8000-00000000000a', name: 'Sikelia' })) };
const KIRA = { path: 'elements/character/kira--00000001.json', data: enc(JSON.stringify({ id: '0192a000-0000-7000-8000-000000000001', name: 'Kira' })) };

describe('a download over a folder in other capitals', () => {
  it('Spatial/ beside elements/: refused with the folder named', () => {
    const pin = { path: 'Spatial/pin/p--00000002.json', data: enc(JSON.stringify({ id: '0192a000-0000-7000-8000-000000000002', name: 'A pin' })) };
    expect(() => zipWorld([WORLD, KIRA, pin], 'sikelia')).toThrow(writeNameCaseSentence('Spatial/', 'spatial/'));
  });
  it('Elements/ alone: refused with the folder named', () => {
    const kira = { ...KIRA, path: 'Elements/character/kira--00000001.json' };
    expect(() => zipWorld([WORLD, kira], 'sikelia')).toThrow("This world's folder holds Elements/ where the folder format names elements/, so no file was made: rename it elements/ and download again.");
  });
  it('the names as written: the file is made', () => {
    expect(zipWorld([WORLD, KIRA], 'sikelia').byteLength).toBeGreaterThan(0);
  });
});
