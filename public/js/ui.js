function renderDex(){
  const grid = document.getElementById('dexGrid');
  grid.innerHTML = '';
  Game.config.fishTypes.forEach(f => {
    const caught = Game.state.caughtLog[f.name] > 0;
    const card = document.createElement('div');
    card.className = 'dexCard' + (caught ? '' : ' locked');
    const pointsText = f.isTreasure ? `${f.minBonus}~${f.maxBonus}점 랜덤`
      : f.isMagnet ? '물고기가 끌려와요!'
      : f.isTimeBonus ? `시간 +${f.timeBonus}초`
      : `${f.points}점`;
    card.innerHTML = caught
      ? `<div class="icon">${f.emoji}</div><div class="name">${f.name}</div><div class="count">${Game.state.caughtLog[f.name]}번 · ${pointsText}</div>`
      : `<div class="icon">❔</div><div class="name">???</div><div class="count">아직 못 잡음</div>`;
    grid.appendChild(card);
  });
}

// 도감/순위 화면을 열 때 시작/종료 화면을 안 가리면, 반투명 배경 너머로
// "게임 끝!" 같은 글자가 겹쳐 비쳐 보여서 어디서 열었는지 기억해뒀다가
// 닫을 때 그 화면으로 되돌려줘요
Game.ui = { returnToScreenId: 'startScreen' };
function rememberReturnScreen(){
  if(!document.getElementById('endScreen').classList.contains('hidden')) Game.ui.returnToScreenId = 'endScreen';
  else if(!document.getElementById('startScreen').classList.contains('hidden')) Game.ui.returnToScreenId = 'startScreen';
}

function openDex(){
  rememberReturnScreen();
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('endScreen').classList.add('hidden');
  renderDex();
  document.getElementById('dexScreen').classList.remove('hidden');
}
document.getElementById('dexBtnStart').addEventListener('click', openDex);
document.getElementById('dexBtnEnd').addEventListener('click', openDex);
document.getElementById('dexCloseBtn').addEventListener('click', () => {
  document.getElementById('dexScreen').classList.add('hidden');
  document.getElementById(Game.ui.returnToScreenId).classList.remove('hidden');
});

/* ------------------------------------------------------
   친구 순위표: 같은 링크로 게임을 연 친구들끼리 점수를 공유해요
   서버가 판정한 멀티플레이 라운드 점수만 보여줘요.
------------------------------------------------------ */
function randomName(){
  const adjectives = ['신나는','용감한','반짝이는','재빠른','행복한','씩씩한','졸린','배고픈','멋진','귀여운'];
  const nouns = ['물고기','상어','문어','고래','낚시왕','새우','불가사리','조개'];
  const num = Math.floor(Math.random() * 100);
  return adjectives[Math.floor(Math.random()*adjectives.length)] + ' ' + nouns[Math.floor(Math.random()*nouns.length)] + num;
}

document.getElementById('randomNameBtn').addEventListener('click', () => {
  document.getElementById('playerNameInput').value = randomName();
});

async function loadLeaderboard(){
  const listEl = document.getElementById('leaderboardList');
  listEl.innerHTML = '<p>불러오는 중...</p>';

  try {
    const response = await fetch('/leaderboard');
    if (!response.ok) throw new Error('순위표 조회 실패');
    const entries = await response.json();
    if(entries.length === 0){
      listEl.innerHTML = '<p>아직 멀티플레이 기록이 없어요.</p>';
      return;
    }
    listEl.innerHTML = entries.map((e, i) => `
      <div class="lbRow">
        <span class="lbRank">${i+1}위</span>
        <span class="lbName">${escapeHtml(e.name)}</span>
        <span>${e.score}점</span>
      </div>
    `).join('');
  } catch(e){
    listEl.innerHTML = '<p>순위를 불러오는 데 문제가 생겼어요. 잠시 후 다시 시도해주세요.</p>';
  }
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function openLeaderboard(){
  rememberReturnScreen();
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('endScreen').classList.add('hidden');
  document.getElementById('leaderboardScreen').classList.remove('hidden');
  loadLeaderboard();
}
document.getElementById('leaderboardBtnStart').addEventListener('click', openLeaderboard);
document.getElementById('leaderboardBtnEnd').addEventListener('click', openLeaderboard);
document.getElementById('leaderboardRefreshBtn').addEventListener('click', loadLeaderboard);
document.getElementById('leaderboardCloseBtn').addEventListener('click', () => {
  document.getElementById('leaderboardScreen').classList.add('hidden');
  document.getElementById(Game.ui.returnToScreenId).classList.remove('hidden');
});
