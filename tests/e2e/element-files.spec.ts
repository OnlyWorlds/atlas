/**
 * The Files card through the real page: an online world's element
 * lists its files with the world's total, adds one through a ticket (the
 * world's own PIN to keel, only the ticket to the upload host), fetches a
 * download link at the click, and removes a file this key added. A local
 * world's element has no card. keel and the upload host are mocked with
 * page.route; the online world comes in through the #/join/ door, as a seat
 * whose membership added one of the two files.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const V2 = 'https://www.onlyworlds.com/api/v2';
const WORLD_ID = '22222222-3333-4444-8555-777777777777';
const CHAR_ID = 'c0000000-0000-4000-8000-000000000002';
const CODE = 'ow_j_' + 'F'.repeat(32);
const SECRET = 'ow_s_' + 'T'.repeat(32);
const KEY = 'ow_w_' + 'L'.repeat(32);
const MB = 1024 * 1024;

interface Seen {
  tickets: Array<{ pin: string | null; body: unknown }>;
  host: Array<{ auth: string | null; key: string | null; pin: string | null }>;
  links: string[];
  deletes: string[];
}

const fileRow = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `${id}.pdf`, kind: 'pdf', size: 12.4 * MB, label: null,
  added_by: { name: 'Judge Holden', membership: null, agent: false }, added_at: '2026-10-19T10:00:00Z', ...over,
});

async function onlineWorld(page: Page): Promise<Seen> {
  const seen: Seen = { tickets: [], host: [], links: [], deletes: [] };
  const now = '2026-10-10T00:00:00.000Z';
  let files = [
    fileRow('scan', { name: 'Blood Meridian, ch. I-XXIII (scan).pdf', label: 'Source' }),
    fileRow('notes', { name: 'The Kid, timeline notes.md', kind: 'md', size: 6 * 1024, label: null,
      added_by: { name: 'Quillon\'s seat', membership: 'm-seat', agent: true } }),
  ];
  const char = { id: CHAR_ID, type: 'character', name: 'The Kid', updated_at: now, created_at: now };
  await page.route(`${V2}/**`, async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v2', '');
    const parts = path.split('/').filter(Boolean);
    if (path === '/join/preview') return route.fulfill({ json: {
      world: { name: 'Blood Meridian', description: '' }, invited_by: null, owner_character: null,
      role: 'contributor', with_character: false, expires_at: '2099-01-01T00:00:00Z' } });
    if (path === '/join') return route.fulfill({ status: 201, json: {
      world: { id: WORLD_ID, name: 'Blood Meridian', description: '' }, seat: { id: 'm-seat', role: 'contributor', agent_name: 'x' },
      with_character: false, character: null, key: KEY, pin: SECRET } });
    if (path === '/me' || path === '/me/') return route.fulfill({ json: {
      world: { id: WORLD_ID, name: 'Blood Meridian' }, scope: 'write', kind: 'agent', role: 'contributor', membership: 'm-seat', character: null } });
    if (path === '/world/files') return route.fulfill({ json: { data: [], used_bytes: 41 * MB + files.length, cap_bytes: 250 * MB } });
    if (path === '/world' || path === '/world/') return route.fulfill({ json: { id: WORLD_ID, name: 'Blood Meridian', updated_at: now } });
    if (parts[0] === 'character' && parts[2] === 'files') {
      if (parts.length === 3 && req.method() === 'GET') return route.fulfill({ json: { data: files } });
      if (parts.length === 3 && req.method() === 'POST') {
        seen.tickets.push({ pin: req.headers()['api-pin'] ?? null, body: req.postDataJSON() });
        return route.fulfill({ status: 201, json: {
          ticket: 'ftk-1', upload_url: 'https://upload.onlyworlds.com/v1/file', prefix: `w/${WORLD_ID}/${CHAR_ID}/`,
          key: `w/${WORLD_ID}/${CHAR_ID}/f-new.txt`, max_bytes: 25 * MB, exp: 0, uses: 1,
          issued_to: { account: null, membership: 'm-seat' }, kind: 'file', file_id: 'f-new' } });
      }
      if (parts.length === 5 && parts[4] === 'download') {
        seen.links.push(parts[3]);
        return route.fulfill({ json: { url: 'https://files.onlyworlds.com/x/scan.pdf', exp: 0, name: 'scan.pdf', kind: 'pdf', size: 1 } });
      }
      if (parts.length === 4 && req.method() === 'DELETE') {
        seen.deletes.push(parts[3]);
        files = files.filter(f => f.id !== parts[3]);
        return route.fulfill({ status: 204, body: '' });
      }
    }
    if (parts[0] === 'character' && parts.length === 2) return route.fulfill({ json: char });
    const data = parts[0] === 'character' ? [char] : [];
    return route.fulfill({ json: { data, has_more: false, next_cursor: null } });
  });
  await page.route('https://upload.onlyworlds.com/**', async (route: Route) => {
    const h = route.request().headers();
    seen.host.push({ auth: h['authorization'] ?? null, key: h['api-key'] ?? null, pin: h['api-pin'] ?? null });
    files = [fileRow('f-new', { name: 'kid, quotes.txt', kind: 'txt', size: 2048, label: 'Description',
      added_by: { name: 'Quillon\'s seat', membership: 'm-seat', agent: true } }), ...files];
    return route.fulfill({ status: 201, json: { key: 'k', fid: 'f-new', bytes: 2048, type: 'text/plain', etag: 'e' } });
  });
  await page.route('https://files.onlyworlds.com/**', (route: Route) =>
    route.fulfill({ status: 200, headers: { 'Content-Disposition': 'attachment; filename="scan.pdf"' }, contentType: 'application/pdf', body: '%PDF-1.4' }));

  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('about:blank');
  await page.goto(`/#/join/${CODE}`);
  const modal = page.locator('[data-modal="join-world"]');
  await expect(modal).toBeVisible();
  const browserWhere = modal.locator('input[name="where"][value="browser"]');
  if (await browserWhere.count()) await browserWhere.check();
  await modal.locator('[data-action="open"]').click();
  await expect(modal).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__atlasTestApi.getState().data.elements.length)).toBe(1);
  const worldId = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
  await page.evaluate(([w, c]) => { window.location.hash = `#/w/${w}/element/${c}`; }, [worldId, CHAR_ID]);
  return seen;
}

test('an online world\'s element lists its files, with the world\'s total and Remove only where keel would take it', async ({ page }) => {
  await onlineWorld(page);
  const card = page.locator('.atlas-files-section');
  await expect(card.locator('.atlas-file-row')).toHaveCount(2);
  await expect(card.locator('.atlas-files-meta')).toHaveText('2 · this world 41 MB of 250 MB');
  const scan = card.locator('[data-file-id="scan"]');
  await expect(scan.locator('.atlas-field-label')).toHaveText('Source');
  await expect(scan.locator('.atlas-file-line')).toHaveText('pdf · 12.4 MB · added by Judge Holden · 2026-10-19');
  // The owner added it, and this key is a contributor's seat: no Remove.
  await expect(scan.locator('[data-action="remove-file"]')).toHaveCount(0);
  const notes = card.locator('[data-file-id="notes"]');
  await expect(notes.locator('.atlas-field-label')).toHaveText('—');
  await expect(notes.locator('.atlas-file-agent')).toHaveText('Agent');
  await expect(notes.locator('[data-action="remove-file"]')).toHaveCount(1);
});

test('Download asks keel for a link at the click', async ({ page }) => {
  const seen = await onlineWorld(page);
  const scan = page.locator('.atlas-files-section [data-file-id="scan"]');
  await expect(scan).toBeVisible();
  expect(seen.links).toEqual([]);
  const download = page.waitForEvent('download');
  await scan.locator('[data-action="download-file"]').click();
  await download;
  expect(seen.links).toEqual(['scan']);
});

test('Add file: a label, a ticket with the world\'s PIN, the bytes with only the ticket, the row in the list', async ({ page }) => {
  const seen = await onlineWorld(page);
  const card = page.locator('.atlas-files-section');
  await expect(card.locator('.atlas-file-row')).toHaveCount(2);
  await card.locator('input[type="file"]').setInputFiles({ name: 'kid, quotes.txt', mimeType: 'text/plain', buffer: Buffer.from('x'.repeat(2048)) });
  const form = card.locator('.atlas-files-label-form');
  await expect(form).toContainText('kid, quotes.txt · 2 KB');
  await form.locator('input[type="text"]').fill('Description');
  await form.locator('[data-action="upload-file"]').click();
  await expect(card.locator('[data-file-id="f-new"]')).toBeVisible();
  await expect(page.locator('.ow-toast', { hasText: 'kid, quotes.txt added to The Kid' })).toBeVisible();
  expect(seen.tickets).toEqual([{ pin: SECRET, body: { name: 'kid, quotes.txt', kind: 'txt', size: 2048, label: 'Description' } }]);
  expect(seen.host).toEqual([{ auth: 'Bearer ftk-1', key: null, pin: null }]);
  await expect(card.locator('.atlas-file-row')).toHaveCount(3);
});

test('Remove asks first, then the row leaves', async ({ page }) => {
  const seen = await onlineWorld(page);
  const notes = page.locator('.atlas-files-section [data-file-id="notes"]');
  await expect(notes).toBeVisible();
  page.once('dialog', d => { expect(d.message()).toContain('The Kid, timeline notes.md'); void d.dismiss(); });
  await notes.locator('[data-action="remove-file"]').click();
  expect(seen.deletes).toEqual([]);
  page.once('dialog', d => void d.accept());
  await notes.locator('[data-action="remove-file"]').click();
  await expect(notes).toHaveCount(0);
  expect(seen.deletes).toEqual(['notes']);
});

test('a local world\'s element has no Files card', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('files-test-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Local');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await page.waitForSelector('[data-role="elements-search"]');
  const made = await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const created = await api.getActiveStore().createElement('character', { name: 'Ana', description: 'here' });
    api.patchData(await api.getActiveStore().listElements());
    return { world: api.getState().active.worldId as string, el: created.id as string };
  });
  await page.evaluate(([w, c]) => { window.location.hash = `#/w/${w}/element/${c}`; }, [made.world, made.el]);
  await expect(page.locator('[data-section="Custom fields"]')).toBeVisible();
  await expect(page.locator('.atlas-files-section')).toHaveCount(0);
});
