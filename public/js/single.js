function getLevelForScore(s){
  for(const stage of levelStages){
    if(s < stage.upTo) return stage;
  }
  return levelStages[levelStages.length - 1]; // 100점 넘으면 3단계 유지(최고 난이도)
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
  if(!running) return;
  let spawnMs = levelStages[currentLevel - 1].spawnMs;
  if(activeWeatherKind === 'storm') spawnMs = Math.max(220, spawnMs * 0.55);
  else if(activeWeatherKind === 'snow') spawnMs = spawnMs * 1.25;
  clearInterval(spawnTimer);
  spawnTimer = setInterval(spawnFish, spawnMs);
}

function checkLevelUp(){
  const stage = getLevelForScore(score);
  if(stage.level !== currentLevel){
    currentLevel = stage.level;
    document.getElementById('level').textContent = currentLevel;

    // 물고기 스폰 속도를 새 단계(+현재 날씨)에 맞게 조정
    applyLevelSpawnRate();

    showBanner('🌟 ' + currentLevel + '단계! 🌟');
    playLevelUpSound();
  }
}

// 마우스를 따라 낚싯대/줄 움직이기
const rodPole = document.getElementById('rodPole');
const linePath = document.getElementById('linePath');
const hook = document.getElementById('hook');
const boat = document.getElementById('boat');

function updateHookIcon(){
  hook.textContent = frozen ? '🧊' : (magnetActive ? '🧲' : '🪝');
}

// 바늘의 현재 중심 좌표를 여기 저장해둬요. 물고기가 바늘에 닿았는지 확인할 때마다
// getBoundingClientRect()로 DOM을 다시 읽으면 브라우저가 강제로 레이아웃을 다시 계산해야
// 해서(reflow), 물고기가 많을수록 프레임마다 버벅이는 원인이 됐어요. 대신 우리가 이미
// 계산해서 알고 있는 이 좌표만 숫자로 비교해요.
let hookX = window.innerWidth / 2, hookY = 330;
// 배는 낚싯바늘을 곧장 따라가지 않고 뒤늦게 쫓아가요 (아래 updateBoatAndLine 루프가 매 프레임 당겨줘요)
let boatX = hookX;

function moveRod(x, y){
  if(frozen) return; // 얼어있는 동안엔 낚싯줄을 움직일 수 없어요
  const clampedX = Math.max(80, Math.min(window.innerWidth - 80, x));
  const clampedY = Math.max(110, Math.min(window.innerHeight - 110, y || 330));
  // 바늘(잡는 판정 기준)은 커서를 그대로 따라가야 정확하니 즉시 움직여요.
  // 배/낚싯줄의 "뒤늦게 따라오는" 연출은 updateBoatAndLine()이 따로 매 프레임 처리해요.
  hookX = clampedX; hookY = clampedY;
  hook.style.left = clampedX + 'px';
  hook.style.top = clampedY + 'px';

  // 폭풍우 안개의 중심을 낚싯바늘 위치로 맞춰요
  const fog = document.getElementById('stormFog');
  fog.style.setProperty('--fx', clampedX + 'px');
  fog.style.setProperty('--fy', clampedY + 'px');
}

// 배가 바늘 쪽으로 서서히 따라가고, 그 사이 낚싯줄은 팽팽하게 당겨지며 살짝 휘어요
function updateBoatAndLine(){
  boatX += (hookX - boatX) * 0.1;
  if(Math.abs(hookX - boatX) < 0.3) boatX = hookX;

  boat.style.left = boatX + 'px';
  rodPole.style.left = (boatX - 3) + 'px';

  const startX = boatX, startY = 70;
  const midX = (startX + hookX) / 2, midY = (startY + hookY) / 2;
  const bend = (hookX - boatX) * 0.3; // 배가 뒤처진 만큼 줄도 그만큼 뒤로 처져요
  const controlX = midX - bend, controlY = midY - 15;
  linePath.setAttribute('d', `M ${startX} ${startY} Q ${controlX} ${controlY} ${hookX} ${hookY}`);

  requestAnimationFrame(updateBoatAndLine);
}
requestAnimationFrame(updateBoatAndLine);

// 물고기 박스 크기의 절반(대략치) + 바늘이 닿았다고 쳐줄 반지름이에요
const FISH_HALF = gameConfig.hitbox.fishHalf, FISH_CATCH_RADIUS = gameConfig.hitbox.fishCatchRadius;
const BOSS_HALF = gameConfig.hitbox.bossHalf, BOSS_CATCH_RADIUS = gameConfig.hitbox.bossCatchRadius;

// 바늘이 (centerX, centerY)에 있는 물고기에 닿았는지, DOM을 안 읽고 숫자로만 확인해요
function isNearHook(centerX, centerY, catchRadius){
  const dx = centerX - hookX, dy = centerY - hookY;
  return (dx * dx + dy * dy) < catchRadius * catchRadius;
}

scene.addEventListener('mousemove', e => moveRod(e.clientX, e.clientY));
// 화면을 손가락으로 끌면 배가 그 자리로 순간이동하는 게 어색해서, 터치 기기는
// 대신 화면 아래 가상 조이스틱으로 배를 "조종"하게 해요 (아래 조이스틱 코드 참고)
scene.addEventListener('touchmove', e => e.preventDefault(), {passive:false});
moveRod(window.innerWidth/2, 330);

/* ------------------------------------------------------
   터치 기기용 가상 조이스틱: 화면 아래 왼쪽 원을 손가락으로 밀면
   그 방향으로 배가 계속 이동해요 (마우스는 그대로 커서를 따라가요)
------------------------------------------------------ */
const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const joystickBase = document.getElementById('joystickBase');
const joystickKnob = document.getElementById('joystickKnob');
let joyDX = 0, joyDY = 0; // -1~1로 정규화된 방향
let joyActive = false;
let joyTouchId = null;

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
      joyDX = 0; joyDY = 0;
      joystickKnob.style.transform = 'translate(0px, 0px)';
      return;
    }
    if(dist > maxKnobOffset){
      dx = (dx / dist) * maxKnobOffset;
      dy = (dy / dist) * maxKnobOffset;
    }
    joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    joyDX = dx / maxKnobOffset;
    joyDY = dy / maxKnobOffset;
  }

  function resetJoystick(){
    joyActive = false;
    joyTouchId = null;
    joyDX = 0; joyDY = 0;
    joystickKnob.style.transform = 'translate(0px, 0px)';
  }

  joystickBase.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    joyTouchId = t.identifier;
    joyActive = true;
    updateJoystick(t);
    e.preventDefault();
  }, { passive: false });

  joystickBase.addEventListener('touchmove', (e) => {
    if(!joyActive) return;
    const t = Array.from(e.changedTouches).find(t => t.identifier === joyTouchId);
    if(t) updateJoystick(t);
    e.preventDefault();
  }, { passive: false });

  joystickBase.addEventListener('touchend', (e) => {
    if(Array.from(e.changedTouches).some(t => t.identifier === joyTouchId)) resetJoystick();
  });
  joystickBase.addEventListener('touchcancel', resetJoystick);

  const JOYSTICK_SPEED = 420; // 조이스틱을 끝까지 밀었을 때 배가 움직이는 속도(초당 px)
  let lastSteerTime = null;

  function steerLoop(now){
    if(joyActive && (joyDX !== 0 || joyDY !== 0)){
      if(lastSteerTime !== null){
        const dt = Math.min((now - lastSteerTime) / 1000, 0.05);
        const curX = parseFloat(hook.style.left) || window.innerWidth / 2;
        const curY = parseFloat(hook.style.top) || 330;
        moveRod(curX + joyDX * JOYSTICK_SPEED * dt, curY + joyDY * JOYSTICK_SPEED * dt);
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
  const total = fishTypes.reduce((s,f)=>s+f.chance,0);
  let r = Math.random()*total;
  for(const f of fishTypes){
    if(r < f.chance) return f;
    r -= f.chance;
  }
  return fishTypes[0];
}

function spawnFish(){
  if(!running) return;
  const type = pickFishType();
  const fish = document.createElement('div');
  fish.className = 'fish';
  fish.textContent = type.emoji;
  fish.dataset.name = type.name;

  const fromLeft = Math.random() < 0.5;
  const y = 120 + Math.random() * (window.innerHeight - 260);
  fish.style.top = y + 'px';
  fish.style.left = (fromLeft ? -50 : window.innerWidth + 50) + 'px';
  // 물고기 이모지는 기본적으로 왼쪽을 보므로, 왼쪽에서 오른쪽으로 갈 때 뒤집어요.
  if(fromLeft) fish.style.transform = 'scaleX(-1)';
  scene.appendChild(fish);

  const distance = window.innerWidth + 100;
  const duration = distance / (type.speed * 40); // 초 단위 대략치
  const startTime = performance.now();
  // 물고기의 지금 위치를 우리가 직접 계산해서 알고 있으니, DOM에서 다시 읽지 않아요
  let curLeft = fromLeft ? -50 : window.innerWidth + 50;
  let curTop = y;

  function animate(now){
    if(!fish.isConnected) return;

    // 낚싯바늘이 물고기 몸에 닿으면 클릭/탭 없이도 바로 잡혀요
    if(isNearHook(curLeft + FISH_HALF, curTop + FISH_HALF, FISH_CATCH_RADIUS)){
      catchFish(fish, type);
      return;
    }

    // 자석이 켜져 있으면 물고기가 낚싯바늘 쪽으로 저절로 끌려와요
    // (curLeft/curTop은 물고기의 왼쪽위 모서리라, 목표점도 FISH_HALF만큼 당겨줘야
    // 물고기의 "중심"이 바늘 중심에 겹쳐요. 안 그러면 중심끼리 대각선으로 어긋나서
    // isNearHook 판정 반경(42px) 밖에서 맴돌다가 못 잡히고 사라져버려요)
    if(magnetActive && !type.isMagnet){
      const dx = (hookX - FISH_HALF) - curLeft, dy = (hookY - FISH_HALF) - curTop;
      const dist = Math.max(Math.sqrt(dx*dx + dy*dy), 0.01);
      const step = 6;
      curLeft += (dx/dist) * step;
      curTop += (dy/dist) * step;
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
      : (window.innerWidth + 50) - progress * distance;
    fish.style.left = curLeft + 'px';
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

function catchFish(fish, type){
  if(!running || !fish.isConnected) return;

  // 보물통은 잡을 때마다 랜덤 보너스 점수 + 랜덤 보물 아이템을 줘요
  let earnedPoints = type.points;
  let lootName = '';
  if(type.isTreasure){
    earnedPoints = Math.floor(Math.random() * (type.maxBonus - type.minBonus + 1)) + type.minBonus;
    lootName = lootItems[Math.floor(Math.random() * lootItems.length)];
    treasureLoot.push(lootName);
  }

  // 자석: 잠깐동안 물고기들이 낚싯바늘로 저절로 끌려와요
  if(type.isMagnet){
    magnetActive = true;
    updateHookIcon();
    clearTimeout(magnetTimer);
    magnetTimer = setTimeout(() => {
      magnetActive = false;
      updateHookIcon();
    }, type.magnetMs);
  }

  // 시계: 시간이 늘어나요
  if(type.isTimeBonus){
    timeLeft += type.timeBonus;
    document.getElementById('timeLeft').textContent = timeLeft;
  }

  score += earnedPoints;
  if(score < 0) score = 0;
  document.getElementById('score').textContent = score;
  checkLevelUp();
  caughtLog[type.name]++;
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
  scene.appendChild(pop);
  setTimeout(()=>pop.remove(), 700);

  fish.classList.add('caught');
  setTimeout(() => fish.remove(), 350);
}

function scheduleRival(){
  if(!running) return;
  const delay = 6000 + Math.random() * 6000; // 6~12초마다 랜덤하게 등장
  rivalTimeout = setTimeout(tryStealFish, delay);
}

function tryStealFish(){
  if(!running) return;
  // 보스는 친구들(여기선 나)이 직접 잡거나 도망가게 두고, 해적은 노리지 않아요 (멀티플레이와 동일)
  // 그렇지 않으면 해적이 보스를 통째로 훔쳐가버려서, 잡는 도중 사라지고
  // 다음 보스도 다시는 안 나오는 문제가 생겨요
  const fishes = Array.from(document.querySelectorAll('.fish')).filter(f => !f.classList.contains('boss-fish'));
  if(fishes.length === 0){ scheduleRival(); return; }

  // 보물통이 화면에 있으면 그것부터 노려요!
  const treasures = fishes.filter(f => f.dataset.name === '보물통');
  const pool = treasures.length > 0 ? treasures : fishes;
  const target = pool[Math.floor(Math.random() * pool.length)];
  const targetX = Math.max(80, Math.min(window.innerWidth - 80, parseFloat(target.style.left) || window.innerWidth/2));

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
      scene.appendChild(steal);
      setTimeout(() => steal.remove(), 900);
      setTimeout(() => target.remove(), 300);
    }
    setTimeout(() => rival.classList.remove('show'), 500);
  }, 700);

  scheduleRival();
}



function scheduleWeather(){
  if(!running) return;
  const delay = 18000 + Math.random() * 15000; // 18~33초마다 랜덤하게 날씨 이벤트
  stormTimeout = setTimeout(triggerWeatherEvent, delay);
}

function triggerWeatherEvent(){
  if(!running) return;
  if(Math.random() < 0.5) triggerStorm();
  else triggerSnow();
}

function triggerSnow(){
  if(!running) return;
  activeWeatherKind = 'snow';
  document.getElementById('snowTint').classList.add('active');
  showBanner('❄️ 눈이 내려요! 낚싯줄이 얼었어요 🥶');

  // 눈이 내리기 시작하면 5초 동안 낚싯줄이 얼어서 움직일 수 없어요
  frozen = true;
  updateHookIcon();
  clearTimeout(freezeTimeout);
  freezeTimeout = setTimeout(() => {
    frozen = false;
    updateHookIcon();
  }, 5000);

  // 눈 오는 동안은 조금 더 느긋하게
  applyLevelSpawnRate();

  clearInterval(snowFlakeInterval);
  snowFlakeInterval = setInterval(() => {
    const flake = document.createElement('div');
    flake.className = 'snowflake';
    flake.textContent = '❄️';
    flake.style.left = Math.random() * 100 + '%';
    flake.style.fontSize = (10 + Math.random() * 14) + 'px';
    flake.style.animationDuration = (4 + Math.random() * 3) + 's';
    scene.appendChild(flake);
    setTimeout(() => flake.remove(), 8000);
  }, 220);

  const duration = 7000 + Math.random() * 3000;
  setTimeout(() => {
    clearInterval(snowFlakeInterval); snowFlakeInterval = null;
    document.getElementById('snowTint').classList.remove('active');
    showBanner('☀️ 눈이 그쳤어요!');
    activeWeatherKind = null;
    applyLevelSpawnRate();
    scheduleWeather();
  }, duration);
}

function triggerStorm(){
  if(!running) return;
  stormActive = true;
  activeWeatherKind = 'storm';
  document.getElementById('stormOverlay').classList.add('active');
  document.getElementById('stormFog').classList.add('active');
  showBanner('⛈️ 폭풍우가 몰아쳐요!');
  playThunderSound();

  // 폭풍우 동안 물고기가 더 빨리, 자주 나와요
  applyLevelSpawnRate();

  // 가끔 번개가 번쩍여요
  clearInterval(stormFlashInterval);
  stormFlashInterval = setInterval(() => {
    const flash = document.getElementById('lightningFlash');
    flash.classList.remove('flash');
    void flash.offsetWidth;
    flash.classList.add('flash');
    playThunderSound();
  }, 1800 + Math.random() * 1200);

  const stormDuration = 6000 + Math.random() * 3000;
  setTimeout(() => {
    clearInterval(stormFlashInterval); stormFlashInterval = null;
    stormActive = false;
    document.getElementById('stormOverlay').classList.remove('active');
    document.getElementById('stormFog').classList.remove('active');
    showBanner('🌤️ 폭풍우가 지나갔어요!');
    activeWeatherKind = null;
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
  scene.appendChild(cloud);
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
    scene.appendChild(blob);
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
  if(!running) return;
  const delay = 22000 + Math.random() * 15000; // 22~37초마다 랜덤하게 보스 등장
  bossTimeout = setTimeout(spawnBoss, delay);
}

function spawnBoss(){
  if(!running) return;
  const bossType = bossTypes[Math.floor(Math.random() * bossTypes.length)];
  const half = bossType.half, catchRadius = bossType.catchRadius;
  showBanner(bossType.emoji + ' ' + bossType.name + ' 출현!');
  playBossSound();

  const fromLeft = Math.random() < 0.5;
  const startY = 150 + Math.random() * (window.innerHeight - 320);
  const fish = document.createElement('div');
  fish.className = 'fish boss-fish';
  fish.textContent = bossType.emoji;
  fish.dataset.name = bossType.name;
  fish.style.top = startY + 'px';
  fish.style.left = (fromLeft ? -100 : window.innerWidth + 100) + 'px';
  fish.style.fontSize = '86px';
  if(bossType.tint) fish.style.filter = bossType.tint + ' drop-shadow(0 3px 3px rgba(0,0,0,0.25))';
  scene.appendChild(fish);

  let curLeft = fromLeft ? -100 : window.innerWidth + 100;
  let curTop = startY;

  // 몇 번 낚싯바늘에 스칠 때까지는 안 잡히고, 스칠 때마다 도망가요 (보스마다 필요 횟수가 달라요)
  const hitsNeeded = bossType.hitsMin + Math.floor(Math.random() * (bossType.hitsMax - bossType.hitsMin + 1));
  let hitsLanded = 0;
  let invulnerableUntil = 0;

  const minX = -80, maxX = window.innerWidth + 80;
  const minY = 130, maxY = window.innerHeight - 160;
  // 처음에는 화면 안쪽으로 헤엄쳐 들어와요
  let target = { x: window.innerWidth * (0.3 + Math.random() * 0.4), y: startY };

  const speedPxPerSec = 90 * (bossType.speedMul || 1) * 1.25; // 보스는 일반 물고기보다 빠르게 움직여요
  const encounterDeadline = performance.now() + 28000; // 28초 안에 다 못 잡으면 완전히 도망가요
  let lastTime = performance.now();

  // 상어: 가끔 순간적으로 멀리 돌진해요 / 바다용: 방향을 자주 바꿔서 불규칙하게 움직여요
  let dashUntil = 0;
  let nextDashAt = lastTime + 1500 + Math.random() * 2000;
  let nextJitterPickAt = lastTime;
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
        const kdx = hookX - (curLeft + half), kdy = hookY - (curTop + half);
        const kdist = Math.max(Math.hypot(kdx, kdy), 0.01);
        moveRod(hookX + (kdx / kdist) * 90, hookY + (kdy / kdist) * 90);
      }
      if(bossType.freeze){
        // 바다용: 감전돼서 낚싯줄이 1초간 얼어붙어요
        frozen = true;
        updateHookIcon();
        clearTimeout(freezeTimeout);
        freezeTimeout = setTimeout(() => { frozen = false; updateHookIcon(); }, 1000);
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
  if(!running || !fish.isConnected) return;
  fish.classList.add('caught');
  setTimeout(() => fish.remove(), 350);
  score += bossType.points;
  document.getElementById('score').textContent = score;
  checkLevelUp();
  caughtLog[bossType.name] = (caughtLog[bossType.name] || 0) + 1;
  playCatchSound(bossType.points, false, false, false);

  const pop = document.createElement('div');
  pop.className = 'caughtPop';
  pop.textContent = bossType.emoji + ' ' + bossType.name + ' 처치! +' + bossType.points;
  pop.style.color = '#ffd166';
  pop.style.fontSize = '22px';
  pop.style.left = fish.style.left;
  pop.style.top = fish.style.top;
  scene.appendChild(pop);
  setTimeout(() => pop.remove(), 900);

  scheduleBoss();
}

function startGame(){
  ensureAudio();
  // 이전 판(특히 폭풍우/눈이 오던 도중 다시하기를 누른 경우)의 타이머가 남아있을 수 있으니
  // 새 판을 시작하기 전에 전부 확실히 정리해요
  clearInterval(spawnTimer); clearInterval(gameTimer);
  clearTimeout(rivalTimeout); clearTimeout(stormTimeout); clearTimeout(bossTimeout);
  clearTimeout(magnetTimer); clearTimeout(freezeTimeout);
  clearInterval(stormFlashInterval); stormFlashInterval = null;
  clearInterval(snowFlakeInterval); snowFlakeInterval = null;
  document.querySelectorAll('.snowflake').forEach(f => f.remove());

  score = 0; timeLeft = 60; running = true;
  currentLevel = 1;
  treasureLoot = [];
  playerName = document.getElementById('playerNameInput').value.trim();
  document.getElementById('score').textContent = score;
  document.getElementById('timeLeft').textContent = timeLeft;
  document.getElementById('level').textContent = currentLevel;
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('endScreen').classList.add('hidden');
  document.getElementById('levelUpBanner').classList.remove('show');
  startBgMusic();
  setJoystickVisible(true);

  document.querySelectorAll('.fish').forEach(f=>f.remove());

  spawnTimer = setInterval(spawnFish, levelStages[0].spawnMs);
  scheduleRival();
  magnetActive = false;
  frozen = false;
  updateHookIcon();
  stormActive = false;
  activeWeatherKind = null;
  document.getElementById('stormOverlay').classList.remove('active');
  document.getElementById('stormFog').classList.remove('active');
  document.getElementById('snowTint').classList.remove('active');
  scheduleWeather();
  scheduleBoss();
  gameTimer = setInterval(()=>{
    timeLeft--;
    document.getElementById('timeLeft').textContent = timeLeft;
    if(timeLeft <= 0) endGame();
  }, 1000);
}

function endGame(){
  running = false;
  setJoystickVisible(false);
  clearInterval(spawnTimer);
  clearInterval(gameTimer);
  clearTimeout(rivalTimeout);
  clearTimeout(stormTimeout);
  clearTimeout(magnetTimer);
  clearTimeout(bossTimeout);
  clearTimeout(freezeTimeout);
  clearInterval(stormFlashInterval); stormFlashInterval = null;
  clearInterval(snowFlakeInterval); snowFlakeInterval = null;
  magnetActive = false;
  frozen = false;
  stormActive = false;
  activeWeatherKind = null;
  document.getElementById('stormOverlay').classList.remove('active');
  document.getElementById('stormFog').classList.remove('active');
  document.getElementById('snowTint').classList.remove('active');
  document.getElementById('hook').textContent = '🪝';
  document.getElementById('rivalBoat').classList.remove('show');
  document.querySelectorAll('.fish').forEach(f=>f.remove());
  document.querySelectorAll('.snowflake').forEach(f=>f.remove());

  const isNewRecord = score > bestScore;
  if(isNewRecord) bestScore = score;
  stopBgMusic();
  playGameOverSound(isNewRecord);


  document.getElementById('resultScore').textContent = score + '점';
  const msg = isNewRecord ? '🎉 신기록이에요! 최고점수를 경신했어요!'
            : score >= 25 ? '와, 진짜 낚시왕이에요! 🏆'
            : score >= 12 ? '아주 잘했어요! 👍'
            : '다음엔 더 잘할 수 있어요! 🐟';
  document.getElementById('resultMsg').textContent = msg;
  document.getElementById('lootResult').textContent = treasureLoot.length > 0
    ? '📦 보물함 전리품: ' + treasureLoot.join(', ')
    : '이번 판엔 보물통을 못 열었어요. 다음엔 찾아봐요!';
  document.getElementById('bestScoreEnd').textContent = '🏅 최고점수: ' + bestScore + '점';
  document.getElementById('bestScoreStart').textContent = bestScore > 0 ? ('🏅 최고점수: ' + bestScore + '점') : '';
  document.getElementById('endScreen').classList.remove('hidden');
}

document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('retryBtn').addEventListener('click', startGame);

// 게임 중 어디서든 메인 메뉴로 빠져나갈 수 있는 버튼 (혼자하기/온라인 둘 다 동작)
document.getElementById('quitBtn').addEventListener('click', () => {
  if(mpActive){
    if(confirm('정말 그만하고 메인 메뉴로 돌아갈까요?')) leaveMultiplayer();
  } else if(running){
    if(confirm('정말 그만하고 메인 메뉴로 돌아갈까요?')) endGame();
  }
});

document.getElementById('mainMenuBtn').addEventListener('click', () => {
  document.getElementById('endScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
});
