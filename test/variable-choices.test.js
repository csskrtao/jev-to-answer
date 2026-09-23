import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookService, validateOptions, validateDecision } from '../src/book.js';
import { createApp } from '../src/app.js';
import { generateBookOptions } from '../src/llm.js';

const question = '周末有哪些活动可以选？';
const config = {
  llm: { model: 'test', baseURL: 'https://llm.example.test/v1' },
  jev: { provider: 'typesafe', typesafe: { apiKey: 'test-only-key', baseURL: 'https://jev.example.test/v1' } },
};
const makeOptions = (count) => ({
  question, state: { context: '周末安排' },
  choices: Array.from({ length: count }, (_, index) => ({
    id: `option_${index + 1}`, title: `活动${index + 1}`, description: `第${index + 1}个活动的说明`,
  })),
});

// 在真实 HTTP 适配边界截获请求，验证全部候选，而不消耗外部服务额度。
test('2、5、12、30 个候选完整贯穿 HTTP、TypeSafe、解读、追问与重写', async (t) => {
  let sent;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://jev.example.test/v1/systemone');
    sent = JSON.parse(init.body);
    const ids = Object.keys(sent.questions.decision.criteria);
    return Response.json({ answers: { decision: {
      type: 'choice', choice: ids.at(-1),
      probabilities: Object.fromEntries(ids.map((id, index) => [id, index === ids.length - 1 ? 1 : 0])),
    } } });
  });
  for (const count of [2, 5, 12, 30]) {
    const options = makeOptions(count);
    const seen = {};
    const capture = (step) => async (_, input) => { seen[step] = input; return '结合全部候选给出说明。'; };
    const app = createApp({ readConfig: async () => config, bookService: createBookService({
      generateOptions: async () => options,
      explain: capture('explain'), followUp: capture('followUp'), rewrite: capture('rewrite'),
    }) });
    async function post(path, body) {
      const response = await app.fetch(new Request(`http://localhost/api/book/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }));
      assert.equal(response.status, 200);
      return response.json();
    }
    const generated = (await post('options', { question })).options;
    assert.deepEqual(generated.choices, options.choices);
    const decision = (await post('decide', { question, options: generated })).decision;
    assert.deepEqual(Object.entries(sent.questions.decision.criteria), options.choices.map(
      (choice) => [choice.id, `${choice.title}：${choice.description}`],
    ));
    assert.equal(decision.choiceId, `option_${count}`);
    assert.equal(Object.keys(decision.probabilities).length, count);
    await post('follow-up', { question, options: generated, decision, followUp: '为什么选它？' });
    await post('rewrite', { question, options: generated, decision, style: 'concise' });
    for (const input of Object.values(seen)) {
      assert.deepEqual(input.options.choices, options.choices);
      assert.deepEqual(input.decision.probabilities, decision.probabilities);
      assert.equal(input.decision.choiceId, decision.choiceId);
    }
    assert.deepEqual(Object.keys(seen), ['explain', 'followUp', 'rewrite']);
  }
});

test('候选仍需至少两个且字段有效，旧字母 ID 保持兼容', () => {
  for (const count of [0, 1]) assert.throws(() => validateOptions(makeOptions(count), question), { status: 400 });
  for (const patch of [{ id: 'option_1' }, { title: '活动1' }, { id: 'bad-id' }, { description: '' }]) {
    const options = makeOptions(30);
    Object.assign(options.choices[29], patch);
    assert.throws(() => validateOptions(options, question), { status: 400 });
  }
  const legacy = makeOptions(2);
  legacy.choices[0].id = 'option_a';
  legacy.choices[1].id = 'option_b';
  assert.deepEqual(validateOptions(legacy, question), legacy);
});

test('多候选概率缺项、选中未知候选时仍拒绝', () => {
  const { choices } = makeOptions(30);
  const probabilities = Object.fromEntries(choices.map(({ id }) => [id, 1 / 30]));
  const result = { provider: 'typesafe', answers: { decision: { type: 'choice', choice: 'option_30', probabilities } } };
  assert.deepEqual(validateDecision(result, choices).probabilities, probabilities);
  delete probabilities.option_29;
  assert.throws(() => validateDecision(result, choices), { status: 502 });
  result.answers.decision.choice = 'unknown';
  assert.throws(() => validateDecision(result, choices), { status: 502 });
});

test('候选生成沿用模型输出额度并完整解析多候选，残缺 JSON 不进入 Jev', async (t) => {
  let content = JSON.stringify(makeOptions(30));
  let sent;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    sent = JSON.parse(init.body);
    return Response.json({ id: 'mock', object: 'chat.completion', created: 1, model: 'test',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  });
  assert.deepEqual(await generateBookOptions(config.llm, { question }), makeOptions(30));
  assert.equal(sent.max_tokens, undefined);
  assert.equal(sent.max_completion_tokens, undefined);
  const system = sent.messages.find((message) => message.role === 'system').content;
  assert.match(system, /至少 2.*不设上限/);
  assert.match(system, /option_1、option_2/);
  assert.doesNotMatch(system, /2 到 4|option_d/);
  content = content.slice(0, -10);
  const service = createBookService({ evaluate: async () => assert.fail('残缺候选不得发送给 Jev') });
  await assert.rejects(service.options(config, { question }), { status: 502 });
});
