const { canCatch } = require("./fish");
const { lootItems } = require('../public/fishing/game-config.json');
function attachSockets(io, api) {
const { rooms, getRoom, startRound, removePlayer, checkLevelUpForRoom, scheduleBossForRoom, broadcastTime, normalizeRoomCode, normalizeName, MAX_ROOMS, MAX_PLAYERS_PER_ROOM } = api;
io.on('connection', (socket) => {
  socket.on('joinRoom', (payload) => {
    const code = normalizeRoomCode(payload && payload.roomCode);
    const name = normalizeName(payload && payload.name);
    if (!code) { socket.emit('joinError', { message: '방 코드는 24자 이내의 한글, 영문, 숫자, _ 또는 -만 사용할 수 있어요.' }); return; }

    // 방이 너무 많거나(새 방인 경우) 한 방에 사람이 너무 많이 몰려있으면 못 들어오게 해요
    if(!rooms[code] && Object.keys(rooms).length >= MAX_ROOMS){
      socket.emit('joinError', { message: '지금은 방이 너무 많아서 새 방을 열 수 없어요. 잠시 후 다시 시도해주세요.' });
      return;
    }
    const room = getRoom(code);
    if(Object.keys(room.players).length >= MAX_PLAYERS_PER_ROOM && !room.players[socket.id]){
      socket.emit('joinError', { message: '이 방은 이미 친구들로 가득 찼어요. 다른 방 코드를 써보세요!' });
      return;
    }

    if (socket.data.roomCode && socket.data.roomCode !== code) {
      socket.leave(socket.data.roomCode);
      removePlayer(socket.data.roomCode, socket.id);
    }
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.name = name;
    socket.data.position = null;
    socket.data.magnetUntil = 0;
    if (!room.players[socket.id]) room.players[socket.id] = { name, score: 0 };
    else room.players[socket.id].name = name;

    if(!room.started && !room.resetTimer){
      startRound(code);
    }

    socket.emit('roomState', {
      code,
      players: room.players,
      fish: Object.values(room.fish).map(f => ({ ...f, elapsedMs: Date.now() - f.startTime })),
      timeLeft: room.timeLeft,
      level: room.currentLevel,
      started: room.started,
      activeWeather: room.activeWeather,
      weatherRemainingMs: Math.max(0, room.weatherEndsAt - Date.now()),
      resetRemainingMs: !room.started && room.resetEndsAt ? Math.max(0, room.resetEndsAt - Date.now()) : 0,
    });
    io.to(code).emit('playerListUpdate', room.players);
  });

  socket.on('catchAttempt', (payload) => {
    const fishId = payload && typeof payload.fishId === 'string' && /^f\d+$|^boss\d+$/.test(payload.fishId) ? payload.fishId : null;
    if(!fishId) return;

    const code = socket.data.roomCode;
    const room = rooms[code];
    if(!room || !room.started || !room.players[socket.id] || !socket.rooms.has(code)) return;

    const fish = Object.hasOwn(room.fish, fishId) ? room.fish[fishId] : null;
    if (!fish) { socket.emit('catchRejected', { fishId }); return; }
    const now = Date.now();
    const viewElapsedMs = Number.isFinite(payload.viewElapsedMs) ? payload.viewElapsedMs : undefined;
    if (!canCatch(fish, socket.data.position, now, socket.data.magnetUntil, viewElapsedMs)) {
      socket.emit('catchRejected', { fishId });
      return;
    }

    const type = fish.type;

    if(type.isBoss){
      fish.hitsLanded = (fish.hitsLanded || 0) + 1;
      fish.invulnerableUntil = now + 1500;
      if(fish.hitsLanded < fish.hitsNeeded){
        fish.seed = (fish.seed + 0.371) % 1;
        // 아직 다 안 잡혔어요: 도망 연출을 내고 도망가요. 물고기는 그대로 살아있어요.
        // byId를 같이 보내서, 고래의 넉백이나 바다용의 감전 같은 "때린 사람에게만" 적용되는
        // 효과를 클라이언트가 정확히 나인지 구분할 수 있게 해요.
        io.to(code).emit('bossInked', { id: fishId, seed: fish.seed, byId: socket.id, hitsLanded: fish.hitsLanded, hitsNeeded: fish.hitsNeeded });
        return;
      }
    }

    delete room.fish[fishId];
    const player = room.players[socket.id];

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
    if (type.isMagnet) socket.data.magnetUntil = now + type.magnetMs;

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

  socket.on('boatMove', (payload) => {
    // 내 배가 어디 있는지 같은 방 친구들한테만 살짝 알려줘요 (나한테는 다시 안 보내요)
    const code = socket.data.roomCode;
    if(!code) return;
    const xRatio = payload && payload.xRatio;
    const yRatio = payload && payload.yRatio;
    const width = payload && payload.width, height = payload && payload.height;
    // 화면 크기는 판정 계산에만 쓰니 말이 되는 양수면 다 받아요 (아주 넓은 모니터나 좁은 창도 못 잡는 일이 없게)
    if (![xRatio, yRatio, width, height].every(Number.isFinite) || xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1 || width <= 0 || width > 16384 || height <= 0 || height > 16384) return;
    // yRatio(낚싯바늘이 얼마나 내려가 있는지)도 같이 알려줘서, 친구들 화면에 낚싯줄까지 보이게 해요
    socket.data.position = { xRatio, yRatio, width, height, at: Date.now() };
    socket.to(code).emit('boatMove', { id: socket.id, xRatio, yRatio });
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (code) removePlayer(code, socket.id);
  });
});
}
module.exports = { attachSockets };
