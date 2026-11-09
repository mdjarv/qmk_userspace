// council: an Agentique council as a campfire. The members sit around the
// fire in the middle; the scribe's desk is at the top; the answer comes down
// to the bottom edge (nearest the hand) when it waits for you. Each finished
// round puts a log on the fire, small pips under it show the round of the
// planned ones, and an ended council burns down to embers. Other councils are
// small fires in the top corner; with none at all, embers under the night sky.
'use strict';

page('council', (function () {
  // ---- sprites: '#' lit, 'o' cleared, anything else left alone ---------------
  function put(rows, x, y) {
    rows.forEach((r, yy) => { for (let xx = 0; xx < r.length; xx++) { if (r[xx] === '#') f.px(x + xx, y + yy); else if (r[xx] === 'o') f.px(x + xx, y + yy, false); } });
  }
  const mirror = rows => rows.map(r => r.split('').reverse().join(''));
  const seedOf = s => { let h = 7; for (const c of String(s)) h = (h * 33 + c.charCodeAt(0)) % 9973; return h; };

  // ---- the cast: 7 wide, front-on, faces cut out, shown standing ------------
  // head: the rows down to the chin, mouth shut; mouth: the row that opens,
  // and how it looks open. Built-in personas have a look of their own; anyone
  // else is hooded, the hood picked by a hash of the name.
  const LOOKS = {
    socrates: { head: ['..###..', '.#####.', '.#.#.#.', '.#####.', '###.###', '#######', '.#####.', '..#.#..'], mouth: [4, '##...##'] }, // bald, a beard
    nietzsche: { head: ['.#####.', '.#####.', '.#.#.#.', '.#####.', '#######', '#.#.#.#', '..###..'], mouth: [6, '..#.#..'] },      // the moustache
    odysseus: { head: ['#.#.#.#', '.#####.', '...#...', '.#####.', '.#...#.', '.##.##.', '.##.##.'], mouth: [6, '.#...#.'] },     // a plumed helmet
    spark: { head: ['#..#..#', '.#.#.#.', '.#####.', '.#.#.#.', '.#####.', '..###..'], mouth: [4, '.##.##.'] },                    // lightning hair
    razor: { head: ['...#...', '..###..', '..#.#..', '..###..', '...#...'], mouth: [3, '..#.#..'], thin: true },                    // blade-thin
  };
  const HOODS = [
    ['...#...', '..###..', '.#####.', '#.....#', '#.#.#.#', '#.....#'],
    ['..###..', '.#####.', '#######', '#.....#', '#.#.#.#', '#.....#'],
    ['....#..', '...##..', '.#####.', '#.....#', '#.#.#.#', '#.....#'],
    ['..#....', '..##...', '.#####.', '#.....#', '#.#.#.#', '#.....#'],
  ];
  function lookOf(name) {
    const l = LOOKS[String(name).toLowerCase()];
    if (l) return l;
    const h = seedOf(name);
    return { head: HOODS[h % HOODS.length], mouth: [5, '#..#..#'], hood: true, belt: (h >> 2) % 2 === 1 };
  }
  // Seated: a small figure, the same for everyone, sitting on its log;
  // hollow while its turn in the round is still to come, so the round fills
  // up like the pips as members speak.
  const SMALL = { head: ['.###.', '#.#.#', '.###.'], shut: ['.###.', '#####', '.###.'], body: ['#####', '#####'],
    hollowHead: ['.###.', '#...#', '.###.'], hollowBody: ['#####', '#...#'] };
  const LOG = ['#########'];
  const LANTERN = ['.#.', '###', '#.#', '###'];

  // ---- talking: the whole body ------------------------------------------------
  // A speaker talks in phrases (a beat's pause between them): the mouth opens
  // and shuts by syllable, the arms go from pose to pose, and it bobs up on
  // the big ones. Each speaker keeps its own beat.
  // Arms by shape: [dx, dy] from the shoulder, for the right arm (the left is
  // mirrored). Standing bodies from the shoulders down, 7 wide, without arms,
  // and the columns the arms hang from; down: how much of a hanging arm shows.
  const ARM = {
    down: [[0, 0], [0, 1], [0, 2]], out: [[0, 0], [1, 0], [2, 0]], up: [[0, 0], [1, -1], [1, -2], [2, -3]],
    wave: [[0, 0], [1, 0], [2, -1], [2, -2]], low: [[0, 0], [1, 1], [2, 2]],
  };
  const STAND = {
    stand: { l: 0, r: 6, body: ['.#####.', '.#####.', '..###..', '..###..', '..###..', '..#.#..', '..#.#..'] },
    thinStand: { l: 1, r: 5, body: ['..###..', '...#...', '...#...', '..###..', '..#.#..', '..#.#..'], down: 2 },
    cloak: { l: 0, r: 6, body: ['#######', '#######', '.#####.', '.#####.', '.#####.', '.#...#.'], down: 0 }, // arms come out of the cloak
  };
  // [left, right] for a fire on the right; mirrored for one on the left
  const POSES = [['down', 'out'], ['out', 'out'], ['down', 'up'], ['wave', 'out'], ['up', 'up'], ['low', 'wave'], ['out', 'down'], ['low', 'low']];
  const PHRASE = 2800, PAUSE = 500, BEAT = 380, SYLLABLE = 130;
  function talk(t, i) {
    const p = (t + i * 977) % PHRASE;
    if (p >= PHRASE - PAUSE) return { open: false, pose: ['down', 'down'], bob: 0 };
    const pose = POSES[seedOf(Math.floor((t + i * 577) / BEAT) * 31 + i) % POSES.length];
    return { open: seedOf(Math.floor(t / SYLLABLE) * 7 + i) % 5 < 3, pose, bob: pose.includes('up') ? -1 : 0 };
  }

  // Pixels of rows at (x, y), for drawing a figure with a dark outline.
  const lit = (rows, x, y, out) => rows.forEach((r, yy) => { for (let xx = 0; xx < r.length; xx++) if (r[xx] === '#') out.push([x + xx, y + yy]); });

  // A member at its seat (cx, feet); side is where the fire is (-1 left, 1
  // right, 0 above or below). At work in its turn (thinking, a tool,
  // writing) it stands up off its log, a step toward the fire, full size in
  // the persona's own look, outlined so it stands out, and talks; using a
  // tool it holds a lantern. Otherwise it sits small on its log. Getting up
  // and sitting down pass through a crouch. Returns the top of its head.
  const WORKING = ['thinking', 'tool', 'writing'];
  const CROUCH = ['.###.', '#.#.#', '.###.', '#####', '#####', '.#.#.'];
  const RISE_MS = 220;
  const posture = new Map(); // council id/member -> { up, at }
  function member(m, key, cx, feet, side, t, i) {
    const look = lookOf(m.name), s = m.state, standing = WORKING.includes(s);
    put(LOG, cx - 4, feet);
    const was = posture.get(key);
    if (!was) posture.set(key, { up: standing, at: -1e9 });
    else if (was.up !== standing) posture.set(key, { up: standing, at: t });
    const sx = cx - 3 + (side ? side * 2 : 5); // where it stands: toward the fire, or aside
    if (t - posture.get(key).at < RISE_MS) { put(CROUCH, sx + 1, feet - CROUCH.length + 1); return feet - CROUCH.length + 1; }
    if (standing) {
      const kind = look.hood ? 'cloak' : look.thin ? 'thinStand' : 'stand';
      const tk = talk(t, i), sh = STAND[kind], tool = s === 'tool';
      let head = look.head;
      if (tk.open) head = head.map((r, k) => (k === look.mouth[0] ? look.mouth[1] : r));
      const body = sh.body, x = sx, top = feet + tk.bob - body.length + 1, hy = top - head.length, px = [];
      // the arms posed, the fire side first; with a tool the far hand holds the lantern low
      let pose = (side || 1) > 0 ? tk.pose : [tk.pose[1], tk.pose[0]];
      if (tool) pose = side > 0 ? ['low', pose[1]] : [pose[0], 'low'];
      [[sh.l, -1, pose[0]], [sh.r, 1, pose[1]]].forEach(([ox, dir, name]) => {
        const arm = name === 'down' && sh.down !== undefined ? ARM.down.slice(0, sh.down) : ARM[name];
        arm.forEach(([dx, dy]) => px.push([x + ox + dx * dir, top + 1 + dy]));
      });
      lit(body, x, top, px);
      lit(head, x, hy, px);
      if (tool) lit(LANTERN, side > 0 ? x - 5 : x + 9, top + 3, px);
      px.forEach(([a, b]) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) f.px(a + dx, b + dy, false); });
      px.forEach(([a, b]) => f.px(a, b));
      if (look.belt) f.fill(x + 1, top + 2, 5, 1, false);
      return hy;
    }
    // seated, everyone is the same small figure; the look only shows standing
    const x = cx - 2, top = feet - SMALL.body.length, ahead = s === 'waiting';
    put(ahead ? SMALL.hollowBody : SMALL.body, x, top);
    // the head: upright; leaning back from the fire when answered; dropped
    // toward it when failed; bowed with its eyes shut when dozing
    let hx = x, hy = top - SMALL.head.length;
    if (s === 'answered') hx -= side;
    if (s === 'failed') { hx += side; hy += 2; }
    if (s === 'stopped') hy += 1;
    put(ahead ? SMALL.hollowHead : s === 'stopped' ? SMALL.shut : SMALL.head, hx, hy);
    if (s === 'stopped') { const p = ((t / 2000) + i * 0.3) % 1; f.tiny('Z', cx + (side > 0 ? -6 : 4) + Math.round(p * 2), hy - 3 - Math.round(p * 4)); }
    return hy;
  }

  // ---- the fire ----------------------------------------------------------------
  const FIRE_X = 16, FIRE_Y = 76; // the middle of its foot
  const FLAMES = [ // small, medium, large; mirrored and shortened for the flicker
    ['...#...', '..##...', '..###..', '.##.##.', '.#...#.', '.##.##.'],
    ['....#....', '....##...', '...###...', '...####..', '..##.##..', '.##..###.', '.##...##.', '.##...##.', '..##.##..', '...###...'],
    ['.....#.....', '.....##....', '....###....', '....####...', '...##.###..', '...##..##..', '..###..###.', '..##....##.', '.##.....##.', '.##.....##.', '..##...##..', '...#####...'],
  ];
  // One stick of kindling always; a log for each finished round, alternately
  // leaning each way and reaching further out.
  const KINDLING = ['.#...#.', '..###..'];
  const LOGS = [
    ['##.......', '..###....', '.....####'],
    ['.......##', '....###..', '####.....'],
    ['###.........', '...####.....', '.......#####'],
    ['.........###', '.....####...', '#####.......'],
    ['#.............', '.###..........', '....####......', '........######'],
    ['.............#', '..........###.', '......####....', '######........'],
  ];
  function fire(n, ended, t, drop) {
    if (!ended) {
      const fl = FLAMES[n < 2 ? 0 : n < 4 ? 1 : 2];
      const phase = [0, 1, 0, 2, 1, 0, 2, 1][Math.floor(t / 330) % 8];
      const rows = phase === 1 ? mirror(fl) : phase === 2 ? fl.slice(1) : fl;
      put(rows, FIRE_X - (fl[0].length >> 1), FIRE_Y - 2 - rows.length);
      const p = (t / 2600) % 1; // now and then a spark drifts up
      if (p < 0.5) f.px(FIRE_X + Math.round(Math.sin(t / 500) * 2), FIRE_Y - 4 - fl.length - Math.round(p * 10));
    }
    put(KINDLING, FIRE_X - 3, FIRE_Y - 1);
    for (let k = 0; k < n; k++) {
      const lg = LOGS[k], fall = k === n - 1 && drop < 1 ? Math.round((1 - drop) * 12) : 0;
      put(lg, FIRE_X - (lg[0].length >> 1), FIRE_Y - lg.length + 1 - fall);
    }
    if (ended) { // embers that come and go slowly, a wisp of smoke
      const slot = Math.floor(t / 1200);
      for (let k = 0; k < 5; k++) if (seedOf(slot * 5 + k) % 3) f.px(FIRE_X - 4 + k * 2, FIRE_Y - 2 - (k % 2));
      const p = (t / 3400) % 1;
      if (p < 0.7) for (let k = 0; k < 3; k++) f.px(FIRE_X + Math.round(Math.sin(p * 8 + k * 0.6)), FIRE_Y - 6 - Math.round(p * 14) - k * 2);
    }
  }
  // Pips under the fire: the rounds so far, of the planned ones.
  function pips(round, planned) {
    const n = Math.min(Math.max(round, planned), 8);
    const x0 = FIRE_X - Math.floor((n * 3 - 1) / 2);
    for (let k = 0; k < n; k++) {
      if (k < round) f.fill(x0 + k * 3, FIRE_Y + 3, 2, 2);
      else f.px(x0 + k * 3, FIRE_Y + 4);
    }
  }

  // ---- the scribe, the brief and the answer --------------------------------------
  const DESK_Y = 24;
  const SCRIBE = ['.#####.', '#######', '.#####.', '.#.#.#.', '.#####.', '..###..', '.#####.', '#######', '#.###.#'];
  const QUILL = ['...#', '..#.', '.#..', '#...'];
  const BLANK = ['.#####.', '#.....#', '.#####.'];
  const SEALED = ['.##.........##.', '#..#########..#', '#..#...#...#..#', '#..#..###..#..#', '#..#...#...#..#', '#..#########..#', '.##.........##.'];
  function scribe(c, t) {
    put(SCRIBE, 4, DESK_Y - SCRIBE.length);
    for (let x = 1; x <= 30; x++) f.px(x, DESK_Y);
    f.fill(2, DESK_Y + 1, 1, 4); f.fill(29, DESK_Y + 1, 1, 4);
    if (c.scribing) { // the sheet hangs over the desk's edge, longer with every round it covers
      const len = 4 + 2 * Math.min(Math.max(c.briefRound, 1), 4), x = 15;
      f.fill(x - 1, DESK_Y - 2, 13, 2); // the roll it comes off
      for (let y = DESK_Y + 2; y < DESK_Y + len - 1; y += 2) for (let i = 2; i < 9; i++) if ((i * 3 + y) % 7) f.px(x + i, y);
      f.fill(x - 1, DESK_Y + len, 13, 2); // the roll at its foot
      const p = (t / 2600) % 1, line = DESK_Y + len - 2; // the quill writes the last line
      put(QUILL, x + 2 + Math.round(p * 5), line - 4);
      for (let i = 2; i < 2 + Math.round(p * 5); i++) f.px(x + i, line);
    } else if (!c.waiting && !(c.briefRound > 0)) put(BLANK, 18, DESK_Y - 3); // a blank scroll, ready
  }
  const answer = () => { put(SEALED, 8, 117); f.tiny('?', 14, 109); };

  // ---- the sky ---------------------------------------------------------------------
  const MOON = ['.###.', '##...', '#....', '##...', '.###.'];
  const STARS = [[3, 2], [9, 5], [14, 1], [20, 4], [27, 2], [24, 9], [6, 14], [30, 17], [1, 24], [12, 27], [23, 25], [28, 34], [4, 38], [19, 42]];
  // Other councils: small fires in the top right corner, embers when ended.
  function others(list, t) {
    list.slice(0, 3).forEach((c, k) => {
      const x = 27 - k * 6;
      f.fill(x, 8, 5, 1);
      if (c.status === 'ended') { f.px(x + 1 + (Math.floor(t / 1300 + k) % 3), 7); return; }
      const fl = ['..#..', '.##..', '.###.', '##.##'];
      put(Math.floor(t / 400 + k * 3) % 3 ? fl : mirror(fl), x, 4);
    });
  }

  // ---- what to show ----------------------------------------------------------------
  const live = c => c.status !== 'ended';
  const order = list => [...list].sort((a, b) => live(b) - live(a)); // live first; the list comes newest first
  const finished = c => Math.max(0, Math.min(c.running ? c.round - 1 : c.round, LOGS.length));
  const seen = new Map(); // council id -> { logs, at }, for the newest log falling in

  // A fixture council for the preview page's buttons, shown for a minute.
  const NAMES = ['Socrates', 'Nietzsche', 'Odysseus', 'Razor', 'Spark'];
  let fixture = null;
  const councilsOf = d => (fixture && Date.now() < fixture.until ? (typeof fixture.list === 'function' ? fixture.list(Date.now() - fixture.from) : fixture.list) : d.councils);
  function fake(over, states) {
    const cast = NAMES.map((name, i) => ({ name, role: '', state: states[i % states.length], turn: 2, tool: '' }));
    return Object.assign({ id: 'fixture', title: 'Fixture', status: 'live', running: true, round: 2, autoRounds: 3, scribing: false, waiting: false,
      briefRound: 0, handedOverRound: 0, cast }, over);
  }
  const show = list => { fixture = { list, from: Date.now(), until: Date.now() + 60000 }; seen.clear(); posture.clear(); showPage('council'); };
  ['writing', 'thinking', 'tool', 'waiting', 'answered', 'failed', 'stopped'].forEach(s =>
    action('council: ' + s, () => show([fake({ running: s !== 'answered' && s !== 'stopped' }, [s])])));
  action('council: a round', () => show([fake({}, ['writing', 'thinking', 'tool', 'answered', 'waiting'])]));
  // A whole round played out: each member in turn thinks, maybe uses a tool,
  // writes and sits down; then the scribe writes and the answer waits.
  const TURNS = [[700, 0, 1600], [500, 900, 1500], [600, 0, 1400], [400, 700, 1200], [500, 0, 1300]]; // ms thinking, tool, writing
  action('council: play a round', () => show(ms => {
    let at = 1500;
    const states = TURNS.map(([th, to, wr]) => {
      const p = ms - at; at += th + to + wr + 400;
      return p < 0 ? 'waiting' : p < th ? 'thinking' : p < th + to ? 'tool' : p < th + to + wr ? 'writing' : 'answered';
    });
    const scribing = ms >= at && ms < at + 4000, done = ms >= at + 4000;
    return [fake({ round: 1, autoRounds: 1, running: ms < at, scribing, waiting: done, briefRound: ms >= at ? 1 : 0 }, states)];
  }));
  action('council: scribing', () => show([fake({ running: false, round: 3, scribing: true, briefRound: 2 }, ['answered'])]));
  action('council: answer waits', () => show([fake({ running: false, round: 3, waiting: true, briefRound: 3 }, ['answered'])]));
  action('council: handed over', () => show([fake({ running: false, round: 3, briefRound: 3, handedOverRound: 3 }, ['answered'])]));
  action('council: ended', () => show([fake({ status: 'ended', running: false, round: 3, briefRound: 3, handedOverRound: 3 }, ['stopped'])]));
  action('council: several', () => show([fake({}, ['writing', 'thinking', 'waiting']), fake({ id: 'b' }, ['thinking']), fake({ id: 'c', status: 'ended', running: false }, ['stopped'])]));
  action('council: none', () => show([]));
  action('council: reset', () => { fixture = null; seen.clear(); });

  return function council(d, t) {
    const list = order(councilsOf(d) || []);
    if (!list.length) { // embers under the night sky
      put(MOON, 4, 4);
      STARS.forEach(([x, y]) => f.px(x, y));
      fire(2, true, t, 1);
      return;
    }
    const c = list[0], ended = !live(c);
    STARS.slice(0, 5).forEach(([x, y]) => (list.length < 2 || x < 18) && f.px(x, y));
    others(list.slice(1), t);
    scribe(c, t);

    const n = finished(c), was = seen.get(c.id);
    if (!was || n < was.logs) seen.set(c.id, { logs: n, at: -1e9 });
    else if (n > was.logs) seen.set(c.id, { logs: n, at: t });
    fire(n, ended, t, Math.min(1, (t - seen.get(c.id).at) / 800));
    pips(c.round, c.autoRounds);

    // the members around it on an ellipse, starting top right, drawn back to front
    const cast = (c.cast || []).slice(0, 8), k = cast.length;
    cast.map((m, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / k;
      return { m, i, cx: Math.round(FIRE_X + 12 * Math.cos(a)), feet: Math.round(FIRE_Y + 26 * Math.sin(a)) };
    }).sort((p, q) => p.feet - q.feet).forEach(({ m, i, cx, feet }) => {
      const side = cx < FIRE_X - 3 ? 1 : cx > FIRE_X + 3 ? -1 : 0;
      member(m, c.id + '/' + i, cx, feet, side, t, i);
    });

    if (c.waiting) answer();
  };
})());
