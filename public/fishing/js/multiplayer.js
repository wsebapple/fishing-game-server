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
    Game.mp.connecting = false; // 다시 '입장하기'를 누를 수 있게 해요
    document.getElementById('mpStatus').textContent = '서버에 연결할 수 없어요.';
  };
  document.head.appendChild(script);
}

function joinMultiplayer(roomCodeOverride){
  if(Game.mp.connecting) return; // 입장하기를 여러 번 눌러도 소켓이 중복 생성되지 않게 해요
  const url = getMpServerUrl();
  const roomCode = (roomCodeOverride || document.getElementById('mpRoomCode').value.trim() || 'default');
  // 서버도 이름을 12글자로 잘라서 저장하니, 우리도 똑같이 잘라야
  // 화면에 보이는 이름이 서버가 broadcast하는 이름과 어긋나지 않아요
  const name = (document.getElementById('playerNameInput').value.trim() || randomName()).slice(0, 12);
  Game.state.playerName = name; // 싱글플레이를 안 거치고 바로 온라인으로 들어와도 화면에 내 이름이 정확히 보이게 해줘요

  if(!url){
    document.getElementById('mpStatus').textContent = '파일로 직접 열면 온라인 기능을 쓸 수 없어요. 서버 주소로 접속해주세요.';
    return;
  }

  if(Game.mp.socket){ Game.mp.socket.disconnect(); Game.mp.socket = null; } // 이전에 연결됐던 소켓이 남아있으면 정리하고 새로 시작해요
  Game.mp.connecting = true;
  document.getElementById('mpStatus').textContent = '연결하는 중...';

  loadSocketIoScript(() => {
    ensureAudio();
    Game.mp.socket = window.io(url);

    Game.mp.socket.on('connect', () => {
      Game.mp.socket.emit('joinRoom', { roomCode, name });
      // 화면 전환은 서버가 입장을 실제로 받아준 뒤(roomState 수신 시)에 해요
    });

    Game.mp.socket.on('connect_error', () => {
      Game.mp.connecting = false;
      document.getElementById('mpStatus').textContent = '연결에 실패했어요. 잠시 후 다시 시도해주세요.';
    });

    Game.mp.socket.on('joinError', ({ message }) => {
      Game.mp.connecting = false;
      document.getElementById('mpStatus').textContent = message || '지금은 입장할 수 없어요.';
      if(Game.mp.socket){ Game.mp.socket.disconnect(); Game.mp.socket = null; }
    });

    Game.mp.socket.on('roomState', (state) => {
      Game.mp.connecting = false;
      if(!Game.mp.active) startMultiplayerMode(); // 방 입장이 확정된 시점에만 화면을 전환해요
      document.querySelectorAll('.fish').forEach(f => f.remove());
      Game.mp.fishEls = {}; Game.mp.fishTypeById = {}; Game.mp.caughtSent = {}; Game.mp.bossInvulnUntil = {}; Game.mp.catchRetryAt = {}; Game.mp.bossSeedById = {};
      stopMpWeather();
      if (state.activeWeather) startMpWeather(state.activeWeather);
      if(state.code) document.getElementById('mpRoomCodeDisplay').textContent = '방 코드: ' + state.code;
      Object.values(state.fish).forEach(spawnMpFish);
      renderMpPlayerList(state.players);
      if(typeof state.timeLeft === 'number') updateMpTime(state.timeLeft);
      if(typeof state.level === 'number') updateMpLevel(state.level);
      document.getElementById('mpConnBanner').classList.add('hidden');
      document.getElementById('mpRoundEndScreen').classList.toggle('hidden', !!state.started);
      document.getElementById('mpPanel').classList.toggle('hidden', !state.started); // 순위 화면과 점수가 겹쳐 보이지 않게
      setJoystickVisible(!!state.started);
      if (!state.started) {
        renderMpRoundEndRanking(state.players);
        startMpRoundEndCountdown(Math.ceil(state.resetRemainingMs / 1000));
      } else clearInterval(Game.mp.roundEndCountdownTimer);
      sendBoatPosition();
    });

    Game.mp.socket.on('disconnect', () => {
      if (!Game.mp.active) return;
      document.getElementById('mpStatus').textContent = '연결이 끊겼어요. 다시 연결하는 중...';
      // #mpStatus는 입장 화면 안에 있어서 게임 중엔 안 보여요. 게임 화면 위 배너로 알려줘요.
      document.getElementById('mpConnBanner').classList.remove('hidden');
    });
    Game.mp.socket.on('catchRejected', ({ fishId }) => {
      clearTimeout(Game.mp.catchResetTimers[fishId]); delete Game.mp.catchResetTimers[fishId];
      Game.mp.caughtSent[fishId] = false;
      // 거절되자마자 다음 프레임에 또 보내면 초당 수십 번 전송하게 돼요. 잠깐 쉬었다가 다시 시도해요.
      Game.mp.catchRetryAt[fishId] = performance.now() + 200;
    });

    Game.mp.socket.on('fishSpawn', (data) => {
      spawnMpFish(data);
      if(data.type.isBoss){
        showBanner(data.type.emoji + ' ' + data.type.name + ' 출현!');
        playBossSound();
      }
    });

    Game.mp.socket.on('fishExpire', ({ id }) => {
      const el = Game.mp.fishEls[id];
      if(el){
        // 보스가 끝내 못 잡히고 도망가는 경우, 마지막으로 도망 연출을 내고 사라져요
        const bossType = Game.mp.fishTypeById[id];
        if(bossType && bossType.isBoss){
          const left = parseFloat(el.style.left) || 0;
          const top = parseFloat(el.style.top) || 0;
          spawnBossEscapeEffect(left + (bossType.half || Game.config.hitbox.bossHalf), top + (bossType.half || Game.config.hitbox.bossHalf), bossType.escape);
        }
        el.remove();
        delete Game.mp.fishEls[id];
      }
      forgetMpFish(id);
    });

    // 대왕게가 곧 쓰레기를 뿌려요: 빨갛게 깜빡이며 ❗로 예고해요
    Game.mp.socket.on('bossWarn', ({ id }) => {
      const bossEl = Game.mp.fishEls[id], bossType = Game.mp.fishTypeById[id];
      if(!bossEl || !bossType) return;
      const half = bossType.half || Game.config.hitbox.bossHalf;
      playTrashWarnEffect(bossEl, (parseFloat(bossEl.style.left) || 0) + half, (parseFloat(bossEl.style.top) || 0) + half, bossType);
    });

    // 사나운 보스(상어·바다용·오징어)가 점수 물고기를 먼저 삼켰어요 (서버가 정해요)
    Game.mp.socket.on('fishEaten', ({ id, bossId }) => {
      const el = Game.mp.fishEls[id];
      const bossEl = Game.mp.fishEls[bossId];
      const bossType = Game.mp.fishTypeById[bossId];
      if(el){
        if(bossEl && bossType){
          const half = bossType.half || Game.config.hitbox.bossHalf;
          playEatEffect(el, (parseFloat(bossEl.style.left) || 0) + half, (parseFloat(bossEl.style.top) || 0) + half, bossType, bossEl);
        } else el.remove();
        delete Game.mp.fishEls[id];
      }
      forgetMpFish(id);
    });

    Game.mp.socket.on('bossInked', ({ id, seed, byId }) => {
      // 보스가 맞긴 했지만 아직 다 안 잡혀서, 도망 연출을 내요 (물고기는 그대로 살아있어요)
      const el = Game.mp.fishEls[id];
      const bossType = Game.mp.fishTypeById[id];
      if(el){
        const left = parseFloat(el.style.left) || 0;
        const top = parseFloat(el.style.top) || 0;
        spawnBossEscapeEffect(left + (bossType ? (bossType.half || Game.config.hitbox.bossHalf) : Game.config.hitbox.bossHalf), top + (bossType ? (bossType.half || Game.config.hitbox.bossHalf) : Game.config.hitbox.bossHalf), bossType ? bossType.escape : 'ink');

        // 나를 맞춘 경우에만: 고래는 내 낚싯바늘을 밀쳐내고, 바다용은 내 낚싯줄을 얼려요
        const isMe = Game.mp.socket && byId === Game.mp.socket.id;
        if(isMe && bossType){
          if(bossType.knockback){
            const half = bossType.half || Game.config.hitbox.bossHalf;
            const kdx = Game.hook.x - (left + half), kdy = Game.hook.y - (top + half);
            const kdist = Math.max(Math.hypot(kdx, kdy), 0.01);
            moveRod(Game.hook.x + (kdx / kdist) * 90, Game.hook.y + (kdy / kdist) * 90);
          }
          if(bossType.freeze){
            Game.effects.frozen = true;
            updateHookIcon();
            clearTimeout(Game.effects.freezeTimeout);
            Game.effects.freezeTimeout = setTimeout(() => { Game.effects.frozen = false; updateHookIcon(); }, 1000);
          }
        }
      }
      if (typeof seed === 'number') {
        Game.mp.bossSeedTransitionById[id] = { from: Game.mp.bossSeedById[id], to: seed, started: performance.now() };
        Game.mp.bossSeedById[id] = seed;
      }
      clearTimeout(Game.mp.catchResetTimers[id]); delete Game.mp.catchResetTimers[id];
      Game.mp.caughtSent[id] = false; // 다시 낚싯바늘로 노려볼 수 있게 풀어줘요
      Game.mp.bossInvulnUntil[id] = performance.now() + 1500; // 1.5초간은 무적: 한 번 지나간 걸로 여러 번 잡히지 않게 해요
    });

    Game.mp.socket.on('timeUpdate', ({ timeLeft }) => updateMpTime(timeLeft));

    Game.mp.socket.on('levelUp', ({ level }) => {
      // 서버는 단계가 바뀔 때마다 보내요(감점으로 내려갈 때 포함). 올라갈 때만 축하 연출을 해요.
      const wentUp = level > Game.state.currentLevel;
      updateMpLevel(level);
      if(wentUp){
        showBanner('🌟 ' + level + '단계! 🌟');
        playLevelUpSound();
      }
    });

    Game.mp.socket.on('roundReset', ({ players, timeLeft, level }) => {
      clearInterval(Game.mp.roundEndCountdownTimer);
      Game.effects.magnetActive = false; clearTimeout(Game.effects.magnetTimer); updateHookIcon();
      document.getElementById('mpRoundEndScreen').classList.add('hidden');
      document.getElementById('mpPanel').classList.remove('hidden');
      setJoystickVisible(true);
      renderMpPlayerList(players);
      updateMpTime(timeLeft);
      updateMpLevel(level || 1);
      document.querySelectorAll('.fish').forEach(f => f.remove());
      Game.mp.fishEls = {};
      Game.mp.fishTypeById = {};
      Game.mp.caughtSent = {};
      Game.mp.bossInvulnUntil = {}; Game.mp.catchRetryAt = {}; Game.mp.bossSeedById = {};
      stopMpWeather();
      showBanner('🎣 새 라운드 시작!');
    });

    Game.mp.socket.on('roundEnded', ({ players }) => {
      renderMpPlayerList(players);
      stopMpWeather();
      setJoystickVisible(false); // 라운드 결과를 보는 동안엔 조종할 게 없으니 숨겨요
      const me = players[Game.mp.socket.id];
      const isNewRecord = !!me && me.score > Game.state.bestScore;
      if(me){
        if(isNewRecord) Game.state.bestScore = me.score;
        document.getElementById('bestScoreStart').textContent = Game.state.bestScore > 0 ? ('🏅 최고점수: ' + Game.state.bestScore + '점') : '';
        document.getElementById('bestScoreEnd').textContent = '🏅 최고점수: ' + Game.state.bestScore + '점';
      }
      playGameOverSound(isNewRecord);

      // 싱글플레이처럼 점수만 반짝 보이고 사라지는 대신, 방 친구들 순위와
      // 다음 라운드까지 남은 시간을 화면 가득 보여줘서 "뭐가 어떻게 된 건지" 알 수 있게 해요
      renderMpRoundEndRanking(players);
      document.getElementById('mpPanel').classList.add('hidden'); // 순위 화면에 같은 점수가 두 번 보이지 않게
      document.getElementById('mpRoundEndScreen').classList.remove('hidden');
      startMpRoundEndCountdown(6); // 서버의 RESET_DELAY_MS(6초)와 맞춰뒀어요
    });

    Game.mp.socket.on('weatherEvent', ({ kind, durationMs }) => {
      if(kind === 'stormEnd' || kind === 'snowEnd') stopMpWeather(kind.replace('End',''));
      else startMpWeather(kind);
    });

    Game.mp.socket.on('fishStolen', ({ id, name }) => {
      const el = Game.mp.fishEls[id];
      if(!el) return;
      const targetX = Math.max(80, Math.min(Game.view.w - 80, parseFloat(el.style.left) || Game.view.w/2));
      playStealAnimation(el, name, targetX, () => { delete Game.mp.fishEls[id]; });
    });

    Game.mp.socket.on('fishCaught', (info) => {
      const { fishId, by, byId, name, points, emoji, isTreasure, isMagnet, isTimeBonus, isBoss, label, lootName } = info;
      clearTimeout(Game.mp.catchResetTimers[fishId]); delete Game.mp.catchResetTimers[fishId];
      const el = Game.mp.fishEls[fishId];
      // 이름은 친구랑 겹칠 수 있어서(둘 다 "친구"로 들어오는 등) 서버가 보내주는
      // 내 socket.id(byId)로 정확히 "내가 잡았는지"를 판정해요
      const isMe = Game.mp.socket && byId === Game.mp.socket.id;

      if(isMe){
        playCatchSound(points, isTreasure, isMagnet, isTimeBonus);
        if(name) Game.state.caughtLog[name] = (Game.state.caughtLog[name] || 0) + 1; // 📖 도감에도 기록해요
        if(isTreasure) Game.state.treasureLoot.push(lootName || '보물');
        if(isMagnet){
          Game.effects.magnetActive = true;
          updateHookIcon();
          clearTimeout(Game.effects.magnetTimer);
          Game.effects.magnetTimer = setTimeout(() => { Game.effects.magnetActive = false; updateHookIcon(); }, Game.config.fishTypes.find(f => f.isMagnet).magnetMs);
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
        Game.dom.scene.appendChild(popText);
        setTimeout(() => popText.remove(), 800);

        el.classList.add('caught');
        // 잡히는 애니메이션이 재생되는 동안(350ms)에도 el은 아직 DOM에 남아있어서
        // animate() 루프가 계속 돌아요. 그새 mpCaughtSent를 풀어버리면 이미 사라진
        // 물고기에 대해 catchAttempt를 한 번 더 헛되이 보낼 수 있으니, 완전히 사라진
        // 뒤에 정리해요.
        setTimeout(() => { el.remove(); forgetMpFish(fishId); }, 350);
        delete Game.mp.fishEls[fishId];
      } else {
        forgetMpFish(fishId);
      }
    });

    Game.mp.socket.on('playerListUpdate', renderMpPlayerList);

    Game.mp.socket.on('boatMove', ({ id, xRatio, yRatio }) => {
      const g = Game.mp.ghostBoats[id];
      if(!g) return;
      // 바늘 목표 위치만 기억하고, 배·줄·바늘은 updateGhostBoats()가 매 프레임 부드럽게 따라가게 해요
      g.hookX = xRatio * Game.view.w;
      if(typeof yRatio === 'number') g.hookY = yRatio * Game.view.h;
      if(!g.seen){ g.seen = true; g.shownX = g.hookX; g.shownY = g.hookY; g.hookEl.hidden = false; }
    });
  });
}


function startMpWeather(kind){
  if(kind === 'storm'){
    Game.effects.stormActive = true;
    document.getElementById('stormOverlay').classList.add('active');
    document.getElementById('stormFog').classList.add('active');
    showBanner('⛈️ 폭풍우가 몰아쳐요!');
    playThunderSound();
    clearInterval(Game.mp.flashInterval);
    Game.mp.flashInterval = startLightningFlashes();
  } else if(kind === 'snow'){
    document.getElementById('snowTint').classList.add('active');
    showBanner('❄️ 눈이 내려요! 낚싯줄이 얼었어요 🥶');
    Game.effects.frozen = true;
    updateHookIcon();
    clearTimeout(Game.effects.freezeTimeout);
    Game.effects.freezeTimeout = setTimeout(() => { Game.effects.frozen = false; updateHookIcon(); }, 5000);
    clearInterval(Game.mp.snowInterval);
    Game.mp.snowInterval = startSnowflakes();
  }
}

function stopMpWeather(kind){
  clearInterval(Game.mp.flashInterval); Game.mp.flashInterval = null;
  clearInterval(Game.mp.snowInterval); Game.mp.snowInterval = null;
  Game.effects.stormActive = false;
  Game.effects.frozen = false;
  clearTimeout(Game.effects.freezeTimeout);
  updateHookIcon();
  document.getElementById('stormOverlay').classList.remove('active');
  document.getElementById('stormFog').classList.remove('active');
  document.getElementById('snowTint').classList.remove('active');
  if(kind === 'storm') showBanner('🌤️ 폭풍우가 지나갔어요!');
  else if(kind === 'snow') showBanner('☀️ 눈이 그쳤어요!');
}

function updateMpLevel(level){
  Game.state.currentLevel = level;
  document.getElementById('level').textContent = Game.state.currentLevel;
}

function updateMpTime(t){
  Game.state.timeLeft = t;
  document.getElementById('timeLeft').textContent = Game.state.timeLeft;
}

// 보스 이동/은신 계산식(bossWanderPosition, isBossStealthed)은 서버와 같이 쓰는
// js/shared/boss-math.js에 있어요.

// 피격 후 서버가 새 경로(seed)를 주면 650ms 동안 부드럽게 옮겨가요. 전환이 끝난 뒤에는
// 스폰 때의 옛 seed가 아니라 최신 seed를 써야 서버 판정 위치와 화면 위치가 맞아요.
// 사라진 물고기에 대해 기억해두던 상태를 모두 지워요 (fishExpire/fishEaten 공통)
function forgetMpFish(id){
  delete Game.mp.fishTypeById[id];
  delete Game.mp.caughtSent[id];
  clearTimeout(Game.mp.catchResetTimers[id]); delete Game.mp.catchResetTimers[id];
  delete Game.mp.bossInvulnUntil[id];
  delete Game.mp.catchRetryAt[id];
  delete Game.mp.bossSeedById[id];
  delete Game.mp.bossSeedTransitionById[id];
}

function getMpBossSeed(id, fallback, now = performance.now()){
  const current = typeof Game.mp.bossSeedById[id] === 'number' ? Game.mp.bossSeedById[id] : fallback;
  const transition = Game.mp.bossSeedTransitionById[id];
  if(!transition || typeof transition.from !== 'number') return current;
  const progress = Math.min(1, Math.max(0, (now - transition.started) / 650));
  if(progress >= 1){ delete Game.mp.bossSeedTransitionById[id]; return transition.to; }
  return transition.from + (transition.to - transition.from) * progress;
}

function spawnMpFish(data){
  const type = data.type;
  const fish = document.createElement('div');
  fish.className = type.isBoss ? 'fish boss-fish' : (data.trash ? 'fish trashItem' : 'fish');
  fish.textContent = type.emoji;
  fish.dataset.name = type.name;
  if(type.isBoss){
    fish.style.fontSize = '86px';
    if(type.tint) fish.style.filter = type.tint + ' drop-shadow(0 3px 3px rgba(0,0,0,0.25))';
  }
  Game.dom.scene.appendChild(fish);
  Game.mp.fishEls[data.id] = fish;
  Game.mp.fishTypeById[data.id] = type;
  if(type.isBoss) Game.mp.bossSeedById[data.id] = data.seed;
  Game.mp.caughtSent[data.id] = false;

  const hb = Game.config.hitbox;
  const half = type.isBoss ? (type.half || hb.bossHalf) : (data.trash ? hb.trashHalf : hb.fishHalf);
  const catchRadius = type.isBoss ? (type.catchRadius || hb.bossCatchRadius) : (data.trash ? hb.trashCatchRadius : hb.fishCatchRadius);

  const distance = Game.view.w + 100;
  const duration = data.durationMs; // 서버가 정해준 "화면을 가로지르는 시간"(또는 보스의 전체 등장 시간)을 그대로 써서 서버 만료 시점과 맞춰요
  // 내 기기 시계와 서버 시계가 어긋나 있어도 문제가 없도록, Date.now() 대신
  // "이 물고기를 화면에 그리기 시작한 내 브라우저 시각"을 기준으로 흐른 시간을 재요.
  // 뒤늦게 방에 들어와서 이미 날아가고 있던 물고기라면(elapsedMs) 그만큼 앞에서 시작해요.
  const localStart = performance.now() - (data.elapsedMs || 0);
  // 물고기의 지금 위치를 우리가 직접 계산해서 알고 있으니, DOM에서 다시 읽지 않아요
  let curLeft, curTop;
  if(type.isBoss){
    const pos = bossWanderPosition(getMpBossSeed(data.id, data.seed), (data.elapsedMs || 0) / 1000, type);
    curLeft = pos.xRatio * Game.view.w;
    curTop = pos.yRatio * Game.view.h;
  } else if(data.trash){
    const c = trashCenter(data.trash, (data.elapsedMs || 0) / 1000, Game.view.w, Game.view.h);
    curLeft = c.x - half; curTop = c.y - half;
    // 방금 던진 쓰레기라면 던진 대왕게가 몸을 휘두르고 흙탕물이 퍼져요 (한 번에 여러 개를 던져도 연출은 한 번만)
    const thrower = Game.mp.fishEls[data.fromBossId], throwerType = Game.mp.fishTypeById[data.fromBossId];
    const throwKey = data.fromBossId + '@' + data.startTime;
    if(thrower && throwerType && !data.elapsedMs && Game.mp.lastThrowKey !== throwKey){
      Game.mp.lastThrowKey = throwKey;
      const bh = throwerType.half || hb.bossHalf;
      playTrashThrowEffect(thrower, (parseFloat(thrower.style.left) || 0) + bh, (parseFloat(thrower.style.top) || 0) + bh);
    }
  } else {
    curTop = data.y * Game.view.h;
    curLeft = data.fromLeft ? -50 : Game.view.w + 50;
    // 물고기 이모지는 기본적으로 왼쪽을 보므로, 오른쪽으로 이동할 때 뒤집어요.
    if(data.fromLeft) fish.style.transform = 'scaleX(-1)';
  }
  fish.style.left = curLeft + 'px';
  fish.style.top = curTop + 'px';

  let lastFrame = performance.now();
  function tryMagnetPull(dt){
    // 내가 자석을 켠 상태라면, 이 물고기를 내 낚싯바늘 쪽으로 끌어당겨서 보여줘요 (싱글과 같은 magnetPull)
    if(!Game.effects.magnetActive || type.isMagnet) return;
    const pos = { left: curLeft, top: curTop };
    magnetPull(pos, half, dt);
    curLeft = pos.left; curTop = pos.top;
    fish.style.left = curLeft + 'px';
    fish.style.top = curTop + 'px';
  }

  function animate(){
    if(!fish.isConnected || fish.classList.contains('eaten')) return;
    const frameNow = performance.now();
    const dt = Math.min(frameNow - lastFrame, 100) / 1000;
    lastFrame = frameNow;
    // 캐치 요청을 이미 보냈다면, 서버 응답(fishCaught/fishExpire/bossInked)이 올 때까지
    // 원래 유영 경로로 되돌아가지 않고 제자리에서 기다려요
    if(Game.mp.caughtSent[data.id]){ requestAnimationFrame(animate); return; }

    // 보스는 스치고 도망간 직후 잠깐 무적이라, 낚싯바늘을 대고 있어도
    // 그 순간에는 연속으로 여러 번 스친 것으로 처리되지 않아요
    const bossInvulnerable = type.isBoss && performance.now() < (Game.mp.bossInvulnUntil[data.id] || 0);
    const elapsedSec = (performance.now() - localStart) / 1000;
    const stealthed = type.isBoss && isBossStealthed(getMpBossSeed(data.id, data.seed), elapsedSec, type);

    // 낚싯바늘이 물고기에 닿으면 클릭/탭 없이도 자동으로 캐치를 시도해요 (숨어있는 동안은 안 닿아요)
    const retryBlocked = performance.now() < (Game.mp.catchRetryAt[data.id] || 0);
    if(!bossInvulnerable && !stealthed && !retryBlocked && isNearHook(curLeft + half, curTop + half, catchRadius)){
      Game.mp.caughtSent[data.id] = true;
      clearTimeout(Game.mp.catchResetTimers[data.id]);
      Game.mp.catchResetTimers[data.id] = setTimeout(() => {
        // 네트워크 지연이나 재접속으로 응답이 유실돼도 보스가 영구히 멈추지 않게 해요.
        Game.mp.caughtSent[data.id] = false;
        delete Game.mp.catchResetTimers[data.id];
      }, 1800);
      // 서버는 마지막으로 받은 바늘 위치로 판정해요. 150ms마다 보내는 위치는 그새 낡았을 수 있어서
      // 판정 요청 직전에 지금 위치를 먼저 보내요(같은 소켓이라 순서가 보장돼요).
      sendBoatPosition();
      // 화면은 네트워크 지연만큼 과거 모습이에요. 내가 보고 있던 시점을 같이 보내면
      // 서버가 그 시점의 위치로 판정해줘요(빠른 보스가 닿아 보이는데 안 잡히던 문제).
      if(Game.mp.socket) Game.mp.socket.emit('catchAttempt', { fishId: data.id, viewElapsedMs: Math.max(0, Math.round(performance.now() - localStart)) });
      requestAnimationFrame(animate);
      return;
    }

    if(type.isBoss){
      fish.classList.toggle('stealthed', stealthed);
      if(type.stealth){
        fish.style.filter = (type.tint ? type.tint + ' ' : '') + (stealthed ? 'blur(1.5px) ' : '') + 'drop-shadow(0 3px 3px rgba(0,0,0,0.25))';
      }
      const pos = bossWanderPosition(getMpBossSeed(data.id, data.seed), elapsedSec, type);
      const nextLeft = pos.xRatio * Game.view.w;
      fish.style.transform = nextLeft < curLeft ? 'scaleX(1)' : 'scaleX(-1)';
      curLeft = nextLeft;
      curTop = pos.yRatio * Game.view.h;
      fish.style.left = curLeft + 'px';
      fish.style.top = curTop + 'px';
      requestAnimationFrame(animate);
      return;
    }

    if(Game.effects.magnetActive && !type.isMagnet){
      tryMagnetPull(dt);
      requestAnimationFrame(animate);
      return;
    }

    const elapsed = performance.now() - localStart;
    if(data.trash){
      if(elapsed >= duration) return; // 서버의 fishExpire 이벤트가 제거를 처리해요
      const c = trashCenter(data.trash, elapsed / 1000, Game.view.w, Game.view.h);
      curLeft = c.x - half; curTop = c.y - half;
      fish.style.left = curLeft + 'px';
      fish.style.top = curTop + 'px';
      requestAnimationFrame(animate);
      return;
    }
    const progress = elapsed / duration;
    if(progress >= 1) return; // 서버의 fishExpire 이벤트가 제거를 처리해요
    curLeft = data.fromLeft
      ? -50 + progress * distance
      : (Game.view.w + 50) - progress * distance;
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
  const me = Game.mp.socket && players[Game.mp.socket.id];
  if(me) document.getElementById('score').textContent = me.score;

  syncGhostBoatsFromPlayers(players);
}

/* ------------------------------------------------------
   온라인 라운드가 끝나면, 싱글플레이의 종료화면처럼 방 친구들
   순위와 다음 라운드까지 남은 시간을 화면 가득 보여줘요.
------------------------------------------------------ */

function renderMpRoundEndRanking(players){
  const list = Object.entries(players)
    .map(([id, p]) => ({ id, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
  const myId = Game.mp.socket ? Game.mp.socket.id : null;
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
  clearInterval(Game.mp.roundEndCountdownTimer);
  let left = seconds;
  const el = document.getElementById('mpRoundEndCountdown');
  const tick = () => {
    el.textContent = left > 0 ? `${left}초 후 새 라운드가 시작돼요...` : '곧 시작해요...';
    left--;
  };
  tick();
  Game.mp.roundEndCountdownTimer = setInterval(() => {
    if(left < -1){ clearInterval(Game.mp.roundEndCountdownTimer); return; }
    tick();
  }, 1000);
}

/* ------------------------------------------------------
   온라인 중에 다른 친구들의 배를 화면에 뿌옇게(반투명) 보여줘요.
   실제 위치가 아니라, 서로 다른 화면 폭에도 맞도록 0~1 비율로 주고받아요.
------------------------------------------------------ */

function ensureGhostBoat(id, name){
  let g = Game.mp.ghostBoats[id];
  if(!g){
    const el = document.createElement('div');
    el.className = 'ghostBoat';
    el.appendChild(document.querySelector('#boat .boatBody').cloneNode(true)); // 내 배 그림을 복제해요 (색은 CSS에서)
    const label = document.createElement('div');
    label.className = 'ghostBoatName';
    el.appendChild(label);
    const hookEl = document.createElement('div');
    hookEl.className = 'ghostHook';
    hookEl.textContent = '🪝';
    hookEl.hidden = true; // 친구 바늘 위치를 받기 전에는 줄/바늘을 안 그려요
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'ghostLinePath');
    Game.dom.scene.appendChild(el);
    Game.dom.scene.appendChild(hookEl);
    const lineSvg = document.getElementById('lineSvg');
    lineSvg.insertBefore(path, lineSvg.firstChild); // 내 줄(#linePath)보다 아래 겹에 그려요
    const x = Game.view.w / 2; // 위치를 아직 모를 때는 가운데에 둬요
    g = { el, label, hookEl, path, seen: false, hookX: x, hookY: 330, shownX: x, shownY: 330,
      boat: { x, facing: 1, turn: 1 }, phase: Math.random() * Math.PI * 2 };
    Game.mp.ghostBoats[id] = g;
  }
  g.label.textContent = name; // .textContent라 이름에 이상한 문자가 있어도 안전해요
  return g;
}

// 친구 배도 내 배와 같은 계산(stepBoat)으로 움직여요. 서버에서 오는 바늘 위치는 띄엄띄엄이라
// 화면에 보이는 바늘(shownX/Y)이 그 위치를 부드럽게 쫓아가게 해요.
function updateGhostBoats(now){
  Object.values(Game.mp.ghostBoats).forEach(g => {
    g.shownX += (g.hookX - g.shownX) * 0.25;
    g.shownY += (g.hookY - g.shownY) * 0.25;
    const bobY = boatBob(now, g.phase);
    const tip = stepBoat(g.boat, g.shownX, bobY);
    placeBoat(g.el, g.boat, bobY, tip.s);
    if(!g.seen) return;
    g.path.setAttribute('d', fishingLinePath(tip, g.shownX, g.shownY));
    g.hookEl.style.left = g.shownX.toFixed(1) + 'px';
    g.hookEl.style.top = g.shownY.toFixed(1) + 'px';
  });
}

function removeGhostBoat(id){
  const g = Game.mp.ghostBoats[id];
  if(g){ g.el.remove(); g.hookEl.remove(); g.path.remove(); delete Game.mp.ghostBoats[id]; }
}

function syncGhostBoatsFromPlayers(players){
  const myId = Game.mp.socket ? Game.mp.socket.id : null;
  const activeIds = new Set();
  Object.entries(players).forEach(([id, p]) => {
    if(id === myId) return; // 내 배는 이미 진짜로 보이니 유령 배는 안 만들어요
    activeIds.add(id);
    ensureGhostBoat(id, p.name);
  });
  Object.keys(Game.mp.ghostBoats).forEach(id => { if(!activeIds.has(id)) removeGhostBoat(id); });
}

function clearGhostBoats(){
  Object.keys(Game.mp.ghostBoats).forEach(removeGhostBoat);
}

function sendBoatPosition(){
  if(!Game.mp.socket || !Game.mp.active) return;
  Game.mp.socket.emit('boatMove', { xRatio: Math.max(0, Math.min(1, Game.hook.x / Game.view.w)),
    yRatio: Math.max(0, Math.min(1, Game.hook.y / Game.view.h)),
    width: Game.view.w, height: Game.view.h });
}

function startMultiplayerMode(){
  Game.mp.active = true;
  Game.state.running = false; // 싱글플레이 스폰/보스/날씨는 꺼두고, 시간과 물고기는 서버가 맡아요
  clearInterval(Game.timers.gameTimer); Game.timers.gameTimer = null;
  clearInterval(Game.timers.spawnTimer); Game.timers.spawnTimer = null;
  clearTimeout(Game.timers.rivalTimeout); clearTimeout(Game.timers.stormTimeout); clearTimeout(Game.timers.bossTimeout);
  document.getElementById('rivalBoat').classList.remove('show');
  stopMpWeather();
  Game.effects.magnetActive = false; clearTimeout(Game.effects.magnetTimer);
  updateHookIcon();
  updateMpLevel(1);
  document.getElementById('score').textContent = 0; // 이전 싱글플레이 점수가 남아있지 않도록 초기화
  document.getElementById('mpScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('endScreen').classList.add('hidden');
  document.getElementById('mpRoundEndScreen').classList.add('hidden');
  clearInterval(Game.mp.roundEndCountdownTimer);
  document.getElementById('mpPanel').classList.remove('hidden');
  document.querySelectorAll('.fish').forEach(f => f.remove());
  Game.mp.fishEls = {};
  Game.mp.fishTypeById = {};
  Game.mp.caughtSent = {};
  Game.mp.bossInvulnUntil = {};
  Game.mp.catchRetryAt = {};
  Game.mp.bossSeedById = {};
  Game.mp.bossSeedTransitionById = {};
  Object.values(Game.mp.catchResetTimers).forEach(clearTimeout); Game.mp.catchResetTimers = {};
  startBgMusic();
  setJoystickVisible(true);

  // 내 배 위치를 주기적으로 친구들에게 알려줘요 (마우스 움직일 때마다 보내면 너무 잦으니 묶어서 보내요)
  clearInterval(Game.mp.boatSendTimer);
  Game.mp.boatSendTimer = setInterval(sendBoatPosition, 150);
}

function leaveMultiplayer(){
  if(Game.mp.socket){ Game.mp.socket.disconnect(); Game.mp.socket = null; }
  Game.mp.connecting = false;
  Game.mp.active = false;
  setJoystickVisible(false);
  Game.effects.magnetActive = false; clearTimeout(Game.effects.magnetTimer);
  document.getElementById('rivalBoat').classList.remove('show');
  stopMpWeather();
  stopBgMusic();
  clearInterval(Game.mp.boatSendTimer); Game.mp.boatSendTimer = null;
  clearInterval(Game.mp.roundEndCountdownTimer);
  clearGhostBoats();
  document.querySelectorAll('.fish').forEach(f => f.remove());
  Game.mp.fishEls = {};
  Game.mp.fishTypeById = {};
  Game.mp.caughtSent = {};
  Game.mp.bossInvulnUntil = {};
  Game.mp.catchRetryAt = {};
  Game.mp.bossSeedById = {};
  Game.mp.bossSeedTransitionById = {};
  Object.values(Game.mp.catchResetTimers).forEach(clearTimeout); Game.mp.catchResetTimers = {};
  document.getElementById('mpPanel').classList.add('hidden');
  document.getElementById('mpRoundEndScreen').classList.add('hidden');
  document.getElementById('mpConnBanner').classList.add('hidden');
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
  if(!Game.mp.active && Game.mp.socket){ Game.mp.socket.disconnect(); Game.mp.socket = null; }
  Game.mp.connecting = false;
  document.getElementById('mpStatus').textContent = '';
  document.getElementById('mpScreen').classList.add('hidden');
});
document.getElementById('mpJoinBtn').addEventListener('click', () => joinMultiplayer());
document.getElementById('mpLeaveBtn').addEventListener('click', leaveMultiplayer);
