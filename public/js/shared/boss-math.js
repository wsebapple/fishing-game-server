// 보스 이동/은신 계산식 — 서버(server/fish.js)와 브라우저(multiplayer.js)가 이 파일 하나를 같이 써요.
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

if(typeof module !== 'undefined' && module.exports){
  module.exports = { bossWanderPosition, isBossStealthed };
}
