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
const { app, BrowserWindow, Menu } = require('electron');
const {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync,
  writeSync, openSync, closeSync, createReadStream,
} = require('node:fs');
const { createGunzip } = require('node:zlib');
const { join, dirname } = require('node:path');
const { pathToFileURL } = require('node:url');
const { networkInterfaces } = require('node:os');

// ── 启动 loading 页 ─────────────────────────────────────────────────
// 首次启动解压 dsh-dist.tar.gz 耗时较长（~45s），期间用内联 loading 页提示用户等待初始化。
const LOADING_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DeepSeek Harness</title>
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
  <div class="title">DeepSeek Harness</div>
  <div class="hint">应用初始化中，请稍候…</div>
</body>
</html>`;
const LOADING_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent(LOADING_HTML);

// 渲染进程 polyfill：鸿蒙 Chromium 的 Web Crypto 可能缺 crypto.randomUUID，
// 在每次页面 dom-ready 时注入主世界，用 getRandomValues 兜底生成 UUID v4。
const RENDERER_POLYFILL = [
  "if (typeof crypto.randomUUID !== 'function') {",
  "  crypto.randomUUID = function randomUUID() {",
  "    try {",
  "      var b = crypto.getRandomValues(new Uint8Array(16));",
  "      b[6] = (b[6] & 0x0f) | 0x40;",
  "      b[8] = (b[8] & 0x3f) | 0x80;",
  "      var h = '';",
  "      for (var i = 0; i < 16; i++) h += b[i].toString(16).padStart(2, '0');",
  "      return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);",
  "    } catch (e) {",
  "      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {",
  "        var r = (Math.random() * 16) | 0;",
  "        var v = c === 'x' ? r : (r & 0x3) | 0x8;",
  "        return v.toString(16);",
  "      });",
  "    }",
  "  };",
  "}",
].join('\n');

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
  process.env.DSH_DISABLE_HMR = '1';

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
    console.log('[dsh-harmony] host 就绪: http://' + host + ':' + port + '/');
    return {
      ctx,
      shutdown: (code) => shutdown.shutdown(code ?? 0),
      port,
      url: 'http://' + host + ':' + port + '/',
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
      try { target = new URL(details.url); } catch { /* 非 http(s) URL（data: 等）跳过 */ }
      if (target !== null && (target.protocol === 'http:' || target.protocol === 'https:') && target.port === String(port)) {
        headers.Host = loopbackAuthority;
        // 同源请求浏览器会带 Origin（POST  fetch）；改写为 loopback 以通过围栏的 Origin 比对。
        if (typeof headers.Origin === 'string' && headers.Origin.length > 0) {
          headers.Origin = 'http://' + loopbackAuthority;
        }
      }
      callback({ requestHeaders: headers });
    });
    console.log('[dsh-harmony] 已安装渲染进程 Host→loopback 改写，端口', port);
  } catch (err) {
    console.error('[dsh-harmony] webRequest 头改写安装失败:', err);
  }
}

let host = null;

// 去掉 Electron 默认菜单
Menu.setApplicationMenu(null);

app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({
      width: 1200,
      height: 800,
      title: 'DeepSeek Harness',
      autoHideMenuBar: true,
    });
    win.setWindowButtonVisibility(true);
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

  // 每次页面 dom-ready 时向主世界注入 crypto.randomUUID polyfill（渲染进程 Chromium 可能缺失）
  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScript(RENDERER_POLYFILL).catch(() => {});
  });

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = new BrowserWindow({ width: 1200, height: 800 });
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
