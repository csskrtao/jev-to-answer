import test from 'node:test';
import assert from 'node:assert/strict';
import { runEvaluate } from '../src/jev.js';

// 用 fetch 替身核对官方 HTTP 合同，测试不会发送真实请求或使用真实凭据。
test('TypeSafe 请求遵循 systemone 官方合同并原样保留 Choice 答案', async (context) => {
  let sent;
  const choice = { type: 'choice', choice: 'a', probabilities: { a: 0.7, b: 0.3 }, confidence: 0.21 };
  context.mock.method(globalThis, 'fetch', async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return Response.json({ model: 'jev-1.13.0', answers: { decision: choice, available: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 20, output_tokens: 10 } });
  });
  const result = await runEvaluate({ provider: 'typesafe', typesafe: { baseURL: 'https://example.test/v1/', apiKey: 'test-only-key', model: 'jev-latest' } }, {
    state: { question: '今天做什么' },
    questions: {
      decision: { type: 'choice', instructions: '选择一个适合的活动', criteria: { a: '散步', b: '读书' } },
      available: { type: 'boolean', instructions: '现在有空吗' },
    },
  });
  assert.equal(sent.url, 'https://example.test/v1/systemone');
  assert.equal(sent.init.method, 'POST');
  assert.equal(sent.init.headers.Authorization, 'Bearer test-only-key');
  assert.equal(sent.body.model, 'jev-latest');
  assert.equal(sent.body.questions.available.type, 'noul');
  assert.equal(sent.body.questions.decision.type, 'choice');
  assert.ok(sent.init.signal instanceof AbortSignal);
  assert.deepEqual(result.answers.decision, choice);
  assert.deepEqual(result.answers.available, { type: 'boolean', probability: 0.9 });
});

test('TypeSafe 上游错误不回显服务响应内容', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => Response.json({ message: 'test-only-private-value' }, { status: 401 }));
  await assert.rejects(runEvaluate({ provider: 'typesafe', typesafe: { apiKey: 'test-only-key' } }, { state: 'a', questions: {} }), (error) => {
    assert.equal(error.status, 502);
    assert.equal(error.message.includes('test-only-private-value'), false);
    return true;
  });
});
