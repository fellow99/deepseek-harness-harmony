# 006-runtime-profile 技术方案（As-Built）

> 本文档为回溯式技术方案，记录运行时 profile 与 patch 模块的**实际**架构、设计决策与实现策略。
> Module: 006-runtime-profile
> 对应规格: [spec.md](./spec.md)
> Last Updated: 2026-09-04

## 1. 技术上下文

### 1.1 运行时环境

- **形态**：纯声明式配置（JSON + YAML）与静态补丁（git unified diff），无自研运行时代码。
- **位置**：`profiles/desktop/`（随应用分发的 profile 种子）与 `patches/`（构建期作用于 dsh 源码）。
- **消费方**：
  - `profiles/desktop/` 由 `001-host` 在运行期复制到 `$DSH_HOME/profiles/desktop`（`ensureDesktopProfile`），
    并由 dsh 的 profile 机制在 `runProfile('desktop')` 时装配；
  - `patches/` 由 `005-build-pipeline`（`scripts/build-dsh.mjs`）在构建期 `git apply` 到 `../deepseek-harness` 源码。

### 1.2 依赖

| 依赖 | 版本/来源 | 用途 |
|------|-----------|------|
| `dshmarket` | `1.26.0`（`profiles/desktop/package.json` dependencies） | 插件市场 bundle，随 profile 组合 |
| `@deepseek-ai/dsh-base` | dsh 源码引用（bundles 名） | profile 基础面 bundle |
| `@deepseek-ai/dsh-web-app` | dsh 源码引用（bundles 名） | profile 浏览器面 bundle（含 web-runtime / webserver 行） |
| Cordis（dsh 内置） | dsh 内置 | patch 语法（`id` 定位 + 整块替换 + `disabled: true`） |
| dsh 源码基线 | `dsh-v0.1.2-rc.1`（4 个 patch 的基线） | patch 的作用对象 |

> 4 个 patch 的作用文件（dsh 仓库内路径）：
> `packages/boot/app-boot/src/profile.ts`、`packages/bundle/web-app/src/startup.ts`、
> `apps/cli/src/profile-boot.ts`、`packages/host/directory-picker-auto/src/resolve.ts`。

## 2. 宪法合规检查

| 原则 | 状态 | 说明 |
|------|------|------|
| 架构：零上游改动 | ✅ | 对 dsh 的改动收敛于 4 个 patch + 1 份 cordis.patch.yml，不 fork |
| 架构：只写装配代码 | ✅ | 纯配置装配 + 静态补丁，无自定义业务逻辑 |
| 架构：同源数据面 | ✅ | 复用 web-app bundle 的 webserver，不改变数据面载体 |
| 架构：进程内 Host（MVP） | ✅ | profile 与进程模型无关，由 001-host 决定 |
| 安全：围栏语义不可破坏 | ✅ | allow-all-interfaces 仅移除 `0.0.0.0` 拒绝检查，不改特权方法围栏 |
| 安全：沙箱边界 | ⚠️ | 原生沙箱（landlock/koffi）MVP 禁用，工具调用无沙箱隔离（已知取舍） |
| 代码质量：源码即真理 | ✅ | 每个 patch 目标文件 + 行号可溯源；注释标注根因 |
| 构建：幂等构建 | ✅ | 4 patch 幂等应用（`git apply --reverse --check` 跳过已应用） |

> 合规结论：除沙箱边界为已知取舍（⚠️）外，其余全部 ✅，无 ❌。

## 3. 研究结论

### 3.1 关键决策与理由

| 决策 | 理由 | 对应 FR |
|------|------|---------|
| 新建独立 `desktop` profile（非复用 `web` profile） | 干净、可演进，不依赖 `web` profile 内部行 id 稳定（工程规划 §3 原则） | FR-006-001 |
| bundles = `dsh-base` + `dsh-web-app` + `dshmarket` | 复用 web 组合 + 内置插件市场；`dshmarket` 经 `dsh.profile.bundles` 声明为 bundle | FR-006-001/002 |
| `webserver` 覆盖 `host: '0.0.0.0'`（literal，非 `--host` 参数） | 绕过 `--host` 参数解析；鸿蒙 NEXT 渲染进程访问 127.0.0.1 被 loopback 网络隔离拦截 | FR-006-004 |
| 禁用 4 插件（subprocess/sandbox/bash-sandbox/permission） | dsh-dist 在 Windows 上收集，`node-pty`(subprocess)/`koffi`(sandbox) 二进制 win32-x64，鸿蒙 aarch64 无法加载；bash-sandbox 依赖 subprocess+sandbox，permission 依赖 shell | FR-006-005 |
| `dsh-market` 覆盖 `profile: desktop` + `allowRestart: false` | 市场默认 profile 为 'web'（写错目录）；桌面壳拥有进程生命周期，市场不得 spawn 独立 dsh 进程重启 | FR-006-006 |
| symlink 回退 copy（`cpSync`） | 鸿蒙沙箱禁 symlink（EACCES/EPERM/ENOSYS/EOPNOTSUPP），`healProfilesModuleFallback` 必须回退物化 | FR-006-008 |
| 移除 `--host 0.0.0.0` 拒绝检查 | dsh 上游因安全拒绝全网卡绑定；鸿蒙需绑全网卡 + 局域网 IP，必须放行 | FR-006-009 |
| `DSH_DISABLE_HMR` 开关 | dsh watch-only HMR 依赖 `--expose-internals`，打包桌面场景不应挂载 | FR-006-010 |
| `'electron' in process.versions` → `browse` | native picker 的 worker 用 `process.execPath`（Electron 下为 electron.exe），koffi 依赖 Node 内部符号，spawn 即失败 | FR-006-011 |

### 3.2 源码级核实（patch 内容 vs dsh 源码行为）

- **symlink-to-copy**（`app-boot/src/profile.ts` 的 `ensureSymlink`）：patch ① 导入 `cpSync`；② 在
  `stat.isDirectory()` 分支新增 `return`（真实目录已物化，不再抛错）；③ 在 `symlinkSync` 的 catch 里对
  `EACCES`/`EPERM`/`ENOSYS`/`EOPNOTSUPP` 回退 `cpSync(target, link, { recursive, dereference, filter })`，
  其中 filter 跳过 `node_modules`；④ `EEXIST` 竞争分支保留原「相同链接即成功」语义，仅重构 try/catch 结构。
- **allow-all-interfaces**（`bundle/web-app/src/startup.ts` 的 `apply`）：删除 3 行
  `if (options.host === '0.0.0.0') program.error(...)` 拒绝检查，仅保留 `--port` 数字校验。
- **disable-hmr**（`apps/cli/src/profile-boot.ts` 的 `runProfile`）：在 HMR 挂载条件前插入
  `!process.env.DSH_DISABLE_HMR &&`，使开关为真时短路。
- **disable-native-picker**（`directory-picker-auto/src/resolve.ts` 的 `resolveDirectoryPickerBackend`）：
  在函数体开头插入 `if ('electron' in process.versions) return 'browse'`，先于 bindHost/SSH/platform 判断。

## 4. 数据模型

### 4.1 文件 `profiles/desktop/package.json`

| 字段 | 值 | 说明 |
|------|-----|------|
| `name` | `dsh-desktop-profile` | profile 工程名 |
| `private` | `true` | 不发布 |
| `dependencies.dshmarket` | `1.26.0` | 插件市场依赖（FR-006-002） |
| `dsh.profile.bundles` | `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dshmarket"]` | 组合声明（FR-006-001） |

### 4.2 文件 `profiles/desktop/cordis.patch.yml`（62 行）

| id | 覆盖内容 | 说明 | 对应 FR |
|----|----------|------|---------|
| `web-runtime`（行 13-19） | `printUrl: false`、`surfaceContext: true`、`trustedHosts: !!js ctx.webStartup.trustedHosts` | 关 URL 打印、保持原值 | FR-006-003 |
| `subprocess`（行 32-33） | `disabled: true` | 禁用终端子进程（node-pty） | FR-006-005 |
| `sandbox`（行 34-35） | `disabled: true` | 禁用进程沙箱（koffi/landlock） | FR-006-005 |
| `bash-sandbox`（行 36-37） | `disabled: true` | 禁用 bash 沙箱（依赖上两者） | FR-006-005 |
| `permission`（行 38-39） | `disabled: true` | 禁用权限插件（依赖 shell） | FR-006-005 |
| `webserver`（行 44-49） | `host: '0.0.0.0'`、`port: !!js ctx.webStartup.port ?? 3080` | 绑全网卡 + 端口注入 | FR-006-004/007 |
| `dsh-market`（行 58-62） | `profile: desktop`、`allowRestart: false` | 市场运行配置 | FR-006-006 |

### 4.3 4 个上游 patch 文件

| 文件 | 目标（dsh 内） | 体积 | 改动行为 |
|------|----------------|------|----------|
| `dsh-symlink-to-copy.patch` | `packages/boot/app-boot/src/profile.ts` | 2515B | `ensureSymlink`：EACCES 等 → cpSync 回退；真实目录直接 return |
| `dsh-allow-all-interfaces.patch` | `packages/bundle/web-app/src/startup.ts` | 771B | 删除 `--host 0.0.0.0` 拒绝检查 |
| `dsh-disable-hmr.patch` | `apps/cli/src/profile-boot.ts` | 663B | HMR 挂载前置 `DSH_DISABLE_HMR` 开关 |
| `dsh-disable-native-picker.patch` | `packages/host/directory-picker-auto/src/resolve.ts` | 1044B | Electron 下强制返回 `browse` |

## 5. 接口契约

### 5.1 提供接口（本模块对外提供）

| 接口 | 形态 | 说明 |
|------|------|------|
| `desktop` profile | `dsh.profile.bundles` + `cordis.patch.yml` | 供 dsh profile 机制发现/加载 |
| 4 个上游 patch | git unified diff 文件 | 供 005-build-pipeline 在构建期 apply |
| 禁用集 | `cordis.patch.yml` 的 `disabled: true` 行 | 装配期排除依赖原生模块的插件 |

### 5.2 消费接口（本模块 import/依赖）

| 来源 | 符号/机制 | 说明 |
|------|-----------|------|
| dsh profile 机制 | `dsh.profile.bundles` | 组合声明 |
| cordis patch 机制 | 行级 `id` 覆盖 + `disabled: true` | 覆盖与禁用 |
| `@deepseek-ai/dsh-base` / `dsh-web-app` / `dshmarket` | bundle | 被组合对象 |
| dsh 上游源码（4 文件） | `ensureSymlink`/`apply`/`runProfile`/`resolveDirectoryPickerBackend` | patch 作用点 |

### 5.3 事件协议

- 本模块为纯配置 + 静态补丁，无运行时事件/协议。
- `webserver` 行的 `inject: [webStartup]` 为 cordis 装配期注入点（对 web-app bundle 的 webStartup 生效），
  属声明式装配，非运行时事件。

## 6. 实现策略

### 6.1 架构模式

**声明式装配（declarative composition）+ 静态补丁（static patch）**：

- 组合（bundles）用 JSON 声明，覆盖（override）用 YAML patch 声明，上游适配用 git diff 声明；
- 无任何自研运行时代码，本模块是 4 个「纯数据文件 + 6 个纯配置/补丁文件」的集合。

### 6.2 关键算法

- **覆盖定位**：cordis patch 以 `id` 精确定位目标行，整块替换 `config`，避免逐字段合并歧义
  （`web-runtime`/`webserver`/`dsh-market` 三处）。
- **上下文取值**：`trustedHosts` 用 `!!js ctx.webStartup.trustedHosts`、`port` 用 `!!js ctx.webStartup.port ?? 3080`
  在装配期从上下文取值，而非写死（FR-006-003/007）。
- **symlink 回退物化**：`symlinkSync` 抛 `EACCES`/`EPERM`/`ENOSYS`/`EOPNOTSUPP` 时
  `cpSync(target, link, { recursive: true, dereference: true, filter: 跳过 node_modules })`；
  已是真实目录（`stat.isDirectory()`）时直接 `return` 视为已物化（FR-006-008）。
- **幂等应用**：`git apply --reverse --check` 判定已应用则跳过（构建侧实现，见 005；本模块保证补丁内容
  在基线版本上可干净正向应用）。

### 6.3 错误处理

- 纯配置无运行时错误路径；patch 与上游行不匹配时由 `git apply` 报错（构建期暴露）。
- symlink patch 保留 `EEXIST` 竞争分支：相同链接已由并发进程创建即视为成功，否则抛错（原语义不变）。
- 覆盖行 `id` 与上游不一致时由 cordis 装配过程报错（消费 dsh 后验证）。

### 6.4 性能

- 配置与补丁仅影响构建期/装配期，无运行时热路径开销。
- symlink→copy 的 `cpSync` 过滤 `node_modules`，避免递归拷贝依赖目录（物化开销可控）。

## 7. 测试考虑

- **幂等（构建期，可建议）**：对 `dsh-v0.1.2-rc.1` 基线正向 `git apply` 4 个 patch 成功；重复 apply 被
  `--reverse --check` 跳过；`--reverse` 可干净回滚（FR-006-012）。
- **patch 语义（源码级，可建议）**：
  - symlink 沙箱 EACCES 下 `ensureSymlink` 回退 cpSync 且不抛错；目标已是目录时 return（FR-006-008）；
  - `--host 0.0.0.0` 不再被 `program.error` 拒绝（FR-006-009）；
  - `DSH_DISABLE_HMR='1'` 下 `runProfile` 不挂载 HMR（FR-006-010）；
  - `process.versions.electron` 存在时 `resolveDirectoryPickerBackend` 返回 `browse`（FR-006-011）。
- **集成（已真机验证）**：HarmonyOS 6.1.0.135（API 24）+ Electron 37 / Node 22.17.0 下宿主以
  `desktop` profile 启动成功，Web UI 经局域网 IP 加载（README「已真机验证」、工程规划 §18.7）。
- **边界**：上游版本变更导致 patch 失配时 `git apply` 的报错提示（[NEEDS CLARIFICATION：未验证对
  rc.7 之后版本的兼容性]）；禁用集插件被其它插件硬依赖时的装配告警。

## 8. 文件清单

| 文件 | 用途 | 行数/体积 |
|------|------|-----------|
| `profiles/desktop/package.json` | 声明 `desktop` profile 组合与 dshmarket 依赖 | 12 行 |
| `profiles/desktop/cordis.patch.yml` | web-runtime/webserver/dsh-market 覆盖 + 4 插件禁用 | 62 行 |
| `patches/dsh-v0.1.2-rc.1/dsh-symlink-to-copy.patch` | symlink EACCES → cpSync 回退 | 46 行 / 2391B |
| `patches/dsh-v0.1.2-rc.1/dsh-allow-all-interfaces.patch` | 移除 `0.0.0.0` 拒绝检查 | 14 行 / 771B |
| `patches/dsh-v0.1.2-rc.1/dsh-disable-hmr.patch` | `DSH_DISABLE_HMR` 开关跳过 HMR | 14 行 / 781B |
| `patches/dsh-v0.1.2-rc.1/dsh-disable-native-picker.patch` | Electron 下目录选择器走 browse | 13 行 / 1044B |

## 9. 与规格的交叉引用

| 规格需求 | 实现位置 |
|----------|----------|
| FR-006-001（bundles 组合） | `profiles/desktop/package.json:9`（`dsh.profile.bundles`） |
| FR-006-002（dshmarket 依赖） | `profiles/desktop/package.json:5`（`dshmarket: 1.26.0`） |
| FR-006-003（关 URL 打印） | `cordis.patch.yml:13-19`（`web-runtime` 覆盖） |
| FR-006-004（绑定 0.0.0.0） | `cordis.patch.yml:44-49`（`webserver` 覆盖 `host: '0.0.0.0'`） |
| FR-006-005（禁用 4 插件） | `cordis.patch.yml:32-39`（`subprocess`/`sandbox`/`bash-sandbox`/`permission`） |
| FR-006-006（dsh-market 配置） | `cordis.patch.yml:58-62`（`profile: desktop`、`allowRestart: false`） |
| FR-006-007（端口注入） | `cordis.patch.yml:49`（`port: !!js ctx.webStartup.port ?? 3080`） |
| FR-006-008（symlink 回退 copy） | `patches/dsh-v0.1.2-rc.1/dsh-symlink-to-copy.patch`（`ensureSymlink` 的 cpSync 回退 + isDirectory return） |
| FR-006-009（移除 0.0.0.0 拒绝） | `patches/dsh-v0.1.2-rc.1/dsh-allow-all-interfaces.patch`（删除 `program.error(...)` 3 行） |
| FR-006-010（DSH_DISABLE_HMR） | `patches/dsh-v0.1.2-rc.1/dsh-disable-hmr.patch`（`!process.env.DSH_DISABLE_HMR &&`） |
| FR-006-011（Electron → browse） | `patches/dsh-v0.1.2-rc.1/dsh-disable-native-picker.patch`（`if ('electron' in process.versions) return 'browse'`） |
| FR-006-012（幂等应用） | 4 个 patch 均支持 `git apply --reverse --check`（由 005 在构建期执行） |
