import test from 'node:test';
import assert from 'node:assert/strict';
import { UsageQuota, createMemoryQuota, quotaLimits } from '../src/quota.js';

// 模拟持久存储及串行事务，验证业务逻辑而不依赖 Cloudflare 服务。
function storageFixture() {
  const data = new Map();
  let queue = Promise.resolve();
  const transactionStorage = {
    async get(key) { return structuredClone(data.get(key)); },
    async put(key, value) { data.set(key, structuredClone(value)); },
  };
  return {
    data,
    transaction(callback) {
      const result = queue.then(() => callback(transactionStorage));
      queue = result.catch(() => {});
      return result;
    },
  };
}

function request(perMinute = 2, perDay = 3) {
  return new Request('https://quota.internal/', {
    method: 'POST', body: JSON.stringify({ perMinute, perDay }),
  });
}

test('配置默认值及非法配置校验', () => {
  assert.deepEqual(quotaLimits(), { perMinute: 12, perDay: 60, globalPerDay: 3000 });
  assert.deepEqual(quotaLimits({ REQUESTS_PER_MINUTE: '2', REQUESTS_PER_DAY: '4', GLOBAL_REQUESTS_PER_DAY: '8' }), {
    perMinute: 2, perDay: 4, globalPerDay: 8,
  });
  for (const value of ['-1', '0', '1.5', 'abc', 'Infinity', '9007199254740992', true]) {
    assert.throws(() => quotaLimits({ REQUESTS_PER_DAY: value }), /正整数/);
  }
});

test('Durable Object 计数持久化、并发不能突破分钟限制', async (t) => {
  t.mock.method(Date, 'now', () => Date.UTC(2026, 8, 21, 12, 0, 10));
  const storage = storageFixture();
  const instance = new UsageQuota({ storage });
  const responses = await Promise.all(Array.from({ length: 8 }, () => instance.fetch(request())));
  assert.equal(responses.filter(response => response.status === 200).length, 2);
  const rejection = responses.find(response => response.status === 429);
  assert.equal(rejection.headers.get('Retry-After'), '50');
  assert.equal((await rejection.json()).ok, false);
  assert.equal((await new UsageQuota({ storage }).fetch(request())).status, 429);
  assert.equal(storage.data.size, 1);
});

test('Durable Object 分钟重置不清空日额度，UTC 跨日恢复', async (t) => {
  let now = Date.UTC(2026, 8, 21, 23, 58, 10);
  t.mock.method(Date, 'now', () => now);
  const storage = storageFixture();
  const instance = new UsageQuota({ storage });
  assert.equal((await instance.fetch(request(1, 2))).status, 200);
  assert.equal((await instance.fetch(request(1, 2))).status, 429);
  now += 60_000;
  assert.equal((await instance.fetch(request(1, 2))).status, 200);
  const rejection = await instance.fetch(request(1, 2));
  assert.equal(rejection.status, 429);
  assert.equal(rejection.headers.get('Retry-After'), '50');
  now += 60_000;
  assert.equal((await instance.fetch(request(1, 2))).status, 200);
  assert.equal(storage.data.size, 1);
});

test('Durable Object 拒绝无效额度', async () => {
  const instance = new UsageQuota({ storage: storageFixture() });
  assert.equal((await instance.fetch(request(0, 3))).status, 400);
  assert.equal((await instance.fetch(new Request('https://quota.internal/', { method: 'POST', body: '{}' }))).status, 400);
});

test('内存限流分别限制用户分钟、日额度和全站日额度，次日恢复', () => {
  let now = Date.UTC(2026, 8, 21, 23, 58);
  const check = createMemoryQuota({ perMinute: 1, perDay: 2, globalPerDay: 3, now: () => now });
  assert.equal(check('a'), null);
  assert.equal(check('a').status, 429);
  now += 60_000;
  assert.equal(check('a'), null);
  assert.equal(check('a').status, 429);
  assert.equal(check('b'), null);
  assert.equal(check('c').status, 429);
  now += 60_000;
  assert.equal(check('a'), null);
  assert.equal(check('b'), null);
  assert.throws(() => createMemoryQuota({ globalPerDay: -1 }), /正整数/);
});
