'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 구슬 쏘기: 화면·입력·소리. 규칙은 logic.js (LOGIC_MB). 여기서는 규칙이 알려 주는 일(events)을 보고 소리·효과를 만든다.
const L = LOGIC_MB, $ = (id) => document.getElementById(id);
const TUT = /[?&]tutorial=1(&|$)/.test(location.search);
const cv = $('c'), ctx = cv.getContext('2d');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 계속 */ } },
};
const LAST = L.LEVELS.length - 1;
let unlocked = Math.max(0, Math.min(LAST, store.get('mbLevel', 0) | 0)), best = store.get('mbBest', 0) | 0, soundOn = store.get('mbSound', true);
let G = null, screen = 'start', paused = false, selLevel = unlocked, endT = 0, runScore = 0;
let vis = {}, parts = [], floats = [], shake = 0, aim = -Math.PI / 2, aimOn = false, pend = { fire: null, swap: false };
const COLORS = [['#ff7a6a', '#c8281c'], ['#6ab4ff', '#1c5cc8'], ['#6ae88a', '#1c9a3c'], ['#ffe27a', '#c8941c'], ['#c88aff', '#7a2cc8']];

// ---------- 소리 ----------
let audio = null;
function tone(freq, dur, type = 'square', vol = 0.05, slide = 0, delay = 0) {
  if (!soundOn) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audio.currentTime + delay, o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0); if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(audio.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  } catch (e) { /* 소리가 안 나도 게임은 계속 */ }
}
const sfx = {
  fire() { tone(520, 0.08, 'sine', 0.04, -240); },
  insert() { tone(220, 0.06, 'triangle', 0.05, -40); },
  pop(n, chain) { const b = 420 + chain * 90; for (let i = 0; i < Math.min(n, 6); i++) tone(b + i * 70, 0.12, 'triangle', 0.05, 40, i * 0.04); },
  bomb() { tone(110, 0.35, 'sawtooth', 0.08, -70); tone(60, 0.35, 'square', 0.06, -20, 0.02); },
  slow() { tone(600, 0.3, 'sine', 0.05, -400); },
  swap() { tone(380, 0.05, 'square', 0.03, 120); },
  miss() { tone(160, 0.08, 'sine', 0.025, -60); },
  win() { [523, 659, 784, 1046].forEach((f, k) => tone(f, 0.2, 'triangle', 0.06, 0, k * 0.1)); },
  lose() { [392, 330, 262, 196].forEach((f, k) => tone(f, 0.3, 'triangle', 0.05, 0, k * 0.16)); },
};

// ---------- 크기 맞추기 ----------
let cssW = 300, K = 1;
function resize() {
  const wrap = $('stageWrap'), w = wrap.clientWidth - 16, h = wrap.clientHeight - 8;
  const s = Math.max(0.4, Math.min(w / L.W, h / L.H)); cssW = L.W * s;
  cv.style.width = L.W * s + 'px'; cv.style.height = L.H * s + 'px';
  K = Math.max(1, Math.ceil(s * (window.devicePixelRatio || 1)));
  cv.width = L.W * K; cv.height = L.H * K;
}
window.addEventListener('resize', resize);

// ---------- 입력 ----------
const toGame = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * L.W, y: (e.clientY - r.top) / r.height * L.H }; };
let down = null;   // 누르고 있는 중: { swapZone }
function setAimFrom(p) { if (!G) return; const dx = p.x - G.shooter.x, dy = p.y - G.shooter.y; if (Math.hypot(dx, dy) > 4) aim = Math.atan2(dy, dx); aimOn = true; }
cv.addEventListener('pointerdown', (e) => {
  if (screen !== 'play' || paused || !G) return; e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
  const p = toGame(e); down = { swapZone: Math.hypot(p.x - G.shooter.x, p.y - G.shooter.y) < 24 };
  if (!down.swapZone) setAimFrom(p);
});
cv.addEventListener('pointermove', (e) => { if (screen !== 'play' || paused || !G) return; const p = toGame(e); if (down) { if (down.swapZone && Math.hypot(p.x - G.shooter.x, p.y - G.shooter.y) > 34) down.swapZone = false; if (!down.swapZone) setAimFrom(p); } else if (e.pointerType === 'mouse') setAimFrom(p); });
function release(e) {
  if (!down) return; const d = down; down = null; if (screen !== 'play' || paused || !G) return;
  if (e.type === 'pointercancel') return;
  if (d.swapZone) pend.swap = true; else pend.fire = aim;
}
cv.addEventListener('pointerup', release); cv.addEventListener('pointercancel', release);
cv.addEventListener('contextmenu', (e) => e.preventDefault());
$('btnSwap').addEventListener('click', () => { if (screen === 'play' && !paused) pend.swap = true; });
window.addEventListener('keydown', (e) => {
  if (screen !== 'play' || paused) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pend.fire = aim; }
  else if (e.key === 's' || e.key === 'S' || e.key === 'q' || e.key === 'Q') pend.swap = true;
  else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { aim -= 0.09; aimOn = true; e.preventDefault(); }
  else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { aim += 0.09; aimOn = true; e.preventDefault(); }
});

// ---------- 흐름 ----------
function showLevels() {
  const box = $('levels'); box.innerHTML = '';
  L.LEVELS.forEach((lv, i) => {
    const b = document.createElement('button'); b.setAttribute('data-level', i);
    const open = i <= unlocked; b.disabled = !open;
    b.className = (i === selLevel ? 'cur ' : '') + (i < unlocked ? 'done' : '');
    b.innerHTML = open ? `${i + 1}<small>${lv.name}</small>` : '🔒';
    b.onclick = () => { if (i > unlocked) return; selLevel = i; startLevel(i, 0); };
    box.appendChild(b);
  });
  $('levelBox').style.display = TUT ? 'none' : '';
  $('btnStart').textContent = TUT ? '시작하기' : (unlocked > 0 ? `이어서 하기 (${unlocked + 1}단계)` : '시작하기');
}
function startLevel(i, carry) {
  selLevel = i; G = L.newGame({ level: i, seed: (Date.now() & 0xffffff) + 1, tutorial: TUT, score: carry });
  vis = {}; parts = []; floats = []; shake = 0; endT = 0; pend = { fire: null, swap: false }; down = null; paused = false; screen = 'play';
  aim = -Math.PI / 2; aimOn = false;
  for (const m of G.marbles) vis[m.id] = L.posOf(G, m);
  for (const id of ['ovStart', 'ovEnd', 'ovPause']) $(id).classList.add('hidden');
  updateHud();
}
function toStart() { screen = 'start'; G = null; showLevels(); for (const id of ['ovEnd', 'ovPause']) $(id).classList.add('hidden'); $('ovStart').classList.remove('hidden'); updateHud(); }
function updateHud() {
  $('hLv').textContent = TUT ? '연습' : `${(G ? G.lvIdx : selLevel) + 1}단계 · ${G ? G.lv.name : L.LEVELS[selLevel].name}`;
  $('hScore').textContent = G ? G.score : 0; $('hBest').textContent = '최고 ' + best;
}
function showEnd() {
  const win = G.state === 'win';
  if (!TUT) {
    if (G.score > best) { best = G.score; store.set('mbBest', best); }
    if (win && G.lvIdx < LAST && G.lvIdx + 1 > unlocked) { unlocked = G.lvIdx + 1; store.set('mbLevel', unlocked); }
  }
  const all = win && G.lvIdx === LAST;
  $('endTitle').textContent = all ? '🏆 모든 단계 클리어!' : win ? '단계 클리어!' : '구멍에 빠졌어요…';
  $('endScore').textContent = G.score + '점';
  $('endText').innerHTML = all ? '마지막 길까지 모두 지켰어요. 구슬 명사수예요!' : win ? `다음은 <b>${G.lvIdx + 2}단계 · ${L.LEVELS[G.lvIdx + 1].name}</b>.` : '줄이 구멍에 닿았어요. 줄이 끊어진 곳을 노려 보세요.';
  $('btnNext').textContent = all ? '처음부터 다시' : win ? '다음 단계' : '다시 도전';
  $('btnNext').dataset.act = all ? 'reset' : win ? 'next' : 'retry';
  runScore = win ? G.score : 0;
  screen = 'end'; $('ovEnd').classList.remove('hidden'); win ? sfx.win() : sfx.lose(); updateHud();
}
$('btnStart').onclick = () => startLevel(TUT ? 0 : Math.min(unlocked, LAST), 0);
$('btnNext').onclick = () => { const a = $('btnNext').dataset.act; if (a === 'next') startLevel(G.lvIdx + 1, runScore); else if (a === 'reset') startLevel(0, 0); else startLevel(G.lvIdx, 0); };
$('btnMenu').onclick = toStart;
$('pause').onclick = () => setPaused(true);
$('btnResume').onclick = () => setPaused(false);
$('btnQuit').onclick = () => { if (G && !TUT && G.score > best) { best = G.score; store.set('mbBest', best); } toStart(); };
function setPaused(p) { if (screen !== 'play') return; paused = p; $('ovPause').classList.toggle('hidden', !p); down = null; }
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
window.addEventListener('blur', () => setPaused(true));

// ---------- 규칙이 알려 준 일 → 소리와 효과 ----------
function burst(x, y, c, n, sp = 2.2) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, v = (0.4 + Math.random()) * sp; parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.4, t: 0, life: 24 + Math.random() * 16, c }); } }
function handle(events) {
  for (const e of events) {
    if (e.t === 'fire') { sfx.fire(); tutorialSignal('shoot'); }
    else if (e.t === 'insert') { sfx.insert(); vis[e.id] = { x: e.x, y: e.y, tx: 0, ty: 0 }; tutorialSignal('insert'); }
    else if (e.t === 'miss') sfx.miss();
    else if (e.t === 'swap') { sfx.swap(); tutorialSignal('swap'); }
    else if (e.t === 'pop') {
      e.bomb ? sfx.bomb() : sfx.pop(e.n, e.chain); if (e.slow) sfx.slow();
      let cx = 0, cy = 0; for (const a of e.at) { burst(a.x, a.y, a.c, e.bomb ? 8 : 5); delete vis[a.id]; cx += a.x / e.n; cy += a.y / e.n; }
      floats.push({ x: cx, y: cy, t: 0, text: '+' + e.gain, big: e.n >= 5 || e.chain > 0 });
      if (e.chain > 0) floats.push({ x: cx, y: cy - 16, t: 0, text: '연쇄 x' + (e.chain + 1), big: true, col: '#ff9a4a' });
      if (e.bomb) { shake = 8; floats.push({ x: cx, y: cy + 16, t: 0, text: '💣 폭발!', big: true, col: '#ffb27a' }); }
      if (e.slow) floats.push({ x: cx, y: cy + 16, t: 0, text: '⏳ 느려져요', big: true, col: '#8fd8ff' });
      tutorialSignal('pop'); if (e.bomb) tutorialSignal('bomb');
    }
    else if (e.t === 'combo') tutorialSignal('combo');
    else if (e.t === 'win') { for (let i = 0; i < 40; i++) burst(Math.random() * L.W, Math.random() * L.H * 0.7, Math.floor(Math.random() * 5), 1, 2.8); }
    else if (e.t === 'lose') shake = 10;
  }
}

function tick() {
  const inp = (pend.fire !== null || pend.swap) ? { fire: pend.fire === null ? undefined : pend.fire, swap: pend.swap } : null;
  pend = { fire: null, swap: false };
  const ev = L.step(G, inp); handle(ev);
  if (G.state !== 'play') { endT++; if (endT > (G.state === 'win' ? 70 : 80) && screen === 'play') showEnd(); }
  updateHud();
}

// ---------- 그리기 ----------
function glyph(c, x, y, r) {          // 색을 구분하기 쉽게 구슬마다 작은 무늬
  ctx.save(); ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath();
  if (c === 0) ctx.arc(x, y, r * 0.3, 0, 6.283);
  else if (c === 1) { ctx.moveTo(x, y - r * 0.38); ctx.lineTo(x + r * 0.36, y + r * 0.28); ctx.lineTo(x - r * 0.36, y + r * 0.28); ctx.closePath(); }
  else if (c === 2) ctx.rect(x - r * 0.26, y - r * 0.26, r * 0.52, r * 0.52);
  else if (c === 3) { ctx.moveTo(x, y - r * 0.4); ctx.lineTo(x + r * 0.32, y); ctx.lineTo(x, y + r * 0.4); ctx.lineTo(x - r * 0.32, y); ctx.closePath(); }
  else { for (let i = 0; i < 5; i++) { const a = -1.5708 + i * 1.2566, a2 = a + 0.6283; ctx.lineTo(x + Math.cos(a) * r * 0.42, y + Math.sin(a) * r * 0.42); ctx.lineTo(x + Math.cos(a2) * r * 0.2, y + Math.sin(a2) * r * 0.2); } ctx.closePath(); }
  ctx.fill(); ctx.restore();
}
function marble(x, y, c, f, r = L.R, a = 1) {
  const [hi, lo] = COLORS[c] || COLORS[0]; ctx.save(); ctx.globalAlpha = a;
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r); g.addColorStop(0, '#fff'); g.addColorStop(0.25, hi); g.addColorStop(1, lo);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke();
  glyph(c, x, y + r * 0.1, r);
  if (f) { ctx.lineWidth = 2; ctx.strokeStyle = f === 'b' ? '#ff9a4a' : '#8fd8ff'; ctx.beginPath(); ctx.arc(x, y, r + 1, 0, 6.283); ctx.stroke(); ctx.font = `${Math.round(r * 1.25)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(f === 'b' ? '💣' : '⏳', x, y + 1); }
  ctx.restore();
}
// 겨눈 방향으로 날아가다 처음 닿는 곳 (점선 안내선용)
function aimEnd(ang) {
  let x = G.shooter.x, y = G.shooter.y; const vx = Math.cos(ang) * 4, vy = Math.sin(ang) * 4, lim = (L.D * 0.92) ** 2;
  for (let k = 0; k < 120; k++) {
    x += vx; y += vy; if (x < -4 || x > L.W + 4 || y < -4 || y > L.H + 4) return { x, y, hit: false };
    for (const m of G.marbles) { if (m.s < 0) continue; const q = G.path.at(m.s); if ((q.x - x) ** 2 + (q.y - y) ** 2 < lim) return { x, y, hit: true }; }
  }
  return { x, y, hit: false };
}

function render() {
  ctx.setTransform(K, 0, 0, K, 0, 0);
  const sx = shake > 0 ? (Math.random() - 0.5) * shake : 0, sy = shake > 0 ? (Math.random() - 0.5) * shake : 0; if (shake > 0) shake *= 0.85; if (shake < 0.3) shake = 0;
  ctx.translate(sx, sy);
  const bg = ctx.createLinearGradient(0, 0, 0, L.H); bg.addColorStop(0, '#12342f'); bg.addColorStop(1, '#0b1f2a'); ctx.fillStyle = bg; ctx.fillRect(-10, -10, L.W + 20, L.H + 20);
  if (!G) return;
  const P = G.path, dng = L.danger(G);
  // 길
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const trace = () => { ctx.beginPath(); P.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); };
  trace(); ctx.lineWidth = 27; ctx.strokeStyle = '#08161a'; ctx.stroke();
  trace(); ctx.lineWidth = 22; ctx.strokeStyle = '#1c3d3a'; ctx.stroke();
  trace(); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.setLineDash([2, 10]); ctx.stroke(); ctx.setLineDash([]);
  // 구멍
  const hp = P.at(P.len), pulse = dng > 0.75 ? 0.5 + 0.5 * Math.sin(G.t * 0.25) : 0;
  const hg = ctx.createRadialGradient(hp.x, hp.y, 2, hp.x, hp.y, 24); hg.addColorStop(0, '#000'); hg.addColorStop(0.55, '#150508'); hg.addColorStop(1, dng > 0.75 ? `rgba(255,60,40,${0.3 + pulse * 0.5})` : 'rgba(255,60,40,0.08)');
  ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(hp.x, hp.y, 24, 0, 6.283); ctx.fill();
  ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('💀', hp.x, hp.y);
  // 구슬 줄
  for (let i = G.marbles.length - 1; i >= 0; i--) {
    const m = G.marbles[i], t = P.at(m.s); let v = vis[m.id];
    if (!v) v = vis[m.id] = { x: t.x, y: t.y };
    const d = Math.hypot(t.x - v.x, t.y - v.y);
    if (d > 36 || G.state === 'lose') { v.x = t.x; v.y = t.y; } else { v.x += (t.x - v.x) * 0.55; v.y += (t.y - v.y) * 0.55; }
    if (v.x > -L.R * 2 && v.x < L.W + L.R * 2) marble(v.x, v.y, m.c, m.f);
  }
  if (G.slowT > 0) { ctx.fillStyle = 'rgba(140,210,255,.08)'; ctx.fillRect(0, 0, L.W, L.H); }
  // 안내선
  if (G.state === 'play' && !paused && (aimOn || TUT)) {
    const e = aimEnd(aim); ctx.save(); ctx.setLineDash([3, 5]); ctx.lineWidth = 1.6; ctx.strokeStyle = e.hit ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.25)';
    ctx.beginPath(); ctx.moveTo(G.shooter.x + Math.cos(aim) * 26, G.shooter.y + Math.sin(aim) * 26); ctx.lineTo(e.x, e.y); ctx.stroke(); ctx.restore();
    if (e.hit) { ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.arc(e.x, e.y, L.R * 0.8, 0, 6.283); ctx.stroke(); }
  }
  // 쏜 구슬
  for (const s of G.shots) marble(s.x, s.y, s.c, '');
  // 대포
  const S = G.shooter; ctx.save(); ctx.translate(S.x, S.y);
  ctx.fillStyle = '#26454c'; ctx.beginPath(); ctx.arc(0, 0, 21, 0, 6.283); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#4f8a86'; ctx.stroke();
  ctx.rotate(aim); ctx.fillStyle = '#3a6a68'; ctx.fillRect(4, -8, 26, 16); ctx.fillStyle = '#9ad8c8'; ctx.fillRect(26, -9.5, 6, 19);
  ctx.rotate(-aim);
  marble(Math.cos(aim) * 9, Math.sin(aim) * 9, G.cur, '', L.R);
  marble(-Math.cos(aim) * 22, -Math.sin(aim) * 22 + 0, G.next, '', 5.5, 0.9);
  ctx.restore();
  // 효과
  for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.t++; p.x += p.vx; p.y += p.vy; p.vy += 0.12; if (p.t > p.life) { parts.splice(i, 1); continue; } ctx.globalAlpha = 1 - p.t / p.life; ctx.fillStyle = COLORS[p.c % 5][0]; ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, 6.283); ctx.fill(); }
  ctx.globalAlpha = 1;
  for (let i = floats.length - 1; i >= 0; i--) { const f = floats[i]; f.t++; if (f.t > 50) { floats.splice(i, 1); continue; } ctx.globalAlpha = f.t > 36 ? (50 - f.t) / 14 : 1; ctx.font = `900 ${f.big ? 16 : 13}px -apple-system, sans-serif`; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.fillStyle = f.col || '#ffe27a'; const yy = f.y - f.t * 0.7; ctx.strokeText(f.text, f.x, yy); ctx.fillText(f.text, f.x, yy); }
  ctx.globalAlpha = 1;
  if (dng > 0.8 && G.state === 'play') { ctx.fillStyle = `rgba(255,40,30,${0.05 + pulse * 0.1})`; ctx.fillRect(0, 0, L.W, L.H); }
}

// ---------- 반복 ----------
let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(100, now - last); last = now;
  if (screen !== 'start' && G && !paused && !document.hidden) { acc += dt; while (acc >= 1000 / 60) { acc -= 1000 / 60; if (screen === 'play') tick(); } } else acc = 0;
  render(); requestAnimationFrame(frame);
}
showLevels(); updateHud(); resize(); requestAnimationFrame(frame);
setTimeout(resize, 60);

/* @test-hooks:start */
window.__mb = { get G() { return G; }, get screen() { return screen; }, get unlocked() { return unlocked; }, get best() { return best; }, get aim() { return aim; }, tick, render, startLevel, handle, get paused() { return paused; }, setPaused, pend: () => pend };
/* @test-hooks:end */
