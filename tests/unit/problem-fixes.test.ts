/**
 * showProblem: the sentence, the fix buttons, and details only when worth reporting (S368).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToastManager } from '../../src/ui/toast-manager';
import { showProblem } from '../../src/ui/problem-fixes';
import { problemWasShown, PlainError } from '../../src/core/problems';

let toasts: ToastManager;
let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="toast-container"></div>';
  container = document.getElementById('toast-container')!;
  toasts = new ToastManager();
  toasts.init();
});

const buttons = () => Array.from(container.querySelectorAll('button, a')).map(b => b.textContent);

describe('showProblem', () => {
  it('a held file: plain sentence, Retry now, details; the browser text stays out', () => {
    const retry = vi.fn();
    const err = new DOMException('An operation that depends on state cached in an interface object', 'InvalidStateError');
    showProblem(err, { doing: 'saving this scene', retry, toasts });
    const text = container.querySelector('.ow-toast-message')!.textContent!;
    expect(text).toContain('could not finish saving this scene');
    expect(text).not.toContain('interface object');
    expect(buttons()).toEqual(expect.arrayContaining(['Retry now', 'Copy details', 'Send feedback']));
    expect(container.querySelector('pre')!.textContent).toContain('Kind: disk-busy');
    expect(problemWasShown(err)).toBe(true);
    Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Retry now')!.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('no Retry now without a retry, and a refusal shows its own words without details', () => {
    showProblem(new PlainError('Finish editing the zone first.'), { doing: 'giving new ids', toasts });
    expect(container.querySelector('.ow-toast-message')!.textContent).toBe('Finish editing the zone first.');
    expect(container.querySelector('details')).toBeNull();
    expect(buttons()).not.toContain('Retry now');
  });

  it('a permission problem offers Allow access', () => {
    showProblem(new DOMException('denied', 'NotAllowedError'), { doing: 'opening this world', toasts });
    expect(buttons()).toContain('Allow access');
  });

  it('a cancelled picker shows nothing', () => {
    showProblem(new DOMException('The user aborted a request.', 'AbortError'), { doing: 'opening a folder', toasts });
    expect(container.children).toHaveLength(0);
  });
});
