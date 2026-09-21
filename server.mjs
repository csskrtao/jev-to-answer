import { createApp } from './src/app.js';
import { serve } from 'h3';

// 独立端口，方便与原来的 Jev 调试广场同时运行。
const port = Number(process.env.PORT) || 9001;
const app = createApp();

const server = serve(app, { port });
server.ready().then(() => {
  console.log(`答案之书已启动: http://localhost:${port}`);
});
