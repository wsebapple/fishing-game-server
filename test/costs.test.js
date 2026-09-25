const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCosts, DEFAULT_COSTS } = require('../server/costs');

async function tmpFile() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-costs-'));
  return { directory, file: path.join(directory, 'game-costs.json') };
}

test('with no file yet, list() returns the built-in defaults', async () => {
  const { directory, file } = await tmpFile();
  try {
    const costs = createCosts(file);
    assert.deepEqual(await costs.list(), DEFAULT_COSTS);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('setCost persists and survives re-reading, and a restart (a fresh instance) sees the saved value', async () => {
  const { directory, file } = await tmpFile();
  try {
    const costs = createCosts(file);
    await costs.setCost('fishing', 9);
    assert.equal((await costs.list()).fishing, 9);

    const restarted = createCosts(file);
    assert.equal((await restarted.list()).fishing, 9);
    assert.equal((await restarted.list())['sea-picnic'], DEFAULT_COSTS['sea-picnic'], '건드리지 않은 게임은 기본값 그대로예요');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('setCost can add a brand new game id not in the defaults', async () => {
  const { directory, file } = await tmpFile();
  try {
    const costs = createCosts(file);
    await costs.setCost('new-game', 7);
    assert.equal((await costs.list())['new-game'], 7);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('a corrupted costs file is quarantined and defaults are used instead of breaking forever', async () => {
  const { directory, file } = await tmpFile();
  try {
    await fs.writeFile(file, '{not valid json', 'utf8');
    const costs = createCosts(file);
    assert.deepEqual(await costs.list(), DEFAULT_COSTS);
    const siblings = await fs.readdir(directory);
    assert.ok(siblings.some(name => name.startsWith('game-costs.json.corrupt-')));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('negative or non-numeric values in the file are ignored in favour of the default', async () => {
  const { directory, file } = await tmpFile();
  try {
    await fs.writeFile(file, JSON.stringify({ fishing: -3, spaceship: 'free', 'fruit-game': 1 }), 'utf8');
    const costs = createCosts(file);
    const list = await costs.list();
    assert.equal(list.fishing, DEFAULT_COSTS.fishing);
    assert.equal(list.spaceship, DEFAULT_COSTS.spaceship);
    assert.equal(list['fruit-game'], 1);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
