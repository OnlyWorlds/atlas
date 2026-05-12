/**
 * Toast Notification Manager
 * Queue-based toast system with auto-dismiss
 */

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

class ToastManager {
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
  show(message: string, type: ToastType = 'info', duration = 4000): void {
    if (!this.container) {
      console.error('Toast manager not initialized');
      return;
    }

    const toast: Toast = {
      id: `toast-${Date.now()}-${Math.random()}`,
      message,
      type,
      duration
    };

    this.toasts.push(toast);

    // Remove oldest toast if exceeding max
    if (this.toasts.length > this.maxToasts) {
      const oldestToast = this.toasts.shift();
      if (oldestToast) {
        this.removeToast(oldestToast.id);
      }
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
    this.show(message, 'error', duration);
  }

  info(message: string, duration?: number): void {
    this.show(message, 'info', duration);
  }

  /**
   * Render toast element
   */
  private renderToast(toast: Toast): void {
    if (!this.container) return;

    const toastEl = document.createElement('div');
    toastEl.id = toast.id;
    toastEl.className = `ow-toast ow-toast-${toast.type}`;

    const icon = this.getIcon(toast.type);
    toastEl.innerHTML = `
      <span class="material-icons ow-toast-icon">${icon}</span>
      <span class="ow-toast-message">${this.escapeHtml(toast.message)}</span>
    `;

    this.container.appendChild(toastEl);

    // Auto-dismiss after duration
    setTimeout(() => {
      this.removeToast(toast.id);
    }, toast.duration);
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
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
