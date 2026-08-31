// 낚시게임 멀티플레이 서버
// 여러 친구가 같은 "방 코드"로 들어오면, 서버가 물고기를 생성해서
// 모두에게 똑같이 보여주고, 누가 먼저 잡는지 판정해줘요.
// (시간 흐름/자석/시계/보스 같은 특수 기능도 여기서 방 전체에 맞춰 돌려줘요)

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// public 폴더 안의 게임 파일(index.html 등)을 그대로 보여줘요
// (어느 폴더에서 node server.js를 실행해도 항상 이 파일 옆의 public을 찾도록 절대경로를 써요)
app.use(express.static(path.join(__dirname, 'public')));

// 지금 열려있는(사람이 있는) 방 목록을 알려줘요. 온라인 접속 화면에서
// "이미 만들어진 방 고르기"를 보여주는 데 써요.
app.get('/rooms', (req, res) => {
  const list = Object.keys(rooms)
    .filter(code => Object.keys(rooms[code].players).length > 0)
    .map(code => ({ code, players: Object.keys(rooms[code].players).length }))
    .sort((a, b) => b.players - a.players);
  res.json(list);
});

// 방(room) 하나마다: 참가자 목록, 현재 떠있는 물고기, 라운드 타이머 등을 저장해요
const rooms = {};

const ROUND_SECONDS = 60;
const RESET_DELAY_MS = 6000; // 라운드가 끝나고 이만큼 기다렸다가 새 라운드를 시작해요
const MAX_ROOMS = 200; // 방이 너무 많이 만들어지는 걸 막아요
const MAX_PLAYERS_PER_ROOM = 20; // 방 하나에 너무 많은 사람이 몰리는 걸 막아요

// 물고기가 화면을 가로지르는 시간(ms)을 정하는 기준이에요.
// 실제 화면 폭은 친구마다 다르지만(핸드폰/모니터), 이 "시간"만큼은 모두가 똑같이 써야
// 서버가 물고기를 지우는 시점과 친구들 화면이 어긋나지 않아요.
const FISH_DURATION_REFERENCE_PX = 1380; // 평범한 화면 폭(1280) + 여유값
function fishDurationMs(speed){
  return (FISH_DURATION_REFERENCE_PX / (speed * 40)) * 1000;
}

// 단계(레벨) 설정: 방에서 가장 점수가 높은 친구를 기준으로 다 같이 단계가 올라가요
// (index.html의 levelStages와 맞춰뒀어요)
const levelStages = [
  { level: 1, upTo: 30, spawnMs: 700 },
  { level: 2, upTo: 60, spawnMs: 550 },
  { level: 3, upTo: 100, spawnMs: 420 },
];

function getLevelForScore(s){
  for(const stage of levelStages){
    if(s < stage.upTo) return stage;
  }
  return levelStages[levelStages.length - 1];
}

// 보물통을 열면 이 중에서 하나가 랜덤으로 나와요 (index.html의 lootItems와 맞춰뒀어요)
const lootItems = ['반짝이는 진주', '오래된 금화', '인어의 머리핀', '신비한 조개껍질', '작은 다이아몬드', '보물지도 조각', '산호 장식품', '용왕님의 반지'];

// 일반적으로 헤엄쳐 다니는 물고기들 (index.html의 fishTypes와 맞춰뒀어요)
const fishTypes = [
  { emoji: "🐳", points: 15, speed: 1.6, chance: 5, label: "", name: "고래" },
  { emoji: "🦈", points: 10, speed: 4.2, chance: 8, label: "", name: "상어" },
  { emoji: "🐡", points: 7,  speed: 3.0, chance: 6, label: "", name: "가오리" },
  { emoji: "🐙", points: 6,  speed: 2.6, chance: 7, label: "", name: "문어" },
  { emoji: "🐟", points: 5,  speed: 3.2, chance: 9, label: "", name: "참치" },
  { emoji: "🦀", points: 2,  speed: 2.0, chance: 6, label: "", name: "게" },
  { emoji: "🐚", points: 3,  speed: 1.8, chance: 7, label: "", name: "조개" },
  { emoji: "⭐", points: 1,  speed: 1.4, chance: 5, label: "", name: "불가사리" },
  { emoji: "🦐", points: 1,  speed: 2.4, chance: 8, label: "", name: "새우" },
  { emoji: "📦", points: 0,  speed: 2.2, chance: 6, label: "", name: "보물통", isTreasure: true, minBonus: 5, maxBonus: 15 },
  { emoji: "🧲", points: 0,  speed: 2.2, chance: 5, label: "", name: "자석", isMagnet: true, magnetMs: 6000 },
  { emoji: "⏰", points: 0,  speed: 2.2, chance: 5, label: "", name: "시계", isTimeBonus: true, timeBonus: 5 },
  { emoji: "🪼", points: -4, speed: 2.6, chance: 6, label: "", name: "해파리" },
  { emoji: "🦠", points: -6, speed: 1.8, chance: 5, label: "", name: "오염물" },
  { emoji: "🥾", points: 0,  speed: 2.0, chance: 6, label: "꽝! 헌 신발이에요 😅", name: "헌 신발" },
  { emoji: "🗑️", points: 0, speed: 2.0, chance: 6, label: "꽝! 쓰레기예요 🙈", name: "쓰레기" },
];

// 보스는 평소엔 나오지 않고, scheduleBossForRoom이 따로 등장시켜요
const bossType = { emoji: "🦑", points: 40, speed: 1.2, chance: 0, label: "", name: "보스 오징어", isBoss: true };

function pickFishType(){
  const total = fishTypes.reduce((s, f) => s + f.chance, 0);
  let r = Math.random() * total;
  for(const f of fishTypes){
    if(r < f.chance) return f;
    r -= f.chance;
  }
  return fishTypes[0];
}

// 방 코드는 대소문자/앞뒤 공백뿐 아니라 중간 공백도 무시해서, 친구끼리 코드를
// 살짝 다르게 입력해도(예: "HOYA 123" vs "HOYA123") 같은 방으로 만나게 해줘요
function normalizeRoomCode(raw){
  const str = typeof raw === 'string' ? raw : String(raw || '');
  const cleaned = str.toUpperCase().replace(/\s+/g, '');
  return cleaned || 'DEFAULT';
}

function normalizeName(raw){
  const str = typeof raw === 'string' ? raw : String(raw || '');
  return (str.trim() || '친구').slice(0, 12);
}

function getRoom(code){
  if(!rooms[code]){
    rooms[code] = {
      players: {},
      fish: {},
      fishIdCounter: 0,
      spawnTimer: null,
      bossTimer: null,
      timerInterval: null,
      rivalTimer: null,
      weatherTimer: null,
      weatherEndTimer: null,
      resetTimer: null,
      activeWeather: null, // 'storm' | 'snow' | null
      timeLeft: ROUND_SECONDS,
      started: false,
      currentLevel: 1,
      levelSpawnMs: levelStages[0].spawnMs,
    };
  }
  return rooms[code];
}

function spawnFishForRoom(code){
  const room = rooms[code];
  if(!room) return;

  const type = pickFishType();
  const id = 'f' + (room.fishIdCounter++);
  const fromLeft = Math.random() < 0.5;
  const y = 0.2 + Math.random() * 0.55;
  const durationMs = fishDurationMs(type.speed);
  const fishData = { id, type, fromLeft, y, startTime: Date.now(), durationMs };
  room.fish[id] = fishData;
  io.to(code).emit('fishSpawn', fishData);

  setTimeout(() => {
    if(room.fish[id]){
      delete room.fish[id];
      io.to(code).emit('fishExpire', { id });
    }
  }, durationMs);
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
  const fromLeft = Math.random() < 0.5;
  const y = 0.25 + Math.random() * 0.5;
  const durationMs = fishDurationMs(bossType.speed);
  const fishData = { id, type: bossType, fromLeft, y, startTime: Date.now(), durationMs };
  room.fish[id] = fishData;
  io.to(code).emit('fishSpawn', fishData);

  setTimeout(() => {
    if(room.fish[id]){
      delete room.fish[id];
      io.to(code).emit('fishExpire', { id });
      scheduleBossForRoom(code); // 보스가 도망가면 다음 보스를 또 예약해요
    }
  }, durationMs);
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
  const stealable = Object.values(room.fish).filter(f => !f.type.isBoss);
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

  applySpawnRate(code);
  io.to(code).emit('weatherEvent', { kind, durationMs: duration });

  clearTimeout(room.weatherEndTimer);
  room.weatherEndTimer = setTimeout(() => {
    room.activeWeather = null;
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
  room.timeLeft = ROUND_SECONDS; // 다음 라운드를 기다리는 동안 누가 들어와도 0초로 보이지 않게

  // 폭풍우/눈이 오던 중이었다면 친구들 화면에서도 정리해줘요
  if(room.activeWeather){
    io.to(code).emit('weatherEvent', { kind: room.activeWeather + 'End' });
    room.activeWeather = null;
  }

  // 화면에 남아있던 물고기를 모두 치워요
  Object.keys(room.fish).forEach(id => io.to(code).emit('fishExpire', { id }));
  room.fish = {};

  io.to(code).emit('roundEnded', { players: room.players });

  room.resetTimer = setTimeout(() => startRound(code), RESET_DELAY_MS);
}

function startRound(code){
  const room = rooms[code];
  if(!room || Object.keys(room.players).length === 0) return; // 아무도 없으면 굳이 새 라운드를 시작 안 해요
  if(room.started) return; // 이미 라운드가 진행 중이면 다시 시작하지 않아요 (재입장 등으로 중복 시작되는 것 방지)

  clearTimeout(room.resetTimer);
  room.resetTimer = null;

  room.timeLeft = ROUND_SECONDS;
  room.started = true;
  room.currentLevel = 1;
  room.levelSpawnMs = levelStages[0].spawnMs;
  room.activeWeather = null;
  Object.values(room.players).forEach(p => p.score = 0);

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

io.on('connection', (socket) => {
  socket.on('joinRoom', (payload) => {
    const code = normalizeRoomCode(payload && payload.roomCode);
    const name = normalizeName(payload && payload.name);

    // 방이 너무 많거나(새 방인 경우) 한 방에 사람이 너무 많이 몰려있으면 못 들어오게 해요
    if(!rooms[code] && Object.keys(rooms).length >= MAX_ROOMS){
      socket.emit('joinError', { message: '지금은 방이 너무 많아서 새 방을 열 수 없어요. 잠시 후 다시 시도해주세요.' });
      return;
    }
    const room = getRoom(code);
    if(Object.keys(room.players).length >= MAX_PLAYERS_PER_ROOM){
      socket.emit('joinError', { message: '이 방은 이미 친구들로 가득 찼어요. 다른 방 코드를 써보세요!' });
      return;
    }

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.name = name;
    room.players[socket.id] = { name, score: 0 };

    if(!room.started){
      startRound(code);
    }

    socket.emit('roomState', {
      code,
      players: room.players,
      fish: Object.values(room.fish).map(f => ({ ...f, elapsedMs: Date.now() - f.startTime })),
      timeLeft: room.timeLeft,
      level: room.currentLevel,
    });
    io.to(code).emit('playerListUpdate', room.players);
  });

  socket.on('catchAttempt', (payload) => {
    const fishId = payload && typeof payload.fishId === 'string' ? payload.fishId : null;
    if(!fishId) return;

    const code = socket.data.roomCode;
    const room = rooms[code];
    if(!room) return;

    const fish = room.fish[fishId];
    if(!fish) return;

    delete room.fish[fishId];
    const player = room.players[socket.id];
    const type = fish.type;

    let earnedPoints = type.points;
    let lootName = null;

    if(type.isTreasure){
      earnedPoints = Math.floor(Math.random() * (type.maxBonus - type.minBonus + 1)) + type.minBonus;
      lootName = lootItems[Math.floor(Math.random() * lootItems.length)];
    }

    if(type.isTimeBonus){
      // 시계는 방 전체가 같이 쓰는 시간을 늘려줘요
      room.timeLeft += type.timeBonus;
      broadcastTime(code);
    }

    if(player){
      player.score += earnedPoints;
      if(player.score < 0) player.score = 0;
      checkLevelUpForRoom(code);
    }

    io.to(code).emit('fishCaught', {
      fishId,
      by: player ? player.name : '???',
      byId: socket.id, // 이름이 겹쳐도 정확히 "누가" 잡았는지 클라이언트가 판별할 수 있게
      name: type.name, // 도감(caughtLog) 기록용
      points: earnedPoints,
      emoji: type.emoji,
      isTreasure: !!type.isTreasure,
      isMagnet: !!type.isMagnet,
      isTimeBonus: !!type.isTimeBonus,
      isBoss: !!type.isBoss,
      label: type.label || '',
      lootName,
    });
    io.to(code).emit('playerListUpdate', room.players);

    if(type.isBoss) scheduleBossForRoom(code); // 보스를 잡았으니 다음 보스를 예약해요
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if(room){
      delete room.players[socket.id];
      io.to(code).emit('playerListUpdate', room.players);
      if(Object.keys(room.players).length === 0){
        clearInterval(room.spawnTimer);
        clearInterval(room.timerInterval);
        clearTimeout(room.bossTimer);
        clearTimeout(room.rivalTimer);
        clearTimeout(room.weatherTimer);
        clearTimeout(room.weatherEndTimer);
        clearTimeout(room.resetTimer);
        delete rooms[code];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('서버 실행 중: 포트 ' + PORT));
