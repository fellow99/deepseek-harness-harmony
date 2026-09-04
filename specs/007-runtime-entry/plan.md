# 007-runtime-entry 技术方案（As-Built）

> 本文档是对实际架构、设计决策与实现策略的回顾性技术方案。
> Module: 007-runtime-entry（运行时入口）
> Corresponding spec: [spec.md](./spec.md)
> Last Updated: 2026-09-04

## 1. Technical Context

### 1.1 Runtime Environment — 代码在哪里运行

- **模块类型**：HAP 入口模块（`electron/src/main/module.json5` → `"type": "entry"`），是根 `build-profile.json5` modules 列表中唯一的 entry。
- **设备类型**：`["2in1", "tablet"]`。
- **构建系统**：hvigor（Stage 模型，`electron/build-profile.json5` → `"apiType": "stageMode"`），release 构建开启代码混淆（`obfuscation-rules.txt`）。
- **模块系统**：ArkTS / ArkUI，源码位于 `electron/src/main/ets/`。
- **进程模型**：主入口进程（`EntryAbility`）+ 独立 `:browser` 进程（`BrowserAbility` / `StatelessAbility`）。
- **原生层**：`electron/libs/arm64-v8a/` 承载 Electron-on-鸿蒙 运行时共享库（构建期由 `collect-runtime.mjs` copy，gitignore 不入库）。

### 1.2 Dependencies — 依赖

| 依赖 | 版本 | 用途 |
|---|---|---|
| `web_engine`（HAR） | `file:../web_engine`（`oh-package.json5`） | 提供 `WebAbility` / `WebAbilityStage` / `WebEmbeddedAbility` / `WebWindow` / `WebNodeHandleWindow` 等基类与组件 |
| `@ohos.app.ability.*` | HarmonyOS SDK | `Want` / `AbilityConstant` / `Configuration` 等 Ability 生命周期类型 |
| `@ohos.window` | HarmonyOS SDK | `window.WindowStage`（窗口阶段） |
| `@kit.BasicServicesKit` | HarmonyOS SDK | `deviceInfo.sdkApiVersion`（StatelessAbility 用） |
| `@kit.StatusBarExtensionKit` | HarmonyOS SDK | `StatusBarViewExtensionAbility` 基类 |
| `@kit.AbilityKit` | HarmonyOS SDK | `UIExtensionContentSession`（扩展能力会话） |
| `@kit.ArkWeb` | HarmonyOS SDK | `webview.WebviewController`（WebPage.ets 用） |
| `@kit.PerformanceAnalysisKit` | HarmonyOS SDK | `hilog`（日志） |
| `@kit.InputKit` | HarmonyOS SDK | `KeyCode`（ESC 键拦截） |
| `@kit.ArkUI` | HarmonyOS SDK | `router` / `uiObserver` |
| 原生 SO | — | `libs/arm64-v8a/*.so`（Electron 37 运行时） |

## 2. Constitution Compliance

| 原则 | 状态 | 说明 |
|---|---|---|
| 零上游改动 | ✅ | 本模块即 copy 自 `../harmonypc-electron` 的运行时入口，逐字 copy，无自研改动 |
| 进程内 Host（MVP） | ✅ | `EntryAbility` 启动运行时，dsh Host 跑在 Electron 主进程内（Host 逻辑在 `main.js`，非本模块） |
| 只写装配代码 | ✅ | 所有 Ability 为「薄壳」子类，仅 `super.*` 委托 + `getContentPath()` 覆盖 |
| 同源数据面 | N/A | 本模块不涉及数据面（loadURL / webserver 在 `main.js` + `web_engine`） |
| sibling 源码引用 + copy | ✅ | 构建期 copy（`collect-runtime.mjs`），非 submodule（实现 FR-007-001 的「承载运行时」） |
| 类型安全 | ⚠️ 局部 | ArkTS strict；但 `StatelessAbility.ets` 存在 `import { WebAbility } from 'web_engine';;`（双分号）笔误，不影响编译 |
| 日志规范 | ⚠️ 局部 | `StatusBarEntryAbility.ets` 用 `hilog` + `TAG='StatusBarEntryAbility'`；`[dsh-harmony]` 前缀属 `main.js` 职责，本模块不覆盖 |
| 二进制不提交 | ✅ | SO 加 `.gitignore`，构建期 copy |

## 3. Research Findings

- **薄壳继承模式**：`EntryAbility` / `BrowserAbility` / `StatelessAbility` / `TaskManagerAbility` 均 `extends WebAbility`（来自 `web_engine`），`BrowserEmbeddedAbility` `extends WebEmbeddedAbility`，`StatusBarEntryAbility` `extends StatusBarViewExtensionAbility`（`@kit.StatusBarExtensionKit`）。全部运行时能力下沉到基类，本模块仅「声明入口 + 委托」。这是 copy 自上游运行时的既定架构，非本工程自研选择。
- **内容页映射（`getContentPath`）**：`BrowserAbility` 覆盖 `getContentPath(): string { return 'pages/WindowNode' }`，`StatelessAbility` 覆盖返回 `'pages/Index'`。主入口 `EntryAbility` 未覆盖 `getContentPath`（沿用基类默认，加载默认窗口页）。`getContentPath` 决定 Ability 挂载的 ArkUI 页面，进而决定用哪个 Web 承载组件（`WebWindow` vs `WebNodeHandleWindow`）。
- **进程隔离（`:browser`）**：`module.json5` 中 `BrowserAbility` 与 `StatelessAbility` 声明 `"process": ':browser'`，与主入口进程隔离；`EntryAbility` 未声明 process（默认主进程）。这一进程模型来自上游运行时（Electron 浏览器子进程）。
- **运行时定位（metadata）**：`electron_exec_path_ohos` 声明运行时二进制路径 `/data/app/electron.org/electron_1.0/bin/electron/electron`；`client_id` 为空字符串。metadata 供运行时启动链（基类内）读取，本模块仅声明。
- **StatelessAbility 窗口矩形处理**：`onWindowStageCreate` 内 `if (deviceInfo.sdkApiVersion >= 14) windowStage.setWindowRectAutoSave(false)` —— 仅在 API 14+ 关闭窗口矩形自动保存（避免无状态窗口被系统自动持久化位置）。
- **状态栏 / 内嵌 UI 为 ExtensionAbility**：`StatusBarEntryAbility`（`statusBarView`）与 `BrowserEmbeddedAbility`（`embeddedUI`）声明在 `extensionAbilities`（而非 `abilities`）数组内，生命周期由系统会话驱动（`UIExtensionContentSession`）。

## 4. Data Model

模块级声明（`module.json5`）：

| 项 | 值 | 说明 |
|---|---|---|
| `module.name` / `type` | `electron` / `entry` | 入口模块 |
| `srcEntry` | `./ets/Application/AbilityStage.ets` | 应用舞台入口 |
| `mainElement` | `EntryAbility` | 主入口 |
| `deviceTypes` | `["2in1", "tablet"]` | 设备类型 |
| `deliveryWithInstall` | `true` | 随安装交付 |
| `installationFree` | `false` | 非免安装 |
| `metadata` | `client_id`="" / `electron_exec_path_ohos`="/data/app/electron.org/electron_1.0/bin/electron/electron" | 运行时定位 |

Ability 声明表：

| Ability | srcEntry | process | launchType | exported | skills |
|---|---|---|---|---|---|
| EntryAbility | `./ets/entryability/EntryAbility.ets` | 主进程（默认） | specified | true | home + viewData；viewData(link) |
| BrowserAbility | `./ets/entryability/BrowserAbility.ets` | `:browser` | 默认 | false | viewData |
| StatelessAbility | `./ets/entryability/StatelessAbility.ets` | `:browser` | specified | true | — |

ExtensionAbility 声明表：

| 名称 | srcEntry | type | exported |
|---|---|---|---|
| StatusBarEntryAbility | `./ets/entryability/StatusBarEntryAbility.ets` | statusBarView | false |
| BrowserEmbeddedAbility | `./ets/extensionAbility/BrowserEmbeddedAbility.ets` | embeddedUI | false |

## 5. Interface Contracts

### 5.1 Provided Interfaces — 本模块对外提供

- HAP 入口：作为 `type: entry` 模块被系统调度，提供 `EntryAbility`（`mainElement`）作为拉起锚点（实现 FR-007-001/002/003）。
- 应用舞台：`MyAbilityStage`（默认导出）作为 `srcEntry`，供系统创建舞台。
- metadata：`electron_exec_path_ohos` 供运行时启动链读取（实现 FR-007-004）。

### 5.2 Consumed Interfaces — 本模块消费

| 接口 | 来源 | 说明 |
|---|---|---|
| `WebAbility` | `web_engine` | Ability 基类（`onCreate` / `onWindowStageCreate` / `onForeground` / `onBackground` / `onDestroy` / `onConfigurationUpdate` / `getContentPath`） |
| `WebAbilityStage` | `web_engine` | 舞台基类（`onCreate`） |
| `WebEmbeddedAbility` | `web_engine` | 内嵌 UI 基类（`onSessionCreate` / `onSessionDestroy`） |
| `StatusBarViewExtensionAbility` | `@kit.StatusBarExtensionKit` | 状态栏扩展基类 |
| `WebWindow` | `web_engine` | Index.ets 的窗口承载组件 |
| `WebNodeHandleWindow` | `web_engine` | NodeHandleWindow.ets 的窗口承载组件 |
| `webview.WebviewController` | `@kit.ArkWeb` | WebPage.ets 的原生 WebView（华为账号协议页） |
| `LogUtil` | `web_engine/src/main/ets/utils/LogUtil` | NodeHandleWindow.ets 的日志工具 |

### 5.3 Event Protocols — 生命周期事件

| 回调 | 来源 | 处理 |
|---|---|---|
| `onCreate` | 系统 Ability 生命周期 | 委托 `super.onCreate(want, launchParam)`（FR-007-008） |
| `onWindowStageCreate` | 系统窗口阶段 | 委托 `super.onWindowStageCreate(windowStage)`；StatelessAbility 额外 `setWindowRectAutoSave(false)` |
| `onForeground` / `onBackground` | 系统前后台切换 | 委托 `super.*` |
| `onDestroy` / `onWindowStageDestroy` | 系统销毁 | 委托 `super.*` |
| `onSessionCreate` / `onSessionDestroy` | 扩展能力会话 | 委托 `super.*`；StatusBarEntryAbility 额外 `session.loadContent('pages/StatusBarPage')` |

## 6. Implementation Strategy

### 6.1 Architecture Pattern — 实际采用模式

**薄壳继承 + 委托（thin-subclass delegation）**：每个 Ability / ExtensionAbility 是运行时基类的空子类，仅覆盖 `getContentPath()` 与个别 `onWindowStageCreate` / `onSessionCreate` 钩子，其余全部 `super.*` 委托。入口模块自身零业务逻辑。

### 6.2 Key Algorithms — 关键逻辑

- **内容页映射**：`getContentPath()` 返回 ArkUI 页面路径，运行时基类据此加载对应 Web 承载页。`BrowserAbility → 'pages/WindowNode'`、`StatelessAbility → 'pages/Index'`、`EntryAbility` 沿用基类默认。
- **窗口矩形自动保存禁用**：`StatelessAbility.onWindowStageCreate` 中 `deviceInfo.sdkApiVersion >= 14` 时 `windowStage.setWindowRectAutoSave(false)`，防止无状态窗口位置被系统自动持久化。
- **状态栏会话加载**：`StatusBarEntryAbility.onSessionCreate` 中 `session.loadContent('pages/StatusBarPage')`，把状态栏页挂载到 `UIExtensionContentSession`。
- **ESC 键拦截**：`Index.ets` / `NodeHandleWindow.ets` 的 `onKeyEvent` 中拦截 `KeyCode.KEYCODE_ESCAPE` 并 `event.stopPropagation()`，阻止 ESC 冒泡触发默认关闭行为。

### 6.3 Error Handling — 错误传播

- 本模块无显式 try/catch（纯委托）。生命周期错误由基类与运行时处理。
- 日志：`StatusBarEntryAbility` 各回调写 `hilog.info`；`WebPage.ets` 用 `hilog` 记录加载进度与错误（`onErrorReceive`）。
- 进程级崩溃兜底（`uncaughtException` 等）在 `main.js`（模块 003 生命周期）注册，非本模块职责。

### 6.4 Performance — 性能

- 进程隔离：浏览器/无状态 Ability 运行于 `:browser` 进程，渲染负载不竞争主入口进程（实现 FR-007-006/007）。
- release 构建开启混淆（`obfuscation-rules.txt`），减小包体与代码可读性开销。
- SO 不入库（gitignore），构建期 copy，保持仓库轻量。

## 7. Testing Considerations

- **可测试性**：Ability 为薄壳子类，适合以「声明正确性 + 委托完整性」为单位做验证；`ohosTest/`（Ability.test.ets）与 `test/`（LocalUnit.test.ets）目录已存在（copy 自运行时）。
- **建议测试类别**：
  - 声明正确性：module.json5 中 5 个 Ability/ExtensionAbility 的 srcEntry 路径与对应 `.ets` 文件一一对应；`mainElement=EntryAbility`；deviceTypes 含 `2in1`/`tablet`。
  - 内容页映射：`BrowserAbility.getContentPath()==='pages/WindowNode'`、`StatelessAbility.getContentPath()==='pages/Index'`。
  - 委托完整性：各 Ability 生命周期回调均调用 `super.*`（无遗漏导致运行时状态不同步）。
  - 进程隔离：`BrowserAbility`/`StatelessAbility` 的 `process` 为 `:browser`。
- **边界场景**：`StatelessAbility` 在 API < 14 设备上不应调用 `setWindowRectAutoSave`（`deviceInfo.sdkApiVersion >= 14` 分支）；`TaskManagerAbility` 未声明时不应被系统拉起。

## 8. File Inventory

| 文件 | 用途 | 行数 |
|---|---|---|
| `electron/src/main/module.json5` | HAP 入口声明：EntryAbility/BrowserAbility/StatelessAbility + StatusBarEntryAbility/BrowserEmbeddedAbility + metadata + deviceTypes | 122 |
| `electron/build-profile.json5` | 模块构建配置（stageMode + release 混淆） | 30 |
| `electron/oh-package.json5` | 模块包清单（依赖 web_engine） | 12 |
| `electron/src/main/ets/Application/AbilityStage.ets` | 应用舞台 MyAbilityStage，委托 WebAbilityStage | 11 |
| `electron/src/main/ets/entryability/EntryAbility.ets` | 主入口，启动运行时 | 40 |
| `electron/src/main/ets/entryability/BrowserAbility.ets` | 浏览器形态，`:browser` 进程，getContentPath→pages/WindowNode | 44 |
| `electron/src/main/ets/entryability/StatelessAbility.ets` | 无状态，`:browser` 进程，getContentPath→pages/Index，关闭窗口矩形自动保存 | 49 |
| `electron/src/main/ets/entryability/StatusBarEntryAbility.ets` | 状态栏扩展，statusBarView，loadContent pages/StatusBarPage | 35 |
| `electron/src/main/ets/entryability/TaskManagerAbility.ets` | 任务管理 Ability（源码存在，未在 module.json5 声明） | 45 |
| `electron/src/main/ets/extensionAbility/BrowserEmbeddedAbility.ets` | 内嵌 UI 扩展，embeddedUI，委托 WebEmbeddedAbility | 33 |
| `electron/src/main/ets/pages/Index.ets` | 主窗口页，WebWindow + ESC 拦截 | 66 |
| `electron/src/main/ets/pages/NodeHandleWindow.ets` | 节点句柄窗口页，WebNodeHandleWindow + 状态栏避让 + ESC 拦截 | 108 |
| `electron/src/main/ets/pages/WebPage.ets` | 华为账号用户认证协议展示页（ArkWeb webview） | 91 |
| `electron/src/main/ets/pages/` 其它 | WindowNode.ets / SubWindow.ets / StatusBarPage.ets / QuickLoginButtonComponent.ets / NodeHandleSubWindow.ets / Login.ets / EmbeddedWindow.ets | —（集成面级别未逐一读取） |
| `electron/src/main/ets/process/CustomChildProcess.ets` | 自定义子进程（被 Index/NodeHandleWindow 引用以触发编译） | —（未逐一读取） |
| `electron/libs/arm64-v8a/` | 原生运行时 SO（libelectron.so / libadapter.so / libffmpeg.so / libc++_shared.so，构建期 copy，gitignore） | — |

> 注：SO 数量以 STRUCTURE.md（4 个：libelectron.so ~172.7MB / libadapter.so / libffmpeg.so / libc++_shared.so，其中 libc++_shared.so 由 collect-runtime 从 DevEco SDK 注入）为准；docs/工程规划.md §6 早期规划列 5 个（含 libextractor.so），§18.1 最终落地为 harmonypc-electron 的 3 个 SO + 注入 libc++_shared.so。
