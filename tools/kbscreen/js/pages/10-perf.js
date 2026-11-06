// perf: battery and clock; CPU load beside a RAM tank, GPU load beside VRAM.
'use strict';

page('perf', (function () {
  const ICON = {
    cpu: ['..#.#..', '.#####.', '##...##', '.#.#.#.', '##...##', '.#####.', '..#.#..'],
    gpu: ['#######', '#.###.#', '#.#.#.#', '#.###.#', '#######', '.#.#.#.'],
    ram: ['#######', '#.#.#.#', '#######', '.#.#.#.'],
    plug: ['.#.#.', '.#.#.', '#####', '#####', '.###.', '..#..'],
  };

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

  return function perf(d, t) {
    const s = d.sys;
    statusLine(d, t);
    pair(25, ICON.cpu, s.cpu, s.cpuHistory, '', s.ramUsed, s.ramTotal);
    f.dotted(73);
    pair(78, ICON.gpu, s.gpu, s.gpuHistory, 'V', s.vramUsed, s.vramTotal);
  };
})());
