/**
 * Import room — bring external content into a world.
 *
 * v1: explanation + pointer to base-tool. Mechanics lift from base-tool's
 * existing import flow in a future session.
 */

export function mountImportRoom(target: HTMLElement): () => void {
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-import-room';
  target.appendChild(root);

  const header = document.createElement('header');
  header.className = 'atlas-room-header';
  header.innerHTML = `
    <h1>Import</h1>
    <p class="atlas-room-subtitle">Bring external content into this world.</p>
  `;
  root.appendChild(header);

  const body = document.createElement('div');
  body.className = 'atlas-import-body';
  body.innerHTML = `
    <p>
      Atlas import isn't wired up yet. The OnlyWorlds <strong>base-tool</strong>
      (<a href="https://onlyworlds.github.io/base-tool" target="_blank">onlyworlds.github.io/base-tool</a>)
      has a working import flow for parsed/formatted content. Use it to load data
      into your world; atlas will pick the changes up via the next sync.
    </p>
    <p class="atlas-room-hint">
      A direct import flow will land in atlas in a future session, lifting from base-tool's
      proven mechanics.
    </p>
  `;
  root.appendChild(body);

  return () => {
    /* no subscribers */
  };
}
