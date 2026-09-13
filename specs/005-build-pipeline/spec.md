# 构建编排 功能规格

> 模块：005-build-pipeline（构建编排）
> 状态：Implemented
> 最后更新：2026-09-04

## 1. 模块概述

### 1.1 目的 —— 为什么存在这个模块

本模块负责把三个同级工程（`../deepseek-harness`、`../dsh-market`、`../harmonypc-electron`）的源码与二进制产物，装配成本工程（鸿蒙 HAP）可打包、可运行的形态。整个流程分三个阶段，由三个 Node 脚本独立驱动：

1. **收集运行时**：把 Electron-on-鸿蒙 运行时（`electron` + `web_engine` 两个模块）连同原生 SO 从同级运行时工程复制进本工程。
2. **构建 dsh**：对 dsh Host 源码打兼容补丁、安装依赖、编译出 host/client/web 三份产物，并顺带构建插件市场。
3. **收集 dsh 产物**：把 dsh 的部署产物物化为「真实文件、无链接、无 store」的自包含目录，并完成鸿蒙 aarch64 平台下的原生模块产物适配。

### 1.2 解决的问题

- **运行时就位**：鸿蒙运行时工程默认不含 Electron 37 原生 SO（`libelectron.so` 等需从华为发布物下载解压补齐），需自动校验并复制，缺失即明确报错而非静默失败。
- **上游兼容补丁**：dsh 是为桌面/LAN 形态设计的，直接构建会在鸿蒙环境下出问题（symlink、`0.0.0.0` 拒绝、HMR、原生文件选择器等），需打 4 个补丁且**幂等应用**。
- **依赖物化**：`pnpm deploy` 物化出的 `node_modules` 是「链接结构」（外部依赖为 Junction 指向 `.pnpm` store），打包分发后链接失效；且 deploy 不物化 peerDependencies 与非 hoisted 依赖，需递归物化为真实文件。
- **原生模块 ABI 取舍**：鸿蒙 aarch64 下 `sharp`（libvips）、`node-pty`、`koffi` 无可用产物，需 stub/禁用；`better-sqlite3` 需注入按 Node ABI v138 预编译的 aarch64 成品。
- **手工步骤固化**：4 个 patch 应用、workspace 残留清理、sharp stub 写入等历史上需手动操作，均固化为脚本内自动步骤。

### 1.3 范围

**包含**：运行时收集（复制 + SO 校验/注入 + 主进程入口恢复）、dsh 构建（残留清理 + 幂等补丁 + 三份产物 + 市场构建）、dsh 产物收集（deploy 物化 + 依赖补全 + 原生模块产物适配 + web dist/profile/市场物化）。

**不包含**：

- 产物压缩打包（`tar -czf --format=ustar → dsh-dist.tar.gz`，为手动命令，见 `docs/工程规划.md` §18.4 步骤④）。
- HAP 构建、签名与安装启动（hvigor / DevEco / hdc，步骤⑤⑥）。
- 产物运行时的解压与消费（属模块 004 产物解压引导）。
- 原生模块的交叉编译（`clang --target=aarch64-linux-ohos`，属 §18.5 优化路径，非本模块）。

## 2. 用户故事

- 作为打包者，我只需在干净的中间产物状态下顺序执行三个脚本，就能得到可打入 HAP 的完整产物，无需手工打补丁、手工写 stub、手工清理残留。
- 作为打包者，我重复执行构建脚本时不应因「补丁已应用」「目录已存在」而失败——构建过程必须幂等。
- 作为打包者，当某个前置（原生 SO、SQLite 成品、web dist、同级工程）缺失时，我应得到明确、可定位的报错，而非在后续打包/运行阶段才暴露。
- 作为运行时使用者，打包出的产物在鸿蒙设备上应能正常加载（无失效链接、无非目标架构原生二进制、被禁用的工具行不阻塞会话创建）。

## 3. 功能需求

### 3.1 运行时收集

- FR-005-001：系统 MUST 将同级运行时工程中的 `electron` 与 `web_engine` 两个模块复制到本工程，并在复制时剔除 `build`/`oh_modules`/`node_modules`/`.git`/`.hvigor`/`.idea`/`.codegraph` 等生成目录。
- FR-005-002：系统 MUST 校验三个原生 SO（`libelectron.so`、`libadapter.so`、`libffmpeg.so`）在源目录就位，任一缺失 MUST 以明确错误信息终止流程。
- FR-005-003：系统 MUST 将本工程主进程入口恢复到运行时模块的 resfile 资源目录，供打包进入 HAP。
- FR-005-004：系统 MUST 从 SDK 环境注入 `libc++_shared.so`（C++ 运行库）到 `electron/libs/arm64-v8a/`，且 SDK 环境未配置或库文件缺失时 MUST 终止流程。

### 3.2 dsh 构建

- FR-005-005：系统 MUST 在构建前清理 workspace 残留——删除 `vendor/*` 与 `packages/*/*` 下「既无 `package.json` 又无 `src`」的空壳目录，避免被构建工具的 glob 匹配导致入口解析失败。
- FR-005-006：系统 MUST 幂等应用 4 个上游兼容补丁；对已应用的补丁（反向校验通过）SHOULD 跳过而不重复应用。
- FR-005-007：系统 MUST 在依赖未安装时执行依赖安装，并顺序构建 host 库、client 库与 web dist 三份产物。
- FR-005-008：系统 SHOULD 构建插件市场（`../dsh-market`）；当市场工程缺失时 MAY 警告并跳过，而不中断主流程。

### 3.3 dsh 产物收集

- FR-005-009：系统 MUST 清理旧产物目录后，用依赖部署命令物化依赖闭包（apps/cli 的 dependencies 含 web profile 全部插件）。
- FR-005-010：系统 MUST 将物化产物中指向 store 的链接（Junction）递归替换为真实文件，跳过 `.bin` 与 `.pnpm`，最终产出自包含目录（无链接、无 `.pnpm` store）。
- FR-005-011：系统 MUST 补全 `@deepseek-ai` scope 的全部工作区包（覆盖 peer 依赖与 `link:` override），并物化 landlock-run 入口包使沙箱插件的静态 import 不报错。
- FR-005-012：系统 MUST 物化非 hoisted 的外部依赖（如 `zod`）到顶层 `node_modules`，并从每个 store entry 的嵌套目录解析出真实包名。
- FR-005-013：系统 MUST 清理原生模块中非目标平台的 `prebuilds`（如 `node-pty` 的 `linux-arm64`/`win32-x64`），避免打包工具对非目标架构 `.node` 报错并减小包体积。
- FR-005-014：系统 MUST 用纯 JS stub 替换 `sharp` 原生模块入口（`libvips` 在鸿蒙 aarch64 不可用），使图片附件相关调用不抛加载错误。
- FR-005-015：系统 MUST 注入按 Node ABI v138 预编译的 `better-sqlite3` aarch64 成品，注入前 MUST 校验归档结构（含 `package.json` 与 `build/Release/better_sqlite3.node`），缺失 MUST 终止。
- FR-005-016：系统 MUST 禁用 agent preset 中依赖 shell/subprocess/pty 的工具行（`tool-bash`/`tool-fs-search`/`persistent-shell`），使 preset 在会话创建时能正常挂载；不依赖子进程的工具 MUST 保留。
- FR-005-017：系统 MUST 将 web dist 复制到部署产物的 frontend-static 包内（deploy 不物化 build 产物），缺失 MUST 终止。
- FR-005-018：系统 MUST 复制 desktop profile 到部署产物目录，供 host 启动时复制到用户目录。
- FR-005-019：系统 MUST 物化插件市场（`dsh-market`）到部署产物的 `node_modules/dshmarket`（含 `package.json`/`cordis.patch.yml`/`lib`/`client` + 运行时依赖），缺失 MUST 终止。

## 4. 关键实体

| 实体 | 描述 | 关键属性 |
|---|---|---|
| 运行时模块副本 | 从同级运行时工程复制的 `electron` + `web_engine` 模块 | 剔除生成目录后的物理文件，含 resfile |
| 原生 SO 集 | 鸿蒙 aarch64 运行时必需的原生库 | `libelectron.so`/`libadapter.so`/`libffmpeg.so`/`libc++_shared.so` |
| 上游补丁集 | 对 dsh 的 4 个兼容补丁 | symlink-to-copy / allow-all-interfaces / disable-hmr / disable-native-picker |
| dsh 构建产物 | host 库 / client 库 / web dist | 编译期产物，后续被 collect 物化 |
| 部署产物目录（dsh-dist） | 自包含的 dsh 运行时目录 | 真实文件、无 Junction、无 `.pnpm` store，含 `node_modules` + `config` + `profiles` |
| 原生模块产物适配 | sharp stub / better-sqlite3 注入 / preset 工具行禁用 | 构建期写入，与运行时兜底双保险 |
| 被禁用的工具行集合 | preset 中依赖 shell/subprocess/pty 的行 | `tool-bash` / `tool-fs-search` / `persistent-shell` |

## 5. 验收场景

### 场景：运行时收集幂等且前置校验

- Given 同级运行时工程的 `electron`/`web_engine` 模块与 3 个原生 SO 就位，且 SDK 环境已配置
- When 执行运行时收集脚本
- Then 两个模块被复制到本工程并剔除生成目录；3 个 SO 校验通过；`libc++_shared.so` 注入到目标目录；主进程入口恢复到 resfile

### 场景：原生 SO 缺失时报错终止

- Given 3 个原生 SO 中任一缺失
- When 执行运行时收集脚本
- Then 脚本输出明确错误并终止（非零退出），不产生半成品

### 场景：补丁幂等应用

- Given dsh 已 checkout 到补丁基线版本，且某补丁已应用
- When 执行构建脚本
- Then 已应用的补丁被跳过（反向校验通过），未应用的补丁被应用；重复执行不报错

### 场景：workspace 残留自动清理

- Given dsh 的 `vendor/*` 或 `packages/*/*` 下存在「无 package.json 且无 src」的空壳目录
- When 执行构建脚本
- Then 残留目录被删除，构建工具不再因 glob 匹配到空壳而报入口失败

### 场景：部署产物自包含化

- Given dsh 已构建
- When 执行产物收集脚本
- Then 产出目录中所有 Junction 被物化为真实文件，`.pnpm` store 被删除，非 hoisted 依赖与 `@deepseek-ai` 包全部就位

### 场景：原生模块产物适配完成

- Given 产物已物化，且 SQLite v138 成品归档就位
- When 执行产物收集脚本
- Then sharp 入口被纯 JS stub 覆盖；better-sqlite3 成品注入（含 `.node`）；agent preset 中 3 类工具行被禁用、其余保留

### 场景：必需前置缺失时报错终止

- Given web dist 缺失、或 SQLite 成品归档缺失、或插件市场工程缺失
- When 执行产物收集脚本
- Then 脚本输出明确错误并终止，而非产出残缺的部署包

## 6. 非功能需求

- **幂等性**：三个脚本 MUST 可重复执行；补丁应用、模块复制、目录物化均需幂等。
- **健壮性**：必需前置缺失 MUST 明确报错并终止；可跳过项（市场缺失、sharp 缺失）MUST 警告而非崩溃。
- **可维护性**：脚本单文件、按阶段命名、日志带统一前缀（`[collect-runtime]`/`[build-dsh]`/`[collect-dsh]`），关键步骤打印进度。
- **体积控制**：剔除生成目录、清理非目标架构 prebuilds、删除物化后冗余的 `.pnpm` store，减小最终产物体积。
- **可移植性**：脚本定位工程根目录时不依赖启动时 cwd，统一由脚本自身路径解析（`fileURLToPath` 向上取根）。

## 7. 假设与约束

- **假设**：三个同级工程与本工程并行存放（无 git submodule），路径固定为 `../deepseek-harness`、`../dsh-market`、`../harmonypc-electron`。
- **假设**：dsh 已 checkout 到补丁基线版本（`dsh-v0.1.2-rc.1`），否则补丁可能冲突。
- **假设**：构建在 Windows 上执行（`collect-dsh` 的 `pruneForeignPrebuilds` 以 `process.platform-process.arch` 为目标平台）；Windows x64 无法加载 aarch64 `.node`，native 加载验证需在 Electron 37 真机执行。
- **约束**：产物适配（sharp stub / sqlite 注入 / preset 禁用）统一集中在 `collect-dsh` 阶段，属本模块步骤，非独立模块；与运行时兜底（main.js 的 `patchAgentPresetsRuntime`）双保险。
- **约束**：`better-sqlite3` 不放入 Windows workspace 运行依赖（构建环境可能无对应 native toolchain），由本模块注入 aarch64 成品。

## 8. 依赖

- **上游**：无（脚本直接消费同级工程的物理文件与 `DEVECO_SDK_HOME` 环境，非本工程其它模块的输出）。
- **下游 / 消费者**：`collect-runtime` 复制的 `electron`/`web_engine` 被 hvigor 打包消费；`collect-dsh` 产出的 `dsh-dist` 经 tar 打入 resfile，由模块 004 产物解压引导在运行时消费。
- **同级工程**：`../deepseek-harness`（patch + pnpm build + pnpm deploy 物化）、`../dsh-market`（npm build + 物化）、`../harmonypc-electron`（copy electron + web_engine + SO）。
