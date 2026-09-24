# N1「ArkWeb 合规」分析与设计

> 文档编号：docs/N1-ArkWeb合规-分析与设计.md
> 状态：**分析设计（未实施）**——待定方案后进入 PoC / 实施
> 日期：2026-09-24
> 关联：`docs/上线整改-0.1.5.md` §2.1（N1）、`patches/dsh-v0.1.5-rc.2/`、`web_engine/.../components/WebWindow.ets`

---

## 1. 问题与规则

**审核原文**
> 经检测发现，应用渲染打开网页时，未使用 ArkWeb 组件，不符合应用市场审核标准。如您的应用需渲染打开网页，请使用 ArkWeb 组件。

**规则要点**：应用若「渲染 / 打开网页」，须使用 ArkWeb（`@kit.ArkWeb` 的 `Web` 组件），以保证安全、可靠、一致的浏览体验。

**对本应用的问题**：本应用的主界面就是 **HTML/JS（dsh Web UI）**，当前由**随包分发的 Chromium（Electron 渲染器）**渲染，且 `EntryAbility` 声明了浏览器语义 → 命中规则。

---

## 2. 现状（含证据）

### 2.1 主 UI 渲染路径（非 ArkWeb）

```
Electron 主进程 src-main/main.js
  └─ new BrowserWindow(...) → win.loadURL(http://<LAN IP>:<port>/)
       └─ 鸿蒙侧入口页 electron/src/main/ets/pages/{Index|NodeHandleWindow}.ets
            └─ web_engine/.../components/WebWindow.ets
                 └─ XComponent(SURFACE) + nativeContext.runBrowser(args)   ← 原生 Chromium 渲染面
```

- 渲染引擎是**随包分发的 Chromium**，不是 ArkWeb。全仓 ArkWeb 仅有两处：`NativeMessagingAdapter.ets`（原生消息）与 `electron/.../pages/WebPage.ets`（华为账号认证协议演示页，未接入 dsh 主流程）。

### 2.2 浏览器语义（会被纳入判定）

`electron/src/main/module.json5` 的 `EntryAbility.skills` 同时声明：

```json5
"entities": ["entity.system.home", "entity.system.browsable"],
"actions":  ["action.system.home", "ohos.want.action.viewData"]
```

即应用可被系统当作 `viewData`（打开 URL）的目标 → 强化「浏览器」判定。

### 2.3 应用自身不打开外部网页

`src-main/main.js` 无 `shell.openExternal` / `openURL` / `openExternal` 调用（已检索）。dsh 的 `web` 工具是 **Host 侧抓取**（Node 发起 HTTP），不经渲染器打开页面。

### 2.4 壳对渲染器的依赖极薄（关键）

`src-main/renderer-preload.js` 仅注入两项**纯主世界 JS**（必须在 dsh 客户端 `apply()` 之前就位）：

1. `crypto.randomUUID` polyfill（鸿蒙 Chromium 缺 Web Crypto 时的兜底）；
2. `globalThis.__DSH_TRANSPORT__.ownsHost = true`（让浏览器侧 `isLoopback` 恒为 true，使 `settings/credentials/ui-theme` 等持久化 scope 可用）。

> 结论：**渲染层与壳的耦合只有一个 preload**，不存在 Node 能力依赖 → 渲染层理论上可替换。

---

## 3. 关键事实（决定可行性与收益）

| # | 事实 | 证据 | 含义 |
|---|---|---|---|
| F1 | ArkWeb `Web` 组件具备文档起始注入与拦截能力 | SDK `ets/component/web.d.ts`：`javaScriptOnDocumentStart`、`javaScriptProxy`、`onLoadIntercept`、`onInterceptRequest`、`onPageEnd` 均存在 | preload 的两项引导可在 ArkWeb **等价注入** |
| F2 | ArkWeb 运行在**应用进程内**（非跨进程隔离的独立渲染进程） | 运行时既有 `pages/WebPage.ets` 用 ArkWeb 正常渲染 | **可能**不再需要 LAN-IP 加载 + `Host` 改写 + `webserver 绑 0.0.0.0`（待 PoC 验证 loopback 可达性）→ 可退役 `dsh-allow-all-interfaces.patch` 与头改写逻辑 |
| F3 | dsh Host 需 Node；鸿蒙无自带 Node 运行时 | `docs/鸿蒙环境能力清单-v0.1.5.md`（自带 ELF 需二进制证书，个人开发者不可得） | **Electron（Node）不可去除** → 迁移目标是**渲染层**，不是整体去 Electron |
| F4 | dsh 前端是纯浏览器代码 | 官方入口 `dsh web`（浏览器 Web UI） | ArkWeb（Chromium 内核）**应可**运行 |

---

## 4. 方案对比

### 方案 A — 论证 + 收窄浏览器语义 + 外链 ArkWeb（低成本）

| 项 | 内容 |
|---|---|
| 动作 | ① 移除 `entity.system.browsable` 与 `ohos.want.action.viewData`（不再作为 URL 处理目标）；② 应用内**任何外部网页**（帮助/文档/隐私政策/用户协议）统一用 ArkWeb 页 `pages/ExternalWeb.ets`；③ 复审答复：主界面是**应用自带界面**（进程内 Host 同源提供，非浏览器上网），应用非浏览器 |
| 工作量 | **1–2 天** |
| 风险 | 审核**可能仍不接受**（主界面仍是「渲染网页」） |
| 收益 | 立即可做；若被接受即闭环 |

### 方案 B — 主 UI 迁移到 ArkWeb（彻底合规）

| 项 | 内容 |
|---|---|
| 动作 | 渲染层由「Electron BrowserWindow + Chromium（XComponent 面）」换成 **ArkUI `Web` 组件**加载同一 Host 地址；Electron 退化为**只跑 Node Host**（隐藏渲染器或 headless）；`javaScriptOnDocumentStart` 注入 preload 两项 |
| 工作量 | **2–4 周**（含窗口/输入/IME/托盘/全屏适配与回归） |
| 风险 | **高**：与上游 `harmonypc-electron` 的 XComponent 架构耦合；URL 需从主进程传到 ArkTS；双渲染路径维护 |
| 收益 | 彻底满足 ArkWeb 规则；**可能**顺带退役网络补丁（F2）与 LAN-IP/头改写复杂度 |
| 依赖 | 需 PoC 通过（§6）方可承诺 |

### 方案 C — 推荐：A 先行 + B 的 PoC 验证，按审核反馈推进

- 本轮提审走 **A**（争取直接过审）；
- **并行**做 **B 的最小 PoC**（只验证「ArkWeb 能跑通 dsh Web UI」，不承诺工期）；
- 若 A 被拒 → 用 PoC 结论决定是否投入 B。

---

## 5. 分阶段计划（建议）

| 阶段 | 内容 | 产出 |
|---|---|---|
| **阶段 1（本轮提审）** | 方案 A：移除浏览器语义 + 外链 ArkWeb 化 + 复审答复口径 | 可提审的合规面 |
| **阶段 2（并行）** | 方案 B 的 **PoC**（§6） | 「ArkWeb 能否跑通 dsh UI」的实测结论 |
| **阶段 3** | 按审核结论：过审则收尾；被拒则按 PoC 决定投入 B | 渲染层迁移或澄清沟通 |

---

## 6. PoC 计划（阶段 2，需真机实测）

**PoC 目标**：只回答一个问题 —— *ArkWeb 能否完整跑通 dsh Web UI？*（不追求产品化）

| # | 待验证问题 | 判据 | 备注 |
|---|---|---|---|
| P1 | ArkWeb 能否访问 **loopback**（`http://127.0.0.1:<port>/?token=…`） | 页面 200 + 完成 token 交换跳转到 `/` | 若可行 → 可退役 `dsh-allow-all-interfaces` 与 `Host/Origin` 改写（F2 收益） |
| P2 | `javaScriptOnDocumentStart` 注入 preload 两项 | dsh 客户端 `apply()` 前 `crypto.randomUUID` 与 `__DSH_TRANSPORT__.ownsHost` 已就位 | 注入需在**文档起始**，不能晚于页面脚本 |
| P3 | dsh SPA 在 ArkWeb 内运行 | `fetch('/api/*')` 200；WebSocket `/api/events.mux` 握手成功 | ArkWeb 为 Chromium 内核，预期可行 |
| P4 | 设置/凭据 scope 可用 | 「设置 → 模型」能加载提供方目录（非 `settings are unavailable`） | 依赖 P2 的 `ownsHost` |
| P5 | 交互能力 | contenteditable 输入法输入、拖拽、剪贴板粘贴均正常 | 当前靠 `MultiInputAdapter`/`DragDropAdapter`（XComponent 路径） |
| P6 | 性能与稳定性 | 首屏时间、长会话不崩、内存可接受 | — |

**PoC 实现落点（不影响现有路径）**
- 新增最小探针页 `electron/src/main/ets/pages/ArkWebProbe.ets`（`Web({src: …})` + `javaScriptOnDocumentStart` + 日志）；
- main 侧把 `host.url` 写到一个 ArkTS 可读位置（文件或日志轮询）以传递 URL；
- 以开关（如 `--arkweb-probe`）启用，默认关闭。

**成功判据**：在 ArkWeb 页内完成「选择工作区 → 新建会话 → 发消息 → 工具调用 → 打开设置」全链路。

---

### 6.1 PoC 实施状态（已搭建，待设备实测）

已搭好**旁路式** PoC（不进入正常启动路径），2in1 设备回归后即可直接执行：

| 落点 | 作用 |
|---|---|
| `electron/src/main/ets/ability/ArkWebProbeAbility.ets` | 独立 UIAbility（**不继承 `WebAbility`**，不启动 Electron 浏览器面），读 `--ps url` 传参并加载探针页 |
| `electron/src/main/ets/pages/ArkWebProbe.ets` | ArkWeb `Web` 页：`javaScriptOnDocumentStart` 注入 preload 两项；`onPageEnd` 后执行结构化探测；页内显示 URL / 状态 / 结果 |
| `module.json5`（源 + overlay） | 注册 `ArkWebProbeAbility`（`exported:false`，`process: ':browser'`） |
| `main_pages.json`（源 + overlay） | 注册 `pages/ArkWebProbe` |
| `src-main/main.js`（+ resfile 镜像） | 仅当 `DSH_ARKWEB_PROBE=1` 时打印**认证 URL**（含 launch token，调试专用） |
| `scripts/collect-runtime.mjs` | 新文件入 `OVERLAY_ADD_FILES`（5→7）；`main_pages.json` 入 `OVERLAY_FILES`（17） |

**运行步骤（设备就绪后）**
1. 让应用在 `DSH_ARKWEB_PROBE=1` 下运行（debug 构建）；
2. `hdc shell hilog -x | grep "\[probe\] 认证 URL"` 取得 `http://…?token=…`；
3. `hdc shell aa start -a ArkWebProbeAbility -b org.fellow99.DeepseekHarnessHarmony --ps url "<认证URL>"`；
4. `hdc shell hilog -x | grep ArkWebProbe` 读取 `PROBE_RESULT={…}` 与 `onErrorReceive` / `onHttpErrorReceive` / `console[…]`；
5. 记录 §6 表中 P1–P4 结论（P5 交互、P6 性能另测）。

**判读**
- `hasRandomUUID=true` 且 `ownsHost=true` → **P2 通过**（文档起始注入等价 preload）；
- `hasComposer=true` 且 `settingsUnavailable=false` → **P3 + P4 通过**（SPA 启动、fetch/WS 连通、settings scope 可用）；
- `href` 的 host 形态 → **P1 结论**（loopback 是否可达，决定能否退役网络补丁）。

> ⚠️ `ArkWebProbeAbility` / `pages/ArkWebProbe` / `module.json5` 内的声明均为 **PoC 专用**，**上架前必须移除**（并从 `OVERLAY_ADD_FILES` 撤销）。

---

### 6.2 PoC 实测结果（2026-09-24，MateBook Pro 2in1）

**第一轮**（`hdc shell aa start -a ArkWebProbeAbility -b …`；URL 由 handoff 文件交接，无需环境变量）

```
PROBE_RESULT={"href":"http://192.168.137.44:40539/","title":"DSH Desktop",
  "hasRandomUUID":true,"ownsHost":true,"hasComposer":false,
  "settingsUnavailable":false,"bodyHead":"DSH Desktop\n新会话\n工作区\n暂无会话\n设置"}
```

| 判据 | 结果 |
|---|---|
| **P2** 文档起始注入（preload 等价物） | ✅ `hasRandomUUID=true` + `ownsHost=true` |
| **P4** settings/credentials scope | ✅ `settingsUnavailable=false` |
| **P3** SPA 启动（fetch/WS） | ⚠️ **部分**：页面 200 无 HTTP 错误、侧栏渲染（新会话/工作区/设置），但 `hasComposer=false` |
| **P1** loopback | ⏳ 本轮 URL 是 handoff 给出的 **LAN-IP** 认证 URL（`http://192.168.137.44:40539/`），ArkWeb 加载正常；**未直接验证 `127.0.0.1`** |

**发现并修复（关键配置项）**：ArkWeb `Web` 组件**默认关闭 DOM storage**，而 dsh 客户端用 `localStorage` 持久化视图状态：

```
console: snapshot store 'dsh.sessions.current' rehydration failed: TypeError: Cannot read properties of null (reading 'getItem')
console: slot entry crashed in 'main.conversation': TypeError: Cannot read properties of null (reading 'getItem')
```

→ 主区/composer 因此未渲染。**修复**：探针页加 `.domStorageAccess(true)` + `.databaseAccess(true)`（已改，待复测）。**这也是方案 B 的必备配置项**。

**第二轮**（加 `.domStorageAccess(true)` + `.databaseAccess(true)` 后重建复跑）

```
PROBE_RESULT={"href":"http://192.168.137.44:45011/","title":"DSH Desktop",
  "hasRandomUUID":true,"ownsHost":true,"hasComposer":false,"settingsUnavailable":false,
  "bodyHead":"DSH Desktop\n新会话\n工作区\n暂无会话\n设置\nDSH Desktop\n选择工作区\n选择一个工作区开始"}
```

- `localStorage` 崩溃**已消失**（`rehydration failed` / `main.conversation` 命中 **0**），`bodyHead` 已含 Hero 主区；
- **截图实证**：ArkWeb 内 dsh UI **完整渲染** —— 侧栏（DSH Desktop / 新会话 / 工作区 / 设置）+ **Hero 主区**（logo + DSH Desktop + 选择工作区 / 标准模式）+ **composer 输入框**（`+` / 回形针 / 发送按钮）。
- `hasComposer=false` 仅是**探针选择器**问题（`role="textbox"` 未聚焦时不存在），已改为 `[contenteditable="true"]`（下次构建生效）。

> **✅ PoC 结论：ArkWeb 可完整承载 dsh Web UI（方案 B 技术可行）。** 必备配置：`domStorageAccess(true)`（dsh 客户端依赖 `localStorage` 持久化视图状态）+ `databaseAccess(true)`；preload 两项可由 `javaScriptOnDocumentStart` 等价注入；`settings` scope（`ownsHost`）正常。
> 剩余待验证：P1 的 **loopback（127.0.0.1）**变体（本轮用 handoff 给的 LAN-IP URL）、P5 交互（输入法/拖拽/剪贴板）、P6 性能与稳定性。

---

## 7. 决策点（需确认）

1. **是否投入方案 B**（2–4 周 + 与上游运行时耦合的风险）——取决于 A 能否过审。
2. 若走 B：Electron 是 **headless 化**（不建窗口）还是**保留隐藏渲染器**（仅作 Node Host）？
3. 是否接受「**A 先行、B 兜底**」的策略（推荐）。
4. 若 A 被拒且 B 的 PoC 失败：是否需要与华为/审核沟通澄清「应用自带 UI ≠ 浏览器」（走申诉/澄清通道）。

---

## 8. 复审应答口径（方案 A）

> 本应用为面向开发者的 AI Agent 工作台桌面应用，主界面为**应用自带的本地界面**（由应用内进程同源提供，非浏览器上网）。本次整改已：(1) **移除**对 `entity.system.browsable` / `ohos.want.action.viewData` 的声明，应用不再承担浏览器语义；(2) 应用内所有**外部网页**（帮助 / 文档 / 隐私政策 / 用户协议）均改由 **ArkWeb 组件**（`Web`）渲染，见附图。请复核。

（方案 B 版：> 本应用主界面已改由 ArkWeb 组件（`@kit.ArkWeb` 的 `Web`）渲染，运行于同一进程内 Host 之上，见附图/录屏。）

---

## 9. 风险与遗留

- **B 与上游运行时的耦合**：当前窗口/输入/拖拽/托盘均围绕 XComponent 会话构建，替换渲染层会牵动多处 `*Adapter`；上游 `harmonypc-electron` 的改动需以 `runtime-overlays` 方式落盘（本工程纪律）。
- **cleartext HTTP**：ArkWeb 加载 `http://…` 是否需要额外的网络安全配置（`cleartextTraffic` / `networkSecurityConfig`）——列 PoC 前置确认项。
- **双渲染路径维护成本**：迁移期需同时维护 Chromium 与 ArkWeb 两条路径。
- **PoC 失败时的退路**：以方案 A + 澄清沟通为兜底；不承诺 B 的工期。
- **文档同步**：本设计一旦选定方案，需回写 `docs/上线整改-0.1.5.md` §2.1 与 `specs/ARCHITECTURE.md`（进程模型）。
