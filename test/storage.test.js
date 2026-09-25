const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createFileBackend, createRedisBackend, createStorageBackend } = require('../server/storage');

test('file backend: missing key reads as null, write/read round-trips, quarantine renames the file aside', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-storage-'));
  try {
    const backend = createFileBackend();
    const file = path.join(directory, 'nested', 'thing.json');

    assert.equal(await backend.read(file), null);

    await backend.write(file, '{"a":1}');
    assert.equal(await backend.read(file), '{"a":1}');

    const dest = await backend.quarantine(file);
    assert.ok(dest.startsWith(file + '.corrupt-'));
    assert.equal(await backend.read(file), null, '원래 자리엔 더 이상 없어요');
    assert.equal(await fs.readFile(dest, 'utf8'), '{"a":1}', '격리된 파일에 내용이 그대로 남아있어요');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

// fetch를 흉내내서 Upstash REST API를 실제로 호출하지 않고 요청 모양만 검증해요
function mockFetch(handler) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options, body: options && options.body ? JSON.parse(options.body) : null });
    return handler(calls.at(-1));
  };
  return { calls, restore: () => { global.fetch = original; } };
}

test('redis backend: read sends a GET command with the auth header and returns the string result', async () => {
  const { calls, restore } = mockFetch(() => ({
    ok: true, json: async () => ({ result: 'hello' }),
  }));
  try {
    const backend = createRedisBackend('https://example-upstash.io', 'secret-token');
    const value = await backend.read('mykey');
    assert.equal(value, 'hello');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://example-upstash.io');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-token');
    assert.deepEqual(calls[0].body, ['GET', 'mykey']);
  } finally {
    restore();
  }
});

test('redis backend: read returns null when the key does not exist', async () => {
  const { restore } = mockFetch(() => ({ ok: true, json: async () => ({ result: null }) }));
  try {
    const backend = createRedisBackend('https://example-upstash.io', 'secret-token');
    assert.equal(await backend.read('missing'), null);
  } finally {
    restore();
  }
});

test('redis backend: write sends a SET command with the key and content', async () => {
  const { calls, restore } = mockFetch(() => ({ ok: true, json: async () => ({ result: 'OK' }) }));
  try {
    const backend = createRedisBackend('https://example-upstash.io', 'secret-token');
    await backend.write('mykey', '{"points":5}');
    assert.deepEqual(calls[0].body, ['SET', 'mykey', '{"points":5}']);
  } finally {
    restore();
  }
});

test('redis backend: quarantine copies the value to a "<key>.corrupt-<ts>" key, then deletes the original', async () => {
  const { calls, restore } = mockFetch((call) => {
    if (call.body[0] === 'GET') return { ok: true, json: async () => ({ result: 'broken-but-preserved' }) };
    return { ok: true, json: async () => ({ result: 'OK' }) };
  });
  try {
    const backend = createRedisBackend('https://example-upstash.io', 'secret-token');
    const dest = await backend.quarantine('mykey');
    assert.ok(dest.startsWith('mykey.corrupt-'));
    assert.deepEqual(calls.map(c => c.body[0]), ['GET', 'SET', 'DEL']);
    assert.deepEqual(calls[1].body, ['SET', dest, 'broken-but-preserved']);
    assert.deepEqual(calls[2].body, ['DEL', 'mykey']);
  } finally {
    restore();
  }
});

test('redis backend: a non-ok response or a Redis-side error both throw instead of silently returning nothing', async () => {
  const { restore: restore1 } = mockFetch(() => ({ ok: false, status: 500, json: async () => ({}) }));
  try {
    const backend = createRedisBackend('https://example-upstash.io', 'secret-token');
    await assert.rejects(backend.read('x'));
  } finally { restore1(); }

  const { restore: restore2 } = mockFetch(() => ({ ok: true, json: async () => ({ error: 'WRONGTYPE' }) }));
  try {
    const backend = createRedisBackend('https://example-upstash.io', 'secret-token');
    await assert.rejects(backend.read('x'));
  } finally { restore2(); }
});

test('createStorageBackend picks Redis only when both env vars are set, otherwise falls back to the file backend', async () => {
  const { calls, restore } = mockFetch(() => ({ ok: true, json: async () => ({ result: 'from-redis' }) }));
  try {
    const withBoth = createStorageBackend({ UPSTASH_REDIS_REST_URL: 'https://x.io', UPSTASH_REDIS_REST_TOKEN: 't' });
    assert.equal(await withBoth.read('k'), 'from-redis');
    assert.equal(calls.length, 1, '두 환경변수가 다 있으면 Redis를 써요');

    const withOnlyUrl = createStorageBackend({ UPSTASH_REDIS_REST_URL: 'https://x.io' });
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-storage-'));
    try {
      const file = path.join(directory, 'f.json');
      await withOnlyUrl.write(file, 'still-a-file');
      assert.equal(await fs.readFile(file, 'utf8'), 'still-a-file', '토큰이 없으면 파일 백엔드로 남아있어요');
      assert.equal(calls.length, 1, '파일 백엔드를 쓸 땐 fetch를 안 불러요');
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }

    const withNeither = createStorageBackend({});
    const directory2 = await fs.mkdtemp(path.join(os.tmpdir(), 'fishing-storage-'));
    try {
      const file = path.join(directory2, 'f.json');
      await withNeither.write(file, 'plain-file');
      assert.equal(await fs.readFile(file, 'utf8'), 'plain-file');
    } finally {
      await fs.rm(directory2, { recursive: true, force: true });
    }
  } finally {
    restore();
  }
});
