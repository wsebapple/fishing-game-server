const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPoints } = require('../server/points');

async function tmpFile() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-points-'));
  return { directory, file: path.join(directory, 'points.json') };
}

test('a new name registers with 0 points, and the same name+PIN logs back in with the same points', async () => {
  const { directory, file } = await tmpFile();
  try {
    const points = createPoints(file, 'test-secret');
    const first = await points.login('철수', '1234');
    assert.equal(first.points, 0);
    assert.equal(points.verifyToken(first.token), '철수');

    const second = await points.login('철수', '1234');
    assert.equal(second.points, 0);

    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.ok(saved['철수'].pinHash, 'PIN은 해시로 저장돼요');
    assert.notEqual(saved['철수'].pinHash, '1234');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('logging back in with the wrong PIN is rejected and does not change stored points', async () => {
  const { directory, file } = await tmpFile();
  try {
    const points = createPoints(file, 'test-secret');
    await points.login('영희', '1111');
    await assert.rejects(points.login('영희', '9999'), (error) => error.code === 'PIN_MISMATCH');

    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(saved['영희'].points, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('a token only verifies for the name it was issued to, and a tampered token is rejected', async () => {
  const { directory, file } = await tmpFile();
  try {
    const points = createPoints(file, 'test-secret');
    const { token } = await points.login('민수', '5555');
    assert.equal(points.verifyToken(token), '민수');
    assert.equal(points.verifyToken('garbage'), null);
    assert.equal(points.verifyToken(token + 'x'), null);

    const otherPoints = createPoints(file, 'different-secret');
    assert.equal(otherPoints.verifyToken(token), null, '다른 비밀키로 서명한 토큰처럼 위조되면 거부돼요');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('points can be read for an existing name without going through login', async () => {
  const { directory, file } = await tmpFile();
  try {
    const points = createPoints(file, 'test-secret');
    await points.login('지민', '2468');
    assert.equal(await points.getPoints('지민'), 0);
    assert.equal(await points.getPoints('없는사람'), null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('a corrupted points file is quarantined instead of breaking logins forever', async () => {
  const { directory, file } = await tmpFile();
  try {
    await fs.writeFile(file, '{not valid json', 'utf8');
    const points = createPoints(file, 'test-secret');

    const result = await points.login('새친구', '0000');
    assert.equal(result.points, 0);
    const siblings = await fs.readdir(directory);
    assert.ok(siblings.some(name => name.startsWith('points.json.corrupt-')), '원본 파일은 지우지 않고 옆으로 격리해요');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('malformed entries inside an otherwise valid file are dropped, not thrown on', async () => {
  const { directory, file } = await tmpFile();
  try {
    await fs.writeFile(file, JSON.stringify({
      broken1: null,
      broken2: { points: 5 },
      ok: { pinHash: 'abc', points: 3, updatedAt: '2026-01-01T00:00:00.000Z' },
    }), 'utf8');
    const points = createPoints(file, 'test-secret');

    assert.equal(await points.getPoints('ok'), 3);
    assert.equal(await points.getPoints('broken1'), null);
    assert.equal(await points.getPoints('broken2'), null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('normalizeName trims and strips control characters, normalizePin accepts only 4 digits', () => {
  const points = createPoints(path.join(os.tmpdir(), 'unused.json'), 'test-secret');
  assert.equal(points.normalizeName('  철수  '), '철수');
  assert.equal(points.normalizeName('\u0000철수\u0000'), '철수');
  assert.equal(points.normalizeName('   '), null, '빈 이름은 허용하지 않아요');
  assert.equal(points.normalizeName(123), null);

  assert.equal(points.normalizePin('1234'), '1234');
  assert.equal(points.normalizePin('123'), null);
  assert.equal(points.normalizePin('12345'), null);
  assert.equal(points.normalizePin('abcd'), null);
});
