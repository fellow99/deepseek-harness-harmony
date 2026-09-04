# 001-host 技术方案（As-Built）

> 本文档为回溯式技术方案，记录 Host 宿主模块的**实际**架构、设计决策与实现策略。
> Module: 001-host
> 对应规格: [spec.md](./spec.md)
> Last Updated: 2026-09-04

## 1. 技术上下文

### 1.1 运行时环境

- 运行于 **Electron-on-鸿蒙 主进程**（Node.js 环境，Electron 37 / Node 22.17.0）。
- 主进程即 dsh Host 宿主：`runProfile('desktop')` 进程内挂起 Host 及其 webserver。
- 源码位置：`src-main/main.js`（单文件 CommonJS 入口，`require('electron')`），
  dsh 的 ESM 产物经动态 `import(pathToFileURL(...))` 加载。
- dsh 产物解压于 `userData/dsh-dist`（`DSH_ROOT`，由 004-artifact-bootstrap 保证就位）。

### 1.2 依赖

| 依赖 | 版本/来源 | 用途 |
|------|-----------|------|
| deepseek-harness（dsh） | 源码引用（同级目录 `../deepseek-harness`），构建期产物 | 被封装宿主；`runProfile` 经 profile-boot 薄入口 |
| `@deepseek-ai/dsh-app-boot` | dsh 产物 `node_modules/@deepseek-ai/dsh-app-boot/lib/index.js` | `loadLayeredEnv`（`DSH_APP_BOOT_LIB`） |
| dsh CLI lib（`DSH_CLI_LIB`） | dsh 产物 `lib/` | `profile-boot-*.js` 薄入口（`findProfileBootEntry` 在此扫描） |
| `profiles/desktop`（`DESKTOP_PROFILE_SRC`） | dsh 产物 `profiles/desktop` | desktop profile 种子（`ensureDesktopProfile` 复制源） |
| `dshmarket` | dsh 产物 `node_modules/dshmarket` | 插件市场（`ensureDshMarketProfileLink` 复制源） |
| node:url / node:os / node:path | Node 22.17.0 内置 | `pathToFileURL` / `networkInterfaces` / `join` |

## 2. 宪法合规检查

| 原则 | 状态 | 说明 |
|------|------|------|
| 架构：零上游改动 | ✅ | 复用 `runProfile` / `loadLayeredEnv`，仅 4 个 patch（含 allow-all-interfaces） |
| 架构：进程内 Host（MVP） | ✅ | `startHost()` 在主进程内 `runProfile('desktop')` |
| 架构：只写装配代码 | ✅ | 仅定位入口 + 读端口 + 拼 URL + 装配 profile，无业务逻辑 |
| 架构：同源数据面 | ✅ | `url = http://<可达地址>:<port>/`，渲染进程同源加载 |
| 安全：围栏语义不变 | ✅ | 本模块不改 dsh 特权方法围栏；0.0.0.0 绑定 + 头改写由 003-lifecycle 兜底 |
| 代码质量：源码即真理 | ✅ | dsh 引用标注源码位置；本模块为 CommonJS（`require('electron')`） |
| 生命周期：优雅关闭 | ✅ | 暴露 `shutdown` 句柄（`shutdown.shutdown(code ?? 0)`） |
| 生命周期：崩溃兜底 | ✅ | 失败返回 `null` + `__hostError` 记录，不阻塞启动 |

> 合规结论：全部 ✅，无 ❌。

## 3. 研究结论

### 3.1 关键决策与理由

| 决策 | 理由 |
|------|------|
| 进程内 `runProfile('desktop')` | 直连 `ctx` 订阅事件最省事；渲染进程只认可达地址，迁移 utilityProcess 透明 |
| `--port 0`（OS 分配端口） | 规避固定端口冲突；读 `ctx.webServer.port` 取实际端口 |
| `--host 0.0.0.0`（绑全部网卡） | 鸿蒙 NEXT 渲染进程访问 127.0.0.1 存在 loopback 网络隔离（main.js:352-354 注释） |
| `pickReachableHost()` 选局域网 IPv4 | 渲染进程需走局域网 IP 建连，故加载地址用局域网 IP 而非 127.0.0.1（main.js:306-322） |
| 返回 `{ ctx, shutdown, port, url }` 句柄 | 封装 dsh 细节，下游窗口/生命周期模块只依赖稳定句柄 |
| 校验 `ctx.webServer` 缺失返回 null | 诊断环境问题（如 zlib.zstd 缺失）并写 `__hostError`，兜底不崩溃 |
| `findProfileBootEntry` 按 mtime 选最新 | tsdown 每次构建生成新 hash 薄入口、旧产物残留，需选最新（main.js:246-247） |
| 运行时禁用 preset 工具行 | cordis Include 直接组合 EntryTree，host 的 cordis.patch.yml 管不到，需运行时 patch（main.js:176-182） |

### 3.2 源码级核实（固化于 main.js 注释）

- `runProfile(options): Promise<{ ctx; shutdown }>` —— 经 `profileBoot.runProfile` 调用（main.js:345）。
- `loadLayeredEnv('dsh')` —— 经 `appBoot.loadLayeredEnv` 调用（main.js:346）。
- webserver 端口 0 语义 + `--host 0.0.0.0`：dsh 已 patch 掉对 0.0.0.0 的拒绝检查（main.js:352-354）。

### 3.3 消费 dsh 的实现（已落地）

`startHost()` 动态 import dsh 编译产物（与 dsh CLI `bin.js` 一致），调用 `runProfile('desktop')`
（main.js:342-355）：

```js
const profileBoot = await import(pathToFileURL(entry).href);
const appBoot = await import(pathToFileURL(DSH_APP_BOOT_LIB()).href);
const runProfile = profileBoot.runProfile;
const loadLayeredEnv = appBoot.loadLayeredEnv;

const { ctx, shutdown } = await runProfile({
  environment: loadLayeredEnv('dsh'),
  profile: 'desktop',
  patchFiles: [],
  args: ['--port', '0', '--host', '0.0.0.0'],
});
```

**鸿蒙/Electron 兼容处理**（均在本模块内完成）：

1. **独立 DSH_HOME**：`process.env.DSH_HOME` 未设置时赋值为 `userData/.dsh`（main.js:331-333），
   避免污染全局 `~/.dsh`。
2. **desktop profile 安装**：`ensureDesktopProfile` 把 `DSH_ROOT/profiles/desktop` 复制到
   `$DSH_HOME/profiles/desktop`（dsh 对未知 profile 默认仅 `dsh-base`）。
3. **dshmarket 复制**：`ensureDshMarketProfileLink` 把 `node_modules/dshmarket` 复制到
   `$DSH_HOME/profiles/node_modules/dshmarket`（复制而非 symlink，适配沙箱/无符号链接场景）。
4. **禁用 HMR**：`process.env.DSH_DISABLE_HMR = '1'`（main.js:337），跳过 runProfile 的 watch-only HMR 挂载。
5. **禁用 preset 工具行**：`patchAgentPresetsRuntime` 在 `runProfile` 前改写 `config/agent-presets/*/agent.cordis.yml`。

## 4. 数据模型

### 4.1 实体定义

宿主句柄（`startHost()` 返回值，main.js:368-373）：

```js
{
  ctx,                                        // dsh Cordis Context（含 webServer.port）
  shutdown: (code) => shutdown.shutdown(code ?? 0),  // 优雅关闭
  port,                                       // ctx.webServer.port（OS 分配的正整数）
  url: 'http://' + host + ':' + port + '/',   // host = pickReachableHost()
}
```

profile-boot 薄入口候选（`findProfileBootEntry` 中间值，main.js:243）：

```js
{ path: fullPath, mtime: statSync(fullPath).mtimeMs }
```

禁用工具行映射（`HARMONY_DISABLED_PRESET_ROWS`，main.js:183-187）：

| 工具行 id | 禁用原因 |
|-----------|----------|
| `tool-bash` | bash 终端依赖 shell/node-pty（MVP 已禁用） |
| `tool-fs-search` | 内容搜索依赖 subprocess 跑 ripgrep（node-pty 已禁用） |
| `persistent-shell` | 持久 shell 依赖 pty（node-pty 已禁用） |

### 4.2 状态转换

```
startHost()
  ├─ findProfileBootEntry() → null ──────────────→ return null（__hostError 未写，仅 console.error）
  ├─ 设置 DSH_HOME（未设置时）→ ensureDesktopProfile → ensureDshMarketProfileLink → DSH_DISABLE_HMR
  ├─ patchAgentPresetsRuntime()
  └─ runProfile(...)
       ├─ ctx.webServer 缺失 → 写 __hostError（'webServer undefined | zlib.zstd=... | ctx keys:...'）→ return null
       ├─ 抛异常 → 扁平化 AggregateError 链 → 写 __hostError → return null
       └─ 成功 → return { ctx, shutdown, port, url }
```

### 4.3 校验规则

- `port`：来自 `ctx.webServer.port`，OS 分配的正整数（`--port 0`），非硬编码。
- `url`：`http://<pickReachableHost()>:<port>/`；`pickReachableHost()` 遍历 `networkInterfaces()`
  取第一个 `family === 'IPv4' && !internal && address` 非空者，无则回退 `127.0.0.1`（main.js:310-322）。
- profile 安装幂等：`$DSH_HOME/profiles/desktop/package.json` 不存在则整目录 `cpSync`；
  存在则合并 `dependencies` 与 `dsh.profile.bundles`（保留用户插件），种子文件（cordis.patch.yml 等）
  一律 `force: true` 覆盖（main.js:260-285）。
- 薄入口判定：文件名匹配 `profile-boot-*.js`、内容含 `export { runProfile`、长度 < 300（main.js:238-242）。
- 工具行禁用幂等：改写前检查 `block` 内是否已有 `disabled:` 行，已禁用则不再插入（main.js:210-222）。

## 5. 接口契约

### 5.1 提供接口（本模块导出/产生的运行时契约）

| 接口 | 类型 | 说明 |
|------|------|------|
| `startHost()` | `async () => HostHandle \| null` | 启动宿主；失败/产物缺失返回 null |
| `HostHandle` | object | `{ ctx, shutdown(code?), port, url }` |
| `DSH_HOME`（环境变量） | string | 宿主数据目录（未设置时由本模块赋值为 `userData/.dsh`） |
| `globalThis.__hostError` | string | 启动失败错误摘要（供生命周期模块显示诊断） |

> 注：`findProfileBootEntry` / `ensureDesktopProfile` / `ensureDshMarketProfileLink` /
> `patchAgentPresetsRuntime` / `pickReachableHost` 均为模块内部函数（CommonJS 单文件内闭包），
> 不对外导出，仅 `startHost` 编排使用；`host` 模块级变量（main.js:469）供生命周期模块消费。

### 5.2 消费接口（本模块 import）

| 来源 | 符号 | 说明 |
|------|------|------|
| dsh profile-boot 薄入口（`DSH_CLI_LIB` 下 `profile-boot-*.js`） | `runProfile` | 挂起 Host（main.js:345） |
| `@deepseek-ai/dsh-app-boot/lib/index.js`（`DSH_APP_BOOT_LIB`） | `loadLayeredEnv` | 构造 environment（main.js:346） |
| dsh 产物目录 `config/agent-presets/` | `agent.cordis.yml` | 运行时禁用工具行（`patchAgentPresetsRuntime`） |
| dsh 产物目录 `profiles/desktop` / `node_modules/dshmarket` | 文件 | profile 装配源 |
| node:os `networkInterfaces` | — | 选可达地址（`pickReachableHost`） |

### 5.3 事件协议

- 本模块**不产生自有事件**，仅透传宿主事件订阅能力：通过返回的 `ctx`（Cordis Context），
  下游可直接订阅 dsh host 事件（`ctx.on(...)`）。本模块不封装/转发事件，仅保证 `ctx` 句柄可达。
- `shutdown` 透传 dsh 的 `shutdown.shutdown(code ?? 0)`，语义与 dsh 保持一致。

## 6. 实现策略

### 6.1 架构模式

**门面（Facade）+ 装配器 + 降级兜底**：

- `startHost()` 是 dsh `runProfile` 的薄门面，封装「入口定位 → 环境装配 → 启动 → 就绪校验 → 拼句柄」。
- 三个装配函数（`ensureDesktopProfile` / `ensureDshMarketProfileLink` / `patchAgentPresetsRuntime`）
  各自独立、幂等，失败不互相阻断（除 profile 外均 try/catch 包裹、不抛出）。
- 失败路径统一返回 `null` + 写 `__hostError`，由生命周期模块决定兜底展示。

### 6.2 关键算法

- **薄入口定位**：`readdirSync(DSH_CLI_LIB())` → 过滤 `profile-boot-*.js` → 读内容匹配
  `export { runProfile` 且 < 300 字符 → 按 mtime 降序取首个（main.js:236-247）。
- **preset 工具行禁用**：逐行扫描 `agent.cordis.yml`，用正则 `/^- id: ([A-Za-z0-9_-]+)\s*$/` 匹配顶层
  row id，命中 `HARMONY_DISABLED_PRESET_ROWS` 则收集其 2 空格缩进 block，在 `name:` 行后或已有
  `disabled:` 处插入 `disabled: true # HarmonyOS: <reason>`（main.js:200-224）。
- **可达地址选择**：遍历 `networkInterfaces()` 取首个非 internal 的 IPv4 地址，回退 `127.0.0.1`
  （main.js:310-322）。
- **错误摘要扁平化**：递归遍历 `AggregateError` 的 `errors` 数组与 `cause` 链（深度 ≤ 6），
  提取各子错误首行消息拼成 ` || ` 分隔摘要，截断 2500 字符写入 `__hostError`（main.js:378-390）。

### 6.3 错误处理

- 薄入口未定位：`console.error` + 返回 null（main.js:327-330）。
- `ctx.webServer` 缺失：采集 `Object.keys(ctx)` 与 `node:zlib.createZstdDecompress` 可用性，
  写入 `__hostError`（main.js:356-364），返回 null。
- `runProfile` 抛异常：扁平化 AggregateError 链写 `__hostError`（截断 2500），返回 null（main.js:374-392）。
- 装配失败：`ensureDesktopProfile` / `ensureDshMarketProfileLink` 内部 try/catch，仅 console.error，
  不阻断启动（其中 dshmarket 复制失败明确标注「不阻塞」）。

### 6.4 性能

- 端口 0 规避端口冲突重试；宿主启动与建窗解耦（就绪后才建窗），无忙等。
- 装配均在启动路径一次性完成，无运行时热路径开销。
- `findProfileBootEntry` 只读文件名 + 内容前缀 + stat mtime，文件量级小，开销可忽略。

## 7. 测试考虑

- **冒烟（已真机验证）**：HarmonyOS 6.1.0.135（API 24）+ Electron 37 / Node 22.17.0 下
  `startHost()` 正常返回句柄、dsh Web UI 可加载、可创建会话（README「已真机验证」）。
- **单元（可建议）**：`pickReachableHost` 回退逻辑（无网卡/仅 loopback 时返回 127.0.0.1）；
  `patchAgentPresetsRuntime` 幂等性（已含 `disabled:` 时不重复插入）；
  `ensureDesktopProfile` 幂等性（用户插件保留 + 种子文件覆盖）。
- **集成（可建议）**：`findProfileBootEntry` 多 hash 产物时选 mtime 最新；`--port 0` 重复启动端口不冲突；
  `shutdown` 重复调用不抛异常（[NEEDS CLARIFICATION]：dsh `shutdown.shutdown` 是否幂等未核实）。
- **边界**：`ctx.webServer` 缺失时 `__hostError` 包含 zlib.zstd 诊断；preset 无 `agent.cordis.yml` 时静默跳过。

## 8. 文件清单

| 文件 | 用途 | 行数 |
|------|------|------|
| `src-main/main.js` | 主进程单文件入口；本模块关注：常量（DSH_CLI_LIB / DSH_APP_BOOT_LIB / DESKTOP_PROFILE_SRC，172-174）、禁用行映射（183-187）、`patchAgentPresetsRuntime`（189-232）、`findProfileBootEntry`（235-252）、`ensureDesktopProfile`（255-289）、`ensureDshMarketProfileLink`（292-304）、`pickReachableHost`（310-322）、`startHost`（324-393） | 537 |

> 同文件内其他函数（`extractTarGz`/`ensureDshExtracted` 属 004-artifact-bootstrap；
> `ensureLoopbackNoProxy`/`ensureSandboxHome`/`installLoopbackHeaderRewrite`/`before-quit` 属 003-lifecycle；
> `BrowserWindow` 创建/`loadURL` 属 002-window）不属于本模块，仅在依赖中提及。

## 9. 与规格的交叉引用

| 规格需求 | 实现位置 |
|----------|----------|
| FR-001-001（统一启动入口） | `startHost()`（main.js:325-393） |
| FR-001-002（空闲端口） | `args: ['--port', '0', ...]` + `port = ctx.webServer.port`（main.js:354、365） |
| FR-001-003（desktop profile） | `profile: 'desktop'`（main.js:350） |
| FR-001-004（绑定 0.0.0.0） | `args: ['--port', '0', '--host', '0.0.0.0']`（main.js:354） |
| FR-001-005（返回句柄） | return `{ ctx, shutdown, port, url }`（main.js:368-373） |
| FR-001-006（校验 webServer） | `if (!ctx.webServer) { ...; return null; }`（main.js:356-364） |
| FR-001-007（可达地址 URL） | `pickReachableHost()` + `url: 'http://' + host + ':' + port + '/'`（main.js:366、372） |
| FR-001-008（desktop profile 安装幂等） | `ensureDesktopProfile`（main.js:255-289） |
| FR-001-009（dshmarket 复制） | `ensureDshMarketProfileLink`（main.js:292-304） |
| FR-001-010（薄入口定位） | `findProfileBootEntry`（main.js:235-252） |
| FR-001-011（工具行禁用幂等） | `patchAgentPresetsRuntime` + `HARMONY_DISABLED_PRESET_ROWS`（main.js:183-232） |
| FR-001-012（优雅关闭） | `shutdown: (code) => shutdown.shutdown(code ?? 0)`（main.js:370） |
| FR-001-013（失败返回 null） | `startHost()` 三条 return null 路径（main.js:329、363、391） |
