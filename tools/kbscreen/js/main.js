// What kbscreen calls: render(d, t) 20 times a second with the latest data
// (the README lists d's fields) and t in ms, and knob(kind) when the right knob
// is pressed: "press", "double" or "long". The pages are in pages/, one file
// each; this picks which one shows. Save any file and the keyboard shows the
// change within a second; a version that fails to load leaves the last good
// one running.
//
// Music playing shows music, otherwise the farm (the agent zoo). A knob press shows the next page
// until that choice changes, a double press the previous one, a long press
// goes back to the automatic choice. The screens stay on while music plays,
// and dim at night. A volume change shows over any page for 1.5 s.
'use strict';

let shown = null, override = null, overrideContext = null, lastData = null;

const has = name => PAGES.some(p => p.name === name);
const context = d => (d.media.playing && has('music') ? 'music' : has('farm') ? 'farm' : has('perf') ? 'perf' : PAGES[0].name);

function knob(kind) {
  if (kind === 'long') { override = null; return; }
  const names = PAGES.map(p => p.name), step = kind === 'double' ? names.length - 1 : 1;
  override = names[(names.indexOf(override || shown) + step) % names.length];
  overrideContext = lastData ? context(lastData) : null;
}

function night(d) {
  const hour = Number(d.sys.clock.slice(0, 2));
  return hour >= 22 || hour < 7;
}

function volume(m) {
  f.fill(0, 62, W, 30, false);
  f.rect(0, 62, W, 30);
  f.tiny('VOL', 10, 65);
  if (m.muted) { f.text('MUT', 7, 74); return; }
  const s = String(m.volume);
  f.text(s, (W - f.textWidth(s)) >> 1, 72);
  f.rect(3, 83, 26, 5);
  f.fill(4, 84, Math.floor(Math.min(m.volume, 100) * 24 / 100), 3);
}

function render(d, t) {
  lastData = d;
  const ctx = context(d);
  if (override && (ctx !== overrideContext || !has(override))) override = null;
  shown = override || ctx;
  display.keepAwake = d.media.playing;
  display.brightness = night(d) ? 40 : 255;
  f.clear();
  PAGES.find(p => p.name === shown).draw(d, t);
  if (d.media.volume >= 0 && d.media.volumeChangedAgo >= 0 && d.media.volumeChangedAgo < 1500) volume(d.media);
  return f.buf;
}
