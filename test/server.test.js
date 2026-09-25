const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { io: client } = require('socket.io-client');
const { createApp } = require('../server');
const { createRooms } = require('../server/rooms');
const { STARTING_POINTS } = require('../server/points');
const { fishTypes, bossTypes, hitbox } = require('../public/fishing/game-config.json');
const { bossWanderPosition } = require('../server/fish');
const { regularFishCenter } = require('../public/fishing/js/shared/boss-math');

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

test('normalizeName keeps emoji whole and strips control characters', () => {
  const roomApi = createRooms({ to: () => ({ emit: () => {} }) }, { record: () => Promise.resolve(), list: () => Promise.resolve([]) });
  assert.equal(roomApi.normalizeName('a'.repeat(11) + '😀' + 'b'), 'a'.repeat(11) + '😀', '자르는 위치가 이모지 한가운데를 지나가면 안 돼요');
  assert.equal(roomApi.normalizeName('\u0000hello\u0000'), 'hello', '제어문자는 걷어내요');
  assert.equal(roomApi.normalizeName('   '), '친구', '빈 이름은 기본값으로 대체해요');
});

test('the clock bonus cannot push the round timer past the cap', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-test-'));
  const { server, io, roomApi } = createApp({ leaderboardFile: path.join(directory, 'scores.json') });
  await new Promise(resolve => server.listen(0, resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const a = client(url, { transports: ['websocket'] });
  try {
    await once(a, 'connect');
    const state = once(a, 'roomState');
    a.emit('joinRoom', { roomCode: 'clock', name: 'A' });
    await state;
    const room = roomApi.rooms.CLOCK;
    const clockType = fishTypes.find(f => f.isTimeBonus);
    room.timeLeft = roomApi.MAX_TIME_LEFT - 1;
    room.fish.f900 = { id: 'f900', type: clockType, fromLeft: true, y: 0.5, startTime: Date.now() - 1000, durationMs: 10000 };
    a.emit('boatMove', { xRatio: 123 / 1280, yRatio: 435 / 800, width: 1280, height: 800 });
    const caught = once(a, 'fishCaught');
    a.emit('catchAttempt', { fishId: 'f900' });
    await caught;
    assert.equal(room.timeLeft, roomApi.MAX_TIME_LEFT, '상한을 넘어 계속 늘어나면 안 돼요');
  } finally {
    a.disconnect();
    for (const code of Object.keys(roomApi.rooms)) {
      for (const id of Object.keys(roomApi.rooms[code].players)) roomApi.removePlayer(code, id);
    }
    await new Promise(resolve => io.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('boatMove flooding is throttled instead of overwhelming the room', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-test-'));
  const { server, io, roomApi } = createApp({ leaderboardFile: path.join(directory, 'scores.json') });
  await new Promise(resolve => server.listen(0, resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const a = client(url, { transports: ['websocket'] });
  const b = client(url, { transports: ['websocket'] });
  try {
    await Promise.all([once(a, 'connect'), once(b, 'connect')]);
    let state = once(a, 'roomState');
    a.emit('joinRoom', { roomCode: 'flood', name: 'A' });
    await state;
    state = once(b, 'roomState');
    b.emit('joinRoom', { roomCode: 'flood', name: 'B' });
    await state;

    let received = 0;
    b.on('boatMove', () => { received++; });
    for (let i = 0; i < 600; i++) {
      a.emit('boatMove', { xRatio: 0.5, yRatio: 0.5, width: 1280, height: 800 });
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.ok(received <= 130, `초당 제한을 넘어서면 안 돼요 (받은 개수: ${received})`);
    assert.equal(a.connected, true, '너무 많이 보내도 연결은 끊기지 않아요');

    await new Promise(resolve => setTimeout(resolve, 1000));
    const nextMove = once(b, 'boatMove');
    a.emit('boatMove', { xRatio: 0.6, yRatio: 0.6, width: 1280, height: 800 });
    await nextMove; // 다음 초 창에서는 다시 정상적으로 전달돼요
  } finally {
    a.disconnect(); b.disconnect();
    for (const code of Object.keys(roomApi.rooms)) {
      for (const id of Object.keys(roomApi.rooms[code].players)) roomApi.removePlayer(code, id);
    }
    await new Promise(resolve => io.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('the pirate net sweeps the lure and its close neighbours only', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-test-'));
  const { server, io, roomApi } = createApp({ leaderboardFile: path.join(directory, 'scores.json') });
  await new Promise(resolve => server.listen(0, resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const a = client(url, { transports: ['websocket'] });
  const origRandom = Math.random;
  try {
    await once(a, 'connect');
    const state = once(a, 'roomState');
    a.emit('joinRoom', { roomCode: 'pirate', name: 'A' });
    await state;
    const room = roomApi.rooms.PIRATE;
    clearInterval(room.spawnTimer); clearTimeout(room.bossTimer); clearTimeout(room.rivalTimer);
    for (const id of Object.keys(room.fish)) delete room.fish[id];

    const regular = fishTypes.find(f => !f.isTreasure && !f.isBoss && !f.isBossTrash && !f.isMagnet && !f.isTimeBonus);
    const W = hitbox.eatRefWidth, H = hitbox.eatRefHeight, now = Date.now();
    const bx = 300, by = 300;
    const fishAt = (id, dx) => {
      const durationMs = 1e7; // 거의 멈춰 있게
      const f = { id, type: regular, fromLeft: true, y: (by - hitbox.fishHalf) / H, startTime: now, durationMs };
      f.startTime = now - ((bx + dx + 50 - hitbox.fishHalf) / (W + 100)) * durationMs;
      assert.ok(Math.abs(regularFishCenter(f, now - f.startTime, W, H, hitbox.fishHalf).x - (bx + dx)) < 0.01);
      room.fish[id] = f;
    };
    fishAt('f1', 0);   // lure (조준당하는 물고기)
    fishAt('f2', 100); // 반경(150) 안 — 같이 쓸려가요
    fishAt('f3', 400); // 반경 밖 — 그대로 남아요

    Math.random = () => 0; // 등록 순서상 첫 번째(f1)가 lure로 뽑히게 고정
    const stolen = once(a, 'fishStolen');
    roomApi.tryStealForRoom('PIRATE');
    const items = await stolen;
    assert.deepEqual(items.map(i => i.id).sort(), ['f1', 'f2'], '조준 대상과 가까운 것만 그물에 걸려요');
    assert.equal(room.fish.f1, undefined);
    assert.equal(room.fish.f2, undefined);
    assert.ok(room.fish.f3, '반경 밖 물고기는 안 쓸려가요');
  } finally {
    Math.random = origRandom;
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

test('points login/me: register, re-login with the right PIN, reject the wrong one, reject a bad token', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-test-'));
  const { server, io } = createApp({ leaderboardFile: path.join(directory, 'scores.json'), pointsFile: path.join(directory, 'points.json'), pointsSecret: 'test-secret' });
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const postJson = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    const first = await postJson('/api/points/login', { name: '테스터', pin: '1234' });
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.points, STARTING_POINTS);
    assert.ok(firstBody.token);

    const me = await fetch(base + '/api/points/me', { headers: { Authorization: 'Bearer ' + firstBody.token } });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { name: '테스터', points: STARTING_POINTS });

    const wrongPin = await postJson('/api/points/login', { name: '테스터', pin: '9999' });
    assert.equal(wrongPin.status, 401);

    const badToken = await fetch(base + '/api/points/me', { headers: { Authorization: 'Bearer garbage' } });
    assert.equal(badToken.status, 401);

    const noBody = await postJson('/api/points/login', { name: '테스터' });
    assert.equal(noBody.status, 400);
  } finally {
    await new Promise(resolve => io.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('points spend: costs are public, spending deducts and blocks entry when short, and requires login', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-test-'));
  const { server, io, points } = createApp({ leaderboardFile: path.join(directory, 'scores.json'), pointsFile: path.join(directory, 'points.json'), pointsSecret: 'test-secret' });
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const postJson = (route, body, headers) => fetch(base + route, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body) });

    const costs = await (await fetch(base + '/api/points/costs')).json();
    assert.equal(costs.fishing, 5);

    const login = await (await postJson('/api/points/login', { name: '입장테스트', pin: '1234' })).json();
    const auth = { Authorization: 'Bearer ' + login.token };

    const noLogin = await postJson('/api/points/spend', { gameId: 'fishing' });
    assert.equal(noLogin.status, 401);

    await points.grant('입장테스트', -STARTING_POINTS); // 시작 포인트를 다 쓴 상태로 만들어요
    const shortOnPoints = await postJson('/api/points/spend', { gameId: 'fishing' }, auth);
    assert.equal(shortOnPoints.status, 402, '가진 포인트가 부족하면 입장료를 못 내요');

    await points.grant('입장테스트', 10);
    const spent = await postJson('/api/points/spend', { gameId: 'fishing' }, auth);
    assert.equal(spent.status, 200);
    assert.equal((await spent.json()).points, 5);

    const unknownGame = await postJson('/api/points/spend', { gameId: 'no-such-game' }, auth);
    assert.equal(unknownGame.status, 404);
  } finally {
    await new Promise(resolve => io.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('points earn: a learning game reports correct answers and gets points back, gated by login', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-test-'));
  const { server, io } = createApp({ leaderboardFile: path.join(directory, 'scores.json'), pointsFile: path.join(directory, 'points.json'), pointsSecret: 'test-secret' });
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const postJson = (route, body, headers) => fetch(base + route, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body) });

    const noLogin = await postJson('/api/points/earn', { gameId: 'hanja-game', units: 5 });
    assert.equal(noLogin.status, 401);

    const login = await (await postJson('/api/points/login', { name: '한자테스트', pin: '1234' })).json();
    const auth = { Authorization: 'Bearer ' + login.token };

    const earned = await postJson('/api/points/earn', { gameId: 'hanja-game', units: 5 }, auth);
    assert.equal(earned.status, 200);
    const earnedBody = await earned.json();
    assert.equal(earnedBody.awarded, 5);
    assert.equal(earnedBody.points, STARTING_POINTS + 5);

    const unknownGame = await postJson('/api/points/earn', { gameId: 'no-such-learning-game', units: 5 }, auth);
    assert.equal(unknownGame.status, 404);

    const badUnits = await postJson('/api/points/earn', { gameId: 'hanja-game', units: -1 }, auth);
    assert.equal(badUnits.status, 400);
  } finally {
    await new Promise(resolve => io.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('admin endpoints require the configured admin key and let an admin grant points and change costs', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-test-'));
  const { server, io } = createApp({
    leaderboardFile: path.join(directory, 'scores.json'),
    pointsFile: path.join(directory, 'points.json'),
    costsFile: path.join(directory, 'game-costs.json'),
    pointsSecret: 'test-secret',
    adminKey: 'let-me-in',
  });
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const asAdmin = { 'X-Admin-Key': 'let-me-in' };
    const postJson = (route, body, headers) => fetch(base + route, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body) });

    const wrongKey = await fetch(base + '/api/admin/players', { headers: { 'X-Admin-Key': 'nope' } });
    assert.equal(wrongKey.status, 401);
    const noKey = await fetch(base + '/api/admin/players');
    assert.equal(noKey.status, 401);

    await postJson('/api/points/login', { name: '관리자테스트', pin: '1234' });

    const grantUnknown = await postJson('/api/admin/grant', { name: '없는사람', amount: 5 }, asAdmin);
    assert.equal(grantUnknown.status, 404);

    const grant = await postJson('/api/admin/grant', { name: '관리자테스트', amount: 8 }, asAdmin);
    assert.equal(grant.status, 200);
    assert.equal((await grant.json()).points, STARTING_POINTS + 8);

    const players = await (await fetch(base + '/api/admin/players', { headers: asAdmin })).json();
    assert.deepEqual(players, [{ name: '관리자테스트', points: STARTING_POINTS + 8 }]);

    const setCost = await postJson('/api/admin/costs', { gameId: 'fishing', cost: 12 }, asAdmin);
    assert.equal(setCost.status, 200);
    assert.equal((await setCost.json()).fishing, 12);

    const publicCosts = await (await fetch(base + '/api/points/costs')).json();
    assert.equal(publicCosts.fishing, 12, '관리자가 바꾼 입장료가 공개 조회에도 바로 반영돼요');
  } finally {
    await new Promise(resolve => io.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('DATA_DIR (or the dataDir option) places leaderboard/points/costs files under it when no explicit file path is given', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-datadir-'));
  const origEnv = process.env.DATA_DIR;
  try {
    process.env.DATA_DIR = dataDir;
    const { server, io, leaderboard, points, costs } = createApp({});
    await new Promise(resolve => server.listen(0, resolve));
    try {
      await leaderboard.record({ a: { name: 'A', score: 3 } });
      await points.login('디비테스트', '1234');
      await costs.setCost('fishing', 9);

      const files = await fs.readdir(dataDir);
      assert.deepEqual(files.sort(), ['game-costs.json', 'leaderboard.json', 'points.json']);
    } finally {
      await new Promise(resolve => io.close(resolve));
    }
  } finally {
    if (origEnv === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = origEnv;
    await fs.rm(dataDir, { recursive: true, force: true });
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

