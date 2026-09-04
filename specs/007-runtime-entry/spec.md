# 运行时入口 功能规格

> Module: 007-runtime-entry（运行时入口）
> Status: Implemented
> Last Updated: 2026-09-04

## 1. Module Overview

### 1.1 Purpose — 为什么存在这个模块

本模块是鸿蒙 HAP 的**入口模块（`type: entry`）**，负责承载 Electron-on-鸿蒙 原生运行时（共享库 SO），并在应用被系统拉起时通过主入口 Ability 启动该运行时。它本身不实现任何桌面/桥接能力，而是声明一组 Ability / ExtensionAbility 作为运行时的「启动面」，把全部运行时行为委托给桥接层（`web_engine` HAR）提供的基类。

### 1.2 Problems Solved — 解决的问题

- **运行时如何被鸿蒙拉起**：Electron 运行时是一个原生共享库，不能直接被系统调度。本模块提供一个 `entry` 类型的 HAP 入口模块 + 主入口 Ability（`EntryAbility`），作为系统拉起运行时进程的锚点。
- **多窗口/多进程形态**：桌面应用需要主窗口、浏览器窗口、状态栏、内嵌 UI 等多种形态。本模块通过声明多个 Ability（主入口 / 浏览器 / 无状态）与 ExtensionAbility（状态栏 / 内嵌 UI）来承载这些形态，其中浏览器类 Ability 隔离到独立进程（`:browser`）。
- **运行时可执行路径的发现**：运行时二进制安装在固定路径，本模块通过 metadata（`electron_exec_path_ohos`）声明该路径，供启动链定位 Electron 可执行文件。
- **集成面与实现分离**：运行时能力（Web 组件、窗口、通知、剪贴板、权限等）全部在 `web_engine` 桥接层实现，本模块只做「薄壳」子类，避免入口模块膨胀、便于随上游运行时整体 copy 升级。

### 1.3 Scope — 范围

**包含**：

- HAP 入口模块声明（设备类型、主入口、页面配置、metadata）
- 主入口 Ability（`EntryAbility`）与运行时启动面
- 浏览器 / 无状态 Ability（独立 `:browser` 进程）
- 状态栏 / 内嵌 UI 扩展能力声明
- 应用舞台（AbilityStage）初始化委托
- 原生运行时共享库（SO）承载

**不包含**（由其它模块承担）：

- 桥接层 Web 组件、`*AdapterBind`、jsbindings 的具体实现（`web_engine` HAR，模块 008）
- Electron 主进程编排（`main.js`：解压 / runProfile / loadURL，模块 001-004）
- dsh Host 启动与 webserver（`main.js` / `host`）
- dsh 产物收集与构建编排（`scripts/`，模块 005）
- 每个 page 的内部实现细节（本模块以「集成面」级别记录，不逐一深挖）

## 2. User Stories

- 作为用户，当我点击桌面图标启动应用时，应用应启动 Electron 运行时并显示主窗口。
- 作为用户，当系统以 `viewData` 意图（如 `link://` scheme）拉起应用时，应用应能响应并进入对应的浏览器/主窗口形态。
- 作为用户，当应用需要展示常驻状态栏内容时，应能加载状态栏页面（`statusBarView`）。
- 作为用户，当应用需要内嵌浏览器形态时，应能承载嵌入式 UI（`embeddedUI`）。
- 作为开发者，我希望运行时入口只负责「HAP 入口 + 运行时启动」，桥接细节全部委托给 `web_engine`，以便随上游运行时整体 copy 升级。

## 3. Functional Requirements

### 3.1 HAP 入口

- FR-007-001：系统 MUST 提供一个 `type: entry` 的入口模块，作为整个 HAP 的唯一入口，并声明设备类型为 `["2in1", "tablet"]`。
- FR-007-002：系统 MUST 声明主入口元素（`mainElement`）指向 `EntryAbility`。

### 3.2 运行时启动

- FR-007-003：系统 MUST 通过主入口 Ability（`EntryAbility`）在应用被系统拉起时启动 Electron-on-鸿蒙 运行时。
- FR-007-004：系统 MUST 通过 metadata 声明 Electron 运行时可执行文件路径（`electron_exec_path_ohos`），供启动链定位运行时二进制。

### 3.3 Ability 形态

- FR-007-005：主入口（`EntryAbility`）MUST 声明 home 与 viewData 两类 skills，使其可被桌面图标（`action.system.home`）与 `link` scheme 的 `viewData` 意图拉起。
- FR-007-006：浏览器类 Ability（`BrowserAbility`）MUST 运行于独立进程（`:browser`），并通过内容页映射加载窗口承载页。
- FR-007-007：无状态 Ability（`StatelessAbility`）MUST 运行于独立进程（`:browser`），并在窗口创建阶段关闭窗口矩形自动保存（`setWindowRectAutoSave(false)`）。
- FR-007-008：每个 Ability MUST 在其生命周期回调（onCreate / onWindowStageCreate / onForeground / onBackground / onDestroy 等）中委托运行时基类（`super.*`），保证运行时窗口与渲染正确挂载。

### 3.4 扩展能力

- FR-007-009：状态栏扩展能力（`StatusBarEntryAbility`）MUST 以 `statusBarView` 类型声明，并在会话创建时加载状态栏页。
- FR-007-010：内嵌 UI 扩展能力（`BrowserEmbeddedAbility`）MUST 以 `embeddedUI` 类型声明，承载内嵌浏览器窗口。

### 3.5 应用舞台

- FR-007-011：应用舞台（`MyAbilityStage`）MUST 委托桥接层舞台基类完成舞台级初始化（`super.onCreate()`）。

### 3.6 模块依赖

- FR-007-012：入口模块 MUST 声明对桥接层（`web_engine` HAR）的依赖，Ability 基类与页面组件均来源于该 HAR。

## 4. Key Entities

| 实体 | 描述 | 关键属性 |
|---|---|---|
| EntryAbility | 主入口 Ability，启动运行时的锚点 | 继承 WebAbility；launchType=specified；exported=true；home + viewData skills |
| BrowserAbility | 浏览器形态 Ability | 继承 WebAbility；process=:browser；exported=false；内容页 pages/WindowNode |
| StatelessAbility | 无状态 Ability | 继承 WebAbility；process=:browser；exported=true；内容页 pages/Index |
| StatusBarEntryAbility | 状态栏扩展能力 | 继承 StatusBarViewExtensionAbility；type=statusBarView；加载 pages/StatusBarPage |
| BrowserEmbeddedAbility | 内嵌 UI 扩展能力 | 继承 WebEmbeddedAbility；type=embeddedUI；exported=false |
| MyAbilityStage | 应用舞台 | 继承 WebAbilityStage；onCreate 委托 super |
| 运行时 SO | Electron-on-鸿蒙 原生共享库 | 承载于 libs/arm64-v8a/，构建期 copy，不入库 |
| metadata | 运行时定位元数据 | electron_exec_path_ohos；client_id（空值） |

## 5. Acceptance Scenarios

### Scenario: 桌面图标启动

- Given 应用已安装且设备类型为 2in1 / tablet
- When 用户点击桌面图标（`action.system.home` 意图）
- Then 系统拉起 `EntryAbility`，进而启动 Electron 运行时并显示主窗口

### Scenario: viewData 意图拉起

- Given 应用已安装
- When 系统以 `ohos.want.action.viewData` + `link` scheme 意图拉起应用
- Then 应用能匹配主入口的 viewData skill 并进入对应窗口形态

### Scenario: 浏览器窗口独立进程

- Given 应用运行中，需要打开浏览器窗口
- When 系统拉起 `BrowserAbility`
- Then 浏览器窗口运行于独立 `:browser` 进程，加载 pages/WindowNode 承载页，与主入口进程隔离

### Scenario: 状态栏扩展加载

- Given 应用运行中，系统创建状态栏会话
- When `StatusBarEntryAbility.onSessionCreate` 被触发
- Then 状态栏页面（pages/StatusBarPage）被加载到会话中

### Scenario: 生命周期委托

- Given 应用运行中
- When Ability 收到 onForeground / onBackground / onDestroy 等生命周期回调
- Then 每个回调均委托运行时基类处理，窗口与渲染状态正确同步

## 6. Non-Functional Requirements

- **可靠性**：所有 Ability 生命周期回调委托基类，保证运行时窗口/渲染正确挂载与释放；浏览器类 Ability 与主入口进程隔离，单一 Ability 异常不影响主入口。
- **性能**：浏览器/无状态 Ability 隔离到独立 `:browser` 进程，避免渲染负载竞争主入口进程。
- **可维护性**：入口 Ability 均为「薄壳」子类，仅 `super.*` 委托 + `getContentPath()` 覆盖，随上游运行时整体 copy 升级无侵入。
- **可移植性**：限定设备类型 `["2in1", "tablet"]`，面向桌面形态设备。

## 7. Assumptions & Constraints

- 本模块整体 copy 自 `../harmonypc-electron`（Electron 37 / Node 22.17.0 运行时），属「集成面级别」记录——只记录入口与启动职责，不逐一深挖每个 page 的内部实现。
- 运行时实际启动链（加载 SO、执行 Electron 二进制）在 `WebAbility` / `WebAbilityStage` 基类（`web_engine` 模块）内部完成，本模块只负责声明与委托。
- `TaskManagerAbility.ets` 源码存在，但**未在 module.json5 的 abilities / extensionAbilities 中声明**，其是否被注册、用途如何 [NEEDS CLARIFICATION]。
- `client_id` metadata 值为空字符串，其填充时机与用途 [NEEDS CLARIFICATION]。
- `electron_exec_path_ohos` 有两个候选路径（生效值 `/data/app/electron.org/electron_1.0/bin/electron/electron`，注释备选 `/data/storage/el1/bundle/libs/arm64/electron`），最终由哪条路径定位运行时 [NEEDS CLARIFICATION]。

## 8. Dependencies

- **上游**：`web_engine` HAR（提供 `WebAbility` / `WebAbilityStage` / `WebEmbeddedAbility` / `WebWindow` / `WebNodeHandleWindow` 等基类与组件）；`../harmonypc-electron`（copy 源）。
- **下游**：鸿蒙系统（Ability 生命周期调度、home/viewData 意图分发、状态栏与内嵌 UI 会话）；Electron-on-鸿蒙 运行时（被启动方）。
- **外部**：原生共享库（`libs/arm64-v8a/*.so`，构建期由 `collect-runtime` copy）。
