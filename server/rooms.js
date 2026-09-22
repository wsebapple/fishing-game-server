const { levelStages, bossTypes, fishTypes, hitbox } = require('../public/game-config.json');
const { pickFishType, fishDurationMs } = require("./fish");
const { bossWanderPosition, isBossStealthed, isEdible, regularFishCenter, makeTrashThrows } = require('../public/js/shared/boss-math');
const TRASH_TYPES = fishTypes.filter(f => f.isBossTrash);
const TRASH_LIFETIME_MS = 6000;
const BOSS_ACT_INTERVAL_MS = 100;
const ROUND_SECONDS = 60, RESET_DELAY_MS = 6000, MAX_ROOMS = 200, MAX_PLAYERS_PER_ROOM = 20;
const BOSS_ENCOUNTER_MS = 28000;
function createRooms(io, leaderboard) {
const rooms = Object.create(null);
function getLevelForScore(score) { return levelStages.find(stage => score < stage.upTo) || levelStages.at(-1); }
// 방 코드는 대소문자/앞뒤 공백뿐 아니라 중간 공백도 무시해서, 친구끼리 코드를
// 살짝 다르게 입력해도(예: "HOYA 123" vs "HOYA123") 같은 방으로 만나게 해줘요
function normalizeRoomCode(raw){
  if (raw != null && typeof raw !== 'string') return null;
  const cleaned = (raw || '').toUpperCase().replace(/\s+/g, '') || 'DEFAULT';
  return /^[A-Z0-9가-힣_-]{1,24}$/.test(cleaned) ? cleaned : null;
}

function normalizeName(raw){
  const str = typeof raw === 'string' ? raw : String(raw || '');
  return (str.trim() || '친구').slice(0, 12);
}

function getRoom(code){
  if(!rooms[code]){
    rooms[code] = {
      players: {},
      fish: Object.create(null),
      fishTimers: new Set(),
      fishIdCounter: 0,
      spawnTimer: null,
      bossTimer: null,
      bossActTimer: null, // 보스가 물고기를 잡아먹거나 쓰레기를 뿌리는 행동 반복
      timerInterval: null,
      rivalTimer: null,
      weatherTimer: null,
      weatherEndTimer: null,
      resetTimer: null,
      resetEndsAt: 0,
      activeWeather: null, // 'storm' | 'snow' | null
      weatherEndsAt: 0,
      timeLeft: ROUND_SECONDS,
      started: false,
      currentLevel: 1,
      levelSpawnMs: levelStages[0].spawnMs,
    };
  }
  return rooms[code];
}

// 물고기를 방에 넣고 모두에게 알린 뒤, 시간이 다 되면 스스로 사라지게 예약해요
function addFishToRoom(code, room, fishData, onExpire){
  room.fish[fishData.id] = fishData;
  io.to(code).emit('fishSpawn', fishData);
  const expiry = setTimeout(() => {
    room.fishTimers.delete(expiry);
    if(rooms[code] === room && room.fish[fishData.id]){
      delete room.fish[fishData.id];
      io.to(code).emit('fishExpire', { id: fishData.id });
      if(onExpire) onExpire();
    }
  }, fishData.durationMs);
  room.fishTimers.add(expiry);
}

function spawnFishForRoom(code){
  const room = rooms[code];
  if(!room) return;

  const type = pickFishType();
  const id = 'f' + (room.fishIdCounter++);
  const fromLeft = Math.random() < 0.5;
  const y = 0.2 + Math.random() * 0.55;
  const durationMs = fishDurationMs(type.speed);
  addFishToRoom(code, room, { id, type, fromLeft, y, startTime: Date.now(), durationMs });
}

function scheduleBossForRoom(code){
  const room = rooms[code];
  if(!room) return;
  clearTimeout(room.bossTimer);
  const delay = 22000 + Math.random() * 15000; // 22~37초마다 랜덤하게 보스 등장 (싱글플레이와 동일)
  room.bossTimer = setTimeout(() => spawnBossForRoom(code), delay);
}

function spawnBossForRoom(code){
  const room = rooms[code];
  if(!room) return;

  const id = 'boss' + (room.fishIdCounter++);
  const bossType = bossTypes[Math.floor(Math.random() * bossTypes.length)];
  const seed = Math.random(); // 화면을 누비는 경로를 친구들 모두가 똑같이 그릴 수 있게 하는 값이에요
  const hitsNeeded = bossType.hitsMin + Math.floor(Math.random() * (bossType.hitsMax - bossType.hitsMin + 1));
  const fishData = { id, type: bossType, seed, startTime: Date.now(), durationMs: BOSS_ENCOUNTER_MS, hitsNeeded, hitsLanded: 0 };
  addFishToRoom(code, room, fishData, () => {
    stopBossActions(room);
    scheduleBossForRoom(code); // 보스가 완전히 도망가면 다음 보스를 또 예약해요
  });
  startBossActions(code, room, fishData);
}

function stopBossActions(room){
  clearInterval(room.bossActTimer);
  room.bossActTimer = null;
}

// 사나운 보스는 점수 물고기를 잡아먹고, 대왕게는 감점 쓰레기를 뿌려요.
// 친구마다 화면 크기가 달라서, 서버는 기준 화면(eatRefWidth x eatRefHeight)에서 겹치는지 계산해요.
function startBossActions(code, room, boss){
  stopBossActions(room);
  const type = boss.type;
  if(!type.eats && !type.throwsTrash) return;
  let nextEatAt = 0;
  let nextThrowAt = Date.now() + (type.throwsTrash ? type.throwsTrash.everyMs : 0);
  room.bossActTimer = setInterval(() => {
    if(rooms[code] !== room || room.fish[boss.id] !== boss){ stopBossActions(room); return; }
    const now = Date.now();
    const elapsedSec = (now - boss.startTime) / 1000;
    if(isBossStealthed(boss.seed, elapsedSec, type)) return; // 모래 속에 숨어 있을 땐 아무것도 안 해요
    const pos = bossWanderPosition(boss.seed, elapsedSec, type);

    if(type.eats && now >= nextEatAt){
      const W = hitbox.eatRefWidth, H = hitbox.eatRefHeight;
      const bx = pos.xRatio * W + type.half, by = pos.yRatio * H + type.half;
      let prey = null, preyDist = Infinity;
      for(const f of Object.values(room.fish)){
        if(!isEdible(f.type) || f.trash) continue;
        const c = regularFishCenter(f, now - f.startTime, W, H, hitbox.fishHalf);
        const d = Math.hypot(c.x - bx, c.y - by);
        if(d <= type.catchRadius && d < preyDist){ prey = f; preyDist = d; }
      }
      if(prey){
        delete room.fish[prey.id];
        io.to(code).emit('fishEaten', { id: prey.id, bossId: boss.id });
        nextEatAt = now + type.eatCooldownMs;
      }
    }

    if(type.throwsTrash && now >= nextThrowAt && TRASH_TYPES.length){
      nextThrowAt = now + type.throwsTrash.everyMs;
      makeTrashThrows(pos, type.half, type.throwsTrash.count).forEach(trash => {
        const trashType = TRASH_TYPES[Math.floor(Math.random() * TRASH_TYPES.length)];
        addFishToRoom(code, room, { id: 'f' + (room.fishIdCounter++), type: trashType, trash, startTime: now, durationMs: TRASH_LIFETIME_MS });
      });
    }
  }, BOSS_ACT_INTERVAL_MS);
}

// 지금 단계 + 날씨 상태에 맞는 스폰 속도로 물고기 생성 타이머를 다시 맞춰요
function applySpawnRate(code){
  const room = rooms[code];
  if(!room || !room.started) return;

  let spawnMs = room.levelSpawnMs;
  if(room.activeWeather === 'storm') spawnMs = Math.max(220, room.levelSpawnMs * 0.55);
  else if(room.activeWeather === 'snow') spawnMs = room.levelSpawnMs * 1.25;

  clearInterval(room.spawnTimer);
  room.spawnTimer = setInterval(() => spawnFishForRoom(code), spawnMs);
}

// 방에서 가장 점수가 높은 친구를 기준으로 단계를 올려요 (다 같이 더 빠르고 짜릿해져요)
function checkLevelUpForRoom(code){
  const room = rooms[code];
  if(!room) return;

  const topScore = Object.values(room.players).reduce((max, p) => Math.max(max, p.score), 0);
  const stage = getLevelForScore(topScore);
  if(stage.level === room.currentLevel) return;

  room.currentLevel = stage.level;
  room.levelSpawnMs = stage.spawnMs;
  applySpawnRate(code);
  io.to(code).emit('levelUp', { level: room.currentLevel });
}

function scheduleRivalForRoom(code){
  const room = rooms[code];
  if(!room) return;
  clearTimeout(room.rivalTimer);
  const delay = 6000 + Math.random() * 6000; // 6~12초마다 랜덤하게 등장 (싱글플레이와 동일)
  room.rivalTimer = setTimeout(() => tryStealForRoom(code), delay);
}

function tryStealForRoom(code){
  const room = rooms[code];
  if(!room) return;

  // 보스는 친구들이 직접 잡거나 도망가게 두고, 해적은 노리지 않아요
  const stealable = Object.values(room.fish).filter(f => !f.type.isBoss && !f.type.isBossTrash);
  if(stealable.length === 0){ scheduleRivalForRoom(code); return; }

  // 보물통이 떠 있으면 그것부터 노려요!
  const treasures = stealable.filter(f => f.type.isTreasure);
  const pool = treasures.length > 0 ? treasures : stealable;
  const target = pool[Math.floor(Math.random() * pool.length)];

  delete room.fish[target.id];
  io.to(code).emit('fishStolen', { id: target.id, name: target.type.name });

  scheduleRivalForRoom(code);
}

function scheduleWeatherForRoom(code){
  const room = rooms[code];
  if(!room) return;
  clearTimeout(room.weatherTimer);
  const delay = 18000 + Math.random() * 15000; // 18~33초마다 랜덤하게 날씨 이벤트
  room.weatherTimer = setTimeout(() => triggerWeatherForRoom(code), delay);
}

function triggerWeatherForRoom(code){
  const room = rooms[code];
  if(!room) return;

  const kind = Math.random() < 0.5 ? 'storm' : 'snow';
  room.activeWeather = kind;
  const duration = kind === 'storm'
    ? 6000 + Math.random() * 3000
    : 7000 + Math.random() * 3000;
  room.weatherEndsAt = Date.now() + duration;

  applySpawnRate(code);
  io.to(code).emit('weatherEvent', { kind, durationMs: duration });

  clearTimeout(room.weatherEndTimer);
  room.weatherEndTimer = setTimeout(() => {
    room.activeWeather = null;
    room.weatherEndsAt = 0;
    applySpawnRate(code);
    io.to(code).emit('weatherEvent', { kind: kind + 'End' });
    scheduleWeatherForRoom(code);
  }, duration);
}

function broadcastTime(code){
  const room = rooms[code];
  if(!room) return;
  io.to(code).emit('timeUpdate', { timeLeft: room.timeLeft });
}

function endRound(code){
  const room = rooms[code];
  if(!room) return;

  clearInterval(room.spawnTimer);
  clearTimeout(room.bossTimer);
  stopBossActions(room);
  clearTimeout(room.rivalTimer);
  clearTimeout(room.weatherTimer);
  clearTimeout(room.weatherEndTimer);
  clearTimeout(room.resetTimer);
  room.spawnTimer = null;
  room.bossTimer = null;
  room.rivalTimer = null;
  room.weatherTimer = null;
  room.weatherEndTimer = null;
  room.started = false;
  leaderboard.record(room.players).catch(error => console.error('순위표 저장 실패', error));
  room.timeLeft = ROUND_SECONDS; // 다음 라운드를 기다리는 동안 누가 들어와도 0초로 보이지 않게

  // 폭풍우/눈이 오던 중이었다면 친구들 화면에서도 정리해줘요
  if(room.activeWeather){
    io.to(code).emit('weatherEvent', { kind: room.activeWeather + 'End' });
    room.activeWeather = null;
  }
  room.weatherEndsAt = 0;

  // 화면에 남아있던 물고기를 모두 치워요
  Object.keys(room.fish).forEach(id => io.to(code).emit('fishExpire', { id }));
  for (const expiry of room.fishTimers) clearTimeout(expiry);
  room.fishTimers.clear();
  room.fish = Object.create(null);

  io.to(code).emit('roundEnded', { players: room.players });

  room.resetEndsAt = Date.now() + RESET_DELAY_MS;
  room.resetTimer = setTimeout(() => startRound(code), RESET_DELAY_MS);
}

function startRound(code){
  const room = rooms[code];
  if(!room || Object.keys(room.players).length === 0) return; // 아무도 없으면 굳이 새 라운드를 시작 안 해요
  if(room.started) return; // 이미 라운드가 진행 중이면 다시 시작하지 않아요 (재입장 등으로 중복 시작되는 것 방지)

  clearTimeout(room.resetTimer);
  room.resetTimer = null;
  room.resetEndsAt = 0;

  room.timeLeft = ROUND_SECONDS;
  room.started = true;
  room.currentLevel = 1;
  room.levelSpawnMs = levelStages[0].spawnMs;
  room.activeWeather = null;
  room.weatherEndsAt = 0;
  Object.values(room.players).forEach(p => p.score = 0);
  for (const id of Object.keys(room.players)) {
    const socket = io.sockets.sockets.get(id);
    if (socket) socket.data.magnetUntil = 0;
  }

  io.to(code).emit('roundReset', { players: room.players, timeLeft: room.timeLeft, level: room.currentLevel });

  clearInterval(room.timerInterval);
  room.timerInterval = setInterval(() => {
    room.timeLeft--;
    broadcastTime(code);
    if(room.timeLeft <= 0){
      clearInterval(room.timerInterval);
      endRound(code);
    }
  }, 1000);

  applySpawnRate(code);
  scheduleBossForRoom(code);
  scheduleRivalForRoom(code);
  scheduleWeatherForRoom(code);
}
function removePlayer(code, id) {
  const room = rooms[code];
  if (!room) return;
  delete room.players[id];
  io.to(code).emit('playerListUpdate', room.players);
  if (Object.keys(room.players).length) return;
  for (const timer of ['spawnTimer', 'timerInterval', 'bossActTimer']) clearInterval(room[timer]);
  for (const timer of ['bossTimer', 'rivalTimer', 'weatherTimer', 'weatherEndTimer', 'resetTimer']) clearTimeout(room[timer]);
  for (const expiry of room.fishTimers) clearTimeout(expiry);
  room.fishTimers.clear();
  delete rooms[code];
}
return { rooms, getRoom, startRound, endRound, removePlayer, checkLevelUpForRoom, scheduleBossForRoom, stopBossActions, startBossActions, broadcastTime, normalizeRoomCode, normalizeName, MAX_ROOMS, MAX_PLAYERS_PER_ROOM, ROUND_SECONDS };
}
module.exports = { createRooms };
