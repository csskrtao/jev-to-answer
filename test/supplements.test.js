import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookService } from '../src/book.js';
import { createApp } from '../src/app.js';
import { DEFAULT_CONFIG } from '../src/config-store.js';

// 外部模型全部注入测试实现，验证信息传递而不消耗实际 API 配额。
const question = '周末出去走走还是在家休息？';
const supplements = ['只有周六下午有空。', '预算改为 100 元，希望少走路。'];
const choices = [
  { id: 'option_a', title: '附近坐坐', description: '选择附近可以坐下休息的公园。' },
  { id: 'option_b', title: '居家休息', description: '在家放松，节省预算与体力。' },
];
const generated = { state: { context: '安排周末' }, choices };
const result = { answers: { decision: { type: 'choice', choice: 'option_b', probabilities: { option_a: 0.2, option_b: 0.8 } } } };
// 只使用测试凭据，满足公共接口的服务就绪检查。
const config = structuredClone(DEFAULT_CONFIG);
config.llm.baseURL = 'https://example.test/v1';
config.llm.model = 'test-model';
config.jev.typesafe.apiKey = 'test-only-key';

test('全部补充贯穿生成选项、Jev 选择、解读和继续追问，原问题保持独立', async () => {
  const calls = {};
  const service = createBookService({
    generateOptions: async (_, input) => { calls.options = input; return generated; },
    evaluate: async (_, input) => { calls.evaluate = input; return result; },
    explain: async (_, input) => { calls.explain = input; return '结合新增的时间与预算，居家休息更容易安排。'; },
    followUp: async (_, input) => { calls.followUp = input; return '可以把周六下午留给休息。'; },
  });
  const options = await service.options(config, { question, supplements, category: '日常小事' });
  assert.deepEqual(options.supplements, supplements);
  assert.equal(options.question, question);
  const decision = await service.decide(config, { question, supplements, options });
  assert.equal(decision.choiceId, 'option_b');
  await service.followUp(config, { question, supplements, options, decision, followUp: '怎么安排？' });
  assert.deepEqual(calls.options.supplements, supplements);
  assert.deepEqual(calls.evaluate.state.supplements, supplements);
  assert.equal(calls.evaluate.state.question, question);
  assert.deepEqual(calls.explain.options.supplements, supplements);
  assert.deepEqual(calls.followUp.options.supplements, supplements);
  assert.equal(calls.followUp.question, question);
});

test('补充被修改、删减或乱序后，旧候选不能直接用于选择或追问', async () => {
  let calls = 0;
  const service = createBookService({
    evaluate: async () => { calls++; return result; },
    followUp: async () => { calls++; return '不应调用'; },
  });
  const options = { ...generated, question, supplements };
  for (const changed of [[], ['只有周日有空。'], [...supplements].reverse(), undefined]) {
    await assert.rejects(service.decide(config, { question, supplements: changed, options }), { status: 400 });
    await assert.rejects(service.followUp(config, { question, supplements: changed, options, followUp: '为什么？' }), { status: 400 });
  }
  assert.equal(calls, 0);
});

test('非法或超限补充在外部调用之前被拒绝，五条完整信息可通过', async () => {
  let calls = 0;
  const service = createBookService({ generateOptions: async () => { calls++; return generated; } });
  for (const invalid of [null, '一条信息', {}, [42], [''], ['  '], ['字'.repeat(1001)], Array(6).fill('新信息')]) {
    await assert.rejects(service.options(config, { question, supplements: invalid }), { status: 400 });
  }
  assert.equal(calls, 0);
  const maximum = Array(5).fill('字'.repeat(1000));
  const options = await service.options(config, { question, supplements: maximum });
  assert.deepEqual(options.supplements, maximum);
  assert.equal(calls, 1);
});

test('没有补充的旧历史和原接口保持兼容', async () => {
  const service = createBookService({
    generateOptions: async () => generated,
    evaluate: async () => result,
    explain: async () => '可以在家休息。',
    followUp: async () => '留出半天时间放松。',
  });
  const options = await service.options(config, { question });
  assert.deepEqual(options, { question, ...generated });
  const decision = await service.decide(config, { question, options });
  assert.equal(await service.followUp(config, { question, options, decision, followUp: '怎么做？' }), '留出半天时间放松。');
});

test('HTTP 接口保留补充信息并拒绝与选项不一致的重试', async () => {
  const app = createApp({
    readConfig: async () => config,
    bookService: createBookService({ generateOptions: async () => generated, evaluate: async () => result, explain: async () => '结合补充选择休息。' }),
  });
  const post = (path, body) => app.fetch(new Request(`http://localhost/api/book/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  const generatedResponse = await post('options', { question, supplements });
  assert.equal(generatedResponse.status, 200);
  const { options } = await generatedResponse.json();
  assert.deepEqual(options.supplements, supplements);
  const accepted = await post('decide', { question, supplements, options });
  assert.equal(accepted.status, 200);
  const stale = await post('decide', { question, supplements: ['改成周日。'], options });
  assert.equal(stale.status, 400);
  assert.match((await stale.json()).error, /补充信息已改变/);
});
