# ARCHITECTURE.md — 整体架构

> dsh-desktop-hos 系统整体架构：进程模型、分层、数据流、关键决策。
> Last Updated: 2026-09-04

## 1. 定位

基于「Electron-on-鸿蒙」运行时（harmonypc-electron，Electron 37 / Node 22.17.0）的 deepseek-harness 桌面封装——在鸿蒙设备的 Electron 主进程内跑 dsh Host（含 webserver），渲染进程同源加载 dsh Web UI，界面 100% 复用 dsh Web UI。

**与 desktop 同构**：进程内 Host + webserver + localhost 同源数据面。唯一本质差异是把「Electron 桌面运行时」替换为「Electron-on-鸿蒙运行时」。

## 2. 进程模型

```
┌─ 鸿蒙 HAP（dsh-desktop-hos）───────────────────────────────┐
│  electron 模块（entry）                                            │
│    ├─ 原生 SO：libelectron.so + libadapter.so + libffmpeg.so + libc++_shared.so │
│    └─ EntryAbility → 启动 Electron-on-鸿蒙 运行时                   │
│  web_engine 模块（HAR 桥接层）                                      │
│    ├─ ArkUI Web 组件 + *AdapterBind（窗口/通知/剪贴板/权限）        │
│    ├─ jsbindings（JsBindingMethod 注册 ArkTS 方法供 Node 调用）      │
│    └─ resfile/resources/app/  ← main.js + dsh-dist.tar.gz          │
│         ┌─ Electron 主进程（Node.js，承载 dsh Host）──────────────┐ │
│         │  main.js: 解压 → ensureSandboxHome → startHost → 建窗   │ │
│         │    ├─ webserver ← 0.0.0.0:<port>，服务 dist + /api      │ │
│         │    ├─ apiProxy  ← RPC 网关                              │ │
│         │    └─ connection ← /api + WebSocket 注册                │ │
│         │  就绪后 loadURL(http://<局域网 IP>:<port>/)              │ │
│         └────────────────────▲───────────────────────────────────┘ │
│                              │ 同源（无 CORS/鉴权）+ Host 头改写    │
│         ┌────────────────────┴───────────────────────────────────┐ │
│         │ 渲染进程：loadURL(局域网 IP) ← 同源                      │ │
│         │   标准 dsh Web UI（WebApiClient：fetch /api + WS 事件）   │ │
│         └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### 三层进程

| 层 | 进程 | 职责 |
|---|---|---|
| ArkTS 层 | Electron 主进程（Node.js） | 承载 dsh Host（webserver + apiProxy + connection），订阅 ctx 事件 |
| ArkUI 层 | 渲染进程（Chromium） | loadURL 同源加载 dsh Web UI |
| 桥接层 | web_engine HAR（ArkTS） | ArkUI Web 组件承载窗口 + Adapter/Binding 桥接系统能力 |

## 3. 数据流

### 3.1 上行（unary）

渲染进程 `WebApiClient.doFetch` → `fetch('/api/<method>')`（同源）→ webserver `/api` 路由 → `toFetchHandler(apiProxy).fetch`。

### 3.2 下行（事件帧）

渲染进程 `WebApiClient.openMux/openHost` → `WebSocket('/api/events.mux' | '/api/events.host')` → 帧流。

### 3.3 loopback 头改写（鸿蒙专用）

鸿蒙 NEXT 渲染进程访问 127.0.0.1 被进程间网络隔离拦截 → webserver 绑 0.0.0.0、渲染进程走局域网 IP 建连。dsh 的特权方法（`settings.*`/`credentials.*` 等）锁定 loopback-only，局域网 Host 头会被 403。修复：渲染进程请求出栈前把 Host/Origin 改写为 `127.0.0.1:<port>`（TCP 仍连局域网 IP），围栏放行且语义不变。

## 4. 启动时序

```
EntryAbility 启动 Electron-on-鸿蒙
  └→ main.js（require('electron')）
      ├─ ensureSandboxHome()        # HOME → userData（沙箱可写）
      ├─ ensureLoopbackNoProxy()    # NO_PROXY 并入 loopback + proxy-bypass-list
      ├─ app.whenReady()
      │   ├─ 创建 BrowserWindow → 先加载 loading 页（data: URL）
      │   ├─ ensureDshExtracted()   # 首次启动流式解压 dsh-dist.tar.gz → userData/dsh-dist
      │   ├─ startHost()            # runProfile('desktop') → {ctx, shutdown, port, url}
      │   │   ├─ ensureDesktopProfile / ensureDshMarketProfileLink
      │   │   └─ patchAgentPresetsRuntime（禁用 shell/subprocess/pty 工具行）
      │   ├─ installLoopbackHeaderRewrite(win, port)
      │   └─ loadURL(http://<局域网 IP>:<port>/)
      └─ before-quit → host.shutdown()
```

## 5. 构建流水线（三阶段）

```
① collect-runtime.mjs  copy ../harmonypc-electron 的 electron + web_engine + 3 SO + libc++_shared.so
② build-dsh.mjs        清理残留 → apply 4 patch → pnpm build host/client/web + dsh-market
③ collect-dsh.mjs      pnpm deploy 物化 → 补包 → sharp stub → better-sqlite3 注入 → web dist + profile + dshmarket
④ tar -czf --format=ustar → dsh-dist.tar.gz（打入 resfile）
⑤ hvigor 构建 + 签名 → HAP
⑥ hdc install + start
```

## 6. 模块划分（9 模块）

| 编号 | 模块 | 英文 | 来源 |
|---|---|---|---|
| 001 | Host 宿主 | host | 自研（main.js） |
| 002 | 窗口管理 | window | 自研（main.js） |
| 003 | 生命周期与鸿蒙适配 | lifecycle | 自研（main.js） |
| 004 | 产物解压引导 | artifact-bootstrap | 自研（main.js） |
| 005 | 构建编排 | build-pipeline | 自研（scripts/） |
| 006 | 运行时 profile | runtime-profile | 移植（profiles/ + patches/） |
| 007 | 运行时入口 | runtime-entry | copy 运行时（electron/） |
| 008 | Web 桥接层 | web-bridge | copy 运行时（web_engine/） |
| 201 | dsh-market 插件市场 | dsh-market | 依赖集成 |

## 7. 关键架构决策

| # | 决策 | 理由 |
|---|---|---|
| 1 | Electron 37 / Node 22.17.0 | dsh 依赖 `node:zlib.createZstdDecompress` |
| 2 | webserver 绑 0.0.0.0 + 局域网 IP 加载 | 鸿蒙 NEXT loopback 网络隔离 |
| 3 | Host 头 loopback 改写 | 特权方法围栏放行，语义不变 |
| 4 | HOME → 沙箱目录 | `os.homedir()` 返回沙箱外目录导致 EPERM |
| 5 | dsh-dist.tar.gz 流式解压 | HAP 打包 5 万+ 小文件超限 |
| 6 | sharp stub / node-pty+ koffi 禁用 / better-sqlite3 注入 | 原生模块 aarch64 ABI 取舍 |
| 7 | agent preset 工具行禁用 | shell/subprocess 禁用导致 preset 挂载失败 |

## 8. 相关工程关系

```
dsh-desktop-hos（本工程：鸿蒙 HAP）
        │ 构建期消费 3 个同级工程（sibling 源码引用 + copy 产物，均无 submodule）
        ├─ ../deepseek-harness（dsh Host）             ← build-dsh：patch + pnpm build
        ├─ ../dsh-market（插件市场）                    ← build-dsh + collect-dsh：build + 物化
        └─ ../harmonypc-electron（Electron 37 运行时） ← collect-runtime：copy electron + web_engine + SO

dsh-desktop（Electron 桌面壳）
        └─ 仅「架构设计参考」：复用架构决策 + patch + 主进程编排逻辑；不参与本工程构建
```
