/* ------------------------------------------------------
   온라인 같이하기: 부모님이 배포한 서버에 접속해서
   실시간으로 같은 물고기를 보고 서로 먼저 잡기 경쟁을 해요
------------------------------------------------------ */
// 이 게임은 항상 지금 이 페이지를 보여준 서버로 온라인 접속을 해요
// (부모님이 어디에 배포하든, 그 서버 주소를 따로 입력할 필요가 없어요)
function getMpServerUrl(){
  return window.location.protocol === 'file:' ? '' : window.location.origin;
}

function loadSocketIoScript(callback){
  if(window.io){ callback(); return; }
  const script = document.createElement('script');
  // socket.io 클라이언트 라이브러리는 접속할 서버에서 직접 제공해줘요
  script.src = getMpServerUrl() + '/socket.io/socket.io.js';
  script.onload = callback;
  script.onerror = () => {
    document.getElementById('mpStatus').textContent = '서버에 연결할 수 없어요.';
  };
  document.head.appendChild(script);
}

function joinMultiplayer(roomCodeOverride){
  if(mpConnecting) return; // 입장하기를 여러 번 눌러도 소켓이 중복 생성되지 않게 해요
  const url = getMpServerUrl();
  const roomCode = (roomCodeOverride || document.getElementById('mpRoomCode').value.trim() || 'default');
  // 서버도 이름을 12글자로 잘라서 저장하니, 우리도 똑같이 잘라야
  // 화면에 보이는 이름이 서버가 broadcast하는 이름과 어긋나지 않아요
  const name = (document.getElementById('playerNameInput').value.trim() || randomName()).slice(0, 12);
  playerName = name; // 싱글플레이를 안 거치고 바로 온라인으로 들어와도 화면에 내 이름이 정확히 보이게 해줘요

  if(!url){
    document.getElementById('mpStatus').textContent = '파일로 직접 열면 온라인 기능을 쓸 수 없어요. 서버 주소로 접속해주세요.';
    return;
  }

  if(mpSocket){ mpSocket.disconnect(); mpSocket = null; } // 이전에 연결됐던 소켓이 남아있으면 정리하고 새로 시작해요
  mpConnecting = true;
  document.getElementById('mpStatus').textContent = '연결하는 중...';

  loadSocketIoScript(() => {
    ensureAudio();
    mpSocket = window.io(url);

    mpSocket.on('connect', () => {
      mpSocket.emit('joinRoom', { roomCode, name });
      // 화면 전환은 서버가 입장을 실제로 받아준 뒤(roomState 수신 시)에 해요
    });

    mpSocket.on('connect_error', () => {
      mpConnecting = false;
      document.getElementById('mpStatus').textContent = '연결에 실패했어요. 잠시 후 다시 시도해주세요.';
    });

    mpSocket.on('joinError', ({ message }) => {
      mpConnecting = false;
      document.getElementById('mpStatus').textContent = message || '지금은 입장할 수 없어요.';
      if(mpSocket){ mpSocket.disconnect(); mpSocket = null; }
    });

    mpSocket.on('roomState', (state) => {
      mpConnecting = false;
      if(!mpActive) startMultiplayerMode(); // 방 입장이 확정된 시점에만 화면을 전환해요
      document.querySelectorAll('.fish').forEach(f => f.remove());
      mpFishEls = {}; mpFishTypeById = {}; mpCaughtSent = {}; mpBossInvulnUntil = {}; mpBossSeedById = {};
      stopMpWeather();
      if (state.activeWeather) startMpWeather(state.activeWeather);
      if(state.code) document.getElementById('mpRoomCodeDisplay').textContent = '방 코드: ' + state.code;
      Object.values(state.fish).forEach(spawnMpFish);
      renderMpPlayerList(state.players);
      if(typeof state.timeLeft === 'number') updateMpTime(state.timeLeft);
      if(typeof state.level === 'number') updateMpLevel(state.level);
      document.getElementById('mpRoundEndScreen').classList.toggle('hidden', !!state.started);
      setJoystickVisible(!!state.started);
      if (!state.started) {
        renderMpRoundEndRanking(state.players);
        startMpRoundEndCountdown(Math.ceil(state.resetRemainingMs / 1000));
      } else clearInterval(mpRoundEndCountdownTimer);
      sendBoatPosition();
    });

    mpSocket.on('disconnect', () => {
      if (mpActive) document.getElementById('mpStatus').textContent = '연결이 끊겼어요. 다시 연결하는 중...';
    });
    mpSocket.on('catchRejected', ({ fishId }) => {
      clearTimeout(mpCatchResetTimers[fishId]); delete mpCatchResetTimers[fishId];
      mpCaughtSent[fishId] = false;
    });

    mpSocket.on('fishSpawn', (data) => {
      spawnMpFish(data);
      if(data.type.isBoss){
        showBanner(data.type.emoji + ' ' + data.type.name + ' 출현!');
        playBossSound();
      }
    });

    mpSocket.on('fishExpire', ({ id }) => {
      const el = mpFishEls[id];
      if(el){
        // 보스가 끝내 못 잡히고 도망가는 경우, 마지막으로 도망 연출을 내고 사라져요
        const bossType = mpFishTypeById[id];
        if(bossType && bossType.isBoss){
          const left = parseFloat(el.style.left) || 0;
          const top = parseFloat(el.style.top) || 0;
          spawnBossEscapeEffect(left + (bossType.half || BOSS_HALF), top + (bossType.half || BOSS_HALF), bossType.escape);
        }
        el.remove();
        delete mpFishEls[id];
      }
      delete mpFishTypeById[id];
      delete mpCaughtSent[id];
      clearTimeout(mpCatchResetTimers[id]); delete mpCatchResetTimers[id];
      delete mpBossInvulnUntil[id];
      delete mpBossSeedById[id];
      delete mpBossSeedTransitionById[id];
      clearTimeout(mpCatchResetTimers[id]); delete mpCatchResetTimers[id];
    });

    mpSocket.on('bossInked', ({ id, seed, byId }) => {
      // 보스가 맞긴 했지만 아직 다 안 잡혀서, 도망 연출을 내요 (물고기는 그대로 살아있어요)
      const el = mpFishEls[id];
      const bossType = mpFishTypeById[id];
      if(el){
        const left = parseFloat(el.style.left) || 0;
        const top = parseFloat(el.style.top) || 0;
        spawnBossEscapeEffect(left + (bossType ? (bossType.half || BOSS_HALF) : BOSS_HALF), top + (bossType ? (bossType.half || BOSS_HALF) : BOSS_HALF), bossType ? bossType.escape : 'ink');

        // 나를 맞춘 경우에만: 고래는 내 낚싯바늘을 밀쳐내고, 바다용은 내 낚싯줄을 얼려요
        const isMe = mpSocket && byId === mpSocket.id;
        if(isMe && bossType){
          if(bossType.knockback){
            const half = bossType.half || BOSS_HALF;
            const kdx = hookX - (left + half), kdy = hookY - (top + half);
            const kdist = Math.max(Math.hypot(kdx, kdy), 0.01);
            moveRod(hookX + (kdx / kdist) * 90, hookY + (kdy / kdist) * 90);
          }
          if(bossType.freeze){
            frozen = true;
            updateHookIcon();
            clearTimeout(freezeTimeout);
            freezeTimeout = setTimeout(() => { frozen = false; updateHookIcon(); }, 1000);
          }
        }
      }
      if (typeof seed === 'number') {
        mpBossSeedTransitionById[id] = { from: mpBossSeedById[id], to: seed, started: performance.now() };
        mpBossSeedById[id] = seed;
      }
      clearTimeout(mpCatchResetTimers[id]); delete mpCatchResetTimers[id];
      mpCaughtSent[id] = false; // 다시 낚싯바늘로 노려볼 수 있게 풀어줘요
      mpBossInvulnUntil[id] = performance.now() + 1500; // 1.5초간은 무적: 한 번 지나간 걸로 여러 번 잡히지 않게 해요
    });

    mpSocket.on('timeUpdate', ({ timeLeft }) => updateMpTime(timeLeft));

    mpSocket.on('levelUp', ({ level }) => {
      updateMpLevel(level);
      showBanner('🌟 ' + level + '단계! 🌟');
      playLevelUpSound();
    });

    mpSocket.on('roundReset', ({ players, timeLeft, level }) => {
      clearInterval(mpRoundEndCountdownTimer);
      magnetActive = false; clearTimeout(magnetTimer); updateHookIcon();
      document.getElementById('mpRoundEndScreen').classList.add('hidden');
      setJoystickVisible(true);
      renderMpPlayerList(players);
      updateMpTime(timeLeft);
      updateMpLevel(level || 1);
      document.querySelectorAll('.fish').forEach(f => f.remove());
      mpFishEls = {};
      mpFishTypeById = {};
      mpCaughtSent = {};
      mpBossInvulnUntil = {}; mpBossSeedById = {};
      stopMpWeather();
      showBanner('🎣 새 라운드 시작!');
    });

    mpSocket.on('roundEnded', ({ players }) => {
      renderMpPlayerList(players);
      stopMpWeather();
      setJoystickVisible(false); // 라운드 결과를 보는 동안엔 조종할 게 없으니 숨겨요
      const me = players[mpSocket.id];
      const isNewRecord = !!me && me.score > bestScore;
      if(me){
        if(isNewRecord) bestScore = me.score;
        document.getElementById('bestScoreStart').textContent = bestScore > 0 ? ('🏅 최고점수: ' + bestScore + '점') : '';
        document.getElementById('bestScoreEnd').textContent = '🏅 최고점수: ' + bestScore + '점';
      }
      playGameOverSound(isNewRecord);

      // 싱글플레이처럼 점수만 반짝 보이고 사라지는 대신, 방 친구들 순위와
      // 다음 라운드까지 남은 시간을 화면 가득 보여줘서 "뭐가 어떻게 된 건지" 알 수 있게 해요
      renderMpRoundEndRanking(players);
      document.getElementById('mpRoundEndScreen').classList.remove('hidden');
      startMpRoundEndCountdown(6); // 서버의 RESET_DELAY_MS(6초)와 맞춰뒀어요
    });

    mpSocket.on('weatherEvent', ({ kind, durationMs }) => {
      if(kind === 'stormEnd' || kind === 'snowEnd') stopMpWeather(kind.replace('End',''));
      else startMpWeather(kind);
    });

    mpSocket.on('fishStolen', ({ id, name }) => {
      const el = mpFishEls[id];
      if(!el) return;
      const targetX = Math.max(80, Math.min(window.innerWidth - 80, parseFloat(el.style.left) || window.innerWidth/2));
      const rival = document.getElementById('rivalBoat');
      rival.style.left = targetX + 'px';
      rival.classList.add('show');

      setTimeout(() => {
        if(el.isConnected){
          playStealSound();
          el.style.transition = 'transform .3s ease, opacity .3s ease';
          el.style.transform = (el.style.transform || '') + ' scale(0.3)';
          el.style.opacity = '0';

          const steal = document.createElement('div');
          steal.className = 'caughtPop';
          steal.textContent = name === '보물통'
            ? '🏴‍☠️ 해적이 보물통을 가져갔어요!'
            : '🏴‍☠️ 다른 배가 채갔어요!';
          steal.style.color = '#ff9b9b';
          steal.style.fontSize = '16px';
          steal.style.left = el.style.left;
          steal.style.top = el.style.top;
          scene.appendChild(steal);
          setTimeout(() => steal.remove(), 900);
          setTimeout(() => { el.remove(); delete mpFishEls[id]; }, 300);
        }
        setTimeout(() => rival.classList.remove('show'), 500);
      }, 700);
    });

    mpSocket.on('fishCaught', (info) => {
      const { fishId, by, byId, name, points, emoji, isTreasure, isMagnet, isTimeBonus, isBoss, label, lootName } = info;
      clearTimeout(mpCatchResetTimers[fishId]); delete mpCatchResetTimers[fishId];
      const el = mpFishEls[fishId];
      // 이름은 친구랑 겹칠 수 있어서(둘 다 "친구"로 들어오는 등) 서버가 보내주는
      // 내 socket.id(byId)로 정확히 "내가 잡았는지"를 판정해요
      const isMe = mpSocket && byId === mpSocket.id;

      if(isMe){
        playCatchSound(points, isTreasure, isMagnet, isTimeBonus);
        if(name) caughtLog[name] = (caughtLog[name] || 0) + 1; // 📖 도감에도 기록해요
        if(isTreasure) treasureLoot.push(lootName || '보물');
        if(isMagnet){
          magnetActive = true;
          updateHookIcon();
          clearTimeout(magnetTimer);
          magnetTimer = setTimeout(() => { magnetActive = false; updateHookIcon(); }, 6000);
        }
      }

      if(el){
        const popText = document.createElement('div');
        popText.className = 'caughtPop';
        if(isBoss){
          popText.textContent = emoji + ' ' + by + ' ' + name + ' 처치! +' + points;
          popText.style.color = '#ffd166'; popText.style.fontSize = '20px';
        } else if(isTreasure){
          popText.textContent = '🎁 ' + by + ' ' + (lootName || '보물') + '! +' + points;
          popText.style.color = '#ffe066';
        } else if(isMagnet){
          popText.textContent = '🧲 ' + by + ' 자석 발동!';
          popText.style.color = '#a0e6ff';
        } else if(isTimeBonus){
          popText.textContent = '⏰ ' + by + ' 시간 +5초!';
          popText.style.color = '#b6ffb0';
        } else if(points === 0){
          popText.textContent = by + ' ' + (label || '꽝!');
          popText.style.color = '#d8d8d8';
        } else {
          popText.textContent = emoji + ' ' + by + ' ' + (points >= 0 ? '+' : '') + points;
          popText.style.color = points >= 0 ? '#fff' : '#ffb3b3';
        }
        popText.style.left = el.style.left;
        popText.style.top = el.style.top;
        scene.appendChild(popText);
        setTimeout(() => popText.remove(), 800);

        el.classList.add('caught');
        // 잡히는 애니메이션이 재생되는 동안(350ms)에도 el은 아직 DOM에 남아있어서
        // animate() 루프가 계속 돌아요. 그새 mpCaughtSent를 풀어버리면 이미 사라진
        // 물고기에 대해 catchAttempt를 한 번 더 헛되이 보낼 수 있으니, 완전히 사라진
        // 뒤에 정리해요.
        setTimeout(() => {
          el.remove();
          delete mpCaughtSent[fishId];
          delete mpBossInvulnUntil[fishId];
          delete mpFishTypeById[fishId];
          delete mpBossSeedById[fishId];
          delete mpBossSeedTransitionById[fishId];
        }, 350);
        delete mpFishEls[fishId];
      } else {
        delete mpCaughtSent[fishId];
        delete mpBossInvulnUntil[fishId];
      delete mpFishTypeById[fishId];
      delete mpBossSeedById[fishId];
      delete mpBossSeedTransitionById[fishId];
      }
    });

    mpSocket.on('playerListUpdate', renderMpPlayerList);

    mpSocket.on('boatMove', ({ id, xRatio, yRatio }) => {
      const el = mpGhostBoats[id];
      if(!el) return;
      el.style.left = (xRatio * window.innerWidth) + 'px';
      // 낚싯줄/바늘 위치도 같이 갱신해요 (#line/#hook과 같은 기준: 낚싯줄은 70px 높이에서 시작해요)
      if(typeof yRatio === 'number'){
        const y = yRatio * window.innerHeight;
        const ghostLine = el.querySelector('.ghostLine');
        const ghostHook = el.querySelector('.ghostHook');
        ghostLine.style.height = Math.max(0, y - 70) + 'px';
        ghostHook.style.top = (y - 46) + 'px';
      }
    });
  });
}

let mpFlashInterval = null;
let mpSnowInterval = null;

function startMpWeather(kind){
  if(kind === 'storm'){
    stormActive = true;
    document.getElementById('stormOverlay').classList.add('active');
    document.getElementById('stormFog').classList.add('active');
    showBanner('⛈️ 폭풍우가 몰아쳐요!');
    playThunderSound();
    clearInterval(mpFlashInterval);
    mpFlashInterval = setInterval(() => {
      const flash = document.getElementById('lightningFlash');
      flash.classList.remove('flash');
      void flash.offsetWidth;
      flash.classList.add('flash');
      playThunderSound();
    }, 1800 + Math.random() * 1200);
  } else if(kind === 'snow'){
    document.getElementById('snowTint').classList.add('active');
    showBanner('❄️ 눈이 내려요! 낚싯줄이 얼었어요 🥶');
    frozen = true;
    updateHookIcon();
    clearTimeout(freezeTimeout);
    freezeTimeout = setTimeout(() => { frozen = false; updateHookIcon(); }, 5000);
    clearInterval(mpSnowInterval);
    mpSnowInterval = setInterval(() => {
      const flake = document.createElement('div');
      flake.className = 'snowflake';
      flake.textContent = '❄️';
      flake.style.left = Math.random() * 100 + '%';
      flake.style.fontSize = (10 + Math.random() * 14) + 'px';
      flake.style.animationDuration = (4 + Math.random() * 3) + 's';
      scene.appendChild(flake);
      setTimeout(() => flake.remove(), 8000);
    }, 220);
  }
}

function stopMpWeather(kind){
  clearInterval(mpFlashInterval); mpFlashInterval = null;
  clearInterval(mpSnowInterval); mpSnowInterval = null;
  stormActive = false;
  frozen = false;
  clearTimeout(freezeTimeout);
  updateHookIcon();
  document.getElementById('stormOverlay').classList.remove('active');
  document.getElementById('stormFog').classList.remove('active');
  document.getElementById('snowTint').classList.remove('active');
  if(kind === 'storm') showBanner('🌤️ 폭풍우가 지나갔어요!');
  else if(kind === 'snow') showBanner('☀️ 눈이 그쳤어요!');
}

function updateMpLevel(level){
  currentLevel = level;
  document.getElementById('level').textContent = currentLevel;
}

function updateMpTime(t){
  timeLeft = t;
  document.getElementById('timeLeft').textContent = timeLeft;
}

// 보스가 화면을 이리저리 누비는 경로를 "흐른 시간"만의 함수로 계산해요.
// (프레임마다 조금씩 움직이는 방식이 아니라 절대 시간 기준으로 계산해서,
// 친구마다 프레임 속도가 달라도 다들 거의 같은 위치에 보스가 보여요)
function bossWanderPosition(seed, elapsedSec, type){
  const speedMul = ((type && type.speedMul) || 1) * 1.25;
  const jitterBoost = (type && type.jitter) ? 2.75 : 1;
  const fx = (0.16 + seed * 0.12) * speedMul * jitterBoost;
  const fy = (0.11 + (1 - seed) * 0.09) * speedMul * jitterBoost;
  const px = seed * Math.PI * 2;
  const py = (1 - seed) * Math.PI * 2;
  let xRatio = 0.5 + 0.42 * Math.sin(fx * elapsedSec + px) * Math.cos(0.29 * elapsedSec * speedMul + py);
  const yRatio = 0.5 + 0.33 * Math.sin(fy * elapsedSec + py);

  if(type && type.dash){
    // 상어: 주기적으로 순간 돌진하는 느낌을 "시간만의 함수"로 표현해요(모든 클라이언트가 똑같이 보도록)
    const cyclePos = ((elapsedSec * 0.34 + seed * 3) % 1 + 1) % 1;
    if(cyclePos > 0.78){
      const burstT = (cyclePos - 0.78) / 0.22;
      const dashDir = Math.sin(fx * elapsedSec + px) >= 0 ? 1 : -1;
      xRatio = 0.5 + 0.46 * dashDir * Math.min(1, burstT * 3.2);
    }
  }

  return {
    xRatio: Math.min(0.96, Math.max(0.04, xRatio)),
    yRatio: Math.min(0.88, Math.max(0.12, yRatio)),
  };
}

function getMpBossSeed(id, fallback, now = performance.now()){
  const transition = mpBossSeedTransitionById[id];
  if(!transition || typeof transition.from !== 'number') return fallback;
  const progress = Math.min(1, Math.max(0, (now - transition.started) / 650));
  if(progress >= 1){ delete mpBossSeedTransitionById[id]; return transition.to; }
  return transition.from + (transition.to - transition.from) * progress;
}

// 대왕게: 주기적으로 모래 속에 잠깐 숨어서 무적이 돼요 (역시 시간만의 함수라 모두 같은 타이밍에 보여요)
function isBossStealthedNow(seed, elapsedSec, type){
  if(!type || !type.stealth) return false;
  const cycle = 5, hideFor = 2; // 초 단위
  const t = ((elapsedSec + seed * 10) % cycle + cycle) % cycle;
  return t < hideFor;
}

function spawnMpFish(data){
  const type = data.type;
  const fish = document.createElement('div');
  fish.className = 'fish';
  fish.textContent = type.emoji;
  fish.dataset.name = type.name;
  if(type.isBoss){
    fish.style.fontSize = '86px';
    if(type.tint) fish.style.filter = type.tint + ' drop-shadow(0 3px 3px rgba(0,0,0,0.25))';
  }
  scene.appendChild(fish);
  mpFishEls[data.id] = fish;
  mpFishTypeById[data.id] = type;
  if(type.isBoss) mpBossSeedById[data.id] = data.seed;
  mpCaughtSent[data.id] = false;

  const half = type.isBoss ? (type.half || BOSS_HALF) : FISH_HALF;
  const catchRadius = type.isBoss ? (type.catchRadius || BOSS_CATCH_RADIUS) : FISH_CATCH_RADIUS;

  const distance = window.innerWidth + 100;
  const duration = data.durationMs; // 서버가 정해준 "화면을 가로지르는 시간"(또는 보스의 전체 등장 시간)을 그대로 써서 서버 만료 시점과 맞춰요
  // 내 기기 시계와 서버 시계가 어긋나 있어도 문제가 없도록, Date.now() 대신
  // "이 물고기를 화면에 그리기 시작한 내 브라우저 시각"을 기준으로 흐른 시간을 재요.
  // 뒤늦게 방에 들어와서 이미 날아가고 있던 물고기라면(elapsedMs) 그만큼 앞에서 시작해요.
  const localStart = performance.now() - (data.elapsedMs || 0);
  // 물고기의 지금 위치를 우리가 직접 계산해서 알고 있으니, DOM에서 다시 읽지 않아요
  let curLeft, curTop;
  if(type.isBoss){
    const pos = bossWanderPosition(getMpBossSeed(data.id, data.seed), (data.elapsedMs || 0) / 1000, type);
    curLeft = pos.xRatio * window.innerWidth;
    curTop = pos.yRatio * window.innerHeight;
  } else {
    curTop = data.y * window.innerHeight;
    curLeft = data.fromLeft ? -50 : window.innerWidth + 50;
    // 물고기 이모지는 기본적으로 왼쪽을 보므로, 오른쪽으로 이동할 때 뒤집어요.
    if(data.fromLeft) fish.style.transform = 'scaleX(-1)';
  }
  fish.style.left = curLeft + 'px';
  fish.style.top = curTop + 'px';

  function tryMagnetPull(){
    // 내가 자석을 켠 상태라면, 이 물고기를 내 낚싯바늘 쪽으로 끌어당겨서 보여줘요
    // (목표점도 half만큼 당겨서 물고기 "중심"이 바늘 중심에 겹치게 해요 - 안 그러면
    // 중심끼리 대각선으로 어긋나서 isNearHook 판정 반경 밖에서 맴돌다 못 잡히고 사라져요)
    if(!magnetActive || type.isMagnet) return;
    const dx = (hookX - half) - curLeft, dy = (hookY - half) - curTop;
    const dist = Math.max(Math.sqrt(dx*dx + dy*dy), 0.01);
    const step = 6;
    curLeft += (dx/dist) * step;
    curTop += (dy/dist) * step;
    fish.style.left = curLeft + 'px';
    fish.style.top = curTop + 'px';
  }

  function animate(){
    if(!fish.isConnected) return;
    // 캐치 요청을 이미 보냈다면, 서버 응답(fishCaught/fishExpire/bossInked)이 올 때까지
    // 원래 유영 경로로 되돌아가지 않고 제자리에서 기다려요
    if(mpCaughtSent[data.id]){ requestAnimationFrame(animate); return; }

    // 보스는 스치고 도망간 직후 잠깐 무적이라, 낚싯바늘을 대고 있어도
    // 그 순간에는 연속으로 여러 번 스친 것으로 처리되지 않아요
    const bossInvulnerable = type.isBoss && performance.now() < (mpBossInvulnUntil[data.id] || 0);
    const elapsedSec = (performance.now() - localStart) / 1000;
    const stealthed = type.isBoss && isBossStealthedNow(getMpBossSeed(data.id, data.seed), elapsedSec, type);

    // 낚싯바늘이 물고기에 닿으면 클릭/탭 없이도 자동으로 캐치를 시도해요 (숨어있는 동안은 안 닿아요)
    if(!bossInvulnerable && !stealthed && isNearHook(curLeft + half, curTop + half, catchRadius)){
      mpCaughtSent[data.id] = true;
      clearTimeout(mpCatchResetTimers[data.id]);
      mpCatchResetTimers[data.id] = setTimeout(() => {
        // 네트워크 지연이나 재접속으로 응답이 유실돼도 보스가 영구히 멈추지 않게 해요.
        mpCaughtSent[data.id] = false;
        delete mpCatchResetTimers[data.id];
      }, 1800);
      if(mpSocket) mpSocket.emit('catchAttempt', { fishId: data.id });
      requestAnimationFrame(animate);
      return;
    }

    if(type.isBoss){
      fish.classList.toggle('stealthed', stealthed);
      if(type.stealth){
        fish.style.filter = (type.tint ? type.tint + ' ' : '') + (stealthed ? 'blur(1.5px) ' : '') + 'drop-shadow(0 3px 3px rgba(0,0,0,0.25))';
      }
      const pos = bossWanderPosition(getMpBossSeed(data.id, data.seed), elapsedSec, type);
      const nextLeft = pos.xRatio * window.innerWidth;
      fish.style.transform = nextLeft < curLeft ? 'scaleX(1)' : 'scaleX(-1)';
      curLeft = nextLeft;
      curTop = pos.yRatio * window.innerHeight;
      fish.style.left = curLeft + 'px';
      fish.style.top = curTop + 'px';
      requestAnimationFrame(animate);
      return;
    }

    if(magnetActive && !type.isMagnet){
      tryMagnetPull();
      requestAnimationFrame(animate);
      return;
    }

    const elapsed = performance.now() - localStart;
    const progress = elapsed / duration;
    if(progress >= 1) return; // 서버의 fishExpire 이벤트가 제거를 처리해요
    curLeft = data.fromLeft
      ? -50 + progress * distance
      : (window.innerWidth + 50) - progress * distance;
    fish.style.left = curLeft + 'px';
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

function renderMpPlayerList(players){
  const list = Object.values(players).sort((a, b) => b.score - a.score);
  // 친구 이름은 다른 사람이 입력한 텍스트라, HTML로 그대로 넣으면 위험할 수 있어요(escapeHtml 필수)
  document.getElementById('mpPlayerList').innerHTML = list
    .map(p => `${escapeHtml(p.name)}: ${p.score}점`)
    .join('<br>');

  // 왼쪽 위 메인 점수판은 원래 싱글플레이용이라 멀티플레이 중엔 안 움직였어요.
  // 여기서도 내 점수를 바로 반영해줘요. (이름이 같은 친구가 있어도 안 헷갈리게 socket.id로 찾아요)
  const me = mpSocket && players[mpSocket.id];
  if(me) document.getElementById('score').textContent = me.score;

  syncGhostBoatsFromPlayers(players);
}

/* ------------------------------------------------------
   온라인 라운드가 끝나면, 싱글플레이의 종료화면처럼 방 친구들
   순위와 다음 라운드까지 남은 시간을 화면 가득 보여줘요.
------------------------------------------------------ */
let mpRoundEndCountdownTimer = null;

function renderMpRoundEndRanking(players){
  const list = Object.entries(players)
    .map(([id, p]) => ({ id, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
  const myId = mpSocket ? mpSocket.id : null;
  const medals = ['🥇', '🥈', '🥉'];
  // 친구 이름은 다른 사람이 입력한 텍스트라, HTML로 그대로 넣으면 위험할 수 있어요(escapeHtml 필수)
  document.getElementById('mpRoundEndRanking').innerHTML = list.map((p, i) => `
    <div class="mpRankRow${p.id === myId ? ' me' : ''}">
      <span class="mpRankMedal">${medals[i] || (i + 1) + '.'}</span>
      <span class="mpRankName">${escapeHtml(p.name)}</span>
      <span class="mpRankScore">${p.score}점</span>
    </div>
  `).join('');
}

function startMpRoundEndCountdown(seconds){
  clearInterval(mpRoundEndCountdownTimer);
  let left = seconds;
  const el = document.getElementById('mpRoundEndCountdown');
  const tick = () => {
    el.textContent = left > 0 ? `${left}초 후 새 라운드가 시작돼요...` : '곧 시작해요...';
    left--;
  };
  tick();
  mpRoundEndCountdownTimer = setInterval(() => {
    if(left < -1){ clearInterval(mpRoundEndCountdownTimer); return; }
    tick();
  }, 1000);
}

/* ------------------------------------------------------
   온라인 중에 다른 친구들의 배를 화면에 뿌옇게(반투명) 보여줘요.
   실제 위치가 아니라, 서로 다른 화면 폭에도 맞도록 0~1 비율로 주고받아요.
------------------------------------------------------ */
let mpGhostBoats = {}; // socket.id -> 그 친구의 배 엘리먼트
let mpBoatSendTimer = null;

function ensureGhostBoat(id, name){
  let el = mpGhostBoats[id];
  if(!el){
    el = document.createElement('div');
    el.className = 'ghostBoat';
    el.style.left = (window.innerWidth / 2) + 'px'; // 위치를 아직 모를 때는 가운데에 둬요
    el.innerHTML = '<div class="ghostBoatIcon">⛵</div><div class="ghostBoatName"></div><div class="ghostLine"></div><div class="ghostHook">🪝</div>';
    scene.appendChild(el);
    mpGhostBoats[id] = el;
  }
  el.querySelector('.ghostBoatName').textContent = name; // .textContent라 이름에 이상한 문자가 있어도 안전해요
  return el;
}

function removeGhostBoat(id){
  const el = mpGhostBoats[id];
  if(el){ el.remove(); delete mpGhostBoats[id]; }
}

function syncGhostBoatsFromPlayers(players){
  const myId = mpSocket ? mpSocket.id : null;
  const activeIds = new Set();
  Object.entries(players).forEach(([id, p]) => {
    if(id === myId) return; // 내 배는 이미 진짜로 보이니 유령 배는 안 만들어요
    activeIds.add(id);
    ensureGhostBoat(id, p.name);
  });
  Object.keys(mpGhostBoats).forEach(id => { if(!activeIds.has(id)) removeGhostBoat(id); });
}

function clearGhostBoats(){
  Object.keys(mpGhostBoats).forEach(removeGhostBoat);
}

function sendBoatPosition(){
  if(!mpSocket || !mpActive) return;
  mpSocket.emit('boatMove', { xRatio: Math.max(0, Math.min(1, hookX / window.innerWidth)),
    yRatio: Math.max(0, Math.min(1, hookY / window.innerHeight)),
    width: window.innerWidth, height: window.innerHeight });
}

function startMultiplayerMode(){
  mpActive = true;
  running = false; // 싱글플레이 스폰/보스/날씨는 꺼두고, 시간과 물고기는 서버가 맡아요
  clearInterval(gameTimer); gameTimer = null;
  clearInterval(spawnTimer); spawnTimer = null;
  clearTimeout(rivalTimeout); clearTimeout(stormTimeout); clearTimeout(bossTimeout);
  document.getElementById('rivalBoat').classList.remove('show');
  stopMpWeather();
  magnetActive = false; clearTimeout(magnetTimer);
  updateHookIcon();
  updateMpLevel(1);
  document.getElementById('score').textContent = 0; // 이전 싱글플레이 점수가 남아있지 않도록 초기화
  document.getElementById('mpScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('endScreen').classList.add('hidden');
  document.getElementById('mpRoundEndScreen').classList.add('hidden');
  clearInterval(mpRoundEndCountdownTimer);
  document.getElementById('mpPanel').classList.remove('hidden');
  document.querySelectorAll('.fish').forEach(f => f.remove());
  mpFishEls = {};
  mpFishTypeById = {};
  mpCaughtSent = {};
  mpBossInvulnUntil = {};
  mpBossSeedById = {};
  mpBossSeedTransitionById = {};
  Object.values(mpCatchResetTimers).forEach(clearTimeout); mpCatchResetTimers = {};
  startBgMusic();
  setJoystickVisible(true);

  // 내 배 위치를 주기적으로 친구들에게 알려줘요 (마우스 움직일 때마다 보내면 너무 잦으니 묶어서 보내요)
  clearInterval(mpBoatSendTimer);
  mpBoatSendTimer = setInterval(sendBoatPosition, 150);
}

function leaveMultiplayer(){
  if(mpSocket){ mpSocket.disconnect(); mpSocket = null; }
  mpConnecting = false;
  mpActive = false;
  setJoystickVisible(false);
  magnetActive = false; clearTimeout(magnetTimer);
  document.getElementById('rivalBoat').classList.remove('show');
  stopMpWeather();
  stopBgMusic();
  clearInterval(mpBoatSendTimer); mpBoatSendTimer = null;
  clearInterval(mpRoundEndCountdownTimer);
  clearGhostBoats();
  document.querySelectorAll('.fish').forEach(f => f.remove());
  mpFishEls = {};
  mpFishTypeById = {};
  mpCaughtSent = {};
  mpBossInvulnUntil = {};
  mpBossSeedById = {};
  mpBossSeedTransitionById = {};
  Object.values(mpCatchResetTimers).forEach(clearTimeout); mpCatchResetTimers = {};
  document.getElementById('mpPanel').classList.add('hidden');
  document.getElementById('mpRoundEndScreen').classList.add('hidden');
  document.getElementById('mpStatus').textContent = '';
  document.getElementById('mpRoomCodeDisplay').textContent = '';
  document.getElementById('startScreen').classList.remove('hidden');
}

document.getElementById('mpOpenBtn').addEventListener('click', () => {
  document.getElementById('mpScreen').classList.remove('hidden');
  loadRoomList();
});
document.getElementById('mpRoomListRefreshBtn').addEventListener('click', loadRoomList);

async function loadRoomList(){
  const listEl = document.getElementById('mpRoomList');
  const url = getMpServerUrl();
  if(!url){
    listEl.innerHTML = '<p style="font-size:14px; opacity:0.8;">파일로 직접 열면 방 목록을 볼 수 없어요.</p>';
    return;
  }
  listEl.innerHTML = '<p style="font-size:14px; opacity:0.8;">불러오는 중...</p>';
  try {
    const res = await fetch(url + '/rooms');
    const rooms = await res.json();
    if(!rooms.length){
      listEl.innerHTML = '<p style="font-size:14px; opacity:0.8;">지금 열려있는 방이 없어요. 방 코드를 새로 만들어보세요!</p>';
      return;
    }
    listEl.innerHTML = '';
    rooms.forEach(r => {
      const btn = document.createElement('div');
      btn.className = 'roomRow';
      btn.innerHTML = `<span>🚪 ${escapeHtml(r.code)}</span><span class="roomPlayers">${r.players}명</span>`;
      btn.addEventListener('click', () => {
        document.getElementById('mpRoomCode').value = r.code;
        joinMultiplayer(r.code);
      });
      listEl.appendChild(btn);
    });
  } catch(e){
    listEl.innerHTML = '<p style="font-size:14px; opacity:0.8;">방 목록을 불러오지 못했어요.</p>';
  }
}
document.getElementById('mpCloseBtn').addEventListener('click', () => {
  // 연결/입장 중이었다면 이 화면을 닫을 때 그 시도도 같이 취소해요
  if(!mpActive && mpSocket){ mpSocket.disconnect(); mpSocket = null; }
  mpConnecting = false;
  document.getElementById('mpStatus').textContent = '';
  document.getElementById('mpScreen').classList.add('hidden');
});
document.getElementById('mpJoinBtn').addEventListener('click', () => joinMultiplayer());
document.getElementById('mpLeaveBtn').addEventListener('click', leaveMultiplayer);
