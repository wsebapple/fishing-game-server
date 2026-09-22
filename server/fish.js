const { fishTypes, hitbox } = require('../public/game-config.json');
const { bossWanderPosition, isBossStealthed } = require('../public/js/shared/boss-math');

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

function canCatch(fish, position, now = Date.now(), magnetUntil = 0) {
  if (!position || now - position.at > 1000 || now < fish.startTime || now >= fish.startTime + fish.durationMs) return false;
  const { width, height } = position;
  const hookX = position.xRatio * width, hookY = position.yRatio * height;
  const elapsed = now - fish.startTime;
  const type = fish.type;
  if (type.isBoss) {
    if (now < (fish.invulnerableUntil || 0)) return false;
    if (isBossStealthed(fish.seed, elapsed / 1000, type)) return false;
    const point = bossWanderPosition(fish.seed, elapsed / 1000, type);
    return Math.hypot(hookX - (point.xRatio * width + type.half), hookY - (point.yRatio * height + type.half)) <= type.catchRadius + hitbox.bossServerTolerance;
  }
  if (magnetUntil > now && !type.isMagnet) return true;
  const progress = elapsed / fish.durationMs;
  const left = fish.fromLeft ? -50 + progress * (width + 100) : width + 50 - progress * (width + 100);
  return Math.hypot(hookX - (left + hitbox.fishHalf), hookY - (fish.y * height + hitbox.fishHalf)) <= hitbox.fishCatchRadius + hitbox.fishServerTolerance;
}

module.exports = { pickFishType, fishDurationMs, bossWanderPosition, canCatch };
