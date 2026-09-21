import { createApp } from './src/app.js';
import { configFromEnv } from './src/runtime-config.js';
import { quotaLimits } from './src/quota.js';
export { UsageQuota } from './src/quota.js';

/** 持久化对象在多个 Worker 实例之间共享额度，重启不会清零。 */
async function checkQuota(request, env) {
  if (!env.USAGE_QUOTA) throw new Error('缺少额度存储绑定');
  const limits = quotaLimits(env);
  // 只采用 Cloudflare 提供的客户端 IP，忽略访客可伪造的 X-Forwarded-For。
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  const key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  async function consume(name, perMinute, perDay) {
    const stub = env.USAGE_QUOTA.get(env.USAGE_QUOTA.idFromName(name));
    const response = await stub.fetch('https://quota.internal/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ perMinute, perDay }),
    });
    if (response.status === 429) return response;
    if (!response.ok) throw new Error('额度校验失败');
    return null;
  }
  const personal = await consume(`visitor:${key}`, limits.perMinute, limits.perDay);
  if (personal) return personal;
  // 全站按日计数；每分钟阈值设为日阈值，避免额外限制。
  return consume('global', limits.globalPerDay, limits.globalPerDay);
}

export default {
  async fetch(request, env) {
    const app = createApp({
      readConfig: async () => configFromEnv(env),
      checkQuota: () => checkQuota(request, env),
    });
    return app.fetch(request);
  },
};
