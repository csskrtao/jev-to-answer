import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createConfigRepository } from './config.js';

export {
  DEFAULT_CONFIG,
  deepMerge,
  mergeConnection,
  mergeConfig,
  publicConfig,
  normalizeConfig,
  createConfigRepository,
} from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(__dirname, '..', 'data');

/** 路径可注入，离线测试使用临时配置，不触碰用户的真实文件。 */
export function createConfigStore(configPath = join(DATA_DIR, 'config.json')) {
  return createConfigRepository({
    async readRaw() {
      try {
        return JSON.parse(await readFile(configPath, 'utf8'));
      } catch (error) {
        // 损坏的配置不能静默覆盖，避免一次保存意外清空原有凭据。
        if (error.code !== 'ENOENT') throw new Error('本地配置读取失败，请检查 config.json 的格式与权限');
      }
    },
    async writeRaw(merged) {
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, JSON.stringify(merged, null, 2), 'utf8');
    },
  });
}

const store = createConfigStore();
export const readConfig = store.readConfig;
export const saveConfig = store.saveConfig;
