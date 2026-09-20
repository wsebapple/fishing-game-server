const test = require('node:test');
const assert = require('node:assert/strict');
const { canCatch, bossWanderPosition } = require('../server/fish');
const { bossTypes, fishTypes } = require('../public/game-config.json');

test('normal fish require fresh hook coordinates near their server position', () => {
  const now = 100000;
  const fish = { type: fishTypes[0], fromLeft: true, y: 0.5, startTime: now - 1000, durationMs: 10000 };
  const position = { xRatio: 123 / 1280, yRatio: 435 / 800, width: 1280, height: 800, at: now };
  assert.equal(canCatch(fish, position, now), true);
  assert.equal(canCatch(fish, { ...position, xRatio: 0.8 }, now), false);
  assert.equal(canCatch(fish, { ...position, at: now - 1001 }, now), false);
  assert.equal(canCatch(fish, null, now), false);
  assert.equal(canCatch(fish, position, now + 9000), false);
});

test('boss hit cooldown and stealth are enforced on the server', () => {
  const now = 100000, type = bossTypes[0], seed = 0.5, elapsed = 2000;
  const point = bossWanderPosition(seed, elapsed / 1000, type);
  const fish = { type, seed, startTime: now - elapsed, durationMs: 28000 };
  const position = { xRatio: (point.xRatio * 1280 + type.half) / 1280,
    yRatio: (point.yRatio * 800 + type.half) / 800, width: 1280, height: 800, at: now };
  assert.equal(canCatch(fish, position, now), true);
  const outside = { ...position, xRatio: (point.xRatio * 1280 + type.half + type.catchRadius + 11) / 1280 };
  assert.equal(canCatch(fish, outside, now), false);
  fish.invulnerableUntil = now + 1500;
  assert.equal(canCatch(fish, position, now), false);
  assert.equal(canCatch(fish, position, now + 1499), false);
  const laterPoint = bossWanderPosition(seed, (elapsed + 1500) / 1000, type);
  assert.equal(canCatch(fish, { ...position,
    xRatio: (laterPoint.xRatio * 1280 + type.half) / 1280,
    yRatio: (laterPoint.yRatio * 800 + type.half) / 800,
    at: now + 1500 }, now + 1500), true);
  fish.invulnerableUntil = 0;
  fish.type = bossTypes.find(b => b.stealth);
  fish.seed = 0;
  fish.startTime = now;
  assert.equal(canCatch(fish, position, now), false);
});
