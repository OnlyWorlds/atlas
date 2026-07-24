# Changelog pipeline live test — run together, then clear (S318)

**Written**: 2026-07-24 · The end-to-end proof that the changelog pipeline works, run WITH Captain in-chat as the session's last act (or post-deploy against the real URL). Total time ~3 minutes.

## The test (Temper drives, Captain verifies)

1. **Temper adds a REAL test entry** to `src/changelog/changelog.data.ts`, top of the v1.0 entries:
   ```ts
   {
     id: 'pipeline-test',
     title: 'A test entry, passing through',
     body: 'If you can read this at its own anchor, the pipeline works end to end. It will be gone in a minute.',
     tags: ['test'],
   },
   ```
2. **Temper runs** `npm run changelog` — one command regenerates `changelog.html` + `public/changelog-feed.xml`.
3. **Captain opens** `http://localhost:3045/changelog.html#pipeline-test` (dev serves the regenerated page; the anchor must land highlighted on the test entry). Post-deploy variant: `https://atlas.onlyworlds.com/changelog.html#pipeline-test`.
4. **Captain checks the feed**: `http://localhost:3045/changelog-feed.xml` — the test entry is the newest `<item>` with its permalink guid.
5. **Temper clears**: delete the entry from the data file, `npm run changelog` again, confirm the anchor 404s-to-top and the item is gone from the feed. `git diff` shows the data file byte-identical to before.

## Why this shape

The data file is the ONLY edit surface; everything else is derived. If step 3+4 pass, every future entry works the same way — write the entry in the same commit as the fix, and the build does the rest. Nothing in the test touches the app bundle.

## Standing facts (verified S318)

- `npm run build` and `npm run dev` both regenerate page + feed (`predev`/prebuild hook) — a stale page cannot ship.
- Entry ids are global permalinks; a duplicate id FAILS THE BUILD naming both versions.
- The uniqueness guard + render + feed are unit-locked (`changelog-render.test.ts`, 10 tests, including "the seed data is exactly one launch-dated v1.0 release").
- The feed item shape (title / permalink guid / description / category / release-day pubDate) is the shape Skeld's ecosystem what's-new feed will interleave.
- `/changelog` pretty URL (no `.html`) = Boss's `_redirects`, post-launch, banked.
