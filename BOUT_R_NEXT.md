# Bout R — Next session pickup

 

## Tier C — Smaller smoke items (in order)

If A + B all green, blow through these:

- [ ] **Path 3** — `+ new api` shortcut sidebar button works
- [ ] **Path 8** — `pull on activate` toggle behavior
- [ ] **Path 9** — auto-refresh cadence (set to 1 min, edit on web, wait, see auto-pull)
- [ ] **Path 10** — stay offline toggle (per-world)
- [ ] **Path 11** — global pause-all
- [ ] **Path 14** — server-side delete review modal auto-opens on pull
- [ ] **Path 15** — unlink from api → flips to local-only, can re-link
- [ ] **Path 16** — test connection button
- [ ] **Path 17** — PIN re-attach on settings edit
- [ ] **Path 18** — bad creds path (inline errors)
- [ ] **Path 19** — settings deep-link via URL hash
- [ ] **Path 20** — reload + auto-activate
- [ ] **Path 21** — multi-world switching

---

## After all of Tier A + B + C pass

Cutover:
1. `git status` in `tools/atlas/` — confirm working tree state
2. `git push --force origin main`
3. Cloudflare Pages auto-redeploys
4. Update `Forge/tools.json` — note 3.5 milestone
5. Update memory `project_atlas.md`
6. Archive `PHASE3.5_BRIEF.md` (add SHIPPED marker at top)
7. Reflect (session-close) and tell Captain

---

## Known-and-accepted (don't smoke for)

- Multi-link changes on web propagate via `updated_at` bump now (Skeld's server fix)
- Pagination beyond first page is logged via console.warn — full pagination is 3.6+
- Per-world conflict policy overrides — only global setting today
- "Last synced X min ago" prominent display — currently only in pill title attribute

---

*Written 2026-05-13, session 201 close (between policy-rewrite and continued smoke).*
