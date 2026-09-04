# Host 宿主 功能规格

> Module: 001-host
> Status: Implemented
> Last Updated: 2026-09-04

## 1. 模块概述

### 1.1 目的（Why this module exists）

在鸿蒙桌面应用的**主进程内**启动并挂起 deepseek-harness（dsh）的 Host（宿主，含内置 webserver），
并向桌面壳提供：

1. **宿主上下文**（`ctx`）——供桌面能力直接订阅宿主事件；
2. **同源加载地址**（`http://<可达地址>:<port>/`）——供窗口模块加载 dsh Web UI；
3. **优雅关闭句柄**（`shutdown`）——应用退出时释放宿主资源。

模块的核心价值是「就绪判定」：桌面壳必须先拿到 Host 的**实际绑定端口**与**渲染进程可达的地址**，
才能在窗口创建时用正确的地址加载界面。这是「先就绪、后建窗」加载时序的宿主侧。

> 与 sibling `deepseek-harness-desktop` 的 001-host 同构，唯一本质差异是：鸿蒙 NEXT 下渲染进程
> 访问 loopback（127.0.0.1）存在进程间网络隔离，故本模块让 webserver 绑定 `0.0.0.0`（所有网卡）、
> 并选用**局域网 IPv4** 构造加载地址（而非 127.0.0.1）。

### 1.2 解决的问题（What pain points it addresses）

- **避免自定义协议 / 鉴权 / CORS 三件套**：dsh 的 webserver 同源服务 SPA dist 与 `/api`，
  渲染进程直接加载即同源，fetch `/api` 与 WebSocket `/api/events.mux` 均无需 CORS、无需鉴权、
  无需自定义协议、无需新 IPC 载体。
- **避免端口冲突**：使用「端口 0 = 由 OS 分配」语义，宿主绑定空闲端口并回传实际端口，杜绝固定端口占用。
- **避免加载竞争**：宿主先就绪（拿到端口 + 可达地址）→ 再建窗加载，杜绝渲染进程在宿主未就绪时的加载竞态。
- **规避鸿蒙 loopback 网络隔离**：webserver 绑全部网卡、加载地址走局域网 IPv4，使内嵌渲染进程在
  loopback 被隔离的前提下仍能同源访问 dsh Web UI。
- **规避 shell/subprocess/pty 缺失导致的 preset 挂载失败**：agent preset 中依赖 shell/subprocess/pty
  的工具行在鸿蒙运行时不可用（node-pty 原生模块 MVP 已禁用），不处理会导致 preset 挂载失败、
  会话创建报 `agent-preset-invalid`。本模块在运行时禁用这些工具行。
- **优雅释放**：通过 `shutdown` 句柄在退出时 dispose 插件树，避免宿主资源泄漏。

### 1.3 范围（Scope）

**包含**：

- 启动宿主的统一入口（`startHost`）及其返回值契约（宿主句柄 / 空句柄）；
- profile-boot 薄入口的定位（`findProfileBootEntry`）；
- desktop profile 的安装（`ensureDesktopProfile`）与 dshmarket 的复制（`ensureDshMarketProfileLink`）；
- agent preset 工具行的运行时禁用（`patchAgentPresetsRuntime` + 禁用行映射）；
- 渲染进程可达地址的选择（`pickReachableHost`）；
- 就绪判定（拿到实际端口 + 可达地址，拼出同源加载 URL）；
- 优雅关闭句柄的暴露。

**不包含**：

- 窗口创建与加载（见 `002-window`）；
- 应用生命周期、HOME 沙箱修正、loopback 请求头改写、NO_PROXY 绕过（见 `003-lifecycle`）；
- 产物 tar.gz 解压引导（见 `004-artifact-bootstrap`，本模块依赖其产物 `DSH_ROOT` 就位）；
- dsh 自身功能（agent、session、工具调用等，全部由 dsh 提供，桌面壳不实现）。

## 2. 用户故事

- 作为用户，我希望鸿蒙桌面应用启动后能在进程内拉起 dsh Host 并绑定一个空闲端口，使界面能够被加载，
  而无需我手动启动 `dsh web`。
- 作为用户，我希望界面功能 100% 沿用 dsh 标准 Web UI，不出现桌面壳二次封装的行为差异。
- 作为用户，我希望关闭/退出应用时，Host 资源被优雅释放，不留僵尸进程或端口占用。
- 作为用户，我希望在鸿蒙设备上首次启动即可正常打开 dsh Web UI 并创建会话（工作区可选中、可开会话），
  不因 shell/终端能力缺失而卡在「选择工作区」。
- 作为（桌面能力的）开发者，我希望拿到宿主的上下文，以便直接订阅宿主事件（如会话结束、审批请求）。

## 3. 功能需求

### 3.1 宿主启动

- FR-001-001：系统 MUST 提供统一的宿主启动入口，在应用进程内启动 dsh Host。
- FR-001-002：系统 MUST 让宿主的 webserver 绑定一个**空闲端口**（以「端口 0 = OS 分配」方式），
  并取得实际绑定端口。
- FR-001-003：系统 MUST 采用 `desktop` profile 启动宿主（复用 `dsh-base` + `dsh-web-app` 组合）。
- FR-001-004：系统 MUST 让宿主的 webserver 绑定 `0.0.0.0`（所有网卡），而非仅 loopback，
  以规避鸿蒙 NEXT 渲染进程的 loopback 网络隔离。

### 3.2 就绪判定与句柄

- FR-001-005：系统 MUST 在宿主就绪后返回一个宿主句柄，至少包含：宿主上下文（`ctx`）、
  优雅关闭（`shutdown`）、实际端口（`port`）、同源加载地址（`url`）。
- FR-001-006：系统 MUST 校验宿主上下文中的 webserver 是否可用（`ctx.webServer` 存在）；缺失时
  视为启动失败，返回空句柄并记录错误。
- FR-001-007：系统 MUST 以渲染进程可达的地址构造同源加载地址，优先局域网 IPv4，回退 127.0.0.1。

### 3.3 profile 装配

- FR-001-008：系统 MUST 在启动宿主前将 desktop profile 安装到宿主数据目录（`$DSH_HOME/profiles/desktop`），
  且该安装 MUST 幂等（重复执行不产生错误、不丢失用户插件）。
- FR-001-009：系统 MUST 将 dshmarket 复制到宿主数据目录（`$DSH_HOME/profiles/node_modules/dshmarket`），
  采用**复制而非符号链接**；复制失败 MUST NOT 阻塞宿主启动。

### 3.4 profile-boot 入口定位

- FR-001-010：系统 MUST 在 dsh 产物目录中定位 profile-boot 薄入口（re-export `runProfile` 的 JS 文件），
  并在存在多个候选时选择最新（mtime 最大）者。

### 3.5 鸿蒙工具行禁用

- FR-001-011：系统 MUST 在启动宿主前禁用 agent preset 中依赖 shell/subprocess/pty 的工具行，
  以保证 preset 正常挂载；该操作 MUST 幂等（已禁用则不重复改写）。

### 3.6 优雅关闭与降级

- FR-001-012：系统 MUST 提供优雅关闭句柄，调用后释放（dispose）宿主插件树。
- FR-001-013：在 dsh 产物缺失 / profile-boot 入口未定位 / 启动失败时，系统 MUST 返回空句柄（`null`）
  而非阻塞应用启动，使主进程能够显示兜底页继续运行，并记录可诊断的错误摘要。

## 4. 关键实体

| 实体 | 说明 | 关键属性 |
|------|------|----------|
| 宿主句柄（HostHandle） | 主进程持有的 dsh Host 句柄 | `ctx`（上下文）、`shutdown`（优雅关闭）、`port`（实际端口）、`url`（同源加载地址） |
| 宿主上下文（HostContext） | dsh Cordis Context | `webServer.port`（webserver 实际端口） |
| profile-boot 薄入口 | dsh CLI lib 中 re-export `runProfile` 的 JS 文件 | `path`（文件路径）、`mtime`（修改时间，用于选最新） |
| 禁用工具行（DisabledPresetRow） | agent preset 中需禁用的工具行 | `id`（如 `tool-bash`）、`reason`（禁用原因） |

## 5. 验收场景

### 场景：宿主启动成功

- Given 应用启动，dsh 产物已就位（DSH_ROOT 已解压）
- When 调用宿主启动入口
- Then 返回宿主句柄，其 `port` 为 OS 分配的实际端口，`url` 为 `http://<局域网 IPv4>:<port>/`；
  主进程可据此加载界面

### 场景：webserver 缺失降级

- Given `runProfile` 返回的 `ctx` 中无 `webServer`
- When 调用宿主启动入口
- Then 返回空句柄（`null`），并记录 `webServer undefined` 相关错误摘要，应用启动不被阻塞

### 场景：产物缺失降级

- Given dsh 产物缺失或 profile-boot 薄入口未定位
- When 调用宿主启动入口
- Then 返回空句柄（`null`），主进程显示兜底页

### 场景：profile 装配幂等

- Given 宿主数据目录已存在 desktop profile（含用户插件）
- When 再次调用宿主启动入口
- Then 不覆盖用户插件（package.json 合并），种子文件（cordis.patch.yml 等）以最新版覆盖

### 场景：工具行禁用幂等

- Given agent preset 工具行已被禁用
- When 再次执行工具行禁用逻辑
- Then 不重复改写（无重复的 `disabled: true` 行）

### 场景：优雅关闭

- Given 宿主已启动并返回句柄
- When 应用退出时调用 `shutdown`
- Then 宿主插件树被释放，无资源泄漏

## 6. 非功能需求

- **性能**：宿主启动应高效完成；桌面壳自身不引入额外等待（「就绪后建窗」避免无效轮询）。
- **可移植性**：宿主进程边界应设计为可迁移到子进程/独立进程，迁移对渲染进程（只认可达地址）透明。
- **可维护性**：对 dsh 的依赖以「动态 import + 薄入口」封装，接口集中在本模块，便于跟随 dsh 上游迭代。
- **安全性**：webserver 绑定 `0.0.0.0` 是鸿蒙 loopback 隔离的妥协；特权方法（`settings.*`/`credentials.*` 等）
  的 loopback-only 围栏语义由生命周期模块的头改写保证（见依赖），本模块不改动围栏语义。
- **幂等性**：profile 安装、工具行禁用、dshmarket 复制均幂等，支持重复启动无副作用。

## 7. 假设与约束

- **假设**：dsh 的 webserver 支持「端口 0 → OS 分配」并回传实际端口，且接受 `--host 0.0.0.0`
  绑定参数（本项目已通过 allow-all-interfaces patch 移除 dsh 对 0.0.0.0 的拒绝检查）。
- **假设**：`runProfile` 返回 `{ ctx, shutdown }`，其中 `shutdown` 提供 `shutdown(code?)` 方法。
- **假设**：profile-boot 薄入口为 dsh CLI lib 下 `profile-boot-*.js`，内容含 `export { runProfile`，
  且为短小文件（< 300 字符级判定）。
- **约束（已知代价）**：Host 运行在主进程内，宿主崩溃 = 应用级崩溃（MVP 已接受的代价，后续可迁移到 utilityProcess）。
- **约束（MVP 已确认）**：原生模块 node-pty（终端）/ koffi（沙箱）/ sharp 在鸿蒙 aarch64 不可用，
  相应能力被禁用或 stub，因此需禁用依赖它们的 agent preset 工具行。
- **约束**：宿主数据目录（`DSH_HOME`）独立于用户全局 `~/.dsh`，指向应用沙箱可写目录下的 `.dsh`。
  [NEEDS CLARIFICATION]：DSH_HOME 的具体路径由启动入口根据运行环境注入，本模块仅在其未设置时兜底赋值。

## 8. 依赖

**上游（被本模块消费）**：

- deepseek-harness（dsh）—— `runProfile`（经 profile-boot 薄入口）、`loadLayeredEnv`（经 dsh-app-boot）、
  `desktop` profile（`profiles/desktop`）、dshmarket（`node_modules/dshmarket`）、agent preset（`config/agent-presets`）。
- `004-artifact-bootstrap`（产物解压引导）—— 保证 `DSH_ROOT`（userData/dsh-dist）就位，本模块的
  `DSH_CLI_LIB` / `DSH_APP_BOOT_LIB` / `DESKTOP_PROFILE_SRC` 均基于 `DSH_ROOT` 解析。
- `006-runtime-profile`（运行时 profile）—— desktop profile 的种子文件（`cordis.patch.yml` 等），
  本模块负责将其安装到 `$DSH_HOME`。

**下游（消费本模块）**：

- `002-window`（窗口管理）：使用宿主的 `url` 加载界面；宿主为 null 时使用兜底页。
- `003-lifecycle`（生命周期与鸿蒙适配）：调用 `startHost()` 编排启动时序，并在退出时调用 `shutdown`；
  其 loopback 请求头改写依赖本模块返回的 `port`。
