'use strict';
// 사람처럼 겨누는 봇: 쏠 구슬(또는 다음 구슬)과 같은 색이 붙은 곳을 직선으로 맞힐 수 있는 각도를 고른다.
// skill: 'normal' 0.5초에 한 번 쏜다. 'slow' 1초에 한 번.
const L = require('../logic.js');

// 쏜 구슬이 처음 맞히게 될 구슬 번호를 센다 (규칙과 같은 충돌 거리)
function firstHit(G, ang) {
  let x = G.shooter.x, y = G.shooter.y; const vx = Math.cos(ang) * 3, vy = Math.sin(ang) * 3, lim = (L.D * 0.92) ** 2;
  for (let k = 0; k < 140; k++) {
    x += vx; y += vy; if (x < -30 || x > L.W + 30 || y < -30 || y > L.H + 30) return -1;
    for (let i = 0; i < G.marbles.length; i++) { const m = G.marbles[i]; if (m.s < 0) continue; const q = G.path.at(m.s); if ((q.x - x) ** 2 + (q.y - y) ** 2 < lim) return i; }
  }
  return -1;
}
function runLen(G, i, c) { let n = 1, a = i, b = i; while (G.marbles[a - 1] && G.marbles[a - 1].c === c && L.touching(G, a)) { a--; n++; } while (G.marbles[b + 1] && G.marbles[b + 1].c === c && L.touching(G, b + 1)) { b++; n++; } return n; }
function choose(G) {
  const sw = [G.cur, G.next]; let best = { score: -1, ang: -Math.PI / 2, swap: false };
  for (let w = 0; w < 2; w++) {
    const c = sw[w];
    for (let a = 0; a < 360; a += 1) {
      const ang = a * Math.PI / 180 - Math.PI, h = firstHit(G, ang); if (h < 0) continue;
      const m = G.marbles[h]; let sc = 0;
      if (m.c === c) { const r = runLen(G, h, c); sc = r >= 2 ? 100 + r * 10 : 5 + r; } else sc = 1;
      sc += (m.s / G.path.len) * 6;                                 // 구멍에 가까운 곳 우선
      if (sc > best.score) best = { score: sc, ang, swap: w === 1 };
    }
  }
  return best;
}
function play(level, seed, skill = 'normal', maxFrames = 60 * 60 * 6) {
  const G = L.newGame({ level, seed }); const every = skill === 'slow' ? 60 : 30; let f = 0;
  while (G.state === 'play' && f++ < maxFrames) {
    let inp = null;
    if (f > 150 && f % every === 0) { const b = choose(G); if (b.swap) L.step(G, { swap: true }); inp = { fire: b.ang }; }
    L.step(G, inp);
  }
  return { state: G.state, score: G.score, frames: f, left: G.marbles.length, shots: G.shotsFired };
}
module.exports = { play, choose };
if (require.main === module && process.env.BOT) {
  for (const skill of ['normal', 'slow']) for (let lv = 0; lv < L.LEVELS.length; lv++) {
    let w = 0, tot = 0; const rs = []; for (let s = 1; s <= 6; s++) { const r = play(lv, s * 31 + lv, skill); rs.push(r); if (r.state === 'win') w++; tot += r.frames / 60; }
    console.log(skill, 'lv', lv + 1, 'win', w + '/6', 'avg sec', Math.round(tot / 6), 'left', rs.map((r) => r.left).join(','));
  }
}
