const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60일: 가족 서비스라 자주 다시 로그인하지 않아도 되게 넉넉히 잡아요
const STARTING_POINTS = 30; // 처음 등록할 때부터 즐거운 게임을 한 판이라도 해볼 수 있게 주는 시작 포인트

// 학습게임이 "정답 개수"를 보내오면 이 기준으로 포인트를 환산해요. 게임이 스스로 매기는 점수(배율·콤보 포함)는
// 믿지 않고 정답 개수만 받아서, 한 판에 인정하는 정답 개수와 하루 적립 한도를 서버가 강제로 제한해요.
// 완벽한 부정 방지는 아니지만(진짜 정답을 맞혔는지까지는 확인 안 해요), 남용 규모를 작게 묶어둬요.
const EARN_CONFIG = {
  'hanja-game': { pointsPerCorrect: 1, maxCorrectPerRound: 30, maxPointsPerDay: 50 },
  'math-game': { pointsPerCorrect: 1 / 5, maxCorrectPerRound: 30, maxPointsPerDay: 50 }, // 정답 5개당 1점
};

// 이름은 방 코드와 달리 대문자로 바꾸지 않아요(사람 이름의 대소문자를 그대로 존중) — 그래서 rooms.js의
// normalizeRoomCode와는 다른 함수예요. 제어문자만 걷어내고, 이모지 같은 문자가 코드포인트 중간에서
// 잘리지 않게 Array.from으로 잘라요.
function normalizeName(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/\p{C}/gu, '').trim();
  if (!cleaned) return null;
  return Array.from(cleaned).slice(0, 12).join('');
}

function normalizePin(raw) {
  return typeof raw === 'string' && /^\d{4}$/.test(raw) ? raw : null;
}

function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(a, 'hex'), bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function isValidEntry(name, entry) {
  return !!entry && typeof entry.pinHash === 'string' && Number.isFinite(entry.points) && typeof name === 'string';
}

function createPoints(file = path.join(__dirname, '..', 'data', 'points.json'), secret = process.env.POINTS_SECRET || 'dev-secret-change-me') {
  let queue = Promise.resolve();

  function hashPin(name, pin) {
    return crypto.createHmac('sha256', secret).update(`${name}\u0000${pin}`).digest('hex');
  }

  function makeToken(name) {
    const exp = Date.now() + TOKEN_TTL_MS;
    const sig = crypto.createHmac('sha256', secret).update(`${name}\u0000${exp}`).digest('hex');
    return Buffer.from(JSON.stringify({ name, exp, sig })).toString('base64url');
  }

  // 토큰이 유효하면 그 안에 담긴 이름을, 아니면 null을 돌려줘요
  function verifyToken(token) {
    let parsed;
    try { parsed = JSON.parse(Buffer.from(String(token), 'base64url').toString('utf8')); }
    catch { return null; }
    const { name, exp, sig } = parsed || {};
    if (typeof name !== 'string' || !Number.isFinite(exp) || typeof sig !== 'string') return null;
    if (Date.now() > exp) return null;
    const expected = crypto.createHmac('sha256', secret).update(`${name}\u0000${exp}`).digest('hex');
    return timingSafeEqualHex(expected, sig) ? name : null;
  }

  async function read() {
    let raw;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      // 파일이 깨져 있으면 옆으로 격리해두고 빈 상태로 계속 진행해요 (안 그러면 로그인/조회가 영구히 실패해요)
      const quarantine = `${file}.corrupt-${Date.now()}`;
      await fs.rename(file, quarantine).catch(() => {});
      console.error('포인트 파일이 손상돼서 격리했어요:', quarantine, error);
      return {};
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([name, entry]) => isValidEntry(name, entry)));
  }

  async function write(data) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = file + '.tmp';
    await fs.writeFile(temp, JSON.stringify(data), 'utf8');
    await fs.rename(temp, file);
  }

  // 처음 보는 이름이면 그 PIN으로 새로 등록하고, 이미 있는 이름이면 PIN이 맞는지 확인해요.
  // 방과 마찬가지로 큐로 순서를 지켜서, 같은 이름으로 동시에 로그인해도 등록이 겹쳐 쓰이지 않게 해요.
  function login(name, pin) {
    const attempt = queue.catch(() => {}).then(async () => {
      const data = await read();
      const entry = data[name];
      const pinHash = hashPin(name, pin);
      if (entry) {
        if (!timingSafeEqualHex(entry.pinHash, pinHash)) {
          const error = new Error('PIN이 일치하지 않아요.');
          error.code = 'PIN_MISMATCH';
          throw error;
        }
        return entry.points;
      }
      data[name] = { pinHash, points: STARTING_POINTS, updatedAt: new Date().toISOString() };
      await write(data);
      return STARTING_POINTS;
    });
    queue = attempt.catch(() => {}); // 이번 시도가 실패해도 다음 요청은 계속 처리돼요
    return attempt.then(points => ({ points, token: makeToken(name) }));
  }

  async function getPoints(name) {
    await queue.catch(() => {}); // 직전 쓰기가 실패했어도 조회는 계속 되게 해요
    const data = await read();
    return data[name] ? data[name].points : null;
  }

  async function listAll() {
    await queue.catch(() => {});
    const data = await read();
    return Object.entries(data).map(([name, entry]) => ({ name, points: entry.points }));
  }

  // 즐거운 게임 입장료만큼 깎아요. 포인트가 모자라면 깎지 않고 실패해요.
  function spend(name, cost) {
    const attempt = queue.catch(() => {}).then(async () => {
      const data = await read();
      const entry = data[name];
      if (!entry) {
        const error = new Error('로그인이 필요해요.');
        error.code = 'NOT_FOUND';
        throw error;
      }
      if (entry.points < cost) {
        const error = new Error('포인트가 부족해요.');
        error.code = 'INSUFFICIENT';
        throw error;
      }
      const nextPoints = entry.points - cost;
      data[name] = { ...entry, points: nextPoints, updatedAt: new Date().toISOString() };
      await write(data);
      return nextPoints;
    });
    queue = attempt.catch(() => {});
    return attempt;
  }

  // 관리자가 이름별 포인트를 더하거나 뺘요(뺄 땐 amount에 음수를 넘겨요). 0 밑으로는 안 내려가요.
  // 아직 한 번도 로그인하지 않은 이름은 지급 대상이 아니에요(본인이 먼저 등록해야 해요).
  function grant(name, amount) {
    const attempt = queue.catch(() => {}).then(async () => {
      const data = await read();
      const entry = data[name];
      if (!entry) {
        const error = new Error('그런 이름은 없어요.');
        error.code = 'NOT_FOUND';
        throw error;
      }
      const nextPoints = Math.max(0, entry.points + amount);
      data[name] = { ...entry, points: nextPoints, updatedAt: new Date().toISOString() };
      await write(data);
      return nextPoints;
    });
    queue = attempt.catch(() => {});
    return attempt;
  }

  // 학습게임에서 맞힌 정답 개수만큼 포인트를 적립해요. 한 판에 인정하는 정답 개수(maxCorrectPerRound)와
  // 오늘 이 게임으로 이미 적립한 만큼을 빼고 남은 하루 한도(maxPointsPerDay) 중 더 작은 쪽만큼만 줘요.
  function earn(name, gameId, correct, now = Date.now()) {
    const config = EARN_CONFIG[gameId];
    const attempt = queue.catch(() => {}).then(async () => {
      if (!config) {
        const error = new Error('알 수 없는 학습게임이에요.');
        error.code = 'UNKNOWN_GAME';
        throw error;
      }
      const data = await read();
      const entry = data[name];
      if (!entry) {
        const error = new Error('로그인이 필요해요.');
        error.code = 'NOT_FOUND';
        throw error;
      }
      const cappedCorrect = Math.min(Math.max(0, Math.floor(correct) || 0), config.maxCorrectPerRound);
      // pointsPerCorrect가 1보다 작은 게임(예: 정답 5개당 1점 = 0.2)도 있어서, 소수점 포인트가 쌓이지 않게 내림해요.
      const rawPoints = Math.floor(cappedCorrect * config.pointsPerCorrect);
      const today = new Date(now).toISOString().slice(0, 10);
      const todaysEntry = entry.dailyEarn && entry.dailyEarn[gameId];
      const earnedToday = todaysEntry && todaysEntry.date === today ? todaysEntry.amount : 0;
      const awarded = Math.max(0, Math.min(rawPoints, config.maxPointsPerDay - earnedToday));
      const nextPoints = entry.points + awarded;
      const dailyEarn = { ...(entry.dailyEarn || {}), [gameId]: { date: today, amount: earnedToday + awarded } };
      data[name] = { ...entry, points: nextPoints, dailyEarn, updatedAt: new Date(now).toISOString() };
      await write(data);
      return { awarded, points: nextPoints, dailyCapped: awarded < rawPoints };
    });
    queue = attempt.catch(() => {});
    return attempt;
  }

  return { login, getPoints, listAll, spend, grant, earn, verifyToken, normalizeName, normalizePin };
}

module.exports = { createPoints, STARTING_POINTS, EARN_CONFIG };
