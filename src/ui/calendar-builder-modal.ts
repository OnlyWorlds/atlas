/**
 * Calendar builder modal — create or edit a calendar (2B design §Flow 2 + §5).
 *
 * A calendar is a Construct (supertype 'calendar' by convention) whose machine
 * structure lives in the `atlas_calendar` field. The builder is the ONLY edit
 * surface for that field (it is machinery — hidden from the custom-fields
 * editor); the construct's lore fields (description, founder, custodian…) are
 * edited in the element room like any element.
 *
 * Every section below "name" is optional: a minimal calendar (step word +
 * eras + format) must feel complete, not truncated. The live preview panel
 * formats real sample steps through the draft on every input — the instant
 * loop is the point. Validation errors render loudly in the same panel;
 * saving is blocked while any exist.
 *
 * The world grain rule (contract rule 10): a year-grain world's builder never
 * offers months/weeks/intercalary — a calendar cannot invent finer resolution
 * than the dates carry.
 */

import { BaseModal } from './modal-base';
import { ToastManager } from './toast-manager';
import { showProblem } from './problem-fixes';
import { getState } from '../core/state';
import { getActiveStore } from '../core/active-store';
import { refreshElementsAfterWrite } from '../sync/sync-attach';
import { escapeText } from '../core/dom-utils';
import {
  type CalendarConfig, type CalendarEra, type CalendarIntercalary,
  validateCalendarConfig, formatStep,
} from '@onlyworlds/sdk';
import { CALENDAR_SUPERTYPE, readCalendarValue } from '../core/calendar-lens';
// view-only-ok: opened only from the Charts calendar menu, which a view-only world does not show (timeline.ts) (conv. 149).

export interface CalendarBuilderOpts {
  /** Present = edit this calendar element; absent = create a new one. */
  elementId?: string;
  /** Sample steps for the live preview (the room passes min/mid/now/max). */
  sampleSteps: number[];
  /** Called with the element id after create/save (the room activates the lens). */
  onSaved?: (elementId: string) => void;
  /**
   * Legacy-field mint seed (2B §1): prefills the step word and lands the
   * inherited vocabulary in the construct's description. Create-only.
   */
  seed?: { stepName?: string | null; description?: string };
}

interface EraDraft {
  name: string; abbrev: string; start: string; end: string;
  numbering: 'from-1' | 'from-0' | 'continuous';
  direction: 'up' | 'down';
  closed: boolean;
}

interface MonthDraft { name: string; length: string; }
/**
 * `rest`: the stored entry's keys the form does not draw (a version 2 leap
 * rule's `except` and `offset`, SDK 4.76, or anything newer), carried back on
 * save so an edit never strips them (the stored-config rule, per festival day).
 */
interface InterDraft { name: string; after: string; everyYears: string; inWeek: boolean; rest?: Record<string, unknown>; }

const DRAWN_INTER_KEYS = new Set(['name', 'after_month', 'every_years', 'in_week']);
/** Version 2 only on a calendar that uses its keys (the profile at serial 68). */
const V2_INTER_KEYS = ['except', 'offset'];

interface Draft {
  name: string;
  stepName: string;
  eras: EraDraft[];
  months: MonthDraft[];
  weekLength: string;
  weekNames: string;
  weekMode: 'free' | 'nested';
  intercalary: InterDraft[];
  format: string;
  formatIntercalary: string;
}

export class CalendarBuilderModal extends BaseModal {
  private draft: Draft;
  private grain: string;
  /** The config as stored, on edit: save patches it, never rebuilds it. */
  private stored: CalendarConfig | null = null;
  /** Set once a new calendar is written, so Save after a later failure updates it instead of making a second. */
  private createdId: string | null = null;

  constructor(private toasts: ToastManager, private opts: CalendarBuilderOpts) {
    super();
    // A blank clock unit is no grain: the calendar profile requires one, and
    // SDK 4.102.5 reads a calendar with an empty grain as no calendar at all.
    const unit = getState().active?.meta?.time_basic_unit;
    this.grain = typeof unit === 'string' && unit.trim() !== '' ? unit : 'step';
    this.draft = this.loadDraft();
  }

  private loadDraft(): Draft {
    const empty: Draft = {
      name: '', stepName: this.opts.seed?.stepName || this.grain,
      eras: [], months: [],
      weekLength: '', weekNames: '', weekMode: 'free',
      intercalary: [],
      format: '', formatIntercalary: '',
    };
    if (!this.opts.elementId) return empty;
    const el = getState().data.elements.find(e => e.id === this.opts.elementId);
    if (!el) return empty;
    // Tolerant read (object OR JSON string) — an object-only read here would
    // load an EMPTY draft for a string-config calendar and save would blank it.
    const cfg = readCalendarValue((el as Record<string, unknown>)['atlas_calendar']);
    if (!cfg) return { ...empty, name: el.name };
    this.stored = structuredClone(cfg);
    return {
      name: el.name,
      stepName: cfg.step_name ?? cfg.grain,
      eras: (cfg.eras ?? []).map(e => ({
        name: e.name, abbrev: e.abbrev ?? '',
        start: String(e.start), end: e.end != null ? String(e.end) : '',
        numbering: e.restart === false ? 'continuous' : (e.year_base === 0 ? 'from-0' : 'from-1'),
        direction: e.direction ?? 'up',
        closed: !!e.closed,
      })),
      months: (cfg.bundles?.months?.names ?? []).map((n, i) => ({
        name: n, length: String(cfg.bundles!.months!.lengths[i] ?? ''),
      })),
      weekLength: cfg.bundles?.week ? String(cfg.bundles.week.length) : '',
      weekNames: cfg.bundles?.week?.names.join(', ') ?? '',
      weekMode: cfg.bundles?.week?.mode ?? 'free',
      intercalary: (cfg.intercalary ?? []).map(ic => ({
        name: ic.name, after: String(ic.after_month),
        everyYears: ic.every_years != null ? String(ic.every_years) : '',
        inWeek: ic.in_week !== false,
        rest: Object.fromEntries(Object.entries(ic).filter(([k]) => !DRAWN_INTER_KEYS.has(k))),
      })),
      // A format that is not a string is one the SDK ignores (4.103.0): the
      // form shows it blank, and a blank save leaves the stored value alone.
      format: typeof cfg.format === 'string' ? cfg.format : '',
      formatIntercalary: typeof cfg.format_intercalary === 'string' ? cfg.format_intercalary : '',
    };
  }

  /**
   * The draft as a CalendarConfig (or the reason it isn't one yet). On edit it
   * starts from the STORED config and patches only the fields the form owns:
   * sections the form does not render, a coarse
   * `bundles.year`, unknown keys and the grain all survive a save.
   */
  private buildConfig(): { config: CalendarConfig; errors: string[] } {
    const d = this.draft;
    const num = (s: string): number => Number(s.trim());
    const config: CalendarConfig = this.stored ? structuredClone(this.stored) : { version: 1, grain: this.grain };
    const grain = config.grain;
    const stepName = d.stepName.trim();
    const storedStepWord = this.stored ? (this.stored.step_name ?? this.stored.grain) : null;
    if (stepName === storedStepWord) { /* untouched: keep as stored */ }
    else if (stepName && stepName !== grain) config.step_name = stepName;
    else delete config.step_name;

    const eras: CalendarEra[] = [];
    for (const e of d.eras) {
      if (!e.name.trim() && !e.start.trim()) continue; // blank row
      const era: CalendarEra = { name: e.name.trim(), start: num(e.start) };
      if (e.abbrev.trim()) era.abbrev = e.abbrev.trim();
      if (e.end.trim()) era.end = num(e.end);
      if (e.numbering === 'continuous') era.restart = false;
      else if (e.numbering === 'from-0') era.year_base = 0;
      if (e.direction === 'down') era.direction = 'down';
      if (e.closed) era.closed = true;
      eras.push(era);
    }
    if (eras.length > 0) config.eras = eras;
    else delete config.eras;

    // Months, week and festival days are the form's only when it renders them;
    // on a year-grain world they are hidden and the stored ones stay.
    if (!this.yearGrain()) {
      const bundles: NonNullable<CalendarConfig['bundles']> = { ...config.bundles };
      const months = d.months.filter(m => m.name.trim() || m.length.trim());
      if (months.length > 0) {
        bundles.months = {
          names: months.map(m => m.name.trim()),
          lengths: months.map(m => num(m.length)),
        };
        delete bundles.year; // months define the year length (the form says so)
      } else {
        delete bundles.months;
      }
      if (d.weekLength.trim()) {
        const names = d.weekNames.split(',').map(s => s.trim()).filter(Boolean);
        bundles.week = { length: num(d.weekLength), names, mode: d.weekMode };
      } else {
        delete bundles.week;
      }
      if (Object.keys(bundles).length > 0) config.bundles = bundles;
      else delete config.bundles;
      const inter = d.intercalary.filter(ic => ic.name.trim());
      if (inter.length > 0) {
        config.intercalary = inter.map(ic => {
          const entry: CalendarIntercalary = { ...(ic.rest ?? {}), name: ic.name.trim(), after_month: num(ic.after || '0') };
          if (ic.everyYears.trim()) entry.every_years = num(ic.everyYears);
          if (!ic.inWeek) entry.in_week = false;
          return entry;
        });
      } else {
        delete config.intercalary;
      }
      if (config.version === 1 || config.version === 2) {
        const usesV2 = (config.intercalary ?? []).some(ic => V2_INTER_KEYS.some(k => k in ic));
        config.version = usesV2 ? 2 : 1;
      }
    }

    if (d.format.trim()) config.format = d.format.trim();
    else if (typeof config.format === 'string') delete config.format;
    if (!this.yearGrain()) {
      if (d.formatIntercalary.trim()) config.format_intercalary = d.formatIntercalary.trim();
      else if (typeof config.format_intercalary === 'string') delete config.format_intercalary;
    }

    const errors = validateCalendarConfig(config);
    if (!this.draft.name.trim()) errors.unshift('The calendar needs a name');
    return { config, errors };
  }

  private yearGrain(): boolean {
    return this.grain.trim().toLowerCase() === 'year';
  }

  /** The step word the calendar was made with (stored grain on edit, world grain on create). */
  private calendarGrain(): string {
    return this.stored?.grain ?? this.grain;
  }

  /**
   * Plain notes on what the form keeps but does not show: a
   * grain that no longer matches the world clock, and a coarse year length.
   */
  private keptNotes(): string {
    const s = this.stored;
    if (!s) return '';
    const notes: string[] = [];
    if (s.grain.trim().toLowerCase() !== this.grain.trim().toLowerCase()) {
      const hidden = this.yearGrain() && (s.bundles?.months || s.bundles?.week || (s.intercalary?.length ?? 0) > 0);
      notes.push(`<p class="atlas-calbuilder-hint" data-role="grain-note">This calendar was made when one step was a ${escapeText(s.grain)}; the world clock now counts in ${escapeText(this.grain)}s. It keeps its original step.${hidden ? ' Its months, week and festival days are kept as they are but are not shown here.' : ''}</p>`);
    }
    const yearSteps = s.bundles?.year?.steps;
    if (yearSteps != null && !s.bundles?.months) {
      notes.push(`<p class="atlas-calbuilder-hint" data-role="year-note">A year here is ${escapeText(String(yearSteps))} ${escapeText(s.grain)}s long. That is kept as it is.${this.yearGrain() ? '' : ' Adding months replaces it, since the months then set the year.'}</p>`);
    }
    return notes.join('');
  }

  open(): void {
    const { overlay, body } = this.buildModalShell({
      title: this.opts.elementId ? 'Edit calendar' : 'Create a calendar',
      dataModal: 'calendar-builder',
      panelClass: 'atlas-calbuilder-panel',
    });

    body.innerHTML = `
      <div class="atlas-calbuilder">
        <div class="atlas-calbuilder-form">
          <label class="atlas-modal-label" for="cb-name">Name</label>
          <input id="cb-name" data-field="name" type="text" class="atlas-modal-input"
                 placeholder="The Imperial Reckoning" value="${escapeText(this.draft.name)}" />

          <label class="atlas-modal-label" for="cb-step">What one ${escapeText(this.calendarGrain())} is called here <span class="atlas-calbuilder-opt">Optional</span></label>
          <input id="cb-step" data-field="stepName" type="text" class="atlas-modal-input"
                 placeholder="${escapeText(this.calendarGrain())}" value="${escapeText(this.draft.stepName)}" />
          ${this.keptNotes()}

          <div class="atlas-calbuilder-section" data-section="eras">
            <div class="atlas-calbuilder-section-head">Eras <span class="atlas-calbuilder-opt">Named stretches with their own counting</span></div>
            <div class="atlas-calbuilder-rows" data-rows="eras"></div>
            <button type="button" class="atlas-btn-ghost atlas-calbuilder-add" data-add="era">+ Era</button>
          </div>

          ${this.yearGrain() ? '' : `
          <div class="atlas-calbuilder-section" data-section="months">
            <div class="atlas-calbuilder-section-head">Months <span class="atlas-calbuilder-opt">Group ${escapeText(this.grain)}s into a year</span></div>
            <div class="atlas-calbuilder-rows" data-rows="months"></div>
            <button type="button" class="atlas-btn-ghost atlas-calbuilder-add" data-add="month">+ Month</button>
          </div>

          <div class="atlas-calbuilder-section" data-section="week">
            <div class="atlas-calbuilder-section-head">Week <span class="atlas-calbuilder-opt">A repeating cycle of named days</span></div>
            <div class="atlas-calbuilder-week">
              <input data-field="weekLength" type="number" min="1" class="atlas-modal-input atlas-calbuilder-week-len"
                     placeholder="Length" value="${escapeText(this.draft.weekLength)}" />
              <input data-field="weekNames" type="text" class="atlas-modal-input"
                     placeholder="Day names, comma-separated" value="${escapeText(this.draft.weekNames)}" />
              <select data-field="weekMode" class="atlas-modal-input atlas-calbuilder-week-mode" title="Free: the week runs across month boundaries. Nested: it restarts with each month.">
                <option value="free" ${this.draft.weekMode === 'free' ? 'selected' : ''}>Runs freely</option>
                <option value="nested" ${this.draft.weekMode === 'nested' ? 'selected' : ''}>Restarts each month</option>
              </select>
            </div>
          </div>

          <div class="atlas-calbuilder-section" data-section="intercalary">
            <div class="atlas-calbuilder-section-head">Festival days <span class="atlas-calbuilder-opt">Days between months, belonging to none</span></div>
            <div class="atlas-calbuilder-rows" data-rows="intercalary"></div>
            <button type="button" class="atlas-btn-ghost atlas-calbuilder-add" data-add="intercalary">+ Festival day</button>
          </div>
          `}

          <div class="atlas-calbuilder-section" data-section="format">
            <div class="atlas-calbuilder-section-head">How a date reads</div>
            <input data-field="format" type="text" class="atlas-modal-input"
                   placeholder="${this.yearGrain() ? '{year} {era}' : '{day} {month}, {year} {era}'}"
                   value="${escapeText(this.draft.format)}" />
            <p class="atlas-calbuilder-hint">Pieces: {day} {month} {weekday} {year} {era} {step}. Empty pieces disappear.</p>
            ${this.yearGrain() ? '' : `
            <input data-field="formatIntercalary" type="text" class="atlas-modal-input"
                   placeholder="{intercalary}, {year} {era}" value="${escapeText(this.draft.formatIntercalary)}"
                   title="How a festival day reads (it has no month or day number)" />
            `}
          </div>
        </div>

        <div class="atlas-calbuilder-preview" data-role="preview"></div>

        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="button" class="atlas-btn-primary" data-action="save-calendar">${this.opts.elementId ? 'Save calendar' : 'Create calendar'}</button>
        </div>
      </div>
    `;

    this.renderRows(body);
    this.renderPreview(body);

    // One delegated input listener keeps the draft + preview live per keystroke.
    body.addEventListener('input', (e) => {
      const t = e.target as HTMLElement;
      const field = t.getAttribute('data-field');
      if (field) this.readScalar(field, t as HTMLInputElement);
      this.readRows(body);
      this.renderPreview(body);
    });
    body.addEventListener('change', () => { this.readRows(body); this.renderPreview(body); });

    body.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-add],[data-remove],[data-action]') as HTMLElement | null;
      if (!t) return;
      const add = t.getAttribute('data-add');
      if (add === 'era') this.draft.eras.push({ name: '', abbrev: '', start: '0', end: '', numbering: 'from-1', direction: 'up', closed: false });
      if (add === 'month') this.draft.months.push({ name: '', length: '30' });
      if (add === 'intercalary') this.draft.intercalary.push({ name: '', after: '0', everyYears: '', inWeek: true });
      if (add) { this.renderRows(body); this.renderPreview(body); return; }
      const remove = t.getAttribute('data-remove');
      if (remove) {
        const [kind, idxStr] = remove.split(':');
        const idx = Number(idxStr);
        if (kind === 'era') this.draft.eras.splice(idx, 1);
        if (kind === 'month') this.draft.months.splice(idx, 1);
        if (kind === 'intercalary') this.draft.intercalary.splice(idx, 1);
        this.renderRows(body);
        this.renderPreview(body);
        return;
      }
      const action = t.getAttribute('data-action');
      if (action === 'cancel') this.hide();
      if (action === 'save-calendar') void this.save();
    });

    this.modal = overlay;
    this.show();
    (body.querySelector('#cb-name') as HTMLInputElement).focus();
  }

  private readScalar(field: string, input: HTMLInputElement): void {
    const d = this.draft as unknown as Record<string, unknown>;
    if (field in d && typeof d[field] === 'string') d[field] = input.value;
  }

  /** Re-read every row input into the draft (rows carry data-row/data-col). */
  private readRows(body: HTMLElement): void {
    body.querySelectorAll<HTMLElement>('[data-row]').forEach(row => {
      const [kind, idxStr] = row.getAttribute('data-row')!.split(':');
      const idx = Number(idxStr);
      const col = (name: string): string =>
        (row.querySelector(`[data-col="${name}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
      const checked = (name: string): boolean =>
        (row.querySelector(`[data-col="${name}"]`) as HTMLInputElement | null)?.checked ?? false;
      if (kind === 'era' && this.draft.eras[idx]) {
        this.draft.eras[idx] = {
          name: col('name'), abbrev: col('abbrev'), start: col('start'), end: col('end'),
          numbering: col('numbering') as EraDraft['numbering'],
          direction: col('direction') as EraDraft['direction'],
          closed: checked('closed'),
        };
      }
      if (kind === 'month' && this.draft.months[idx]) {
        this.draft.months[idx] = { name: col('name'), length: col('length') };
      }
      if (kind === 'intercalary' && this.draft.intercalary[idx]) {
        this.draft.intercalary[idx] = {
          ...this.draft.intercalary[idx],
          name: col('name'), after: col('after'), everyYears: col('every'), inWeek: checked('inweek'),
        };
      }
    });
  }

  private renderRows(body: HTMLElement): void {
    const eraRows = body.querySelector('[data-rows="eras"]');
    if (eraRows) {
      eraRows.innerHTML = this.draft.eras.map((e, i) => `
        <div class="atlas-calbuilder-row" data-row="era:${i}">
          <input data-col="name" type="text" class="atlas-modal-input" placeholder="Era name" value="${escapeText(e.name)}" />
          <input data-col="abbrev" type="text" class="atlas-modal-input atlas-calbuilder-narrow" placeholder="Abbr" value="${escapeText(e.abbrev)}" />
          <input data-col="start" type="number" class="atlas-modal-input atlas-calbuilder-narrow" placeholder="Starts" title="Where this era begins on the world's line (for a countdown era: its pivot)" value="${escapeText(e.start)}" />
          <input data-col="end" type="number" class="atlas-modal-input atlas-calbuilder-narrow" placeholder="Ends" title="Optional. Ends before the next era begins = a real gap in between" value="${escapeText(e.end)}" />
          <select data-col="numbering" class="atlas-modal-input atlas-calbuilder-mid" title="How years number inside this era">
            <option value="from-1" ${e.numbering === 'from-1' ? 'selected' : ''}>Years from 1</option>
            <option value="from-0" ${e.numbering === 'from-0' ? 'selected' : ''}>Years from 0</option>
            <option value="continuous" ${e.numbering === 'continuous' ? 'selected' : ''}>Label only</option>
          </select>
          <select data-col="direction" class="atlas-modal-input atlas-calbuilder-mid" title="Down = counts toward its pivot, like BC">
            <option value="up" ${e.direction === 'up' ? 'selected' : ''}>Counts up</option>
            <option value="down" ${e.direction === 'down' ? 'selected' : ''}>Counts down</option>
          </select>
          <label class="atlas-calbuilder-check" title="A closed era still formats old dates but is never offered when entering new ones">
            <input data-col="closed" type="checkbox" ${e.closed ? 'checked' : ''} /> Closed
          </label>
          <button type="button" class="atlas-calbuilder-remove" data-remove="era:${i}" title="Remove era">×</button>
        </div>
      `).join('');
    }
    const monthRows = body.querySelector('[data-rows="months"]');
    if (monthRows) {
      monthRows.innerHTML = this.draft.months.map((m, i) => `
        <div class="atlas-calbuilder-row" data-row="month:${i}">
          <input data-col="name" type="text" class="atlas-modal-input" placeholder="Month name" value="${escapeText(m.name)}" />
          <input data-col="length" type="number" min="1" class="atlas-modal-input atlas-calbuilder-narrow" placeholder="${escapeText(this.grain)}s" value="${escapeText(m.length)}" />
          <button type="button" class="atlas-calbuilder-remove" data-remove="month:${i}" title="Remove month">×</button>
        </div>
      `).join('');
    }
    const interRows = body.querySelector('[data-rows="intercalary"]');
    if (interRows) {
      const monthOptions = (selected: string): string => {
        const opts = [`<option value="0" ${selected === '0' ? 'selected' : ''}>Before month 1</option>`];
        this.draft.months.forEach((m, i) => {
          const v = String(i + 1);
          opts.push(`<option value="${v}" ${selected === v ? 'selected' : ''}>After ${escapeText(m.name.trim() || `month ${v}`)}</option>`);
        });
        return opts.join('');
      };
      interRows.innerHTML = this.draft.intercalary.map((ic, i) => `
        <div class="atlas-calbuilder-row" data-row="intercalary:${i}">
          <input data-col="name" type="text" class="atlas-modal-input" placeholder="Festival name" value="${escapeText(ic.name)}" />
          <select data-col="after" class="atlas-modal-input atlas-calbuilder-mid">${monthOptions(ic.after)}</select>
          <input data-col="every" type="number" min="1" class="atlas-modal-input atlas-calbuilder-narrow" placeholder="Every N yrs"
                 title="Leave empty for every year; 4 = a leap day every 4th year" value="${escapeText(ic.everyYears)}" />
          <label class="atlas-calbuilder-check" title="Counted in the week? Days outside the week keep every date on the same weekday forever">
            <input data-col="inweek" type="checkbox" ${ic.inWeek ? 'checked' : ''} /> In week
          </label>
          <button type="button" class="atlas-calbuilder-remove" data-remove="intercalary:${i}" title="Remove day">×</button>
        </div>
      `).join('');
    }
  }

  private renderPreview(body: HTMLElement): void {
    const panel = body.querySelector('[data-role="preview"]');
    if (!panel) return;
    const { config, errors } = this.buildConfig();
    const structural = errors.filter(e => e !== 'The calendar needs a name');
    if (structural.length > 0) {
      panel.innerHTML = `<div class="atlas-calbuilder-errors">${structural.map(e => `<div>⚠ ${escapeText(e)}</div>`).join('')}</div>`;
      return;
    }
    const samples = this.opts.sampleSteps.length > 0 ? this.opts.sampleSteps : [0];
    panel.innerHTML = `
      <div class="atlas-calbuilder-preview-head">Your dates will read as</div>
      ${samples.map(s => `
        <div class="atlas-calbuilder-preview-row">
          <span class="atlas-calbuilder-preview-step">${s}</span>
          <span class="atlas-calbuilder-preview-date">${escapeText(formatStep(config, s))}</span>
        </div>
      `).join('')}
      ${errors.length > 0 ? `<div class="atlas-calbuilder-errors">${errors.map(e => `<div>⚠ ${escapeText(e)}</div>`).join('')}</div>` : ''}
    `;
  }

  private async save(): Promise<void> {
    const { config, errors } = this.buildConfig();
    if (errors.length > 0) {
      this.toasts.error(errors[0]);
      return;
    }
    const store = getActiveStore();
    if (!store) { this.toasts.error('This world is not open. Open it from the sidebar, then try again.'); return; }
    try {
      let id = this.opts.elementId ?? this.createdId ?? undefined;
      if (id) {
        await store.updateElement(id, { name: this.draft.name.trim(), atlas_calendar: config });
      } else {
        const el = await store.createElement('construct', {
          name: this.draft.name.trim(),
          supertype: CALENDAR_SUPERTYPE,
          atlas_calendar: config,
          // The mint seed's inherited vocabulary becomes lore, not dead config.
          ...(this.opts.seed?.description ? { description: this.opts.seed.description } : {}),
        });
        id = el.id;
        this.createdId = el.id;
      }
      await refreshElementsAfterWrite(store);
      this.hide();
      this.toasts.success(this.opts.elementId ? 'Calendar saved' : `“${this.draft.name.trim()}” is your calendar now`);
      this.opts.onSaved?.(id);
    } catch (err) {
      // The builder stays open, so Save again is the retry (a create retried
      // from a toast could make a second calendar).
      console.error('[calendar] save failed:', err);
      showProblem(err, { doing: 'saving the calendar', toasts: this.toasts });
    }
  }
}
