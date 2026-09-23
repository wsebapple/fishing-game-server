const { fishTypes, hitbox } = require('../public/fishing/game-config.json');
const { bossWanderPosition, isBossStealthed, regularFishCenter, trashCenter } = require('../public/fishing/js/shared/boss-math');

function pickFishType(random = Math.random) {
  const total = fishTypes.reduce((sum, fish) => sum + fish.chance, 0);
  let value = random() * total;
  for (const fish of fishTypes) {
    if (value < fish.chance) return fish;
    value -= fish.chance;
  }
  return fishTypes[0];
}

function fishDurationMs(speed) { return 1380 / (speed * 40) * 1000; }

// viewElapsedMs: 클라이언트가 그 순간 화면에 그리고 있던 물고기의 경과 시간.
// 화면은 네트워크 지연만큼 과거를 보여주므로 그 시점 위치로 판정하되(지연 보정),
// 되감기는 maxLagCompensationMs까지만 허용하고 미래 시점은 인정하지 않아요.
function canCatch(fish, position, now = Date.now(), magnetUntil = 0, viewElapsedMs) {
  if (!position || now - position.at > 1000 || now < fish.startTime || now >= fish.startTime + fish.durationMs) return false;
  const { width, height } = position;
  const hookX = position.xRatio * width, hookY = position.yRatio * height;
  const serverElapsed = now - fish.startTime;
  const elapsed = Number.isFinite(viewElapsedMs)
    ? Math.min(serverElapsed, Math.max(serverElapsed - hitbox.maxLagCompensationMs, viewElapsedMs))
    : serverElapsed;
  const type = fish.type;
  if (type.isBoss) {
    if (now < (fish.invulnerableUntil || 0)) return false;
    if (isBossStealthed(fish.seed, elapsed / 1000, type)) return false;
    const point = bossWanderPosition(fish.seed, elapsed / 1000, type);
    return Math.hypot(hookX - (point.xRatio * width + type.half), hookY - (point.yRatio * height + type.half)) <= type.catchRadius + hitbox.bossServerTolerance;
  }
  if (magnetUntil > now && !type.isMagnet) return true;
  if (fish.trash) {
    const c = trashCenter(fish.trash, elapsed / 1000, width, height);
    return Math.hypot(hookX - c.x, hookY - c.y) <= hitbox.trashCatchRadius + hitbox.fishServerTolerance;
  }
  const c = regularFishCenter(fish, elapsed, width, height, hitbox.fishHalf);
  return Math.hypot(hookX - c.x, hookY - c.y) <= hitbox.fishCatchRadius + hitbox.fishServerTolerance;
}

module.exports = { pickFishType, fishDurationMs, bossWanderPosition, canCatch };
