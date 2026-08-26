#!/usr/bin/env node
/**
 * 收集 Electron-on-鸿蒙 运行时：从 ../harmonypc-electron copy electron + web_engine 模块
 * （剔除 build/oh_modules/node_modules/.git 等生成目录）。
 *
 * 用法：node scripts/collect-runtime.mjs
 * 前置：
 *   - ../harmonypc-electron 与本工程同级目录（HarmonyPC Electron 工程）
 *   - 原生 SO 库已就位：从华为仓库下载的 v37.2.3 产物（zip → libelectron_138.tar.gz）解压后，
 *     其 ohos_hap/electron/libs/arm64-v8a/ 下有 libelectron.so / libadapter.so / libffmpeg.so，
 *     需先放置到 ../harmonypc-electron/ohos_hap/electron/libs/（仓库默认不含 SO，需下载解压补齐）。
 */
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const harmonyRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const runtimeRoot = resolve(harmonyRoot, '../harmonypc-electron/ohos_hap');

const EXCLUDE_TOP = new Set(['build', 'oh_modules', 'node_modules', '.git', '.hvigor', '.idea', '.codegraph']);

function copyModule(name) {
  const src = resolve(runtimeRoot, name);
  const dest = resolve(harmonyRoot, name);
  if (!existsSync(resolve(src, 'build-profile.json5')) && !existsSync(resolve(src, 'oh-package.json5'))) {
    console.error(`[collect-runtime] 运行时模块缺失: ${src}`);
    process.exit(1);
  }
  cpSync(src, dest, {
    recursive: true,
    force: true,
    filter: (s) => {
      const rel = s.slice(src.length + 1);
      if (rel === '') return true;
      const top = rel.split(/[\\/]/)[0];
      return !EXCLUDE_TOP.has(top);
    },
  });
  console.log(`[collect-runtime] 已 copy 模块 ${name} -> ${dest}`);
}

// 校验原生 SO 库
const soDir = resolve(runtimeRoot, 'electron/libs/arm64-v8a');
const requiredSo = ['libelectron.so', 'libadapter.so', 'libffmpeg.so'];
const missing = requiredSo.filter((n) => !existsSync(resolve(soDir, n)));
if (missing.length > 0) {
  console.error(`[collect-runtime] 缺失原生 SO 库: ${missing.join(', ')}`);
  console.error('  请将下载的 Electron 编译产物（v37.2.3-20260825.1-release.zip → libelectron_138.tar.gz）');
  console.error(`  解压后把 ohos_hap/electron/libs/arm64-v8a/ 下的 .so 放到: ${soDir}`);
  process.exit(1);
}

for (const m of ['electron', 'web_engine']) {
  copyModule(m);
}
console.log('[collect-runtime] 完成：electron + web_engine 模块已就绪');
