/**
 * JoinWorldModal: the `#/join/` door's confirm screen (OW Infra #104, S385;
 * contract R5, R8; logic in `setup/join-door.ts`).
 *
 * Names the world, its owner (as their chosen Character) or the inviter
 * (quoted, never presented as checked), the role in plain words, a Character
 * the join would add, and a same-name world already here. Nothing is spent
 * until Open: the preview was the only call before it. After Open, the seat
 * is held in memory for this dialog, so a failed download can be retried
 * without a second code.
 */

import { BaseModal } from './modal-base';
import type { ToastManager } from './toast-manager';
import { downloadingLine } from './download-progress';
import { lockWhereChoice, readyWhere, takeWhereInClick, whereChoiceHtml, wireWhereChoice } from './where-choice';
import { showProblem } from './problem-fixes';
import { getState } from '../core/state';
import { navigate, homeHash } from '../core/router';
import { enqueueActivationTask } from '../core/activation-chain';
import { completeWaypoint } from '../core/waypoints';
import { problemFor } from '../core/problems';
import { takePendingJoin } from '../core/join-capture';
import { diskApiBlock } from '../core/seat';
import { getActiveStore } from '../core/active-store';
import { attachSyncEngine } from '../sync/sync-attach';
import { isTourFlagActive } from '../tour/tour-flag';
import { DownloadCancelledError, type DownloadStop, type InitialDownloadProgress } from '../sync/initial-download';
import {
  ALL_TAKEN_LINE, alreadyHereLine, isPickRefused, isRefusedCode, isWorldFull, JOIN_MALFORMED_LINE, JOIN_REFUSED_LINE,
  NAME_NEEDED_LINE, openJoinedWorld, openPlayerWorld, pickRefusedLine, playerAlreadyHereLine, previewJoin, redeemJoin,
  redeemPlayerJoin, redeemRefusedSentence, roleLine, SPARE_PLAYER_LINE, SPARE_SEAT_LINE, TABLE_GONE_LINE, tablePicks,
  tableTimesLine, WORLD_FULL_LINE, type JoinedPlayer, type JoinedSeat, type JoinPreview, type OpenJoinedOutcome,
} from '../setup/join-door';
// view-only-ok: writes a new world of its own, never the active one (conv. 149).

/** Run the door for a code `join-capture` took, once. */
export async function runPendingJoin(toasts: ToastManager): Promise<void> {
  const code = takePendingJoin();
  if (code === null) return;
  if (code === '') { toasts.error(JOIN_MALFORMED_LINE); return; }
  if (isTourFlagActive()) {
    toasts.info('Finish the tour first, then open the link again.');
    return;
  }
  let preview: JoinPreview;
  try {
    preview = await previewJoin(code);
  } catch (err) {
    if (isRefusedCode(err)) toasts.error(JOIN_REFUSED_LINE, 12_000);
    else showProblem(err, { doing: 'reading the link to the world', toasts });
    return;
  }
  if (preview.reader === 'unknown') {
    toasts.error('This invitation is of a kind this version of Atlas does not know. Reload Atlas and open the link again, or ask for a new link.', 12_000);
    return;
  }
  // A person's code joins with their account, never as a seat (keel #212, #294).
  if (preview.reader === 'person') {
    const { PersonJoinModal } = await import('./person-join-modal');
    new PersonJoinModal(toasts, code, preview).open();
    return;
  }
  // An agent's code joins as a seat; a player's (keel #353) opens to read as
  // the Character the link gives, with no account. One dialog, two redeems.
  new JoinWorldModal(toasts, code, preview).open();
}

export class JoinWorldModal extends BaseModal {
  private seat: JoinedSeat | null = null;
  private player: JoinedPlayer | null = null;
  /** The world opened, or the cancel already said what was left behind. */
  private settled = false;
  private readonly asPlayer: boolean;

  /** However it closes: a seat made and never used is said once (R6 waits on keel Q5). */
  protected hide(): void {
    super.hide();
    if ((this.seat || this.player) && !this.settled) {
      this.settled = true;
      this.toasts.info(this.spareLine(), 12_000);
    }
  }

  constructor(private toasts: ToastManager, private code: string, private preview: JoinPreview) {
    super();
    this.asPlayer = preview.reader === 'player';
  }

  private spareLine(): string {
    return this.asPlayer ? SPARE_PLAYER_LINE : SPARE_SEAT_LINE;
  }

  open(): void {
    this.modal = this.buildModal();
    this.show();
    queueMicrotask(() => this.modal?.querySelector<HTMLButtonElement>('[data-action="open"]')?.focus());
  }

  private buildModal(): HTMLElement {
    const p = this.preview;
    const player = this.asPlayer;
    // A party link (keel #422 PR 2, Seethe's frame 5): each player picks who
    // they are from the owner's list, or, on a table with no list, names a
    // fresh Character. A refused pick looks again and spends nothing.
    const table = player ? p.table : undefined;
    const askName = !!table?.nameRequired;
    const { overlay, body } = this.buildModalShell({ title: 'Open a world from OnlyWorlds', dataModal: 'join-world' });
    body.innerHTML = `
      <form data-form="join-world" data-reader="${player ? 'player' : 'agent'}"${table ? ' data-table="true"' : ''}>
        <p class="atlas-join-question">Open <strong data-role="world-name"></strong> ${player ? 'as a player' : 'from onlyworlds.com'}?</p>
        <p class="atlas-modal-hint" data-role="who" hidden></p>
        <p class="atlas-modal-hint" data-role="role"></p>
        <p class="atlas-modal-hint" data-role="times" hidden></p>
        <p class="atlas-modal-hint" data-role="character" hidden>Joining also adds a Character for Atlas to this world.</p>
        <p class="atlas-modal-hint" data-role="same-name" hidden></p>
        ${table && !askName ? `<div class="atlas-modal-error" data-role="pick-refused" hidden></div>
        <fieldset class="atlas-pick-choice" data-role="picks">
          <legend>Who are you at this table?</legend>
        </fieldset>
        <p class="atlas-modal-hint" data-role="picks-note">Only these names: the game master chose them.</p>
        <p class="atlas-modal-hint" data-role="all-taken" hidden>${ALL_TAKEN_LINE}</p>` : ''}
        ${player ? `<label class="atlas-modal-field" data-role="name-field">
          <span>${askName ? 'Your name: your Character takes it, and the game master sees it' : 'Your name, as the game master sees it'}</span>
          <input class="atlas-input" type="text" name="player-name" maxlength="80" autocomplete="nickname" placeholder="${askName ? 'Your name' : 'Optional'}" />
        </label>` : ''}
        ${whereChoiceHtml()}
        <p class="atlas-modal-hint" data-role="downloads">${player
          ? 'Atlas downloads what your Character knows. The world\'s owner can remove your seat on onlyworlds.com.'
          : 'Atlas downloads every element and keeps its own seat in this world. The owner can remove that seat on onlyworlds.com.'}</p>
        <div class="atlas-modal-error" data-role="error" hidden></div>
        <div class="atlas-modal-progress" data-role="progress" hidden></div>
        <div class="atlas-modal-actions" data-role="form-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="submit" class="atlas-btn-primary" data-action="open">Open</button>
        </div>
        <div class="atlas-modal-actions" data-role="busy-actions" hidden>
          <button type="button" class="atlas-btn-ghost" data-action="cancel-download" title="Stop now and remove what was downloaded; nothing is kept">Cancel download</button>
          <button type="button" class="atlas-btn-primary" data-action="finish-early" title="Stop now and open the world with what has downloaded; Refresh from OnlyWorlds brings the rest">Stop and keep what's here</button>
        </div>
      </form>
    `;
    // World data is untrusted (conv. 93): every name goes in as text.
    body.querySelector<HTMLElement>('[data-role="world-name"]')!.textContent = p.world.name;
    const who = body.querySelector<HTMLElement>('[data-role="who"]')!;
    if (p.ownerCharacter) {
      who.textContent = `Owned by ${p.ownerCharacter}.`;
      who.hidden = false;
    } else if (p.invitedBy) {
      // Free text the inviter typed (R8): quoted, never vouched for.
      who.textContent = `The invitation says it is from "${p.invitedBy}".`;
      who.hidden = false;
    }
    body.querySelector<HTMLElement>('[data-role="role"]')!.textContent = !player ? roleLine(p.role)
      : askName ? 'You get a Character of your own and read the world as it, with no account: only what it knows, and Atlas opens it to read.'
      : table ? 'You read the world as the Character you pick, with no account: only what they know, and Atlas opens it to read.'
      : 'You read the world as your Character, with no account: only what your Character knows, and Atlas opens it to read.';
    // A player's Character is the link's whole point, said in the role line.
    body.querySelector<HTMLElement>('[data-role="character"]')!.hidden = player || !p.withCharacter;
    const nameInput = body.querySelector<HTMLInputElement>('input[name="player-name"]');
    const sameName = sameNameHere(p.world.name);
    if (sameName) {
      const el = body.querySelector<HTMLElement>('[data-role="same-name"]')!;
      el.textContent = `You already have a world called ${sameName} here. This one may be a different world with the same name.`;
      el.hidden = false;
    }

    const form = body.querySelector<HTMLFormElement>('form')!;
    const errorBox = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const progressBox = body.querySelector<HTMLElement>('[data-role="progress"]')!;
    const formActions = body.querySelector<HTMLElement>('[data-role="form-actions"]')!;
    const busyActions = body.querySelector<HTMLElement>('[data-role="busy-actions"]')!;
    const cancelBtn = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    const openBtn = body.querySelector<HTMLButtonElement>('[data-action="open"]')!;
    const cancelDl = body.querySelector<HTMLButtonElement>('[data-action="cancel-download"]')!;
    const finishBtn = body.querySelector<HTMLButtonElement>('[data-action="finish-early"]')!;
    wireWhereChoice(form);

    const picksBox = body.querySelector<HTMLFieldSetElement>('[data-role="picks"]');
    let picked: string | null = null;
    // Drawn from the preview on screen, and again from a fresh one after a refused pick.
    const renderTable = (said = ''): void => {
      const t = this.preview.table;
      if (!t) return;
      const times = body.querySelector<HTMLElement>('[data-role="times"]')!;
      times.textContent = tableTimesLine(t, this.preview.expiresAt);
      times.hidden = false;
      if (!picksBox) return;
      const refused = body.querySelector<HTMLElement>('[data-role="pick-refused"]')!;
      refused.textContent = said;
      refused.hidden = !said;
      picked = null;
      picksBox.querySelectorAll('label').forEach(l => l.remove());
      const picks = tablePicks(t);
      for (const c of picks) {
        // Character names are world data (conv. 93): text, never markup.
        const row = document.createElement('label');
        row.className = 'atlas-pick-row';
        row.dataset.pick = c.id;
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'table-pick';
        input.value = c.id;
        input.disabled = c.taken;
        input.addEventListener('change', () => {
          if (!input.checked) return;
          picked = c.id;
          openBtn.disabled = false;
          openBtn.textContent = `Open as ${c.name}`;
        });
        const name = document.createElement('strong');
        name.textContent = c.name;
        row.append(input, name);
        if (c.taken) {
          const tag = document.createElement('span');
          tag.textContent = 'taken';
          row.append(tag);
        }
        picksBox.append(row);
      }
      const anyFree = picks.some(c => !c.taken);
      picksBox.hidden = !anyFree;
      body.querySelector<HTMLElement>('[data-role="picks-note"]')!.hidden = !anyFree;
      body.querySelector<HTMLElement>('[data-role="all-taken"]')!.hidden = anyFree;
      body.querySelector<HTMLElement>('[data-role="name-field"]')!.hidden = !anyFree;
      openBtn.hidden = !anyFree;
      openBtn.disabled = true;
      openBtn.textContent = 'Pick who you are';
      if (!anyFree) {
        // Nothing can open: where it would live, and what it would download, say nothing now.
        // Removed, not hidden: the Firefox note is shown later by `wireWhereChoice`'s own check.
        body.querySelectorAll<HTMLElement>('[data-role="where"], [data-role="where-browser"], [data-role="persist-note"], [data-role="downloads"]')
          .forEach(el => el.remove());
        cancelBtn.textContent = 'Close';
      }
    };
    renderTable();
    const closeOnly = (sentence: string) => {
      say(sentence);
      openBtn.hidden = true;
      cancelBtn.textContent = 'Close';
    };

    let stop: DownloadStop = null;
    cancelDl.addEventListener('click', () => { stop = 'cancel'; cancelDl.disabled = finishBtn.disabled = true; progressBox.textContent = 'Cancelling…'; });
    finishBtn.addEventListener('click', () => { stop = 'finish'; cancelDl.disabled = finishBtn.disabled = true; progressBox.textContent = 'Stopping; keeping what has downloaded…'; });
    cancelBtn.addEventListener('click', (e) => { e.preventDefault(); this.hide(); });

    const say = (sentence: string) => { errorBox.textContent = sentence; errorBox.hidden = !sentence; };
    const busy = (on: boolean) => {
      this.dismissLocked = on;
      formActions.hidden = on;
      busyActions.hidden = !on;
      lockWhereChoice(form, on);
      if (nameInput) nameInput.disabled = on || !!this.player;
      if (picksBox) picksBox.disabled = on || !!this.player;
      if (on) { stop = null; cancelDl.disabled = finishBtn.disabled = false; }
    };

    // One submit at a time: a second Open while the first awaits the folder
    // pick would redeem the code twice (S386 gate).
    let submitting = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submitting) return;
      submitting = true;
      try { await submit(); } finally { submitting = false; }
    });

    const submit = async (): Promise<void> => {
      say('');
      progressBox.hidden = true;
      if (table && !this.player) {
        if (askName && !nameInput?.value.trim()) { say(NAME_NEEDED_LINE); nameInput?.focus(); return; }
        if (!askName && !picked) { say('Pick who you are at this table.'); return; }
      }
      // Taken synchronously, inside the click, before the first await.
      const where = takeWhereInClick(form);
      const ready = await readyWhere(where, this.toasts, 'Opening a world downloads it into a new folder.');
      if (ready !== true) { say(ready || ''); return; }

      busy(true);
      if (!this.seat && !this.player) {
        progressBox.textContent = 'Joining the world…';
        progressBox.hidden = false;
        try {
          if (player) this.player = await redeemPlayerJoin(this.code, nameInput?.value ?? '', table && !askName ? picked ?? undefined : undefined);
          else this.seat = await redeemJoin(this.code);
        } catch (err) {
          busy(false);
          progressBox.hidden = true;
          if (table && isPickRefused(err)) {
            // Taken a moment ago, or off the list now: look again, so the list on screen is keel's.
            const said = pickRefusedLine(err);
            try {
              this.preview = await previewJoin(this.code);
            } catch (again) {
              if (isRefusedCode(again)) closeOnly(TABLE_GONE_LINE);
              else say(problemFor(again, { inline: true, doing: 'reading the link to the world' }).sentence);
              return;
            }
            if (!this.preview.table) { closeOnly(TABLE_GONE_LINE); return; }
            renderTable(said);
          } else if (isWorldFull(err)) {
            closeOnly(WORLD_FULL_LINE);
          } else if (isRefusedCode(err)) {
            // The code is spent or gone: nothing here can open it any more.
            closeOnly(table ? TABLE_GONE_LINE : redeemRefusedSentence(this.preview));
          } else {
            say(problemFor(err, { inline: true, doing: 'joining the world' }).sentence);
          }
          return;
        }
      }
      const seat = this.seat;
      const joinedPlayer = this.player;
      const renderProgress = (pr: InitialDownloadProgress) => {
        if (stop) return;
        progressBox.textContent = pr.phase === 'list'
          ? `Discovering ${pr.currentType ?? ''}…`
          : pr.total === 0 ? 'World is empty; finishing up' : downloadingLine(pr.done, pr.total, where);
        progressBox.hidden = false;
      };
      try {
        const outcome: OpenJoinedOutcome = await enqueueActivationTask(() => joinedPlayer
          ? openPlayerWorld({ player: joinedPlayer, where, onProgress: renderProgress, shouldStop: () => stop })
          : openJoinedWorld({ seat: seat!, where, onProgress: renderProgress, shouldStop: () => stop }));
        this.settled = true;
        this.hide();
        if (outcome.kind === 'downloaded') {
          const r = outcome.result;
          // A player's toast names who they read as: the slice is that Character's.
          const opened = joinedPlayer ? `${r.entry.name} as ${joinedPlayer.character.name || 'your Character'}` : r.entry.name;
          if (r.stoppedEarly) this.toasts.info(`Opened ${opened} with ${r.downloaded} of ${r.stoppedEarly.total} elements. Use Refresh from OnlyWorlds to download the rest.`);
          else if (r.failures.length > 0) this.toasts.error(`Opened ${opened}. ${r.failures.length} element${r.failures.length === 1 ? '' : 's'} did not download. Refresh from OnlyWorlds brings ${r.failures.length === 1 ? 'it' : 'them'}.`);
          else this.toasts.success(`Opened ${opened} · ${r.downloaded} element${r.downloaded === 1 ? '' : 's'} downloaded`);
          completeWaypoint('ecosystem');
          navigate(homeHash(r.entry.id));
          return;
        }
        const id = outcome.entry.id;
        const wasActive = getState().active?.worldId === id;
        if (!wasActive) {
          const { activateWorld } = await import('../sidebar/worlds-sidebar');
          // activateWorld says its own problem and returns false (a folder
          // whose permission prompt lost the click's gesture, S386 gate).
          if (!(await activateWorld(id, this.toasts))) {
            this.toasts.info(outcome.kind === 'reconnected'
              ? `${outcome.entry.name} is connected again on the seat this link made. Open it from the sidebar.`
              : `${outcome.entry.name} is already here; open it from the sidebar. ${this.spareLine()}`, 12_000);
            return;
          }
        }
        if (outcome.kind === 'reconnected' && getState().active?.worldId === id) {
          // The folder learns the new key (never the secret), and an open
          // world that could not sync starts now.
          const store = getActiveStore();
          if (store) {
            await store.writeWorldMeta({ api: diskApiBlock(outcome.entry.api!) })
              .catch(err => console.warn('[join-world] could not note the new key in world.json:', err));
            if (wasActive) attachSyncEngine(outcome.entry, store);
          }
        }
        navigate(homeHash(id));
        this.toasts.info(outcome.kind !== 'reconnected' && joinedPlayer ? playerAlreadyHereLine(outcome) : alreadyHereLine(outcome), 12_000);
      } catch (err) {
        busy(false);
        if (err instanceof DownloadCancelledError) {
          this.settled = true;
          this.hide();
          this.toasts.info(`Download cancelled. Nothing was kept. ${this.spareLine()}`, 12_000);
          return;
        }
        console.warn('[join-world] open failed:', err);
        progressBox.hidden = true;
        // The seat is held: Open again retries without spending a new code.
        say(problemFor(err, { inline: true, doing: 'downloading the world', where }).sentence);
        openBtn.textContent = 'Retry';
      }
    };

    return overlay;
  }
}

/** A world here whose name matches, case-insensitively (R8: names are free text). */
function sameNameHere(name: string): string | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  const hit = getState().registry.worlds.find(w =>
    w.demo !== true && (w.name.trim().toLowerCase() === n || w.api?.world_name?.trim().toLowerCase() === n));
  return hit ? hit.name : null;
}
