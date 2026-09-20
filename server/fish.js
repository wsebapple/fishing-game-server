const { fishTypes } = require('../public/game-config.json');

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

function bossWanderPosition(seed, elapsedSec, type) {
  const speedMul = (type.speedMul || 1) * 1.25;
  const jitterBoost = type.jitter ? 2.75 : 1;
  const fx = (0.16 + seed * 0.12) * speedMul * jitterBoost;
  const fy = (0.11 + (1 - seed) * 0.09) * speedMul * jitterBoost;
  const px = seed * Math.PI * 2, py = (1 - seed) * Math.PI * 2;
  let xRatio = 0.5 + 0.42 * Math.sin(fx * elapsedSec + px) * Math.cos(0.29 * elapsedSec * speedMul + py);
  const yRatio = 0.5 + 0.33 * Math.sin(fy * elapsedSec + py);
  if (type.dash) {
    const cyclePos = ((elapsedSec * 0.34 + seed * 3) % 1 + 1) % 1;
    if (cyclePos > 0.78) {
      const dashDir = Math.sin(fx * elapsedSec + px) >= 0 ? 1 : -1;
      xRatio = 0.5 + 0.46 * dashDir * Math.min(1, (cyclePos - 0.78) / 0.22 * 3.8);
    }
  }
  return { xRatio: Math.min(0.96, Math.max(0.04, xRatio)), yRatio: Math.min(0.88, Math.max(0.12, yRatio)) };
}

function canCatch(fish, position, now = Date.now(), magnetUntil = 0) {
  if (!position || now - position.at > 1000 || now < fish.startTime || now >= fish.startTime + fish.durationMs) return false;
  const { width, height } = position;
  const hookX = position.xRatio * width, hookY = position.yRatio * height;
  const elapsed = now - fish.startTime;
  const type = fish.type;
  if (type.isBoss) {
    if (now < (fish.invulnerableUntil || 0)) return false;
    if (type.stealth && ((elapsed / 1000 + fish.seed * 10) % 5) < 2) return false;
    const point = bossWanderPosition(fish.seed, elapsed / 1000, type);
    return Math.hypot(hookX - (point.xRatio * width + type.half), hookY - (point.yRatio * height + type.half)) <= type.catchRadius + 10;
  }
  if (magnetUntil > now && !type.isMagnet) return true;
  const progress = elapsed / fish.durationMs;
  const left = fish.fromLeft ? -50 + progress * (width + 100) : width + 50 - progress * (width + 100);
  return Math.hypot(hookX - (left + 35), hookY - (fish.y * height + 35)) <= 87;
}

module.exports = { pickFishType, fishDurationMs, bossWanderPosition, canCatch };
