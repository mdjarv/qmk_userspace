// agents: a robot per Agentique session updated in the last hour, the rest
// counted under LATER.
'use strict';

page('agents', (function () {
  return function agents(d, t) {
    const a = d.agents;
    if (!a) { robot(0, 10, 'idle', t); f.tiny('NO', 15, 10); f.tiny('LINK', 15, 16); return; }
    f.tiny('RUN ' + a.running, 0, 0);
    f.tinyRight('?' + a.waiting, 0);
    f.dotted(7);

    let y = 10;
    if (a.rows.length === 0) { robot(0, y, 'idle', t); f.tiny('QUIET', 13, y + 2); y += 12; }
    a.rows.forEach((r, i) => { robot(0, y, r.state, t, i); f.tiny(r.name.slice(0, 4), 15, y + 2); y += 12; });

    if (a.laterWaiting || a.laterIdle) {
      y += 2;
      f.tiny('LATER', 0, y);
      f.dotted(y + 7);
      y += 11;
      if (a.laterWaiting) {
        robot(0, y, 'waiting', t);
        f.tiny(String(a.laterWaiting), 15, y + 2);
        f.tinyRight(a.oldestWait, y + 2);
        y += 12;
      }
      if (a.laterIdle) { robot(0, y, 'idle', t); f.tiny(String(a.laterIdle), 15, y + 2); }
    }
  };
})());
