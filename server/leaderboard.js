const fs = require('node:fs/promises');
const path = require('node:path');

function isValidEntry(e) {
  return !!e && typeof e.name === 'string' && Number.isFinite(e.score);
}

function createLeaderboard(file = path.join(__dirname, '..', 'data', 'leaderboard.json')) {
  let queue = Promise.resolve();
  async function read() {
    let raw;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    let entries;
    try {
      entries = JSON.parse(raw);
    } catch (error) {
      // 파일이 깨져 있으면 옆으로 격리해두고 빈 순위표로 계속 진행해요 (안 그러면 저장/조회가 영구히 실패해요)
      const quarantine = `${file}.corrupt-${Date.now()}`;
      await fs.rename(file, quarantine).catch(() => {});
      console.error('순위표 파일이 손상돼서 격리했어요:', quarantine, error);
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
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temp = file + '.tmp';
      await fs.writeFile(temp, JSON.stringify(entries), 'utf8');
      await fs.rename(temp, file);
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
