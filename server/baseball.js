// 완전한 9이닝 대전 야구의 순수 게임 로직이에요. 소켓이나 타이머는 전혀 모르고,
// 상태(state) + 입력을 받아 다음 상태를 계산만 해요. 그래서 아래 함수들은 전부
// server/baseball-rooms.js(방·타이머 관리)와 test/baseball.test.js(단위 테스트)가 같이 써요.
// 무작위 요소(rng)는 항상 매개변수로 받아서, 테스트에서 고정된 값을 넣어 결과를 예측할 수 있게 해요.

const GRID_MIN = 0, GRID_MAX = 4; // 존은 5x5 격자(0~4). 가운데 3x3(1~3)이 스트라이크존이에요.
const ZONE_LOW = 1, ZONE_HIGH = 3;
const DOUBLE_PLAY_CHANCE = 0.42;
const MAX_INNINGS = 15; // 연장이 너무 길어지는 걸 막는 안전장치예요 (실제 경기는 거의 안 걸려요)
const PITCH_TYPES = ['fastball', 'curve', 'changeup'];

function clamp(value, lo, hi) { return Math.min(hi, Math.max(lo, value)); }

function clampZone(zone) {
  const x = Number(zone && zone.x);
  const y = Number(zone && zone.y);
  return {
    x: clamp(Number.isFinite(x) ? Math.round(x) : 2, GRID_MIN, GRID_MAX),
    y: clamp(Number.isFinite(y) ? Math.round(y) : 2, GRID_MIN, GRID_MAX),
  };
}

function inStrikeZone(zone) {
  return zone.x >= ZONE_LOW && zone.x <= ZONE_HIGH && zone.y >= ZONE_LOW && zone.y <= ZONE_HIGH;
}

function chebyshev(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }

function clampRating(value) { return clamp(Math.round(Number(value) || 3), 1, 5); }

function normalizeRatings(ratings) {
  return {
    contact: clampRating(ratings && ratings.contact),
    power: clampRating(ratings && ratings.power),
    control: clampRating(ratings && ratings.control),
    stuff: clampRating(ratings && ratings.stuff),
  };
}

function normalizeTeam(team) {
  const name = typeof (team && team.name) === 'string' && team.name.trim() ? team.name.trim().slice(0, 16) : '우리팀';
  const color = typeof (team && team.color) === 'string' && /^#[0-9a-fA-F]{6}$/.test(team.color) ? team.color : '#3b82f6';
  const emoji = typeof (team && team.emoji) === 'string' ? Array.from(team.emoji).slice(0, 2).join('') : '⚾';
  return { name, color, emoji, ratings: normalizeRatings(team && team.ratings) };
}

// 투수가 노린 곳(targetZone)과 실제로 꽂힌 곳(actualZone)은 다를 수 있어요 - 제구(control)가
// 낮을수록 흔들릴 확률과 흔들리는 정도가 커져요. 타자는 이 실제 위치를 모른 채 존을 추측해요.
function computeActualPitchZone(targetZone, control, rng) {
  const target = clampZone(targetZone);
  const wildChance = Math.max(0.08, 0.34 - control * 0.05);
  if (rng() < wildChance) {
    const dx = Math.round((rng() - 0.5) * 2.4);
    const dy = Math.round((rng() - 0.5) * 2.4);
    return clampZone({ x: target.x + dx, y: target.y + dy });
  }
  return target;
}

// 한 번의 투구+스윙(또는 지켜보기)을 판정해요. 상태(카운트·주자 등)는 건드리지 않고
// 결과만 돌려줘요 - 실제 상태 반영은 applyAtBatResult가 해요.
function resolvePitch({ pitchType, targetZone, swing, pitcherRatings, batterRatings }, rng) {
  const pitcher = normalizeRatings(pitcherRatings);
  const batter = normalizeRatings(batterRatings);
  const type = PITCH_TYPES.includes(pitchType) ? pitchType : 'fastball';
  const actualZone = computeActualPitchZone(targetZone, pitcher.control, rng);
  const zoneStrike = inStrikeZone(actualZone);

  if (!swing) {
    return { event: zoneStrike ? 'called_strike' : 'ball', actualZone, pitchType: type };
  }

  const swingZone = clampZone(swing.zone);
  const guessType = PITCH_TYPES.includes(swing.pitchType) ? swing.pitchType : null;
  const mode = swing.mode === 'power' ? 'power' : 'contact';

  const locDist = chebyshev(actualZone, swingZone);
  const typeMiss = guessType && guessType !== type ? 1 : 0;
  let effDist = locDist + typeMiss * 1.4 + (pitcher.stuff - 3) * 0.35 - (batter.contact - 3) * 0.45;
  if (mode === 'power') effDist += 0.55;
  effDist += (rng() - 0.5) * 1.1;

  let quality;
  if (effDist <= 0.45) quality = 'barreled';
  else if (effDist <= 1.25) quality = 'solid';
  else if (effDist <= 2.25) quality = 'weak';
  else if (effDist <= 3.25) quality = 'foul';
  else quality = 'whiff';

  if (quality === 'whiff') return { event: 'swinging_strike', actualZone, pitchType: type, quality };
  if (quality === 'foul') return { event: 'foul', actualZone, pitchType: type, quality };

  const powerScore = batter.power + (mode === 'power' ? 1.6 : 0)
    + (quality === 'barreled' ? 3 : 1.4) + rng() * 2.2 - (pitcher.stuff - 3) * 0.3;
  const trajRoll = rng();
  let hitType;
  if (quality === 'weak') {
    hitType = trajRoll < 0.16 ? 'single' : (trajRoll < 0.58 ? 'groundout' : 'flyout');
  } else if (powerScore >= 9) hitType = 'homerun';
  else if (powerScore >= 7) hitType = trajRoll < 0.65 ? 'double' : 'triple';
  else if (powerScore >= 5) hitType = trajRoll < 0.6 ? 'single' : 'double';
  else if (powerScore >= 3) hitType = trajRoll < 0.55 ? 'single' : (trajRoll < 0.82 ? 'flyout' : 'groundout');
  else hitType = trajRoll < 0.5 ? 'groundout' : 'flyout';

  return { event: 'in_play', actualZone, pitchType: type, quality, hitType };
}

const HIT_TYPES = new Set(['single', 'double', 'triple', 'homerun']);

function advanceRunnersForHit(bases, hitType) {
  if (hitType === 'single') {
    let runs = (bases.third ? 1 : 0) + (bases.second ? 1 : 0);
    return { bases: { first: true, second: bases.first, third: false }, runs };
  }
  if (hitType === 'double') {
    let runs = (bases.third ? 1 : 0) + (bases.second ? 1 : 0);
    return { bases: { first: false, second: true, third: bases.first }, runs };
  }
  if (hitType === 'triple') {
    const runs = (bases.first ? 1 : 0) + (bases.second ? 1 : 0) + (bases.third ? 1 : 0);
    return { bases: { first: false, second: false, third: true }, runs };
  }
  // homerun
  const runs = 1 + (bases.first ? 1 : 0) + (bases.second ? 1 : 0) + (bases.third ? 1 : 0);
  return { bases: { first: false, second: false, third: false }, runs };
}

// 4구째 볼(사구): 뒤가 막혀 밀려날 수밖에 없는 주자만 다음 베이스로 강제 진루해요.
function advanceRunnersForWalk(bases) {
  const { first, second, third } = bases;
  let runs = 0;
  let newFirst = true, newSecond = second, newThird = third;
  if (first) {
    if (second) {
      if (third) runs = 1;
      newThird = true;
    } else {
      newSecond = true;
    }
  }
  return { bases: { first: newFirst, second: newSecond, third: newThird }, runs };
}

// 땅볼/뜬공 아웃: 상황에 따라 병살(더블플레이)이나 희생플라이가 될 수 있어요.
// outsAdded는 이번 타구로 늘어나는 아웃 수(보통 1, 병살이면 2)예요.
function resolveOutInPlay(bases, outs, hitType, rng) {
  if (hitType === 'groundout' && bases.first && outs < 2 && rng() < DOUBLE_PLAY_CHANCE) {
    return {
      bases: { first: false, second: bases.second, third: bases.third },
      runs: 0, outsAdded: 2, resultType: 'double_play',
    };
  }
  if (hitType === 'flyout' && bases.third && outs < 2) {
    return {
      bases: { first: bases.first, second: bases.second, third: false },
      runs: 1, outsAdded: 1, resultType: 'sac_fly',
    };
  }
  return { bases: { ...bases }, runs: 0, outsAdded: 1, resultType: hitType };
}

function cloneState(state) {
  return {
    ...state,
    bases: { ...state.bases },
    score: { ...state.score },
    log: state.log.slice(-49), // 로그가 끝없이 커지지 않게 최근 49개만 유지하고, 이번 이벤트를 더해 50개로
  };
}

function createInitialState(awayTeam, homeTeam) {
  return {
    inning: 1,
    half: 'top', // 'top' = 원정팀(away) 공격, 'bottom' = 홈팀(home) 공격
    outs: 0,
    balls: 0,
    strikes: 0,
    bases: { first: false, second: false, third: false },
    score: { away: 0, home: 0 },
    teams: { away: normalizeTeam(awayTeam), home: normalizeTeam(homeTeam) },
    status: 'in_progress', // 'in_progress' | 'finished'
    winner: null, // 'away' | 'home' | null(무승부)
    log: [],
  };
}

function battingSide(state) { return state.half === 'top' ? 'away' : 'home'; }
function pitchingSide(state) { return state.half === 'top' ? 'home' : 'away'; }

function resetCount(state) { state.balls = 0; state.strikes = 0; }

// 끝내기: 9회 이후 홈팀 공격 중에 홈팀이 앞서가는 순간 바로 경기가 끝나요(3아웃을 채울 필요 없음).
function checkWalkoff(state, events) {
  if (state.status === 'finished') return;
  if (state.half === 'bottom' && state.inning >= 9 && state.score.home > state.score.away) {
    state.status = 'finished';
    state.winner = 'home';
    state.outs = 0;
    events.push({ type: 'game_over', winner: 'home', walkoff: true });
  }
}

function endHalfInning(state, events) {
  state.outs = 0;
  resetCount(state);
  state.bases = { first: false, second: false, third: false };

  if (state.half === 'top') {
    // 9회 이상 초 공격이 끝났는데 이미 홈팀이 이기고 있으면, 홈팀은 말 공격을 할 필요가 없어요.
    if (state.inning >= 9 && state.score.home > state.score.away) {
      state.status = 'finished';
      state.winner = 'home';
      events.push({ type: 'game_over', winner: 'home' });
      return;
    }
    state.half = 'bottom';
    events.push({ type: 'half_inning', half: 'bottom', inning: state.inning });
    return;
  }

  // 말 공격이 끝났어요
  if (state.inning >= 9 && state.score.home !== state.score.away) {
    state.status = 'finished';
    state.winner = state.score.home > state.score.away ? 'home' : 'away';
    events.push({ type: 'game_over', winner: state.winner });
    return;
  }
  if (state.inning >= MAX_INNINGS) {
    state.status = 'finished';
    state.winner = state.score.home === state.score.away ? null : (state.score.home > state.score.away ? 'home' : 'away');
    events.push({ type: 'game_over', winner: state.winner, tie: state.winner === null });
    return;
  }
  state.inning++;
  state.half = 'top';
  events.push({ type: 'half_inning', half: 'top', inning: state.inning });
}

// outcome은 resolvePitch()가 돌려준 결과예요. 여기서 실제로 카운트·주자·점수·이닝을 반영해요.
function applyAtBatResult(state, outcome, rng) {
  if (state.status === 'finished') return { state, events: [] };
  const next = cloneState(state);
  const side = battingSide(next);
  const events = [];

  switch (outcome.event) {
    case 'ball': {
      next.balls++;
      if (next.balls >= 4) {
        const { bases, runs } = advanceRunnersForWalk(next.bases);
        next.bases = bases;
        next.score[side] += runs;
        resetCount(next);
        events.push({ type: 'walk', runs });
      } else {
        events.push({ type: 'ball' });
      }
      break;
    }
    case 'called_strike':
    case 'swinging_strike': {
      next.strikes++;
      if (next.strikes >= 3) {
        next.outs++;
        resetCount(next);
        events.push({ type: 'strikeout' });
      } else {
        events.push({ type: outcome.event });
      }
      break;
    }
    case 'foul': {
      if (next.strikes < 2) next.strikes++;
      events.push({ type: 'foul' });
      break;
    }
    case 'in_play': {
      if (HIT_TYPES.has(outcome.hitType)) {
        const { bases, runs } = advanceRunnersForHit(next.bases, outcome.hitType);
        next.bases = bases;
        next.score[side] += runs;
        resetCount(next);
        events.push({ type: outcome.hitType, runs });
      } else {
        const result = resolveOutInPlay(next.bases, next.outs, outcome.hitType, rng);
        next.bases = result.bases;
        next.score[side] += result.runs;
        next.outs += result.outsAdded;
        resetCount(next);
        events.push({ type: result.resultType, runs: result.runs, outsAdded: result.outsAdded });
      }
      break;
    }
    default:
      events.push({ type: 'noop' });
  }

  checkWalkoff(next, events);
  if (next.status !== 'finished' && next.outs >= 3) {
    endHalfInning(next, events);
  }
  next.log = [...state.log, ...events].slice(-50);
  return { state: next, events };
}

module.exports = {
  GRID_MIN, GRID_MAX, ZONE_LOW, ZONE_HIGH, PITCH_TYPES, MAX_INNINGS,
  clampZone, inStrikeZone, normalizeRatings, normalizeTeam,
  computeActualPitchZone, resolvePitch, applyAtBatResult,
  advanceRunnersForHit, advanceRunnersForWalk, resolveOutInPlay,
  createInitialState, battingSide, pitchingSide,
};
