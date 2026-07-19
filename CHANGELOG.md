# Changelog

## Unreleased

- Selecting text in a page's text block now raises a small toolbar: bold, italic, and a link button that connects the selection to any existing element. Bold and italic always worked from the keyboard (Ctrl+B, Ctrl+I); now they are visible, and they render on the published page too.
- Link any words to any element: right-click a selection (in page text blocks AND the writing room) and choose "Link to existing element". The words you selected stay exactly as written; they become a chip pointing where you chose, and atlas remembers them as an alias of that element so future mentions auto-link too.
- A map block on a page follows the world live now: move a pin on the map and the block shows the new position immediately, no re-adding the block needed. (Published pages update on republish, as before.)
- A sync error class fixed: elements pulled from onlyworlds.com could carry a server bookkeeping field that the server then rejected back, leaving the element stuck at "couldn't sync pending change" forever. Those stuck elements clear on their next sync round.
- The first screen carries the animated OnlyWorlds mark at full size, with more air between everything.
- The tour's narrator starts docked at the bottom of the bare page and stays there: the workspace builds up above it from the first Next. No more large centered opener.
- The tour's two create steps have one route now: the create dialog itself. The quiet Next beside them read as a fork; every other step keeps watch-mode Next.
- The tour's narrator panel holds one exact shape through all 18 steps: no more small resizes between steps with and without the deeper widget or longer copy.
- A hands-on tour step's sentence icon now lights when you create the element, not when the step opens.

- The guided tour: one famous sentence becomes a small linked world, and atlas builds itself around it. From a bare page you create the world, then its first character through the real dialogs, and the workspace appears piece by piece as each room earns its place: elements and links, a map with a pin and a zone, the sentence itself as a chapter full of live chips, two dated events on a chart, and finally the whole thing at once. The sentence rides along the bottom the entire time, coloring in as you go: each parsed word takes its element type's color and a small icon lights up in place.
- The tour needs nothing from you: no folder, no account, nothing touches your files. It runs in browser storage and folds away completely when it ends, and every hands-on step also works as watch mode: press Next and the tour performs the step for you. Replay it anytime from settings.
- The first screen slimmed down to match: two doors on a bare page, take the tour or set up a folder. After a finished tour the folder door takes the lead.
- Safari and Firefox can take the tour now: atlas boots in browsers without folder support and says honestly which parts need Chrome or Brave.
- PIN fields show dots while you type, in every dialog that asks for one.

- Big worlds open fast: a 1,500-element world that took ~18 seconds on first open now lands in about 3, and switching between worlds or saving edits no longer re-reads every file from disk (those dropped from seconds to instant). While a large world opens, the loading message counts: "Opening world… 600 / 1,500".
- Linking a large OnlyWorlds world downloads noticeably faster: the element types fetch in parallel and each page carries more elements per request.
- Routine autosaves stopped paying an extra server round-trip for world settings that had not changed.
- The charts controls swapped their right corner: the view toggle sits on top, the now chip under it.
- Link previews: sharing the atlas address now shows a proper title and description instead of a bare link.
- Switching back to a world you had open is instant now: atlas keeps recently visited worlds warm instead of re-reading their folders (another tab taking a world over is still detected, and the fresh read happens then).
- Open an existing world folder from anywhere on your disk: a new sidebar button registers a folder that already contains a world, in place. No copying, no downloading. A world copied from another machine, exported from Obsidian, or synced through Dropbox opens directly.
- Structured data written by other tools (battle records, sidecar configs) now shows as a read-only block on the element page instead of an editable "[object Object]" row that could destroy it with one save. You can still remove such a field deliberately.
- Battles recorded from Tactical Tangle render as real battle cards on their Event page: the sides with their fallen, every unit's numbers and fate, and the seed that can retell the same battle. The tropaion Object shows where the battle turned. Elements recorded from play carry a small swords mark in the sidebar.

- The charts room gained a document view: a toggle beside the calendar chip turns the chart into a scrolling page of your history. Down is later; era names section the document; long silences read as "132 years pass" instead of empty distance; the now is a gold seam you scroll across; a corner readout tracks the date under your eye. Click a card to expand it with its links and actions. A chart saved in document view reopens in document view, and shares as the same static chart block as before.
- The season wash settled at half its prototype strength: the lowest level where the months still read.
- The chart view toggle holds its place at the right end of the controls instead of drifting with the type chips.
- Creating a knowledge entry no longer pulls you back into it when you navigate away in the moment after clicking create.

- Calendars arrived in the charts room: name your world's time and every date surface speaks it. Set the world clock once (what one step of time means), then build a calendar: eras, months, weeks, festival days, and how a date reads, with a live preview formatting your own dates as you type. A date like "12 Frostwane, Year 454 FT" now works everywhere a number did: axis labels, the now, cards, drag guides, and typed date entry with a quiet "resolves to" hint before you commit. Bare numbers keep working forever.
- A calendar is a real element of your world: a Construct with its own lore fields (founder, history), so it syncs, exports, and can sit on the charts it labels. Several calendars can name the same history; switch the lens and every label changes while nothing moves.
- The chart grid follows your calendar: ticks land on real year and month boundaries with round years ("450 KR", never a raw step number), era bands shade the chart and the overview strip under their names, months wash the background in season colors, and festival days glint gold.
- Zoom reaches the days now: a fifty-year world used to stop zooming around a three-month window; it now goes down to single days ("11 Greening 454").
- Worlds carrying the old time format fields get a one-time offer to mint their first calendar from them: the step word carries over, the word lists move into the calendar's description, and the old fields clear so no other device re-offers forever.
- Published charts speak their calendar: chart blocks bake the formatted dates and axis labels in at publish time, so a viewer reads "454 FT" with no calendar machinery. The numbers underneath stay untouched.
- Calendar constructs no longer sit in the undated work list: a calendar is complete without an adoption date (you can still date one from its element page).
- Link every mention at once: while writing, a quiet link icon in the corner counts the element names in your prose that aren't linked yet - one click links them all, one Ctrl+Z takes it back. Selecting text and right-clicking offers the same for just that selection (unlinking too), and right-clicking a book or chapter in the writing tree links mentions across every scene inside it.
- Two people can know a secret: adding a second knower to a knowledge entry now offers to make the pair a circle (named after both, editable) instead of stopping at one. The circle affordances read "existing circle" and "new circle".
- Clicking a map on the home page works: an open map tab comes forward, a new one opens, and a map without an image says so and takes you to its fields instead of doing nothing. Same fix for the Map card in the world tour.
- The tour cards found their taglines: Chart "elements in time", Map "ground your world", Share "a page of your world", Export "your entire world".
- The protagonist and home cards on the home page dropped their filler line; clicking one now says exactly what to do next ("click in the left sidebar").
- Saved charts name themselves after their members ("Gale, Alpha +1") instead of "Selection (4)".
- The element picker keeps one size while you flip categories instead of shrinking under the cursor.
- Ranges stretch from both ends: drag a range's end cap on the chart to move its end date (the start stays put), with the same guide line and confirm as start-drags. Neither edge can cross the other.
- Chart labels respect their neighbors' rings: name labels no longer end inside the ring around a selected or zoomed glyph.
- Deleting the chart you're looking at now truly releases it — the view no longer stays invisibly scoped to a dead chart.
- Creating a map from the home tour card stays on the home page like every other card.
- The writing page sits centered again (it overflowed its right edge), the breadcrumb reads book › chapter in the right order, and the link-all icon lives inside the page's top corner.
- The writing sidebar creates where you point: hover a book or chapter row for a "+" that creates directly inside it. The header keeps one button (new book); the draft button is gone, though existing drafts keep working.
- The knowledge page's "Who knows this" carries a small ? that explains circles on hover.
- The AI import prompt now includes a small example of the expected JSON shape.
- The writing room no longer ambushes you with its setup screen: a loose narrative beside your book/chapter tree doesn't count as a structure decision anymore. Setup still appears for imported worlds whose tiers use different names.
- Creating your first element no longer shifts the home page — the count line and the protagonist/home row reserve their space from the start.
- The home page's element list lives under one "Recent" heading (the "Recently edited" subtitle is gone).
- With the sidebar filtered to one category, the + button opens element creation with that category preselected.
- The import/export room is now called "Data".
- The home page's Recent list speaks one language: every row is verb + name + type + time, whether it's your latest writing, map, or any other element.
- The writing tree's hover "+" sits in one column at every nesting depth.

- View a shared world: the worlds sidebar gained an eye button that accepts a read key — no PIN asked, anywhere. The world downloads into your OnlyWorlds folder, stays current with its owner's changes (refreshes on open and on demand), and is view-only by construction: atlas never writes to it, locally or on the server. The row wears an eye and a "view" chip; the corner pill says "View only".

- Re-date by dragging: grab any dot on the chart and slide it to a new date; a guide line shows where it will land and a confirm keeps mis-drags harmless. Dragging a range moves its start; the end stays anchored, so the drag can never invert it.
- Saved charts fixed: a chart saved from the default view can now be reopened (it silently refused before). The panel beside the chart names whichever saved chart is open, renames included, and the chips sit beside the buttons with a quieter look, so saving your first chart no longer shifts the page.
- Previewing and focusing look different now: a click gives an element a soft ring; focusing it earns the bright one.
- The charts room's create button is "+ Element" (it always could create more than events).
- The home page now walks a new world in: character and location cards lead, and once both exist, quiet cards suggest what each next element type unlocks — create an event and the card becomes a door to Charts, a narrative opens Writing, a map, a collective for Knowledge, a construct for Pages, an object for Export. Each card can be dismissed for good.
- Creating from a home card keeps you on the home page; your first element gets a highlighted row that takes you back into editing it.
- Empty link fields are easier to read: fields brightened overall, fields whose target type exists in the world show a readier link icon, and a field with nothing to link opens element creation directly — the new element links itself in and you stay where you were.
- The AI import prompt now carries the full OnlyWorlds field list for every type, generated from the schema itself — assistants no longer invent fields. The import room shows the prompt's approximate size.
- The maps panel teaches by glow: with no maps yet, the new-map button lights up instead of a paragraph explaining it.
- Category names appear instantly when hovering the sidebar's type icons.
- Picking a category in the create dialog no longer steals focus from the name field.
- Room descriptions tightened across writing, charts, knowledge, pages, and import.

- Charts mark where recorded time ends, cleanly: the overview bar now ends exactly at the world's bounds (the viewport band pins inside it, never overhanging), and in the plot everything beyond the bounds dims back toward the page. The lit region is recorded history; its edge is the border.
- Element chips on the chart card speak time: a border means the element is dated and lives on the chart; undated-but-dateable chips are borderless and can be dragged straight onto the axis to date them. A click still previews.
- The date on the chart card is editable: click it, type, Enter. Same for elements with ranges (edits the start).
- When the chart is already focused on an element, its card no longer offers a redundant Focus button.
- The "Tableau: the cast and essentials" label is gone; the help overlay explains the default view instead.
- "Set current" is now "set now time". Once set, the chart tag and the control both show just the date (the gold treatment already says it's the now), and the control keeps its exact size when toggled, so the view no longer jumps.
- A world with nothing dated still gets its full chart: the axis, the overview bar, and Set now time all work from element zero.
- Creating from the charts room now asks for the date up front (prefilled with the now) and only offers types that can carry one; dateless types stay visible but disabled so the difference is learnable. The new element lands on the chart immediately, selected, or says so honestly if the current view excludes it.
- The element card in charts is a compact raised panel: content-height with a visible edge, and Focus and Edit sit right under the content instead of the bottom of a tall empty column.
- World settings travel between devices: the description, cover image URL, time setup, and the charts now-line sync for linked worlds. Move the now on one machine and it moves everywhere. Clearing the now syncs too.
- Linking a world that already has a description or time setup on OnlyWorlds brings those in instead of blanking them.
- A sync round that only moved world settings says "Pulled world settings" instead of pretending nothing happened, and "Already up to date" no longer fires when settings did change.
- If both a device and the server changed the same world setting under review mode, the conflict list shows a world-settings row with the same keep-mine or take-theirs choice as elements.
- The world name on the home page stays local by design (the OnlyWorlds name is a separate identity, shown in settings); its tooltip now says so.
- A read-only access key now gets its own sync message instead of PIN advice.
- Keys atlas creates for account worlds now carry a name ("atlas · windows"), so the portal keys table says which tool and machine each key belongs to.
- Titles read as tenures in charts: a title granted and never revoked draws a bar from its grant to the world's now with a fading open end, instead of posing as a single instant. The bar claims its row, so other marks no longer sit on a held tenure.
- Charts treat the focused element as the subject: its span draws thick and holds the center line. Focusing a character or creature born before the now shows a dotted life-line running to the now (dotted because atlas presumes alive; nothing records a death).
- The chart card speaks in type language: "granted 12 · revoked 31 · held 19", "granted 28 · held 10 so far", "born 5 · age 33", "founded 8". Durations stay plain numbers until calendars land.
- Focusing an element with an ongoing span keeps the world's now in view, so the openness is visible instead of running off the right edge.
- Opening a world from the account list shows a progress overlay (creating the key, downloading N of M elements) instead of a silent freeze.
- Account mode: paste one account token (minted at onlyworlds.com → Settings → Account tokens) into Settings → Account and atlas knows your account. Your OnlyWorlds worlds appear in the sidebar under "On OnlyWorlds"; opening one downloads it into your atlas folder, with atlas creating its own access key along the way. No more hunting API keys per world.
- Creating a new API world while signed in goes through your account: no email needed, one request, and the world lands linked. Signed out, the classic email + PIN path still works.
- Shared worlds (where you are a collaborator, not the owner) show in the account list with a hint to link them with a key from the owner.
- If a world's access key is revoked, sync now says exactly that and points at the fix, instead of suggesting your PIN is wrong.
- Unlinked worlds no longer reappear in the account list as if they weren't on disk; atlas remembers the folder is already yours.
- Fixed a long-standing race where clicking a world during a link download could corrupt the download or land you in the wrong world; downloads and world switches now queue politely.

- Sync now speaks the OnlyWorlds v2 API. Making a world online uploads everything in one atomic request: worlds whose elements reference each other in loops (any real world, in practice) now come through complete on the first try.
- Custom fields: fields named with an `atlas_`, `x_`, or `shadow_` prefix now sync, import, and export like any other data. Bring your own fields; atlas carries them.
- Custom fields have a home in the editor: a Custom fields section at the bottom of every element shows them with clean labels, and an add field row creates new ones. Names autocomplete from fields already used in the world, values keep their type, and shared pages show the clean label too. Hover the section header or the add row for a short explanation.
- Published cards read as presentation: short values like supertype and subtype join one inline line under the name, the description flows as plain text, and only longer fields keep their labels. Applies in atlas previews and on published pages.
- The example page shows its highlight cards in two columns on wide screens.
- Creating an element switches the sidebar to the elements list so the new entry is visible, matching what creating a world already did.
- Chart labels pick their spot more predictably: to the right of the dot first, then below, then left.
- Zone colors, opacity, and shape now sync between devices instead of living on one machine.
- Pulling changes uses the server's change feed: faster, and deletions arrive as explicit events instead of being inferred, which removes a whole class of false "deleted on the server" prompts.
- Elements deleted and later restored on the server no longer risk a stale deletion prompt.
- Sync errors are more precise: a dangling reference names the missing element, an expired key reads differently from a wrong PIN, and rate limiting no longer pauses sync as if your credentials failed.
- Credential checks (linking, Test connection, make online) use the v2 world endpoint: one call validates the key and reads the world's identity.
- If the OnlyWorlds server is ever restored from a backup, atlas now detects it and rebuilds its sync position from scratch instead of trusting a position that points past the server's history.
- Charts open richer by default: every element type present keeps a seat, and worlds dominated by one type now fill the whole view instead of a handful of dots.
- Chart interactions: click previews an element, clicking it again focuses the chart on it, clicking empty space dismisses. Larger click targets and a clearer selection ring.
- Events no longer sit directly on top of narrative or era lines in charts.
- The home page chart now always previews the Charts room's default view, with saved charts as quick links below it, in a compact layout built for the smaller space.
- Switching worlds keeps you in the same room (charts to charts, writing to writing) instead of jumping to home.
- Removed the unfinished search and templates pages; their old links land on home.
- Search everywhere with Ctrl+K (or `/`): a command palette that finds elements by name, alias, type label, or description text, jumps to rooms by name, and can hand its query to the sidebar for the full list. The sidebar filter now searches those same fields, not just names.
- Fixed: creating a map from the sidebar left the element search stuck filtered.

## 1.0.0

- Folder-first world browser and editor: worlds live as local folders, with optional two-way sync to the OnlyWorlds API.
- Schema-driven element editing across all 22 OnlyWorlds element types.
- Maps, zones, and pins for spatial worldbuilding, alongside the graph-based context pane for browsing connections.
- Writing room for drafting narratives with element mentions, plus a knowledge room for tracking who knows what.
- Charts for visualizing world data (timelines, distributions, relationships).
- Sharing and publishing: build and publish read-only pages of world content.
- Import and export: bring in worlds from JSON, or take a world out to file or clipboard.
