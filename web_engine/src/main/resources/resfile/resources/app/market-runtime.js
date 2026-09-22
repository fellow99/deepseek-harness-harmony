/**
 * 011-runtime-provisioning —— 内置插件市场 `dshmarket` 的运行时供给引导（路径 A / B / C）。
 *
 * 为什么需要它：市场的安装 / 卸载通道依赖 `node` + `pnpm` 入口点 + `dsh plugin` 三件套，
 * 而鸿蒙 HAP 内没有可运行的 node（B0：`process.execPath` 指向不存在的 ELF），`symlink`/`chmod`
 * 对第三方应用被禁（B1：`13900012`），用户目录 ELF 被拒执行（B2），`#!/usr/bin/env node` 的
 * shebang 假设破裂（B3）。本模块按 `specs/011-runtime-provisioning/spec.md` §4.3 的**有序**规则
 * 探测并采用下列机制（**禁跳级**）：
 *
 *   - **路径 A（主路径）**：随包携带、经二进制证书签名的 Node ELF，以 public HNP 分发，系统
 *     installer 在 `/data/service/hnp/bin` 创建 `node`/`pnpm` 软链接（**系统上下文，B1 不适用**）。
 *     ⚠️ **路径 A 被 AGC「二进制证书」工单阻塞**（AGC `certType: 4`；见 `docs/ACL申请清单-v2.md`
 *     的 A1 项与 `spec.md` §4.4）。证书未到手时路径 A 必然探测失败，这是**预期**行为，不是缺陷。
 *   - **路径 B（过渡 / 兜底）**：进程内运行 pnpm 的 JavaScript —— **零 ELF、零 symlink、零证书**，
 *     一次绕过 B0/B1/B2/B3。本引导只做「pnpm JS 是否随包就位」的检测并记录；真正的进程内调用
 *     由 `dsh-market` 的进程内补丁承担（`plan.md` §11，尚未落地）。
 *   - **路径 C（机会性兜底）**：复用设备上第三方应用已装的 Node。**仅机会性**，绝不作为产品能力；
 *     结果带 `source: 'device-environment'` 标记，UI / 日志必须标注「复用了设备环境运行时，非本
 *     应用保障」。不通过 `node -e` 探针即视为不可用（现设备 `node -e` 无输出，`未验证`）。
 *
 * 本文件只依赖 node 内建模块：探测 / 校验 / 组装的纯逻辑（`discoverMarketRuntime` /
 * `isUsableExecutable` / `isExecutableFile` / `dshShim` / `composePath` / `formatDiagnostics`）
 * 可在裸 Node 上被单测直接驱动，不依赖 Electron / dsh / 第三方包。`electron` 的 `app.getPath`
 * 只在 `setupMarketRuntime()` 内部**按需** require，因此 `require()` 本文件不会拉入 Electron。
 *
 * 日志规范：所有输出以 `[dsh-harmony]` 前缀打印（constitution §3.3），**禁止静默降级**。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ── 常量 ──────────────────────────────────────────────────────────────
/** 工程统一日志前缀（FR-6.1）。 */
const LOG_PREFIX = '[dsh-harmony]';
/** ELF magic `\x7fELF`。 */
const ELF_MAGIC = [0x7f, 0x45, 0x4c, 0x46];
const ELFCLASS64 = 2;
const ELFDATA2LSB = 1;
const ELFDATA2MSB = 2;
/** `e_machine`：AARCH64 / x86-64。 */
const EM_AARCH64 = 0xb7;
const EM_X86_64 = 0x3e;
/** HNP public 包落点（device 事实，`docs/鸿蒙环境能力清单-v0.1.5.md:907-918`）；可被 env 覆盖。 */
const DEFAULT_HNP_PUBLIC_HOME = '/data/service/hnp';
/** `dsh` shim 的落地目录名（`<userData>/runtime-bin`）。 */
const RUNTIME_BIN_DIRNAME = 'runtime-bin';
/** `dsh-market/src/dsh-cli.ts:328-340` 的 `dshArgv()` 回退到裸 `dsh` 时依赖的 CLI 入口。 */
const DSH_CLI_REL = ['lib', 'bin.js'];
/**
 * 路径 B：pnpm 的 JavaScript 物化成的包名（布局由 `scripts/collect-dsh.mjs` 物化阶段决定；
 * 本引导只按约定路径检测，不 import 它）。`plan.md` §4.2「物化进 dsh-dist/node_modules/」。
 */
const BUNDLED_PNPM_PACKAGE = 'dsh-market-pnpm';
const BUNDLED_PNPM_ENTRY_REL = ['node_modules', BUNDLED_PNPM_PACKAGE, 'lib', 'index.mjs'];
/**
 * 路径 C 候选目录，对齐 `dsh-market/src/dsh-cli.ts:172-195` 的 `toolSearchDirs()` 与
 * `spec.md` §4.1（设备 HNP 落点 + 常见 POSIX / homebrew 目录）。`~` 以 `HOME` 展开。
 */
const DEVICE_NODE_DIR_CANDIDATES = [
  '/data/service/hnp/bin',
  '~/.harmonybrew/opt/node/bin',
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '~/.local/bin',
  '~/Library/pnpm',
  '~/.local/share/pnpm',
];

// ── 基础工具（纯函数，绝不抛出） ──────────────────────────────────────

/** 目标平台是否为 win32（构建期参考，非本平台运行）。 */
function isWin32(platform) {
  return platform === 'win32';
}

/** PATH 分隔符。 */
function pathSeparator(platform) {
  return isWin32(platform) ? ';' : ':';
}

/** 按**注入的**目标平台拼接路径 —— 使跨平台单测稳定（宿主 win32 也产出 POSIX 形态）。 */
function joinPath(platform, ...parts) {
  return isWin32(platform) ? path.win32.join(...parts) : path.posix.join(...parts);
}

/** 反斜杠 → 正斜杠（POSIX shim 内容用）。 */
function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

/**
 * 定长读取文件片段。任何 IO / 解析异常返回空 Buffer（**绝不抛出**）——
 * 这是「校验器遇异常一律判不可用」的根基（spec §7.2 / FR-1.3）。
 */
function readAt(file, offset, length) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(length);
      const n = fs.readSync(fd, buf, 0, length, offset);
      if (n <= 0) return Buffer.alloc(0);
      return n < length ? buf.subarray(0, n) : buf;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // 文件消失 / 权限 / 截断等：返回哨兵空 Buffer，由调用方按长度判无效（不抛）。
    return Buffer.alloc(0);
  }
}

/** 读取无符号 64 位字段；超出安全整数范围时返回一个「必然越界」的哨兵值。 */
function readU64(buf, offset, littleEndian) {
  const value = littleEndian ? buf.readBigUInt64LE(offset) : buf.readBigUInt64BE(offset);
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER + 1 : Number(value);
}

/**
 * POSIX 可执行位校验。Windows 主机没有 POSIX 可执行位语义（`access(X_OK)` 退化为存在性检查），
 * 因此**仅在宿主非 win32 时**校验，避免把宿主能力差异误判成产物不可用。
 */
function assertExecutableBit(file) {
  if (process.platform === 'win32') return;
  fs.accessSync(file, fs.constants.X_OK);
}

/**
 * 结构校验：文件是否为**目标架构的完整 ELF**（spec §9.1 / FR-1.3）。
 *
 * 校验 `\x7fELF` magic、`EI_CLASS == 2`（64 位）、`e_machine` 与目标架构一致、节表范围不越界。
 * 「节表越界」正是截断下载的典型特征（对齐 desktop `runtime.ts:isUsableExecutable` 的 PE
 * 节区越界检查），必被拦截。任何 IO / 解析异常返回 `false`，**绝不抛出**。
 *
 * @param {string} file
 * @param {string} arch `arm64` | `x64`（其它值不校验 `e_machine`，只查结构与节表）
 * @param {number} size 文件字节数（调用方已 stat）
 * @returns {boolean}
 */
function isValidElf(file, arch, size) {
  const header = readAt(file, 0, 64);
  if (header.length < 64) return false;
  for (let i = 0; i < 4; i += 1) if (header[i] !== ELF_MAGIC[i]) return false;
  if (header[4] !== ELFCLASS64) return false;
  const data = header[5];
  if (data !== ELFDATA2LSB && data !== ELFDATA2MSB) return false;
  const littleEndian = data === ELFDATA2LSB;
  const machine = littleEndian ? header.readUInt16LE(18) : header.readUInt16BE(18);
  const expected = arch === 'arm64' ? EM_AARCH64 : arch === 'x64' ? EM_X86_64 : null;
  if (expected !== null && machine !== expected) return false;
  const shoff = readU64(header, 40, littleEndian);
  const shentsize = littleEndian ? header.readUInt16LE(58) : header.readUInt16BE(58);
  const shnum = littleEndian ? header.readUInt16LE(60) : header.readUInt16BE(60);
  // 有节表则必须完整落在文件内；声明有节表却越界 = 截断产物。
  if (shoff !== 0 || shnum !== 0) {
    if (shoff === 0 || shnum === 0 || shentsize === 0) return false;
    if (shoff + shentsize * shnum > size) return false;
  }
  return true;
}

/**
 * win32 专用：文件是否为完整 PE 映像（构建期参考，非本平台运行）。
 * 逐节区要求 `PointerToRawData + SizeOfRawData <= 文件大小`，拦截截断的 PE。
 */
function isCompletePeImage(file, arch, size) {
  const dos = readAt(file, 0, 2);
  if (dos.length < 2 || dos[0] !== 0x4d || dos[1] !== 0x5a) return false; // 'MZ'
  const lfanew = readAt(file, 0x3c, 4);
  if (lfanew.length < 4) return false;
  const peOff = lfanew.readUInt32LE(0);
  const sig = readAt(file, peOff, 4);
  if (sig.length < 4 || sig[0] !== 0x50 || sig[1] !== 0x45 || sig[2] !== 0 || sig[3] !== 0) return false;
  const expected = arch === 'arm64' ? 0xaa64 : arch === 'x64' ? 0x8664 : -1;
  const coff = readAt(file, peOff + 4, 24);
  if (coff.length < 24) return false;
  const machine = coff.readUInt16LE(0);
  if (expected < 0 || machine !== expected) return false;
  const sections = coff.readUInt16LE(2);
  const optionalSize = coff.readUInt16LE(16);
  if (sections === 0) return false;
  const tableOff = peOff + 24 + optionalSize;
  if (tableOff + sections * 40 > size) return false;
  for (let i = 0; i < sections; i += 1) {
    const raw = readAt(file, tableOff + i * 40 + 0x10, 8);
    if (raw.length < 8) return false;
    const rawSize = raw.readUInt32LE(0);
    const rawPtr = raw.readUInt32LE(4);
    if (rawPtr + rawSize > size) return false;
  }
  return true;
}

/**
 * 严格校验：随包运行时产物是否为**可用的可执行文件**（spec §9.1 / §7.2 边界 2）。
 *
 * - 目标 win32：完整 PE 映像；
 * - 其它目标（本平台 openharmony）：完整 ELF（magic + class + `e_machine` + 节表）+ 非空 + 可执行位。
 *
 * 损坏 / 截断产物**必须**判 `false` —— 否则它会被前置进 PATH 并遮蔽设备上可能可用的运行时
 * （对齐 desktop `runtime.ts:165-180` 的「绝不遮蔽」规则，spec FR-2.2）。
 * 任何异常返回 `false`，**绝不抛出**（对齐 desktop `isUsableExecutable` 的 try/catch 语义）。
 *
 * @param {string} file
 * @param {{platform?: string, arch?: string}} [options] 注入目标平台 / 架构，默认取宿主。
 */
function isUsableExecutable(file, options = {}) {
  try {
    const platform = options.platform ?? process.platform;
    const arch = options.arch ?? process.arch;
    if (!fs.existsSync(file)) return false;
    const st = fs.statSync(file);
    if (!st.isFile() || st.size === 0) return false;
    if (isWin32(platform)) return isCompletePeImage(file, arch, st.size);
    if (!isValidElf(file, arch, st.size)) return false;
    assertExecutableBit(file);
    return true;
  } catch {
    // 文件消失 / 权限 / 解析异常一律视为不可用，绝不向外抛出。
    return false;
  }
}

/**
 * 宽松校验（**仅用于路径 C 的机会性探测**）：文件存在、非空、（POSIX 目标）具可执行位。
 *
 * 路径 C 不假定完整性 / 签名（FR-4.3「复用对象不得来自本工程产物之外的任何签名 / 完整性假定」），
 * 其真正的硬门槛是 `node -e` 探针；此处只排除「不存在 / 空文件」这类显然不可用的候选。
 * 任何异常返回 `false`，绝不抛出。
 */
function isExecutableFile(file, options = {}) {
  try {
    const platform = options.platform ?? process.platform;
    if (!fs.existsSync(file)) return false;
    const st = fs.statSync(file);
    if (!st.isFile() || st.size === 0) return false;
    if (!isWin32(platform)) assertExecutableBit(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * 路径 B 的 JS 入口校验（spec §9.1）：入口文件存在、非空。
 * 运行期不做语法解析（`node --check` 级解析归构建期），只判存在 + 非空；异常返回 `false`。
 */
function isParsableJs(file) {
  try {
    const st = fs.statSync(file);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

/**
 * 路径 C 的硬门槛探针（spec §4.3 规则 3）：`node -e "process.stdout.write('ok')"` 必须输出 `ok`。
 * 现设备第三方 Node 的 `node -e` 无输出（3 次复现，原因未定位，`未验证`），故即便 `node` 存在，
 * 路径 C 在当前设备上也大概率不通过 —— 这正是「机会性兜底不得作为产品能力」的实证。
 * 单次短探针，任何异常返回 `false`，绝不抛出。
 */
function probeNodeExec(nodeFile) {
  try {
    const { spawnSync } = require('node:child_process');
    const res = spawnSync(nodeFile, ['-e', "process.stdout.write('ok')"], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    return res.status === 0 && String(res.stdout ?? '').includes('ok');
  } catch {
    return false;
  }
}

/**
 * 生成 `dsh` shim 内容（FR-3.1 / FR-3.2）。
 *
 * POSIX（本平台运行）：`#!/bin/sh\nexec "<node>" "<dshRoot>/lib/bin.js" "$@"\n`
 * Windows（构建期参考，非本平台运行）：`@echo off\r\n"<node>" "<dshRoot>\lib\bin.js" %*\r\nexit /b %errorlevel%\r\n`
 *
 * `dsh-market/src/dsh-cli.ts:328-340` 的 `dshArgv()` 在无法从 `process.argv[1]` 重入时会回退到
 * 裸 `dsh`，故 PATH 上必须有这个 shim（FR-3.3，命中与否的真机确认标 `未验证`）。
 */
function dshShim(nodeFile, dshRoot, platform = process.platform) {
  if (isWin32(platform)) {
    const cli = String(dshRoot).replace(/\//g, '\\') + '\\lib\\bin.js';
    return `@echo off\r\n"${nodeFile}" "${cli}" %*\r\nexit /b %errorlevel%\r\n`;
  }
  const cli = path.posix.join(toPosix(dshRoot), ...DSH_CLI_REL);
  return `#!/bin/sh\nexec "${nodeFile}" "${cli}" "$@"\n`;
}

/**
 * 组装 PATH：前缀目录在前、原 PATH 在后，去重、剔除空项（spec §8.1 / FR-2.2）。
 *
 * 顺序固定为 `[...prefixDirs, ...原 PATH]`；已在列表中的目录**只保留首次出现**，故
 * 「已在设备 PATH 上的 `/data/service/hnp/bin`」不会被重复追加（与 `dsh-cli.ts:240-242`
 * 的去重语义一致）。只有**通过校验**的目录才应出现在 `prefixDirs` 里。
 */
function composePath(prefixDirs, previousPath, platform = process.platform) {
  const separator = pathSeparator(platform);
  const seen = new Set();
  const out = [];
  const push = (dir) => {
    if (typeof dir !== 'string') return;
    const value = dir.trim();
    if (value === '' || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  };
  for (const dir of Array.isArray(prefixDirs) ? prefixDirs : []) push(dir);
  for (const dir of String(previousPath ?? '').split(separator)) push(dir);
  return out.join(separator);
}

/** `~` 展开：`~` / `~/...` 以注入的 HOME 解析（确保与 `ensureSandboxHome()` 之后的 HOME 一致）。 */
function expandHome(dir, home, platform = process.platform) {
  if (dir === '~') return home;
  if (dir.startsWith('~/') || dir.startsWith('~\\')) return joinPath(platform, home, dir.slice(2));
  return dir;
}

/** 选中路径的说明文案。 */
function pathLabel(pathId) {
  if (pathId === 'A') return '随包携带的签名 Node ELF（public HNP，主路径）';
  if (pathId === 'B') return '进程内运行 pnpm JS（过渡路径，零 ELF / 零 symlink / 零证书）';
  if (pathId === 'C') return '复用设备第三方 Node（机会性兜底）';
  return '未采用任何路径';
}

/** 选中路径的来源标记（路径 C 固定 `device-environment`，供 UI / 文档标注，FR-4.3）。 */
function sourceOf(pathId) {
  if (pathId === 'A') return 'bundled-hnp';
  if (pathId === 'B') return 'in-process';
  if (pathId === 'C') return 'device-environment';
  return null;
}

/**
 * 构造成功结果对象。`dirs` 会去重（路径 A 的 pnpm / node 目录同为 HNP `bin`）。
 * `shim`：仅当存在**可 exec 的 node** 时才生成 shim（路径 A / C）；路径 B 无 node 可 exec，
 * shim 无意义（plan D8），改为进程内调用。
 */
function successResult(pathId, fields, diagnostics) {
  const dirs = [];
  for (const dir of fields.dirs) {
    if (typeof dir === 'string' && dir !== '' && !dirs.includes(dir)) dirs.push(dir);
  }
  return {
    path: pathId,
    ok: true,
    reason: null,
    source: sourceOf(pathId),
    deviceEnvironment: pathId === 'C',
    shim: pathId === 'A' || pathId === 'C',
    dirs,
    binDir: fields.binDir,
    pnpmHome: fields.pnpmHome ?? null,
    nodeFile: fields.nodeFile ?? null,
    pnpmFile: fields.pnpmFile ?? null,
    pnpmJsEntry: fields.pnpmJsEntry ?? null,
    dshRoot: fields.dshRoot ?? null,
    hnpBin: fields.hnpBin ?? null,
    diagnostics,
  };
}

function failureResult(binDir, reason, diagnostics) {
  return {
    path: null,
    ok: false,
    reason,
    source: null,
    deviceEnvironment: false,
    shim: false,
    // No runtime was adopted, so NOTHING is prepended to PATH: an empty
    // `runtime-bin` must never shadow the device's own runtime (FR-2.2).
    dirs: [],
    binDir,
    pnpmHome: null,
    nodeFile: null,
    pnpmFile: null,
    pnpmJsEntry: null,
    dshRoot: null,
    hnpBin: null,
    diagnostics,
  };
}

/**
 * 纯探测 + 选路（spec §4.3 有序规则：A → B → C → 显式失败，**禁跳级**）。
 *
 * 所有副作用（`env` / `existsSync` / 校验器 / `node -e` 探针 / 平台 / 架构 / 目录）均通过
 * `deps` 注入，因此可在裸 Node 上被单测直接驱动，不需要 Electron、不需要真实设备。
 *
 * @param {{
 *   platform?: string, arch?: string, env?: Record<string,string|undefined>,
 *   userData?: string, dshRoot?: string|null, home?: string, hnpPublicHome?: string,
 *   deviceNodeDirs?: string[],
 *   exists?: (file: string) => boolean,
 *   isUsableExecutable?: (file: string) => boolean,
 *   isExecutableFile?: (file: string) => boolean,
 *   isParsableJs?: (file: string) => boolean,
 *   probeNodeExec?: (file: string) => boolean,
 * }} deps
 */
function discoverMarketRuntime(deps) {
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const env = deps.env ?? {};
  const exists = deps.exists ?? ((file) => fs.existsSync(file));
  const usable = deps.isUsableExecutable ?? ((file) => isUsableExecutable(file, { platform, arch }));
  const executable = deps.isExecutableFile ?? ((file) => isExecutableFile(file, { platform }));
  const parsable = deps.isParsableJs ?? isParsableJs;
  const probe = deps.probeNodeExec ?? probeNodeExec;
  const userData = deps.userData ?? '';
  const home = deps.home ?? env.HOME ?? env.USERPROFILE ?? '';
  const dshRoot = deps.dshRoot ?? null;
  const binDir = joinPath(platform, userData, RUNTIME_BIN_DIRNAME);
  const diagnostics = [];

  const nodeName = isWin32(platform) ? 'node.exe' : 'node';
  const pnpmName = isWin32(platform) ? 'pnpm.exe' : 'pnpm';

  // ── 路径 A：HNP 提供的签名 Node 工具链（主路径） ─────────────────────
  const hnpHome = deps.hnpPublicHome ?? env.HNP_PUBLIC_HOME ?? DEFAULT_HNP_PUBLIC_HOME;
  const hnpBin = joinPath(platform, hnpHome, 'bin');
  const aNode = joinPath(platform, hnpBin, nodeName);
  const aPnpm = joinPath(platform, hnpBin, pnpmName);
  const aNodeOk = exists(aNode) && usable(aNode);
  const aPnpmOk = exists(aPnpm) && usable(aPnpm);
  diagnostics.push(
    `路径 A（HNP 签名 Node）：node=${aNode} ${aNodeOk ? '结构校验通过' : '缺失或校验失败'}；`
    + `pnpm=${aPnpm} ${aPnpmOk ? '结构校验通过' : '缺失或校验失败'}；`
    + '其前置 AGC 二进制证书工单未完成时本项必然失败，属预期（docs/ACL申请清单-v2.md A1、spec §4.4）',
  );
  if (aNodeOk && aPnpmOk) {
    return successResult('A', {
      dirs: [binDir, hnpBin, hnpBin],
      binDir,
      pnpmHome: hnpBin,
      nodeFile: aNode,
      pnpmFile: aPnpm,
      dshRoot,
      hnpBin,
    }, diagnostics);
  }

  // ── 路径 B：进程内 pnpm JS（过渡路径） ───────────────────────────────
  const bEntry = dshRoot === null ? null : joinPath(platform, dshRoot, ...BUNDLED_PNPM_ENTRY_REL);
  const bOk = bEntry !== null && exists(bEntry) && parsable(bEntry);
  diagnostics.push(
    `路径 B（进程内 pnpm JS）：入口=${bEntry ?? '(无 dshRoot)'} ${bOk ? '已随包就位' : '缺失'}；`
    + '需 collect-dsh 将 pnpm JS 物化进 dsh-dist（plan §4.2 / T2.6）',
  );
  if (bOk) {
    return successResult('B', {
      dirs: [binDir],
      binDir,
      pnpmHome: null,
      pnpmJsEntry: bEntry,
      dshRoot,
    }, diagnostics);
  }

  // ── 路径 C：设备第三方 Node（机会性兜底） ────────────────────────────
  const candidates = deps.deviceNodeDirs ?? DEVICE_NODE_DIR_CANDIDATES;
  let hit = null;
  for (const candidate of candidates) {
    const dir = expandHome(candidate, home, platform);
    const nodeFile = joinPath(platform, dir, nodeName);
    const pnpmFile = joinPath(platform, dir, pnpmName);
    const nodeOk = exists(nodeFile) && executable(nodeFile);
    const pnpmOk = exists(pnpmFile) && executable(pnpmFile);
    let probeOk = false;
    let probeNote = 'node -e 探针未执行（node/pnpm 不全）';
    if (nodeOk && pnpmOk) {
      probeOk = probe(nodeFile);
      probeNote = probeOk ? 'node -e 探针通过' : 'node -e 探针无输出或失败（现设备实测现象，未验证）';
    }
    diagnostics.push(
      `路径 C 候选 ${dir}：node ${nodeOk ? '存在' : '缺失'}、pnpm ${pnpmOk ? '存在' : '缺失'}、${probeNote}`,
    );
    if (nodeOk && pnpmOk && probeOk) {
      hit = { dir, nodeFile, pnpmFile };
      break;
    }
  }
  if (hit !== null) {
    return successResult('C', {
      dirs: [binDir, hit.dir],
      binDir,
      pnpmHome: hit.dir,
      nodeFile: hit.nodeFile,
      pnpmFile: hit.pnpmFile,
      dshRoot,
    }, diagnostics);
  }

  // ── 规则 4：显式失败（fail-visible，不阻塞应用启动） ─────────────────
  diagnostics.push('全部候选不可用：按 spec §4.3 规则 4 显式失败（仅市场安装通道受影响）');
  const reason = '市场安装通道不可用：'
    + '路径 A 未就位（HNP 的 node/pnpm 缺失或结构校验失败；其前置 AGC 二进制证书工单见 docs/ACL申请清单-v2.md A1）；'
    + '路径 B 未就位（dsh-dist 下未物化 pnpm JS，需 collect-dsh 物化）；'
    + '路径 C 不可用（设备第三方 node/pnpm 缺失，或 node -e 探针不通过）';
  return failureResult(binDir, reason, diagnostics);
}

/**
 * 把探测结果格式化为带 `[dsh-harmony]` 前缀的日志行（FR-6.1 / FR-6.3）。
 * 采用路径时**显式**记录 source 与「设备环境」标注；失败时记录**可操作**的原因（禁止静默降级）。
 */
function formatDiagnostics(result) {
  const lines = result.diagnostics.slice();
  if (result.ok) {
    const device = result.deviceEnvironment
      ? '，source=device-environment，复用了设备环境运行时，非本应用保障'
      : `，source=${result.source}`;
    lines.push(`runtime 采用路径 ${result.path}（${pathLabel(result.path)}${device}）`);
    lines.push(`runtime PATH 前置=[${result.dirs.join(', ')}] PNPM_HOME=${result.pnpmHome ?? '(未设置)'}`);
  } else {
    lines.push(`runtime 不可用：${result.reason}`);
  }
  return lines.map((line) => `${LOG_PREFIX} ${line}`);
}

/**
 * 生成 `dsh` shim（每次启动**重写**，幂等；仅路径 A / C —— 存在可 exec 的 node）。
 * POSIX 以 `{ mode: 0o755 }` 创建，并做 best-effort `chmod`；本平台 `chmod` 由 B1 可能无效
 * （`13900012`），可执行位能否由 `writeFileSync` 的 mode 一次到位 `未验证`（真机 TC-D6）。
 * 任何失败只记日志、返回 `null`，绝不抛出。
 */
function writeShim(result, platform) {
  const shimName = isWin32(platform) ? 'dsh.cmd' : 'dsh';
  const shimPath = joinPath(platform, result.binDir, shimName);
  try {
    fs.mkdirSync(result.binDir, { recursive: true });
    const content = dshShim(result.nodeFile, result.dshRoot, platform);
    if (isWin32(platform)) {
      fs.writeFileSync(shimPath, content);
    } else {
      fs.writeFileSync(shimPath, content, { mode: 0o755 });
      try {
        fs.chmodSync(shimPath, 0o755);
      } catch (err) {
        console.warn(`${LOG_PREFIX} dsh shim chmod 失败（B1 下可能预期，忽略）: ${err && err.message ? err.message : String(err)}`);
      }
    }
    return shimPath;
  } catch (err) {
    console.warn(`${LOG_PREFIX} dsh shim 生成失败，市场安装通道可能不可用: ${err && err.message ? err.message : String(err)}`);
    return null;
  }
}

/**
 * 运行时供给入口：探测 → 校验 → 生成 shim → 前置 PATH / 设置 PNPM_HOME → 记录日志。
 *
 * 幂等，每次启动调用；**绝不抛异常出本函数**（spec FR-2.1 / plan §3.3「失败处置」）。
 * 失败只影响市场安装通道，不阻塞应用启动。
 *
 * @param {{platform?:string, arch?:string, env?:object, userData?:string, dshRoot?:string,
 *   home?:string, hnpPublicHome?:string, deviceNodeDirs?:string[]}} [options]
 * @returns {object} 探测结果（含采用的路径 / 注入目录 / 失败原因），供 FR-6.3 探针读取。
 */
function setupMarketRuntime(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const env = options.env ?? process.env;
  let result;
  try {
    let userData = options.userData;
    if (userData === undefined) {
      // 按需 require electron：本模块在裸 Node（单测）下可被 require 而不拉入 Electron。
      const { app } = require('electron');
      userData = app.getPath('userData');
    }
    const dshRoot = options.dshRoot ?? joinPath(platform, userData, 'dsh-dist');
    result = discoverMarketRuntime({
      platform,
      arch,
      env,
      userData,
      dshRoot,
      home: options.home ?? env.HOME ?? env.USERPROFILE,
      hnpPublicHome: options.hnpPublicHome,
      deviceNodeDirs: options.deviceNodeDirs,
    });

    let shimPath = null;
    if (result.shim && result.nodeFile) {
      shimPath = writeShim(result, platform);
      if (shimPath !== null) {
        result.diagnostics.push(`dsh shim 已写入 ${shimPath}（mode 0o755，每次启动重写）`);
      }
    }

    if (result.dirs.length > 0) {
      const merged = composePath(result.dirs, env.PATH, platform);
      if (merged !== '') env.PATH = merged;
    }
    if (result.ok && result.pnpmHome) {
      env.PNPM_HOME = result.pnpmHome;
    }

    for (const line of formatDiagnostics(result)) {
      // 一律走 console.warn：**鸿蒙 hilog 只收 `console.log`/`console.warn`，不收 `console.error`**
      // （2026-09-22 真机实验证实：同一次 `--inspect` 里 log/warn 两条都进了 hilog，error 一条没有）。
      // 失败诊断恰恰是运维最需要看见的那一条，故不得用 console.error —— 否则
      // `hilog | grep dsh-harmony` 这个本工程唯一的排查通道会把它丢掉（FR-6.1 / AC-18）。
      console.warn(line);
    }

    // FR-6.3：供 `--inspect`（CDP Runtime.evaluate）读回的诊断探针。失败不影响启动。
    try {
      globalThis.__marketRuntime = {
        path: result.path,
        ok: result.ok,
        source: result.source,
        deviceEnvironment: result.deviceEnvironment,
        pnpmHome: result.pnpmHome,
        pnpmHomeEnv: env.PNPM_HOME ?? null,
        nodeFile: result.nodeFile,
        pnpmFile: result.pnpmFile,
        pnpmJsEntry: result.pnpmJsEntry,
        shimPath,
        pathEnv: env.PATH,
        execPath: process.execPath,
        argv0: process.argv0,
        diagnostics: formatDiagnostics(result),
      };
    } catch (err) {
      console.warn(`${LOG_PREFIX} __marketRuntime 探针写入失败（忽略）: ${err && err.message ? err.message : String(err)}`);
    }
    return result;
  } catch (err) {
    // 兜底：任何未预期异常都不得逃出本函数（不阻塞应用启动）。
    const message = err && err.message ? err.message : String(err);
    // 同上前提：必须用 console.warn，console.error 在设备上不进 hilog。
    console.warn(`${LOG_PREFIX} 运行时供给失败（不阻塞启动）: ${message}`);
    const reason = `运行时供给内部错误：${message}`;
    const fallback = failureResult(options.userData ? joinPath(platform, options.userData, RUNTIME_BIN_DIRNAME) : '', reason, [reason]);
    try {
      globalThis.__marketRuntime = { path: null, ok: false, reason, diagnostics: formatDiagnostics(fallback) };
    } catch (probeErr) {
      console.warn(`${LOG_PREFIX} __marketRuntime 探针写入失败（忽略）: ${probeErr && probeErr.message ? probeErr.message : String(probeErr)}`);
    }
    return fallback;
  }
}

module.exports = {
  // 运行期入口
  setupMarketRuntime,
  // 纯逻辑（单测直接驱动）
  discoverMarketRuntime,
  isUsableExecutable,
  isExecutableFile,
  isParsableJs,
  isValidElf,
  dshShim,
  composePath,
  formatDiagnostics,
  probeNodeExec,
  // 常量（单测 / 构建期复用）
  LOG_PREFIX,
  DEFAULT_HNP_PUBLIC_HOME,
  RUNTIME_BIN_DIRNAME,
  DSH_CLI_REL,
  BUNDLED_PNPM_PACKAGE,
  BUNDLED_PNPM_ENTRY_REL,
  DEVICE_NODE_DIR_CANDIDATES,
};
