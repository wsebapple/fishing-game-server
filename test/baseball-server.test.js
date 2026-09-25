const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { io: client } = require('socket.io-client');
const { createApp } = require('../server');

function once(socket, event) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout: ' + event)), 3000);
    socket.once(event, value => { clearTimeout(timeout); resolve(value); });
  });
}

function onceAny(socket, events) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout: ' + events.join('/'))), 4000);
    const handlers = {};
    const cleanup = () => { clearTimeout(timeout); events.forEach(e => socket.off(e, handlers[e])); };
    events.forEach(e => {
      handlers[e] = value => { cleanup(); resolve({ event: e, value }); };
      socket.once(e, handlers[e]);
    });
  });
}

const SAMPLE_TEAM = { name: '테스트팀', color: '#112233', emoji: '🦅', ratings: { contact: 4, power: 3, control: 4, stuff: 3 } };

async function setup() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'baseball-test-'));
  const { server, io, baseballRoomApi } = createApp({ leaderboardFile: path.join(directory, 'scores.json'), baseballTurnMs: 800 });
  await new Promise(resolve => server.listen(0, resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  return { directory, server, io, baseballRoomApi, url };
}

async function teardown({ server, io, directory }, sockets) {
  sockets.forEach(s => s && s.disconnect());
  await new Promise(resolve => setTimeout(resolve, 20));
  await new Promise(resolve => io.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
}

test('two players join, pick teams and the first at-bat resolves', async () => {
  const ctx = await setup();
  const a = client(ctx.url, { transports: ['websocket'] });
  const b = client(ctx.url, { transports: ['websocket'] });
  try {
    await Promise.all([once(a, 'connect'), once(b, 'connect')]);

    let state = once(a, 'baseball:roomState');
    a.emit('baseball:joinRoom', { roomCode: 'btest', name: 'A' });
    const aState = await state;
    assert.equal(aState.mySide, 'away');

    state = once(b, 'baseball:roomState');
    b.emit('baseball:joinRoom', { roomCode: 'btest', name: 'B' });
    const bState = await state;
    assert.equal(bState.mySide, 'home');

    const room = ctx.baseballRoomApi.rooms.BTEST;
    assert.equal(Object.keys(room.players).length, 2);

    a.emit('baseball:setTeam', SAMPLE_TEAM);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(room.game, null, 'game should not start until both teams are ready');

    const gameStart = once(a, 'baseball:gameStart');
    const atBatStart = once(a, 'baseball:atBatStart');
    b.emit('baseball:setTeam', { ...SAMPLE_TEAM, name: '상대팀' });
    const started = await gameStart;
    assert.equal(started.game.half, 'top');
    const firstAtBat = await atBatStart;
    // top = away(A)가 타자, home(B)가 투수예요
    assert.equal(firstAtBat.pitcherId, b.id);
    assert.equal(firstAtBat.batterId, a.id);

    // 타자(A)가 투구를 대신 제출하려 해도 무시되고, 아무 판정도 일어나지 않아요
    a.emit('baseball:submitPitch', { atBatId: firstAtBat.atBatId, pitchType: 'fastball', targetZone: { x: 2, y: 2 } });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(room.pending.pitchSubmitted, false);

    const result = once(a, 'baseball:atBatResult');
    b.emit('baseball:submitPitch', { atBatId: firstAtBat.atBatId, pitchType: 'fastball', targetZone: { x: 2, y: 2 } });
    a.emit('baseball:submitSwing', { atBatId: firstAtBat.atBatId, swing: null });
    const outcome = await result;
    assert.equal(outcome.atBatId, firstAtBat.atBatId);
    assert.ok(['ball', 'called_strike'].includes(outcome.outcome.event));
    assert.equal(outcome.game.balls + outcome.game.strikes, 1);
  } finally {
    await teardown(ctx, [a, b]);
  }
});

test('a full game plays to completion within a bounded number of at-bats', async () => {
  const ctx = await setup();
  const a = client(ctx.url, { transports: ['websocket'] });
  const b = client(ctx.url, { transports: ['websocket'] });
  try {
    await Promise.all([once(a, 'connect'), once(b, 'connect')]);
    a.emit('baseball:joinRoom', { roomCode: 'full', name: 'A' });
    await once(a, 'baseball:roomState');
    b.emit('baseball:joinRoom', { roomCode: 'full', name: 'B' });
    await once(b, 'baseball:roomState');

    const atBatStart = once(a, 'baseball:atBatStart');
    a.emit('baseball:setTeam', SAMPLE_TEAM);
    b.emit('baseball:setTeam', { ...SAMPLE_TEAM, name: '상대팀' });
    let atBat = await atBatStart;

    // 매번 같은 곳만 던지고 노리면 거의 매번 맞아서(끝없이 안타) 3아웃이 좀처럼 안 쌓이니,
    // 코스와 스윙을 무작위로 섞어서 실제 경기처럼 삼진·범타도 섞이게 해요.
    const PITCH_TYPES = ['fastball', 'curve', 'changeup'];
    function randZone() { return { x: Math.floor(Math.random() * 5), y: Math.floor(Math.random() * 5) }; }

    let gameOver = null;
    let guard = 0;
    while (!gameOver && guard++ < 1000) {
      const pitcherSocket = atBat.pitcherId === a.id ? a : b;
      const batterSocket = atBat.batterId === a.id ? a : b;
      const nextEvent = onceAny(a, ['baseball:atBatStart', 'baseball:gameOver']);
      pitcherSocket.emit('baseball:submitPitch', { atBatId: atBat.atBatId, pitchType: PITCH_TYPES[Math.floor(Math.random() * 3)], targetZone: randZone() });
      const swing = Math.random() < 0.75
        ? { zone: randZone(), pitchType: PITCH_TYPES[Math.floor(Math.random() * 3)], mode: Math.random() < 0.5 ? 'power' : 'contact' }
        : null;
      batterSocket.emit('baseball:submitSwing', { atBatId: atBat.atBatId, swing });
      const next = await nextEvent;
      if (next.event === 'baseball:gameOver') { gameOver = next.value; break; }
      atBat = next.value;
    }

    assert.ok(gameOver, '경기가 제한된 타석 안에 끝나야 해요');
    assert.ok(['away', 'home', null].includes(gameOver.winner));
    assert.ok(Number.isInteger(gameOver.score.away) && gameOver.score.away >= 0);
    assert.ok(Number.isInteger(gameOver.score.home) && gameOver.score.home >= 0);
    const room = ctx.baseballRoomApi.rooms.FULL;
    assert.equal(room.game.status, 'finished');
  } finally {
    await teardown(ctx, [a, b]);
  }
});

test('a mid-game disconnect forfeits the game to the remaining player', async () => {
  const ctx = await setup();
  const a = client(ctx.url, { transports: ['websocket'] });
  const b = client(ctx.url, { transports: ['websocket'] });
  try {
    await Promise.all([once(a, 'connect'), once(b, 'connect')]);
    a.emit('baseball:joinRoom', { roomCode: 'forfeit', name: 'A' });
    await once(a, 'baseball:roomState');
    b.emit('baseball:joinRoom', { roomCode: 'forfeit', name: 'B' });
    await once(b, 'baseball:roomState');

    const started = once(a, 'baseball:gameStart');
    a.emit('baseball:setTeam', SAMPLE_TEAM);
    b.emit('baseball:setTeam', { ...SAMPLE_TEAM, name: '상대팀' });
    await started;

    const forfeited = once(a, 'baseball:gameOver');
    const opponentLeft = once(a, 'baseball:opponentLeft');
    b.disconnect();
    const gameOver = await forfeited;
    await opponentLeft;
    assert.equal(gameOver.forfeited, true);
    assert.equal(gameOver.winner, 'away'); // A가 원정팀으로 남아서 승리 처리돼요

    await new Promise(resolve => setTimeout(resolve, 20));
    a.disconnect();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(ctx.baseballRoomApi.rooms.FORFEIT, undefined);
  } finally {
    await teardown(ctx, [a, b]);
  }
});

test('an unanswered turn resolves on its own after the timeout', async () => {
  const ctx = await setup(); // baseballTurnMs: 800로 짧게 설정해서 타임아웃 경로를 빠르게 확인해요
  const a = client(ctx.url, { transports: ['websocket'] });
  const b = client(ctx.url, { transports: ['websocket'] });
  try {
    await Promise.all([once(a, 'connect'), once(b, 'connect')]);
    a.emit('baseball:joinRoom', { roomCode: 'timeout', name: 'A' });
    await once(a, 'baseball:roomState');
    b.emit('baseball:joinRoom', { roomCode: 'timeout', name: 'B' });
    await once(b, 'baseball:roomState');

    const atBatStart = once(a, 'baseball:atBatStart');
    a.emit('baseball:setTeam', SAMPLE_TEAM);
    b.emit('baseball:setTeam', { ...SAMPLE_TEAM, name: '상대팀' });
    await atBatStart;

    // 아무도 제출하지 않아도 서버가 알아서 판정해서 다음 타석(또는 종료)으로 넘어가요
    const next = await onceAny(a, ['baseball:atBatStart', 'baseball:gameOver']);
    assert.ok(next.event === 'baseball:atBatStart' || next.event === 'baseball:gameOver');
  } finally {
    await teardown(ctx, [a, b]);
  }
});
