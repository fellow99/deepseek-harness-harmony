# 003-lifecycle 技术方案（As-Built）

> 本文档为「回溯性」技术方案，记录模块实际架构、设计决策与实现策略。
> 模块：003-lifecycle（生命周期与鸿蒙适配）
> 对应规格：specs/003-lifecycle/spec.md
> 最后更新：2026-09-04

## 1. 技术上下文

### 1.1 运行时环境

- **运行位置**：Electron-on-鸿蒙 主进程（Node.js 22.17.0，Electron 37.2.3），与 dsh Host 同进程。
- **主进程入口**：`src-main/main.js`（CommonJS，`require('electron')`），单文件承载全部主进程逻辑。
- **本模块代码落点**：`src-main/main.js` 内的 RENDERER_POLYFILL（56-75 行）、崩溃兜底（396-397 行）、`ensureLoopbackNoProxy`（400-410 行）、`ensureSandboxHome`（419-429 行）、`installLoopbackHeaderRewrite`（447-467 行）、`app.whenReady` 编排（474-527 行）、`window-all-closed`（529-531 行）、`before-quit`（533-537 行）。
- **调用时机**：`ensureLoopbackNoProxy()`（410 行）与 `ensureSandboxHome()`（429 行）在模块顶层、`app.whenReady()` 之前同步执行；`installLoopbackHeaderRewrite(win, port)` 在宿主就绪后、`loadURL` 前调用（511 行）；`before-quit` 在退出时调用宿主 `shutdown`。

### 1.2 依赖

| 依赖 | 类型 | 用途 |
|---|---|---|
| `electron`（`app`） | 内置 | `app.commandLine.appendSwitch('proxy-bypass-list','<-loopback>')`（408 行）、`app.getPath('userData')`（421 行）、`app.on('window-all-closed'/'before-quit'/'activate')`、`app.whenReady()`、`Menu.setApplicationMenu(null)` |
| `electron`（`win.webContents.session.webRequest`） | 内置 | `onBeforeSendHeaders` 改写 Host/Origin（450-462 行） |
| Node `process` | 内置 | `process.env` 读写、`process.on('uncaughtException'/'unhandledRejection')` |
| `node:os`（`networkInterfaces`/`homedir`） | 内置 | `pickReachableHost`（310-322 行，归 001-host）；`ensureSandboxHome` 内日志打印 `homedir()`（424 行） |
| `node:url`（`URL`） | 内置 | `installLoopbackHeaderRewrite` 解析 `details.url`（453 行） |

> 无第三方 npm 依赖，纯 Electron / Node 内置能力。

## 2. 宪法合规检查

| 宪法原则（constitution.md） | 状态 | 说明 |
|---|---|---|
| §2.1 安全围栏语义不可破坏 | ✅ | loopback 头改写仅作用于内嵌渲染进程 session（450-462 行），局域网其他设备请求不经此 session，特权方法对其仍 403 |
| §2.2 沙箱边界 | ✅ | `ensureSandboxHome` 把 HOME 指向 `app.getPath('userData')` 沙箱可写目录（421-423 行），不触碰沙箱外目录 |
| §1.4 同源数据面 | ✅ | 代理豁免 + loopback 头改写正是为保证同源加载与数据面通信不被代理劫持/被围栏 403 |
| §4.1 优雅关闭 | ✅ | `before-quit` 调用 `host.shutdown()`（535 行）释放宿主插件树 |
| §4.2 崩溃兜底 | ✅ | `uncaughtException`/`unhandledRejection` 记录（396-397 行），防静默崩溃 |
| §3.3 日志规范 | ✅ | 统一 `[dsh-harmony]` 前缀（396/397/424/463 行），经 hilog 收集 |

> 合规结论：全部 ✅，无 ⚠️ / ❌。

## 3. 研究结论

- **沙箱 HOME 修正（对应 §18.7 问题 1）**：鸿蒙沙箱中 Node 的 `os.homedir()` 解析 `HOME`/`getpwuid` 得到 `/storage/Users/currentUser`（沙箱外系统用户目录），dsh 目录浏览器（`directory-picker-browse`）以 `homedir()` 为起始目录，`opendir` 即抛 `EPERM`。POSIX 下 `homedir()` 优先读 `HOME` 环境变量，故把 `HOME`/`USERPROFILE` 显式指向 `app.getPath('userData')`（真机 `/data/storage/el2/base/files`）即可让起始目录落到沙箱内。**必须**在 dsh Host 启动（任何 `homedir()` 调用）前设置（主进程注释 412-418 行明确此约束）。
- **loopback 信任围栏适配（对应 §18.7 问题 2）**：dsh `client-connection` 安全围栏把 `settings.describe`/`credentials.*`/`host.pickDirectory`/`host.openPath`/`agentPreset.*`/`llm.discoverModels` 等特权方法锁定为 loopback-only（`PRIVILEGED_METHODS` 用空信任列表校验 Host 头）。鸿蒙为绕过渲染进程 loopback 网络隔离改走局域网 IP 加载，Host 头非 loopback → 特权方法 403；普通方法因局域网 IP 经 `resolveLanTrust` 自动入 trustedHosts 而正常。修复：在请求出栈前把 `Host`/`Origin` 改写为 `127.0.0.1:<port>`，TCP 仍连局域网 IP（绕开隔离），仅 HTTP Host 头呈现 loopback，围栏据此放行。
- **改写作用域安全性**：`onBeforeSendHeaders` 挂在 `win.webContents.session`（内嵌渲染进程会话）上，改写只作用于本应用内嵌浏览器发起的请求；局域网其他设备的请求不经过此 session，特权方法对其依然 403（主进程注释 442-445 行明确此语义，§18.7 用 curl 验证：局域网 Host → 403，loopback Host → 200）。
- **proxy-bypass-list `<-loopback>`**：Chromium 命令行开关，`<-loopback>` 是「排除 loopback 之外的规则」的内建值，使渲染进程对 loopback 直连（对齐 desktop `lifecycle.ts`）。
- **NO_PROXY 大小写双键**：不同平台/工具读 `NO_PROXY`（大写）或 `no_proxy`（小写），二者均注入以兼容（对应 FR-003-007）。
- **crypto.randomUUID polyfill**：鸿蒙 Chromium 的 Web Crypto 可能缺 `crypto.randomUUID`，注入用 `getRandomValues` 生成 UUID v4，`getRandomValues` 亦失败时降级 `Math.random` 版本（56-75 行），每次 `dom-ready` 时注入主世界（498-500 行）。
- **与 desktop 的差异**：desktop 的 `lifecycle.ts` 含「系统 CA 证书合并」（`setupSystemCertificates`），本模块**未实现**该能力（main.js 无对应代码），不纳入本模块职责。

## 4. 数据模型

### 4.1 代理豁免列表

- 读取 `process.env[NO_PROXY | no_proxy]` → 按 `,` 拆分 → `trim` → 过滤空串 → 与 loopback 集合（`127.0.0.1`、`localhost`、`::1`）取并集（`Set` 去重）→ 以 `,` 重写回环境变量（400-407 行）。
- 幂等：`Set<string>` 保证重复启动不产生重复项（对应 FR-003-007）。

### 4.2 沙箱 HOME 目录

- `home = app.getPath('userData')` → `process.env.HOME = home`、`process.env.USERPROFILE = home`（421-423 行）。
- 真机值：`/data/storage/el2/base/files`（§18.7 验证日志）。

### 4.3 loopback 改写规则

- `loopbackAuthority = '127.0.0.1:' + String(port)`（448 行）。
- 匹配条件：请求 URL 可解析为 `http:`/`https:` 且 `target.port === String(port)`（454 行）；`data:` 等非 http(s) URL 跳过（453 行 try/catch）。
- 改写：`headers.Host = loopbackAuthority`（455 行）；若存在非空 `Origin`，`headers.Origin = 'http://' + loopbackAuthority`（457-459 行）。

### 4.4 渲染进程 polyfill

- `RENDERER_POLYFILL` 为字符串数组 `join('\n')` 的 JS 片段（56-75 行）：若 `typeof crypto.randomUUID !== 'function'`，用 `crypto.getRandomValues` 生成 16 字节、置版本/变体位（`b[6]`、`b[8]`）、拼成 8-4-4-4-12 格式；异常时回退 `Math.random` 模板字符串版本。

## 5. 接口契约

### 5.1 提供的接口（模块内函数）

| 函数 | 签名 | 说明 |
|---|---|---|
| `ensureLoopbackNoProxy` | `() => void` | 注入 NO_PROXY loopback（大小写双键）+ `appendSwitch('proxy-bypass-list','<-loopback>')`（400-409 行） |
| `ensureSandboxHome` | `() => void` | 把 `HOME`/`USERPROFILE` 指向 `userData`，失败 try/catch 记录（419-428 行） |
| `installLoopbackHeaderRewrite` | `(win, port) => void` | 在 `win.webContents.session.webRequest.onBeforeSendHeaders` 中改写 Host/Origin（447-467 行） |

### 5.2 消费的接口

- `electron.app.commandLine.appendSwitch('proxy-bypass-list','<-loopback>')`
- `electron.app.getPath('userData')`
- `electron.app.on('window-all-closed' | 'before-quit' | 'activate')`、`app.whenReady()`
- `win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => ...)`
- `process.env`、`process.on('uncaughtException' | 'unhandledRejection')`

### 5.3 事件协议

- `process` 的 `uncaughtException`（回调参数 `Error`）、`unhandledRejection`（回调参数：拒绝原因）——仅记录，无自定义事件协议（396-397 行）。
- `app` 的 `window-all-closed`（无参 → `app.quit()`）、`before-quit`（无参 → `host.shutdown()`）。
- `win.webContents` 的 `dom-ready`（注入 polyfill，归窗口编排，本模块仅提供 polyfill 内容）。

## 6. 实现策略

### 6.1 架构模式

单文件内联工具函数（CommonJS，无独立模块文件），由模块顶层与 `app.whenReady` 编排按序调用。各函数彼此独立、无状态、幂等；`ensureLoopbackNoProxy` 与 `ensureSandboxHome` 在 `whenReady` 前同步执行（410/429 行），`installLoopbackHeaderRewrite` 在宿主就绪后按需挂载（511 行、522 行 activate 分支）。

### 6.2 关键算法

- **代理豁免合并**（对应 FR-003-007/008）：拆分 → 归一化（trim + 去空）→ 集合并集 → 回写 + Chromium 开关。
- **沙箱 HOME 修正**（对应 FR-003-001/002/003）：读取 `userData` → 写 `HOME`/`USERPROFILE`，try/catch 包裹。
- **loopback 头改写**（对应 FR-003-004/005/006）：`onBeforeSendHeaders` 中解析 URL → 端口匹配 → 改写 `Host`（及非空 `Origin`）→ `callback({ requestHeaders: headers })`；非 http(s) 或端口不匹配的请求原样透传（`callback` 仍被调用）。
- **UUID 兜底**（对应 FR-003-009/010）：`getRandomValues` 置位版本位 `(b[6]&0x0f)|0x40`、变体位 `(b[8]&0x3f)|0x80`，异常回退 `Math.random`。

### 6.3 错误处理

- `ensureSandboxHome`：整体 try/catch，失败 `console.error` 不中断（425-427 行）。
- `installLoopbackHeaderRewrite`：整体 try/catch，安装失败 `console.error` 不中断（464-466 行）。
- 崩溃兜底：`console.error('[dsh-harmony] uncaughtException:' / 'unhandledRejection:')` 记录（396-397 行），防静默。
- 头改写内部：URL 解析失败 try/catch 跳过非 http(s) URL（453 行）。

### 6.4 性能

- 均为启动期一次性操作，无热路径；头改写 `onBeforeSendHeaders` 在每次渲染请求出栈时触发，仅做 URL 解析 + 字符串比较，开销可忽略。

## 7. 测试考量

- **单元 — 代理豁免**：给定已存在 `NO_PROXY`/`no_proxy` 值，断言 loopback 被追加且去重、空项被过滤（覆盖大小写双键）。边界：`NO_PROXY` 为 `undefined`/空串。
- **单元 — 沙箱 HOME**：mock `app.getPath('userData')`，断言 `process.env.HOME`/`USERPROFILE` 被置为 `userData`；mock 抛错时断言启动不中断。
- **单元 — 头改写**：mock `onBeforeSendHeaders` 回调，断言 (a) 端口匹配的 http(s) URL 的 `Host`/`Origin` 被改写、(b) 端口不匹配或非 http(s)（如 `data:`）URL 原样透传。
- **单元 — 崩溃兜底**：mock `process.on`，断言 `uncaughtException`/`unhandledRejection` 均被注册。
- **单元 — polyfill**：在无 `crypto.randomUUID` 环境注入片段，断言生成 UUID 格式合法（版本位/变体位正确）。
- **真机验证（已执行）**：`settings.describe`/`credentials.describe` 经 loopback Host 返回 200；`host.listDirectory` 起始目录返回沙箱 `files` 目录无 EPERM；局域网 curl 验证特权方法 403、loopback Host 200（§18.7）。

## 8. 文件清单

| 文件 | 用途 | 行数 |
|---|---|---|
| `src-main/main.js` | 本模块相关段落：RENDERER_POLYFILL（56-75）、崩溃兜底（396-397）、ensureLoopbackNoProxy（400-410）、ensureSandboxHome（419-429）、installLoopbackHeaderRewrite（447-467）、whenReady 编排（474-527）、window-all-closed（529-531）、before-quit（533-537） | 全文件 537 |

> 本模块无独立文件，代码内联于主进程单文件 `main.js`（与 desktop 拆分为 `lifecycle.ts` 的形态不同，鸿蒙版合并为 CommonJS 单入口）。

## 9. 与规格的交叉引用

| 技术决策 | 对应规格需求 |
|---|---|
| `ensureSandboxHome`：HOME 指向 `userData`（421-423 行） | FR-003-001 |
| `process.env.USERPROFILE = home`（423 行） | FR-003-002 |
| `ensureSandboxHome` try/catch 降级（425-427 行） | FR-003-003 |
| `headers.Host = loopbackAuthority`（455 行） | FR-003-004 |
| `headers.Origin = 'http://' + loopbackAuthority`（457-459 行） | FR-003-005 |
| 改写仅挂内嵌 session + 局域网其他设备仍 403（450/442-445 行） | FR-003-006 |
| NO_PROXY 双键合并 + 去重（400-407 行） | FR-003-007 |
| `appendSwitch('proxy-bypass-list','<-loopback>')`（408 行） | FR-003-008 |
| RENDERER_POLYFILL 注入 `crypto.randomUUID`（56-75 行） | FR-003-009 |
| `getRandomValues` 失败回退 `Math.random`（66-72 行） | FR-003-010 |
| `process.on('uncaughtException')` 记录（396 行） | FR-003-011 |
| `process.on('unhandledRejection')` 记录（397 行） | FR-003-012 |
| `[dsh-harmony]` 前缀区分来源（396-397 行） | FR-003-013 |
| `window-all-closed` → `app.quit()`（529-531 行） | FR-003-014 |
| `before-quit` → `host.shutdown()`（533-535 行） | FR-003-015 |
| `shutdown()` 后 `finally(() => app.quit())`（535 行） | FR-003-016 |
