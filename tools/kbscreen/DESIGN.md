# Left OLED design

What the screens are for and what has been decided about how they look. Read this before designing a page; add to it when a verdict would apply to the next page too.

## The surface

- 32×128 pixels, portrait, one colour, physically about 22×6 mm, on the left half beside the hand.
- The keyboard's 6×8 font fits 5 characters a line and 16 lines; the 3×5 `tiny` font fits 8 a line. Text is expensive: a word is a whole line.
- Up to 20 frames a second (the firmware's OLED refresh). Animation is cheap; flicker is not.
- The right OLED is firmware, not kbscreen: the top half of the headphones animation (amazed face in game mode) over the original layer icon and Gui/Alt/Ctrl/Shift tiles.

## Point of view

The screen is there to be cool first and useful second. It sits in peripheral vision, so it should read at a glance and never demand attention.

## Verdicts so far

Each came from a round of mockups or from using it on the keyboard (2026-11-06).

- **Graphics and symbols over text.** Icons (chip, card, memory stick, plug), avatars and meters beat labels. "Vertical displays make text very limited."
- **Nothing flashes or inverts to get attention.** A blinking inverted row felt aggressive. Motion should be calm: a swaying antenna, scrolling text, moving needles and graphs.
- **Avatars for agents.** A 9×9 robot per session, its face showing the state: antenna sways while working, `?` when asking, smile when done, hollow and `Z` when idle. Liked more than any text list.
- **Graphs are lines, no fill pattern under them.** Levels (RAM, VRAM) are solid tanks, not cells or dithering. 32 per-thread bars were too busy.
- **Pair what belongs together**: CPU load beside its RAM tank, GPU load beside its VRAM tank, with clear separation (a gap and a dotted line) between the pairs.
- **Show only what matters now.** The battery appears only while charging or discharging; temperature and power were dropped as not needed; VRAM stays because local LLMs make it matter.
- **A notification replaces something rather than adding**: the asking robot takes the battery percent's place on perf and the album art's corner on music.
- **Charging is a plug, not a lightning bolt** (the bolt looked odd at this size).
- **Recent first, old things fold away.** Agents sort by last update; questions left for days sink into a LATER count with the oldest age, instead of pinning the screen.
- **The screen never switches itself to demand attention.** Music playing selects the music screen (that is context, not an alert); the agent board is only reached by knob.
- **Right screen:** text bands for layer and mods were rejected, and having no indicators was missed on the keyboard; the original icon set under half the animation was the answer.

## Working method

Design work runs as rounds on one page of mockups, each option shown inside the real two-screen context, with a marked recommendation; answers come back short ("S2, P3", "less aggressive"). Now that the screens are JavaScript, a mockup can be the real `screens.js` running against live data: edit, look at http://localhost:8077, screenshot `frame.png` for a round.

## Known trade-offs

- A single knob press reaches kbscreen 250 ms late: the keyboard waits that long to rule out a double press (`KNOB_DOUBLE_MS` in the keymap's `screens.c`; changing it means a flash).
