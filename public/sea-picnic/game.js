const c = document.querySelector('#game'), x = c.getContext('2d');
const W = c.width, H = c.height, WATER = 118;
const keys = {};
const player = { x: 170, y: 390, vx: 0, vy: 0, w: 158, h: 108, inv: 0, hurt: 0, tilt: 0 };
const fish = [], puffs = [], bubbles = [], effects = [];
let score = 0, lives = 3, running = false, t = 0, spawn = 0, speed = 3.05, swimClock = 0;
let theme = window.THEMES[0], diff = window.DIFFICULTIES.find(d => d.default) || window.DIFFICULTIES[0];
let runStartedAt = 0, playerName = theme.defaultName;
const assetCache = {};

function readScores() { try { return JSON.parse(localStorage.getItem(theme.scoreKey) || '[]'); } catch { return []; } }
function formatTime(sec) { let m = Math.floor(sec / 60), s = Math.floor(sec % 60); return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
function safeName(v) { return String(v || theme.defaultName).replace(/[<>&"']/g, '').trim().slice(0, 10) || theme.defaultName; }
function saveScore(points, seconds) {
  let list = readScores();
  list.push({ name: safeName(playerName), score: points, time: Math.max(1, Math.round(seconds)), date: new Date().toISOString() });
  list.sort((a, b) => b.score - a.score || b.time - a.time || a.date.localeCompare(b.date));
  list = list.slice(0, 10);
  try { localStorage.setItem(theme.scoreKey, JSON.stringify(list)); } catch {}
  return list;
}
function rankingHTML(list = readScores()) {
  if (!list.length) return '<div class="ranking"><h2>🏆 TOP 10</h2><div class="empty">아직 기록이 없어요</div></div>';
  return `<div class="ranking"><h2>🏆 TOP 10</h2><table><thead><tr><th>순위</th><th>이름</th><th>친구</th><th>시간</th><th>날짜</th></tr></thead><tbody>${list.map((r, i) => `<tr><td>${i + 1}</td><td>${safeName(r.name)}</td><td>${r.score}마리</td><td>${formatTime(r.time)}</td><td>${new Date(r.date).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}</td></tr>`).join('')}</tbody></table></div>`;
}

let audioCtx = null, master = null, musicTimer = null, musicStep = 0, muted = false;
function ensureAudio() { if (audioCtx) { if (audioCtx.state === 'suspended') audioCtx.resume(); return; } audioCtx = new (window.AudioContext || window.webkitAudioContext)(); master = audioCtx.createGain(); master.gain.value = .52; master.connect(audioCtx.destination); startAmbience(); startMusic(); }
function startAmbience() { let len = audioCtx.sampleRate * 3, buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate), data = buf.getChannelData(0), smooth = 0; for (let i = 0; i < len; i++) { smooth = smooth * .985 + (Math.random() * 2 - 1) * .015; data[i] = smooth; } let src = audioCtx.createBufferSource(), filter = audioCtx.createBiquadFilter(), gain = audioCtx.createGain(); src.buffer = buf; src.loop = true; filter.type = 'lowpass'; filter.frequency.value = 520; filter.Q.value = .7; gain.gain.value = .16; src.connect(filter); filter.connect(gain); gain.connect(master); src.start(); }
function tone(freq, dur = .18, type = 'sine', vol = .12, delay = 0) { if (!audioCtx || muted) return; let now = audioCtx.currentTime + delay, o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.type = type; o.frequency.setValueAtTime(freq, now); g.gain.setValueAtTime(.0001, now); g.gain.exponentialRampToValueAtTime(vol, now + .025); g.gain.exponentialRampToValueAtTime(.0001, now + dur); o.connect(g); g.connect(master); o.start(now); o.stop(now + dur + .03); }
function startMusic() { if (musicTimer) return; const melody = [523, 587, 659, 784, 659, 587, 523, 440, 494, 587, 659, 587, 523, 494, 440, 392]; musicTimer = setInterval(() => { if (!running || muted) return; let n = melody[musicStep % melody.length]; tone(n, .42, 'sine', .055); tone(n / 2, .65, 'triangle', .025, .03); if (musicStep % 4 === 0) tone([131, 147, 165, 147][(musicStep / 4) % 4], .8, 'sine', .035); if (musicStep % 11 === 7) { tone(1050, .08, 'sine', .025); tone(1420, .1, 'sine', .018, .07); } musicStep++; }, 360); }
function sfxStart() { tone(392, .18, 'triangle', .1); tone(523, .22, 'triangle', .1, .1); tone(659, .3, 'sine', .09, .2); }
function sfxFish() { tone(660, .11, 'sine', .12); tone(880, .2, 'sine', .1, .07); }
function sfxHit() { tone(180, .3, 'sawtooth', .1); tone(110, .42, 'square', .06, .08); }
function sfxGameOver() { tone(392, .28, 'triangle', .08); tone(330, .32, 'triangle', .08, .18); tone(262, .55, 'sine', .1, .38); }

// 흰 배경을 깐 팩 이미지(오로라 요정 테마)에서 배경을 지워 투명하게 만들어요
function stripChecker(source) {
  let q = document.createElement('canvas'), w = q.width = source.width, h = q.height = source.height, g = q.getContext('2d', { willReadFrequently: true });
  g.drawImage(source, 0, 0);
  let im = g.getImageData(0, 0, w, h), d = im.data;
  for (let k = 0; k < d.length; k += 4) {
    let r = d[k], gg = d[k + 1], b = d[k + 2], hi = Math.max(r, gg, b), lo = Math.min(r, gg, b), spread = hi - lo;
    if (lo > 218 && spread < 15) d[k + 3] = 0;
    else if (lo > 205 && spread < 22) { let neutrality = 1 - spread / 22, brightness = (lo - 205) / 13; d[k + 3] = Math.round(d[k + 3] * (1 - Math.min(1, neutrality * brightness))); }
  }
  g.putImageData(im, 0, 0);
  return q;
}
function safeStrip(source) { try { return stripChecker(source); } catch (err) { console.warn('투명 배경 처리를 건너뜁니다.', err); return null; } }
function cellRect(source, cols, rows, col, row, pad = 0) {
  let x0 = Math.round(col * source.width / cols), x1 = Math.round((col + 1) * source.width / cols);
  let y0 = Math.round(row * source.height / rows), y1 = Math.round((row + 1) * source.height / rows);
  return [x0 + pad, y0 + pad, x1 - x0 - pad * 2, y1 - y0 - pad * 2];
}

function loadImage(src) { return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; }); }
async function loadTheme(t) {
  if (assetCache[t.key]) return assetCache[t.key];
  const [bg, fishImg, pufferImg, charImg, weedImg] = await Promise.all([
    loadImage(t.bg), loadImage(t.fish.src), loadImage(t.puffer.src), loadImage(t.char.src), loadImage(t.weed),
  ]);
  const assets = {
    bg, fishImg, pufferImg, charImg, weedImg,
    fishClean: t.fish.strip ? safeStrip(fishImg) : null,
    pufferClean: t.puffer.strip ? safeStrip(pufferImg) : null,
    charClean: t.char.strip ? safeStrip(charImg) : null,
  };
  assetCache[t.key] = assets;
  return assets;
}

let A = null; // 현재 테마의 로드된 이미지들

function reset() {
  score = 0; lives = 3; speed = 3.05 * diff.speedMul; swimClock = 0;
  fish.length = puffs.length = bubbles.length = effects.length = 0;
  Object.assign(player, { x: 170, y: 390, w: theme.char.w, h: theme.char.h, vx: 0, vy: 0, inv: 0, hurt: 0, tilt: 0 });
  updateHud();
}
function updateHud() {
  document.querySelector('#score').textContent = theme.scoreIcon + ' ' + score;
  document.querySelector('#lives').textContent = theme.lifeIcon.repeat(lives) + '🤍'.repeat(3 - lives);
}
function updateTimer() { let sec = running ? (performance.now() - runStartedAt) / 1000 : 0; document.querySelector('#timer').textContent = '⏱ ' + formatTime(sec); }
function addFish() {
  let bad = Math.random() < Math.min(.14 + score / 130, .35), y = WATER + 48 + Math.random() * (H - WATER - 100);
  (bad ? puffs : fish).push({ x: W + 100, y, vx: -(speed + Math.random() * 1.15 * diff.speedMul), r: bad ? 38 : 30, kind: Math.floor(Math.random() * 5), bob: Math.random() * 6.28, hurt: 0, done: false });
}
function hit(a, b, r) { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < r * r; }

function drawFishFrame(kind, frame, dx, dy, dw, dh) {
  let source = A.fishClean || A.fishImg, cr = cellRect(source, theme.fish.cols, theme.fish.rows, frame, kind, theme.fish.pad);
  x.drawImage(source, ...cr, dx, dy, dw, dh);
}
function drawPuffer(frame, dx, dy, dw, dh) {
  let source = A.pufferClean || A.pufferImg, col = frame % theme.puffer.cols, row = Math.floor(frame / theme.puffer.cols);
  let cr = cellRect(source, theme.puffer.cols, theme.puffer.rows, col, row, theme.puffer.pad);
  x.drawImage(source, ...cr, dx, dy, dw, dh);
}
function drawCharacter(frame, flip, bob, alpha = 1) {
  let source = A.charClean || A.charImg, col = frame % theme.char.cols, row = Math.floor(frame / theme.char.cols);
  let cr = cellRect(source, theme.char.cols, theme.char.rows, col, row, theme.char.pad);
  let shake = player.hurt ? Math.sin(t * 1.8) * 7 : 0, sx = player.hurt ? 1 + Math.sin(t * .8) * .12 : 1, sy = player.hurt ? 1 - Math.sin(t * .8) * .1 : 1;
  x.save(); x.globalAlpha = alpha; x.translate(player.x + shake, player.y + bob);
  x.rotate(player.tilt + (player.hurt ? Math.sin(t * .7) * .1 : 0));
  if (flip) x.scale(-1, 1);
  x.scale(sx, sy);
  x.drawImage(source, ...cr, -player.w / 2, -player.h / 2, player.w, player.h);
  x.restore();
}
function livingWater() {
  x.save(); x.lineCap = 'round';
  for (let band = 0; band < 3; band++) {
    x.beginPath();
    for (let px = -30; px <= W + 30; px += 12) { let py = WATER + Math.sin(px * .022 + t * .035 + band * 1.7) * (5 + band * 2) + band * 5; if (px < 0) x.moveTo(px, py); else x.lineTo(px, py); }
    x.strokeStyle = ['#ffffffbb', '#8ff4f0aa', '#1baec888'][band]; x.lineWidth = [3, 2, 2][band]; x.stroke();
  }
  x.restore();
}
function livingPlants() {
  const plants = [[34, 0, 118, 210, 0], [120, 1, 105, 165, 1.3], [230, 2, 92, 125, 2.6], [955, 2, 100, 135, .7], [1050, 1, 108, 175, 2], [1148, 0, 115, 205, 3.2]];
  const src = [[0, 0, 520, 1024], [520, 0, 530, 1024], [1050, 0, 486, 1024]];
  plants.forEach(([px, k, w, h, phase]) => {
    let a = Math.sin(t * .018 + phase) * .075;
    x.save(); x.translate(px, H + 5); x.rotate(a); x.transform(1, 0, Math.sin(t * .014 + phase) * .055, 1, 0, 0);
    x.drawImage(A.weedImg, ...src[k], -w / 2, -h, w, h); x.restore();
  });
}
function update() {
  if (!running) return;
  t++; if (t % 10 === 0) updateTimer();
  spawn--; if (spawn < 0) { addFish(); spawn = Math.max(Math.round(30 / diff.densityMul), Math.round((78 - score) / diff.densityMul)); }
  player.vx += (keys.ArrowRight ? 0.48 : 0) - (keys.ArrowLeft ? 0.48 : 0); player.vx *= .9;
  player.vy += .12; if (keys.Space || keys.ArrowUp) player.vy -= .32; player.vy *= .975;
  player.x = Math.max(65, Math.min(W - 145, player.x + player.vx));
  player.y = Math.max(WATER + 50, Math.min(H - 62, player.y + player.vy));
  player.tilt += (Math.max(-.18, Math.min(.18, player.vy * .035)) - player.tilt) * .08;
  swimClock += .09 + Math.min(.11, (Math.abs(player.vx) + Math.abs(player.vy)) * .014);
  if (player.inv) player.inv--; if (player.hurt) player.hurt--;
  if ((Math.abs(player.vx) > 1.2 || Math.abs(player.vy) > 1.2) && t % 9 === 0) bubbles.push({ x: player.x - 52 * (player.vx >= 0 ? 1 : -1), y: player.y + 14, vx: -player.vx * .16 + (Math.random() - .5), vy: -.8 - Math.random(), r: 2 + Math.random() * 4, life: 32, hue: [174, 194, 218, 282, 345][Math.floor(Math.random() * 5)] });
  fish.forEach(o => { o.x += o.vx; o.y += Math.sin(t / 20 + o.bob) * .35; });
  puffs.forEach(o => { o.x += o.vx; o.y += Math.sin(t / 20 + o.bob) * .25; if (o.hurt) { o.hurt--; o.vx *= .94; if (!o.hurt) o.done = true; } });
  for (let i = fish.length - 1; i >= 0; i--) {
    let f = fish[i];
    if (hit(player, f, 62)) {
      fish.splice(i, 1); score++; sfxFish();
      speed = Math.min(5.4 * diff.speedMul, (3.05 + score * .035) * diff.speedMul);
      for (let j = 0; j < 9; j++) bubbles.push({ x: f.x, y: f.y, vx: (Math.random() - .5) * 3, vy: -Math.random() * 3, r: 3 + Math.random() * 7, life: 35, hue: [48, 174, 194, 218, 282, 345][(f.kind + j) % 6] });
      for (let j = 0; j < 6; j++) effects.push({ type: 'heart', x: (player.x + f.x) / 2 + (Math.random() - .5) * 35, y: (player.y + f.y) / 2, a: -Math.PI / 2 + (Math.random() - .5) * 1.2, r: 7 + Math.random() * 6, life: 48 + j * 3, hue: j % 2 ? 345 : 42 });
      updateHud();
    } else if (f.x < -100) fish.splice(i, 1);
  }
  for (let i = puffs.length - 1; i >= 0; i--) {
    let p = puffs[i];
    if (p.done) { puffs.splice(i, 1); continue; }
    if (hit(player, p, 67) && !player.inv && !p.hurt) {
      lives--; sfxHit(); player.inv = 80; player.hurt = 38; player.vx = -8; p.hurt = 38; p.vx = 5;
      for (let j = 0; j < 6; j++) effects.push({ x: (player.x + p.x) / 2, y: (player.y + p.y) / 2, a: j * Math.PI / 3, r: 8 + j % 2 * 3, life: 38 });
      updateHud();
      if (lives <= 0) setTimeout(gameOver, 550);
    } else if (p.x < -100) puffs.splice(i, 1);
  }
  for (let i = bubbles.length - 1; i >= 0; i--) { let b = bubbles[i]; b.x += b.vx; b.y += b.vy; b.life--; if (b.life < 0) bubbles.splice(i, 1); }
  for (let i = effects.length - 1; i >= 0; i--) { let e = effects[i]; if (e.type === 'heart') { e.x += Math.sin(t * .18 + e.a) * .8; e.y -= 1.8; } else { e.x += Math.cos(e.a) * 1.7; e.y += Math.sin(e.a) * 1.7 - 1; } e.life--; if (e.life < 0) effects.splice(i, 1); }
}
function draw() {
  x.clearRect(0, 0, W, H);
  if (A.bg.complete) x.drawImage(A.bg, 0, 0, W, H);
  x.fillStyle = '#38bfd70d'; x.fillRect(0, WATER, W, H - WATER);
  for (let i = 0; i < 25; i++) { let bx = (i * 97 - t * speed * .22) % 1300, by = WATER + 18 + (i * 73) % (H - WATER - 25), hue = [174, 194, 218, 282, 345][i % 5]; x.beginPath(); x.arc(bx, by, 2 + (i % 4), 0, 7); x.fillStyle = `hsla(${hue},90%,82%,.55)`; x.fill(); }
  livingWater(); livingPlants();
  fish.forEach(f => { let phase = (t + f.bob * 25), blink = phase % 190 < 10, frame = blink ? 2 : Math.floor(phase / 9) % 2, wag = Math.sin(t * .14 + f.bob); x.save(); x.translate(f.x, f.y); x.rotate(wag * .045); drawFishFrame(f.kind, frame, -theme.fish.drawW / 2, -theme.fish.drawH * .5, theme.fish.drawW, theme.fish.drawH); x.restore(); });
  puffs.forEach(p => { let idle = (t + p.bob * 20) % 170 < 10 ? 2 : Math.floor((t + p.bob * 20) / 16) % 2, frame = p.hurt ? 3 + Math.min(2, Math.floor((38 - p.hurt) / 12)) : idle, shake = p.hurt ? Math.sin(t * 1.5) * 7 : 0; x.save(); x.translate(p.x + shake, p.y); if (p.hurt) x.rotate(Math.sin(t * .8) * .16); drawPuffer(frame, -theme.puffer.drawW / 2, -theme.puffer.drawH / 2, theme.puffer.drawW, theme.puffer.drawH); x.restore(); });
  bubbles.forEach(b => { let hue = b.hue ?? 190, g = x.createRadialGradient(b.x - b.r * .35, b.y - b.r * .35, 0, b.x, b.y, b.r); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(.35, `hsla(${hue},95%,78%,.42)`); g.addColorStop(1, `hsla(${hue},90%,55%,.08)`); x.beginPath(); x.arc(b.x, b.y, b.r, 0, 7); x.fillStyle = g; x.fill(); x.strokeStyle = `hsla(${hue},95%,88%,.9)`; x.lineWidth = 1.6; x.stroke(); });
  effects.forEach(e => {
    x.save(); x.translate(e.x, e.y);
    if (e.type === 'heart') { let s = e.r, pulse = 1 + Math.sin(t * .32 + e.a) * .12; x.scale(pulse, pulse); x.fillStyle = `hsla(${e.hue},95%,65%,.92)`; x.strokeStyle = '#fff9'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(0, s * .34); x.bezierCurveTo(-s * 1.15, -s * .35, -s * .55, -s * 1.05, 0, -s * .48); x.bezierCurveTo(s * .55, -s * 1.05, s * 1.15, -s * .35, 0, s * .34); x.fill(); x.stroke(); }
    else { x.rotate(t * .12 + e.a); x.fillStyle = e.life % 6 < 3 ? '#ffe66d' : '#ff8d68'; x.beginPath(); for (let i = 0; i < 10; i++) { let rr = i % 2 ? e.r * .42 : e.r, aa = -Math.PI / 2 + i * Math.PI / 5; x.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr); } x.closePath(); x.fill(); }
    x.restore();
  });
  let moving = Math.abs(player.vx) > .5 || Math.abs(player.vy) > .5, frame = Math.floor(swimClock) % theme.char.frames, bob = moving ? Math.sin(swimClock * Math.PI / (theme.char.frames / 2)) * 2.2 : Math.sin(t * .055) * 1.5;
  if (!player.inv || Math.floor(player.inv / 6) % 2 === 0) drawCharacter(frame, player.vx < -.2, bob, 1);
  x.fillStyle = '#fff8'; x.font = 'bold 15px sans-serif'; x.fillText(`${theme.scoreIcon} 만나기 +1  ·  복어 -1 ${theme.lifeIcon}`, 18, H - 18);
}
function loop() { update(); if (A) draw(); requestAnimationFrame(loop); }

function gameOver() {
  running = false; sfxGameOver();
  let elapsed = (performance.now() - runStartedAt) / 1000, list = saveScore(score, elapsed);
  window.SeaPicnicUI.showResult({ score, elapsed: formatTime(elapsed), win: score >= 20, rankingHTML: rankingHTML(list) });
}

async function startGame(selectedTheme, selectedDiff, name) {
  theme = selectedTheme; diff = selectedDiff; playerName = safeName(name);
  try { localStorage.setItem(theme.nameKey, playerName); } catch {}
  document.querySelector('#title').textContent = `${playerName}의 ${theme.title}`;
  document.querySelector('#sound').setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기');
  A = await loadTheme(theme);
  ensureAudio(); sfxStart(); reset(); runStartedAt = performance.now(); running = true; updateTimer();
}
window.SeaPicnicGame = { start: startGame };

document.querySelector('#sound').onclick = () => { ensureAudio(); muted = !muted; master.gain.setTargetAtTime(muted ? 0 : .52, audioCtx.currentTime, .03); let b = document.querySelector('#sound'); b.textContent = muted ? '🔇' : '🔊'; b.setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기'); };
// 브라우저 기본 confirm()은 게임 화면과 스타일이 안 맞아서, 직접 그린 팝업으로 같은 역할을 해요
function showQuitConfirm() {
  return new Promise(resolve => {
    const box = document.querySelector('#quitConfirm');
    const yesBtn = document.querySelector('#quitYes'), noBtn = document.querySelector('#quitNo');
    box.style.display = 'grid';
    const finish = result => { box.style.display = 'none'; yesBtn.removeEventListener('click', onYes); noBtn.removeEventListener('click', onNo); resolve(result); };
    const onYes = () => finish(true), onNo = () => finish(false);
    yesBtn.addEventListener('click', onYes); noBtn.addEventListener('click', onNo);
  });
}
document.querySelector('#quit').onclick = async () => {
  if (!running) return;
  if (!await showQuitConfirm()) return;
  running = false;
  document.querySelector('#overlay').style.display = 'grid';
  window.SeaPicnicUI.renderSelect();
};
addEventListener('keydown', e => { keys[e.code] = true; if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space'].includes(e.code)) e.preventDefault(); });
addEventListener('keyup', e => keys[e.code] = false);
document.querySelectorAll('[data-key]').forEach(b => { let k = b.dataset.key; b.onpointerdown = e => { e.preventDefault(); keys[k] = true; }; b.onpointerup = b.onpointercancel = b.onpointerleave = () => keys[k] = false; });

requestAnimationFrame(loop);
