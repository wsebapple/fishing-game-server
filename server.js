// 낚시게임 멀티플레이 서버
// 여러 친구가 같은 "방 코드"로 들어오면, 서버가 물고기를 생성해서
// 모두에게 똑같이 보여주고, 누가 먼저 잡는지 판정해줘요.
// (시간 흐름/자석/시계/보스 같은 특수 기능도 여기서 방 전체에 맞춰 돌려줘요)

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// public 폴더 안의 게임 파일(index.html 등)을 그대로 보여줘요
app.use(express.static('public'));

// 방(room) 하나마다: 참가자 목록, 현재 떠있는 물고기, 라운드 타이머 등을 저장해요
const rooms = {};

const ROUND_SECONDS = 60;
const RESET_DELAY_MS = 6000; // 라운드가 끝나고 이만큼 기다렸다가 새 라운드를 시작해요
const BASE_SPAWN_MS = 900;

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
      activeWeather: null, // 'storm' | 'snow' | null
      timeLeft: ROUND_SECONDS,
      started: false,
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
  const fishData = { id, type, fromLeft, y, startTime: Date.now() };
  room.fish[id] = fishData;
  io.to(code).emit('fishSpawn', fishData);

  const duration = 11000 / type.speed;
  setTimeout(() => {
    if(room.fish[id]){
      delete room.fish[id];
      io.to(code).emit('fishExpire', { id });
    }
  }, duration);
}

function scheduleBossForRoom(code){
  const room = rooms[code];
  if(!room) return;
  const delay = 22000 + Math.random() * 15000; // 22~37초마다 랜덤하게 보스 등장 (싱글플레이와 동일)
  room.bossTimer = setTimeout(() => spawnBossForRoom(code), delay);
}

function spawnBossForRoom(code){
  const room = rooms[code];
  if(!room) return;

  const id = 'boss' + (room.fishIdCounter++);
  const fromLeft = Math.random() < 0.5;
  const y = 0.25 + Math.random() * 0.5;
  const fishData = { id, type: bossType, fromLeft, y, startTime: Date.now() };
  room.fish[id] = fishData;
  io.to(code).emit('fishSpawn', fishData);

  const duration = 11000 / bossType.speed;
  setTimeout(() => {
    if(room.fish[id]){
      delete room.fish[id];
      io.to(code).emit('fishExpire', { id });
      scheduleBossForRoom(code); // 보스가 도망가면 다음 보스를 또 예약해요
    }
  }, duration);
}

function scheduleRivalForRoom(code){
  const room = rooms[code];
  if(!room) return;
  const delay = 6000 + Math.random() * 6000; // 6~12초마다 랜덤하게 등장 (싱글플레이와 동일)
  room.rivalTimer = setTimeout(() => tryStealForRoom(code), delay);
}

function tryStealForRoom(code){
  const room = rooms[code];
  if(!room) return;

  const fishList = Object.values(room.fish);
  if(fishList.length === 0){ scheduleRivalForRoom(code); return; }

  // 보물통이 떠 있으면 그것부터 노려요!
  const treasures = fishList.filter(f => f.type.isTreasure);
  const pool = treasures.length > 0 ? treasures : fishList;
  const target = pool[Math.floor(Math.random() * pool.length)];

  delete room.fish[target.id];
  io.to(code).emit('fishStolen', { id: target.id, name: target.type.name });

  scheduleRivalForRoom(code);
}

function scheduleWeatherForRoom(code){
  const room = rooms[code];
  if(!room) return;
  const delay = 18000 + Math.random() * 15000; // 18~33초마다 랜덤하게 날씨 이벤트
  room.weatherTimer = setTimeout(() => triggerWeatherForRoom(code), delay);
}

function triggerWeatherForRoom(code){
  const room = rooms[code];
  if(!room) return;

  const kind = Math.random() < 0.5 ? 'storm' : 'snow';
  room.activeWeather = kind;
  const spawnMs = kind === 'storm'
    ? Math.max(220, BASE_SPAWN_MS * 0.55)
    : BASE_SPAWN_MS * 1.25;
  const duration = kind === 'storm'
    ? 6000 + Math.random() * 3000
    : 7000 + Math.random() * 3000;

  clearInterval(room.spawnTimer);
  room.spawnTimer = setInterval(() => spawnFishForRoom(code), spawnMs);
  io.to(code).emit('weatherEvent', { kind, durationMs: duration });

  room.weatherEndTimer = setTimeout(() => {
    room.activeWeather = null;
    if(room.started){
      clearInterval(room.spawnTimer);
      room.spawnTimer = setInterval(() => spawnFishForRoom(code), BASE_SPAWN_MS);
    }
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
  room.spawnTimer = null;
  room.bossTimer = null;
  room.rivalTimer = null;
  room.weatherTimer = null;
  room.weatherEndTimer = null;
  room.started = false;

  // 폭풍우/눈이 오던 중이었다면 친구들 화면에서도 정리해줘요
  if(room.activeWeather){
    io.to(code).emit('weatherEvent', { kind: room.activeWeather + 'End' });
    room.activeWeather = null;
  }

  // 화면에 남아있던 물고기를 모두 치워요
  Object.keys(room.fish).forEach(id => io.to(code).emit('fishExpire', { id }));
  room.fish = {};

  io.to(code).emit('roundEnded', { players: room.players });

  setTimeout(() => startRound(code), RESET_DELAY_MS);
}

function startRound(code){
  const room = rooms[code];
  if(!room || Object.keys(room.players).length === 0) return; // 아무도 없으면 굳이 새 라운드를 시작 안 해요

  room.timeLeft = ROUND_SECONDS;
  room.started = true;
  Object.values(room.players).forEach(p => p.score = 0);

  io.to(code).emit('roundReset', { players: room.players, timeLeft: room.timeLeft });

  clearInterval(room.timerInterval);
  room.timerInterval = setInterval(() => {
    room.timeLeft--;
    broadcastTime(code);
    if(room.timeLeft <= 0){
      clearInterval(room.timerInterval);
      endRound(code);
    }
  }, 1000);

  clearInterval(room.spawnTimer);
  room.spawnTimer = setInterval(() => spawnFishForRoom(code), BASE_SPAWN_MS);
  scheduleBossForRoom(code);
  scheduleRivalForRoom(code);
  scheduleWeatherForRoom(code);
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomCode, name }) => {
    const code = (roomCode || 'default').toUpperCase().trim();
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.name = (name || '친구').slice(0, 12);

    const room = getRoom(code);
    room.players[socket.id] = { name: socket.data.name, score: 0 };

    if(!room.started){
      startRound(code);
    }

    socket.emit('roomState', {
      players: room.players,
      fish: Object.values(room.fish),
      timeLeft: room.timeLeft,
    });
    io.to(code).emit('playerListUpdate', room.players);
  });

  socket.on('catchAttempt', ({ fishId }) => {
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
    }

    io.to(code).emit('fishCaught', {
      fishId,
      by: player ? player.name : '???',
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
        delete rooms[code];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('서버 실행 중: 포트 ' + PORT));
