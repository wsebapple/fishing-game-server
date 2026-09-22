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

test('the browser and the server use the exact same boss math file', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const file = path.join(__dirname, '../public/js/shared/boss-math.js');
  const browser = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), browser);
  const server = require('../public/js/shared/boss-math');
  for (const type of bossTypes) {
    for (const [seed, t] of [[0.1, 0.5], [0.5, 3.3], [0.93, 12.7], [0.37, 25.1]]) {
      assert.deepEqual({ ...browser.bossWanderPosition(seed, t, type) }, server.bossWanderPosition(seed, t, type));
      assert.equal(browser.isBossStealthed(seed, t, type), server.isBossStealthed(seed, t, type));
    }
  }
  for (const client of ['multiplayer.js', 'single.js', 'core.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../public/js', client), 'utf8');
    assert.doesNotMatch(source, /function\s+(bossWanderPosition|isBossStealthed)\b/, client + ' must not redefine shared boss math');
  }
});
