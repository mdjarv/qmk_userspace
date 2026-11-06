// music: album art, scrolling title and artist, spectrum, track position.
'use strict';

page('music', (function () {
  // Scrolls text that does not fit; text that fits stands still.
  function marquee(s, y, t, msPerPx, tiny) {
    const w = tiny ? f.tinyWidth(s) : f.textWidth(s);
    const draw = x => (tiny ? f.tiny(s, x, y) : f.text(s, x, y));
    if (w <= W) { draw(0); return; }
    const gap = 12, off = Math.floor(t / msPerPx) % (w + gap);
    for (let x = -off; x < W; x += w + gap) draw(x);
  }

  const peaks = new Array(10).fill(0);

  return function music(d, t) {
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
  };
})());
