import test from 'node:test';
import assert from 'node:assert/strict';
import { configFromEnv, isServiceReady } from '../src/runtime-config.js';
import { createApp } from '../src/app.js';
import { createMemoryQuota } from '../src/quota.js';
import worker from '../worker.js';

// 所有连接都是虚构配置，通过注入业务服务避免消耗真实额度。
const env = { LLM_BASE_URL: 'https://example.test/v1', LLM_MODEL: 'test', LLM_API_KEY: 'private-llm', JEV_API_KEY: 'private-jev' };
const request = (path, body = {}) => new Request(`https://book.test${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('环境配置支持双通道，不携带默认密钥，错误地址不能使用', () => {
  assert.equal(isServiceReady(configFromEnv()), false);
  const config = configFromEnv(env);
  assert.equal(config.llm.apiKey, env.LLM_API_KEY);
  assert.equal(config.jev.typesafe.apiKey, env.JEV_API_KEY);
  assert.equal(config.jev.vercel.apiKey, '');
  assert.equal(isServiceReady(config), true);
  const vercel = configFromEnv({ ...env, JEV_PROVIDER: 'vercel' });
  assert.equal(vercel.jev.vercel.apiKey, env.JEV_API_KEY);
  assert.equal(vercel.jev.vercel.model, 'typesafe-ai/jev');
  assert.throws(() => configFromEnv({ ...env, LLM_BASE_URL: 'file:///secret' }));
  assert.throws(() => configFromEnv({ ...env, JEV_PROVIDER: 'unknown' }));
});

test('所有业务接口拒绝连接覆盖，未就绪或限额耗尽不执行模型调用', async () => {
  let calls = 0;
  const bookService = Object.fromEntries(['options', 'decide', 'followUp'].map((method) => [method, async (config) => {
    assert.equal(config.llm.apiKey, env.LLM_API_KEY);
    calls += 1;
    return 'test-result';
  }]));
  const check = createMemoryQuota({ perMinute: 1 });
  const app = createApp({ readConfig: async () => configFromEnv(env), bookService, checkQuota: () => check('visitor') });
  for (const path of ['/api/book/options', '/api/book/decide', '/api/book/follow-up']) {
    for (const field of ['llm', 'jev', 'baseURL', 'apiKey', 'model']) {
      assert.equal((await app.fetch(request(path, { [field]: 'attacker-input' }))).status, 400);
    }
  }
  assert.equal(calls, 0);
  assert.equal((await app.fetch(request('/api/book/options'))).status, 200);
  const blocked = await app.fetch(request('/api/book/follow-up'));
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal(calls, 1);
  const unconfigured = createApp({ bookService });
  assert.equal((await unconfigured.fetch(request('/api/book/options'))).status, 503);
  assert.equal(calls, 1);
});

test('Worker 不需要旧 KV，配置不跨请求串用，额度服务不可用时拒绝请求', async () => {
  const status = () => new Request('https://book.test/api/status');
  assert.deepEqual(await (await worker.fetch(status(), env)).json(), { ok: true, ready: true });
  assert.deepEqual(await (await worker.fetch(status(), {})).json(), { ok: true, ready: false });
  const failure = await worker.fetch(request('/api/book/options', { question: '散步还是读书？' }), env);
  assert.equal(failure.status, 500);
  assert.equal((await failure.text()).includes('private-'), false);
});

test('Worker 使用可信 IP 隔离访客并汇总全站额度，超限直接返回', async () => {
  const names = [];
  let exceeded = false;
  const USAGE_QUOTA = {
    idFromName(name) { names.push(name); return name; },
    get() { return { async fetch(_url, init) {
      const limits = JSON.parse(init.body);
      assert.ok(limits.perDay > 0);
      if (names.at(-1) === 'global' || exceeded) {
        return Response.json({ ok: false, error: '测试额度已用完' }, { status: 429 });
      }
      return Response.json({ ok: true });
    } }; },
  };
  const send = async (ip, spoofed) => {
    const req = request('/api/book/options', { question: '散步还是读书？' });
    req.headers.set('CF-Connecting-IP', ip);
    req.headers.set('X-Forwarded-For', spoofed);
    return worker.fetch(req, { ...env, USAGE_QUOTA });
  };
  assert.equal((await send('192.0.2.1', 'fake-a')).status, 429);
  assert.equal(names[1], 'global');
  exceeded = true;
  assert.equal((await send('192.0.2.1', 'fake-b')).status, 429);
  assert.equal(names[0], names[2]);
  assert.equal((await send('192.0.2.2', 'fake-b')).status, 429);
  assert.notEqual(names[0], names[3]);
});
