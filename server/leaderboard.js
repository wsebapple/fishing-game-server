const fs = require('node:fs/promises');
const path = require('node:path');

function createLeaderboard(file = path.join(__dirname, '..', 'data', 'leaderboard.json')) {
  let queue = Promise.resolve();
  async function read() {
    try {
      const entries = JSON.parse(await fs.readFile(file, 'utf8'));
      return Array.isArray(entries) ? entries : [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
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
    await queue;
    return (await read()).sort((a, b) => b.score - a.score).slice(0, 10);
  }
  return { record, list };
}
module.exports = { createLeaderboard };
