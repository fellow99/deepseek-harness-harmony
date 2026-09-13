# overall-spec.md — 整体规格

> deepseek-harness-harmony 系统级功能规格（技术无关，描述 WHAT 与 WHY）。
> Last Updated: 2026-09-04

## 1. 系统目的与目标用户

**目的**：在鸿蒙/OpenHarmony 设备上提供 deepseek-harness（dsh）的一等公民桌面应用，对标 `deepseek-harness-desktop`，而非「包一层 `dsh web`」的粗壳。

**目标用户**：鸿蒙 2in1 / tablet 设备上使用 AI agent harness 进行会话、agent 编排、工具调用的用户。

**核心价值**：界面 100% 复用 dsh Web UI，无行为差异；桌面封装只负责「让 dsh 在鸿蒙设备上跑起来」，不重造业务能力。

## 2. 核心能力（用户故事）

- 作为用户，我希望在鸿蒙设备上启动应用后，直接看到 dsh 的标准 Web 界面（新建会话、聊天、agent 工具调用），而无需手动启动 `dsh web`。
- 作为用户，我希望首次启动时应用自动完成初始化（解压产物），期间看到加载提示，而非白屏。
- 作为用户，我希望应用能在鸿蒙沙箱内正常「选择工作区」（浏览目录），不会因权限不足报错。
- 作为用户，我希望「设置」等敏感操作可用，而不会被安全围栏误拦。
- 作为用户，我希望会话持久化（SQLite）与历史搜索正常工作。
- 作为用户，我希望从插件市场安装/管理插件。
- 作为开发者，我希望通过确定性构建脚本从同级工程一键产出可安装 HAP。

## 3. 功能需求（按域）

### 3.1 启动与初始化

- FR-OV-001：系统 MUST 在应用启动时把 HOME 环境变量指向应用沙箱可写目录，使目录浏览等依赖 `homedir()` 的能力落到沙箱内。
- FR-OV-002：系统 MUST 在首次启动时把压缩产物（tar.gz）流式解压到用户数据目录，并在后续启动复用（幂等跳过）。
- FR-OV-003：系统 MUST 在初始化期间显示加载页，避免用户面对白屏。

### 3.2 宿主承载

- FR-OV-004：系统 MUST 在应用进程内以 `desktop` profile 启动 dsh Host（含 webserver），并取得实际绑定端口。
- FR-OV-005：系统 MUST 让 webserver 绑定所有网卡（0.0.0.0）并以局域网可达 IP 构造加载地址，规避鸿蒙 loopback 网络隔离。
- FR-OV-006：系统 MUST 在 Host 启动失败时降级（显示兜底页），不阻塞应用启动。

### 3.3 界面加载

- FR-OV-007：系统 MUST 让渲染进程同源加载 dsh Web UI（零 CORS、零鉴权）。
- FR-OV-008：系统 MUST 把渲染进程发往 webserver 的请求的 Host/Origin 改写为 loopback，使特权方法（settings/credentials 等）通过安全围栏，且不影响局域网其他设备的 403 语义。

### 3.4 能力取舍（MVP）

- FR-OV-009：系统 MUST 禁用依赖不可用原生模块（node-pty/koffi）的插件（subprocess/sandbox/bash-sandbox/permission），保证 Host 正常启动。
- FR-OV-010：系统 MUST 禁用 agent preset 中依赖 shell/subprocess/pty 的工具行，保证会话创建（工作区关联）成功。
- FR-OV-011：系统 MUST 以纯 JS stub 替代 sharp（图片校验变 no-op），保证附件路径可用。
- FR-OV-012：系统 MUST 注入 aarch64 兼容的 better-sqlite3，保证会话持久化与全文搜索可用。

### 3.5 构建与分发

- FR-OV-013：系统 MUST 提供三阶段构建脚本，从 3 个同级工程确定性产出 HAP 所需产物。
- FR-OV-014：系统 MUST 输出签名 HAP 并支持 `hdc install` 安装。

## 4. 非功能需求

- **性能**：产物解压采用流式（避免 555MB 一次性载入内存导致 OOM）；宿主就绪后才建窗加载，无忙等。
- **可移植性**：宿主进程边界设计为可迁移（渲染进程只认地址，迁移透明）。
- **安全性**：特权方法围栏语义不变；HOME 不触碰沙箱外目录；原生沙箱 MVP 禁用（已知取舍）。
- **可维护性**：对 dsh 依赖以「源码引用 + 最小接口 + 4 patch」封装；产物适配集中在收集脚本。
- **可调试性**：统一 `[dsh-harmony]` 日志前缀（hilog）；诊断信息写入 `globalThis.__hostError`/`__extractError`/`__winError` 全局变量。

## 5. 系统边界

**在范围内**：鸿蒙 HAP 桌面封装（主进程编排、桥接接线、构建流水线、运行时 profile、patch）。

**不在范围内**：
- dsh 自身功能（agent/session/工具调用，全部由 dsh 提供）。
- 系统托盘（鸿蒙 2in1 无传统托盘，语义需重构，二期）。
- 无边框窗口 / 开机自启 / 全局快捷键（二期）。
- 原生文件/目录选择器（使用 dsh Web UI 内置目录浏览）。
- 终端（bash 工具，node-pty 无 aarch64 产物，禁用）。
- 进程沙箱（koffi/landlock，禁用）。
- 商店分发 / 自动更新（本地签名 HAP 自用）。

## 6. 依赖

- `../deepseek-harness`（dsh Host，patch 基线 dsh-v0.1.2-rc.1）。
- `../dsh-market`（插件市场，1.26.0）。
- `../harmonypc-electron`（Electron-on-鸿蒙运行时，Electron 37）。
- `../deepseek-harness-desktop`（仅架构参考，无构建依赖）。
