/**
 * Templates room — atlas-local element creation templates.
 *
 * v1 stub. Real template authoring + apply flow lands in a future session.
 */

export function mountTemplatesRoom(target: HTMLElement): () => void {
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-templates-room';
  target.appendChild(root);

  const header = document.createElement('header');
  header.className = 'atlas-room-header';
  header.innerHTML = `
    <h1>Templates</h1>
    <p class="atlas-room-subtitle">Reusable presets for element creation.</p>
  `;
  root.appendChild(header);

  const body = document.createElement('div');
  body.className = 'atlas-pane-empty';
  body.innerHTML = `
    <p>Templates are atlas-local; they never sync to the OW API.</p>
    <p class="atlas-room-hint">
      Coming soon: create a template by selecting an element and saving its
      field pattern. Apply with one click to scaffold new elements that follow
      the same shape.
    </p>
  `;
  root.appendChild(body);

  return () => {
    /* no subscribers */
  };
}
