# overall-plan.md — 整体技术方案

> deepseek-harness-harmony 系统级技术方案（HOW，各模块 plan 总纲）。
> Last Updated: 2026-09-04

## 1. 技术上下文

- 运行时：Electron-on-鸿蒙（harmonypc-electron，Electron 37 / Node 22.17.0），主进程为 Node.js 环境。
- 主进程入口：`src-main/main.js`（CommonJS，`require('electron')`），dsh ESM 产物经动态 import 加载。
- 桥接层：`web_engine` HAR（ArkTS Adapter + JsBinding + ArkUI Web 组件）。
- 构建：三阶段 Node 脚本 + hvigor 产 HAP。
- 详见 [TECH.md](./TECH.md)。

## 2. 宪法合规检查

| 原则 | 状态 | 说明 |
|---|---|---|
| 零上游改动 | ✅ | 仅 4 patch，复用 runProfile/webserver/WebApiClient |
| 进程内 Host | ✅ | main.js 进程内 runProfile('desktop') |
| 只写装配代码 | ✅ | 复用 *AdapterBind，自研仅 main.js + scripts + profile |
| 同源数据面 | ✅ | loadURL 同源 + Host 头改写 |
| 安全围栏语义不变 | ✅ | loopback 改写仅限内嵌 session，局域网仍 403 |
| sibling + 构建期 copy | ✅ | 无 submodule |
| 源码即真理 | ✅ | 引用标注源码位置 |
| 优雅关闭 + 崩溃兜底 | ✅ | shutdown + uncaughtException 兜底 |
| 幂等构建 | ✅ | patch/collect 幂等 |

> 合规结论：全部 ✅ / ⚠️ 可解释，无 ❌。

## 3. 实现策略总览

### 3.1 主进程编排（src-main/main.js）

单文件承载全部主进程逻辑（与 desktop 的 host.ts + windows.ts + lifecycle.ts 等价但合并为 CommonJS 单入口）：

- **解压**：`extractTarGz` 极简 ustar 流式解压（createGunzip + 逐条目落盘 + 剥离 `dsh-dist/` 前缀）。
- **宿主**：`startHost` 定位 profile-boot 薄入口 → `runProfile({profile:'desktop', args:['--port','0','--host','0.0.0.0']})` → 校验 `ctx.webServer`。
- **窗口**：`BrowserWindow` + loading 页（data: URL）+ `loadURL(局域网 IP)`。
- **鸿蒙适配**：`ensureSandboxHome`（HOME→userData）、`installLoopbackHeaderRewrite`（onBeforeSendHeaders 改 Host/Origin）、`ensureLoopbackNoProxy`（NO_PROXY + proxy-bypass-list）、`RENDERER_POLYFILL`（crypto.randomUUID）、`patchAgentPresetsRuntime`（禁用 shell/subprocess/pty 工具行）。

### 3.2 构建编排（scripts/）

- `collect-runtime.mjs`：copy electron + web_engine 模块（剔除生成目录）+ 校验/注入 SO + 恢复 main.js。
- `build-dsh.mjs`：清理 workspace 残留 → 幂等 apply 4 patch → pnpm build host/client/web → build dsh-market。
- `collect-dsh.mjs`：pnpm deploy 物化 → Junction 物化 → 补全 @deepseek-ai 包 → 非 hoisted 依赖物化 → sharp stub → better-sqlite3 注入 → web dist + profile + dshmarket。

### 3.3 运行时 profile 与 patch（profiles/ + patches/）

- `cordis.patch.yml`：覆盖 web-runtime（printUrl=false）、webserver（host=0.0.0.0）、dsh-market（profile=desktop, allowRestart=false）；禁用 subprocess/sandbox/bash-sandbox/permission。
- 4 patch：symlink→copy、allow-all-interfaces、disable-hmr、disable-native-picker。

### 3.4 运行时集成（electron/ + web_engine/）

- `electron` entry 模块：EntryAbility 启动 Electron-on-鸿蒙运行时。
- `web_engine` HAR：ArkUI Web 组件承载渲染 + ~50 Adapter/~50 Binding 桥接系统能力 + resfile 承载产物。

## 4. 横切关注点

### 4.1 错误处理

- Host 启动失败：返回 null + `__hostError`/`__extractError` 写入全局变量并经 console 记录错误摘要。
- 解压失败：`__extractError` 记录 inspect 摘要。
- 崩溃：`uncaughtException`/`unhandledRejection` 记录不静默。

### 4.2 日志

- 统一 `[dsh-harmony]` 前缀；hilog 关键字 `dsh-harmony`。

### 4.3 安全

- 特权方法围栏语义不变（loopback 改写仅内嵌 session）。
- HOME 沙箱修正；签名 HAP 安装。

## 5. 测试策略

- **单元**：electron/src/test（LocalUnit.test.ets）、web_engine/src/test。
- **自动化测试**：electron/src/ohosTest（Ability.test.ets + TestAbility）。
- **真机验证**：Electron 37 / Node 22.17.0 真机（3QC0226526001227），覆盖「创建会话→写入事件→重启→搜索历史」主路径。
- **构建验证**：产物结构检查（better-sqlite3 package.json + .node、libc++_shared.so 存在）。

## 6. 部署策略

- 本地签名 HAP 自用，`hdc install -r electron-default-signed.hap` + `hdc shell aa start`。
- 不做商店分发/自动更新（对齐 desktop 现阶段）。

## 7. 模块 plan 索引

| 模块 | plan 文档 |
|---|---|
| 001-host | [001-host/plan.md](./001-host/plan.md) |
| 002-window | [002-window/plan.md](./002-window/plan.md) |
| 003-lifecycle | [003-lifecycle/plan.md](./003-lifecycle/plan.md) |
| 004-artifact-bootstrap | [004-artifact-bootstrap/plan.md](./004-artifact-bootstrap/plan.md) |
| 005-build-pipeline | [005-build-pipeline/plan.md](./005-build-pipeline/plan.md) |
| 006-runtime-profile | [006-runtime-profile/plan.md](./006-runtime-profile/plan.md) |
| 007-runtime-entry | [007-runtime-entry/plan.md](./007-runtime-entry/plan.md) |
| 008-web-bridge | [008-web-bridge/plan.md](./008-web-bridge/plan.md) |
| 201-dsh-market | [201-dsh-market/plan.md](./201-dsh-market/plan.md) |
