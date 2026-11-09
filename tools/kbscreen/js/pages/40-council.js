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

  // ---- the cast: 7 wide, front-on, faces cut out ----------------------------
  // head: the rows down to the chin; eyes: the row with the eyes, which
  // dozing closes. Built-in personas have a look of their own; anyone else is
  // hooded, the hood picked by a hash of the name.
  const LOOKS = {
    socrates: { head: ['..###..', '.#####.', '.#.#.#.', '.#####.', '##...##', '#######', '.#####.', '..#.#..'], eyes: 2 }, // bald, a beard
    nietzsche: { head: ['.#####.', '.#####.', '.#.#.#.', '.#####.', '#######', '#.#.#.#', '..###..'], eyes: 2 },      // the moustache
    odysseus: { head: ['#.#.#.#', '.#####.', '...#...', '.#####.', '.#...#.', '.##.##.', '.##.##.'], eyes: -1 },     // a plumed helmet
    spark: { head: ['#..#..#', '.#.#.#.', '.#####.', '.#.#.#.', '.#####.', '..###..'], eyes: 3 },                    // lightning hair
    razor: { head: ['...#...', '..###..', '..#.#..', '..###..', '...#...'], eyes: 2, thin: true },                    // blade-thin
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
    return { head: HOODS[h % HOODS.length], eyes: 4, hood: true, belt: (h >> 2) % 2 === 1 };
  }
  // Bodies from the shoulders down, 7 wide; seated ones end where they sit
  // on their log.
  const BODY = {
    stand: ['.#####.', '#######', '#.###.#', '#.###.#', '..###..', '..#.#..', '..#.#..'],
    seat: ['.#####.', '#.###.#', '#######'],
    thinStand: ['..###..', '.#.#.#.', '.#.#.#.', '..###..', '..#.#..', '..#.#..'],
    thinSeat: ['..###..', '.#.#.#.', '.#####.'],
    cloak: ['#######', '#######', '.#####.', '.#####.', '.#####.', '.#...#.'],
    cloakSeat: ['#######', '#######', '#######'],
  };
  const LOG = ['###########'];
  const LANTERN = ['.#.', '###', '#.#', '###'];
  // the speaker's arm on the fire side, out and up in turn: [dx, dy] from the
  // body's top left, for a fire to the right
  const ARMS = [[[6, 1], [7, 1], [8, 0]], [[6, 1], [7, 0], [8, -1], [8, -2]]];

  // Pixels of rows at (x, y), for drawing a figure with a dark outline.
  const lit = (rows, x, y, out) => rows.forEach((r, yy) => { for (let xx = 0; xx < r.length; xx++) if (r[xx] === '#') out.push([x + xx, y + yy]); });

  // A member at its seat (cx, feet); side is where the fire is (-1 left, 1
  // right, 0 above or below). Seated states sit on the seat's log. Speaking
  // and using a tool stand up off it, a step toward the fire, outlined so
  // they stand out against it. Returns the top of its head.
  function member(m, cx, feet, side, t, i) {
    const look = lookOf(m.name), s = m.state;
    const standing = s === 'writing' || s === 'tool';
    put(LOG, cx - 5, feet);
    let head = look.head;
    if (s === 'stopped' && look.eyes >= 0) head = head.map((r, k) => (k === look.eyes ? r[0] + r.slice(1, -1).replace(/\./g, look.hood ? '.' : '#') + r.slice(-1) : r));
    if (s === 'stopped' && look.hood) head = head.map((r, k) => (k === look.eyes ? '#.....#' : r));
    if (standing) {
      const x = cx - 3 + (side ? side * 2 : 5), ft = feet; // off the log, toward the fire or aside
      let body = look.hood ? BODY.cloak : look.thin ? BODY.thinStand : BODY.stand;
      const top = ft - body.length + 1, hy = top - head.length, px = [];
      const toward = side || 1;
      if (s === 'writing' && !look.thin) // the fire-side arm comes off the body to gesture
        body = body.map((r, k) => (k >= 1 && k <= 3 ? (toward > 0 ? r.slice(0, 6) + '.' : '.' + r.slice(1)) : r));
      lit(body, x, top, px);
      lit(head, x, hy, px);
      if (s === 'writing') ARMS[Math.floor(t / 750 + i) % 2].forEach(([dx, dy]) => px.push([toward > 0 ? x + dx : x + 6 - dx, top + dy]));
      if (s === 'tool') lit(LANTERN, side > 0 ? x - 4 : x + 8, top + 2 + (Math.floor(t / 900 + i) % 2), px);
      px.forEach(([a, b]) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) f.px(a + dx, b + dy, false); });
      px.forEach(([a, b]) => f.px(a, b));
      if (look.belt) f.fill(x + 1, top + 2, 5, 1, false);
      return hy;
    }
    const body = look.hood ? BODY.cloakSeat : look.thin ? BODY.thinSeat : BODY.seat;
    const x = cx - 3, top = feet - body.length;
    put(body, x, top);
    // the head: upright; leaning back from the fire when answered; dropped
    // toward it when failed; bowed when dozing
    let hx = x, hy = top - head.length;
    if (s === 'answered') hx -= 2 * side;
    if (s === 'failed') { hx += side || 0; hy += 3; }
    if (s === 'stopped') hy += 2;
    put(head, hx, hy);
    if (s === 'thinking') // dots rising like smoke
      for (let k = 0; k < 3; k++) {
        const p = ((t / 2200) + k / 3 + i * 0.17) % 1;
        if (p < 0.85) f.px(cx + Math.round(Math.sin(p * 7 + k + i) * 1.2), hy - 2 - Math.round(p * 8));
      }
    if (s === 'stopped') { const p = ((t / 2000) + i * 0.3) % 1; f.tiny('Z', cx + (side > 0 ? -6 : 4) + Math.round(p * 2), hy - 3 - Math.round(p * 4)); }
    return hy;
  }

  // Small arcs drifting from a speaker's mouth to the fire, bowed toward it.
  function sound(x0, y0, x1, y1, t, i) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    for (let k = 0; k < 2; k++) {
      const p = ((t / 1800) + k / 2 + i * 0.23) % 1, d = 2 + p * (len - 6);
      if (d > len - 5) continue;
      const cx = x0 + ux * d, cy = y0 + uy * d;
      f.px(cx, cy);
      f.px(cx - ux - uy * 1.3, cy - uy + ux * 1.3);
      f.px(cx - ux + uy * 1.3, cy - uy - ux * 1.3);
    }
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
  const councilsOf = d => (fixture && Date.now() < fixture.until ? fixture.list : d.councils);
  function fake(over, states) {
    const cast = NAMES.map((name, i) => ({ name, role: '', state: states[i % states.length], turn: 2, tool: '' }));
    return Object.assign({ id: 'fixture', title: 'Fixture', status: 'live', running: true, round: 2, autoRounds: 3, scribing: false, waiting: false,
      briefRound: 0, handedOverRound: 0, cast }, over);
  }
  const show = list => { fixture = { list, until: Date.now() + 60000 }; seen.clear(); showPage('council'); };
  ['writing', 'thinking', 'tool', 'waiting', 'answered', 'failed', 'stopped'].forEach(s =>
    action('council: ' + s, () => show([fake({ running: s !== 'answered' && s !== 'stopped' }, [s])])));
  action('council: a round', () => show([fake({}, ['writing', 'thinking', 'tool', 'answered', 'waiting'])]));
  action('council: scribing', () => show([fake({ running: false, round: 3, scribing: true, briefRound: 2 }, ['answered'])]));
  action('council: answer waits', () => show([fake({ running: false, round: 3, waiting: true, briefRound: 3 }, ['answered'])]));
  action('council: handed over', () => show([fake({ running: false, round: 3, briefRound: 3, handedOverRound: 3 }, ['answered'])]));
  action('council: ended', () => show([fake({ status: 'ended', running: false, round: 3, briefRound: 3, handedOverRound: 3 }, ['stopped'])]));
  action('council: several', () => show([fake({}, ['writing', 'thinking', 'waiting']), fake({ id: 'b' }, ['thinking']), fake({ id: 'c', status: 'ended', running: false }, ['stopped'])]));
  action('council: none', () => show([]));

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
      const top = member(m, cx, feet, side, t, i);
      if (m.state === 'writing') sound(cx + side * 5, top + 3, FIRE_X, FIRE_Y - 8, t, i);
    });

    if (c.waiting) answer();
  };
})());
