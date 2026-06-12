# Sharing — Cloudflare Delivery Design (Temper's half)

**Status**: MERGED (2026-06-12, session 239) — Anchor's half is BUILT: she chose **purge-by-URL** (scoped Zone→Cache-Purge token, Captain mints it; degrades to edge TTL when the token's absent). Cache key = `https://www.onlyworlds.com/api/sharing/pages/<slug>/` (configurable via her `SHARING_API_ORIGIN`); all three payload fetchers (atlas client, viewer SPA, OG Function) are pinned to that host. Remaining: the shared Cache Rule (§3) + the §5 deploy-time verify.
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
2. **Invalidation — DECIDED (as-built): purge-by-URL.** Django holds a CF API token (zone → purge scope only), fires the purge with the exact page URL on republish + revoke; degrades to edge TTL if the token's absent. Captain mints the token. TTL can be LONG (hours+) — exact freshness, max cache efficiency.
3. **Per-IP throttle on the GET** stays at Django regardless (cache-miss path + cache-bypass attempts are still origin traffic).
4. **CORS on the public GET** (flagged session 239): the viewer SPA fetches cross-origin (`show.onlyworlds.com` → `www.onlyworlds.com`). The response needs `Access-Control-Allow-Origin` — and because the response is edge-cached, it should be **`*` set statically**, NOT a per-request Origin reflection (a cached copy carrying `ACAO: <some-other-origin>` without `Vary: Origin` would be served to the viewer and blocked by the browser). Likely covered by ow.com's existing global CORS config — verify which mode it runs in at first deploy.

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

## 5. Verify at first deploy (checklist — RUN 2026-06-12, deploy day)

1. ✅ `cf-cache-status: HIT` on second GET (Cache Rule live).
2. ✅ Republish → purge fires → edge refreshed within seconds (verified twice: ETag flip + Age reset; Anchor's env vars `CLOUDFLARE_ZONE_ID`/`CLOUDFLARE_PURGE_TOKEN` are set).
3. ⬜ Revoke → 410 immediately (not yet exercised live post-purge-wiring).
4. ⬜ Bot-UA curl on `show.onlyworlds.com/<slug>` → og:title (OG Function unverified).
5. ⬜ Burst test (~1 origin hit).
6. ✅ CORS: origin-reflected ACAO with `Vary: origin` for show + localhost dev.
7. ✅ Cache HIT + CORS: per-origin cache keys (`Vary: origin`) make this safe by construction.

**Post-deploy residue (small, non-blocking):**
- The Cache Rule was set with explicit TTLs (responses carry `max-age=14400`, overriding origin's 3600) — recommend flipping to **"respect origin headers"** so Anchor's header changes (incl. the suggested `max-age=0, s-maxage=3600` split) take effect.
- Viewer-side browser staleness is already neutralized (`no-cache` fetch + ETag revalidation, show v0.2).
