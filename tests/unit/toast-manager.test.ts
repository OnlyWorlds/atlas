/**
 * Problem toasts (S368, lane X): buttons, details, sticky, eviction.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToastManager, feedbackUrl, FEEDBACK_BASE } from '../../src/ui/toast-manager';

let toasts: ToastManager;
let container: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="toast-container"></div>';
  container = document.getElementById('toast-container')!;
  toasts = new ToastManager();
  toasts.init();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const live = () => Array.from(container.querySelectorAll<HTMLElement>('.ow-toast')).filter(t => t.style.opacity !== '0');

describe('toast manager', () => {
  it('keeps plain toasts as they were: text only, escaped, auto-dismissed', () => {
    toasts.error('<img src=x onerror=alert(1)>');
    const el = live()[0];
    expect(el.getAttribute('role')).toBe('alert');
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('.ow-toast-message')!.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(el.querySelector('button')).toBeNull();
    vi.advanceTimersByTime(8000);
    expect(live()).toHaveLength(0);
  });

  it('renders actions as buttons that run and then dismiss', () => {
    const run = vi.fn();
    toasts.show('Could not save.', 'error', 8000, { actions: [{ label: 'Retry now', run }] });
    const btn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Retry now')!;
    expect(btn).toBeTruthy();
    btn.click();
    expect(run).toHaveBeenCalledTimes(1);
    expect(live()).toHaveLength(0);
  });

  it('a toast with buttons is sticky and has a Dismiss button', () => {
    toasts.show('Could not save.', 'error', 1000, { actions: [{ label: 'Retry now', run: () => {} }] });
    vi.advanceTimersByTime(60_000);
    expect(live()).toHaveLength(1);
    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!;
    expect(close).toBeTruthy();
    close.click();
    expect(live()).toHaveLength(0);
  });

  it('shows details in a native disclosure with Copy details and Send feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    toasts.show('Something failed.', 'error', 8000, { details: 'Atlas 1.14.0\nKind: bug' });
    const box = container.querySelector('details')!;
    expect(box.querySelector('summary')!.textContent).toBe('Details');
    expect(box.querySelector('pre')!.textContent).toBe('Atlas 1.14.0\nKind: bug');
    const copy = Array.from(box.querySelectorAll('button')).find(b => b.textContent === 'Copy details')!;
    copy.click();
    expect(writeText).toHaveBeenCalledWith('Atlas 1.14.0\nKind: bug');
    await flush();
    expect(copy.textContent).toBe('Copied');
    const send = box.querySelector<HTMLAnchorElement>('a')!;
    expect(send.textContent).toBe('Send feedback');
    expect(send.target).toBe('_blank');
    expect(send.rel).toBe('noopener');
    expect(send.href.startsWith(FEEDBACK_BASE)).toBe(true);
    expect(decodeURIComponent(send.href.slice(FEEDBACK_BASE.length))).toBe('Atlas 1.14.0\nKind: bug');
    // Details make the toast sticky too.
    vi.advanceTimersByTime(60_000);
    expect(live()).toHaveLength(1);
  });

  it('selects the details text when the clipboard refuses', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    toasts.show('Something failed.', 'error', 8000, { details: 'the block' });
    const copy = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Copy details')!;
    copy.click();
    await flush();
    expect(window.getSelection()!.toString()).toBe('the block');
  });

  it('keeps the feedback link under 1800 characters', () => {
    const url = feedbackUrl('ü'.repeat(5000));
    expect(url.length).toBeLessThan(1800);
    expect(url.startsWith(FEEDBACK_BASE)).toBe(true);
  });

  it('evicts plain toasts before sticky ones at the cap', () => {
    toasts.show('Sticky one.', 'error', 8000, { actions: [{ label: 'Retry now', run: () => {} }] });
    toasts.info('plain a');
    toasts.info('plain b');
    toasts.info('plain c');
    const texts = live().map(t => t.querySelector('.ow-toast-message')!.textContent);
    expect(texts).toContain('Sticky one.');
    expect(texts).not.toContain('plain a');
    expect(texts).toHaveLength(3);
  });

  it('problem() shows the sentence with its fixes, and nothing for a quiet problem', () => {
    toasts.problem({ sentence: '', quiet: true });
    expect(live()).toHaveLength(0);
    const run = vi.fn();
    toasts.problem({ sentence: 'Your disk is full.' }, { fixes: [{ label: 'Retry now', run }] });
    expect(live()[0].querySelector('.ow-toast-message')!.textContent).toBe('Your disk is full.');
    expect(live()[0].getAttribute('role')).toBe('alert');
  });
});
