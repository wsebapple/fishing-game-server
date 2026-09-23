const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { io: client } = require('socket.io-client');
const { createApp } = require('../server');
const { fishTypes, bossTypes } = require('../public/fishing/game-config.json');
const { bossWanderPosition } = require('../server/fish');

function once(socket, event) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout: ' + event)), 2000);
    socket.once(event, value => { clearTimeout(timeout); resolve(value); });
  });
}

test('two players: invalid catch, valid score, room switch, disconnect and leaderboard', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-test-'));
  const { server, io, roomApi, leaderboard } = createApp({ leaderboardFile: path.join(directory, 'scores.json') });
  await new Promise(resolve => server.listen(0, resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const a = client(url, { transports: ['websocket'] });
  const b = client(url, { transports: ['websocket'] });
  let c;
  try {
    await Promise.all([once(a, 'connect'), once(b, 'connect')]);
    let state = once(a, 'roomState');
    a.emit('joinRoom', { roomCode: 'alpha', name: 'A' });
    await state;
    state = once(b, 'roomState');
    b.emit('joinRoom', { roomCode: 'alpha', name: 'B' });
    await state;
    const room = roomApi.rooms.ALPHA;
    assert.equal(Object.keys(room.players).length, 2);
    a.emit('catchAttempt', { fishId: '__proto__' });
    a.emit('catchAttempt', { fishId: 'toString' });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(a.connected, true);
    const now = Date.now();
    room.fish.f999 = { id: 'f999', type: fishTypes[0], fromLeft: true, y: 0.5, startTime: now - 1000, durationMs: 10000 };
    const rejected = once(a, 'catchRejected');
    a.emit('catchAttempt', { fishId: 'f999' });
    assert.equal((await rejected).fishId, 'f999');
    a.emit('boatMove', { xRatio: 0.8, yRatio: 435 / 800, width: 1280, height: 800 });
    const far = once(a, 'catchRejected');
    a.emit('catchAttempt', { fishId: 'f999' });
    await far;
    assert.equal(room.players[a.id].score, 0);
    a.emit('boatMove', { xRatio: 123 / 1280, yRatio: 435 / 800, width: 1280, height: 800 });
    const caught = once(a, 'fishCaught');
    a.emit('catchAttempt', { fishId: 'f999' });
    assert.equal((await caught).byId, a.id);
    assert.equal(room.players[a.id].score, 15);
    const treasureType = fishTypes.find(f => f.isTreasure);
    room.fish.f1000 = { id: 'f1000', type: treasureType, fromLeft: true, y: 0.5, startTime: now - 1000, durationMs: 10000 };
    const treasureCaught = once(a, 'fishCaught');
    a.emit('catchAttempt', { fishId: 'f1000' });
    const treasureInfo = await treasureCaught;
    assert.equal(treasureInfo.isTreasure, true);
    assert.ok(typeof treasureInfo.lootName === 'string' && treasureInfo.lootName.length > 0);
    state = once(a, 'roomState');
    a.emit('joinRoom', { roomCode: 'alpha', name: 'A' });
    await state;
    assert.ok(room.players[a.id].score > 15);
    assert.equal(Object.keys(room.players).length, 2);
    room.activeWeather = 'snow';
    room.weatherEndsAt = Date.now() + 4000;
    c = client(url, { transports: ['websocket'] });
    await once(c, 'connect');
    state = once(c, 'roomState');
    c.emit('joinRoom', { roomCode: 'alpha', name: 'C' });
    const lateState = await state;
    assert.equal(lateState.activeWeather, 'snow');
    assert.ok(lateState.weatherRemainingMs > 0);
    c.disconnect();
    await new Promise(resolve => setTimeout(resolve, 20));
    roomApi.endRound('ALPHA');
    assert.equal(room.timerInterval, null, 'ending a round from outside stops the countdown too');
    const entries = await leaderboard.list();
    assert.equal(entries[0].score, room.players[a.id].score);
    assert.equal(entries.length, 2);
    state = once(a, 'roomState');
    a.emit('joinRoom', { roomCode: 'beta', name: 'A' });
    await state;
    assert.equal(room.players[a.id], undefined);
    assert.equal(Object.keys(roomApi.rooms.BETA.players).length, 1);
    b.disconnect();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(roomApi.rooms.ALPHA, undefined);
    a.disconnect();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(roomApi.rooms.BETA, undefined);
  } finally {
    a.disconnect(); b.disconnect(); if (c) c.disconnect();
    for (const code of Object.keys(roomApi.rooms)) {
      for (const id of Object.keys(roomApi.rooms[code].players)) roomApi.removePlayer(code, id);
    }
    await new Promise(resolve => io.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('boss: a partial hit keeps it alive, the final hit scores and schedules the next boss', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-test-'));
  const { server, io, roomApi } = createApp({ leaderboardFile: path.join(directory, 'scores.json') });
  await new Promise(resolve => server.listen(0, resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const a = client(url, { transports: ['websocket'] });
  try {
    await once(a, 'connect');
    const state = once(a, 'roomState');
    a.emit('joinRoom', { roomCode: 'boss', name: 'A' });
    await state;
    const room = roomApi.rooms.BOSS;
    const type = bossTypes.find(b => !b.stealth);
    const width = 1280, height = 800;
    const aimAt = fish => {
      const point = bossWanderPosition(fish.seed, (Date.now() - fish.startTime) / 1000, fish.type);
      a.emit('boatMove', { xRatio: (point.xRatio * width + type.half) / width,
        yRatio: (point.yRatio * height + type.half) / height, width, height });
    };
    const boss = { id: 'boss900', type, seed: 0.5, startTime: Date.now() - 2000, durationMs: 28000, hitsNeeded: 2, hitsLanded: 0 };
    room.fish.boss900 = boss;

    aimAt(boss);
    const inked = once(a, 'bossInked');
    a.emit('catchAttempt', { fishId: 'boss900' });
    assert.equal((await inked).byId, a.id);
    assert.equal(room.fish.boss900, boss);

    boss.invulnerableUntil = 0;
    clearTimeout(room.bossTimer);
    room.bossTimer = null;
    aimAt(boss);
    const caught = once(a, 'fishCaught');
    a.emit('catchAttempt', { fishId: 'boss900' });
    const info = await caught;
    assert.equal(info.isBoss, true);
    assert.equal(info.points, type.points);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(room.fish.boss900, undefined);
    assert.ok(room.bossTimer, 'next boss should be scheduled');
    assert.equal(a.connected, true);
  } finally {
    a.disconnect();
    for (const code of Object.keys(roomApi.rooms)) {
      for (const id of Object.keys(roomApi.rooms[code].players)) roomApi.removePlayer(code, id);
    }
    await new Promise(resolve => io.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('fierce bosses eat only point fish, and the king crab throws trash that costs points', async () => {
  const { hitbox } = require('../public/fishing/game-config.json');
  const { regularFishCenter, trashCenter } = require('../public/fishing/js/shared/boss-math');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-test-'));
  const { server, io, roomApi } = createApp({ leaderboardFile: path.join(directory, 'scores.json') });
  await new Promise(resolve => server.listen(0, resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const a = client(url, { transports: ['websocket'] });
  const waitFor = (event, ms) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout: ' + event)), ms);
    a.once(event, value => { clearTimeout(timeout); resolve(value); });
  });
  try {
    await once(a, 'connect');
    const state = once(a, 'roomState');
    a.emit('joinRoom', { roomCode: 'fierce', name: 'A' });
    await state;
    const room = roomApi.rooms.FIERCE;
    clearInterval(room.spawnTimer); clearTimeout(room.bossTimer); clearTimeout(room.rivalTimer);
    for (const id of Object.keys(room.fish)) delete room.fish[id];

    // 먹는 보스 바로 옆에 점수 물고기(참치)와 감점 생물(해파리)을 둬요. 해파리가 더 가까워도 참치만 먹어요.
    const eater = bossTypes.find(b => b.eats);
    const W = hitbox.eatRefWidth, H = hitbox.eatRefHeight;
    const now = Date.now();
    const boss = { id: 'boss950', type: eater, seed: 0.3, startTime: now, durationMs: 28000, hitsNeeded: 3, hitsLanded: 0 };
    const p = bossWanderPosition(boss.seed, 0.15, eater);
    const bx = p.xRatio * W + eater.half, by = p.yRatio * H + eater.half;
    const fishAt = (id, type, dx) => {
      const durationMs = 1e7; // 거의 멈춰 있게
      const f = { id, type, fromLeft: true, y: (by - hitbox.fishHalf) / H, startTime: now, durationMs };
      f.startTime = now - ((bx + dx + 50 - hitbox.fishHalf) / (W + 100)) * durationMs;
      assert.ok(Math.abs(regularFishCenter(f, now - f.startTime, W, H, hitbox.fishHalf).x - (bx + dx)) < 0.01);
      room.fish[id] = f;
    };
    const tuna = fishTypes.find(f => f.name === '참치');
    const jelly = fishTypes.find(f => f.points < 0 && !f.isBossTrash);
    fishAt('f951', jelly, 0);
    fishAt('f952', tuna, 25);
    room.fish.boss950 = boss;
    const eaten = waitFor('fishEaten', 2000);
    roomApi.startBossActions('FIERCE', room, boss);
    const info = await eaten;
    assert.deepEqual(info, { id: 'f952', bossId: 'boss950' });
    assert.equal(room.fish.f952, undefined);
    assert.ok(room.fish.f951, 'negative-point creatures are never eaten');
    delete room.fish.boss950;
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(room.bossActTimer, null, 'boss actions stop once the boss is gone');

    // 대왕게: everyMs마다 쓰레기를 뿌리고, 그걸 잡으면 점수가 깎여요
    const crab = bossTypes.find(b => b.throwsTrash);
    const crabBoss = { id: 'boss960', type: crab, seed: 0, startTime: Date.now(), durationMs: 28000, hitsNeeded: 4, hitsLanded: 0 };
    room.fish.boss960 = crabBoss;
    const spawned = waitFor('fishSpawn', crab.throwsTrash.everyMs + 1500);
    roomApi.startBossActions('FIERCE', room, crabBoss);
    const trash = await spawned;
    assert.equal(trash.type.isBossTrash, true);
    assert.ok(trash.trash);
    delete room.fish.boss960;
    room.players[a.id].score = 10;
    const width = 1280, height = 800;
    const c = trashCenter(trash.trash, (Date.now() - trash.startTime) / 1000, width, height);
    a.emit('boatMove', { xRatio: c.x / width, yRatio: c.y / height, width, height });
    const caught = once(a, 'fishCaught');
    a.emit('catchAttempt', { fishId: trash.id });
    assert.equal((await caught).points, trash.type.points);
    assert.equal(room.players[a.id].score, 10 + trash.type.points);
  } finally {
    a.disconnect();
    for (const code of Object.keys(roomApi.rooms)) {
      for (const id of Object.keys(roomApi.rooms[code].players)) roomApi.removePlayer(code, id);
    }
    await new Promise(resolve => io.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('the home page lists the games, and the fishing game asks for versioned scripts', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-test-'));
  const { server, io } = createApp({ leaderboardFile: path.join(directory, 'scores.json') });
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const home = await fetch(base + '/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /href: '\/fishing\/'/, 'the home page links to the fishing game');

    const redirect = await fetch(base + '/fishing', { redirect: 'manual' });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('location'), '/fishing/');
    await redirect.arrayBuffer();

    // 쿼리스트링을 달고 들어와도 리다이렉트 주소에 그대로 옮겨져야 해요 (예: 공유 링크의 ?ref=...)
    const redirectWithQuery = await fetch(base + '/fishing?ref=friend', { redirect: 'manual' });
    assert.equal(redirectWithQuery.headers.get('location'), '/fishing/?ref=friend');
    await redirectWithQuery.arrayBuffer();

    const res = await fetch(base + '/fishing/');
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    const html = await res.text();
    assert.doesNotMatch(html, /__BUILD_ID__/);
    const version = html.match(/const version = "([0-9a-f]{10})"/);
    assert.ok(version, 'build id injected');
    for (const file of ['js/core.js', 'js/shared/boss-math.js', 'game-config.json']) {
      const asset = await fetch(base + '/fishing/' + file + '?v=' + version[1]);
      assert.equal(asset.status, 200, file);
      assert.equal(asset.headers.get('cache-control'), 'no-cache');
      await asset.arrayBuffer();
    }
  } finally {
    await new Promise(resolve => io.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('a game folder name with regex-special characters does not break routing or crash the server', async () => {
  // README가 안내하는 대로 "새 게임은 public/<폴더>/ 에 넣으면 된다"고 했을 때, 그 폴더 이름에
  // 정규식에서 특별한 뜻을 가진 글자(., +)가 있어도 서버가 뜨고 그 게임만 정확히 매칭돼야 해요.
  const publicDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-routing-'));
  const gameDir = path.join(publicDir, 'co.op+fun');
  await fs.mkdir(gameDir);
  await fs.writeFile(path.join(gameDir, 'index.html'), '<!doctype html><title>__BUILD_ID__</title>');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-test-'));
  const { server, io } = createApp({ leaderboardFile: path.join(directory, 'scores.json'), publicDir });
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const redirect = await fetch(base + '/co.op+fun', { redirect: 'manual' });
    assert.equal(redirect.status, 301, 'the exact folder name (with its special characters) redirects');
    assert.equal(redirect.headers.get('location'), '/co.op+fun/');
    await redirect.arrayBuffer();

    // 이스케이프가 안 됐다면 '.'이 아무 글자나 매칭해서 이런 엉뚱한 주소도 같이 걸렸을 거예요
    const unrelated = await fetch(base + '/coXop+fun', { redirect: 'manual' });
    assert.equal(unrelated.status, 404, 'a similar but different path must not match');
    await unrelated.arrayBuffer();

    const page = await fetch(base + '/co.op+fun/');
    assert.equal(page.status, 200);
    assert.doesNotMatch(await page.text(), /__BUILD_ID__/);
  } finally {
    await new Promise(resolve => io.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(publicDir, { recursive: true, force: true });
  }
});

