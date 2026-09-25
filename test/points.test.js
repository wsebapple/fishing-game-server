const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPoints, STARTING_POINTS, DEFAULT_EARN_POLICY } = require('../server/points');

async function tmpFile() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-points-'));
  return { directory, file: path.join(directory, 'points.json') };
}

// earn()은 학습게임 폴더 안 earn-config.json을 직접 읽으니, 가짜 게임 폴더를 담을 임시 "public" 디렉터리도 같이 줘요
async function tmpFileWithGames() {
  const { directory, file } = await tmpFile();
  const gamesDir = path.join(directory, 'public');
  await fs.mkdir(gamesDir, { recursive: true });
  return { directory, file, gamesDir };
}

async function writeEarnConfig(gamesDir, gameId, config) {
  const gameDir = path.join(gamesDir, gameId);
  await fs.mkdir(gameDir, { recursive: true });
  await fs.writeFile(path.join(gameDir, 'earn-config.json'), JSON.stringify(config), 'utf8');
}

test('a new name registers with the starting points, and the same name+PIN logs back in with the same points', async () => {
  const { directory, file } = await tmpFile();
  try {
    const points = createPoints(file, 'test-secret');
    const first = await points.login('철수', '1234');
    assert.equal(first.points, STARTING_POINTS);
    assert.equal(points.verifyToken(first.token), '철수');

    const second = await points.login('철수', '1234');
    assert.equal(second.points, STARTING_POINTS);

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
    assert.equal(saved['영희'].points, STARTING_POINTS);
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
    assert.equal(await points.getPoints('지민'), STARTING_POINTS);
    assert.equal(await points.getPoints('없는사람'), null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('spend deducts on success, rejects when short, and never lets points go negative', async () => {
  const { directory, file } = await tmpFile();
  try {
    const points = createPoints(file, 'test-secret');
    await points.login('철수', '1234'); // 시작 포인트(STARTING_POINTS)로 시작해요
    await points.grant('철수', 10);

    const afterGrant = STARTING_POINTS + 10;
    assert.equal(await points.spend('철수', 4), afterGrant - 4);
    await assert.rejects(points.spend('철수', 1000), (error) => error.code === 'INSUFFICIENT');
    assert.equal(await points.getPoints('철수'), afterGrant - 4, '실패한 시도는 포인트를 깎지 않아요');

    await assert.rejects(points.spend('없는사람', 1), (error) => error.code === 'NOT_FOUND');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('grant adds or subtracts points for an existing name, clamped at 0, and rejects unknown names', async () => {
  const { directory, file } = await tmpFile();
  try {
    const points = createPoints(file, 'test-secret');
    await points.login('영희', '1111'); // 시작 포인트(STARTING_POINTS)로 시작해요

    assert.equal(await points.grant('영희', 5), STARTING_POINTS + 5);
    assert.equal(await points.grant('영희', -3), STARTING_POINTS + 2);
    assert.equal(await points.grant('영희', -1000), 0, '0 밑으로는 안 내려가요');

    await assert.rejects(points.grant('없는사람', 5), (error) => error.code === 'NOT_FOUND');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('remove deletes an existing account, and logging back in with the same name starts fresh', async () => {
  const { directory, file } = await tmpFile();
  try {
    const points = createPoints(file, 'test-secret');
    await points.login('민지', '1234');
    await points.grant('민지', 20);

    await points.remove('민지');
    assert.equal(await points.getPoints('민지'), null, '삭제 후엔 조회가 안 돼요');

    await assert.rejects(points.remove('민지'), (error) => error.code === 'NOT_FOUND', '이미 지운 이름을 또 지우면 실패해요');
    await assert.rejects(points.remove('없는사람'), (error) => error.code === 'NOT_FOUND');

    const relogin = await points.login('민지', '9999'); // PIN도 새로 정할 수 있어요(완전히 새 계정 취급)
    assert.equal(relogin.points, STARTING_POINTS, '지운 이름으로 다시 로그인하면 시작 포인트부터예요');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('listAll reports every registered name with their current points', async () => {
  const { directory, file } = await tmpFile();
  try {
    const points = createPoints(file, 'test-secret');
    await points.login('철수', '1234');
    await points.login('영희', '5678');
    await points.grant('영희', 7);

    const all = await points.listAll();
    assert.deepEqual(
      all.map(p => [p.name, p.points]).sort(),
      [['영희', STARTING_POINTS + 7], ['철수', STARTING_POINTS]],
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('earn awards points per unit according to that game\'s own earn-config.json, capped per round, and rejects an unregistered game or a logged-out name', async () => {
  const { directory, file, gamesDir } = await tmpFileWithGames();
  const policy = { pointsPerUnit: 2, maxUnitsPerRound: 10, maxPointsPerDay: 1000 };
  await writeEarnConfig(gamesDir, 'quiz-game', policy);
  try {
    const points = createPoints(file, 'test-secret', { gamesDir });
    await points.login('민수', '1234');

    const result = await points.earn('민수', 'quiz-game', 5);
    assert.equal(result.awarded, 5 * policy.pointsPerUnit);
    assert.equal(result.points, STARTING_POINTS + 5 * policy.pointsPerUnit);
    assert.equal(result.dailyCapped, false);

    // 한 판에 인정하는 단위 수(maxUnitsPerRound)를 넘겨 보내도 상한만큼만 쳐줘요
    const overReport = await points.earn('민수', 'quiz-game', policy.maxUnitsPerRound + 1000);
    assert.equal(overReport.awarded, policy.maxUnitsPerRound * policy.pointsPerUnit);

    // earn-config.json 자체가 없는 게임 폴더(혹은 아예 없는 폴더)는 학습게임으로 등록 안 된 거예요
    await assert.rejects(points.earn('민수', 'no-such-game', 3), (error) => error.code === 'UNKNOWN_GAME');
    await assert.rejects(points.earn('없는사람', 'quiz-game', 3), (error) => error.code === 'NOT_FOUND');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('a game folder with no earn-config.json cannot earn points, even though a fun game folder with the same name exists', async () => {
  const { directory, file, gamesDir } = await tmpFileWithGames();
  await fs.mkdir(path.join(gamesDir, 'fishing'), { recursive: true }); // index.html만 있고 earn-config.json은 없는 상황을 흉내내요
  try {
    const points = createPoints(file, 'test-secret', { gamesDir });
    await points.login('철수', '1234');
    await assert.rejects(points.earn('철수', 'fishing', 5), (error) => error.code === 'UNKNOWN_GAME');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('a partial earn-config.json only overrides the fields it sets; the rest fall back to DEFAULT_EARN_POLICY', async () => {
  const { directory, file, gamesDir } = await tmpFileWithGames();
  await writeEarnConfig(gamesDir, 'partial-game', { pointsPerUnit: 5, maxPointsPerDay: 1000 }); // maxUnitsPerRound만 안 정해요
  try {
    const points = createPoints(file, 'test-secret', { gamesDir });
    await points.login('영희', '1234');
    const result = await points.earn('영희', 'partial-game', 2);
    assert.equal(result.awarded, 2 * 5, '지정한 pointsPerUnit(5)은 그대로 쓰여요');

    const overReport = await points.earn('영희', 'partial-game', DEFAULT_EARN_POLICY.maxUnitsPerRound + 100);
    assert.equal(overReport.awarded, DEFAULT_EARN_POLICY.maxUnitsPerRound * 5, 'maxUnitsPerRound는 기본값으로 채워져요');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('a game id with path-traversal characters is rejected outright, never read as a file path', async () => {
  const { directory, file, gamesDir } = await tmpFileWithGames();
  try {
    const points = createPoints(file, 'test-secret', { gamesDir });
    await points.login('보안테스트', '1234');
    await assert.rejects(points.earn('보안테스트', '../../etc/passwd', 3), (error) => error.code === 'UNKNOWN_GAME');
    await assert.rejects(points.earn('보안테스트', '..', 3), (error) => error.code === 'UNKNOWN_GAME');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('earn stops handing out points once the daily cap for that game is reached, and resets the next day', async () => {
  const { directory, file, gamesDir } = await tmpFileWithGames();
  const policy = { pointsPerUnit: 1, maxUnitsPerRound: 30, maxPointsPerDay: 50 };
  await writeEarnConfig(gamesDir, 'hanja-game', policy);
  const maxPerRoundPoints = policy.maxUnitsPerRound * policy.pointsPerUnit;
  const day1 = Date.parse('2026-01-01T00:00:00.000Z');
  const day2 = Date.parse('2026-01-02T00:00:00.000Z');
  try {
    const points = createPoints(file, 'test-secret', { gamesDir });
    await points.login('지호', '1234');

    // 한 판 최대치를 여러 판 연달아 보내서 하루 한도(maxPointsPerDay)를 넘겨봐요
    let awardedSoFar = 0, capped = false;
    for (let round = 0; round < Math.ceil(policy.maxPointsPerDay / maxPerRoundPoints) + 1; round++) {
      const result = await points.earn('지호', 'hanja-game', policy.maxUnitsPerRound, day1);
      awardedSoFar += result.awarded;
      if (result.dailyCapped) capped = true;
    }
    assert.equal(awardedSoFar, policy.maxPointsPerDay, '아무리 여러 판 해도 하루 한도만큼만 쌓여요');
    assert.ok(capped, '한도를 넘기는 시도에서는 dailyCapped가 true예요');

    const stillToday = await points.earn('지호', 'hanja-game', 5, day1);
    assert.equal(stillToday.awarded, 0, '오늘은 이미 한도를 다 썼어요');

    const nextDay = await points.earn('지호', 'hanja-game', 5, day2);
    assert.ok(nextDay.awarded > 0, '날짜가 바뀌면 한도가 다시 초기화돼요');
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
    assert.equal(result.points, STARTING_POINTS);
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
