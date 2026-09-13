# 运行时 profile 功能规格

> Module: 006-runtime-profile
> Status: Implemented
> Last Updated: 2026-09-04

## 1. 模块概述

### 1.1 目的（Why this module exists）

本模块为被封装的宿主（deepseek-harness，dsh）定义一套「鸿蒙桌面运行时」的**自定义 profile + 上游 patch**，
使 dsh 在不被 fork 的前提下适配「Electron-on-鸿蒙」运行时（Electron 37 / Node 22.17.0 / aarch64 / 鸿蒙沙箱）。

模块由两部分组成，职责互补：

1. **声明式 profile**（`profiles/desktop/`）：声明 `desktop` profile 的组合（复用 web 组合 + 插件市场），
   并用 cordis patch 微调为桌面/鸿蒙形态——关闭 URL 打印、强制 webserver 绑全网卡、禁用依赖原生模块的插件、
   指定插件市场运行配置。
2. **上游 patch**（`patches/`）：4 个针对 dsh 源码的补丁，解决「鸿蒙沙箱禁 symlink」「鸿蒙 loopback 网络隔离」
   「HMR 依赖 `--expose-internals`」「Electron 下原生目录对话框 worker 无法 spawn」四类运行时冲突。

模块的核心价值是「**以配置 + 最小 patch 换取零 fork**」：所有对 dsh 的改动都收敛在 4 个 patch 与 1 份
`cordis.patch.yml` 内，其余 100% 复用 dsh 上游。

### 1.2 解决的问题（What pain points it addresses）

- **复用 vs 重造**：鸿蒙桌面壳需要 dsh 的 Web 界面与插件市场，但不应重新拼装插件组合。通过声明式复用
  web 组合（`dsh-base` + `dsh-web-app`）+ `dshmarket`，零重复、零 fork。
- **鸿蒙沙箱禁 symlink**：dsh 的 profile 安装机制用 `symlinkSync` 物化 fallback，鸿蒙沙箱对 symlink 抛
  `EACCES`，导致 `healProfilesModuleFallback` 初始化失败。patch 改为 symlink 失败时回退 `cpSync` 递归拷贝。
- **鸿蒙 loopback 网络隔离**：鸿蒙 NEXT 下渲染进程访问 `127.0.0.1` 被进程间网络隔离拦截，Web UI 白屏。
  patch 移除 dsh 对 `--host 0.0.0.0` 的「安全拒绝」检查，再由 profile 强制 `host: '0.0.0.0'`，渲染进程改走局域网 IP。
- **原生模块 ABI 不兼容**：dsh-dist 在 Windows 上收集，`node-pty`/`koffi` 二进制为 win32-x64，鸿蒙 aarch64
  无法加载。profile 禁用依赖它们的 4 个插件（subprocess/sandbox/bash-sandbox/permission）。
- **HMR 依赖受限能力**：dsh 的 watch-only HMR 依赖 `--expose-internals`，在打包桌面场景不应挂载。
  patch 加 `DSH_DISABLE_HMR` 开关跳过。
- **Electron 下原生目录对话框失效**：native picker 的 worker 用 `process.execPath`（Electron 下是
  `electron.exe` 而非 node），其 koffi 依赖 Node 内部符号，spawn 即失败。patch 强制走 `browse`（内置目录浏览）。

### 1.3 范围（Scope）

**包含**：

- `desktop` profile 的组合声明（bundles）与插件市场依赖声明；
- `cordis.patch.yml` 的覆盖语义（web-runtime / webserver / dsh-market / 禁用集）；
- 4 个上游 patch 的补丁内容与语义（目标文件、改动行为、目的）。

**不包含**：

- 构建脚本如何 apply/reverse patch（见 `005-build-pipeline`，本模块只描述 patch 的**内容与语义**）；
- 宿主的实际启动/就绪逻辑（见 `001-host`）；
- profile 文件在运行期的复制/安装编排（`ensureDesktopProfile` 等，见 `001-host`）；
- webserver 的端口绑定实现与数据面（dsh webserver 自身，端口由启动代码注入）。

## 2. 用户故事

- 作为鸿蒙桌面应用，我希望以「web 组合 + 桌面/鸿蒙微调」的方式启动宿主，而不是重新拼装插件或 fork dsh。
- 作为用户，我希望宿主启动时不会因 `node-pty`/`koffi` 等原生模块无法加载而崩溃（禁用依赖它们的插件）。
- 作为用户，我希望渲染进程能突破鸿蒙 loopback 隔离正常加载 Web UI（webserver 绑全网卡 + 局域网 IP）。
- 作为用户，我希望 profile 安装在任何启动环境（含禁 symlink 的沙箱）都能完成（symlink 回退 copy）。
- 作为用户，我希望在 Electron 桌面壳里使用目录选择器时能正常浏览目录（native 回退 browse）。
- 作为用户，我希望打包应用内不挂载依赖受限能力的 HMR 监视（`DSH_DISABLE_HMR` 跳过）。

## 3. 功能需求

### 3.1 组合声明

- FR-006-001：系统 MUST 声明一个 `desktop` profile，其组合包含 `dsh-base`、`dsh-web-app` 与 `dshmarket`
  三个 bundle。
- FR-006-002：系统 MUST 声明对 `dshmarket` 的依赖（版本 `1.26.0`），使其可作为 bundle 被解析。

### 3.2 profile 覆盖（cordis.patch.yml）

- FR-006-003：系统 MUST 关闭 web-runtime 的 URL 打印（`printUrl: false`），并保持其 `surfaceContext` 与
  `trustedHosts` 原值不变。
- FR-006-004：系统 MUST 强制 webserver 绑定 `host: '0.0.0.0'`（全网卡），以绕过鸿蒙 NEXT 渲染进程访问
  `127.0.0.1` 的 loopback 网络隔离。
- FR-006-005：系统 MUST 禁用 4 个依赖原生模块（`.node`）的插件：`subprocess`、`sandbox`、`bash-sandbox`、
  `permission`（其原生二进制为 win32-x64，鸿蒙 aarch64 无法加载）。
- FR-006-006：系统 MUST 为 dsh-market 指定运行配置 `profile: desktop`（否则默认写错目录）与
  `allowRestart: false`（桌面壳拥有进程生命周期，市场不得 spawn 独立 dsh 进程重启）。
- FR-006-007：系统 SHOULD 保持 webserver 端口由启动代码注入（`!!js ctx.webStartup.port ?? 3080`），
  不在 profile 层写死端口。

### 3.3 上游 patch 语义

- FR-006-008：系统 MUST 在 symlink 物化失败（`EACCES`/`EPERM`/`ENOSYS`/`EOPNOTSUPP`）时回退为
  `cpSync` 递归拷贝，且当目标位置已是真实目录（已被 copy 物化）时视为成功直接返回（symlink-to-copy）。
- FR-006-009：系统 MUST 移除 webserver 对 `--host 0.0.0.0` 的拒绝检查，使全网卡绑定可被接受
  （allow-all-interfaces）。
- FR-006-010：系统 MUST 将 HMR 挂载置于 `DSH_DISABLE_HMR` 环境变量开关之后，使该开关为真时跳过
  watch-only HMR（disable-hmr）。
- FR-006-011：系统 MUST 在运行于 Electron（`'electron' in process.versions`）时强制目录选择器后端为
  `browse`（disable-native-picker）。
- FR-006-012：4 个 patch MUST 可幂等应用（已应用时 `git apply --reverse --check` 通过，重复应用跳过）。

## 4. 关键实体

| 实体 | 描述 | 关键属性 |
|------|------|----------|
| profile | 宿主插件组合的命名配置 | 名称 `desktop`；`dsh.profile.bundles` 列表；依赖 `dshmarket@1.26.0` |
| patch（cordis 行） | 对特定插件行的用户级覆盖 | 定位 `id`；注入点 `inject`；覆盖后的 `config` 或 `disabled: true` |
| 上游 patch（git diff） | 对 dsh 源码的构建期补丁 | 目标文件路径；hunk 改动；目的 |
| 禁用集 | 因原生模块 ABI 不兼容而禁用的插件集合 | `subprocess`/`sandbox`/`bash-sandbox`/`permission`（4 个） |
| bundle | 被 profile 组合的 dsh 插件包 | `@deepseek-ai/dsh-base`/`@deepseek-ai/dsh-web-app`/`dshmarket` |

## 5. 验收场景

### 场景：组合声明正确

- Given `desktop` profile 被宿主加载
- When 宿主装配该 profile
- Then 组合包含 dsh-base、dsh-web-app 与 dshmarket 三个 bundle

### 场景：原生模块依赖插件被禁用

- Given dsh-dist 内 `node-pty`/`koffi` 为 win32-x64 二进制
- When 宿主装配 `desktop` profile
- Then `subprocess`/`sandbox`/`bash-sandbox`/`permission` 四个插件不加载，宿主不因原生模块加载失败而崩溃

### 场景：webserver 绑定全网卡

- Given 鸿蒙 NEXT 渲染进程访问 `127.0.0.1` 被 loopback 隔离拦截
- When 宿主 webserver 启动（`--host 0.0.0.0` 不再被拒绝）
- Then webserver 绑定 `0.0.0.0`，渲染进程可经局域网 IP 加载 Web UI

### 场景：symlink 回退 copy

- Given 运行环境沙箱对 symlink 抛 `EACCES`
- When profile 安装尝试物化 fallback（symlink）
- Then 回退为 `cpSync` 递归拷贝完成物化；且目标已是真实目录时直接视为成功

### 场景：Electron 目录选择器走 browse

- Given 运行于 Electron 桌面壳（`process.versions.electron` 存在）
- When 请求目录选择器后端
- Then 返回 `browse`（内置目录浏览，走 `host.listDirectory`），而非 `native`

### 场景：HMR 跳过

- Given 打包应用环境设置了 `DSH_DISABLE_HMR`
- When `runProfile` 进入 HMR 挂载判断
- Then 跳过 watch-only HMR 挂载

## 6. 非功能需求

- **零上游改动**：对 dsh 的改动收敛于 4 个 patch 与 1 份 `cordis.patch.yml`，不 fork dsh 业务代码与 Web UI。
- **可演进性**：profile 独立于 dsh 内置的 `web` profile；patch 语义以 `id` 定位、整块替换，便于对齐 dsh 上游版本。
- **可维护性**：每个 patch 与每段覆盖的意图均在注释中明确（`cordis.patch.yml` 注释、patch 内联注释）。
- **幂等性**：patch 应用幂等（`--reverse --check` 跳过已应用），重复构建结果一致。
- **安全**：`allow-all-interfaces` 仅移除「拒绝 `0.0.0.0`」的入口检查，不改动 dsh `client-connection`
  的 loopback-only 特权方法围栏语义（围栏放行由 `003-lifecycle` 的 Host 头改写单独兜底）。

## 7. 假设与约束

- **假设**：复用 web 组合（dsh-base + dsh-web-app）+ dshmarket 是既定产品决策（工程规划 §3 原则、§9）。
- **约束**：4 个 patch 的基线版本为 `dsh-v0.1.2-rc.1`（工程规划 §18.4 前置 2）；上游版本变更可能导致 patch 失配。
  [NEEDS CLARIFICATION：patch 是否对上游后续版本向前兼容未验证]
- **约束（已知取舍）**：禁用 subprocess/sandbox/bash-sandbox/permission 意味着终端（bash 工具）、进程沙箱、
  内容搜索等能力不可用（MVP 接受），恢复需按 aarch64 工具链交叉编译原生模块（工程规划 §18.5）。
- **约束**：`0.0.0.0` 绑定 + 局域网 IP 加载依赖「Host 头 loopback 改写」才能保住特权方法围栏（见 `003-lifecycle`），
  本模块的 patch 不承担围栏放行职责。
- **约束**：symlink-to-copy 的 `cpSync` 过滤 `node_modules` 目录不拷贝（依赖目录由上层物化流程单独就位）。
  [NEEDS CLARIFICATION：为何跳过 node_modules 而非全量拷贝，取决于 dsh `healProfilesModuleFallback` 对依赖目录的既有物化方式]

## 8. 依赖

**上游（被本模块消费）**：

- dsh 的 profile 机制（`dsh.profile.bundles`）与 cordis patch 机制（行级覆盖/禁用）；
- `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`dshmarket` 三个被组合的 bundle；
- dsh 上游源码文件（4 个 patch 的作用对象：`app-boot/src/profile.ts`、`bundle/web-app/src/startup.ts`、
  `apps/cli/src/profile-boot.ts`、`directory-picker-auto/src/resolve.ts`）。

**下游（消费本模块）**：

- `005-build-pipeline`：构建期 apply 这 4 个 patch（幂等）到 dsh 源码；
- `001-host`：以 `desktop` profile 名启动宿主，并在运行期复制/装配本模块的 profile 文件；
- `201-dsh-market`：其运行配置（profile/allowRestart）由本模块的 `cordis.patch.yml` 指定。
