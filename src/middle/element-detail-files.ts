/**
 * The Files card on an element page (keel #393; Seethe's mock 04,
 * 2026-10-19): the files
 * OnlyWorlds holds on this element, each with its label, kind, size, who
 * added it (AGENT when an agent did) and when, and Download and Remove; the
 * world's total against its room in the header; Add file at the foot.
 *
 * Shown in an online world only: files live on OnlyWorlds, not in the folder.
 * A view-only world lists and downloads; Remove shows only where keel would
 * take it (the owner's key, or whoever added the file). The card paints
 * itself in place from `sync/element-files.ts` whenever that module's state
 * moves, so a page rebuild never loses an upload in flight (conv. 146).
 */
import type { OwFileRow } from '@onlyworlds/sdk';
import { getState } from '../core/state';
import type { Element, WorldRegistryEntry } from '../core/types';
import { knownFieldsFor } from '../editor/field-schema';
import {
  addFile, fileLink, filesNow, formatBytes, formatQuota, mayRemove, onFilesChanged, refreshFiles, removeFile,
  FILES_ACCEPT, FILES_KINDS_LINE, FILES_NOT_SYNCED_LINE,
} from '../sync/element-files';
import type { ToastManager } from '../ui/toast-manager';
import { showProblem } from '../ui/problem-fixes';
import { humanizeFieldName } from './element-detail-fields';

const MAX_LABEL = 80;

/** The open world's entry when its elements can carry files, else null. */
export function filesWorld(): WorldRegistryEntry | null {
  const id = getState().active?.worldId;
  const entry = id ? getState().registry.worlds.find(w => w.id === id) : undefined;
  return entry?.state === 'api-linked' && entry.api?.api_key ? entry : null;
}

/** A file picked and waiting for its label, kept across page rebuilds. */
let pendingPick: { worldId: string; elementId: string; file: File } | null = null;

/** A date as the mock prints it: 2026-10-19, in local time. */
function dayOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The label suggestions: the element type's own fields, as the page names them. */
function labelSuggestions(el: Element): string[] {
  return [...knownFieldsFor(el.type)].filter(n => n !== 'name').map(humanizeFieldName).sort((a, b) => a.localeCompare(b));
}

export function buildFilesSection(el: Element, entry: WorldRegistryEntry, toasts: ToastManager): HTMLElement {
  const readOnly = !!entry.api?.read_only;
  const section = document.createElement('div');
  section.className = 'atlas-detail-section atlas-files-section';
  section.dataset.section = 'Files';

  const header = document.createElement('div');
  header.className = 'atlas-detail-section-header no-toggle';
  const title = document.createElement('span');
  title.textContent = 'Files';
  title.title = 'Kept on OnlyWorlds with this element, never in your copy of the world or its world file.';
  const meta = document.createElement('span');
  meta.className = 'atlas-files-meta';
  header.append(title, meta);
  section.appendChild(header);

  const body = document.createElement('div');
  body.className = 'atlas-detail-section-body atlas-files-body';
  section.appendChild(body);

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = FILES_ACCEPT;
  input.hidden = true;
  // Only where a file can be added: a view-only card carries no upload input.
  if (!readOnly) section.appendChild(input);
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    pendingPick = { worldId: entry.id, elementId: el.id, file };
    paint();
  });

  const onServer = !!el.server_updated_at;
  let formFor: { file: File; node: HTMLElement } | null = null;

  function paint(): void {
    const view = filesNow(entry, el.type, el.id);
    // A file still being added shows as its upload until the add ends (the new total read beside it).
    const rows = (view.rows ?? []).filter(r => !view.uploads.some(u => u.fileId === r.id));

    const parts: string[] = [];
    if (view.rows) parts.push(String(rows.length));
    if (view.used !== null && view.cap !== null) parts.push(`this world ${formatQuota(view.used, view.cap)}`);
    meta.textContent = parts.join(' · ');

    const focused = formFor && formFor.node.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    body.replaceChildren();
    if (!onServer || view.missing) {
      body.appendChild(note(FILES_NOT_SYNCED_LINE));
      return;
    }
    if (view.loading) body.appendChild(note('Reading the files…'));
    else if (view.failed && !view.rows) {
      const line = note('The files could not be read just now. ');
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'atlas-btn-ghost';
      again.textContent = 'Try again';
      again.addEventListener('click', () => { void refreshFiles(entry, el.type, el.id); });
      line.appendChild(again);
      body.appendChild(line);
    } else if (view.rows && rows.length === 0 && view.uploads.length === 0) {
      body.appendChild(note(readOnly ? 'No files on this element.' : 'No files on this element yet.'));
    }

    for (const row of rows) body.appendChild(fileRow(row, mayRemove(row, view.me, readOnly), view.removing.has(row.id)));
    for (const up of view.uploads) body.appendChild(uploadRow(up.name, up.loaded, up.total));

    if (readOnly) return;
    const pick = pendingPick && pendingPick.worldId === entry.id && pendingPick.elementId === el.id ? pendingPick : null;
    // The label form survives a repaint (a list read or another upload's
    // progress) with what was typed in it.
    if (pick && formFor?.file !== pick.file) formFor = { file: pick.file, node: labelForm(pick.file) };
    if (!pick) formFor = null;
    body.appendChild(formFor ? formFor.node : addRow());
    if (focused && focused.isConnected) focused.focus();
  }

  function note(text: string): HTMLElement {
    const p = document.createElement('div');
    p.className = 'atlas-files-note';
    p.textContent = text;
    return p;
  }

  function fileRow(row: OwFileRow, removable: boolean, removing: boolean): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'atlas-field atlas-file-row';
    wrap.dataset.fileId = row.id;

    const label = document.createElement('div');
    label.className = 'atlas-field-label';
    label.textContent = row.label?.trim() || '—';
    if (!row.label?.trim()) label.classList.add('atlas-file-unlabelled');
    if (row.label) label.title = row.label;
    wrap.appendChild(label);

    const main = document.createElement('div');
    main.className = 'atlas-file-main';
    const name = document.createElement('div');
    name.className = 'atlas-file-name';
    name.textContent = row.name;
    main.appendChild(name);
    const line = document.createElement('div');
    line.className = 'atlas-file-line';
    const bits = [row.kind, formatBytes(row.size), `added by ${row.added_by?.name || 'someone'}`, dayOf(row.added_at)].filter(Boolean);
    // Each part whole on a narrow screen: the line breaks between parts, never inside a date.
    bits.forEach((bit, i) => {
      if (i > 0) line.append(' · ');
      const part = document.createElement('span');
      part.className = 'atlas-file-bit';
      part.textContent = bit;
      line.appendChild(part);
    });
    if (row.added_by?.agent) {
      const chip = document.createElement('span');
      chip.className = 'atlas-file-agent';
      chip.textContent = 'Agent';
      chip.title = 'An agent added this file.';
      line.appendChild(chip);
    }
    main.appendChild(line);
    wrap.appendChild(main);

    const acts = document.createElement('div');
    acts.className = 'atlas-file-acts';
    const dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'atlas-file-download';
    dl.dataset.action = 'download-file';
    dl.textContent = 'Download';
    dl.addEventListener('click', () => { void download(row, dl); });
    acts.appendChild(dl);
    if (removable) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'atlas-file-remove';
      rm.dataset.action = 'remove-file';
      rm.textContent = removing ? 'Removing…' : 'Remove';
      rm.disabled = removing;
      rm.addEventListener('click', () => { void remove(row); });
      acts.appendChild(rm);
    }
    wrap.appendChild(acts);
    return wrap;
  }

  function uploadRow(fileName: string, loaded: number, total: number): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'atlas-field atlas-file-row atlas-file-uploading';
    const label = document.createElement('div');
    label.className = 'atlas-field-label';
    label.textContent = 'Adding';
    const main = document.createElement('div');
    main.className = 'atlas-file-main';
    const name = document.createElement('div');
    name.className = 'atlas-file-name';
    name.textContent = fileName;
    const bar = document.createElement('progress');
    bar.className = 'atlas-file-progress';
    bar.max = Math.max(1, total);
    bar.value = Math.min(loaded, total);
    const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
    bar.setAttribute('aria-label', `Adding ${fileName}: ${pct}%`);
    const line = document.createElement('div');
    line.className = 'atlas-file-line';
    line.textContent = `${formatBytes(loaded)} of ${formatBytes(total)}`;
    main.append(name, bar, line);
    wrap.append(label, main);
    return wrap;
  }

  function addRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'atlas-files-add-row';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-custom-add-btn';
    btn.dataset.action = 'add-file';
    btn.textContent = '+ Add file';
    btn.addEventListener('click', () => input.click());
    const hint = document.createElement('span');
    hint.className = 'atlas-files-hint';
    hint.textContent = `${FILES_KINDS_LINE} · 25 MB a file`;
    row.append(btn, hint);
    return row;
  }

  function labelForm(file: File): HTMLElement {
    const form = document.createElement('div');
    form.className = 'atlas-files-label-form';
    const what = document.createElement('div');
    what.className = 'atlas-file-name';
    what.textContent = `${file.name} · ${formatBytes(file.size)}`;
    const field = document.createElement('input');
    field.type = 'text';
    field.className = 'atlas-custom-add-input';
    field.placeholder = 'Label (optional): a field it belongs to, or your own words';
    field.maxLength = MAX_LABEL;
    field.setAttribute('aria-label', 'Label for the file');
    const listId = `atlas-file-labels-${el.id}`;
    field.setAttribute('list', listId);
    const datalist = document.createElement('datalist');
    datalist.id = listId;
    for (const s of labelSuggestions(el)) {
      const opt = document.createElement('option');
      opt.value = s;
      datalist.appendChild(opt);
    }
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'atlas-btn-primary atlas-files-upload-btn';
    go.dataset.action = 'upload-file';
    go.textContent = 'Add';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'atlas-btn-ghost';
    cancel.dataset.action = 'cancel-file';
    cancel.textContent = 'Cancel';
    const submit = () => {
      const label = field.value.trim().slice(0, MAX_LABEL) || null;
      pendingPick = null;
      paint();
      void add(file, label);
    };
    go.addEventListener('click', submit);
    cancel.addEventListener('click', () => { pendingPick = null; paint(); });
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); pendingPick = null; paint(); }
    });
    const acts = document.createElement('div');
    acts.className = 'atlas-files-label-acts';
    acts.append(go, cancel);
    form.append(what, field, datalist, acts);
    queueMicrotask(() => { if (field.isConnected) field.focus(); });
    return form;
  }

  async function add(file: File, label: string | null): Promise<void> {
    try {
      await addFile(entry, getState().registry, el.type, el.id, file, label);
      toasts.success(`${file.name} added to ${el.name || 'the element'}.`);
    } catch (err) {
      showProblem(err, { doing: 'adding the file', toasts });
    }
  }

  async function download(row: OwFileRow, btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    try {
      const url = await fileLink(entry, el.type, el.id, row.id);
      // The host sends it as an attachment, so the page stays where it is.
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener noreferrer';
      a.download = row.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      showProblem(err, { doing: 'fetching the file', toasts });
    } finally {
      btn.disabled = false;
    }
  }

  async function remove(row: OwFileRow): Promise<void> {
    if (!window.confirm(`Remove ${row.name} from OnlyWorlds for good?\n\nIt leaves this element and the world at once, for everyone.`)) return;
    try {
      await removeFile(entry, getState().registry, el.type, el.id, row.id);
      toasts.success(`${row.name} removed.`);
    } catch (err) {
      showProblem(err, { doing: 'removing the file', toasts });
    }
  }

  // Repaint in place while on the page; let go once the page is rebuilt.
  let wasConnected = false;
  const stop = onFilesChanged(() => {
    if (!section.isConnected) { if (wasConnected) stop(); return; }
    wasConnected = true;
    paint();
  });
  paint();
  queueMicrotask(() => { wasConnected ||= section.isConnected; });
  if (onServer) void refreshFiles(entry, el.type, el.id);
  return section;
}
