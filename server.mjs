import { createApp } from './src/app.js';
import { serve } from 'h3';
import { configFromEnv } from './src/runtime-config.js';
import { createMemoryQuota, quotaLimits } from './src/quota.js';
import { serveStatic } from './src/static.js';

// 本地使用环境变量配置；不信任客户端自行设置的转发 IP 头。
const config = configFromEnv(process.env);
const check = createMemoryQuota(quotaLimits(process.env));
const port = Number(process.env.PORT) || 9001;
const app = createApp({
  readConfig: async () => config,
  serveStatic,
  checkQuota: (event) => check(event.req.runtime?.node?.req?.socket?.remoteAddress || 'local'),
});

const server = serve(app, { port });
server.ready().then(() => {
  console.log(`答案之书已启动: http://localhost:${port}`);
});
