/**
 * Gate A (atlas 1.16) probes: the sync-issues list, the public details
 * block, the usage note's switch, the toast dedupe. Each asserts the CORRECT
 * behaviour: red today = a defect.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { noteRoundIssues, issuesFor, __resetSyncIssues } from '../../../src/sync/sync-issues';
import { buildDetails, problemFor, scrubForReport, detailFields } from '../../../src/core/problems';
import { ToastManager } from '../../../src/ui/toast-manager';
import type { PerElementFailure } from '../../../src/core/types';

const pullHeld = (id: string): PerElementFailure => ({
  element_id: id, type: 'character', operation: 'read', message: 'held',
  error_name: 'InvalidStateError', source: 'disk',
});
const round = (failures: PerElementFailure[]) => ({ failures, auth_blocked: false, transient_blocked: false });

describe('gate A: the sync-issues list tells the truth about pull-side failures', () => {
  beforeEach(() => __resetSyncIssues());

  it('a push round that never retried a pull-side failure does not clear it', () => {
    noteRoundIssues('w', 'pull', round([pullHeld('a')]));
    noteRoundIssues('w', 'push', round([])); // an autosave of another element; nothing pulled
    expect(issuesFor('w').map(i => i.element_id)).toEqual(['a']);
  });

  it('a clean pull clears the pull-side failure it retried (a view-only world only ever pulls)', () => {
    noteRoundIssues('w', 'pull', round([pullHeld('a')]));
    noteRoundIssues('w', 'pull', round([]));
    expect(issuesFor('w')).toEqual([]);
  });
});

describe('gate A: the public details block carries no names', () => {
  const details = (err: unknown) => buildDetails(problemFor(err, { doing: 'saving' }), { world: 'local', browser: 'Chrome 141, Windows', now: new Date(0) });

  it('a name with an inner capital (McAllister, DeVries) is masked', () => {
    const d = details(new Error('McAllister not found in DeVries'));
    expect(d).not.toContain('McAllister');
    expect(d).not.toContain('DeVries');
  });

  it('a name starting with a non-ASCII capital (Éowyn, Ødegaard, Łódź) is masked', () => {
    const d = details(new Error('Éowyn and Ødegaard went to Łódź'));
    expect(d).not.toMatch(/Éowyn|Ødegaard|Łódź/);
  });

  it("JSON.parse's own quote of the user's text does not survive the quote scrubber", () => {
    let err: unknown;
    try { JSON.parse('my "secret" diary entry'); } catch (e) { err = e; }
    expect(details(err)).not.toContain('secret');
  });

  // BANKED: copy now says 'refresh to try again' / schema allow-list not built.
  it.skip('a field name a folder carries outside the schema is not printed (non-namespaced, atlas_)', () => {
    const lines = [
      ...detailFields({ name: 'OwApiError', status: 400, code: 'validation_error', param: 'secret_lover' }),
      ...detailFields({ name: 'OwApiError', status: 400, code: 'validation_error', param: 'atlas_my_diary' }),
    ].join('\n');
    expect(lines).not.toMatch(/secret_lover|atlas_my_diary/);
  });

  it('scrubbing a long message is linear (no quadratic backtracking freeze)', () => {
    const t0 = performance.now();
    scrubForReport('a'.repeat(60_000));
    expect(performance.now() - t0).toBeLessThan(250);
  });
});

describe('gate A: the toast dedupe never hides a different problem', () => {
  let toasts: ToastManager;
  let container: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="toast-container"></div>';
    container = document.getElementById('toast-container')!;
    toasts = new ToastManager();
    toasts.init();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('two unexpected errors with the same sentence keep both detail blocks', () => {
    const sentence = 'Atlas ran into a problem it did not expect while working in the background. Send the details as feedback so it can be fixed.';
    toasts.show(sentence, 'error', 8000, { details: 'Error: TypeError\nMessage: first cause' });
    toasts.show(sentence, 'error', 8000, { details: 'Error: RangeError\nMessage: second cause' });
    vi.advanceTimersByTime(1000);
    const text = container.textContent ?? '';
    expect(text).toContain('first cause');
    expect(text).toContain('second cause');
  });
});
