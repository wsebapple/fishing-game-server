/* ------------------------------------------------------
   낚시 게임 - 아이와 함께 자유롭게 고쳐보는 시작 코드예요!
   아래 fishTypes 배열만 바꿔도 완전히 다른 게임이 됩니다.
------------------------------------------------------ */

/* 배경을 더 생동감 있게 만드는 거품 + 반짝임 자동 생성 */
function createBackgroundDecor(){
  const sceneEl = document.getElementById('scene');
  // 터치 기기(폰)는 계속 애니메이션되는 배경 장식 수를 줄여서, 오래 켜둘 때
  // 발열로 성능이 떨어지는(스로틀링) 상황을 조금이라도 덜 만들어요
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const bubbleCount = isTouch ? 7 : 14;
  const sparkleCount = isTouch ? 8 : 16;
  for(let i = 0; i < bubbleCount; i++){
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const size = 6 + Math.random() * 14;
    bubble.style.width = size + 'px';
    bubble.style.height = size + 'px';
    bubble.style.left = Math.random() * 100 + '%';
    bubble.style.animationDuration = (7 + Math.random() * 8) + 's';
    bubble.style.animationDelay = (-Math.random() * 15) + 's';
    sceneEl.appendChild(bubble);
  }
  for(let i = 0; i < sparkleCount; i++){
    const sparkle = document.createElement('div');
    sparkle.className = 'sparkle';
    sparkle.style.left = Math.random() * 100 + '%';
    sparkle.style.top = (10 + Math.random() * 80) + '%';
    sparkle.style.animationDuration = (2 + Math.random() * 3) + 's';
    sparkle.style.animationDelay = (-Math.random() * 4) + 's';
    sceneEl.appendChild(sparkle);
  }
}
createBackgroundDecor();

/* ------------------------------------------------------
   게임 전체가 같이 쓰는 상태는 전부 window.Game 아래에 모아둬요.
   (예전엔 파일마다 let 전역 변수가 흩어져 있어서 누가 어떤 값을 바꾸는지
   알기 어려웠어요.) 각 파일 전용 상태는 그 파일 맨 위에서 스스로 등록해요:
   Game.audio(audio.js), Game.joystick(single.js), Game.ui(ui.js)
------------------------------------------------------ */
const Game = window.Game = {};

// 설정: game-config.json에서 읽어온, 게임 중에 바뀌지 않는 값들
Game.config = (() => {
  const fishTypes = [...gameConfig.fishTypes, ...gameConfig.bossTypes];
  return {
    lootItems: gameConfig.lootItems, // 보물통을 열면 이 중에서 하나가 랜덤으로 나와요
    fishTypes,
    bossTypes: fishTypes.filter(f => f.isBoss), // 보스 등장 시 이 중에서 랜덤으로 하나 골라요
    levelStages: gameConfig.levelStages, // 점수에 따라 몇 단계인지, 단계마다 물고기가 얼마나 자주 나오는지
    hitbox: gameConfig.hitbox, // 물고기/보스 크기와 바늘 판정 반지름 (서버와 같은 값)
  };
})();

Game.dom = { scene: document.getElementById('scene') };

// 화면 크기. window.innerWidth/innerHeight는 읽을 때마다 브라우저가 레이아웃을 다시 계산할 수 있어서
// (물고기 위치를 바꾼 직후 읽으면 매번 강제 계산 → 아이폰에서 끊김), 창 크기가 바뀔 때만 읽어 여기 저장해둬요.
// 게임 코드는 매 프레임 이 값만 써요.
Game.view = { w: window.innerWidth, h: window.innerHeight };
window.addEventListener('resize', () => { Game.view.w = window.innerWidth; Game.view.h = window.innerHeight; });

// 한 판(또는 온라인 한 라운드) 동안의 진행 상황
Game.state = {
  score: 0,
  timeLeft: 60,
  running: false, // 혼자하기 판이 진행 중인지
  currentLevel: 1,
  bestScore: 0, // 이 창을 열어둔 동안의 최고 점수예요 (창을 닫으면 초기화돼요)
  playerName: '',
  treasureLoot: [], // 이번 판에 모은 보물 목록
  caughtLog: {}, // 도감: 잡은 바다생물을 기록해요 (게임을 다시 해도 안 사라져요)
};
Game.config.fishTypes.forEach(f => Game.state.caughtLog[f.name] = 0);

// 자석/얼음/날씨처럼 잠깐 걸리는 효과 (혼자하기·온라인 공통)
Game.effects = {
  magnetActive: false,
  magnetTimer: null,
  frozen: false,
  freezeTimeout: null,
  stormActive: false,
  // 'storm' | 'snow' | null - 레벨업 시에도 지금 날씨에 맞는 스폰 속도를 유지하려고 따로 기억해둬요
  // (멀티플레이 서버의 applySpawnRate와 같은 방식이에요)
  activeWeatherKind: null,
};

// 혼자하기 타이머들 (게임 종료 시 반드시 정리해야 해요)
Game.timers = {
  gameTimer: null,
  spawnTimer: null,
  rivalTimeout: null,
  stormTimeout: null,
  stormFlashInterval: null, // 번개 번쩍임 반복
  snowFlakeInterval: null, // 눈송이 생성 반복
  bossTimeout: null,
};

// 낚싯바늘 위치. 물고기가 바늘에 닿았는지 확인할 때마다 getBoundingClientRect()로 DOM을
// 다시 읽으면 강제로 레이아웃을 다시 계산해서(reflow) 버벅이니, 계산해둔 이 숫자만 비교해요.
Game.hook = {
  x: Game.view.w / 2,
  y: 330,
  // 내 배. 바늘을 곧장 따라가지 않고 뒤늦게 쫓아가요.
  // facing: 뱃머리 방향(1=오른쪽, -1=왼쪽), turn: 그쪽으로 돌아가는 중인 값(-1~1, 0이면 정면으로 반쯤 돈 상태)
  boat: { x: Game.view.w / 2, facing: 1, turn: 1 },
  lastDrawnLine: '', // 마지막으로 그린 낚싯줄 모양 (안 바뀌었으면 다시 안 그려요)
};

// 배 그림(index.html #boat의 SVG, 160x100)에서 나온 숫자들. 내 배와 친구 배가 같이 써요.
const phoneBoatMq = window.matchMedia('(max-width: 480px)');
Game.boat = {
  bottom: 106, // 배 바닥의 화면 y (#boat top 6px + 높이 100px)
  tipDX: 74, // 배 가운데에서 낚싯대 끝까지 가로 거리 (SVG 154 - 80)
  tipUp: 68, // 배 바닥에서 낚싯대 끝까지 높이 (SVG 100 - 32)
  turnSlack: 12, // 바늘이 배 가운데보다 이만큼 뒤로 넘어가면 뱃머리를 돌려요
  turnSpeed: 2, // 바늘을 반대쪽으로 이 속도(프레임당 px) 넘게 끌어도 돌려요. 살짝 흔들 때는 안 돌아서 배가 떨지 않아요
  scale: () => phoneBoatMq.matches ? 0.8 : 1, // 폰에서는 HUD에 덜 가리게 배를 줄여요
};

// 온라인 같이하기 상태
Game.mp = {
  socket: null,
  connecting: false,
  active: false, // 온라인 방에 들어가 있는지
  fishEls: {}, // fishId -> 물고기 엘리먼트
  fishTypeById: {}, // fishId -> 그 물고기의 type 객체 (보스 종류별 half/escape 등을 나중에 참조하려고)
  bossSeedById: {}, // 피격 후 서버가 갱신한 보스 이동 경로
  bossSeedTransitionById: {}, // 피격 직후 새 경로로 부드럽게 전환하기 위한 상태
  catchResetTimers: {},
  caughtSent: {}, // fishId -> 캐치 요청을 보내고 서버 응답(fishCaught/fishExpire/bossInked)을 기다리는 중인지
  catchRetryAt: {}, // fishId -> 서버가 캐치를 거절했을 때 다시 시도해도 되는 시각(performance.now() 기준)
  bossInvulnUntil: {}, // fishId -> 스치고 도망간 직후 잠깐 무적인 시각(performance.now() 기준)
  flashInterval: null, // 폭풍우 번개 반복
  snowInterval: null, // 눈송이 생성 반복
  roundEndCountdownTimer: null,
  ghostBoats: {}, // socket.id -> 그 친구의 배 { el, hookEl, path, boat, hookX, hookY ... }
  boatSendTimer: null,
  lastThrowKey: '', // 대왕게 던지기 연출을 한 번에 여러 개 오는 쓰레기마다 반복하지 않게 기억해요
};
