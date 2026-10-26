/**
 * Toast Notification Manager
 * Queue-based toast system with auto-dismiss
 *
 * A toast with buttons or details stays until the user closes it: a
 * fix the user has to read and act on must not race a timer. It gets a close
 * button, and at the cap the plain toasts are evicted before it.
 */

type ToastType = 'success' | 'error' | 'info';

/**
 * The key of a toast asking for the sign-in a waiting link needs (the open
 * door's, a person's invitation's): the sign-in takes it down when it lands
 * (`settings-account.ts`), so it never outlives what it asked for.
 */
export const WAITS_FOR_SIGN_IN = 'waits-for-sign-in';

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface ToastOptions {
  actions?: ToastAction[];
  /** Plain text behind a "Details" disclosure, with Copy details and Send feedback. */
  details?: string;
  /** No auto-dismiss. Implied by actions or details. */
  sticky?: boolean;
  /**
   * Same key, same message: the new toast replaces the one on screen (a save
   * failing on every autosave of ONE scene). Without a key nothing is
   * replaced: two scenes failing alike each keep their own Retry.
   */
  dedupeKey?: string;
}

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  sticky: boolean;
  opts: ToastOptions;
}

/** Where "Send feedback" goes; the details ride in the body. */
export const FEEDBACK_BASE = 'https://onlyworlds.com/feedback?category=atlas&body=';
const FEEDBACK_URL_MAX = 1800;

/** The feedback link for these details, trimmed so the whole URL stays under 1800 characters. */
export function feedbackUrl(details: string): string {
  let body = details;
  let url = FEEDBACK_BASE + encodeURIComponent(body);
  while (url.length >= FEEDBACK_URL_MAX && body.length > 0) {
    const over = url.length - FEEDBACK_URL_MAX + 1;
    // An encoded character can take up to 9 URL characters; cut at least one.
    body = body.slice(0, Math.max(0, body.length - Math.max(1, Math.ceil(over / 3))));
    url = FEEDBACK_BASE + encodeURIComponent(body + '…');
  }
  return url;
}

export class ToastManager {
  private container: HTMLElement | null = null;
  private toasts: Toast[] = [];
  private maxToasts = 3;

  init(): void {
    this.container = document.getElementById('toast-container');
    if (!this.container) {
      console.warn('Toast container not found');
    }
  }

  /**
   * Show a toast notification
   */
  show(message: string, type: ToastType = 'info', duration = 4000, opts: ToastOptions = {}): void {
    if (!this.container) {
      console.error('Toast manager not initialized');
      return;
    }

    const rich = (opts.actions?.length ?? 0) > 0 || !!opts.details;
    // The same sticky problem again (a save failing on every keystroke's
    // autosave) replaces the one on screen instead of stacking three of it.
    // The newer one wins: its buttons hold the newest retry.
    if (opts.dedupeKey) {
      for (const t of this.toasts.filter(t => t.opts.dedupeKey === opts.dedupeKey && t.type === type && t.message === message)) this.removeToast(t.id);
    }
    const toast: Toast = {
      id: `toast-${Date.now()}-${Math.random()}`,
      message,
      type,
      duration,
      sticky: !!opts.sticky || rich,
      opts,
    };

    this.toasts.push(toast);

    // Over the cap: the oldest plain toast goes first; a sticky one only
    // when every toast is sticky.
    if (this.toasts.length > this.maxToasts) {
      const victim = this.toasts.find(t => !t.sticky && t.id !== toast.id) ?? this.toasts[0];
      this.removeToast(victim.id);
    }

    this.renderToast(toast);
  }

  /**
   * Convenience methods
   */
  success(message: string, duration?: number): void {
    this.show(message, 'success', duration);
  }

  error(message: string, duration?: number): void {
    // Errors stay twice as long: they are the ones that need reading.
    this.show(message, 'error', duration ?? 8000);
  }

  info(message: string, duration?: number): void {
    this.show(message, 'info', duration);
  }

  /** Take down every toast shown with this key: what it said is over (a sign-in it asked for landed). */
  dismiss(dedupeKey: string): void {
    for (const t of this.toasts.filter(t => t.opts.dedupeKey === dedupeKey)) this.removeToast(t.id);
  }

  /**
   * A problem from `core/problems.ts`: its sentence, its fix buttons and,
   * when given, the details block. A quiet problem (nothing to say) shows nothing.
   */
  problem(problem: { sentence: string; quiet?: boolean }, opts: { details?: string; fixes?: ToastAction[]; dedupeKey?: string } = {}): void {
    if (problem.quiet || !problem.sentence) return;
    this.show(problem.sentence, 'error', 8000, { actions: opts.fixes, details: opts.details, dedupeKey: opts.dedupeKey });
  }

  /**
   * Render toast element
   */
  private renderToast(toast: Toast): void {
    if (!this.container) return;

    const toastEl = document.createElement('div');
    toastEl.id = toast.id;
    toastEl.className = `ow-toast ow-toast-${toast.type}`;
    // Screen readers hear toasts: errors interrupt, the rest wait.
    toastEl.setAttribute('role', toast.type === 'error' ? 'alert' : 'status');

    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined ow-toast-icon';
    icon.textContent = this.getIcon(toast.type);
    toastEl.appendChild(icon);

    const message = document.createElement('span');
    message.className = 'ow-toast-message';
    message.textContent = toast.message;

    const { actions = [], details } = toast.opts;
    if (actions.length > 0 || details || toast.sticky) {
      toastEl.classList.add('ow-toast-rich');
      const body = document.createElement('div');
      body.className = 'ow-toast-body';
      body.appendChild(message);
      if (actions.length > 0) body.appendChild(this.renderActions(toast.id, actions));
      if (details) body.appendChild(this.renderDetails(details));
      toastEl.appendChild(body);

      const close = document.createElement('button');
      close.type = 'button';
      // The glyph lives in its own span: Atlas hides every icon element from
      // screen readers, and on the button itself that hid the button too.
      close.className = 'ow-toast-close';
      close.setAttribute('aria-label', 'Dismiss');
      const glyph = document.createElement('span');
      glyph.className = 'material-symbols-outlined';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.textContent = 'close';
      close.appendChild(glyph);
      close.addEventListener('click', () => this.removeToast(toast.id));
      toastEl.appendChild(close);
    } else {
      toastEl.appendChild(message);
    }

    this.container.appendChild(toastEl);

    if (toast.sticky) return;
    // Auto-dismiss after duration; hovering holds the toast open (reading
    // shouldn't race a timer), with a short grace after leave.
    // Only a mouse holds it: a tap fires the emulated mouseenter too, with no
    // mouseleave until the next tap elsewhere, so one tap pinned a toast for
    // good (Seethe's phone pass). A tap dismisses instead.
    let timer = setTimeout(() => this.removeToast(toast.id), toast.duration);
    toastEl.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') clearTimeout(timer);
    });
    toastEl.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(timer);
      timer = setTimeout(() => this.removeToast(toast.id), 2000);
    });
    toastEl.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse') return;
      clearTimeout(timer);
      this.removeToast(toast.id);
    });
  }

  private renderActions(id: string, actions: ToastAction[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'ow-toast-actions';
    for (const action of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'atlas-btn-ghost ow-toast-action';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        // Run FIRST, inside the click: a permission request needs the gesture.
        let result: void | Promise<void> = undefined;
        try {
          result = action.run();
        } catch (err) {
          console.warn('[toast] action failed:', err);
        }
        this.removeToast(id);
        void Promise.resolve(result).catch(err => console.warn('[toast] action failed:', err));
      });
      row.appendChild(btn);
    }
    return row;
  }

  private renderDetails(text: string): HTMLElement {
    const box = document.createElement('details');
    box.className = 'ow-toast-details';
    const summary = document.createElement('summary');
    summary.textContent = 'Details';
    const pre = document.createElement('pre');
    pre.className = 'ow-toast-details-text';
    pre.textContent = text;

    const row = document.createElement('div');
    row.className = 'ow-toast-actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'atlas-btn-ghost ow-toast-action';
    copy.textContent = 'Copy details';
    const selectText = () => {
      const sel = window.getSelection?.();
      if (!sel) return;
      const range = document.createRange();
      range.selectNodeContents(pre);
      sel.removeAllRanges();
      sel.addRange(range);
    };
    copy.addEventListener('click', () => {
      box.open = true;
      const clip = navigator.clipboard;
      if (!clip?.writeText) { selectText(); return; }
      clip.writeText(text).then(
        () => { copy.textContent = 'Copied'; },
        () => { selectText(); },
      );
    });
    const send = document.createElement('a');
    send.className = 'atlas-btn-ghost ow-toast-action';
    send.textContent = 'Send feedback';
    send.href = feedbackUrl(text);
    send.target = '_blank';
    send.rel = 'noopener';
    row.append(copy, send);

    box.append(summary, pre, row);
    return box;
  }

  /**
   * Remove toast from DOM
   */
  private removeToast(id: string): void {
    const toastEl = document.getElementById(id);
    if (toastEl) {
      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translateY(100%)';
      setTimeout(() => {
        toastEl.remove();
      }, 300);
    }

    this.toasts = this.toasts.filter(t => t.id !== id);
  }

  /**
   * Get icon for toast type
   */
  private getIcon(type: ToastType): string {
    switch (type) {
      case 'success':
        return 'check_circle';
      case 'error':
        return 'error';
      case 'info':
        return 'info';
      default:
        return 'info';
    }
  }

  /**
   * Clear all toasts
   */
  clearAll(): void {
    this.toasts.forEach(toast => this.removeToast(toast.id));
    this.toasts = [];
  }
}

export const toastManager = new ToastManager();

// Export global function for convenience
(window as any).showToast = (message: string, type: ToastType = 'info') => {
  toastManager.show(message, type);
};
