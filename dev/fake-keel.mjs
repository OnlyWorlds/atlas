// Minimal fake keel for live-verifying atlas flows (account-mode S260;
// world-meta sync S262). Implements: GET /api/v2/account, GET
// /api/v2/account/worlds, POST /api/v2/account/worlds/:id/keys,
// GET+PATCH /api/v2/world (world-meta, keel@83fe020 semantics),
// GET /api/v2/:type (cursor-envelope lists). CORS open. Port 8787.
// Rescued from the S260 scratchpad to tools/atlas/dev/ (S262) — a durable
// verification instrument, not session debris.
import http from 'node:http';

const TOKEN = 'ow_a_livetest00000000000000000000000000000000';
const WORLD_ID = '11111111-2222-4333-8444-555555555555';
const KEY = 'ow_w_livetestkey000000000000000000000000fake';
const createdKeys = new Set([KEY]);

const worldMeta = {
  id: WORLD_ID,
  name: 'Fake Keel World',
  description: '',
  image_url: '',
  time_format_names: [],
  time_format_equivalents: [],
  time_basic_unit: '',
  time_range_min: null,
  time_range_max: null,
  time_range_current: null,
  public_read: false,
  created_at: '2026-07-13T08:00:00Z',
  updated_at: '2026-07-13T08:00:00Z',
};

const elements = {
  character: [
    { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Probe Hero', description: 'Downloaded through the fake keel.', updated_at: '2026-07-13T08:00:00Z' },
    { id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Probe Rival', description: 'Second element.', updated_at: '2026-07-13T08:00:01Z' },
  ],
  location: [
    { id: 'bbbbbbbb-0000-4000-8000-000000000003', name: 'Probe Bay', description: 'A place.', updated_at: '2026-07-13T08:00:02Z' },
  ],
};

const server = http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, API-Key, API-Pin, Content-Type, Idempotency-Key',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  const send = (status, body) => {
    res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const err = (status, code, message, param = null) =>
    send(status, { error: { type: 'authentication_error', code, message, param } });

  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  console.log(req.method, p);

  // ---- account routes (Bearer) ----
  if (p.startsWith('/api/v2/account')) {
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${TOKEN}`) return err(401, 'invalid_credentials', 'Invalid account token.');
    if (p === '/api/v2/account' && req.method === 'GET') {
      return send(200, { id: 'u-1', username: 'captain-live', email: 'cap@example.com', date_joined: '2020-01-01T00:00:00Z' });
    }
    if (p === '/api/v2/account/worlds' && req.method === 'GET') {
      return send(200, { data: [
        { id: WORLD_ID, name: 'Fake Keel World', role: 'owner', public_read: false, keys: [] },
        { id: '99999999-2222-4333-8444-555555555555', name: 'Shared Realm', role: 'collaborator', public_read: true, keys: [] },
      ] });
    }
    if (p === `/api/v2/account/worlds/${WORLD_ID}/keys` && req.method === 'POST') {
      return send(201, { id: 'k-1', last4: KEY.slice(-4), scope: 'WRITE', last_used_at: null, revoked: false, key: KEY });
    }
    // create world — the PIN dance: this fake account ALREADY has a pin,
    // so a body carrying `pin` is rejected 422 param=pin; omitted passes.
    if (p === '/api/v2/account/worlds' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const data = JSON.parse(body || '{}');
        if ('pin' in data) return send(422, { error: { type: 'invalid_request', code: 'invalid_request', message: 'This account already has a PIN; omit it.', param: 'pin' } });
        if (!data.name) return send(422, { error: { type: 'invalid_request', code: 'invalid_request', message: 'name required', param: 'name' } });
        const id = 'cccccccc-0000-4333-8444-' + String(Date.now()).slice(-12).padStart(12, '0');
        const key = 'ow_w_created' + Math.abs(id.length * 7919) + '0000000000000000000fake2';
        createdKeys.add(key);
        return send(201, { id, name: data.name, role: 'owner', public_read: false, keys: [{ last4: key.slice(-4), scope: 'WRITE', revoked: false }], key });
      });
      return;
    }
    return err(404, 'not_found', 'Not found.');
  }

  // ---- world-key routes ----
  // World-meta state (S262): the 13-field /world body, keel@83fe020 semantics.
  // Mutable via PATCH; updated_at bumps on every applied write (even
  // same-value — keel does not diff), never on an empty body.
  if (p === '/api/v2/world' && req.method === 'GET') {
    if (!createdKeys.has(req.headers['api-key'])) return err(401, 'invalid_credentials', 'Invalid API key.');
    return send(200, { ...worldMeta });
  }
  if (p === '/api/v2/world' && req.method === 'PATCH') {
    if (!createdKeys.has(req.headers['api-key'])) return err(401, 'invalid_credentials', 'Invalid API key.');
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const data = JSON.parse(body || '{}');
      const TEXT = ['name', 'description', 'image_url', 'time_basic_unit'];
      const LIST = ['time_format_names', 'time_format_equivalents'];
      const INT = ['time_range_min', 'time_range_max', 'time_range_current'];
      const invalid = (message, param) =>
        send(422, { error: { type: 'invalid_request_error', code: 'invalid_request', message, param } });
      for (const [k, v] of Object.entries(data)) {
        if (TEXT.includes(k)) {
          if (typeof v !== 'string') return invalid(`'${k}' must be a string.`, k);
          if (k === 'name' && !v.trim()) return invalid('name must be a non-empty string.', k);
        } else if (LIST.includes(k)) {
          if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) return invalid(`'${k}' must be a list of strings.`, k);
        } else if (INT.includes(k)) {
          if (v !== null && (typeof v !== 'number' || !Number.isInteger(v))) return invalid(`'${k}' must be an integer or null.`, k);
        } else {
          return invalid(`Unknown field '${k}'.`, k);
        }
      }
      const keys = Object.keys(data);
      if (keys.length > 0) {
        Object.assign(worldMeta, data);
        worldMeta.updated_at = new Date().toISOString();
        console.log('  PATCH /world applied:', keys.join(', '), '→ updated_at', worldMeta.updated_at);
      }
      return send(200, { ...worldMeta });
    });
    return;
  }
  // /changes MUST precede the generic list matcher ([a-z]+ captures 'changes').
  if (p === '/api/v2/changes' && req.method === 'GET') {
    if (!createdKeys.has(req.headers['api-key'])) return err(401, 'invalid_credentials', 'Invalid API key.');
    return send(200, { cursor: 'c-0', changes: [], has_more: false, head: 0 });
  }
  const listMatch = p.match(/^\/api\/v2\/([a-z]+)$/);
  if (listMatch && req.method === 'GET') {
    if (!createdKeys.has(req.headers['api-key'])) return err(401, 'invalid_credentials', 'Invalid API key.');
    const rows = req.headers['api-key'] === KEY ? (elements[listMatch[1]] ?? []) : [];
    // Latency so the loading overlay's progress states are observable.
    setTimeout(() => send(200, { data: rows, has_more: false, next_cursor: null }), 180);
    return;
  }
  return err(404, 'not_found', 'Not found.');
});

server.listen(8787, () => console.log('fake keel on http://localhost:8787'));
