const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLeaderboard } = require('../server/leaderboard');

// server/leaderboard.js require('node:fs/promises')하고 fs.rename처럼 속성으로만 불러서 쓰니까,
// 이 참조를 잠깐 바꿔치기해서 "디스크에 쓰다가 실패하는" 상황을 흉내낼 수 있어요.
test('a failed write does not leave later reads/writes stuck on the old rejection', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-lb-'));
  const origRename = fs.rename;
  try {
    const file = path.join(directory, 'scores.json');
    const lb = createLeaderboard(file);

    fs.rename = async () => { throw new Error('디스크 꽉 참(흉내)'); };
    await assert.rejects(lb.record({ a: { name: 'A', score: 5 } }));

    fs.rename = origRename; // 문제가 풀렸어요(디스크에 자리가 생겼다고 쳐요)
    assert.deepEqual(await lb.list(), [], 'list()가 예전에 실패했던 저장 때문에 계속 거부되면 안 돼요');

    await lb.record({ a: { name: 'A', score: 7 } });
    assert.equal((await lb.list())[0].score, 7, '다음 저장은 정상적으로 되고 순위에 반영돼요');
  } finally {
    fs.rename = origRename;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
