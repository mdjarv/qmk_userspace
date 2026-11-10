// What kbscreen calls: render(d, t) 20 times a second with the latest data
// (the README lists d's fields) and t in ms, and knob(kind) when the right knob
// is pressed: "press", "double" or "long". The pages are in pages/, one file
// each; this picks which one shows. Save any file and the keyboard shows the
// change within a second; a version that fails to load leaves the last good
// one running.
//
// A council at work or with an answer waiting shows the council, otherwise
// the page on trial this week (see TRIAL). Music is only a knob press away:
// coming up by itself when a track started was annoying. A
// knob press shows the next page until that choice changes, a double press the
// previous one, a long press goes back to the automatic choice. The screens stay on while music plays,
// and dim at night. A volume change shows over any page for 1.5 s.
'use strict';

let shown = null, override = null, overrideContext = null, lastData = null;

const has = name => PAGES.some(p => p.name === name);
// The judging week (a council, 2026-11-09): each page alone long enough to
// learn it by heart, the farm through the 11th, fishing from the 12th to the
// 14th, a verdict on the 15th and the losing page deleted. Swapping every ten
// minutes taught neither. Until the verdict, the farm.
const TRIAL = [['2026-11-12', 'fishing'], ['2026-11-15', 'farm']];
function onTrial(d) {
  let page = 'farm';
  TRIAL.forEach(([from, name]) => { if (d.sys.date >= from) page = name; });
  return page;
}
// A live council debating or writing its brief; one whose answer has waited
// less than an hour; or one that moved in the last five minutes and has a
// round not yet handed over (just started, or between rounds). Agentique
// keeps councils "live" for weeks with an answer nobody took, so waiting alone
// is not enough, and it reports briefRound 0, so rounds are judged by round.
const COUNCIL_FRESH_S = 300, COUNCIL_WAIT_S = 3600;
const councilBusy = d => (d.councils || []).some(c => {
  if (c.status === 'ended') return false;
  if (c.running || c.scribing) return true;
  const fresh = s => c.updatedAgo >= 0 && c.updatedAgo < s;
  if (c.waiting) return fresh(COUNCIL_WAIT_S);
  return c.handedOverRound < c.round && fresh(COUNCIL_FRESH_S);
});
function context(d) {
  if (councilBusy(d) && has('council')) return 'council';
  const trial = onTrial(d);
  if (has(trial)) return trial;
  if (has('farm')) return 'farm';
  return has('perf') ? 'perf' : PAGES[0].name;
}

function knob(kind) {
  if (kind === 'long') { override = null; return; }
  const names = PAGES.map(p => p.name), step = kind === 'double' ? names.length - 1 : 1;
  override = names[(names.indexOf(override || shown) + step) % names.length];
  overrideContext = lastData ? context(lastData) : null;
}

// The preview page's reset: every page's own reset (an action named
// '<page>: reset'), and back to the automatic page.
action('reset', () => {
  ACTIONS.forEach((fn, name) => { if (name.endsWith(': reset')) fn(); });
  override = null;
});

// Shows a page as a knob press would (for actions that want to be seen).
function showPage(name) {
  if (!has(name)) return;
  override = name;
  overrideContext = lastData ? context(lastData) : null;
}

// For the preview page's picker: the pages, the one showing and whether it
// is the automatic choice; pick(name) shows one, pick('') goes back to
// automatic (a long press).
function pageState() { return { pages: PAGES.map(p => p.name), shown: shown || '', auto: !override }; }
function pick(name) { if (name) showPage(name); else override = null; }

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
  TICKS.forEach(fn => fn(d, t));
  f.clear();
  PAGES.find(p => p.name === shown).draw(d, t);
  if (d.media.volume >= 0 && d.media.volumeChangedAgo >= 0 && d.media.volumeChangedAgo < 1500) volume(d.media);
  return f.buf;
}
