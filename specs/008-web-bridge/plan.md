# 008-web-bridge 技术方案（As-Built）

> 本文档为回溯式技术方案，记录 Web 桥接层的**实际**架构、设计决策与实现策略。
> Module: 008-web-bridge
> 对应规格: [spec.md](./spec.md)
> Last Updated: 2026-09-04

## 1. 技术上下文

### 1.1 运行时环境

- 模块类型：HAR（`web_engine/src/main/module.json5` 中 `"type": "har"`），copy 自 `../harmonypc-electron`（Electron 37 / Node 22.17.0）。
- 运行于鸿蒙 ArkTS 层，与 `electron`（entry）模块共同构成 HAP；`web_engine` 的 ArkUI 组件承载 BrowserWindow 渲染，Adapter/Binding 桥接系统能力。
- 设备类型：`["tablet", "2in1"]`（module.json5 `deviceTypes`）。
- 语言：ArkTS（strict mode），依赖注入用 inversify。

### 1.2 依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| `inversify` | ^6.0.1 | ArkTS 侧依赖注入（Adapter 注册与注入） |
| `reflect-metadata` | ^0.1.13 | 装饰器元数据（inversify 依赖） |
| `libadapter.so` | file:./src/main/cpp/types/libadapter | 原生桥接模块（dev，TS 类型声明；运行时 SO 由 electron 模块提供） |

> 桥接三件套（运行时已编译好，本模块不参与原生编译，见 docs/工程规划.md §10）：`aki`（libaki_jsbind.so，JS 绑定框架）+ `adapter`（libadaptertest.so，注册原生方法）+ `addon`（electron-addon.node 链 libshim.a，Node 侧 `require()` 入口）。

## 2. 宪法合规检查

| 原则 | 状态 | 说明 |
|------|------|------|
| 零上游改动 / 界面 100% 复用 dsh Web UI | ✅ | 本模块仅承载渲染，不自绘业务 UI |
| 同源数据面 | ✅ | 渲染进程由主进程 loadURL 同源加载，本模块只承载渲染输出 |
| 只写装配代码 | ✅ | 系统能力实现与注册入口直接复用运行时，本工程只接线（通知/剪贴板/权限） |
| sibling 源码引用 + 构建期 copy | ✅ | 本模块整体 copy 自 harmonypc-electron（collect-runtime.mjs ①） |
| 二进制不提交 | ✅ | SO 在 `electron/libs/arm64-v8a/`，构建期 copy；resfile 大产物 gitignore |
| 源码即真理 | ✅ | 符号/文件均可追溯 |
| 类型安全（ArkTS strict） | ✅ | 无 `as any`、无 `@ts-ignore`；lazy import + type-only import |
| 日志规范 | ✅ | 各文件定义 `TAG` + `LogUtil.info/error/warn` |
| 生命周期/优雅关闭 | ✅ | `onWindowStageDestroy` 释放资源、`onPrepareTerminationAsync` 退出协商 |

> 合规结论：全部 ✅，无 ⚠️ / ❌。本模块是「集成面级别」桥接 HAR，本身即运行时产物，宪法原则主要作用于主进程侧（001/002/003），本模块以「复用 + 接线」满足「只写装配代码」。

## 3. 研究结论

### 3.1 关键决策与理由

| 决策 | 理由 |
|------|------|
| HAR（非 entry）+ 权限集中在模块清单 | 桥接层作为库被入口模块引用，权限随 HAR 声明（module.json5 约 28 项，FR-008-019） |
| ArkUI XComponent（`type: SURFACE`，`libraryname: "adapter"`）+ NodeContainer 承载渲染 | 渲染输出落地到鸿蒙 UI 树，`XComponent.initialize` 挂接原生 adapter（FR-008-005） |
| `JsBindingMethod.bind()` 集中注册 40 组 AdapterBind | 单一入口批量注册，宿主持 `require('electron-addon.node')` 调方法（FR-008-001/002/003） |
| inversify DI（`@injectable()`/`@inject` + `Inject.get/getOrCreate`） | Adapter 解耦，Bind 层懒加载单例（FR-008-002） |
| `BaseAdapter` 基类 + `init()`/`unInit()` 生命周期 | 统一 Adapter 初始化/反初始化契约 |
| `NativeContext.ExecuteCommand` + `On*` 回调 | ArkTS 与原生运行时双向通信：下行命令（kNewWindow/kOpenURL/kGetWidget/kTrayQuitRequest/kAppQuit）+ 上行回调（窗口事件/通知点击等） |
| `onPrepareTerminationAsync` 托盘退出协商 | Electron 37（138）无 app-close 握手，退化用「kTrayQuitRequest 轮询 + kAppQuit + 立即终止」（FR-008-015） |
| `onWindowStageRestore` 委派 `onWindowStageCreate` | 跨设备接续启动不经 onWindowStageCreate，缺此委派窗口会挂起（FR-008-016） |
| SDK 版本分支（`deviceInfo.sdkApiVersion >= 15/20/21/22`） | 新能力（指针事件转移/触摸转移/阴影/窗口图标/内容比例）按 API 降级（FR-008-014） |

### 3.2 桥接注册流程（WebAbilityStage.onCreate → runTaskAsync）

```
WebAbilityStage.onCreate()
  → runTaskAsync()  setTimeout(0) 异步执行
      → JsBindingUtils.initNativeContext(kMainProcess)   // adapter.getNativeContext
      → CommonDependencyProvider + GlobalThisHelper.appInit
      → import('../jsbindings/JsBindingMethod') → JsBindingMethod.bind()   // 40 组 AdapterBind
      → Inject.get(NativeThemeAdapter)
      → JsBindingUtils.SetContextPaths()                 // cacheDir/filesDir/tempDir/文档/桌面/下载
```

`JsBindingUtils.bindFunction(name, func)` 底层走 `currentContext.JSBind.bindFunction(name, func)`（`adapter.getNativeContext` 返回的 `NativeContext`，FR-008-001/004）。

### 3.3 窗口承载（WebWindow 组件）

```
WebWindow(@Component struct)
  → NodeContainer(WindowNodeController)
      → makeNode: FrameNode + TypedNode.XComponent(type:SURFACE, libraryname:"adapter")
          → .onLoad: setDefaultBounds → nativeContext.runBrowser(vec_args)
                      → ExecuteCommand(kNewWindow, {url, is_sync:true})   // 加载 startUri
  → .gesture: PanGesture / PinchGesture → MultiInputAdapter.OnPan/OnPinchEvent
  → .onDragEnter/onDragMove/onDragLeave/onDrop → DragDropAdapter.drag*/dropData
```

（FR-008-005/006/009；`getContentPath()` 据 `IsSupportNodeHandleFeature()` 在 `pages/NodeHandleWindow` 与 `pages/Index` 间选择。）

### 3.4 系统能力桥接（代表实现）

| 能力 | Adapter（适配实现） | AdapterBind（注册入口） | 代表性方法 |
|------|---------------------|------------------------|-----------|
| 通知 | NotificationAdapter | NotificationAdapterBind | sendNotification / closeNotification / requestNotificationPermission（FR-008-010） |
| 剪贴板 | PasteBoardAdapter | PasteBoardAdapterBind | setPasteData / readPasteBoardText / writeImage / readImageInfo（FR-008-011） |
| 权限 | PermissionManagerAdapter | PermissionManagerAdapterBind | requestPermissions / checkPermissions / fileAccessPersist / openPermissionConfirm（FR-008-012） |
| 窗口 | AppWindowAdapter | AppWindowAdapterBind | createWindow / maximize / setBounds / setTitle / showHuaweiQuickLogin（FR-008-013） |

- 通知：`notificationManager.publish/cancel/getActiveNotifications` + `wantAgent.getWantAgent`（`SEND_COMMON_EVENT`）+ `commonEventManager` 订阅 `chrome.notification.click/close/button.click` → 回传 `nativeContext.OnNotificationClickCallback` 等。
- 剪贴板：`pasteboard.getSystemPasteboard()` 读写 `PasteDataRecord`（text/html/pixelMap/uri + `chromium/x-bookmark-entries` 自定义格式）。
- 权限：`needPermissions: Map<type, Permissions[]>` 预置 11 类权限映射；`abilityAccessCtrl.AtManager.requestPermissionsFromUser/checkAccessTokenSync`；`fileShare.activatePermission/persistPermission` 持久化目录访问；`openPermissionConfirm` 弹确认框后跳设置页。
- 窗口：`abilityManager.getProxy(id)` 获取窗口代理（WebBaseAbility 实现 WebProxy）→ 调 `window.Window` API；`LaunchHelper.LaunchWithOptions` 以 `StartOptions`（位置/尺寸/启动图标/隐藏）拉起 Ability。

## 4. 数据模型

### 4.1 核心接口与类型（interface/CommonInterface）

| 符号 | 说明 |
|------|------|
| `NativeContext` | 原生上下文接口：`JSBind.bindFunction`、`ExecuteCommand(CommandType, params)`、`runBrowser(args)`、`On*` 窗口回调、`GetTrayExitResponse`、`IsSupportNodeHandleFeature` |
| `CommandType` | 命令枚举（`kNewWindow`/`kOpenURL`/`kGetWidget`/`kTrayQuitRequest`/`kAppQuit` 等，common/Constants） |
| `ContextType` | 上下文类型（`kMainProcess` 等） |
| `WindowPreferences` | 窗口偏好：`hideTitleBar`/`maximizable`/`minimizable`/`closable` |
| `WindowBound` / `WinLimits` | 窗口边界 / 尺寸上下限 |
| `NotificationAdapterRequest` | 通知请求（id/title/message/icon/buttons/silent/requireInteraction/timestamp） |
| `OhosPasteDataRecord` | 剪贴板记录（mime_type/plain_text/html_text） |
| `WebProxy` | 窗口代理接口（getWindowStage/getWindow/getWindowId/closeWindow/setWindowTitle/setWindowPreferences 等） |
| `ILoginInfo` / `ILogin` | 快速登录信息与回调（Index.ets 导出） |

### 4.2 状态机（窗口生命周期）

```
onCreate(want) → initParameters（xcomponentId/启动地址/窗口偏好/cmdArgs）
  → xcomponentId 为空 ? ExecuteCommand(kGetWidget).widget_Id → WINDOW_PREFIX+widgetId
  → onWindowStageCreate → getMainWindow → 注册 windowStatusChange/windowSizeChange/windowRectChange/windowEvent/visibilityChange/...
      → loadContent(getContentPath()) → 视图 onLoad → runBrowser → kNewWindow(startUri)
  → onWindowStageDestroy → ClearWindowEventFilter + removeProxy + delActiveBrowserId
```

### 4.3 校验规则（从代码提取）

- 权限申请前校验 `needPermissions.get(type)` 存在，否则 `REQUEST_PERMISSION_FAIL`（-2）。
- 通知图标超限缩放：`getPixelBytesNumber() > 30720` 时按 `sqrt(30720/bytes)` 比例缩放。
- 窗口按钮可见性：`!hideTitleBar` 时才由 `setWindowTitleButtonVisible` 控制；`hideTitleBar` 时标题按钮 rect 归零。
- tablet 设备：`setWindowLayoutFullScreen(true)` + 隐藏 status bar + `window_pcmode_switch_status` 观察者。
- `onAcceptWant` 按 `instanceKey` → 最近活跃窗口 → `GetLastActiveWidgetId` → 默认窗口 ID 路由实例。

## 5. 接口契约

### 5.1 提供接口（HAR 导出，Index.ets）

| 导出符号 | 说明 |
|----------|------|
| `WebAbilityStage` | Ability 阶段入口（application/WebAbilityStage） |
| `WebAbility` | 主窗口 UIAbility（ability/WebAbility） |
| `WebEmbeddedAbility` | 嵌入式窗口 Ability（UIExtensionContentSession） |
| `WebWindow` / `WebSubWindow` / `WebEmbeddedWindow` | 窗口组件 |
| `WebWindowNode` / `WebNodeHandleWindow` / `WebNodeHandleSubWindow` | 节点句柄窗口组件 |
| `ILoginInfo` / `ILogin` | 快速登录接口（interface/CommonInterface） |

### 5.2 消费接口（本模块 import）

| 来源 | 符号 |
|------|------|
| `libadapter.so` | `adapter.getNativeContext` / `adapter.SetContextPaths` / `adapter.JSBind.bindFunction` |
| `@ohos.window` / `@ohos.app.ability.*` / `@ohos.notificationManager` / `@ohos.pasteboard` / `@ohos.abilityAccessCtrl` 等 | 鸿蒙系统 API |
| `inversify` | `injectable` / `inject` |
| `@kit.AbilityKit` / `@kit.BasicServicesKit` / `@kit.ArkUI` / `@kit.ShareKit` / `@kit.CoreFileKit` / `@kit.ImageKit` | Kit 聚合 API |

### 5.3 事件/回调协议

| 方向 | 机制 | 示例 |
|------|------|------|
| ArkTS → 原生（命令） | `NativeContext.ExecuteCommand(CommandType, params)` | `kNewWindow`/`kOpenURL`/`kGetWidget`/`kTrayQuitRequest`/`kAppQuit` |
| ArkTS → 原生（窗口回调） | `NativeContext.On*` | `OnWindowStatusChange`/`OnWindowSizeChange`/`OnWindowRectChange`/`OnWindowEvent`/`OnWindowVisibilityChange`/`OnKeyboardHeightChange`/`OnWindowDisplayIdChange`/`OnCaptionButtonRectChange` |
| 原生 → ArkTS（方法调用） | `JSBind.bindFunction(name, func)` 注册 | 40 组 AdapterBind 的方法名 |
| 系统事件 → 宿主 | `commonEventManager` 订阅 + `nativeContext.On*Callback` | 通知 click/close/button.click |
| 跨设备接续 | `onContinue`/`onWindowStageRestore`/`onNewWant` | ContinueAbility 委派 |
| 系统分享 | `systemShare.getSharedData` → `OnSharedDataReceived` | handleSharedData |

## 6. 实现策略

### 6.1 架构模式

- **依赖注入（inversify）**：Adapter 用 `@injectable()` 声明、`@inject()` 注入协作对象，`Inject.get/getOrCreate` 获取单例。
- **适配器 + 注册入口成对**：`adapter/`（实现系统能力）+ `jsbindings/`（薄注册壳，`JsBindingUtils.bindFunction` 暴露方法名）一一对应。
- **基类复用**：`BaseAdapter`（原生上下文 + init/unInit）、`WebBaseAbility`（WebProxy + 参数初始化 + 接续/分享）。
- **单例管理**：`AbilityManager`（窗口代理注册表）、`GlobalThisHelper`（活跃浏览器 ID、appInit）。

### 6.2 关键算法

- `onAcceptWant` 实例路由：`instanceKey` → `GlobalThisHelper.getLastActiveBrowserId` → `GetLastActiveWidgetId` → `DEFAULT_WINDOW_ID`（WebAbilityStage.ets:32-50）。
- 窗口边界换算：`windowRect + drawableRect` 偏移 → 传给原生的 `WindowBound`（WebAbility 多处）。
- 通知图标缩放：`Math.floor(Math.sqrt(ratio) * 100) / 100` 保留两位小数。
- `onPrepareTerminationAsync` 轮询：`MAXIMUM_NUM_OF_SLEEP_CYCLES=250` × `SLEEP_INTERVAL_MS=10`（约 2.5s）内轮询 `GetTrayExitResponse`，`kPrevented`/`kUndetermined` → `CANCEL`，`kAllowed` → `kAppQuit` + 立即终止。

### 6.3 错误处理

- 全部系统 API 调用包裹 `try/catch`，失败记 `LogUtil.error(TAG, ...)` 并返回默认值/失败码，不抛出。
- 回调式能力统一 `callback` 返回结果（成功数据或空/失败标志）。
- 窗口事件注册逐个 `try/catch`，单点失败不影响其他监听。

### 6.4 性能

- `lazy import`（`import lazy { ... }`）+ `type-only import` 减少启动期加载。
- `JsBindingMethod` 动态 `import()` 异步加载，不阻塞 Ability 阶段启动。
- 通知队列串行发布（`NOTIFICATION_LIST` + while 循环），避免并发发布竞态。
- Adapter 单例复用（`Inject.getOrCreate`），避免重复初始化。

## 7. 测试考虑

- **集成**：宿主侧 `require('electron-addon.node')` 后能调到 40 组已注册方法名。
- **能力桥接**：通知发送/点击回传、剪贴板读写文本/图片、权限申请/检查/持久化。
- **窗口承载**：XComponent onLoad → runBrowser → 渲染显示；窗口尺寸/位置/状态事件回传。
- **生命周期**：托盘退出协商（阻止/允许/超时）、跨设备接续恢复、系统分享接收。
- **版本降级**：`sdkApiVersion` 分支（<15/15/20/21/22）在对应设备上不抛错。
- `[NEEDS CLARIFICATION]`：约 46 个 Adapter 中仅有代表（通知/剪贴板/权限/窗口）被深读，其余以「集成面级别」处理——文件清单列全、行为按命名推断，具体方法签名未逐一核对。
- `[NEEDS CLARIFICATION]`：`JsBindingMethod.bind()` 注册 40 组，而 `jsbindings/` 目录含 44 个 `*AdapterBind.ets`——存在若干 Bind 文件（如 `DeviceInfoAdapterBind`、`MultiInputAdapterBind`）未纳入 `JsBindingMethod` 集中注册，其是否以其它路径注册未深挖。
- `[NEEDS CLARIFICATION]`：`resfile/resources/app/main.js` 为构建期产物（copy 自 src-main），本模块仅承载，其内容随 collect-dsh 变化，不作为本模块静态职责。

## 8. 文件清单

### 8.1 核心文件

| 文件 | 用途 | 行数 |
|------|------|------|
| `web_engine/Index.ets` | HAR 导出入口（WebAbilityStage/WebAbility/WebWindow 等 11 个导出） | 11 |
| `web_engine/src/main/module.json5` | HAR 声明 + 约 28 项权限 + definePermissions（kernel.ALLOW_WRITABLE_CODE_MEMORY） | 179 |
| `web_engine/oh-package.json5` | 包清单：inversify + reflect-metadata + libadapter.so（dev） | 15 |
| `src/main/ets/application/WebAbilityStage.ets` | Ability 阶段：runTaskAsync 注册桥接、onAcceptWant 路由、onPrepareTerminationAsync 退出协商 | 121 |
| `src/main/ets/ability/WebAbility.ets` | 主窗口 UIAbility：窗口事件注册、loadContent、pad 适配 | 486 |
| `src/main/ets/ability/WebBaseAbility.ets` | 基类：WebProxy 实现、initParameters、接续/分享 | 292 |
| `src/main/ets/ability/WebEmbeddedAbility.ets` | 嵌入式窗口 Ability（UIExtensionContentSession） | 103 |
| `src/main/ets/components/WebWindow.ets` | 窗口组件：NodeContainer + XComponent(SURFACE/adapter) + 手势/拖拽 | 244 |
| `src/main/ets/jsbindings/JsBindingMethod.ets` | 集中注册 40 组 AdapterBind | 89 |
| `src/main/ets/utils/JsBindingUtils.ets` | nativeContext 初始化、bindFunction、SetContextPaths | 62 |

### 8.2 代表 Adapter（适配实现，`src/main/ets/adapter/`）

| 文件 | 用途 | 行数 |
|------|------|------|
| `AppWindowAdapter.ets` | 窗口管理（创建/关闭/最大化/置顶/全屏/标题/快速登录等） | 883 |
| `PermissionManagerAdapter.ets` | 权限申请/检查/文件访问持久化/确认框 | 353 |
| `NotificationAdapter.ets` | 通知发布/关闭/查询/权限 + 点击回传 | 348 |
| `PasteBoardApadter.ets` | 剪贴板读写（文本/HTML/图片/URI/自定义格式） | 252 |

> 其余 42 个 Adapter（集成面级别，不逐一深挖）：`Accessibility`、`AppLifecycle`、`AutoUpdater`、`Bluetooth`、`BluetoothLowEnergy`、`BrowserPolicy`、`CertManager`、`Context`、`ContextPath`、`Cursor`、`DefaultApplication`、`Device`、`DeviceInfo`、`DeviceUserAuth`、`Dialog`、`Display`、`DragDrop`、`ElectronApp`、`EtsBridge`、`ExternalProtocol`、`FileManager`、`FilePicker`、`Font`、`I18n`、`IMF`、`Media`、`MimeType`、`MultiInput`、`NativeMessaging`、`NativeTheme`、`PopupWindow`、`Print`、`Process`、`RunningLock`、`Screenshot`、`ShapeDetection`、`Share`、`Speech`、`StatusBarManager`、`SubWindow`、`SystemFloatingWindow`、`WebApp`。

### 8.3 代表 AdapterBind（注册入口，`src/main/ets/jsbindings/`）

| 文件 | 用途 | 行数 |
|------|------|------|
| `PasteBoardAdapterBind.ets` | 剪贴板 11 个方法注册 | 74 |
| `PermissionManagerAdapterBind.ets` | 权限 6 个方法注册 | 46 |
| `NotificationAdapterBind.ets` | 通知 5 个方法注册 | 42 |

> 其余 41 个 AdapterBind（集成面级别）：与 §8.2 各 Adapter 一一对应（`AppWindowAdapterBind` 等），另有 `JsBindingMethod.ets` 不属 AdapterBind。

### 8.4 resfile 承载目录（`src/main/resources/resfile/`）

| 内容 | 说明 |
|------|------|
| `resources/app/` | dsh 产物收集目标：`main.js`（主进程入口）+ `dsh-dist.tar.gz`（产物归档）+ `package.json` + `electron_white.png` |
| `resources.pak` / `chrome_100_percent.pak` / `chrome_200_percent.pak` | Chromium UI 资源 |
| `icudtl.dat` / `v8_context_snapshot.bin` / `snapshot_blob.bin` | Chromium 国际化/快照 |
| `locales/en-US.pak` / `locales/zh-CN.pak` | 语言包 |
| `vulkan/icd.d/` | Vulkan Swiftshader 配置 |
| `electron` | 运行时配置目录 |

## 9. 与规格的交叉引用

| 规格需求 | 实现位置 |
|----------|----------|
| FR-008-001（启动早期注册） | `WebAbilityStage.runTaskAsync` → `JsBindingMethod.bind()`（WebAbilityStage.ets:104-120） |
| FR-008-002（适配+注册成对） | `adapter/*.ets` + `jsbindings/*AdapterBind.ets` 一一对应 |
| FR-008-003（约 40 组能力） | `JsBindingMethod.bind()` 40 次 `*AdapterBind.bind()`（JsBindingMethod.ets:48-87） |
| FR-008-004（注册前初始化上下文） | `JsBindingUtils.initNativeContext` → `adapter.getNativeContext`（JsBindingUtils.ets:17-20） |
| FR-008-005（可渲染视图面） | `WebWindow` NodeContainer + XComponent（WebWindow.ets:57-78） |
| FR-008-006（视图就绪启动渲染） | `.onLoad` → `runBrowser` + `kNewWindow`（WebWindow.ets:70-75） |
| FR-008-007（窗口事件转发） | `windowStatusChange`/`windowSizeChange`/`windowRectChange`/`windowEvent` 等 → `nativeContext.On*`（WebAbility.ets:94-190） |
| FR-008-008（多窗口） | `createSubWindow`（WebBaseAbility.ets:193-206）+ `AppWindowAdapter.createWindow` + WebSubWindow/WebEmbeddedWindow |
| FR-008-009（手势/拖拽） | PanGesture/PinchGesture → `MultiInputAdapter`；onDrag*/onDrop → `DragDropAdapter`（WebWindow.ets:183-241） |
| FR-008-010（通知桥接） | `NotificationAdapter` + `NotificationAdapterBind`（5 方法） |
| FR-008-011（剪贴板桥接） | `PasteBoardAdapter` + `PasteBoardAdapterBind`（11 方法） |
| FR-008-012（权限桥接） | `PermissionManagerAdapter` + `PermissionManagerAdapterBind`（6 方法） |
| FR-008-013（窗口管理桥接） | `AppWindowAdapter`（883 行）+ `AppWindowAdapterBind` |
| FR-008-014（不支持返回失败） | 各 Adapter `callback(REQUEST_PERMISSION_FAIL)` / `callback(false)` / 空结果 |
| FR-008-015（退出协商） | `onPrepareTerminationAsync`（WebAbilityStage.ets:56-92） |
| FR-008-016（跨设备接续） | `onWindowStageRestore` 委派 create（WebAbility.ets:65-68）+ `ContinueAbility` |
| FR-008-017（系统分享） | `handleSharedData` + `normalizeSharedRecord`（WebBaseAbility.ets:257-291） |
| FR-008-018（实例路由） | `onAcceptWant`（WebAbilityStage.ets:32-50）+ `checkSingleInstance`（WebAbility.ets:454-461） |
| FR-008-019（约 28 项权限） | `module.json5` requestPermissions（28 项） |
| FR-008-020（自定义内核权限） | `module.json5` definePermissions（kernel.ALLOW_WRITABLE_CODE_MEMORY） |
| FR-008-021（运行产物承载） | `src/main/resources/resfile/resources/app/`（main.js + dsh-dist.tar.gz） |
