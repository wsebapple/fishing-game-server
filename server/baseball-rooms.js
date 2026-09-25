// 야구 게임의 방·턴 관리예요. 실제 판정 규칙은 전혀 모르고(server/baseball.js가 담당),
// "누가 지금 투수/타자인지", "둘 다 제출했으면 판정하고 다음 타석으로 넘기기" 같은
// 진행(흐름)만 맡아요 — 낚시 게임의 server/rooms.js와 같은 역할이에요.
const { createInitialState, resolvePitch, applyAtBatResult, normalizeTeam, clampZone } = require('./baseball');

const MAX_ROOMS = 200;
const MAX_PLAYERS_PER_ROOM = 2; // 야구는 정확히 두 명(원정/홈)이 대전해요 - 관전은 아직 없어요
const DEFAULT_TURN_MS = 15000; // 투수가 코스를 정하고 타자가 노려볼 시간
const FORCE_RESOLVE_GRACE_MS = 400; // 네트워크 지연을 감안해 타이머보다 살짝 여유를 둬요

function normalizeRoomCode(raw) {
  if (raw != null && typeof raw !== 'string') return null;
  const cleaned = (raw || '').toUpperCase().replace(/\s+/g, '') || 'DEFAULT';
  return /^[A-Z0-9가-힣_-]{1,24}$/.test(cleaned) ? cleaned : null;
}

function normalizeName(raw) {
  const str = typeof raw === 'string' ? raw : String(raw || '');
  const cleaned = str.trim().replace(/\p{C}/gu, '').trim();
  return Array.from(cleaned || '친구').slice(0, 12).join('');
}

function createBaseballRooms(io, options = {}) {
  const TURN_MS = options.turnMs || DEFAULT_TURN_MS; // 테스트에서 턴 시간을 짧게 줄여 타임아웃 경로를 검증할 수 있게 해요
  const rooms = Object.create(null);

  function getRoom(code) {
    if (!rooms[code]) {
      rooms[code] = {
        players: {}, // socketId -> { name, side: 'away'|'home'|null, team, ready }
        game: null,
        atBatId: 0,
        pending: null, // { atBatId, pitch, pitchSubmitted, swing, swingSubmitted }
        turnTimer: null,
        turnDeadline: 0,
        rematchVotes: new Set(),
      };
    }
    return rooms[code];
  }

  function publicPlayers(room) {
    const out = {};
    for (const [id, p] of Object.entries(room.players)) out[id] = { name: p.name, side: p.side, team: p.team, ready: p.ready };
    return out;
  }

  function sideSocketId(room, side) {
    return Object.keys(room.players).find(id => room.players[id].side === side) || null;
  }

  function assignSide(room, socketId) {
    const existing = room.players[socketId];
    if (existing && existing.side) return existing.side;
    const taken = new Set(Object.values(room.players).map(p => p.side).filter(Boolean));
    if (!taken.has('away')) return 'away';
    if (!taken.has('home')) return 'home';
    return null;
  }

  function currentPitcherId(room) { return sideSocketId(room, room.game.half === 'top' ? 'home' : 'away'); }
  function currentBatterId(room) { return sideSocketId(room, room.game.half === 'top' ? 'away' : 'home'); }

  function clearTurnTimer(room) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
    room.turnDeadline = 0;
  }

  function bothTeamsReady(room) {
    const away = sideSocketId(room, 'away');
    const home = sideSocketId(room, 'home');
    return !!(away && home && room.players[away].ready && room.players[home].ready);
  }

  function getSnapshot(code) {
    const room = rooms[code];
    if (!room) return null;
    return {
      players: publicPlayers(room),
      game: room.game,
      atBat: room.game && room.game.status === 'in_progress'
        ? { atBatId: room.atBatId, pitcherId: currentPitcherId(room), batterId: currentBatterId(room), deadline: room.turnDeadline }
        : null,
    };
  }

  function setTeam(code, socketId, teamInput) {
    const room = rooms[code];
    if (!room || !room.players[socketId] || room.game) return false;
    room.players[socketId].team = normalizeTeam(teamInput);
    room.players[socketId].ready = true;
    return true;
  }

  function startAtBat(code) {
    const room = rooms[code];
    if (!room || !room.game || room.game.status === 'finished') return;
    clearTurnTimer(room);
    room.atBatId++;
    room.pending = { atBatId: room.atBatId, pitch: null, pitchSubmitted: false, swing: null, swingSubmitted: false };
    room.turnDeadline = Date.now() + TURN_MS;
    io.to(code).emit('baseball:atBatStart', {
      atBatId: room.atBatId,
      pitcherId: currentPitcherId(room),
      batterId: currentBatterId(room),
      game: room.game,
      deadline: room.turnDeadline,
    });
    room.turnTimer = setTimeout(() => forceResolveAtBat(code), TURN_MS + FORCE_RESOLVE_GRACE_MS);
  }

  function settleAtBat(code) {
    const room = rooms[code];
    if (!room || !room.pending || !room.game) return;
    clearTurnTimer(room);
    const pending = room.pending;
    room.pending = null; // 늦게 도착한 제출이 같은 타석을 두 번 판정하지 않게 바로 비워요
    const pitcherId = currentPitcherId(room);
    const batterId = currentBatterId(room);
    const pitcherTeam = room.players[pitcherId] && room.players[pitcherId].team;
    const batterTeam = room.players[batterId] && room.players[batterId].team;

    const outcome = resolvePitch({
      pitchType: pending.pitch.pitchType,
      targetZone: pending.pitch.targetZone,
      swing: pending.swing,
      pitcherRatings: pitcherTeam && pitcherTeam.ratings,
      batterRatings: batterTeam && batterTeam.ratings,
    }, Math.random);

    const { state, events } = applyAtBatResult(room.game, outcome, Math.random);
    room.game = state;
    io.to(code).emit('baseball:atBatResult', { atBatId: pending.atBatId, outcome, events, game: state });

    if (state.status === 'finished') {
      io.to(code).emit('baseball:gameOver', { winner: state.winner, score: state.score });
      return;
    }
    startAtBat(code);
  }

  function forceResolveAtBat(code) {
    const room = rooms[code];
    if (!room || !room.pending) return;
    if (!room.pending.pitchSubmitted) {
      room.pending.pitch = { pitchType: 'fastball', targetZone: { x: 2, y: 2 } };
      room.pending.pitchSubmitted = true;
    }
    if (!room.pending.swingSubmitted) {
      room.pending.swing = null; // 시간 초과면 그냥 지켜봐요(스윙 안 함)
      room.pending.swingSubmitted = true;
    }
    settleAtBat(code);
  }

  function maybeResolve(code) {
    const room = rooms[code];
    if (room && room.pending && room.pending.pitchSubmitted && room.pending.swingSubmitted) settleAtBat(code);
  }

  function submitPitch(code, socketId, atBatId, pitchType, targetZone) {
    const room = rooms[code];
    if (!room || !room.pending || !room.game) return;
    if (room.pending.atBatId !== atBatId || room.pending.pitchSubmitted) return;
    if (currentPitcherId(room) !== socketId) return;
    room.pending.pitch = { pitchType, targetZone: clampZone(targetZone) };
    room.pending.pitchSubmitted = true;
    maybeResolve(code);
  }

  function submitSwing(code, socketId, atBatId, swing) {
    const room = rooms[code];
    if (!room || !room.pending || !room.game) return;
    if (room.pending.atBatId !== atBatId || room.pending.swingSubmitted) return;
    if (currentBatterId(room) !== socketId) return;
    room.pending.swing = swing;
    room.pending.swingSubmitted = true;
    maybeResolve(code);
  }

  function tryStartGame(code) {
    const room = rooms[code];
    if (!room || room.game || !bothTeamsReady(room)) return;
    const awayId = sideSocketId(room, 'away');
    const homeId = sideSocketId(room, 'home');
    room.game = createInitialState(room.players[awayId].team, room.players[homeId].team);
    room.atBatId = 0;
    io.to(code).emit('baseball:gameStart', { game: room.game, awayId, homeId });
    startAtBat(code);
  }

  function requestRematch(code, socketId) {
    const room = rooms[code];
    if (!room || !room.players[socketId] || !room.game || room.game.status !== 'finished') return;
    room.rematchVotes.add(socketId);
    io.to(code).emit('baseball:rematchVoteUpdate', { votes: [...room.rematchVotes] });
    if (room.rematchVotes.size >= 2 && Object.keys(room.players).length >= 2) {
      // 다음 판은 원정/홈을 서로 바꿔서 공평하게 시작해요
      for (const p of Object.values(room.players)) p.side = p.side === 'away' ? 'home' : 'away';
      room.rematchVotes.clear();
      room.game = null;
      room.pending = null;
      io.to(code).emit('baseball:playerListUpdate', publicPlayers(room));
      tryStartGame(code);
    }
  }

  function removePlayer(code, id) {
    const room = rooms[code];
    if (!room) return;
    const leavingPlayer = room.players[id];
    delete room.players[id];
    io.to(code).emit('baseball:playerListUpdate', publicPlayers(room));

    if (leavingPlayer && leavingPlayer.side && room.game && room.game.status === 'in_progress') {
      clearTurnTimer(room);
      room.pending = null;
      const remaining = Object.values(room.players)[0];
      room.game = { ...room.game, status: 'finished', winner: remaining ? remaining.side : null };
      io.to(code).emit('baseball:opponentLeft', {});
      io.to(code).emit('baseball:gameOver', { winner: room.game.winner, score: room.game.score, forfeited: true });
    }

    if (Object.keys(room.players).length === 0) {
      clearTurnTimer(room);
      delete rooms[code];
    }
  }

  return {
    rooms, getRoom, publicPlayers, getSnapshot, assignSide, setTeam, tryStartGame,
    submitPitch, submitSwing, requestRematch, removePlayer,
    normalizeRoomCode, normalizeName, MAX_ROOMS, MAX_PLAYERS_PER_ROOM, TURN_MS,
  };
}

module.exports = { createBaseballRooms };
