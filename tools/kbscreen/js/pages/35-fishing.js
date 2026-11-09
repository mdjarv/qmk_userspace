// fishing: the agent sessions as fish under a fisherman's boat. Depth is how
// much an agent needs you, from the surface down: asking just under the boat
// (a bare ?), done in the boat (hooked, reeled up and landed when its turn
// ends; thrown back once you have seen it), working out in the water, idle on
// the bottom. A session another one started is small fry swimming behind its
// parent; subagents in its turn are bubbles; its size is how full its context
// window is. Archived, it swims off; merged, it leaps first. Old questions are
// a bottle floating by the boat. Each project has its own kind of fish, kept
// in save.fish. A trial page beside the farm; the farm is untouched.
'use strict';

page('fishing', (function () {
  // ---- the fish: side-on, facing right, eye cut out as a hole ----------------
  // a and b are the tail's two beats; eye is the hole [col, row]; the body
  // row and column (the row under the eye, column 3) are what size adds or takes.
  const KINDS = {
    carp: { a: ['...##...', '#.#####.', '##.###.#', '########', '#.######', '...##...'],
            b: ['...##...', '..#####.', '#####.#.', '#######.', '..######', '...##...'], eye: [6, 2] },
    puffer: { a: ['..#.#.#.', '.######.', '#####.##', '.#######', '#######.', '.######.', '..#.#.#.'],
              b: ['..#.#.#.', '.######.', '.####.##', '########', '.######.', '.######.', '..#.#.#.'], eye: [5, 2] },
    angler: { a: ['....###.', '...#..#.', '#.######', '##.##.##', '#.######', '..#.#.#.'],
              b: ['....###.', '...#..#.', '..######', '####.#.#', '..######', '..#.#.#.'], eye: [5, 3] },
    sword: { a: ['...##...', '#.####..', '###.####', '#.####..', '....#...'],
             b: ['...##...', '..####..', '####.###', '..####..', '....#...'], eye: [4, 2] },
    shark: { a: ['....#...', '...##...', '#.####.#', '.#######', '#.#####.', '....#...'],
             b: ['....#...', '...##...', '..####.#', '########', '..#####.', '....#...'], eye: [6, 2] },
    angel: { a: ['..#.....', '..##....', '#.###...', '#####.#.', '#.#####.', '..###...', '..##....', '..#.....'],
             b: ['..#.....', '..##....', '..###...', '####.##.', '..#####.', '..###...', '..##....', '..#.....'], eye: [5, 3] },
    catfish: { a: ['..###...', '#.######', '######.#', '#.######', '.....#.#'],
               b: ['..###...', '..######', '######.#', '########', '.....#.#'], eye: [6, 2] },
    guppy: { a: ['##......', '###.###.', '#####.##', '###.####', '##..###.'],
             b: ['........', '###.###.', '#####.##', '###.####', '###.###.'], eye: [5, 2] },
  };
  // Fry: a 5-wide of the parent's kind, eye cut out.
  const FRY = {
    carp: ['..##.', '####.', '#.#.#', '.###.'],
    puffer: ['.#.#.', '###.#', '.####', '.#.#.'],
    angler: ['...#.', '.####', '##.##', '.#.#.'],
    sword: ['.##..', '##.##', '.##..'],
    shark: ['..#..', '#####', '.###.'],
    angel: ['.#...', '####.', '#.##.', '.#...'],
    catfish: ['.##..', '####.', '#.###', '...#.'],
    guppy: ['#....', '##.#.', '###.#', '##.#.'],
  };
  const NAMES = Object.keys(KINDS);

  const store = () => (save.fish = save.fish || { projects: {}, caught: 0 });
  // A project's kind, given once in first-seen order: the least used.
  function kindFor(name) {
    const ps = store().projects;
    if (!ps[name]) {
      let best = NAMES[0], n = Infinity;
      NAMES.forEach(k => { const c = Object.values(ps).filter(p => p.kind === k).length; if (c < n) { best = k; n = c; } });
      ps[name] = { kind: best, seen: Date.now() };
    }
    ps[name].seen = Date.now();
    return ps[name].kind;
  }
  // Projects not seen for 30 days give their kind back.
  function forget() {
    if (!save.fish) return; // nothing written until there is something to keep
    const ps = save.fish.projects, old = Date.now() - 30 * 24 * 3600000;
    Object.keys(ps).forEach(n => { if (ps[n].seen < old) delete ps[n]; });
  }
  forget();

  // ---- shapes ----------------------------------------------------------------
  const flip = rows => rows.map(r => r.split('').reverse().join(''));
  // Mouth up, hanging off the hook.
  const hang = rows => { const w = rows[0].length, out = []; for (let i = 0; i < w; i++) out.push(rows.map(r => r[w - 1 - i]).join('')); return out; };
  // Context usage is size: a row and column fewer under a third, one more over
  // three quarters.
  function sized(rows, eye, pct) {
    if (pct === undefined || pct < 0 || (pct >= 34 && pct <= 75)) return rows;
    const br = Math.min(eye[1] + 1, rows.length - 1);
    if (pct < 34) return rows.filter((r, i) => i !== br).map(r => r.slice(0, 3) + r.slice(4));
    return rows.flatMap((r, i) => (i === br ? [r, r] : [r])).map(r => r.slice(0, 4) + r.slice(3));
  }
  function shape(m, beat, closed) {
    if (m.fry) return FRY[m.kind];
    const k = KINDS[m.kind];
    let rows = beat ? k.b : k.a;
    if (closed) { // resting: the eye a slit
      const [c, r] = k.eye;
      rows = rows.map((s, i) => (i === r ? s.slice(0, c - 1) + '..' + s.slice(c + 1) : s));
    }
    return sized(rows, k.eye, m.r.context);
  }
  // Draws a sprite over what is behind it: its rows are cleared a pixel
  // wider first, so overlapping fish stay apart.
  function knock(rows, x, y) {
    rows.forEach((r, yy) => {
      const a = r.indexOf('#'), b = r.lastIndexOf('#');
      if (a >= 0) f.fill(x + a - 1, y + yy, b - a + 3, 1, false);
    });
    f.sprite(rows, x, y);
  }
  function line(x0, y0, x1, y1) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) f.px(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n));
  }
  function seedOf(id) { let h = 7; for (const c of id) h = (h * 33 + c.charCodeAt(0)) % 9973; return h % 17; }
  const lerp = (a, b, k) => a + (b - a) * Math.max(0, Math.min(1, k));

  // ---- the place ---------------------------------------------------------------
  // Sky 0-9, the boat 7-19 on the surface (row 19), the water to the sand at
  // 122. Asking just under the boat, working in eight lanes, idle on the sand.
  const SURF = 19;
  const TIP = [3, 1], HAND = [21, 13];
  const HULL = ['#....................#', '######################', '.####################.', '...################...'];
  const HULL_X = 7, HULL_Y = 16;
  const FISHER = ['..###..', '.#####.', '#######', '.#.###.', '.#####.', '..###..', '.#####.', '######.', '.#####.'];
  const FISHER_X = 22, FISHER_Y = 7;
  const PILE = [[8, 12], [14, 12], [11, 9]]; // landed fish, tops; more stay out of sight under them
  const ASK_Y = [27, 39];
  const LANES = [46, 54, 62, 70, 78, 86, 94, 102];
  const FLOOR = 121; // the resting fish's bottom row
  const BOTTLE = ['..##', '.###', '###.', '##..'];
  const BUBBLE = ['.#.', '#.#', '.#.'];

  // ---- the simulation ----------------------------------------------------------
  // tick() runs whichever page shows, so fish are caught behind perf and music
  // too; the page only draws what it left.
  const fish = new Map(), lanes = new Map();
  let lastTick = null, booted = false, catching = null;
  const SWIM = 0.004, MOVE = 0.012; // px per ms: patrolling, going somewhere

  function families(a) {
    const rowOf = new Map(a.rows.map(r => [r.id, r]));
    const known = new Map((a.sessions || []).map(s => [s.id, s]));
    const alive = id => { const x = rowOf.get(id) || known.get(id); return x && x.state !== 'archived' && x.state !== 'parked' ? x : null; };
    const root = r => { let x = r; for (let i = 0; i < 6 && x.parent && alive(x.parent); i++) x = alive(x.parent); return x; };
    const out = [];
    a.rows.forEach(r => { const top = root(r); out.push({ r, family: top.id, fry: top !== r, kind: kindFor(top.name) }); });
    // a parent quiet for an hour comes back while its fry are here
    out.filter(o => o.fry && !out.some(p => p.r.id === o.family)).forEach(o => {
      if (out.some(p => p.r.id === o.family)) return;
      const p = alive(o.family);
      out.push({ r: { id: p.id, name: p.name, state: p.state, parent: '', helpers: p.helpers || 0, context: p.context }, family: p.id, fry: false, kind: o.kind });
    });
    return out;
  }
  const dims = m => { const s = shape(m, 0); return [s[0].length, s.length]; };

  // Moves m toward (tx, ty) at speed v; true while on its way.
  function steer(m, dt, v) {
    const dx = m.tx - m.x, dy = m.ty - m.y, dist = Math.hypot(dx, dy);
    if (dist <= 0.3) { m.x = m.tx; m.y = m.ty; return false; }
    const k = Math.min(1, dt * v / dist);
    m.x += dx * k; m.y += dy * k;
    if (Math.abs(dx) > 0.5) m.dir = dx > 0 ? 1 : -1;
    return true;
  }
  // Lays the fish out in rows from the middle: tops at ys[row] (bottoms when
  // bottom is set), gap pixels apart.
  function layout(list, ys, gap, bottom) {
    const lines = [[]];
    let used = 0;
    list.forEach(m => {
      const [w] = dims(m);
      if (used && used + w > W) { lines.push([]); used = 0; }
      lines[lines.length - 1].push(m); used += w + gap;
    });
    lines.forEach((ln, i) => {
      const total = ln.reduce((s, m) => s + dims(m)[0] + gap, -gap);
      let x = Math.floor((W - total) / 2) + (i % 2) * 3;
      const y = ys[Math.min(i, ys.length - 1)] + (i >= ys.length ? (i - ys.length + 1) * (bottom ? -7 : 11) : 0);
      ln.forEach(m => { const [w, h] = dims(m); m.tx = x; m.ty = bottom ? y - h + 1 : y; x += w + gap; });
    });
  }
  // The free lane farthest from the taken ones (the middle when none is).
  function laneFor() {
    const taken = [...lanes.values()];
    let best = 0, score = -Infinity;
    LANES.forEach((y, i) => {
      const n = taken.filter(j => j === i).length;
      const s = -n * 1000 + (taken.length ? Math.min(...taken.map(j => Math.abs(LANES[j] - y))) : -Math.abs(y - 74));
      if (s > score) { score = s; best = i; }
    });
    return best;
  }
  // A flight out of the water or back into it: a parabola over len ms.
  function fly(m, t, x1, y1, len, top, then) {
    m.fly = { t0: t, len, x0: m.x, y0: m.y, x1, y1, top, then };
  }
  function flown(m, t) {
    const p = m.fly, k = Math.min(1, (t - p.t0) / p.len);
    const mid = (p.y0 + p.y1) / 2, h = Math.max(0, mid - p.top);
    m.x = lerp(p.x0, p.x1, k); m.y = lerp(p.y0, p.y1, k) - h * 4 * k * (1 - k);
    if (p.x1 !== p.x0) m.dir = p.x1 > p.x0 ? 1 : -1;
    if (k >= 1) { const then = p.then; m.fly = null; if (then) then(); }
  }
  const pileSpot = i => PILE[Math.min(i, PILE.length - 1)];
  const pile = () => [...fish.values()].filter(m => m.landed).sort((p, q) => p.landed - q.landed);

  tick(function fishingTick(d, t) {
    const dt = lastTick === null ? 50 : Math.min(200, Math.max(0, t - lastTick)); lastTick = t;
    const a = d.agents;
    if (!a) return;
    const all = families(a), sessions = new Map((a.sessions || []).map(s => [s.id, s]));

    // who is here: new fish swim in from a side (on first sight, already in place)
    const seen = new Set();
    all.forEach(o => {
      seen.add(o.r.id);
      let m = fish.get(o.r.id);
      if (!m) {
        const sd = seedOf(o.r.id);
        m = { id: o.r.id, sd, dir: sd % 2 ? 1 : -1, x: sd % 2 ? -9 : W + 1, y: LANES[sd % 8], fresh: !booted };
        fish.set(o.r.id, m);
      }
      Object.assign(m, { r: o.r, family: o.family, fry: o.fry, kind: o.kind });
    });
    // gone from the rows: archived (or parked, or quiet an hour) it swims off;
    // merged, it leaps out of the water on its way
    fish.forEach((m, id) => {
      if (seen.has(id) || m.leaving) return;
      const s = sessions.get(id);
      m.leaving = s && s.state === 'archived' && s.merged ? 'leap' : 'swim';
      m.landed = 0;
      if (catching === id) catching = null;
      m.hook = null;
    });

    // lanes: one a family while any of it works
    const working = new Set(all.filter(o => o.r.state === 'working').map(o => o.family));
    lanes.forEach((l, fam) => { if (!working.has(fam)) lanes.delete(fam); });
    working.forEach(fam => { if (!lanes.has(fam)) lanes.set(fam, laneFor()); });

    // thrown back: landed, but no longer done (seen, or working again)
    fish.forEach(m => {
      if (m.landed && (m.leaving || m.r.state !== 'done')) {
        m.landed = 0;
        fly(m, t, 1, SURF + 4, 700, 4);
      }
      if (m.hook && m.r.state !== 'done') { // let go of the line
        m.hook = null; catching = null;
        if (m.y < SURF) fly(m, t, m.x, SURF + 4, 500, m.y - 2);
      }
    });

    // done: hooked, reeled up and landed, one at a time; on first sight
    // already in the boat. Waiting its turn, it hovers where it is.
    const done = [...fish.values()].filter(m => !m.leaving && m.r.state === 'done' && !m.landed && !m.fly && !m.hook);
    done.forEach((m, i) => { if (m.fresh) { m.landed = t + 1 + i; m.fresh = false; } else { m.tx = m.x; m.ty = m.y; } });
    if (!catching) {
      const next = done.find(m => !m.landed);
      if (next) { catching = next.id; next.hook = { phase: 'sink', y: SURF + 1 }; }
    }

    // where everyone goes
    const live = [...fish.values()].filter(m => !m.leaving && !m.fly && !m.landed && !m.hook);
    const byFam = fam => live.filter(m => m.family === fam);
    layout(live.filter(m => m.r.state === 'waiting').sort((p, q) => (p.family + p.fry).localeCompare(q.family + q.fry)), ASK_Y, 3, false);
    layout(live.filter(m => m.r.state === 'idle').sort((p, q) => (p.family + (p.fry ? 1 : 0)).localeCompare(q.family + (q.fry ? 1 : 0))), [FLOOR, FLOOR - 7], 2, true);
    // working: the family's lane; the first of it patrols, the rest follow behind
    fish.forEach(m => { m.lead = null; });
    lanes.forEach((l, fam) => {
      const school = byFam(fam).filter(m => m.r.state === 'working').sort((p, q) => (p.fry ? 1 : 0) - (q.fry ? 1 : 0));
      school.forEach((m, i) => {
        m.lead = i === 0 ? null : school[i - 1];
        if (i === 0) {
          const [w, h] = dims(m);
          m.ty = LANES[l] + 7 - h;
          if (m.patrol === undefined) m.patrol = m.sd % 2 ? W - w : 0;
          if (Math.abs(m.x - m.patrol) < 0.5 && Math.abs(m.y - m.ty) < 0.5) m.patrol = m.patrol ? 0 : W - w;
          m.tx = m.patrol;
        }
      });
    });

    // leaders before the fry in their wake
    const depth = m => { let n = 0; for (let x = m; x.lead && n < 9; x = x.lead) n++; return n; };
    [...fish.entries()].sort((p, q) => depth(p[1]) - depth(q[1])).forEach(([id, m]) => {
      m.moving = false;
      if (m.fly) { flown(m, t); m.moving = true; return; }
      if (m.leaving) {
        if (m.leaving === 'leap') { // up under the surface, a leap out of it, then away
          m.tx = m.x; m.ty = Math.min(m.y, ASK_Y[1]); // below the askers
          if (!steer(m, dt, MOVE * 1.5)) fly(m, t, m.x + (m.x < 12 ? -20 : 20), ASK_Y[1] + 4, 1300, SURF - 9, () => { m.leaving = 'swim'; });
          m.moving = true;
          return;
        }
        m.tx = m.x + (m.x + 4 < W / 2 ? -40 : 40); m.ty = m.y;
        steer(m, dt, MOVE); m.moving = true;
        if (m.x < -12 || m.x > W + 4) fish.delete(id);
        return;
      }
      if (m.landed) { const [x, y] = pileSpot(pile().indexOf(m)); m.x = x; m.y = y; return; }
      if (m.hook) { catchStep(m, t, dt); return; }
      const st = m.r.state;
      if (st === 'working' && m.lead) { // in its leader's wake
        const l = m.lead, [lw] = dims(l), [w, h] = dims(m), [, lh] = dims(l);
        m.tx = l.dir > 0 ? l.x - w - 1 : l.x + lw + 1; m.ty = l.y + lh - h + 2;
        if (m.fresh) { m.x = m.tx; m.y = m.ty; m.fresh = false; }
        steer(m, dt, MOVE * 1.2); m.moving = true;
        m.dir = l.dir;
        return;
      }
      if (m.fresh) { m.x = m.tx; m.y = m.ty; m.fresh = false; }
      m.moving = steer(m, dt, st === 'working' && m.patrol !== undefined && Math.abs(m.y - m.ty) < 0.5 ? SWIM : MOVE);
      if (st === 'working') m.moving = true;
      else m.patrol = undefined;
      if (!m.moving && (st === 'waiting' || st === 'idle')) m.dir = 1;
    });
    booted = true;
  });

  // The catch: the hook sinks to the fish's depth while it swims to the line,
  // it bites, it is reeled up wriggling, swung over the side into the boat.
  function catchStep(m, t, dt) {
    const h = m.hook, [w, ht] = dims(m), mouthY = Math.round(m.y + ht / 2) - 1;
    if (h.phase === 'sink') {
      h.y = Math.min(mouthY, h.y + dt * 0.06);
      m.tx = TIP[0]; m.ty = Math.max(m.y, SURF + 3);
      steer(m, dt, MOVE);
      m.dir = -1;
      if (h.y >= mouthY && Math.abs(m.x - m.tx) < 0.5) { h.phase = 'reel'; m.x = TIP[0] - Math.floor(ht / 2); m.y = mouthY; }
    } else if (h.phase === 'reel') {
      m.y = Math.max(TIP[1] + 2, m.y - dt * 0.035);
      h.y = m.y;
      if (m.y <= TIP[1] + 2) {
        h.phase = 'swing';
        const [px, py] = pileSpot(pile().length);
        fly(m, t, px, py, 700, TIP[1], () => {
          m.hook = null; catching = null; m.landed = t;
          store().caught = (store().caught || 0) + 1;
        });
      }
    }
  }

  // ---- events --------------------------------------------------------------------
  // One short scene now and then, as on the farm: checked every 5 s, every
  // (ms, wall clock, kept in save.fish.last) at least between two, mean the
  // average wait after that.
  const MIN = 60000;
  const GULL = [['#...#', '.#.#.', '..#..'], ['.....', '.#.#.', '#.#.#']];
  const GULL_SIT = [['.##.', '####', '.##.', '.#.#'], ['.##.', '####', '.###', '.#.#']];
  const CRAB = [['#...#', '#.#.#', '.###.', '#.#.#'], ['.#.#.', '#.#.#', '.###.', '.#.#.']];
  const JELLY = [['.###.', '#####', '#.#.#', '#.#.#', '.#.#.'], ['.###.', '#####', '.#.#.', '#.#.#', '#.#..']];
  const EVENTS = [
    { name: 'gull', len: 12000, every: 20 * MIN, mean: 30 * MIN, when: c => !c.night,
      draw: (c, k, t) => {
        const flap = GULL[Math.floor(t / 150) % 2];
        if (k < 0.2) f.sprite(flap, Math.round(lerp(33, 8, k / 0.2)), Math.round(lerp(-3, 12, k / 0.2)));
        else if (k < 0.85) f.sprite(GULL_SIT[Math.floor(t / 700) % 2], 7, 12);
        else f.sprite(flap, Math.round(lerp(8, -6, (k - 0.85) / 0.15)), Math.round(lerp(12, -4, (k - 0.85) / 0.15)));
      } },
    { name: 'crab', len: 16000, every: 15 * MIN, mean: 30 * MIN, when: () => true,
      draw: (c, k, t) => f.sprite(CRAB[Math.floor(t / 250) % 2], Math.round(lerp(-6, 33, k)), 123) },
    { name: 'jelly', len: 24000, every: 30 * MIN, mean: 60 * MIN, when: () => true,
      draw: (c, k, t) => f.sprite(JELLY[Math.floor(t / 900) % 2], Math.round(26 + Math.sin(t / 2000) * 2), Math.round(lerp(118, 30, Math.sin(k * Math.PI)))) },
    { name: 'star', len: 1500, every: 10 * MIN, mean: 30 * MIN, when: c => c.night && c.sky === 'clear',
      draw: (c, k) => { for (let i = 0; i < 4; i++) { const kk = k - i * 0.06; if (kk > 0 && kk < 1) f.px(lerp(30, 14, kk), lerp(0, 6, kk)); } } },
  ];
  let cur = null, nextCheck = 0;
  function events(c, t) {
    const last = store().last = store().last || {};
    if (!cur && t >= nextCheck) {
      nextCheck = t + 5000;
      const now = Date.now();
      const pick = EVENTS.find(e => e.when(c) && now - (last[e.name] || 0) >= e.every && Math.random() < 5000 / e.mean);
      if (pick) { cur = { e: pick, at: t }; last[pick.name] = now; }
    }
    if (!cur) return;
    const k = (t - cur.at) / cur.e.len;
    if (k >= 1) { cur = null; return; }
    cur.e.draw(c, k, t);
  }

  // ---- weather -------------------------------------------------------------------
  const MOON = ['.###.', '##...', '#....', '##...', '.###.'];
  const SUN = ['.###.', '#####', '#####', '#####', '.###.'];
  const CLOUD = ['...###....', '.##...##..', '#.......##', '##########'];
  function weatherOf(d) {
    const w = d.weather, h = Number(d.sys.clock.slice(0, 2));
    if (!w) return { sky: 'clear', night: h >= 21 || h < 6, wind: 5 };
    return { sky: w.sky, night: !w.day, wind: w.wind };
  }
  const drops = [];
  function sky(w, t, dt) {
    const clouded = w.sky !== 'clear' && w.sky !== 'fog';
    if (!clouded) {
      if (w.night) { f.sprite(MOON, 10, 0); [[22, 1], [27, 4], [5, 6], [16, 3]].forEach(p => f.px(p[0], p[1])); }
      else f.sprite(SUN, 10, 0);
    }
    const drift = 300 + 900 / (1 + w.wind / 10);
    if (clouded) {
      f.sprite(CLOUD, Math.round((t / drift) % 44) - 12, 0);
      f.sprite(CLOUD, Math.round((t / (drift * 1.5) + 20) % 44) - 12, 3);
    }
    const wet = w.sky === 'rain' || w.sky === 'storm', snow = w.sky === 'snow';
    if (wet || snow) {
      const want = snow ? 8 : 6;
      while (drops.length < want) drops.push({ x: Math.random() * W, y: -Math.random() * 20, s: Math.random() });
      for (let i = drops.length - 1; i >= 0; i--) {
        const p = drops[i];
        p.y += dt * (snow ? 0.012 : 0.06);
        if (snow) p.x += Math.sin(t / 700 + p.s * 6) * 0.15;
        if (p.y >= SURF) { // a ring where it lands
          if (!snow && p.y < SURF + 3) { f.px(p.x - 1, SURF - 1); f.px(p.x + 1, SURF - 1); }
          if (p.y > SURF + 3 || snow) drops.splice(i, 1);
          continue;
        }
        f.px(p.x, p.y);
        if (!snow) f.px(p.x, p.y - 1);
      }
    } else drops.length = 0;
    if (w.sky === 'fog') [4, 9, 14].forEach((y, i) => f.sprite(['##.##.##', '.##.##..'], Math.round(((t / (900 + i * 300)) + i * 11) % 44) - 10, y));
  }

  // ---- the page ------------------------------------------------------------------
  let last = null;
  function water(w, t) {
    // the surface, rolling slowly with the wind
    const s = Math.floor(t / Math.max(150, 700 - w.wind * 10));
    for (let x = 0; x < W; x++) if ((x + s) % 7 < 4) f.px(x, SURF);
    // the sand and a weed that sways
    for (let x = 0; x < W; x++) { f.px(x, 122); if ((x * 5) % 7 === 0) f.px(x, 124); if ((x * 3) % 11 === 0) f.px(x, 126); }
    const sway = Math.round(Math.sin(t / 1500));
    for (let y = 112; y < 122; y++) f.px(30 + (y % 4 < 2 ? sway : 0), y);
  }
  function boat(a, w, t, bob, reeling) {
    // rod and line
    const tip = [TIP[0], TIP[1] + (reeling ? 2 : 0) + bob];
    line(HAND[0], HAND[1] + bob, tip[0], tip[1]);
    const hooked = [...fish.values()].find(m => m.hook);
    if (!hooked) { // the bobber on the surface
      line(tip[0], tip[1], tip[0], SURF - 2);
      f.fill(tip[0] - (tip[0] > 0 ? 1 : 0), SURF - 1 + (Math.floor(t / 1300) % 2 ? 0 : 0), 2, 2);
    } else if (hooked.hook.phase === 'sink') line(tip[0], tip[1], tip[0], hooked.hook.y);
    else if (hooked.hook.phase === 'reel') line(tip[0], tip[1], tip[0], hooked.y);
    else line(tip[0], tip[1], hooked.x + 1, hooked.y);
    // the catch, the fisherman, the hull over them
    pile().slice(0, PILE.length).forEach((m, i) => knock(i % 2 ? flip(shape(m, 0)) : shape(m, 0), m.x, m.y + bob));
    f.fill(FISHER_X - 1, FISHER_Y + bob, 9, 9, false);
    f.sprite(FISHER, FISHER_X, FISHER_Y + bob);
    if (w.night) f.sprite(['###', '###', '.#.'], 29, 12 + bob); // the lantern on the stern
    f.fill(HULL_X, HULL_Y + bob + 1, HULL[0].length, 3, false);
    f.sprite(HULL, HULL_X, HULL_Y + bob);
    if (a && a.laterWaiting) f.sprite(BOTTLE, 28, SURF - 2 + (Math.floor(t / 1700) % 2));
  }
  function drawFish(m, t) {
    const st = m.r.state, x = Math.round(m.x), y = Math.round(m.y);
    if (m.hook && m.hook.phase !== 'sink' || (m.fly && m.y < SURF && !m.leaving && st === 'done')) { // on the line: mouth up, wriggling
      const rows = hang(shape(m, 0));
      knock(Math.floor(t / 180) % 2 ? flip(rows) : rows, x, y);
      return;
    }
    const resting = st === 'idle' && !m.moving && !m.leaving;
    const beat = resting ? 0 : Math.floor(t / (m.moving ? 250 : 600) + m.sd) % 2;
    let rows = shape(m, beat, resting);
    if (m.dir < 0) rows = flip(rows);
    const bob = st === 'waiting' && !m.moving ? (Math.floor(t / 1100 + m.sd) % 2) : 0;
    knock(rows, x, y + bob);
    const w = rows[0].length;
    if (st === 'waiting' && !m.moving && !m.leaving && !m.hook) f.tiny('?', x + (w >> 1) - 1, y - 6);
    // subagents: bubbles rising from the mouth
    const n = Math.min(m.r.helpers || 0, 3);
    for (let i = 0; i < n; i++) {
      const p = ((t / 1500) + i / n + m.sd * 0.1) % 1, bx = m.dir > 0 ? x + w : x - 3;
      f.sprite(BUBBLE, bx + Math.round(Math.sin(p * 6 + i) * 0.8), y - 1 - Math.round(p * 9));
    }
  }

  return function fishing(d, t) {
    const dt = last === null ? 50 : Math.min(200, Math.max(0, t - last)); last = t;
    const a = d.agents, w = weatherOf(d);
    sky(w, t, dt);
    water(w, t);
    const bob = Math.floor(t / (w.sky === 'storm' ? 700 : 1600)) % 2;
    // the fish in the water, deepest first, then the boat and what hangs off it
    const swimming = [...fish.values()].filter(m => !m.landed && !(m.hook && m.hook.phase !== 'sink') && !(m.fly && m.y < SURF + 2 && m.r.state === 'done'));
    swimming.sort((p, q) => q.y - p.y).forEach(m => drawFish(m, t));
    const reeling = [...fish.values()].some(m => m.hook && m.hook.phase === 'reel');
    boat(a, w, t, bob, reeling);
    [...fish.values()].filter(m => (m.hook && m.hook.phase !== 'sink') || (!m.landed && m.fly && m.y < SURF + 2 && m.r.state === 'done')).forEach(m => drawFish(m, t));
    events({ night: w.night, sky: w.sky }, t);
  };
})());
