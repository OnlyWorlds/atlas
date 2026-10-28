/**
 * Base Modal Class — consistent lifecycle + standard chrome scaffolding.
 *
 * Usage:
 *   class MyModal extends BaseModal {
 *     constructor() { super(); }
 *     open() {
 *       const { overlay, body } = this.buildModalShell({
 *         title: 'my modal',
 *         dataModal: 'my-modal',
 *       });
 *       body.innerHTML = `<form>...</form>`;
 *       // wire body.querySelector(...) handlers
 *       this.modal = overlay;
 *       this.show();
 *     }
 *   }
 *
 * The base class owns:
 *   - lifecycle (show / hide)
 *   - overlay + panel + title structure (via `buildModalShell`)
 *   - close-on-overlay-click + close-on-Escape
 *
 * Subclasses provide ONLY the body content. This keeps modal styling
 * uniform across the app — future modals (link-world, make-online) inherit
 * the same chrome without reimplementing it.
 *
 * Markup produced by `buildModalShell`:
 *
 *   <div class="atlas-modal-overlay">                              ← `overlay`
 *     <div class="atlas-modal-panel [extraPanelClass]"             ← `panel`
 *          [data-modal="<dataModal>"]>
 *       <div class="atlas-modal-title">{title}</div>
 *       <div class="atlas-modal-body"> … subclass fills this … </div>  ← `body`
 *     </div>
 *   </div>
 */
export interface ModalShellOpts {
    /**
     * The title shown at the top of the panel. Lowercase by atlas convention.
     * If omitted, no title element is rendered — the subclass is responsible
     * for its own title affordance (used by the picker modal which puts the
     * title in a custom row alongside a count badge).
     */
    title?: string;
    /** Extra class on the panel (e.g. 'atlas-picker-panel' for wider layouts). */
    panelClass?: string;
    /** data-modal attribute for test selectors. */
    dataModal?: string;
}

/** Open BaseModals, oldest first: Escape belongs to the last one only. */
const openModals: BaseModal[] = [];
let modalTitleSeq = 0;

/** Whether any dialog is up: a BaseModal, or another dialog drawn on the shared overlay. */
export function anyModalOpen(): boolean {
  return openModals.length > 0 || !!document.querySelector('.atlas-modal-overlay');
}

/**
 * What sits behind the topmost open modal is `inert` (found by
 * Seethe): `aria-modal` tells a screen reader, but Tab walked out of the
 * panel into the page behind, where Enter on "Start a world" opened a second
 * dialog over the first. Every child of `<body>` but the topmost modal's
 * overlay is made inert while any modal is open (a modal below a picker
 * included), and only what this marked is released, so an `inert` set by
 * anything else stays. Called after every open and close.
 */
const MARK = 'atlasModalInert';
function syncInertBehindModals(): void {
    const top = [...openModals].reverse().find(m => m.overlay()?.isConnected)?.overlay() ?? null;
    for (const child of Array.from(document.body.children)) {
        if (!(child instanceof HTMLElement)) continue;
        const ours = child.dataset[MARK] === '1';
        if (top && child !== top) {
            if (!child.inert) { child.inert = true; child.dataset[MARK] = '1'; }
        } else if (ours) {
            child.inert = false;
            delete child.dataset[MARK];
        }
    }
}

export class BaseModal {
    /** The overlay this modal mounted, while it is mounted. */
    overlay(): HTMLElement | null {
        return this.modal;
    }

    protected modal: HTMLElement | null = null;

    /**
     * While true, an outside click and Escape do NOT close the modal (from
     * Titus: a link that downloads for minutes closed on a stray click and
     * looked cancelled). Set it for the duration of long work; the modal's own
     * buttons are then the only way out, and they say what they do.
     */
    protected dismissLocked = false;

    private escapeHandler: ((e: KeyboardEvent) => void) | null = null;
    private returnFocusTo: HTMLElement | null = null;

    /** True when this is the most recently opened modal still on screen. */
    protected isTopmost(): boolean {
        return openModals[openModals.length - 1] === this;
    }

    /**
     * Build the standard modal chrome. Returns the overlay (root, append to
     * document.body) plus the body element ready for subclass content.
     *
     * Subclasses should assign the returned `overlay` to `this.modal` before
     * calling `show()`.
     */
    protected buildModalShell(opts: ModalShellOpts): {
        overlay: HTMLElement;
        panel: HTMLElement;
        body: HTMLElement;
    } {
        const overlay = document.createElement('div');
        overlay.className = 'atlas-modal-overlay';

        const panel = document.createElement('div');
        panel.className =
            'atlas-modal-panel' + (opts.panelClass ? ` ${opts.panelClass}` : '');
        if (opts.dataModal) panel.setAttribute('data-modal', opts.dataModal);
        // A real dialog to assistive tech: role, modality,
        // and its title as the accessible name when it has one.
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');

        if (opts.title !== undefined) {
            const title = document.createElement('div');
            title.className = 'atlas-modal-title';
            title.textContent = opts.title;
            title.id = `atlas-modal-title-${++modalTitleSeq}`;
            panel.setAttribute('aria-labelledby', title.id);
            panel.appendChild(title);
        }

        const body = document.createElement('div');
        body.className = 'atlas-modal-body';
        panel.appendChild(body);

        overlay.appendChild(panel);
        return { overlay, panel, body };
    }

    /**
     * Show the modal. Subclasses must have assigned `this.modal` to a built
     * overlay first (typically via `buildModalShell`).
     */
    protected show(): void {
        if (this.modal) {
            // Focus goes back where it was when the modal closes.
            const active = document.activeElement;
            this.returnFocusTo = active instanceof HTMLElement && active !== document.body ? active : null;
            document.body.appendChild(this.modal);
            // Force reflow for CSS transition.
            this.modal.offsetHeight;
            this.modal.classList.add('visible');
            if (!openModals.includes(this)) openModals.push(this);
            syncInertBehindModals();
            this.attachBaseEventListeners();
        }
    }

    /** Hide and detach the modal. Idempotent. */
    protected hide(): void {
        // The Escape listener goes with the modal, however it closed (it
        // used to be removed only when Escape itself closed the modal, so every
        // button-closed modal left one behind on document).
        if (this.escapeHandler) {
            document.removeEventListener('keydown', this.escapeHandler);
            this.escapeHandler = null;
        }
        this.dismissLocked = false;
        const at = openModals.indexOf(this);
        if (at >= 0) openModals.splice(at, 1);
        // The last one closed: what waited for the page to be free may speak (the guide's notes).
        if (at >= 0 && openModals.length === 0) queueMicrotask(() => document.dispatchEvent(new CustomEvent('atlas:modal-closed')));
        if (this.modal) {
            const hadFocus = this.modal.contains(document.activeElement);
            this.modal.classList.remove('visible');
            if (this.modal.parentNode) {
                this.modal.parentNode.removeChild(this.modal);
            }
            this.modal = null;
            // The page behind (or the modal below) takes keys again before focus goes back to it.
            syncInertBehindModals();
            // Only when focus was inside the modal: never steal it from
            // something the user moved to meanwhile.
            const back = this.returnFocusTo;
            this.returnFocusTo = null;
            if (hadFocus && back && back.isConnected) back.focus({ preventScroll: true });
        }
    }

    /** Base behaviors: click outside to close, ESC to close. */
    private attachBaseEventListeners(): void {
        // Close only on a FULL outside click: both the press AND the release
        // must land on the overlay itself (Titus). A `click` listener
        // alone closes on drag-out — mousedown in an input, drag past the
        // panel edge, release: the click event fires on the common ancestor
        // (the overlay) and eats the user's half-typed modal. Pointer events
        // target the element actually under the cursor at each end, so the
        // pair check kills that class without touching Escape or Cancel.
        let pressedOnOverlay = false;
        this.modal?.addEventListener('pointerdown', (e) => {
            pressedOnOverlay = e.target === this.modal;
        });
        // The second press of a double-click is not a click outside: it is the
        // rest of the double-click on the button that opened this modal
        // ("add a world" used to open and close at once).
        // `mousedown` carries the click count; it fires after `pointerdown`.
        this.modal?.addEventListener('mousedown', (e) => {
            if (e.detail > 1) pressedOnOverlay = false;
        });
        this.modal?.addEventListener('pointerup', (e) => {
            if (pressedOnOverlay && e.target === this.modal && !this.dismissLocked) this.hide();
            pressedOnOverlay = false;
        });

        if (this.escapeHandler) document.removeEventListener('keydown', this.escapeHandler);
        this.escapeHandler = (e: KeyboardEvent) => {
            // Only the TOPMOST modal answers (a picker opened over the
            // map-create modal closed both, losing the half-filled form).
            if (e.key !== 'Escape' || this.dismissLocked) return;
            if (openModals[openModals.length - 1] !== this) return;
            this.hide();
        };
        document.addEventListener('keydown', this.escapeHandler);
    }
}
