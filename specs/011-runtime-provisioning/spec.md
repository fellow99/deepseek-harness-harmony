# 运行时供给（市场安装通道）功能规格

> Module: 011-runtime-provisioning
> Status: Proposed（设计已定，未实现）
> Last Updated: 2026-09-18

## 1. 模块概述

### 1.1 目的 —— 为什么存在这个模块

让内置插件市场 `dshmarket` 在鸿蒙设备上**真的能安装 / 卸载插件**。今天它不能：市场的安装通道需要设备上并不存在的外部可执行文件。这不是"市场某处开关没打开"，而是**四个平台根因同时生效**的结果，其中 B0 是本工程产物形态决定的决定性根因。

| 根因 | 事实 | 出处 |
|---|---|---|
| **B0（本工程特有，决定性）** —— HAP 内**没有可运行的 `node`** | `process.execPath` = `/data/app/electron.org/electron_1.0/bin/electron/electron`，**该路径不存在（`ENOENT`）**；运行时经 ArkTS `childProcessManager.startArkChildProcess`（Ark 子进程）启动 JS，**不是** exec 一个 ELF，因此**也没有可 spawn 的 "electron" 二进制**，`child_process.fork()`（走 `process.execPath`）无法工作 | `[设备实测]` `specs/010-tool-bash/spec.md:139`、`docs/鸿蒙环境能力清单-v0.1.5.md:424,426` |
| **B0 佐证（符号级）** | `harmonypc-electron` 的 `libelectron.so` **只导入 `uv_spawn`**；`posix_spawn` / `forkpty` / `openpty` / `landlock` 在该 `.so` 符号表中**不存在** | `[源码]` `libelectron.so` 符号表；`docs/鸿蒙环境能力清单-v0.1.5.md:327`（`fork`/`execve`/`pipe`/`flock`/`symlink`/`link` 为 UNDEF 动态导入，对照项） |
| **B1 `symlink()` 对第三方应用被禁** | OpenHarmony 文件管理子系统变更 `cl.filemanagement.2`（SDK 4.1.5.2）使 `fs.symlink` 不可用（错误 `13900012`）；官方措辞"受 SEHarmony 管控" / "系统将不再提供创建软链接能力"。同一变更集使 `fs.chmod` / `fs.fchmod` / `fs.chown` / `fs.fchown` / `fs.lchown` **返回 void 且不生效**。Qt 的 HarmonyOS porting wiki（Huawei 确认，QTBUG-146621）称 `::symlink()` 与 `fs.symlink` 对第三方应用不可用，workaround：无 | `[设备实测]` `specs/010-tool-bash/spec.md:146`、`docs/鸿蒙环境能力清单-v0.1.5.md:246,249`；`[官方]` `cl.filemanagement.2` / QTBUG-146621 |
| **B2 从用户 / 可写目录执行 ELF 被拒** | 只有 `hnp_file` SELinux 上下文的二进制可执行；用户目录（hmdfs）ELF 被拒。所有 ELF 都必须**代码签名** | `[官方]` `docs/鸿蒙环境能力清单-v0.1.5.md:233,295` |
| **B3 shebang 断裂** | npm/pnpm CLI 入口以 `#!/usr/bin/env node` 开头。OpenHarmony 无 GNU userland，`/usr/bin/env` 很可能不存在；且 `node` 还必须先在 PATH 上 | `[设计]` 基于 B0/B1 的推论；`/usr/bin/env` 存在性 `未验证` |

**B1 的后果**：npm 的 POSIX 全局 bin 链接即 `symlink()`（`@npmcli/bin-links` → `link-gently.js`），所以 `npm i -g pnpm` **无法创建 `pnpm` 入口点**。`fix-bin.js` 随后 `chmod` 目标——同样失效。`--no-bin-links` / `bin-links=false` 也**不解决**：它**根本不创建入口点**。

**B0+B1 的合并后果**：市场需要**同时**有一个 `node` 解释器**和**一个 `pnpm` 入口点。它们是同一个问题的两个面。

**市场内部事实（源码级）**：`dsh-market/src/dsh-cli.ts` **不使用** `ctx.shell`（`:6-7` 注释：安装经 `node:child_process` 走，因为 shell 服务会拒写 profile 目录）。`probePnpm()` 以 `shell:false` spawn `pnpm --version`（`:617-638`）。`provisionPnpm()` 依次尝试 `corepack enable pnpm`、`npm install -g pnpm`，再用 `npm prefix -g` 并把 `<prefix>/bin` 追加进搜索目录（`:662-690`）。`spawnEnv()` 把 `toolSearchDirs()` 前置进 `PATH`（`:235-250`）；非 win32 时 `toolSearchDirs()` 返回 `PNPM_HOME`、`/opt/homebrew/bin`、`/usr/local/bin`、`~/.local/bin`、`~/Library/pnpm`、`~/.local/share/pnpm`，然后 `nodeBinDir`（= `dirname(nodeExecutable())`），最后 `extraPathDirs`（`:172-195`）。`dshArgv()` 经 `nodeExecutable()`（优先 `process.argv0` 若其为存在的绝对路径，否则 `process.execPath`）重入 CLI，或回退到裸 PATH `dsh`（`:50-54,328-340`）。`runDshPlugin()` 在 POSIX 上 detached spawn `dsh plugin --profile <p> add|remove <target>`，超时 15 分钟（`:895-972,252`）。**这些位置的共同前提是"PATH 上有可执行的 node 与 pnpm"——在本设备上不成立。**

**桌面同级工程已用另一种方式解决了同构问题（作为参考读它）**：`deepseek-harness-desktop/scripts/fetch-runtime.mjs` 拉取**便携 Node 发行版**（`nodejs.org/dist`，`NODE_VERSION = '24.11.1'`，`:24`）加**单文件 standalone pnpm 二进制**（`https://github.com/pnpm/pnpm/releases/download/v<ver>/pnpm-linuxstatic-<arch>`，`PNPM_VERSION = '9.15.9'`，`:25,45`），落在 `runtime/`；`src/main/runtime.ts::setupMarketRuntime()` 生成 `dsh` shim 到 `userData/runtime-bin/`（POSIX 内容 `exec "<bundledNode>" "<dsh-dist>/lib/bin.js" "$@"`，`:53`），`chmod 0755` 捆绑二进制（`:154`），并对捆绑产物做**结构校验**（win32 校验完整 PE 映像；其它平台 `accessSync(X_OK)`，`:73-125`）以防截断下载遮蔽可用的系统 pnpm/node，最后把 `[binDir, pnpmDir, nodeDir, ...prev]` **前置**进 `process.env.PATH`（`:181`）——全部发生在 `startHost()` **之前**。本工程 `specs/201-dsh-market/spec.md:35,131` 把"便携 Node/pnpm 运行时与 `dsh plugin` 安装/删除通道"记为 `[NEEDS CLARIFICATION]`，本模块即来关闭它。

### 1.2 解决的问题

- **市场安装入口是"能浏览、不能装"。** 浏览 / 查看已装插件不依赖子进程，已可用（`specs/201-dsh-market/spec.md`）；安装 / 卸载依赖 `node` + `pnpm` 入口点 + `dsh plugin` 三件套，本设备全无。本模块补齐这条通道，或**诚实降级**并让失败可诊断。
- **四个根因必须一次讲清。** B0 是产物形态（HAP 无 node），B1 是平台策略（symlink/chmod 被禁），B2 是签名策略（ELF 需二进制证书），B3 是 POSIX userland 假设破裂。把它们混为一谈会选错方案：例如试图"用 `npm i -g pnpm` 自动补 pnpm"——它在 B1 上必死。
- **三条候选机制必须诚实比对。** 随包携带签名 Node ELF（路径 A）、进程内 JS 跑 pnpm（路径 B）、复用设备既有 Node（路径 C）各有硬约束。路径 A 的**关键路径是外部二进制证书工单，而该证书对个人开发者不可得 → 路径 A 已撤回**；路径 B 是**零 ELF、零 symlink、零证书**的解，本版暂缓；**0.1.5 已决策采用路径 C（「路线一：主机装好 pnpm」），且本应用对该能力不作上架承诺**（见 §4.2）。
- **权限与签名合规必须前置。** `ALLOW_EXTERNAL_NATIVE_CODE`（受限 + ACL）、`.permission` 是 ELF 节而非 `module.json5` 字段、安装期"bin 权限不得超过 HAP 权限否则整包安装失败"、HNP 无需权限——这些是构建期就要满足的硬约束，不是运行期可补救的。
- **失败必须可见。** 设备上没有交互式终端，"pnpm 找不到"若只表现为安装按钮转圈，用户与模型都无从下手。本模块要求探测结果与 `provisionHint` 从启动日志与市场 UI 两个面暴露。

### 1.3 范围

**包含**：

- 三条候选机制（路径 A / B / C）的对比、主/兜底关系与**决策规则**（§4）。
- 运行时**获取与打包**（FR-1）：Node 运行时与 pnpm 入口的来源、版本固定、完整性校验、打包形态。
- 运行时**安装与 PATH / PNPM_HOME 注入**（FR-2）：接线点、顺序、幂等、失败处置。
- **`dsh` shim 与 CLI 调用通道**（FR-3）：shim 生成与内容、`dshArgv()` 命中条件、路径 B 的进程内改写点。
- **探测、校验与降级**（FR-4）：启动探测、A/B/C 的运行期降级、损坏产物不得遮蔽、机会性复用边界。
- **权限与签名合规**（FR-5）：ACL 申请项、normal 声明项、`.permission` 节约束、HNP 免权限、二进制证书、plugin ACL 的适用范围裁定。
- **失败可见性与诊断**（FR-6）：启动日志、市场 `provisionHint`、诊断探针、未验证项披露。
- 构建脚本触点（`scripts/collect-dsh.mjs` / `build-dsh.mjs` / `inject-hnp.ps1` / `collect-runtime.mjs` overlays + guards）与 `hnp.json` / `module.json5` 变更（见 `plan.md`）。
- 本模块的 `spec.md` / `plan.md` / `tasks.md` / `test-cases.md`。

**不包含**（011 明确**不做**）：

- **命令行执行工具 `bash` / `ctx.shell` / PTY / 进程沙箱。** 那是 `010-tool-bash` 的领域。**011 与 010 相互独立**：011 不依赖 010 的任何产物，010 也不依赖 011；但两者**共享同一个"设备上可执行的运行时"问题**——011 供给的运行时，日后**可以**被 010 的 exec 工具消费（见 §9.2）。本模块只负责"让市场的插件安装通道可用"，不交付模型可见的 shell 工具。
- **重新启用上游 `subprocess` / `sandbox` / `bash-sandbox` / `permission` / `node-pty` / PTY。** 一律保持禁用（与 010、301 同口径）。
- **`ohos.permission.CUSTOM_SANDBOX` / `RUN_ANY_CODE`。** 它们是 system-only / 第三方不可得，**不得**作为可行路径提出。
- **市场自身功能**（目录拉取、备份 / WebDAV / Gist、诊断、安装编排逻辑）——由 `dshmarket` 提供，本模块只供给它运行所需的运行时与 shim。
- **修改 dsh 上游源码。** 若选路径 B，对第三方 `dsh-market` 的改动以**本工程补丁**形式组织（见 `plan.md` §11），不改 `deepseek-harness`。
- **修改 Node 官方或引入未审计的第三方构建产物作为"官方支持"结论。** Node.js 对 OpenHarmony/arm64 仅 **Experimental** 且**不发布官方二进制**；路径 A 需第三方 aarch64-ohos Node 构建，其供应链风险如实记录（§7）。
- **路线图 / 排期。** 每项能力只给判断（**可修 / 不修 / 已决策 / 未验证**），见 §9.3。

### 1.4 事实来源与标注

本规范的结论**只**来自下列来源，不新增、不臆测：

| 来源 | 角色 | 本规范的标注 |
|---|---|---|
| 设备 `3QC0226526001227`（HarmonyOS 6.1.0.135 / API 24）上的实测记录 | `process.execPath`、`node -v`、`node -e`、HNP 设备布局、`symlink`/`chmod` 行为 | `[设备实测]` + `docs/鸿蒙环境能力清单-v0.1.5.md` 行号 |
| `specs/010-tool-bash/spec.md` / `specs/201-dsh-market/spec.md` / `specs/301-skill-runtime-capabilities/spec.md` | 平台基线、市场 [NEEDS CLARIFICATION]、根因分层与安全语义 | `[已归档规范]` + `file:line` |
| 本工程源码与其引用的第三方源码（`dsh-market/src/dsh-cli.ts`、`src-main/main.js`、`scripts/*.mjs`） | 市场内部 spawn 点、main.js 接线点、构建脚本触点 | `[源码]` + `file:line` |
| `deepseek-harness-desktop/scripts/fetch-runtime.mjs` / `src/main/runtime.ts` | 同构问题的参考解法 | `[参考]` + `file:line` |
| OpenHarmony / 华为官方文档（受限权限清单、HNP 指南、`binary-sign-tool`、AGC ACL / 二进制证书） | 权限定义、`.permission` 节、HNP 事实、ACL 机制 | `[官方]` + 命名来源（无公开行号者只给条目名） |
| 社区 / 第三方证据（Qt porting wiki / QTBUG-146621、Node.js 平台支持表、`dsh-ohos-patch`） | B1 的官方确认、Node 的 Experimental 状态、`--ignore-scripts` 先例 | `[研究]`（可能未证实，逐条标 `未验证`） |
| 本规范的**设计决策**（注入顺序、校验算法、降级规则、shim 内容、权限清单） | 由本模块自行确定、可被评审 | `[设计]` |

**纪律**：任何未在真机上验证的结论**必须**显式标注 `未验证`（或 `[NEEDS CLARIFICATION]`）。标注 `[设备实测]` 的条目**只**覆盖来源中明确记录过的测量；不得据此推断相邻结论。**不得**发明路径、版本、行号、权限名或数字。

## 2. 术语与图例

### 2.1 状态图例

| 标记 | 含义 |
|---|---|
| ✅ | 已实测通过 / 结论已被证据直接支持 |
| ⚠️ | 受限 / 部分可用 / 尽力而为（有已知边界） |
| ❌ | 无此能力，或已确认不可行 |
| ❓ | 未实测（`未验证`） |

### 2.2 根因分层（沿用 301 的 L1-L4）

与 `specs/301-skill-runtime-capabilities/spec.md:65-76` 一致：

| 层 | 性质 | 本模块中的典型项 |
|---|---|---|
| **L1 平台硬约束** | 鸿蒙产品策略 / 权限体系 | `symlink()` / `chmod()` 被禁（B1）、用户目录 ELF 不可执行（B2）、二进制证书（受限开放）、`ALLOW_EXTERNAL_NATIVE_CODE` 需 ACL |
| **L2 原生产物缺失** | 本工程产物是 win32 收集 / Ark 子进程启动，HAP 内无可运行 `node`（B0） | 市场安装通道的 `node` + `pnpm` 入口点 |
| **L3 本工程配置选择** | 本工程的打包与接线选择 | 是否随包携带 Node ELF、是否走 HNP、`hnpPackages` 声明 |
| **L4 dsh 上游接口缺失** | `dsh-market` 假定 POSIX userland 与 PATH 工具链 | `dshArgv()` / `spawnShim()` / `runDshPlugin()` 的 spawn 形态（B3） |

### 2.3 三条候选机制的代号（本模块新增）

| 代号 | 名称 | 一句话 |
|---|---|---|
| **路径 A** | 随包携带签名的 Node ELF | 把 aarch64-ohos 的 Node 运行时作为 public HNP（或 `executableBinaryPaths`）随 HAP 分发，由系统创建 `node`/`npm`/`npx`/`pnpm` 符号链接 |
| **路径 B** | 进程内 JS 运行 pnpm | 因 Electron 主进程**本身就是 Node 22.17**，把 pnpm 的 JS 原地 import 进进程内运行，dsh CLI 亦进程内调用，**不 spawn、不 symlink** |
| **路径 C** | 复用设备第三方 Node | 探测并复用设备上第三方应用已装的 Node（如 `/data/service/hnp/bin/node`），**仅机会性兜底**，绝不作为产品能力 |

### 2.4 其它术语

| 术语 | 含义 |
|---|---|
| **运行时供给（runtime provisioning）** | 让市场安装通道在设备上具备可用的 `node` 解释器、`pnpm` 入口点与 `dsh` shim 的全部动作 |
| **入口点（entry point）** | 可被 `spawn('pnpm', ...)` 按命令名解析到的可执行文件；POSIX 上由 npm 的 `symlink()` 创建（本平台被 B1 禁止） |
| **shim** | 本工程生成的 `dsh` 包装脚本，把 `dsh <args>` 转成 `<node> <dsh-dist>/lib/bin.js <args>` |
| **HNP** | HarmonyOS Native 包（`.hnp`），public 包落 `/data/service/hnp`，系统 installer 自行创建 `/data/service/hnp/bin` 软链接 |
| **二进制证书（binary certificate）** | 给 ELF 做代码签名所需、AGC 证书类型 `type` 4 的证书；**受限开放**，经华为在线工单申请 |
| **ACL（跨级别权限）** | 在 AGC 为 `system_basic` / 受限权限申请跨级别授权，审批后写入 release profile |
| **`.permission` 节** | ELF 自身的权限声明节（合法 JSON 的 `requestPermissions` 数组），**不是** `module.json5` 字段 |
| **独立二进制（independent binary）** | 由 `binary-sign-tool` 单独签名、经 `executableBinaryPaths` 集成的 ELF |
| **机会性兜底（opportunistic fallback）** | 仅在探测到设备已有可用运行时且不改变产品契约时才生效的降级；不得作为产品功能依赖 |
| **fail-visible** | 探测 / 校验失败必须表现为显式日志与可读提示，不得静默降级为"安装按钮永远转圈" |

## 3. 环境基线

### 3.1 平台与设备基线

平台事实取自设备实测（`[设备实测]`）：

| 项 | 值 | 出处 |
|---|---|---|
| 设备 / 系统 | `3QC0226526001227` / HarmonyOS 6.1.0.135（API 24） | `[设备实测]` `docs/鸿蒙环境能力清单-v0.1.5.md:14` |
| `deviceTypes` | `["2in1", "tablet"]` | `[源码]` `electron/src/main/module.json5:8-11` |
| `process.platform` / `process.arch` | `openharmony` / `arm64` | `[设备实测]` `docs/鸿蒙环境能力清单-v0.1.5.md:424` |
| Node 版本（宿主进程） | `22.17.0`（Electron 主进程即 Node） | `[设备实测]` `docs/鸿蒙环境能力清单-v0.1.5.md:424` |
| `process.execPath` | `/data/app/electron.org/electron_1.0/bin/electron/electron`，**不存在（`ENOENT`）** | `[设备实测]` `docs/鸿蒙环境能力清单-v0.1.5.md:424,426` |
| 应用包名 | `org.fellow99.DeepseekHarnessHarmony` | `[已归档规范]` `specs/202-plugin-fs-mutate/test-cases.md:15` |
| `$DSH_HOME` | `<userData>/.dsh`（`/data/storage/el2/base/files/.dsh`） | `[源码]` `src-main/main.js:466-469` |

### 3.2 设备上的 HNP 现状（路径 A / C 的事实基础）

来自设备 HNP 通路真机验证（`[设备实测]` `docs/鸿蒙环境能力清单-v0.1.5.md:907-918`）：

| 项 | 值 |
|---|---|
| `HNP_PUBLIC_HOME` | `/data/service/hnp` |
| `/data/service/hnp` 内容 | `[bin, dshprobe.org, node.org, python.org]` |
| `/data/service/hnp/bin` 内容 | `[dsh-probe, node, npm, npx, python, python3, python3.12]` |
| `dsh-probe` 的软链接目标 | `../dshprobe.org/dshprobe_1.0.0//bin/dsh-probe` |
| 裸命令名直调 | ✅ 成功（`DSH_HNP_PROBE_OK`） |

**关键事实**：`/data/service/hnp/bin` 下的 `node` / `npm` / `npx` 符号链接**由系统 installer 创建**（第三方 `node.org` 包的落点），**不是应用调用 `symlink()` 的结果**——因此 **B1 对系统创建的 HNP 软链接不适用**。

**第三方 Node 的运行现状**（`[设备实测]` `docs/鸿蒙环境能力清单-v0.1.5.md:430`）：

- `/data/service/hnp/bin/node` = ✅ `v24.13.0`，来自真机第三方应用（`DevNode-OH`）部署的 HNP 包；
- **但 `node -e` 无任何输出，3 次独立复现，原因未定位**（`未验证`）；
- 该运行时"**属设备环境、不是本应用产物，不得作为产品功能依赖**"。

### 3.3 权限与签名基线（路径 A / 独立二进制的前置）

平台策略事实与 ACL 机制（`[官方]`）：

| 项 | 事实 | 出处 |
|---|---|---|
| **二进制证书** | HarmonyOS PC 上 ELF 必须用**二进制证书**签名才能运行；AGC 证书类型 `type` 4 = 二进制证书（用于二进制程序签名）；官方措辞"二进制程序需使用二进制证书签名，才能在鸿蒙 PC 上正常运行"。**受限开放**——**无自助控制台路径**，经华为**在线工单系统**申请，需提供：企业名称与资质 / 应用名称及 APP ID / 应用的业务场景与用途 / 申请的证书类型 | `[官方]` AGC 证书类型 / 华为在线工单；**控制台具体入口未直取**（`docs/鸿蒙环境能力清单-v0.1.5.md:286` 记官方"申请二进制证书"页为 SPA，未能直取）→ 见 §4.4 `未验证` |
| **`binary-sign-tool`** | 对 ELF 做签名（`sign` / `display-sign`）；`-selfSign 1` 存在，但**只可当作本地开发便利**——官方文档未说明它是否仅限开发者模式，且不适用于上架发布 | `[官方]` `binary-sign-tool`；"`-selfSign` 的适用范围" **`未验证`** |
| **主权限 `ALLOW_EXTERNAL_NATIVE_CODE`** | `ohos.permission.ALLOW_EXTERNAL_NATIVE_CODE` —— system_basic、system_grant、**since API 23、deviceTypes `[2in1]`、受限 → 需 ACL**；官方定义"允许应用使用外部 native 程序。包括加载外部动态链接库(so)、二进制文件(bin)等"。**不存在** `ohos.permission.kernel.ALLOW_EXTERNAL_NATIVE_CODE` 这个名字 | `[官方]` 受限权限清单；`[已归档规范]` `docs/鸿蒙环境能力清单-v0.1.5.md:262` |
| **`LOAD_INDEPENDENT_LIBRARY`** | `ohos.permission.kernel.LOAD_INDEPENDENT_LIBRARY` —— system_basic、system_grant、since API 20、`[2in1]`、受限 → 需 ACL；"允许应用加载二进制证书签名的共享库"（API 20–21 仅系统应用；普通应用 API 22 起） | `[官方]` `docs/鸿蒙环境能力清单-v0.1.5.md:268` |
| **normal，无需 ACL** | `ohos.permission.INHERIT_PARENT_PERMISSION`（since 23，2in1）、`ohos.permission.kernel.IGNORE_LIBRARY_VALIDATION`（since 20，2in1）、`ohos.permission.kernel.EXEMPT_ANONYMOUS_EXECUTABLE_MEMORY`（since 23，2in1）、`ohos.permission.INTERNET`（since 9）、`ohos.permission.GET_NETWORK_INFO`（since 8）、`ohos.permission.ALLOW_COREDUMP`（since 23，2in1）—— 只需在 `requestPermissions` 声明（相关者在 bin 的 `.permission` 节一并声明） | `[官方]` 受限权限清单 / 通用权限清单；前三项见 `docs/鸿蒙环境能力清单-v0.1.5.md:269-271` |
| **`ALLOW_WRITABLE_CODE_MEMORY`** | `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY` —— system_basic、since 14、受限 → ACL。**本应用已获得并声明**，用于捆绑 Electron 引擎的 JIT | `[已归档规范]` `README.md`（Signing & restricted permissions）；`[设计]` 本模块沿用既有声明 |
| **HNP 无需权限 / ACL** | HNP 纯由 `module.json5` `hnpPackages` 声明（`{package, type: public\|private, independentSign?}`，`independentSign` API 23+）；系统 installer 自行创建 `/data/service/hnp/bin` 软链接。经 `hnp` 命令**手动**安装需用户开启**开发者模式**（`hnp install -u -p -i -f`） | `[官方]` HNP 指南 / `module-configuration-file.md`；`[已归档规范]` `docs/鸿蒙环境能力清单-v0.1.5.md:290-293` |
| **HNP 安装流水线** | 运行 `CodeSign + BssInstall`（若 `CODE_SIGNATURE_ENABLE`），即**校验 ELF 代码签名**——因此**未签名的 ELF 载荷预期失败**，而 shell 脚本载荷成功（现有 `dsh-probe` 即 `/system/bin/sh` 脚本） | `[官方]` HNP 安装流水线；"未签名 ELF 预期失败"为**推断**，**`未验证`** |
| **`.permission` 是 ELF 节** | bin 在**自身 `.permission` 节**声明权限，内容须为合法 JSON 的 `{"requestPermissions":[{"name":...}]}`；由 `binary-sign-tool sign … -moduleFile <module.json>` 注入。安装期两条硬约束：bin 声明权限**不得超过** HAP 已声明权限（否则**整包 HAP 安装失败**）；`.permission` 必须是合法 JSON（否则安装失败） | `[官方]` `docs/鸿蒙环境能力清单-v0.1.5.md:275` |
| **`/system/bin/sh` 无对应权限** | 权限目录中**不存在**"执行 `/system/bin/sh`"的权限；执行由 SELinux / seccomp 管辖，不属权限体系。**应用沙箱内签名的 ELF 能否 `execve("/system/bin/sh")` 未验证** —— 这是本模块**最高风险未知** | `[官方]` 权限清单检索零命中；`[设计]` 风险判定 |
| **plugin ACL 不适用（范围裁定）** | `ohos.permission.kernel.SUPPORT_PLUGIN`（since 19）、`INSTALL_PLUGIN_BUNDLE`（since 19）、`UNINSTALL_PLUGIN_BUNDLE`（since 19）、`PLUGIN_UPDATE`（since 18）——均 system_basic + 受限。这些**只当"插件"是 HarmonyOS plugin bundle 时才适用**；本市场安装的是**写进 profile 目录的 Node 包**，故**不需要**这些 ACL | `[官方]` 受限权限清单；`[设计]` 范围裁定 |
| **ACL 申请机制** | AGC → 开发与服务 → 项目 → 应用 → 项目设置 → **ACL 权限** → 勾选"我已知晓" → 选权限 → 申请；**单次最多 30 条**；结果一并返回，新申请须待当前申请完成；**中国大陆账号可用**（限制在**海外**账号：仅 APAC + Europe）；批准后的权限在建 release profile 时**自动写入**；**ACL 在建 profile 之后变更，须重建 profile** | `[官方]` AGC ACL 文档；`[已归档规范]` `README.md`（ACL 流程） |

## 4. 候选机制与选型（路径 A / B / C）

> 三条机制**都必须诚实设计**，不得静默丢弃。本节给出对比（§4.1）、选定（§4.2）、决策规则（§4.3）与未决外部依赖（§4.4）。

### 4.1 三条候选机制对比

| 维度 | 路径 A：随包携带签名 Node ELF | 路径 B：进程内 JS 跑 pnpm | 路径 C：复用设备第三方 Node |
|---|---|---|---|
| **击败的根因** | B1（HNP 系统创建软链接）、B2（`hnp_file` 上下文）、B3（目录在系统 PATH + 软链接入口点） | B0 / B1 / B2 / B3 **同时**——不 spawn、不 symlink | 视设备已有运行时而定 |
| **实现手段** | aarch64-ohos Node 作为 public HNP（`hnpPackages` + `inject-hnp.ps1`），或经 `executableBinaryPaths` 独立二进制 | 把 pnpm 的 JS 供到 `dsh-dist/node_modules/`，进程内 import 运行；dsh CLI 亦进程内调用 | 启动时探测 `/data/service/hnp/bin/node`、`~/.harmonybrew/opt/node/bin` 等 |
| **致命前置** | **二进制证书**（受限工单）+（`executableBinaryPaths` 路线还要 `ALLOW_EXTERNAL_NATIVE_CODE` 的 ACL）；需**第三方 aarch64-ohos Node 构建**（Node 官方无该平台二进制） | 需**改造第三方 `dsh-market`** 的 spawn 点；pnpm 期望独占 `process.argv`，可能调用 `process.exit`；lifecycle scripts 必须禁用 | 设备必须**恰好已装**第三方 Node；版本 / 形态不受本工程控制；`node -e` 在现设备**无输出（原因未定位）** |
| **击败 B1 的方式** | 系统 installer 在系统上下文创建软链接（实测 `/data/service/hnp/bin/node` 等已存在） | 不创建任何入口点——pnpm 的 bin 链接在进程内由 JS 逻辑接管或显式跳过 | 复用设备现成入口点 |
| **供应链风险** | 高：第三方 Node 构建 + 二进制证书签名链；须做完整性校验 | 低：pnpm JS 来自官方 npm registry，可锁定版本 | 高：完全依赖设备环境，不可控 |
| **git 源插件** | 可（若 Node ELF 可用且 `git` 存在——本设备 `git` **不在** toybox 集合，仍不可装 `git:` 源） | **不可**——设备无 `git` | 不可（同左） |
| **上架可行性** | HNP 官方设计意图即"经应用市场分发"（`[官方]` `docs/鸿蒙环境能力清单-v0.1.5.md:296`）；`executableBinaryPaths` 机制本身能否上架**未证实**（`:286`） | 最高——零平台特权、零 ACL | **不作为产品能力**，无上架问题 |
| **本模块定位（0.1.5 已决策）** | ⛔ **已撤回**（二进制证书对个人开发者不可得 → T5 不可实现） | ⏸ **暂缓**（唯一"证书-free 且自包含"的路线，留待后续版本） | ✅ **0.1.5 采用** —— 即用户拍板的「**路线一：主机装好 pnpm**」，且**不作上架承诺** |

### 4.2 选定：主 / 兜底关系

> **0.1.5 已决策（2026-09-22，用户拍板）**：**本版采用路径 C，即「路线一：主机装好 pnpm」**；并把该能力**明确降级为可选依赖 —— 本应用对其不作上架（AppGallery）承诺**。
>
> - **路径 A 撤回**：分发自有 ELF 必须先取得**二进制证书**（AGC `certType: 4`），而华为**不向个人开发者发放**（需企业实体 + 在线工单）→ 在当前主体下**不可实现**，不得作为计划项。依据：`docs/鸿蒙环境能力清单-v0.1.5.md` §C.8 与 D.2 第 17 条。
> - **路径 B 暂缓**：它是唯一**证书-free 且自包含**（零 ELF / 零平台特权）的路线，本可支撑"可上架的自包含能力"；但它需改造第三方 `dsh-market` 的 spawn 点，本版不投入，留待后续版本 —— 若将来想让"市场一键装插件"成为**可上架承诺**，只有这条路线可行。
> - **路径 C 采用**：零 ELF、零证书、零新权限；且**设备侧依据已具备** —— 应用 `process.env.PATH` 实测已含 `/data/service/hnp/bin`，其中 `node` 已通过结构校验，**只缺 `pnpm`**。主机补上 `pnpm`（系统终端 / HNP 建链，**勿在应用域装**，否则 bin 软链建不出）后 `probePnpm()` 即成功。
> - **代价（明示，不作承诺）**：用户没装就没有；版本 / 来源不受控；第三方 node 的 `node -e` 在现设备**无输出（原因未定位）**，故 `node -e` 仍作路径 C 的**硬门禁**（AC-13）。
>
> 原主 / 兜底设定（路径 A 为主、B 为过渡、C 仅机会性）**对 0.1.5 不再成立**；其理由保留如下，仅供后续版本（一旦具备企业资质，或决定投入路径 B）参考。

**（历史设定，非 0.1.5 策略）主路径 = 路径 A；过渡 / 兜底路径 = 路径 B；路径 C 仅机会性兜底。**

理由（均来自 §1.4 来源）：

1. **路径 A 是唯一"产品级"解。** 它把 Node 运行时变成**本应用自己的产物**，版本 / 形态 / 完整性全部受本工程控制；HNP 官方设计意图就是经市场分发；系统创建软链接使其**天然击败 B1**。
2. **路径 B 是唯一"证书未到即可落地"的解。** 它**零 ELF、零 symlink、零证书**，把 B0/B1/B2/B3 一次性绕过。代价是必须改造第三方 `dsh-market` 的 spawn 点，且生命周期脚本必须禁用。
3. **路径 C 永远只是兜底。** 工程既有能力记录已把设备侧运行时定性为"**属设备环境、不是本应用产物，不得作为产品功能依赖**"（`docs/鸿蒙环境能力清单-v0.1.5.md:430`）。本模块**沿用**该定性，不越界。

**因此本模块的交付形态是**：以路径 B 为**可立即实现**的通道（在证书到手前让安装能跑），以路径 A 为**目标形态**（证书到手后切换）；路径 C 只在 A/B 都不可用时提供"能装就装"的机会性兜底，且**必须**在 UI / 日志中标注"复用了设备环境运行时，非本应用保障"。

### 4.3 决策规则

启动时按下列**有序**规则决定采用哪条路径（`[设计]`，落点见 `plan.md` §5）：

| 序 | 条件 | 采用 | 说明 |
|---|---|---|---|
| 1 | 路径 A 的运行时**已随包就位**且**通过完整性校验**（§7.2） | **A** | 目标形态；不依赖设备第三方 |
| 2 | 否则，若路径 B 的 pnpm JS **已随包就位**且 dsh CLI 进程内调用可用 | **B** | 过渡形态；证书未到时的默认 |
| 3 | 否则，若探测到设备第三方 Node + pnpm 入口点且 `node -e` 探针通过 | **C**（机会性） | 必须响亮标注"设备环境" |
| 4 | 都不可用 | **显式失败** | fail-visible：日志 + 市场 `provisionHint`，不得静默 |

**规则 3 的 `node -e` 探针是硬门槛**：现设备 `node -e` **无输出（原因未定位）**，因此**即便 `/data/service/hnp/bin/node` 存在，规则 3 在当前设备上也大概率不通过**（`未验证`）。这正是"机会性兜底不得作为产品能力"的实证。

### 4.4 未决外部依赖（关键路径）

**二进制证书是路径 A 的硬前置，是本项目的关键路径，且由用户 / 企业侧持有。**

- 它是**受限开放**资源，**无自助控制台路径**，必须经华为**在线工单系统**申请（§3.3）。
- 申请材料需企业资质与业务场景说明——**本项目当前是否具备受理资格未验证**（`未验证`）。
- 工单审批时长、成功率、是否要求应用已上架——**均 `未验证`**（`docs/鸿蒙环境能力清单-v0.1.5.md:286` 记官方页为 SPA 未能直取）。

因此 `tasks.md` 把"提交二进制证书工单 + 提交 ACL 申请"设为**用户所有**的前置任务，并**显式标注其阻塞路径 A**。

## 5. 功能需求

> FR-1 至 FR-6 为本模块的六个能力域。每条需求后的括注指向 §1.4 的来源标注。每行给出 `状态 / 根因层 / 判断`，判断取值限 **可修 / 不修 / 已决策 / 未验证**。

### FR-1 运行时获取与打包

| 需求 | 状态 | 根因层 | 判断 |
|---|---|---|---|
| Node 运行时来源 | ⚠️ | L2 + L1 | **已决策**：优先路径 A（随包携带）；Node 官方**无** OpenHarmony/arm64 二进制，须**第三方构建**，其供应链风险如实记录 |
| pnpm 入口点获取 | ⚠️ | L1 + L4 | **已决策**：路径 A 用 standalone 单文件 pnpm；路径 B 用官方 pnpm **JS**，不创建入口点 |
| 产物完整性校验 | ✅（可构建期实现） | 无 | **已决策**：必须有结构校验，损坏产物**不得**前置（对齐 desktop `runtime.ts::isUsableExecutable`） |
| 打包形态 | ⚠️ | L3 + L1 | **已决策**：路径 A 首选 public HNP；`executableBinaryPaths` 作为备选，二者差异见下 |
| 版本固定与幂等 | ✅（可构建期实现） | 无 | **已决策**：版本常量 + 版本戳，重复获取跳过（对齐 desktop `fetch-runtime.mjs`） |

**FR-1.1（Node 运行时来源，`[设计]`）** 路径 A 的 Node 运行时**必须**是 aarch64-ohos 目标。依据：Node.js 官方对 OpenHarmony/arm64 仅 **Experimental** 且**不发布官方二进制**（`[研究]` Node.js `BUILDING.md` 平台支持表 / `nodejs.org/dist` 无该平台条目），故**第三方 aarch64-ohos Node 构建是必需的**。设备上现存的第三方 `node.org`（`v24.13.0`，来自 `DevNode-OH`）**不可**直接作为本工程产物——它是"设备环境"（`docs/鸿蒙环境能力清单-v0.1.5.md:430`）。

**FR-1.2（pnpm 获取，分路径，`[设计]`）**
- **路径 A**：采用单文件 standalone pnpm 二进制，版本固定（对齐 desktop `PNPM_VERSION = '9.15.9'`，`[参考]` `fetch-runtime.mjs:25,45`）。**注意**：desktop 用的是 `pnpm-linuxstatic-<arch>`（Linux 静态）；它在 **OpenHarmony** 上能否直接运行**未验证**，且同样受**二进制证书**约束（B2）。
- **路径 B**：采用**官方 pnpm 的 JavaScript**，随包供到 `dsh-dist/node_modules/`，**不生成任何入口点**（因 B1 下 `symlink` 不可用）。pnpm 的 `.bin` shim 语义须以进程内调用替代或显式跳过。

**FR-1.3（完整性校验，`[设计]`，强制）** 任何随包运行时产物在**前置到 PATH 之前**、以及**释放到设备之前**，**必须**通过结构校验：
- ELF 目标：校验 ELF magic（`\x7fELF`）、`e_machine` = `AARCH64`（`0xB7`）、非空且节表范围不越界——截断下载必须被拦截（对齐 desktop 的 PE 完整性思路，`[参考]` `runtime.ts:73-125`）；
- JS 目标（路径 B）：校验入口文件存在、非空、可被 syntax 解析；
- 校验**任一 IO / 解析异常一律返回不可用**，绝不抛出（对齐 desktop `isUsableExecutable` 的 `try/catch` 语义）。

**FR-1.4（打包形态，`[设计]`）**
- **首选 public HNP**：`module.json5` 的 `hnpPackages` 声明 + `inject-hnp.ps1` 在签名前用 `app_packing_tool --hnp-path` 嵌入 + `hap-sign-tool` 重签。系统 installer 创建 `/data/service/hnp/bin` 软链接（**系统上下文，B1 不适用**），且该目录**默认已在 PATH**（`[官方]` `docs/鸿蒙环境能力清单-v0.1.5.md:293`）。HNP **无需权限、无需 ACL**（`[官方]` 同上）。
- **备选 `executableBinaryPaths`**：需 `ALLOW_EXTERNAL_NATIVE_CODE`（system_basic + ACL）+ `.permission` 节 + `binary-sign-tool`；`path` 必须以 `libs/{abi}/` 开头、配合 `extractNativeLibs: true` / `collectAllLibs: true` / `deviceTypes` 含 `2in1`（`[官方]` `docs/鸿蒙环境能力清单-v0.1.5.md:277`）。**该机制本身能否上架未证实**（`:286`），故**仅作备选**。

**FR-1.5（版本固定与幂等，`[设计]`）** 运行时版本以**常量**固定，并以版本戳文件记录（`{node, pnpm, platform, arch}` 形态，对齐 desktop `fetch-runtime.mjs:186`）。版本戳**只在全部产物校验通过后**写入，截断产物不得被记录为"就绪"（对齐 `fetch-runtime.mjs:225-226` 的既有理由）。

### FR-2 运行时安装与 PATH / PNPM_HOME 注入

| 需求 | 状态 | 根因层 | 判断 |
|---|---|---|---|
| 注入时机 | ✅（已决策） | 无 | **已决策**：在 `runProfile` / `startHost()` **之前**，与 desktop `setupMarketRuntime()` 对齐（`[参考]` `runtime.ts:130`） |
| PATH 前置顺序 | ✅（已决策） | 无 | **已决策**：`[binDir, pnpmDir, nodeDir, ...prev]`，仅前置通过校验者 |
| `PNPM_HOME` | ✅（已决策） | 无 | **已决策**：显式设置，使其成为 `toolSearchDirs()` 首项 |
| HNP 安装失败处置 | ⚠️ | L1 + L3 | **已决策**：fail-visible，不静默；不阻塞应用启动但市场安装显式不可用 |
| `dsh-dist` 就地升级生效条件 | ✅（既有约束） | L4 | **不修**：沿用 202 结论，记录不改 |

**FR-2.1（注入时机，`[设计]`）** 运行时注入**必须**在 dsh Host 启动前完成，且**晚于** `ensureSandboxHome()`（因 `HOME` 被改指沙箱目录，运行时路径若按 `homedir()` 推导必须先定 `HOME`）：具体落点在 `src-main/main.js` 的 `startHost()` 内、`ensureDshMarketProfileLink()` / `ensureDshPluginsProfileLink()` 附近、`runProfile` 调用之前（见 `plan.md` §5）。

**FR-2.2（PATH 顺序，`[设计]`）** 顺序固定为 `[<userData>/runtime-bin, <pnpmDir>, <nodeDir>, ...原 PATH]`，且：
- **只有通过 FR-1.3 结构校验的目录才被前置**——损坏产物**不得**遮蔽设备上可能可用的运行时（`[设计]`，对齐 desktop `runtime.ts:165-180`）；
- 未通过校验的产物在启动日志**响亮**记录（`[dsh-harmony]` 前缀，FR-6.1）。

**FR-2.3（PNPM_HOME，`[设计]`）** **必须**设置 `PNPM_HOME` 指向本工程运行时目录。依据：`dsh-market/src/dsh-cli.ts:178-179` 把 `PNPM_HOME` 作为 `toolSearchDirs()` 的**首项**（"`PNPM_HOME` comes first on every platform"），设置它即让市场的搜索列表把本工程目录排在最前。

**FR-2.4（HNP 安装与运行时失败处置，`[设计]`）**
- HNP 随 HAP 由**系统 installer** 安装（`hnpPackages` 声明）；`hnp` **命令**手动安装需开发者模式（`[官方]` `docs/鸿蒙环境能力清单-v0.1.5.md:291`）。**系统 installer 自动安装是否需要开发者模式未验证**（`未验证`）。
- 若 HNP 未落地，**不得**让应用启动失败：路径 A 不可用即按 §4.3 降级，并在日志与市场 UI 显式说明。

**FR-2.5（`dsh-dist` 就地升级，`[设计]`，记录不改）** `ensureDshExtracted()` 只比对解压 marker，就地升级不重解压，设备继续用旧 `dsh-dist`（`[已归档规范]` `specs/202-plugin-fs-mutate/plan.md:141-153`）。运行时供给的变更**同样**以全新安装 / 清除设备 `$DSH_HOME/dsh-dist` 为生效条件。本模块**只记录，不改**该既有架构缺口。

### FR-3 `dsh` shim 与 CLI 调用通道

| 需求 | 状态 | 根因层 | 判断 |
|---|---|---|---|
| 生成 `dsh` shim | ✅（已决策） | L4 | **已决策**：生成到 `<userData>/runtime-bin/`，每次启动重写（幂等） |
| shim 内容（分平台） | ✅（已决策） | L4 | **已决策**：POSIX 用 `exec "<node>" "<dsh-dist>/lib/bin.js" "$@"` |
| `dshArgv()` 命中条件 | ⚠️ | L4 | **可修**：需使 `process.argv[1]` 匹配 `bin.js` 或使 PATH 上有裸 `dsh` |
| 路径 B 的进程内改写点 | ⚠️ | L4 | **可修**：改写 `dshArgv()` / `spawnShim()` / `runDshPlugin()` 与 dsh 自身的 `dsh plugin` spawn 点 |
| `git:` 源插件 | ❌ | L1 | **不修**：设备无 `git`，只能装 npm registry 包 |

**FR-3.1（shim 生成，`[设计]`）** **必须**生成 `dsh` shim 到 `<userData>/runtime-bin/dsh`，内容使 `dsh <args>` 等价于 `<node> <DSH_ROOT>/lib/bin.js <args>`。依据：`dsh-market/src/dsh-cli.ts:328-340` 的 `dshArgv()` 在**无法**从 `process.argv[1]` 重入时**回退到裸 `dsh`**，故 PATH 上必须有可执行的 `dsh`。每个启动**重写** shim（幂等），对齐 desktop `runtime.ts:130-144`。

**FR-3.2（shim 内容，`[设计]`）**
- **POSIX**（本平台）：`#!/bin/sh` + `exec "<bundledNode>" "<DSH_ROOT>/lib/bin.js" "$@"`（对齐 desktop `runtime.ts:53`）。
- **Windows**（构建期参考，非本平台运行）：`@echo off` + `"<bundledNode>" "<DSH_ROOT>\lib\bin.js" %*`（对齐 `runtime.ts:50-51`）。
- `<DSH_ROOT>` = `$DSH_HOME/dsh-dist`，对应源码 `DSH_ROOT`（`src-main/main.js` 的 `getDshRoot()`）。
- **注意 B1**：shim 用 `writeFileSync` + `mode: 0o755` 创建（对齐 desktop `runtime.ts:139`）；本平台 `chmod` 由 B1 无效，**实际可执行位由创建时的 mode 参数决定**是否生效——**未验证**，需真机核实（见 `test-cases.md` TC-D6）。

**FR-3.3（`dshArgv()` 命中条件，`[源码]`）** `dshArgv()` 的**第一分支**要求 `process.argv[1]` 匹配 `/[\\/](?:bin\.(?:js|ts)|dsh)$/`（`dsh-cli.ts:330`）。dsh Host 在本工程内进程内运行（非经 `lib/bin.js` 启动），故该分支很可能**不命中**，`dshArgv()` 落入**回退分支**（`file: 'dsh'`，`dsh-cli.ts:339`）——这**正是 shim 必须存在**的原因。命中与否的真机确认标 `未验证`。

**FR-3.4（路径 B 的进程内改写点，`[设计]`）** 若采用路径 B，**必须**改造下列 spawn 点使其改为进程内调用（详见 `plan.md` §11）：
- `dshArgv()`（`dsh-cli.ts:328-340`）——不再返回 spawn 目标；
- `spawnShim()`（`dsh-cli.ts:307-321`）——不再 `spawn`；
- `runDshPlugin()`（`dsh-cli.ts:895-972`）——改为进程内执行 `dsh plugin` 逻辑；
- dsh 自身的 `dsh plugin` 路径（desktop 参考称其内部 `spawnSync('pnpm')`）——改为进程内调用 pnpm JS。
改造以**本工程补丁**组织，**不改** `deepseek-harness` 上游（零上游改动，§9.1）。

**FR-3.5（`git:` 源插件，`❌`，`不修`）** 本设备 `git` **不在** toybox 集合（`[设备实测]` `docs/鸿蒙环境能力清单-v0.1.5.md:430` 的命令清单无 `git`）。因此 `git:` 源插件在 A/B/C 三路径下**都装不了**，只有 npm registry 包可装。此限制**必须**在市场 UI / 文档中披露。

### FR-4 探测、校验与降级

| 需求 | 状态 | 根因层 | 判断 |
|---|---|---|---|
| 启动探测 | ✅（可构建期实现） | 无 | **已决策**：探测 node / pnpm / shim 三者可用性并记录 |
| 运行期降级（A→B→C） | ✅（已决策） | 无 | **已决策**：按 §4.3 有序规则降级，顺序固定 |
| 损坏产物不得遮蔽 | ✅（已决策） | 无 | **已决策**：同 FR-2.2 |
| 机会性复用的边界 | ⚠️ | L1 + L3 | **已决策**：路径 C 仅机会性，**不得**作为产品能力；UI / 日志须标注 |
| `provisionHint` 可达 | ⚠️ | L4 | **可修**：市场 `provisionHint()` 是纯函数，可单测；设备路径下须实测 |

**FR-4.1（启动探测，`[设计]`）** 启动时**必须**探测并记录：`node` 解释器路径 / 版本、`pnpm` 入口点路径、`dsh` shim 可执行性。探测结果进启动日志（FR-6.1）。

**FR-4.2（降级规则，`[设计]`）** 降级**严格**按 §4.3 的有序规则；不得跳级、不得在 A 可用时用 C。

**FR-4.3（机会性复用边界，`[设计]`，强制）** 路径 C **仅**在 A、B 都不可用时启用，且：
- 复用对象**不得**来自本工程产物之外的任何签名 / 完整性假定；
- **必须**在启动日志与市场 UI 显式标注"复用了设备环境运行时，非本应用保障"；
- **不得**把路径 C 的成功当作产品能力写入技能 / 文档。

**FR-4.4（`provisionHint` 可达，`[源码]`）** 市场已有 `provisionHint(corepackOutput, npmOutput, npmFound, probeFailure)` 纯函数（`dsh-cli.ts:730-780`），在 Node 不可达 / `npm` 不在搜索路径 / pnpm 存在但运行失败等分支返回**双语可操作提示**。本模块**必须**让该提示在设备路径下可达（fits FR-6.2），并针对鸿蒙特有的失败形态（B1 的 `13900012`、`node -e` 无输出）补充可诊断输出——具体补充形式见 `plan.md` §11。

### FR-5 权限与签名合规

| 需求 | 状态 | 根因层 | 判断 |
|---|---|---|---|
| `ALLOW_EXTERNAL_NATIVE_CODE` + ACL | ⚠️ | L1 | **已决策（路径 A 备选形态）/ 未验证（审批结果）**：system_basic + 受限 → ACL，单次最多 30 条 |
| `LOAD_INDEPENDENT_LIBRARY` + ACL | ⚠️ | L1 | **已决策**：仅当加载二进制证书签名的共享库时才需要 |
| normal 权限声明 | ✅（已决策） | L1 | **已决策**：按 §3.3 清单声明，无需 ACL |
| `.permission` 节 | ✅（已决策） | L1 | **已决策**：合法 JSON；bin 权限**不得超过** HAP 权限 |
| HNP 免权限 / 免 ACL | ✅（已决策） | 无 | **已决策**：纯 `hnpPackages` 声明 |
| plugin ACL 不适用 | ✅（已决策） | L1 | **已决策**：范围裁定，**不申请** |
| 二进制证书 | ⚠️ | L1 | **已决策（需申请）/ 未验证（可得性）**：路径 A 的硬前置，用户所有 |

**FR-5.1（路径 A 备选形态的 ACL 清单，`[官方]`）** 若走 `executableBinaryPaths`：
- `ohos.permission.ALLOW_EXTERNAL_NATIVE_CODE`（system_basic / system_grant / since 23 / `[2in1]` / 受限 → **ACL**）；
- `ohos.permission.kernel.LOAD_INDEPENDENT_LIBRARY`（system_basic / since 20 / `[2in1]` / 受限 → **ACL**）——**仅当**运行时需加载**二进制证书签名的共享库**时；
- HAP 侧还须在 `requestPermissions` 声明同样权限（`[官方]` `docs/鸿蒙环境能力清单-v0.1.5.md:277`）；
- 注意**主权限名精确性**：**不存在** `ohos.permission.kernel.ALLOW_EXTERNAL_NATIVE_CODE`（`:262`）。

**FR-5.2（normal 权限，`[官方]`）** 按需在 `requestPermissions`（及相关 bin 的 `.permission` 节）声明：`ohos.permission.INHERIT_PARENT_PERMISSION`、`ohos.permission.kernel.IGNORE_LIBRARY_VALIDATION`、`ohos.permission.kernel.EXEMPT_ANONYMOUS_EXECUTABLE_MEMORY`、`ohos.permission.INTERNET`、`ohos.permission.GET_NETWORK_INFO`、`ohos.permission.ALLOW_COREDUMP`——**均无需 ACL**。

**FR-5.3（`.permission` 约束，`[官方]`，强制）**
- `.permission` 是 **ELF 节**，内容须为合法 JSON 的 `{"requestPermissions":[{"name":"<权限名>"}]}`（`docs/鸿蒙环境能力清单-v0.1.5.md:275`）；
- 由 `binary-sign-tool sign … -moduleFile <module.json>` 注入；
- **安装期硬约束**：bin 声明权限**不得超过** HAP 已声明权限——否则**整包 HAP 安装失败**；`.permission` 非法 JSON 同样导致安装失败。

**FR-5.4（HNP 免权限，`✅`，`已决策`）** HNP **纯由 `hnpPackages` 声明**，**无需权限、无需 ACL**（`[官方]` HNP 指南）。这是路径 A 首选 HNP 而非 `executableBinaryPaths` 的**合规理由之一**。

**FR-5.5（plugin ACL 不适用，`✅`，`已决策`，范围裁定）** `SUPPORT_PLUGIN` / `INSTALL_PLUGIN_BUNDLE` / `UNINSTALL_PLUGIN_BUNDLE` / `PLUGIN_UPDATE` 这些 system_basic + 受限权限**只适用于 HarmonyOS plugin bundle**。本市场安装的是**写进 profile 目录的 Node 包**，因此**不需要**这些 ACL——**明确不申请**，避免无谓的审核面。

**FR-5.6（二进制证书，`⚠️`，`已决策` + `未验证`）** 路径 A 的 ELF **必须**用二进制证书签名（§3.3）。**证书申请需企业资质与业务场景说明**；本项目**是否具备受理资格未验证**；`binary-sign-tool -selfSign 1` **仅本地开发便利**，不适用于上架。路由：**用户所有**的前置任务（`tasks.md` Phase 0）。

**FR-5.7（`ALLOW_WRITABLE_CODE_MEMORY` 沿用，`✅`）** 本应用**已获得并声明** `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY`（用于捆绑 Electron 引擎的 JIT，`[已归档规范]` `README.md`）。本模块**沿用**既有声明，**不新增**该权限的申请。

### FR-6 失败可见性与诊断

| 需求 | 状态 | 根因层 | 判断 |
|---|---|---|---|
| 启动日志 | ✅（已决策） | 无 | **已决策**：`[dsh-harmony]` 前缀，记录采用的路径与探测结果 |
| 市场 UI 提示 | ⚠️ | L4 | **可修**：`provisionHint` 可达 + 鸿蒙特有形态补充 |
| 诊断探针 | ✅（可期实现） | 无 | **已决策**：`--inspect` 可查的探针（见 `test-cases.md`） |
| 未验证项披露 | ✅（已决策） | 无 | **已决策**：文档与 UI 均标注 |

**FR-6.1（启动日志，`[设计]`）** 运行时供给的关键事件**必须**以 `[dsh-harmony]` 前缀打印（与工程日志规范一致）：采用的路径（A/B/C）、产物校验结果、PATH / `PNPM_HOME` 注入结果、shim 生成结果、降级原因。**静默降级不可接受**（对齐 010 FR-3.7 的"响亮声明"口径）。

**FR-6.2（市场提示，`[设计]`）** 当安装通道不可用时，市场侧**必须**能给用户一句**可操作**的话（复用 `provisionHint()` 的既有形态，`dsh-cli.ts:730-780`），并针对鸿蒙特有失败补充：B1 的 `13900012` 权限错误、`node -e` 无输出、`hnp_file` 执行被拒等。

**FR-6.3（诊断探针，`[设计]`）** 本模块**必须**提供可经 `--inspect`（CDP `Runtime.evaluate`）调用的探针，读回：`process.env.PATH`、`PNPM_HOME`、`process.execPath`、`fs.existsSync` 各运行时路径、`spawnSync('pnpm', ['--version'])` 结果（见 `test-cases.md` §2）。

**FR-6.4（未验证项披露，`[设计]`，强制）** 任何 `未验证` 结论（§4.4 的证书可得性、`-selfSign` 适用范围、`/usr/bin/env` 存在性、HNP 自动安装是否需开发者模式、签名 ELF 能否 `execve("/system/bin/sh")` 等）**必须**在本文档显式标注，并在能力技能同步时如实保留（§9.5）。

## 6. 已知限制

以下为该能力边界的已知限制，均来自 §1.4 的来源；未在真机验证的条目标注 `未验证`。

**根因侧**

1. **HAP 内无可运行的 `node`**：`process.execPath` 指向一个不存在的路径（`ENOENT`），且运行时以 Ark 子进程启动 JS，无 spawnable electron（B0）。
2. **`symlink()` 对第三方应用被禁**：`13900012`；`chmod` / `chown` 同类失效（B1）。npm 的 POSIX bin 链接依赖它——`npm i -g pnpm` 无法创建 `pnpm` 入口点。
3. **`--no-bin-links` 不解决**：它根本不创建入口点（B1 推论）。
4. **用户目录 ELF 被拒执行**：只有 `hnp_file` 上下文可执行，且所有 ELF 须代码签名（B2）。
5. **shebang 断裂**：`#!/usr/bin/env node` 依赖一个很可能不存在的 `/usr/bin/env`（B3）；`/usr/bin/env` 存在性 `未验证`。

**运行时获取侧**

6. **Node 无官方 aarch64-ohos 二进制**：官方仅 Experimental，路径 A 需第三方构建，供应链风险高（§7.1）。
7. **`pnpm-linuxstatic` 在 OpenHarmony 上能否运行 `未验证`**：desktop 用的是 Linux 目标，平台差异未核实。
8. **路径 A 的关键路径是外部二进制证书工单**：受限开放、无自助入口、需企业资质（§4.4）。

**通道侧**

9. **路径 B 必须改造第三方 `dsh-market`**：改写 spawn 点，且 pnpm 可能调用 `process.exit` 干扰宿主进程。
10. **路径 B 生命周期脚本必须禁用**：社区 `dsh-ohos-patch` 已要求 `--ignore-scripts`（`[研究]`）；这是安全属性也是功能限制（依赖 install 脚本的插件装不了）。
11. **`git:` 源插件装不了**：设备无 `git`（FR-3.5）。
12. **`dshArgv()` 在进程内 Host 下很可能不命中第一分支**：依赖 shim 回退（FR-3.3）。

**平台与合规侧**

13. **`executableBinaryPaths` 机制本身能否上架未证实**（`[已归档规范]` `docs/鸿蒙环境能力清单-v0.1.5.md:286`）；`ALLOW_EXTERNAL_NATIVE_CODE` 的 ACL 审核严格。
14. **`/system/bin/sh` 无对应权限**，执行由 SELinux / seccomp 管辖；**签名的 ELF 能否 `execve("/system/bin/sh")` 未验证**——本模块最高风险未知。
15. **HNP 自动安装（随 HAP）是否需要开发者模式未验证**；`hnp` 命令手动安装**需要**开发者模式。
16. **`node -e` 在设备第三方 Node 上无输出（3 次复现，原因未定位）**：这直接削弱路径 C 的可用性。
17. **HNP 是否仅限 PC / 2in1 未证实**（`[已归档规范]` `docs/鸿蒙环境能力清单-v0.1.5.md:297`，属"未证实的强指向"）。

**既有架构缺口（记录不改）**

18. **`dsh-dist` 就地升级不生效**：变更以全新安装 / 清除设备 `$DSH_HOME/dsh-dist` 为生效条件（FR-2.5）。

## 7. 安全：供应链、完整性校验与签名强制

本节是 011 的核心。来源为 §3.3 的平台事实与 desktop 的既有完整性思路（`[参考]` `runtime.ts:73-125`）。

### 7.1 供应链风险（第三方 Node 构建）

路径 A 的 Node 运行时**不是** Node.js 官方产物（官方无 aarch64-ohos 二进制），而是第三方构建。因此：

- **来源可信度未知**：本工程**必须**记录所选构建的发布方与版本，并在文档中**如实标注其非官方属性**；
- **可复现性差**：第三方构建的编译选项 / 补丁集不可控；
- **缓释**：绑定具体版本 + 记录发布方 + 结构校验（§7.2）+ 不把路径 C 的设备运行时混入产物。

**路径 B 的供应链面显著更小**：pnpm 的 JS 来自**官方 npm registry**，可锁定版本，无 ELF、无签名链。这是路径 B 作为过渡解的重要优势。

### 7.2 完整性校验（强制）

任何随包运行时产物**必须**在两条边界上校验：

1. **前置到 PATH 之前**：只前置通过校验的目录，损坏产物不得遮蔽可能可用的设备运行时（FR-2.2，对齐 `runtime.ts:165-180`）；
2. **写入打包产物之前**：构建脚本校验失败即**硬失败**（对齐 `fetch-runtime.mjs` 的 `isValidArtifact` 语义，`:157-166`）。

校验算法（`[设计]`）：ELF 校验 magic + `e_machine` + 文件非空 + 节表范围；JS 校验入口存在 / 非空 / 可解析。**任意 IO / 解析异常一律返回不可用，绝不抛出**。

### 7.3 签名强制

- HarmonyOS PC 上 **ELF 必须用二进制证书签名**才能运行（B2）；**未签名 ELF 预期失败**（HNP 安装流水线的 `CodeSign`——该预期**未验证**）。
- **应用不得伪造"已签名"状态**：签名与校验由 `binary-sign-tool` / 系统 installer 完成，本工程**不得**用 `-selfSign` 的产物冒充可发布签名。
- **`-selfSign 1` 仅本地开发便利**：官方文档未说明其是否仅限开发者模式，**不适用于上架**（FR-5.6）。

### 7.4 运行时执行面（残余风险披露）

- **路径 B 无子进程**：pnpm 的安装逻辑在 Electron 主进程内运行，**生命周期脚本默认禁用**；若启用，脚本即等于在应用进程内执行任意代码——**必须**默认禁用，且启用须是显式的逐包选择。
- **路径 A 的 ELF 以应用 uid 运行**：与现有 Electron 引擎同 uid、同沙箱；其能访问的系统面受 SELinux / seccomp 与 `.permission` 约束（FR-5.3）。
- **`execve("/system/bin/sh")` 未知**：若签名 ELF 可 exec shell，则等于在应用沙箱内引入一个命令执行面；**该能力是否成立未验证**，落地前**必须**真机验证（`test-cases.md` TC-D9），未验证前**不得**假设其可用。
- **路径 C 不引入新信任**：复用的设备运行时本就在设备上、本就被其他方信任，本模块**不为其背书**，只做机会性尝试并显式标注。

### 7.5 不引入的机制

- **不**重新启用 `node-pty` / PTY / 上游 `subprocess` / `sandbox` / `bash-sandbox` / `permission`。
- **不**使用 `ohos.permission.CUSTOM_SANDBOX` / `RUN_ANY_CODE`（system-only / 第三方不可得）。
- **不**申请 FR-5.5 已裁定的 plugin ACL。
- **不**把设备第三方运行时（路径 C）写入产品能力与技能。

## 8. 验收标准

每条 AC 均可行验证。**验证方式**列限 `构建期断言` / `单元测试` / `真机 --inspect` / `真机命令` / `来源核验` / `静态对照` 之一或组合。凡涉及真机执行、当前无设备可用的条目，状态标注 `未验证`。每条 AC 在 `test-cases.md` 有对应用例（见该文件第 5 节对照表）。

| 编号 | 验收标准 | 验证方式 | 状态 |
|---|---|---|---|
| AC-1 | 四份文档（`spec.md` / `plan.md` / `tasks.md` / `test-cases.md`）齐备，无占位文本，不含路线图 / 待办章节 | 静态 grep | ✅ 可构建期核验 |
| AC-2 | FR-1 至 FR-6 六个能力域齐备且互不重叠，每条需求含 `状态` / `根因层` / `判断` 三列 | 静态对照 | ✅ 可构建期核验 |
| AC-3 | 三条候选机制（A / B / C）均有对比表，并给出 §4.3 决策规则；**§4.2 明示 0.1.5 已决策采用路径 C（路线一）**，且如实记录路径 A 因**二进制证书对个人开发者不可得**而撤回、路径 B 暂缓 | 静态对照 | ✅ 可构建期核验 |
| AC-4 | 二进制证书作为路径 A 的前置外部依赖被登记为**用户所有**且**阻塞路径 A**，并注明无自助入口 / 工单字段 | 来源核验 | ✅ 可构建期核验 |
| AC-5 | ACL 申请项（`ALLOW_EXTERNAL_NATIVE_CODE`、按需 `LOAD_INDEPENDENT_LIBRARY`）被登记，并注明 30 条上限 / 重提须待前次完成 / 建 profile 后变更须重建 | 来源核验 | ✅ 可构建期核验 |
| AC-6 | plugin ACL（`SUPPORT_PLUGIN` / `INSTALL_PLUGIN_BUNDLE` / `UNINSTALL_PLUGIN_BUNDLE` / `PLUGIN_UPDATE`）被**显式判定不适用**（非 HarmonyOS plugin bundle），不申请 | 来源核验 | ✅ 可构建期核验 |
| AC-7 | 权限清单不含 `CUSTOM_SANDBOX` / `RUN_ANY_CODE`；不含不存在的 `ohos.permission.kernel.ALLOW_EXTERNAL_NATIVE_CODE` | 构建期断言（grep）+ 来源核验 | ✅ 可构建期核验 |
| AC-8 | `.permission` 生成内容为合法 JSON，且其权限集合 ⊆ HAP `requestPermissions` | 构建期断言 + 单元测试 | ✅ 可构建期核验 |
| AC-9 | 运行时产物完整性校验存在：ELF 校验 magic + `e_machine` = `AARCH64` + 节表不越界；截断产物被判不可用 | 单元测试 | ✅ 可构建期核验 |
| AC-10 | PATH 注入顺序为 `[binDir, pnpmDir, nodeDir, ...prev]`，且仅前置通过校验者；失败者不前置并记录日志 | 单元测试 | ✅ 可构建期核验 |
| AC-11 | `PNPM_HOME` 被设置，且等于 `toolSearchDirs()` 计算出的首项（对齐 `dsh-cli.ts:178-179`） | 单元测试 | ✅ 可构建期核验 |
| AC-12 | `dsh` shim（POSIX）内容为 `exec "<node>" "<DSH_ROOT>/lib/bin.js" "$@"`；shim 以 `mode: 0o755` 创建 | 单元测试 | ✅ 可构建期核验 |
| AC-13 | shim 生成与运行时注入发生在 `runProfile` / `startHost()` **之前**、`ensureSandboxHome()` **之后** | 构建期断言（grep）+ 代码审阅 | ✅ 可构建期核验 |
| AC-14 | 路径 B 的进程内改写点（`dshArgv()` / `spawnShim()` / `runDshPlugin()` + `dsh plugin` 内部 spawn）被列出，且明确**不改** `deepseek-harness` 上游 | 来源核验 + 静态对照 | ✅ 可构建期核验 |
| AC-15 | 降级规则有序且禁跳级（A→B→C→显式失败）；路径 C 启用时必须有"设备环境"标注 | 单元测试 | ✅ 可构建期核验 |
| AC-16 | 路径 B 默认 `--ignore-scripts`（生命周期脚本禁用），启用须显式 | 单元测试 + 静态对照 | ✅ 可构建期核验 |
| AC-17 | `provisionHint()` 纯函数在"Node 不可达 / npm 不在搜索路径 / pnpm 存在但运行失败"三分支返回双语提示 | 单元测试 | ✅ 可构建期核验 |
| AC-18 | 探测结果与采用的路径以 `[dsh-harmony]` 前缀记录；静默降级不存在 | 单元测试 + 构建期断言（grep） | ✅ 可构建期核验 |
| AC-19 | 未重新启用 `node-pty` / PTY / 上游 `subprocess` / `sandbox` / `bash-sandbox` / `permission`（无新增启用） | 构建期断言 + 来源核验 | ✅ 可构建期核验 |
| AC-20 | 规范源 ↔ 技能同步规则被记录：能力变化必须先改规范、再同步技能（单向） | 人工对照 + 静态 grep | ✅ 可构建期核验 |
| AC-21 | 所有未在真机验证的结论均显式标注 `未验证` / `[NEEDS CLARIFICATION]`（含证书可得性、`-selfSign`、`/usr/bin/env`、HNP 自动安装、`execve("/system/bin/sh")`、`node -e`、`pnpm-linuxstatic`） | 静态 grep + 人工 | ✅ 可构建期核验 |
| AC-22 | 真机：设备 HNP 清单实测记录（`/data/service/hnp` 与 `/bin` 内容）与 §3.2 一致 | 真机命令 | ❓ `未验证`（无设备） |
| AC-23 | 真机：`node -e` 在设备第三方 Node 上的行为复现（无输出）并尝试定位根因 | 真机命令 | ❓ `未验证`（无设备） |
| AC-24 | 真机：市场安装入口探测 `pnpm --version` 的实际结果与失败分类（`missing` vs `failed`） | 真机 `--inspect` | ❓ `未验证`（无设备） |
| AC-25 | 真机：`dsh plugin --profile desktop add <npm pkg>` 端到端成功或给出可读失败 | 真机 `--inspect` | ❓ `未验证`（无设备） |
| AC-26 | 真机：路径 B 进程内 pnpm 安装一个 npm registry 包成功，且生命周期脚本被拒 | 真机 `--inspect` | ❓ `未验证`（无设备） |
| AC-27 | 真机：路径 A 的 HNP Node 以裸命令名执行成功，`pnpm` 入口点可被解析 | 真机命令 | ❓ `未验证`（无设备） |
| AC-28 | 真机：ELF 执行 / 签名结果符合预期（未签名 ELF 失败；签名 ELF 成功） | 真机命令 | ❓ `未验证`（无设备） |
| AC-29 | 真机：应用沙箱内签名 ELF 能否 `execve("/system/bin/sh")` 有明确结论（最高风险未知） | 真机 `--inspect` | ❓ `未验证`（无设备） |
| AC-30 | 真机：市场 UI / 日志的 `provisionHint` 输出在设备路径下可达且可读 | 真机 `--inspect` + hilog | ❓ `未验证`（无设备） |
| AC-31 | 真机：既有能力不退化（新建会话、`fs-mutate`、市场浏览、技能加载） | 真机 `--inspect` | ❓ `未验证`（无设备） |

## 9. 约束

### 9.1 与宪法的一致

- **源码即真理（constitution §3.1）**：本规范所有平台结论、行号与数字均来自 §1.4 的来源；未验证处显式标注。
- **零上游改动（constitution §1.1）**：本模块**不**改 `deepseek-harness` 源码；对 `dsh-market` 的改动以本工程补丁形式组织（§11 of `plan.md`）。
- **只写装配代码（constitution §1.3）**：只做运行时供给与接线，不新造业务逻辑。
- **spec / plan 成对（constitution §6）**：本模块产出 `spec.md` + `plan.md` + `tasks.md` + `test-cases.md`。
- **中文 + 英文技术术语（constitution §6）**：与既有 spec 集口径一致。
- **日志规范（constitution §3.3）**：运行期输出统一 `[dsh-harmony]` 前缀。
- **幂等构建（constitution §5.1）**：运行时获取与 shim 生成可重复执行。
- **产物适配集中在收集脚本（constitution §5.3）**：构建期在收集脚本，运行期在 `main.js`，双保险。

### 9.2 与 010-tool-bash 的分工（显式）

- **011 与 010 相互独立**：011 不依赖 010 的任何产物（不注册 `ctx.shell`、不交付模型可见工具），010 也不依赖 011。
- **二者共享同一个"设备上可执行的运行时"问题**：011 供给的 `node` / `pnpm`（路径 A 的 HNP 或路径 B 的 JS）**日后可以**被 010 的 exec 工具消费，作为其命令可达性的一个来源。但**本模块不为此承诺**：011 的验收只覆盖"市场安装通道可用"，010 的 exec 后端仍走它自己的 `/system/bin/sh` 常驻会话。
- **不得混淆交付物**：011 不交付 `bash` 工具；010 不交付运行时供给。

### 9.3 本规范不含路线图

- 本规范**不设**路线图 / 待办 / roadmap 章节。每项能力只给判断（**可修 / 不修 / 已决策 / 未验证**），不给排期与实施步骤。
- `tasks.md` 只做**依赖排序的任务拆解**，不构成时间表。

### 9.4 范围边界（不包含）

- **不**实现 `ctx.shell` / `persistent-shell` / PTY / 进程沙箱（koffi / landlock）。
- **不**重新启用上游 `subprocess` / `sandbox` / `bash-sandbox` / `permission` / `node-pty`。
- **不**修改 `deepseek-harness` 上游；**不**改 `profiles/desktop/cordis.patch.yml` 中已有的禁用行。
- **不**申请 FR-5.5 已裁定的 plugin ACL。
- **不**把路径 C 的设备运行时写成产品能力。

### 9.5 规范源 ↔ 技能同步（强制）

本工程内置技能 `skills/harmony-runtime-capabilities/SKILL.md` 是能力的**运行期摘要**。011 一旦交付（尤其路径 B 让安装通道可用、或路径 A 让 Node 可执行），技能中"**无 shell、无 Node、不能装插件**"的既有表述**可能冲突**，**必须**同步更新该技能（并核对 `docs/鸿蒙环境能力清单-v0.1.5.md` 的 D.2 / T4 相关结论）。同步方向**单向**：先改本规范，再改技能。未同步的技能会让模型拒绝使用新能力（本工程已有先例，见 `README.md` 的技能告警段与提交 `c9ad23e`）。

### 9.6 未解张力的处置

- **二进制证书可得性**（§4.4）**不**在文档层裁定，**必须**由用户侧的工单结果给出；在裁定前，路径 A 保持"设计已定、前置未达"。
- **`execve("/system/bin/sh")`**（FR-5.6 / §7.4）**不**猜测，**必须**真机验证（AC-29）；在验证前，任何依赖它的设计保持 `未验证`。
- **`node -e` 无输出**（§3.2）**不**猜测根因，**必须**真机复现（AC-23）。

## 10. 术语

| 术语 | 含义 |
|---|---|
| **运行时供给（runtime provisioning）** | 让市场安装通道在设备上具备 `node` 解释器、`pnpm` 入口点与 `dsh` shim 的全部动作 |
| **路径 A / B / C** | 随包携带签名 Node ELF / 进程内 JS 跑 pnpm / 复用设备第三方 Node，见 §2.3 |
| **入口点（entry point）** | 可被 `spawn('pnpm', ...)` 按命令名解析到的可执行文件；POSIX 上由 `symlink()` 创建，本平台被 B1 禁止 |
| **shim** | 本工程生成的 `dsh` 包装脚本，把 `dsh <args>` 转成 `<node> <dsh-dist>/lib/bin.js <args>` |
| **HNP（HarmonyOS Native 包）** | `.hnp` 包，public 包落 `/data/service/hnp`，系统 installer 创建 `/data/service/hnp/bin` 软链接 |
| **`.permission` 节** | ELF 自身的权限声明节（合法 JSON），**不是** `module.json5` 字段 |
| **独立二进制（independent binary）** | 由 `binary-sign-tool` 单独签名、经 `executableBinaryPaths` 集成的 ELF |
| **二进制证书（binary certificate）** | 给 ELF 做代码签名所需、AGC 证书类型 `type` 4 的证书；受限开放，经工单申请 |
| **ACL（跨级别权限）** | 在 AGC 为 `system_basic` / 受限权限申请跨级别授权，审批后写入 release profile |
| **机会性兜底（opportunistic fallback）** | 仅在探测到设备已有可用运行时且不改变产品契约时才生效的降级；不得作为产品能力依赖 |
| **fail-visible** | 探测 / 校验失败必须表现为显式日志与可读提示，不得静默降级 |
| **B0 / B1 / B2 / B3** | 四个根因：无 node / symlink 被禁 / ELF 需签名 / shebang 断裂，见 §1.1 |
| **生命周期脚本（lifecycle scripts）** | npm/pnpm 的 `preinstall` / `postinstall` 等；路径 B 下**默认禁用** |
| **部署期状态** | 由产品在启动时设置、不作为模型输入的运行时配置（如 `PATH` / `PNPM_HOME` 注入） |
