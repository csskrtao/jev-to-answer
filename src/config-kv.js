import { createConfigRepository } from './config.js';

const CONFIG_KEY = 'config';

/** Cloudflare KV 配置存储。多 isolate 下关闭读缓存，避免保存后读到过期密钥。 */
export function createKvConfigStore(namespace, key = CONFIG_KEY) {
  if (!namespace || typeof namespace.get !== 'function' || typeof namespace.put !== 'function') {
    throw new Error('缺少有效的 KV 命名空间');
  }
  return createConfigRepository({
    cacheReads: false,
    async readRaw() {
      const text = await namespace.get(key);
      if (text == null || text === '') return undefined;
      try {
        return JSON.parse(text);
      } catch {
        throw new Error('配置读取失败，请检查 KV 中 config 的格式');
      }
    },
    async writeRaw(merged) {
      await namespace.put(key, JSON.stringify(merged));
    },
  });
}
