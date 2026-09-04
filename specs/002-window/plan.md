# 002-window 技术方案（As-Built）

> 本文档为回溯式技术方案，记录窗口管理模块的**实际**架构、设计决策与实现策略。
> Module: 002-window
> 对应规格: [spec.md](./spec.md)
> Last Updated: 2026-09-04

## 1. 技术上下文

### 1.1 运行时环境

- 运行于 **Electron 主进程**（Node.js），Electron-on-鸿蒙运行时（Electron 37 / Node 22.17.0）。
- 主进程入口 `src-main/main.js`（CommonJS，`require('electron')`），本模块为其窗口相关代码段。
- 依赖 `electron` 的 `BrowserWindow`、`Menu`、`app`，以及窗口 `webContents.executeJavaScript`。

### 1.2 依赖

| 依赖 | 用途 |
|------|------|
| `electron`（BrowserWindow / Menu / app） | 窗口创建、去默认菜单、生命周期钩子 |
| `webContents.executeJavaScript` | 向渲染进程注入 polyfill |

## 2. 宪法合规检查

| 原则 | 状态 | 说明 |
|------|------|------|
| 零上游改动 / 界面 100% 复用 dsh Web UI | ✅ | 仅 loadURL 加载 dsh Web UI，无自绘 UI（FR-002-006） |
| 同源数据面 | ✅ | loadURL(host.url) 同源加载（FR-002-006） |
| 只写装配代码 | ✅ | 窗口逻辑为薄装配，无业务逻辑 |
| 崩溃兜底 | ✅ | 宿主失败降级 about:blank、窗口创建失败 try/catch（FR-002-007 / FR-002-004） |
| 日志规范 | ✅ | 统一 `[dsh-harmony]` 前缀（FR-002-009） |
| 源码即真理 | ✅ | 单文件内联，行号可追溯 |

> 合规结论：全部 ✅，无 ⚠️ / ❌。

> 注：与 desktop 版 002-window 相比，本模块未实现无边框/自绘标题栏、窗口控制 IPC、权限白名单、导航加固——鸿蒙 MVP 聚焦「建窗 + loading + 兜底 + polyfill」，界面 100% 复用 dsh Web UI，标题栏沿用系统默认。

## 3. 研究结论

### 3.1 关键决策与理由

| 决策 | 理由 |
|------|------|
| 先加载内联 loading 页（data: URL） | 首装解压约 45s + 宿主启动耗时，直接等待会白屏/假死；用轻量内联页提示用户（FR-002-005） |
| loading 页用 data: URL 而非本地文件 | 无需额外打包资源，单文件内联即可（main.js:52） |
| 宿主失败降级 about:blank | 不阻塞 Electron 启动，符合宪法「崩溃兜底」（FR-002-007） |
| dom-ready 注入 crypto.randomUUID polyfill | 鸿蒙 Chromium Web Crypto 可能缺 randomUUID，dsh Web UI 依赖它（FR-002-008） |
| Menu.setApplicationMenu(null) | Electron 默认菜单栏冗余，去掉（FR-002-002） |
| setWindowButtonVisibility(true) | 鸿蒙运行时窗口控制按钮需显式启用（FR-002-003） |
| activate 重建窗口 | 鸿蒙下窗口被全部关闭后从任务栏/图标重新激活时需重建（FR-002-010） |

### 3.2 加载流程（app.whenReady 内）

```
BrowserWindow 创建（1200×800 / title / autoHideMenuBar / setWindowButtonVisibility(true)）
  → loadURL(LOADING_URL)          // 内联 loading 页（FR-002-005）
  → did-fail-load 注册日志         // FR-002-009
  → dom-ready 注册 polyfill 注入   // FR-002-008
  → ensureDshExtracted()          // 解压（见 004-artifact-bootstrap）
  → startHost()                   // 宿主（见 001-host）
  → host 非空 ? installLoopbackHeaderRewrite + loadURL(host.url)   // FR-002-006
  : loadURL('about:blank')        // FR-002-007
```

### 3.3 与 desktop 版的差异

| 维度 | desktop（002-window） | harmony（本模块） |
|------|----------------------|-------------------|
| 标题栏 | 无边框 + titleBarOverlay 自绘 | 系统默认边框，仅 autoHideMenuBar |
| 窗口控制 IPC | 4 个 IPC（min/max/close/is-maximized） | 无 |
| 权限白名单 | clipboard-sanitized-write + notifications | 无 |
| 导航加固 | setWindowOpenHandler + will-navigate | 无 |
| 显隐控制 | show:false + ready-to-show | loading 页覆盖等待期 |
| 兜底 | dev server / 本地兜底页 | 内联 loading 页 + about:blank |
| polyfill | 无 | crypto.randomUUID（鸿蒙特有） |

## 4. 数据模型

### 4.1 实体与状态

- `LOADING_HTML`：内联 loading 页 HTML 字符串（main.js:23-51）。
- `LOADING_URL`：`data:text/html;charset=utf-8,` + `encodeURIComponent(LOADING_HTML)`（main.js:52）。
- `RENDERER_POLYFILL`：crypto.randomUUID polyfill 源码字符串（main.js:56-75）。

### 4.2 状态机（窗口生命周期）

```
创建（1200×800）
  → loadURL(LOADING_URL)                    // loading 页
      ↓
  host 就绪 → loadURL(host.url)             // dsh Web UI
  host 失败 → loadURL('about:blank')        // 兜底空白页
      ↓
  close → window-all-closed → app.quit()    // 关窗退出（FR-002-011）
      ↓
  activate（无窗口）→ 重建窗口 → loadURL(host.url)  // FR-002-010
```

### 4.3 校验规则

- polyfill 注入条件：`typeof crypto.randomUUID !== 'function'` 时才覆盖，避免覆盖原生实现（main.js:57）。
- 窗口重建条件：`BrowserWindow.getAllWindows().length === 0`（main.js:519）。

## 5. 接口契约

### 5.1 提供接口（本模块导出）

本模块为单文件内联代码段，无显式导出符号；对外的「契约」是：

| 契约 | 说明 |
|------|------|
| 主窗口实例 | 在 `app.whenReady` 内创建，供宿主就绪后 loadURL 使用 |
| `globalThis.__winError` | 窗口创建失败时的错误信息（供诊断） |

### 5.2 消费接口（本模块 import）

| 来源 | 符号 |
|------|------|
| `electron` | `app`, `BrowserWindow`, `Menu` |
| `webContents` | `executeJavaScript`（注入 polyfill） |

### 5.3 事件（app / webContents）

| 事件 | 用途 |
|------|------|
| `app.whenReady` | 建窗与加载的入口（main.js:474） |
| `webContents.did-fail-load` | 记录加载失败（main.js:493-495） |
| `webContents.dom-ready` | 注入 polyfill（main.js:498-500） |
| `app.activate` | 无窗口时重建（main.js:518-526） |
| `app.window-all-closed` | 关窗退出（main.js:529-531，属 003-lifecycle，窗口相关提一句） |

## 6. 实现策略

### 6.1 架构模式

**过程式编排**：窗口逻辑内联在 `app.whenReady` 回调内（与 desktop 的 windows.ts 工厂函数不同），单文件主进程（main.js）。

### 6.2 关键算法

- `LOADING_URL` 构造：`encodeURIComponent` 编码内联 HTML → data: URL（main.js:52）。
- `RENDERER_POLYFILL`：优先 `crypto.getRandomValues` 生成 UUID v4（位操作 b[6] 置 version、b[8] 置 variant），异常时降级 `Math.random` 生成（main.js:56-75）。
- 窗口重建：`activate` 中判 `getAllWindows().length === 0`，有 host 则安装头改写并 loadURL（main.js:518-526）。

### 6.3 错误处理

- 窗口创建失败：try/catch → `globalThis.__winError` + `console.error('[dsh-harmony] BrowserWindow 创建失败:')`，return 退出（main.js:484-488）。
- 宿主失败：`loadURL('about:blank')` + `console.error('[dsh-harmony] dsh Host 启动失败，已加载兜底空白页')`（main.js:514-515）。
- did-fail-load：`console.error('[dsh-harmony] failed to load <url>: <code> <desc>')`（main.js:493-495）。
- polyfill 注入失败：`executeJavaScript(...).catch(() => {})` 静默忽略（main.js:499）。

### 6.4 性能

- loading 页为轻量内联 HTML，首帧即显示，无额外资源加载；
- 无轮询/缓存；polyfill 每次 dom-ready 注入一次（幂等，无副作用）。

## 7. 测试考虑

- **集成/e2e**：窗口加载 loading 页 → dsh Web UI / 兜底空白页；关窗即退出。
- **边界**：宿主为 null 时降级 about:blank；窗口创建抛错时不崩溃；activate 重建窗口。
- **polyfill**：验证 `crypto.randomUUID` 缺失环境下注入后返回合法 UUID v4 格式。
- `[NEEDS CLARIFICATION]`：鸿蒙 Chromium 具体缺失 `crypto.randomUUID` 的版本范围未在源码中明确，polyfill 以「缺失则注入」幂等方式兜底（真机 6.1.0.135 已验证正常运行）。

## 8. 文件清单

| 文件 | 用途 | 行数 |
|------|------|------|
| `src-main/main.js` | 主进程入口，窗口相关代码段：LOADING_HTML/URL（23-52）、RENDERER_POLYFILL（56-75）、Menu.setApplicationMenu(null)（472）、建窗与加载（474-527）、window-all-closed（529-531） | 537（全文件） |

> 协作方（非本模块）：`startHost` / `installLoopbackHeaderRewrite`（001-host / 003-lifecycle）、`ensureDshExtracted`（004-artifact-bootstrap）。

## 9. 与规格的交叉引用

| 规格需求 | 实现位置 |
|----------|----------|
| FR-002-001（主窗口 1200×800 + 标题） | `BrowserWindow({ width:1200, height:800, title:'DeepSeek Harness' })`（main.js:477-482） |
| FR-002-002（去默认菜单 + 隐藏菜单栏） | `Menu.setApplicationMenu(null)`（main.js:472）+ `autoHideMenuBar: true`（main.js:481） |
| FR-002-003（窗口按钮可见） | `win.setWindowButtonVisibility(true)`（main.js:483） |
| FR-002-004（创建失败不崩溃） | try/catch + `__winError` + return（main.js:476-488） |
| FR-002-005（先加载 loading 页） | `LOADING_HTML`/`LOADING_URL`（main.js:23-52）+ `void win.loadURL(LOADING_URL)`（main.js:491） |
| FR-002-006（同源加载 dsh Web UI） | `installLoopbackHeaderRewrite` + `void win.loadURL(host.url)`（main.js:508-512） |
| FR-002-007（失败兜底 about:blank） | `void win.loadURL('about:blank')`（main.js:514） |
| FR-002-008（polyfill 注入） | `dom-ready` + `executeJavaScript(RENDERER_POLYFILL)`（main.js:498-500） |
| FR-002-009（加载失败日志） | `did-fail-load`（main.js:493-495） |
| FR-002-010（activate 重建窗口） | `app.on('activate', ...)`（main.js:518-526） |
| FR-002-011（关窗退出） | `app.on('window-all-closed', () => app.quit())`（main.js:529-531） |
