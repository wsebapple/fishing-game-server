# 낚시 게임

Node.js 18 이상에서 `npm install` 후 `npm start`를 실행하고 `http://localhost:3000`에 접속합니다. 첫 화면(`public/index.html`)은 여러 게임을 고르는 메인 페이지이고, 낚시 게임은 `http://localhost:3000/fishing/`에 있습니다. 새 게임은 `public/<폴더>/`에 넣고 메인 페이지의 `GAMES` 목록에 한 줄 추가하면 됩니다. 테스트는 `npm test`로 실행합니다.

`server.js`는 HTTP/Socket.IO 시작점입니다. `server/rooms.js`가 방과 라운드를 관리하고, `server/fish.js`가 물고기 위치와 포획 판정을 계산하며, `server/socket.js`가 클라이언트 이벤트를 검증합니다. 순위 기록은 `server/leaderboard.js`가 `data/leaderboard.json`에 보관합니다. 이 파일은 Git에서 제외됩니다.

낚시 게임 브라우저 코드는 `public/fishing/js/`에서 싱글플레이, 멀티플레이, UI, 사운드로 나뉩니다. 게임 상태는 전역 변수 대신 `core.js`가 만드는 `window.Game` 아래(`Game.config`, `Game.state`, `Game.mp` 등)에 모여 있습니다. 물고기 종류·레벨·판정 크기 설정은 서버와 브라우저가 `public/fishing/game-config.json`을 함께 사용하고, 보스 이동·은신, 사나운 보스의 포식, 대왕게 쓰레기 궤적 계산식은 `public/fishing/js/shared/boss-math.js` 한 파일을 서버와 브라우저가 같이 씁니다. 친구 순위표에는 서버가 계산한 멀티플레이 라운드 점수만 기록됩니다. 서버를 여러 인스턴스로 늘리려면 방 상태와 순위 저장소를 공유 저장소로 옮겨야 합니다.
