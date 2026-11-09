// farm: the agent zoo. Every Agentique session is a creature on a farm laid
// out in bands: sky, home (house, porch, cart), the patch (a corner for each
// project along a lane) and the gate. Distance from the gate is how much an
// agent needs you: asking at the gate, a ripe crop in its corner, tending its
// corner, asleep on the porch, behind the lit window. A session another one
// started is its child; an archived one walks home through the door, a merged
// one leaves through the gate carrying its crop and a flag goes up. The
// creature's size is how full its context window is. Weather, night and the
// events go over everything. What lasts (projects, crops, harvests, unlocks,
// cooldowns) is in kbscreen's save object.
'use strict';

page('farm', (function () {
  delete save.demo; // left by the design rounds
  if (save.projects && save.cornersV !== 2) { Object.values(save.projects).forEach(p => delete p.corner); save.cornersV = 2; } // corners were filled from the top

  // ---- the cast: 8x8, front-on, two idle frames each ------------------------
  // acc is what still shows when it lies down to sleep (ears, antenna, cap).
  const CAST = {
    bun: { a: ['..#..#..', '..#..#..', '.######.', '.#.##.#.', '.######.', '.##..##.', '.######.', '..#..#..'],
           b: ['........', '..#..#..', '..#..#..', '.######.', '.#.##.#.', '.######.', '.##..##.', '.#....#.'],
           acc: ['.....##.', '...###..'] },
    bot: { a: ['...##...', '....#...', '.######.', '.#.##.#.', '.######.', '.#....#.', '.######.', '.#....#.'],
           b: ['..##....', '....#...', '.######.', '.#.##.#.', '.######.', '.##..##.', '.######.', '..#..#..'],
           acc: ['...#....', '...#....'] },
    cat: { a: ['.#....#.', '.##..##.', '.######.', '.#.##.#.', '.######.', '..####..', '.######.', '.#.##.#.'],
           b: ['........', '.#....#.', '.##..##.', '.######.', '.#.##.#.', '.######.', '.######.', '.##..##.'],
           acc: ['........', '.#....#.'] },
    owl: { a: ['.#....#.', '.######.', '#..##..#', '#..##..#', '###..###', '.######.', '.######.', '..#..#..'],
           b: ['........', '.#....#.', '.######.', '#..##..#', '########', '###..###', '.######.', '.#....#.'],
           acc: ['........', '.#....#.'] },
    mush: { a: ['..####..', '.##..##.', '########', '.######.', '..#..#..', '..####..', '..####..', '..#..#..'],
            b: ['........', '..####..', '.##..##.', '########', '..#..#..', '..####..', '..####..', '.#....#.'],
            acc: ['..####..', '.##..##.'] },
    frog: { a: ['........', '.##..##.', '.#.##.#.', '########', '########', '#......#', '.######.', '##....##'],
            b: ['........', '........', '.##..##.', '.#.##.#.', '########', '#......#', '########', '#.#..#.#'],
            acc: ['........', '.##..##.'] },
    hat: { a: ['..####..', '..####..', '.######.', '..####..', '..#..#..', '..####..', '.######.', '..#..#..'],
           b: ['........', '..####..', '..####..', '.######.', '..#..#..', '..####..', '.######.', '.#....#.'],
           acc: ['..####..', '.######.'] },
    blob: { a: ['........', '........', '..####..', '.######.', '.#.##.#.', '.######.', '########', '########'],
            b: ['........', '..####..', '.######.', '.#.##.#.', '.######.', '.######.', '.######.', '########'],
            acc: ['........', '........'] },
  };
  // Children: a 5x5 of the parent's kind.
  const MINI = {
    bun: ['.#.#.', '.###.', '#.#.#', '#####', '.#.#.'],
    bot: ['..#..', '#####', '#.#.#', '#####', '.#.#.'],
    cat: ['#...#', '#####', '#.#.#', '#####', '.#.#.'],
    owl: ['#...#', '#####', '#.#.#', '##.##', '.#.#.'],
    mush: ['.###.', '#####', '.#.#.', '.###.', '.#.#.'],
    frog: ['##.##', '#.#.#', '#####', '#...#', '##.##'],
    hat: ['.###.', '#####', '.#.#.', '.###.', '.#.#.'],
    blob: ['.....', '.###.', '#.#.#', '#####', '#####'],
  };
  const MINI_SLEEP = ['.....', '.....', '.....', '.###.', '#####'];
  const SOUL = ['..###..', '.#...#.', '#.#.#.#', '#.....#', '#..#..#', '#.....#', '#.#.#.#', '.#.#.#.'];
  const DUCKLING = ['.#.', '###'];
  const KINDS = Object.keys(CAST);

  // ---- quirks: a move of its own for each kind, every few minutes ------------
  // frames are whole sprites shown in turn over len ms (top row at y + dy);
  // extra(x, y, k, t) draws what happens around it, k from 0 to 1.
  const QUIRKS = {
    bun: { len: 1600, frames: [['..#.....', '..#..###', ...CAST.bun.a.slice(2)], CAST.bun.a] }, // an ear flops, twice
    bot: { len: 1500, extra: (x, y, k) => { const r = Math.round(k * 3); f.px(x + 3 - Math.round(k * 2), y - 1 - r); f.px(x + 4 + Math.round(k * 2), y - 1 - r); } }, // a spark off the antenna
    cat: { len: 1400, frames: [['.#....#.', '.##..##.', '.######.', '.######.', '.##..##.', '..####..', '.######.', '.#.##.#.']] }, // a yawn, eyes shut
    owl: { len: 1600, frames: [['.#....#.', '.######.', '#.##.###', '#.##.###', ...CAST.owl.a.slice(4)], CAST.owl.a, ['.#....#.', '.######.', '###.##.#', '###.##.#', ...CAST.owl.a.slice(4)], CAST.owl.a] }, // looks left, then right
    mush: { len: 1800, extra: (x, y, k) => [[2, 0], [4, 0.15], [5, 0.3]].forEach(([dx, d]) => { const kk = (k - d) / 0.7; if (kk > 0 && kk < 1) f.px(x + dx + Math.round(Math.sin(kk * 6 + dx)), y - 1 - Math.round(kk * 6)); }) }, // puffs spores
    frog: { len: 1600, frames: [CAST.frog.a, CAST.frog.a, CAST.frog.a, CAST.frog.a, CAST.frog.a, CAST.frog.a, CAST.frog.a, CAST.frog.b, CAST.frog.b, CAST.frog.b],
      extra: (x, y, k, t) => { // a fly comes by; the tongue gets it
        if (k < 0.6) f.px(x + 10 + Math.round(Math.sin(t / 90)), y - 1 + Math.round(Math.cos(t / 70)));
        else if (k < 0.7) for (let i = 6; i <= 10; i++) f.px(x + i, y + 5 - Math.round((i - 6) * 1.5));
      } },
    hat: { len: 1400, dy: -2, frames: [['...####.', '...####.', '..######', '........', '........', '..####..', '..#..#..', '..####..', '.######.', '..#..#..']] }, // tips its hat
    blob: { len: 1200, frames: [CAST.blob.b, CAST.blob.a, CAST.blob.b, CAST.blob.a, CAST.blob.b, CAST.blob.a] }, // jiggles
  };

  // ---- crops: one kind a project ----------------------------------------------
  const STAGES = [['..#..'], ['.#.#.', '..#..'], ['#.#.#', '.###.', '..#..'], ['.#.#.', '#.#.#', '.###.', '..#..', '..#..']];
  const RIPE = {
    pumpkin: ['..#..', '.###.', '##.##', '#####', '.###.'],
    cabbage: ['.#.#.', '#.#.#', '#####', '#####', '.###.'],
    sunflower: ['.###.', '##.##', '.###.', '..#..', '.##..', '..##.', '..#..'],
    corn: ['..#..', '.###.', '.###.', '#.#.#', '.###.', '..#..', '..#..'],
    carrot: ['#.#.#', '.#.#.', '..#..', '.###.', '.###.'],
    strawberry: ['.#.#.', '#####', '#.#.#', '.###.', '..#..'],
  };
  const CROPS = Object.keys(RIPE);
  const plant = (rows, x, soil) => f.sprite(rows, x, soil - rows.length + 1);

  // A project's creature, crop and corner, given once, in first-seen order:
  // the least used of each list. Kept in the save, so a project keeps them
  // for weeks.
  function project(name) {
    const ps = save.projects = save.projects || {};
    if (!ps[name]) {
      const least = (list, key) => {
        let best = list[0], n = Infinity;
        list.forEach(v => { const c = Object.values(ps).filter(p => p[key] === v).length; if (c < n) { best = v; n = c; } });
        return best;
      };
      ps[name] = { kind: least(KINDS, 'kind'), crop: least(CROPS, 'crop'), seen: Date.now() };
    }
    return ps[name];
  }
  const kindOf = r => r.kind || project(r.name).kind;
  const sleepRows = c => ['........', '........', '........', c.acc[0], c.acc[1], '.######.', '#..##..#', '########'];
  function seedOf(id) { let h = 7; for (const c of id) h = (h * 33 + c.charCodeAt(0)) % 9973; return h % 17; }

  // ---- the place ---------------------------------------------------------------
  // Bands: sky 0-9, home 10-22, the patch 24-108, the gate 110-127.
  const HOUSE = ['....##....', '..######..', '##########', '.#......#.', '.#.####.#.', '.#.#..#.#.', '.#.####.#.', '.#......#.', '.#...##.#.', '##########'];
  // What cart sales buy, in order, each swapped in place: [loads sold, part, tier].
  const UPGRADES = [[1, 'cart', 1], [2, 'gate', 1], [4, 'house', 1], [6, 'cart', 2], [9, 'gate', 2], [12, 'house', 2]];
  const tierOf = part => (save.tiers || {})[part] || 0;
  const BARN = ['...####...', '..#....#..', '.#.#..#.#.', '#........#', '##########', '#.#....#.#', '#..#..#..#', '#...##...#', '#..#..#..#', '##########'];
  const CARTS = [
    { rows: ['#######', '#.....#', '#######', '.#...#.'], y: 18, load: [17, 16, 15], lx: 0, dots: '.#.#.#.' }, // a handcart
    { rows: ['#.#.#.#', '#######', '#.....#', '#######', '.#...#.'], y: 17, load: [16, 15, 14], lx: 0, dots: '.#.#.#.' }, // a crate cart
    { rows: ['.#####.', '#.....#', '#.....#', '#######', '#.....#', '#######', '.#...#.'], y: 15, load: [19, 17, 16], lx: 1, dots: '#.#.#' }, // a covered wagon
  ];
  // Draws a part at a tier; share < 1 while it is being built (an upgrade).
  const draw = (rows, x, y, share) => (share < 1 ? fade(rows, x, y, share) : f.sprite(rows, x, y));
  function house(tier, share, t) {
    if (tier < 2) {
      draw(HOUSE, 0, 11, share);
      if (tier === 1) { draw(['##', '##', '##'], 7, 8, share); draw(['#.#', '###'], 2, 18, share); } // a chimney, a window box
    } else {
      draw(BARN, 0, 11, share);
      draw(['.', '#', '#'], 5, 8, share); // the windmill vane, turning slowly
      draw(Math.floor(t / 900) % 2 ? ['.#.', '###', '.#.'] : ['#.#', '.#.', '#.#'], 4, 6, share);
    }
  }
  const windowAt = () => (tierOf('house') === 2 ? [4, 13] : [4, 16]);
  const smokeAt = () => (tierOf('house') === 1 ? [7, 7] : [7, 11]);
  function cart(tier, x, load, share) {
    const k = CARTS[tier];
    draw(k.rows, x, k.y, share);
    for (let r = 0; r < load; r++) draw([k.dots], x + k.lx, k.load[r], share);
  }
  function gate(tier, share) {
    if (tier === 0) {
      draw(['#........#', '#........#', '#........#', '##########', '#..#..#..#', '#..#..#..#', '#..#..#..#', '##########', '#........#', '#........#'], 11, 118, share);
      return;
    }
    // pickets with pointed tops between the posts
    draw(['#........#', '#.#.#.#.##', '#.#.#.#.##', '##########', '#.#.#.#.##', '#.#.#.#.##', '#.#.#.#.##', '##########', '#.#.#.#.##', '#........#'], 11, 118, share);
    if (tier === 2) { // a stone arch over it
      const arch = [];
      for (let x = 10; x <= 21; x++) arch.push([x, 117 - Math.round(Math.sqrt(Math.max(0, 36 - (x - 15.5) * (x - 15.5))))]);
      arch.forEach(([x, y]) => (share < 1 ? ((x * 7) % 10) / 10 < share : true) && f.px(x, y));
      draw(['##', '#.', '##', '.#', '##', '#.', '##', '.#', '##', '#.', '##'], 10, 117, share);
      draw(['##', '.#', '##', '#.', '##', '.#', '##', '#.', '##', '.#', '##'], 20, 117, share);
    }
  }
  const MAILBOX = ['.#####.', '#.....##', '#.###.##', '#.....#.', '.#####..', '...#....', '...#....', '...#....', '...#....'];
  const DOOR = [1, 12];       // where a creature goes in
  const PORCH = [[10, 13], [17, 13]];
  const LANE = 12;            // a creature on the lane covers x 12..19
  const ASK = [[0, 112], [8, 112], [16, 112]]; // the mailbox stands where a fourth would
  // Eight corners scattered over the patch, at uneven heights, the plant on
  // either side: x, y the creature's top left, px the plant's, side where the
  // plant is. Placed so that a corner's plant and its two children (below
  // the creature) stay clear of every other corner.
  const CORNERS = [
    { x: 1, y: 25, px: 10, side: 1 },
    { x: 22, y: 30, px: 16, side: -1 },
    { x: 6, y: 46, px: 15, side: 1 },
    { x: 23, y: 52, px: 17, side: -1 },
    { x: 0, y: 66, px: 9, side: 1 },
    { x: 17, y: 71, px: 26, side: 1 },
    { x: 10, y: 86, px: 4, side: -1 },
    { x: 22, y: 95, px: 16, side: -1 },
  ];

  // ---- drawing helpers -----------------------------------------------------------
  // Context usage is size: a pixel smaller under a third, chunky over three
  // quarters. Row 6 is the body in every sprite; column 4 is inside the face.
  function sized(rows, pct) {
    if (pct === undefined || pct < 0 || (pct >= 34 && pct <= 75)) return rows;
    if (pct < 34) return rows.filter((r, i) => i !== 6).map(r => r.slice(0, 4) + r.slice(5));
    return rows.flatMap((r, i) => (i === 6 ? [r, r] : [r])).map(r => r.slice(0, 4) + r[3] + r[4] + r.slice(4));
  }
  // pose: walk, stand, water, done, sleep. Feet stay on y + 7 whatever the size.
  function creature(m, pose, t) {
    const c = CAST[m.kind];
    let rows = pose === 'sleep' ? sleepRows(c) : pose === 'water' ? c.a : (Math.floor(t / (pose === 'walk' ? 160 : 500) + m.sd) % 2 ? c.b : c.a);
    // now and then, standing or working, its quirk: the first within a few
    // minutes of arriving, then every 3 to 9 minutes
    const q = QUIRKS[m.kind];
    if (!m.quirkAt) m.quirkAt = t + (60 + Math.random() * 240) * 1000;
    if (pose === 'walk' || pose === 'sleep') { if (m.quirk && t - m.quirk < q.len) m.quirk = 0; }
    else if (t >= m.quirkAt) { m.quirk = t; m.quirkAt = t + (180 + Math.random() * 360) * 1000; }
    const qk = m.quirk ? (t - m.quirk) / q.len : 1;
    let dy = 0;
    if (qk < 1 && q.frames) { rows = q.frames[Math.min(Math.floor(qk * q.frames.length), q.frames.length - 1)]; dy = q.dy || 0; }
    if (rows.length === 8) rows = sized(rows, m.r.context);
    const w = rows[0].length, x = Math.round(m.x) - (w > 8 ? 1 : 0);
    const y = Math.round(m.y) + 8 - (dy ? 8 : rows.length) + dy + (pose === 'done' ? hop(t, m.sd) : 0);
    f.sprite(rows, x, y);
    if (qk < 1 && q.extra) q.extra(x, y - dy, qk, t);
    if (pose === 'water') { // the can, tipped now and then over its plant
      const ph = (t + m.sd * 137) % 1600, tip = ph > 900;
      const can = tip ? ['.##..', '#####', '####.', '....#'] : ['.##..', '####.', '#####'];
      f.sprite(m.side > 0 ? can : can.map(r => r.split('').reverse().join('')), m.side > 0 ? x + w - 1 : x - 4, y + 3);
      if (tip) { const off = Math.floor((ph - 900) / 700 * 3), dx = m.side > 0 ? x + w + 3 : x - 4; f.px(dx, y + 6 + off); }
    }
    if (pose === 'sleep') zee(x + 6, y + 2, t, m.sd);
    const n = Math.min(m.r.helpers || 0, 3); // in-turn subagents: ducklings over its head
    for (let i = 0; i < n; i++) f.sprite(DUCKLING, x + i * 3 - 1 + (n === 1 ? 2 : 0), y - 3 + (Math.floor(t / 250 + i) % 2 ? -1 : 0));
    return y;
  }
  function child(c, t) {
    const rows = MINI[c.kind] || MINI.blob, x = Math.round(c.x), y = Math.round(c.y), s = c.r.state;
    if (c.moving) f.sprite(rows, x, y + (Math.floor(t / 160 + c.sd) % 2));
    else if (s === 'waiting') { f.sprite(rows, x, y); f.tiny('?', x + 1, y - 6); }
    else if (s === 'working') { // bobbing, flicking a drop up at the plant now and then
      f.sprite(rows, x, y + (Math.floor(t / 400 + c.sd) % 2));
      const p = (t + c.sd * 97) % 1200;
      if (p < 400) f.px(x + 2, y - 2 - Math.floor(p / 200));
    } else if (s === 'done') f.sprite(rows, x, y + hop(t, c.sd));
    else f.sprite(MINI_SLEEP, x, y);
  }
  // Draws only a share (0..1) of a sprite's pixels, the same ones every frame,
  // so it dissolves rather than flickers.
  function fade(rows, x, y, share) {
    rows.forEach((r, yy) => { for (let xx = 0; xx < r.length; xx++) if (r[xx] === '#' && ((xx * 7 + yy * 13) % 10) / 10 < share) f.px(x + xx, y + yy); });
  }
  const hop = (t, sd) => { const p = (t + sd * 911) % 2600; return p < 150 ? -1 : p < 300 ? -2 : p < 450 ? -1 : 0; };
  function zee(x, y, t, sd) { const p = ((t / 1800) + sd * 0.37) % 1; f.tiny('Z', x + Math.round(p * 2), y - Math.round(p * 5)); }
  // Walks m toward (tx, ty) at 16 px/s, along the lane between bands: across
  // to it, along it, then across. True while it is still on its way.
  function walk(m, dt, lane) {
    let tx = m.tx, ty = m.ty;
    if (Math.abs(m.x - tx) > 0.5 && Math.abs(m.y - ty) > 0.5) {
      if (Math.abs(m.x - lane) > 0.5) { tx = lane; ty = m.y; } else tx = lane;
    }
    const dx = tx - m.x, dy = ty - m.y, dist = Math.hypot(dx, dy);
    if (dist <= 0.5) return false;
    const k = Math.min(1, dt * 0.016 / dist);
    m.x += dx * k; m.y += dy * k;
    return true;
  }

  // ---- families ------------------------------------------------------------------
  // Splits the rows into grown-ups and children. A child's family is its
  // oldest live ancestor; a parent off the rows (quiet for an hour) comes back
  // while its children are there. A child whose parent is parked or archived
  // is on its own.
  function families(a) {
    const rowOf = new Map(a.rows.map(r => [r.id, r]));
    const known = new Map((a.sessions || []).map(s => [s.id, s]));
    const alive = id => { const x = rowOf.get(id) || known.get(id); return x && x.state !== 'archived' && x.state !== 'parked' ? x : null; };
    const root = r => { let x = r; for (let i = 0; i < 6 && x.parent && alive(x.parent); i++) x = alive(x.parent); return x; };
    const adults = [], kids = [];
    a.rows.forEach(r => { const top = root(r); if (top === r) adults.push(r); else kids.push(Object.assign({}, r, { family: top.id, kind: kindOf(top) })); });
    kids.forEach(k => {
      if (adults.some(x => x.id === k.family)) return;
      const p = alive(k.family);
      adults.push({ id: p.id, name: p.name, state: p.state, parent: '', helpers: p.helpers || 0, context: p.context });
    });
    return { adults, kids };
  }

  // ---- weather -------------------------------------------------------------------
  // d.weather (Open-Meteo); without it, fair weather and night by the clock.
  const MOON = ['.###.', '##...', '#....', '##...', '.###.'];
  const SUN = ['.###.', '#####', '#####', '#####', '.###.'];
  const CLOUD = ['...###....', '.##...##..', '#.......##', '##########'];
  function weatherOf(d) {
    const w = d.weather, h = Number(d.sys.clock.slice(0, 2));
    if (!w) return { sky: 'clear', night: h >= 21 || h < 6, temp: 10, wind: 5 };
    return { sky: w.sky, night: !w.day, temp: w.temp, wind: w.wind, sunrise: w.sunrise };
  }
  const flakes = [];
  function sky(w, t, dt) {
    const wet = w.sky === 'rain' || w.sky === 'storm', clouded = w.sky !== 'clear';
    if (w.night && !clouded) {
      f.sprite(MOON, 13, 2);
      [[20, 2], [24, 6], [3, 4], [8, 1]].forEach(p => f.px(p[0], p[1]));
    } else if (!w.night && !clouded) {
      f.sprite(SUN, 13, 2);
      const r = Math.floor(t / 1000) % 2; // the rays turn, slowly
      (r ? [[15, 0], [15, 8], [11, 4], [19, 4]] : [[12, 1], [18, 1], [12, 7], [18, 7]]).forEach(p => f.px(p[0], p[1]));
    }
    const drift = 300 + 900 / (1 + w.wind / 10); // clouds drift with the wind
    if (clouded && w.sky !== 'fog') {
      f.sprite(CLOUD, Math.round((t / drift) % 44) - 12, 0);
      f.sprite(CLOUD, Math.round((t / (drift * 1.5) + 20) % 44) - 12, 4);
      if (w.sky === 'storm') f.sprite(CLOUD, Math.round((t / (drift * 1.2) + 32) % 44) - 12, 2);
    }
    if (w.sky === 'fog') // patches of haze drifting across, not lines
      [40, 58, 76, 94].forEach((y, i) => f.sprite(['##.##.##', '.##.##..'], Math.round(((t / (900 + i * 300)) + i * 11) % 44) - 10, y));
    if (wet || w.sky === 'snow') {
      const snow = w.sky === 'snow', want = snow ? 10 : w.sky === 'storm' ? 12 : 7, slant = Math.min(w.wind / 40, 1);
      while (flakes.length < want) flakes.push({ x: Math.random() * (W + 10) - 10 * slant, y: 8 - Math.random() * 40, s: Math.random() });
      for (let i = flakes.length - 1; i >= 0; i--) {
        const p = flakes[i];
        p.y += dt * (snow ? 0.012 : 0.07);
        p.x += snow ? Math.sin(t / 700 + p.s * 6) * 0.15 : dt * 0.07 * slant;
        if (p.y > 121) { flakes.splice(i, 1); continue; }
        f.px(p.x, p.y);
        if (!snow) f.px(p.x - slant, p.y + 1);
      }
    } else flakes.length = 0;
  }

  // ---- the simulation ------------------------------------------------------------
  // tick() runs every frame whichever page shows, so the farm keeps going
  // behind perf and music: corners are handed out, plants grow (timed by the
  // wall clock, so through a suspend too), crops are harvested, creatures
  // walk. The page only draws what tick left.
  const GROW_MS = 180000; // a stage of growth per 3 minutes of work
  const mobs = new Map(), kids = new Map();
  let lastTick = null, insideIdle = 0, insideBusy = 0;
  const workOf = m => (m.workMs || 0) + (m.since ? Date.now() - m.since : 0);

  // The free corner farthest from the taken ones (the one nearest the middle
  // of the patch when none is), so a few projects spread over all of it
  // rather than filling it from the top. -1 when all are taken.
  function spread(owner) {
    const mid = i => [CORNERS[i].x + 4, CORNERS[i].y + 4];
    const taken = CORNERS.map((c, i) => i).filter(i => owner(i) !== undefined);
    let best = -1, score = -Infinity;
    CORNERS.forEach((c, i) => {
      if (owner(i) !== undefined) return;
      const [x, y] = mid(i);
      const s = taken.length ? Math.min(...taken.map(j => { const [a, b] = mid(j); return Math.hypot(x - a, y - b); })) : -Math.hypot(x - 16, y - 66);
      if (s > score) { score = s; best = i; }
    });
    return best;
  }

  // A project's corner: kept while the project lives; a second session of it
  // takes the nearest free corner; with all eight taken, the project quiet
  // longest gives its corner up.
  function cornerFor(m, used) {
    const ps = save.projects, p = project(m.r.name);
    const owner = i => Object.keys(ps).find(n => ps[n].corner === i);
    if (p.corner === undefined) {
      let free = spread(owner);
      if (free < 0) {
        const live = new Set([...mobs.values()].map(x => x.r.name));
        const quiet = Object.keys(ps).filter(n => ps[n].corner !== undefined && !live.has(n)).sort((x, y) => ps[x].seen - ps[y].seen)[0];
        if (quiet === undefined) return undefined;
        free = ps[quiet].corner;
        delete ps[quiet].corner;
      }
      p.corner = free;
    }
    if (!used.has(p.corner)) return p.corner;
    const c0 = CORNERS[p.corner];
    let best, bd = Infinity;
    CORNERS.forEach((c, i) => {
      if (used.has(i) || owner(i) !== undefined) return;
      const dist = Math.abs(c.y - c0.y) + Math.abs(c.x - c0.x);
      if (dist < bd) { bd = dist; best = i; }
    });
    return best;
  }

  tick(function farmTick(d, t) {
    const dt = lastTick === null ? 50 : Math.min(200, Math.max(0, t - lastTick)); lastTick = t;
    const a = d.agents;
    if (!a) return;
    const now = Date.now();
    save.harvest = save.harvest || 0;
    save.crops = save.crops || {};
    const { adults, kids: kidRows } = families(a);
    const sessions = new Map((a.sessions || []).map(s => [s.id, s]));

    // who is here
    const seen = new Set();
    adults.forEach(r => {
      seen.add(r.id);
      let m = mobs.get(r.id);
      if (!m) { // out of the door, back to the growth the save says it had
        const c = save.crops[r.id] || {};
        m = { x: DOOR[0], y: DOOR[1], tx: DOOR[0], ty: DOOR[1], sd: seedOf(r.id), workMs: c.workMs || c.work || 0, since: c.since || 0, ripe: !!c.ripe };
        mobs.set(r.id, m);
      }
      m.r = r; m.kind = kindOf(r);
      project(r.name).seen = now;
    });
    // off the rows: merged, it leaves through the gate with its crop and the
    // flag goes up; otherwise (archived, parked, quiet) it goes home
    mobs.forEach((m, id) => {
      if (seen.has(id) || m.leaving) return;
      const s = sessions.get(id);
      if (s && s.state === 'archived' && s.merged) {
        m.leaving = 'gate'; m.carry = m.ripe; save.flagUntil = now + 60 * 60000;
      } else m.leaving = 'home';
      if (s && s.state === 'archived') { save.departed = (save.departed || 0) + 1; save.homedWeek = (save.homedWeek || 0) + 1; }
      m.corner = undefined;
    });

    // A family works one plant: busy while anyone in it works, ripe once
    // nobody works and someone is done, harvested when all of it has been seen.
    const kidsOf = new Map();
    kidRows.forEach(k => { if (!kidsOf.has(k.family)) kidsOf.set(k.family, []); kidsOf.get(k.family).push(k); });
    const used = new Set();
    mobs.forEach((m, id) => {
      if (m.leaving) return;
      const ks = kidsOf.get(id) || [], st = m.r.state;
      m.busy = st === 'working' || ks.some(k => k.state === 'working');
      const ripe = !m.busy && (st === 'done' || ks.some(k => k.state === 'done'));
      const asking = st === 'waiting' || ks.some(k => k.state === 'waiting'); // the plant waits for the answer
      if (m.busy && !m.since) m.since = now;
      if (!m.busy && m.since) { m.workMs = workOf(m); m.since = 0; }
      if (!m.busy && !ripe && !asking && (m.ripe || m.workMs)) {
        if (m.ripe) { save.harvest++; save.harvested = (save.harvested || 0) + 1; }
        m.workMs = 0; m.ripe = false;
      }
      m.ripe = ripe;
      m.growing = m.busy || m.ripe || (asking && m.workMs > 0);
    });
    // corners: those with a plant (or a question beside one) first
    [...mobs.values()].filter(m => !m.leaving && (m.growing || m.workMs)).forEach(m => { m.corner = cornerFor(m, used); if (m.corner !== undefined) used.add(m.corner); });
    mobs.forEach((m, id) => {
      if (m.leaving || !(m.growing || m.workMs)) { m.corner = m.leaving ? undefined : m.corner; delete save.crops[id]; return; }
      save.crops[id] = { workMs: Math.round(m.workMs || 0), since: m.since || 0, ripe: !!m.ripe };
    });
    Object.keys(save.crops).forEach(id => { if (!mobs.has(id)) delete save.crops[id]; });

    // where everyone goes
    let ask = 0, porch = 0;
    insideIdle = 0; insideBusy = 0;
    const order = [...mobs.values()].sort((p, q) => (p.r.state === 'waiting' ? 0 : 1) - (q.r.state === 'waiting' ? 0 : 1));
    order.forEach(m => {
      const s = m.r.state, c = CORNERS[m.corner];
      m.indoors = false; m.watching = false;
      if (m.leaving === 'gate') { m.tx = LANE; m.ty = 136; }
      else if (m.leaving === 'home') { m.tx = DOOR[0]; m.ty = DOOR[1]; }
      else if (s === 'waiting') { const i = ask++; m.tx = i < 3 ? ASK[i][0] : (i - 3) * 8 + 4; m.ty = i < 3 ? ASK[i][1] : 103; }
      else if (c && m.growing) { m.tx = c.x; m.ty = c.y; m.watching = s === 'idle'; }
      else if (s === 'idle') {
        if (porch < 2) { [m.tx, m.ty] = PORCH[porch++]; } else { m.tx = DOOR[0]; m.ty = DOOR[1]; m.indoors = true; }
      } else { m.tx = DOOR[0]; m.ty = DOOR[1]; m.indoors = true; } // no corner free: it works indoors
    });
    mobs.forEach((m, id) => {
      m.moving = walk(m, dt, LANE);
      if (m.leaving && !m.moving) mobs.delete(id);
      else if (m.indoors && !m.moving) { if (m.r.state === 'idle') insideIdle++; else insideBusy++; }
    });

    // the children: below their parent's corner while the family works (two
    // in front, the rest crowding behind), at the gate when they ask, curled up
    // by the parent otherwise; archived, home through the door, or out
    // through the gate when merged
    const kseen = new Set(), at = new Map();
    let kidAsk = Math.min(ask, 3) * 8;
    kidRows.forEach(k => {
      kseen.add(k.id);
      const p = mobs.get(k.family);
      let c = kids.get(k.id);
      if (!c) { c = { x: p ? p.x + 2 : DOOR[0], y: p ? p.y + 3 : DOOR[1] + 2, sd: seedOf(k.id) }; kids.set(k.id, c); }
      c.r = k; c.kind = k.kind;
      const pc = p && CORNERS[p.corner];
      if (k.state === 'waiting') { c.tx = Math.min(kidAsk, 26); c.ty = 115; kidAsk += 6; }
      else if (pc && p.growing) {
        const j = at.get(k.family) || 0; at.set(k.family, j + 1);
        c.tx = Math.min(pc.x + (j === 0 ? 0 : j === 1 ? 6 : 3), 27); // a pixel apart, so two read as two c.ty = pc.y + 10 - (j > 1 ? 1 : 0);
      } else if (p) { c.tx = Math.min(Math.round(p.tx) + 9, 27); c.ty = p.ty + 3; }
      else { c.tx = DOOR[0]; c.ty = DOOR[1] + 2; }
    });
    kids.forEach((c, id) => {
      if (!kseen.has(id) && !c.leaving) {
        const s = sessions.get(id);
        c.leaving = s && s.state === 'archived' && s.merged ? 'gate' : 'home';
        if (c.leaving === 'gate') { c.tx = LANE + 1; c.ty = 136; } else { c.tx = DOOR[0]; c.ty = DOOR[1] + 2; }
      }
      c.moving = walk(c, dt, LANE + 1);
      if (c.leaving && !c.moving) kids.delete(id);
    });
  });

  // ---- events ------------------------------------------------------------------
  // A short scene now and then, Johnny Castaway style. One at a time, checked
  // every 5 s. when(c) says it may start; every (ms, wall clock, kept in the
  // save) how long at least between two; mean, for the ambient ones, how long
  // on average after that, so they come unannounced. start(c) and end(c)
  // change the game; draw(c, k, t) draws it, k from 0 to 1 over len ms.
  // c: { a, w (weather), now (Date.now()), today, minutes (of the day), ev (the running one) }.
  const MIN = 60000;
  const CROW = [['#...#', '.#.#.', '..#..'], ['.....', '.#.#.', '#.#.#']];
  const PERCH = [['..##', '.###', '###.', '.#..'], ['....', '..##', '####', '.#..']];
  const BUTTERFLY = [['#.#', '.#.', '#.#'], ['.#.', '.#.', '.#.']];
  const SCARECROW = ['..###..', '..#.#..', '..###..', '#######', '#..#..#', '..###..', '..###..', '...#...', '...#...', '...#...', '...#...'];
  const BALLOON = ['..###..', '.#####.', '#######', '##.#.##', '#######', '.#####.', '..###..', '..#.#..', '..#.#..', '..###..'];
  const SNOWMAN = ['.###.', '#.#.#', '#####', '.###.', '#####', '#####', '.###.'];
  const ROOSTER = [['.##..', '###..', '.####', '.###.', '..#..'], ['.##..', '###.#', '.####', '.###.', '..#..']];
  const SCARECROW_AT = [0, 97], SNOWMAN_AT = [0, 50]; // gaps the corners leave, beside the lane's ends and at the left
  const lerp = (a, b, k) => a + (b - a) * Math.max(0, Math.min(1, k));
  const clockMin = s => (s && s.length >= 5 ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)) : -1);
  const growingPlant = () => [...mobs.values()].find(m => m.corner !== undefined && m.busy);
  let cartAway = false;

  // The week, from Monday 06:00: the meteor comes once a week, the first time
  // the farm is on screen after that.
  function weekOf(now) {
    const d = new Date(now), back = (d.getDay() + 6) % 7;
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, 6);
    if (now < monday.getTime()) monday.setDate(monday.getDate() - 7);
    return monday.toDateString();
  }
  const IMPACT = [15, 62], CRATER = ['..#####..', '.#.....#.', '#.#.#.#.#'];

  const EVENTS = [
    { // first thing in the week: a meteor. It clears the week (the ones who
      // went home rise as ghosts, the corners are handed out afresh, the cart
      // load is gone) and keeps what was earned; the crater stays the morning.
      name: 'meteor', len: 12000, every: 0,
      when: c => {
        if (save.homedWeek === undefined) save.homedWeek = save.departed || 0;
        return save.meteorWeek !== weekOf(c.now);
      },
      start: c => { c.ev.ghosts = Math.min(save.homedWeek || 0, 5); },
      end: c => {
        Object.values(save.projects || {}).forEach(p => delete p.corner);
        save.harvest = 0; save.homedWeek = 0;
        save.meteorWeek = weekOf(c.now);
        save.crater = c.now;
      },
      draw: (c, k, t) => {
        const [ix, iy] = IMPACT;
        if (k < 0.25) { // the streak, from the top right
          const kk = k / 0.25, x = Math.round(lerp(34, ix, kk)), y = Math.round(lerp(-4, iy, kk));
          f.fill(x - 1, y - 1, 3, 3);
          for (let i = 1; i < 6; i++) f.px(x + i, y - Math.round(i * 4.2));
          return;
        }
        if (k < 0.45) { // the ring, spreading
          const r = lerp(2, 20, (k - 0.25) / 0.2);
          for (let a = 0; a < 40; a++) if (a % 2 === 0) f.px(ix + Math.cos(a / 40 * Math.PI * 2) * r, iy + Math.sin(a / 40 * Math.PI * 2) * r * 1.4);
        }
        if (k < 0.75) for (let i = 0; i < 12; i++) { // dust, settling
          const kk = (k - 0.25) / 0.5, a = i * 2.4;
          f.px(ix + Math.cos(a) * (6 + i) * kk * 1.2, iy - 8 * Math.sin(kk * Math.PI) + Math.sin(a) * (4 + i / 2) + kk * 6);
        }
        f.sprite(CRATER, ix - 4, iy - 1);
        for (let i = 0; i < (c.ev.ghosts || 0); i++) { // the week's homecomers rise from the house
          const kk = (k - 0.4 - i * 0.06) / 0.5;
          if (kk > 0 && kk < 1) fade(SOUL, 1 + i * 5, Math.round(lerp(10, -10, kk)), kk < 0.6 ? 0.8 : 0.8 * (1 - kk) / 0.4);
        }
      },
    },
    { // a full load: the cart drives off with it and comes back empty
      name: 'cart', len: 10000, every: 0,
      when: () => (save.harvest || 0) >= 9,
      end: () => { save.harvest = Math.max(0, save.harvest - 9); save.sold = (save.sold || 0) + 1; },
      draw: (c, k) => {
        cartAway = true;
        if (k < 0.4) cart(tierOf('cart'), Math.round(lerp(25, 33, k / 0.4)), 3, 1);
        else if (k > 0.6) cart(tierOf('cart'), Math.round(lerp(33, 25, (k - 0.6) / 0.4)), 0, 1);
      },
    },
    { // what the loads sold have paid for: the next upgrade is built in place
      name: 'upgrade', len: 5000, every: 0,
      when: () => UPGRADES.some(([n, part, tier]) => (save.sold || 0) >= n && tierOf(part) < tier),
      start: c => { c.ev.up = UPGRADES.find(([n, part, tier]) => (save.sold || 0) >= n && tierOf(part) < tier); },
      end: c => { const [, part, tier] = c.ev.up; save.tiers = Object.assign(save.tiers || {}, { [part]: tier }); },
      draw: (c, k, t) => {
        const [, part, tier] = c.ev.up;
        if (part === 'house') house(tier, k, t);
        else if (part === 'cart') { if (!cartAway) cart(tier, 25, Math.min(Math.floor((save.harvest || 0) / 3), 3), k); }
        else gate(tier, k);
      },
    },
    { // twenty harvests in all: a scarecrow goes up beside the lane, and stays
      name: 'scarecrow', len: 5000, every: 0,
      when: () => (save.harvested || 0) >= 20 && !(save.unlocked || {}).scarecrow,
      end: () => { save.unlocked = Object.assign(save.unlocked || {}, { scarecrow: true }); },
      draw: (c, k) => { const h = Math.round(SCARECROW.length * k); f.sprite(SCARECROW.slice(0, h), SCARECROW_AT[0], SCARECROW_AT[1] + SCARECROW.length - h); },
    },
    { // every 500 turns Agentique has run: a balloon goes up the lane
      name: 'balloon', len: 20000, every: 0,
      when: c => {
        const n = Math.floor(c.a.totals.turns / 500);
        if (save.turnMark == null) save.turnMark = n; // count from the first sight, not from history
        return n > save.turnMark;
      },
      start: c => { save.turnMark = Math.floor(c.a.totals.turns / 500); },
      draw: (c, k, t) => f.sprite(BALLOON, Math.round(LANE + 1 + Math.sin(t / 900) * 2), Math.round(lerp(110, -12, k))),
    },
    { // the rain has stopped and the sun is out: a rainbow across the sky
      name: 'rainbow', len: 60000, every: 30 * MIN,
      when: c => !c.w.night && c.w.sky !== 'rain' && c.now - (save.events.rainEnded || 0) < 10 * MIN,
      draw: (c, k) => {
        const share = k < 0.2 ? k / 0.2 : k > 0.8 ? (1 - k) / 0.2 : 1;
        [9, 7, 5].forEach(r => { for (let a = 0; a <= 32; a++) { const th = Math.PI * a / 32; if (((a * 7 + r) % 10) / 10 < share) f.px(22 + Math.cos(th) * r, 10 - Math.sin(th) * r); } });
      },
    },
    { // after snow, while it is freezing: someone builds a snowman
      name: 'snowman', len: 6000, every: 12 * 60 * MIN,
      when: c => c.w.temp <= 1 && c.now - (save.events.snowed || 0) < 6 * 60 * MIN,
      end: c => { save.snowman = c.now; },
      draw: (c, k) => { const h = Math.round(SNOWMAN.length * k); f.sprite(SNOWMAN.slice(SNOWMAN.length - h), SNOWMAN_AT[0], SNOWMAN_AT[1] + SNOWMAN.length - h); },
    },
    { // the first light of the day: the rooster on the roof
      name: 'rooster', len: 8000, every: 0,
      when: c => { const s = clockMin(c.w.sunrise) >= 0 ? clockMin(c.w.sunrise) : 7 * 60; return !c.w.night && c.minutes >= s && c.minutes < s + 120 && save.events.rooster !== c.today; },
      start: c => { save.events.rooster = c.today; },
      draw: (c, k, t) => f.sprite(ROOSTER[Math.floor(t / 400) % 2], 3, 6),
    },
    { // a crow on a growing plant, pecking, until it is shooed off
      name: 'crow', len: 9000, every: 20 * MIN, mean: 40 * MIN,
      when: c => !c.w.night && !!growingPlant(),
      start: c => { const m = growingPlant(); const k = CORNERS[m.corner]; c.ev.at = [k.px, k.y + 1]; },
      draw: (c, k, t) => {
        const [px, py] = c.ev.at, flap = CROW[Math.floor(t / 150) % 2];
        if (k < 0.25) f.sprite(flap, Math.round(lerp(33, px, k / 0.25)), Math.round(lerp(-4, py, k / 0.25)));
        else if (k < 0.8) f.sprite(PERCH[Math.floor(t / 400) % 2], px, py);
        else f.sprite(flap, Math.round(lerp(px, -6, (k - 0.8) / 0.2)), Math.round(lerp(py, -4, (k - 0.8) / 0.2)));
      },
    },
    { // a warm, dry day: a butterfly over the patch
      name: 'butterfly', len: 8000, every: 10 * MIN, mean: 30 * MIN,
      when: c => !c.w.night && c.w.temp >= 12 && c.w.sky !== 'rain' && c.w.sky !== 'snow',
      draw: (c, k, t) => f.sprite(BUTTERFLY[Math.floor(t / 200) % 2], Math.round(lerp(-3, 33, k)), Math.round(50 + Math.sin(k * 12) * 6)),
    },
    { // a clear night: a shooting star
      name: 'star', len: 1500, every: 10 * MIN, mean: 30 * MIN,
      when: c => c.w.night && c.w.sky === 'clear',
      draw: (c, k) => { for (let i = 0; i < 4; i++) { const kk = k - i * 0.06; if (kk > 0 && kk < 1) f.px(lerp(30, 4, kk), lerp(0, 8, kk)); } },
    },
    { // a windy day: leaves blowing over the farm
      name: 'leaves', len: 6000, every: 15 * MIN, mean: 20 * MIN,
      when: c => c.w.wind >= 20 && c.w.sky !== 'snow',
      draw: (c, k, t) => [[30, 0], [55, 0.2], [80, 0.35], [45, 0.5]].forEach(([y, d]) => {
        const kk = (k - d) / 0.5;
        if (kk > 0 && kk < 1) { const x = lerp(-2, 33, kk), yy = y + Math.sin(t / 200 + y) * 2; f.px(x, yy); f.px(x + 1, yy + (Math.floor(t / 300) % 2)); }
      }),
    },
    { // at night someone who went home looks in now and then
      name: 'visitor', len: 10000, every: 30 * MIN, mean: 90 * MIN,
      when: c => c.w.night && (save.departed || 0) > 0,
      draw: (c, k, t) => fade(SOUL, Math.round(lerp(33, -8, k)), Math.round(28 + Math.sin(t / 500) * 2), 0.5),
    },
  ];

  let cur = null, nextCheck = 0;
  function events(c, t) {
    const ev = save.events = save.events || {};
    ev.last = ev.last || {};
    // what the weather did lately, for the rainbow and the snowman
    if (c.w.sky === 'rain' || c.w.sky === 'storm') ev.raining = true;
    else if (ev.raining) { ev.raining = false; ev.rainEnded = c.now; }
    if (c.w.sky === 'snow') ev.snowed = c.now;
    if (!cur && t >= nextCheck) {
      nextCheck = t + 5000;
      const pick = EVENTS.find(e => e.when(c) && c.now - (ev.last[e.name] || 0) >= e.every && (!e.mean || Math.random() < 5000 / e.mean));
      if (pick) { cur = { e: pick, at: t }; c.ev = cur; ev.last[pick.name] = c.now; if (pick.start) pick.start(c); }
    }
    if (!cur) return;
    c.ev = cur;
    const k = (t - cur.at) / cur.e.len;
    if (k >= 1) { if (cur.e.end) cur.e.end(c); cur = null; cartAway = false; return; }
    cur.e.draw(c, k, t);
  }

  // ---- the page ------------------------------------------------------------------
  let last = null;

  function scenery(a, w, t, dt) {
    sky(w, t, dt);
    // home: the house (snow on the roof, the flag after a merge, the window lit
    // with someone asleep inside or smoke when someone works indoors), the
    // porch, the cart with its load in rows of three
    house(tierOf('house'), 1, t);
    if (w.sky === 'snow') f.sprite(tierOf('house') === 2 ? ['...####...', '..#....#..'] : ['....##....', '..######..'], 0, 10);
    if (w.night || insideIdle || (a && a.laterIdle)) f.fill(windowAt()[0], windowAt()[1], 2, 1);
    if (insideBusy) { const [sx, sy] = smokeAt(); for (let i = 0; i < 3; i++) { const p = ((t / 900) + i / 3) % 1; f.px(sx + Math.round(Math.sin(p * 6 + i)), sy - Math.round(p * 7)); } }
    if ((save.flagUntil || 0) > Date.now()) { f.fill(9, 3, 1, 8); f.sprite(Math.floor(t / 600) % 2 ? ['###', '##.', '#..'] : ['##.', '###', '#..'], 10, 3); }
    for (let x = 10; x < 25; x++) f.px(x, 21);
    if (!cartAway) cart(tierOf('cart'), 25, Math.min(Math.floor((save.harvest || 0) / 3), 3), 1);
    // the lane, worn only at its ends: by the porch and at the gate
    [[15, 24], [14, 27], [16, 30]].forEach(([x, y]) => f.fill(x, y, 2, 1));
    [[13, 104], [16, 105], [14, 107], [17, 108], [15, 109]].forEach(([x, y]) => f.px(x, y));
    // the corners that belong to a project: a mound each
    Object.values(save.projects || {}).forEach(p => { if (p.corner !== undefined) { const c = CORNERS[p.corner]; f.sprite(['.###.'], c.px, c.y + 8); } });
    if (save.crater && Date.now() - save.crater < 6 * 60 * MIN) f.sprite(CRATER, IMPACT[0] - 4, IMPACT[1] - 1);
    // what the farm has earned stays: the scarecrow, a snowman while it lasts
    if ((save.unlocked || {}).scarecrow) f.sprite(SCARECROW, SCARECROW_AT[0], SCARECROW_AT[1]);
    if (save.snowman && Date.now() - save.snowman < 48 * 60 * MIN && w.temp <= 3) f.sprite(SNOWMAN, SNOWMAN_AT[0], SNOWMAN_AT[1]);
    // the gate in the middle, a stub of fence either side, the mailbox on the right one
    [[0, 9], [22, 31]].forEach(([x0, x1]) => { for (let x = x0; x <= x1; x++) { f.px(x, 122); f.px(x, 125); } f.fill(x0 + 1, 121, 1, 7); f.fill(x1 - 1, 121, 1, 7); });
    gate(tierOf('gate'), 1);
    if (a && a.laterWaiting) f.sprite(MAILBOX, 24, 111);
  }

  return function farm(d, t) {
    const dt = last === null ? 50 : Math.min(200, Math.max(0, t - last)); last = t;
    const a = d.agents, w = weatherOf(d);
    scenery(a, w, t, dt);
    if (!a) return;
    // the plants (one a family, at its corner), the children, then the
    // grown-ups in depth order
    mobs.forEach(m => {
      const c = CORNERS[m.corner];
      if (!c || !m.growing) return;
      const crop = project(m.r.name).crop;
      plant(m.ripe ? RIPE[crop] : STAGES[Math.min(Math.floor(workOf(m) / GROW_MS), STAGES.length - 1)], c.px, c.y + 7);
    });
    kids.forEach(c => child(c, t));
    [...mobs.values()].filter(m => !(m.indoors && !m.moving)).sort((p, q) => p.y - q.y).forEach(m => {
      const s = m.r.state, c = CORNERS[m.corner];
      m.side = c ? c.side : 1;
      const pose = m.moving ? 'walk' : m.watching ? 'stand' : s === 'working' ? 'water' : s === 'done' ? 'done' : s === 'idle' ? 'sleep' : 'stand';
      const top = creature(m, pose, t);
      if (s === 'waiting' && !m.moving && !m.leaving) f.tiny('?', Math.round(m.x) + 3, top - 6);
      if (m.leaving === 'gate' && m.carry) f.sprite(RIPE[project(m.r.name).crop].slice(0, 4), Math.round(m.x) + 2, top - 5);
    });

    const now = Date.now();
    events({ a, w, now, today: new Date(now).toDateString(), minutes: clockMin(d.sys.clock), ev: {} }, t);
  };
})());
