import { H3, readBody, assertBodySize } from 'h3';
import { DEFAULT_CONFIG } from './config.js';
import { isServiceReady } from './runtime-config.js';
import { createBookService } from './book.js';
import { publicResponseStyles, validateResponseStyle } from './response-styles.js';

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
      if (data instanceof Response) return data;
      return new Response(JSON.stringify({ ok: true, ...data }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    } catch (err) {
      const code = err?.status ?? err?.statusCode;
      const status = Number.isInteger(code) && code >= 400 && code <= 599 ? code : 500;
      // 上游异常可能携带响应正文，不把内部配置或服务细节回显到浏览器。
      const message = status >= 500 ? '服务暂时不可用，请稍后重试' : err?.message || '请求未完成';
      return new Response(JSON.stringify({ ok: false, error: message }), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
  };
}

export function createApp(dependencies = {}) {
  const app = new H3();
  const getConfig = dependencies.readConfig ?? (async () => structuredClone(DEFAULT_CONFIG));
  const book = dependencies.bookService ?? createBookService();
  const staticHandler = dependencies.serveStatic;

  // 访客只知道服务是否就绪，不接收服务地址、模型名称或任何凭据。
  app.get('/api/status', wrap(async () => ({ ready: isServiceReady(await getConfig()) })));
  app.get('/api/book/styles', wrap(async () => ({ styles: publicResponseStyles() })));

  async function prepare(event) {
    const body = await readInput(event);
    body.style = validateResponseStyle(body.style);
    // 拒绝旧客户端的连接覆盖，防止把服务端密钥发送到访客指定的地址。
    if (['llm', 'jev', 'baseURL', 'apiKey', 'model'].some((key) => Object.hasOwn(body, key))) {
      throw Object.assign(new Error('访客不能修改模型连接配置'), { status: 400 });
    }
    const config = await getConfig();
    if (!isServiceReady(config)) throw Object.assign(new Error('服务暂未就绪，请稍后再试'), { status: 503 });
    const limited = await dependencies.checkQuota?.(event);
    return { body, config, limited };
  }

  // 两阶段接口用于展示选项生成进度，网页拿到候选后自动交给 Jev。
  app.post('/api/book/options', wrap(async (event) => {
    const { body, config, limited } = await prepare(event);
    return limited || { style: body.style, options: await book.options(config, body) };
  }));
  app.post('/api/book/decide', wrap(async (event) => {
    const { body, config, limited } = await prepare(event);
    return limited || { style: body.style, decision: await book.decide(config, body) };
  }));
  app.post('/api/book/follow-up', wrap(async (event) => {
    const { body, config, limited } = await prepare(event);
    return limited || { style: body.style, answer: await book.followUp(config, body) };
  }));
  app.post('/api/book/rewrite', wrap(async (event) => {
    const { body, config, limited } = await prepare(event);
    return limited || await book.rewrite(config, body);
  }));

  // 旧配置、调试以及未知 API 一律关闭，不能落入静态页面。
  app.all('/api/**', () => new Response('Not Found', { status: 404 }));

  // 静态资源由本地 server 注入；Cloudflare 使用 Workers Assets，不必走这层。
  if (typeof staticHandler === 'function') {
    app.all('/**', async (event) => {
      const pathname = event.path || '/';
      const res = await staticHandler(event, pathname);
      if (res) return res;
      return new Response('Not Found', { status: 404 });
    });
  }

  return app;
}
