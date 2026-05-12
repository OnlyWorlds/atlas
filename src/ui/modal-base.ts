/**
 * Base Modal Class - Consistent modal behavior across the app
 *
 * Usage:
 * 1. Extend this class: class MyModal extends BaseModal
 * 2. Call show() to display, hide() to close
 * 3. Override createModalContent() to define your modal HTML
 *
 * Features:
 * - Consistent lifecycle (show/hide)
 * - Click outside to close
 * - ESC key to close
 * - Smooth transitions via CSS
 * - Proper cleanup on hide
 */
export class BaseModal {
    protected modal: HTMLElement | null = null;
    protected modalClass: string;

    constructor(modalClass: string = 'modal') {
        this.modalClass = modalClass;
    }

    /**
     * Create the modal container element
     * Override this to customize modal structure
     */
    protected createModalContainer(): HTMLElement {
        const modal = document.createElement('div');
        modal.className = this.modalClass;
        return modal;
    }

    /**
     * Show the modal
     * Call this from subclass after creating modal content
     */
    protected show(): void {
        if (this.modal) {
            document.body.appendChild(this.modal);
            // Force reflow for CSS transition
            this.modal.offsetHeight;
            this.modal.classList.add('visible');
            this.attachBaseEventListeners();
        }
    }

    /**
     * Hide the modal
     * Removes from DOM immediately (no transition delay)
     */
    protected hide(): void {
        if (this.modal) {
            this.modal.classList.remove('visible');
            // Immediate cleanup - no transition delay
            if (this.modal.parentNode) {
                this.modal.parentNode.removeChild(this.modal);
            }
            this.modal = null;
        }
    }

    /**
     * Attach base event listeners (close on ESC, click outside)
     * Called automatically by show()
     */
    private attachBaseEventListeners(): void {
        // Click outside to close
        this.modal?.addEventListener('click', e => {
            if (e.target === this.modal) {
                this.hide();
            }
        });

        // Escape key to close
        const escapeHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.hide();
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);
    }
}
