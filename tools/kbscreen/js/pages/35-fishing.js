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

  const store = () => (save.fish = save.fish || { projects: {} });
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
  const TIP = [3, 1], HAND = [20, 10];
  const HULL = ['#....................#', '######################', '.####################.', '...################...'];
  const HULL_X = 7, HULL_Y = 16;
  // The fisherman, facing the line; 9 wide (a column either side for his arms).
  const FISHER = ['...###...', '..#####..', '.#######.', '..#.###..', '..#####..', '...###...', '..#####..', '.######..', '..#####..'];
  const CHEER = ['#..###..#', '#.#####.#', '##########'.slice(0, 9), '..#.###..', '..##.##..', '...###...', '..#####..', '..#####..', '..#####..']; // arms up, mouth open
  const SIP = [...FISHER.slice(0, 3), '..#.##...', '.##.###..', '.##.##...', '..#####..', '..#####..', '..#####..']; // a cup to his mouth
  const YAWN = [...FISHER.slice(0, 3), '..#####..', '..##.##..', '...#.#...', ...FISHER.slice(6)];
  const DOZE = ['.........', '...###...', '..#####..', '.#######.', '..#####..', '..#####..', '..#####..', '.######..', '..#####..']; // head down, eye shut
  const FISHER_X = 21, FISHER_Y = 7;
  // The catch, in ms: the bobber held under before the strike (skipped while
  // more are queued), the gap the fish leaves in the surface, arms up on a
  // landing, the recast flight and the ring where the bobber lands.
  const BITE_MS = 300, SPLASH_MS = 300, CHEER_MS = 700, CAST_MS = 500, RING_MS = 400;
  // Landed: the newest lies whole on the gunwale; the two before it show as
  // tails inside the boat, older ones are out of sight.
  const NEWEST_X = 13, TAILS = [9, 7], TAIL = ['#.#', '.#.', '.#.'];
  const ASK_Y = [27, 42], ASK_X = 7; // askers keep right of the line (x 7-31)
  const LANES = [51, 58, 65, 72, 79, 86, 93, 100];
  const FLOOR = 121; // the resting fish's bottom row
  const BOTTLE = ['..##', '.###', '###.', '##..'];
  const BUBBLE = ['.#.', '#.#', '.#.'];

  // ---- the simulation ----------------------------------------------------------
  // tick() runs whichever page shows, so fish are caught behind perf and music
  // too; the page only draws what it left.
  const fish = new Map(), lanes = new Map();
  let lastTick = null, booted = false, catching = null, landedAt = -1e9, castEnd = -1e9, splash = null, demos = 0;
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
  function layout(list, ys, gap, bottom, x0 = 0) {
    const lines = [[]];
    let used = 0;
    list.forEach(m => {
      const [w] = dims(m);
      if (used && used + w > W - x0) { lines.push([]); used = 0; }
      lines[lines.length - 1].push(m); used += w + gap;
    });
    lines.forEach((ln, i) => {
      const total = ln.reduce((s, m) => s + dims(m)[0] + gap, -gap);
      let x = x0 + Math.floor((W - x0 - total) / 2) + (x0 ? 0 : (i % 2) * 3);
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
    if (k >= 1) { const then = p.then; m.fly = null; if (then) then(t); }
  }
  // Where landed fish i of n lies (its top left).
  function pileSpot(m, i, n) {
    if (i === n - 1) return [NEWEST_X, HULL_Y + 1 - dims(m)[1]];
    return [TAILS[Math.min(n - 2 - i, TAILS.length - 1)], HULL_Y - 2];
  }
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
    fish.forEach(m => { if (m.demo && m.landed && t - m.landed > 6000) m.leaving = 'swim'; });
    fish.forEach((m, id) => {
      if (seen.has(id) || m.leaving || m.demo) return;
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
    done.forEach((m, i) => { if (m.fresh) { m.landed = t + 1 + i; m.fresh = false; } });
    // the rest line up at the hook, left of the askers, next one on top
    done.filter(m => !m.landed).forEach((m, i) => { m.tx = 0; m.ty = SURF + 5 + i * 8 });
    if (!catching && t >= castEnd) {
      const next = done.find(m => !m.landed);
      if (next) { catching = next.id; next.hook = { phase: 'sink', y: SURF + 1 }; }
    }

    // where everyone goes
    const live = [...fish.values()].filter(m => !m.leaving && !m.fly && !m.landed && !m.hook);
    const byFam = fam => live.filter(m => m.family === fam);
    layout(live.filter(m => m.r.state === 'waiting').sort((p, q) => (p.family + p.fry).localeCompare(q.family + q.fry)), ASK_Y, 2, false, ASK_X);
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
      if (m.landed) { const p = pile(), [x, y] = pileSpot(m, p.indexOf(m), p.length); m.x = x; m.y = y; return; }
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

  // The catch: the hook sinks under the bobber while the fish swims to the
  // line; it bites and the bobber goes under (held a moment unless more are
  // queued); the rod dips and it is reeled up, opening a gap in the surface;
  // it is swung into the boat, arms go up, and he recasts.
  function catchStep(m, t, dt) {
    const h = m.hook, [, ht] = dims(m), mouthY = Math.round(m.y + ht / 2) - 1;
    if (h.phase === 'sink') {
      h.y = Math.min(mouthY, h.y + dt * 0.06);
      m.tx = TIP[0]; m.ty = Math.max(m.y, SURF + 3);
      steer(m, dt, MOVE);
      m.dir = -1;
      if (h.y >= mouthY && Math.abs(m.x - m.tx) < 0.5) {
        const queued = [...fish.values()].filter(o => o !== m && !o.leaving && !o.landed && o.r.state === 'done').length;
        h.phase = 'bite'; h.t0 = t; h.hold = queued ? 0 : BITE_MS;
      }
    } else if (h.phase === 'bite') {
      if (t - h.t0 >= h.hold) { h.phase = 'reel'; m.x = TIP[0] - Math.floor(ht / 2); m.y = mouthY; }
    } else if (h.phase === 'reel') {
      m.y = Math.max(TIP[1] + 2, m.y - dt * 0.035);
      h.y = m.y;
      if (!h.breach && m.y < SURF) { h.breach = true; splash = { t0: t, x: Math.round(m.x) - 1, w: ht + 2 }; }
      if (m.y <= TIP[1] + 2) {
        h.phase = 'swing';
        const n = pile().length + 1, [px, py] = pileSpot(m, n - 1, n);
        fly(m, t, px, py, 700, TIP[1], at => {
          m.hook = null; catching = null; m.landed = at;
          landedAt = at; castEnd = at + CHEER_MS + CAST_MS;
        });
      }
    }
  }

  // Shows to set off from the preview page; they leave the save alone.
  function demo(n) {
    for (let i = 0; i < n; i++) {
      const id = 'demo' + demos++, sd = seedOf(id);
      fish.set(id, { id, sd, demo: true, dir: -1, x: W + 1 + i * 10, y: LANES[(sd + i * 3) % 8], family: id, fry: false,
        kind: NAMES[(sd + i) % NAMES.length], r: { id, name: '', state: 'done', helpers: 0, context: -1 } });
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
  const JELLY = [['.###.', '#...#', '#####', '#.#.#', '.#.#.'], ['.###.', '#...#', '#####', '.#.#.', '#.#.#']]; // a hollow bell
  const EVENTS = [
    { name: 'gull', len: 12000, every: 20 * MIN, mean: 30 * MIN, when: c => !c.night,
      draw: (c, k, t) => {
        const flap = GULL[Math.floor(t / 150) % 2];
        if (k < 0.2) f.sprite(flap, Math.round(lerp(33, 5, k / 0.2)), Math.round(lerp(-3, 12, k / 0.2)));
        else if (k < 0.85) f.sprite(GULL_SIT[Math.floor(t / 700) % 2], 5, 12); // on the bow post
        else f.sprite(flap, Math.round(lerp(5, -6, (k - 0.85) / 0.15)), Math.round(lerp(12, -4, (k - 0.85) / 0.15)));
      } },
    { name: 'crab', len: 16000, every: 15 * MIN, mean: 30 * MIN, when: () => true,
      draw: (c, k, t) => f.sprite(CRAB[Math.floor(t / 250) % 2], Math.round(lerp(-6, 33, k)), 123) },
    { name: 'jelly', len: 24000, every: 30 * MIN, mean: 60 * MIN, when: () => true,
      draw: (c, k, t) => f.sprite(JELLY[Math.floor(t / 900) % 2], Math.round(26 + Math.sin(t / 2000) * 2), Math.round(lerp(118, 44, Math.sin(k * Math.PI)))) }, // stays below the askers
    { name: 'star', len: 1500, every: 10 * MIN, mean: 30 * MIN, when: c => c.night && c.sky === 'clear',
      draw: (c, k) => { for (let i = 0; i < 4; i++) { const kk = k - i * 0.06; if (kk > 0 && kk < 1) f.px(lerp(30, 14, kk), lerp(0, 6, kk)); } } },
  ];
  let cur = null, nextCheck = 0, forced = null;
  function events(c, t) {
    if (forced) { cur = { e: forced, at: t }; forced = null; } // from the preview: no cooldown kept
    if (!cur && t >= nextCheck) {
      const last = store().last = store().last || {};
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
  // His idle routines (no data in them): one every 3 to 9 minutes while no
  // catch is on; dozing late at night, nodding now and then.
  const ROUTINES = [{ name: 'sip', len: 2400 }, { name: 'yawn', len: 1400 }, { name: 'check', len: 1200 }];
  let routine = null, routineAt = 60000 + Math.random() * 180000;
  function fisher(t, bob, hooked, clock) {
    const h = Number(clock.slice(0, 2)), late = h >= 23 || h < 6;
    if (t - landedAt < CHEER_MS) return { rows: CHEER, tip: 0 };
    if (hooked || t < castEnd) { routine = null; return { rows: FISHER, tip: 0 }; }
    if (!routine && t >= routineAt) { routine = { r: ROUTINES[Math.floor(Math.random() * ROUTINES.length)], t0: t }; routineAt = t + 180000 + Math.random() * 360000; }
    if (routine && t - routine.t0 >= routine.r.len) routine = null;
    if (routine) {
      const k = (t - routine.t0) / routine.r.len;
      if (routine.r.name === 'sip') return { rows: k > 0.15 && k < 0.85 ? SIP : FISHER, tip: 0 };
      if (routine.r.name === 'yawn') return { rows: YAWN, tip: 0 };
      return { rows: FISHER, tip: k < 0.5 ? -2 : 0 }; // lifts the rod to check the line
    }
    if (late) return { rows: (t % 5000) < 500 ? FISHER : DOZE, tip: 1 };
    return { rows: FISHER, tip: 0 };
  }
  function boat(a, w, t, bob, clock) {
    const hooked = [...fish.values()].find(m => m.hook);
    const ph = hooked ? hooked.hook.phase : '', man = fisher(t, bob, hooked, clock);
    // the rod: the tip dips a step once it bites, until the fish is in
    const tip = [TIP[0], TIP[1] + bob + (ph === 'bite' || ph === 'reel' || ph === 'swing' ? 2 : man.tip)];
    line(HAND[0], HAND[1] + bob, tip[0], tip[1]);
    const bx = tip[0] - 1, by = SURF - 1; // the bobber's place
    if (ph === 'sink') { // the bobber rides, the hook goes down under it
      line(tip[0], tip[1], tip[0], by - 1); f.fill(bx, by, 2, 2); line(tip[0], SURF + 1, tip[0], hooked.hook.y);
    } else if (ph === 'bite') { // pulled under
      line(tip[0], tip[1], tip[0], hooked.hook.y); f.fill(bx, SURF + 2, 2, 2);
    } else if (ph === 'reel') line(tip[0], tip[1], tip[0], hooked.y);
    else if (ph === 'swing') line(tip[0], tip[1], hooked.x + 1, hooked.y);
    else if (t < landedAt + CHEER_MS) { line(tip[0], tip[1], tip[0], tip[1] + 3); f.fill(bx, tip[1] + 4, 2, 2); } // dangling
    else if (t < castEnd) { // the recast: out in an arc from beside him
      const k = (t - landedAt - CHEER_MS) / CAST_MS;
      const x = lerp(HAND[0] - 2, bx, k), y = lerp(HAND[1] - 4, by, k) - 8 * 4 * k * (1 - k);
      line(tip[0], tip[1], x, y); f.fill(Math.round(x), Math.round(y), 2, 2);
    } else {
      const dip = Math.floor(t / 1300) % 2; // riding the swell
      line(tip[0], tip[1], tip[0], by - 1 + dip); f.fill(bx, by + dip, 2, 2);
      if (t - castEnd < RING_MS) { f.px(bx - 2, SURF - 1); f.px(bx + 3, SURF - 1); } // where it landed
    }
    // the catch, the fisherman, the hull over them
    const p = pile();
    p.forEach((m, i) => {
      if (i === p.length - 1) knock(shape(m, Math.floor(t / 600 + m.sd) % 2), m.x, m.y + bob); // the newest still beats its tail
      else if (p.length - 2 - i < TAILS.length) f.sprite(TAIL, m.x, m.y + bob);
    });
    knock(man.rows, FISHER_X, FISHER_Y + bob);
    if (w.night) f.sprite(['###', '###', '.#.'], 29, 12 + bob); // the lantern on the stern
    f.fill(HULL_X, HULL_Y + bob + 1, HULL[0].length, 3, false);
    f.sprite(HULL, HULL_X, HULL_Y + bob);
    if (a && a.laterWaiting) f.sprite(BOTTLE, 28, SURF - 2 + (Math.floor(t / 1700) % 2));
  }
  const onLine = m => m.hook && (m.hook.phase === 'reel' || m.hook.phase === 'swing');
  function drawFish(m, t) {
    const st = m.r.state, x = Math.round(m.x), y = Math.round(m.y);
    if (onLine(m) || (m.fly && m.y < SURF && !m.leaving && st === 'done')) { // on the line: mouth up, wriggling
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

  // The preview page's buttons (kbscreen :8077).
  action('fishing: catch', () => { demo(1); showPage('fishing'); });
  action('fishing: three catches', () => { demo(3); showPage('fishing'); });
  action('fishing: routine', () => { routine = null; routineAt = 0; landedAt = -1e9; showPage('fishing'); });
  EVENTS.forEach(e => action('fishing: ' + e.name, () => { forced = e; showPage('fishing'); }));

  return function fishing(d, t) {
    const dt = last === null ? 50 : Math.min(200, Math.max(0, t - last)); last = t;
    const a = d.agents, w = weatherOf(d);
    sky(w, t, dt);
    water(w, t);
    if (splash && t - splash.t0 < SPLASH_MS) f.fill(splash.x, SURF, splash.w, 1, false); // the gap it left
    const bob = Math.floor(t / (w.sky === 'storm' ? 700 : 1600)) % 2;
    // the fish in the water, deepest first, then the boat and what hangs off it
    const swimming = [...fish.values()].filter(m => !m.landed && !(onLine(m)) && !(m.fly && m.y < SURF + 2 && m.r.state === 'done'));
    swimming.sort((p, q) => q.y - p.y).forEach(m => drawFish(m, t));
    boat(a, w, t, bob, d.sys.clock);
    [...fish.values()].filter(m => (onLine(m)) || (!m.landed && m.fly && m.y < SURF + 2 && m.r.state === 'done')).forEach(m => drawFish(m, t));
    events({ night: w.night, sky: w.sky }, t);
  };
})());
