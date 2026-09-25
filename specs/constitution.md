# constitution.md — 宪法原则

> dsh-desktop-hos 项目开发原则与治理规则。
> 本文档从代码库与工程规划中**提取**（descriptive，非 prescriptive），描述本项目实际遵循的原则。
> Last Updated: 2026-09-04

## 1. 架构原则

### 1.1 零上游改动（对 dsh 最小侵入）

- 复用 dsh 现有 HTTP 载体（`WebApiClient` + webserver 路由），**不新写 IPC 载体**。
- 对 dsh 的改动**仅限 4 个 patch**（disable-hmr / disable-native-picker / symlink-to-copy / allow-all-interfaces），其余全部复用。
- 不 fork dsh Web UI，界面 100% 复用 dsh Web UI。

### 1.2 进程内 Host（MVP）

- Host + webserver 跑在 Electron 主进程（Node.js），直连 `ctx` 订阅事件。
- 渲染进程只认 localhost/局域网 IP，将来迁移子进程透明。
- 已知代价：Host 崩溃 = 应用级崩溃（MVP 接受）。

### 1.3 只写装配代码

- 复用 `runProfile` / 现有插件机制 / 运行时已提供的 `*AdapterBind`。
- 桌面能力以主进程启动代码 + 既有桥接注入，不新造业务逻辑。

### 1.4 同源数据面

- dsh webserver 同源服务 SPA dist 与 `/api`，渲染进程同源加载 → 零 CORS、零鉴权、零自定义协议、零新 IPC 载体。

### 1.5 sibling 源码引用 + 构建期 copy（非 submodule）

- 3 个同级工程（`../deepseek-harness` / `../dsh-market` / `../harmonypc-electron`）并行存放。
- dsh / dsh-market：源码引用 + 构建期收集产物。
- harmonypc-electron：构建期 copy 物理文件（electron + web_engine 模块 + SO）。
- **不使用 git submodule**。

## 2. 安全原则

### 2.1 安全围栏语义不可破坏

- dsh `client-connection` 的 loopback-only 特权方法围栏（`settings.*`/`credentials.*` 等）语义不变。
- loopback 头改写**仅作用于本应用内嵌渲染进程的 session**；局域网其他设备请求不经过此 session，特权方法对其依然 403。

### 2.2 沙箱边界

- HOME 显式指向应用沙箱可写目录（userData），不触碰沙箱外系统目录。
- 原生沙箱（landlock/koffi）MVP 禁用，工具调用无沙箱隔离（已知取舍）。

## 3. 代码质量原则

### 3.1 源码即真理

- 所有对 dsh 的引用均标注源码文件 + 行号（如 `apps/cli/src/profile-boot.ts:207`）。
- 不臆测未读代码；不确定处标注 `[NEEDS CLARIFICATION]`。

### 3.2 类型安全

- ArkTS strict mode（build-profile.json5 `strictMode`）；无 `as any`、无 `@ts-ignore`。
- 主进程 main.js 为 CommonJS（鸿蒙 Electron 示例用 `require('electron')`），dsh ESM 产物经动态 import 加载。

### 3.3 日志规范

- 主进程统一 `[dsh-harmony]` 前缀输出到 hilog，便于真机排查（hilog 关键字 `dsh-harmony`）。
- 诊断信息（node/electron 版本、host 状态、解压错误）写入 `globalThis.__hostError` / `__extractError` / `__winError` 全局变量并经 console（`[dsh-harmony]` 前缀）输出到 hilog。

## 4. 生命周期原则

### 4.1 优雅关闭

- 退出时调用 `shutdown` 释放 Host 插件树，不留僵尸进程/端口占用。

### 4.2 崩溃兜底

- `uncaughtException` / `unhandledRejection` 捕获并记录，不静默崩溃。
- Host 启动失败返回 `null` + 兜底空白页，不阻塞 Electron 启动。

## 5. 构建原则

### 5.1 幂等构建

- patch 应用幂等（`git apply --reverse --check` 已应用则跳过）。
- collect-runtime 幂等（可重复执行，`--reverse`/增量）。

### 5.2 二进制不提交

- `libelectron.so`（~172MB）等 SO 加入 `.gitignore`，构建期从 sibling copy。

### 5.3 产物适配集中在收集脚本

- sharp stub / sqlite 注入 / preset patch 等产物适配，统一在 `collect-dsh.mjs` 内完成（构建期），与主进程运行时兜底（main.js）双保险。

## 6. 治理规则

- 提交信息遵循 Conventional Commits 前缀（`feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert`）。
- 模块规范文档（spec/plan）成对产出，规格（WHAT）与技术方案（HOW）分离。
- 文档用中文 + 英文技术术语（对齐 sibling desktop 规范集）。
