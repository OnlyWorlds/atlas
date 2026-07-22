# Handover — the tour copy pass

**Written**: 2026-07-22 20:15 (S310 close, by Temper) · **For**: a fresh session with Captain
**Mandate**: Captain's copy pass over the guided tour. He has already started.

---

## Where things stand

Atlas is days from launch and in good shape: **typecheck 0 · 1496 vitest · 262 e2e (zero flaky) ·
build clean**, all committed as `opus bout` and **unpushed**. Bouts W/C/D closed in S310. The tour
runs end-to-end on real gestures and has been walked with own eyes twice this week.

**What is left before launch is mostly this copy pass**, plus the og:image pick and the World-green
trade. This is a taste session, not a build session.

## Captain has already edited two steps — do not clobber them

`src/tour/tour-data.ts` is MODIFIED in the working tree (uncommitted). Two edits so far:

1. **Step 1 (`the-sentence`)** — cut "What elements do you see that should have a name in this
   world?", and added an inline request: `'The opening sentence of the novel
   Hyperion[hyperlink pls to wiki page] (1989) by the late Dan Simmons.'`
2. **Step 2 (`the-world`)** — now reads "Atlas treats worlds as folders. Create one for this
   sentence in the top left. We'll call it Hyperion after the novel."

⚠ **`[hyperlink pls to wiki page]` is a placeholder and MUST NOT SHIP.** Resolve or remove it.

⚠ **Do not run backup/restore cycles on this file.** I nearly destroyed edit #2 doing a
`cp`-then-restore revert-check while he was typing. Use `git stash`/`git diff` if you need to
experiment, or better, experiment somewhere else.

## The hyperlink request — answered, needs his call

**Inline is not possible without reworking the renderer.** `tour-bar.ts:402` does
`body.textContent = phase.body` — plain text, deliberately. Same for `meta` (`:468-470`) and each
`deeper` paragraph. Nothing in `src/tour/` ever creates an anchor.

**But the extras row is the designated home for links, with precedent.** `tour-bar.ts:440` carries
this comment verbatim:

> `(The ecosystem-explorer link was CUT in S298, Freek's round. Captain's Hyperion share-page link
> can join this extras row when it exists.)`

So the shape already exists: the row beside "more information" held a link before and is built to
hold one again. **Recommendation**: put the Hyperion wiki link there as a small labelled link on
step 1, rather than teaching the body renderer to parse markup days before launch. Parsing markup in
the narrator would also mean escaping decisions on every other step's copy, which is a bad trade for
one link.

His call, but frame it as "a link in the extras row" vs "not at all", not as inline.

## What copy you can change freely, and what bites back

**FREE — no test asserts narrator prose.** All 26 `body`/`meta`/`deeper` strings can be rewritten
without breaking anything. The e2e asserts `data-tour-phase` attributes and that
`.atlas-tour-body` is *not empty* (`tour.spec.ts:299`), never its text. `tour-data.test.ts` locks
structure and bundle data, never wording.

**BITES BACK — these are asserted by name:**
| Change | Breaks |
|---|---|
| Renaming a **step id** | `tour-step-ids.test.ts` (loudly, by design — see below) |
| Renaming a **bundle element** ("The Consul", "The Hegemony", "Consul of the Hegemony") | `tour.spec.ts:345, 380, 381` |
| Changing **the sentence** itself | `tour.spec.ts:451` asserts the linked prose |
| Changing landing button labels | `tour.spec.ts:513` (`replay the tour`) |
| Adding/removing a **phase** | phase-attribute assertions at `:63, 120, 142, 245, 249, 547` |

**Step ids are now guarded three ways** (added S310, specifically because a copy pass is when ids get
renamed): unique/non-empty/count, the e2e index→id map, and — the important one — a scan of
`src/tour/*.ts` that extracts every `s.id === '...'` lookup **from the source** and asserts it
resolves. That last one exists because S308 shipped a dead gate for three sessions when a step was
merged away and `findIndex` silently returned -1. If you rename a step, the test tells you exactly
which file's gate just died. `tour-bar.ts` holds two such lookups today (`the-swamps`,
`yours-to-keep`).

## Voice law (non-negotiable, this is the whole point of the pass)

- **Zero em-dashes in user-visible copy.** Rulebook: `memory/feedback_voice_no_emdash.md`.
- Calibration source is Captain's own voice file: `Orrery/product/voice/voice.md` — colon as
  connective tissue, plain statements over flourishes, no marketing words.
- Sentence case throughout (convention #30), acronyms preserved.
- **My default register is an AI accent and he reads it as machine.** The em-dash appositive, the
  "X, Y, Z — anything that…" flourish, the statement-then-reassurance rhythm. Expect the red pen;
  do not defend the draft.

## The trap that has already cost a live confusion

**Copy that describes a gesture is a BEHAVIOURAL CLAIM and rots like any other.** S306: the copy said
"hover a dotted word and press Tab", but the handler promotes the decoration containing the
**cursor** — hovering places no cursor, so a user following the sentence exactly could never succeed.
The code was right; the sentence was the bug, and Captain hit it live.

**So: perform every instruction as written, not as intended.** If a line tells the user to do
something, do that exact thing in the app before accepting the line. Related S306 find: the affordance
you need is often already on the page you are writing about (the prose panel had a link-all button
with a live count while the copy was sending people to a right-click menu).

## Suggested shape for the session

1. Read `DESIGN_TOUR.md` (v3.2, and strikingly current per the S309 audit).
2. Run the dev server and **walk the tour**, reading each step as a stranger would. Copy judgements
   made against the running app beat copy judgements made against the source file.
3. Work step by step through `tour-data.ts`; it is one file, 17 steps, 26 copy strings.
4. Resolve the hyperlink placeholder.
5. `npx vitest run` (fast, ~8s) after id-level changes; the full e2e only at the end.

## Open, not for this session

- **og:image** — two 1200×630 candidates in `Notes/ui-snapshots/2026-07-22-s309/`. Captain picks,
  then `public/og.png` + two meta tags in `index.html`.
- **The World-green trade** — `#009a00` failed Skeld's CVD validator; reverted to `#008300`. He
  recommends keeping it and letting icon+label carry World. Record at the bottom of
  `core/element-colors.ts`.
- **`tools/show` still owes a redeploy** (its render.ts is a deliberate copy and has S308 zone fixes
  in it). Deploys are message-first to Boss. **Do not trigger it before the copy pass lands** — it
  would put un-passed tour text in front of users.
- Post-launch runway (icon() migration, dead CSS, sync-engine extraction) is in the S309 stepback.
