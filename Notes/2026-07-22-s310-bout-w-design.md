# Bout W — the narrative delete guarantee (design, pre-build)

**Written**: 2026-07-22 18:40 (S310)
**Status**: DESIGN — to be gated before wiring.

---

## What the banked spec said, and why it was wrong

S309 banked: *"right-click on a writing tree row → Delete with the standard confirm. Investigate the
chain first: what happens to children of a deleted Book/Chapter (propose: children stay, become
top-level in the tree)."*

Two of those three claims do not survive contact with the code.

**1. Writing-room delete ALREADY EXISTS.** The workspace reuses `element-detail-header.ts`, which
carries a trash button (`data-action="delete-element"`, line 147) wired to `onDelete` (line 816).
It already respects `confirm_before_delete` and already navigates back to the writing room rather
than world home when the delete happened there (line 867). The gap is the TREE GESTURE, not delete.

**2. "Children stay, become top-level" is the wrong proposal.** `findDependents` (folder-store-fs.ts:868)
already walks the `parent_narrative` chain BFS and returns every descendant, and `deleteElement`
cascades by default (`cascade = silent ? false : (opts.cascade ?? true)`, line 907). The shipped
comment states the reason and it is correct: orphaned children carry a dangling `parent_narrative`
FK and re-surface as loose roots in the tree. Re-parenting twelve chapters to top level silently is
messier than deleting them, and the dangling FK would push `invalid_link` to keel on the next round.

**Cascade stays. The design question is not what to delete — it is what the user is told before it
happens.**

## The actual finding (the thing worth building)

Deleting a Book from the writing room deletes **every chapter and scene beneath it**, recursively,
plus their pins. There is **no undo anywhere in atlas**. Prose is the highest-value content the tool
holds. Two things are wrong with the guard on that path:

**W1 — the only guard is a user preference that can be switched off.**
`confirm_before_delete` (default true, `registry.ts:593`) is toggleable in Settings → Elements
(`settings-elements.ts:114`). With it off, clicking the trash on a Book destroys the entire
manuscript subtree with **zero confirmation and no undo**. Every other delete in atlas is a single
element; this is the only UI path where one click can destroy an unbounded amount of authored prose.

**The house already has the precedent for exactly this.** `share-room.ts:166-180` forces a confirm
for publish-backed page deletes *"regardless of the confirm_before_delete setting — this is a
public, destructive action"*, and `writing-sidebar.ts:603` forces one for bulk-unlink because
*"disk unlinks in closed narratives have no Ctrl+Z."* Both are the same class: **a delete whose
blast radius exceeds the thing the user clicked has a confirm FLOOR the preference cannot lower.**

**W2 — the confirm does not say what is being destroyed.**
Current text: `Delete "Book One"? This will also remove 15 dependent elements.`
"15 dependent elements" is true and useless. It does not distinguish 15 scenes of finished prose
from 15 pins, and it never uses the world's own tier vocabulary. The user configured these labels;
the confirm should speak them.

Target: `Delete "Book One"? This also deletes 3 chapters and 12 scenes. This cannot be undone.`

## LIVE REPRO — confirmed by run, not by source read (2026-07-22 18:55)

Dev server on 3048, real OPFS folder store, real Playwright clicks. World: `Book > 2 Chapters >
4 Scenes`, plus one narrative free-texted to supertype `Interlude` parented under Chapter One, plus
an unrelated second book. `confirm_before_delete` set to false through the real settings path.

Opened the Book in the writing room. Clicked the header trash ONCE.

```
confirmsFired:            0        (window.confirm spy recorded zero calls)
elementsRemainingOnDisk:  1        (was 9)
survivors:                ["Notes to self [Book]"]
```

**One click, no dialog, eight elements destroyed, no undo.** The Interlude died too — and it was
never visible in the writing tree, so the user could not have known it was there. Screenshot of the
tree before the delete: `Notes/ui-snapshots/2026-07-22-s310/writing-room-book.png` (six rows under
the book, no Interlude among them).

This is the highest-severity finding of the session and it is a pre-launch data-loss path.

## The setting's own words decide the scope of the fix

Settings → Elements reads: **"Ask for confirmation before deleting an element"**
(`settings-elements.ts:73`). Singular. A user who turns that off has opted out of confirming the
deletion of *an element*. Deleting a Book that takes seven other elements with it is not that.

So the floor is **not** an override of the user's preference — it honours the preference's literal
scope. That also settles how wide the fix should be: the floor belongs on ANY cascading delete, not
on narratives specifically. Deleting a map with 50 pins under `confirm_before_delete: false` is the
same class and the same silent loss. One rule, all types; only the SENTENCE is narrative-specific.

## The build

**One rule site.** A pure kernel, store-free and DOM-free, so all three surfaces cannot diverge:

`src/core/narrative-delete.ts`
```
summarizeNarrativeDeletion(all: Element[], targetId: string, labels: WritingLabels)
  -> { descendantIds: string[]; byTier: Record<tier, number>; total: number; sentence: string }
```
- Walks `parent_narrative` with the SAME BFS shape as `findDependents` (cycle-safe via a seen set —
  a malformed folder can contain a parent cycle and neither walker may hang).
- Counts by tier using the world's configured labels, pluralised with the sidebar's existing
  `pluralize` (moved into the kernel; the sidebar imports it back, so one pluraliser, not two).
- Emits the sentence. Non-narrative dependents (pins) keep the generic phrasing they have now.

**Three call sites, one rule:**
1. `element-detail-header.ts onDelete` — replaces the generic `extra` string for narratives.
2. `writing-sidebar.ts openTreeContextMenu` — NEW `Delete` item (the banked gesture), routed
   through the same kernel + the same `store.deleteElement`.
3. The confirm FLOOR: when `total > 0` on a narrative, confirm regardless of the setting.
   Single-narrative deletes (a lone scene, no children) keep honouring the preference — the floor
   is for blast radius, not for narratives as a category.

**Navigation trap the tree gesture introduces (the header path does not have it):** deleting a
subtree from the TREE can destroy the narrative currently open in the workspace, which is addressed
by URL, not by selection state (convention #46 — the URL is the source of truth). If the active
`narrativeId` is in `descendantIds` OR is the target, navigate to `writingHash(worldId)` BEFORE the
delete lands, or the workspace renders a deleted element. The header path always navigates because
the deleted element is always the open one.

## What I am NOT doing

- Not adding undo. Real, wanted, far beyond a pre-launch bout, and it needs a design conversation.
- Not touching the cascade semantics. They are correct and reasoned.
- Not gating single-element deletes harder. The preference exists for a reason and a lone scene is
  an ordinary delete.

## OUTCOME (2026-07-22 close)

Built, gated, and verified live. `core/narrative-delete.ts` (the counting kernel) +
`core/delete-confirm.ts` (the floor rule) + two call sites. 35 unit tests, 5 e2e.

**Post-fix live verification, same world, same gesture:**
```
Delete "The Hegemony Cycle"? This also deletes 2 chapters, 4 scenes and 1 other narrative.
This cannot be undone.
   confirmsFired: 1   (was 0)
   declined -> elementsRemainingOnDisk: 9   (nothing lost)
```
And the tree gesture, accepted, with a scene of the doomed subtree OPEN in a mounted editor:
route moved to `/writing` first, exactly 4 elements removed, siblings untouched.

**The resurrection question, answered from source and then proven:** `persistSnapshot`
(`writing-workspace.ts:334-335`) resolves the narrative from the URL and bails when it is gone, so
navigating BEFORE the delete disarms any pending debounced save. Proven by typing unsaved words into
a scene, deleting its parent chapter immediately, and waiting 3s past the debounce window: the scene
did not come back and the marker text appears nowhere on disk. The ordering in the handler is
load-bearing, and there is now a comment saying so.

**Both halves revert-checked separately** (S307's three-halves lesson): removing the floor -> 4 loud
failures; removing the tier sentence -> 4 loud failures.

## THE GATE LANDED LATE, AND IT WAS RIGHT TWICE

The 3-lens gate returned after I had already shipped and written the report. Two real findings,
both fixed and revert-checked.

**1. HIGH — the cascade bypassed each dependent's write chain.** `deleteElement` serializes on the
TARGET's id (`folder-store-fs.ts:902`), then removed descendants from inside that same slot via a
direct `unlinkElement(dep)`. `PerIdWriteChain` is per-id by design, so a concurrent
`updateElement(childId)` was NOT serialized against that child's deletion: the update reads the
child, yields at its I/O gap, the cascade removes it, and the update's write RECREATES the file and
restores it to `fileIndex`/`bodyCache` while the tombstone is already logged. Next sync round pushes
a DELETE for an element that still exists locally. Permanent divergence, no undo.

**I had noticed this bypass myself while reading the cascade and moved on.** The gate's whole value
here was refusing to let a noticed-and-dropped thread stay dropped. The navigate-first guard I did
build is genuinely sound for the OPEN narrative (the gate confirmed the mechanism with file:line),
but it does nothing for the other children of the subtree, which is a window the writing workspace
opens every time it fires `flushPendingSave()` without awaiting it on a narrative switch.

Fixed in BOTH stores (`folder-store-fs.ts` and `MockFolderStore`, because a fake that cannot express
production's I/O gaps produces confident-wrong tests). Deadlock-guarded on `dep.id === id`.

**The test story is worth recording.** I wrote the behavioural resurrection test first and it PASSED
against the unfixed cascade — a false green. The mock's update has one read→write yield while the
cascade has several before it deletes, so the update's write always lands first; the dangerous
interleaving needs real disk I/O on both sides. I added the tombstone-write yield the fake had been
missing (faithfulness), and it STILL could not fail. So the honest close, per S258: the behavioural
tests lock the observable contract, and a SOURCE SCAN is the actual lock — revert-checked, it fails
2 tests when the chain is removed. Saying the lock is coarse beats claiming a repro I do not have.

**2. MED — the new tree gesture could SOFT-LOCK the tour.** The `the-writing` step reveals a Book and
its Chapter and gates advance on the chip count inside that chapter's story. The writing tree is
fully reachable while touring (no overlay; `.atlas-tour-locked` is deliberately not
`pointer-events:none`), so right-click Delete on the book cascades the chapter away, the gate becomes
permanently unsatisfiable, no Next renders, and `revealOne` only re-creates on step ENTRY so there is
no self-heal. A regression my own bout introduced, on the front door, days from launch. The Delete
item is now suppressed while `isTourFlagActive()`; the reversible link/unlink items stay. Asserted as
a present/absent PAIR and revert-checked (guard removed -> expected 0, received 1).

Also noted and accepted without change: the confirm counts from memory while the delete counts from
disk (a staleness window); 60 tombstones is 60 sequential read-modify-writes with no bulk delete path;
`writing-workspace-recents.ts` never prunes deleted ids from localStorage. All pre-existing, none
launch-blocking, all worth a look post-launch.

## Verification contract

- Kernel units: tier counting, deep chains, cycle safety, empty/leaf case, label pluralisation,
  a Draft (`l4`) nested under a Chapter (the flexible tier is the one that breaks naive counting).
- Revert-check each half separately (S307 law — the three-halves lesson): the floor and the
  sentence are independent, and a partial revert must fail loudly.
- The floor test must assert the confirm fires with the setting OFF — that is the whole point.
- Own-eyes: a real right-click on a real Book row in a real tree, and read the dialog.
