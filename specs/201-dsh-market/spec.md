# dsh-market 插件市场 功能规格

> Module: 201-dsh-market
> Status: Implemented
> Last Updated: 2026-09-04

## 1. 模块概述

### 1.1 目的 —— 为什么存在这个模块

把 [dsh-market](https://github.com/dsh-market/dsh-market)（DeepSeek Harness 的可视化插件市场，npm 包 `dshmarket`，版本 `1.26.0`）**内置**到本工程（deepseek-harness-harmony，鸿蒙桌面版）封装的 dsh 环境中，使其随 Host **自动加载**，并让用户在鸿蒙设备的桌面应用内浏览插件市场目录、查看已装插件。

dsh-market 是一个前后端混合的 Cordis 插件：宿主端（`lib/`）挂载 `/dsh-market/*` HTTP 路由并读写 profile 目录，浏览器端（`client/`）注入设置页 UI。本模块负责「把它作为一个 bundle 装进 desktop profile 并打通其物化、复制与运行配置」——**不改 dsh-market 与 dsh 的上游代码**，只描述「如何集成到本工程」。

### 1.2 解决的问题

- **零命令行逛插件市场**：鸿蒙设备用户无需自装 Node/pnpm，即可在设置页看到「插件市场」入口并浏览社区目录。
- **打包应用的插件市场可用**：普通 `dsh web` 依赖系统 Node/pnpm；打包进 HAP 的鸿蒙应用没有这些运行时，本模块通过「构建期物化 + 运行期复制」把市场产物随 dsh 部署产物一并打入，使市场的前后端 bundle 在设备上可被解析、可被服务。
- **profile 正确性**：dsh-market 默认操作 `web` profile，本工程用 `desktop` profile，必须显式注入 profile 名，否则安装/删除会写错目录。
- **进程生命周期归属**：市场不能擅自在鸿蒙设备上 spawn 独立 dsh 进程重启，须由桌面壳掌控进程生命周期。

### 1.3 范围

**包含**：

- 构建期构建 dsh-market（`npm install` + `npm run build`，产出 `lib/` 与 `client/`）。
- 收集期把市场产物（`package.json` + `cordis.patch.yml` + `lib/` + `client/`，排除源码/测试/devDeps）物化到 `dsh-dist/node_modules/dshmarket`，并递归复制其运行时依赖（`@deepseek-ai` scope 从宿主解析）。
- 运行期把 dshmarket 复制到 `$DSH_HOME/profiles/node_modules/dshmarket`（复制而非 symlink）。
- desktop profile 声明 dshmarket 为 bundle 并注入运行配置（`profile: desktop`、`allowRestart: false`）。

**不包含**：

- 修改 dsh-market 或 dsh 的上游源码（沿用「零上游改动」宪法原则）。
- dsh-market 自身功能（目录拉取、备份/WebDAV/Gist、诊断、安装/删除的执行逻辑）——全部由 dsh-market 自身提供。
- **便携 Node/pnpm 运行时与 `dsh plugin` 安装/删除通道**（desktop 版有此通道，本工程未提供，见 §7 约束与 [NEEDS CLARIFICATION]）。
- 全局快捷键、开机自启等其它桌面能力。

## 2. 用户故事

- 作为用户，我希望打开鸿蒙桌面应用后，设置页就能看到「插件市场」，无需任何手动配置。
- 作为用户，我希望在插件市场里浏览社区插件目录、查看已安装的插件。
- 作为用户，我希望插件市场不会擅自重启我的桌面应用（重启由桌面壳掌控）。
- 作为打包者，我希望只需顺序执行构建/收集脚本，市场产物即自动物化进部署包，无需手工拷贝。
- 作为打包者，当市场工程缺失时，我应得到明确报错而非产出「能启动但市场缺失」的残缺产物。

## 3. 功能需求

### 3.1 构建期构建市场

- FR-201-001：系统 MUST 在构建阶段构建 dsh-market（依赖缺失时 `npm install`，随后 `npm run build`，产出 `lib/` 与 `client/`）。
- FR-201-002：当市场工程（`../dsh-market`）缺失时，系统 SHOULD 在构建阶段警告并跳过，而不中断主构建流程。

### 3.2 收集期物化市场产物

- FR-201-003：系统 MUST 将市场产物（`package.json` + `cordis.patch.yml` + `lib/` + `client/`，排除源码/测试/devDeps）物化到 `dsh-dist/node_modules/dshmarket`。
- FR-201-004：收集阶段市场工程缺失时，系统 MUST 以明确错误终止流程（`process.exit(1)`），而非产出残缺部署包。
- FR-201-005：系统 MUST 递归复制市场的运行时依赖（`dependencies` 字段 + 传递依赖）到市场自身 `node_modules`；`@deepseek-ai` scope 的依赖 MUST 从宿主 dsh-dist 解析而不复制。
- FR-201-006：物化 MUST 幂等（目标 `dshmarket/package.json` 已存在则跳过）。

### 3.3 运行期复制到 profile

- FR-201-007：系统 MUST 在 Host 启动前将 dshmarket 从部署产物复制到 `$DSH_HOME/profiles/node_modules/dshmarket`（复制而非 symlink，因鸿蒙沙箱禁止 symlink）。
- FR-201-008：该复制 MUST 幂等（目标 `package.json` 已存在则跳过），且失败时 MUST NOT 阻塞 Host 启动。

### 3.4 bundle 声明与运行配置注入

- FR-201-009：系统 MUST 将 `dshmarket` 声明为 desktop profile 的 bundle（`dsh.profile.bundles`）并写入 `dependencies`（版本 `1.26.0`），使市场随组合自动加载。
- FR-201-010：系统 MUST 在 desktop profile 的 `cordis.patch.yml` 注入运行配置 `config: { profile: desktop, allowRestart: false }`，使市场操作正确的 profile 且不擅自 spawn 独立 dsh 进程重启。

## 4. 关键实体

| 实体 | 描述 | 关键属性 |
|------|------|----------|
| dsh-market 产物（dshmarket） | 内置的插件市场包 | `lib/`（host half）、`client/`（browser half）、`cordis.patch.yml`（insert 声明）、`package.json`（name=dshmarket） |
| 市场运行时依赖闭包 | 复制到市场自身 `node_modules` 的第三方依赖 | `undici`、`js-yaml`、`argparse` 等（`dependencies` + 传递依赖；`@deepseek-ai` 从宿主解析） |
| desktop profile 声明 | 加载市场所用的 profile 组合 | `dsh.profile.bundles`（含 `dshmarket`）+ `dependencies.dshmarket` |
| 市场运行配置（MarketConfig） | 注入到 market 行的配置 | `profile: 'desktop'`、`allowRestart: false` |
| 双解析锚点 | 市场 host/client 两个半体的解析位置 | ① bundle loader 锚点 `DSH_ROOT/node_modules/dshmarket`；② client 扫描锚点 `$DSH_HOME/profiles/node_modules/dshmarket` |

## 5. 验收场景

### 场景：构建后市场产物就位

- Given 同级市场工程 `../dsh-market` 已 checkout 且 node_modules 缺失
- When 执行构建脚本（build-dsh 阶段）
- Then 市场工程执行 `npm install` + `npm run build`，产出 `lib/` 与 `client/`

### 场景：收集期物化市场（含运行时依赖）

- Given 市场已构建，dsh 产物收集脚本执行
- When `collectDshMarket()` 运行
- Then `dsh-dist/node_modules/dshmarket` 含 `package.json`、`cordis.patch.yml`、`lib/`、`client/`；其 `node_modules` 含运行时依赖（如 `undici`），不含 `@deepseek-ai/*`（从宿主解析）

### 场景：市场工程缺失时收集硬失败

- Given `../dsh-market/package.json` 不存在
- When 收集脚本执行到物化市场步骤
- Then 脚本输出明确错误并 `process.exit(1)`，不产出残缺部署包

### 场景：启动后市场复制到 profile

- Given 部署产物已解压到 `userData/dsh-dist`，`$DSH_HOME/profiles/node_modules/dshmarket` 不存在
- When Host 启动（`startHost()` 调用 `ensureDshMarketProfileLink`）
- Then dshmarket 被复制到 `$DSH_HOME/profiles/node_modules/dshmarket`（真实文件复制，非 symlink）；重复启动跳过

### 场景：设置页出现插件市场（自动加载）

- Given 应用启动、dsh Host 就绪、窗口加载
- When 用户打开设置页
- Then 出现「插件市场」入口，能浏览社区目录

### 场景：市场不擅自重启

- Given 市场需要「重启生效」的场景
- When 触发变更
- Then 市场显示待重启提示，但不 spawn 独立 dsh 进程（`allowRestart: false`），由桌面壳关窗/重开完成生效

## 6. 非功能需求

- **幂等性**：构建、收集物化、运行期复制均 MUST 可重复执行（已物化/已复制则跳过）。
- **健壮性**：收集阶段市场缺失 MUST 硬失败；运行期复制失败 MUST 不阻塞启动（warn）。
- **体积**：市场产物与其运行时依赖（`undici` 等）增加部署包体积，属可接受代价；不复制 `@deepseek-ai` scope 与源码/测试/devDeps 以控制体积。
- **安全**：`allowRestart: false` 关闭市场的进程重启能力；市场 API 仅接受同源 loopback 请求（沿用 dsh-market 既有约束，dsh 特权方法围栏不变）。
- **可维护性**：市场作为 sibling 源码引用，随其 tag 迭代；收集逻辑集中在 `collect-dsh.mjs` 的 `collectDshMarket()` / `copyMarketRuntimeDeps()`。

## 7. 假设与约束

- **假设**：dsh-market 为本工程同级目录源码引用 `../dsh-market`（非 git submodule）。
- **假设**：市场默认 profile 为 `web`（`config?.profile ?? argvProfile() ?? 'web'`），本工程用 `desktop`，须显式注入，否则安装/删除写错目录。
- **约束（鸿蒙沙箱禁 symlink）**：运行期复制到 `$DSH_HOME/profiles/node_modules/dshmarket` 采用 `cpSync`（复制）而非 symlink，规避沙箱 `EACCES`（对齐 `dsh-symlink-to-copy.patch` 的取舍）。
- **约束（无便携运行时）**：本工程未内置便携 Node/pnpm、未写 `dsh` shim、未做 PATH 注入（区别于 desktop 版 `fetch-runtime.mjs` + `setupMarketRuntime()`）。鸿蒙设备无系统 Node/pnpm，因此市场的「安装/删除插件」通道（底层 spawn `dsh plugin add|remove` + pnpm）在设备上是否可用属 [NEEDS CLARIFICATION]。浏览目录、查看已装插件等不依赖子进程的能力不受影响。

## 8. 依赖

**上游（被本模块消费）**：

- dsh-market（`../dsh-market`，sibling 源码引用，非 submodule，版本 `1.26.0`）——内置对象。构建前必须与本工程同级 checkout；`build-dsh.mjs` 缺失 node_modules 时 `npm install` + `npm run build`，`collect-dsh.mjs` 物化其 `lib/`+`client/`+`cordis.patch.yml`+`package.json` 为 `dsh-dist/node_modules/dshmarket`，缺失则硬失败。
- deepseek-harness（`../deepseek-harness`）——dsh Host，提供 `dsh.client` 机制、`cordis.patch.yml` 补丁层，市场 `@deepseek-ai` 依赖从其物化产物解析。

**下游 / 本工程模块间依赖**：

- `005-build-pipeline`：本模块的市场构建与物化落点在 `build-dsh.mjs` / `collect-dsh.mjs`（FR-005-008 / FR-005-019 对应）。
- `006-runtime-profile`：本模块扩展其 `profiles/desktop/package.json`（bundles + dependencies）与 `cordis.patch.yml`（market 行 config）。
- `001-host`：本模块在 `startHost()` 前经 `ensureDshMarketProfileLink()` 复制市场到 profile（消费点）。
