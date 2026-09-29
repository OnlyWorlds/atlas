/**
 * The version Settings prints is package.json's, and the release users read
 * about is the changelog's newest block. They drifted for thirteen releases
 * (Settings said v1.0.0 while 1.13 was live, S367), so a release that bumps
 * one must bump the other. Settings reads package.json on purpose: importing
 * the changelog data would put ~46 KB of release notes in the main bundle.
 */
import { describe, it, expect } from 'vitest';
import pkg from '../../package.json';
import { CHANGELOG } from '../../src/changelog/changelog.data';

describe('the app version', () => {
  it('matches the newest changelog release', () => {
    const newest = CHANGELOG[0].version;
    expect(pkg.version === newest || pkg.version.startsWith(`${newest}.`)).toBe(true);
  });
});
