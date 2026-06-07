# Sharing — Cloudflare Delivery Design (Temper's half)

**Status**: DRAFT (2026-06-07, session 238) — the joint mini-design from Anchor's review §7.3. This is the Temper/viewer half; Anchor owns the Django/cache-header half (§3 below names exactly what's hers).
**Context**: `SHARING_CONTRACT.md` v0.2 §7 · Anchor's `SHARING_FEASIBILITY_ANCHOR.md` §3.2 · the viewer at `tools/show/`.

**The goal in one line**: anonymous page-view traffic (the Reddit spike) is served by Cloudflare's edge and never competes with members' API calls for PythonAnywhere's worker pool.

---

## 1. Confirmed ground truth (probed 2026-06-07)

- `www.onlyworlds.com` responds with `Server: cloudflare`, `CF-RAY`, `cf-cache-status: DYNAMIC` → the zone is **already CF-proxied** (orange-cloud). DYNAMIC = passing through uncached, which is just the default for non-static content — no Cache Rule exists yet.
- `show.onlyworlds.com` will be a CF Pages custom domain **on the same zone**.

So the architecture needs **zero new infrastructure** — only configuration + headers.

## 2. The request path

```
visitor → show.onlyworlds.com/<slug>           (CF Pages, static SPA — free, instant)
            │
            ├─ browser SPA fetches  GET www.onlyworlds.com/api/sharing/pages/<slug>/
            │      └─ CF edge: Cache Rule HIT  → served from edge, Django never sees it
            │                  Cache Rule MISS → one origin request, cached per headers
            │
            └─ (unfurl bots) Pages Function fetches the same URL server-side
                   └─ rides the same edge cache → meta injection costs ~nothing
```

Frozen payloads are **immutable between republishes** — the ideal cacheable object.

## 3. The two halves

### Anchor's half (Django)

1. **Cache headers on the public GET** (active pages only):
   `Cache-Control: public, max-age=<TTL>, s-maxage=<TTL>` + `ETag` (payload hash or `updated_at`).
   Error/tombstone responses (404/410): `max-age=60` or no-store — short, so revokes propagate fast even without purge.
2. **Invalidation — pick one** (§8.2 of the contract):
   - **Purge-by-URL** (preferred): hold a CF API token (zone → purge scope only), fire `POST /zones/<id>/purge_cache` with the page URL on republish + revoke. Then the TTL can be LONG (hours+) — exact freshness, max cache efficiency. ~10 lines + a secret.
   - **TTL-only** (fallback): no token, set `max-age=300–900`. "Updates appear within minutes" honesty. Fine for v1 if the token feels like scope creep.
3. **Per-IP throttle on the GET** stays at Django regardless (cache-miss path + cache-bypass attempts are still origin traffic).

### Temper's half (done or owned)

1. **Viewer** (`tools/show/`) — static SPA, scaffolded session 238. Fetches the public GET; renders §5 payloads; honest 404/410/network states. No auth, no cookies → maximally cacheable responses work without `Vary` headaches.
2. **Pages Function** (`functions/[[path]].ts`) — OG meta injection for unfurls; fetches the payload server-side through the same edge cache; fails safe (serves the shell as-is). Response itself carries `max-age=300`.
3. **Pages config** — `_redirects` SPA rewrite, `_routes.json` keeps static assets off the Function.

### The shared piece (one decision, either of us can click it)

A **Cache Rule** on the zone: `hostname eq www.onlyworlds.com AND starts_with(path, "/api/sharing/pages/")` + method GET → "Eligible for cache, respect origin headers". Without it, CF keeps treating API responses as DYNAMIC even with good headers. (Page Rules are legacy; Cache Rules are the current mechanism.)

## 4. What this does NOT cover

- **Authenticated sharing calls** (publish/republish/revoke/list): never cached, always origin. Low volume — author actions.
- **worldapi sync traffic** (atlas autosave/pull): authenticated, uncacheable by design. This is the actual worker-capacity question for the atlas LAUNCH, separate from sharing — flagged in PROGRESS 238 for Captain's timing call.
- **Live pages**: deferred entirely (contract §6). When they return post-rebuild, they get the second endpoint with its own short TTL — the frozen hot path stays untouched.

## 5. Verify at first deploy (checklist)

1. `curl -I` a published page URL twice → second response `cf-cache-status: HIT`.
2. Republish in atlas → page URL serves the new payload (immediately with purge; within TTL without).
3. Revoke → 410 within TTL (or immediately with purge).
4. Curl a slug with a bot UA on `show.onlyworlds.com` → og:title carries the page title (Function works).
5. A burst of GETs (e.g. `hey -n 200`) → Django access log shows ~1 origin hit.
