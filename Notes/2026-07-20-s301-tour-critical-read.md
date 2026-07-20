# Tour — critical read before Captain's dump

**Written**: 2026-07-20 ~17:20 (S301 open)
**Method**: full 17-step walk at 1440×900 + 1366×768, own eyes, measured (no reasoning from docs).
**Snapshots**: `Notes/ui-snapshots/2026-07-20/s301-tour-audit/`
**Status**: positions only. Nothing built. Everything below is mine to be argued with.

---

## The measured spine (holds on EVERY step)

| what | number |
|---|---|
| dock height | 290px, every step (the constant holds) |
| empty slack inside the dock (body bottom → controls top) | **93-110px** on all 17 steps |
| right pane covered by the dock | **172px** horizontally, every step |
| dock share of a 1366×768 laptop screen | **38%** |
| empty stage above the dock at step 1 | 594px of black |

The 290px was set by the three longest bodies. Every other step pays for them with ~100px of visible void. This is Captain's "dead space at step 6" — measured, it is not step 6, it is **all of them**.

---

## The five design positions (ranked, most confident first)

### 1. The sentence ribbon ends UGLIER than it starts — kill the underline
**Evidence**: `01-step1.png` (bright, clean, elegant) vs `17-finale.png` (a wall of underlined fragments).

Every parsed word carries: type color + a lit glyph + **an underline**. By the finale nearly all 30 words are underlined, and the colors are too dim to separate. The moment meant to be the payoff ("look what one sentence became") is the sentence's worst-looking state.

**Position**: the underline is redundant — colour and the lit glyph already say "this word became an element". Drop the underline from parsed words entirely; reserve a wash/underline for the ACTIVE step's words only. The ribbon then gets richer and calmer as it fills, which is the intended emotional curve.

### 2. The writing step shows the same sentence twice, in two visual languages
**Evidence**: `11-writing.png` — the prose (sans, cyan uniform chips) and the ribbon (serif italic, type-coloured) render the identical 30 words ~450px apart.

Two grammars for the same content, competing at the exact moment the doc is supposed to be the star. Worse: the doc's chips are all one cyan while the ribbon insists type colour is the language.

**Position**: on this step the ribbon should yield — collapse it to a single quiet line, or hide it entirely and let the body carry the beat. This is the S297 law (a presence problem is a competition problem) pointed at our own component.

### 3. The charts step promises what the default view discards
**Evidence**: `13-chart.png`. Body says "the two events sit at years 7 and 12. Zoom out and the world's whole span appears, with a gold line marking the now: year 15." On screen: two dots on a large black field, **no gold now-line visible**, and the work-queue rail ("UNDATED 15 — drag onto the timeline to date it") occupying the biggest share of the room.

For a beginner the rail reads as a chore list, and the copy describes a state they never see. This is the S251 class again: the problem is not what the chart draws, it is what the default window throws away.

**Position** (for the redesign convo you're holding): the tour's chart step should land on a **pre-framed chart** — window set so both events AND the now-line are in view — with the rail hidden for the duration of the tour, exactly like the filter strip and Custom fields got hidden in S300. The step teaches "your world on time", not "here are 15 chores".

### 4. The dock should dodge, not just shrink
**Evidence**: `09-pin-step.png` (the dock covers the bottom-left of the map the user is told to click), `05-consul-page.png` (the Consul's fields run underneath it), `11-writing.png` (orphaned "1"s from the Cast list peek out beside the dock's edge — visible breakage).

172px of the right pane is covered on every step. On the pin beat the instruction is "click the map" while the narrator sits on part of the map.

**Position**: dodge is worth more than height reduction, and it is cheap on map/right-pane steps: when the subject is the right pane, the dock narrows to the middle pane's width instead of the full 960. Pair it with dropping the fixed height to a per-step natural height once your copy pass evens the bodies (the 100px slack goes away on its own).

### 5. Hands-on steps keep their instruction copy after the deed is done
**Evidence**: `05-consul-page.png` — the Consul exists, the button has become Next, and the body still reads "create him and he becomes your first element."

**Position**: hands-on steps want a second body line for the done state (a payoff sentence, not an instruction). Small, and it lands right in your copy pass — worth deciding the pattern before you write 17 bodies.

---

## One real bug found (not a design question)

**The residue contract leaks two keys.** After exit/finish the OPFS folder and registry entry are gone (verified), but `atlas_right_tabs` retains the tour's map tab (mapId + worldId) and `atlas_map_camera_state` retains its camera entry.

Consequence: the first world a real user sets up **opens with a ghost "Hyperion" tab** in the right pane which, clicked, reads "This map isn't in the current world / It may have been deleted, or you switched worlds while it was open." That is the first minute of real use, immediately after a tour that promised to leave nothing behind.

Fix shape: teardown prunes right-tab entries whose `worldId` is the tour world, plus its camera-state keys. One place, e2e-lockable. DESIGN_TOUR's residue clause needs the two keys named — the contract enumerates registry/handle/OPFS only, which is exactly why they were missed.

---

## Smaller flags (copy-pass adjacent)

- Create-world modal title reads **"Create local world"** during the tour — "local" is jargon the user has not been taught yet (step 1 of anything).
- The consul modal's readonly name renders with the **OS blue selection highlight**, which reads as editable and clashes with the palette.
- The finale offers **two forward buttons** (Finish | Set up a folder) — the same fork shape that was deliberately cut from the create beats in S298. Worth a consistency call.
- The finale inherits the previous step's route (the Consul's page + Web tab). The last beat of the tour is the one screen not composed on purpose.
- Landing: the whole composition sits high — ~220px of dead space below the doors at 1440×900.

---

## What I did NOT touch
No code changed. Dev server on 3046 is up. The S300 batch remains uncommitted and green (1297 vitest / 240 e2e).
