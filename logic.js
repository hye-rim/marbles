'use strict';
// 구슬 쏘기 규칙 (DOM 없음). 구슬 줄이 길을 따라 구멍으로 굴러가고, 같은 색 구슬을 쏴서 3개 이상 잇대어 터뜨린다.
// 1/60초 한 칸씩 step() 으로 진행하고, 같은 시드·같은 입력이면 늘 같은 결과다.
const LOGIC_MB = (() => {
  const W = 300, H = 400, R = 8.5, D = 17;       // 판 크기, 구슬 반지름, 이웃한 구슬 사이 거리(지름)
  const EPS = 0.6;                                // 이만큼 이하로 벌어져 있으면 붙은 것으로 본다
  const SHOT_V = 9, FIRE_GAP = 9;                 // 쏜 구슬 속도(칸/프레임), 연달아 쏠 때 최소 간격(프레임)
  const CATCH = 5;                                // 끊어진 뒤쪽 줄이 앞줄을 따라잡는 속도
  const RUSH = 3;                                 // 시작할 때 줄이 달려 들어오는 속도
  const SLOW_FRAMES = 300, SLOW_MUL = 0.3;        // ⏳ 구슬: 5초 동안 30% 속도

  function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // ---------- 길 ----------
  // 꺾이는 점을 둥글게 깎아 부드러운 길로 만들고, 1칸마다 위치를 적어 둔다 (s = 길을 따라 간 거리).
  function buildPath(pts, rad) {
    const poly = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
      const r = Math.min(rad, l1 / 2, l2 / 2);
      const p = [b[0] + (a[0] - b[0]) * r / l1, b[1] + (a[1] - b[1]) * r / l1], q = [b[0] + (c[0] - b[0]) * r / l2, b[1] + (c[1] - b[1]) * r / l2];
      for (let k = 0; k <= 10; k++) { const t = k / 10, u = 1 - t; poly.push([u * u * p[0] + 2 * u * t * b[0] + t * t * q[0], u * u * p[1] + 2 * u * t * b[1] + t * t * q[1]]); }
    }
    poly.push(pts[pts.length - 1]);
    const cum = [0]; for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
    const len = cum[cum.length - 1], tab = [];
    let j = 0;
    for (let s = 0; s <= Math.ceil(len); s++) {
      while (j < poly.length - 2 && cum[j + 1] < s) j++;
      const seg = cum[j + 1] - cum[j] || 1, f = Math.min(1, (s - cum[j]) / seg), a = poly[j], b = poly[j + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], dl = Math.hypot(dx, dy) || 1;
      tab.push({ x: a[0] + dx * f, y: a[1] + dy * f, tx: dx / dl, ty: dy / dl });
    }
    const first = tab[0], last = tab[tab.length - 1];
    // 길 앞(구슬이 들어오는 쪽)과 뒤(구멍 너머)는 곧게 이어 붙여 계산한다
    function at(s) {
      if (s < 0) return { x: first.x + first.tx * s, y: first.y + first.ty * s, tx: first.tx, ty: first.ty };
      if (s > len) return { x: last.x + last.tx * (s - len), y: last.y + last.ty * (s - len), tx: last.tx, ty: last.ty };
      const i = Math.floor(s), f = s - i, a = tab[i], b = tab[Math.min(tab.length - 1, i + 1)];
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, tx: a.tx, ty: a.ty };
    }
    return { len, at, pts: poly };
  }

  const PATHS = {
    snake3: { pts: [[-20, 60], [262, 60], [262, 140], [38, 140], [38, 220], [250, 220]], rad: 26, shooter: [150, 335] },
    spiral: { pts: [[-20, 40], [270, 40], [270, 360], [30, 360], [30, 85], [225, 85], [225, 315], [75, 315], [75, 130], [180, 130]], rad: 24, shooter: [150, 205] },
    snake4: { pts: [[-20, 40], [270, 40], [270, 108], [30, 108], [30, 176], [270, 176], [270, 244], [150, 244]], rad: 24, shooter: [150, 340] },
    zigzag: { pts: [[-20, 40], [255, 40], [45, 125], [255, 210], [60, 285], [200, 295]], rad: 30, shooter: [150, 362] },
  };
  // 단계표: n 구슬 수, colors 색 수, speed 줄 속도(칸/프레임), flag 특수 구슬 비율
  const LEVELS = [
    { name: '첫걸음', path: 'snake3', n: 24, colors: 3, speed: 0.15, flag: 0 },
    { name: '나선', path: 'spiral', n: 40, colors: 3, speed: 0.17, flag: 0.07 },
    { name: '구불구불', path: 'snake4', n: 36, colors: 4, speed: 0.17, flag: 0.07 },
    { name: '지그재그', path: 'zigzag', n: 36, colors: 4, speed: 0.18, flag: 0.07 },
    { name: '긴 뱀', path: 'snake3', n: 36, colors: 4, speed: 0.17, flag: 0.07 },
    { name: '큰 나선', path: 'spiral', n: 80, colors: 5, speed: 0.3, flag: 0.07 },
    { name: '빽빽한 길', path: 'snake4', n: 38, colors: 5, speed: 0.15, flag: 0.07 },
    { name: '마지막 길', path: 'zigzag', n: 40, colors: 5, speed: 0.17, flag: 0.07 },
  ];
  const pathCache = {};
  function pathOf(name) { if (!pathCache[name]) pathCache[name] = buildPath(PATHS[name].pts, PATHS[name].rad); return pathCache[name]; }

  // ---------- 새 판 ----------
  // opts: level(0부터), seed, tutorial(연습: 구슬 적고 느리며 구멍에 닿지 않는다)
  function newGame(opts = {}) {
    const lvIdx = Math.max(0, Math.min(LEVELS.length - 1, opts.level | 0));
    const lv = opts.tutorial ? { name: '연습', path: 'snake3', n: 16, colors: 3, speed: 0.08, flag: 0 } : LEVELS[lvIdx];
    const rnd = rng(opts.seed == null ? 12345 : opts.seed), path = pathOf(lv.path), sh = PATHS[lv.path].shooter;
    const G = {
      lvIdx, lv, path, rnd, tutorial: !!opts.tutorial, marbles: [], shots: [], events: [], nextId: 1,
      shooter: { x: sh[0], y: sh[1] }, cur: 0, next: 0, cool: 0, slowT: 0, rush: true, chain: 0,
      score: opts.score | 0, state: 'play', t: 0, shotsFired: 0, popped: 0, tutorialStopAt: 0.62,
    };
    let prev = -1, prev2 = -1;
    for (let i = 0; i < lv.n; i++) {
      let c; do { c = Math.floor(rnd() * lv.colors); } while (c === prev && c === prev2);
      prev2 = prev; prev = c;
      const f = (i > 4 && lv.flag > 0 && rnd() < lv.flag) ? (rnd() < 0.5 ? 'b' : 's') : '';
      G.marbles.push({ id: G.nextId++, c, f, s: 40 - i * D });
    }
    G.cur = pickColor(G); G.next = pickColor(G);
    return G;
  }

  // 쏠 구슬 색은 지금 줄에 남아 있는 색에서만 고른다 (없는 색을 줘서 막히는 일이 없게)
  function pickColor(G) {
    const have = [...new Set(G.marbles.map((m) => m.c))];
    if (!have.length) return 0;
    return have[Math.floor(G.rnd() * have.length)];
  }

  // ---------- 터뜨리기 ----------
  const touching = (G, i) => i > 0 && i < G.marbles.length && G.marbles[i - 1].s - G.marbles[i].s <= D + EPS;   // i-1 과 i 가 붙어 있나

  // idx 의 구슬과 같은 색으로 이어진 덩어리가 3개 이상이면 터뜨린다. 터뜨렸으면 true.
  function clearRun(G, idx) {
    const M = G.marbles; if (!M[idx]) return false;
    const c = M[idx].c; let lo = idx, hi = idx;
    while (touching(G, lo) && M[lo - 1].c === c) lo--;
    while (touching(G, hi + 1) && M[hi + 1].c === c) hi++;
    const cnt = hi - lo + 1; if (cnt < 3) return false;
    let bomb = false, slow = false;
    for (let i = lo; i <= hi; i++) { if (M[i].f === 'b') bomb = true; if (M[i].f === 's') slow = true; }
    let a = lo, b = hi;
    if (bomb) { a = Math.max(0, lo - 3); b = Math.min(M.length - 1, hi + 3); }       // 💣: 양옆 3개씩 더 터뜨린다
    const gone = M.splice(a, b - a + 1);
    const n = gone.length;
    const gain = Math.round((n * 10 + Math.max(0, n - 3) * 15 + (bomb ? 50 : 0)) * (1 + 0.5 * G.chain));
    G.score += gain; G.popped += n;
    if (slow) G.slowT = SLOW_FRAMES;
    G.events.push({ t: 'pop', n, gain, chain: G.chain, bomb, slow, at: gone.map((m) => ({ id: m.id, c: m.c, f: m.f, ...G.path.at(m.s) })) });
    return true;
  }

  // ---------- 쏘기 ----------
  function insertShot(G, shot, hitIdx) {
    const M = G.marbles, h = M[hitIdx], p = G.path.at(h.s);
    const ahead = (shot.x - p.x) * p.tx + (shot.y - p.y) * p.ty > 0;       // 맞은 구슬보다 구멍 쪽에 붙었나
    const k = ahead ? hitIdx : hitIdx + 1;                                  // 새 구슬이 들어갈 자리
    let s;
    if (k < M.length) s = M[k].s + D; else s = M[M.length - 1].s - D;
    const nm = { id: G.nextId++, c: shot.c, f: '', s };
    M.splice(k, 0, nm);
    for (let j = k - 1; j >= 0; j--) { if (M[j].s < M[j + 1].s + D) M[j].s = M[j + 1].s + D; else break; }   // 앞쪽 구슬을 밀어 준다
    G.events.push({ t: 'insert', id: nm.id, c: nm.c, x: shot.x, y: shot.y });
    G.chain = 0;
    const cleared = clearRun(G, k);
    if (!cleared) G.events.push({ t: 'settle', id: nm.id });
    return cleared;
  }

  function fire(G, angle) {
    if (G.cool > 0 || G.shots.length >= 4) return false;
    const c = G.cur;
    G.shots.push({ x: G.shooter.x, y: G.shooter.y, vx: Math.cos(angle) * SHOT_V, vy: Math.sin(angle) * SHOT_V, c });
    G.cur = G.next; G.next = pickColor(G); G.cool = FIRE_GAP; G.shotsFired++;
    G.events.push({ t: 'fire', c, angle });
    return true;
  }

  function moveShots(G) {
    for (let si = G.shots.length - 1; si >= 0; si--) {
      const sh = G.shots[si]; let gone = false;
      for (let sub = 0; sub < 3 && !gone; sub++) {
        sh.x += sh.vx / 3; sh.y += sh.vy / 3;
        if (sh.x < -30 || sh.x > W + 30 || sh.y < -30 || sh.y > H + 30) { gone = true; G.events.push({ t: 'miss' }); break; }
        let best = -1, bd = (D * 0.92) * (D * 0.92);
        for (let i = 0; i < G.marbles.length; i++) {
          const m = G.marbles[i]; if (m.s < 0) continue;
          const q = G.path.at(m.s), d2 = (q.x - sh.x) ** 2 + (q.y - sh.y) ** 2;
          if (d2 < bd) { bd = d2; best = i; }
        }
        if (best >= 0) { insertShot(G, sh, best); gone = true; }
      }
      if (gone) G.shots.splice(si, 1);
    }
  }

  // ---------- 줄 움직이기 ----------
  function moveChain(G) {
    const M = G.marbles; if (!M.length) return;
    let v = G.lv.speed * (G.slowT > 0 ? SLOW_MUL : 1);
    if (G.rush) { v = RUSH; if (M[0].s >= G.path.len * 0.3) G.rush = false; }
    if (G.tutorial && M[0].s >= G.path.len * G.tutorialStopAt) v = 0;
    // 줄을 토막(붙어 있는 덩어리)으로 나눈다
    const segs = []; let st = 0;
    for (let i = 1; i <= M.length; i++) if (i === M.length || !touching(G, i)) { segs.push([st, i - 1]); st = i; }
    if (segs.length === 1) { for (const m of M) m.s += v; return; }
    // 앞 토막은 서고, 뒤 토막들은 앞 토막에 붙을 때까지 빨리 따라간다
    for (let k = 1; k < segs.length; k++) {
      const [a, b] = segs[k], front = M[a - 1], gap = front.s - M[a].s - D;
      const mv = Math.min(CATCH, gap);
      for (let i = a; i <= b; i++) M[i].s += mv;
      if (gap - mv <= 0.01) {                                             // 붙었다
        const ex = front.s - M[a].s - D; if (ex !== 0) for (let i = a; i <= b; i++) M[i].s += ex;
        G.events.push({ t: 'join', id: M[a].id });
        if (front.c === M[a].c) { G.chain++; if (clearRun(G, a)) G.events.push({ t: 'combo', chain: G.chain }); else G.chain = Math.max(0, G.chain - 1); }
        return;                                                           // 줄이 바뀌었으니 다음 칸에 다시 센다
      }
    }
  }

  function step(G, input) {
    G.events = [];
    if (G.state === 'lose') {                                             // 줄이 구멍으로 빨려 들어간다
      for (const m of G.marbles) m.s += 7;
      return G.events;
    }
    if (G.state !== 'play') return G.events;
    G.t++; if (G.cool > 0) G.cool--; if (G.slowT > 0) G.slowT--;
    if (input && input.swap) { const t = G.cur; G.cur = G.next; G.next = t; G.events.push({ t: 'swap' }); }
    if (input && typeof input.fire === 'number') fire(G, input.fire);
    moveShots(G);
    moveChain(G);
    // 같은 색이 새로 닿아 터지고 나면 색이 사라질 수 있으니 쏠 구슬 색을 다시 맞춘다
    const have = new Set(G.marbles.map((m) => m.c));
    if (have.size) { if (!have.has(G.cur)) G.cur = pickColor(G); if (!have.has(G.next)) G.next = pickColor(G); }
    const M = G.marbles;
    if (!M.length) { G.state = 'win'; G.score += 100 + G.lvIdx * 20; G.events.push({ t: 'win' }); return G.events; }
    if (M[0].s >= G.path.len) { G.state = 'lose'; G.events.push({ t: 'lose' }); }
    return G.events;
  }

  // 구멍까지 남은 비율 (0 멀다 ~ 1 코앞). 화면에서 위험 표시에 쓴다.
  function danger(G) { return G.marbles.length ? Math.max(0, Math.min(1, G.marbles[0].s / G.path.len)) : 0; }
  // 몇 번째 구슬인지와 위치를 화면용으로
  function posOf(G, m) { return G.path.at(m.s); }

  return { W, H, R, D, LEVELS, PATHS, rng, buildPath, pathOf, newGame, step, fire, danger, posOf, pickColor, clearRun, touching, SLOW_FRAMES };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_MB;
