# 005-build-pipeline 技术方案（As-Built）

> 本文档为「回溯性」技术方案，记录模块实际架构、设计决策与实现策略。
> 模块：005-build-pipeline
> 对应规格：specs/005-build-pipeline/spec.md
> 最后更新：2026-09-04

## 1. 技术上下文

### 1.1 运行时环境

- **执行环境**：Windows 宿主机 Node（`node scripts/*.mjs` 直接调用）。本工程**无 `package.json`、无 `npm run`**，脚本为 ES Module（`.mjs`），仅依赖 Node 内置模块。
- **工程根定位**：三个脚本均用 `resolve(fileURLToPath(new URL('..', import.meta.url)))` 解析出 `projectRoot`（本工程根目录），与 `deepseek-harness-desktop` 无关（§18.6）。
- **前置环境变量**：`DEVECO_SDK_HOME`（用于定位 `libc++_shared.so`）、`CI`/`npm_config_confirm_modules_purge`/`COREPACK_ENABLE_DOWNLOAD_PROMPT`（脚本内自动设置，保证 pnpm/tsdown 无 TTY 时不中止）。
- **外部 CLI**：`git`（apply patch）、`pnpm@11`（install/build/deploy）、`npm`（build dsh-market）、`tar`（解包 better-sqlite3 归档）。

### 1.2 依赖

| 依赖 | 类型 | 用途 |
|---|---|---|
| `node:fs`（`cpSync`/`rmSync`/`existsSync`/`readdirSync`/`lstatSync`/`realpathSync`/`mkdtempSync`/`readFileSync`/`writeFileSync`） | 内置 | 文件复制、目录物化、stub/补丁写入 |
| `node:child_process`（`execSync`） | 内置 | 调用 git / pnpm / npm / tar |
| `node:path`（`resolve`/`join`/`basename`）、`node:url`（`fileURLToPath`） | 内置 | 路径解析与工程根定位 |
| `pnpm` | 外部 | dsh 依赖安装 + `deploy --legacy` 物化 + `build:lib:host`/`build:lib:client`/`build:web` |
| `git` | 外部 | `git apply --reverse --check` 幂等探测 + `git apply` 应用补丁 |
| `npm` | 外部 | dsh-market 安装依赖 + `npm run build` |

> 无第三方 npm 依赖，纯 Node 内置能力 + 外部构建 CLI。

## 2. 宪法合规检查

| 宪法原则（constitution.md） | 状态 | 说明 |
|---|---|---|
| §1.5 sibling 源码引用 + 构建期 copy（非 submodule） | ✅ | 三个脚本分别消费 `../deepseek-harness`（patch+build）、`../dsh-market`（build+物化）、`../harmonypc-electron`（copy），无 submodule |
| §1.1 零上游改动（4 个 patch 内） | ✅ | `build-dsh.mjs` 只 apply 4 个 patch，其余复用 |
| §5.1 幂等构建 | ✅ | patch 应用 `--reverse --check` 幂等；`collect-runtime`/`collect-dsh` 可重复执行（已物化/已存在则跳过） |
| §5.2 二进制不提交 | ✅ | `libelectron.so` 等 SO 构建期从 sibling copy，不进 git |
| §5.3 产物适配集中在收集脚本 | ✅ | sharp stub / sqlite 注入 / preset patch 均在 `collect-dsh.mjs` 内完成，属本模块步骤，非独立模块 |

> 合规结论：全部 ✅，无 ⚠️ / ❌。

## 3. 研究结论

- **`pnpm deploy --legacy` 为何需要二次物化**：deploy 物化的 `node_modules` 是链接结构（外部依赖为 Junction 指向 `.pnpm` store），打包分发后链接失效；且 deploy 不物化 ① peerDependencies（cordis-plugin-group 等）、② 非 hoisted 外部依赖（zod）。故需 `materializeJunctions` + `collectNonHoistedDeps` + `collectWorkspacePackages` 三路补全（对应 FR-005-010/011/012）。
- **补丁幂等探测**：`git apply --reverse --check` 若成功说明补丁已应用，跳过；否则正向 `git apply`。比「记录已应用状态」更可靠，无需额外状态文件（FR-005-006）。
- **workspace 残留根因**：版本切换或 collect/deploy 遗留的空壳目录会被 tsdown 的 `vendor/*` 与 `packages/*/*` glob 匹配，导致 build 报 `dsh-root entry` 失败。真包至少含 `package.json` 或 `src/`，两者皆无的空壳即残留（FR-005-005）。
- **`collectNonHoistedDeps` 真实包名解析**：`.pnpm` entry 名是截断+hash（如 `@opentelemetry+exporter-log_8841...`），真实包名在 `entry/node_modules/<scope>/<name>` 内，故从嵌套目录提取而非用 entry 名。
- **better-sqlite3 注入方式**：Windows workspace 不装 native addon（无 aarch64 toolchain），改由 `collect-dsh.mjs` 从 `../harmonypc-electron-versions/better-sqlite3编译指导（Electron37）/better-sqlite3-ohos-v138.tar.gz` 解包注入，归档必须含 `package.json` 与 `build/Release/better_sqlite3.node`（FR-005-015，§18.4.1）。
- **agent preset 补丁为何必须落在 collect 阶段**：preset 由 cordis `Include` 在会话创建时组合成独立 EntryTree，host 的 `cordis.patch.yml` 只覆盖 host-plane，管不到 agent-plane；须直接改写 `config/agent-presets/*/agent.cordis.yml` 的顶层工具行（FR-005-016，§18.7 问题 3）。

## 4. 数据模型

### 4.1 collect-runtime 常量

- `EXCLUDE_TOP = {build, oh_modules, node_modules, .git, .hvigor, .idea, .codegraph}`：复制时剔除的顶层目录。
- `requiredSo = ['libelectron.so', 'libadapter.so', 'libffmpeg.so']`：必需 SO 清单。
- `runtimeRoot = ../harmonypc-electron/ohos_hap`；`sdkRoot = process.env.DEVECO_SDK_HOME`。
- libc++ 源路径：`<sdkRoot>/default/openharmony/native/llvm/lib/aarch64-linux-ohos/libc++_shared.so` → 目标 `electron/libs/arm64-v8a/libc++_shared.so`。

### 4.2 build-dsh 常量

- `dshRoot = ../deepseek-harness`；`marketRoot = ../dsh-market`。
- `patchFiles`（4 个，按序）：`patches/dsh-v0.1.2-rc.1/dsh-symlink-to-copy.patch`、`patches/dsh-v0.1.2-rc.1/dsh-allow-all-interfaces.patch`、`patches/dsh-v0.1.2-rc.1/dsh-disable-hmr.patch`、`patches/dsh-v0.1.2-rc.1/dsh-disable-native-picker.patch`。
- 构建命令序列：`pnpm install`（node_modules 缺失时）→ `pnpm run build:lib:host` → `build:lib:client` → `build:web` → dsh-market `npm install` + `npm run build`。

### 4.3 collect-dsh 常量与产物结构

- `distDir = dsh-dist`（清理后重建）；`betterSqliteArchive = ../harmonypc-electron-versions/better-sqlite3编译指导（Electron37）/better-sqlite3-ohos-v138.tar.gz`。
- `HARMONY_DISABLED_PRESET_ROWS = { 'tool-bash', 'tool-fs-search', 'persistent-shell' }`：需禁用的工具行 id → 禁用原因映射。
- 产物目录 `dsh-dist/`：`node_modules/`（含 `@deepseek-ai/*` + `dshmarket` + 物化后的扁平依赖）、`config/agent-presets/*/agent.cordis.yml`、`profiles/desktop/`、`node_modules/@deepseek-ai/dsh-web-frontend/dist/`。
- `materializeJunctions`/`pruneForeignPrebuilds` 递归深度上限 `depth > 8` 即返回，防环与爆栈。

## 5. 接口契约

### 5.1 提供的接口（脚本 + 内部函数）

| 脚本 / 函数 | 签名 | 说明 |
|---|---|---|
| `collect-runtime.mjs` | 入口脚本 | copy electron+web_engine → 校验 SO → 恢复 main.js → 注入 libc++ |
| `copyModule(name)` | `(name: string) => void` | 复制单个运行时模块（剔除 `EXCLUDE_TOP`），源缺失即 `process.exit(1)` |
| `build-dsh.mjs` | 入口脚本 | 清理残留 → 幂等 patch → pnpm build → 市场 build |
| `run(cmd, cwd)` | `(cmd, cwd) => void` | `execSync` 继承 stdio 执行命令 |
| `runQuiet(cmd, cwd)` | `(cmd, cwd) => boolean` | 静默执行，返回是否成功（用于 patch 幂等探测） |
| `collect-dsh.mjs` | 入口脚本 | deploy 物化 → 补包 → 产物适配 → 复制 dist/profile/市场 |
| `materializeJunctions(dir, depth)` | `(dir, depth=0) => void` | 递归把 symlink 物化为真实文件（跳过 `.bin`/`.pnpm`） |
| `copyPackage(pkgDir, destRoot)` | `(pkgDir, destRoot) => void` | 复制单个 `@deepseek-ai` 包（排除 node_modules） |
| `copyMarketRuntimeDeps(srcNm, destNm, marketRoot)` | `(...) => void` | BFS 复制市场运行时依赖（跳过 `@deepseek-ai` scope） |
| `collectDshMarket()` | `() => void` | 物化 dsh-market 到 `node_modules/dshmarket` |
| `collectWorkspacePackages()` | `() => void` | 补全 packages/vendor/apps 下所有 `@deepseek-ai` 包 |
| `collectNonHoistedDeps()` | `() => void` | 物化非 hoisted 依赖到顶层 node_modules |
| `pruneForeignPrebuilds(dir, depth)` | `(dir, depth=0) => void` | 删除非 `platform-arch` 的 prebuilds 子目录 |
| `applySharpStub()` | `() => void` | 写 sharp 纯 JS stub 到 `dist/index.mjs`+`index.cjs` |
| `patchAgentPresets()` | `() => void` | 禁用 preset 顶层工具行（`disabled: true` 注入） |
| `injectBetterSqlite3()` | `() => void` | 解包并注入 better-sqlite3 v138 成品 |

### 5.2 消费的接口

- `node:fs` / `node:child_process` / `node:path` / `node:url` 内置模块。
- 外部命令：`git apply`、`pnpm install/build/deploy`、`npm install/run build`、`tar -xzf`。
- 环境变量：`DEVECO_SDK_HOME`。

### 5.3 事件协议

- 无自定义事件协议。脚本为同步顺序编排，`execSync` 阻塞式调用外部 CLI；日志通过 `console.log`/`console.error` 带阶段前缀（`[collect-runtime]`/`[build-dsh]`/`[collect-dsh]`）输出。

## 6. 实现策略

### 6.1 架构模式

三阶段独立脚本，各自单文件、无共享模块、顺序执行（`① collect-runtime → ② build-dsh → ③ collect-dsh`）。脚本内部以「函数 + 顶层顺序调用」组织，校验前置失败即 `process.exit(1)`。

### 6.2 关键算法

- **Junction 物化**（FR-005-010）：`lstatSync` 判定 symlink → `realpathSync` 取真实目标 → 删链接 → `cpSync(target, fullPath, {dereference:true})`；目录则递归（depth>8 截断）。
- **非 hoisted 依赖物化**（FR-005-012）：遍历 `.pnpm/<entry>/node_modules/`，一级为 scope（`@` 开头）则取 `scope/name`，否则取 `name`；`materialize` 去重后从嵌套路径复制到顶层 `node_modules`。
- **workspace 残留清理**（FR-005-005）：遍历 `vendor/*` 与 `packages/*/*` 目录，`existsSync(package.json) || existsSync(src)` 为假即 `rmSync`。
- **preset 工具行禁用**（FR-005-016）：逐行扫描 `agent.cordis.yml`，正则 `^- id: ([A-Za-z0-9_-]+)\s*$` 匹配顶层行（列 0，不动 group 内 4 空格缩进嵌套行）；收集后续 2 空格缩进块，若块内已有 `disabled:` 则改写，否则在 `name:` 行后插入 `  disabled: true # HarmonyOS: <reason>`。
- **sharp stub**（FR-005-014）：写 `function sharp(_input,_options)` 返回 Proxy 可链式对象（`metadata`/`raw`/`toBuffer`/`toFile`/`stats`/`info` 均返回空值/占位），分别生成 ESM（`export default sharp`）与 CJS（`module.exports = sharp`）。

### 6.3 错误处理

- **致命**（`process.exit(1)` + `console.error`）：运行时模块/SO 缺失、libc++ 缺失、dsh 工程缺失、patch 文件缺失或应用失败、web dist 缺失、better-sqlite3 归档缺失或结构无效、dsh-market 缺失（collect 阶段）、main.js 缺失。
- **可跳过**（`console.warn`）：dsh-market 缺失（build 阶段）、sharp 缺失（跳过 stub）、agent-presets 目录缺失（跳过补丁）、物化失败单条（warn 后继续）。

### 6.4 性能

- 大文件复制（`libelectron.so` ~172MB、`dsh-dist` ~143MB）用 `cpSync` 递归；无热路径，均为一次性构建期操作。
- 体积优化：剔除生成目录、`pruneForeignPrebuilds` 删除非目标架构 `.node`、物化后删除冗余 `.pnpm` store（FR-005-013，§5.3 体积控制）。

## 7. 测试考量

- **产物结构检查**（Windows 可执行，`docs/工程规划.md` §18.4.1）：`Test-Path dsh-dist/node_modules/better-sqlite3/package.json`、`dsh-dist/node_modules/better-sqlite3/build/Release/better_sqlite3.node`、`electron/libs/arm64-v8a/libc++_shared.so` 三者存在。
- **幂等验证**：重复执行 `build-dsh.mjs` 断言 4 个 patch 均打印「已应用」；重复执行 `collect-runtime.mjs` 不报错。
- **边界**：SO 缺失 / libc++ 缺失 / web dist 缺失 / better-sqlite3 归档结构无效 / dsh-market 缺失，各触发 `process.exit(1)` 且输出明确信息。
- **native 加载验证**（需真机）：Windows x64 无法加载 aarch64 `.node`，better-sqlite3 加载、SQLite CRUD、会话持久化与 FTS 须在 Electron 37 真机执行（§18.4.1）。
- **建议自动化**：为 `patchAgentPresets` 断言「3 类行被禁用、`tool-fs` 等保留、group 内缩进行不被误改」。

## 8. 文件清单

| 文件 | 用途 | 行数 |
|---|---|---|
| `scripts/collect-runtime.mjs` | copy electron+web_engine、校验/注入 SO、恢复 main.js、注入 libc++ | 79 |
| `scripts/build-dsh.mjs` | 清理 workspace 残留、幂等 apply 4 patch、pnpm build host/client/web、build dsh-market | 120 |
| `scripts/collect-dsh.mjs` | pnpm deploy 物化、Junction 物化、补包、sharp stub、better-sqlite3 注入、preset patch、复制 dist/profile/市场 | 431 |
| `patches/`（4 个 patch） | dsh 上游兼容补丁（symlink-to-copy / allow-all-interfaces / disable-hmr / disable-native-picker） | — |
| `profiles/desktop/` | 自定义 desktop profile，被 collect 复制到 `dsh-dist/profiles/desktop` | — |

## 9. 与规格的交叉引用

| 技术决策 | 对应规格需求 |
|---|---|
| `collect-runtime.mjs` `copyModule` + `EXCLUDE_TOP` | FR-005-001 |
| `requiredSo` 校验 + `process.exit(1)` | FR-005-002 |
| main.js 恢复到 resfile | FR-005-003 |
| `DEVECO_SDK_HOME` → libc++ 注入 | FR-005-004 |
| workspace 残留清理（`vendor`/`packages` 空壳删除） | FR-005-005 |
| `git apply --reverse --check` 幂等探测 | FR-005-006 |
| `pnpm run build:lib:host/client` + `build:web` | FR-005-007 |
| dsh-market `npm run build`（缺失 warn 跳过） | FR-005-008 |
| `pnpm --filter @deepseek-ai/dsh deploy --legacy` | FR-005-009 |
| `materializeJunctions` + 删除 `.pnpm` store | FR-005-010 |
| `collectWorkspacePackages` + landlock-run 入口物化 | FR-005-011 |
| `collectNonHoistedDeps` | FR-005-012 |
| `pruneForeignPrebuilds` | FR-005-013 |
| `applySharpStub` | FR-005-014 |
| `injectBetterSqlite3` + 归档结构校验 | FR-005-015 |
| `patchAgentPresets` + `HARMONY_DISABLED_PRESET_ROWS` | FR-005-016 |
| web dist → `dsh-web-frontend/dist` | FR-005-017 |
| desktop profile → `dsh-dist/profiles/desktop` | FR-005-018 |
| `collectDshMarket` → `node_modules/dshmarket` | FR-005-019 |
