/**
 * Material Symbols ligature spans must not be read aloud.
 *
 * ── The bug ───────────────────────────────────────────────────────────────
 *
 * A Material Symbols icon is rendered by putting its NAME in the element's text
 * content and letting the font ligature it into a glyph. Sighted users see an
 * icon; assistive technology reads the text. Read off the live accessibility
 * tree (S308), atlas announced its own controls as:
 *
 *   "add folder"        "add cloud_upload"      "add visibility"
 *   "home home"         "menu_book writing"     "wall_art pages"
 *   "import_export import"                      "psychology knowledge"
 *
 * A blind user heard "add cloud upload" for a button that creates a new API
 * world. Where a parent carried an aria-label the ligature was announced BEFORE
 * it ("settings Settings"); where it carried none, the ligature was the entire
 * accessible name.
 *
 * ── Why this is a boot-time sweep and not 253 edits ───────────────────────
 *
 * There are 253 icon render sites across 40+ files, and the whole codebase
 * contained SIX `aria-hidden` attributes. There is no shared `icon()` helper to
 * fix at the boundary, because the boundary was never built — and building one,
 * then migrating 253 call sites by hand, is not a change to make days before a
 * release.
 *
 * So the boundary is created here instead: one observer that stamps every icon
 * span, present and future. It is idempotent, it costs one attribute per icon,
 * and it covers sites nobody has written yet.
 *
 * POST-LAUNCH: introduce a real `icon(name)` helper, migrate the call sites, and
 * delete this file. This is scaffolding with a known demolition date, not a
 * design — a MutationObserver is the wrong permanent home for a decision every
 * render site should be making for itself.
 *
 * ── Why aria-hidden is correct here ───────────────────────────────────────
 *
 * These spans are PURELY decorative in every case: the control's meaning lives
 * in its aria-label, its title, or its adjacent text label. Hiding the glyph
 * removes noise without removing information. Controls that carry NO other
 * accessible name are a separate, real defect — hiding the ligature makes them
 * silent rather than wrong, which is why `auditUnnamedIconControls` exists
 * below to name them rather than paper over them.
 */

const ICON_SELECTOR = '.material-symbols-outlined, .material-symbols-rounded, .material-symbols-sharp';

function stamp(root: ParentNode): void {
  for (const el of root.querySelectorAll(ICON_SELECTOR)) {
    if (!el.hasAttribute('aria-hidden')) el.setAttribute('aria-hidden', 'true');
  }
}

let observer: MutationObserver | null = null;

/** Idempotent. Safe to call more than once; a second call is a no-op. */
export function installIconA11y(): void {
  if (observer) return;
  stamp(document);
  observer = new MutationObserver(records => {
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node as Element;
        if (el.matches?.(ICON_SELECTOR) && !el.hasAttribute('aria-hidden')) {
          el.setAttribute('aria-hidden', 'true');
        }
        stamp(el);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * DEV diagnostic, not shipped behaviour: list interactive controls whose only
 * accessible name WAS the icon ligature. Each one is a real gap that wants a
 * proper label at its render site — hiding the glyph stops it being misleading
 * but leaves it nameless.
 */
export function auditUnnamedIconControls(): Array<{ ligature: string; html: string }> {
  const out: Array<{ ligature: string; html: string }> = [];
  for (const icon of document.querySelectorAll(ICON_SELECTOR)) {
    const control = icon.closest('button, a[href], [role="button"]');
    if (!control) continue;
    const labelled =
      control.getAttribute('aria-label') ||
      control.getAttribute('title') ||
      (control.textContent ?? '').replace(icon.textContent ?? '', '').trim();
    if (!labelled) {
      out.push({ ligature: (icon.textContent ?? '').trim(), html: control.outerHTML.slice(0, 120) });
    }
  }
  return out;
}
