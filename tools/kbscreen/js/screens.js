// The left OLED's screens. kbscreen calls render(d, t) 20 times a second with
// the latest data (README.md lists d's fields) and t in ms, and knob() when
// the right knob is pressed. Save and the keyboard shows the change within a
// second; a script that fails to load leaves the last good one running.
//
//   perf    battery and clock; CPU load beside a RAM tank, GPU load beside VRAM
//   music   album art, scrolling title and artist, spectrum, track position
//   agents  a robot per Agentique session updated in the last hour, the rest
//           counted under LATER; only reached by knob
//
// Music playing shows music, otherwise perf. A knob press shows the next screen
// until that choice changes. A question asked in the last 10 minutes puts the
// asking robot on perf (in place of the battery %) and music (top right).
'use strict';

const f = new Frame();
const SCREENS = ['perf', 'music', 'agents'];
let shown = 'perf', override = null, overrideContext = null, lastData = null;

const context = d => (d.media.playing ? 'music' : 'perf');

function knob() {
  override = SCREENS[(SCREENS.indexOf(override || shown) + 1) % SCREENS.length];
  overrideContext = lastData ? context(lastData) : null;
}

function render(d, t) {
  lastData = d;
  const ctx = context(d);
  if (override && ctx !== overrideContext) override = null;
  shown = override || ctx;
  f.clear();
  if (shown === 'music') music(d, t);
  else if (shown === 'agents') agents(d, t);
  else perf(d, t);
  if (d.media.volume >= 0 && d.media.volumeChangedAgo >= 0 && d.media.volumeChangedAgo < 1500) volume(d.media);
  return f.buf;
}

const asking = d => d.agents && d.agents.newQuestion;

// ---- pictures ------------------------------------------------------------

const ICON = {
  cpu: ['..#.#..', '.#####.', '##...##', '.#.#.#.', '##...##', '.#####.', '..#.#..'],
  gpu: ['#######', '#.###.#', '#.#.#.#', '#.###.#', '#######', '.#.#.#.'],
  ram: ['#######', '#.#.#.#', '#######', '.#.#.#.'],
  plug: ['.#.#.', '.#.#.', '#####', '#####', '.###.', '..#..'],
};

// A 9x9 robot: solid head with cut-out eyes and mouth, hollow when idle.
// Working sways its antenna, done smiles, waiting asks (?), idle sleeps (Z).
const ANTENNA = ['....#....', '...#.....', '....#....', '.....#...'];
const HEAD = {
  open: ['..#####..', '.#######.', '.#..#..#.', '.#######.', '.##...##.', '.#######.', '..#...#..'],
  smile: ['..#####..', '.#######.', '.#..#..#.', '.#######.', '.#.###.#.', '.##...##.', '..#...#..'],
  hollow: ['..#####..', '.#.....#.', '.#.#.#.#.', '.#.....#.', '.#.###.#.', '.#.....#.', '..#####..'],
};
function robot(x, y, state, t, i = 0) {
  const antenna = state === 'working' ? ANTENNA[Math.floor(t / 500 + i) % 4] : ANTENNA[0];
  const head = state === 'done' ? HEAD.smile : state === 'idle' ? HEAD.hollow : HEAD.open;
  f.sprite([antenna, '....#....', ...head], x, y);
  if (state === 'waiting') f.tiny('?', x + 9, y);
  if (state === 'idle') f.tiny('Z', x + 9, y);
}

// ---- perf ----------------------------------------------------------------

const gib = v => (v < 10 ? v.toFixed(1) : String(Math.round(v))) + 'G';

// A 0..100 history as a line, newest at the right edge.
function graph(x0, y0, w, h, hist) {
  const n = Math.min(hist.length, w);
  let prev = -1;
  for (let i = 0; i < n; i++) {
    const v = Math.floor(Math.min(hist[hist.length - n + i], 100) * (h - 1) / 100);
    const y = y0 + h - 1 - v;
    if (prev < 0) prev = y;
    for (let k = Math.min(prev, y); k <= Math.max(prev, y); k++) f.px(x0 + w - n + i, k);
    prev = y;
  }
}

// A solid vertical level, outlined.
function tank(x, y, w, h, used, total) {
  f.rect(x, y, w, h);
  const fill = total > 0 ? Math.floor(Math.min(used, total) * (h - 2) / total) : 0;
  f.fill(x + 1, y + h - 1 - fill, w - 2, fill);
}

function statusLine(d, t) {
  const s = d.sys;
  if (s.batteryState !== 'hidden') {
    f.rect(0, 0, 15, 8);
    f.fill(15, 2, 2, 4);
    f.fill(2, 2, Math.round(s.battery * 11 / 100), 4);
    if (s.batteryState === 'charging') { f.fill(4, 1, 7, 6, false); f.sprite(ICON.plug, 5, 1); }
    if (!asking(d)) f.tiny(s.battery + '%', 19, 2);
  }
  if (asking(d)) robot(19, 0, 'waiting', t);
  f.text(s.clock, 1, 11);
  f.dotted(21);
}

function pair(y, icon, load, hist, tag, used, total) {
  f.sprite(icon, 0, y);
  f.tiny(load + '%', 9, y + 1);
  graph(0, y + 9, 23, 28, hist);
  tank(25, y + 9, 7, 28, used, total);
  f.sprite(ICON.ram, 0, y + 39);
  if (tag) f.tiny(tag, 8, y + 38);
  f.tinyRight(gib(used), y + 38);
}

function perf(d, t) {
  const s = d.sys;
  statusLine(d, t);
  pair(25, ICON.cpu, s.cpu, s.cpuHistory, '', s.ramUsed, s.ramTotal);
  f.dotted(73);
  pair(78, ICON.gpu, s.gpu, s.gpuHistory, 'V', s.vramUsed, s.vramTotal);
}

// ---- music ---------------------------------------------------------------

// Scrolls text that does not fit; text that fits stands still.
function marquee(s, y, t, msPerPx, tiny) {
  const w = tiny ? f.tinyWidth(s) : f.textWidth(s);
  const draw = x => (tiny ? f.tiny(s, x, y) : f.text(s, x, y));
  if (w <= W) { draw(0); return; }
  const gap = 12, off = Math.floor(t / msPerPx) % (w + gap);
  for (let x = -off; x < W; x += w + gap) draw(x);
}

const peaks = new Array(10).fill(0);

function music(d, t) {
  const m = d.media;
  f.pages(m.art, 0);
  marquee(m.title || '-', 34, t, 70, false);
  marquee(m.artist, 44, t, 110, true);
  m.bands.forEach((v, b) => {
    peaks[b] = Math.max(v, peaks[b] > 4 ? peaks[b] - 4 : 0);
    const h = Math.floor(v * 58 / 255), ph = Math.floor(peaks[b] * 58 / 255);
    f.fill(1 + b * 3, 112 - h, 2, h);
    f.fill(1 + b * 3, 111 - ph, 2, 1);
  });
  f.rect(0, 115, W, 3);
  f.fill(0, 116, m.length ? Math.floor(m.position * W / m.length) : 0, 1);
  const time = Math.floor(m.position / 60) + ':' + String(m.position % 60).padStart(2, '0');
  f.tiny(time, (W - f.tinyWidth(time)) >> 1, 121);
  if (asking(d)) { f.fill(19, 0, 13, 10, false); robot(20, 0, 'waiting', t); }
}

// ---- agents --------------------------------------------------------------

function agents(d, t) {
  const a = d.agents;
  if (!a) { robot(0, 10, 'idle', t); f.tiny('NO', 15, 10); f.tiny('LINK', 15, 16); return; }
  f.tiny('RUN ' + a.running, 0, 0);
  f.tinyRight('?' + a.waiting, 0);
  f.dotted(7);

  let y = 10;
  if (a.rows.length === 0) { robot(0, y, 'idle', t); f.tiny('QUIET', 13, y + 2); y += 12; }
  a.rows.forEach((r, i) => { robot(0, y, r.state, t, i); f.tiny(r.name.slice(0, 4), 15, y + 2); y += 12; });

  if (a.laterWaiting || a.laterIdle) {
    y += 2;
    f.tiny('LATER', 0, y);
    f.dotted(y + 7);
    y += 11;
    if (a.laterWaiting) {
      robot(0, y, 'waiting', t);
      f.tiny(String(a.laterWaiting), 15, y + 2);
      f.tinyRight(a.oldestWait, y + 2);
      y += 12;
    }
    if (a.laterIdle) { robot(0, y, 'idle', t); f.tiny(String(a.laterIdle), 15, y + 2); }
  }
}

// ---- over any screen -----------------------------------------------------

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
