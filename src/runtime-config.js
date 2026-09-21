import { DEFAULT_CONFIG, mergeConfig } from './config.js';

/** 生产配置仅来自管理员控制的环境；不再读取旧文件或 KV 中的密钥。 */
export function configFromEnv(env = {}) {
  const provider = env.JEV_PROVIDER || 'typesafe';
  if (!['typesafe', 'vercel'].includes(provider)) throw new Error('JEV_PROVIDER 配置无效');
  return mergeConfig(structuredClone(DEFAULT_CONFIG), {
    llm: { baseURL: env.LLM_BASE_URL || '', model: env.LLM_MODEL || '', apiKey: env.LLM_API_KEY || '' },
    jev: {
      provider,
      [provider]: {
        apiKey: env.JEV_API_KEY || '',
        baseURL: env.JEV_BASE_URL || DEFAULT_CONFIG.jev[provider].baseURL,
        model: env.JEV_MODEL || DEFAULT_CONFIG.jev[provider].model,
      },
    },
  });
}

/** 本地免密钥模型仍可使用；Jev 必须配置管理员的密钥。 */
export function isServiceReady(config) {
  return Boolean(config?.llm?.baseURL && config.llm.model && config.jev?.[config.jev.provider]?.apiKey);
}
