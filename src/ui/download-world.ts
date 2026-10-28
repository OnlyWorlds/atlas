/**
 * "Download the whole world", from a click (1.17, contract §5.1): one
 * path for every door (Settings, This world; the keep-safe card). The save
 * picker opens inside the click, before any work; the toast says honestly
 * what happened (a picked file is saved; a Blob is only handed to the
 * browser's downloads).
 */
import type { ToastManager } from './toast-manager';
import type { WorldRegistryEntry } from '../core/types';
import { downloadName, downloadWorld, pickSaveTarget } from '../setup/world-download';
import { showProblem } from './problem-fixes';
import { PrivateRecordsModal } from './private-records-modal';

export async function downloadWorldFromClick(
  world: WorldRegistryEntry,
  toasts: ToastManager,
  busy: (on: boolean) => void = () => {},
): Promise<boolean | null> {
  let target: Awaited<ReturnType<typeof pickSaveTarget>>;
  try {
    target = await pickSaveTarget(downloadName(world));
  } catch (err) {
    showProblem(err, { doing: 'choosing where to save the world', folder: 'picked', toasts });
    return false;
  }
  if (!target) return null; // the user closed the save picker: nothing was tried
  busy(true);
  try {
    // A world whose records a tool keeps private asks first (folder spec §4.5 rule 11).
    const done = await downloadWorld(world, target, { ask: q => new PrivateRecordsModal().ask(q) });
    if (!done) return null; // the person chose no file
    const { file, leftOut } = done;
    const kept = target.kind === 'picker'
      ? `Saved ${file}. Keep it: it brings this world back.`
      : `Your browser is saving ${file}. Keep the file: it brings this world back.`;
    toasts.success(leftOut.length ? `${kept} Private records were left out.` : kept);
    return true;
  } catch (err) {
    console.warn('[download-world] failed:', err);
    showProblem(err, { doing: 'downloading this world', toasts });
    return false;
  } finally {
    busy(false);
  }
}
