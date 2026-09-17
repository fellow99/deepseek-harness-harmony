#!/usr/bin/env node
/**
 * 构建 dsh（deepseek-harness）：apply Electron 兼容 patch + 安装依赖 + 构建产物。
 *
 * 用法：node scripts/build-dsh.mjs
 * 前置：dsh 与本工程同级目录（../deepseek-harness），git 仓库。
 * 说明：本脚本只依赖同级 ../deepseek-harness 与 ../dsh-market，与 deepseek-harness-desktop 无关。
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dshRoot = resolve(projectRoot, '../deepseek-harness');
// 补丁按 dsh 版本分目录存放；当前构建基于 dsh dsh-v0.1.5-rc.2。
const patchDir = resolve(projectRoot, 'patches/dsh-v0.1.5-rc.2');
const patchFiles = [
  resolve(patchDir, 'dsh-symlink-to-copy.patch'),
  resolve(patchDir, 'dsh-allow-all-interfaces.patch'),
  resolve(patchDir, 'dsh-disable-hmr.patch'),
  resolve(patchDir, 'dsh-disable-native-picker.patch'),
  resolve(patchDir, 'dsh-flock-openharmony.patch'),
  resolve(patchDir, 'dsh-hardlink-to-rename.patch'),
  resolve(patchDir, 'dsh-fs-hardlink-fallback.patch'),
  resolve(patchDir, 'dsh-fs-remove-primitive.patch'),
  resolve(patchDir, 'dsh-fs-write-bytes.patch'),
  resolve(patchDir, 'dsh-extra-writable-roots.patch'),
  resolve(patchDir, 'dsh-disable-lefthook-postinstall.patch'),
  resolve(patchDir, 'dsh-attachment-durable-walk-sandbox.patch'),
  resolve(patchDir, 'dsh-fs-chmod-primitive.patch'),
];

// pnpm/tsdown 在无 TTY 时中止模块重建与依赖检查，故设 CI 使其自动处理
process.env.CI = process.env.CI ?? 'true';
process.env.npm_config_confirm_modules_purge = 'false';
process.env.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0';

function run(cmd, cwd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

/** 静默执行，返回是否成功。 */
function runQuiet(cmd, cwd) {
  try {
    execSync(cmd, { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// 0. 校验前置
if (!existsSync(dshRoot)) {
  console.error(`[build-dsh] dsh 未找到: ${dshRoot}`);
  process.exit(1);
}

// 0.5 清理 workspace 残留：版本切换或 collect/deploy 遗留的空壳目录会被 tsdown 的
//     vendor/* 与 packages/*/* glob 匹配，并导致 build 报 dsh-root entry 失败。
//     真包至少含 package.json 或 src/；两者皆无的空壳目录即残留，直接删除。
const workspaceResidueRoots = [];
{
  const vendorDir = resolve(dshRoot, 'vendor');
  if (existsSync(vendorDir)) {
    for (const entry of readdirSync(vendorDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      workspaceResidueRoots.push(resolve(vendorDir, entry.name));
    }
  }
  const packagesDir = resolve(dshRoot, 'packages');
  if (existsSync(packagesDir)) {
    for (const group of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!group.isDirectory()) continue;
      const groupDir = resolve(packagesDir, group.name);
      for (const pkg of readdirSync(groupDir, { withFileTypes: true })) {
        if (!pkg.isDirectory()) continue;
        workspaceResidueRoots.push(resolve(groupDir, pkg.name));
      }
    }
  }
}
for (const dir of workspaceResidueRoots) {
  if (existsSync(resolve(dir, 'package.json')) || existsSync(resolve(dir, 'src'))) continue;
  rmSync(dir, { recursive: true, force: true });
  console.log(`[build-dsh] 清理 workspace 残留: ${dir.slice(dshRoot.length + 1).replaceAll('\\', '/')}`);
}

// 1. apply patches（幂等：--reverse --check 成功即已应用，跳过）
for (const patchFile of patchFiles) {
  if (!existsSync(patchFile)) {
    console.error(`[build-dsh] patch 未找到: ${patchFile}`);
    process.exit(1);
  }
  const applied = runQuiet(`git apply --reverse --check "${patchFile}"`, dshRoot);
  if (applied) {
    console.log(`[build-dsh] patch 已应用: ${basename(patchFile)}`);
  } else {
    try {
      run(`git apply "${patchFile}"`, dshRoot);
    } catch {
      console.error(`[build-dsh] patch 应用失败（可能与 dsh 版本冲突）: ${basename(patchFile)}`);
      process.exit(1);
    }
  }
}

// 2. 安装依赖（node_modules 缺失时）
if (!existsSync(resolve(dshRoot, 'node_modules'))) {
  run('pnpm install', dshRoot);
}

// 3. 构建产物（host lib + client lib + web dist）
run('pnpm run build:lib:host', dshRoot);
run('pnpm run build:lib:client', dshRoot);
run('pnpm run build:web', dshRoot);

// 4. 构建 dsh-market（插件市场，同级 ../dsh-market 源码引用）
const marketRoot = resolve(projectRoot, '../dsh-market');
if (existsSync(marketRoot)) {
  if (!existsSync(resolve(marketRoot, 'node_modules'))) {
    run('npm install', marketRoot);
  }
  run('npm run build', marketRoot);
  console.log('\n[build-dsh] dsh-market 构建完成（lib + client）');
} else {
  console.warn(`\n[build-dsh] dsh-market 未找到，跳过: ${marketRoot}`);
}

console.log('\n[build-dsh] 完成：dsh lib host/client + web dist + dsh-market 已就绪');
