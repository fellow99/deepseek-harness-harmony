#!/usr/bin/env node
/**
 * 011-runtime-provisioning —— 构建期获取「路径 A」的便携运行时（Node ELF + standalone pnpm）。
 *
 * 定位（**必须读**）：
 *   - 本脚本**不接入默认构建链**（`collect-runtime → build-dsh → collect-dsh` 三阶段不动它）。
 *     原因：默认构建必须能离线完成，而本脚本需要下载数十 MB 的外部产物；把它塞进默认链条会让
 *     离线 / 受限网络下的构建整体失败。故它是**独立的按需命令**，在需要制作路径 A 载荷时手工执行。
 *   - 本脚本**不内置任何二进制**，也**不打包 HNP**。路径 A 的 Node 运行时无官方 aarch64-ohos
 *     二进制（Node 官方仅 Experimental，见 spec §7.1 / §FR-1.1），其**发布方与版本尚未选定**
 *     （plan §16 Q1，`[NEEDS CLARIFICATION]`）—— 因此 Node 来源由调用方**显式**给出
 *     （`--node-url` 或 `DSH_MARKET_NODE_URL`），脚本只负责获取、防截断、结构校验与版本戳。
 *   - 路径 A 的 ELF **必须**用 AGC 二进制证书签名才能在鸿蒙 PC 上运行（spec §7.3 / FR-5.6），
 *     该证书是**受限工单**（`docs/ACL申请清单-v2.md` A1）。本脚本产出的是**未签名**载荷，
 *     签名由后续 `binary-sign-tool` 步骤完成（不在本脚本职责内）。
 *
 * 用法（独立命令）：
 *   node scripts/fetch-market-runtime.mjs --node-url <url> [--node-sha256 <hex>] [--pnpm-url <url>] [--force]
 *
 * 环境变量回退：`DSH_MARKET_NODE_URL` / `DSH_MARKET_NODE_SHA256` / `DSH_MARKET_PNPM_URL`
 *
 * 产出（gitignored 暂存目录 `runtime/market-runtime/`）：
 *   runtime/market-runtime/bin/node           路径 A 的 Node ELF（aarch64-ohos）
 *   runtime/market-runtime/bin/pnpm           路径 A 的 standalone pnpm（单文件 ELF）
 *   runtime/market-runtime/.versions.json     版本戳（仅在全部产物校验通过后写入）
 *
 * 防截断语义（对齐 desktop `scripts/fetch-runtime.mjs`）：下载先写 `<dest>.part`，确认大小与响应
 * `Content-Length` 一致后才 `rename`；失败清理临时文件并重试（3 次）。**截断产物不得被记录为就绪**。
 * 结构校验复用运行期同一算法（`src-main/market-runtime.js::isUsableExecutable`），保证「构建期校验」
 * 与「运行期前置前校验」口径一致（spec §9.1 / §9.2）。
 */
import { createWriteStream, chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { isUsableExecutable } = require('../src-main/market-runtime.js');

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const stageRoot = resolve(projectRoot, 'runtime', 'market-runtime');
const binDir = join(stageRoot, 'bin');

/** 目标平台 / 架构固定为鸿蒙 PC（aarch64-ohos），与 spec §3.1 的设备基线一致。 */
const TARGET_PLATFORM = 'openharmony';
const TARGET_ARCH = 'arm64';

/**
 * pnpm 版本固定，语义对齐 dsh-desktop 的 `PNPM_VERSION = '9.15.9'`（spec FR-1.2）。
 * ⚠️ `pnpm-linuxstatic-arm64` 是 **Linux** 静态目标，它在 OpenHarmony 上能否直接运行 **未验证**
 * （plan §16 Q3 / 真机 TC-D7）；此处沿用同构解，真机不通过则需第三方 ohos 构建。
 */
const PNPM_VERSION = '9.15.9';
const PNPM_URL_DEFAULT = `https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-linuxstatic-arm64`;

/** 下载重试次数：产物数十 MB，抖动网络下中断常见；一次中断不应让整轮获取失败。 */
const DOWNLOAD_ATTEMPTS = 3;

function log(message) {
  console.log(`[fetch-market-runtime] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

// ── 参数 ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { nodeUrl: undefined, nodeSha256: undefined, pnpmUrl: undefined, nodeKind: undefined, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') { out.force = true; continue; }
    const value = argv[i + 1];
    const take = () => {
      if (value === undefined || value.startsWith('--')) fail(`${arg} 需要一个参数值`);
      i += 1;
      return value;
    };
    if (arg === '--node-url') { out.nodeUrl = take(); continue; }
    if (arg === '--node-sha256') { out.nodeSha256 = take().toLowerCase(); continue; }
    if (arg === '--pnpm-url') { out.pnpmUrl = take(); continue; }
    if (arg === '--node-kind') { out.nodeKind = take(); continue; }
    fail(`未知参数: ${arg}（用法: --node-url <url> [--node-sha256 <hex>] [--pnpm-url <url>] [--node-kind raw|targz] [--force]）`);
  }
  return out;
}

function nodeKindFor(url, explicit) {
  if (explicit !== undefined) {
    if (explicit !== 'raw' && explicit !== 'targz') fail(`--node-kind 只支持 raw | targz，收到: ${explicit}`);
    return explicit;
  }
  return /\.(tar\.gz|tgz)$/i.test(url) ? 'targz' : 'raw';
}

// ── 下载（防截断 + 重试） ─────────────────────────────────────────────

/** 流式下载到临时文件，返回响应 `Content-Length`（缺省 0）。 */
async function downloadViaFetch(url, part) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed ${res.status} ${res.statusText}: ${url}`);
  const contentLength = Number(res.headers.get('content-length') ?? 0);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
  return contentLength;
}

/**
 * 下载 `url` 到 `dest`：先写 `<dest>.part`，确认大小与 `Content-Length` 一致后才 `rename`；
 * 失败清理临时文件并重试。截断产物**不会**落到 `dest`。
 */
async function download(url, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  let lastError;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const contentLength = await downloadViaFetch(url, part);
      const size = statSync(part).size;
      if (contentLength > 0 && size !== contentLength) {
        throw new Error(`下载被截断：期望 ${contentLength} 字节，实得 ${size} 字节（${url}）`);
      }
      rmSync(dest, { force: true });
      renameSyncCompat(part, dest);
      return size;
    } catch (err) {
      lastError = err;
      rmSync(part, { force: true });
      console.warn(`[fetch-market-runtime] 下载失败（第 ${attempt}/${DOWNLOAD_ATTEMPTS} 次）：${err.message}`);
    }
  }
  throw lastError;
}

/** `renameSync` 在目标存在的 Windows 上会失败，故先清理目标（已在上层做）。 */
function renameSyncCompat(from, to) {
  // 延迟 require 保持顶部 import 精简；此处是同步重命名，Node 内置。
  const { renameSync } = require('node:fs');
  renameSync(from, to);
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

// ── 归档解包（Node 发行包常见形态） ──────────────────────────────────

/** 递归查找第一个名为 `name` 的文件（限定深度，避免大目录树长时间遍历）。 */
function findFileNamed(root, name, depth = 0) {
  if (depth > 6) return null;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (err) {
    console.warn(`[fetch-market-runtime] 目录不可读，跳过: ${root} (${err.message})`);
    return null;
  }
  // 优先 `<root>/bin/<name>`（Node 官方发行包布局），再退回任意 `<name>`。
  const direct = join(root, 'bin', name);
  if (existsSync(direct) && statSync(direct).isFile()) return direct;
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) {
      const nested = findFileNamed(full, name, depth + 1);
      if (nested !== null) return nested;
    }
  }
  return null;
}

/** 解包 `tar.gz` 归档并返回其中的 `node` ELF 路径。 */
function extractNodeFromTarGz(archive) {
  const extractDir = join(stageRoot, '.extract');
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  log(`解包归档: ${archive}`);
  execFileSync('tar', ['-xzf', archive, '-C', extractDir], { stdio: 'inherit' });
  const found = findFileNamed(extractDir, 'node');
  if (found === null) fail(`归档中未找到 node 可执行文件: ${archive}`);
  return found;
}

// ── 版本戳 ────────────────────────────────────────────────────────────

function buildWanted(args, pnpmUrl) {
  return JSON.stringify({
    node: args.nodeUrl,
    nodeSha256: args.nodeSha256 ?? null,
    pnpm: pnpmUrl,
    platform: TARGET_PLATFORM,
    arch: TARGET_ARCH,
  });
}

function stampUpToDate(stamp, wanted) {
  try {
    return existsSync(stamp) && readFileSync(stamp, 'utf8') === wanted;
  } catch (err) {
    console.warn(`[fetch-market-runtime] 读取版本戳失败（视为过期）: ${err.message}`);
    return false;
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const nodeUrl = args.nodeUrl ?? process.env.DSH_MARKET_NODE_URL;
  const nodeSha256 = (args.nodeSha256 ?? process.env.DSH_MARKET_NODE_SHA256 ?? '').toLowerCase() || undefined;
  const pnpmUrl = args.pnpmUrl ?? process.env.DSH_MARKET_PNPM_URL ?? PNPM_URL_DEFAULT;

  if (nodeUrl === undefined || nodeUrl === '') {
    fail(
      '缺少 Node 运行时来源（路径 A 的 node ELF）：请用 --node-url <url> 或环境变量 DSH_MARKET_NODE_URL 指定。\n'
      + '  · Node.js 官方**没有** aarch64-ohos 二进制（仅 Experimental，spec §7.1），路径 A 依赖第三方构建，\n'
      + '    其发布方 / 版本尚未选定（plan §16 Q1 `[NEEDS CLARIFICATION]`）。\n'
      + '  · 本脚本只做「获取 + 防截断 + 结构校验 + 版本戳」，**不内置**任何二进制，也不打包 HNP。\n'
      + '  · 产物为**未签名** ELF；路径 A 上机前还须用 AGC 二进制证书签名（spec §7.3，工单见 docs/ACL申请清单-v2.md A1）。',
    );
  }

  const nodeDest = join(binDir, 'node');
  const pnpmDest = join(binDir, 'pnpm');
  const stamp = join(stageRoot, '.versions.json');
  const wanted = buildWanted({ nodeUrl, nodeSha256 }, pnpmUrl);

  mkdirSync(binDir, { recursive: true });

  // 幂等：版本戳一致且两份产物均通过结构校验才跳过。
  if (
    !args.force
    && stampUpToDate(stamp, wanted)
    && isUsableExecutable(nodeDest, { platform: TARGET_PLATFORM, arch: TARGET_ARCH })
    && isUsableExecutable(pnpmDest, { platform: TARGET_PLATFORM, arch: TARGET_ARCH })
  ) {
    log('Node / pnpm 运行时已就绪（版本戳一致且校验通过），跳过');
    return;
  }

  // 1) Node
  const nodeKind = nodeKindFor(nodeUrl, args.nodeKind);
  log(`获取 Node（kind=${nodeKind}）: ${nodeUrl}`);
  const nodeDownload = join(stageRoot, nodeKind === 'targz' ? 'node.tar.gz.partial' : 'node.download');
  await download(nodeUrl, nodeDownload);
  try {
    if (nodeKind === 'targz') {
      const extracted = extractNodeFromTarGz(nodeDownload);
      rmSync(nodeDest, { force: true });
      copyFileSyncCompat(extracted, nodeDest);
    } else {
      rmSync(nodeDest, { force: true });
      renameSyncCompat(nodeDownload, nodeDest);
    }
  } finally {
    rmSync(nodeDownload, { force: true });
    rmSync(join(stageRoot, '.extract'), { recursive: true, force: true });
  }
  if (nodeSha256 !== undefined) {
    const actual = sha256File(nodeDest);
    if (actual !== nodeSha256) fail(`Node 产物 sha256 不符：期望 ${nodeSha256}，实得 ${actual}`);
    log(`Node sha256 校验通过: ${actual}`);
  }
  bestEffortChmod(nodeDest);
  if (!isUsableExecutable(nodeDest, { platform: TARGET_PLATFORM, arch: TARGET_ARCH })) {
    fail(`Node 产物结构校验失败（应为完整 aarch64-ohos ELF，不得截断）: ${nodeDest}`);
  }
  log(`Node 就位并校验通过: ${nodeDest}`);

  // 2) pnpm
  log(`获取 standalone pnpm: ${pnpmUrl}`);
  await download(pnpmUrl, pnpmDest);
  bestEffortChmod(pnpmDest);
  if (!isUsableExecutable(pnpmDest, { platform: TARGET_PLATFORM, arch: TARGET_ARCH })) {
    fail(`pnpm 产物结构校验失败（应为完整 aarch64-ohos ELF；注意 pnpm-linuxstatic 在 OpenHarmony 上的可用性未验证，plan §16 Q3）: ${pnpmDest}`);
  }
  log(`pnpm 就位并校验通过: ${pnpmDest}`);

  // 3) 仅在全部产物校验通过后写版本戳（截断产物不得被记录为「就绪」）
  writeFileSync(stamp, wanted);
  log(`版本戳已写入: ${stamp}`);
  log('完成。下一步（不在本脚本内）：collect 阶段物化 → HNP 打包 → binary-sign-tool 签名 → inject-hnp.ps1 嵌入。');
}

/** 同步复制（Windows 上 `rename` 跨卷会失败，归档解包场景用 copy 更稳）。 */
function copyFileSyncCompat(from, to) {
  const { copyFileSync } = require('node:fs');
  copyFileSync(from, to);
}

/** 构建宿主的可执行位：仅 POSIX 宿主有意义；失败不致命（Windows 打包时 HNP 自动赋予 other 位）。 */
function bestEffortChmod(file) {
  if (process.platform === 'win32') return;
  try {
    chmodSync(file, 0o755);
  } catch (err) {
    console.warn(`[fetch-market-runtime] chmod 0755 失败（忽略）: ${file} (${err.message})`);
  }
}

main().catch((err) => {
  console.error('[fetch-market-runtime] 失败:', err && err.message ? err.message : String(err));
  process.exit(1);
});
