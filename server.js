const express = require('express');
const http = require('http');
const path = require('path');
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

  app.use(express.static(path.join(__dirname, 'public')));
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
