// Drawing for the 32x128 left OLED, shared by screens.js (loaded after this).
// A frame is 512 bytes laid out like the OLED buffer: byte x + (y >> 3) * 32,
// bit y & 7. FONT_BUFFER (the keyboard's 6x8 font, 224 glyphs of 6 columns,
// bit 0 on top) is set by kbscreen.
'use strict';

const W = 32, H = 128;
const FONT = new Uint8Array(FONT_BUFFER);

// Set by the screens, read by kbscreen after every frame: the left OLED's
// brightness (0..255), and whether both OLEDs stay on past the 60 s idle
// blanking.
const display = { brightness: 255, keepAwake: false };

// 3x5 glyphs on a 4-pixel pitch (8 characters a line), top row first.
const TINY = {
  ' ': '000000000000000', '!': '010010010000010', '%': '101001010100101', '*': '010101010000000',
  '+': '000010111010000', '-': '000000111000000', '.': '000000000000010', '/': '001001010100100',
  ':': '000010000010000', '>': '100010001010100', '?': '111001010000010', '^': '010111010010010',
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
  '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001010010010',
  '8': '111101111101111', '9': '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
};

class Frame {
  constructor() { this.buf = new Uint8Array(512); }
  clear() { this.buf.fill(0); }

  px(x, y, on = true) {
    x |= 0; y |= 0;
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = x + (y >> 3) * W, bit = 1 << (y & 7);
    if (on) this.buf[i] |= bit; else this.buf[i] &= ~bit;
  }
  fill(x, y, w, h, on = true) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, on);
  }
  rect(x, y, w, h) {
    for (let i = 0; i < w; i++) { this.px(x + i, y); this.px(x + i, y + h - 1); }
    for (let j = 0; j < h; j++) { this.px(x, y + j); this.px(x + w - 1, y + j); }
  }
  dotted(y) { for (let x = 0; x < W; x += 2) this.px(x, y); }

  // The keyboard's font, scaled up by scale; draws set bits only.
  glyph(c, x, y, scale = 1, on = true) {
    if (c > 223) c = 63; // '?'
    for (let i = 0; i < 6; i++) {
      const col = FONT[c * 6 + i];
      for (let k = 0; k < 8; k++) if ((col >> k) & 1) this.fill(x + i * scale, y + k * scale, scale, scale, on);
    }
  }
  text(s, x, y, scale = 1, on = true) {
    s = String(s);
    for (let i = 0; i < s.length; i++) this.glyph(s.charCodeAt(i), x + i * 6 * scale, y, scale, on);
  }
  textWidth(s, scale = 1) { return String(s).length * 6 * scale; }

  tiny(s, x, y, on = true) {
    s = String(s).toUpperCase();
    for (let i = 0; i < s.length; i++) {
      const g = TINY[s[i]];
      if (!g) continue;
      for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (g[r * 3 + q] === '1') this.px(x + i * 4 + q, y + r, on);
    }
  }
  tinyWidth(s) { return String(s).length * 4; }
  tinyRight(s, y) { this.tiny(s, W + 1 - this.tinyWidth(s), y); }

  // Raw OLED-layout bytes (like album art) from 8-row page `page` on.
  pages(bytes, page) {
    for (let i = 0; i < bytes.length && page * W + i < this.buf.length; i++) this.buf[page * W + i] = bytes[i];
  }
  // A picture as rows of '#' (lit) and anything else (left alone).
  sprite(rows, x, y, on = true) {
    rows.forEach((r, yy) => { for (let xx = 0; xx < r.length; xx++) if (r[xx] === '#') this.px(x + xx, y + yy, on); });
  }
}

// ---- shared by the pages ---------------------------------------------------

// The frame every page draws into; main.js clears it before each page.
const f = new Frame();

// Pages register here, in file name order (pages/10-perf.js before
// pages/20-music.js); that is also the knob order.
const PAGES = [];
function page(name, draw) { PAGES.push({ name, draw }); }

// What runs every frame whichever page shows (a game that keeps going while
// another page is on screen), before the page draws. tick(fn) with fn(d, t).
const TICKS = [];
function tick(fn) { TICKS.push(fn); }

// Things a page lets you set off by hand for testing (the preview page at
// :8077 shows them as buttons): action(name, fn). Name them
// 'page/section: label' ('farm/calendar: lucia'); the preview groups them by
// page and section in the order they were registered. '<page>: reset' ends
// the page's shows and goes with the page's heading.
const ACTIONS = new Map();
function action(name, fn) { ACTIONS.set(name, fn); }

// Whether an agent asked something in the last 10 minutes.
const asking = d => d.agents && d.agents.newQuestion;

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
