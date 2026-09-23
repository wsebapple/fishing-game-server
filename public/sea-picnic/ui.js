// 시작 화면(테마·난이도 고르기)과 결과 화면을 그리는 부분. game.js가 진짜 게임 루프를 맡아요.
(function () {
  const THEMES = window.THEMES, DIFFICULTIES = window.DIFFICULTIES;
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
  function readScores(theme) { try { return JSON.parse(localStorage.getItem(theme.scoreKey) || '[]'); } catch { return []; } }
  function formatTime(sec) { let m = Math.floor(sec / 60), s = Math.floor(sec % 60); return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
  function safeName(v, theme) { return String(v || theme.defaultName).replace(/[<>&"']/g, '').trim().slice(0, 10) || theme.defaultName; }
  function rankingHTML(theme) {
    const list = readScores(theme);
    if (!list.length) return '<div class="ranking"><h2>🏆 TOP 10</h2><div class="empty">아직 기록이 없어요</div></div>';
    return `<div class="ranking"><h2>🏆 TOP 10</h2><table><thead><tr><th>순위</th><th>이름</th><th>친구</th><th>시간</th><th>날짜</th></tr></thead><tbody>${list.map((r, i) => `<tr><td>${i + 1}</td><td>${safeName(r.name, theme)}</td><td>${r.score}마리</td><td>${formatTime(r.time)}</td><td>${new Date(r.date).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}</td></tr>`).join('')}</tbody></table></div>`;
  }

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
    </section>`;

    const themeGrid = overlay.querySelector('#themeGrid');
    THEMES.forEach(t => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'themeCard' + (t.key === picked.themeKey ? ' active' : '');
      btn.style.background = t.artBg;
      btn.innerHTML = `<span class="themeArt">${t.art}</span><span class="themeName">${t.shortTitle}</span>`;
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
    </section>`;
    overlay.querySelector('#again').onclick = renderSelect;
  }

  window.SeaPicnicUI = { renderSelect, showResult };
  renderSelect();
})();
