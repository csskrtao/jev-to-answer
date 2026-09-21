// 默认配置不携带密钥；真实密钥由存储后端（本地文件或 Cloudflare KV）保存。
export const DEFAULT_CONFIG = {
  llm: { name: 'custom', baseURL: '', apiKey: '', model: '' },
  jev: {
    provider: 'typesafe',
    vercel: { baseURL: 'https://ai-gateway.vercel.sh/v4/ai', apiKey: '', model: 'typesafe-ai/jev' },
    typesafe: { baseURL: 'https://api.typesafe.ai/v1', apiKey: '', model: 'jev-latest' },
  },
};

const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);

export function deepMerge(base, patch) {
  if (Array.isArray(patch) || typeof patch !== 'object' || patch === null) {
    return patch === undefined ? base : patch;
  }
  const out = { ...(base ?? {}) };
  for (const key of Object.keys(patch)) {
    if (!unsafeKeys.has(key)) out[key] = deepMerge(base?.[key], patch[key]);
  }
  return out;
}

/** 兼容旧版平铺 Jev 配置，迁移时不改变用户已保存的密钥。 */
export function normalizeConfig(cfg) {
  const j = cfg.jev;
  if (j.baseURL) {
    j.vercel = {
      baseURL: j.baseURL,
      apiKey: j.apiKey ?? j.vercel.apiKey,
      model: j.model ?? j.vercel.model,
    };
  }
  delete j.baseURL;
  delete j.apiKey;
  delete j.model;
  return cfg;
}

function configError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/** 空密钥表示保留，只有明确传入 clearApiKey 才执行清除。 */
export function mergeConnection(current, patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw configError('服务配置必须为对象');
  }
  const next = { ...current };
  for (const key of ['name', 'baseURL', 'model', 'apiKey']) {
    if (patch[key] === undefined) continue;
    if (typeof patch[key] !== 'string' || patch[key].length > (key === 'apiKey' ? 8192 : 2048)) {
      throw configError(`${key} 必须是有效字符串`);
    }
    const value = patch[key].trim();
    if (key === 'baseURL' && value) {
      try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
      } catch {
        throw configError('baseURL 必须是有效的 HTTP 或 HTTPS 地址');
      }
    }
    if (key !== 'apiKey' || value) next[key] = value;
  }
  if (patch.clearApiKey !== undefined && typeof patch.clearApiKey !== 'boolean') {
    throw configError('clearApiKey 必须为布尔值');
  }
  if (patch.clearApiKey === true) next.apiKey = '';
  return next;
}

export function mergeConfig(current, patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw configError('配置必须为对象');
  const next = structuredClone(current);
  if (patch.llm !== undefined) next.llm = mergeConnection(current.llm, patch.llm);
  if (patch.jev !== undefined) {
    if (!patch.jev || typeof patch.jev !== 'object' || Array.isArray(patch.jev)) throw configError('Jev 配置必须为对象');
    if (patch.jev.provider !== undefined) {
      if (!['vercel', 'typesafe'].includes(patch.jev.provider)) throw configError('请选择有效的 Jev 通道');
      next.jev.provider = patch.jev.provider;
    }
    for (const provider of ['vercel', 'typesafe']) {
      if (patch.jev[provider] !== undefined) next.jev[provider] = mergeConnection(current.jev[provider], patch.jev[provider]);
    }
  }
  return next;
}

/** 对浏览器只公开是否已配置，不返回任何原始 API Key。 */
export function publicConfig(config) {
  const expose = ({ name, baseURL, model, apiKey }) => ({
    ...(name !== undefined ? { name } : {}), baseURL, model, apiKeyConfigured: Boolean(apiKey),
  });
  return {
    llm: expose(config.llm),
    jev: { provider: config.jev.provider, vercel: expose(config.jev.vercel), typesafe: expose(config.jev.typesafe) },
  };
}

/**
 * 通用配置仓库。readRaw 在记录不存在时返回 undefined；损坏的数据应抛出错误，避免静默覆盖密钥。
 * cacheReads 适合单进程本地文件；Cloudflare 多 isolate 应关闭缓存，始终读取 KV。
 */
export function createConfigRepository({ readRaw, writeRaw, cacheReads = true }) {
  let cached = null;
  let pendingSave = Promise.resolve();

  async function load() {
    if (cacheReads && cached) return cached;
    const raw = await readRaw();
    cached = normalizeConfig(deepMerge(structuredClone(DEFAULT_CONFIG), raw ?? {}));
    return cached;
  }

  async function readConfig() {
    return structuredClone(await load());
  }

  async function saveConfig(patch) {
    // 串行处理保存，确保同时保存不同字段时不会覆盖彼此的改动。
    const operation = pendingSave.then(async () => {
      const merged = mergeConfig(await readConfig(), patch);
      await writeRaw(merged);
      cached = merged;
      return structuredClone(merged);
    });
    pendingSave = operation.catch(() => {});
    return operation;
  }

  return { readConfig, saveConfig };
}
