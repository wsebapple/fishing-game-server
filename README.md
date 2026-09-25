# 낚시 게임

Node.js 18 이상에서 `pnpm install` 후 `pnpm start`를 실행하고 `http://localhost:3000`에 접속합니다(`PORT` 환경변수로 포트를 바꿀 수 있어요). 첫 화면(`public/index.html`)은 여러 게임을 고르는 메인 페이지이고, 낚시 게임은 `http://localhost:3000/fishing/`, 바다 소풍 게임은 `http://localhost:3000/sea-picnic/`, 호야의 네모 모험(점핑 게임)은 `http://localhost:3000/nemo-adventure/`, 우주선 뿅뿅대작전(슈팅 게임)은 `http://localhost:3000/spaceship/`, 과일 합체 게임은 `http://localhost:3000/fruit-game/`에 있습니다. 새 게임은 `public/<폴더>/`에 넣고 메인 페이지의 `GAMES` 목록에 한 줄 추가하면 됩니다. 테스트는 `pnpm test`로 실행합니다.

`server.js`는 HTTP/Socket.IO 시작점입니다. `server/rooms.js`가 방과 라운드를 관리하고, `server/fish.js`가 물고기 위치와 포획 판정을 계산하며, `server/socket.js`가 클라이언트 이벤트를 검증합니다. 순위 기록은 `server/leaderboard.js`가 `data/leaderboard.json`에 보관합니다. 이 파일은 Git에서 제외됩니다.

로그인 없이 이름+PIN(4자리)만으로 개인별 포인트를 관리하는 기능은 `server/points.js`가 담당하고, `data/points.json`에 보관합니다(마찬가지로 Git에서 제외). `POST /api/points/login`으로 등록/로그인하면 토큰을 받고, `GET /api/points/me`로 그 토큰의 포인트를 조회합니다. 이름과 PIN을 함께 서명하는 데 쓰는 `POINTS_SECRET` 환경변수를 배포 환경에서 반드시 지정해주세요(지정하지 않으면 개발용 기본값을 쓰므로 안전하지 않습니다). 허브 페이지(`public/index.html`)가 처음 접속할 때 이 로그인을 안내하고 포인트를 보여줍니다.

낚시 게임 브라우저 코드는 `public/fishing/js/`에서 싱글플레이, 멀티플레이, UI, 사운드로 나뉩니다. 게임 상태는 전역 변수 대신 `core.js`가 만드는 `window.Game` 아래(`Game.config`, `Game.state`, `Game.mp` 등)에 모여 있습니다. 물고기 종류·레벨·판정 크기 설정은 서버와 브라우저가 `public/fishing/game-config.json`을 함께 사용하고, 보스 이동·은신, 사나운 보스의 포식, 대왕게 쓰레기 궤적 계산식은 `public/fishing/js/shared/boss-math.js` 한 파일을 서버와 브라우저가 같이 씁니다. 친구 순위표에는 서버가 계산한 멀티플레이 라운드 점수만 기록됩니다. 서버를 여러 인스턴스로 늘리려면 방 상태와 순위 저장소를 공유 저장소로 옮겨야 합니다.
