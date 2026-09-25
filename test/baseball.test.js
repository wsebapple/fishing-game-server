const test = require('node:test');
const assert = require('node:assert/strict');
const {
  clampZone, inStrikeZone, normalizeRatings, normalizeTeam,
  computeActualPitchZone, resolvePitch, applyAtBatResult,
  advanceRunnersForHit, advanceRunnersForWalk, resolveOutInPlay,
  createInitialState,
} = require('../server/baseball');

function constRng(value) { return () => value; }
function seqRng(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

test('clampZone rounds and clamps into the 0..4 grid', () => {
  assert.deepEqual(clampZone({ x: 1.4, y: -3 }), { x: 1, y: 0 });
  assert.deepEqual(clampZone({ x: 99, y: 2.6 }), { x: 4, y: 3 });
  assert.deepEqual(clampZone({}), { x: 2, y: 2 });
});

test('inStrikeZone only counts the middle 3x3', () => {
  assert.equal(inStrikeZone({ x: 2, y: 2 }), true);
  assert.equal(inStrikeZone({ x: 1, y: 3 }), true);
  assert.equal(inStrikeZone({ x: 0, y: 2 }), false);
  assert.equal(inStrikeZone({ x: 2, y: 4 }), false);
});

test('normalizeRatings/normalizeTeam clamp out-of-range and bad input', () => {
  assert.deepEqual(normalizeRatings({ contact: 99, power: -5, control: NaN }), { contact: 5, power: 1, control: 3, stuff: 3 });
  const team = normalizeTeam({ name: '  탱탱볼 타이거즈  ', color: 'not-a-color', emoji: '🐯🐯🐯', ratings: { power: 5 } });
  assert.equal(team.name, '탱탱볼 타이거즈');
  assert.equal(team.color, '#3b82f6');
  assert.equal(Array.from(team.emoji).length <= 2, true);
  assert.equal(team.ratings.power, 5);
});

test('computeActualPitchZone stays on target when control is high and the wild roll misses', () => {
  const actual = computeActualPitchZone({ x: 2, y: 2 }, 5, constRng(0.99));
  assert.deepEqual(actual, { x: 2, y: 2 });
});

test('computeActualPitchZone drifts off target on a wild pitch roll', () => {
  // 첫 rng 값(0.1)이 wildChance(0.29)보다 작아 와일드가 발동하고, 이후 두 값으로 dx/dy가 정해져요
  const actual = computeActualPitchZone({ x: 2, y: 2 }, 1, seqRng([0.1, 0.9, 0.1]));
  assert.deepEqual(actual, { x: 3, y: 1 });
});

test('resolvePitch: a take in the zone is a called strike, out of the zone is a ball', () => {
  const base = { pitcherRatings: { control: 5 }, batterRatings: {}, swing: null };
  const strike = resolvePitch({ ...base, pitchType: 'fastball', targetZone: { x: 2, y: 2 } }, constRng(0.99));
  assert.equal(strike.event, 'called_strike');
  const ball = resolvePitch({ ...base, pitchType: 'fastball', targetZone: { x: 0, y: 0 } }, constRng(0.99));
  assert.equal(ball.event, 'ball');
});

test('resolvePitch: a badly mismatched, badly guessed swing whiffs', () => {
  const outcome = resolvePitch({
    pitchType: 'curve',
    targetZone: { x: 4, y: 4 },
    swing: { zone: { x: 0, y: 0 }, pitchType: 'fastball', mode: 'contact' },
    pitcherRatings: { control: 5, stuff: 5 },
    batterRatings: { contact: 1 },
  }, constRng(0.99));
  assert.equal(outcome.event, 'swinging_strike');
});

test('resolvePitch: a perfectly read power swing against a weak pitcher can go deep', () => {
  const outcome = resolvePitch({
    pitchType: 'fastball',
    targetZone: { x: 2, y: 2 },
    swing: { zone: { x: 2, y: 2 }, pitchType: 'fastball', mode: 'power' },
    pitcherRatings: { control: 5, stuff: 1 },
    batterRatings: { contact: 5, power: 5 },
  }, constRng(0.99));
  assert.equal(outcome.event, 'in_play');
  assert.equal(outcome.hitType, 'homerun');
});

test('advanceRunnersForHit: single scores runners from second and third, batter to first', () => {
  const result = advanceRunnersForHit({ first: true, second: true, third: true }, 'single');
  assert.deepEqual(result.bases, { first: true, second: true, third: false });
  assert.equal(result.runs, 2);
});

test('advanceRunnersForHit: homerun clears the bases and scores everyone', () => {
  const result = advanceRunnersForHit({ first: true, second: false, third: true }, 'homerun');
  assert.deepEqual(result.bases, { first: false, second: false, third: false });
  assert.equal(result.runs, 3);
});

test('advanceRunnersForWalk: forces only the contiguous chain from first base', () => {
  const noForce = advanceRunnersForWalk({ first: false, second: true, third: true });
  assert.deepEqual(noForce.bases, { first: true, second: true, third: true });
  assert.equal(noForce.runs, 0);

  const partialForce = advanceRunnersForWalk({ first: true, second: false, third: true });
  assert.deepEqual(partialForce.bases, { first: true, second: true, third: true });
  assert.equal(partialForce.runs, 0);

  const loadedForce = advanceRunnersForWalk({ first: true, second: true, third: true });
  assert.deepEqual(loadedForce.bases, { first: true, second: true, third: true });
  assert.equal(loadedForce.runs, 1);
});

test('resolveOutInPlay: a ground ball can turn into a double play with a runner on first', () => {
  const result = resolveOutInPlay({ first: true, second: false, third: false }, 0, 'groundout', constRng(0.1));
  assert.equal(result.resultType, 'double_play');
  assert.equal(result.outsAdded, 2);
  assert.deepEqual(result.bases, { first: false, second: false, third: false });
});

test('resolveOutInPlay: a fly ball with a runner on third and under 2 outs is a sac fly', () => {
  const result = resolveOutInPlay({ first: false, second: false, third: true }, 1, 'flyout', constRng(0.99));
  assert.equal(result.resultType, 'sac_fly');
  assert.equal(result.runs, 1);
  assert.equal(result.outsAdded, 1);
  assert.equal(result.bases.third, false);
});

test('applyAtBatResult: four balls with the bases loaded forces in a run', () => {
  let state = createInitialState({}, {});
  state.bases = { first: true, second: true, third: true };
  const rng = constRng(0.5);
  for (let i = 0; i < 3; i++) {
    ({ state } = applyAtBatResult(state, { event: 'ball' }, rng));
  }
  assert.equal(state.balls, 3);
  ({ state } = applyAtBatResult(state, { event: 'ball' }, rng));
  assert.equal(state.balls, 0);
  assert.equal(state.score.away, 1);
  assert.deepEqual(state.bases, { first: true, second: true, third: true });
});

test('applyAtBatResult: three strikes is a strikeout and resets the count', () => {
  let state = createInitialState({}, {});
  const rng = constRng(0.5);
  ({ state } = applyAtBatResult(state, { event: 'called_strike' }, rng));
  ({ state } = applyAtBatResult(state, { event: 'swinging_strike' }, rng));
  assert.equal(state.strikes, 2);
  assert.equal(state.outs, 0);
  ({ state } = applyAtBatResult(state, { event: 'swinging_strike' }, rng));
  assert.equal(state.outs, 1);
  assert.equal(state.strikes, 0);
  assert.equal(state.balls, 0);
});

test('applyAtBatResult: a foul with two strikes never strikes the batter out', () => {
  let state = createInitialState({}, {});
  state.strikes = 2;
  const { state: next } = applyAtBatResult(state, { event: 'foul' }, constRng(0.5));
  assert.equal(next.strikes, 2);
  assert.equal(next.outs, 0);
});

test('applyAtBatResult: an in-play double play ends the half inning', () => {
  let state = createInitialState({}, {});
  state.outs = 1;
  state.bases = { first: true, second: false, third: false };
  const { state: next, events } = applyAtBatResult(state, { event: 'in_play', hitType: 'groundout' }, constRng(0.1));
  assert.equal(events.some(e => e.type === 'double_play'), true);
  assert.equal(next.outs, 0); // 이닝이 바뀌면서 아웃 카운트가 리셋돼요
  assert.equal(next.half, 'bottom');
});

test('applyAtBatResult: top of the 9th ends immediately if the home team already leads', () => {
  let state = createInitialState({}, {});
  state.inning = 9;
  state.half = 'top';
  state.outs = 2;
  state.strikes = 2;
  state.score = { away: 2, home: 5 };
  const { state: next } = applyAtBatResult(state, { event: 'called_strike' }, constRng(0.5));
  assert.equal(next.status, 'finished');
  assert.equal(next.winner, 'home');
});

test('applyAtBatResult: a go-ahead hit in the bottom of the 9th ends the game as a walk-off', () => {
  let state = createInitialState({}, {});
  state.inning = 9;
  state.half = 'bottom';
  state.outs = 1;
  state.score = { away: 3, home: 3 };
  state.bases = { first: false, second: true, third: true };
  const { state: next } = applyAtBatResult(state, { event: 'in_play', hitType: 'single' }, constRng(0.5));
  assert.equal(next.status, 'finished');
  assert.equal(next.winner, 'home');
  assert.equal(next.score.home, 5);
  assert.equal(next.outs, 0); // 워크오프는 아웃을 다 채우지 않고도 끝나고, 표시용 아웃 카운트는 정리돼요
});

test('applyAtBatResult: a tie after the bottom of the 9th continues into extra innings', () => {
  let state = createInitialState({}, {});
  state.inning = 9;
  state.half = 'bottom';
  state.outs = 2;
  state.strikes = 2;
  state.score = { away: 2, home: 2 };
  const { state: next } = applyAtBatResult(state, { event: 'called_strike' }, constRng(0.5));
  assert.equal(next.status, 'in_progress');
  assert.equal(next.inning, 10);
  assert.equal(next.half, 'top');
});

test('applyAtBatResult: a finished game ignores further outcomes', () => {
  let state = createInitialState({}, {});
  state.status = 'finished';
  state.winner = 'away';
  const { state: next, events } = applyAtBatResult(state, { event: 'ball' }, constRng(0.5));
  assert.equal(next, state);
  assert.deepEqual(events, []);
});
