# S299 progressive-precision audit — per-stage chrome table

**Written**: 2026-07-20 ~09:15 (autonomous run, bout C)
**Method**: scripted 17-step walk collecting visible chrome per step (rooms nav, right tabs, filter strip, map toolbar, sidebar buttons, detail sections), plus own-eyes screenshots. Raw data reproducible via the walk script in the session log.

## Applied this session (named in the S298 handover, so treated as blessed)

| Chrome | Was | Now |
|---|---|---|
| Map toolbar zone buttons (draw polygon, draw line, show/hide zones, zones-dropdown) | visible from step 8 (the map), two steps before zones are taught | hidden until step 10 (the swamps) via `body.atlas-tour-prezone` |
| Right-pane **Web** tab | visible from step 7 (act 2 opens the right pane), taught at step 15 | hidden until step 15 (where-it-lives) via `body.atlas-tour-preweb` |
| Empty element sections | all schema sections rendered (consul page: 6+ sections, mostly empty) | all-empty sections HIDDEN during tour (first section kept if nothing populated) |

Note for the copy pass: the 'linking' step's more-information text mentions the Web tab as a forward promise; the tab is now genuinely absent until step 15. Reads fine to me (it is phrased as a promise), but your call whether to soften.

## Proposed, wants your bless (not applied)

| # | Chrome | Observation | Proposal | Lean |
|---|---|---|---|---|
| 1 | Sidebar filter strip | All ~20 type icons visible from step 2, when the world holds 1-2 types | During tour only: show icons for types with count > 0 (the strip grows as the world does — matches the reveal grammar) | Do it: it is the same progressive logic as the rest, and the strip growing per step is a quiet payoff |
| 2 | "Custom fields" section | Renders (with its add-row) on every element page during the tour | Hide the whole section during tour — a beginner's first pages should not offer schema extension | Do it |
| 3 | Sidebar header buttons | All 20+ create/type icons live from stage 2 (only create-element is scripted during the consul beat) | Leave as-is: the stage-1 greyed-siblings pattern already made the "full landscape, dimmed capabilities" call, and re-staging the elements header contradicts it | Leave |
| 4 | Rooms nav at stage 6 | knowledge / share / import appear at the sweep though never taught | Leave: "the rest arrives at once" is the sweep's own copy | Leave |
| 5 | Map toolbar "Open this map element" | Visible from step 8; harmless, but it exits the railroad into the map element page | Leave (Back recovers; hiding it makes the toolbar feel thinner than the real app for no teaching win) | Leave |

Say the word on 1-2 and they land in minutes; both are CSS + one small render hook in the existing prezone/preweb pattern.
