import { H3, readBody, assertBodySize } from 'h3';
import { readConfig, saveConfig, mergeConfig, mergeConnection, publicConfig } from './config-store.js';
import { listModels, generateJevParams, explainResult } from './llm.js';
import { runEvaluate } from './jev.js';
import { serveStatic } from './static.js';
import { createBookService } from './book.js';

/** JSON 请求限制为 64 KiB，先限制字节数再进行字段校验。 */
async function readInput(event) {
  assertBodySize(event, 64 * 1024);
  let body;
  try {
    body = (await readBody(event, { type: 'json' })) ?? {};
  } catch (error) {
    if (error.status === 413 || error.statusCode === 413) throw error;
    throw Object.assign(new Error('请求内容不是有效的 JSON'), { status: 400 });
  }
  if (typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('请求内容必须为 JSON 对象'), { status: 400 });
  return body;
}

/** 统一错误包装:业务错误带 status 字段 → 对应 HTTP 状态码 */
function wrap(fn) {
  return async (event) => {
    try {
      const data = await fn(event);
      return new Response(JSON.stringify({ ok: true, ...data }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    } catch (err) {
      const code = err?.status ?? err?.statusCode;
      const status = Number.isInteger(code) && code >= 400 && code <= 599 ? code : 500;
      // 上游异常可能携带响应正文，不把内部配置或服务细节回显到浏览器。
      const message = status === 500 ? '服务请求未完成，请检查模型配置或稍后重试' : err?.message || '请求未完成';
      return new Response(JSON.stringify({ ok: false, error: message }), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
  };
}

export function createApp(dependencies = {}) {
  const app = new H3();
  const getConfig = dependencies.readConfig ?? readConfig;
  const setConfig = dependencies.saveConfig ?? saveConfig;
  const getModels = dependencies.listModels ?? listModels;
  const book = dependencies.bookService ?? createBookService();

  // 读取配置(GET /api/config)
  app.get('/api/config', wrap(async () => ({ config: publicConfig(await getConfig()) })));

  // 保存配置(POST /api/config)
  app.post('/api/config', wrap(async (event) => {
    const body = await readInput(event);
    const config = await setConfig({ llm: body?.llm, jev: body?.jev });
    return { config: publicConfig(config) };
  }));

  // 获取模型列表:用已保存的 LLM 配置或请求中携带的配置
  app.post('/api/models', wrap(async (event) => {
    const body = await readInput(event);
    const config = await getConfig();
    const llm = mergeConnection(config.llm, body?.llm ?? {});
    const models = await getModels(llm);
    return { models };
  }));

  // 根据用户需求生成 Jev 参数 { state, questions }
  app.post('/api/gen-params', wrap(async (event) => {
    const body = await readInput(event);
    const config = await getConfig();
    const llm = mergeConnection(config.llm, body?.llm ?? {});
    const need = String(body?.need ?? '').trim();
    if (!need) throw Object.assign(new Error('请输入评估需求'), { status: 400 });
    const params = await generateJevParams(llm, need);
    return { params };
  }));

  // 调用 Jev:body { state, questions } + 可选 jev 配置覆盖
  app.post('/api/jev', wrap(async (event) => {
    const body = await readInput(event);
    const config = await getConfig();
    const jev = mergeConfig(config, { jev: body?.jev ?? {} }).jev;
    const result = await runEvaluate(jev, body);
    return { result };
  }));

  // 用 LLM 解释 Jev 调用结果
  app.post('/api/explain', wrap(async (event) => {
    const body = await readInput(event);
    const config = await getConfig();
    const llm = mergeConnection(config.llm, body?.llm ?? {});
    const need = String(body?.need ?? '');
    const text = await explainResult(llm, need, body?.result);
    return { text };
  }));

  // 两阶段接口用于展示选项生成进度，网页拿到候选后自动交给 Jev。
  app.post('/api/book/options', wrap(async (event) => {
    const body = await readInput(event);
    return { options: await book.options(await getConfig(), body) };
  }));
  app.post('/api/book/decide', wrap(async (event) => {
    const body = await readInput(event);
    return { decision: await book.decide(await getConfig(), body) };
  }));
  app.post('/api/book/follow-up', wrap(async (event) => {
    const body = await readInput(event);
    return { answer: await book.followUp(await getConfig(), body) };
  }));

  // 静态资源(public/)
  app.all('/**', async (event) => {
    const pathname = event.path || '/';
    const res = await serveStatic(event, pathname);
    if (res) return res;
    return new Response('Not Found', { status: 404 });
  });

  return app;
}
