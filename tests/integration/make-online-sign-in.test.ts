/**
 * Keel #134 (Skeld h29 #7492, S432): signed out, making a world online signs in
 * with the account's email or username and password, then makes the world on
 * the account (POST /api/v2/account/worlds). The classic create-world-external
 * lane is never called: its handler stays mounted as a tripwire.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../setup';
import { statefulOwHandlers, statefulV2Handlers } from '../msw-handlers';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MakeOnlineModal } from '../../src/ui/make-online-modal';
import { patchSlice, getState } from '../../src/core/state';
import { setActiveStore } from '../../src/core/active-store';
import { defaultRegistry } from '../../src/core/types';
import { ToastManager } from '../../src/ui/toast-manager';
import { setMakeOnlineBaseUrl } from '../../src/sync/make-online';
import type { Element } from '../../src/core/types';

const V2 = 'https://www.onlyworlds.com/api/v2';
const AUTH = `${V2}/auth/app/v1`;
const TOKEN = 'ow_a_' + 's'.repeat(40);

let sent: string[] = [];
let v1: ReturnType<typeof statefulOwHandlers>;
const onRequest = ({ request }: { request: Request }) => { sent.push(`${request.method} ${new URL(request.url).pathname}`); };

function mountKeel(opts: { password: string }) {
  const made: Array<Record<string, unknown>> = [];
  mswServer.use(
    http.post(`${AUTH}/auth/login`, async ({ request }) => {
      const body = await request.json() as { email?: string; username?: string; password: string };
      if (body.password !== opts.password) {
        return HttpResponse.json({ status: 400, errors: [{ code: 'email_password_mismatch', message: 'nope' }] }, { status: 400 });
      }
      return HttpResponse.json({ status: 200, meta: { session_token: 'sess-1' } });
    }),
    http.delete(`${AUTH}/auth/session`, () => new HttpResponse(null, { status: 204 })),
    http.post(`${V2}/account/tokens`, () => HttpResponse.json({ id: 'tok-1', token: TOKEN, name: 'Atlas in a browser', last4: 'ssss' }, { status: 201 })),
    http.get(`${V2}/account`, () => HttpResponse.json({ username: 'walker', email: 'walker@example.com' })),
    http.post(`${V2}/account/worlds`, async ({ request }) => {
      made.push(await request.json() as Record<string, unknown>);
      return HttpResponse.json({ id: '0e2e0000-0000-4000-8000-000000000134', name: 'W', key: 'ow_w_' + 'k'.repeat(40) }, { status: 201 });
    }),
    ...statefulV2Handlers({ baseUrl: V2 }).handlers,
  );
  return { made };
}

function fill(modal: HTMLElement, name: string, value: string): void {
  modal.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value = value;
}

beforeEach(async () => {
  document.body.innerHTML = '<div class="atlas-shell"></div>';
  sent = [];
  mswServer.events.on('request:start', onRequest);
  v1 = statefulOwHandlers({ baseUrl: 'https://www.onlyworlds.com/api/worldapi' });
  mswServer.use(...v1.handlers);
  setMakeOnlineBaseUrl('https://www.onlyworlds.com/api/worldapi');
  const store = new MockFolderStore();
  await store.open(null);
  await store.createElement('character', { name: 'Alice' } as Partial<Element>);
  setActiveStore(store as never);
  const entry = { id: 'w1', name: 'W', state: 'local-only', folder: { handle_key: 'k', folder_name: 'f' } };
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry as never] });
  patchSlice('active', { worldId: 'w1', meta: { id: 'w1', name: 'W' }, opened: true } as never);
  patchSlice('data', { ...getState().data, elements: await store.listElements() });
});

afterEach(() => {
  mswServer.events.removeListener('request:start', onRequest);
  mswServer.resetHandlers();
  document.body.innerHTML = '';
});

describe('Make online, signed out, signs in and makes the world on the account', () => {
  it('signs in, keeps the token, creates on the account, and never calls create-world-external', async () => {
    const keel = mountKeel({ password: 'right' });
    new MakeOnlineModal(new ToastManager()).open();
    const modal = document.querySelector<HTMLElement>('[data-modal="make-online"]')!;
    expect(modal.querySelector('input[name="create-email"]')).toBeNull();
    fill(modal, 'signin-login', 'walker@example.com');
    fill(modal, 'signin-password', 'right');
    fill(modal, 'create-pin', '1234');
    modal.querySelector<HTMLFormElement>('[data-form="create-route"]')!.requestSubmit();

    await vi.waitFor(() => expect(keel.made).toHaveLength(1), { timeout: 5000 });
    expect(keel.made[0]).toMatchObject({ name: 'W' });
    expect(getState().registry.account_token).toBe(TOKEN);
    expect(getState().registry.account_username).toBe('walker');
    expect(sent).toContain('POST /api/v2/auth/app/v1/auth/login');
    expect(sent.some(r => r.includes('worldsync'))).toBe(false);
    expect(v1.worldCreations).toHaveLength(0);
  });

  it('a refused password says why, keeps nothing, and makes no world', async () => {
    const keel = mountKeel({ password: 'right' });
    new MakeOnlineModal(new ToastManager()).open();
    const modal = document.querySelector<HTMLElement>('[data-modal="make-online"]')!;
    fill(modal, 'signin-login', 'walker@example.com');
    fill(modal, 'signin-password', 'wrong');
    fill(modal, 'create-pin', '1234');
    modal.querySelector<HTMLFormElement>('[data-form="create-route"]')!.requestSubmit();

    const error = modal.querySelector<HTMLElement>('[data-role="create-error"]')!;
    await vi.waitFor(() => expect(error.hidden).toBe(false), { timeout: 5000 });
    expect(error.textContent).toMatch(/did not match an OnlyWorlds account/);
    expect(getState().registry.account_token).toBeUndefined();
    expect(keel.made).toHaveLength(0);
    expect(modal.querySelector('input[name="signin-login"]')).not.toBeNull(); // the fields stay for another try
    expect(sent.some(r => r.includes('worldsync'))).toBe(false);
  });

  it('an empty password is asked for before anything is sent', async () => {
    mountKeel({ password: 'right' });
    new MakeOnlineModal(new ToastManager()).open();
    const modal = document.querySelector<HTMLElement>('[data-modal="make-online"]')!;
    fill(modal, 'signin-login', 'walker@example.com');
    fill(modal, 'create-pin', '1234');
    modal.querySelector<HTMLFormElement>('[data-form="create-route"]')!.requestSubmit();
    const error = modal.querySelector<HTMLElement>('[data-role="create-error"]')!;
    expect(error.textContent).toBe('Enter your OnlyWorlds password.');
    expect(sent).toEqual([]);
  });
});
