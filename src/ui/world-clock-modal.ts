/**
 * World clock modal — the gate that enables calendar creation (2B design §2).
 *
 * The one required question: what does one step of time MEAN in this world
 * (writes `time_basic_unit`). Beneath it, optional and clearly part of the
 * clock: the now (`time_current`) and the recorded extent
 * (`time_range_min/max`). All four are world physics — synced via the meta
 * step; the write pattern is the room's setNow.
 *
 * Gating rules live in the CALLER (charts room): hidden on view-only worlds;
 * on api-linked worlds it waits for the first meta round and PRE-FILLS from
 * whatever is already set — device B never silently overwrites device A's
 * physics (gate 2026-07-14). This modal itself just shows current values and
 * writes the diff.
 */

import { BaseModal } from './modal-base';
import { ToastManager } from './toast-manager';
import { showProblem } from './problem-fixes';
import { getState, patchActiveMeta, patchSlice } from '../core/state';
import { getActiveStore } from '../core/active-store';
import { requestPushIfLinked } from '../sync/sync-attach';
import { escapeText } from '../core/dom-utils';
// view-only-ok: opened only from the Charts calendar menu, which a view-only world does not show (timeline.ts) (conv. 149).

const STEP_SUGGESTIONS = ['year', 'day', 'cycle', 'turn', 'age'];

export interface WorldClockModalOpts {
  /** Called after a successful save (the gate flow opens the builder next). */
  onSaved?: () => void;
}

export class WorldClockModal extends BaseModal {
  constructor(private toasts: ToastManager, private opts: WorldClockModalOpts = {}) {
    super();
  }

  open(): void {
    const meta = (getState().active?.meta ?? {}) as Record<string, unknown>;
    const unit = typeof meta.time_basic_unit === 'string' ? meta.time_basic_unit : '';
    const now = typeof meta.time_current === 'number' ? String(meta.time_current) : '';
    const min = typeof meta.time_range_min === 'number' ? String(meta.time_range_min) : '';
    const max = typeof meta.time_range_max === 'number' ? String(meta.time_range_max) : '';

    const { overlay, body } = this.buildModalShell({
      title: 'Your world’s clock',
      dataModal: 'world-clock',
      panelClass: 'atlas-worldclock-panel',
    });

    body.innerHTML = `
      <form class="atlas-worldclock-form">
        <label class="atlas-modal-label" for="wc-unit">What does one step of time mean in this world?</label>
        <input id="wc-unit" name="unit" type="text" class="atlas-modal-input" required
               placeholder="year, day, cycle… your word" value="${escapeText(unit)}"
               list="wc-unit-suggestions" autocomplete="off" />
        <datalist id="wc-unit-suggestions">
          ${STEP_SUGGESTIONS.map(s => `<option value="${s}"></option>`).join('')}
        </datalist>
        <p class="atlas-worldclock-hint">Every date in this world is a number of these steps. Calendars name and group them; this meaning is shared by all of them.</p>

        <div class="atlas-worldclock-optional">
          <div class="atlas-worldclock-row">
            <label class="atlas-modal-label" for="wc-now">The now <span class="atlas-worldclock-opt">Optional</span></label>
            <input id="wc-now" name="now" type="number" class="atlas-modal-input" value="${escapeText(now)}"
                   placeholder="Where the story is" />
          </div>
          <div class="atlas-worldclock-row atlas-worldclock-range">
            <label class="atlas-modal-label">Recorded history runs <span class="atlas-worldclock-opt">Optional</span></label>
            <div class="atlas-worldclock-range-inputs">
              <input id="wc-min" name="min" type="number" class="atlas-modal-input" value="${escapeText(min)}" placeholder="From" />
              <span>–</span>
              <input id="wc-max" name="max" type="number" class="atlas-modal-input" value="${escapeText(max)}" placeholder="To" />
            </div>
            <p class="atlas-worldclock-hint">Leave empty and the chart fits itself to your dated elements.</p>
          </div>
        </div>

        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="submit" class="atlas-btn-primary" data-action="save-clock">Set the clock</button>
        </div>
      </form>
    `;

    const form = body.querySelector('form') as HTMLFormElement;
    body.querySelector('[data-action="cancel"]')!.addEventListener('click', () => this.hide());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.save(form);
    });

    this.modal = overlay;
    this.show();
    (body.querySelector('#wc-unit') as HTMLInputElement).focus();
  }

  private async save(form: HTMLFormElement): Promise<void> {
    const store = getActiveStore();
    const active = getState().active;
    if (!store || !active) { this.hide(); return; }
    const val = (name: string): string => (form.querySelector(`[name="${name}"]`) as HTMLInputElement).value.trim();
    const numOr = (s: string): number | undefined => (s === '' ? undefined : Number(s));

    const unit = val('unit');
    if (!unit) return;
    const patch: Record<string, unknown> = {
      time_basic_unit: unit,
      time_current: numOr(val('now')),
      time_range_min: numOr(val('min')),
      time_range_max: numOr(val('max')),
    };
    try {
      await store.writeWorldMeta(patch);
      patchActiveMeta(active.worldId, patch);
      requestPushIfLinked();
      this.hide();
      this.toasts.success('World clock set');
      this.opts.onSaved?.();
    } catch (err) {
      // The modal stays open: Save again is the retry.
      console.error('[calendar] world clock save failed:', err);
      showProblem(err, { doing: 'saving the world clock', toasts: this.toasts });
    }
  }
}
