/**
 * DeepSeek Harness 鸿蒙版 — Electron 主进程（Electron-on-鸿蒙 运行时）
 *
 * 与 deepseek-harness-desktop 的 main 进程（host.ts + index.ts）等价，但为 CommonJS 入口
 * （鸿蒙 Electron 示例用 require('electron')），dsh 的 ESM 产物经动态 import 加载。
 *
 * 部署形态：dsh 部署产物（dsh-dist/）先压缩为 dsh-dist.tar.gz 打入 resfile（避免 HAP 内
 * 5 万+ 小文件导致打包过慢/超限），首次启动解压到 userData/dsh-dist 后加载。
 */
'use strict';
const { app, BrowserWindow, Menu, screen } = require('electron');
const {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
  writeSync, openSync, closeSync, createReadStream,
} = require('node:fs');
const { createGunzip } = require('node:zlib');
const { join, dirname, delimiter } = require('node:path');
const { pathToFileURL } = require('node:url');
const { networkInterfaces } = require('node:os');

// ── 启动 loading 页 ─────────────────────────────────────────────────
// 首次启动解压 dsh-dist.tar.gz 耗时较长（~45s），期间用内联 loading 页提示用户等待初始化。
const LOADING_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Deepseek Harness Harmony</title>
  <style>
    html, body { height: 100%; margin: 0; }
    body {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      background: #0f1115; color: #e6e8ec; font-family: system-ui, -apple-system, sans-serif;
      gap: 20px;
    }
    .spinner {
      width: 40px; height: 40px; border-radius: 50%;
      border: 3px solid rgba(255,255,255,0.15); border-top-color: #4c9aff;
      animation: spin 0.9s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .title { font-size: 18px; font-weight: 600; }
    .hint { font-size: 13px; color: #8a9099; }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <div class="title">Deepseek Harness Harmony</div>
  <div class="hint">应用初始化中，请稍候…</div>
</body>
</html>`;
const LOADING_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent(LOADING_HTML);

// 渲染进程 preload 路径：crypto.randomUUID polyfill + __DSH_TRANSPORT__.ownsHost 声明
// 都在 preload 内完成（主世界、每页脚本之前执行，含 token 认证 303 跳转后的新文档）。
// 详见 renderer-preload.js 头注。用 __dirname 解析，与 dsh-dist.tar.gz 同目录打入 resfile。
const PRELOAD_PATH = join(__dirname, 'renderer-preload.js');

// 所有 BrowserWindow 共用的 webPreferences：本鸿蒙 Electron 分支的标准配置为
// nodeIntegration:true + contextIsolation:false（见 harmonypc-electron 运行时自带 main.js），
// preload 因此直接在主世界、页面脚本之前运行。
const DSH_WEB_PREFERENCES = {
  preload: PRELOAD_PATH,
  nodeIntegration: true,
  contextIsolation: false,
};

// ── dsh 部署产物路径 ─────────────────────────────────────────────────
const DSH_ARCHIVE = join(__dirname, 'dsh-dist.tar.gz');
let DSH_ROOT = null;

function getDshRoot() {
  return join(app.getPath('userData'), 'dsh-dist');
}

/**
 * 极简 ustar 流式解压（bsdtar --format=ustar，无符号链接、无 pax 扩展头，仅文件/目录）。
 * 用 createGunzip 流式解压，逐条目落盘，避免把 555MB 产物一次性载入内存（移动设备 OOM）。
 */
function extractTarGz(archivePath, destBase) {
  return new Promise((resolve, reject) => {
    const gunzip = createGunzip();
    const input = createReadStream(archivePath);
    let buf = Buffer.alloc(0);
    let offset = 0;
    let count = 0;
    let ended = false;

    const process = () => {
      while (!ended && buf.length - offset >= 512) {
        const header = buf.subarray(offset, offset + 512);
        if (header[0] === 0) { ended = true; break; } // 结束块
        const name = header.subarray(0, 100).toString('utf8').replace(/\0[\s\S]*$/, '');
        const prefix = header.subarray(345, 500).toString('utf8').replace(/\0[\s\S]*$/, '');
        const sizeStr = header.subarray(124, 136).toString('utf8').replace(/\0[\s\S]*$/, '').trim();
        const size = parseInt(sizeStr, 8) || 0;
        const typeflag = String.fromCharCode(header[156]);
        let fullName = prefix ? prefix + '/' + name : name;
        // tar 由 `-C <proj> dsh-dist` 打包，条目带 dsh-dist/ 前缀；解压目标已含该目录，剥掉避免双重前缀
        fullName = fullName.replace(/^\.\//, '').replace(/^dsh-dist\//, '');
        const dataStart = offset + 512;
        const paddedEnd = dataStart + Math.ceil(size / 512) * 512;
        if (buf.length < paddedEnd) break; // 等更多数据
        if (fullName && !fullName.endsWith('/')) {
          const destPath = join(destBase, fullName);
          if (typeflag === '5') {
            mkdirSync(destPath, { recursive: true });
          } else if (typeflag === '0' || typeflag === '\u0000' || typeflag === '') {
            mkdirSync(dirname(destPath), { recursive: true });
            const fd = openSync(destPath, 'w');
            writeSync(fd, buf, dataStart, size);
            closeSync(fd);
            count++;
          }
        }
        offset = paddedEnd;
      }
      // 压缩缓冲区，释放已处理数据
      if (offset > 0) {
        buf = Buffer.from(buf.subarray(offset));
        offset = 0;
      }
    };

    gunzip.on('data', (chunk) => {
      buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
      process();
    });
    gunzip.on('end', () => resolve(count));
    gunzip.on('error', reject);
    input.on('error', reject);
    input.pipe(gunzip);
  });
}

/** 确保 dsh 产物就位（首次启动解压 tar.gz 到 userData/dsh-dist）。 */
async function ensureDshExtracted() {
  DSH_ROOT = getDshRoot();
  const marker = join(DSH_ROOT, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js');
  if (existsSync(marker)) {
    console.log('[dsh-harmony] dsh 产物已就位，跳过解压');
    return true;
  }
  if (!existsSync(DSH_ARCHIVE)) {
    console.error('[dsh-harmony] dsh-dist.tar.gz 缺失');
    globalThis.__extractError = 'archive-missing';
    return false;
  }
  console.log('[dsh-harmony] 首次启动，解压 dsh-dist.tar.gz →', DSH_ROOT);
  try {
    mkdirSync(DSH_ROOT, { recursive: true });
    const count = await extractTarGz(DSH_ARCHIVE, DSH_ROOT);
    console.log('[dsh-harmony] 解压完成，文件数:', count);
    return true;
  } catch (err) {
    console.error('[dsh-harmony] 解压失败:', err);
    const { inspect } = require('node:util');
    globalThis.__extractError = inspect(err, { depth: 4, colors: false }).slice(0, 400);
    return false;
  }
}

const DSH_CLI_LIB = () => join(DSH_ROOT, 'lib');
const DSH_APP_BOOT_LIB = () => join(DSH_ROOT, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js');
const DESKTOP_PROFILE_SRC = () => join(DSH_ROOT, 'profiles', 'desktop');

/**
 * HarmonyOS 运行时补丁：禁用 agent preset 中依赖 shell/subprocess/pty（node-pty 原生模块，MVP
 * 已禁用）的工具行。agent preset 由 cordis Include 在会话创建时直接组合成独立 EntryTree，host 的
 * cordis.patch.yml 管不到；这些工具行会无限等待被禁的 shell/subprocess 服务，导致 preset 挂载失败、
 * session.create 报 agent-preset-invalid（工作区选不中、点聊天反复弹「选择工作区」）。preset 审计
 * inactiveRows 会跳过 disabled: true 的行，禁用后 preset 可正常挂载。幂等：已禁用则不重复改写。
 */
const HARMONY_DISABLED_PRESET_ROWS = {
  'tool-bash': 'bash 终端依赖 shell/node-pty（MVP 已禁用）',
  'tool-fs-search': '内容搜索依赖 subprocess 跑 ripgrep（node-pty 已禁用）',
  'persistent-shell': '持久 shell 依赖 pty（node-pty 已禁用）',
};

/**
 * HarmonyOS 运行时补丁：补齐 preset 中本应用需要、但上游 preset 未挂载的工具行（顶层追加）。
 *
 * `tool-str-replace-editor` 是纯 JS 工具（inject ['tools','fs']，无 subprocess / 原生模块依赖），
 * 其 `view` 命令对目录会经 ctx.fs.listDir 列出 2 层内容 —— 在 tool-fs-search（ripgrep +
 * subprocess）被禁用的前提下，这是唯一可用的「列目录」入口。
 *
 * `requireRow` 限定只加到已挂载该行的 preset 上：standard / ptc / cordis 有 `tool-fs`；
 * `minimal` 是固定的双工具训练配置，不追加。
 *
 * `fs-mutate`（harmony-plugin-fs-mutate）是本工程专用插件，由本工程 plugins/ 经 collect-dsh.mjs
 * 的 collectPlugins() 物化到 dsh-dist/node_modules，故 name 用裸包名；它经围栏原语 ctx.fs.remove
 * 补齐 delete / move —— 上游 tool-fs 只有读写，删除/移动此前在鸿蒙侧没有入口。
 *
 * `fs-search`（harmony-plugin-fs-search）同理：纯 JS 内容搜索，经 ctx.fs.listDir + readText 遍历，
 * 不依赖 subprocess / ripgrep 二进制 —— 上游 tool-fs-search 在鸿蒙上装不起来（见其被禁原因）。
 *
 * 本表与 collect-dsh.mjs 的 HARMONY_ENSURED_PRESET_ROWS 逐条镜像，改动需同时改两处 —— 该一致性
 * 由 collect-dsh.mjs 的 assertPresetRowsMirrorMainJs() 在构建期机械互校（不等即构建失败），
 * 不再只靠这条注释。
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
    reason: 'HarmonyOS: 经围栏 ctx.fs 原语补齐 delete / move / copy / chmod（纯 JS，本工程 plugins 物化）',
  },
  {
    id: 'fs-search',
    name: 'harmony-plugin-fs-search',
    requireRow: 'tool-fs',
    reason: 'HarmonyOS: 纯 JS 内容搜索（替代依赖 subprocess 与 ripgrep 二进制的 tool-fs-search）',
  },
];

const HARMONY_TOP_ROW_RE = /^- id: ([A-Za-z0-9_-]+)\s*$/;
const HARMONY_MARKER = '# HarmonyOS:';

/** preset 顶层（列 0）是否已有该 id 的行；group 内 4 空格缩进的嵌套行不算。 */
function hasTopLevelPresetRow(lines, id) {
  for (const line of lines) {
    const m = HARMONY_TOP_ROW_RE.exec(line);
    if (m !== null && m[1] === id) return true;
  }
  return false;
}

function ensurePresetRows(out) {
  let ensured = 0;
  for (const spec of HARMONY_ENSURED_PRESET_ROWS) {
    if (spec.requireRow !== undefined && !hasTopLevelPresetRow(out, spec.requireRow)) continue;
    if (hasTopLevelPresetRow(out, spec.id)) continue;
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
    out.push('', `# ${spec.reason}`, `- id: ${spec.id}`, `  name: '${spec.name}'`, '');
    ensured++;
  }
  return ensured;
}

function patchAgentPresetsRuntime() {
  const { readdirSync: rd, existsSync: ex, readFileSync: rf, writeFileSync: wf } = require('node:fs');
  // dsh ≥ 0.1.2 ships presets inside the agent-presets package (SHIPPED_PRESET_ROOT =
  // `<pkg>/presets/`); earlier builds kept them under config/agent-presets. Use whichever exists.
  const presetsDir = [
    join(DSH_ROOT, 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets'),
    join(DSH_ROOT, 'config', 'agent-presets'),
  ].find(ex);
  if (presetsDir === undefined) return;
  let total = 0;
  let ensuredTotal = 0;
  for (const name of rd(presetsDir)) {
    const file = join(presetsDir, name, 'agent.cordis.yml');
    if (!ex(file)) continue;
    const lines = rf(file, 'utf8').split('\n');
    const out = [];
    const totalBefore = total;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      out.push(line);
      const m = HARMONY_TOP_ROW_RE.exec(line);
      const reason = m ? HARMONY_DISABLED_PRESET_ROWS[m[1]] : undefined;
      if (reason === undefined) continue;
      // 收集该顶层 row 的 2 空格缩进行（4 空格 config 嵌套内容不计入）。
      const block = [];
      let j = i + 1;
      while (j < lines.length && /^  \S/.test(lines[j])) { block.push(lines[j]); j++; }
      const hasDisabled = block.some(b => /^  disabled:/.test(b));
      let inserted = false;
      for (const b of block) {
        if (/^  disabled:/.test(b)) {
          if (b.includes(HARMONY_MARKER)) { out.push(b); continue; }
          out.push(`  disabled: true ${HARMONY_MARKER} ${reason}`);
          total++;
        } else {
          out.push(b);
          if (!hasDisabled && !inserted && /^  name:/.test(b)) {
            out.push(`  disabled: true ${HARMONY_MARKER} ${reason}`);
            inserted = true; total++;
          }
        }
      }
      i = j - 1;
    }
    const ensured = ensurePresetRows(out);
    ensuredTotal += ensured;
    if (total > totalBefore || ensured > 0) {
      wf(file, out.join('\n'));
      console.log(`[dsh-harmony] preset ${name} 已适配：禁用 ${total - totalBefore} 行、补齐 ${ensured} 行`);
    }
  }
  if (total > 0 || ensuredTotal > 0) {
    console.log('[dsh-harmony] agent preset 运行时补丁完成，禁用', total, '个工具行，补齐', ensuredTotal, '个工具行');
  }
}

/** 在 dsh CLI lib 中定位 profile-boot 薄入口（re-export runProfile）。 */
function findProfileBootEntry() {
  try {
    const candidates = [];
    for (const file of readdirSync(DSH_CLI_LIB())) {
      if (!file.startsWith('profile-boot-') || !file.endsWith('.js')) continue;
      const fullPath = join(DSH_CLI_LIB(), file);
      const content = readFileSync(fullPath, 'utf8');
      if (content.includes('export { runProfile') && content.length < 300) {
        candidates.push({ path: fullPath, mtime: statSync(fullPath).mtimeMs });
      }
    }
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0]?.path ?? null;
  } catch (err) {
    console.error('[dsh-harmony] findProfileBootEntry 失败:', err);
    return null;
  }
}

/** 将 desktop profile 安装到 $DSH_HOME/profiles/desktop（幂等）。 */
function ensureDesktopProfile(home) {
  const src = DESKTOP_PROFILE_SRC();
  const dest = join(home, 'profiles', 'desktop');
  const srcPkg = join(src, 'package.json');
  if (!existsSync(srcPkg)) return;
  try {
    mkdirSync(dest, { recursive: true });
    const destPkg = join(dest, 'package.json');
    if (!existsSync(destPkg)) { cpSync(src, dest, { recursive: true }); return; }
    const seed = JSON.parse(readFileSync(srcPkg, 'utf8'));
    const cur = JSON.parse(readFileSync(destPkg, 'utf8'));
    let changed = false;
    cur.dependencies ??= {};
    for (const [name, spec] of Object.entries(seed.dependencies ?? {})) {
      if (!(name in cur.dependencies)) { cur.dependencies[name] = spec; changed = true; }
    }
    cur.dsh ??= {};
    cur.dsh.profile ??= {};
    const curBundles = cur.dsh.profile.bundles ?? [];
    for (const b of seed.dsh?.profile?.bundles ?? []) {
      if (!curBundles.includes(b)) { curBundles.push(b); changed = true; }
    }
    cur.dsh.profile.bundles = curBundles;
    if (changed) writeFileSync(destPkg, JSON.stringify(cur, null, 2) + '\n');
    for (const name of readdirSync(src)) {
      if (name === 'package.json') continue;
      const df = join(dest, name);
      // 种子文件（cordis.patch.yml 等）始终用最新版覆盖，确保桌面壳的 patch 层
      // （如 webserver host 覆盖）在应用升级后仍能生效（package.json 单独合并以保留用户插件）。
      cpSync(join(src, name), df, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('[dsh-harmony] ensureDesktopProfile 失败:', err);
  }
}

/** 将 dshmarket 复制到 $DSH_HOME/profiles/node_modules/dshmarket（复制而非 symlink）。 */
function ensureDshMarketProfileLink(home) {
  const src = join(DSH_ROOT, 'node_modules', 'dshmarket');
  if (!existsSync(join(src, 'package.json'))) return;
  const dest = join(home, 'profiles', 'node_modules', 'dshmarket');
  if (existsSync(join(dest, 'package.json'))) return;
  try {
    mkdirSync(join(home, 'profiles', 'node_modules'), { recursive: true });
    cpSync(src, dest, { recursive: true, dereference: true });
    console.log('[dsh-harmony] 已复制 dshmarket → profiles/node_modules');
  } catch (err) {
    console.error('[dsh-harmony] dshmarket 复制失败（不阻塞）:', err.message);
  }
}

/**
 * 将本工程专用插件（dsh-dist/node_modules/harmony-plugin-*）复制到 $DSH_HOME/profiles/node_modules/。
 *
 * 必要性：agent preset 行的可解析性由 dsh-agent-presets 的 discovery 判定 —— 对**裸包名**，它从
 * `ctx.baseUrl`（即本 profile 目录 `$DSH_HOME/profiles/desktop`）向上走 `node_modules` 找
 * `<pkg>/package.json`（`packageInstalled()`）。profile 目录下只有 dsh-dist 那套 `@deepseek-ai/*`
 * 依赖闭包与 dshmarket，因此 **scoped 行能解析、而只存在于 `dsh-dist/node_modules` 的裸名
 * `harmony-plugin-*` 会被判定为 "cannot be resolved"** → 整份 preset 变 broken →
 * `session.create` 报 `agent-preset/invalid`（表现为「新建会话」与「发消息」一起失效）。
 * 与 dshmarket 同法：**复制而非 symlink** —— 鸿蒙沙箱禁止 symlink（EACCES）。
 *
 * 与 dshmarket 的差异：本函数**每次启动都覆盖复制**。dshmarket 采用「已存在即跳过」，但专用插件的内容
 * 随 HAP 迭代，跳过会让 profile 侧 pin 住旧版本（复制进 dsh-dist 的 package.json 已出现过落后于源的情况）。
 * 插件是纯 JS、体量数 KB，覆盖成本可忽略。
 *
 * 末尾附带**同族陈旧目录清理**：`profiles/node_modules` 下匹配 `dsh-plugin-*` / `harmony-plugin-*`
 * 但不在本次源集合中的目录会被移除，使 profile 侧忠实镜像 dsh-dist 侧，并消除「旧包残留 + 旧 preset 行
 * 仍能解析 → 静默加载过期插件」这一最难排查的状态（改名类变更必然产生此类残留）。
 * 清理失败**不中断启动**：该目录已无引用者，属卫生动作，不值得把可用的应用变成起不来的应用。
 */
function ensureDshPluginsProfileLink(home) {
  const destRoot = join(home, 'profiles', 'node_modules');
  // 覆盖改名前后两代的命名，用于识别「同族」目录。
  const isPluginName = (n) => n.startsWith('dsh-plugin-') || n.startsWith('harmony-plugin-');
  let names;
  try {
    names = readdirSync(join(DSH_ROOT, 'node_modules')).filter((n) => n.startsWith('harmony-plugin-'));
  } catch (err) {
    console.error('[dsh-harmony] 读取 dsh-dist/node_modules 失败，专用插件未物化:', err.message);
    return;
  }
  // 源集合为空即返回（含不清理）：此时无法区分「确实没有插件」与「设备仍是旧 tar」，
  // 而剪除旧名副本会使旧 tar 烘焙的旧 preset 行不可解析 → 会话创建失败。故刻意保守，
  // 宁留无引用者的陈旧副本，也不制造不可用的会话入口（代价见 spec §6）。
  if (names.length === 0) return;
  // 保留集取**实际复制成功**者：源里缺 package.json 的目录贴不出去，不该被保留成镜像外残留。
  const copied = [];
  for (const name of names) {
    const src = join(DSH_ROOT, 'node_modules', name);
    if (!existsSync(join(src, 'package.json'))) continue;
    const dest = join(destRoot, name);
    try {
      mkdirSync(destRoot, { recursive: true });
      // 先删后拷：`force` 只覆盖同名文件，源里删掉的文件会留在目标，导致目标与源不一致。
      rmSync(dest, { recursive: true, force: true });
      cpSync(src, dest, { recursive: true, force: true, dereference: true });
      copied.push(name);
      console.log('[dsh-harmony] 已复制', name, '→ profiles/node_modules');
    } catch (err) {
      // 复制失败 ⇒ preset 行不可解析 ⇒ 会话无法创建，必须响亮（不能沿用 dshmarket 的「不阻塞」）。
      console.error('[dsh-harmony] ' + name + ' 复制失败，agent preset 将不可用:', err.message);
    }
  }
  // 陈旧清理：源集合之外的同族目录一律移除（改名、删插件后必然产生）。
  if (!existsSync(destRoot)) return;
  try {
    const keep = new Set(copied);
    for (const entry of readdirSync(destRoot)) {
      if (!isPluginName(entry) || keep.has(entry)) continue;
      rmSync(join(destRoot, entry), { recursive: true, force: true });
      console.log('[dsh-harmony] 已清理陈旧插件目录', entry, '← profiles/node_modules');
    }
  } catch (err) {
    console.warn('[dsh-harmony] 清理陈旧插件目录失败（不影响启动）:', err.message);
  }
}

/**
 * 选择一个渲染进程可访问的 host：优先局域网 IPv4，其次 127.0.0.1。
 * 鸿蒙 NEXT 下渲染进程访问 loopback 可能被网络隔离，故用局域网 IP。
 */
function pickReachableHost() {
  try {
    const ifaces = networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const info of ifaces[name] ?? []) {
        if (info.family === 'IPv4' && !info.internal && info.address) {
          return info.address;
        }
      }
    }
  } catch { /* ignore */ }
  return '127.0.0.1';
}

/** 启动 dsh Host（desktop profile，进程内）。返回 { ctx, shutdown, port, url } 或 null。 */
async function startHost() {
  const entry = findProfileBootEntry();
  if (!entry) {
    console.error('[dsh-harmony] dsh 未构建或产物缺失，宿主未启动');
    return null;
  }
  if (!process.env.DSH_HOME) {
    process.env.DSH_HOME = join(app.getPath('userData'), '.dsh');
  }
  console.log('[dsh-harmony] DSH_HOME =', process.env.DSH_HOME);
  ensureDesktopProfile(process.env.DSH_HOME);
  ensureDshMarketProfileLink(process.env.DSH_HOME);
  ensureDshPluginsProfileLink(process.env.DSH_HOME);
  // 用户目录写入白名单：必须在 runProfile 之前设置，writableRoots 每次围栏判定都读它。
  installExtraWritableRoots();
  process.env.DSH_DISABLE_HMR = '1';
  // 技能目录：故意放在 dsh-dist.tar.gz 之外（与 main.js 同目录），只换 HAP 即可更新技能。
  // 上游 skill-filesystem 读 DSH_BUNDLED_SKILL_DIR 作为 bundled default root（rank 600）；
  // 不设它，preset 虽已挂载 skill-filesystem/tool-skill，skill 工具面对的仍是空目录。
  const bundledSkills = join(__dirname, 'skills');
  if (existsSync(bundledSkills)) {
    process.env.DSH_BUNDLED_SKILL_DIR = bundledSkills;
    console.log('[dsh-harmony] DSH_BUNDLED_SKILL_DIR =', bundledSkills);
  } else {
    console.warn('[dsh-harmony] skills 目录缺失，skill 工具将无可用技能:', bundledSkills);
  }
  // 禁用 agent preset 中依赖 shell/subprocess/pty 的工具行（node-pty MVP 已禁用），
  // 否则 standard preset 挂载失败 → session.create 报 agent-preset-invalid → 无法选中工作区/开会话。
  patchAgentPresetsRuntime();

  try {
    const profileBoot = await import(pathToFileURL(entry).href);
    const appBoot = await import(pathToFileURL(DSH_APP_BOOT_LIB()).href);
    const runProfile = profileBoot.runProfile;
    const loadLayeredEnv = appBoot.loadLayeredEnv;

    const { ctx, shutdown } = await runProfile({
      environment: loadLayeredEnv('dsh'),
      profile: 'desktop',
      patchFiles: [],
      // 绑定 0.0.0.0（已 patch 掉 dsh 的 0.0.0.0 拒绝检查）：鸿蒙 NEXT 下 Chromium
      // 渲染进程访问 127.0.0.1 存在 loopback 网络隔离，改绑全部网卡 + 渲染进程走局域网 IP。
      args: ['--port', '0', '--host', '0.0.0.0'],
    });
    if (!ctx.webServer) {
      let keys = '';
      try { keys = Object.keys(ctx).join(','); } catch (e) { keys = '(keys fail: ' + String(e) + ')'; }
      let zstd = '?';
      try { zstd = typeof require('node:zlib').createZstdDecompress; } catch (e) { zstd = 'err:' + String(e); }
      globalThis.__hostError = 'webServer undefined | zlib.zstd=' + zstd + ' | ctx keys: ' + keys;
      console.error('[dsh-harmony] ctx.webServer 缺失, zlib.zstd=' + zstd + ', ctx keys:', keys);
      return null;
    }
    const port = ctx.webServer.port;
    const host = pickReachableHost();
    const baseUrl = 'http://' + host + ':' + port + '/';
    // dsh（rc.1，2026-08-24 browser-token-authentication 起）对 Web UI 根路径启用浏览器会话
    // token 认证：首次加载必须携带 ?token=<launchToken>（由 ctx.connection.authenticatedUrl 生成），
    // 服务端校验后下发绑定 authority 的签名 cookie 并重定向到干净的 /；裸 / 一律返回 401。
    // 内嵌渲染进程与 Host 同机、可信，故直接用进程 launchToken 生成认证 URL。token 交换发生在
    // Host 头被改写为 127.0.0.1:<port> 之后，cookie 的 authority 与后续请求的改写 Host 一致。
    let url = baseUrl;
    try {
      if (ctx.connection && typeof ctx.connection.authenticatedUrl === 'function') {
        url = ctx.connection.authenticatedUrl(baseUrl);
      } else {
        console.error('[dsh-harmony] ctx.connection.authenticatedUrl 不可用，回退裸 URL（可能 401）');
      }
    } catch (e) {
      console.error('[dsh-harmony] authenticatedUrl 生成失败，回退裸 URL:', e);
    }
    console.log('[dsh-harmony] host 就绪: ' + baseUrl);
    return {
      ctx,
      shutdown: (code) => shutdown.shutdown(code ?? 0),
      port,
      url,
    };
  } catch (err) {
    console.error('[dsh-harmony] host 启动失败:', err);
    const { inspect } = require('node:util');
    // 扁平化提取 AggregateError 链上的所有错误消息（含 cause 与 errors 数组）
    const msgs = [];
    const visit = (e, d) => {
      if (!e || d > 6) return;
      if (e.errors && Array.isArray(e.errors)) {
        for (const sub of e.errors) {
          if (sub && sub.message) msgs.push(sub.message.split('\n')[0]);
          visit(sub, d + 1);
        }
      }
      if (e.cause) visit(e.cause, d + 1);
    };
    visit(err, 0);
    globalThis.__hostError = (msgs.length ? msgs.join(' || ') : inspect(err, { depth: 4, colors: false })).slice(0, 2500);
    return null;
  }
}

// ── 生命周期 ──────────────────────────────────────────────────────────
process.on('uncaughtException', (err) => console.error('[dsh-harmony] uncaughtException:', err));
process.on('unhandledRejection', (reason) => console.error('[dsh-harmony] unhandledRejection:', reason));

// loopback 代理绕过：渲染进程加载 127.0.0.1 同源，避免被系统代理劫持（对齐 desktop lifecycle.ts）
function ensureLoopbackNoProxy() {
  const loopback = ['127.0.0.1', 'localhost', '::1'];
  for (const key of ['NO_PROXY', 'no_proxy']) {
    const existing = (process.env[key] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const next = new Set(existing);
    for (const host of loopback) next.add(host);
    process.env[key] = [...next].join(',');
  }
  app.commandLine.appendSwitch('proxy-bypass-list', '<-loopback>');
}
ensureLoopbackNoProxy();

// ── 沙箱 HOME 修正 ─────────────────────────────────────────────────────
// 鸿蒙沙箱中 Node 的 os.homedir() 解析 HOME/getpwuid 得到 /storage/Users/currentUser
// （沙箱外的系统用户目录，应用无权访问，读它抛 EPERM）。dsh 的目录浏览器
// （directory-picker-browse）以 homedir() 作为「选择工作区」的起始目录，导致
// 一打开就报 `cannot list /storage/Users/currentUser: EPERM: operation not permitted`。
// 把 HOME 显式指向应用沙箱可写的 files 目录（userData），homedir() 即返回沙箱内路径，
// os.homedir() 在 POSIX 下优先取 HOME 环境变量。必须在 dsh Host 启动（任何 homedir() 调用）前设置。
function ensureSandboxHome() {
  try {
    const home = app.getPath('userData');
    process.env.HOME = home;
    process.env.USERPROFILE = home; // 兼容 Windows 风格探测（鸿蒙 Node 以 POSIX 为主）
    console.log('[dsh-harmony] HOME 已指向沙箱目录:', home, '| homedir() =', require('node:os').homedir());
  } catch (err) {
    console.error('[dsh-harmony] ensureSandboxHome 失败:', err);
  }
}

// 真实用户家目录（/storage/Users/currentUser）：必须在 ensureSandboxHome() 覆盖 HOME 之前抓取，
// 之后 homedir() 已指向沙箱内路径，再也看不到用户目录的父目录。供 installExtraWritableRoots() 使用。
const USER_HOME_BEFORE_SANDBOX = (() => {
  try { return require('node:os').homedir(); } catch { return null; }
})();

/**
 * 把用户已授权的桌面/文档/下载目录写进 DSH 沙箱的可写白名单（`DSH_EXTRA_WRITABLE_ROOTS`）。
 *
 * 背景：应用已在 module.json5 声明 READ_WRITE_{DOWNLOAD,DOCUMENTS,DESKTOP}_DIRECTORY，系统层授权是
 * 生效的，但这些目录不在 DSH 的 workspace-write 白名单里（白名单只有会话工作区 + 临时目录），于是每次
 * 写入都要过一次提权审批。把目录一次性写进白名单即可免去逐次审批（上游 writableRoots 读该变量）。
 *
 * 该变量是**部署期状态、不是模型输入**：组合里没有任何能力能设置它，模型无法自行扩大可写面。
 * 显式给出的 DSH_EXTRA_WRITABLE_ROOTS 优先，此时不再自动探测。列出的目录**不按存在性过滤**，
 * 原因见函数体内注释（首次授权弹窗的时序会漏配）。
 */
function installExtraWritableRoots() {
  if (process.env.DSH_EXTRA_WRITABLE_ROOTS) {
    console.log('[dsh-harmony] DSH_EXTRA_WRITABLE_ROOTS 由环境指定，跳过用户目录探测:', process.env.DSH_EXTRA_WRITABLE_ROOTS);
    return;
  }
  if (!USER_HOME_BEFORE_SANDBOX) {
    console.warn('[dsh-harmony] 未取到用户家目录，用户目录未加入可写白名单');
    return;
  }
  const candidates = ['Desktop', 'Documents', 'Download'].map((name) => join(USER_HOME_BEFORE_SANDBOX, name));
  // 白名单**不按存在性过滤**：READ_WRITE_*_DIRECTORY 是 normal 权限，首次访问才弹窗授予，启动瞬间
  // stat 可能失败 —— 若据此把目录排除，用户随后授权的目录会被漏掉，E2 静默失效。多列出的路径在围栏
  // 里匹配不到任何目标，无害。存在性只用于日志，便于真机排查。
  const reachable = candidates.filter((dir) => {
    try { return existsSync(dir); } catch { return false; }
  });
  process.env.DSH_EXTRA_WRITABLE_ROOTS = candidates.join(delimiter);
  console.log('[dsh-harmony] DSH_EXTRA_WRITABLE_ROOTS =', process.env.DSH_EXTRA_WRITABLE_ROOTS,
    '| 启动时可达:', reachable.length > 0 ? reachable.join(', ') : '(均不可达，用户目录权限可能尚未授予)');
}
ensureSandboxHome();

/**
 * 渲染进程请求头改写：让发往 dsh webserver 的请求在 Host 围栏看来来自 loopback。
 *
 * 背景：鸿蒙 NEXT 下 Chromium 渲染进程访问 127.0.0.1 被进程间网络隔离拦截，故 webserver
 * 绑 0.0.0.0、渲染进程走局域网 IP（http://192.168.x.x:port）加载。dsh 的 client-connection
 * 安全围栏把 settings.describe / credentials.* / host.pickDirectory / host.openPath /
 * agentPreset.* 等「特权方法」锁定为 loopback-only（见 dsh 源码 PRIVILEGED_METHODS：
 * 这些方法读取/修改用户配置与密钥，非 loopback 来源一律 HTTP 403）。普通方法因局域网 IP
 * 经 resolveLanTrust 自动加入 trustedHosts 而正常，唯独特权方法在局域网 Host 头下 403。
 *
 * 修复：渲染进程本就是与 Host 同机的内嵌浏览器（可信），在其请求出栈前把 Host/Origin
 * 改写为 127.0.0.1:<port>。TCP 连接仍打到局域网 IP（不受 loopback 隔离影响），仅 HTTP
 * Host 头变为 loopback，围栏据此放行。此改写只作用于本应用内嵌渲染进程的 session，
 * 不影响 webserver 对局域网内其他设备的行为——它们的请求不经过此 session，特权方法对其
 * 依然 403，安全围栏语义不变。
 */
function installLoopbackHeaderRewrite(win, port) {
  const loopbackAuthority = '127.0.0.1:' + String(port);
  try {
    win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = details.requestHeaders ?? {};
      let target = null;
      try { target = new URL(details.url); } catch { /* 非 http(s)/ws URL（data: 等）跳过 */ }
      // 必须同时覆盖 ws:/wss:：Gateway 的事件流走 WebSocket 升级（/api/remote.mux），
      // 其 URL 协议为 ws:，若不纳入，WS 握手的 Host/Origin 不会被改写为 loopback，
      // 服务端按局域网 Host 校验 authority-bound 认证 cookie / Origin 围栏会拒绝握手（net::ERR_FAILED）。
      if (target !== null
          && (target.protocol === 'http:' || target.protocol === 'https:'
              || target.protocol === 'ws:' || target.protocol === 'wss:')
          && target.port === String(port)) {
        headers.Host = loopbackAuthority;
        // 同源请求浏览器会带 Origin（POST fetch / WS 升级）；改写为 loopback 以通过围栏的 Origin 比对。
        // WS 升级的 Origin 是页面来源（http），改写为 http://127.0.0.1:<port> 与改写后的 Host 一致。
        if (typeof headers.Origin === 'string' && headers.Origin.length > 0) {
          const pageScheme = (target.protocol === 'wss:') ? 'https' : 'http';
          headers.Origin = pageScheme + '://' + loopbackAuthority;
        }
      }
      callback({ requestHeaders: headers });
    });
    console.log('[dsh-harmony] 已安装渲染进程 Host→loopback 改写，端口', port);
  } catch (err) {
    console.error('[dsh-harmony] webRequest 头改写安装失败:', err);
  }
}

// ── 主窗口状态持久化 + F11 全屏 ─────────────────────────────────────
// 记录最大化/普通（普通时含位置与尺寸），下次启动恢复；F11 切换全屏。
function windowStateFile() {
  return join(app.getPath('userData'), 'window-state.json');
}

function isVisibleOnSomeDisplay(bounds) {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const overlapX = Math.max(
      0,
      Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x),
    );
    const overlapY = Math.max(
      0,
      Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y),
    );
    return overlapX > 0 && overlapY > 0;
  });
}

function loadWindowState() {
  try {
    const raw = JSON.parse(readFileSync(windowStateFile(), 'utf8'));
    const width = typeof raw.width === 'number' && raw.width > 0 ? raw.width : 1200;
    const height = typeof raw.height === 'number' && raw.height > 0 ? raw.height : 800;
    const state = { width, height, isMaximized: raw.isMaximized === true };
    if (
      typeof raw.x === 'number' &&
      typeof raw.y === 'number' &&
      isVisibleOnSomeDisplay({ x: raw.x, y: raw.y, width, height })
    ) {
      state.x = raw.x;
      state.y = raw.y;
    }
    return state;
  } catch {
    return { width: 1200, height: 800, isMaximized: false };
  }
}

function saveWindowState(win) {
  if (win.isDestroyed()) return;
  const bounds = win.getNormalBounds();
  const state = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: win.isMaximized(),
  };
  try {
    mkdirSync(dirname(windowStateFile()), { recursive: true });
    writeFileSync(windowStateFile(), JSON.stringify(state), 'utf8');
  } catch (err) {
    console.error('[dsh-harmony] 保存窗口状态失败:', err);
  }
}

function trackWindowState(win) {
  let timer = null;
  const scheduleSave = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => saveWindowState(win), 400);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('maximize', scheduleSave);
  win.on('unmaximize', scheduleSave);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    saveWindowState(win);
  });
}

function installFullscreenShortcut(win) {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.code === 'F11' || input.key === 'F11')) {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });
}

// ── 状态栏（托盘）─────────────────────────────────────────────────
// ArkTS 侧早已随上游运行时进入 HAP（module.json5 里的 StatusBarEntryAbility、
// StatusBarManager 适配器），本轮新增的 TrayAdapter 只是它的「JSON 单入单出」门面：
// 既有 binding 的 SetImage 有 8 个参数（含 ArrayBuffer 与函数回调），超出通用桥
// 「≤3 参、仅原始类型」的限制，无法直接调用。
//
// 桥的两条硬性约束（D.2 第 7 条）：async 的 ArkTS 方法必须走 callArkTSAsyncFunction，
// 用另一入口会永久阻塞主进程；应用被挂起时调用同样会阻塞。这里三个入口都是同步方法，
// 且调用发生在启动期（应用必在前台），故安全。
const TRAY_ICON_FILE = 'electron_white.png';
const TRAY_MENU = [
  { commandId: 1, label: '显示主窗口' },
  { commandId: 2, label: '退出' },
];

async function installTray() {
  try {
    const { systemPreferences, nativeImage } = require('electron');
    if (!systemPreferences || typeof systemPreferences.callArkTSFunction !== 'function') {
      console.error('[dsh-harmony] 状态栏桥不可用，跳过托盘');
      return;
    }
    const iconPath = join(__dirname, TRAY_ICON_FILE);
    let icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      console.error('[dsh-harmony] 托盘图标读取失败: ' + iconPath);
      return;
    }
    // 状态栏图标按 16×16 交付（2in1 高 DPI 下对应 16 逻辑像素）。
    try {
      icon = icon.resize({ width: 16, height: 16 });
    } catch (e) {
      console.error('[dsh-harmony] 托盘图标缩放失败，改用原图: ' + e.message);
    }
    // 送原始 BGRA_8888 像素 + 显式尺寸，而不是 PNG：运行时自带的
    // StatusBarManagerAdapter 正是这样构造图标的（createPixelMapSync 配
    // InitializationOptions），也是框架图标路径所依据的形态。
    const size = icon.getSize();
    const payload = JSON.stringify({
      title: 'DeepSeek Harness',
      tooltips: 'DeepSeek Harness',
      quickOperationHeight: 100,
      iconRawBase64: icon.toBitmap().toString('base64'),
      iconWidth: size.width,
      iconHeight: size.height,
      menu: TRAY_MENU,
    });
    const raw = await systemPreferences.callArkTSFunction('HarmonyTray.Setup', 'string', [payload]);
    // 桥返回标签信封 { type, value }，取 value。
    let value = raw;
    if (raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'value')) {
      value = raw.value;
    }
    console.log('[dsh-harmony] 托盘安装结果: ' + String(value));
  } catch (e) {
    console.error('[dsh-harmony] 托盘安装异常: ' + (e && e.message ? e.message : String(e)));
  }
}

let host = null;

// 去掉 Electron 默认菜单
Menu.setApplicationMenu(null);

app.whenReady().then(async () => {
  let win;
  try {
    const savedState = loadWindowState();
    win = new BrowserWindow({
      width: savedState.width,
      height: savedState.height,
      ...(savedState.x !== undefined && savedState.y !== undefined
        ? { x: savedState.x, y: savedState.y }
        : {}),
      title: 'Deepseek Harness Harmony',
      autoHideMenuBar: true,
      webPreferences: DSH_WEB_PREFERENCES,
    });
    win.setWindowButtonVisibility(true);
    trackWindowState(win);
    installFullscreenShortcut(win);
    if (savedState.isMaximized) win.maximize();
  } catch (e) {
    globalThis.__winError = String(e && e.message ? e.message : e);
    console.error('[dsh-harmony] BrowserWindow 创建失败:', e);
    return;
  }

  // 先加载 loading 页（首装解压 + 启动 host 耗时较长，提示用户等待初始化）
  void win.loadURL(LOADING_URL);

  win.webContents.on('did-fail-load', (_e, code, desc, failedUrl) => {
    console.error('[dsh-harmony] failed to load ' + failedUrl + ': ' + code + ' ' + desc);
  });

  // 渲染进程引导（crypto.randomUUID polyfill + __DSH_TRANSPORT__.ownsHost）由 preload
  // 脚本在每页脚本之前注入主世界，无需也不应再用 dom-ready + executeJavaScript（那会与
  // dsh 客户端插件 apply() 的早期求值竞争，导致 isLoopback 被缓存为 false）。

  if (!(await ensureDshExtracted())) {
    console.error('[dsh-harmony] dsh 产物解压失败');
  }

  host = await startHost();

  if (host) {
    // 在加载 dsh Web UI 前安装请求头改写：渲染进程走局域网 IP 建连，但 Host/Origin
    // 改写为 127.0.0.1，使 dsh 的 loopback-only 特权方法围栏（settings/credentials 等）放行。
    installLoopbackHeaderRewrite(win, host.port);
    void win.loadURL(host.url);
  } else {
    void win.loadURL('about:blank');
    console.error('[dsh-harmony] dsh Host 启动失败，已加载兜底空白页');
  }

  // 状态栏托盘：失败只记日志，不影响应用主流程。
  await installTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const st = loadWindowState();
      const w = new BrowserWindow({
        width: st.width,
        height: st.height,
        ...(st.x !== undefined && st.y !== undefined ? { x: st.x, y: st.y } : {}),
        webPreferences: DSH_WEB_PREFERENCES,
      });
      trackWindowState(w);
      installFullscreenShortcut(w);
      if (st.isMaximized) w.maximize();
      if (host) {
        installLoopbackHeaderRewrite(w, host.port);
        void w.loadURL(host.url);
      }
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (host) {
    try { void Promise.resolve(host.shutdown()).finally(() => app.quit()); } catch { /* ignore */ }
  }
});
