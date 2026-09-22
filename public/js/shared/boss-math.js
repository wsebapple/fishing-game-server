// 보스 이동/은신/포식/쓰레기 계산식 — 서버(server/*.js)와 브라우저(single.js, multiplayer.js)가 이 파일 하나를 같이 써요.
// 서버는 이 식으로 "맞았는지"를 판정하고 화면은 이 식으로 보스를 그리므로, 두 곳이 어긋나면
// 눈에 보이는 위치와 판정 위치가 달라져요. 수치를 바꿀 땐 이 파일만 고치면 돼요.

// 보스가 화면을 누비는 경로를 "흐른 시간"만의 함수로 계산해요. 프레임 속도가 달라도
// 모든 친구 화면에 거의 같은 위치로 보여요. 반환값은 화면 크기에 대한 0~1 비율이에요.
function bossWanderPosition(seed, elapsedSec, type){
  const speedMul = ((type && type.speedMul) || 1) * 1.25;
  const jitterBoost = (type && type.jitter) ? 2.75 : 1;
  const fx = (0.16 + seed * 0.12) * speedMul * jitterBoost;
  const fy = (0.11 + (1 - seed) * 0.09) * speedMul * jitterBoost;
  const px = seed * Math.PI * 2;
  const py = (1 - seed) * Math.PI * 2;
  let xRatio = 0.5 + 0.42 * Math.sin(fx * elapsedSec + px) * Math.cos(0.29 * elapsedSec * speedMul + py);
  const yRatio = 0.5 + 0.33 * Math.sin(fy * elapsedSec + py);

  if(type && type.dash){
    // 상어: 주기적으로 순간 돌진해요
    const cyclePos = ((elapsedSec * 0.34 + seed * 3) % 1 + 1) % 1;
    if(cyclePos > 0.78){
      const burstT = (cyclePos - 0.78) / 0.22;
      const dashDir = Math.sin(fx * elapsedSec + px) >= 0 ? 1 : -1;
      xRatio = 0.5 + 0.46 * dashDir * Math.min(1, burstT * 3.8);
    }
  }

  return {
    xRatio: Math.min(0.96, Math.max(0.04, xRatio)),
    yRatio: Math.min(0.88, Math.max(0.12, yRatio)),
  };
}

// 대왕게: 5초마다 2초씩 모래 속에 숨어서 안 잡혀요
function isBossStealthed(seed, elapsedSec, type){
  if(!type || !type.stealth) return false;
  const cycle = 5, hideFor = 2;
  return ((elapsedSec + seed * 10) % cycle + cycle) % cycle < hideFor;
}

// 사나운 보스(상어·바다용·오징어)가 잡아먹을 수 있는 건 "점수를 주는 물고기"뿐이에요.
// 보물통·자석·시계·쓰레기·감점 생물은 안 먹어요.
function isEdible(type){
  return !!type && type.points > 0 && !type.isBoss && !type.isTreasure && !type.isMagnet && !type.isTimeBonus && !type.isBossTrash;
}

// 평범한 물고기는 화면 한쪽 끝에서 반대쪽 끝으로 가로질러 헤엄쳐요. 몸 중심 좌표(px)를 돌려줘요.
function regularFishCenter(fish, elapsedMs, width, height, half){
  const progress = elapsedMs / fish.durationMs;
  const left = fish.fromLeft ? -50 + progress * (width + 100) : width + 50 - progress * (width + 100);
  return { x: left + half, y: fish.y * height + half };
}

// 대왕게가 뿌린 쓰레기: 게가 있던 자리에서 옆으로 퍼지며 천천히 가라앉아요. 중심 좌표(px)를 돌려줘요.
// 위치(비율)는 화면 크기에 맞춰 늘어나고, 게 몸 크기만큼의 오프셋과 이동 속도는 px 그대로예요.
function trashCenter(trash, elapsedSec, width, height){
  return {
    x: trash.xRatio * width + trash.offX + trash.vx * elapsedSec,
    y: trash.yRatio * height + trash.offY + trash.vy * elapsedSec,
  };
}

// 대왕게가 (bossPos 비율, half px) 자리에서 count개를 부채꼴로 뿌릴 때 각 쓰레기의 궤적
function makeTrashThrows(bossPos, half, count, random = Math.random){
  const throws = [];
  for(let i = 0; i < count; i++){
    const spread = count === 1 ? 0 : (i / (count - 1)) * 2 - 1; // -1 ~ 1
    throws.push({
      xRatio: bossPos.xRatio, yRatio: bossPos.yRatio,
      offX: half + spread * 20, offY: half + 10,
      vx: spread * 40 + (random() - 0.5) * 16,
      vy: 45 + random() * 15,
    });
  }
  return throws;
}

if(typeof module !== 'undefined' && module.exports){
  module.exports = { bossWanderPosition, isBossStealthed, isEdible, regularFishCenter, trashCenter, makeTrashThrows };
}
