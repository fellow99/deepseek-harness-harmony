# 011-runtime-provisioning 技术方案

> 模块：011-runtime-provisioning
> 对应规格：[specs/011-runtime-provisioning/spec.md](./spec.md)
> Last Updated: 2026-09-18
>
> ⛔ **HNP 已整体移除（2026-09-23）**：`hnpPackages` 声明、`electron/hnp{,-src}/` 载荷与探针、`scripts/inject-hnp.ps1` 与 `inject-hnp-app.ps1`、以及 `build-hap.ps1` 的自动嵌入逻辑与 `-hnp` 产物**均已删除** —— 本工程不再使用 HNP（见 `docs/鸿蒙环境能力清单-v0.1.5.md` A.2 #30）。故本文件中凡以「路径 A / HNP 打包」为前提的表述（`inject-hnp.ps1`、`hnpPackages`、`hnp.json`、含 `hnp/` 的验收步骤）**均不再适用**，仅作为当时的设计记录保留。**设备端第三方 HNP 仍被复用**：`/data/service/hnp/bin` 提供的 node 是路径 C 的事实基础。

## 1. 技术上下文

### 1.1 运行时环境

- **构建期**：Windows 宿主机 Node（`node scripts/*.mjs`）执行 `collect-runtime → build-dsh → collect-dsh` 三阶段；随后 `build-hap.ps1` 产出 HAP，`inject-hnp.ps1` 在签名前嵌入 HNP 并重签。
- **运行期**：Electron-on-鸿蒙（Electron 37 / Node 22.17.0）主进程内的 dsh Host。本模块供给的运行时与 shim 都被**同一个主进程**消费，不引入独立服务进程。
- **部署形态**：`dsh-dist.tar.gz` → resfile → 首启解压到 `$DSH_HOME/dsh-dist`；运行时产物若走路径 A，则作为 **public HNP** 随 HAP 由系统 installer 安装到 `/data/service/hnp`（与 `dsh-dist` 解压彼此独立）。

### 1.2 依赖

| 依赖 | 来源 | 用途 |
|---|---|---|
| `dshmarket`（`../dsh-market`，v1.26.0） | sibling 源码引用（submodule） | 安装通道的消费者：`dsh-cli.ts` 的 spawn 点 |
| `dsh-dist/lib/bin.js` | 本工程 `collect-dsh` 产物 | `dsh` shim 的 CLI 入口（路径 A） |
| `scripts/inject-hnp.ps1` | 本工程 | 路径 A 的 HNP 嵌入 + 重签（既有，已真机验证） |
| Node aarch64-ohos 运行时 | **第三方构建**（Node 官方无该平台二进制，`[研究]`） | 路径 A 的解释器 |
| standalone pnpm（单文件） | pnpm GitHub releases（版本固定，对齐 desktop `9.15.9`） | 路径 A 的 pnpm 入口点 |
| pnpm 的 JavaScript | 官方 npm registry | 路径 B 的进程内 pnpm |
| 二进制证书 | 华为在线工单（**用户所有**） | 路径 A 的 ELF 签名（硬前置） |
| `ohos.permission.ALLOW_EXTERNAL_NATIVE_CODE`（ACL） | AGC（**用户所有**） | 仅 `executableBinaryPaths` 备选形态需要 |
| desktop 参考实现 | `dsh-desktop/src/main/runtime.ts`、`scripts/fetch-runtime.mjs` | shim / PATH / 完整性校验的同构解 |

> 本模块**不**新增 npm 运行时依赖到本工程 `package.json`：路径 B 的 pnpm JS 由构建脚本获取并物化进 `dsh-dist`，不进入宿主依赖树。

## 2. 宪法合规检查

| 宪法原则（`specs/constitution.md`） | 状态 | 说明 |
|---|---|---|
| §1.1 零上游改动 | ✅ | 不改 `deepseek-harness` 源码；路径 B 对 `dsh-market` 的改动以**本工程补丁**组织（§11），不改第三方仓库的提交历史 |
| §1.3 只写装配代码 | ✅ | 只做运行时获取 / 注入 / shim / 探测，不新造业务逻辑 |
| §3.1 源码即真理 | ✅ | 本文档所有符号 / 行号均来自实际读取；不确定处标 `未验证` / `[NEEDS CLARIFICATION]` |
| §3.3 日志规范 | ✅ | 运行期新增日志统一 `[dsh-harmony]` 前缀 |
| §4.1 优雅关闭 | ✅ | 不涉及进程 / 端口生命周期 |
| §5.1 幂等构建 | ✅ | 运行时获取按版本戳跳过；shim 每次启动重写（幂等）；补丁 `git apply --reverse --check` 幂等 |
| §5.3 产物适配集中在收集脚本 | ✅ | 构建期适配在 `collect-dsh.mjs` / `build-dsh.mjs`，运行期兜底在 `main.js`，双保险 |
| §6 治理规则（spec/plan 成对） | ✅ | 本模块产出 `spec.md` + `plan.md` + `tasks.md` + `test-cases.md` |

## 3. 方案定型与接线位置

### 3.1 定型

| 项 | 结论 |
|---|---|
| **主路径** | **路径 A**：随包携带签名 Node ELF（首选 public HNP） |
| **过渡 / 兜底路径** | **路径 B**：进程内 JS 跑 pnpm（证书未到手时的可落地通道） |
| **机会性兜底** | **路径 C**：复用设备第三方 Node（仅 A/B 都不可用时，且必须标注"设备环境"） |
| **决策规则** | 见 `spec.md` §4.3；降级有序、禁跳级 |
| **关键前置** | 二进制证书（用户工单） + 按需 ACL 申请 —— **阻塞路径 A** |

### 3.2 为什么把注入点放在 `startHost()` 内

`src-main/main.js` 的既有锚点（`[源码]`）：

| 行 | 符号 | 语义 |
|---|---|---|
| `:596-598` | `USER_HOME_BEFORE_SANDBOX` | 在 `HOME` 被改写前抓真实用户家目录 |
| `:631` | `ensureSandboxHome()` | 把 `HOME` 指向 `userData`（必须在任何 `homedir()` 推导之前） |
| `:865` | `ensureDshExtracted()` | 解压 `dsh-dist` → `DSH_ROOT` 就位 |
| `:869` | `startHost()` | 启动 dsh Host |
| `:470` | `ensureDesktopProfile()` | 复制 desktop profile |
| `:471` | `ensureDshMarketProfileLink()` | 复制 `dshmarket` 到 `profiles/node_modules` |
| `:472` | `ensureDshPluginsProfileLink()` | 复制 `harmony-plugin-*` 到 `profiles/node_modules` |
| `:474` | `installExtraWritableRoots()` | 设置 `DSH_EXTRA_WRITABLE_ROOTS`（部署期状态） |
| `:496` | `runProfile({ profile: 'desktop', … })` | **Host 组合的唯一起点** |

**注入点**：在 `startHost()` 内、`ensureDshPluginsProfileLink()`（`:472`）之后、`installExtraWritableRoots()`（`:474`）之前，插入 `setupMarketRuntime()`。理由：

1. **必须晚于 `ensureDshExtracted()`**（`:865`）：shim 的 CLI 入口是 `DSH_ROOT/lib/bin.js`，`DSH_ROOT` 由 `ensureDshExtracted()` 设定（`getDshRoot()`）；
2. **必须晚于 `ensureSandboxHome()`**（`:631`）：`<userData>/runtime-bin` 的推导依赖 `app.getPath('userData')`，且运行时目录若按 `homedir()` 推导须先定 `HOME`；
3. **必须早于 `runProfile()`**（`:496`）：`dshmarket` 的 `spawnEnv()` 在每次 spawn 时读 `process.env.PATH`（`dsh-market/src/dsh-cli.ts:235-250`），而 `provisionPnpm()` / `probePnpm()` 都发生在 Host 起来**之后**的 UI 交互中——因此只要在 `runProfile` 前把 `PATH` / `PNPM_HOME` 写好即可；
4. **与 `installExtraWritableRoots()` 无耦合**：两者都改 `process.env`，但语义正交（前者改运行时搜索路径，后者改沙箱可写白名单），顺序不影响正确性——放在其后便于"先运行时、后沙箱策略"的阅读顺序（也可放在其后，见 §3.3）。

这与 desktop 的做法一致：`setupMarketRuntime()` 在 `startHost()` 之前调用（`[参考]` `dsh-desktop/src/main/runtime.ts:130`），本工程把它落在 `startHost()` 函数体内、`runProfile` 之前。

### 3.3 精确接线（伪代码，`[设计]`）

```js
// src-main/main.js —— startHost() 内
ensureDesktopProfile(process.env.DSH_HOME);
ensureDshMarketProfileLink(process.env.DSH_HOME);
ensureDshPluginsProfileLink(process.env.DSH_HOME);
setupMarketRuntime();            // ← 011 新增：探测 → 校验 → 注入 PATH/PNPM_HOME → 生成 shim
installExtraWritableRoots();
process.env.DSH_DISABLE_HMR = '1';
// … DSH_BUNDLED_SKILL_DIR …
patchAgentPresetsRuntime();
const runProfile = profileBoot.runProfile;
await runProfile({ … });         // Host 组合
```

`setupMarketRuntime()` 内部顺序（`[设计]`，见 §4 / §5）：

```
1. 探测：路径 A 产物存在且校验通过？
2. 探测：路径 B 的 pnpm JS 存在且可解析？
3. 探测：路径 C 的设备 node 存在且 `node -e` 探针通过？
4. 依 §4.3 选定路径 → 组装供注入的目录集合与 PNPM_HOME
5. 校验每个将前置的目录（§9）→ 只保留通过者
6. 生成 dsh shim（仅路径 A；§7）
7. 前置 PATH、设置 PNPM_HOME（§8）
8. 打印 [dsh-harmony] 采用的路径 + 探测结果
```

**失败处置**：`setupMarketRuntime()` **不得**抛异常出 `startHost()`——探测失败即按 §4.3 降级或落到规则 4（显式失败但仅影响市场安装通道，不阻塞应用启动）。

## 4. 文件 / 模块布局

### 4.1 运行期（`src-main/`）

| 路径 | 职责 |
|---|---|
| `src-main/main.js` | 新增 `setupMarketRuntime()` 及其子函数，在 `startHost()` 内调用（§3.2） |
| `src-main/market-runtime.js` | **新增**：把供给逻辑抽成可单测的纯模块（探测 / 校验 / PATH 组装 / shim 生成），`main.js` 只做接线与日志 |

> 抽取为独立 `.js` 的目的与既有 `harmony-plugin-*` 的纯模块策略一致：核心逻辑可在裸 Node 上被单测直接驱动（无需 Electron 运行时）。`main.js` 通过 `require('./market-runtime.js')` 使用。

### 4.2 构建期（`scripts/`）

| 路径 | 职责 |
|---|---|
| `scripts/fetch-market-runtime.mjs` | **新增**：获取 Node（路径 A，第三方构建）+ standalone pnpm 到 `runtime/`；版本戳 + 完整性校验；截断产物不写戳 |
| `scripts/collect-dsh.mjs` | 扩展：把路径 B 的 pnpm JS 物化进 `dsh-dist/node_modules/`；把路径 A 的运行时物化进可嵌入位置 |
| `scripts/build-dsh.mjs` | 扩展：路径 B 时，在 `dsh-market` 构建**之前**应用 `patches/dsh-market-v<ver>/` 补丁（幂等） |
| `scripts/inject-hnp.ps1` | **复用**（路径 A）：已支持 `--hnp-path` + 重签；扩展指向新的 `dshruntime.hnp` 载荷目录 |
| `scripts/collect-runtime.mjs` | **无需改**（§10）；`module.json5` 已在 `OVERLAY_FILES`、`hnp` 载荷不在其管辖范围 |

### 4.3 载荷与声明

| 路径 | 职责 |
|---|---|
| `electron/hnp-src-runtime/hnp.json` | **新增**：路径 A 的 HNP 清单（`type: hnp-config`、`name`、`version`、`install.links`） |
| `electron/hnp-src-runtime/bin/…` | **新增**：路径 A 的 ELF（`node`、`pnpm`）；构建期由 `fetch-market-runtime.mjs` 填入，不入库 |
| `electron/hnp/arm64-v8a/dshruntime.hnp` | **新增**（gitignored 产物）：由 `hnpcli` 打包，`inject-hnp.ps1` 消费 |
| `electron/src/main/module.json5` | **改**：`hnpPackages` 增一行（§6）；`requestPermissions` 按需增（FR-5.2） |
| `runtime-overlays/electron/src/main/module.json5` | **同步改**：`OVERLAY_FILES` 已含该文件，改源必须同步 overlay，否则阶段 3 回盖 + 阶段 7.6 守卫失败 |

### 4.4 补丁（路径 B）

| 路径 | 职责 |
|---|---|
| `patches/dsh-market-v1.26.0/dsh-market-in-process-pnpm.patch` | **新增**：把 `dsh-market` 的 spawn 点改为进程内调用（§11） |

### 4.5 文档与技能

| 文件 | 内容 |
|---|---|
| `specs/011-runtime-provisioning/{spec,plan,tasks,test-cases}.md` | 本模块四件套 |
| `skills/harmony-runtime-capabilities/SKILL.md` | **同步**：能力变化时必须更新（`spec.md` §9.5） |
| `README.md` / `README_zh.md` | 构建阶段说明、运行期供给说明、上架约束（二进制证书 / ACL） |
| `specs/201-dsh-market/spec.md` | 关闭其 `:35,131` 的 `[NEEDS CLARIFICATION]`（或指向本模块） |

## 5. 引导时序（相对既有锚点的完整顺序）

```
[构建期]
 ① node scripts/collect-runtime.mjs        # 既有：copy 运行时 + overlays（含 module.json5）
 ② node scripts/fetch-market-runtime.mjs   # 011：获取 Node(A) + pnpm；校验；版本戳
 ③ node scripts/build-dsh.mjs              # 既有：patch dsh + build；011：路径 B 时先 patch dsh-market
 ④ node scripts/collect-dsh.mjs            # 既有：物化；011：物化路径 B 的 pnpm JS
 ⑤ tar dsh-dist → dsh-dist.tar.gz          # 既有
 ⑥ build-hap.ps1                           # 既有：产出 unsigned hap
 ⑦ inject-hnp.ps1                          # 既有（路径 A）：--hnp-path 嵌入 dshruntime.hnp + 重签
 ⑧ hdc install + start                     # 既有

[运行期]（app.whenReady 之后）
 ensureDshExtracted()          :865   → DSH_ROOT 就位
 startHost()                   :869
   ensureDesktopProfile()      :470
   ensureDshMarketProfileLink():471
   ensureDshPluginsProfileLink():472
   setupMarketRuntime()        ← 011：探测 → 校验 → 注入 → shim
   installExtraWritableRoots() :474
   DSH_DISABLE_HMR / skills    :475-484
   patchAgentPresetsRuntime()  :488
   runProfile({desktop})       :496   ← 此后市场的 spawnEnv() 才读得到注入后的 PATH
```

> **`nodeBinDir` 的求值时机**：`dsh-market/src/dsh-cli.ts:68` 的 `nodeBinDir = dirname(nodeExecutable())` 是**模块加载期常量**——它在 `dshmarket` 被 import 时求值。本工程的 `dshmarket` 是 Host 起来后由 bundle loader import 的，故 `setupMarketRuntime()` 在 `runProfile` 前完成即可保证 `nodeExecutable()` / `nodeBinDir` 看到正确环境（`process.argv0` / `process.execPath` 不受 PATH 影响；PATH 只影响 spawn 解析）。**这条依赖关系需在真机用例中确认**（`test-cases.md` TC-D3）。

## 6. `hnp.json` 与 `module.json5` 变更

### 6.1 路径 A 的 `hnp.json`（`[设计]`，形态对齐既有 `electron/hnp-src/hnp.json`）

既有探针清单（`[源码]` `electron/hnp-src/hnp.json`）为：

```json
{
  "type": "hnp-config",
  "name": "dshprobe",
  "version": "1.0.0",
  "install": { "links": [ { "source": "/bin/dsh-probe", "target": "dsh-probe" } ] }
}
```

新增运行时清单 `electron/hnp-src-runtime/hnp.json`（`name` / `version` 为 `[设计]` 占位语义，落地时按实际运行时版本固定）：

```json
{
  "type": "hnp-config",
  "name": "dshruntime",
  "version": "<runtime-version>",
  "install": {
    "links": [
      { "source": "/bin/node", "target": "node" },
      { "source": "/bin/pnpm", "target": "pnpm" }
    ]
  }
}
```

- `source` 为包内相对路径（既有探针用 `/bin/dsh-probe`，系统映射到 `<pkg>.org/<name>_<version>/bin/dsh-probe`）；
- `target` 为 `/data/service/hnp/bin` 下的裸命令名，故 `node` / `pnpm` 直接可解析；
- **`name` / `version` 不得含空格或特殊字符、目录不得用中文**（`[官方]` HNP 指南，`docs/鸿蒙环境能力清单-v0.1.5.md:289`）；
- **Linux/macOS/ohos 上打包会继承 UGO 权限，须自行 `chmod 755`；Windows 上打包则自动赋予 other 可执行位**（`[官方]` `:294`）——本工程在 Windows 构建期打包，故 **Windows 路径自动处理**，但**必须在 `inject-hnp.ps1` 前校验 ELF 的可执行位语义**（`未验证`：Windows 上打的 HNP 在设备上是否保留 other 可执行位）。
- **`npm` / `npx` 不建链接**：Node 发行版的 `npm` / `npx` 入口是带 `#!/usr/bin/env node` 的壳/JS（B3），符号链接到 `.js` 不构成可执行入口。故路径 A **只供给 `node` 与 `pnpm`**；需要 `npm` 的路径（`provisionPnpm()` 的 `npm i -g pnpm` 回退）在设备上**不可用**，市场须走路径 A 自带的 pnpm 入口点。

### 6.2 `module.json5` 变更（`[设计]`，同时改源 + overlay）

`electron/src/main/module.json5` 的 `hnpPackages`（现含一行，`:37-42`）增第二行：

```json5
"hnpPackages": [
  { "package": "dshprobe.hnp", "type": "public" },   // 既有 T3 探针，保持不动（其处置见 301/E.10）
  { "package": "dshruntime.hnp", "type": "public" }   // 011 路径 A 运行时
]
```

> **硬约束**：`hnpPackages` 声明与**真正嵌入的 `.hnp`** 必须同时生效——安装器找不到包即**整包安装失败**（实测 `code:9568409`，`[源码]` `electron/src/main/module.json5:32-33`、`[已归档规范]` `docs/鸿蒙环境能力清单-v0.1.5.md:889`）。故 `dshruntime.hnp` 的嵌入**必须**由 `inject-hnp.ps1` 在同一轮完成。

若改走 **`executableBinaryPaths` 备选形态**（`[设计]`，不推荐为主），还需：

```json5
"extractNativeLibs": true,
"executableBinaryPaths": [ { "path": "libs/arm64-v8a/node" } ],
"requestPermissions": [
  { "name": "ohos.permission.ALLOW_EXTERNAL_NATIVE_CODE" }   // system_basic + ACL
]
```

并配合 `bundle-profile.json5` 的 `collectAllLibs: true`、`deviceTypes` 含 `2in1`（`[官方]` `docs/鸿蒙环境能力清单-v0.1.5.md:277`）。

**overlay 同步（强制）**：`electron/src/main/module.json5` 在 `collect-runtime.mjs` 的 `OVERLAY_FILES` 内（`:62`），阶段 3 会用 `runtime-overlays/` 的副本回盖，阶段 7.6 做源 / 目标 md5 守卫。因此**改 `module.json5` 必须同时改 `runtime-overlays/electron/src/main/module.json5`**，否则回盖后改动丢失、或守卫失败。

### 6.3 `.permission` 节（仅 `executableBinaryPaths` 备选形态）

若走备选形态，bin 的 `.permission` 节内容须为合法 JSON，并由 `binary-sign-tool sign … -moduleFile <module.json>` 注入（`[官方]` `docs/鸿蒙环境能力清单-v0.1.5.md:275`）：

```json
{ "requestPermissions": [ { "name": "<与 HAP 声明一致且不超集的权限名>" } ] }
```

**安装期硬约束**：bin 的权限集合 ⊆ HAP 的 `requestPermissions`，否则**整包安装失败**（`[官方]` 同上）。HNP 形态**不需要**这一步。

## 7. `dsh` shim 内容（分平台）

shim 只在**路径 A**（存在可 exec 的 `node`）下生成；路径 B **不生成 shim**（无 node 可 exec，改为进程内调用，§11）。

| 平台 | 文件 | 内容 |
|---|---|---|
| **POSIX（本平台运行）** | `<userData>/runtime-bin/dsh` | `#!/bin/sh\nexec "<node>" "<DSH_ROOT>/lib/bin.js" "$@"\n` |
| **Windows（构建期参考，非本平台运行）** | `<userData>/runtime-bin/dsh.cmd` | `@echo off\r\n"<node>" "<DSH_ROOT>\lib\bin.js" %*\r\nexit /b %errorlevel%\r\n` |

- `<node>`：路径 A 为 `/data/service/hnp/bin/node`（HNP 创建）；`<DSH_ROOT>` = `$DSH_HOME/dsh-dist`（`getDshRoot()`）。
- 生成方式：`writeFileSync(shimPath, content, { mode: 0o755 })`（对齐 desktop `runtime.ts:139`）。
- **B1 注意**：本平台 `chmod` 无效（`13900012`）；可执行位能否由 `writeFileSync` 的 `mode` 参数一次到位**未验证**，须真机核实（`test-cases.md` TC-D6）。若不能，则 shim **必须**退化为"不依赖可执行位"的形式——即让市场以 `sh <shim>` 调用，或干脆走路径 B。
- shim 每次启动**重写**（幂等）。
- **`dshArgv()` 命中条件**（`[源码]` `dsh-cli.ts:328-340`）：第一分支要求 `process.argv[1]` 匹配 `/[\\/](?:bin\.(?:js|ts)|dsh)$/`；本工程 Host 进程内运行，`process.argv[1]` 很可能不是该形态 → 落回退分支（`file: 'dsh'`）→ 依赖 PATH 上的 shim。**是否有其它命中路径需真机确认**（`test-cases.md` TC-D3）。

## 8. PATH / PNPM_HOME 顺序

### 8.1 顺序（`[设计]`）

```
PATH = [ <userData>/runtime-bin, <pnpmDir>, <nodeDir>, ...原 PATH ]   （去空项）
PNPM_HOME = <pnpmDir>
```

- `<runtime-bin>` 固定第一：让 shim 优先于任何系统同名命令；
- `<pnpmDir>` / `<nodeDir>` 仅在其产物**通过校验**时加入（§9）；
- 与 desktop 一致（`[参考]` `runtime.ts:181`），但**方向相反**——desktop 把 `binDir` 放首、`pnpmDir` 次、`nodeDir` 再次，本模块沿用同序。
- `PNPM_HOME` 设为 `<pnpmDir>` 的依据：`dsh-market/src/dsh-cli.ts:178-179` 把 `PNPM_HOME` 作为 `toolSearchDirs()` 的**首项**，故它成为市场搜索列表的第一个目录。

### 8.2 各路径的目录取值

| 路径 | `<runtime-bin>` | `<pnpmDir>` | `<nodeDir>` | `PNPM_HOME` |
|---|---|---|---|---|
| **A** | `<userData>/runtime-bin` | `/data/service/hnp/bin` | `/data/service/hnp/bin` | `/data/service/hnp/bin` |
| **B** | `<userData>/runtime-bin`（只放 shim，不生成） | 无（JS 在 `dsh-dist` 内进程内） | 无 | 不设（或设为 `runtime-bin`，无实质作用） |
| **C** | `<userData>/runtime-bin` | 探测到的目录 | 探测到的目录 | 探测到的目录 |

> 路径 A 的 `/data/service/hnp/bin` **默认已在系统 PATH**（`[官方]` `docs/鸿蒙环境能力清单-v0.1.5.md:293`），故前置它是**冗余但明确**的动作——显式前置可避免设备 PATH 被改动时静默失效；校验不通过时**不**前置，让系统 PATH 继续承载。

### 8.3 注入时机与幂等

- 注入在**每次启动**执行；`[binDir, ...]` 若已在 PATH 中则**不重复追加**（与 `dsh-cli.ts:240-242` 的去重语义一致）；
- 注入结果必须打印：`[dsh-harmony] runtime 路径=<A|B|C> PATH=<...> PNPM_HOME=<...>`（FR-6.1）。

## 9. 产物完整性校验

### 9.1 校验器（`[设计]`，`src-main/market-runtime.js` + `scripts/fetch-market-runtime.mjs` 共用同一算法）

| 目标 | 校验 |
|---|---|
| **ELF** | magic `\x7fELF`；`e_ident[EI_CLASS]` = 2（64 位）；`e_machine` = `0xB7`（`EM_AARCH64`，由 `e_ident[EI_DATA]` 决定字节序）；文件非空；节表头范围不越界 |
| **JS（路径 B）** | 入口文件存在、非空、可被 `node --check`-级语法解析（构建期）；运行期只查存在 + 非空 |

- **任意 IO / 解析异常返回 `false`，绝不抛出**（对齐 desktop `runtime.ts:73-125` 的 `isUsableExecutable` 语义）；
- **不启动子进程**做校验（启动期开销最小化）；
- 校验器是**无 Electron 依赖的纯函数** `isUsableExecutable(file, { platform, arch })` / `isParsableJs(file)`，便于单测。

### 9.2 两条边界

1. **前置到 PATH 之前**：只前置通过校验的目录；未通过者在启动日志记录并**回退**（不遮蔽）。
2. **写入打包产物之前**：`fetch-market-runtime.mjs` 校验失败即**硬失败**（`process.exit(1)`），且**只在全部产物通过后才写版本戳**（对齐 `fetch-runtime.mjs:225-226`）。

### 9.3 截断下载的处理

下载一律先写 `<dest>.part`，确认大小与响应 `Content-Length` 一致后才 `rename`（对齐 `fetch-runtime.mjs:64-85`）；失败清理临时文件并重试（`DOWNLOAD_ATTEMPTS = 3`）。**截断产物不得被记录为就绪**。

## 10. 构建脚本触点

| 位置（符号） | 现状 | 011 需改动 |
|---|---|---|
| `scripts/collect-runtime.mjs` `OVERLAY_FILES`（`:61-72`） | 含 `electron/src/main/module.json5` | **无需改列表**；但 `module.json5` 的改动**必须同步到** `runtime-overlays/electron/src/main/module.json5` |
| `scripts/collect-runtime.mjs` 阶段 3 / 7.6 / 7.10 | overlay 回盖 + md5 守卫 | **无需改**（复用既有守卫） |
| `scripts/collect-runtime.mjs` `APP_KEEP`（`:109`） | 仅守护 `resfile/resources/app` | **无需改**（运行时走 HNP 或 `dsh-dist`，不在该目录） |
| `scripts/inject-hnp.ps1` | 已支持 `--hnp-path` + 重签 + `verify-app`（`:84-172`）；`-HnpRoot` 默认 `$Module\hnp` | **扩展**：支持第二个载荷目录（`electron/hnp` 与运行时载荷并存），或让 `-HnpRoot` 指向一个含 `dshruntime.hnp` 的目录；**必须**与 `module.json5` 的 `hnpPackages` 同轮生效 |
| `scripts/collect-dsh.mjs` `collectDshMarket()`（`:114`） | 物化 `dshmarket` 产物 | **扩展**：路径 B 时，把 pnpm JS 物化进 `dsh-dist/node_modules/`（或 `dsh-dist/` 下专用目录），并做存在性断言 |
| `scripts/collect-dsh.mjs` `collectPlugins()`（`:151`） | 物化 `harmony-plugin-*` | **无需改** |
| `scripts/build-dsh.mjs` | 应用 `patches/dsh-v0.1.5-rc.2/` + build dsh + build `../dsh-market` | **扩展**：路径 B 时，在 `dsh-market` build **之前**应用 `patches/dsh-market-v1.26.0/` 补丁（幂等 `git apply --reverse --check`） |
| `scripts/fetch-market-runtime.mjs` | 不存在 | **新增**（§4.2 / §9） |
| `src-main/main.js` | 无运行时供给 | **改**：新增调用 + `require('./market-runtime.js')` |
| `scripts/build-hap.ps1` | 构建 + 签名断言 | **无需改**（HNP 由 `inject-hnp.ps1` 后置） |

### 10.1 `collect-runtime.mjs` 与 HNP 载荷的关系

`collect-runtime.mjs` **不涉及** `electron/hnp-src*` 与 `electron/hnp/`——HNP 载荷由 `fetch-market-runtime.mjs` 生成、`inject-hnp.ps1` 消费。因此 011 **不**需要新增 overlay / prune / keep 条目。唯一的耦合是 `module.json5` 的 overlay 同步（§6.2）。

## 11. 路径 B：第三方 `dsh-market` 补丁的组织

若选路径 B，**必须**改造 `dsh-market` 的 spawn 点。组织方式（`[设计]`）：

### 11.1 补丁目录与版本

- 目录：`patches/dsh-market-v1.26.0/`（版本对齐 `specs/201-dsh-market/spec.md:11` 的 `dshmarket` `1.26.0`；`build-dsh.mjs` 的 dsh 补丁按 `patches/<dsh-tag>/` 组织，本模块沿用同一约定）；
- 文件名：`dsh-market-in-process-pnpm.patch`；
- 幂等：`git apply --reverse --check` 检测已应用则跳过（与既有 dsh 补丁同法）。

### 11.2 补丁内容（改写点）

| 文件 / 符号（`dsh-market/src/dsh-cli.ts`） | 现状 | 补丁后 |
|---|---|---|
| `dshArgv()` `:328-340` | 返回 `{file, args, cwd, viaShell}` 供 spawn | 增加进程内分支：返回 `{ inProcess: true, entry, args }` |
| `spawnShim()` `:307-321` | `spawn(file, args, …)` | 增加进程内分支：`await import(entry)` + 合成 `process.argv` |
| `runDshPlugin()` `:895-972` | `spawnShim(...)` 后收 stdout/stderr/close | 改为调用进程内 CLI 函数，把结果映射回同一 `InstallResult` 形状 |
| `probePnpm()` `:617-638` | spawn `pnpm --version` | 改为进程内 `pnpm.main()` 或 `pnpm --version` 的 JS 等价物 |
| `provisionPnpm()` `:662-690` | `corepack` / `npm i -g` | 路径 A 下无需；路径 B 下改为"pnpm JS 已随包就位"的确定性判定 |
| `dsh plugin` 内部 pnpm spawn | desktop 参考称其内部 `spawnSync('pnpm')` | 改为进程内调用 pnpm JS |

### 11.3 生命周期的硬约束（路径 B）

- **默认 `--ignore-scripts`**：社区 `dsh-ohos-patch` 已要求（`[研究]`）。启用 lifecycle scripts 即等于在 Electron 主进程内执行任意代码——**必须**默认禁用，且启用须是**显式的逐包选择**。
- **`process.exit` 防护**：pnpm JS 内部可能调用 `process.exit`；进程内运行**必须**拦截（例如在调用期间包装 `process.exit` 为抛异常），否则会**杀掉 Electron 主进程**。
- **`process.argv` 合成**：pnpm 期望独占 `process.argv`，调用前保存、调用后恢复。
- **子进程能力的残余缺口**：pnpm 内部某些操作仍需 spawn `node`（例如运行已安装包自带的 CLI）。路径 B 下**无 node 可 spawn**，故这类包**装不了**——这是路径 B 的**已知限制**，必须在 UI / 文档披露；若设备存在路径 A 或路径 C 的 node，则可放宽，但**不得**把该放宽写成产品契约。

### 11.4 替代方案（备选）

若不愿改 `dsh-market` 源码，可在 `collect-dsh.mjs` 物化阶段**后处理已构建的 `lib/*.js`**（文本级替换 spawn 点为进程内调用）。**不推荐**：绕过了源码级 `git apply` 的幂等与可审计性，且升级 dsh-market 版本时文本匹配易碎。

## 12. 单元测试计划

新增纯模块 `src-main/market-runtime.js` 与校验器，用 `node:test` + `node:assert`（Node 22 内置，无框架、无依赖）驱动。

| 用例文件 | 覆盖 | 关键断言 |
|---|---|---|
| `src-main/tests/market-runtime.test.mjs` | 探测 / 选路 / PATH 组装 | A 产物校验通过 → 选 A；A 不可用 + B JS 存在 → 选 B；A/B 不可用 + C 探针通过 → 选 C；全不可用 → 显式失败；**禁跳级**（A 可用时不得选 C）；C 启用时结果带"设备环境"标记 |
| 同上 | PATH 顺序 | `[binDir, pnpmDir, nodeDir, ...prev]`；校验失败目录**不**入前缀；已在 PATH 的项不重复追加；空项剔除 |
| 同上 | `PNPM_HOME` | 等于 `toolSearchDirs()` 语义下的首项；路径 A 下指向 `/data/service/hnp/bin` |
| 同上 | shim 内容 | POSIX 内容精确等于 `exec "<node>" "<DSH_ROOT>/lib/bin.js" "$@"`；Windows 内容精确对应 `.cmd` 形态；`mode: 0o755` 传入 |
| `src-main/tests/artifact-integrity.test.mjs` | 完整性校验 | 合法 ELF 头（`\x7fELF` + class 2 + machine 0xB7）通过；截断（节表越界）拒绝；非 ELF 拒绝；空文件拒绝；`e_machine` 错（x86_64）拒绝；任何解析异常不抛出 |
| 同上 | JS 校验 | 非空 JS 入口通过；空 / 不存在拒绝 |
| `src-main/tests/provision-hint.test.mjs` | `provisionHint` 可达性 | 复用 `dsh-cli.ts:730-780` 三分支的双语形态；对鸿蒙特有形态（`13900012`、`node -e` 无输出）给出可操作文本 |

> 单测**不**覆盖真实 spawn / HNP 安装 / 设备执行；那些归入 `test-cases.md` 的真机用例（`未验证`）。校验器与选路器做成**无 Electron / 无第三方面向**的纯函数，正是为了让它们在裸 Node 上可测。

## 13. FR/AC → 实现落点映射

| 需求 / AC | 落点 | 类型 |
|---|---|---|
| FR-1 运行时获取与打包 | `scripts/fetch-market-runtime.mjs`、`electron/hnp-src-runtime/`、`scripts/collect-dsh.mjs` | build |
| FR-1.3 完整性校验 | `src-main/market-runtime.js` + `scripts/fetch-market-runtime.mjs`（共用算法） | build + 单元测试 |
| FR-1.4 打包形态 | `electron/src/main/module.json5` + `runtime-overlays/.../module.json5` + `scripts/inject-hnp.ps1` | build |
| FR-2 安装与 PATH/PNPM_HOME 注入 | `src-main/main.js::setupMarketRuntime()`、`src-main/market-runtime.js` | runtime |
| FR-2.1 注入时机 | `src-main/main.js`（`startHost()` 内 `:472` 之后 / `:496` 之前） | runtime |
| FR-3 shim 与调用通道 | `src-main/market-runtime.js::dshShim()`；路径 B 的 `patches/dsh-market-v1.26.0/` | runtime + build |
| FR-3.4 进程内改写点 | `patches/dsh-market-v1.26.0/dsh-market-in-process-pnpm.patch` | build（补丁） |
| FR-4 探测 / 校验 / 降级 | `src-main/market-runtime.js::selectRuntime()` / `probe()` | runtime + 单元测试 |
| FR-4.4 `provisionHint` | `dsh-market/src/dsh-cli.ts:730-780`（复用）+ `patches/` 的鸿蒙补充（路径 B） | 单元测试 |
| FR-5 权限与签名合规 | `electron/src/main/module.json5` + `runtime-overlays/.../module.json5` + `.permission`（备选形态） | build |
| FR-5.1 `ALLOW_EXTERNAL_NATIVE_CODE` | `patches/` 无关；`module.json5` + AGC ACL（用户） | build + 外部 |
| FR-5.4 HNP 免权限 | `module.json5` 的 `hnpPackages` | build |
| FR-5.5 plugin ACL 不适用 | 本规范 + `tasks.md`（不申请） | 文档 |
| FR-6 失败可见性 | `src-main/main.js` 日志 + `dsh-market` UI / `provisionHint` | runtime |
| AC-1 / AC-2 / AC-3 / AC-21 | 四份文档 | 文档 |
| AC-4 / AC-5 / AC-6 / AC-7 | 本规范 §3.3 / §4.4 + `tasks.md` Phase 0 + `module.json5` | 文档 + build |
| AC-8 | `.permission` 生成器（备选形态）+ 权限子集断言 | build + 单元测试 |
| AC-9 / AC-10 / AC-11 / AC-12 | `market-runtime.js` / `artifact-integrity` | 单元测试 |
| AC-13 | `src-main/main.js` 接线顺序（grep） | build |
| AC-14 | `plan.md` §11 + `patches/dsh-market-v1.26.0/` | 文档 + build |
| AC-15 / AC-16 / AC-17 / AC-18 | `market-runtime.js` / `provision-hint` | 单元测试 |
| AC-19 | 全工程 `grep` + 来源核验 | build |
| AC-20 | `spec.md` §9.5 + `skills/` 同步 | 文档 |
| AC-22 ~ AC-31 真机 | `market-runtime.js` / `main.js` / `dsh-market` + 设备 | 真机（`未验证`） |

## 14. 关键决策记录

| # | 决策 | 备选 | 理由 |
|---|---|---|---|
| D1 | 主路径 = 路径 A（随包签名 Node ELF，首选 public HNP） | 只做路径 B | 路径 A 是唯一产品级解：产物受本工程控制、HNP 系统创建软链接天然击败 B1、官方设计意图即经市场分发（`spec.md` §4.2） |
| D2 | 过渡 = 路径 B（进程内 JS pnpm），**不等待证书** | 证书到手前不做任何事 | 路径 B **零 ELF、零 symlink、零证书**，一次绕过 B0/B1/B2/B3；是唯一可立即落地的通道 |
| D3 | 路径 C **仅机会性**，且必须标注"设备环境" | 把设备 `node.org` 当产品能力 | 工程既有定性："属设备环境、不是本应用产物，不得作为产品功能依赖"（`docs/鸿蒙环境能力清单-v0.1.5.md:430`） |
| D4 | HNP 首选、`executableBinaryPaths` 备选 | 直接上 `executableBinaryPaths` | HNP 免权限 / 免 ACL；`executableBinaryPaths` 需 `ALLOW_EXTERNAL_NATIVE_CODE`（受限 + ACL）且机制本身能否上架未证实 |
| D5 | 注入点固定在 `startHost()` 内、`runProfile` 前 | 在 `app.whenReady` 顶部注入 | 必须晚于 `ensureDshExtracted()`（shim 需 `DSH_ROOT`）；必须早于 `runProfile`（市场在 Host 起来后读 `PATH`） |
| D6 | PATH 顺序 `[binDir, pnpmDir, nodeDir, ...prev]`，只前置通过校验者 | 无条件前置 | 损坏产物遮蔽可用运行时会把"能装"变成"装不了"（对齐 desktop `runtime.ts:165-180`） |
| D7 | `PNPM_HOME` 显式设置 | 不设，靠默认路径 | `dsh-cli.ts:178-179` 把 `PNPM_HOME` 作为 `toolSearchDirs()` 首项 |
| D8 | shim 只在路径 A 生成 | 全部路径都生成 shim | 路径 B 无 node 可 exec，shim 无意义；路径 B 改为进程内调用 |
| D9 | 路径 B 默认 `--ignore-scripts` | 允许 lifecycle scripts | 启用即在 Electron 主进程内执行任意代码；社区 `dsh-ohos-patch` 已要求禁用 |
| D10 | 路径 B 补丁改 `dsh-market` 源码（`patches/dsh-market-v1.26.0/`） | collect 阶段文本后处理已构建 `lib/` | 源码级 `git apply` 幂等、可审计；文本后处理易随版本升级失配 |
| D11 | 只供给 `node` + `pnpm`，不建 `npm` / `npx` 链接 | 连 `npm` / `npx` 一起供 | `npm` / `npx` 是 `#!/usr/bin/env node` 的壳/JS（B3），符号链接不构成可执行入口 |
| D12 | `hnpPackages` 增行而非删既有探针行 | 删除 `dshprobe.hnp` | 探针处置属 301/E.10 范围；本模块只新增，避免范围外变更 |
| D13 | `module.json5` 改动必须同步 `runtime-overlays/` 副本 | 只改源 | 「overlay 回盖」会把源改动静默覆盖；阶段 7.6 守卫依赖源 / 目标一致 |
| D14 | 校验器不启动子进程 | spawn 一次探针校验 | 启动期开销最小；结构校验足以拦截"截断下载"这一类损坏 |
| D15 | 不新增 npm 运行时依赖到工程 `package.json` | 把 pnpm 装成工程依赖 | 路径 B 的 pnpm JS 由构建脚本物化进 `dsh-dist`，不必进宿主依赖树 |

## 15. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 二进制证书工单被驳回 / 受理资格不足 | 路径 A 不可达，长期停在路径 B | `tasks.md` Phase 0 显式登记为用户所有、阻塞路径 A；路径 B 作为独立可交付的过渡解；在 README / 技能中如实披露路径 A 的前置状态 |
| R2 | 第三方 aarch64-ohos Node 构建质量 / 供应链风险 | 运行时不可靠或含不预期行为 | 版本绑定 + 结构校验（§9）+ 记录发布方；文档如实标注非官方属性（§7.1 of spec） |
| R3 | 路径 A 的 `pnpm-linuxstatic` 在 OpenHarmony 上跑不起来 | 路径 A 退化 | 真机先验证（`test-cases.md` TC-D7）；不行则路径 A 也需第三方 ohos 构建，或退回路径 B |
| R4 | 签名 ELF 能否 `execve("/system/bin/sh")` 未知 | 影响路径 A 的可用范围与安全面 | 作为**最高风险未知**单列（AC-29）；未验证前不假设可用；市场改走直接执行 `node` 而非经 `sh` |
| R5 | 路径 B 改造 `dsh-market` 后，升级 dsh-market 版本使补丁失配 | 安装通道构建失败 | 补丁按 `patches/dsh-market-v<ver>/` 版本化；`git apply --reverse --check` 幂等；升级时新建目录 |
| R6 | 路径 B 下 pnpm 调用 `process.exit` 杀掉主进程 | 应用崩溃 | 调用期包装 `process.exit` 为抛异常（§11.3）；真机用例外加崩溃监控 |
| R7 | 损坏 / 截断运行时产物遮蔽设备可用运行时 | 从"能装"变"装不了" | 只前置通过校验者（D6）；校验器不抛异常；真机断言（AC-9/TC-U2） |
| R8 | `module.json5` overlay 未同步 | 改动被静默回盖、或阶段 7.6 守卫失败 | D13：源 + overlay 双改；`collect-runtime.mjs --verify-only` 做守卫 |
| R9 | HNP 声明与嵌入 `.hnp` 不同轮生效 | **整包安装失败**（`code:9568409`） | `inject-hnp.ps1` 与 `module.json5` 同轮构建；`inject-hnp.ps1` 内已有 `hnp/*` 存在性断言 |
| R10 | `dsh-dist` 就地升级不生效（既有架构缺口） | 设备继续用旧产物 | 沿用 202 结论：验证需全新安装 / 清除设备 `$DSH_HOME/dsh-dist`；本模块只记录不改 |

## 16. 待确认

| # | 事项 | 处置 |
|---|---|---|
| Q1 | 路径 A 的第三方 aarch64-ohos Node 构建设定为哪一个发布方 / 版本？ | `[NEEDS CLARIFICATION]`：本文档只规定"必须第三方 + 必须校验 + 必须记录"，具体来源在 Phase 2 决策 |
| Q2 | `writeFileSync(..., { mode: 0o755 })` 在 B1 下是否真能给出可执行位？ | `未验证`：真机 TC-D6 核实；不能则 shim 需退化或改走路径 B |
| Q3 | `pnpm-linuxstatic-arm64` 能否在 OpenHarmony 上直接执行？ | `未验证`：真机 TC-D7 核实 |
| Q4 | 签名 ELF 能否 `execve("/system/bin/sh")`？ | `未验证`：真机 TC-D9 核实；未核实前不假设可用（AC-29） |
| Q5 | HNP 随 HAP 自动安装是否需开发者模式？ | `未验证`：能力清单只确认 `hnp` 命令需开发者模式（`docs/鸿蒙环境能力清单-v0.1.5.md:291`）；系统 installer 路径待真机核实 |
| Q6 | `dshArgv()` 第一分支在本工程进程内 Host 下是否命中？ | `未验证`：源码分析指向"不命中"（`plan.md` §3.2 / spec FR-3.3），真机 TC-D3 确认 |
| Q7 | Windows 上打的 HNP 在设备上是否保留 other 可执行位？ | `未验证`：官方称 Windows 打包自动赋予（`:294`），真机 TC-D7 确认 |
| Q8 | `node -e` 在设备第三方 Node 上无输出的根因？ | `未验证`：真机 TC-D2 复现并定位；未定位前路径 C 视为不可用 |
