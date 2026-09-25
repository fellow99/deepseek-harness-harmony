#!/usr/bin/env node
/**
 * 收集 Electron-on-鸿蒙 运行时（009-runtime-shell 重设计版）。
 *
 * 固定阶段流水线，任一阶段失败即非零退出：
 *   0 清单加载与前置校验：读取子工程 ohos_hap/runtime-manifest.json、DEVECO_SDK_HOME、3 个 .so
 *   1 拷贝运行时：../harmonypc-electron/ohos_hap 的 electron + web_engine（剔除生成物目录）
 *   1b 剪裁本应用不需要的运行时文件：删除 PRUNE_FILES（缺失即硬失败，防上游外壳结构漂移）
 *   2 恢复 App 主进程三件套：src-main/{main.js,renderer-preload.js,package.json}
 *   3 应用 App 定制 overlay：runtime-overlays/ 白名单文件回盖，含 HAR 权限表 + adapter/jsbindings 定制 + locale 资源（缺失即硬失败）
 *   4 bundleName 字面量替换：4 个 adapter 中通用 bundleName → App bundleName（次数断言）
 *   5 清理 system-info demo 残留：resfile/resources/app 保留白名单之外全部删除并显式列出
 *   6 注入 libc++_shared.so（DevEco SDK）
 *   7 一致性守卫：.so 哈希 / 新壳 markers / barrel 导出 / App 身份 / demo 残留 / overlay 命中 / 剪裁 / 前置 overlay 改写
 *
 * 用法：
 *   node scripts/collect-runtime.mjs                 原地更新本工程（默认）
 *   node scripts/collect-runtime.mjs --out <dir>     把流水线结果写到 <dir>（不碰本工程工作树）
 *   node scripts/collect-runtime.mjs --verify-only   仅对目标（默认本工程）执行阶段 7 守卫
 *
 * 前置：
 *   - ../harmonypc-electron 与本工程同级，且已回灌配套 ArkTS 外壳（fellow99/baseline）
 *   - 原生 SO：v37.2.3-20260825.1 发布包解压到子工程 ohos_hap/electron/libs/arm64-v8a/
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------- 参数/路径

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
let OUT_DIR = null;
if (outIdx !== -1) {
  const value = argv[outIdx + 1];
  if (!value || value.startsWith('--')) {
    console.error('[collect-runtime] 错误: --out 需要一个输出目录参数。用法: node scripts/collect-runtime.mjs --out <dir>');
    process.exit(1);
  }
  OUT_DIR = resolve(value);
}
const VERIFY_ONLY = argv.includes('--verify-only');

const harmonyRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const runtimeRoot = resolve(harmonyRoot, '../harmonypc-electron/ohos_hap');
const sdkRoot = process.env.DEVECO_SDK_HOME;
const manifestPath = resolve(runtimeRoot, 'runtime-manifest.json');
/** 流水线产物根：默认本工程；--out 时为指定目录 */
const targetRoot = OUT_DIR ?? harmonyRoot;

const EXCLUDE_TOP = new Set(['build', 'oh_modules', 'node_modules', '.git', '.hvigor', '.idea', '.codegraph']);

/**
 * App 配置 overlay 白名单（相对工程/目标根的镜像路径）。
 * 共 17 个，均为本 App 自身的定制：2 个 module.json5（entry 的 manifest 含后台保活声明）+
 * 1 个 Ability 源码（后台保活申请/释放）+ 2 个主窗口页面（AI 生成内容常驻标识）+ 快捷方式配置 +
 * main_pages（新增 ArkWeb 外部网页页）+ 3 个 adapter/jsbindings/common 定制 +
 * 1 个状态栏图标（electron_white.png，替换为产品 LOGO）+
 * 6 个 locale 资源（electron 3 + web_engine 3；electron 侧承载 OS 桌面显示名 EntryAbility_label）。
 * 全部由阶段 7.6 做源/目标 md5 一致性守卫。
 */
const OVERLAY_FILES = [
  'electron/src/main/module.json5',
  'electron/src/main/ets/entryability/EntryAbility.ets',
  'electron/src/main/ets/pages/Index.ets',
  'electron/src/main/ets/pages/NodeHandleWindow.ets',
  'web_engine/src/main/module.json5',
  'electron/src/main/resources/base/profile/shortcuts_config.json',
  'electron/src/main/resources/base/profile/main_pages.json',
  'electron/src/main/resources/base/element/string.json',
  'electron/src/main/resources/en_US/element/string.json',
  'electron/src/main/resources/zh_CN/element/string.json',
  'web_engine/src/main/ets/adapter/MediaAdapter.ets',
  'web_engine/src/main/ets/common/CommandLineAdapter.ets',
  'web_engine/src/main/ets/jsbindings/JsBindingMethod.ets',
  'web_engine/src/main/resources/base/element/string.json',
  'web_engine/src/main/resources/en_US/element/string.json',
  'web_engine/src/main/resources/zh_CN/element/string.json',
  'web_engine/src/main/resources/resfile/resources/app/electron_white.png',
];

/**
 * 回盖时机早于阶段 4（bundleName 字面量替换）的 overlay：
 * 这份副本必须保留「通用」bundleName（manifest.bundleNameRewrite.from），
 * 由阶段 4 再替换成 App bundleName，因此**不能**纳入阶段 7.6 的 md5 一致性守卫
 * （回盖后目标文件会被阶段 4 改写，源与目标必然不同）。其正确性由阶段 7.4
 * （4 个 adapter 已无通用字面量残留）保障。
 */
const OVERLAY_PRE_REWRITE_FILES = [
  'web_engine/src/main/ets/adapter/PermissionManagerAdapter.ets',
];

/**
 * 上游**不存在**、由本 App 新增的文件（相对目标根的镜像路径）。
 * 与 OVERLAY_FILES 的区别：目标文件由本次拷贝创建，因此不检查其是否已存在。
 * 全部由阶段 7.10 守卫其落地，并同样纳入 7.6 的 md5 一致性检查。
 */
const OVERLAY_ADD_FILES = [
  'web_engine/src/main/ets/adapter/ImageAdapter.ets',
  'web_engine/src/main/ets/jsbindings/ImageAdapterBind.ets',
  'web_engine/src/main/ets/adapter/TrayAdapter.ets',
  'web_engine/src/main/ets/jsbindings/TrayAdapterBind.ets',
  'electron/src/main/ets/pages/ExternalWeb.ets',
];

/**
 * 本应用不需要、必须在拷贝后删除的运行时文件。
 * 删除前断言其存在：缺失说明上游外壳结构已变化，必须重新评估（不得静默跳过）。
 */
const PRUNE_FILES = [
  'web_engine/src/main/ets/adapter/BluetoothAdapter.ets',
  'web_engine/src/main/ets/adapter/BluetoothLowEnergyAdapter.ets',
  'web_engine/src/main/ets/jsbindings/BluetoothAdapterBind.ets',
  'web_engine/src/main/ets/jsbindings/BluetoothLowEnergyAdapterBind.ets',
];

/** resfile/resources/app 保留白名单（dsh-dist.tar.gz 在 collect-dsh 之后才存在，缺失允许） */
const APP_KEEP = new Set(['main.js', 'market-runtime.js', 'renderer-preload.js', 'package.json', 'electron_white.png', 'dsh-dist.tar.gz', 'skills']);

const APP_RESFILE_DIR = 'web_engine/src/main/resources/resfile/resources/app';

// ---------------------------------------------------------------- 工具

function fail(msg) {
  console.error(`[collect-runtime] 错误: ${msg}`);
  process.exit(1);
}

function log(stage, msg) {
  console.log(`[collect-runtime][${stage}] ${msg}`);
}

function md5File(p) {
  return createHash('md5').update(readFileSync(p)).digest('hex').toUpperCase();
}

function readText(p) {
  return readFileSync(p, 'utf8');
}

function stageBanner(n, name) {
  console.log(`[collect-runtime] ---- 阶段 ${n}: ${name} ----`);
}

// ---------------------------------------------------------------- 阶段 0

function stage0Load() {
  stageBanner(0, '清单加载与前置校验');
  if (!existsSync(manifestPath)) {
    fail(`运行时清单缺失: ${manifestPath}\n  请确认 ../harmonypc-electron 已切换到含 runtime-manifest.json 的 fellow99/baseline 回灌提交。`);
  }
  let manifest;
  try {
    manifest = JSON.parse(readText(manifestPath));
  } catch (e) {
    fail(`运行时清单不是合法 JSON: ${manifestPath} (${e.message})`);
  }
  validateManifest(manifest);
  log(0, `清单 shellVersion=${manifest.shellVersion} binaryVersion=${manifest.binaryVersion}`);

  for (const so of manifest.so) {
    const p = resolve(runtimeRoot, so.path);
    if (!existsSync(p)) fail(`原生 SO 缺失: ${p}\n  请将 ${manifest.binaryVersion} 发布包对应 .so 放到子工程 ohos_hap/electron/libs/arm64-v8a/。`);
  }

  if (!VERIFY_ONLY && !sdkRoot) {
    fail('DEVECO_SDK_HOME 未设置，无法注入 libc++_shared.so');
  }
  return manifest;
}

/**
 * 清单结构强校验：缺任一必需段都硬失败，避免守卫循环因空数组而空转（exit 0）。
 */
function validateManifest(m) {
  const problems = [];
  const needString = (key) => {
    if (typeof m[key] !== 'string' || m[key].length === 0) problems.push(`缺少字符串字段 ${key}`);
  };
  const needNonEmptyArray = (key, itemCheck) => {
    if (!Array.isArray(m[key]) || m[key].length === 0) {
      problems.push(`缺少非空数组字段 ${key}`);
      return;
    }
    m[key].forEach((it, i) => itemCheck?.(it, `${key}[${i}]`));
  };
  needString('shellVersion');
  needString('binaryVersion');
  needString('genericBundleName');
  needNonEmptyArray('so', (it, where) => {
    if (typeof it.path !== 'string' || !it.path) problems.push(`${where}.path 缺失`);
    if (typeof it.md5 !== 'string' || !/^[0-9a-fA-F]{32}$/.test(it.md5 ?? '')) problems.push(`${where}.md5 必须是 32 位十六进制`);
  });
  needNonEmptyArray('shellMarkers', (it, where) => {
    if (typeof it.symbol !== 'string' || !it.symbol) problems.push(`${where}.symbol 缺失`);
    if (typeof it.file !== 'string' || !it.file) problems.push(`${where}.file 缺失`);
  });
  needString('barrelFile');
  needNonEmptyArray('barrelExports');
  const rw = m.bundleNameRewrite;
  if (!rw || typeof rw !== 'object') {
    problems.push('缺少对象字段 bundleNameRewrite');
  } else {
    if (typeof rw.from !== 'string' || !rw.from) problems.push('bundleNameRewrite.from 缺失');
    if (!Array.isArray(rw.adapters) || rw.adapters.length === 0) problems.push('bundleNameRewrite.adapters 必须是非空数组');
    if (typeof rw.expectedHitsPerFile !== 'number') problems.push('bundleNameRewrite.expectedHitsPerFile 必须是数字');
  }
  if (!m.libcxx || typeof m.libcxx.path !== 'string' || !m.libcxx.path) {
    problems.push('libcxx.path 缺失');
  }
  if (problems.length > 0) {
    fail(`运行时清单结构不完整（守卫不得空转）:\n  - ${problems.join('\n  - ')}\n  清单: ${manifestPath}`);
  }
}

// ---------------------------------------------------------------- 阶段 1

function copyModule(name) {
  const src = resolve(runtimeRoot, name);
  const dest = resolve(targetRoot, name);
  if (!existsSync(resolve(src, 'build-profile.json5')) && !existsSync(resolve(src, 'oh-package.json5'))) {
    fail(`运行时模块缺失: ${src}`);
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
  log(1, `已 copy 模块 ${name} -> ${dest}`);
}

function stage1CopyRuntime() {
  stageBanner(1, '拷贝运行时 electron + web_engine');
  if (OUT_DIR) mkdirSync(targetRoot, { recursive: true });
  for (const m of ['electron', 'web_engine']) copyModule(m);
}

// ---------------------------------------------------------------- 阶段 1b

function stage1bPruneRuntime() {
  stageBanner('1b', '剪裁本应用不需要的运行时文件');
  for (const rel of PRUNE_FILES) {
    const p = resolve(targetRoot, rel);
    if (!existsSync(p)) {
      fail(`待剪裁文件缺失（上游外壳结构可能已变化）: ${p}\n  请重新评估 PRUNE_FILES 是否仍然需要。`);
    }
    rmSync(p, { force: true });
    log('1b', `已删除 ${rel}`);
  }
}

// ---------------------------------------------------------------- 阶段 2

function restoreOne(srcRel, destRel, label) {
  const src = resolve(harmonyRoot, srcRel);
  const dest = resolve(targetRoot, destRel);
  if (!existsSync(src)) fail(`本工程 ${label} 缺失: ${src}`);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { force: true });
  log(2, `已恢复 ${label} -> ${relative(harmonyRoot, dest) || dest}`);
}

function restoreTree(srcRel, destRel, label) {
  const src = resolve(harmonyRoot, srcRel);
  const dest = resolve(targetRoot, destRel);
  if (!existsSync(src)) fail(`本工程 ${label} 缺失: ${src}`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true, force: true });
  log(2, `已恢复 ${label} -> ${relative(harmonyRoot, dest) || dest}`);
}

function stage2RestoreAppTriple() {
  stageBanner(2, '恢复 App 主进程文件（main.js / market-runtime.js / renderer-preload.js / package.json）+ 附带技能');
  restoreOne('src-main/main.js', `${APP_RESFILE_DIR}/main.js`, 'main.js');
  // 011-runtime-provisioning：市场运行时引导（main.js 在启动期 require('./market-runtime.js')）。
  // 新增的 src-main 文件**必须**在此登记，否则不会进 HAP，设备上 require 失败即主进程崩溃。
  restoreOne('src-main/market-runtime.js', `${APP_RESFILE_DIR}/market-runtime.js`, 'market-runtime.js');
  restoreOne('src-main/renderer-preload.js', `${APP_RESFILE_DIR}/renderer-preload.js`, 'renderer-preload.js');
  restoreOne('src-main/package.json', `${APP_RESFILE_DIR}/package.json`, 'app package.json');
  restoreTree('skills', `${APP_RESFILE_DIR}/skills`, 'skills 技能目录');
}

// ---------------------------------------------------------------- 阶段 3

function stage3ApplyOverlays() {
  stageBanner(3, '应用 App 配置 overlay');
  for (const rel of [...OVERLAY_FILES, ...OVERLAY_PRE_REWRITE_FILES]) {
    const src = resolve(harmonyRoot, 'runtime-overlays', rel);
    const dest = resolve(targetRoot, rel);
    if (!existsSync(src)) fail(`overlay 源缺失（App 定制丢失）: ${src}`);
    if (!existsSync(dest)) fail(`overlay 目标缺失（外壳结构可能已升级）: ${dest}`);
    cpSync(src, dest, { force: true });
    log(3, `回盖 ${rel}`);
  }
  // 新增文件：上游没有该文件，因此不检查目标是否存在；由阶段 7.10 守卫其落地。
  for (const rel of OVERLAY_ADD_FILES) {
    const src = resolve(harmonyRoot, 'runtime-overlays', rel);
    const dest = resolve(targetRoot, rel);
    if (!existsSync(src)) fail(`新增 overlay 源缺失（App 定制丢失）: ${src}`);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { force: true });
    log(3, `新增 ${rel}`);
  }
}

// ---------------------------------------------------------------- 阶段 4

function stage4RewriteBundleName(manifest) {
  stageBanner(4, 'bundleName 字面量替换');
  const from = manifest.bundleNameRewrite?.from;
  const expected = manifest.bundleNameRewrite?.expectedHitsPerFile ?? 1;
  const adapters = manifest.bundleNameRewrite?.adapters;
  if (!from || !Array.isArray(adapters)) fail('清单缺少 bundleNameRewrite.from/adapters 配置');
  // App bundleName 以 AppScope 事实源为准
  const appBundleName = readAppBundleName();

  for (const rel of adapters) {
    const p = resolve(targetRoot, rel);
    if (!existsSync(p)) fail(`adapter 缺失（外壳结构可能已升级）: ${p}`);
    const original = readText(p);
    const hits = original.split(from).length - 1;
    if (hits !== expected) {
      fail(
        `${rel} 中通用字面量 "${from}" 命中 ${hits} 次，预期 ${expected} 次。\n` +
        '  外壳升级后必须重新评估 App bundleName 定制（见 docs/2026-09-09-runtime-shell-backport-design.md §5.3）。',
      );
    }
    const rewritten = original.split(from).join(appBundleName);
    if (rewritten.includes(from)) fail(`${rel} 替换后仍残留通用字面量 "${from}"`);
    if ((rewritten.split(appBundleName).length - 1) !== expected) fail(`${rel} 替换后 App bundleName 次数异常`);
    writeFileSync(p, rewritten);
    log(4, `${rel.split('/').pop()}: ${from} -> ${appBundleName}（${hits} 处）`);
  }
}

// ---------------------------------------------------------------- 阶段 5

function stage5PurgeDemo() {
  stageBanner(5, '清理 system-info demo 残留');
  const dir = resolve(targetRoot, APP_RESFILE_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    log(5, 'resfile/resources/app 目录原本不存在，已创建（三件套已恢复）');
    return;
  }
  for (const entry of readdirSync(dir)) {
    if (APP_KEEP.has(entry)) continue;
    const p = join(dir, entry);
    rmSync(p, { recursive: true, force: true });
    log(5, `清理非本应用文件: ${entry}`);
  }
}

// ---------------------------------------------------------------- 阶段 6

function stage6InjectLibcxx(manifest) {
  stageBanner(6, '注入 libc++_shared.so');
  const libcxx = resolve(sdkRoot, 'default/openharmony/native/llvm/lib/aarch64-linux-ohos/libc++_shared.so');
  if (!existsSync(libcxx)) fail(`SDK libc++_shared.so 缺失: ${libcxx}`);
  const dest = resolve(targetRoot, manifest.libcxx?.path ?? 'electron/libs/arm64-v8a/libc++_shared.so');
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(libcxx, dest, { force: true });
  log(6, `已 copy libc++_shared.so -> ${relative(targetRoot, dest)}`);
}

// ---------------------------------------------------------------- 阶段 7

function readAppBundleName() {
  const appScope = resolve(harmonyRoot, 'AppScope/app.json5');
  if (!existsSync(appScope)) fail(`AppScope/app.json5 缺失: ${appScope}`);
  const m = readText(appScope).match(/"bundleName"\s*:\s*"([^"]+)"/);
  if (!m) fail(`无法从 AppScope/app.json5 解析 bundleName`);
  return m[1];
}

function stage7Guards(manifest) {
  stageBanner(7, '壳/二进制一致性守卫');
  let failed = 0;
  const guard = (cond, msg) => {
    if (cond) {
      log(7, `PASS ${msg}`);
    } else {
      console.error(`[collect-runtime][7] FAIL ${msg}`);
      failed += 1;
    }
  };

  // 7.1 二进制存在与哈希
  for (const so of manifest.so ?? []) {
    const p = resolve(targetRoot, so.path);
    if (existsSync(p)) {
      const h = md5File(p);
      guard(h === (so.md5 ?? '').toUpperCase(), `SO 哈希 ${so.path} (${h})`);
    } else {
      guard(false, `SO 存在 ${so.path}`);
    }
  }

  // 7.2 新壳标记
  for (const mk of manifest.shellMarkers ?? []) {
    const p = resolve(targetRoot, mk.file);
    const ok = existsSync(p) && readText(p).includes(mk.symbol);
    guard(ok, `新壳标记 ${mk.symbol} @ ${mk.file}`);
  }

  // 7.3 barrel 导出
  const barrelPath = resolve(targetRoot, manifest.barrelFile ?? 'web_engine/Index.ets');
  if (existsSync(barrelPath)) {
    const barrel = readText(barrelPath);
    for (const e of manifest.barrelExports ?? []) guard(barrel.includes(e), `barrel 导出 ${e}`);
  } else {
    guard(false, `barrel 存在 ${manifest.barrelFile}`);
  }

  // 7.4 App 身份：AppScope bundleName + 4 adapter 无通用字面量残留
  const appBundleName = readAppBundleName();
  const expectedBundle = 'org.fellow99.dsh.DshDesktop';
  guard(appBundleName === expectedBundle, `AppScope bundleName = ${appBundleName}`);
  const generic = manifest.bundleNameRewrite?.from ?? 'com.huawei.ohos_electron';
  for (const rel of manifest.bundleNameRewrite?.adapters ?? []) {
    const p = resolve(targetRoot, rel);
    const ok = existsSync(p) && !readText(p).includes(generic);
    guard(ok, `adapter 无通用字面量残留 ${rel.split('/').pop()}`);
  }

  // 7.5 demo 残留
  const dir = resolve(targetRoot, APP_RESFILE_DIR);
  const leftovers = existsSync(dir) ? readdirSync(dir).filter((e) => !APP_KEEP.has(e)) : [];
  guard(leftovers.length === 0, `resfile/app 无 demo 残留${leftovers.length ? `（发现: ${leftovers.join(', ')}）` : ''}`);

  // 7.6 overlay 命中
  for (const rel of OVERLAY_FILES) {
    const src = resolve(harmonyRoot, 'runtime-overlays', rel);
    const dest = resolve(targetRoot, rel);
    const ok = existsSync(src) && existsSync(dest) && md5File(src) === md5File(dest);
    guard(ok, `overlay 命中 ${rel}`);
  }

  // 7.8 App 剪裁：不需要的运行时文件必须不存在
  for (const rel of PRUNE_FILES) {
    guard(!existsSync(resolve(targetRoot, rel)), `已剪裁 ${rel}`);
  }

  // 7.9 阶段 4 前置 overlay：源保留通用字面量、目标已改写为 App bundleName
  const genericLiteral = manifest.bundleNameRewrite?.from ?? 'com.huawei.ohos_electron';
  const appBundle = readAppBundleName();
  for (const rel of OVERLAY_PRE_REWRITE_FILES) {
    const src = resolve(harmonyRoot, 'runtime-overlays', rel);
    const dest = resolve(targetRoot, rel);
    guard(existsSync(src) && readText(src).includes(genericLiteral), `overlay 源保留通用字面量 ${rel.split('/').pop()}`);
    guard(existsSync(dest) && !readText(dest).includes(genericLiteral), `目标已无通用字面量 ${rel.split('/').pop()}`);
    guard(existsSync(dest) && readText(dest).includes(appBundle), `目标含 App bundleName ${rel.split('/').pop()}`);
  }

  // 7.7 libc++ 注入哈希（若清单记录）
  if (manifest.libcxx?.md5) {
    const p = resolve(targetRoot, manifest.libcxx.path);
    guard(existsSync(p) && md5File(p) === manifest.libcxx.md5.toUpperCase(), `libc++_shared.so 哈希 (${manifest.libcxx.source ?? 'SDK'})`);
  }

  // 7.10 新增 overlay：上游没有这些文件，必须由阶段 3 创建且与源一致
  for (const rel of OVERLAY_ADD_FILES) {
    const src = resolve(harmonyRoot, 'runtime-overlays', rel);
    const dest = resolve(targetRoot, rel);
    const ok = existsSync(src) && existsSync(dest) && md5File(src) === md5File(dest);
    guard(ok, `新增 overlay 落地 ${rel}`);
  }

  if (failed > 0) fail(`一致性守卫 ${failed} 项未通过，已中止（旧壳/错 SO/demo 污染/定制丢失风险）。`);
  log(7, '全部守卫通过');
}

// ---------------------------------------------------------------- main

function main() {
  const manifest = stage0Load();
  if (!VERIFY_ONLY) {
    stage1CopyRuntime();
    stage1bPruneRuntime();
    stage2RestoreAppTriple();
    stage3ApplyOverlays();
    stage4RewriteBundleName(manifest);
    stage5PurgeDemo();
    stage6InjectLibcxx(manifest);
  }
  stage7Guards(manifest);
  console.log(
    `[collect-runtime] 完成：electron + web_engine 已就绪（目标: ${targetRoot}${VERIFY_ONLY ? '，仅守卫' : ''}）`,
  );
}

main();
