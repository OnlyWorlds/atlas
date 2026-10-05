# Atlas — Progress Log

Operational state. Architecture: **DESIGN.md** is the index (since S366), with the conventions in `DESIGN_LAWS.md`, the folder in `DESIGN_FOLDER.md`, sync in `DESIGN_SYNC.md`, the shell in `DESIGN_SHELL.md`, fields in `ATLAS_FIELDS.md`; per-room design in `DESIGN_{MAPS,ZONES,WRITING,KNOWLEDGE,SHARING,HOME,IMPORT,CHARTS,TOUR}.md`; the doc-system map lives in **README.md** ("Notes decide, DESIGN docs hold"). Sync lessons in **SYNC_NOTES.md**. Sharing contracts: **`SHARING_CONTRACT.md`** + **`SHARING_CF_DELIVERY.md`**. Superseded docs live in `docs-archive/` (incl. session history `PROGRESS-history.md`).

---

## CURRENT STATE (2026-10-05, SESSION 377: **1.17 SESSION D DONE: every fix the S376 claim-taking ordered, each red first and revert-checked, plus a one-lens gate on D2 and its three fixes**; gates on the final code: typecheck 0 + **2600 vitest** (272 files, 2 skipped, exit 0) + **415 e2e (chromium 404 + firefox 10 + firefox-private 1, each = its `--list`, PLAYWRIGHT_EXIT=0, zero flaky)**; package still 1.16.0, no changelog yet; S377 UNCOMMITTED, S370-S376 committed LOCALLY, nothing pushed: 1.17 waits on Session E and the Captain's smoke)

**Records**: handover `Forge/Notes/2026-10-05-s377-handover.md` (what each D row changed, file by file; the D2 gate's findings; the banked list; the traps); the D2 gate's report is in that handover (the lens returned it as text); the S376 gate and claim-taking note stand as the source of every row.

- **Built**: D1 the keep (A1 'finished' = no journal and no bundle id left, K2 undone only by its own call; A2 K4 stops on a lost save, and the browser delete says when its list did not save; A7 K0 opens with `quietRekey`; C11). D2 the reconciliation (B1: owner read from storage inside the lock, deltas applied to the live registry with storage folded in, every make behind the `reconciled` gate with a 15 s backstop). D3 the probe (B2: `SecurityError` only, a name per probe, one retry, uncached otherwise). D4 the folder door (B3: `clearedOwnTwin` shared with the file door, `review_first_sync` on a linked twin). D5 B4, B10, B6, C21, A9. D6 the false copy: C2, C3, C4, C6, C13, C15, C16. **d-k7 built as my lean** (the Firefox line toasted at the five doors with no dialog), d-1000 left unbuilt, d-title/d-tag/d-changelog untouched: his walk page had no marks at S377's start.
- **The D2 gate** (one opus lens): B1 UPHELD in all three scenarios; F1/F2 (a save landing before its storage event) and F3 (a hung `hydrateAtlasRoot` holding every make) fixed with red tests; a clearedOwnTwin ordering note and a contract drift banked.
- **Banked for 1.18**: B5 (shared-mode locks), the two D2 gate notes, and the S376 banked set (A3, A4 + A6, A5, A8, B7, B8, B9, C12, C14). Reasons in the handover.
- **Deck**: #42 waits on his five rulings, #21 open until live, #38 waits on Kael.
- ⚡ **NEXT**: **Session E, the release**: `Forge/Notes/2026-10-05-s377-handover.md` "Front door" (his marks first; the changelog, 1.17.0, the card; full suites; commit on his word; his smoke on the walk page; fixes; push; Boss in h11). Then **Session F**, the copy session (item #23).
---

Earlier session entries (S253 to S376, newest first, moved verbatim 2026-10-05, with the July `BANKED / TODO` standing queue that sat among them) are at the bottom of `docs-archive/PROGRESS-history.md`.
