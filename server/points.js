const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createStorageBackend } = require('./storage');

const TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60일: 가족 서비스라 자주 다시 로그인하지 않아도 되게 넉넉히 잡아요
const STARTING_POINTS = 30; // 처음 등록할 때부터 즐거운 게임을 한 판이라도 해볼 수 있게 주는 시작 포인트

// 학습게임마다 "게임 자체 성과(예: 정답 개수)를 포인트로 어떻게 환산할지"는 그 게임 폴더 안
// earn-config.json이 직접 정해요(public/<게임>/earn-config.json). 전체 시스템은 그 정책을 읽어서
// "한 판에 인정하는 단위 수"와 "하루 적립 한도"를 강제로 지키게 만드는 것까지만 알아요 — 그래서
// 게임마다 스스로 매기는 점수(배율·콤보 등)를 그대로 믿는 게 아니라, 그 게임이 명시한 단위·비율·상한
// 안에서만 적립돼요. 완벽한 부정 방지는 아니지만(진짜로 그 단위를 달성했는지까지는 확인 안 해요),
// 게임 하나가 한 번에·하루에 줄 수 있는 포인트를 항상 작게 묶어둬요.
// earn-config.json이 아예 없는 게임 폴더는 학습게임으로 등록되지 않은 걸로 보고 적립을 거부해요.
// 파일은 있지만 값이 없거나 이상하면(음수 등) 그 항목만 기본값(DEFAULT_EARN_POLICY)으로 채워요.
const DEFAULT_EARN_POLICY = { pointsPerUnit: 1, maxUnitsPerRound: 20, maxPointsPerDay: 30 };
const GAME_ID_PATTERN = /^[a-z0-9-]+$/; // 파일 경로에 쓰이니 이 모양만 허용해서 경로 탈출을 원천 차단해요

async function loadEarnPolicy(gamesDir, gameId) {
  if (typeof gameId !== 'string' || !GAME_ID_PATTERN.test(gameId)) return null;
  const gameDir = path.join(gamesDir, gameId);
  if (!gameDir.startsWith(path.resolve(gamesDir) + path.sep)) return null; // 이중 안전장치
  let raw;
  try {
    raw = await fs.readFile(path.join(gameDir, 'earn-config.json'), 'utf8');
  } catch {
    return null; // 파일이 없으면 학습게임으로 등록 안 된 거예요
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  const pick = key => (Number.isFinite(parsed[key]) && parsed[key] >= 0 ? parsed[key] : DEFAULT_EARN_POLICY[key]);
  return { pointsPerUnit: pick('pointsPerUnit'), maxUnitsPerRound: pick('maxUnitsPerRound'), maxPointsPerDay: pick('maxPointsPerDay') };
}

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

function createPoints(file = path.join(__dirname, '..', 'data', 'points.json'), secret = process.env.POINTS_SECRET || 'dev-secret-change-me', options = {}) {
  let queue = Promise.resolve();
  const gamesDir = options.gamesDir || path.join(__dirname, '..', 'public');
  const backend = options.backend || createStorageBackend();

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
    const raw = await backend.read(file);
    if (raw == null) return {};
    let data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      // 저장된 내용이 깨져 있으면 옆으로 격리해두고 빈 상태로 계속 진행해요 (안 그러면 로그인/조회가 영구히 실패해요)
      const quarantine = await backend.quarantine(file);
      console.error('포인트가 손상돼서 격리했어요:', quarantine, error);
      return {};
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([name, entry]) => isValidEntry(name, entry)));
  }

  async function write(data) {
    await backend.write(file, JSON.stringify(data));
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

  // 학습게임이 보낸 "단위 수"(예: 정답 개수)만큼 포인트를 적립해요. 그 게임의 earn-config.json이 정한
  // 한 판 최대 인정 단위 수(maxUnitsPerRound)와, 오늘 이 게임으로 이미 적립한 만큼을 빼고 남은 하루
  // 한도(maxPointsPerDay) 중 더 작은 쪽만큼만 줘요.
  function earn(name, gameId, units, now = Date.now()) {
    const attempt = queue.catch(() => {}).then(async () => {
      const config = await loadEarnPolicy(gamesDir, gameId);
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
      const cappedUnits = Math.min(Math.max(0, Math.floor(units) || 0), config.maxUnitsPerRound);
      const rawPoints = cappedUnits * config.pointsPerUnit;
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

module.exports = { createPoints, STARTING_POINTS, DEFAULT_EARN_POLICY };
