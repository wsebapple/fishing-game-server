# Google Play 앱으로 배포하기

이 저장소는 Capacitor로 감싼 Android 앱 프로젝트(`android/`)를 포함합니다. 앱은 자체 화면을 그리지 않고, 배포된 서버(`capacitor.config.json`의 `server.url`, 현재 `https://fishing-game-server-pr77.onrender.com/fishing/`)를 그대로 불러옵니다. 그래서 `window.location.origin`이 실제 서버 주소와 같아져서 멀티플레이(Socket.IO)가 앱 안에서도 그대로 작동합니다.

서버 주소가 바뀌면 `capacitor.config.json`의 `server.url`을 수정한 뒤 `npx cap sync android`를 실행하세요.

## 이 세션에서 할 수 없었던 것

이 작업은 샌드박스 환경에서 진행되어 Android SDK가 설치되어 있지 않고, SDK 다운로드 주소(`dl.google.com`)가 네트워크 정책상 차단되어 있습니다. 그래서 실제 APK/AAB 빌드, 실기기·에뮬레이터 실행, 서명까지는 이 세션에서 검증하지 못했습니다. 아래 단계는 로컬(또는 Android SDK가 설치된 CI)에서 직접 실행해야 합니다.

## 준비물

- [Android Studio](https://developer.android.com/studio) (Android SDK, 빌드 도구 포함)
- JDK 17 이상 (Android Studio에 내장된 것 사용 가능)
- Google Play Console 개발자 계정 (이미 있다고 하셨습니다)

## 로컬에서 빌드/실행

```bash
npm install
npx cap sync android
npx cap open android   # Android Studio가 열립니다
```

Android Studio에서 에뮬레이터나 실기기로 Run 버튼을 눌러 우선 정상 동작(로그인 없이 게임 진입, 멀티플레이 방 입장)을 확인하세요.

## 릴리스 서명 키 만들기

Play Store에 올리려면 앱을 서명해야 합니다. **이 키를 잃어버리면 같은 앱을 다시는 업데이트할 수 없으니 반드시 안전한 곳(비밀번호 관리자, 암호화 백업 등)에 보관하세요.**

```bash
keytool -genkey -v -keystore fishing-game-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias fishing-game
```

`android/app/key.properties.example`를 복사해 `android/app/key.properties`로 만들고 실제 비밀번호/경로를 채우세요. 이 파일과 `.jks`는 `.gitignore`에 등록되어 있어 커밋되지 않습니다.

```bash
cp android/app/key.properties.example android/app/key.properties
# key.properties를 열어 storeFile 경로와 비밀번호를 채우세요
```

## 릴리스 번들(AAB) 만들기

Play Console은 APK 대신 AAB(Android App Bundle)를 요구합니다.

```bash
cd android
./gradlew bundleRelease
# 결과물: android/app/build/outputs/bundle/release/app-release.aab
```

## Play Console에 올리기

1. [Play Console](https://play.google.com/console)에서 새 앱 만들기 (이름: 낚시 게임, 기본 언어: 한국어, 앱 또는 게임: 게임, 무료/유료: 무료)
2. **필수 준비물**
   - 앱 아이콘 512×512 PNG (현재 `android/app/src/main/res/mipmap-*`에는 Capacitor 기본 플레이스홀더 아이콘이 들어있습니다. 실제 낚시 게임 아이콘으로 교체가 필요합니다 — `npx @capacitor/assets generate --android`로 소스 이미지 한 장부터 자동 생성할 수 있습니다.)
   - 기능 그래픽(feature graphic) 1024×500
   - 스크린샷 최소 2장 (휴대폰 기준)
   - 개인정보처리방침 URL (Google Play 정책상 필수입니다. 이 서버는 닉네임과 멀티플레이 라운드 점수만 `server/leaderboard.js`를 통해 저장하므로, 이를 반영한 간단한 개인정보처리방침 페이지를 만들어 공개 URL로 올려야 합니다.)
   - 콘텐츠 등급 설문, 타겟 연령층/데이터 보안 설문 작성
3. **Production(프로덕션) → 새 버전 만들기**에서 위에서 만든 `app-release.aab`를 업로드
4. 스토어 등록정보(설명, 카테고리 등) 작성 후 검토 제출

첫 배포는 검토에 며칠 걸릴 수 있습니다. 이후 업데이트는 `versionCode`/`versionName`을 `android/app/build.gradle`에서 올리고 같은 키로 다시 서명해 업로드하면 됩니다.

## 참고: 서버 가용성

앱은 항상 온라인 서버(`https://fishing-game-server-pr77.onrender.com`)에 접속합니다. Render 무료 플랜은 일정 시간 요청이 없으면 슬립 상태가 되어 첫 접속이 느릴 수 있습니다. 실제 운영 트래픽을 감안해 유료 플랜 또는 다른 상시 구동 호스팅으로 옮기는 것을 고려하세요.
