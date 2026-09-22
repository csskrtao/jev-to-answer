import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookService } from '../src/book.js';
import { createApp } from '../src/app.js';
import { RESPONSE_STYLES, responseStylePrompt } from '../src/response-styles.js';
import { generateBookOptions, explainBookDecision, answerBookFollowUp, rewriteBookAnswer } from '../src/llm.js';

const question = '周末去散步还是在家读书？';
const options = { question, state: { context: '想放松' }, choices: [
  { id: 'option_a', title: '去散步', description: '到附近公园走走。' },
  { id: 'option_b', title: '在家读书', description: '选择一本喜欢的书。' },
] };
const decision = { choiceId: 'option_a', probabilities: { option_a: 0.7, option_b: 0.3 }, explanation: '散步更容易开始。' };
const config = { llm: { model: 'test', baseURL: 'https://example.test/v1' }, jev: { provider: 'typesafe', typesafe: { apiKey: 'key' } } };
const direct = { kind: 'direct', intent: 'chat', question, title: '建议', answer: '可以先出去走走。' };

test('六种风格均传入业务服务，省略时默认 gentle，非法值在外部模型前拒绝', async () => {
  for (const style of RESPONSE_STYLES.map((item) => item.id)) {
    let seen;
    const service = createBookService({
      generateOptions: async (_llm, body) => { seen = body.style; return { ...direct }; },
      evaluate: async () => ({ answers: { decision: { type: 'choice', choice: 'option_a', probabilities: decision.probabilities } } }),
      explain: async (_llm, body) => { seen = body.style; return '解读'; },
      followUp: async (_llm, body) => { seen = body.style; return '追问回答'; },
      rewrite: async (_llm, body) => { seen = body.style; return '改写回答'; },
    });
    await service.options(config, { question, style }); assert.equal(seen, style);
    await service.decide(config, { question, options, style }); assert.equal(seen, style);
    await service.followUp(config, { question, options: direct, messages: [], followUp: '怎么做？', style }); assert.equal(seen, style);
    await service.rewrite(config, { question, options: direct, style }); assert.equal(seen, style);
  }
  let calls = 0;
  const service = createBookService({ generateOptions: async () => { calls++; return direct; } });
  await service.options(config, { question });
  assert.equal(calls, 1);
  await assert.rejects(service.options(config, { question, style: 'unknown' }), { status: 400 });
  assert.equal(calls, 1);
});

test('风格提示词包含安全约束并保持候选中性', () => {
  const roast = responseStylePrompt('roast');
  assert.match(roast, /损友/);
  assert.match(roast, /不能改变事实/);
  assert.match(responseStylePrompt('concise'), /结论先行/);
});

test('所有业务入口默认温和并拒绝非法风格，补充与两类追问均带入实际风格', async () => {
  const seen = [];
  const capture = (result) => async (_config, body) => { seen.push(body); return result; };
  const service = createBookService({
    generateOptions: capture(options), explain: capture('解释'), followUp: capture('追问'), rewrite: capture('重写'),
    evaluate: async (_config, payload) => {
      assert.equal(JSON.stringify(payload).includes('style'), false);
      return { answers: { decision: { type: 'choice', choice: decision.choiceId, probabilities: decision.probabilities } } };
    },
  });
  const input = { question, options, decision, followUp: '怎么开始？' };
  for (const method of ['options', 'decide', 'followUp', 'rewrite']) {
    await service[method](config, input);
    assert.equal(seen.at(-1).style, 'gentle');
    for (const style of [null, '', {}, 123, 'Gentle', 'unknown']) {
      const count = seen.length;
      await assert.rejects(service[method](config, { ...input, style }), { status: 400 });
      assert.equal(seen.length, count);
    }
  }
  for (const { id: style } of RESPONSE_STYLES) {
    const supplements = ['只有半小时时间'];
    const supplemented = { ...options, supplements };
    await service.options(config, { question, supplements, style });
    assert.deepEqual(seen.at(-1).supplements, supplements);
    for (const value of [supplemented, { ...direct, supplements }]) {
      await service.followUp(config, { question, supplements, options: value, decision: value.kind === 'direct' ? null : decision, followUp: '下一步？', style });
      assert.equal(seen.at(-1).style, style);
      assert.deepEqual(seen.at(-1).options.supplements, supplements);
    }
  }
});

test('改写拒绝过期上下文和畸形数据，失败不修改输入', async () => {
  const service = createBookService({ rewrite: async () => assert.fail('无效上下文不得进入模型') });
  const input = { question, options, decision };
  for (const patch of [
    { question: '换了问题' }, { supplements: ['新条件'] }, { options: { ...options, choices: [] } },
    { decision: null }, { decision: { ...decision, choiceId: 'unknown' } },
    { decision: { ...decision, probabilities: { option_a: 0.1, option_b: 0.9 } } },
    { options: { ...direct, choiceId: 'option_a' }, decision: null },
  ]) {
    const body = structuredClone({ ...input, ...patch });
    const original = structuredClone(body);
    await assert.rejects(service.rewrite(config, body), { status: 400 });
    assert.deepEqual(body, original);
  }
  for (const output of ['', '字'.repeat(2001), undefined, {}]) {
    const failed = createBookService({ rewrite: async () => output });
    await assert.rejects(failed.rewrite(config, { question, options: direct }), { status: 502 });
  }
});

test('风格目录只公开展示文案；四个 HTTP 接口一致处理默认与非法值，重写额度耗尽不执行', async () => {
  let calls = 0;
  const request = (path, body) => new Request(`https://book.test/api/book/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const methods = { options: 'options', decide: 'decide', 'follow-up': 'followUp', rewrite: 'rewrite' };
  const bookService = Object.fromEntries(Object.values(methods).map((method) => [method, async (_config, body) => {
    calls++;
    return method === 'rewrite' ? { style: body.style, answer: '回答' } : '回答';
  }]));
  const app = createApp({ readConfig: async () => config, bookService });
  const catalog = await (await app.fetch(new Request('https://book.test/api/book/styles'))).json();
  assert.equal(catalog.styles.length, 6);
  for (const style of catalog.styles) assert.deepEqual(Object.keys(style).sort(), ['description', 'id', 'label']);
  for (const path of Object.keys(methods)) {
    assert.equal((await (await app.fetch(request(path, {}))).json()).style, 'gentle');
    const before = calls;
    assert.equal((await app.fetch(request(path, { style: 'bad' }))).status, 400);
    assert.equal(calls, before);
  }
  const limited = createApp({ readConfig: async () => config, bookService, checkQuota: () => Response.json({ ok: false, error: '额度耗尽' }, { status: 429, headers: { 'Retry-After': '60' } }) });
  const before = calls;
  const response = await limited.fetch(request('rewrite', { style: 'gentle' }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '60');
  assert.equal(calls, before);
});

test('真实 LLM 适配层把六种风格写入系统提示，候选明确保持中性，改写单次调用', async (t) => {
  const sent = [];
  // 拦截兼容协议的网络边界，验证真正发送给 SDK 的提示，不访问真实服务。
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return Response.json({ id: 'mock', object: 'chat.completion', created: 1, model: 'test', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(direct) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
  for (const { id: style } of RESPONSE_STYLES) {
    const body = { question, category: '日常', options, decision, messages: [], followUp: '如何开始', style };
    for (const [fn, value] of [
      [generateBookOptions, body], [explainBookDecision, body], [answerBookFollowUp, body],
      [answerBookFollowUp, { ...body, options: direct, decision: null }],
      [rewriteBookAnswer, body], [rewriteBookAnswer, { ...body, options: direct, decision: null }],
    ]) {
      const count = sent.length;
      await fn(config.llm, value);
      assert.equal(sent.length, count + 1);
      const system = sent.at(-1).messages.find((message) => message.role === 'system').content;
      assert.ok(system.includes(responseStylePrompt(style)));
      if (fn === generateBookOptions) assert.match(system, /state、choices.*保持中性客观/);
      if (fn === rewriteBookAnswer) assert.match(system, /保留原事实、结论/);
    }
  }
});

test('rewrite 仅调用一次改写函数，不调用 Jev；直接回答拒绝 decision 并保留原输入', async () => {
  let rewriteCalls = 0;
  const service = createBookService({
    rewrite: async (_llm, body) => { rewriteCalls++; assert.equal(body.options.kind, 'direct'); return '毒舌后的正文'; },
    evaluate: async () => assert.fail('rewrite 不得调用 Jev'),
  });
  const body = { question, options: structuredClone(direct), style: 'roast' };
  const snapshot = structuredClone(body);
  const result = await service.rewrite(config, body);
  assert.deepEqual(result, { style: 'roast', answer: '毒舌后的正文' });
  assert.deepEqual(body, snapshot);
  await assert.rejects(service.rewrite(config, { ...body, decision }), { status: 400 });
  assert.equal(rewriteCalls, 1);
});

test('rewrite 决策保留候选与概率，空、超长及上游失败均返回错误', async () => {
  let received;
  const service = createBookService({ rewrite: async (_llm, body) => { received = body; return '简洁解读'; } });
  const result = await service.rewrite(config, { question, options, decision, style: 'concise' });
  assert.deepEqual(result, { style: 'concise', answer: '简洁解读' });
  assert.deepEqual(received.decision, decision);
  for (const output of ['', ' '.repeat(3), '字'.repeat(801)]) {
    const failing = createBookService({ rewrite: async () => output });
    await assert.rejects(failing.rewrite(config, { question, options, decision, style: 'gentle' }), { status: 502 });
  }
  const failed = createBookService({ rewrite: async () => { throw Object.assign(new Error('上游失败'), { status: 504 }); } });
  await assert.rejects(failed.rewrite(config, { question, options, decision, style: 'gentle' }), { status: 504 });
});

test('HTTP 路由返回风格、拒绝未就绪并应用重写额度', async () => {
  const request = (path, body) => new Request(`https://book.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let calls = 0;
  const app = createApp({ readConfig: async () => config, checkQuota: () => { calls++; return undefined; }, bookService: {
    options: async () => direct,
    decide: async () => decision,
    followUp: async () => '回答',
    rewrite: async (_config, body) => ({ style: body.style, answer: '改写' }),
  } });
  const response = await app.fetch(request('/api/book/rewrite', { question, options: direct, style: 'healing' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, style: 'healing', answer: '改写' });
  assert.equal(calls, 1);
  const invalid = await app.fetch(request('/api/book/rewrite', { question, options: direct, style: 'bad' }));
  assert.equal(invalid.status, 400);
  const unready = createApp({ bookService: { rewrite: async () => assert.fail('未就绪不应调用') } });
  assert.equal((await unready.fetch(request('/api/book/rewrite', { question, options: direct }))).status, 503);
});
