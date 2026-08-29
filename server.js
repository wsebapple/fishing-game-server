// 낚시게임 멀티플레이 서버
// 여러 친구가 같은 "방 코드"로 들어오면, 서버가 물고기를 생성해서
// 모두에게 똑같이 보여주고, 누가 먼저 잡는지 판정해줘요.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// public 폴더 안의 게임 파일(index.html 등)을 그대로 보여줘요
app.use(express.static('public'));

// 방(room) 하나마다: 참가자 목록, 현재 떠있는 물고기, 스폰 타이머를 저장해요
const rooms = {};

const fishTypes = [
  { emoji: "🐳", points: 15, speed: 1.6, chance: 5,  name: "고래" },
  { emoji: "🦈", points: 10, speed: 4.2, chance: 8,  name: "상어" },
  { emoji: "🐡", points: 7,  speed: 3.0, chance: 6,  name: "가오리" },
  { emoji: "🐙", points: 6,  speed: 2.6, chance: 7,  name: "문어" },
  { emoji: "🐟", points: 5,  speed: 3.2, chance: 9,  name: "참치" },
  { emoji: "🦀", points: 2,  speed: 2.0, chance: 8,  name: "게" },
  { emoji: "🐚", points: 3,  speed: 1.8, chance: 9,  name: "조개" },
  { emoji: "⭐", points: 1,  speed: 1.4, chance: 8,  name: "불가사리" },
  { emoji: "🦐", points: 1,  speed: 2.4, chance: 14, name: "새우" },
  { emoji: "🥾", points: 0,  speed: 2.0, chance: 6,  name: "헌 신발" },
  { emoji: "🗑️", points: 0, speed: 2.0, chance: 6,  name: "쓰레기" },
];

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
    rooms[code] = { players: {}, fish: {}, fishIdCounter: 0, spawnTimer: null };
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

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomCode, name }) => {
    const code = (roomCode || 'default').toUpperCase().trim();
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.name = (name || '친구').slice(0, 12);

    const room = getRoom(code);
    room.players[socket.id] = { name: socket.data.name, score: 0 };

    if(!room.spawnTimer){
      room.spawnTimer = setInterval(() => spawnFishForRoom(code), 900);
    }

    socket.emit('roomState', {
      players: room.players,
      fish: Object.values(room.fish),
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
    if(player) player.score += fish.type.points;

    io.to(code).emit('fishCaught', {
      fishId,
      by: player ? player.name : '???',
      points: fish.type.points,
      emoji: fish.type.emoji,
    });
    io.to(code).emit('playerListUpdate', room.players);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if(room){
      delete room.players[socket.id];
      io.to(code).emit('playerListUpdate', room.players);
      if(Object.keys(room.players).length === 0){
        clearInterval(room.spawnTimer);
        delete rooms[code];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('서버 실행 중: 포트 ' + PORT));