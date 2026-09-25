const fs = require('node:fs/promises');
const path = require('node:path');

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
  baseball: 5,
};

function createCosts(file = path.join(__dirname, '..', 'data', 'game-costs.json')) {
  let queue = Promise.resolve();

  async function read() {
    let raw;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return { ...DEFAULT_COSTS };
      throw error;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      const quarantine = `${file}.corrupt-${Date.now()}`;
      await fs.rename(file, quarantine).catch(() => {});
      console.error('입장료 파일이 손상돼서 격리했어요:', quarantine, error);
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
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = file + '.tmp';
    await fs.writeFile(temp, JSON.stringify(data), 'utf8');
    await fs.rename(temp, file);
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
