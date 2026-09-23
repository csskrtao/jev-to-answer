import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// 只打包独立实验页的 3D 依赖，产物随 public 一起提供，不改变原问答启动方式。
await build({
  absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
  entryPoints: ['preview-src/physics.js'],
  outfile: 'public/random-physics.bundle.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  legalComments: 'linked',
  logLevel: 'info',
});
