# Left OLED design

What the screens are for and what has been decided about how they look. Read this before designing a page; add to it when a verdict would apply to the next page too.

## The surface

- 32×128 pixels, portrait, one colour, physically about 22×6 mm, on the left half beside the hand.
- The keyboard's 6×8 font fits 5 characters a line and 16 lines; the 3×5 `tiny` font fits 8 a line. Text is expensive: a word is a whole line.
- Up to 20 frames a second (the firmware's OLED refresh). Animation is cheap; flicker is not.
- The right OLED is firmware, not kbscreen: the top half of the headphones animation (amazed face in game mode) over the original layer icon and Gui/Alt/Ctrl/Shift tiles.

## Point of view

The screen is there to be cool first and useful second. It sits in peripheral vision, so it should read at a glance and never demand attention. It is not where agents get noticed: Agentique on the main screen is, and the OLEDs sit out of the line of sight (2026-11-09). So the agent pages are a glanceable overview and a pleasure to watch, never a notification channel.

## Verdicts so far

Each came from a round of mockups or from using it on the keyboard (2026-11-06).

- **Graphics and symbols over text.** Icons (chip, card, memory stick, plug), avatars and meters beat labels. "Vertical displays make text very limited."
- **Nothing flashes or inverts to get attention.** A blinking inverted row felt aggressive. Motion should be calm: a swaying antenna, scrolling text, moving needles and graphs.
- **Avatars for agents.** Liked more than any text list. The 9×9 robot board that started it gave way to the farm (below); the robot stays as the asking corner on perf and music.
- **Graphs are lines, no fill pattern under them.** Levels (RAM, VRAM) are solid tanks, not cells or dithering. 32 per-thread bars were too busy.
- **Pair what belongs together**: CPU load beside its RAM tank, GPU load beside its VRAM tank, with clear separation (a gap and a dotted line) between the pairs.
- **Show only what matters now.** The battery appears only while charging or discharging; temperature and power were dropped as not needed; VRAM stays because local LLMs make it matter.
- **A notification replaces something rather than adding**: the asking robot takes the battery percent's place on perf and the corner by the tonearm's pivot on music.
- **Music is a turntable** (2026-11-10): the record spins while it plays and stops on pause, and the tonearm is the track position. No album art: at 32x32 and dithered it showed nothing.
- **Charging is a plug, not a lightning bolt** (the bolt looked odd at this size).
- **Recent first, old things fold away.** Sessions quiet for an hour leave the farm; questions left for days become the mailbox, idle ones a Z from the farmhouse, instead of pinning the screen.
- **The screen never switches itself to demand attention.** The farm and the fishing page take turns; a council at work comes up (context, not an alert). Music does not: switching to it whenever a track started was annoying, so it is a knob press away (2026-11-09).
- **Right screen:** text bands for layer and mods were rejected, and having no indicators was missed on the keyboard; the original icon set under half the animation was the answer.

## The agent zoo (farm)

From rounds on 2026-11-06 and a council on 2026-11-09 (`js/pages/30-farm.js`); the farm is the page that comes up by itself.

- **Distance from the gate is how much an agent needs you.** Asking at the gate, a ripe crop in its corner, tending its corner, asleep on the porch, behind the lit window. The bottom edge is nearest the hand; the gate stands for you.
- **Lane and gate**: bands from the top, one owner each: sky (0-9), home (10-22: a small house, a porch for two sleepers, the cart), the patch (24-108: eight corners either side of a lane), the gate (110-127: askers, the mailbox on a fence stub). Picked over four rows of beds, allotment plots and beanstalks: rows read as a list, plot edges as more dotted lines, and a tall stalk puts a long worker up among the sleepers.
- **Position carries the whole state.** The firmware blanks the screen after 60 s without typing, so it is mostly seen as a snapshot; motion is a bonus. Creatures walk only to cross bands, along the lane; working and done stay in the corner, told apart by pose and a ripe crop.
- **The lane is worn only at its ends** (a few stones by the porch, a worn patch at the gate). Stones all the way down read as another dotted line.
- **A corner belongs to a project**, given in first-seen order and kept in the save for weeks: a mound marks it, one plant on it, no row lines or plot edges. A second session of the project takes the nearest free corner; with all eight taken, the project quiet longest gives its corner up.
- **Species and crop come from the project**, the least used of each list in first-seen order (no hashing, no collisions). The model is not shown.
- **Farm over construction**: growing then ripe maps onto working then done; an unseen finished turn is a ripe crop waiting to be harvested. A harvest is a finished plant you have seen; the cart takes nine.
- **Cast**: 8x8, front-on, faces cut out as holes, feet as separate pixels, a 2-frame idle at 2 fps (the reference sheet in `~/Downloads/g0jpddudups91.mp4`). No ghost species: the ghost belongs to the night visitor.
- **Size is context usage**: a pixel smaller under a third full, chunky over three quarters, normal when unknown.
- **No speech bubbles**: a bare `?` over the head; bubbles were noise at this spacing.
- **Nothing below the gate**: names and counts under the fence confused. Old questions are a mailbox with its flag up.
- **Homecoming, not death**: an archived session walks home through the farmhouse door. A merged one leaves through the gate carrying its crop, and a flag goes up on the house for an hour. The drama moves to a weekly scene: the first time the farm shows after Monday 06:00, a meteor clears the week. It is meant to be dramatic, the one place a flash is allowed: it grows on the way in, hits with a white flash and screen shake, rocks and dust fly, every creature on the farm dies and its ghost rises (and the week's homecomers rise from the house); then a new generation walks out of the house for the live sessions, corners are handed out afresh, the plants and the cart load are gone and keeps what was earned (upgrades, unlocks, lifetime counts); its crater stays six hours, so a morning glance still tells it.
- **Hierarchy is family**: a session another started is its child, a 5x5 of the parent's kind below the family's corner (two in front, the rest crowd in behind); a lead idle while its children work stands at its corner. Subagents inside a turn are ducklings over the head.
- **The farm keeps going behind other pages** (`tick`): growth is timed by the wall clock, so it is right after a page switch, a blanking or a suspend.
- **Quirks** (first take): each kind has one move of its own, every 3 to 9 minutes while it stands or works: the bun's ear flops, the bot's antenna sparks, the cat yawns, the owl looks left and right, the mushroom puffs spores, the frog catches a fly, the top hat is tipped, the blob jiggles.
- **Upgrades** (first take): what the cart loads sell for, with no coin count: each part is swapped in place in a short build-in scene. 1 load: a crate cart; 2: a picket gate; 4: a chimney and a window box; 6: a covered wagon; 9: a stone arch over the gate; 12: a barn with a turning windmill vane.
- **Seasons change the ground, not the cast** (first take): marks in the gaps the corners leave, by the date: flowers in spring, tufts in summer, fallen leaves in autumn, frost in winter or below zero, a snow cover for two days after snow while it stays freezing.
- **A Swedish calendar** (first take): the first frost spreads over the ground; Lucia (13 December) walks up the lane with her candle crown; on Christmas Eve the tomte leaves a gift on the porch that stays to the 26th; on Midsommar Eve the maypole goes up and stands for the weekend.
- **Events**: one short scene at a time, Johnny Castaway style. Earned ones follow the save and Agentique's totals (the cart drives off with every full load, a scarecrow beside the lane after 20 harvests, a balloon up the lane every 500 turns); the weather brings a rainbow after rain and a snowman after snow; a rooster on the roof at sunrise; rare ambient ones come on a random wait (crow, butterfly, shooting star, leaves on windy days, a visitor ghost at night). What is earned stays drawn.

## Fishing (trial)

From the build and a council on 2026-11-09 (`js/pages/35-fishing.js`). The other agent page; it takes turns with the farm.

- **Depth is how much an agent needs you**, from the boat down: asking just under the boat with a bare `?`, done in the boat, working in the water, idle on the sand.
- **Done means in the boat, and nothing else.** The catch plays the moment a turn ends, behind other pages and on a dark screen too, so a glance is always right; the ceremony is what a glance sometimes catches. Done fish waiting for the line line up at the hook (the column left of the askers); askers keep right of the line (x 7-31) so the reel never crosses one.
- **The boat shows the newest catch whole on the gunwale**, still beating its tail while unseen; the two before it are tails, older ones are out of sight. Three whole fish read as a jumble of fins.
- **No progress on this page.** The farm keeps what is earned; fishing holds only the present and the weather. No tallies, records, boat growth or running totals.
- **The fisherman carries no data.** He reacts (arms up on a landing, recasts) and has idle routines, but his pose never stands for a state; it would repeat or contradict the fish.
- **Quirks only while working, and never change size or height**: speed, facing, or something beside the fish. Size is context and height is state.
- **Event props stay out of the state bands**: the gull sits on the bow post, not on the catch; the jellyfish stays below the askers.

## The council (campfire)

Direction agreed 2026-11-09, first take (`js/pages/40-council.js`).

- **Bands**: sky (other councils as small fires top right), the scribe's desk (top), the members around a fire (middle), the answer (bottom edge, nearest the hand, the farm gate's rule). An empty bottom means nothing waits for you.
- **Pose is the member's state; size is who has the floor**: every seat is a log. A member at work in its turn (thinking, a tool, writing) stands up off it, full size in its persona's look, a step toward the fire, outlined dark so it stands clear, and talks with its whole body: phrases of about 2.3 s with a half-second pause, the mouth opening and shutting by syllable, both arms going from pose to pose every beat, a bob up on the raised ones, each speaker on its own beat; with a tool its far hand holds a lantern. When its turn ends it sits back down, through a short crouch. A speaker is the one place on this page where motion is lively on purpose.
- **Seated is a progress meter** (trial: `SEATED` in the page switches small, heads, faint): seated members show their persona's head on a small body, drawn faint (every other pixel) while their turn in the round is still to come and solid once they have spoken, so a round fills in clockwise from the top right and you still see who is who. A hollow body under a head was too small to read; the same small figure for everyone read best as a meter but hid who was who. Solid ones: answered leans back from the fire, failed slumps toward it, stopped dozes with a Z. Faint is dithering, which the meters avoid; here it stands for not-yet, not for a level.
- **No drifting marks**: sound arcs toward the fire and thinking dots read as stray pixels; the talking body says it all. Rounds before: everyone at full size, standing for thinking too; then full size seated; then only writing talking.
- **It comes up when a council starts**, not only while it runs: a live council that moved in the last five minutes counts (round 0 before the first round, the gaps between rounds), unless its answer was handed over.
- **Built-in personas by silhouette**, not name, and only standing: Socrates a beard, Nietzsche a moustache, Odysseus a plumed helmet, Spark spiked hair, Razor blade-thin; anyone else hooded, the hood by a hash of the name.
- **Rounds are fuel**: a log on the fire for each finished round (the newest falls in), the flame a size larger at two and four; pips under it for the round of the planned ones. Ended: embers and a wisp.
- **The brief is a scroll**: while the scribe writes, bent over the desk with a quill scratching, the sheet hangs off the desk and unrolls line by line, to a length that grows with every round it covers; rolled and sealed at the bottom with a bare `?` while it waits; gone once handed over.
- **It comes up by itself** while a live council runs, scribes or waits, ahead of music (a council is minutes, music is hours).

## Working method

Design work runs as rounds on one page of mockups, each option shown inside the real two-screen context, with a marked recommendation; answers come back short ("S2, P3", "less aggressive"). Now that the screens are JavaScript, a mockup can be a real page file running against live data: edit, look at http://localhost:8077, screenshot `frame.png` for a round.

## Known trade-offs

- A single knob press reaches kbscreen 250 ms late: the keyboard waits that long to rule out a double press (`KNOB_DOUBLE_MS` in the keymap's `screens.c`; changing it means a flash).
