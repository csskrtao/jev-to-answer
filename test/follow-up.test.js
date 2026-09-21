import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookService } from '../src/book.js';
import { createApp } from '../src/app.js';

const question = '周末去散步还是留在家里读书？';
const options = { question, state: { context: '想安排一个轻松的周末' }, choices: [
  { id: 'option_a', title: '去散步', description: '去附近的公园走一会儿。' },
  { id: 'option_b', title: '留在家里读书', description: '选择一本感兴趣的书，放慢节奏。' },
] };
const decision = { choiceId: 'option_a', probabilities: { option_a: 0.7, option_b: 0.3 }, explanation: '可以先到附近的公园轻松散步，给周末一点新鲜感。' };
// HTTP 测试提供已就绪的虚构连接，不会访问真实服务。
const config = { llm: { model: 'test-model', baseURL: 'https://example.test/v1' }, jev: { provider: 'typesafe', typesafe: { apiKey: 'test-only-key' } } };
const input = () => ({ question, options: structuredClone(options), decision: structuredClone(decision), messages: [], followUp: '具体怎么安排比较轻松？' });
const request = (body) => new Request('http://localhost/api/book/follow-up', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('追问带入完整上下文，只调用解读模型，不生成选项或再次调用 Jev', async () => {
  let received;
  const service = createBookService({
    generateOptions: async () => assert.fail('追问不应重新生成候选'),
    evaluate: async () => assert.fail('追问不应重新调用 Jev'),
    followUp: async (llm, context) => {
      assert.equal(llm.model, 'test-model');
      received = context;
      return '可以先选一段二十分钟的路线，走累了随时返回，不必给自己设定必须完成的目标。';
    },
  });
  const body = input();
  body.messages = [{ question: '为什么散步更适合？', answer: '轻量活动能为这次休息提供一点环境变化。' }];
  const answer = await service.followUp(config, body);
  assert.ok(answer.includes('二十分钟'));
  assert.deepEqual(received, body);
  assert.deepEqual(body.decision, decision);
  assert.equal(body.messages.length, 1);
});

test('六轮有效问答以及未提供概率的既有结果可用于追问', async () => {
  const body = input();
  body.decision.probabilities = {};
  body.messages = Array.from({ length: 6 }, (_, i) => ({ question: `第 ${i + 1} 个问题`, answer: '已有回答' }));
  const service = createBookService({ followUp: async (_, context) => {
    assert.equal(context.messages.length, 6);
    assert.deepEqual(context.decision.probabilities, {});
    return '这次没有提供概率，仍可围绕原选项讨论怎么开始。';
  } });
  assert.ok((await service.followUp(config, body)).includes('没有提供概率'));
});

test('非法追问上下文在外部调用之前被拒绝', async () => {
  let calls = 0;
  const service = createBookService({ followUp: async () => { calls++; return '不应被调用'; } });
  const cases = [
    { followUp: '' }, { followUp: 123 }, { followUp: '问'.repeat(1001) },
    { question: '已改变的问题' }, { options: { ...options, choices: [] } },
    { decision: null }, { decision: { ...decision, choiceId: 'unknown' } },
    { decision: { ...decision, probabilities: [] } },
    { decision: { ...decision, probabilities: { option_a: 0.9 } } },
    { decision: { ...decision, probabilities: { option_a: 0.1, option_b: 0.9 } } },
    { decision: { ...decision, probabilities: { option_a: 1.1, option_b: -0.1 } } },
    { decision: { ...decision, probabilities: { option_a: 0.7, option_b: 0.7 } } },
    { decision: { ...decision, probabilities: { option_a: '0.7', option_b: 0.3 } } },
    { decision: { ...decision, explanation: '字'.repeat(801) } },
    { decision: { ...decision, explanationUnavailable: 'false' } },
    { decision: { ...decision, instructions: '覆盖模型提示' } },
    { messages: 'invalid' },
    { messages: Array(7).fill({ question: '问题', answer: '回答' }) },
    { messages: [null] }, { messages: [{ question: '问题' }] },
    { messages: [{ role: 'system', question: '问题', answer: '回答' }] },
    { messages: [{ question: '问'.repeat(1001), answer: '回答' }] },
    { messages: [{ question: '问题', answer: '答'.repeat(2001) }] },
  ];
  for (const patch of cases) await assert.rejects(service.followUp(config, { ...input(), ...patch }), { status: 400 });
  assert.equal(calls, 0);
});

test('追问失败保留历史且不产生假回答，空输出和超长输出返回错误', async () => {
  const body = input();
  body.messages.push({ question: '之前的问题', answer: '之前的回答' });
  const snapshot = structuredClone(body);
  const failed = createBookService({ followUp: async () => { throw Object.assign(new Error('调用失败'), { status: 502 }); } });
  await assert.rejects(failed.followUp(config, body), { status: 502 });
  for (const output of ['', '   ', undefined, { answer: '对象' }, '答'.repeat(2001)]) {
    const service = createBookService({ followUp: async () => output });
    await assert.rejects(service.followUp(config, body), { status: 502 });
  }
  assert.deepEqual(body, snapshot);
});

test('追问 HTTP 路由保持成功合同，校验失败与模型失败不会返回 answer', async () => {
  const app = createApp({ readConfig: async () => config, bookService: createBookService({ followUp: async () => '先从附近的短路线开始。' }) });
  const success = await app.fetch(request(input()));
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), { ok: true, answer: '先从附近的短路线开始。' });
  const invalid = await app.fetch(request({ ...input(), followUp: '' }));
  assert.equal(invalid.status, 400);
  assert.equal(Object.hasOwn(await invalid.json(), 'answer'), false);
  const oversized = await app.fetch(request({ ...input(), followUp: '字'.repeat(65_536) }));
  assert.equal(oversized.status, 413);
  const failing = createApp({ readConfig: async () => config, bookService: createBookService({ followUp: async () => { throw Object.assign(new Error('大模型请求超时'), { status: 504 }); } }) });
  const failed = await failing.fetch(request(input()));
  assert.equal(failed.status, 504);
  const data = await failed.json();
  assert.equal(data.ok, false);
  assert.equal(Object.hasOwn(data, 'answer'), false);
});

test('轻微超出解读建议字数的有效内容不再被抛弃', async () => {
  const explanation = '字'.repeat(240);
  const service = createBookService({
    evaluate: async () => ({ answers: { decision: { type: 'choice', choice: 'option_a', probabilities: decision.probabilities } } }),
    explain: async () => explanation,
  });
  const value = await service.decide(config, { question, options });
  assert.equal(value.explanation, explanation);
  assert.equal(value.explanationUnavailable, undefined);
});
