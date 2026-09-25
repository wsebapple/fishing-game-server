const fs = require('node:fs/promises');
const path = require('node:path');

// 지금까지 쓰던 방식이에요: 로컬 파일에 임시파일+rename으로 안전하게 저장해요.
// 서버가 재시작돼도 파일이 살아있는 디스크에서만 데이터가 유지돼요(예: 계속 켜져 있는 서버,
// 영구 디스크를 붙인 배포 환경). Render 무료/프리뷰 서비스처럼 디스크가 재시작마다 사라지는
// 곳에서는 이 백엔드로는 데이터가 유지되지 않아요 — 그럴 땐 Redis 백엔드를 쓰세요.
function createFileBackend() {
  return {
    async read(key) {
      try {
        return await fs.readFile(key, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async write(key, content) {
      await fs.mkdir(path.dirname(key), { recursive: true });
      const temp = key + '.tmp';
      await fs.writeFile(temp, content, 'utf8');
      await fs.rename(temp, key);
    },
    async quarantine(key) {
      const dest = `${key}.corrupt-${Date.now()}`;
      await fs.rename(key, dest).catch(() => {});
      return dest;
    },
  };
}

// Upstash Redis의 REST API를 써요(일반 Redis 프로토콜이 아니라 그냥 HTTPS 요청이라, 서버가 자주
// 재시작되는 환경에서도 연결을 계속 물고 있을 필요가 없어요). 명령은 문서에 나온 대로 JSON 배열을
// POST 본문에 담아 보내요: ["SET", "key", "value"] 같은 식. 무료 티어로 이 앱 트래픽엔 충분해요.
function createRedisBackend(url, token) {
  async function call(...args) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`Redis 요청 실패(${res.status}): ${args[0]}`);
    const body = await res.json();
    if (body.error) throw new Error(`Redis 오류: ${body.error}`);
    return body.result;
  }
  return {
    async read(key) {
      const value = await call('GET', key);
      return value == null ? null : value;
    },
    async write(key, content) {
      await call('SET', key, content);
    },
    async quarantine(key) {
      const dest = `${key}.corrupt-${Date.now()}`;
      const value = await call('GET', key);
      if (value != null) await call('SET', dest, value);
      await call('DEL', key);
      return dest;
    },
  };
}

// UPSTASH_REDIS_REST_URL·_TOKEN 환경변수가 있으면 자동으로 Redis를, 없으면 파일을 써요 —
// 로컬 개발이나 영구 디스크가 있는 배포는 그대로 파일을 쓰고, Render 무료/프리뷰처럼 디스크가
// 없어지는 곳만 이 두 환경변수를 넣어주면 코드 변경 없이 Redis로 넘어가요.
function createStorageBackend(env = process.env) {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    return createRedisBackend(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
  }
  return createFileBackend();
}

module.exports = { createStorageBackend, createFileBackend, createRedisBackend };
