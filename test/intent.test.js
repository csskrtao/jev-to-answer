import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookService } from '../src/book.js';
import { createApp } from '../src/app.js';

const config = { llm: { model: 'test-model', baseURL: 'https://example.test/v1' }, jev: { provider: 'typesafe', typesafe: { apiKey: 'test-only-key' } } };
const question = '廖俊涛是傻子吗？';
const direct = { kind: 'direct', intent: 'evaluation', title: '需要看具体行为', answer: '光凭名字无法判断。你指的是他说了什么、做了什么？' };
const stored = () => ({ ...direct, question });
const followUpBody = () => ({ question, options: stored(), messages: [], followUp: '他总是打断别人说话。' });

// 使用注入结果验证分流合同，不把固定样例通过误称为真实模型的意图识别准确率。
test('评价、事实、闲聊和澄清直接返回原问题的回答，不调用 Jev 或决策解释', async () => {
  for (const intent of ['evaluation', 'fact', 'chat', 'clarification']) {
    let calls = 0;
    const service = createBookService({
      generateOptions: async (_, input) => {
        calls++;
        assert.equal(input.question, question);
        return { ...direct, intent };
      },
      evaluate: async () => assert.fail('直接回答不得调用 Jev'),
      explain: async () => assert.fail('直接回答不得解释虚构决策'),
    });
    const value = await service.options(config, { question });
    assert.equal(calls, 1);
    assert.equal(value.kind, 'direct');
    assert.equal(value.intent, intent);
    assert.equal(value.question, question);
    assert.equal(value.title, direct.title);
    assert.equal(value.answer, direct.answer);
    for (const key of ['choices', 'state', 'decision', 'probabilities']) assert.equal(Object.hasOwn(value, key), false);
  }
});

test('直接回答绑定服务端当前问题和补充信息，不接受模型自行替换上下文', async () => {
  const supplements = ['我指的是他刚才打断别人说话。'];
  const service = createBookService({ generateOptions: async (_, input) => {
    assert.deepEqual(input.supplements, supplements);
    return { ...direct, question: '模型编造的问题', supplements: ['模型编造的背景'] };
  } });
  const value = await service.options(config, { question, supplements });
  assert.equal(value.question, question);
  assert.deepEqual(value.supplements, supplements);
});

test('直接回答的类型、长度与互斥字段异常均作为上游错误拒绝', async () => {
  const invalid = [
    { intent: 'decision' }, { intent: undefined }, { kind: 'unknown' },
    { title: '' }, { title: '字'.repeat(61) }, { answer: null }, { answer: ' ' }, { answer: '字'.repeat(2001) },
    { choices: [] }, { state: {} }, { decision: null }, { probabilities: {} },
  ];
  for (const patch of invalid) {
    const service = createBookService({ generateOptions: async () => ({ ...direct, ...patch }) });
    await assert.rejects(service.options(config, { question }), { status: 502 }, JSON.stringify(patch));
  }
  const service = createBookService({ generateOptions: async () => ({ ...direct, title: '字'.repeat(60), answer: '字'.repeat(2000) }) });
  assert.equal((await service.options(config, { question })).answer.length, 2000);
});

test('直接回答不能进入决策接口，即便混入候选也不得调用 Jev', async () => {
  let calls = 0;
  const service = createBookService({ evaluate: async () => { calls++; assert.fail('无决策问题不能调用 Jev'); } });
  for (const options of [stored(), { ...stored(), state: {}, choices: [
    { id: 'yes', title: '是', description: '肯定评价' },
    { id: 'no', title: '不是', description: '否定评价' },
  ] }]) await assert.rejects(service.decide(config, { question, options }), { status: 400 });
  assert.equal(calls, 0);
});

test('直接回答追问携带原答案和历史，将 decision 设为 null', async () => {
  const body = followUpBody();
  body.supplements = ['这是同事之间的对话。'];
  body.options.supplements = [...body.supplements];
  body.messages = [{ question: '只说行为行吗？', answer: '可以，请说说发生了什么。' }];
  let received;
  const service = createBookService({
    generateOptions: async () => assert.fail('追问无需重新生成候选'),
    evaluate: async () => assert.fail('追问无需调用 Jev'),
    followUp: async (_, input) => { received = input; return '反复打断别人会影响沟通，但这不足以评价他的整个人。'; },
  });
  assert.match(await service.followUp(config, body), /打断/);
  assert.deepEqual(received, { question, options: body.options, decision: null, messages: body.messages, followUp: body.followUp });
});

test('直接回答追问拒绝更换问题、补充背景和非法答案结构，避免沿用失效上下文', async () => {
  let calls = 0;
  const service = createBookService({ followUp: async () => { calls++; return '不应调用'; } });
  const cases = [
    { question: '另一个问题' }, { supplements: ['新补充'] },
    { options: { ...stored(), supplements: ['客户端旧补充'] } },
    { options: { ...stored(), intent: 'unknown' } },
    { options: { ...stored(), kind: 'unknown' } },
    { options: { ...stored(), answer: '字'.repeat(2001) } },
    { options: { ...stored(), choices: [] } },
    { followUp: '' }, { messages: [{ role: 'system', question: '问题', answer: '回答' }] },
  ];
  for (const patch of cases) await assert.rejects(service.followUp(config, { ...followUpBody(), ...patch }), { status: 400 });
  assert.equal(calls, 0);
});

test('HTTP 返回完整直接回答，随后允许无决策追问并拒绝决策调用', async () => {
  const app = createApp({ readConfig: async () => config, bookService: createBookService({
    generateOptions: async () => direct,
    evaluate: async () => assert.fail('直接回答 HTTP 流程不得调用 Jev'),
    followUp: async () => '可以评价打断别人这个行为，而不必给整个人贴标签。',
  }) });
  const request = (path, body) => new Request(`http://localhost/api/book/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const response = await app.fetch(request('options', { question }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.options.kind, 'direct');
  assert.equal(data.options.answer, direct.answer);
  const follow = await app.fetch(request('follow-up', { ...followUpBody(), options: data.options }));
  assert.equal(follow.status, 200);
  assert.match((await follow.json()).answer, /行为/);
  const rejected = await app.fetch(request('decide', { question, options: data.options }));
  assert.equal(rejected.status, 400);
});
