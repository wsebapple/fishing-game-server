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

// 보물통을 열면 이 중에서 하나가 랜덤으로 나와요
const lootItems = gameConfig.lootItems;
let treasureLoot = []; // 이번 판에 모은 보물 목록

const fishTypes = [...gameConfig.fishTypes, ...gameConfig.bossTypes];

// 위 fishTypes 중 보스만 따로 뽑아둬요 (보스 등장 시 이 중에서 랜덤으로 하나 골라요)
const bossTypes = fishTypes.filter(f => f.isBoss);

// 도감: 잡은 바다생물을 기록해요 (게임을 다시 해도 안 사라져요)
const caughtLog = {};
fishTypes.forEach(f => caughtLog[f.name] = 0);

let score = 0;
let timeLeft = 60;
let gameTimer = null;
let spawnTimer = null;
let running = false;
const scene = document.getElementById('scene');

// 단계(레벨) 설정: 점수에 따라 몇 단계인지 정하고, 단계마다 물고기가 조금 더 빨리 나와요
const levelStages = gameConfig.levelStages;
let currentLevel = 1;
let rivalTimeout = null;
let bestScore = 0; // 이 창을 열어둔 동안의 최고 점수예요 (창을 닫으면 초기화돼요)
let magnetActive = false;
let magnetTimer = null;
let frozen = false;
let freezeTimeout = null;
let stormActive = false;
// 'storm' | 'snow' | null - 레벨업 시에도 지금 날씨에 맞는 스폰 속도를 유지하려고 따로 기억해둬요
// (멀티플레이 서버의 applySpawnRate와 같은 방식이에요)
let activeWeatherKind = null;
let stormTimeout = null;
let stormFlashInterval = null; // 번개 번쩍임 반복 타이머 (게임 종료 시 반드시 정리해야 해요)
let snowFlakeInterval = null; // 눈송이 생성 반복 타이머 (게임 종료 시 반드시 정리해야 해요)
let bossTimeout = null;
let playerName = '';
let mpSocket = null;
let mpConnecting = false;
let mpActive = false;
let mpFishEls = {};
let mpFishTypeById = {}; // fishId -> 그 물고기의 type 객체 (보스 종류별 half/escape 등을 나중에 참조하려고)
let mpBossSeedById = {}; // 피격 후 서버가 갱신한 보스 이동 경로
let mpBossSeedTransitionById = {}; // 피격 직후 새 경로로 부드럽게 전환하기 위한 상태
let mpCatchResetTimers = {};
let mpCaughtSent = {}; // fishId -> 캐치 요청을 보내고 서버 응답(fishCaught/fishExpire/bossInked)을 기다리는 중인지
let mpCatchRetryAt = {}; // fishId -> 서버가 캐치를 거절했을 때 다시 시도해도 되는 시각(performance.now() 기준)
let mpBossInvulnUntil = {}; // fishId -> 먹물을 뿌리고 도망간 직후, 같은 스침이 연속으로 여러 번 잡히지 않게 잠깐 무적인 시각(performance.now() 기준)
