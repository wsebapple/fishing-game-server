# 낚시 게임

Node.js 18 이상에서 `pnpm install` 후 `pnpm start`를 실행하고 `http://localhost:3000`에 접속합니다(`PORT` 환경변수로 포트를 바꿀 수 있어요). 첫 화면(`public/index.html`)은 여러 게임을 고르는 메인 페이지이고, 낚시 게임은 `http://localhost:3000/fishing/`, 바다 소풍 게임은 `http://localhost:3000/sea-picnic/`, 호야의 네모 모험(점핑 게임)은 `http://localhost:3000/nemo-adventure/`, 우주선 뿅뿅대작전(슈팅 게임)은 `http://localhost:3000/spaceship/`, 과일 합체 게임은 `http://localhost:3000/fruit-game/`, 총잡이 대작전(탑다운 총싸움 게임)은 `http://localhost:3000/gunner/`, 탐사로봇 땅따먹기(볼피드류 영역 차지하기)는 `http://localhost:3000/land-grab/`에 있습니다. 새 게임은 `public/<폴더>/`에 넣고 메인 페이지의 `GAMES` 목록에 한 줄 추가하면 됩니다. 테스트는 `pnpm test`로 실행합니다.

`server.js`는 HTTP/Socket.IO 시작점입니다. `server/rooms.js`가 방과 라운드를 관리하고, `server/fish.js`가 물고기 위치와 포획 판정을 계산하며, `server/socket.js`가 클라이언트 이벤트를 검증합니다. 순위 기록은 `server/leaderboard.js`가 `data/leaderboard.json`에 보관합니다. 이 파일은 Git에서 제외됩니다.

로그인 없이 이름+PIN(4자리)만으로 개인별 포인트를 관리하는 기능은 `server/points.js`가 담당하고, `data/points.json`에 보관합니다(마찬가지로 Git에서 제외). `POST /api/points/login`으로 등록/로그인하면 토큰을 받고, `GET /api/points/me`로 그 토큰의 포인트를 조회합니다. 처음 보는 이름으로 등록하면 `server/points.js`의 `STARTING_POINTS`(기본 30점)만큼 바로 받아서, 학습게임을 안 해도 즐거운 게임을 한두 판 해볼 수 있습니다 — 학습으로 포인트를 더 쌓아야 계속 놀 수 있다는 동기부여는 여기서 시작됩니다. 이름과 PIN을 함께 서명하는 데 쓰는 `POINTS_SECRET` 환경변수를 배포 환경에서 반드시 지정해주세요(지정하지 않으면 개발용 기본값을 쓰므로 안전하지 않습니다). 허브 페이지(`public/index.html`)가 처음 접속할 때 이 로그인을 안내하고 포인트를 보여줍니다.

허브 페이지는 "즐거운 게임"·"포인트 쌓기" 두 탭으로 나뉩니다. `GAMES` 배열 각 항목의 `category`가 `'fun'`인 게임(낚시·바다소풍·네모모험·우주선·과일합체·총잡이 대작전·탐사로봇 땅따먹기)은 즐거운 게임 탭에 뜨고, 카드를 누르면 `GET /api/points/costs`로 공개된 입장료만큼 `POST /api/points/spend`가 포인트를 깎은 뒤에만 실제 게임으로 이동합니다. 입장료는 `server/costs.js`가 `data/game-costs.json`에 보관하고, 값이 없으면 코드에 있는 기본값을 씁니다. `category`가 `'learning'`인 게임(한자 맞추기)은 포인트 쌓기 탭에 뜨고 입장료 없이 바로 들어갈 수 있습니다 — 다만 아직 그 안에서 정답을 맞혀도 포인트가 자동으로 적립되지는 않습니다(서버가 채점해 적립하는 기능은 추후 추가 예정). 이름별 포인트 지급/차감과 게임별 입장료 조정은 `http://localhost:3000/admin/`(`public/admin/index.html`)에서 합니다 — 이 화면과 `POST /api/admin/grant`·`GET/POST /api/admin/costs`·`GET /api/admin/players`는 모두 `ADMIN_KEY` 환경변수와 일치하는 `X-Admin-Key` 헤더가 있어야 동작하며, `ADMIN_KEY`를 설정하지 않으면 관리자 기능 전체가 막힙니다.

낚시 게임 브라우저 코드는 `public/fishing/js/`에서 싱글플레이, 멀티플레이, UI, 사운드로 나뉩니다. 게임 상태는 전역 변수 대신 `core.js`가 만드는 `window.Game` 아래(`Game.config`, `Game.state`, `Game.mp` 등)에 모여 있습니다. 물고기 종류·레벨·판정 크기 설정은 서버와 브라우저가 `public/fishing/game-config.json`을 함께 사용하고, 보스 이동·은신, 사나운 보스의 포식, 대왕게 쓰레기 궤적 계산식은 `public/fishing/js/shared/boss-math.js` 한 파일을 서버와 브라우저가 같이 씁니다. 친구 순위표에는 서버가 계산한 멀티플레이 라운드 점수만 기록됩니다. 서버를 여러 인스턴스로 늘리려면 방 상태와 순위 저장소를 공유 저장소로 옮겨야 합니다.

## 배포 시 데이터가 사라지지 않게 하기

순위표·포인트·입장료는 모두 `data/` 폴더 안 파일에 저장됩니다. **로컬 디스크가 영구적이지 않은 배포 환경(예: Render의 무료 플랜이나 PR 프리뷰 서비스)에서는 서버가 재배포되거나 한동안 안 쓰여 잠들었다가 깨어날 때 이 파일들이 통째로 사라집니다.** 이건 이 앱의 버그가 아니라 그런 호스팅 방식의 특징입니다 — 실제로 계속 쓰실 서비스에는 반드시 영구 디스크를 연결하세요.

영구 디스크가 있는 배포 환경에서는 그 디스크가 마운트된 경로를 `DATA_DIR` 환경변수로 지정해주세요(예: Render Disk를 `/var/data`에 마운트했다면 `DATA_DIR=/var/data`). 지정하면 순위표·포인트·입장료 파일이 전부 그 아래(`leaderboard.json`, `points.json`, `game-costs.json`)에 저장되어, 서버가 재시작돼도 데이터가 남아있습니다. `DATA_DIR`을 지정하지 않으면 예전처럼 이 저장소 안의 `data/` 폴더를 씁니다(로컬 개발용 기본값이라 배포에는 적합하지 않습니다).

PR 프리뷰 서비스(주소에 `-pr숫자`가 붙는 것)는 원래 그 PR을 잠깐 테스트해보는 용도라, 디스크를 연결해도 그 PR이 닫히면 서비스 자체가 없어집니다. 아이들이 실제로 계속 쓸 주소는 `main` 브랜치를 배포하는 별도의(항상 떠 있는) 서비스로 만들고, 그 서비스에만 영구 디스크와 `DATA_DIR`을 설정하세요.
