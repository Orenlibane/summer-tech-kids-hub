/* ===========================================================
   מירוץ הכדורים — Ball Race
   Side-scrolling button-masher race. 4 balls, 3 themed levels.
   Works on desktop (W / arrows / space) and mobile (touch buttons).
   =========================================================== */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// ---- Logical resolution (we scale to fit the screen) ----
const W = 900, H = 540;
canvas.width = W; canvas.height = H;

// ---- Level themes ----
const LEVELS = [
  { name: 'רמה 1 — רגילים', prefix: 'l1', sky1: '#8fd0ff', sky2: '#dff3ff', ground: '#6bbf59', dirt: '#4f8f3f', aiSkill: 0.55 },
  { name: 'רמה 2 — אריות 🦁', prefix: 'l2', sky1: '#ffd27a', sky2: '#ffeec2', ground: '#d9a441', dirt: '#b07d24', aiSkill: 0.72 },
  { name: 'רמה 3 — מונדיאל ⚽', prefix: 'l3', sky1: '#6a8bff', sky2: '#c9d6ff', ground: '#3aa76d', dirt: '#2b7d50', aiSkill: 0.9 },
];

const COLORS = {
  yellow: '#ffd21f', blue: '#3a9bff', green: '#3fce4e', red: '#ff4d4d',
};
const COLOR_NAMES = { yellow: 'צהוב', blue: 'כחול', green: 'ירוק', red: 'אדום' };
const COLOR_KEYS = ['yellow', 'blue', 'green', 'red'];

// ---- Physics tuning ----
const TRACK_LEN = 5200;     // race distance
const GROUND_Y = H - 90;    // ground line
const LANE_H = 96;          // vertical space per lane
const BALL_R = 34;
const GRAVITY = 2400;
const JUMP_V = 850;
const TAP_IMPULSE = 145;    // speed gained per press/tap  (mash to go fast!)
const HOLD_ACCEL = 260;     // gentle push while held
const FRICTION = 1.45;      // speed decay
const MAX_SPEED = 720;
const PLAYER_SCREEN_X = 250; // player stays here; world scrolls

// ---- Game state ----
let state = 'menu';         // menu | countdown | racing | result
let levelIndex = 0;
let playerColor = 'yellow';
let racers = [];
let obstacles = [];
let camX = 0;
let countdown = 0;
let finishOrder = [];
let elapsed = 0;

// ---- Ball image cache (Codex art if available, else procedural) ----
const ballImgs = {}; // key `${prefix}_${color}` -> {img, ok}
function loadBall(prefix, color) {
  const key = `${prefix}_${color}`;
  if (ballImgs[key]) return;
  const rec = { img: new Image(), ok: false };
  rec.img.onload = () => { rec.ok = true; };
  rec.img.onerror = () => { rec.ok = false; };
  rec.img.src = `assets/balls/${key}.png`;
  ballImgs[key] = rec;
}

// =========================================================
//  RACER
// =========================================================
function makeRacer(color, isPlayer, lane) {
  return {
    color, isPlayer, lane,
    dist: 0, speed: 0, y: 0, vy: 0, onGround: true,
    rot: 0, finished: false, finishTime: 0,
    aiTapClock: 0,        // AI decides when to "tap"
    aiJumpLook: 0,
    hitCooldown: 0,
  };
}

function setupRace() {
  const lv = LEVELS[levelIndex];
  // player + 3 AIs, one per color, assigned to lanes 0..3
  const others = COLOR_KEYS.filter(c => c !== playerColor);
  racers = [];
  racers.push(makeRacer(playerColor, true, 0));
  others.forEach((c, i) => racers.push(makeRacer(c, false, i + 1)));
  racers.forEach(r => loadBall(lv.prefix, r.color));

  // obstacles: bumps every so often (shared X positions, each lane gets its own)
  obstacles = [];
  for (let x = 700; x < TRACK_LEN - 400; x += 430 + Math.random() * 260) {
    obstacles.push({ x: x + Math.random() * 120, w: 46, h: 46 });
  }
  camX = 0; finishOrder = []; elapsed = 0;
}

// =========================================================
//  INPUT
// =========================================================
const held = { forward: false, jump: false };
function playerTap() {
  const p = racers.find(r => r.isPlayer);
  if (!p || p.finished || state !== 'racing') return;
  p.speed = Math.min(MAX_SPEED, p.speed + TAP_IMPULSE);
}
function playerJump() {
  const p = racers.find(r => r.isPlayer);
  if (!p || p.finished || state !== 'racing') return;
  if (p.onGround) { p.vy = -JUMP_V; p.onGround = false; }
}

// Keyboard
const FORWARD_KEYS = ['KeyW', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'ArrowDown'];
window.addEventListener('keydown', (e) => {
  if (FORWARD_KEYS.includes(e.code)) {
    e.preventDefault();
    if (!e.repeat) playerTap();   // fresh press = burst (mash!)
    held.forward = true;
  }
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) playerJump(); held.jump = true; }
});
window.addEventListener('keyup', (e) => {
  if (FORWARD_KEYS.includes(e.code)) held.forward = false;
  if (e.code === 'Space') held.jump = false;
});

// Tap anywhere on the canvas = burst forward (both desktop & mobile)
canvas.addEventListener('pointerdown', (e) => { if (state === 'racing') playerTap(); });

// Touch buttons
const btnF = document.getElementById('btn-forward');
const btnJ = document.getElementById('btn-jump');
function bindHold(btn, onDown, holdKey) {
  const down = (e) => { e.preventDefault(); onDown(); if (holdKey) held[holdKey] = true; };
  const up = (e) => { e.preventDefault(); if (holdKey) held[holdKey] = false; };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointerleave', up);
  btn.addEventListener('pointercancel', up);
}
bindHold(btnF, playerTap, 'forward');
bindHold(btnJ, playerJump, 'jump');

// =========================================================
//  UPDATE
// =========================================================
function update(dt) {
  if (state !== 'racing') return;
  elapsed += dt;
  const lv = LEVELS[levelIndex];

  for (const r of racers) {
    if (r.finished) continue;

    // ---- AI control ----
    if (!r.isPlayer) {
      r.aiTapClock -= dt;
      const tapEvery = 0.16 - lv.aiSkill * 0.08 + Math.random() * 0.05; // faster tapping = harder
      if (r.aiTapClock <= 0) {
        r.speed = Math.min(MAX_SPEED, r.speed + TAP_IMPULSE * (0.7 + lv.aiSkill * 0.4));
        r.aiTapClock = tapEvery;
      }
      // AI jump when an obstacle is close in its lane
      const next = nextObstacle(r.dist);
      if (next && next.x - r.dist < 150 && next.x - r.dist > 40 && r.onGround) {
        if (Math.random() < 0.6 + lv.aiSkill * 0.35) { r.vy = -JUMP_V; r.onGround = false; }
      }
    } else {
      // player: gentle hold assist so it never feels stuck
      if (held.forward) r.speed = Math.min(MAX_SPEED, r.speed + HOLD_ACCEL * dt);
    }

    // ---- Friction / move ----
    r.speed = Math.max(0, r.speed - FRICTION * r.speed * dt);
    r.dist += r.speed * dt;
    r.rot += (r.speed * dt) / BALL_R;

    // ---- Jump physics ----
    r.vy += GRAVITY * dt;
    r.y += r.vy * dt;
    if (r.y >= 0) { r.y = 0; r.vy = 0; r.onGround = true; }

    // ---- Obstacle collision (only if on the ground / low) ----
    if (r.hitCooldown > 0) r.hitCooldown -= dt;
    const airborne = r.y < -30;
    if (!airborne && r.hitCooldown <= 0) {
      const o = obstacleAt(r.dist);
      if (o) { r.speed *= 0.35; r.hitCooldown = 0.5; } // hit a bump → slow down
    }

    // ---- Finish ----
    if (r.dist >= TRACK_LEN && !r.finished) {
      r.finished = true; r.finishTime = elapsed;
      finishOrder.push(r);
    }
  }

  // camera follows player
  const p = racers.find(r => r.isPlayer);
  camX = p.dist - PLAYER_SCREEN_X;
  if (camX < 0) camX = 0;

  updateHUD();

  // race ends when player finished (rank locked) — let it settle
  if (p.finished) { endRace(); }
}

function nextObstacle(dist) {
  let best = null;
  for (const o of obstacles) if (o.x > dist && (!best || o.x < best.x)) best = o;
  return best;
}
function obstacleAt(dist) {
  for (const o of obstacles) if (Math.abs(o.x - dist) < BALL_R * 0.7) return o;
  return null;
}

// =========================================================
//  RENDER
// =========================================================
function laneY(lane) { return GROUND_Y - (racers.length - 1 - lane) * 0 - lane * 0; }
// All racers share the same ground line but are drawn front-to-back by lane offset:
function drawY(lane) { return GROUND_Y - lane * (LANE_H * 0.42); }

function render() {
  const lv = LEVELS[levelIndex];

  // sky
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, lv.sky1); g.addColorStop(1, lv.sky2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // parallax hills
  drawHills(lv);

  if (state === 'menu') return; // menu overlay handles visuals

  // ground band
  ctx.fillStyle = lv.ground;
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  ctx.fillStyle = lv.dirt;
  ctx.fillRect(0, GROUND_Y, W, 10);

  // start & finish lines
  drawMarker(0, '#ffffff');
  drawMarker(TRACK_LEN, 'checker');

  // distance ticks
  ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 2;
  for (let x = 0; x <= TRACK_LEN; x += 500) {
    const sx = x - camX; if (sx < -20 || sx > W + 20) continue;
    ctx.beginPath(); ctx.moveTo(sx, GROUND_Y); ctx.lineTo(sx, GROUND_Y + 14); ctx.stroke();
  }

  // obstacles
  for (const o of obstacles) {
    const sx = o.x - camX; if (sx < -60 || sx > W + 60) continue;
    drawObstacle(sx, GROUND_Y);
  }

  // racers — draw far lanes first
  const order = [...racers].sort((a, b) => a.lane - b.lane);
  for (const r of order) {
    const sx = (r.isPlayer) ? PLAYER_SCREEN_X : (r.dist - camX);
    const sy = drawY(r.lane) + r.y;
    drawBall(sx, sy, r, lv);
    // name tag / rank marker for AI so kid can track them
    if (!r.isPlayer) {
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(COLOR_NAMES[r.color], sx, sy - BALL_R - 44);
    }
  }
}

function drawHills(lv) {
  ctx.fillStyle = 'rgba(255,255,255,.18)';
  const base = GROUND_Y + 10;
  const off = (camX * 0.3) % 400;
  for (let i = -1; i < W / 400 + 2; i++) {
    const cx = i * 400 - off + 200;
    ctx.beginPath(); ctx.arc(cx, base, 180, Math.PI, 0); ctx.fill();
  }
}

function drawMarker(worldX, style) {
  const sx = worldX - camX;
  if (sx < -30 || sx > W + 30) return;
  if (style === 'checker') {
    const sq = 12;
    for (let y = GROUND_Y - 120; y < GROUND_Y; y += sq) {
      for (let k = 0; k < 2; k++) {
        ctx.fillStyle = ((Math.floor((y) / sq) + k) % 2 === 0) ? '#111' : '#fff';
        ctx.fillRect(sx + k * sq, y, sq, sq);
      }
    }
    ctx.fillStyle = '#111'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('🏁', sx + sq, GROUND_Y - 130);
  } else {
    ctx.strokeStyle = style; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(sx, GROUND_Y - 120); ctx.lineTo(sx, GROUND_Y); ctx.stroke();
  }
}

function drawObstacle(sx, gy) {
  // a rock / cone bump
  ctx.save();
  ctx.translate(sx, gy);
  ctx.fillStyle = '#7a4a22';
  ctx.beginPath();
  ctx.moveTo(-24, 0); ctx.lineTo(0, -46); ctx.lineTo(24, 0); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillRect(-14, -26, 28, 8);
  ctx.fillRect(-9, -40, 18, 7);
  ctx.restore();
}

function drawBall(sx, sy, r, lv) {
  const key = `${lv.prefix}_${r.color}`;
  const rec = ballImgs[key];
  const y = sy - BALL_R;

  // shadow
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(sx, sy + 4, BALL_R * (0.9 + Math.min(0.4, -r.y / 300)), 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (rec && rec.ok) {
    ctx.save();
    ctx.translate(sx, y);
    ctx.rotate(r.rot);
    ctx.drawImage(rec.img, -BALL_R, -BALL_R, BALL_R * 2, BALL_R * 2);
    ctx.restore();
  } else {
    drawProceduralBall(sx, y, r, lv);
  }

  if (r.isPlayer) { // crown / arrow so player knows which is them
    ctx.font = '20px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('👑', sx, y - BALL_R - 10);
  }
}

// Nice fallback ball drawn with canvas (gradient + theme decoration)
function drawProceduralBall(cx, cy, r, lv) {
  const col = COLORS[r.color];
  ctx.save();
  ctx.translate(cx, cy);
  // base sphere
  const grad = ctx.createRadialGradient(-BALL_R * 0.35, -BALL_R * 0.4, BALL_R * 0.2, 0, 0, BALL_R);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.18, tint(col, 0.55));
  grad.addColorStop(0.7, col);
  grad.addColorStop(1, shade(col, 0.45));
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(0, 0, BALL_R, 0, Math.PI * 2); ctx.fill();

  ctx.rotate(r.rot);
  if (lv.prefix === 'l1') {
    // beach-ball stripes
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 3;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.arc(0, 0, BALL_R - 2, a, a + 0.02); ctx.lineTo(0, 0); ctx.stroke();
    }
  } else if (lv.prefix === 'l2') {
    // lion: little ears + face hint
    ctx.fillStyle = shade(col, 0.35);
    ctx.beginPath(); ctx.arc(-BALL_R * 0.5, -BALL_R * 0.5, 8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(BALL_R * 0.5, -BALL_R * 0.5, 8, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(-r.rot); // face upright
    ctx.fillStyle = '#3a2a12';
    ctx.beginPath(); ctx.arc(-9, -4, 3.2, 0, 7); ctx.arc(9, -4, 3.2, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 6, 4, 0, Math.PI); ctx.fill();
    ctx.rotate(r.rot);
  } else {
    // soccer pentagons
    ctx.fillStyle = '#111';
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 2.5) {
      const px = Math.cos(a) * BALL_R * 0.55, py = Math.sin(a) * BALL_R * 0.55;
      ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // glossy highlight
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(cx - BALL_R * 0.35, cy - BALL_R * 0.4, BALL_R * 0.22, BALL_R * 0.14, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function tint(hex, t) { return mix(hex, '#ffffff', t); }
function shade(hex, t) { return mix(hex, '#000000', t); }
function mix(a, b, t) {
  const pa = hx(a), pb = hx(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r},${g},${bl})`;
}
function hx(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

// =========================================================
//  HUD / FLOW
// =========================================================
const hud = document.getElementById('hud');
const hudLevel = document.getElementById('hud-level');
const hudPlace = document.getElementById('hud-place');
const hudSpeed = document.getElementById('hud-speed');

function updateHUD() {
  const p = racers.find(r => r.isPlayer);
  hudLevel.textContent = LEVELS[levelIndex].name;
  // current place
  const ranked = [...racers].sort((a, b) => b.dist - a.dist);
  const place = ranked.indexOf(p) + 1;
  hudPlace.textContent = `מקום ${place}/${racers.length}`;
  // speed bar as emoji
  const s = Math.round((p.speed / MAX_SPEED) * 5);
  hudSpeed.textContent = '🔥'.repeat(Math.max(0, s)) || '💤';
}

function startLevel() {
  setupRace();
  hud.classList.remove('hidden');
  document.getElementById('touch').classList.remove('hidden');
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('result').classList.add('hidden');
  // countdown
  state = 'countdown'; countdown = 3;
  const el = document.getElementById('countdown');
  const num = document.getElementById('count-num');
  el.classList.remove('hidden');
  num.textContent = '3';
  let n = 3;
  const iv = setInterval(() => {
    n--;
    if (n <= 0) {
      clearInterval(iv);
      el.classList.add('hidden');
      state = 'racing';
    } else {
      num.textContent = n === 0 ? 'צא!' : n;
      num.style.animation = 'none'; void num.offsetWidth; num.style.animation = 'pop .5s';
    }
  }, 800);
}

let raceEnded = false;
function endRace() {
  if (raceEnded) return;
  raceEnded = true;
  // finish remaining AIs by their current distance to compute full ranking
  const ranked = [...racers].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1; if (b.finished) return 1;
    return b.dist - a.dist;
  });
  const p = racers.find(r => r.isPlayer);
  const place = ranked.indexOf(p) + 1;

  state = 'result';
  hud.classList.add('hidden');
  document.getElementById('touch').classList.add('hidden');
  const res = document.getElementById('result');
  const title = document.getElementById('result-title');
  const sub = document.getElementById('result-sub');
  const nextBtn = document.getElementById('next-btn');

  const medals = ['🥇', '🥈', '🥉', '🎽'];
  if (place === 1) {
    title.textContent = '🥇 ניצחת! מקום ראשון!';
    if (levelIndex < LEVELS.length - 1) {
      sub.textContent = `כל הכבוד! עולה ל${LEVELS[levelIndex + 1].name}`;
      nextBtn.textContent = 'לרמה הבאה ➡️';
      nextBtn.classList.remove('hidden');
    } else {
      sub.textContent = '🎉 סיימת את כל הרמות! אלוף הכדורים! 🏆';
      nextBtn.classList.add('hidden');
    }
  } else {
    title.textContent = `${medals[place - 1]} מקום ${place}`;
    sub.textContent = 'רק מקום ראשון עולה רמה — נסה שוב!';
    nextBtn.classList.add('hidden');
  }
  res.classList.remove('hidden');
}

// buttons
document.getElementById('start-btn').addEventListener('click', () => { raceEnded = false; startLevel(); });
document.getElementById('retry-btn').addEventListener('click', () => { raceEnded = false; startLevel(); });
document.getElementById('next-btn').addEventListener('click', () => {
  if (levelIndex < LEVELS.length - 1) levelIndex++;
  raceEnded = false; startLevel();
});

// ---- Ball picker in menu ----
const picker = document.getElementById('ball-picker');
COLOR_KEYS.forEach((c) => {
  const d = document.createElement('div');
  d.className = 'pick' + (c === playerColor ? ' selected' : '');
  d.style.background = `radial-gradient(circle at 32% 28%, #fff, ${COLORS[c]} 42%, ${shade(COLORS[c], .4)})`;
  d.title = COLOR_NAMES[c];
  d.addEventListener('click', () => {
    playerColor = c;
    [...picker.children].forEach(ch => ch.classList.remove('selected'));
    d.classList.add('selected');
  });
  picker.appendChild(d);
});

// preload level-1 balls so menu → race is instant
COLOR_KEYS.forEach(c => loadBall('l1', c));

// =========================================================
//  MAIN LOOP + RESIZE
// =========================================================
function resize() {
  const wrap = document.getElementById('game-wrap');
  const scale = Math.min(wrap.clientWidth / W, wrap.clientHeight / H);
  canvas.style.width = W * scale + 'px';
  canvas.style.height = H * scale + 'px';
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
function loop(t) {
  let dt = (t - last) / 1000; last = t;
  if (dt > 0.05) dt = 0.05; // clamp
  update(dt);
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
