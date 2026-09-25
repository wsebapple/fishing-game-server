const path = require('node:path');
const { createStorageBackend } = require('./storage');

// 게임을 처음 추가했을 때부터 값이 있어야 하니 기본값을 코드에 둬요. 관리자가 값을 바꾸면
// data/game-costs.json에 저장되고, 그 뒤로는 파일에 있는 값이 기본값을 덮어써요.
const DEFAULT_COSTS = {
  fishing: 5,
  'sea-picnic': 3,
  'nemo-adventure': 3,
  spaceship: 4,
  'fruit-game': 2,
  gunner: 4,
  'land-grab': 3,
};

function createCosts(file = path.join(__dirname, '..', 'data', 'game-costs.json'), backend = createStorageBackend()) {
  let queue = Promise.resolve();

  async function read() {
    const raw = await backend.read(file);
    if (raw == null) return { ...DEFAULT_COSTS };
    let data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      const quarantine = await backend.quarantine(file);
      console.error('입장료가 손상돼서 격리했어요:', quarantine, error);
      return { ...DEFAULT_COSTS };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ...DEFAULT_COSTS };
    const merged = { ...DEFAULT_COSTS };
    for (const [gameId, cost] of Object.entries(data)) {
      if (typeof gameId === 'string' && Number.isFinite(cost) && cost >= 0) merged[gameId] = cost;
    }
    return merged;
  }

  async function write(data) {
    await backend.write(file, JSON.stringify(data));
  }

  async function list() {
    await queue.catch(() => {});
    return read();
  }

  function setCost(gameId, cost) {
    const attempt = queue.catch(() => {}).then(async () => {
      const data = await read();
      data[gameId] = cost;
      await write(data);
      return data;
    });
    queue = attempt.catch(() => {});
    return attempt;
  }

  return { list, setCost };
}

module.exports = { createCosts, DEFAULT_COSTS };
