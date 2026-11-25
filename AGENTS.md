# Working in this repository

## What this repository is

Atlas, a browser app for OnlyWorlds worlds: it opens a world folder on your computer or in browser storage, edits every element, draws maps, and syncs with an onlyworlds.com account when one is linked. TypeScript and Vite, no UI framework; `npm run build` writes the static site to `dist/`, which is served at https://atlas.onlyworlds.com. No workflow here deploys it: a merge to `master` is not a release. Read `README.md` first, then `DESIGN.md` (the index of the design docs) and `DESIGN_LAWS.md` (the numbered conventions new code keeps).

## Set up and run the gates

CI uses Node 22. Run every command from the repository root in a POSIX shell (Git Bash on Windows); `npm ci` and the browser install need the network. Work in a full clone (`git clone https://github.com/OnlyWorlds/atlas.git`; a clone made with `--depth` is shallow, and `git fetch --unshallow` mends it) and `git fetch origin` first: the commit check reads history. From a fork, add this repository as a second remote and read its `master` wherever this file says `origin/master`. Before you call a change done, run these in this order (the `unit`, `commits` and `e2e` jobs):

```bash
npm ci
npx tsc --noEmit -p .                                # the typecheck; prints nothing when clean
npx vitest run                                       # unit and integration suites, a few minutes
node .github/commit-words.mjs origin/master..HEAD    # your commit messages
npx playwright install chromium firefox              # once per machine
npx playwright test --workers=1                      # the end-to-end suite, about 20 minutes
```

Every change runs all six, the whole end-to-end suite included, once before you open the pull request. A change only to `*.md` files needs the typecheck, `npx vitest run tests/unit/docs-paths.test.ts` and the commit check.

Never `npm test` or `npm run test`: bare `vitest` watches and never exits. `npm run typecheck` runs the same typecheck as the line above; neither covers `tests/e2e/` (`tsconfig.json` leaves it out). Vitest does not typecheck, so run the typecheck before you trust a new test. The unit run skips two tests on purpose (`it.skip` in `tests/integration/sync-held-files/`); a skip is not yours to turn on. A timing test such as `tests/unit/ow-links-perf.test.ts` can fail on a busy machine: run its file alone once (`npx vitest run tests/unit/ow-links-perf.test.ts`) before you call it red.

The end-to-end suite starts `npm run dev` on port 3045 itself, or reuses a server already answering there, so keep 3045 for it (`netstat -ano | grep :3045` shows what holds it). Always pass `--workers=1`: short of memory, the config's four workers die, and the run reads clean until its summary. A `flaky` line (failed, then passed on retry) is a pass; only `failed` is red. Read the command's exit code, never a grep of its output; its last line is the count, such as `4 passed (23.5s)`. While you work, run only the spec you touched (`npx playwright test tests/e2e/demo.spec.ts --workers=1`, with your file's name). CI adds reporter and trace flags; you need neither.

`master` requires two checks: `unit` (`.github/workflows/unit.yml`: `npm ci`, the typecheck, `npx vitest run`) and `commits` (`.github/workflows/commit-words.yml`: `node .github/commit-words.mjs` over the commits each push or pull request adds). Two more jobs run on every pull request, a fork's included; they are not required but must be green. `e2e` (`.github/workflows/e2e.yml`) runs the suite above in Chromium and Firefox, then `npm run build` and `node scripts/check-update-banner.mjs dist chromium` (and `firefox`), a check of the update banner on a production build. `windows` (`.github/workflows/desktop.yml`) builds a desktop app of Atlas on Windows from a `desktop/` folder, which does not exist yet; until it does, the job passes with nothing to build.

To look at the app yourself, `npm run dev` serves it at http://localhost:3045. While the end-to-end suite runs, or when 3045 is taken, use another port: `npm run dev -- --port 3046`. Stop every server you start (Ctrl+C in its terminal, or by its process id; never by a program's name).

`npm run dev` and `npm run build` first run `npm run changelog`, which rewrites `changelog.html` and `public/changelog-feed.xml`; git ignores both. If `git status` shows a tracked file you did not mean to change after any command here, do not commit it: restore it with `git restore <file>` and say so in your pull request.

## How a change reaches master

Make a branch from `origin/master` (any name), commit as you go, push it, and open a pull request against `master`. `master` takes a commit only when `unit` and `commits` passed on it, with no bypass, and it refuses a force-push or its own deletion, so a direct push is refused. A maintainer merges; you never merge your own pull request. Never push to `master`. Never create or push a tag. Never edit anything under `.github/`: the workflows, and `.github/commit-words.mjs`, which you run but never change. Never change `version` in `package.json`, or a release's `version`, `date` or `theme` in `src/changelog/changelog.data.ts`, unless the job says so (`tests/unit/app-version.test.ts` holds the two together).

A change a person using Atlas would notice (a word, a screen, a behaviour, a fix) gets a changelog entry. The maintainers place entries in releases, so unless the job says otherwise, write yours in the pull request's description in the shape of an entry in `src/changelog/changelog.data.ts` (an `id` slug, a `title`, a `body` of one or two plain sentences, its `tags`), not in the file. `CHANGELOG.md` is the pre-launch log: leave it alone.

## What must not be hand-edited

- `changelog.html` and `public/changelog-feed.xml`: written by `npm run changelog` from `src/changelog/changelog.data.ts`. `dist/`: written by `npm run build`. None is tracked.
- `package-lock.json`: moves only with a dependency change, which is a stop. `npm ci` installs from it and never rewrites it. The `@onlyworlds/sdk` version in `package.json` is an exact pin: also a stop.
- The ratchet baselines (a count per file that may only fall): `tests/unit/raw-error-baseline.json`, `tests/unit/view-only-baseline.json` and `tests/unit/folder-words-baseline.json`. The comment at the top of each guarding test (`tests/unit/no-raw-error-in-copy.test.ts`, `tests/unit/view-only-ratchet.test.ts`, `tests/unit/folder-words-census.test.ts`) names its switch; set it to 1, for example `UPDATE_RAW_ERROR_BASELINE=1 npx vitest run tests/unit/no-raw-error-in-copy.test.ts`, then read the JSON diff. A count your change lowered may be written back that way. A count that would rise, or a new file in a baseline, is a stop.
- `tests/fixtures/*.fixture.json`: copied whole from the profiles of https://github.com/OnlyWorlds/schema-dist; the test that reads each names the release it came from. `tests/fixtures/folder-conformance/`: the folder format's shared conformance fixture, read byte for byte (its `README.md`). Never edit either; a new copy is a stop.
- The numbers in `DESIGN_LAWS.md`: code, tests and docs cite them, and a number never changes.

Text files are LF (`.gitattributes`): keep LF on Windows too. `tests/unit/docs-paths.test.ts` reads every `*.md` at the root, this file included, and fails on a backticked `src/` or `tests/` path that does not exist.

## Words

Everything in this repository is public, commit messages included. Copy a person reads is plain statements in sentence case, with no em dashes (`tests/unit/no-emdash-in-copy.test.ts` checks the strings in `src/`) and no marketing words ("seamless", "powerful", "effortless"). A caught error's own text never reaches the screen: word it with `showProblem(err, { doing })` from `src/ui/problem-fixes.ts`, or throw a `PlainError` (`src/core/plain-error.ts`) whose message is written for a person; never `err.message` or `String(err)` in a toast or on the page (`tests/unit/no-raw-error-in-copy.test.ts` counts these).

A commit message says what the change does and why. It names no person inside the project, no private repository, no internal ticket and no path on your machine. `node .github/commit-words.mjs origin/master..HEAD` checks your commits as the `commits` job does; exit 1 is a finding, exit 2 means it could not read the history (a shallow clone), and neither is a pass. No check here reads the words in files.

## Where to stop and ask

Stop, do not guess, when the job would need any of these: a change to a file named under "What must not be hand-edited"; a new dependency (in `dependencies` or `devDependencies`) or a changed pin; a change to public behaviour the job did not name; a convention in `DESIGN_LAWS.md` the change would break; a failing gate you cannot explain, a test your change did not touch included, and one that also fails on `origin/master` (it is not yours to fix); two readings of the job that give different code. Write one question as a comment on your pull request (with no pull request yet, in a file `ASK.md` at the root of your branch, committed). Push your branch as it stands, then end your turn.

## What a finished pull request says

What changed, and why; each gate you ran, with the last line of its output (the typecheck prints none: say so); what you did not run, and why; the changelog entry, or "No changelog entry: nothing a person would notice"; and a list headed "Looked wrong, left alone" of anything outside the job that seemed wrong.
