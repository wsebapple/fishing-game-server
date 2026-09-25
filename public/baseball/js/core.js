/* ------------------------------------------------------
   완전한 9이닝 대전 야구 - 게임 전체가 같이 쓰는 상태는
   fishing 게임과 같은 방식으로 window.Game 아래에 모아둬요.
------------------------------------------------------ */
const Game = window.Game = {};

Game.config = {
  GRID: 5, ZONE_LOW: 1, ZONE_HIGH: 3, // server/baseball.js와 반드시 같아야 해요
  PITCH_TYPES: [
    { id: 'fastball', label: '직구', emoji: '⚡' },
    { id: 'curve', label: '커브', emoji: '🌀' },
    { id: 'changeup', label: '체인지업', emoji: '🎭' },
  ],
  EMOJIS: ['🦅', '🐯', '🐻', '🦁', '🐬', '🐲', '🦈', '🐢', '🐝', '🔥'],
  RESULT_LABELS: {
    ball: '볼', called_strike: '스트라이크(루킹)', swinging_strike: '스트라이크(스윙)', foul: '파울',
    walk: '볼넷!', strikeout: '삼진 아웃!', single: '1루타!', double: '2루타!', triple: '3루타!',
    homerun: '홈런!! 🎉', groundout: '땅볼 아웃', flyout: '뜬공 아웃', double_play: '병살타! ⚡', sac_fly: '희생플라이',
  },
};

Game.state = {
  screen: 'join',
  myId: null,
  mySide: null, // 'away' | 'home'
  roomCode: '',
  players: {},
  game: null, // 서버가 보내주는 최신 경기 상태
  atBat: null, // { atBatId, pitcherId, batterId, deadline }
  submitted: false,
  selectedZone: null,
  selectedPitchType: 'fastball',
  selectedMode: 'contact',
  selectedEmoji: '🦅',
  log: [],
  endInfo: null,
};

Game.mp = { socket: null, connecting: false, timerRaf: null };
