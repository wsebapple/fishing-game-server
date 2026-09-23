function getLevelForScore(s){
  for(const stage of Game.config.levelStages){
    if(s < stage.upTo) return stage;
  }
  return Game.config.levelStages[Game.config.levelStages.length - 1]; // 100점 넘으면 3단계 유지(최고 난이도)
}

function showBanner(text){
  const banner = document.getElementById('levelUpBanner');
  banner.textContent = text;
  banner.classList.remove('show');
  void banner.offsetWidth; // 애니메이션 재시작을 위한 트릭
  banner.classList.add('show');
}

// 지금 단계 + 날씨 상태에 맞는 스폰 속도로 물고기 생성 타이머를 다시 맞춰요
// (멀티플레이 서버의 applySpawnRate와 같은 방식: 폭풍우/눈이 오는 중에 레벨업해도
// 날씨 효과가 사라지지 않게 해요)
function applyLevelSpawnRate(){
  if(!Game.state.running) return;
  let spawnMs = Game.config.levelStages[Game.state.currentLevel - 1].spawnMs;
  if(Game.effects.activeWeatherKind === 'storm') spawnMs = Math.max(220, spawnMs * 0.55);
  else if(Game.effects.activeWeatherKind === 'snow') spawnMs = spawnMs * 1.25;
  clearInterval(Game.timers.spawnTimer);
  Game.timers.spawnTimer = setInterval(spawnFish, spawnMs);
}

function checkLevelUp(){
  const stage = getLevelForScore(Game.state.score);
  if(stage.level !== Game.state.currentLevel){
    Game.state.currentLevel = stage.level;
    document.getElementById('level').textContent = Game.state.currentLevel;

    // 물고기 스폰 속도를 새 단계(+현재 날씨)에 맞게 조정
    applyLevelSpawnRate();

    showBanner('🌟 ' + Game.state.currentLevel + '단계! 🌟');
    playLevelUpSound();
  }
}

// 마우스를 따라 낚싯대/줄 움직이기
const linePath = document.getElementById('linePath');
const hook = document.getElementById('hook');
const boat = document.getElementById('boat');

function updateHookIcon(){
  hook.textContent = Game.effects.frozen ? '🧊' : (Game.effects.magnetActive ? '🧲' : '🪝');
}

function moveRod(x, y){
  if(Game.effects.frozen) return; // 얼어있는 동안엔 낚싯줄을 움직일 수 없어요
  const clampedX = Math.max(80, Math.min(Game.view.w - 80, x));
  const clampedY = Math.max(110, Math.min(Game.view.h - 110, y || 330));
  // 바늘(잡는 판정 기준)은 커서를 그대로 따라가야 정확하니 즉시 움직여요.
  // 배/낚싯줄의 "뒤늦게 따라오는" 연출은 updateBoatAndLine()이 따로 매 프레임 처리해요.
  Game.hook.x = clampedX; Game.hook.y = clampedY;
  hook.style.left = clampedX + 'px';
  hook.style.top = clampedY + 'px';

  // 폭풍우 안개의 중심을 낚싯바늘 위치로 맞춰요
  const fog = document.getElementById('stormFog');
  fog.style.setProperty('--fx', clampedX + 'px');
  fog.style.setProperty('--fy', clampedY + 'px');
}

// 배 한 척(내 배/친구 배)을 한 프레임 움직여요. 낚싯대 끝이 바늘 바로 위에 오도록 쫓아가고,
// 바늘을 반대쪽으로 계속 끌거나 배 가운데 뒤로 넘기면 뱃머리를 돌려요(살짝 되돌리는 건 뒤로 물러나기만 해요).
// 낚싯대 끝 좌표와 배가 뒤처진 정도(lag)를 돌려줘요.
function stepBoat(b, hookX, bobY){
  const s = Game.boat.scale();
  const reach = Game.boat.tipDX * s;
  b.hookVel = (b.hookVel || 0) * 0.9 + (hookX - (typeof b.prevHookX === 'number' ? b.prevHookX : hookX)) * 0.1; // 바늘이 움직이는 속도(프레임당 px, 부드럽게)
  b.prevHookX = hookX;
  const behind = (hookX - b.x) * b.facing < -Game.boat.turnSlack;
  if(behind || b.hookVel * b.facing < -Game.boat.turnSpeed) b.facing = -b.facing;
  const half = 50 * s; // 화면 가장자리에서 배가 반 넘게 잘리지 않게 해요
  const targetX = Math.max(half, Math.min(Game.view.w - half, hookX - b.facing * reach));
  b.x += (targetX - b.x) * 0.1;
  if(Math.abs(targetX - b.x) < 0.3) b.x = targetX;
  b.turn += (b.facing - b.turn) * 0.18; // 좌우를 확 뒤집지 않고 납작해졌다가 돌아서게 해요
  if(Math.abs(b.facing - b.turn) < 0.01) b.turn = b.facing;
  return {
    s,
    tipX: b.x + b.turn * reach,
    tipY: Game.boat.bottom - Game.boat.tipUp * s + bobY,
    lag: targetX - b.x,
  };
}

// 배가 물 위에서 천천히 오르내리는 높이(px). 줄 시작점도 같은 값만큼 움직여야 낚싯대 끝에 붙어 있어요.
function boatBob(now, phase = 0){
  return 3 + 3 * Math.sin(now / 2200 * Math.PI * 2 + phase);
}

function placeBoat(el, b, bobY, s){
  el.style.left = b.x.toFixed(1) + 'px';
  el.style.transform = `translate(-50%, ${bobY.toFixed(1)}px)`;
  el.firstElementChild.style.transform = `scale(${(b.turn * s).toFixed(3)}, ${s})`;
}

// 낚싯대 끝에서 바늘까지: 배가 뒤처진 만큼 줄이 뒤로 처지며 휘어요
function fishingLinePath(tip, hookX, hookY){
  const midX = (tip.tipX + hookX) / 2, midY = (tip.tipY + hookY) / 2;
  const controlX = midX - tip.lag * 0.3, controlY = midY - 15;
  return `M ${tip.tipX.toFixed(1)} ${tip.tipY.toFixed(1)} Q ${controlX.toFixed(1)} ${controlY.toFixed(1)} ${hookX.toFixed(1)} ${hookY.toFixed(1)}`;
}

function updateBoatAndLine(now){
  // 다음 프레임 예약을 맨 먼저 해요. 그리는 도중 오류가 한 번 나도 배·줄 그리기가 영영 멈추지 않게요
  // (예전엔 오류가 나면 배가 왼쪽 구석에 멈추고 줄이 사라진 채로 남았어요).
  requestAnimationFrame(updateBoatAndLine);
  // 시작/종료/도감 화면에서는 아무것도 안 움직이니 계산을 쉬어요(루프는 살려둬서 게임이 시작되면 바로 이어져요)
  if(Game.state.running || Game.mp.active || !Game.hook.lastDrawnLine){ // 첫 프레임은 시작 화면 뒤에 배를 그려두려고 항상 그려요
    const bobY = boatBob(now || 0);
    const tip = stepBoat(Game.hook.boat, Game.hook.x, bobY);
    const d = fishingLinePath(tip, Game.hook.x, Game.hook.y);
    if(d !== Game.hook.lastDrawnLine){ // 배가 멈춰 있으면 DOM을 다시 쓰지 않아요
      Game.hook.lastDrawnLine = d;
      placeBoat(boat, Game.hook.boat, bobY, tip.s);
      linePath.setAttribute('d', d);
    }
    if(Game.mp.active) updateGhostBoats(now || 0);
  }
}
requestAnimationFrame(updateBoatAndLine);

// 경쟁 배(해적)도 내 배 그림을 복제해서 써요 (색은 CSS에서 바꿔요)
document.getElementById('rivalBoat').appendChild(boat.querySelector('.boatBody').cloneNode(true));

// 자석이 물고기를 바늘로 끌어오는 속도(초당 px). 끌려오는 모습이 보이도록 천천히 하되,
// 조이스틱 최고 속도(420px/s)보다는 빨라야 바늘을 움직이는 중에도 끌려오던 물고기가 결국 따라잡아서 잡혀요.
// (이보다 느리면 물고기가 바늘 뒤에 쌓였다가 점수 없이 사라지던 버그가 다시 생겨요) 프레임 수와 상관없이 같은 속도예요.
const MAGNET_PULL_SPEED = 500;
// pos(왼쪽 위 모서리 {left, top})를 중심이 바늘에 겹치도록 dt초만큼 끌어와요
function magnetPull(pos, half, dt){
  const dx = (Game.hook.x - half) - pos.left, dy = (Game.hook.y - half) - pos.top;
  const dist = Math.hypot(dx, dy);
  if(dist < 0.01) return;
  const step = Math.min(dist, MAGNET_PULL_SPEED * dt);
  pos.left += (dx / dist) * step;
  pos.top += (dy / dist) * step;
}

// 바늘이 (centerX, centerY)에 있는 물고기에 닿았는지, DOM을 안 읽고 숫자로만 확인해요
function isNearHook(centerX, centerY, catchRadius){
  const dx = centerX - Game.hook.x, dy = centerY - Game.hook.y;
  return (dx * dx + dy * dy) < catchRadius * catchRadius;
}

// 진짜 마우스로 움직일 때만 바늘이 커서를 따라가요. 아이폰은 화면을 탭하면 가짜 마우스 이벤트(mousemove)를
// 같이 보내서, 예전엔 탭할 때마다 바늘이 그 자리로 순간이동해 배·줄과 떨어져 보였어요.
Game.dom.scene.addEventListener('pointermove', e => { if(e.pointerType === 'mouse' || e.pointerType === 'pen') moveRod(e.clientX, e.clientY); });
// 화면을 손가락으로 끌면 배가 그 자리로 순간이동하는 게 어색해서, 터치 기기는
// 대신 화면 아래 가상 조이스틱으로 배를 "조종"하게 해요 (아래 조이스틱 코드 참고)
// 한 손가락 끌기로 화면이 스크롤되는 건 막고, 두 손가락 확대(핀치줌)는 막지 않아요
Game.dom.scene.addEventListener('touchmove', e => { if(e.touches.length < 2) e.preventDefault(); }, {passive:false});
moveRod(Game.view.w/2, 330);

/* ------------------------------------------------------
   터치 기기용 가상 조이스틱: 화면 아래 왼쪽 원을 손가락으로 밀면
   그 방향으로 배가 계속 이동해요 (마우스는 그대로 커서를 따라가요)
------------------------------------------------------ */
const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const joystickBase = document.getElementById('joystickBase');
const joystickKnob = document.getElementById('joystickKnob');
Game.joystick = { dx: 0, dy: 0, active: false, touchId: null }; // dx/dy: -1~1로 정규화된 방향

// 조이스틱은 실제로 게임을 플레이하는 동안에만 보여줘요. 시작/종료/도감 같은
// 메뉴 화면은 반투명 배경이라, z-index로만 가리면 하얀 원이 유령처럼 비쳐 보여요.
function setJoystickVisible(visible){
  if(!isTouchDevice) return;
  joystickBase.classList.toggle('hidden', !visible);
}

if(isTouchDevice){
  const maxKnobOffset = 35; // 조이스틱 안에서 노브가 움직일 수 있는 최대 거리(px)
  const deadZone = 6; // 이보다 작게 밀면 안 움직인 걸로 쳐요

  function updateJoystick(touch){
    const rect = joystickBase.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let dx = touch.clientX - centerX;
    let dy = touch.clientY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if(dist < deadZone){
      Game.joystick.dx = 0; Game.joystick.dy = 0;
      joystickKnob.style.transform = 'translate(0px, 0px)';
      return;
    }
    if(dist > maxKnobOffset){
      dx = (dx / dist) * maxKnobOffset;
      dy = (dy / dist) * maxKnobOffset;
    }
    joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    Game.joystick.dx = dx / maxKnobOffset;
    Game.joystick.dy = dy / maxKnobOffset;
  }

  function resetJoystick(){
    Game.joystick.active = false;
    Game.joystick.touchId = null;
    Game.joystick.dx = 0; Game.joystick.dy = 0;
    joystickKnob.style.transform = 'translate(0px, 0px)';
  }

  joystickBase.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    Game.joystick.touchId = t.identifier;
    Game.joystick.active = true;
    updateJoystick(t);
    e.preventDefault();
  }, { passive: false });

  joystickBase.addEventListener('touchmove', (e) => {
    if(!Game.joystick.active) return;
    const t = Array.from(e.changedTouches).find(t => t.identifier === Game.joystick.touchId);
    if(t) updateJoystick(t);
    e.preventDefault();
  }, { passive: false });

  joystickBase.addEventListener('touchend', (e) => {
    if(Array.from(e.changedTouches).some(t => t.identifier === Game.joystick.touchId)) resetJoystick();
  });
  joystickBase.addEventListener('touchcancel', resetJoystick);

  const JOYSTICK_SPEED = 420; // 조이스틱을 끝까지 밀었을 때 배가 움직이는 속도(초당 px)
  let lastSteerTime = null;

  function steerLoop(now){
    if(Game.joystick.active && (Game.joystick.dx !== 0 || Game.joystick.dy !== 0)){
      if(lastSteerTime !== null){
        const dt = Math.min((now - lastSteerTime) / 1000, 0.05);
        const curX = parseFloat(hook.style.left) || Game.view.w / 2;
        const curY = parseFloat(hook.style.top) || 330;
        moveRod(curX + Game.joystick.dx * JOYSTICK_SPEED * dt, curY + Game.joystick.dy * JOYSTICK_SPEED * dt);
      }
      lastSteerTime = now;
    } else {
      lastSteerTime = null;
    }
    requestAnimationFrame(steerLoop);
  }
  requestAnimationFrame(steerLoop);
}

function pickFishType(){
  const total = Game.config.fishTypes.reduce((s,f)=>s+f.chance,0);
  let r = Math.random()*total;
  for(const f of Game.config.fishTypes){
    if(r < f.chance) return f;
    r -= f.chance;
  }
  return Game.config.fishTypes[0];
}

function spawnFish(){
  if(!Game.state.running) return;
  const type = pickFishType();
  const fish = document.createElement('div');
  fish.className = 'fish';
  fish.textContent = type.emoji;
  fish.dataset.name = type.name;

  const fromLeft = Math.random() < 0.5;
  const y = 120 + Math.random() * (Game.view.h - 260);
  fish.style.top = y + 'px';
  fish.style.left = (fromLeft ? -50 : Game.view.w + 50) + 'px';
  // 물고기 이모지는 기본적으로 왼쪽을 보므로, 왼쪽에서 오른쪽으로 갈 때 뒤집어요.
  if(fromLeft) fish.style.transform = 'scaleX(-1)';
  Game.dom.scene.appendChild(fish);

  const distance = Game.view.w + 100;
  const duration = distance / (type.speed * 40); // 초 단위 대략치
  const startTime = performance.now();
  // 물고기의 지금 위치를 우리가 직접 계산해서 알고 있으니, DOM에서 다시 읽지 않아요
  let curLeft = fromLeft ? -50 : Game.view.w + 50;
  let curTop = y;
  // 사나운 보스가 잡아먹을 물고기를 고를 때 쓰는 정보
  fish._type = type;
  fish._center = () => ({ x: curLeft + Game.config.hitbox.fishHalf, y: curTop + Game.config.hitbox.fishHalf });
  let lastFrame = startTime;

  function animate(now){
    if(!fish.isConnected || fish.classList.contains('eaten')) return;

    // 낚싯바늘이 물고기 몸에 닿으면 클릭/탭 없이도 바로 잡혀요
    if(isNearHook(curLeft + Game.config.hitbox.fishHalf, curTop + Game.config.hitbox.fishHalf, Game.config.hitbox.fishCatchRadius)){
      catchFish(fish, type);
      return;
    }

    // 자석이 켜져 있으면 물고기가 낚싯바늘 쪽으로 저절로 끌려와요
    // (curLeft/curTop은 물고기의 왼쪽위 모서리라, 목표점도 FISH_HALF만큼 당겨줘야
    // 물고기의 "중심"이 바늘 중심에 겹쳐요. 안 그러면 중심끼리 대각선으로 어긋나서
    // isNearHook 판정 반경(42px) 밖에서 맴돌다가 못 잡히고 사라져버려요)
    const dt = Math.min(now - lastFrame, 100) / 1000;
    lastFrame = now;
    if(Game.effects.magnetActive && !type.isMagnet){
      const pos = { left: curLeft, top: curTop };
      magnetPull(pos, Game.config.hitbox.fishHalf, dt);
      curLeft = pos.left; curTop = pos.top;
      fish.style.left = curLeft + 'px';
      fish.style.top = curTop + 'px';
      requestAnimationFrame(animate);
      return;
    }

    const elapsed = (now - startTime) / 1000;
    const progress = elapsed / duration;
    if(progress >= 1){ fish.remove(); return; }
    curLeft = fromLeft
      ? -50 + progress * distance
      : (Game.view.w + 50) - progress * distance;
    fish.style.left = curLeft + 'px';
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

// 대왕게가 뿌린 쓰레기 하나: 멀티와 같은 궤적(trashCenter)으로 가라앉다가 사라져요. 바늘에 걸리면 감점!
const TRASH_LIFETIME_MS = 6000;
function spawnTrash(trash){
  if(!Game.state.running) return;
  const trashTypes = Game.config.fishTypes.filter(f => f.isBossTrash);
  const type = trashTypes[Math.floor(Math.random() * trashTypes.length)];
  const half = Game.config.hitbox.trashHalf;
  const fish = document.createElement('div');
  fish.className = 'fish trashItem';
  fish.textContent = type.emoji;
  fish.dataset.name = type.name;
  const start = trashCenter(trash, 0, Game.view.w, Game.view.h);
  let curLeft = start.x - half, curTop = start.y - half;
  fish.style.left = curLeft + 'px';
  fish.style.top = curTop + 'px';
  Game.dom.scene.appendChild(fish);
  const startTime = performance.now();
  let lastFrame = startTime;

  function animate(now){
    if(!fish.isConnected) return;
    if(now - startTime >= TRASH_LIFETIME_MS){ fish.remove(); return; }
    if(isNearHook(curLeft + half, curTop + half, Game.config.hitbox.trashCatchRadius)){
      catchFish(fish, type);
      return;
    }
    const dt = Math.min(now - lastFrame, 100) / 1000;
    lastFrame = now;
    if(Game.effects.magnetActive){ // 자석은 쓰레기도 가리지 않고 끌어와요 (멀티와 같아요)
      const pos = { left: curLeft, top: curTop };
      magnetPull(pos, half, dt);
      curLeft = pos.left; curTop = pos.top;
    } else {
      const c = trashCenter(trash, (now - startTime) / 1000, Game.view.w, Game.view.h);
      curLeft = c.x - half; curTop = c.y - half;
    }
    fish.style.left = curLeft + 'px';
    fish.style.top = curTop + 'px';
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

// 잠깐 떴다가 사라지는 연출용 글자/이모지 하나를 (x, y)에 띄워요
function spawnEffectText(className, text, x, y, lifeMs){
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  Game.dom.scene.appendChild(el);
  setTimeout(() => el.remove(), lifeMs);
}

// 보스 엘리먼트에 연출용 class를 잠깐 붙였다 떼요 (같은 연출을 연달아 다시 틀 수 있게 reflow로 되감아요)
function flashBossClass(bossEl, className, ms){
  if(!bossEl || !bossEl.isConnected) return;
  bossEl.classList.remove(className);
  void bossEl.offsetWidth;
  bossEl.classList.add(className);
  setTimeout(() => bossEl.classList.remove(className), ms);
}

// 사나운 보스가 물고기를 삼키는 연출 (싱글·멀티 공통). 점수는 아무도 못 받아요.
// 보스가 물고기 쪽으로 덥석 튀어나가고(💥), 물고기는 빙글빙글 돌며 입으로 빨려 들어가요.
// 머리 위엔 😋, 바늘이 가까우면 화면도 살짝 흔들려요.
function playEatEffect(fishEl, bossCenterX, bossCenterY, bossType, bossEl){
  if(!fishEl || !fishEl.isConnected || fishEl.classList.contains('eaten')) return;
  const half = Game.config.hitbox.fishHalf;
  const fishX = (parseFloat(fishEl.style.left) || 0) + half, fishY = (parseFloat(fishEl.style.top) || 0) + half;
  const bossHalf = bossType.half || Game.config.hitbox.bossHalf;

  if(bossEl){
    const dx = fishX - bossCenterX, dy = fishY - bossCenterY;
    const dist = Math.max(Math.hypot(dx, dy), 1);
    const reach = Math.min(dist * 0.6, 40);
    bossEl.style.setProperty('--lx', (dx / dist * reach).toFixed(1) + 'px');
    bossEl.style.setProperty('--ly', (dy / dist * reach).toFixed(1) + 'px');
    flashBossClass(bossEl, 'lunge', 360);
  }
  spawnEffectText('chompBurst', '💥', (fishX + bossCenterX) / 2, (fishY + bossCenterY) / 2, 520);
  spawnEffectText('bossEmote', '😋', bossCenterX, bossCenterY - bossHalf, 920);
  const pop = document.createElement('div');
  pop.className = 'caughtPop';
  pop.textContent = bossType.emoji + ' 냠! 먹혔어요';
  pop.style.color = '#ff9b9b';
  pop.style.fontSize = '16px';
  pop.style.left = fishEl.style.left;
  pop.style.top = fishEl.style.top;
  Game.dom.scene.appendChild(pop);
  setTimeout(() => pop.remove(), 900);

  if(Math.hypot(Game.hook.x - bossCenterX, Game.hook.y - bossCenterY) < 200) flashBossClass(Game.dom.scene, 'shake', 320);

  fishEl.classList.add('eaten');
  fishEl.style.left = (bossCenterX - half) + 'px';
  fishEl.style.top = (bossCenterY - half) + 'px';
  setTimeout(() => fishEl.remove(), 420);
  playEatSound();
}

// 대왕게가 쓰레기를 뿌리기 직전 예고: 빨갛게 깜빡이고 머리 위에 ❗가 떠요
function playTrashWarnEffect(bossEl, bossCenterX, bossCenterY, bossType){
  flashBossClass(bossEl, 'warn', 620);
  spawnEffectText('bossEmote', '❗', bossCenterX, bossCenterY - (bossType.half || Game.config.hitbox.bossHalf), 920);
}

// 대왕게가 쓰레기를 던지는 순간: 몸을 휘두르고 흙탕물 구름이 퍼져요
function playTrashThrowEffect(bossEl, bossCenterX, bossCenterY){
  flashBossClass(bossEl, 'throwing', 420);
  const cloud = document.createElement('div');
  cloud.className = 'mudCloud';
  cloud.style.left = bossCenterX + 'px';
  cloud.style.top = bossCenterY + 'px';
  Game.dom.scene.appendChild(cloud);
  setTimeout(() => cloud.remove(), 950);
}

function catchFish(fish, type){
  if(!Game.state.running || !fish.isConnected) return;

  // 보물통은 잡을 때마다 랜덤 보너스 점수 + 랜덤 보물 아이템을 줘요
  let earnedPoints = type.points;
  let lootName = '';
  if(type.isTreasure){
    earnedPoints = Math.floor(Math.random() * (type.maxBonus - type.minBonus + 1)) + type.minBonus;
    lootName = Game.config.lootItems[Math.floor(Math.random() * Game.config.lootItems.length)];
    Game.state.treasureLoot.push(lootName);
  }

  // 자석: 잠깐동안 물고기들이 낚싯바늘로 저절로 끌려와요
  if(type.isMagnet){
    Game.effects.magnetActive = true;
    updateHookIcon();
    clearTimeout(Game.effects.magnetTimer);
    Game.effects.magnetTimer = setTimeout(() => {
      Game.effects.magnetActive = false;
      updateHookIcon();
    }, type.magnetMs);
  }

  // 시계: 시간이 늘어나요
  if(type.isTimeBonus){
    Game.state.timeLeft += type.timeBonus;
    document.getElementById('timeLeft').textContent = Game.state.timeLeft;
  }

  Game.state.score += earnedPoints;
  if(Game.state.score < 0) Game.state.score = 0;
  document.getElementById('score').textContent = Game.state.score;
  checkLevelUp();
  Game.state.caughtLog[type.name]++;
  playCatchSound(earnedPoints, type.isTreasure, type.isMagnet, type.isTimeBonus);

  document.getElementById('sun').classList.add('bounce');
  setTimeout(()=>document.getElementById('sun').classList.remove('bounce'), 250);

  const pop = document.createElement('div');
  pop.className = 'caughtPop';
  if(type.isTreasure){
    pop.textContent = '🎁 ' + lootName + '! +' + earnedPoints;
    pop.style.color = '#ffe066';
    pop.style.fontSize = '18px';
  } else if(type.isMagnet){
    pop.textContent = '🧲 자석 발동! 물고기가 끌려와요!';
    pop.style.color = '#a0e6ff';
    pop.style.fontSize = '16px';
  } else if(type.isTimeBonus){
    pop.textContent = '⏰ 시간 +' + type.timeBonus + '초!';
    pop.style.color = '#b6ffb0';
    pop.style.fontSize = '18px';
  } else if(type.points === 0){
    pop.textContent = type.label || "꽝!";
    pop.style.color = '#d8d8d8';
    pop.style.fontSize = '18px';
  } else {
    pop.textContent = (earnedPoints > 0 ? '+' : '') + earnedPoints;
    pop.style.color = earnedPoints > 0 ? '#fff' : '#ffb3b3';
  }
  pop.style.left = fish.style.left;
  pop.style.top = fish.style.top;
  Game.dom.scene.appendChild(pop);
  setTimeout(()=>pop.remove(), 700);

  fish.classList.add('caught');
  setTimeout(() => fish.remove(), 350);
}

function scheduleRival(){
  if(!Game.state.running) return;
  const delay = 6000 + Math.random() * 6000; // 6~12초마다 랜덤하게 등장
  Game.timers.rivalTimeout = setTimeout(tryStealFish, delay);
}

function tryStealFish(){
  if(!Game.state.running) return;
  // 보스는 친구들(여기선 나)이 직접 잡거나 도망가게 두고, 해적은 노리지 않아요 (멀티플레이와 동일)
  // 그렇지 않으면 해적이 보스를 통째로 훔쳐가버려서, 잡는 도중 사라지고
  // 다음 보스도 다시는 안 나오는 문제가 생겨요
  const fishes = Array.from(document.querySelectorAll('.fish')).filter(f => !f.classList.contains('boss-fish') && !f.classList.contains('trashItem') && !f.classList.contains('eaten'));
  if(fishes.length === 0){ scheduleRival(); return; }

  // 보물통이 화면에 있으면 그것부터 노려요!
  const treasures = fishes.filter(f => f.dataset.name === '보물통');
  const pool = treasures.length > 0 ? treasures : fishes;
  const target = pool[Math.floor(Math.random() * pool.length)];
  const targetX = Math.max(80, Math.min(Game.view.w - 80, parseFloat(target.style.left) || Game.view.w/2));

  const rival = document.getElementById('rivalBoat');
  rival.style.left = targetX + 'px';
  rival.classList.add('show');

  setTimeout(() => {
    if(target.isConnected){
      playStealSound();
      target.style.transition = 'transform .3s ease, opacity .3s ease';
      target.style.transform = (target.style.transform || '') + ' scale(0.3)';
      target.style.opacity = '0';

      const steal = document.createElement('div');
      steal.className = 'caughtPop';
      steal.textContent = target.dataset.name === '보물통'
        ? '🏴‍☠️ 해적이 보물통을 가져갔어요!'
        : '🏴‍☠️ 다른 배가 채갔어요!';
      steal.style.color = '#ff9b9b';
      steal.style.fontSize = '16px';
      steal.style.left = target.style.left;
      steal.style.top = target.style.top;
      Game.dom.scene.appendChild(steal);
      setTimeout(() => steal.remove(), 900);
      setTimeout(() => target.remove(), 300);
    }
    setTimeout(() => rival.classList.remove('show'), 500);
  }, 700);

  scheduleRival();
}



function scheduleWeather(){
  if(!Game.state.running) return;
  const delay = 18000 + Math.random() * 15000; // 18~33초마다 랜덤하게 날씨 이벤트
  Game.timers.stormTimeout = setTimeout(triggerWeatherEvent, delay);
}

function triggerWeatherEvent(){
  if(!Game.state.running) return;
  if(Math.random() < 0.5) triggerStorm();
  else triggerSnow();
}

function triggerSnow(){
  if(!Game.state.running) return;
  Game.effects.activeWeatherKind = 'snow';
  document.getElementById('snowTint').classList.add('active');
  showBanner('❄️ 눈이 내려요! 낚싯줄이 얼었어요 🥶');

  // 눈이 내리기 시작하면 5초 동안 낚싯줄이 얼어서 움직일 수 없어요
  Game.effects.frozen = true;
  updateHookIcon();
  clearTimeout(Game.effects.freezeTimeout);
  Game.effects.freezeTimeout = setTimeout(() => {
    Game.effects.frozen = false;
    updateHookIcon();
  }, 5000);

  // 눈 오는 동안은 조금 더 느긋하게
  applyLevelSpawnRate();

  clearInterval(Game.timers.snowFlakeInterval);
  Game.timers.snowFlakeInterval = setInterval(() => {
    const flake = document.createElement('div');
    flake.className = 'snowflake';
    flake.textContent = '❄️';
    flake.style.left = Math.random() * 100 + '%';
    flake.style.fontSize = (10 + Math.random() * 14) + 'px';
    flake.style.animationDuration = (4 + Math.random() * 3) + 's';
    Game.dom.scene.appendChild(flake);
    setTimeout(() => flake.remove(), 8000);
  }, 220);

  const duration = 7000 + Math.random() * 3000;
  setTimeout(() => {
    clearInterval(Game.timers.snowFlakeInterval); Game.timers.snowFlakeInterval = null;
    document.getElementById('snowTint').classList.remove('active');
    showBanner('☀️ 눈이 그쳤어요!');
    Game.effects.activeWeatherKind = null;
    applyLevelSpawnRate();
    scheduleWeather();
  }, duration);
}

function triggerStorm(){
  if(!Game.state.running) return;
  Game.effects.stormActive = true;
  Game.effects.activeWeatherKind = 'storm';
  document.getElementById('stormOverlay').classList.add('active');
  document.getElementById('stormFog').classList.add('active');
  showBanner('⛈️ 폭풍우가 몰아쳐요!');
  playThunderSound();

  // 폭풍우 동안 물고기가 더 빨리, 자주 나와요
  applyLevelSpawnRate();

  // 가끔 번개가 번쩍여요
  clearInterval(Game.timers.stormFlashInterval);
  Game.timers.stormFlashInterval = setInterval(() => {
    const flash = document.getElementById('lightningFlash');
    flash.classList.remove('flash');
    void flash.offsetWidth;
    flash.classList.add('flash');
    playThunderSound();
  }, 1800 + Math.random() * 1200);

  const stormDuration = 6000 + Math.random() * 3000;
  setTimeout(() => {
    clearInterval(Game.timers.stormFlashInterval); Game.timers.stormFlashInterval = null;
    Game.effects.stormActive = false;
    document.getElementById('stormOverlay').classList.remove('active');
    document.getElementById('stormFog').classList.remove('active');
    showBanner('🌤️ 폭풍우가 지나갔어요!');
    Game.effects.activeWeatherKind = null;
    applyLevelSpawnRate();
    scheduleWeather();
  }, stormDuration);
}



// 보스마다 스칠 때 나오는 연출(색/파티클 모양)을 다르게 줘요
const BOSS_ESCAPE_STYLE = {
  ink:    { c1:'rgba(8,6,18,0.94)',   c2:'rgba(8,6,18,0.78)',   c3:'rgba(8,6,18,0.4)',   c4:'rgba(8,6,18,0)',   blob:'#0b0716', char:'●' },
  splash: { c1:'rgba(9,64,99,0.9)',   c2:'rgba(9,64,99,0.7)',   c3:'rgba(9,64,99,0.32)', c4:'rgba(9,64,99,0)',  blob:'#bfeeff', char:'💧' },
  wave:   { c1:'rgba(16,74,110,0.9)', c2:'rgba(16,74,110,0.68)',c3:'rgba(16,74,110,0.3)',c4:'rgba(16,74,110,0)',blob:'#eaffff', char:'〰️' },
  shock:  { c1:'rgba(88,32,150,0.92)',c2:'rgba(88,32,150,0.7)', c3:'rgba(88,32,150,0.3)',c4:'rgba(88,32,150,0)',blob:'#ffe066', char:'⚡' },
  sand:   { c1:'rgba(120,88,48,0.9)', c2:'rgba(120,88,48,0.68)',c3:'rgba(120,88,48,0.3)',c4:'rgba(120,88,48,0)',blob:'#e8caa0', char:'●' },
};



// 보스가 스치고 도망갈 때 시각/음향 효과: 보스 주변만 잠깐 가려요
function spawnBossEscapeEffect(x, y, kind){
  const style = BOSS_ESCAPE_STYLE[kind] || BOSS_ESCAPE_STYLE.ink;
  const cloud = document.createElement('div');
  cloud.className = 'bossEscapeCloud';
  cloud.style.left = x + 'px';
  cloud.style.top = y + 'px';
  cloud.style.setProperty('--ec1', style.c1);
  cloud.style.setProperty('--ec2', style.c2);
  cloud.style.setProperty('--ec3', style.c3);
  cloud.style.setProperty('--ec4', style.c4);
  Game.dom.scene.appendChild(cloud);
  setTimeout(() => cloud.remove(), 1300);

  const blobCount = 6;
  for(let i = 0; i < blobCount; i++){
    const blob = document.createElement('div');
    blob.className = 'bossEscapeBlob';
    blob.textContent = style.char;
    blob.style.left = x + 'px';
    blob.style.top = y + 'px';
    blob.style.setProperty('--ebc', style.blob);
    const angle = (Math.PI * 2 * i) / blobCount + Math.random() * 0.5;
    const dist = 40 + Math.random() * 70;
    blob.style.setProperty('--dx', (Math.cos(angle) * dist) + 'px');
    blob.style.setProperty('--dy', (Math.sin(angle) * dist) + 'px');
    Game.dom.scene.appendChild(blob);
    setTimeout(() => blob.remove(), 850);
  }
  playBossEscapeSound(kind);
}

// 도망칠 때는 가까운 곳 말고 최대한 먼 곳으로: 후보 몇 개를 뽑아서 제일 먼 곳을 골라요
function pickBossTarget(minX, maxX, minY, maxY){
  return { x: minX + Math.random() * (maxX - minX), y: minY + Math.random() * (maxY - minY) };
}
function pickBossFleeTarget(curLeft, curTop, minX, maxX, minY, maxY){
  let best = null, bestDist = -1;
  for(let i = 0; i < 14; i++){
    const t = pickBossTarget(minX, maxX, minY, maxY);
    const d = Math.hypot(t.x - curLeft, t.y - curTop);
    if(d > bestDist){ bestDist = d; best = t; }
  }
  return best;
}

function scheduleBoss(){
  if(!Game.state.running) return;
  const delay = 22000 + Math.random() * 15000; // 22~37초마다 랜덤하게 보스 등장
  Game.timers.bossTimeout = setTimeout(spawnBoss, delay);
}

function spawnBoss(){
  if(!Game.state.running) return;
  const bossType = Game.config.bossTypes[Math.floor(Math.random() * Game.config.bossTypes.length)];
  const half = bossType.half, catchRadius = bossType.catchRadius;
  showBanner(bossType.emoji + ' ' + bossType.name + ' 출현!');
  playBossSound();

  const fromLeft = Math.random() < 0.5;
  const startY = 150 + Math.random() * (Game.view.h - 320);
  const fish = document.createElement('div');
  fish.className = 'fish boss-fish';
  fish.textContent = bossType.emoji;
  fish.dataset.name = bossType.name;
  fish.style.top = startY + 'px';
  fish.style.left = (fromLeft ? -100 : Game.view.w + 100) + 'px';
  fish.style.fontSize = '86px';
  if(bossType.tint) fish.style.filter = bossType.tint + ' drop-shadow(0 3px 3px rgba(0,0,0,0.25))';
  Game.dom.scene.appendChild(fish);

  let curLeft = fromLeft ? -100 : Game.view.w + 100;
  let curTop = startY;

  // 몇 번 낚싯바늘에 스칠 때까지는 안 잡히고, 스칠 때마다 도망가요 (보스마다 필요 횟수가 달라요)
  const hitsNeeded = bossType.hitsMin + Math.floor(Math.random() * (bossType.hitsMax - bossType.hitsMin + 1));
  let hitsLanded = 0;
  let invulnerableUntil = 0;

  const minX = -80, maxX = Game.view.w + 80;
  const minY = 130, maxY = Game.view.h - 160;
  // 처음에는 화면 안쪽으로 헤엄쳐 들어와요
  let target = { x: Game.view.w * (0.3 + Math.random() * 0.4), y: startY };

  const speedPxPerSec = 90 * (bossType.speedMul || 1) * 1.25; // 보스는 일반 물고기보다 빠르게 움직여요
  const encounterDeadline = performance.now() + 28000; // 28초 안에 다 못 잡으면 완전히 도망가요
  let lastTime = performance.now();

  // 상어: 가끔 순간적으로 멀리 돌진해요 / 바다용: 방향을 자주 바꿔서 불규칙하게 움직여요
  let dashUntil = 0;
  let nextDashAt = lastTime + 1500 + Math.random() * 2000;
  let nextJitterPickAt = lastTime;
  // 사나운 보스(eats)는 점수 물고기를 잡아먹고, 대왕게(throwsTrash)는 감점 쓰레기를 뿌려요
  let nextEatAt = 0;
  let nextThrowAt = lastTime + (bossType.throwsTrash ? bossType.throwsTrash.everyMs : 0);
  let warnedAt = 0; // 쓰레기 예고를 한 시각 (0이면 아직 예고 전)
  // 대왕게: 주기적으로 모래 속에 잠깐 숨어서 무적이 돼요
  const stealthCycleStart = lastTime + 1500 + Math.random() * 1500;
  function isStealthedNow(now){
    if(!bossType.stealth) return false;
    const cycle = 5000, hideFor = 2000;
    return ((now - stealthCycleStart) % cycle + cycle) % cycle < hideFor;
  }

  function animate(now){
    if(!fish.isConnected) return;
    const dt = Math.min(now - lastTime, 60) / 1000;
    lastTime = now;

    if(now >= encounterDeadline){
      spawnBossEscapeEffect(curLeft + half, curTop + half, bossType.escape);
      fish.remove();
      scheduleBoss();
      return;
    }

    const stealthed = isStealthedNow(now);
    fish.classList.toggle('stealthed', stealthed);
    if(bossType.stealth){
      fish.style.filter = (bossType.tint ? bossType.tint + ' ' : '') + (stealthed ? 'blur(1.5px) ' : '') + 'drop-shadow(0 3px 3px rgba(0,0,0,0.25))';
    }

    if(!stealthed && bossType.eats && now >= nextEatAt){
      const bx = curLeft + half, by = curTop + half;
      let prey = null, preyDist = Infinity;
      document.querySelectorAll('.fish:not(.boss-fish):not(.caught):not(.eaten)').forEach(f => {
        if(!f._center || !isEdible(f._type)) return;
        const c = f._center();
        const d = Math.hypot(c.x - bx, c.y - by);
        if(d <= catchRadius && d < preyDist){ prey = f; preyDist = d; }
      });
      if(prey){
        playEatEffect(prey, bx, by, bossType, fish);
        nextEatAt = now + bossType.eatCooldownMs;
      }
    }
    // 대왕게: 뿌리기 TRASH_WARN_MS 전에 예고하고, 예고가 끝난 뒤에만 뿌려요 (숨어 있는 동안은 미뤄요)
    if(!stealthed && bossType.throwsTrash && !warnedAt && now >= nextThrowAt - TRASH_WARN_MS){
      warnedAt = now;
      playTrashWarnEffect(fish, curLeft + half, curTop + half, bossType);
    }
    if(!stealthed && bossType.throwsTrash && warnedAt && now >= Math.max(nextThrowAt, warnedAt + TRASH_WARN_MS)){
      nextThrowAt = now + bossType.throwsTrash.everyMs;
      warnedAt = 0;
      const pos = { xRatio: curLeft / Game.view.w, yRatio: curTop / Game.view.h };
      playTrashThrowEffect(fish, curLeft + half, curTop + half);
      makeTrashThrows(pos, half, bossType.throwsTrash.count).forEach(spawnTrash);
    }

    if(!stealthed && now >= invulnerableUntil && isNearHook(curLeft + half, curTop + half, catchRadius)){
      hitsLanded++;
      if(hitsLanded >= hitsNeeded){
        catchBoss(fish, bossType);
        return;
      }
      // 아직 덜 잡혔어요: 연출을 내고 놀라서 최대한 먼 곳으로 도망가요
      spawnBossEscapeEffect(curLeft + half, curTop + half, bossType.escape);
      target = pickBossFleeTarget(curLeft, curTop, minX, maxX, minY, maxY);
      invulnerableUntil = now + 1500; // 1.5초간은 다시 안 맞아요

      if(bossType.knockback){
        // 고래: 물보라로 내 낚싯바늘을 확 밀쳐내요
        const kdx = Game.hook.x - (curLeft + half), kdy = Game.hook.y - (curTop + half);
        const kdist = Math.max(Math.hypot(kdx, kdy), 0.01);
        moveRod(Game.hook.x + (kdx / kdist) * 90, Game.hook.y + (kdy / kdist) * 90);
      }
      if(bossType.freeze){
        // 바다용: 감전돼서 낚싯줄이 1초간 얼어붙어요
        Game.effects.frozen = true;
        updateHookIcon();
        clearTimeout(Game.effects.freezeTimeout);
        Game.effects.freezeTimeout = setTimeout(() => { Game.effects.frozen = false; updateHookIcon(); }, 1000);
      }
      if(bossType.dash){
        // 상어는 맞고 도망갈 때도 곧장 돌진하듯 빠르게 빠져나가요
        dashUntil = now + 500;
      }
    }

    if(bossType.dash && now >= nextDashAt){
      dashUntil = now + 500;
      target = pickBossFleeTarget(curLeft, curTop, minX, maxX, minY, maxY);
      nextDashAt = now + 1800 + Math.random() * 1800;
    }
    if(bossType.jitter && now >= nextJitterPickAt){
      target = pickBossTarget(minX, maxX, minY, maxY);
      nextJitterPickAt = now + 250 + Math.random() * 220;
    }

    const dx = target.x - curLeft, dy = target.y - curTop;
    const dist = Math.hypot(dx, dy);
    if(dist < 20){
      target = pickBossTarget(minX, maxX, minY, maxY);
    } else if(!stealthed) {
      const dashBoost = (bossType.dash && now < dashUntil) ? 5.2 : 1;
      const step = speedPxPerSec * dashBoost * dt;
      curLeft += (dx / dist) * step;
      curTop += (dy / dist) * step;
      fish.style.transform = dx < 0 ? 'scaleX(1)' : 'scaleX(-1)';
    }
    fish.style.left = curLeft + 'px';
    fish.style.top = curTop + 'px';
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

function catchBoss(fish, bossType){
  if(!Game.state.running || !fish.isConnected) return;
  fish.classList.add('caught');
  setTimeout(() => fish.remove(), 350);
  Game.state.score += bossType.points;
  document.getElementById('score').textContent = Game.state.score;
  checkLevelUp();
  Game.state.caughtLog[bossType.name] = (Game.state.caughtLog[bossType.name] || 0) + 1;
  playCatchSound(bossType.points, false, false, false);

  const pop = document.createElement('div');
  pop.className = 'caughtPop';
  pop.textContent = bossType.emoji + ' ' + bossType.name + ' 처치! +' + bossType.points;
  pop.style.color = '#ffd166';
  pop.style.fontSize = '22px';
  pop.style.left = fish.style.left;
  pop.style.top = fish.style.top;
  Game.dom.scene.appendChild(pop);
  setTimeout(() => pop.remove(), 900);

  scheduleBoss();
}

function startGame(){
  ensureAudio();
  // 이전 판(특히 폭풍우/눈이 오던 도중 다시하기를 누른 경우)의 타이머가 남아있을 수 있으니
  // 새 판을 시작하기 전에 전부 확실히 정리해요
  clearInterval(Game.timers.spawnTimer); clearInterval(Game.timers.gameTimer);
  clearTimeout(Game.timers.rivalTimeout); clearTimeout(Game.timers.stormTimeout); clearTimeout(Game.timers.bossTimeout);
  clearTimeout(Game.effects.magnetTimer); clearTimeout(Game.effects.freezeTimeout);
  clearInterval(Game.timers.stormFlashInterval); Game.timers.stormFlashInterval = null;
  clearInterval(Game.timers.snowFlakeInterval); Game.timers.snowFlakeInterval = null;
  document.querySelectorAll('.snowflake').forEach(f => f.remove());

  Game.state.score = 0; Game.state.timeLeft = 60; Game.state.running = true;
  Game.state.currentLevel = 1;
  Game.state.treasureLoot = [];
  Game.state.playerName = document.getElementById('playerNameInput').value.trim();
  document.getElementById('score').textContent = Game.state.score;
  document.getElementById('timeLeft').textContent = Game.state.timeLeft;
  document.getElementById('level').textContent = Game.state.currentLevel;
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('endScreen').classList.add('hidden');
  document.getElementById('levelUpBanner').classList.remove('show');
  startBgMusic();
  setJoystickVisible(true);

  document.querySelectorAll('.fish').forEach(f=>f.remove());

  Game.timers.spawnTimer = setInterval(spawnFish, Game.config.levelStages[0].spawnMs);
  scheduleRival();
  Game.effects.magnetActive = false;
  Game.effects.frozen = false;
  updateHookIcon();
  Game.effects.stormActive = false;
  Game.effects.activeWeatherKind = null;
  document.getElementById('stormOverlay').classList.remove('active');
  document.getElementById('stormFog').classList.remove('active');
  document.getElementById('snowTint').classList.remove('active');
  scheduleWeather();
  scheduleBoss();
  Game.timers.gameTimer = setInterval(()=>{
    Game.state.timeLeft--;
    document.getElementById('timeLeft').textContent = Game.state.timeLeft;
    if(Game.state.timeLeft <= 0) endGame();
  }, 1000);
}

function endGame(){
  Game.state.running = false;
  setJoystickVisible(false);
  clearInterval(Game.timers.spawnTimer);
  clearInterval(Game.timers.gameTimer);
  clearTimeout(Game.timers.rivalTimeout);
  clearTimeout(Game.timers.stormTimeout);
  clearTimeout(Game.effects.magnetTimer);
  clearTimeout(Game.timers.bossTimeout);
  clearTimeout(Game.effects.freezeTimeout);
  clearInterval(Game.timers.stormFlashInterval); Game.timers.stormFlashInterval = null;
  clearInterval(Game.timers.snowFlakeInterval); Game.timers.snowFlakeInterval = null;
  Game.effects.magnetActive = false;
  Game.effects.frozen = false;
  Game.effects.stormActive = false;
  Game.effects.activeWeatherKind = null;
  document.getElementById('stormOverlay').classList.remove('active');
  document.getElementById('stormFog').classList.remove('active');
  document.getElementById('snowTint').classList.remove('active');
  document.getElementById('hook').textContent = '🪝';
  document.getElementById('rivalBoat').classList.remove('show');
  document.querySelectorAll('.fish').forEach(f=>f.remove());
  document.querySelectorAll('.snowflake').forEach(f=>f.remove());

  const isNewRecord = Game.state.score > Game.state.bestScore;
  if(isNewRecord) Game.state.bestScore = Game.state.score;
  stopBgMusic();
  playGameOverSound(isNewRecord);


  document.getElementById('resultScore').textContent = Game.state.score + '점';
  const msg = isNewRecord ? '🎉 신기록이에요! 최고점수를 경신했어요!'
            : Game.state.score >= 25 ? '와, 진짜 낚시왕이에요! 🏆'
            : Game.state.score >= 12 ? '아주 잘했어요! 👍'
            : '다음엔 더 잘할 수 있어요! 🐟';
  document.getElementById('resultMsg').textContent = msg;
  document.getElementById('lootResult').textContent = Game.state.treasureLoot.length > 0
    ? '📦 보물함 전리품: ' + Game.state.treasureLoot.join(', ')
    : '이번 판엔 보물통을 못 열었어요. 다음엔 찾아봐요!';
  document.getElementById('bestScoreEnd').textContent = '🏅 최고점수: ' + Game.state.bestScore + '점';
  document.getElementById('bestScoreStart').textContent = Game.state.bestScore > 0 ? ('🏅 최고점수: ' + Game.state.bestScore + '점') : '';
  document.getElementById('endScreen').classList.remove('hidden');
}

document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('retryBtn').addEventListener('click', startGame);

// 게임 중 어디서든 메인 메뉴로 빠져나갈 수 있는 버튼 (혼자하기/온라인 둘 다 동작)
document.getElementById('quitBtn').addEventListener('click', () => {
  if(Game.mp.active){
    if(confirm('정말 그만하고 메인 메뉴로 돌아갈까요?')) leaveMultiplayer();
  } else if(Game.state.running){
    if(confirm('정말 그만하고 메인 메뉴로 돌아갈까요?')) endGame();
  }
});

document.getElementById('mainMenuBtn').addEventListener('click', () => {
  document.getElementById('endScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
});
