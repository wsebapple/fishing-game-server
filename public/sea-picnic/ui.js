// 시작 화면(테마·난이도 고르기)과 결과 화면을 그리는 부분. game.js가 진짜 게임 루프를 맡아요.
(function () {
  const THEMES = window.THEMES, DIFFICULTIES = window.DIFFICULTIES;
  const { rankingHTML } = window.SeaPicnicGame; // 순위 읽기/검증/렌더링은 game.js에 한 곳으로 모아뒀어요
  const overlay = document.querySelector('#overlay');
  const STATE_KEY = 'seaPicnicLastPickV1';

  function readLastPick() {
    try {
      const saved = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
      const themeKey = THEMES.some(t => t.key === saved.themeKey) ? saved.themeKey : THEMES[0].key;
      const diffKey = DIFFICULTIES.some(d => d.key === saved.diffKey) ? saved.diffKey : (DIFFICULTIES.find(d => d.default) || DIFFICULTIES[0]).key;
      return { themeKey, diffKey };
    } catch { return { themeKey: THEMES[0].key, diffKey: (DIFFICULTIES.find(d => d.default) || DIFFICULTIES[0]).key }; }
  }
  function saveLastPick(themeKey, diffKey) { try { localStorage.setItem(STATE_KEY, JSON.stringify({ themeKey, diffKey })); } catch {} }

  let picked = readLastPick();

  function themeByKey(key) { return THEMES.find(t => t.key === key) || THEMES[0]; }
  function diffByKey(key) { return DIFFICULTIES.find(d => d.key === key) || DIFFICULTIES[0]; }

  function readSavedName(theme) { try { return localStorage.getItem(theme.nameKey) || ''; } catch { return ''; } }

  function renderSelect() {
    const theme = themeByKey(picked.themeKey), diff = diffByKey(picked.diffKey);
    overlay.innerHTML = `<section class="card">
      <h1>바다 소풍</h1>
      <p>테마를 고르고 난이도를 정해서 출발해요!</p>
      <div class="themeGrid" id="themeGrid"></div>
      <p class="themeDesc" id="themeDesc"></p>
      <div class="diffRow" id="diffRow"></div>
      <p class="diffDesc" id="diffDesc"></p>
      <label class="nameBox">이름 <input id="playerName" maxlength="10" placeholder="${theme.defaultName}" autocomplete="nickname"></label>
      <div id="startRanking"></div>
      <button id="start"></button>
      <div><a class="backToHub" href="/">◀ 다른 게임 고르기</a></div>
    </section>`;

    const themeGrid = overlay.querySelector('#themeGrid');
    THEMES.forEach(t => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'themeCard' + (t.key === picked.themeKey ? ' active' : '');
      btn.style.background = t.artBg;
      btn.innerHTML = `<span class="themeArt">${t.art}</span><span class="themeName">${t.shortTitle}</span><span class="themeCheck">✔ 선택됨</span>`;
      btn.onclick = () => { picked.themeKey = t.key; renderSelect(); };
      themeGrid.appendChild(btn);
    });

    const diffRow = overlay.querySelector('#diffRow');
    DIFFICULTIES.forEach(d => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'diffPill' + (d.key === picked.diffKey ? ' active' : '');
      btn.textContent = d.label;
      btn.onclick = () => { picked.diffKey = d.key; renderSelect(); };
      diffRow.appendChild(btn);
    });

    overlay.querySelector('#themeDesc').textContent = theme.desc;
    overlay.querySelector('#diffDesc').textContent = diff.desc;
    overlay.querySelector('#playerName').value = readSavedName(theme);
    overlay.querySelector('#startRanking').innerHTML = rankingHTML(theme);
    const startBtn = overlay.querySelector('#start');
    startBtn.textContent = theme.startLabel;
    startBtn.onclick = async () => {
      saveLastPick(picked.themeKey, picked.diffKey);
      const name = overlay.querySelector('#playerName').value;
      startBtn.disabled = true; startBtn.textContent = '불러오는 중…';
      overlay.style.display = 'none';
      await window.SeaPicnicGame.start(themeByKey(picked.themeKey), diffByKey(picked.diffKey), name);
    };
  }

  function showResult({ score, elapsed, win, rankingHTML }) {
    const theme = themeByKey(picked.themeKey);
    overlay.style.display = 'grid';
    overlay.innerHTML = `<section class="card">
      <h1>${win ? '바다의 친구!' : '풍덩!'}</h1>
      <p>${theme.scoreIcon} 친구를 <b>${score}마리</b> 만났어요 · <b>${elapsed}</b><br>${win ? '정말 멋진 여행이었어요!' : '이번에는 방해꾼을 살짝 피해 봐요.'}</p>
      ${rankingHTML}
      <button id="again">테마·난이도 다시 고르기</button>
      <div><a class="backToHub" href="/">◀ 다른 게임 고르기</a></div>
    </section>`;
    overlay.querySelector('#again').onclick = renderSelect;
  }

  // 게임 시작 도중(테마 이미지 로딩 등) 실패해서 테마 고르기로 되돌아왔을 때, 왜 돌아왔는지 알려줘요
  function showLoadError() {
    const card = overlay.querySelector('.card');
    if (!card) return;
    const msg = document.createElement('p');
    msg.style.cssText = 'color:#d63838;font-weight:900';
    msg.textContent = '이미지를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시작해보세요.';
    card.insertBefore(msg, card.querySelector('.themeGrid'));
  }

  window.SeaPicnicUI = { renderSelect, showResult, showLoadError };
  renderSelect();
})();
