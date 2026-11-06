// The agent zoo: a farm where every Agentique session is a creature. 'farm'
// shows the live sessions and is the page that comes up by itself;
// 'farmdemo' runs a scripted fleet through every state, deaths included, with
// the weather cycling; 'plots' is the building-site take, on the demo fleet.
'use strict';

(function () {
// ---- demo fleet: 64 s a loop, typical (24 s), busy (24 s), quiet (16 s) -----
const SCENES = [
  { len: 24, later: [0, '', 2], rows: [
    ['q', 'QMK', 'bot', [[0, 'working'], [8, 'waiting'], [16, 'done']], { helpers: 2 }],
    ['p', 'PINT', 'cat', [[0, 'waiting'], [5, 'working'], [14, 'done'], [20, 'idle']]],
    ['s', 'SEISI', 'bun', [[0, 'working']]],
    ['g', 'AGENT', 'ghost', [[0, 'idle']]],
    ['b', 'CINDE', 'blob', [[0, 'done'], [11, 'idle'], [17, 'archived']]],
    // a lead that waits on three workers of its own
    ['t', 'TJANS', 'frog', [[0, 'idle']]],
    ['t1', 'TJANS', 'frog', [[0, 'working'], [16, 'done']], { parent: 't' }],
    ['t2', 'TJANS', 'frog', [[0, 'working'], [8, 'waiting'], [13, 'working']], { parent: 't' }],
    ['t3', 'TJANS', 'frog', [[0, 'working'], [19, 'archived']], { parent: 't' }],
  ] },
  { len: 24, later: [3, '2D', 7], rows: [
    ['q', 'QMK', 'bot', [[0, 'working'], [6, 'waiting'], [14, 'working']]],
    ['p', 'PINT', 'cat', [[0, 'waiting']]],
    ['s', 'SEISI', 'bun', [[0, 'working']]],
    ['g', 'AGENT', 'ghost', [[0, 'working'], [10, 'done']]],
    ['b', 'CINDE', 'blob', [[0, 'idle']]],
    ['h', 'HITTA', 'mush', [[0, 'idle'], [12, 'working']]],
    ['k', 'KBFLA', 'frog', [[0, 'working'], [18, 'waiting']]],
    ['d', 'DO', 'hat', [[0, 'done'], [12, 'archived']]],
  ] },
  { len: 16, later: [0, '', 4], rows: [] },
];
const LOOP = SCENES.reduce((s, c) => s + c.len, 0);
function demoAgents(t) {
  let s = (t / 1000) % LOOP, scene = SCENES[0];
  for (const c of SCENES) { if (s < c.len) { scene = c; break; } s -= c.len; }
  const n0 = SCENES.indexOf(scene);
  const all = scene.rows.map(([id, name, kind, tl, x]) => {
    let state = tl[0][1], since = tl[0][0];
    tl.forEach(([at, st]) => { if (s >= at) { state = st; since = at; } });
    x = x || {};
    return { id: id + n0, name, kind, state, since, parent: x.parent ? x.parent + n0 : '', helpers: state === 'working' ? x.helpers || 0 : 0 };
  }).sort((a, b) => b.since - a.since);
  const rows = all.filter(r => r.state !== 'archived');
  const n = st => rows.filter(r => r.state === st).length;
  return { rows, running: n('working'), waiting: n('waiting') + scene.later[0], laterWaiting: scene.later[0],
    oldestWait: scene.later[1], laterIdle: scene.later[2], newQuestion: n('waiting') > 0,
    sessions: all, totals: { sessions: 677, turns: 3945, archived: 647, merged: 214, models: 8 } };
}
const agentsOf = (d, t, demo) => (demo ? demoAgents(t) : d.agents);
// The game's own state, kept by kbscreen across reloads and restarts. The demo
// plays in a corner of its own so it never touches the real farm.
const game = demo => (demo ? (save.demo = save.demo || {}) : save);

// ---- the cast: 8x8, front-on, two idle frames each --------------------------
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
  ghost: { a: ['..####..', '.######.', '##.##.##', '########', '########', '########', '########', '#.#..#.#'],
           b: ['........', '..####..', '.######.', '##.##.##', '########', '########', '########', '.#.##.#.'],
           acc: ['........', '..####..'] },
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
const KINDS = Object.keys(CAST);
function kindOf(r) {
  if (r.kind) return r.kind;
  let h = 0;
  for (const c of r.name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return KINDS[h % KINDS.length];
}
const sleepRows = c => ['........', '........', '........', c.acc[0], c.acc[1], '.######.', '#..##..#', '########'];
function seedOf(id) { let h = 7; for (const c of id) h = (h * 33 + c.charCodeAt(0)) % 9973; return h % 17; }
function rng(s) { return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

// pose: walk, stand, sleep, work (dir: the side the hammer is on).
// Returns true on the frame a hammer lands.
function critter(kind, pose, x, y, t, sd, dir) {
  const c = CAST[kind];
  x = Math.round(x); y = Math.round(y);
  if (pose === 'walk') { f.sprite(Math.floor(t / 160 + sd) % 2 ? c.b : c.a, x, y); return false; }
  if (pose === 'stand') { f.sprite(Math.floor(t / 500 + sd) % 2 ? c.b : c.a, x, y); return false; }
  if (pose === 'sleep') { f.sprite(sleepRows(c), x, y); return false; }
  if (pose === 'water') { // a watering can, tipped now and then over the bed
    const ph = (t + sd * 137) % 1600, tip = ph > 900;
    f.sprite(c.a, x, y);
    if (!tip) { f.sprite(['.##..', '####.', '#####'], x + 7, y + 3); return false; }
    f.sprite(['.##..', '#####', '####.', '....#'], x + 7, y + 3);
    const off = Math.floor((ph - 900) / 700 * 4);
    f.px(x + 12, y + 6 + off); f.px(x + 13, y + 4 + off);
    return false;
  }
  const ph = (t + sd * 137) % 700, struck = ph > 480, rows = struck ? c.b : c.a;
  f.sprite(rows, x, y);
  // a hard hat over the top of the head
  const top = rows.findIndex(r => r.includes('#')) + y;
  f.fill(x, top - 1, 8, 2, false);
  f.sprite(['..####..', '########'], x, top - 1);
  if (struck) { if (dir > 0) f.sprite(['...#', '####', '...#'], x + 8, y + 3); else f.sprite(['#...', '####', '#...'], x - 4, y + 3); }
  else if (dir > 0) f.sprite(['###', '.#.', '.#.'], x + 6, y - 2);
  else f.sprite(['###', '.#.', '.#.'], x - 1, y - 2);
  return struck && ph < 530;
}
// Draws only a share (0..1) of a sprite's pixels, the same ones every frame,
// so it dissolves rather than flickers.
function fade(rows, x, y, share) {
  rows.forEach((r, yy) => { for (let xx = 0; xx < r.length; xx++) if (r[xx] === '#' && ((xx * 7 + yy * 13) % 10) / 10 < share) f.px(x + xx, y + yy); });
}
const SOUL = ['..###..', '.#...#.', '#.#.#.#', '#.....#', '#..#..#', '#.....#', '#.#.#.#', '.#.#.#.'];
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
function chipper() {
  const list = [];
  return {
    hit(x, y, dir) { for (let i = 0; i < 2; i++) list.push({ x, y, vx: dir * (6 + i * 9), vy: -14 - i * 8, age: 0 }); },
    draw(dt, floor) {
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i];
        c.age += dt; c.vy += 60 * dt / 1000; c.x += c.vx * dt / 1000; c.y += c.vy * dt / 1000;
        if (c.age > 700 || c.y > floor) { list.splice(i, 1); continue; }
        f.px(c.x, c.y);
      }
    },
  };
}
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
function fence(y) { // a site barrier: rails with diagonal stripes, on legs
  for (let x = 0; x < W; x++) {
    f.px(x, y); f.px(x, y + 3);
    for (let r = 1; r < 3; r++) if ((x + r) % 6 < 3) f.px(x, y + r);
  }
  [2, 13, 18, 29].forEach(x => f.fill(x, y + 4, 1, 2));
}
// Questions older than an hour: a mailbox at the fence with its flag up.
const MAILBOX = ['.#####.', '#.....##', '#.###.##', '#.....#.', '.#####..', '...#....', '...#....', '...#....', '...#....'];
function mailbox(a, y) { if (a.laterWaiting) f.sprite(MAILBOX, 24, y); }
// The site cabin, where idle sessions rest; the older ones are counted inside.
const CABIN = ['############', '#..........#', '#.###......#', '#.#.#......#', '#.###......#', '#..........#', '############', '.##......##.'];
function cabin(a, t) {
  f.sprite(CABIN, 20, 2);
  if (a && a.laterIdle) { f.tiny(String(Math.min(a.laterIdle, 9)), 27, 3); zee(26, 0, t, 3); }
}

// A site: one creature per row, kept between frames, placed by a layout.
// layout(a, by, mobs, dt) sets every m.tx, m.ty (and m.dir, m.hit for
// workers); under(a, mobs, t, dt) draws what the creatures stand in front of.
// Every page counts turns finished (working -> done) in built.
function site(name, scenery, layout, under, opts) {
  opts = opts || {};
  const tool = opts.tool || 'work';
  const mobs = new Map(), chips = chipper(), st = { built: 0 };
  let last = null;
  page(name, function (d, t) {
    const dt = last === null ? 50 : Math.min(200, Math.max(0, t - last)); last = t;
    let a = agentsOf(d, t, opts.demo);
    if (a && opts.prepare) a = opts.prepare(a);
    st.d = d; st.dt = dt;
    scenery(a, t, st);
    if (!a) return;
    const by = { working: [], waiting: [], done: [], idle: [] }, seen = new Set();
    a.rows.forEach(r => {
      by[r.state].push(r); seen.add(r.id);
      let m = mobs.get(r.id);
      if (!m) {
        const sd = seedOf(r.id);
        m = { x: 24, y: 8, tx: 24, ty: 8, dir: 1, pause: 0, rand: rng(sd + 3), sd, kind: kindOf(r) };
        mobs.set(r.id, m);
        if (opts.born) opts.born(m, r, st);
      } else if (m.r.state === 'working' && r.state === 'done') st.built++;
      m.r = r;
    });
    // Off the rows: archived, it dies; otherwise (parked, or old) it goes home.
    const gone = new Map((a.sessions || []).map(s => [s.id, s.state]));
    mobs.forEach((m, id) => {
      if (seen.has(id) || m.dying || m.home) return;
      if (gone.get(id) === 'archived') { m.dying = t; if (opts.died) opts.died(m, st); }
      else { m.home = true; m.tx = 24; m.ty = 8; }
    });
    layout(a, by, mobs, dt, st);
    const list = [...mobs.values()];
    list.forEach(m => { m.moving = !m.dying && walk(m, m.tx, m.ty, dt); if (m.home && !m.moving) mobs.delete(m.r.id); });
    if (under) under(a, mobs, t, dt, st);
    list.sort((p, q) => p.y - q.y).forEach(m => {
      const s = m.r.state;
      if (m.dying) { if (!departing(m, t)) mobs.delete(m.r.id); }
      else if (m.moving) critter(m.kind, 'walk', m.x, m.y, t, m.sd);
      else if (m.pose) critter(m.kind, m.pose, m.x, m.y, t, m.sd);
      else if (s === 'waiting') { critter(m.kind, 'stand', m.x, m.y, t, m.sd); f.tiny('?', Math.round(m.x) + 3, Math.round(m.y) - 6); }
      else if (s === 'working') { if (critter(m.kind, tool, m.x, m.y, t, m.sd, m.dir) && m.hit) chips.hit(m.hit[0], m.y + 4, m.hit[1]); }
      else if (s === 'done') critter(m.kind, 'stand', m.x, m.y + hop(t, m.sd), t, m.sd);
      else { critter(m.kind, 'sleep', m.x, m.y, t, m.sd); zee(m.x + 6, m.y + 2, t, m.sd); }
    });
    chips.draw(dt, 128);
  });
}
function slots(by, mobs, state, places, overflow) {
  by[state].forEach((r, i) => {
    const m = mobs.get(r.id), p = places[i] || overflow(i);
    m.tx = p[0]; m.ty = p[1]; m.dir = p[2] || 1; m.hit = p[3];
  });
}
const ASK = [[0, 114], [8, 114], [16, 114], [24, 114]]; // the mailbox, when up, hides the fourth
const SLEEP = [[0, 4], [9, 4], [0, 14], [9, 14], [18, 14]];
const asking = (by, mobs) => slots(by, mobs, 'waiting', ASK, i => [(i - 4) * 8 + 4, 100]);
const resting = (by, mobs) => slots(by, mobs, 'idle', SLEEP, i => [(i - 5) * 9, 24]);
const common = (a, t) => { fence(122); cabin(a, t); if (a) mailbox(a, 113); };

// ---- C1: plots -------------------------------------------------------------
// Each worker builds its own house on a plot, a course of bricks a minute
// (1.5 s in the demo). Done, it stands on the roof; a question leaves the
// house standing; idle, the plot is cleared.
const COURSE_MS = 1500, COURSES = 8;
const PLOTS = [[0, 58], [17, 58], [0, 90], [17, 90]];
site('plots', (a, t) => {
  common(a, t);
  PLOTS.forEach(s => { for (let x = s[0]; x < s[0] + 15; x += 2) f.px(x, s[1] + 8); });
}, (a, by, mobs, dt) => {
  const taken = new Set();
  mobs.forEach(m => { if (m.r.state === 'idle') { m.plot = undefined; m.work = 0; } if (m.plot !== undefined) taken.add(m.plot); });
  by.working.forEach(r => {
    const m = mobs.get(r.id);
    if (m.plot === undefined) for (let s = 0; s < PLOTS.length; s++) if (!taken.has(s)) { m.plot = s; taken.add(s); break; }
  });
  asking(by, mobs); resting(by, mobs);
  mobs.forEach(m => {
    const s = m.r.state;
    if (m.dying || m.home || (s !== 'working' && s !== 'done')) return;
    if (m.plot === undefined) { wander(m, dt, [[0, 26, 23, 40]]); return; }
    const p = PLOTS[m.plot], n = Math.min(COURSES, Math.floor((m.work || 0) / COURSE_MS));
    if (s === 'working') { m.tx = p[0]; m.ty = p[1]; m.dir = 1; m.hit = [p[0] + 9, -1]; if (!m.moving) m.work = (m.work || 0) + dt; }
    else { m.tx = p[0] + 8; m.ty = p[1] - n * 2; }
  });
}, (a, mobs) => {
  mobs.forEach(m => {
    if (m.plot === undefined) return;
    const p = PLOTS[m.plot], n = Math.min(COURSES, Math.floor((m.work || 0) / COURSE_MS)), base = p[1] + 8;
    for (let k = 0; k < n; k++) { f.sprite(['######', '#.##.#'], p[0] + 9, base - 2 - k * 2); }
  });
}, { demo: true });

// ---- F: the farm -----------------------------------------------------------
// One bed per working session: it waters, the plants grow (a stage every
// 1.5 s in the demo, a few minutes live). Done, the crop is ripe and waits
// for you; once you have looked (idle), it is harvested onto the pile by the
// farmhouse and the bed is cleared. A bed and its growth are kept in the save,
// so a reload or a restart leaves the crops standing. The sky follows the real
// clock; until there is a weather source the live farm has fair weather and
// the demo cycles through all of it.
const BEDS = [30, 52, 74, 96].map(y => y - 8); // creature top; soil at y + 8
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
const MOON = ['.###.', '##...', '#....', '##...', '.###.'];
const SUN = ['.###.', '#####', '#####', '#####', '.###.'];
const CLOUD = ['...###....', '.##...##..', '#.......##', '##########'];

// Simulated weather, 80 s a loop: sun, cloud, rain, snow, a clear night.
const SKIES = ['sun', 'cloud', 'rain', 'snow', 'night'];
function weatherOf(d, t, demo) {
  const sim = demo ? SKIES[Math.floor(t / 16000) % SKIES.length] : 'sun';
  const h = Number(d.sys && d.sys.clock ? d.sys.clock.slice(0, 2) : 12);
  return { sky: sim, night: sim === 'night' || h >= 21 || h < 6 };
}
const flakes = [];
function sky(w, t, dt) {
  if (w.night) {
    f.sprite(MOON, 2, 1);
    [[10, 2], [15, 6], [5, 10], [13, 12]].forEach(p => f.px(p[0], p[1]));
  } else if (w.sky === 'sun') {
    f.sprite(SUN, 2, 2);
    const r = Math.floor(t / 1000) % 2; // the rays turn, slowly
    (r ? [[4, 0], [4, 8], [0, 4], [8, 4]] : [[1, 1], [7, 1], [1, 7], [7, 7]]).forEach(p => f.px(p[0], p[1]));
  }
  if (w.sky === 'cloud' || w.sky === 'rain' || w.sky === 'snow') {
    f.sprite(CLOUD, Math.round(((t / 400) % 44)) - 12, 1);
    f.sprite(CLOUD, Math.round(((t / 600 + 20) % 44)) - 12, 8);
  }
  if (w.sky === 'rain' || w.sky === 'snow') {
    const snow = w.sky === 'snow', want = snow ? 10 : 7;
    while (flakes.length < want) flakes.push({ x: Math.random() * W, y: 12 - Math.random() * 40, s: Math.random() });
    for (let i = flakes.length - 1; i >= 0; i--) {
      const p = flakes[i];
      p.y += dt * (snow ? 0.012 : 0.07);
      if (snow) p.x += Math.sin(t / 700 + p.s * 6) * 0.15;
      if (p.y > 121) { flakes.splice(i, 1); continue; }
      f.px(p.x, p.y);
      if (!snow) f.px(p.x, p.y + 1);
    }
  } else flakes.length = 0;
}

// ---- families --------------------------------------------------------------
// A session another one started (a worker in a channel) is that one's child:
// a 5x5 of the parent's kind that works the family's bed beside it.
const MINI = {
  bun: ['.#.#.', '.###.', '#.#.#', '#####', '.#.#.'],
  bot: ['..#..', '#####', '#.#.#', '#####', '.#.#.'],
  cat: ['#...#', '#####', '#.#.#', '#####', '.#.#.'],
  ghost: ['.###.', '#####', '#.#.#', '#####', '#.#.#'],
  mush: ['.###.', '#####', '.#.#.', '.###.', '.#.#.'],
  frog: ['##.##', '#.#.#', '#####', '#...#', '##.##'],
  hat: ['.###.', '#####', '.#.#.', '.###.', '.#.#.'],
  blob: ['.....', '.###.', '#.#.#', '#####', '#####'],
};
const MINI_SLEEP = ['.....', '.....', '.....', '.###.', '#####'];
const MINI_SOUL = ['.#.', '#.#', '###', '#.#'];
const DUCKLING = ['.#.', '###'];

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
    adults.push({ id: p.id, name: p.name, state: p.state, parent: '', helpers: p.helpers || 0, kind: p.kind });
  });
  return Object.assign({}, a, { rows: adults, kids });
}

function farm(name, demo) {
const kidMobs = new Map();
const GROW_MS = demo ? 1500 : 180000;
site(name, (a, t, st) => {
  const w = weatherOf(st.d, t, demo);
  sky(w, t, st.dt || 50);
  f.sprite(FARMHOUSE, 20, 8);
  if (w.night) f.fill(22, 14, 2, 2); // the lamp is on
  if (w.sky === 'snow') for (let x = 21; x < 32; x++) f.px(x, 7 + Math.abs(x - 26) / 2 | 0);
  // the harvest pile beside the house, a dot per crop brought in
  const n = Math.min(game(demo).harvest || 0, 9);
  for (let k = 0; k < n; k++) f.fill(17 - (k % 3) * 2, 18 - Math.floor(k / 3) * 2, 1, 1);
  if (a && a.laterIdle) zee(26, 3, t, 3);
  // the fence: posts and rails, the mailbox at the gate
  for (let x = 0; x < W; x++) { f.px(x, 123); f.px(x, 126); }
  for (let x = 1; x < W; x += 5) f.fill(x, 122, 1, 6);
  if (a) mailbox(a, 113);
  BEDS.forEach(y => { for (let x = 12; x < 31; x += 2) f.px(x, y + 9); });
}, (a, by, mobs, dt, st) => {
  const taken = new Set();
  const g = game(demo);
  g.harvest = g.harvest || 0;
  g.crops = g.crops || {};
  // A family works one bed: busy while anyone in it works, ripe once nobody
  // works and someone is done, harvested when all of it has been seen.
  const kidsOf = new Map();
  (a.kids || []).forEach(k => { if (!kidsOf.has(k.family)) kidsOf.set(k.family, []); kidsOf.get(k.family).push(k); });
  mobs.forEach((m, id) => {
    const ks = kidsOf.get(id) || [], st = m.r.state;
    m.kids = ks;
    m.busy = !m.dying && !m.home && (st === 'working' || ks.some(k => k.state === 'working'));
    const ripe = !m.dying && !m.home && !m.busy && (st === 'done' || ks.some(k => k.state === 'done'));
    if (m.bed !== undefined && !m.busy && !ripe) { if (m.ripe) g.harvest++; m.bed = undefined; m.work = 0; m.ripe = false; }
    if (m.bed !== undefined) { m.ripe = ripe; taken.add(m.bed); }
  });
  // what the save keeps of each bed; a session gone for good takes its own
  const live = new Set((a.sessions || []).map(s => s.id));
  Object.keys(g.crops).forEach(id => { if (!live.has(id) && !mobs.has(id)) delete g.crops[id]; });
  mobs.forEach((m, id) => { if (m.bed === undefined) delete g.crops[id]; else g.crops[id] = { bed: m.bed, work: Math.round(m.work || 0), ripe: !!m.ripe }; });
  mobs.forEach(m => {
    if (m.busy && m.bed === undefined) for (let s = 0; s < BEDS.length; s++) if (!taken.has(s)) { m.bed = s; taken.add(s); break; }
  });
  asking(by, mobs);
  // sleepers by the house; a parent whose children work stands at the bed
  const sleepers = by.idle.filter(r => mobs.get(r.id).bed === undefined);
  slots({ idle: sleepers }, mobs, 'idle', [[0, 12], [8, 12]], i => [(i - 2) * 8, 4]);
  mobs.forEach(m => {
    const s = m.r.state;
    m.pose = undefined;
    if (m.dying || m.home) return;
    if (m.bed !== undefined && m.busy) m.work = (m.work || 0) + dt;
    if (s === 'waiting') return;
    if (m.bed === undefined) { if (s === 'working' || s === 'done') wander(m, dt, [[0, 100, 20, 104]]); return; }
    m.tx = 1; m.ty = BEDS[m.bed];
    if (s === 'idle') m.pose = 'stand';
  });
  st.waitingAdults = by.waiting.length;
}, (a, mobs, t, dt, st) => {
  mobs.forEach(m => {
    if (m.bed === undefined) return;
    const soil = BEDS[m.bed] + 8, g = (m.work || 0) / GROW_MS, crop = cropOf(m.kind);
    [14, 19, 24].forEach((x, i) => {
      if (m.ripe) plant(RIPE[crop], x, soil);
      else { const st = Math.floor(g - i * 0.6); if (st >= 0) plant(STAGES[Math.min(st, STAGES.length - 1)], x, soil); }
    });
  });
  children(a, mobs, t, dt, st);
  // subagents running inside a turn: ducklings hopping over its head
  mobs.forEach(m => {
    const n = Math.min(m.r.helpers || 0, 3);
    for (let i = 0; i < n; i++) f.sprite(DUCKLING, Math.round(m.x) + i * 3 - 1 + (n === 1 ? 2 : 0), Math.round(m.y) - 3 + (Math.floor(t / 250 + i) % 2 ? -1 : 0));
  });
}, {
  demo, tool: 'water',
  // a creature comes back to the bed the save says it had
  born: (m, r) => { const c = (game(demo).crops || {})[r.id]; if (c) { m.bed = c.bed; m.work = c.work; m.ripe = c.ripe; } },
  died: () => { const g = game(demo); g.departed = (g.departed || 0) + 1; },
  prepare: families,
});

// The children: beside their parent's bed while it is worked (each at a
// plant), at the fence when they ask, curled up by their parent when idle,
// and a small ghost when archived.
function children(a, mobs, t, dt, st) {
  const kids = a.kids || [], seen = new Set(), gone = new Map((a.sessions || []).map(s => [s.id, s.state]));
  let waitAt = (st.waitingAdults || 0) * 8;
  const slotOf = new Map(), idleOf = new Map();
  kids.forEach(k => {
    seen.add(k.id);
    const p = mobs.get(k.family);
    let c = kidMobs.get(k.id);
    if (!c) { c = { x: p ? p.x + 2 : 24, y: p ? p.y + 3 : 10, sd: seedOf(k.id) }; kidMobs.set(k.id, c); }
    c.k = k; c.kind = k.kind;
    if (k.state === 'waiting') { c.tx = Math.min(waitAt, 27); c.ty = 116; waitAt += 6; }
    else if (p && p.bed !== undefined && k.state !== 'idle') {
      const j = slotOf.get(k.family) || 0; slotOf.set(k.family, j + 1);
      // on the path under the plants, four to a line, two lines
      c.tx = 12 + (j % 4) * 5; c.ty = BEDS[p.bed] + 11 + Math.min(Math.floor(j / 4), 1) * 6;
    } else if (p) {
      const j = idleOf.get(k.family) || 0; idleOf.set(k.family, j + 1);
      c.tx = Math.min(Math.round(p.tx) + 9 + j * 5, 27); c.ty = p.ty + 3;
    } else { c.tx = 12; c.ty = 16; }
  });
  kidMobs.forEach((c, id) => {
    if (!seen.has(id) && !c.dying) { if (gone.get(id) === 'archived') c.dying = t; else { kidMobs.delete(id); return; } }
    const x = Math.round(c.x), y = Math.round(c.y), rows = MINI[c.kind] || MINI.blob;
    if (c.dying) {
      const age = t - c.dying;
      if (age > 2600) { kidMobs.delete(id); return; }
      fade(MINI_SLEEP, x, y, age < 400 ? 1 : Math.max(0, 1 - (age - 400) / 900));
      if (age >= 400) { const k = (age - 400) / 2200; fade(MINI_SOUL, x + 1, y - Math.round(k * Math.min(16, y + 2)), k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4); }
      return;
    }
    const moving = walk(c, c.tx, c.ty, dt), s = c.k.state;
    if (moving) { f.sprite(rows, x, y + (Math.floor(t / 160 + c.sd) % 2)); return; }
    if (s === 'working') { // bobbing over its plant, a drop now and then
      f.sprite(rows, x, y + (Math.floor(t / 400 + c.sd) % 2));
      const p = (t + c.sd * 97) % 1200;
      if (p < 400) f.px(x + 2, y - 2 - Math.floor(p / 200)); // a drop flicked up at its plant
    } else if (s === 'waiting') { f.sprite(rows, x, y); f.tiny('?', x + 1, y - 6); }
    else if (s === 'done') f.sprite(rows, x, y + hop(t, c.sd));
    else f.sprite(MINI_SLEEP, x, y);
  });
}
}
farm('farm', false);
farm('farmdemo', true);

})();
