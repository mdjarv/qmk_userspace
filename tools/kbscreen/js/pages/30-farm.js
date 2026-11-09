// farm: the agent zoo. Every Agentique session is a creature on a farm, and
// where it stands says what it is doing: watering its crop bed while it works,
// at the fence with a ? when it asks, beside a ripe crop when it is done,
// asleep by the farmhouse when idle. A session another one started is its
// child; an archived one dies and its ghost rises. Weather, night and the
// events (cart, scarecrow, balloon, rainbow, crow...) go over everything. What
// lasts (crops, harvests, unlocks, cooldowns) is in kbscreen's save object.
'use strict';

page('farm', (function () {
  delete save.demo; // left by the design rounds

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
  const MINI_SOUL = ['.#.', '#.#', '###', '#.#'];
  const SOUL = ['..###..', '.#...#.', '#.#.#.#', '#.....#', '#..#..#', '#.....#', '#.#.#.#', '.#.#.#.'];
  const DUCKLING = ['.#.', '###'];
  const KINDS = Object.keys(CAST);
  // One kind per project, from its name.
  function kindOf(r) {
    if (r.kind) return r.kind;
    let h = 0;
    for (const c of r.name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return KINDS[h % KINDS.length];
  }
  const sleepRows = c => ['........', '........', '........', c.acc[0], c.acc[1], '.######.', '#..##..#', '########'];
  function seedOf(id) { let h = 7; for (const c of id) h = (h * 33 + c.charCodeAt(0)) % 9973; return h % 17; }
  function rng(s) { return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

  // ---- the farm ----------------------------------------------------------------
  const GROW_MS = 180000; // a stage of growth per 3 minutes of work, by the wall clock
  const BEDS = [22, 44, 66, 88]; // a creature's top at its bed; soil at + 8
  const STAGES = [['..#..'], ['.#.#.', '..#..'], ['#.#.#', '.###.', '..#..'], ['.#.#.', '#.#.#', '.###.', '..#..', '..#..']];
  const RIPE = {
    pumpkin: ['..#..', '.###.', '##.##', '#####', '.###.'],
    cabbage: ['.#.#.', '#.#.#', '#####', '#####', '.###.'],
    sunflower: ['.###.', '##.##', '.###.', '..#..', '.##..', '..##.', '..#..'],
  };
  const CROPS = Object.keys(RIPE);
  const cropOf = kind => CROPS[KINDS.indexOf(kind) % CROPS.length];
  const plant = (rows, x, soil) => f.sprite(rows, x, soil - rows.length + 1);
  const FARMHOUSE = ['....#####...', '...#######..', '..#########.', '.###########', '############', '.#........#.',
    '.#.##..##.#.', '.#.##..##.#.', '.#........#.', '.#..##....#.', '.#..##....#.', '############'];
  // Questions older than an hour: a mailbox at the fence with its flag up.
  const MAILBOX = ['.#####.', '#.....##', '#.###.##', '#.....#.', '.#####..', '...#....', '...#....', '...#....', '...#....'];
  const ASK = [[0, 114], [8, 114], [16, 114], [24, 114]]; // the mailbox, when up, hides the fourth
  const HOME = [24, 8]; // the farmhouse door

  // pose: walk, stand, sleep, water.
  function critter(kind, pose, x, y, t, sd) {
    const c = CAST[kind];
    x = Math.round(x); y = Math.round(y);
    if (pose === 'walk') f.sprite(Math.floor(t / 160 + sd) % 2 ? c.b : c.a, x, y);
    else if (pose === 'stand') f.sprite(Math.floor(t / 500 + sd) % 2 ? c.b : c.a, x, y);
    else if (pose === 'sleep') f.sprite(sleepRows(c), x, y);
    else { // a watering can, tipped now and then over the bed
      const ph = (t + sd * 137) % 1600;
      f.sprite(c.a, x, y);
      if (ph <= 900) { f.sprite(['.##..', '####.', '#####'], x + 7, y + 3); return; }
      f.sprite(['.##..', '#####', '####.', '....#'], x + 7, y + 3);
      const off = Math.floor((ph - 900) / 700 * 4);
      f.px(x + 12, y + 6 + off); f.px(x + 13, y + 4 + off);
    }
  }
  // Draws only a share (0..1) of a sprite's pixels, the same ones every frame,
  // so it dissolves rather than flickers.
  function fade(rows, x, y, share) {
    rows.forEach((r, yy) => { for (let xx = 0; xx < r.length; xx++) if (r[xx] === '#' && ((xx * 7 + yy * 13) % 10) / 10 < share) f.px(x + xx, y + yy); });
  }
  // Archived: it keels over, its ghost rises and thins out, the body fades.
  // 3.4 s in all; false once it is over.
  function departing(m, t) {
    const age = t - m.dying, x = Math.round(m.x), y = Math.round(m.y);
    if (age > 3400) return false;
    fade(sleepRows(CAST[m.kind]), x, y, age < 600 ? 1 : Math.max(0, 1 - (age - 600) / 1200));
    if (age >= 600) {
      const k = (age - 600) / 2800;
      fade(SOUL, x + Math.round(Math.sin(age / 300)), y - Math.round(k * Math.min(26, y + 2)), k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4);
    }
    return true;
  }
  const hop = (t, sd) => { const p = (t + sd * 911) % 2600; return p < 150 ? -1 : p < 300 ? -2 : p < 450 ? -1 : 0; };
  function zee(x, y, t, sd) { const p = ((t / 1800) + sd * 0.37) % 1; f.tiny('Z', x + Math.round(p * 2), y - Math.round(p * 5)); }
  // Walks m toward (tx, ty) at 16 px/s; true while it is still on its way.
  function walk(m, tx, ty, dt) {
    const dx = tx - m.x, dy = ty - m.y, dist = Math.hypot(dx, dy);
    if (dist <= 0.5) return false;
    const k = Math.min(1, dt * 0.016 / dist);
    m.x += dx * k; m.y += dy * k;
    return true;
  }
  // Picks a new spot in one of the boxes [x0, y0, x1, y1] now and then.
  function wander(m, dt, boxes) {
    const inside = boxes.some(b => m.tx >= b[0] && m.tx <= b[2] && m.ty >= b[1] && m.ty <= b[3]);
    if (inside && Math.hypot(m.tx - m.x, m.ty - m.y) > 0.5) return;
    m.pause -= dt;
    if (inside && m.pause > 0) return;
    const b = boxes[Math.floor(m.rand() * boxes.length)];
    m.tx = b[0] + Math.floor(m.rand() * (b[2] - b[0] + 1));
    m.ty = b[1] + Math.floor(m.rand() * (b[3] - b[1] + 1));
    m.pause = 1500 + m.rand() * 3000;
  }

  // ---- families ----------------------------------------------------------------
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
      adults.push({ id: p.id, name: p.name, state: p.state, parent: '', helpers: p.helpers || 0 });
    });
    return { adults, kids };
  }

  // ---- weather -----------------------------------------------------------------
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
      f.sprite(MOON, 2, 1);
      [[10, 2], [15, 6], [5, 10], [13, 12]].forEach(p => f.px(p[0], p[1]));
    } else if (!w.night && !clouded) {
      f.sprite(SUN, 2, 2);
      const r = Math.floor(t / 1000) % 2; // the rays turn, slowly
      (r ? [[4, 0], [4, 8], [0, 4], [8, 4]] : [[1, 1], [7, 1], [1, 7], [7, 7]]).forEach(p => f.px(p[0], p[1]));
    }
    const drift = 300 + 900 / (1 + w.wind / 10); // clouds drift with the wind
    if (clouded && w.sky !== 'fog') {
      f.sprite(CLOUD, Math.round((t / drift) % 44) - 12, 1);
      f.sprite(CLOUD, Math.round((t / (drift * 1.5) + 20) % 44) - 12, 8);
      if (w.sky === 'storm') f.sprite(CLOUD, Math.round((t / (drift * 1.2) + 32) % 44) - 12, 4);
    }
    if (w.sky === 'fog') // patches of haze drifting across, not lines
      [40, 58, 76, 94].forEach((y, i) => {
        const x = Math.round(((t / (900 + i * 300)) + i * 11) % 44) - 10;
        f.sprite(['##.##.##', '.##.##..'], x, y);
      });
    if (wet || w.sky === 'snow') {
      const snow = w.sky === 'snow', want = snow ? 10 : w.sky === 'storm' ? 12 : 7, slant = Math.min(w.wind / 40, 1);
      while (flakes.length < want) flakes.push({ x: Math.random() * (W + 10) - 10 * slant, y: 12 - Math.random() * 40, s: Math.random() });
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

  // ---- events ------------------------------------------------------------------
  // A short scene now and then, Johnny Castaway style. One at a time, checked
  // every 5 s. when(c) says it may start; every (ms, wall clock, kept in the
  // save) how long at least between two; mean, for the ambient ones, how long
  // on average after that, so they come unannounced. start(c) and end(c)
  // change the game; draw(c, k, t) draws it, k from 0 to 1 over len ms.
  // c: { a, w (weather), mobs, now (Date.now()), today, minutes (of the day), ev (the running one) }.
  const MIN = 60000;
  const CROW = [['#...#', '.#.#.', '..#..'], ['.....', '.#.#.', '#.#.#']];
  const PERCH = [['..##', '.###', '###.', '.#..'], ['....', '..##', '####', '.#..']];
  const BUTTERFLY = [['#.#', '.#.', '#.#'], ['.#.', '.#.', '.#.']];
  const CART = ['.......', '#######', '#.....#', '#######', '.#...#.'];
  const SCARECROW = ['..###..', '..#.#..', '..###..', '#######', '#..#..#', '..###..', '..###..', '...#...', '...#...', '...#...', '...#...'];
  const BALLOON = ['..###..', '.#####.', '#######', '##.#.##', '#######', '.#####.', '..###..', '..#.#..', '..#.#..', '..###..'];
  const SNOWMAN = ['.###.', '#.#.#', '#####', '.###.', '#####', '#####', '.###.'];
  const ROOSTER = [['.##..', '###..', '.####', '.###.', '..#..'], ['.##..', '###.#', '.####', '.###.', '..#..']];
  const lerp = (a, b, k) => a + (b - a) * Math.max(0, Math.min(1, k));
  const clockMin = s => (s && s.length >= 5 ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)) : -1);
  const growingBed = c => [...c.mobs.values()].find(m => m.bed !== undefined && !m.ripe);
  let hidePile = false;

  const EVENTS = [
    { // a full pile: the cart comes, loads it and goes; the farm sells a load
      name: 'cart', len: 10000, every: 0,
      when: () => (save.harvest || 0) >= 9,
      end: () => { save.harvest = Math.max(0, save.harvest - 9); save.sold = (save.sold || 0) + 1; },
      draw: (c, k) => {
        const x = k < 0.3 ? lerp(-8, 12, k / 0.3) : k < 0.7 ? 12 : lerp(12, 33, (k - 0.7) / 0.3);
        f.sprite(CART, Math.round(x), 101);
        if (k >= 0.5) f.sprite(['.#.#.#.'], Math.round(x), 100);
        hidePile = k >= 0.5;
      },
    },
    { // twenty harvests in all: a scarecrow goes up, and stays
      name: 'scarecrow', len: 5000, every: 0,
      when: () => (save.harvested || 0) >= 20 && !(save.unlocked || {}).scarecrow,
      end: () => { save.unlocked = Object.assign(save.unlocked || {}, { scarecrow: true }); },
      draw: (c, k) => { const h = Math.round(SCARECROW.length * k); f.sprite(SCARECROW.slice(0, h), 25, 112 - h); },
    },
    { // every 500 turns Agentique has run: a balloon goes up
      name: 'balloon', len: 20000, every: 0,
      when: c => {
        const n = Math.floor(c.a.totals.turns / 500);
        if (save.turnMark == null) save.turnMark = n; // count from the first sight, not from history
        return n > save.turnMark;
      },
      start: c => { save.turnMark = Math.floor(c.a.totals.turns / 500); },
      draw: (c, k, t) => f.sprite(BALLOON, Math.round(lerp(4, 16, k) + Math.sin(t / 900) * 2), Math.round(lerp(110, -12, k))),
    },
    { // the rain has stopped and the sun is out: a rainbow over the beds
      name: 'rainbow', len: 60000, every: 30 * MIN,
      when: c => !c.w.night && c.w.sky !== 'rain' && c.now - (save.events.rainEnded || 0) < 10 * MIN,
      draw: (c, k) => {
        const share = k < 0.2 ? k / 0.2 : k > 0.8 ? (1 - k) / 0.2 : 1;
        [9, 7, 5].forEach(r => { for (let a = 0; a <= 32; a++) { const th = Math.PI * a / 32; if (((a * 7 + r) % 10) / 10 < share) f.px(10 + Math.cos(th) * r, 22 - Math.sin(th) * r); } });
      },
    },
    { // after snow, while it is freezing: someone builds a snowman
      name: 'snowman', len: 6000, every: 12 * 60 * MIN,
      when: c => c.w.temp <= 1 && c.now - (save.events.snowed || 0) < 6 * 60 * MIN,
      end: c => { save.snowman = c.now; },
      draw: (c, k) => { const h = Math.round(SNOWMAN.length * k); f.sprite(SNOWMAN.slice(SNOWMAN.length - h), 13, 20 - h); },
    },
    { // the first light of the day: the rooster on the roof
      name: 'rooster', len: 8000, every: 0,
      when: c => { const s = clockMin(c.w.sunrise) >= 0 ? clockMin(c.w.sunrise) : 7 * 60; return !c.w.night && c.minutes >= s && c.minutes < s + 120 && save.events.rooster !== c.today; },
      start: c => { save.events.rooster = c.today; },
      draw: (c, k, t) => f.sprite(ROOSTER[Math.floor(t / 400) % 2], 24, 1),
    },
    { // a crow on a growing bed, pecking, until it is shooed off
      name: 'crow', len: 9000, every: 20 * MIN, mean: 40 * MIN,
      when: c => !c.w.night && !!growingBed(c),
      start: c => { c.ev.bed = growingBed(c).bed; },
      draw: (c, k, t) => {
        const ty = BEDS[c.ev.bed] + 2, flap = CROW[Math.floor(t / 150) % 2];
        if (k < 0.25) f.sprite(flap, Math.round(lerp(33, 22, k / 0.25)), Math.round(lerp(-4, ty, k / 0.25)));
        else if (k < 0.8) f.sprite(PERCH[Math.floor(t / 400) % 2], 22, ty);
        else f.sprite(flap, Math.round(lerp(22, -6, (k - 0.8) / 0.2)), Math.round(lerp(ty, -4, (k - 0.8) / 0.2)));
      },
    },
    { // a warm, dry day: a butterfly over the meadow
      name: 'butterfly', len: 8000, every: 10 * MIN, mean: 30 * MIN,
      when: c => !c.w.night && c.w.temp >= 12 && c.w.sky !== 'rain' && c.w.sky !== 'snow',
      draw: (c, k, t) => f.sprite(BUTTERFLY[Math.floor(t / 200) % 2], Math.round(lerp(-3, 33, k)), Math.round(40 + Math.sin(k * 12) * 6)),
    },
    { // a clear night: a shooting star
      name: 'star', len: 1500, every: 10 * MIN, mean: 30 * MIN,
      when: c => c.w.night && c.w.sky === 'clear',
      draw: (c, k) => { for (let i = 0; i < 4; i++) { const kk = k - i * 0.06; if (kk > 0 && kk < 1) f.px(lerp(30, 4, kk), lerp(1, 14, kk)); } },
    },
    { // a windy day: leaves blowing over the farm
      name: 'leaves', len: 6000, every: 15 * MIN, mean: 20 * MIN,
      when: c => c.w.wind >= 20 && c.w.sky !== 'snow',
      draw: (c, k, t) => [[20, 0], [55, 0.2], [80, 0.35], [35, 0.5]].forEach(([y, d]) => {
        const kk = (k - d) / 0.5;
        if (kk > 0 && kk < 1) { const x = lerp(-2, 33, kk), yy = y + Math.sin(t / 200 + y) * 2; f.px(x, yy); f.px(x + 1, yy + (Math.floor(t / 300) % 2)); }
      }),
    },
    { // at night the departed come back to look in, now and then
      name: 'visitor', len: 10000, every: 30 * MIN, mean: 90 * MIN,
      when: c => c.w.night && (save.departed || 0) > 0,
      draw: (c, k, t) => fade(SOUL, Math.round(lerp(33, -8, k)), Math.round(24 + Math.sin(t / 500) * 2), 0.5),
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
    hidePile = false;
    if (!cur && t >= nextCheck) {
      nextCheck = t + 5000;
      const pick = EVENTS.find(e => e.when(c) && c.now - (ev.last[e.name] || 0) >= e.every && (!e.mean || Math.random() < 5000 / e.mean));
      if (pick) { cur = { e: pick, at: t }; c.ev = cur; ev.last[pick.name] = c.now; if (pick.start) pick.start(c); }
    }
    if (!cur) return;
    c.ev = cur;
    const k = (t - cur.at) / cur.e.len;
    if (k >= 1) { if (cur.e.end) cur.e.end(c); cur = null; return; }
    cur.e.draw(c, k, t);
  }

  // ---- the simulation ------------------------------------------------------------
  // tick() runs every frame whichever page shows, so the farm keeps going
  // behind perf and music: sessions get their beds, plants grow (timed by the
  // wall clock, so through a suspend too), crops are harvested, creatures
  // walk. The page only draws what tick left.
  const mobs = new Map(), kidMobs = new Map();
  let lastTick = null, insideBusy = 0, insideIdle = 0;
  const workOf = m => (m.workMs || 0) + (m.since ? Date.now() - m.since : 0);

  // A family works one bed: busy while anyone in it works, ripe once nobody
  // works and someone is done, harvested when all of it has been seen. The
  // bed and its growth are kept in the save.
  function beds(a, kids) {
    save.harvest = save.harvest || 0;
    save.crops = save.crops || {};
    const taken = new Set(), kidsOf = new Map();
    kids.forEach(k => { if (!kidsOf.has(k.family)) kidsOf.set(k.family, []); kidsOf.get(k.family).push(k); });
    mobs.forEach((m, id) => {
      const ks = kidsOf.get(id) || [], st = m.r.state;
      const busy = !m.dying && !m.home && (st === 'working' || ks.some(k => k.state === 'working'));
      const ripe = !m.dying && !m.home && !busy && (st === 'done' || ks.some(k => k.state === 'done'));
      if (busy && !m.since) m.since = Date.now();
      if (!busy && m.since) { m.workMs = workOf(m); m.since = 0; }
      m.busy = busy;
      if (m.bed !== undefined && !busy && !ripe) {
        if (m.ripe) { save.harvest++; save.harvested = (save.harvested || 0) + 1; }
        m.bed = undefined; m.workMs = 0; m.ripe = false;
      }
      if (m.bed !== undefined) { m.ripe = ripe; taken.add(m.bed); }
    });
    mobs.forEach(m => { if (m.busy && m.bed === undefined) for (let s = 0; s < BEDS.length; s++) if (!taken.has(s)) { m.bed = s; taken.add(s); break; } });
    const live = new Set((a.sessions || []).map(s => s.id));
    Object.keys(save.crops).forEach(id => { if (!live.has(id) && !mobs.has(id)) delete save.crops[id]; });
    mobs.forEach((m, id) => {
      if (m.bed === undefined) delete save.crops[id];
      else save.crops[id] = { bed: m.bed, workMs: Math.round(m.workMs || 0), since: m.since || 0, ripe: !!m.ripe };
    });
  }

  // Where every grown-up goes: askers to the fence (a second rank behind the
  // first when there are more than four), workers to their bed, a family with
  // no free bed works indoors, two sleepers outside the house and the rest
  // inside, a parent whose children work stands at its bed.
  function places(by, dt) {
    by.waiting.forEach((r, i) => { const m = mobs.get(r.id); m.tx = i < 4 ? ASK[i][0] : (i - 4) * 8 + 4; m.ty = i < 4 ? ASK[i][1] : 104; });
    by.idle.filter(r => mobs.get(r.id).bed === undefined).forEach((r, i) => {
      const m = mobs.get(r.id);
      if (i < 2) { m.tx = i * 8; m.ty = 12; } else { m.tx = HOME[0]; m.ty = HOME[1]; m.indoors = true; }
    });
    insideBusy = 0; insideIdle = 0;
    mobs.forEach(m => {
      const s = m.r.state;
      m.pose = undefined;
      if (m.dying || m.home) return;
      if (s !== 'idle') m.indoors = false;
      if (s === 'waiting') return;
      if (m.bed === undefined) {
        if (s === 'working' || s === 'done') { m.tx = HOME[0]; m.ty = HOME[1]; m.indoors = true; }
        return;
      }
      m.tx = 1; m.ty = BEDS[m.bed];
      if (s === 'idle') m.pose = 'stand';
    });
  }

  // The children: on the path under their family's plant while it is worked,
  // at the fence when they ask, curled up by their parent when idle, and a
  // small ghost when archived.
  function kidPlaces(a, kids, waitingAdults, t) {
    const seen = new Set(), gone = new Map((a.sessions || []).map(s => [s.id, s.state]));
    let waitAt = Math.min(waitingAdults, 4) * 8;
    const slotOf = new Map(), idleOf = new Map();
    kids.forEach(k => {
      seen.add(k.id);
      const p = mobs.get(k.family);
      let c = kidMobs.get(k.id);
      if (!c) { c = { x: p ? p.x + 2 : HOME[0], y: p ? p.y + 3 : HOME[1] + 2, sd: seedOf(k.id) }; kidMobs.set(k.id, c); }
      c.k = k; c.kind = k.kind;
      if (k.state === 'waiting') { c.tx = Math.min(waitAt, 27); c.ty = 116; waitAt += 6; }
      else if (p && p.bed !== undefined && k.state !== 'idle') {
        const j = slotOf.get(k.family) || 0; slotOf.set(k.family, j + 1);
        c.tx = 12 + (j % 4) * 5; c.ty = BEDS[p.bed] + 11 + Math.min(Math.floor(j / 4), 1) * 6; // four to a line, two lines
      } else if (p) {
        const j = idleOf.get(k.family) || 0; idleOf.set(k.family, j + 1);
        c.tx = Math.min(Math.round(p.tx) + 9 + j * 5, 27); c.ty = p.ty + 3;
      } else { c.tx = 12; c.ty = 16; }
    });
    kidMobs.forEach((c, id) => {
      if (seen.has(id) || c.dying) return;
      if (gone.get(id) === 'archived') c.dying = t; else kidMobs.delete(id);
    });
  }

  tick(function farmTick(d, t) {
    const dt = lastTick === null ? 50 : Math.min(200, Math.max(0, t - lastTick)); lastTick = t;
    const a = d.agents;
    if (!a) return;
    const { adults, kids } = families(a);
    const by = { working: [], waiting: [], done: [], idle: [] }, seen = new Set();
    adults.forEach(r => {
      by[r.state].push(r); seen.add(r.id);
      let m = mobs.get(r.id);
      if (!m) { // from the farmhouse, back to the bed the save says it had
        const sd = seedOf(r.id), c = (save.crops || {})[r.id];
        m = { x: HOME[0], y: HOME[1], tx: HOME[0], ty: HOME[1], pause: 0, rand: rng(sd + 3), sd, kind: kindOf(r) };
        if (c) { m.bed = c.bed; m.workMs = c.workMs || c.work || 0; m.since = c.since || 0; m.ripe = c.ripe; }
        mobs.set(r.id, m);
      }
      m.r = r;
    });
    // off the rows: archived, it dies; otherwise (parked, or quiet) it goes home
    const gone = new Map((a.sessions || []).map(s => [s.id, s.state]));
    mobs.forEach((m, id) => {
      if (seen.has(id) || m.dying || m.home) return;
      if (gone.get(id) === 'archived') { m.dying = t; save.departed = (save.departed || 0) + 1; }
      else { m.home = true; m.tx = HOME[0]; m.ty = HOME[1]; }
    });
    beds(a, kids);
    places(by, dt);
    mobs.forEach(m => {
      m.moving = !m.dying && walk(m, m.tx, m.ty, dt);
      if (m.home && !m.moving) mobs.delete(m.r.id);
      if (m.dying && t - m.dying > 3400) mobs.delete(m.r.id);
      if (m.indoors && !m.moving && !m.dying) { if (m.r.state === 'idle') insideIdle++; else insideBusy++; }
    });
    kidPlaces(a, kids, by.waiting.length, t);
    kidMobs.forEach((c, id) => {
      if (c.dying) { if (t - c.dying > 2600) kidMobs.delete(id); return; }
      c.moving = walk(c, c.tx, c.ty, dt);
    });
  });

  // ---- the page ------------------------------------------------------------------
  let last = null;

  function scenery(a, w, t, dt) {
    sky(w, t, dt);
    f.sprite(FARMHOUSE, 20, 8);
    if (w.night || insideIdle) f.fill(22, 14, 2, 2); // the lamp is on: night, or someone asleep inside
    if (insideBusy) for (let i = 0; i < 3; i++) { const p = ((t / 900) + i / 3) % 1; f.px(29 + Math.round(Math.sin(p * 6 + i)), 7 - Math.round(p * 7)); } // smoke: working indoors
    if (w.sky === 'snow') for (let x = 21; x < 32; x++) f.px(x, 7 + Math.abs(x - 26) / 2 | 0);
    // what the farm has earned stays: the scarecrow, a snowman while it lasts
    if ((save.unlocked || {}).scarecrow) f.sprite(SCARECROW, 25, 101);
    if (save.snowman && Date.now() - save.snowman < 48 * 60 * MIN && w.temp <= 3) f.sprite(SNOWMAN, 13, 13);
    // the harvest pile beside the house, a dot per crop brought in
    const n = hidePile ? 0 : Math.min(save.harvest || 0, 9);
    for (let k = 0; k < n; k++) f.fill(17 - (k % 3) * 2, 18 - Math.floor(k / 3) * 2, 1, 1);
    if (a && (a.laterIdle || insideIdle)) zee(26, 3, t, 3);
    // the fence, and the mailbox at the gate
    for (let x = 0; x < W; x++) { f.px(x, 123); f.px(x, 126); }
    for (let x = 1; x < W; x += 5) f.fill(x, 122, 1, 6);
    if (a && a.laterWaiting) f.sprite(MAILBOX, 24, 113);
    BEDS.forEach(y => { for (let x = 12; x < 31; x += 2) f.px(x, y + 9); });
  }

  function drawKids(t) {
    kidMobs.forEach(c => {
      const x = Math.round(c.x), y = Math.round(c.y), rows = MINI[c.kind] || MINI.blob;
      if (c.dying) {
        const age = t - c.dying;
        fade(MINI_SLEEP, x, y, age < 400 ? 1 : Math.max(0, 1 - (age - 400) / 900));
        if (age >= 400) { const k = (age - 400) / 2200; fade(MINI_SOUL, x + 1, y - Math.round(k * Math.min(16, y + 2)), k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4); }
        return;
      }
      const s = c.k.state;
      if (c.moving) { f.sprite(rows, x, y + (Math.floor(t / 160 + c.sd) % 2)); return; }
      if (s === 'working') { // bobbing under its plant, flicking a drop up now and then
        f.sprite(rows, x, y + (Math.floor(t / 400 + c.sd) % 2));
        const p = (t + c.sd * 97) % 1200;
        if (p < 400) f.px(x + 2, y - 2 - Math.floor(p / 200));
      } else if (s === 'waiting') { f.sprite(rows, x, y); f.tiny('?', x + 1, y - 6); }
      else if (s === 'done') f.sprite(rows, x, y + hop(t, c.sd));
      else f.sprite(MINI_SLEEP, x, y);
    });
  }

  // For the layout round in 50-round.js; goes when the round is decided.
  globalThis.FARM = { CAST, MINI, MINI_SLEEP, MINI_SOUL, DUCKLING, STAGES, RIPE, FARMHOUSE, MAILBOX, ASK, HOME,
    kindOf, sleepRows, seedOf, rng, critter, fade, departing, hop, zee, walk, wander, families, weatherOf, sky, cropOf, plant };

  return function farm(d, t) {
    const dt = last === null ? 50 : Math.min(200, Math.max(0, t - last)); last = t;
    const a = d.agents, w = weatherOf(d);
    scenery(a, w, t, dt);
    if (!a) return;
    // the crops (one plant a bed, watered from the left), the children, the
    // ducklings, then the grown-ups in depth order
    mobs.forEach(m => {
      if (m.bed === undefined) return;
      const soil = BEDS[m.bed] + 8;
      if (m.ripe) plant(RIPE[cropOf(m.kind)], 10, soil);
      else plant(STAGES[Math.min(Math.floor(workOf(m) / GROW_MS), STAGES.length - 1)], 10, soil);
    });
    drawKids(t);
    const shown = [...mobs.values()].filter(m => !(m.indoors && !m.moving));
    shown.forEach(m => { // subagents running inside a turn: ducklings hopping over its head
      const n = Math.min(m.r.helpers || 0, 3);
      for (let i = 0; i < n; i++) f.sprite(DUCKLING, Math.round(m.x) + i * 3 - 1 + (n === 1 ? 2 : 0), Math.round(m.y) - 3 + (Math.floor(t / 250 + i) % 2 ? -1 : 0));
    });
    shown.sort((p, q) => p.y - q.y).forEach(m => {
      const s = m.r.state;
      if (m.dying) departing(m, t);
      else if (m.moving) critter(m.kind, 'walk', m.x, m.y, t, m.sd);
      else if (m.pose) critter(m.kind, m.pose, m.x, m.y, t, m.sd);
      else if (s === 'waiting') { critter(m.kind, 'stand', m.x, m.y, t, m.sd); f.tiny('?', Math.round(m.x) + 3, Math.round(m.y) - 6); }
      else if (s === 'working') critter(m.kind, 'water', m.x, m.y, t, m.sd);
      else if (s === 'done') critter(m.kind, 'stand', m.x, m.y + hop(t, m.sd), t, m.sd);
      else { critter(m.kind, 'sleep', m.x, m.y, t, m.sd); zee(m.x + 6, m.y + 2, t, m.sd); }
    });

    const now = Date.now();
    events({ a, w, mobs, now, today: new Date(now).toDateString(), minutes: clockMin(d.sys.clock), ev: {} }, t);
  };
})());
