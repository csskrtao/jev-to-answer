import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(__dirname, '..', 'data');

// 默认配置不携带密钥；真实密钥仅保存在本地 data/config.json。
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
function normalizeConfig(cfg) {
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

/** 路径可注入，离线测试使用临时配置，不触碰用户的真实文件。 */
export function createConfigStore(configPath = join(DATA_DIR, 'config.json')) {
  let cached = null;
  let pendingSave = Promise.resolve();
  async function readConfig() {
    if (!cached) {
      let raw;
      try {
        raw = JSON.parse(await readFile(configPath, 'utf8'));
      } catch (error) {
        // 损坏的配置不能静默覆盖，避免一次保存意外清空原有凭据。
        if (error.code !== 'ENOENT') throw new Error('本地配置读取失败，请检查 config.json 的格式与权限');
      }
      cached = normalizeConfig(deepMerge(structuredClone(DEFAULT_CONFIG), raw ?? {}));
    }
    return structuredClone(cached);
  }
  async function saveConfig(patch) {
    // 串行处理保存，确保同时保存不同字段时不会覆盖彼此的改动。
    const operation = pendingSave.then(async () => {
      const merged = mergeConfig(await readConfig(), patch);
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, JSON.stringify(merged, null, 2), 'utf8');
      cached = merged;
      return structuredClone(merged);
    });
    pendingSave = operation.catch(() => {});
    return operation;
  }
  return { readConfig, saveConfig };
}

const store = createConfigStore();
export const readConfig = store.readConfig;
export const saveConfig = store.saveConfig;
