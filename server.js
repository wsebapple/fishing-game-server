const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 배포할 때마다 바뀌는 버전 꼬리표: 게임 스크립트·설정 파일 내용으로 만들어요.
// 게임마다 자기 폴더 밑에서 "js/core.js?v=버전"처럼 상대 경로로 스크립트를 부르니, 새로 배포하면
// 주소가 바뀌어서 아이폰 사파리가 예전 파일(캐시)과 새 파일을 섞어 쓰는 일이 없어요.
function computeBuildId(publicDir) {
  const hash = crypto.createHash('sha1');
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|json|html)$/.test(entry.name)) hash.update(entry.name).update(fs.readFileSync(full));
    });
  walk(publicDir);
  return hash.digest('hex').slice(0, 10);
}
const { Server } = require('socket.io');
const { createRooms } = require('./server/rooms');
const { createLeaderboard } = require('./server/leaderboard');
const { createPoints } = require('./server/points');
const { createCosts } = require('./server/costs');
const { attachSockets } = require('./server/socket');

function getBearerToken(req) {
  const match = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  return match ? match[1] : null;
}

function createApp(options = {}) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  const leaderboard = createLeaderboard(options.leaderboardFile);
  const roomApi = createRooms(io, leaderboard);
  const points = createPoints(options.pointsFile, options.pointsSecret);
  const costs = createCosts(options.costsFile);
  const adminKey = options.adminKey || process.env.ADMIN_KEY || '';
  // 관리자 코드는 길이가 달라도 안전하게 시간차 공격 없이 비교해요. 코드가 설정 안 돼 있으면 항상 거부해요.
  function isAdmin(req) {
    if (!adminKey) return false;
    const provided = req.get('x-admin-key') || '';
    const a = Buffer.from(adminKey), b = Buffer.from(provided);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // public/index.html은 여러 게임을 고르는 메인 페이지이고, 게임마다 public/<게임>/ 폴더에 index.html이 있어요.
  // index.html이 있는 폴더마다 똑같이: /게임 → /게임/ 로 보내고, 첫 화면에 버전 꼬리표를 넣어 매번 새로 확인하게 해요.
  // 평소엔 이 저장소의 public/ 폴더를 쓰지만, 테스트에서 임시 폴더 구조로 라우팅을 확인할 수 있게 옵션으로 바꿀 수 있어요
  const publicDir = options.publicDir || path.join(__dirname, 'public');
  const buildId = computeBuildId(publicDir);
  for (const dir of fs.readdirSync(publicDir, { withFileTypes: true })) {
    const indexFile = path.join(publicDir, dir.name, 'index.html');
    if (!dir.isDirectory() || !fs.existsSync(indexFile)) continue;
    const html = fs.readFileSync(indexFile, 'utf8').replace(/__BUILD_ID__/g, buildId);
    // 폴더 이름을 문자열 경로('/fishing/'처럼)로 등록하면 Express가 그 경로를 자기만의 패턴 문법(path-to-regexp)으로
    // 다시 해석해서, +·.·:·( 같은 글자가 폴더 이름에 있을 때 다르게(또는 아예 안) 매칭될 수 있어요. 그래서 세 경로
    // 모두 직접 만든 정규식 하나로 통일하고, 이름은 미리 이스케이프해서 정규식에서 아무 특별한 뜻도 없게 해요.
    const escapedName = dir.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 주소 끝에 /가 없으면(/fishing) 게임 안의 상대 경로(js/core.js 등)가 틀어지니 /fishing/으로 보내요
    // (Express는 기본적으로 끝의 /를 무시해서 '/fishing'으로 등록하면 '/fishing/'까지 잡혀 무한 리다이렉트가 돼요. 정규식으로 딱 맞춰요)
    // 쿼리스트링(예: ?ref=...)은 리다이렉트 주소에 그대로 옮겨줘야 나중에 그런 값을 쓰는 기능이 생겨도 안 끊겨요.
    app.get(new RegExp('^/' + escapedName + '$'), (req, res) => {
      const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      res.redirect(301, '/' + dir.name + '/' + query);
    });
    app.get(new RegExp('^/' + escapedName + '/(?:index\\.html)?$'), (req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.type('html').send(html);
    });
  }
  app.use(express.static(publicDir, {
    // 파일마다 매번 서버에 "바뀌었나요?"를 물어보게 해요(안 바뀌었으면 304로 가볍게 끝나요)
    setHeaders: res => res.set('Cache-Control', 'no-cache'),
  }));
  app.get('/rooms', (req, res) => {
    res.json(Object.entries(roomApi.rooms)
      .filter(([, room]) => Object.keys(room.players).length > 0)
      .map(([code, room]) => ({ code, players: Object.keys(room.players).length }))
      .sort((a, b) => b.players - a.players));
  });
  app.get('/leaderboard', async (req, res) => {
    try { res.json(await leaderboard.list()); }
    catch (error) { console.error('순위표 조회 실패', error); res.status(500).json({ error: '순위표를 불러올 수 없습니다.' }); }
  });

  app.use(express.json());

  app.post('/api/points/login', async (req, res) => {
    const name = points.normalizeName(req.body && req.body.name);
    const pin = points.normalizePin(req.body && req.body.pin);
    if (!name || !pin) { res.status(400).json({ error: '이름과 4자리 PIN을 입력해주세요.' }); return; }
    try {
      const { points: earned, token } = await points.login(name, pin);
      res.json({ name, points: earned, token });
    } catch (error) {
      if (error.code === 'PIN_MISMATCH') { res.status(401).json({ error: 'PIN이 일치하지 않아요.' }); return; }
      console.error('포인트 로그인 실패', error);
      res.status(500).json({ error: '로그인에 실패했어요.' });
    }
  });

  app.get('/api/points/me', async (req, res) => {
    const name = points.verifyToken(getBearerToken(req));
    if (!name) { res.status(401).json({ error: '로그인이 필요해요.' }); return; }
    try {
      const earned = await points.getPoints(name);
      if (earned == null) { res.status(401).json({ error: '로그인이 필요해요.' }); return; }
      res.json({ name, points: earned });
    } catch (error) {
      console.error('포인트 조회 실패', error);
      res.status(500).json({ error: '포인트를 불러올 수 없습니다.' });
    }
  });

  // 입장료는 누구나 볼 수 있는 정보라 로그인 없이 조회돼요(허브 화면에서 카드마다 표시하는 데 써요)
  app.get('/api/points/costs', async (req, res) => {
    try { res.json(await costs.list()); }
    catch (error) { console.error('입장료 조회 실패', error); res.status(500).json({ error: '입장료를 불러올 수 없습니다.' }); }
  });

  app.post('/api/points/spend', async (req, res) => {
    const name = points.verifyToken(getBearerToken(req));
    if (!name) { res.status(401).json({ error: '로그인이 필요해요.' }); return; }
    const gameId = typeof (req.body && req.body.gameId) === 'string' ? req.body.gameId : null;
    if (!gameId) { res.status(400).json({ error: 'gameId가 필요해요.' }); return; }
    try {
      const gameCosts = await costs.list();
      if (!Object.hasOwn(gameCosts, gameId)) { res.status(404).json({ error: '알 수 없는 게임이에요.' }); return; }
      const remaining = await points.spend(name, gameCosts[gameId]);
      res.json({ points: remaining });
    } catch (error) {
      if (error.code === 'INSUFFICIENT') { res.status(402).json({ error: '포인트가 부족해요.' }); return; }
      if (error.code === 'NOT_FOUND') { res.status(401).json({ error: '로그인이 필요해요.' }); return; }
      console.error('포인트 차감 실패', error);
      res.status(500).json({ error: '포인트 차감에 실패했어요.' });
    }
  });

  app.get('/api/admin/players', async (req, res) => {
    if (!isAdmin(req)) { res.status(401).json({ error: '관리자 코드가 필요해요.' }); return; }
    try { res.json(await points.listAll()); }
    catch (error) { console.error('플레이어 목록 조회 실패', error); res.status(500).json({ error: '목록을 불러올 수 없습니다.' }); }
  });

  app.post('/api/admin/grant', async (req, res) => {
    if (!isAdmin(req)) { res.status(401).json({ error: '관리자 코드가 필요해요.' }); return; }
    const name = points.normalizeName(req.body && req.body.name);
    const amount = Number(req.body && req.body.amount);
    if (!name || !Number.isFinite(amount)) { res.status(400).json({ error: '이름과 숫자 포인트를 입력해주세요.' }); return; }
    try {
      const updated = await points.grant(name, amount);
      res.json({ name, points: updated });
    } catch (error) {
      if (error.code === 'NOT_FOUND') { res.status(404).json({ error: '그런 이름은 없어요. 먼저 본인이 한 번 로그인해야 지급할 수 있어요.' }); return; }
      console.error('포인트 지급 실패', error);
      res.status(500).json({ error: '포인트 지급에 실패했어요.' });
    }
  });

  app.get('/api/admin/costs', async (req, res) => {
    if (!isAdmin(req)) { res.status(401).json({ error: '관리자 코드가 필요해요.' }); return; }
    try { res.json(await costs.list()); }
    catch (error) { console.error('입장료 조회 실패', error); res.status(500).json({ error: '입장료를 불러올 수 없습니다.' }); }
  });

  app.post('/api/admin/costs', async (req, res) => {
    if (!isAdmin(req)) { res.status(401).json({ error: '관리자 코드가 필요해요.' }); return; }
    const gameId = typeof (req.body && req.body.gameId) === 'string' ? req.body.gameId : null;
    const cost = Number(req.body && req.body.cost);
    if (!gameId || !Number.isFinite(cost) || cost < 0) { res.status(400).json({ error: '게임과 0 이상의 입장료를 입력해주세요.' }); return; }
    try { res.json(await costs.setCost(gameId, cost)); }
    catch (error) { console.error('입장료 수정 실패', error); res.status(500).json({ error: '입장료 수정에 실패했어요.' }); }
  });

  attachSockets(io, roomApi);
  return { app, server, io, roomApi, leaderboard, points, costs };
}

if (require.main === module) {
  const { server } = createApp();
  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log('서버 실행 중: 포트 ' + port));
}
module.exports = { createApp };
