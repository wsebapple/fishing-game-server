/* ------------------------------------------------------
   화면 전환과 렌더링만 담당해요. 서버와 주고받는 통신은
   전부 multiplayer.js의 Game.actions.*를 통해서만 해요.
------------------------------------------------------ */
const $ = id => document.getElementById(id);

function showScreen(name) {
  Game.state.screen = name;
  document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
  $('screen-' + name).classList.remove('hidden');
}

function initEmojiPicker() {
  const wrap = $('emojiPicker');
  Game.config.EMOJIS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'chip'; btn.textContent = emoji;
    btn.addEventListener('click', () => {
      Game.state.selectedEmoji = emoji;
      $('emojiSelected').textContent = emoji;
    });
    wrap.appendChild(btn);
  });
}

function initStatSliders() {
  const ids = ['contact', 'power', 'control', 'stuff'];
  function updateBudget() {
    const total = ids.reduce((sum, id) => sum + Number($('stat' + capitalize(id)).value), 0);
    $('statBudget').textContent = `배분 합계: ${total} / 권장 16 이하`;
    $('statBudget').style.color = total > 16 ? 'var(--bad)' : 'var(--muted)';
  }
  function capitalize(s) { return s[0].toUpperCase() + s.slice(1); }
  ids.forEach(id => {
    const input = $('stat' + capitalize(id));
    input.addEventListener('input', () => { $('stat' + capitalize(id) + 'Val').textContent = input.value; updateBudget(); });
  });
  updateBudget();
}

function currentRatings() {
  return {
    contact: Number($('statContact').value), power: Number($('statPower').value),
    control: Number($('statControl').value), stuff: Number($('statStuff').value),
  };
}

function renderPlayerListStatus() {
  const players = Object.values(Game.state.players);
  const readyCount = players.filter(p => p.ready).length;
  if (players.length < 2) { $('teamWaitStatus').textContent = '친구가 들어오길 기다리는 중...'; return; }
  $('teamWaitStatus').textContent = readyCount < 2 ? '상대가 팀을 정하는 중...' : '경기를 시작해요!';
}

function inningLabel(game) { return `${game.inning}회${game.half === 'top' ? '초' : '말'}`; }

function renderPips(containerId, count, max, kind) {
  const el = $(containerId);
  el.innerHTML = '';
  for (let i = 0; i < max; i++) {
    const pip = document.createElement('span');
    pip.className = 'pip' + (i < count ? ' lit ' + kind : '');
    el.appendChild(pip);
  }
}

function renderScoreboard() {
  const game = Game.state.game;
  if (!game) return;
  const away = document.querySelector('.teamBox.away');
  const home = document.querySelector('.teamBox.home');
  away.querySelector('.teamEmoji').textContent = game.teams.away.emoji;
  away.querySelector('.teamName').textContent = game.teams.away.name;
  away.querySelector('.teamScore').textContent = game.score.away;
  away.style.boxShadow = game.half === 'top' ? '0 0 0 3px var(--accent) inset' : 'none';
  home.querySelector('.teamEmoji').textContent = game.teams.home.emoji;
  home.querySelector('.teamName').textContent = game.teams.home.name;
  home.querySelector('.teamScore').textContent = game.score.home;
  home.style.boxShadow = game.half === 'bottom' ? '0 0 0 3px var(--accent) inset' : 'none';
  $('inningBox').textContent = inningLabel(game);

  renderPips('ballPips', game.balls, 3, 'ball');
  renderPips('strikePips', game.strikes, 2, 'strike');
  renderPips('outPips', game.outs, 2, 'out');

  $('baseFirst').classList.toggle('lit', !!game.bases.first);
  $('baseSecond').classList.toggle('lit', !!game.bases.second);
  $('baseThird').classList.toggle('lit', !!game.bases.third);
}

function myRole() {
  const state = Game.state;
  if (!state.atBat) return 'idle';
  if (state.atBat.pitcherId === state.myId) return 'pitcher';
  if (state.atBat.batterId === state.myId) return 'batter';
  return 'idle';
}

function buildZoneGrid() {
  const grid = $('zoneGrid');
  grid.innerHTML = '';
  for (let y = 0; y < Game.config.GRID; y++) {
    for (let x = 0; x < Game.config.GRID; x++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'zoneCell';
      if (x >= Game.config.ZONE_LOW && x <= Game.config.ZONE_HIGH && y >= Game.config.ZONE_LOW && y <= Game.config.ZONE_HIGH) {
        cell.classList.add('strikeZone');
      }
      cell.addEventListener('click', () => {
        if (Game.state.submitted) return;
        Game.state.selectedZone = { x, y };
        grid.querySelectorAll('.zoneCell').forEach(c => c.classList.remove('selected'));
        cell.classList.add('selected');
      });
      grid.appendChild(cell);
    }
  }
}

function buildPitchTypeRow(containerId) {
  const row = $(containerId);
  row.innerHTML = '';
  Game.config.PITCH_TYPES.forEach(type => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'chip';
    btn.textContent = `${type.emoji} ${type.label}`;
    if (type.id === Game.state.selectedPitchType) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      if (Game.state.submitted) return;
      Game.state.selectedPitchType = type.id;
      row.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
      btn.classList.add('selected');
    });
    row.appendChild(btn);
  });
}

function buildSwingModeRow() {
  const row = $('swingModeRow');
  row.innerHTML = '';
  [['contact', '정교하게 🎯'], ['power', '힘껏 파워 💪']].forEach(([mode, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'chip';
    btn.textContent = label;
    if (mode === Game.state.selectedMode) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      if (Game.state.submitted) return;
      Game.state.selectedMode = mode;
      row.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
      btn.classList.add('selected');
    });
    row.appendChild(btn);
  });
}

function resetAtBatControls() {
  Game.state.submitted = false;
  Game.state.selectedZone = null;
  buildZoneGrid();
  buildPitchTypeRow('pitchTypeRow');
  buildSwingModeRow();
  renderControls();
}

function renderControls() {
  const role = myRole();
  const zoneGrid = $('zoneGrid'), swingRow = $('swingModeRow'), takeBtn = $('takeBtn'), confirmBtn = $('confirmBtn');
  if (role === 'pitcher') {
    $('roleBanner').textContent = Game.state.submitted ? '상대가 스윙을 정하는 중이에요...' : '투수 차례! 코스와 구종을 골라 던지세요';
    zoneGrid.classList.remove('hidden');
    swingRow.classList.add('hidden');
    takeBtn.classList.add('hidden');
    confirmBtn.textContent = '던지기';
  } else if (role === 'batter') {
    $('roleBanner').textContent = Game.state.submitted ? '상대가 코스를 정하는 중이에요...' : '타자 차례! 노릴 코스를 찍고 스윙하거나, 지켜보세요';
    zoneGrid.classList.remove('hidden');
    swingRow.classList.remove('hidden');
    takeBtn.classList.remove('hidden');
    confirmBtn.textContent = '스윙!';
  } else {
    $('roleBanner').textContent = '경기를 준비하는 중이에요...';
    zoneGrid.classList.add('hidden');
    swingRow.classList.add('hidden');
    takeBtn.classList.add('hidden');
  }
  confirmBtn.disabled = Game.state.submitted || role === 'idle';
  takeBtn.disabled = Game.state.submitted;
}

function stopTurnTimer() {
  if (Game.mp.timerRaf) cancelAnimationFrame(Game.mp.timerRaf);
  Game.mp.timerRaf = null;
}

function startTurnTimer(deadline) {
  stopTurnTimer();
  const total = Math.max(1, deadline - Date.now());
  function tick() {
    const remain = Math.max(0, deadline - Date.now());
    $('turnTimerFill').style.width = (remain / total * 100) + '%';
    if (remain > 0) Game.mp.timerRaf = requestAnimationFrame(tick);
  }
  tick();
}

function addLog(text) {
  const log = $('playLog');
  const line = document.createElement('div');
  line.textContent = text;
  log.prepend(line);
  while (log.children.length > 40) log.removeChild(log.lastChild);
}

function showResultBanner(text) {
  const banner = $('resultBanner');
  banner.textContent = text;
  banner.style.opacity = '1';
  clearTimeout(showResultBanner._t);
  showResultBanner._t = setTimeout(() => { banner.style.opacity = '0.35'; }, 2200);
}

function renderEndScreen(payload) {
  const game = Game.state.game;
  const mySide = Game.state.mySide;
  const won = payload.winner === mySide;
  const tie = payload.winner === null;
  $('endTitle').textContent = tie ? '무승부!' : (won ? '승리했어요! 🎉' : '아쉬워요...');
  const teams = game ? game.teams : { away: { name: '원정팀' }, home: { name: '홈팀' } };
  $('endScore').textContent = `${teams.away.name} ${payload.score.away} : ${payload.score.home} ${teams.home.name}` + (payload.forfeited ? ' (상대 퇴장으로 종료)' : '');
  $('rematchStatus').textContent = '';
  $('rematchBtn').disabled = false;
  showScreen('end');
}
