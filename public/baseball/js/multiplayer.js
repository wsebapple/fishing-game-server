/* ------------------------------------------------------
   서버와의 실시간 통신을 전담해요. 이 게임은 온라인 대전이
   전부라서(오프라인 연습 모드 없음) 접속하자마자 방에 들어가요.
------------------------------------------------------ */
function getMpServerUrl() { return window.location.protocol === 'file:' ? '' : window.location.origin; }

function loadSocketIoScript(callback) {
  if (window.io) { callback(); return; }
  const script = document.createElement('script');
  script.src = getMpServerUrl() + '/socket.io/socket.io.js';
  script.onload = callback;
  script.onerror = () => { Game.mp.connecting = false; $('joinStatus').textContent = '서버에 연결할 수 없어요.'; };
  document.head.appendChild(script);
}

function joinRoom() {
  if (Game.mp.connecting) return;
  const url = getMpServerUrl();
  if (!url) { $('joinStatus').textContent = '파일로 직접 열면 온라인 기능을 쓸 수 없어요. 서버 주소로 접속해주세요.'; return; }
  const name = $('nameInput').value.trim().slice(0, 12) || '선수';
  const roomCode = $('roomInput').value.trim() || 'default';
  Game.mp.connecting = true;
  $('joinStatus').textContent = '연결하는 중...';
  loadSocketIoScript(() => {
    if (Game.mp.socket) { Game.mp.socket.disconnect(); Game.mp.socket = null; }
    const socket = Game.mp.socket = io(url, { transports: ['websocket'] });
    wireSocket(socket, name, roomCode);
  });
}

function wireSocket(socket, name, roomCode) {
  socket.on('connect', () => {
    Game.mp.connecting = false;
    Game.state.myId = socket.id;
    socket.emit('baseball:joinRoom', { roomCode, name });
  });

  socket.on('baseball:joinError', payload => {
    Game.mp.connecting = false;
    $('joinStatus').textContent = payload.message;
    socket.disconnect();
  });

  socket.on('baseball:roomState', payload => {
    Game.state.roomCode = payload.code;
    Game.state.mySide = payload.mySide;
    Game.state.players = payload.players;
    Game.state.game = payload.game;
    Game.state.atBat = payload.atBat;
    if (payload.game && payload.game.status === 'in_progress') {
      renderScoreboard();
      resetAtBatControls();
      showScreen('game');
      if (payload.atBat) startTurnTimer(payload.atBat.deadline);
    } else {
      showScreen('team');
      renderPlayerListStatus();
    }
  });

  socket.on('baseball:playerListUpdate', players => {
    Game.state.players = players;
    if (players[Game.state.myId]) Game.state.mySide = players[Game.state.myId].side;
    if (Game.state.screen === 'team') renderPlayerListStatus();
  });

  socket.on('baseball:gameStart', payload => {
    Game.state.game = payload.game;
    $('playLog').innerHTML = '';
    addLog(`⚾ 경기 시작! ${payload.game.teams.away.name} vs ${payload.game.teams.home.name}`);
    renderScoreboard();
    showScreen('game');
  });

  socket.on('baseball:atBatStart', payload => {
    Game.state.atBat = payload;
    Game.state.game = payload.game;
    renderScoreboard();
    resetAtBatControls();
    startTurnTimer(payload.deadline);
  });

  socket.on('baseball:atBatResult', payload => {
    stopTurnTimer();
    Game.state.game = payload.game;
    Game.state.submitted = true;
    renderControls();
    renderScoreboard();
    let mainLabel = null;
    payload.events.forEach(event => {
      const label = Game.config.RESULT_LABELS[event.type];
      if (!label) return;
      addLog(label + (event.runs ? ` (+${event.runs}점)` : ''));
      mainLabel = label;
    });
    if (mainLabel) showResultBanner(mainLabel);
  });

  socket.on('baseball:gameOver', payload => {
    stopTurnTimer();
    if (payload.score) Game.state.game = { ...Game.state.game, score: payload.score };
    renderEndScreen(payload);
  });

  socket.on('baseball:opponentLeft', () => addLog('상대가 방을 나갔어요.'));

  socket.on('baseball:rematchVoteUpdate', payload => {
    const count = payload.votes.length;
    $('rematchStatus').textContent = count >= 2 ? '재대결을 시작해요!' : `재대결 대기 중... (${count}/2)`;
  });

  socket.on('disconnect', () => {
    stopTurnTimer();
    if (Game.state.screen !== 'join') $('joinStatus').textContent = '연결이 끊어졌어요.';
    $('joinStatus').textContent = '연결이 끊어졌어요. 새로고침해서 다시 입장해주세요.';
  });
}

function onReady() {
  const team = {
    name: $('teamNameInput').value.trim() || '우리팀',
    color: $('teamColorInput').value,
    emoji: Game.state.selectedEmoji,
    ratings: currentRatings(),
  };
  Game.mp.socket.emit('baseball:setTeam', team);
  $('readyBtn').disabled = true;
  $('teamWaitStatus').textContent = '상대를 기다리는 중...';
}

function onConfirm() {
  if (Game.state.submitted) return;
  const role = myRole();
  if (role !== 'pitcher' && role !== 'batter') return;
  if (!Game.state.selectedZone) { $('roleBanner').textContent = '먼저 코스를 하나 찍어주세요!'; return; }
  if (role === 'pitcher') {
    Game.mp.socket.emit('baseball:submitPitch', {
      atBatId: Game.state.atBat.atBatId, pitchType: Game.state.selectedPitchType, targetZone: Game.state.selectedZone,
    });
  } else {
    Game.mp.socket.emit('baseball:submitSwing', {
      atBatId: Game.state.atBat.atBatId,
      swing: { zone: Game.state.selectedZone, pitchType: Game.state.selectedPitchType, mode: Game.state.selectedMode },
    });
  }
  Game.state.submitted = true;
  renderControls();
}

function onTake() {
  if (Game.state.submitted || myRole() !== 'batter') return;
  Game.mp.socket.emit('baseball:submitSwing', { atBatId: Game.state.atBat.atBatId, swing: null });
  Game.state.submitted = true;
  renderControls();
}

function onRematch() {
  Game.mp.socket.emit('baseball:requestRematch');
  $('rematchBtn').disabled = true;
  $('rematchStatus').textContent = '재대결 신청했어요! 상대를 기다리는 중...';
}

document.addEventListener('DOMContentLoaded', () => {
  initEmojiPicker();
  initStatSliders();
  $('emojiSelected').textContent = Game.state.selectedEmoji;
  $('joinBtn').addEventListener('click', joinRoom);
  $('readyBtn').addEventListener('click', onReady);
  $('confirmBtn').addEventListener('click', onConfirm);
  $('takeBtn').addEventListener('click', onTake);
  $('rematchBtn').addEventListener('click', onRematch);
});
