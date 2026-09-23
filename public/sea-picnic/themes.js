// 바다 소풍의 테마 3종과 난이도 3단계 설정. 새 테마를 추가하려면 이 배열에 한 항목만 더하면 돼요.
window.THEMES = [
  {
    key: 'seaChild',
    art: '🐟', artBg: 'linear-gradient(180deg, #bdeeff 0%, #1fb4d9 55%, #0b72b9 100%)',
    title: '바다아이의 물고기 소풍',
    shortTitle: '바다아이',
    desc: '바다아이와 함께 파도를 헤엄쳐요!',
    moveHint: '헤엄치기',
    scoreIcon: '🐟', lifeIcon: '❤️', startLabel: '출발!',
    scoreKey: 'seaSpriteTop10V1', nameKey: 'seaSpritePlayerNameV1', defaultName: '바다 친구',
    bg: 'assets/underwater-background-v2.png',
    weed: 'assets/seaweed-sprites-v2.png',
    fish: { src: 'assets/fish-animation-15frame-v3.png', cols: 3, rows: 5, pad: 0, strip: false, drawW: 96, drawH: 78 },
    puffer: { src: 'assets/puffer-animation-6frame-v2.png', cols: 3, rows: 2, pad: 0, strip: false, drawW: 104, drawH: 104 },
    char: { src: 'assets/swimmer-6frame-grid-v4.png', cols: 3, rows: 2, frames: 6, pad: 0, strip: false, w: 158, h: 108 },
  },
  {
    key: 'babyShark',
    art: '🦈', artBg: 'linear-gradient(180deg, #cdefff 0%, #4fb7e6 55%, #1c6fae 100%)',
    title: '아기 상어의 바다 친구 소풍',
    shortTitle: '아기 상어',
    desc: '노란 아기 상어와 함께 바다를 헤엄쳐요!',
    moveHint: '헤엄치기',
    scoreIcon: '🐟', lifeIcon: '❤️', startLabel: '출발!',
    scoreKey: 'babySharkTop10V1', nameKey: 'babySharkPlayerNameV1', defaultName: '바다 친구',
    bg: 'assets/underwater-background-v2.png',
    weed: 'assets/seaweed-sprites-v2.png',
    fish: { src: 'assets/fish-animation-15frame-v3.png', cols: 3, rows: 5, pad: 0, strip: false, drawW: 96, drawH: 78 },
    puffer: { src: 'assets/puffer-animation-6frame-v2.png', cols: 3, rows: 2, pad: 0, strip: false, drawW: 104, drawH: 104 },
    char: { src: 'assets/baby-shark-8frame-v2.png', cols: 4, rows: 2, frames: 8, pad: 0, strip: false, w: 180, h: 240 },
  },
  {
    key: 'auroraFairy',
    art: '🧚', artBg: 'linear-gradient(180deg, #f3e3ff 0%, #b98bff 55%, #7a4fc9 100%)',
    title: '오로라 요정의 마법 바다 소풍',
    shortTitle: '오로라 요정',
    desc: '하트 보석을 품은 오로라 요정과 마법 왕국을 날아요!',
    moveHint: '날갯짓',
    scoreIcon: '💎', lifeIcon: '💖', startLabel: '마법 소풍!',
    scoreKey: 'auroraFairyTop10V1', nameKey: 'auroraFairyPlayerNameV1', defaultName: '마법 친구',
    bg: 'assets/magic-kingdom-bg.png',
    weed: 'assets/seaweed-sprites-v2.png',
    fish: { src: 'assets/magic-fish-v2-packed.png', cols: 3, rows: 5, pad: 6, strip: true, drawW: 128, drawH: 52 },
    puffer: { src: 'assets/magic-puffer-6frame-packed.png', cols: 3, rows: 2, pad: 6, strip: true, drawW: 92, drawH: 92 },
    char: { src: 'assets/aurora-fairy-8frame-packed.png', cols: 4, rows: 2, frames: 8, pad: 10, strip: true, w: 138, h: 184 },
  },
];

// speedMul: 물고기·복어의 이동 속도 배율 / densityMul: 화면에 나오는 양(간격의 역수) 배율
// 상(high)은 원래 게임 그대로의 난이도예요.
window.DIFFICULTIES = [
  { key: 'high', label: '상', desc: '원래 난이도예요, 빠르고 촘촘해요', speedMul: 1, densityMul: 1 },
  { key: 'mid', label: '중', desc: '적당한 기본 난이도예요', speedMul: 0.8, densityMul: 0.72, default: true },
  { key: 'low', label: '하', desc: '느긋하게 즐기는 난이도예요', speedMul: 0.62, densityMul: 0.48 },
];
