# Sharing — Handover

**Written**: 2026-06-07 (session 238) · **CLOSED OUT 2026-06-12 (session 239)**: backend deployed, contract v0.3 as-built + fully confirmed, all blocks built, `show.onlyworlds.com` LIVE, CF cache + purge verified end-to-end. This doc is now historical reference; current truth lives in PROGRESS.md CURRENT STATE + `SHARING_CF_DELIVERY.md` §5 (the small delivery residue).
**One line (as of 238)**: everything atlas-side and viewer-side that can exist without the backend EXISTS and is test-locked; the arc is paused on (a) Anchor building her slice and (b) Captain's smoke of the 238 checklist.

---

## 1. Where every piece stands

| Piece | State | Where |
|---|---|---|
| Block model (heading/prose/element-card/**circle**) | ✅ built + tested | `core/sharing.ts` |
| Publish payload builder (§5) | ✅ built + tested (13 unit) | `core/share-payload.ts` — `buildPagePayload()` |
| Visitor preview | ✅ payload-true (disclosure-correct) | share room preview toggle → `renderPayloadPage` |
| Copy-payload affordance | ✅ | share room detail header, `data_object` button |
| Publish / republish / revoke UI | ✅ built **against fakes** | share room "Publish" section |
| Sharing API client | ✅ typed, error-enum mapped | `sync/sharing-client.ts` |
| Contract fakes | ✅ encode v0.2 (15 integration tests) | `tests/msw-sharing-handlers.ts` |
| Circle block + Knowledge bridge | ✅ ("create page →" in known-view) | share room + `knowledge-room.ts` |
| Viewer tool | ✅ scaffolded, builds, visually verified | `tools/show/` (own README) |
| CF delivery design | ✅ my half drafted | `SHARING_CF_DELIVERY.md` |
| Backend contract | ✅ **v0.2 AGREED** by Captain + Anchor's review | `SHARING_CONTRACT.md` |
| Anchor's backend slice | ⏳ **in her court** | her §8: base path · purge-vs-TTL · error enum · reserved list |
| Captain smoke (238 work) | ⚠ **PENDING** | 10-item checklist in PROGRESS.md "Session 238" |
| S3 theme tokens · element-collection · drag-reorder | ⬜ open, backend-free | DESIGN_SHARING build phases |
| Map block | ⬜ **design conversation first** | D3: only `image_url` maps can publish (local media never leaves the folder) |

**Gates at close**: 797 vitest · 150 Playwright · typecheck · atlas build (TipTap code-split intact) · `tools/show` build. All measured.

## 2. Integration state (updated session 239 — Anchor's slice is BUILT)

Her slice landed 2026-06-07 (83 backend tests; Captain deploying). Steps 1–3 are DONE:

1. ✅ Her message received + processed. As-built adjustments: **slug-addressed PATCH/DELETE**, locked error enum (+`title_too_long`/`intent_invalid`, enveloped 401 w/ `unauthorized`), **quota 20**, purge-by-URL, empty-payload pages serve 200.
2. ✅ Base path was already right — `SHARING_BASE_URL` = `https://www.onlyworlds.com/api/sharing` in all three places (atlas client, `tools/show/src/main.ts`, `tools/show/functions/[[path]].ts`). Host stays pinned to **www** (her CF purge keys on it).
3. ✅ Fakes + client + share-room call sites synced (session 239); contract bumped to v0.3; 800 vitest green. Verify-live residue listed in contract §8 (cross-account 403 vs 404, PATCH-on-revoked, CORS mode).

Remaining (the moment her API is deployed):

4. Live smoke against the real backend (Captain's messworld `5474990854`): publish → curl/visit URL → republish → revoke → 410 → revive. Expect the *first* real 4xx to reveal a fake-vs-real gap — encode it in the fakes before fixing the caller.
5. CF checklist (`SHARING_CF_DELIVERY.md` §5): cache HIT on second GET, purge path, Function unfurl, **CORS** (items 6–7).
6. Wire the share room's list-reconcile if mirror-drift shows up in smoke (`listForWorld` exists on the client, unwired — `atlas_page_pub` is currently the only display source).
7. Deploy-order note: published URLs point at `show.onlyworlds.com` — until Hangar deploys `tools/show`, verify payloads via `curl` on the API URL directly (the toast URL will 404 at the viewer, that's expected).

## 3. Deploying the viewer (Hangar, Captain's call on timing)

`tools/show/` → CF Pages, custom domain `show.onlyworlds.com`, build `npm run build`, output `dist/`. Functions auto-deploy from `functions/`. **Verify at first deploy**: the OG Function (untested locally — fails safe to plain shell). Can deploy BEFORE the backend: landing + drop/paste + `/?demo` work standalone; slug routes will show the network state until Anchor ships.

## 4. Open decisions (none block Anchor)

- **Map block design** — start from D3: published maps need `image_url`; probable v1 = static image + %-positioned pins (portable, no Leaflet in viewer) vs Leaflet embed. Needs a Captain conversation.
- **S3 theme tokens** — the ~6 tokens (accent, font pair, light/dark, density, cover, width); `theme` slot already plumbed end-to-end (page field → payload → viewer). Pure build, no decisions.
- **Worker capacity timing** — the PythonAnywhere upgrade question is about atlas-launch *sync* traffic, not sharing (CF absorbs anonymous reads). Captain's money/timing call, tied to atlas public launch.
- **PRE/POST rebuild frame** — PROGRESS.md Build Map bottom section. The one durable constraint: **public GET path + slugs survive the ow.com rebuild unchanged**.

## 5. Gotchas for whoever picks this up (probably me)

- **Preview ≡ payload ≡ viewer** is the load-bearing invariant. Any new block kind must land in FOUR places: `core/sharing.ts` (model + parse + refs mirror if element-bearing — conv. #75), `core/share-payload.ts` (payload transform), `share-page-render.ts` (BOTH render paths), `tools/show/src/render.ts` + `payload-types.ts` (deliberate copy — re-lift). The circle block is the worked example of all four.
- **`tools/show` render modules are COPIES, not imports** — drift is possible by design; `schema_version` is the gate; atlas's `tests/unit/share-payload.test.ts` is the wire-shape truth.
- **Page writes**: store serializes per-id (#79), the room chain adds compute-ordering for whole-array block patches (#77) — both stay.
- **Don't ship a publish UI affordance for live pages** — `is_live` is post-rebuild; the v1 showcase story is "republish the frozen page".
- **The e2e cost**: full Playwright ~52s; per-bout run only `share.spec.ts` (and `knowledge.spec.ts` if the bridge/known-view changes).

## 6. Reading order on a cold start

1. This file.
2. `SHARING_CONTRACT.md` v0.2 (the agreed shape — short).
3. PROGRESS.md "Session 238" entry (what was built, the pending smoke checklist).
4. `DESIGN_SHARING.md` only if touching design; `SHARING_CF_DELIVERY.md` only if touching delivery/deploy.
