# Hyperion (Simmons) — what the SOURCE TEXT actually says about time

**Written**: 2026-07-21 (S306). **Method**: five agents over the full novel
(`Forge/hyperion.txt`, ~19,000 lines) — four reading quarters, one running
targeted searches across the whole. Every claim below carries a line number.
The keeper verified the load-bearing one (L307) by reading it directly.

**Why this exists**: the demo world invents its dates (events at year 7, the
Consul's title granted at 3, Rachmaninov at -320). Captain asked whether the
book gives us real ones before we lock the chart approach. It mostly does not —
and the shape of that "not" is the useful finding.

---

## 1. The headline: the book is a RELATIVE-TIME novel

Across ~19,000 lines there are **five** absolute year references. Five. Against
dozens upon dozens of elapsed-duration expressions. The book's native units are:

- **standard years / months / weeks** (subjective, traveller-side)
- **local days** (Hyperion runs a **26-hour day**, L1670)
- **time-debt** — the relativistic gap between shipboard time and Web time,
  which is the book's real narrative currency ("the round trip would have cost
  us eleven years' worth of friends and family. The time-debt was
  irrevocable." L17129)

Absolute years are rare enough to be almost incidental, and the one passage
that stacks them up is written as bureaucratic clutter, half-mocking.

**This is the finding that should drive the chart design.** Simmons dates almost
nothing absolutely; he expresses *depth* and *duration*. Captain's instinct
("can we GUESS how long ago?") is the book's own idiom.

## 2. Every absolute date in the novel

| Line | Quote | What it dates |
|---|---|---|
| L1130 | "By the monastic calendar on Pacem, it is the seventeenth day of Thomas-month in the **Year of Our Lord 2732**. By Hegemony Standard, it is October 12, **589 P.C.** By Hyperion reckoning... the twenty-third day of Lycius (the last of their seven forty-day months), either **426 A.D.C.** (after dropship crash!) or the **hundred and twenty-eighth year of the reign of Sad King Billy**" | Duré's journal, Day 1. THE Rosetta stone — four calendars on one day |
| L9069 | "year **457 of the Hegira**, **AD 2739** old reckoning" | Rachel's recording |
| L9969 | "this is the year **AD 2711**" | a reporter, to Sol |
| L4361 | "AD 1415" | Agincourt — a *simulation*, not diegetic present |
| L12742 | "Born in **A D 1795**. Died of tuberculosis in **1821**. John Keats." | the cybrid's Old Earth template |

**Derivable epochs** (arithmetic, flagged as inference not quotation):
- AD 2732 = 589 P.C. → **P.C. year 0 ≈ AD 2143**
- AD 2739 = Hegira 457 → **Hegira year 0 ≈ AD 2282**

⚠ **Handle with care.** The grep sweep's own warning: do not conflate 2732
(Duré, a different character and period) with 2711/2739 (the pilgrimage's
timeframe) — same numbering scheme, different moments. And **"P.C." appears
exactly ONCE in the entire novel** (L1130). Our bundle's era vocabulary
currently leans on "PC" as though it were common usage; it is a single line.

## 3. The Consul

- **Eleven years as Consul on Hyperion** — L327 ("During his eleven years as
  Consul on that distant and enigmatic world...") and independently L3823 ("In
  the eleven years the Consul had worked with Theo Lane..."). Two witnesses.
- **Career ladder**, L18321: "Within five standard years I was an Under Consul.
  Within eight, a Consul in my own right."
- Left Hyperion **eight local years** before the pilgrimage present (L3641).
- Earlier posting on Hebron "almost four standard decades earlier" (L426).
- **He is Siri and Merin's grandson** (L18263-18271), from Maui-Covenant — the
  Consul's Tale is his family's story. Rich, unused material.
- No numeric age is ever given.

**So the title's span has a real, sourced duration: eleven years.** That is a
better number than our invented grant-at-3, and it answers Captain's "how do we
know?" with a citation instead of a shrug.

## 4. The Steinway and the Rachmaninov

- **Rachmaninov is named exactly ONCE in the whole novel** — the opening
  sentence itself (L219). No provenance, no date, never mentioned again. So our
  deep-time beat placing him at -320 is pure invention, and the book offers
  nothing to replace it with. (If we wanted a canon-derived number: Rachmaninov
  born AD 1873 → **P.C. -270** via the L1130 epoch. Inference, not text.)
- **The Steinway is "Pre-Hegira"** (L3448, the Consul answering Kassad) — the
  only hard datum on it, meaning older than the exodus from Old Earth.
- **Its provenance IS in the book** (L18405): "The Hegemony provided me with a
  private spacecraft. I asked for only one modification: the addition of an
  antique Steinway piano." The piano is his request.
- Lovely bookend worth knowing: the novel CLOSES mirroring its opening — "I
  played a **Bach** Prelude on the Steinway, buttoned up the ship, and rose into
  space" (L18517).

## 5. ⚠ THE OPENING SCENE IS NOT ON HYPERION

**Keeper-verified by reading L307 directly** (this contradicts an earlier
agent conclusion of Captain's, so it was checked by hand rather than trusted):

> "The Consul was suddenly very aware that he was, at that second, the only
> sentient being on an **unnamed world**. He listened to the antediluvian night
> sounds rising from the swamps and he thought about morning... solitude he had
> earned through the pain and nightmare he had **already suffered on Hyperion**."

Past tense, elsewhere. He is on an unnamed world remembering Hyperion, and the
prologue ends with his ship rising to rendezvous; he then wakes from cryo-fugue
with the Templar saying the Tree is "five hours of travel from Hyperion" (L350).

The charitable reading — that "unnamed" meant he had not yet learned the name —
does not survive: he was Hegemony Consul there for eleven years.

**Consequence for the demo world**: our bundle fuses the balcony, the swamps,
the saurians and the Hyperion map into one place called Hyperion. That is a
deliberate teaching simplification, not the source. **Captain's call (S306): to
be solved next session with the unnamed world.** Record it in `_bake_notes`
either way so nobody rediscovers it as a bug.

## 6. Hyperion's calendar is SPECIFIED, and we could bake it

From L1130 + L1670 + L3292:
- **seven months of forty days** each = a 280-day year
- at least one month name: **Lycius** (the last)
- a **26-hour local day**
- local era **A.D.C.** — "after dropship crash" — at 426
- a parallel regnal count: the reign of Sad King Billy (year 128)

That is a real, multi-era calendar with named months, and it is *exactly* the
shape `atlas_calendar` already supports. If we want the demo's calendar to be
canon rather than invented, this is the structure.

## 7. Other durable numbers, if wanted

- the human colony on Hyperion: **~400 years** old (L624, L1158, L2176, and
  L15846 "Since Hyperion was explored four centuries ago")
- the labyrinths: **~750,000 standard years** (L2760-2768)
- the Ousters fled Old Earth **four and a half centuries** ago (L18425)
- Old Earth's destruction: **"The Big Mistake of '38"** (L18429) — no era prefix
- Chronos Keep: Shrike Church has held it **two centuries** (L16389)

---

## What I'd propose for the chart (for Captain's decision)

**Lean: stay relative, and use the one real duration we found.**

1. **Give the Consul's title its canon span — eleven years.** Sourced twice.
   Replaces the invented grant-at-3 and makes the open-end lesson (grant → now,
   fade cap) rest on a fact.
2. **Leave the events where they are.** They carry the "two things at one
   moment" lesson; the book gives no date for the opening scene at all (the
   grep sweep confirms: no line dates the balcony scene).
3. **Don't chase absolute P.C. numbers.** "P.C." is one line; 589 would make the
   demo's axis read 589 where it now reads single digits, for no teaching gain,
   on the thinnest possible evidence.
4. **Deep time stays a choice, and should say so.** Rachmaninov appears once,
   undated. If we want a defensible number, AD 1873 → P.C. -270 is derivable —
   but it asserts an Earth↔P.C. conversion, which Captain ruled against in S305.
   That ruling was made without knowing L1130 exists, so it is now his to
   revisit with evidence rather than a constraint I should quietly route around.
5. **The richest unbuilt idea**: the book's own unit is *elapsed duration*. A
   chart that can say "eleven years before now" without an absolute date is
   truer to this fiction than one that numbers every axis tick — and it is
   Captain's "can we guess how long ago" instinct, arriving from the source.
