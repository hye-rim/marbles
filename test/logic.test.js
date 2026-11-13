'use strict';

// 구슬 쏘기 규칙 시험. 실행: node --test (디렉터리)
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

// 시험용으로 줄을 직접 짠다: colors 는 앞(구멍 쪽)부터, 모두 붙어 있고 head 는 맨 앞 구슬의 길 위치
function setChain(G, colors, head = 300) {
  G.rush = false;
  G.marbles = colors.map((c, i) => ({ id: G.nextId++, c, f: '', s: head - i * L.D }));
  G.cur = colors[0]; G.next = colors[0];
}
const run = (G, n, inp) => { for (let i = 0; i < n; i++) L.step(G, typeof inp === 'function' ? inp(i) : inp); };
// 길 위 s 지점의 구슬을 향해 쏜다 (똑바로 그 구슬의 한가운데로)
function aimAt(G, s) { const p = G.path.at(s); return Math.atan2(p.y - G.shooter.y, p.x - G.shooter.x); }
const evs = (G) => G.events.map((e) => e.t);

test('every path is long enough and gives a point and a direction for any distance', () => {
  for (const k of Object.keys(L.PATHS)) {
    const p = L.pathOf(k); assert.ok(p.len > 700, k);
    for (const s of [-30, 0, 100, p.len / 2, p.len, p.len + 20]) { const q = p.at(s); assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y)); assert.ok(Math.abs(Math.hypot(q.tx, q.ty) - 1) < 1e-6); }
  }
});

test('the first path starts offscreen on the left and ends inside the field', () => {
  const p = L.pathOf('snake3'); assert.ok(p.at(0).x < 0); const e = p.at(p.len); assert.ok(e.x > 0 && e.x < L.W && e.y > 0 && e.y < L.H);
});

test('a new game has the right number of marbles, no starting triple, and ammo colors that exist', () => {
  for (let lv = 0; lv < L.LEVELS.length; lv++) {
    const G = L.newGame({ level: lv, seed: 7 + lv }); assert.strictEqual(G.marbles.length, L.LEVELS[lv].n);
    for (let i = 2; i < G.marbles.length; i++) assert.ok(!(G.marbles[i].c === G.marbles[i - 1].c && G.marbles[i].c === G.marbles[i - 2].c), 'no triple at ' + i);
    const have = new Set(G.marbles.map((m) => m.c)); assert.ok(have.has(G.cur) && have.has(G.next));
    assert.ok(Math.max(...G.marbles.map((m) => m.c)) < L.LEVELS[lv].colors);
  }
});

test('the same seed and the same inputs always give the same game', () => {
  const play = () => { const G = L.newGame({ level: 1, seed: 99 }); run(G, 300, (i) => (i % 40 === 5 ? { fire: aimAt(G, G.marbles[3].s) } : null)); return JSON.stringify(G.marbles) + G.score; };
  assert.strictEqual(play(), play());
});

test('at the start the chain rushes in and then settles to the level speed', () => {
  const G = L.newGame({ level: 0, seed: 1 }); const s0 = G.marbles[0].s; run(G, 10, null); assert.ok(G.marbles[0].s - s0 > 20, 'rush is fast');
  let g = 0; while (G.rush && g++ < 600) L.step(G, null); assert.ok(!G.rush);
  const s1 = G.marbles[0].s; run(G, 100, null); assert.ok(Math.abs((G.marbles[0].s - s1) - 100 * G.lv.speed) < 0.01, 'then steady');
});

test('a shot joins the chain next to the marble it hits and pushes the ones ahead', () => {
  const G = L.newGame({ level: 0, seed: 3 }); setChain(G, [0, 1, 0, 1, 0, 1], 400); G.cur = 2; G.next = 2; G.lv = { ...G.lv, speed: 0 };
  const before = G.marbles.map((m) => m.s); L.step(G, { fire: aimAt(G, 400 - 3 * L.D) });
  let g = 0; while (G.shots.length && g++ < 100) L.step(G, null);
  assert.strictEqual(G.marbles.length, 7); assert.strictEqual(G.marbles.filter((m) => m.c === 2).length, 1);
  for (let i = 1; i < G.marbles.length; i++) assert.ok(G.marbles[i - 1].s - G.marbles[i].s >= L.D - 0.01, 'no overlap at ' + i);
  assert.ok(G.marbles[0].s >= before[0], 'front moved forward, never back');
});

test('three of the same color in a row pop and give points', () => {
  const G = L.newGame({ level: 0, seed: 3 }); setChain(G, [1, 0, 0, 1, 2, 1], 400); G.cur = 0; G.next = 0; G.lv = { ...G.lv, speed: 0 };
  L.step(G, { fire: aimAt(G, 400 - 2 * L.D) }); let popped = null, g = 0;
  while (!popped && g++ < 100) { L.step(G, null); popped = G.events.find((e) => e.t === 'pop'); }
  assert.ok(popped); assert.strictEqual(popped.n, 3); assert.strictEqual(G.marbles.length, 4); assert.ok(G.score >= 30);
});

test('two of a kind do not pop and a different color never pops', () => {
  const G = L.newGame({ level: 0, seed: 3 }); setChain(G, [1, 0, 2, 1, 2, 1], 400); G.cur = 0; G.next = 0; G.lv = { ...G.lv, speed: 0 };
  L.step(G, { fire: aimAt(G, 400 - 1 * L.D) }); let g = 0; while (G.shots.length && g++ < 100) L.step(G, null);
  assert.strictEqual(G.marbles.length, 7); assert.strictEqual(G.popped, 0);
});

test('popping the middle leaves a gap; the back part catches up and a matching join pops again as a combo', () => {
  const G = L.newGame({ level: 0, seed: 3 }); G.lv = { ...G.lv, speed: 0 };
  G.rush = false; G.marbles = [1, 1, 2, 2, 1, 1].map((c, i) => ({ id: G.nextId++, c, f: '', s: 400 - i * L.D })); G.cur = 2; G.next = 2;
  L.step(G, { fire: aimAt(G, 400 - 2.5 * L.D) });
  let combo = false, pops = 0, g = 0; while (g++ < 200) { L.step(G, null); for (const e of G.events) { if (e.t === 'pop') pops++; if (e.t === 'combo') combo = true; } }
  assert.strictEqual(pops, 2, 'first the 2s, then the 1s'); assert.ok(combo); assert.strictEqual(G.marbles.length, 0, 'everything gone'); assert.strictEqual(G.state, 'win');
});

test('the front part waits while the gap closes and then the parts rejoin', () => {
  const G = L.newGame({ level: 0, seed: 3 }); G.lv = { ...G.lv, speed: 0.5 }; G.rush = false;
  G.marbles = [1, 2, 0, 0, 2, 1, 0].map((c, i) => ({ id: G.nextId++, c, f: '', s: 400 - i * L.D })); G.cur = 0; G.next = 0;
  L.step(G, { fire: aimAt(G, 400 - 2.5 * L.D) }); let g = 0; while (G.shots.length && g++ < 100) L.step(G, null);
  assert.ok(G.popped >= 3, 'popped the 0s'); const frontBefore = G.marbles[0].s; L.step(G, null);
  assert.ok(Math.abs(G.marbles[0].s - frontBefore) < 1e-9, 'front part stays while the gap is open');
  run(G, 40, null); for (let i = 1; i < G.marbles.length; i++) assert.ok(G.marbles[i - 1].s - G.marbles[i].s <= L.D + 0.7, 'rejoined');
});

test('a bomb marble that pops also pops three neighbors on each side', () => {
  const G = L.newGame({ level: 1, seed: 3 }); G.lv = { ...G.lv, speed: 0 };
  setChain(G, [1, 2, 1, 2, 1, 0, 0, 1, 2, 1, 2, 1], 500); G.marbles[5].f = 'b'; G.cur = 0; G.next = 0;
  L.step(G, { fire: aimAt(G, 500 - 6.5 * L.D) }); let pop = null, g = 0; while (!pop && g++ < 100) { L.step(G, null); pop = G.events.find((e) => e.t === 'pop'); }
  assert.ok(pop && pop.bomb && pop.n === 9, 'popped 3 plus 3 on each side: ' + (pop && pop.n));
});

test('a slow marble that pops slows the chain for a while', () => {
  const G = L.newGame({ level: 1, seed: 3 }); G.lv = { ...G.lv, speed: 0.3 };
  setChain(G, [1, 2, 1, 2, 0, 0, 1, 2], 400); G.marbles[4].f = 's'; G.cur = 0; G.next = 0;
  L.step(G, { fire: aimAt(G, 400 - 5.5 * L.D) }); let g = 0; while (G.slowT === 0 && g++ < 100) L.step(G, null);
  assert.ok(G.slowT > 0); run(G, 40, null); const s = G.marbles[0].s; run(G, 10, null); assert.ok(Math.abs((G.marbles[0].s - s) - 10 * 0.3 * 0.3) < 0.02, 'moves at 30 percent');
});

test('a shot that hits nothing flies off the field and a swap exchanges the two ammo', () => {
  const G = L.newGame({ level: 0, seed: 3 }); setChain(G, [0, 1, 0, 1], 100); G.lv = { ...G.lv, speed: 0 };
  G.cur = 0; G.next = 1; L.step(G, { swap: true }); assert.strictEqual(G.cur, 1); assert.strictEqual(G.next, 0);
  L.step(G, { fire: Math.PI / 2 }); let missed = false, g = 0; while (G.shots.length && g++ < 200) { L.step(G, null); if (evs(G).includes('miss')) missed = true; } assert.ok(missed); assert.strictEqual(G.marbles.length, 4);
});

test('you cannot fire faster than the cooldown and only a few shots fly at once', () => {
  const G = L.newGame({ level: 0, seed: 3 }); setChain(G, [0, 1, 0, 1], 100); G.lv = { ...G.lv, speed: 0 };
  let fired = 0; for (let i = 0; i < 5; i++) { L.step(G, { fire: -Math.PI / 2 }); fired += G.events.filter((e) => e.t === 'fire').length; }
  assert.strictEqual(fired, 1, 'cooldown'); run(G, 9, null); L.step(G, { fire: -Math.PI / 2 }); assert.strictEqual(G.shotsFired, 2);
});

test('when the front marble reaches the hole you lose, and the chain keeps rolling in', () => {
  const G = L.newGame({ level: 0, seed: 3 }); setChain(G, [0, 1, 0, 1], G.path.len - 1); G.lv = { ...G.lv, speed: 2 };
  run(G, 3, null); assert.strictEqual(G.state, 'lose'); const s = G.marbles[0].s; run(G, 3, null); assert.ok(G.marbles[0].s > s);
  assert.strictEqual(L.danger(G), 1);
});

test('popping every marble wins the level and adds a bonus', () => {
  const G = L.newGame({ level: 2, seed: 3 }); G.lv = { ...G.lv, speed: 0 }; G.rush = false; G.marbles = [0, 0].map((c, i) => ({ id: G.nextId++, c, f: '', s: 300 - i * L.D }));
  G.cur = 0; G.next = 0; L.step(G, { fire: aimAt(G, 300 - L.D / 2) }); let g = 0; while (G.state === 'play' && g++ < 100) L.step(G, null);
  assert.strictEqual(G.state, 'win'); assert.ok(G.score >= 30 + 100);
});

test('after the last color of a kind is gone the ammo switches to colors that remain', () => {
  const G = L.newGame({ level: 0, seed: 3 }); G.lv = { ...G.lv, speed: 0 }; setChain(G, [0, 0, 1, 1, 1, 0], 300); G.cur = 1; G.next = 1;
  L.step(G, { fire: aimAt(G, 300 - 2 * L.D) }); let g = 0; while ((G.shots.length || G.popped === 0) && g++ < 100) L.step(G, null);
  const have = new Set(G.marbles.map((m) => m.c)); assert.ok(have.has(G.cur) && have.has(G.next));
});

test('the practice game is small and slow and never lets the chain reach the hole', () => {
  const G = L.newGame({ tutorial: true, seed: 5 }); assert.ok(G.marbles.length <= 16); run(G, 3000, null); assert.strictEqual(G.state, 'play'); assert.ok(L.danger(G) < 0.7);
});

test('the early levels are beaten by a simple bot and the last ones are at least 40 percent cleared by it', () => {
  const bot = require('./bot.js');
  for (let lv = 0; lv < L.LEVELS.length; lv++) {
    const r = bot.play(lv, 11 + lv, 'normal');
    if (lv < 4) assert.strictEqual(r.state, 'win', 'level ' + (lv + 1) + ' bot ' + r.state + ' left ' + r.left);
    else assert.ok(r.state === 'win' || r.left <= L.LEVELS[lv].n * 0.6, 'level ' + (lv + 1) + ' left ' + r.left);
  }
});
