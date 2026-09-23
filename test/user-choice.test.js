import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 运行实际前端流程，模拟网络与 DOM，不调用收费模型接口。
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function fixture() {
  const request = deferred();
  const elements = new Map();
  const state = { pending: { question: '周末去哪', category: 'daily', options: { choices: [
    { id: 'a', title: '散步', description: '去公园' }, { id: 'b', title: '读书', description: '在家读书' },
  ] } }, records: [], view: 'home', supplementDrafts: new Map() };
  const requests = [];
  const context = vm.createContext({ state, AbortController, DOMException, Date,
    $: (key) => { if (!elements.has(key)) elements.set(key, { hidden: false, innerHTML: '', focus() {} }); return elements.get(key); },
    escapeHTML: (text) => String(text), isDirect: (record) => record?.options?.kind === 'direct',
    categories: { daily: '日常' }, setBusy: (value) => { state.busy = value; },
    openReader() {}, closeReader() {}, persistRecords() {}, renderHistory() {}, toast() {},
    createRecordId: () => 'new', readableError: (error) => error.message,
    renderResult: (record) => { state.shown = record; },
    renderJourney: (phase) => { state.phase = phase; },
    api: (url, args) => { requests.push({ url, ...args }); return request.promise; },
  });
  for (const name of ['userChoiceLabel', 'renderUserChoice', 'waitForUserChoice', 'runJourney']) {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`, 'm'));
    assert.ok(match, name);
    vm.runInContext(match[0], context);
  }
  return { context, state, request, requests, elements };
}
const result = { decision: { choiceId: 'a', probabilities: { a: 0.7, b: 0.3 }, explanation: '适合散步' } };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('Jev 先完成仍不展示或保存，改选并确认犹豫后仅保存一次', async () => {
  const f = fixture();
  const task = f.context.runJourney();
  const pending = f.state.pending;
  f.request.resolve(result);
  await tick();
  assert.equal(f.state.records.length, 0);
  assert.equal(f.state.shown, undefined);
  pending.userChoiceId = 'b';
  pending.userChoiceId = 'hesitate';
  pending.confirmChoice();
  assert.equal(pending.confirmChoice, undefined);
  await task;
  assert.equal(f.state.records.length, 1);
  assert.equal(f.state.records[0].userChoiceId, 'hesitate');
  assert.equal(f.context.userChoiceLabel(f.state.records[0]), '犹豫');
  assert.equal(f.requests[0].body.userChoiceId, undefined);
  assert.equal(f.requests[0].body.options.choices.length, 2);
});

test('用户先确认时等待后台，同一轮不能重复发起请求', async () => {
  const f = fixture();
  const task = f.context.runJourney();
  f.state.pending.userChoiceId = 'a';
  f.state.pending.confirmChoice();
  await f.context.runJourney();
  assert.equal(f.requests.length, 1);
  assert.equal(f.state.records.length, 0);
  f.request.resolve(result);
  await task;
  assert.equal(f.context.userChoiceLabel(f.state.shown), '散步');
});

test('取消选择会立即释放等待，迟到响应不写历史', async () => {
  const f = fixture();
  const task = f.context.runJourney();
  f.state.controller.abort();
  await task;
  assert.equal(f.state.busy, false);
  assert.equal(f.state.pending, null);
  f.request.resolve(result);
  await tick();
  assert.equal(f.state.records.length, 0);
});

test('失败保留确认状态，重试复用候选且不要求再选', async () => {
  const f = fixture();
  const task = f.context.runJourney();
  f.state.pending.userChoiceId = 'b';
  f.state.pending.confirmChoice();
  f.request.reject(new Error('网络失败'));
  await task;
  assert.equal(f.state.phase, 'error');
  assert.equal(f.state.pending.userChoiceId, 'b');
  f.context.api = async () => result;
  await f.context.runJourney();
  assert.equal(f.state.records.length, 1);
  assert.equal(f.state.records[0].userChoiceId, 'b');
});

test('确认后取消，迟到的成功响应也清理本轮且不保存', async () => {
  const f = fixture();
  const task = f.context.runJourney();
  f.state.pending.userChoiceId = 'hesitate';
  f.state.pending.confirmChoice();
  f.state.controller.abort();
  f.request.resolve(result);
  await task;
  assert.equal(f.state.pending, null);
  assert.equal(f.state.records.length, 0);
  assert.equal(f.state.busy, false);
});

test('旧记录与直接回答不虚构用户选择，单选区保留完整说明', () => {
  const f = fixture();
  assert.equal(f.context.userChoiceLabel({ options: f.state.pending.options }), '');
  assert.equal(f.context.userChoiceLabel({ options: { kind: 'direct' }, userChoiceId: 'hesitate' }), '');
  f.context.renderUserChoice(f.state.pending);
  const html = f.elements.get('#journey').innerHTML;
  assert.match(html, /去公园/);
  assert.match(html, /value="hesitate"/);
  assert.doesNotMatch(html, /checked/);
});
