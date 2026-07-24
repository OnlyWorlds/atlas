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

export class BaseModal {
    protected modal: HTMLElement | null = null;

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

        if (opts.title !== undefined) {
            const title = document.createElement('div');
            title.className = 'atlas-modal-title';
            title.textContent = opts.title;
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
            document.body.appendChild(this.modal);
            // Force reflow for CSS transition.
            this.modal.offsetHeight;
            this.modal.classList.add('visible');
            this.attachBaseEventListeners();
        }
    }

    /** Hide and detach the modal. Idempotent. */
    protected hide(): void {
        if (this.modal) {
            this.modal.classList.remove('visible');
            if (this.modal.parentNode) {
                this.modal.parentNode.removeChild(this.modal);
            }
            this.modal = null;
        }
    }

    /** Base behaviors: click outside to close, ESC to close. */
    private attachBaseEventListeners(): void {
        // Close only on a FULL outside click: both the press AND the release
        // must land on the overlay itself (Captain, S318). A `click` listener
        // alone closes on drag-out — mousedown in an input, drag past the
        // panel edge, release: the click event fires on the common ancestor
        // (the overlay) and eats the user's half-typed modal. Pointer events
        // target the element actually under the cursor at each end, so the
        // pair check kills that class without touching Escape or Cancel.
        let pressedOnOverlay = false;
        this.modal?.addEventListener('pointerdown', (e) => {
            pressedOnOverlay = e.target === this.modal;
        });
        this.modal?.addEventListener('pointerup', (e) => {
            if (pressedOnOverlay && e.target === this.modal) this.hide();
            pressedOnOverlay = false;
        });

        const escapeHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.hide();
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);
    }
}
