// music: a turntable. The record spins while it plays (33 rpm, the grooves
// and the label's notch going round) and stops on pause; the tonearm is the
// track position, from the outer groove in, and lifts back to its rest when
// nothing plays. Under it the title and artist scroll, the spectrum, and the
// elapsed time. No album art: at 32x32 and dithered it showed nothing.
'use strict';

page('music', (function () {
  // Scrolls text that does not fit; text that fits stands still.
  function marquee(s, y, t, msPerPx, tiny) {
    const w = tiny ? f.tinyWidth(s) : f.textWidth(s);
    const draw = x => (tiny ? f.tiny(s, x, y) : f.text(s, x, y));
    if (w <= W) { draw((W - w) >> 1); return; }
    const gap = 12, off = Math.floor(t / msPerPx) % (w + gap);
    for (let x = -off; x < W; x += w + gap) draw(x);
  }
  function line(x0, y0, x1, y1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) f.px(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n));
  }

  const CX = 15, CY = 16, R = 14;           // the platter
  const PIVOT = [29, 3], ARM = 20;          // the tonearm, and its length
  const OUTER = 96, INNER = 120, REST = 84; // arm angles (degrees): first groove, last groove, at rest off the record
  const RPM = 33 / 60;
  let spin = 0, last = null, arm = REST;
  const peaks = new Array(10).fill(0);

  function turntable(m, t, dt) {
    if (m.playing) spin += dt / 1000 * RPM * Math.PI * 2;
    // the record's edge, its grooves as fine rings, and two glints of light
    // across them that go round with it
    for (let a = 0; a < 96; a++) { const th = a / 96 * Math.PI * 2; f.px(CX + Math.cos(th) * R, CY + Math.sin(th) * R); }
    [11, 8].forEach(r => {
      const n = Math.round(r * 6.3);
      for (let k = 0; k < n; k++) {
        const th = k / n * Math.PI * 2, glint = [spin, spin + Math.PI].some(g => Math.abs(Math.atan2(Math.sin(th - g), Math.cos(th - g))) < 0.35);
        if (glint || k % 2 === 0) f.px(CX + Math.cos(th) * r, CY + Math.sin(th) * r);
      }
    });
    // the label: solid, a notch going round, the spindle in the middle
    for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) if (x * x + y * y <= 17) f.px(CX + x, CY + y);
    f.px(CX + Math.round(Math.cos(spin) * 3), CY + Math.round(Math.sin(spin) * 3), false);
    f.px(CX, CY, false);
    // the tonearm swings to the track position, or back to its rest
    const target = m.playing && m.length ? OUTER + (INNER - OUTER) * Math.min(m.position / m.length, 1) : REST;
    arm += Math.sign(target - arm) * Math.min(Math.abs(target - arm), dt * 0.03);
    const th = arm * Math.PI / 180, sx = PIVOT[0] + Math.cos(th) * ARM, sy = PIVOT[1] + Math.sin(th) * ARM;
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y <= 4) f.px(PIVOT[0] + x, PIVOT[1] + y, x * x + y * y > 1);
    line(PIVOT[0], PIVOT[1], sx, sy);
    f.fill(Math.round(sx) - 1, Math.round(sy) - 1, 2, 3); // the cartridge
  }

  return function music(d, t) {
    const m = d.media, dt = last === null ? 50 : Math.min(200, Math.max(0, t - last));
    last = t;
    turntable(m, t, dt);
    marquee(m.title || '-', 36, t, 70, false);
    marquee(m.artist, 46, t, 110, true);
    m.bands.forEach((v, b) => {
      peaks[b] = Math.max(v, peaks[b] > 4 ? peaks[b] - 4 : 0);
      const h = Math.floor(v * 54 / 255), ph = Math.floor(peaks[b] * 54 / 255);
      f.fill(1 + b * 3, 114 - h, 2, h);
      f.fill(1 + b * 3, 113 - ph, 2, 1);
    });
    const time = Math.floor(m.position / 60) + ':' + String(m.position % 60).padStart(2, '0');
    f.tiny(time, (W + 1 - f.tinyWidth(time)) >> 1, 120); // how far in is the tonearm's
    if (asking(d)) { f.fill(19, 0, 13, 10, false); robot(20, 0, 'waiting', t); }
  };
})());
