import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, unlink, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigStore, DEFAULT_CONFIG, mergeConfig, publicConfig, deepMerge } from '../src/config-store.js';
import { createApp } from '../src/app.js';
import { createBookService } from '../src/book.js';

// 全部测试使用虚构凭据与临时目录，不读取或修改 data/config.json。
const testConfig = () => mergeConfig(structuredClone(DEFAULT_CONFIG), {
  llm: { apiKey: 'test-only-llm-key', baseURL: 'https://example.test/v1', model: 'test-model' },
  jev: { vercel: { apiKey: 'test-only-jev-key' } },
});
const post = (path, body) => new Request(`http://localhost${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('默认配置无密钥，公开配置只返回 configured 标记', () => {
  assert.equal(DEFAULT_CONFIG.jev.vercel.apiKey, '');
  assert.equal(DEFAULT_CONFIG.jev.typesafe.apiKey, '');
  const publicValue = publicConfig(testConfig());
  assert.equal(publicValue.llm.apiKeyConfigured, true);
  assert.equal(publicValue.jev.vercel.apiKeyConfigured, true);
  assert.equal(publicValue.jev.typesafe.apiKeyConfigured, false);
  assert.equal(JSON.stringify(publicValue).includes('test-only'), false);
  assert.equal(Object.hasOwn(publicValue.llm, 'apiKey'), false);
});

test('空密钥保留旧值、部分保存保留其它通道、显式清除才删除', () => {
  const before = testConfig();
  const after = mergeConfig(before, { llm: { apiKey: '', model: 'new-model' }, jev: { provider: 'typesafe' } });
  assert.equal(after.llm.apiKey, before.llm.apiKey);
  assert.equal(after.jev.vercel.apiKey, before.jev.vercel.apiKey);
  assert.equal(after.llm.model, 'new-model');
  assert.equal(mergeConfig(after, { llm: { clearApiKey: true } }).llm.apiKey, '');
  assert.equal(before.llm.model, 'test-model');
});

test('错误配置不会进入存储，原型字段不会污染对象', () => {
  for (const patch of [{ llm: null }, { llm: { model: 42 } }, { llm: { baseURL: 'file:///secret' } }, { jev: { provider: 'unknown' } }, { llm: { clearApiKey: 'yes' } }]) {
    assert.throws(() => mergeConfig(testConfig(), patch), { status: 400 });
  }
  const value = deepMerge({}, JSON.parse('{"__proto__":{"polluted":true}}'));
  assert.equal(Object.hasOwn(value, '__proto__'), false);
  assert.equal({}.polluted, undefined);
});

test('配置持久化与并发部分保存保留密钥，读取结果无法修改缓存', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'answer-book-config-'));
  const path = join(directory, 'config.json');
  try {
    const store = createConfigStore(path);
    await store.saveConfig(testConfig());
    await Promise.all([store.saveConfig({ llm: { model: 'updated' } }), store.saveConfig({ jev: { provider: 'typesafe' } })]);
    const actual = await store.readConfig();
    assert.equal(actual.llm.model, 'updated');
    assert.equal(actual.jev.provider, 'typesafe');
    assert.equal(actual.llm.apiKey, 'test-only-llm-key');
    actual.llm.apiKey = 'mutated';
    assert.equal((await store.readConfig()).llm.apiKey, 'test-only-llm-key');
    assert.equal(JSON.parse(await readFile(path, 'utf8')).llm.apiKey, 'test-only-llm-key');
  } finally {
    await unlink(path).catch(() => {});
    await rmdir(directory);
  }
});

test('损坏配置不会被默认配置静默覆盖', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'answer-book-invalid-'));
  const path = join(directory, 'config.json');
  try {
    await writeFile(path, '{broken', 'utf8');
    const store = createConfigStore(path);
    await assert.rejects(store.saveConfig({ llm: { model: 'new' } }));
    assert.equal(await readFile(path, 'utf8'), '{broken');
  } finally {
    await unlink(path);
    await rmdir(directory);
  }
});

test('配置 GET/POST 响应从不包含密钥，模型列表空密钥沿用已配置值', async () => {
  let current = testConfig();
  const app = createApp({
    readConfig: async () => current,
    saveConfig: async (patch) => (current = mergeConfig(current, patch)),
    listModels: async (llm) => { assert.equal(llm.apiKey, 'test-only-llm-key'); return ['test-model']; },
  });
  for (const request of [new Request('http://localhost/api/config'), post('/api/config', { llm: { apiKey: '', model: 'changed' } })]) {
    const response = await app.fetch(request);
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.equal(text.includes('test-only'), false);
    assert.equal(JSON.parse(text).config.llm.apiKeyConfigured, true);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const models = await app.fetch(post('/api/models', { llm: { apiKey: '' } }));
  assert.deepEqual((await models.json()).models, ['test-model']);
});

test('新路由返回合同结构，字段与请求体超限返回客户端错误', async () => {
  const question = '周末做什么？';
  const options = { question, state: '安排周末', choices: [
    { id: 'a', title: '散步', description: '去附近公园散步。' },
    { id: 'b', title: '读书', description: '留在家里读一本书。' },
  ] };
  const app = createApp({
    readConfig: async () => testConfig(),
    bookService: createBookService({
      generateOptions: async () => options,
      evaluate: async () => ({ answers: { decision: { type: 'choice', choice: 'a', probabilities: { a: 0.7, b: 0.3 } } } }),
      explain: async () => { throw new Error('解释暂不可用'); },
    }),
  });
  const generated = await app.fetch(post('/api/book/options', { question }));
  assert.deepEqual((await generated.json()).options, options);
  const decided = await app.fetch(post('/api/book/decide', { question, options }));
  const data = await decided.json();
  assert.equal(data.ok, true);
  assert.equal(data.decision.choiceId, 'a');
  assert.equal(data.decision.explanationUnavailable, true);
  assert.equal((await app.fetch(post('/api/book/options', { question: '字'.repeat(1001) }))).status, 400);
  assert.equal((await app.fetch(post('/api/book/options', { question: '字'.repeat(65_536) }))).status, 413);
});

test('内部异常不在 API 响应中暴露服务凭据', async () => {
  const app = createApp({ readConfig: async () => { throw new Error('test-only-private-key'); } });
  const response = await app.fetch(new Request('http://localhost/api/config'));
  assert.equal(response.status, 500);
  assert.equal((await response.text()).includes('test-only-private-key'), false);
});
