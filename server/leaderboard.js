const path = require('node:path');
const { createStorageBackend } = require('./storage');

function isValidEntry(e) {
  return !!e && typeof e.name === 'string' && Number.isFinite(e.score);
}

function createLeaderboard(file = path.join(__dirname, '..', 'data', 'leaderboard.json'), backend = createStorageBackend()) {
  let queue = Promise.resolve();
  async function read() {
    const raw = await backend.read(file);
    if (raw == null) return [];
    let entries;
    try {
      entries = JSON.parse(raw);
    } catch (error) {
      // 저장된 내용이 깨져 있으면 옆으로 격리해두고 빈 순위표로 계속 진행해요 (안 그러면 저장/조회가 영구히 실패해요)
      const quarantine = await backend.quarantine(file);
      console.error('순위표가 손상돼서 격리했어요:', quarantine, error);
      return [];
    }
    return Array.isArray(entries) ? entries.filter(isValidEntry) : [];
  }
  function record(players) {
    const newEntries = Object.values(players).map(p => ({
      name: p.name, score: p.score, date: new Date().toISOString(),
    }));
    queue = queue.catch(() => {}).then(async () => {
      const entries = (await read()).concat(newEntries).slice(-1000);
      await backend.write(file, JSON.stringify(entries));
    });
    return queue;
  }
  async function list() {
    await queue.catch(() => {}); // 직전 저장이 실패했어도 순위 읽기는 계속 되게 해요
    return (await read()).sort((a, b) => b.score - a.score).slice(0, 10);
  }
  return { record, list };
}
module.exports = { createLeaderboard };
