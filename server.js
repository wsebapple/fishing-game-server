const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 배포할 때마다 바뀌는 버전 꼬리표: 게임 스크립트·설정 파일 내용으로 만들어요.
// index.html이 스크립트를 "/js/core.js?v=버전"으로 부르니, 새로 배포하면 주소가 바뀌어서
// 아이폰 사파리가 예전 파일(캐시)과 새 파일을 섞어 쓰는 일이 없어요.
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
const { attachSockets } = require('./server/socket');

function createApp(options = {}) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  const leaderboard = createLeaderboard(options.leaderboardFile);
  const roomApi = createRooms(io, leaderboard);

  const publicDir = path.join(__dirname, 'public');
  const buildId = computeBuildId(publicDir);
  const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8').replace(/__BUILD_ID__/g, buildId);
  // 첫 화면(index.html)은 매번 새로 확인하게 해서, 항상 최신 버전 꼬리표를 받아가게 해요
  app.get(['/', '/index.html'], (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(indexHtml);
  });
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
  attachSockets(io, roomApi);
  return { app, server, io, roomApi, leaderboard };
}

if (require.main === module) {
  const { server } = createApp();
  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log('서버 실행 중: 포트 ' + port));
}
module.exports = { createApp };
