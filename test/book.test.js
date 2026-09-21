import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookService, validateOptions, validateDecision, validateState } from '../src/book.js';
import { withTimeout } from '../src/timeout.js';

const question = '周末应该去爬山，还是留在家里休息？';
const choices = [
  { id: 'option_a', title: '去爬山', description: '选一条轻松路线，呼吸新鲜空气。' },
  { id: 'option_b', title: '在家休息', description: '留出完整时间补觉和恢复精力。' },
];
const options = { question, state: { context: '正在考虑周末的安排' }, choices };
const config = { llm: { model: 'test-llm' }, jev: { provider: 'test' } };
const result = { answers: { decision: { type: 'choice', choice: 'option_b', probabilities: { option_a: 0.35, option_b: 0.65 } } } };
const explanation = '这次更倾向于留在家里休息。给自己留出一段不必赶行程的时间，可能更容易照顾当下的状态。这个倾向只是模型对现有选项的比较，并不代表你出门就会失望。可以先睡个好觉，再根据精力决定要不要去附近散步，让周末保留一点弹性。';

test('完整流程保留 Jev 选择和概率，并把完整候选交给解释模型', async () => {
  let evaluationInput;
  let explanationInput;
  const service = createBookService({
    generateOptions: async (llm, input) => {
      assert.equal(llm.model, 'test-llm');
      assert.equal(input.question, question);
      return options;
    },
    evaluate: async (_, input) => { evaluationInput = input; return result; },
    explain: async (_, input) => { explanationInput = input; return explanation; },
  });
  const generated = await service.options(config, { question, category: '生活' });
  const decision = await service.decide(config, { question, options: generated });
  assert.deepEqual(decision, { choiceId: 'option_b', probabilities: { option_a: 0.35, option_b: 0.65 }, explanation });
  assert.equal(evaluationInput.state.question, question);
  assert.deepEqual(Object.keys(evaluationInput.questions.decision.criteria), ['option_a', 'option_b']);
  assert.deepEqual(explanationInput.options.choices, choices);
  assert.equal(explanationInput.decision.choiceId, 'option_b');
});

test('非法问题与分类在调用外部模型前被拒绝', async () => {
  let calls = 0;
  const service = createBookService({ generateOptions: async () => { calls++; return options; } });
  for (const body of [{ question: '' }, { question: 42 }, { question: '问'.repeat(1001) }, { question, category: {} }]) {
    await assert.rejects(service.options(config, body), { status: 400 });
  }
  assert.equal(calls, 0);
});

test('大模型生成无效选项时返回上游格式错误', async () => {
  const service = createBookService({ generateOptions: async () => ({ state: 'abc', choices: choices.slice(0, 1) }) });
  await assert.rejects(service.options(config, { question }), { status: 502 });
});

test('选项数量、重复 ID、危险 ID 与字段上限均校验', () => {
  const invalidChoices = [
    choices.slice(0, 1), [...choices, ...choices, choices[0]],
    [choices[0], { ...choices[1], id: choices[0].id }],
    [choices[0], { ...choices[1], id: '__proto__' }],
    [choices[0], { ...choices[1], id: 'constructor' }],
    [choices[0], { ...choices[1], title: '字'.repeat(61) }],
    [choices[0], { ...choices[1], description: '字'.repeat(201) }],
  ];
  for (const invalid of invalidChoices) assert.throws(() => validateOptions({ ...options, choices: invalid }, question), { status: 400 });
});

test('问题修改后拒绝使用旧选项，且不会调用 Jev', async () => {
  let called = false;
  const service = createBookService({ evaluate: async () => { called = true; return result; } });
  await assert.rejects(service.decide(config, { question: '另一件事', options }), { status: 400 });
  assert.equal(called, false);
});

test('state 递归、长度、节点数量及危险字段受限制', () => {
  let deep = {};
  for (let i = 0; i < 8; i++) deep = { next: deep };
  const circular = {}; circular.self = circular;
  for (const state of [undefined, null, 42, '', 'a'.repeat(8001), deep, circular, Array(257).fill('x'), JSON.parse('{"__proto__":{"polluted":true}}')]) {
    assert.throws(() => validateState(state), { status: 400 });
  }
  assert.deepEqual(validateState({ facts: ['周末', 2, true, null] }), { facts: ['周末', 2, true, null] });
});

test('缺失概率不会伪造成零或百分之百', () => {
  const decision = validateDecision({ answers: { decision: { type: 'choice', choice: 'option_a' } } }, choices);
  assert.deepEqual(decision, { choiceId: 'option_a', probabilities: {} });
});

test('TypeSafe 官方通道必须提供完整 Choice 分布', () => {
  assert.throws(() => validateDecision({ provider: 'typesafe', answers: { decision: { type: 'choice', choice: 'option_a' } } }, choices), { status: 502 });
  const officialResult = structuredClone(result);
  officialResult.provider = 'typesafe';
  officialResult.answers.decision.confidence = 0.18;
  assert.equal(validateDecision(officialResult, choices).probabilities.option_b, 0.65);
});

test('无效选项、概率或分布直接拒绝，不产生替代选择', () => {
  const invalid = [
    { type: 'choice', choice: 'missing' },
    { type: 'score', choice: 'option_a' },
    { type: 'choice', choice: 'option_a', probabilities: {} },
    { type: 'choice', choice: 'option_a', probabilities: { option_a: 1.1, option_b: -0.1 } },
    { type: 'choice', choice: 'option_a', probabilities: { option_a: '0.8', option_b: 0.2 } },
    { type: 'choice', choice: 'option_a', probabilities: { option_a: 0.8, option_b: 0.8 } },
    { type: 'choice', choice: 'option_b', probabilities: { option_a: 0.8, option_b: 0.2 } },
    { type: 'choice', choice: 'option_a', probabilities: { option_a: NaN, option_b: 0.2 } },
    { type: 'choice', choice: 'option_a', probabilities: { option_a: 0.8, unexpected: 0.2 } },
  ];
  for (const answer of invalid) assert.throws(() => validateDecision({ answers: { decision: answer } }, choices), { status: 502 });
});

test('Jev 请求失败时不调用解释或制造结果', async () => {
  let explained = false;
  const service = createBookService({
    evaluate: async () => { throw Object.assign(new Error('Jev timeout'), { status: 504 }); },
    explain: async () => { explained = true; return explanation; },
  });
  await assert.rejects(service.decide(config, { question, options }), { status: 504 });
  assert.equal(explained, false);
});

test('解释失败、为空或超长仍保留已经得到的 Jev 结果', async () => {
  for (const explain of [async () => { throw new Error('unavailable'); }, async () => '', async () => '字'.repeat(801)]) {
    const service = createBookService({ evaluate: async () => result, explain });
    const decision = await service.decide(config, { question, options });
    assert.equal(decision.explanationUnavailable, true);
    assert.equal(decision.choiceId, 'option_b');
    assert.deepEqual(decision.probabilities, result.answers.decision.probabilities);
  }
});

test('超时会终止外部请求并返回 504', async () => {
  let signal;
  await assert.rejects(withTimeout((incoming) => { signal = incoming; return new Promise(() => {}); }, 10, '测试服务'), { status: 504 });
  assert.equal(signal.aborted, true);
  assert.equal(await withTimeout(async () => '完成', 100, '测试服务'), '完成');
});
