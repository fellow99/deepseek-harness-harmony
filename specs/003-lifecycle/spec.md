# 生命周期与鸿蒙适配 功能规格

> 模块：003-lifecycle（生命周期与鸿蒙适配）
> 状态：Implemented（真机验证通过，HarmonyOS 6.1.0.135 / API 24）
> 最后更新：2026-09-04

## 1. 模块概述

### 1.1 目的 —— 为什么存在这个模块

本模块负责应用启动早期的「鸿蒙运行时适配」与运行期的「生命周期兜底」。鸿蒙 NEXT 运行时与 dsh 上游所假设的「标准 Electron 桌面 / LAN 环境」存在三类本质差异，必须在宿主（dsh Host，含 webserver）真正对外服务之前予以修正：

1. **沙箱边界差异**：鸿蒙沙箱中 Node 的 `os.homedir()` 解析到沙箱外系统用户目录（应用无权访问，读之抛 `EPERM`），而 dsh 目录浏览器以 `homedir()` 作为「选择工作区」的起始目录。
2. **loopback 网络隔离**：鸿蒙 NEXT 下渲染进程访问 `127.0.0.1` 被进程间网络隔离拦截，故宿主 webserver 绑全网卡、渲染进程走局域网 IP 加载；但 dsh 的安全围栏把特权方法锁定为 loopback-only，局域网 Host 头下特权方法被 403。
3. **能力缺口**：鸿蒙 Chromium 的 Web Crypto 可能缺失 `crypto.randomUUID`，影响依赖该 API 的渲染逻辑。

同时，宿主运行于主进程内，一次未捕获异常/未处理拒绝即可导致整个应用崩溃，需在早期建立崩溃兜底；退出时需优雅释放宿主插件树。

### 1.2 解决的问题

- 「选择工作区」一打开即报 `cannot list /storage/Users/currentUser: EPERM: operation not permitted`，导致无法选工作区、无法开会话。
- 设置对话框多处报 `transport failure for /api/settings.describe: HTTP 403`，通用/模型/插件等 tab 全部无法使用。
- 渲染进程 `crypto.randomUUID` 缺失时相关前端逻辑报错。
- 主进程发生未捕获异常或未处理拒绝时静默崩溃、无痕迹。
- 退出时若未释放宿主，遗留僵尸进程 / 端口占用。

### 1.3 范围

**包含**：沙箱 HOME 修正、loopback 信任围栏适配、代理豁免注入、渲染进程 polyfill、崩溃兜底记录、应用退出编排（`app.quit` / 宿主 `shutdown`）。

**不包含**：宿主启动细节（归 001-host）、窗口创建与加载细节（归 002-window）、产物解压引导（归 004-artifact-bootstrap）、agent preset 工具行禁用（运行时补丁，属宿主启动前准备，归 001-host）。系统 CA 证书合并在本模块**不存在**（与 desktop 参考实现不同，鸿蒙版主进程未实现该能力）。

## 2. 用户故事

- 作为用户，我在鸿蒙设备上打开应用后，「选择工作区」应能正常列出沙箱目录，而非报权限错误。
- 作为用户，我打开设置对话框时，通用/模型/插件/插件市场各 tab 应正常加载，而非报 403。
- 作为用户，当应用内部依赖 `crypto.randomUUID` 的渲染逻辑运行时，即使运行时缺失该 API，界面功能仍应正常。
- 作为用户，我使用系统代理时，应用对本地宿主的访问不应被代理劫持，界面与数据面通信应正常。
- 作为开发者，当应用发生崩溃时，我应能在日志（hilog，关键字 `dsh-harmony`）中看到异常记录，而非无痕迹静默退出。
- 作为用户，我关闭应用时，宿主应被优雅释放，不遗留僵尸进程。

## 3. 功能需求

### 3.1 沙箱 HOME 修正

- FR-003-001：系统 MUST 在宿主启动、任何 `homedir()` 调用发生之前，把 HOME 指向应用沙箱可写目录（`userData`），使 `os.homedir()` 返回沙箱内路径而非沙箱外系统用户目录。
- FR-003-002：系统 MUST 同步设置 Windows 风格探测键（`USERPROFILE`），以兼容不同平台下的主目录探测逻辑。
- FR-003-003：HOME 修正失败时系统 SHOULD 记录错误而非中断启动流程（try/catch 包裹）。

### 3.2 loopback 信任围栏适配

- FR-003-004：系统 MUST 在内嵌渲染进程的请求出栈前，将发往宿主 webserver 的请求的 `Host` 头改写为 `127.0.0.1:<port>`，使 dsh 的 loopback-only 特权方法围栏放行。
- FR-003-005：系统 MUST 在请求携带非空 `Origin` 头时，将其同步改写为 loopback 同源，以通过围栏的 Origin 比对。
- FR-003-006：该改写 MUST 仅作用于本应用内嵌渲染进程的会话；局域网内其他设备对宿主 webserver 的请求不受影响，特权方法对其依然 403，安全围栏语义不变。

### 3.3 代理豁免

- FR-003-007：系统 MUST 在宿主启动之前，将 loopback 地址（`127.0.0.1`、`localhost`、`::1`）并入代理豁免列表（`NO_PROXY`/`no_proxy` 大小写双键均处理），使本地宿主请求不被系统代理劫持。
- FR-003-008：系统 MUST 为渲染进程配置 loopback 直连（代理绕过），保证同源加载本地宿主不被代理拦截。

### 3.4 渲染进程 polyfill

- FR-003-009：系统 MUST 在渲染进程每次页面就绪时注入 `crypto.randomUUID` 兜底实现，以 `getRandomValues` 生成 UUID v4，弥补鸿蒙 Chromium 可能缺失该 API 的缺口。
- FR-003-010：兜底实现 SHOULD 在 `getRandomValues` 亦不可用时降级到基于 `Math.random` 的 UUID 生成，保证不抛错。

### 3.5 崩溃兜底

- FR-003-011：系统 MUST 捕获未处理异常并记录，防止进程静默崩溃。
- FR-003-012：系统 MUST 捕获未处理的 Promise 拒绝并记录，防止静默失败。
- FR-003-013：系统 MUST 以显式标记（来源前缀）区分不同来源的崩溃记录，便于排查。

### 3.6 应用生命周期编排

- FR-003-014：系统 MUST 在所有窗口关闭时退出应用（`app.quit`），不留无窗口残留进程。
- FR-003-015：系统 MUST 在退出前调用宿主 `shutdown`，优雅释放宿主插件树，不遗留僵尸进程/端口占用。
- FR-003-016：系统 SHOULD 在宿主 `shutdown` 完成后最终退出应用（异步完成后再次 `quit`）。

## 4. 关键实体

| 实体 | 描述 | 关键属性 |
|---|---|---|
| 沙箱 HOME 目录 | 应用沙箱内可写目录，作为 `HOME`/`USERPROFILE` 的指向 | `userData` 路径（真机 `/data/storage/el2/base/files`） |
| 代理豁免列表 | 需绕开系统代理的主机集合 | loopback 主机（`127.0.0.1`/`localhost`/`::1`），大小写双键，去重合并 |
| loopback 改写规则 | 内嵌渲染进程请求出栈时对 Host/Origin 的改写 | 目标端口匹配 + `Host`/`Origin` 改为 `127.0.0.1:<port>` |
| 特权方法围栏 | dsh 侧锁定 loopback-only 的敏感方法集合 | `settings.*`/`credentials.*`/`host.pickDirectory`/`host.openPath`/`agentPreset.*`/`llm.discoverModels` 等 |
| 渲染进程 polyfill | 注入主世界的 `crypto.randomUUID` 兜底 | 基于 `getRandomValues` 的 UUID v4 生成器 |
| 崩溃记录 | 未处理异常 / 未处理拒绝的日志 | 异常对象 / 拒绝原因，`[dsh-harmony]` 来源前缀 |

## 5. 验收场景

### 场景：沙箱 HOME 修正后「选择工作区」不再 EPERM

- Given 应用运行于鸿蒙沙箱，`os.homedir()` 默认解析到沙箱外系统用户目录
- When 应用启动，在宿主启动前完成 HOME 修正
- Then `os.homedir()` 返回沙箱可写目录；目录浏览器起始目录落在沙箱内，「选择工作区」正常列出目录，无 `EPERM` 报错

### 场景：内嵌渲染进程特权方法经 loopback 放行

- Given 宿主 webserver 绑全网卡，渲染进程走局域网 IP 建连
- When 渲染进程发起 `settings.describe` / `credentials.*` 等特权方法请求
- Then 请求出栈前 Host 头被改写为 `127.0.0.1:<port>`，围栏放行，返回 200

### 场景：局域网其他设备特权方法仍被拒绝

- Given 同一宿主 webserver 对局域网开放
- When 局域网内其他设备直接请求特权方法（Host 头为局域网 IP）
- Then 该请求不经内嵌渲染进程会话，特权方法返回 403，安全围栏语义不变

### 场景：渲染进程 crypto.randomUUID 缺失时兜底可用

- Given 鸿蒙 Chromium 的 Web Crypto 缺失 `crypto.randomUUID`
- When 页面就绪触发 polyfill 注入
- Then `crypto.randomUUID` 存在且能返回格式合法的 UUID v4

### 场景：系统代理环境下本地请求不被劫持

- Given 系统配置了代理，环境变量中已存在部分代理豁免主机
- When 应用启动完成代理豁免注入
- Then loopback 主机被追加进豁免列表且不重复；渲染进程对本地宿主直连、不走代理

### 场景：发生未处理异常 / 未处理拒绝

- Given 主进程内发生未捕获异常或未处理的 Promise 拒绝
- When 异常 / 拒绝发生
- Then 系统记录该异常 / 拒绝（带 `[dsh-harmony]` 来源标记），不静默吞掉错误

### 场景：关闭应用优雅退出

- Given 宿主已在主进程内运行
- When 用户关闭所有窗口并触发退出
- Then 宿主 `shutdown` 被调用释放插件树，随后应用退出，不遗留僵尸进程/端口占用

## 6. 非功能需求

- **健壮性**：HOME 修正、loopback 头改写安装、polyfill 注入等能力缺失/异常时降级（try/catch）不中断启动；代理豁免注入幂等、去重。
- **安全性**：loopback 改写仅作用于内嵌渲染进程会话，局域网其他设备特权方法仍 403；HOME 仅指向沙箱可写目录，不触碰沙箱外目录。
- **可维护性**：崩溃兜底记录方式可替换（当前为 `console` 输出 + `[dsh-harmony]` 前缀，经 hilog 收集）。
- **兼容性**：对底层运行时缺失的能力（如 `crypto.randomUUID`）保持运行时兜底。

## 7. 假设与约束

- **假设**：鸿蒙沙箱中 Node 的 `os.homedir()` 默认解析到沙箱外系统用户目录（`/storage/Users/currentUser`），且 POSIX 下 `homedir()` 优先读取 `HOME` 环境变量。
- **假设**：dsh `client-connection` 的特权方法围栏以「空信任列表 + Host 头比对」判定 loopback，故改写 Host 头即可放行。
- **假设**：内嵌渲染进程（与本机同机、由应用自己创建）可信，其请求出栈时的 Host/Origin 改写不会引入外部风险。
- **已知代价**：MVP 阶段宿主运行于主进程内，主进程异常即应用级崩溃；本模块仅「记录 + 防静默」，不尝试恢复或进程隔离。
- **约束**：HOME 必须在任何 `homedir()` 调用（宿主启动）之前设置，否则目录浏览器会先缓存错误的沙箱外路径。 [NEEDS CLARIFICATION]

## 8. 依赖

- **上游**：无（本模块为启动早期被调用的鸿蒙适配与生命周期准备，无上游模块输入）。
- **下游 / 消费者**：主进程启动编排（`app.whenReady` 顶层编排）在宿主就绪前后调用本模块的代理豁免、沙箱 HOME、头改写、polyfill 与退出编排；宿主启动（001-host）、窗口加载（002-window）依赖本模块先完成沙箱 HOME 修正与 loopback 头改写。
- **外部依赖**：dsh `client-connection` 的特权方法围栏（`PRIVILEGED_METHODS`）语义，本模块的 loopback 改写依赖并保持其不变。
