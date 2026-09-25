const { PITCH_TYPES } = require('./baseball');

function allow(socket, key, maxPerSec) {
  const now = Date.now();
  const rate = socket.data.baseballRate || (socket.data.baseballRate = Object.create(null));
  let bucket = rate[key];
  if (!bucket || now - bucket.windowStart >= 1000) bucket = rate[key] = { windowStart: now, count: 0 };
  bucket.count++;
  return bucket.count <= maxPerSec;
}

function attachBaseballSockets(io, api) {
  const {
    rooms, getRoom, publicPlayers, getSnapshot, setTeam, tryStartGame,
    submitPitch, submitSwing, requestRematch, removePlayer,
    normalizeRoomCode, normalizeName, MAX_ROOMS, MAX_PLAYERS_PER_ROOM,
  } = api;

  io.on('connection', (socket) => {
    socket.on('baseball:joinRoom', (payload) => {
      if (!allow(socket, 'joinRoom', 5)) return;
      const code = normalizeRoomCode(payload && payload.roomCode);
      const name = normalizeName(payload && payload.name);
      if (!code) { socket.emit('baseball:joinError', { message: '방 코드는 24자 이내의 한글, 영문, 숫자, _ 또는 -만 사용할 수 있어요.' }); return; }

      if (!rooms[code] && Object.keys(rooms).length >= MAX_ROOMS) {
        socket.emit('baseball:joinError', { message: '지금은 방이 너무 많아서 새 방을 열 수 없어요. 잠시 후 다시 시도해주세요.' });
        return;
      }
      const room = getRoom(code);
      if (Object.keys(room.players).length >= MAX_PLAYERS_PER_ROOM && !room.players[socket.id]) {
        socket.emit('baseball:joinError', { message: '이 방은 이미 두 명이 꽉 찼어요. 다른 방 코드를 써보세요!' });
        return;
      }

      if (socket.data.baseballRoomCode && socket.data.baseballRoomCode !== code) {
        socket.leave(socket.data.baseballRoomCode);
        removePlayer(socket.data.baseballRoomCode, socket.id);
      }
      socket.join(code);
      socket.data.baseballRoomCode = code;

      if (!room.players[socket.id]) {
        const side = api.assignSide(room, socket.id);
        if (!side) { socket.emit('baseball:joinError', { message: '이 방은 이미 두 명이 꽉 찼어요. 다른 방 코드를 써보세요!' }); return; }
        room.players[socket.id] = { name, side, team: null, ready: false };
      } else {
        room.players[socket.id].name = name;
      }

      const snapshot = getSnapshot(code);
      socket.emit('baseball:roomState', { code, mySide: room.players[socket.id].side, ...snapshot });
      io.to(code).emit('baseball:playerListUpdate', publicPlayers(room));
    });

    socket.on('baseball:setTeam', (payload) => {
      if (!allow(socket, 'setTeam', 5)) return;
      const code = socket.data.baseballRoomCode;
      if (!code) return;
      const room = rooms[code];
      if (!room || !room.players[socket.id]) return;
      if (!setTeam(code, socket.id, payload)) return;
      io.to(code).emit('baseball:playerListUpdate', publicPlayers(room));
      tryStartGame(code);
    });

    socket.on('baseball:submitPitch', (payload) => {
      if (!allow(socket, 'submitPitch', 5)) return;
      const code = socket.data.baseballRoomCode;
      if (!code) return;
      const atBatId = Number(payload && payload.atBatId);
      const targetZone = payload && payload.targetZone;
      if (!Number.isFinite(atBatId) || !targetZone) return;
      const x = Number(targetZone.x), y = Number(targetZone.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const pitchType = PITCH_TYPES.includes(payload && payload.pitchType) ? payload.pitchType : 'fastball';
      submitPitch(code, socket.id, atBatId, pitchType, { x, y });
    });

    socket.on('baseball:submitSwing', (payload) => {
      if (!allow(socket, 'submitSwing', 5)) return;
      const code = socket.data.baseballRoomCode;
      if (!code) return;
      const atBatId = Number(payload && payload.atBatId);
      if (!Number.isFinite(atBatId)) return;
      let swing = null;
      const raw = payload && payload.swing;
      if (raw && raw.zone) {
        const x = Number(raw.zone.x), y = Number(raw.zone.y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          swing = {
            zone: { x, y },
            pitchType: PITCH_TYPES.includes(raw.pitchType) ? raw.pitchType : null,
            mode: raw.mode === 'power' ? 'power' : 'contact',
          };
        }
      }
      submitSwing(code, socket.id, atBatId, swing);
    });

    socket.on('baseball:requestRematch', () => {
      if (!allow(socket, 'requestRematch', 3)) return;
      const code = socket.data.baseballRoomCode;
      if (!code) return;
      requestRematch(code, socket.id);
    });

    socket.on('disconnect', () => {
      const code = socket.data.baseballRoomCode;
      if (code) removePlayer(code, socket.id);
    });
  });
}

module.exports = { attachBaseballSockets };
