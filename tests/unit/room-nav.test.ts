/**
 * First tests for `src/middle/room-nav.ts` (the persistent room-icon strip).
 * Zero prior test references, and two live bugs shipped from this exact file
 * in the last week (the label-shortener that stranded "Data"/"import" on
 * one control, and the "known worldId" guard against a stale/dead deep link
 * rendering a stuck real nav). Both classes are covered below: the label
 * shortener (`truncateName`, exercised through the selected-element chip,
 * since it is not itself exported) and the preview-vs-real / active-route
 * decision (`render`'s `known` guard and each room's `matches` array).
 *
 * `mountRoomNav` reads real global state (`core/state`) and the real hash
 * router (`core/router`) rather than mocking either — both are small,
 * synchronous, in-memory modules, and the whole point of this file is to
 * prove the DOM the strip actually produces for a given state+route, not to
 * re-describe its own wiring. Each test resets the relevant state slices and
 * the location hash itself so tests don't leak into each other.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mountRoomNav } from '../../src/middle/room-nav';
import { getState, patchSlice } from '../../src/core/state';
import type { Element, WorldsRegistry } from '../../src/core/types';

function resetState(): void {
  window.location.hash = '';
  patchSlice('registry', { version: 1, worlds: [] } as WorldsRegistry);
  patchSlice('active', null);
  patchSlice('data', { elements: [] });
  patchSlice('ui', {
    ...getState().ui,
    selectedElementId: null,
    sidebarWritingOverride: false,
  });
}

function mount(): { target: HTMLElement; unmount: () => void } {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const unmount = mountRoomNav({ target });
  return { target, unmount };
}

function activateWorld(worldId: string): void {
  patchSlice('registry', {
    version: 1,
    worlds: [{
      id: worldId,
      name: 'Test World',
      state: 'local-only',
      folder: { handle_key: 'k', folder_name: 'f' },
    }],
  } as WorldsRegistry);
  patchSlice('active', {
    worldId,
    meta: { id: worldId, name: 'Test World' },
    opened: true,
  });
}

describe('mountRoomNav — preview vs. real, and the active-route decision', () => {
  beforeEach(resetState);

  it('renders the disabled preview strip with no active world and no hash', () => {
    const { target, unmount } = mount();
    const strip = target.querySelector('.atlas-room-nav-strip')!;
    expect(strip.classList.contains('is-preview')).toBe(true);
    const previewBtns = target.querySelectorAll('.atlas-room-nav-preview-btn');
    // home, writing, knowledge, timeline, share, import — every PREVIEW_ROOM_ID.
    expect(previewBtns.length).toBe(6);
    previewBtns.forEach(btn => {
      expect(btn.getAttribute('aria-disabled')).toBe('true');
    });
    unmount();
  });

  it('a hash naming a world the registry does not know still falls back to preview', () => {
    // The stale-deep-link guard: `known` must be false here even though the
    // hash carries a worldId, because neither `active` nor the registry
    // recognises it.
    window.location.hash = '#/w/some-dead-world-id';
    const { target, unmount } = mount();
    expect(target.querySelector('.atlas-room-nav-strip')!.classList.contains('is-preview')).toBe(true);
    unmount();
  });

  it('a known world renders the real strip with data-room buttons, not preview', () => {
    activateWorld('w1');
    window.location.hash = '#/w/w1';
    const { target, unmount } = mount();
    const strip = target.querySelector('.atlas-room-nav-strip')!;
    expect(strip.classList.contains('is-preview')).toBe(false);
    expect(target.querySelectorAll('[data-room]').length).toBe(6);
    unmount();
  });

  it('the home route (bare /w/<id>) marks the home button active', () => {
    activateWorld('w1');
    window.location.hash = '#/w/w1';
    const { target, unmount } = mount();
    expect(target.querySelector('[data-room="home"]')!.classList.contains('active')).toBe(true);
    expect(target.querySelector('[data-room="writing"]')!.classList.contains('active')).toBe(false);
    unmount();
  });

  it('the legacy /elements route ALSO matches home (home\'s matches array includes it)', () => {
    activateWorld('w1');
    window.location.hash = '#/w/w1/elements';
    const { target, unmount } = mount();
    expect(target.querySelector('[data-room="home"]')!.classList.contains('active')).toBe(true);
    unmount();
  });

  it('the writing route marks writing active and home inactive', () => {
    activateWorld('w1');
    window.location.hash = '#/w/w1/writing';
    const { target, unmount } = mount();
    expect(target.querySelector('[data-room="writing"]')!.classList.contains('active')).toBe(true);
    expect(target.querySelector('[data-room="home"]')!.classList.contains('active')).toBe(false);
    unmount();
  });

  it('a room whose route is not the current one never lights up (no cross-talk)', () => {
    activateWorld('w1');
    window.location.hash = '#/w/w1/knowledge';
    const { target, unmount } = mount();
    for (const id of ['home', 'writing', 'timeline', 'share', 'import']) {
      expect(target.querySelector(`[data-room="${id}"]`)!.classList.contains('active'), id).toBe(false);
    }
    expect(target.querySelector('[data-room="knowledge"]')!.classList.contains('active')).toBe(true);
    unmount();
  });
});

describe('mountRoomNav — the selected-element chip name (truncateName)', () => {
  beforeEach(resetState);

  function withSelectedElement(name: string): { target: HTMLElement; unmount: () => void; el: Element } {
    activateWorld('w1');
    window.location.hash = '#/w/w1';
    const el = {
      id: 'e1',
      type: 'character',
      name,
      local_updated_at: '2026-07-22T00:00:00.000Z',
    } as Element;
    patchSlice('data', { elements: [el] });
    patchSlice('ui', { ...getState().ui, selectedElementId: 'e1' });
    const { target, unmount } = mount();
    return { target, unmount, el };
  }

  it('a short name renders unchanged, with no ellipsis', () => {
    const { target, unmount } = withSelectedElement('The Consul');
    const label = target.querySelector('.atlas-room-nav-selected-name')!;
    expect(label.textContent).toBe('The Consul');
    expect(label.textContent).not.toContain('…');
    unmount();
  });

  it('a name over 22 chars is shortened to 21 chars + an ellipsis (the stale shortener\'s bug shape)', () => {
    // This is the live-bug shape: a stale/rewritten shortener could show the
    // full name (breaking layout) or truncate to the wrong length/character —
    // both would fail this exact-string check.
    const longName = 'A Name Substantially Longer Than The Chip Allows';
    const { target, unmount } = withSelectedElement(longName);
    const label = target.querySelector('.atlas-room-nav-selected-name')!;
    const expected = longName.slice(0, 21).trimEnd() + '…';
    expect(label.textContent).toBe(expected);
    expect(label.textContent!.length).toBeLessThanOrEqual(22);
    unmount();
  });

  it('the chip title carries the FULL name even when the visible label is truncated', () => {
    // The truncation is cosmetic only: the tooltip/title must still teach the
    // real name. A shortener that truncated the title too would defeat the
    // whole point of truncating (there'd be nowhere left to read the name).
    const longName = 'A Name Substantially Longer Than The Chip Allows';
    const { target, unmount } = withSelectedElement(longName);
    const chip = target.querySelector('.atlas-room-nav-selected')!;
    expect(chip.getAttribute('title')).toContain(longName);
    unmount();
  });

  it('an unnamed element falls back to "(unnamed)" rather than an empty chip', () => {
    const { target, unmount } = withSelectedElement('');
    const label = target.querySelector('.atlas-room-nav-selected-name')!;
    expect(label.textContent).toBe('(unnamed)');
    unmount();
  });

  it('no selected element means no chip at all', () => {
    activateWorld('w1');
    window.location.hash = '#/w/w1';
    const { target, unmount } = mount();
    expect(target.querySelector('.atlas-room-nav-selected')).toBeNull();
    unmount();
  });
});
