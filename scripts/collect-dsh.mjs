#!/usr/bin/env node
/**
 * 收集 dsh 部署产物：pnpm deploy 物化依赖闭包 → 物化 Junction → 补全 @deepseek-ai 包
 * 与非 hoisted 依赖 → 复制 web dist → 写 sharp 纯 JS stub。
 *
 * 产出 dsh-dist/（真实文件、无 Junction、无 .pnpm），随后由 tar 压成 dsh-dist.tar.gz 打入 resfile。
 * 前置：dsh 已构建（node scripts/build-dsh.mjs）。本脚本只依赖同级 ../deepseek-harness 与
 * ../dsh-market，与 deepseek-harness-desktop 无关。
 *
 * 背景：pnpm deploy --legacy 物化的 node_modules 是「链接结构」（外部依赖为 Junction 指向
 * .pnpm store），打包分发后指向失效，故需物化为真实文件。且 deploy 不物化：① peerDependencies
 * （如 cordis-plugin-group、大量 packages 下插件）；② 非 hoisted 的外部依赖（如 zod）。
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dshRoot = resolve(projectRoot, '../deepseek-harness');
const distDir = resolve(projectRoot, 'dsh-dist');
const betterSqliteArchive = resolve(projectRoot, '../harmonypc-electron-versions/better-sqlite3编译指导（Electron37）/better-sqlite3-ohos-v138.tar.gz');

function run(cmd, cwd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

/** 递归物化目录下的 Junction 为真实文件（跳过 .bin 与 .pnpm）。 */
function materializeJunctions(dir, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.name === '.bin' || entry.name === '.pnpm') continue;
    let st;
    try {
      st = lstatSync(fullPath);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      try {
        const target = realpathSync(fullPath);
        rmSync(fullPath, { recursive: true, force: true });
        cpSync(target, fullPath, { recursive: true, dereference: true });
      } catch (err) {
        console.warn(`[collect-dsh] 物化失败 ${fullPath}: ${err.message}`);
      }
    } else if (st.isDirectory()) {
      materializeJunctions(fullPath, depth + 1);
    }
  }
}

/** 复制单个 @deepseek-ai 包（lib + package.json + cordis.patch.yml 等，排除 node_modules）。 */
function copyPackage(pkgDir, destRoot) {
  const pkgJson = resolve(pkgDir, 'package.json');
  if (!existsSync(pkgJson)) return;
  let name;
  try {
    name = JSON.parse(readFileSync(pkgJson, 'utf8')).name;
  } catch {
    return;
  }
  if (!name || !name.startsWith('@deepseek-ai/')) return;
  const shortName = name.slice('@deepseek-ai/'.length);
  const dest = resolve(destRoot, shortName);
  if (existsSync(dest)) return; // 已物化
  cpSync(pkgDir, dest, {
    recursive: true,
    dereference: true,
    // 排除 node_modules：嵌套依赖是 Junction 指向其它包，递归物化会循环；扁平结构里已有
    filter: (src) => !src.includes('node_modules'),
  });
  console.log(`[collect-dsh] 物化 @deepseek-ai/${shortName}`);
}

/** 递归复制 dshmarket 的运行时依赖（dependencies 字段 + 传递依赖）到物化目录，@deepseek-ai scope 从宿主解析。 */
function copyMarketRuntimeDeps(srcNm, destNm, marketRoot) {
  let queue = [];
  try {
    queue = Object.keys(JSON.parse(readFileSync(resolve(marketRoot, 'package.json'), 'utf8')).dependencies ?? {});
  } catch {
    return;
  }
  const seen = new Set();
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name) || name.startsWith('@deepseek-ai/')) continue;
    seen.add(name);
    const srcPkg = resolve(srcNm, name);
    const destPkg = resolve(destNm, name);
    if (!existsSync(resolve(srcPkg, 'package.json')) || existsSync(resolve(destPkg, 'package.json'))) continue;
    cpSync(srcPkg, destPkg, { recursive: true, dereference: true });
    try {
      const deps = JSON.parse(readFileSync(resolve(srcPkg, 'package.json'), 'utf8')).dependencies ?? {};
      for (const dep of Object.keys(deps)) queue.push(dep);
    } catch {
      // 跳过无法解析的传递依赖
    }
  }
}

/** 物化 dsh-market（插件市场，非 scoped 包）到 dsh-dist/node_modules/dshmarket。
 *  复制 package.json + cordis.patch.yml + lib/ + client/ + 运行时依赖（undici/js-yaml 等），
 *  排除源码/测试/devDeps；@deepseek-ai 依赖从宿主 dsh-dist 解析。 */
function collectDshMarket() {
  const marketRoot = resolve(projectRoot, '../dsh-market');
  const dest = resolve(distDir, 'node_modules/dshmarket');
  if (!existsSync(resolve(marketRoot, 'package.json'))) {
    console.error(`[collect-dsh] dsh-market 未找到（打包必需，先构建 ../dsh-market）: ${marketRoot}`);
    process.exit(1);
  }
  if (existsSync(resolve(dest, 'package.json'))) {
    console.log('[collect-dsh] dshmarket 已物化');
    return;
  }
  cpSync(marketRoot, dest, {
    recursive: true,
    dereference: true,
    filter: (src) => {
      const rel = src.slice(marketRoot.length + 1);
      if (rel === '') return true;
      const top = rel.split(/[\\/]/)[0];
      return top === 'package.json' || top === 'cordis.patch.yml' || top === 'lib' || top === 'client';
    },
  });
  // 复制运行时依赖（dshmarket 的 dependencies，如 undici/js-yaml）
  const srcNm = resolve(marketRoot, 'node_modules');
  if (existsSync(srcNm)) {
    copyMarketRuntimeDeps(srcNm, resolve(dest, 'node_modules'), marketRoot);
  }
  console.log('[collect-dsh] 物化 dshmarket（lib/client/cordis.patch.yml/package.json + 运行时依赖）');
}

/** 物化本工程 plugins/ 下的专用插件到 dsh-dist/node_modules/<包名>。
 *  约定：本工程专用插件统一放在 `<projectRoot>/plugins/`，目录名与包名同为 `harmony-plugin-XXX`
 *  （XXX 描述功能）；通用可插拔插件放父工程 `../dsh-plugins/`，命名 `dsh-plugin-XXX`，不由本脚本处理。
 *  本函数按 `harmony-plugin-*` 通配自动发现，落地目录名一律取自各插件 package.json 的 `name`
 *  （而非目录名），因此以后新增插件无需改动本脚本。
 *  与 dshmarket 同策略：非 scoped 包直接落在 node_modules 顶层，agent preset 行按包名挂载即可解析。
 *  硬失败：plugins 存在、但匹配到的插件缺 package.json / JSON 非法 / 包名不符约定（同时防 `../` 逃逸）。
 *  无 op：plugins 缺失或无 harmony-plugin-* 目录时只打印一行日志。幂等：目标已有 package.json 即跳过。 */
function collectPlugins() {
  const pluginsRoot = resolve(projectRoot, 'plugins');
  if (!existsSync(pluginsRoot)) {
    console.log(`[collect-dsh] plugins 目录不存在，跳过插件物化: ${pluginsRoot}`);
    return;
  }
  const pluginDirs = readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('harmony-plugin-'))
    .map((entry) => entry.name)
    .sort();
  if (pluginDirs.length === 0) {
    console.log('[collect-dsh] plugins 下没有 harmony-plugin-* 目录，跳过插件物化');
    return;
  }
  for (const dirName of pluginDirs) {
    const src = resolve(pluginsRoot, dirName);
    const pkgJson = resolve(src, 'package.json');
    if (!existsSync(pkgJson)) {
      console.error(`[collect-dsh] 插件 ${dirName} 缺少 package.json（约定 harmony-plugin-XXX 必须是可发布的包）: ${pkgJson}`);
      process.exit(1);
    }
    let name;
    try {
      name = JSON.parse(readFileSync(pkgJson, 'utf8')).name;
    } catch (err) {
      console.error(`[collect-dsh] 插件 ${dirName} 的 package.json 无法解析: ${err.message}`);
      process.exit(1);
    }
    // 包名即落地目录名：只接受裸包名 harmony-plugin-*，既落实命名约定，也杜绝 `../` 逃逸出 node_modules
    if (typeof name !== 'string' || !/^harmony-plugin-[A-Za-z0-9._-]+$/.test(name)) {
      console.error(`[collect-dsh] 插件 ${dirName} 的包名不符合 harmony-plugin-* 约定: ${JSON.stringify(name)}`);
      process.exit(1);
    }
    const dest = resolve(distDir, 'node_modules', name);
    if (existsSync(resolve(dest, 'package.json'))) {
      console.log(`[collect-dsh] 插件 ${name} 已物化`);
      continue;
    }
    // 排除 node_modules：插件的运行时依赖由宿主 dsh-dist 解析（与 copyPackage 同策略），
    // 避免把 pnpm junction 递归展开成巨型目录。
    cpSync(src, dest, {
      recursive: true,
      dereference: true,
      filter: (s) => !s.includes('node_modules'),
    });
    console.log(`[collect-dsh] 物化插件 ${name} <- plugins/${dirName}`);
  }
}

/** 补全所有 @deepseek-ai 包（packages、vendor、apps 下），覆盖 peer 依赖与 link: override。 */
function collectWorkspacePackages() {
  const destRoot = resolve(distDir, 'node_modules/@deepseek-ai');
  for (const root of ['packages', 'vendor', 'apps']) {
    const rootDir = resolve(dshRoot, root);
    if (!existsSync(rootDir)) continue;
    for (const cat of readdirSync(rootDir)) {
      const catDir = resolve(rootDir, cat);
      if (!existsSync(catDir)) continue;
      if (existsSync(resolve(catDir, 'package.json'))) {
        copyPackage(catDir, destRoot); // 一级（vendor/*、apps/*）
      } else {
        try {
          for (const pkg of readdirSync(catDir)) {
            copyPackage(resolve(catDir, pkg), destRoot); // 两级（packages/*/*）
          }
        } catch {
          // 非目录，跳过
        }
      }
    }
  }
}

/** 物化非 hoisted 的外部依赖到顶层 node_modules。
 *  从每个 .pnpm entry 的 node_modules 子目录提取真实包名（entry 名可能是截断+hash，
 *  如 @opentelemetry+exporter-log_8841...，真实包名在 node_modules/@opentelemetry/exporter-logs-otlp-http）。 */
function collectNonHoistedDeps() {
  const pnpmDir = resolve(distDir, 'node_modules/.pnpm');
  const topDir = resolve(distDir, 'node_modules');
  if (!existsSync(pnpmDir)) return;
  const seen = new Set();
  const materialize = (entry, pkgName) => {
    if (seen.has(pkgName)) return;
    seen.add(pkgName);
    const dest = resolve(topDir, ...pkgName.split('/'));
    if (existsSync(dest)) return; // 已 hoisted 或已物化
    const nested = resolve(pnpmDir, entry, 'node_modules', ...pkgName.split('/'));
    if (!existsSync(nested)) return;
    cpSync(nested, dest, { recursive: true, dereference: true });
    console.log(`[collect-dsh] 物化非 hoisted 依赖 ${pkgName}`);
  };
  for (const entry of readdirSync(pnpmDir)) {
    const entryNodeModules = resolve(pnpmDir, entry, 'node_modules');
    if (!existsSync(entryNodeModules)) continue;
    for (const scopeOrName of readdirSync(entryNodeModules)) {
      const full = resolve(entryNodeModules, scopeOrName);
      let st;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      if (scopeOrName.startsWith('@')) {
        for (const name of readdirSync(full)) {
          materialize(entry, `${scopeOrName}/${name}`);
        }
      } else {
        materialize(entry, scopeOrName);
      }
    }
  }
}

/** 递归清理原生模块中非目标平台的 prebuilds（如 node-pty 的 linux-arm64/win32-x64 等），
 *  避免 rpmbuild 的 brp-strip 遇到非目标架构 .node 报错，并减小包体积。 */
function pruneForeignPrebuilds(dir, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const target = `${process.platform}-${process.arch}`;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = join(dir, entry.name);
    if (entry.name === 'prebuilds') {
      for (const sub of readdirSync(fullPath)) {
        const subPath = resolve(fullPath, sub);
        let st;
        try {
          st = lstatSync(subPath);
        } catch {
          continue;
        }
        if (!st.isDirectory()) continue;
        if (sub !== target) {
          rmSync(subPath, { recursive: true, force: true });
          console.log(`[collect-dsh] 清理非目标架构 prebuilds: ${sub}`);
        }
      }
    } else {
      pruneForeignPrebuilds(fullPath, depth + 1);
    }
  }
}

/** 用纯 JS stub 替换 sharp 原生模块入口（libvips 在鸿蒙 aarch64 不可用，见 docs/工程规划.md §18.3）。 */
function applySharpStub() {
  const sharpDist = resolve(distDir, 'node_modules/sharp/dist');
  if (!existsSync(resolve(sharpDist, 'index.mjs')) || !existsSync(resolve(sharpDist, 'index.cjs'))) {
    console.warn('[collect-dsh] sharp 未找到，跳过 stub');
    return;
  }
  const header = '/*!\n * Pure-JS sharp stub for HarmonyOS aarch64 (libvips unavailable).\n * See docs/工程规划.md §18.3.\n */\n';
  const body = `function sharp(_input, _options) {
  const toBuffer = async () => Buffer.alloc(0);
  const raw = () => ({ toBuffer });
  const chain = {
    metadata: async () => ({ format: 'png', width: 1, height: 1 }),
    raw,
    toBuffer,
    toFile: async () => undefined,
    stats: async () => ({ channels: 3 }),
    info: async () => ({ format: 'png', width: 1, height: 1 }),
  };
  return new Proxy(chain, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => chain;
    },
  });
}
`;
  const esm = `${header}${body}sharp.default = sharp;\nexport default sharp;\n`;
  const cjs = `${header}'use strict';\n\n${body}module.exports = sharp;\n`;
  writeFileSync(resolve(sharpDist, 'index.mjs'), esm);
  writeFileSync(resolve(sharpDist, 'index.cjs'), cjs);
  console.log('[collect-dsh] sharp 纯 JS stub 已写入 node_modules/sharp/dist');
}

/**
 * HarmonyOS: 适配 agent preset —— 禁用依赖 shell/subprocess/pty（node-pty 等原生模块，MVP 已禁用）
 * 的工具行，并补齐本应用需要的行。
 *
 * 背景：agent preset（<agent-presets 包>/presets/<id>/agent.cordis.yml）由 cordis Include 在会话创建时
 * 直接组合成独立 EntryTree（见 dsh packages/preset/agent-presets/src/mount.ts），host 的
 * cordis.patch.yml 只覆盖 host-plane 行、管不到 agent-plane；这些工具行会无限等待被禁用的
 * shell/subprocess 服务，mount 的 inactiveRows 审计报 "waiting for shell/subprocess"，preset 挂载
 * 失败 → session.create 抛 agent-preset-invalid → 工作区无法选中、点聊天区反复弹「选择工作区」。
 * inactiveRows 会跳过 disabled: true 的行，故禁用后 preset 可正常挂载（终端/内容搜索能力按
 * §18.3 取舍，文件读写 tool-fs 等不依赖子进程的工具保留）。
 */
const HARMONY_DISABLED_PRESET_ROWS = {
  'tool-bash': '依赖 shell 服务（bash 终端，node-pty 子进程，MVP 已禁用）',
  'tool-fs-search': '依赖 subprocess 跑 ripgrep 内容搜索（node-pty 已禁用）',
  'persistent-shell': '依赖 pty 终端服务（node-pty 已禁用）',
};

/**
 * 补齐 preset 中本应用需要、但上游 preset 未挂载的工具行（顶层追加）。
 * 与 src-main/main.js 的 HARMONY_ENSURED_PRESET_ROWS 保持一致：`tool-str-replace-editor` 是纯 JS
 * 工具（inject ['tools','fs']，无 subprocess/原生依赖），其 `view` 对目录经 ctx.fs.listDir 列目录 ——
 * 在 tool-fs-search 被禁用后这是唯一可用的列目录入口。`requireRow` 限定只加到已挂载该行的 preset。
 *
 * `fs-mutate`（harmony-plugin-fs-mutate）是本工程专用插件，由 collectPlugins() 从本工程 plugins/
 * 物化到 dsh-dist/node_modules，故 name 为裸包名；它经围栏原语 ctx.fs.remove 补齐 delete / move。
 */
const HARMONY_ENSURED_PRESET_ROWS = [
  {
    id: 'tool-str-replace-editor',
    name: '@deepseek-ai/dsh-tool-str-replace-editor',
    requireRow: 'tool-fs',
    reason: 'HarmonyOS: 补齐列目录（view）与文件编辑，替代依赖 subprocess 的 tool-fs-search',
  },
  {
    id: 'fs-mutate',
    name: 'harmony-plugin-fs-mutate',
    requireRow: 'tool-fs',
    reason: 'HarmonyOS: 经围栏原语 ctx.fs.remove 补齐 delete / move（纯 JS，本工程 plugins 物化）',
  },
];

const TOP_ROW_RE = /^- id: ([A-Za-z0-9_-]+)\s*$/;
const HARMONY_MARKER = '# HarmonyOS:';

/** preset 顶层（列 0）是否已有该 id 的行；group 内 4 空格缩进的嵌套行不算。 */
function hasTopLevelRow(lines, id) {
  for (const line of lines) {
    const m = TOP_ROW_RE.exec(line);
    if (m !== null && m[1] === id) return true;
  }
  return false;
}

/** 按 HARMONY_ENSURED_PRESET_ROWS 追加缺失的顶层行；返回追加数。 */
function ensurePresetRows(out) {
  let ensured = 0;
  for (const spec of HARMONY_ENSURED_PRESET_ROWS) {
    if (spec.requireRow !== undefined && !hasTopLevelRow(out, spec.requireRow)) continue;
    if (hasTopLevelRow(out, spec.id)) continue;
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
    out.push('', `# ${spec.reason}`, `- id: ${spec.id}`, `  name: '${spec.name}'`, '');
    ensured++;
  }
  return ensured;
}

function patchAgentPresets() {
  // dsh ≥ 0.1.2 把 preset 放在 agent-presets 包内（SHIPPED_PRESET_ROOT = <pkg>/presets/）；
  // 更早的构建放在 config/agent-presets 下。取实际存在的那个。
  const presetsDir = [
    resolve(distDir, 'node_modules/@deepseek-ai/dsh-agent-presets/presets'),
    resolve(distDir, 'config/agent-presets'),
  ].find((dir) => existsSync(dir));
  if (presetsDir === undefined) {
    console.warn('[collect-dsh] agent-presets 目录缺失，跳过 preset 补丁');
    return;
  }
  let disabled = 0;
  let ensuredTotal = 0;
  for (const name of readdirSync(presetsDir)) {
    const file = resolve(presetsDir, name, 'agent.cordis.yml');
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    const out = [];
    let disabledHere = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      out.push(line);
      const m = TOP_ROW_RE.exec(line);
      const reason = m ? HARMONY_DISABLED_PRESET_ROWS[m[1]] : undefined;
      if (reason === undefined) continue;
      // 收集该 row 的后续 2 空格缩进行（4 空格的 config 嵌套内容不计入）。
      const block = [];
      let j = i + 1;
      while (j < lines.length && /^  \S/.test(lines[j])) { block.push(lines[j]); j++; }
      const hasDisabled = block.some(b => /^  disabled:/.test(b));
      let inserted = false;
      for (const b of block) {
        if (/^  disabled:/.test(b)) {
          if (b.includes(HARMONY_MARKER)) { out.push(b); continue; }
          out.push(`  disabled: true ${HARMONY_MARKER} ${reason}`);
          disabledHere++;
        } else {
          out.push(b);
          if (!hasDisabled && !inserted && /^  name:/.test(b)) {
            out.push(`  disabled: true ${HARMONY_MARKER} ${reason}`);
            inserted = true; disabledHere++;
          }
        }
      }
      i = j - 1; // block 已输出，外层循环从 block 之后继续
    }
    const ensured = ensurePresetRows(out);
    disabled += disabledHere;
    ensuredTotal += ensured;
    if (disabledHere > 0 || ensured > 0) {
      writeFileSync(file, out.join('\n'));
      console.log(`[collect-dsh] preset ${name}: 禁用 ${disabledHere} 行、补齐 ${ensured} 行`);
    }
  }
  console.log(`[collect-dsh] agent preset 补丁完成：禁用 ${disabled} 行、补齐 ${ensuredTotal} 行`);
}

/** Inject the tested Electron 37 / Node ABI v138 better-sqlite3 package. */
function injectBetterSqlite3() {
  if (!existsSync(betterSqliteArchive)) {
    console.error(`[collect-dsh] better-sqlite3 v138 成品缺失: ${betterSqliteArchive}`);
    process.exit(1);
  }
  const tempRoot = mkdtempSync(resolve(projectRoot, '.better-sqlite3-'));
  try {
    // 归档名只传 basename、用 cwd 定位目录：Windows 绝对路径含 `D:`，而 GNU tar（MSYS
    // 的 /usr/bin/tar）会把归档名里的 `host:path` 当远程主机而报 "Cannot connect to D:"。
    // System32 的 bsdtar 无此语义但也不支持 `--force-local`，故只传文件名是唯一同时兼容两者的写法。
    run(`tar -xzf "${basename(betterSqliteArchive)}" -C "${tempRoot}"`, dirname(betterSqliteArchive));
    const source = resolve(tempRoot, 'better-sqlite3');
    const destination = resolve(distDir, 'node_modules/better-sqlite3');
    if (!existsSync(resolve(source, 'package.json')) || !existsSync(resolve(source, 'build/Release/better_sqlite3.node'))) {
      console.error(`[collect-dsh] better-sqlite3 v138 成品结构无效: ${source}`);
      process.exit(1);
    }
    rmSync(destination, { recursive: true, force: true });
    cpSync(source, destination, { recursive: true, dereference: true });
    console.log('[collect-dsh] better-sqlite3 v138 aarch64 成品已注入 dsh-dist');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

// 0. 校验
if (!existsSync(dshRoot)) {
  console.error(`[collect-dsh] dsh 未找到: ${dshRoot}`);
  process.exit(1);
}

// 1. 清理旧产物
if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });

// 2. pnpm deploy 物化依赖闭包（apps/cli 的 dependencies 含 web profile 全部插件）
run(`pnpm --filter @deepseek-ai/dsh deploy --legacy "${distDir}"`, dshRoot);

// 3. 物化顶层 Junction（js-yaml 等）
console.log('\n[collect-dsh] 物化 Junction 为真实文件...');
materializeJunctions(join(distDir, 'node_modules'));

// 4. 补全 @deepseek-ai 包（peer 依赖与 link: override）
console.log('\n[collect-dsh] 补全 @deepseek-ai 包...');
collectWorkspacePackages();

// 4b. 物化 landlock-run 入口包（native 原生模块，win32 无平台 .node，但沙箱插件静态 import 其入口；
//     产品概念设计已确认 MVP 裁掉 landlock 原生沙箱，此处仅物化入口使 import 不报错）
const landlockEntry = resolve(dshRoot, 'native/landlock-run/packages/entry');
copyPackage(landlockEntry, resolve(distDir, 'node_modules/@deepseek-ai'));

// 5. 物化非 hoisted 依赖（zod 等）
console.log('\n[collect-dsh] 物化非 hoisted 依赖...');
collectNonHoistedDeps();

// 6. 删除 .pnpm store（已物化，冗余）
const pnpmStore = resolve(distDir, 'node_modules/.pnpm');
if (existsSync(pnpmStore)) rmSync(pnpmStore, { recursive: true, force: true });

// 6b. 清理非目标架构的原生模块 prebuilds（node-pty 等），避免 rpmbuild brp-strip 失败
console.log('\n[collect-dsh] 清理非目标架构 prebuilds...');
pruneForeignPrebuilds(join(distDir, 'node_modules'));

// 6c. 写 sharp 纯 JS stub（libvips 在鸿蒙 aarch64 不可用）
applySharpStub();

// 6d. 注入 better-sqlite3 v138（Windows 不安装 native addon，部署包使用 OpenHarmony aarch64 成品）
injectBetterSqlite3();

// 6e. 适配 agent preset（禁用依赖 shell/subprocess/pty 的行，补齐列目录工具行）
patchAgentPresets();

// 7. 复制 web dist（pnpm deploy 不物化 build 产物，frontend-static 经
//    require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html') 定位）
const webDist = resolve(dshRoot, 'apps/web/dist');
const webFrontendDist = resolve(distDir, 'node_modules/@deepseek-ai/dsh-web-frontend/dist');
if (existsSync(webDist)) {
  cpSync(webDist, webFrontendDist, { recursive: true });
  console.log('[collect-dsh] web dist 已复制到 dsh-web-frontend/dist');
} else {
  console.error('[collect-dsh] web dist 缺失（先跑 npm run build:dsh）');
  process.exit(1);
}

// 8. 复制 desktop profile 到 dsh-dist/profiles/desktop（供 host.ts 复制到 $DSH_HOME）
const profileSrc = resolve(projectRoot, 'profiles/desktop');
const profileDest = resolve(distDir, 'profiles/desktop');
if (existsSync(profileSrc)) {
  cpSync(profileSrc, profileDest, { recursive: true });
  console.log('[collect-dsh] desktop profile 已复制到 dsh-dist/profiles/desktop');
}

// 9. 物化 dsh-market（插件市场）到 dsh-dist/node_modules/dshmarket
collectDshMarket();

// 10. 物化本工程 plugins/ 下的专用插件（harmony-plugin-*）到 dsh-dist/node_modules/<包名>。
//     刻意放在最后：此前所有清理动作（.pnpm 删除、非目标架构 prebuilds 剪裁）都已跑完，
//     插件目录落在 dsh-dist.tar.gz 内，不经过 resfile/app 的 demo 清理，故无需 keep 白名单。
collectPlugins();

console.log(`\n[collect-dsh] 完成: ${distDir}`);
