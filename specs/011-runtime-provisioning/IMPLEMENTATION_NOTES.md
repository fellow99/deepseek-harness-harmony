# 011-runtime-provisioning —— 实现记录（IMPLEMENTATION_NOTES）

> 模块：011-runtime-provisioning
> 对应规格：[spec.md](./spec.md) ｜ 方案：[plan.md](./plan.md) ｜ 任务：[tasks.md](./tasks.md) ｜ 用例：[test-cases.md](./test-cases.md)
> 记录日期：2026-09-18
> 设备状态：**当前无设备连接** —— 本文件**不含**任何真机结论；`tasks.md` 中依赖设备的项一律保持 `未验证`。
>
> ⛔ **HNP 已整体移除（2026-09-23）**：`hnpPackages` 声明、`electron/hnp{,-src}/` 载荷与探针、`scripts/inject-hnp.ps1` 与 `inject-hnp-app.ps1`、以及 `build-hap.ps1` 的自动嵌入逻辑与 `-hnp` 产物**均已删除** —— 本工程不再使用 HNP（见 `docs/鸿蒙环境能力清单-v0.1.5.md` A.2 #30）。故本文件中凡以「路径 A / HNP 打包」为前提的记录**仅作历史留存**，不再代表当前构建流程；**设备端第三方 HNP 仍被复用**（路径 C）。

本记录只陈述**已执行并抓到输出**的事实；未执行项显式标为「未执行 / 待下一步」，不臆测结果。

---

## 1. 交付物与行数

| 文件 | 类型 | 行数 | 说明 |
|---|---|---|---|
| `src-main/market-runtime.js` | **新增** | 669 | 运行时供给引导：纯探测 / 选路 / 完整性校验 / shim / PATH 组装 / 诊断（仅 node 内建依赖） |
| `scripts/fetch-market-runtime.mjs` | **新增** | 308 | 路径 A 的便携运行时获取器（`.part` + `Content-Length` + 重试 + 校验 + 版本戳） |
| `scripts/tests/market-runtime.test.mjs` | **新增** | 207 | 选路 / PATH / PNPM_HOME / shim / 诊断 单测 |
| `scripts/tests/artifact-integrity.test.mjs` | **新增** | 118 | 完整性校验矩阵单测 |
| `runtime-overlays/web_engine/src/main/module.json5` | 修改 | 145（+30） | 新增 3 条 normal 权限（含 `reason` + `usedScene`） |
| `runtime-overlays/web_engine/src/main/resources/base/element/string.json` | 修改 | 124（+12） | 3 条 `reason` 的 base（英文）文案 |
| `runtime-overlays/web_engine/src/main/resources/en_US/element/string.json` | 修改 | 124（+12） | 3 条 `reason` 的 en_US 文案 |
| `runtime-overlays/web_engine/src/main/resources/zh_CN/element/string.json` | 修改 | 124（+12） | 3 条 `reason` 的中文文案 |
| `.gitignore` | 修改 | 36（+4） | 忽略路径 A 的暂存目录 `/runtime/` |

行数为实测值：**运行时交付文件（表中前 4 行）** 按 `(Get-Content).Count`（**含空行的总行数**）计；其余（`runtime-overlays/*`、`.gitignore`）按 `(Get-Content | Measure-Object -Line).Lines`（**非空行**）计 —— 两者对无空行文件一致，仅 `.gitignore` 的含空行总数与之不同。括号内为相对改动量。

---

## 2. 已完成的 spec 任务（逐条对应 `tasks.md`）

| 任务 | 状态 | 落点 |
|---|---|---|
| T1.3 选路骨架 `selectRuntime()` | ✅ 完成 | `src-main/market-runtime.js::discoverMarketRuntime()`（§4.3 有序规则 A→B→C→显式失败，禁跳级；C 带 `source: 'device-environment'`） |
| T2.1 `scripts/fetch-market-runtime.mjs` | ✅ 完成（框架） | `.part` + `Content-Length` 比对 + 3 次重试 + `rename`；复用运行期同一校验器；**全部通过后才写版本戳**；缺失来源**响亮失败** |
| T3.1 `setupMarketRuntime()` | ✅ 完成 | `src-main/market-runtime.js`：探测→校验→shim→PATH/`PNPM_HOME`→日志；**绝不抛出** |
| T3.3 注入结果日志 | ✅ 完成 | `formatDiagnostics()`；统一 `[dsh-harmony]` 前缀；四态均有输出；无静默降级 |
| T4.1 `dsh` shim | ✅ 完成 | `dshShim()`（POSIX/Windows 精确内容）；POSIX 以 `{ mode: 0o755 }` 写入并 best-effort `chmod`（不抛出）；每次启动重写 |
| T5.1 探测 `probeRuntimes()` | ✅ 完成 | `discoverMarketRuntime()`（A 严格校验 / B JS 就位 / C `node -e` 硬门槛）；依赖全部注入，可裸 Node 单测 |
| T5.2 完整性校验器 | ✅ 完成 | `isUsableExecutable`（ELF magic + class + `e_machine` + 节表越界 + 可执行位）、`isValidElf`、`isParsableJs`、宽松 `isExecutableFile`；异常一律 `false` |
| T5.3 降级与显式失败 | ✅ 完成 | 返回带 `reason` 的结果对象，**不抛异常**、不阻塞启动 |
| T5.4 路径 C 的「设备环境」标注 | ✅ 完成 | `source: 'device-environment'` + 诊断含 `device-environment` 与「非本应用保障」 |
| T6.1 声明 normal 权限 | ✅ 完成 | 仅 `INHERIT_PARENT_PERMISSION` / `kernel.IGNORE_LIBRARY_VALIDATION` / `kernel.EXEMPT_ANONYMOUS_EXECUTABLE_MEMORY` 三条，均免 ACL（见 §4） |
| T6.4 不申请 plugin ACL | ✅ 完成（零命中） | 未声明 `SUPPORT_PLUGIN` / `INSTALL_PLUGIN_BUNDLE` / `UNINSTALL_PLUGIN_BUNDLE` / `PLUGIN_UPDATE` |
| T8.1 `market-runtime.test.mjs` | ✅ 完成 | 24 项断言全过（含 §5 证据） |
| T8.2 `artifact-integrity.test.mjs` | ✅ 完成 | 同上 |
| T9.5 权限静态断言（等价） | ✅ 完成（等价检查） | 见 §5 第 6 条：`CUSTOM_SANDBOX` / `RUN_ANY_CODE` / `kernel.ALLOW_EXTERNAL_NATIVE_CODE` 三项在 `web_engine` overlay 中零命中 |

---

## 3. 被阻断 / 未执行的任务，及其阻断原因

> **阻断主因**：① AGC **二进制证书**工单（`docs/ACL申请清单-v2.md` A1，`spec §4.4`，用户所有）；② Node aarch64-ohos 的来源与版本未选定（`plan §16 Q1`，`[NEEDS CLARIFICATION]`）；③ **文件所有权**（本工作单禁止改动 `src-main/main.js`、`scripts/collect-dsh.mjs`、`runtime-overlays/electron/**`）。

### 3.1 阻断在「二进制证书 / 运行时来源」

| 任务 | 状态 | 原因 |
|---|---|---|
| T0.1 提交二进制证书工单 | **用户所有**，未执行 | 外部工单，工程侧只登记（`docs/ACL申请清单-v2.md` A1） |
| T0.2 提交 ACL 申请 | **用户所有**，未执行 | 外部流程 |
| T1.1 落定 Node 运行时来源与版本 | **未执行**（`[NEEDS CLARIFICATION]`） | 第三方 aarch64-ohos 构建的发布方 / 版本未选定（`plan §16 Q1`）；`fetch-market-runtime.mjs` 因此把 Node 来源作为**显式外部输入**（`--node-url` / `DSH_MARKET_NODE_URL`），不内置任何二进制 |
| T2.2 `electron/hnp-src-runtime/hnp.json` | **未创建** | `plan §6.1` 的 `version` 必须与 T1.1 选定的运行时版本一致；在来源未定时写入任一版本号即等于伪造。**不做**占位值 |
| T2.3 路径 A ELF 载荷就位 | **未执行** | 无已选定二进制；且产物须经二进制证书签名（`spec §7.3` / FR-5.6） |
| T2.5 扩展 `inject-hnp.ps1` 嵌入运行时载荷 | **未执行** | 依赖 T2.3 的 `.hnp` 载荷与 T2.4 的 `hnpPackages` 声明；两者未就位 |
| T6.2 / T6.3 `.permission` 节与权限子集断言 | **未执行** | 仅 `executableBinaryPaths` **备选形态**需要；本工作单只声明 normal 权限，未走备选形态（`spec` FR-5.4 首选 HNP 免权限） |
| T9.1 获取脚本的幂等 / 防截断断言（真跑下载） | **未执行** | 无选定来源可下载；脚本的防截断与版本戳逻辑已实现并 `node --check` 通过，其真跑需外部 URL |
| T9.3 / T9.4 / T9.8 HAP 构建 + overlay 守卫 + HNP 嵌入 | **未执行** | 需 DevEco SDK + 签名材料 + T2.4/T2.5；当前无设备、无载荷 |

### 3.2 原阻断在「文件所有权」（T3.2 已应用；其余须由下一轮 / 人工处理）

| 任务 | 文件（所有权） | 需要的动作 |
|---|---|---|
| T3.2 `startHost()` 内接线 | `src-main/main.js` | ✅ **已应用**：`require('./market-runtime.js')` 在 `:20`；调用 `setupMarketRuntime({ dshRoot: DSH_ROOT })` 在 `:480-484`，位于 `ensureDshPluginsProfileLink()`（`:479`）之后、`installExtraWritableRoots()`（`:486`）与 `runProfile()` 之前（见 §6） |
| T2.4 `hnpPackages` 增行（源 + overlay 双改） | `runtime-overlays/electron/src/main/module.json5`（**禁止改动**） | 由拥有 `runtime-overlays/electron/**` 的一方，在 T1.1/T2.3 就位后同步改源与 overlay（`plan D13`；改一不改二会被阶段 3 回盖且阶段 7.6 守卫失败） |
| T2.6 物化路径 B 的 pnpm JS | `scripts/collect-dsh.mjs`（**本工作单禁止改动**） | 扩展 `collectDshMarket()`（或新增 `collectMarketPNPM()`），把 pnpm JS 与依赖物化到 `<DSH_ROOT>/node_modules/dsh-market-pnpm/lib/index.mjs`（本模块 `BUNDLED_PNPM_ENTRY_REL` 常量即该约定），缺失即非零退出 |
| T4.2 / T4.3 路径 B 进程内补丁 + `build-dsh.mjs` 应用 | `patches/dsh-market-v1.26.0/` + `scripts/build-dsh.mjs` | 按 `plan §11.2` 改写 `dshArgv()` / `spawnShim()` / `runDshPlugin()` / `probePnpm()` / `provisionPnpm()`；默认 `--ignore-scripts`、`process.exit` 包装、`process.argv` 保存/恢复。本工作单未交付该补丁 |
| T7.1 / T7.2 / T7.3 文档 / 技能同步 | `specs/201-dsh-market/spec.md`、`skills/harmony-runtime-capabilities/SKILL.md`、`README*.md` | 安装通道的真实可用性在路径 A/B 落地后才可写死；**技能同步单向**（先改规范，再改技能，`spec §9.5`） |

### 3.3 未纳入本工作单交付范围

| 任务 | 状态 | 说明 |
|---|---|---|
| T8.3 `provision-hint.test.mjs` | **未写** | `provisionHint()` 是 `../dsh-market/src/dsh-cli.ts:730-780` 的 TypeScript 纯函数，不属于本工程构建产物；本工作单的交付清单未含该测试。若要做，须先把该逻辑以可单测形态引入（例如市场补丁的一部分） |
| T8.4 接入 `npm test` | **未执行** | 本工程**没有根 `package.json`**（仅 `src-main/package.json` 与各插件各一份），不存在统一的 `npm test` 入口。测试以 `node --test` 直接运行（见 §5） |
| T9.6 / T9.7 未恢复上游禁用 / 文档纪律断言 | **未执行** | 无新增启用；本工作单未改动 `profiles/desktop/cordis.patch.yml` |

---

## 4. 权限声明的精确落点与裁定

**落点**：`runtime-overlays/web_engine/src/main/module.json5` 的 `requestPermissions`（新增三条）：

```json5
{ "name": "ohos.permission.INHERIT_PARENT_PERMISSION",
  "reason": "$string:inherit_parent_permission",
  "usedScene": { "abilities": ["EntryAbility"], "when": "inuse" } },
{ "name": "ohos.permission.kernel.IGNORE_LIBRARY_VALIDATION",
  "reason": "$string:ignore_library_validation",
  "usedScene": { "abilities": ["EntryAbility"], "when": "inuse" } },
{ "name": "ohos.permission.kernel.EXEMPT_ANONYMOUS_EXECUTABLE_MEMORY",
  "reason": "$string:exempt_anonymous_executable_memory",
  "usedScene": { "abilities": ["EntryAbility"], "when": "inuse" } }
```

- 三条均为 **normal（`provisionEnable == false`）**，**无需 ACL**（`docs/ACL申请清单-v2.md` §2；`spec §3.3`）。`kernel.` 前缀不影响该判定。
- **未**新增任何 ACL 门控权限；**未**新增 `CUSTOM_SANDBOX` / `RUN_ANY_CODE`；**未**新增不存在的 `ohos.permission.kernel.ALLOW_EXTERNAL_NATIVE_CODE`（`spec` FR-5.1 精确名提示）。
- `reason` 是资源引用（HarmonyOS 要求 `$string:`），故同步在 3 个 locale 的 `string.json` 各加 3 条：`base` / `en_US` 为英文、`zh_CN` 为中文，**沿用邻近 `access_pasteboard` / `download_dir` 等既有双语形态**。
- 这 4 个文件都在 `collect-runtime.mjs` 的 `OVERLAY_FILES` 内，改 overlay 即最终产物；阶段 3 回盖、阶段 7.6 md5 守卫继续成立（未改列表、未改源文件列表外的任何 overlay）。

---

## 5. 证据：已执行的命令与逐字输出

以下命令均在 `D:\deepseek-harness-workspace\deepseek-harness-harmony` 下执行。

### 5.1 `node --check`（4 个新文件）

```
> node --check src-main/market-runtime.js
> node --check scripts/fetch-market-runtime.mjs
> node --check scripts/tests/market-runtime.test.mjs
> node --check scripts/tests/artifact-integrity.test.mjs
market-runtime.js exit=0
fetch-market-runtime.mjs exit=0
market-runtime.test.mjs exit=0
artifact-integrity.test.mjs exit=0
```

### 5.2 单元测试

```
> node --test scripts/tests/market-runtime.test.mjs scripts/tests/artifact-integrity.test.mjs
✔ a complete aarch64 ELF passes structural validation
✔ a complete x86_64 ELF passes when the expected arch is x64
✔ a truncated ELF (section table out of bounds) is rejected
✔ an ELF with the wrong e_machine (x86_64 vs arm64) is rejected
✔ a non-ELF payload (PNG magic) is rejected
✔ an empty file is rejected
✔ an absent file returns false without throwing
✔ a directory path is rejected without throwing
✔ isParsableJs accepts a non-empty JS entry and rejects empty / absent ones
✔ path A is selected when both HNP node and pnpm pass structural validation
✔ path B is selected when path A is unavailable and the pnpm JS entry is in place
✔ path C is selected only when A and B are unavailable and the node -e probe passes
✔ path C is NOT selected when the node -e probe produces no output
✔ degradation is ordered and never skips a level: an available A beats a probe-passing C
✔ an available B beats a probe-passing C
✔ when everything is unavailable the result is an explicit failure, not an exception
✔ composePath prepends prefix dirs in order, dedupes, and drops empty entries
✔ composePath uses the platform separator
✔ POSIX shim content is exactly the exec form
✔ Windows shim content is exactly the cmd form
✔ diagnostics are prefixed and record which path was selected
✔ path C diagnostics carry the device-environment marker; A and B do not
✔ explicit failure diagnostics are loud and actionable
✔ candidate diagnostics record rejected candidates and why
ℹ tests 24
ℹ pass 24
ℹ fail 0
TESTS exit=0
```

### 5.3 获取脚本的响亮失败（未提供 Node 来源）

```
> node scripts/fetch-market-runtime.mjs          # 未设置 DSH_MARKET_NODE_URL
[fetch-market-runtime] 失败: 缺少 Node 运行时来源（路径 A 的 node ELF）：请用 --node-url <url> 或环境变量 DSH_MARKET_NODE_URL 指定。
  · Node.js 官方**没有** aarch64-ohos 二进制（仅 Experimental，spec §7.1），路径 A 依赖第三方构建，
    其发布方 / 版本尚未选定（plan §16 Q1 `[NEEDS CLARIFICATION]`）。
  · 本脚本只做「获取 + 防截断 + 结构校验 + 版本戳」，**不内置**任何二进制，也不打包 HNP。
  · 产物为**未签名** ELF；路径 A 上机前还须用 AGC 二进制证书签名（spec §7.3，工单见 docs/ACL申请清单-v2.md A1）。
fetch exit=1
```

### 5.4 权限静态断言（等价于 TC-B4 / T6.4）

```
> node -e "...JSON.parse(module.json5)..."
OK runtime-overlays/web_engine/src/main/resources/base/element/string.json
OK runtime-overlays/web_engine/src/main/resources/en_US/element/string.json
OK runtime-overlays/web_engine/src/main/resources/zh_CN/element/string.json
OK runtime-overlays/web_engine/src/main/module.json5
HAS ohos.permission.INHERIT_PARENT_PERMISSION
HAS ohos.permission.kernel.IGNORE_LIBRARY_VALIDATION
HAS ohos.permission.kernel.EXEMPT_ANONYMOUS_EXECUTABLE_MEMORY
forbidden CUSTOM_SANDBOX: false RUN_ANY_CODE: false kernel.ALLOW_EXTERNAL_NATIVE_CODE: false
```

---

## 6. `src-main/main.js` 接线（**已应用**）

> **状态更新：T3.2 已应用。** `src-main/main.js` 现含 `const { setupMarketRuntime } = require('./market-runtime.js');` 于 `:20`，并在 `startHost()` 中、`ensureDshPluginsProfileLink()`（`:479`）之后、`installExtraWritableRoots()`（`:486`）与 `runProfile()` 之前，调用 `setupMarketRuntime({ dshRoot: DSH_ROOT })`（`:480-484`）。
> 下方 §6.1/§6.2 保留原始「可直接粘贴」片段作为**历史锚点记录**（写作时 `main.js` 为 912 行；应用后为 924 行），§6.3 表中的 `:631` / `:865` / `:472` / `:474` / `:496` / `:488` 同理为应用前的历史行号。

### 6.1 新增 require（插在 `src-main/main.js:19` 之后）

```diff
@@ -17,6 +17,7 @@
 const { createGunzip } = require('node:zlib');
 const { join, dirname, delimiter } = require('node:path');
 const { pathToFileURL } = require('node:url');
 const { networkInterfaces } = require('node:os');
+const { setupMarketRuntime } = require('./market-runtime.js');
 
 // ── 启动 loading 页 ─────────────────────────────────────────────────
```

### 6.2 调用点（插在 `src-main/main.js:472` 之后、`:473` 之前）

```diff
@@ -470,6 +471,10 @@ async function startHost() {
   ensureDesktopProfile(process.env.DSH_HOME);
   ensureDshMarketProfileLink(process.env.DSH_HOME);
   ensureDshPluginsProfileLink(process.env.DSH_HOME);
+  // 011-runtime-provisioning：运行时供给（探测 A/B/C → 校验 → 生成 dsh shim → 前置 PATH / 设 PNPM_HOME）。
+  // 时序约束：晚于 ensureDshExtracted()（DSH_ROOT 就位，shim 指向 DSH_ROOT/lib/bin.js）与
+  // ensureSandboxHome()（HOME 已指向沙箱目录）；晚于 ensureDshPluginsProfileLink()；早于 runProfile()
+  // （dshmarket 的 spawnEnv() 在调用时读 process.env.PATH）。失败仅影响市场安装通道，不阻塞启动。
+  setupMarketRuntime({ dshRoot: DSH_ROOT });
   // 用户目录写入白名单：必须在 runProfile 之前设置，writableRoots 每次围栏判定都读它。
   installExtraWritableRoots();
```

### 6.3 顺序约束（为什么必须在这个位置）

| 约束 | 依据 |
|---|---|
| **晚于** `ensureSandboxHome()`（`:631`，顶层调用） | `HOME` 必须先指向沙箱目录，路径 C 的 `~` 展开与 `homedir()` 推导才正确（`plan §3.2` 理由 2） |
| **晚于** `ensureDshExtracted()`（`:865`） | `DSH_ROOT` 由它设定；shim 的 CLI 入口是 `DSH_ROOT/lib/bin.js`（`plan §3.2` 理由 1） |
| **晚于** `ensureDshPluginsProfileLink()`（`:472`） | `plan §3.3` 的落点；与插件目录镜像无耦合，放在其后仅为阅读顺序 |
| **早于** `installExtraWritableRoots()`（`:474`） | `plan §3.3` 伪代码的落点（两者都改 `process.env`，语义正交，顺序不影响正确性） |
| **早于** `runProfile()`（`:496`） | `dsh-market/src/dsh-cli.ts:235-250` 的 `spawnEnv()` 在**调用时**读 `process.env.PATH`；`provisionPnpm()` / `probePnpm()` 都发生在 Host 起来后的 UI 交互中，故只要在 `runProfile` 前写好即可（`plan §3.2` 理由 3） |
| **早于** `patchAgentPresetsRuntime()`（`:488`）/ `runProfile` | 无直接依赖；同属「Host 起来前完成全部 `process.env` 注入」的既有约定 |

### 6.4 应用后的构建期断言

- `node --check src-main/main.js` 应通过 —— **已通过**（exit 0）；
- grep 断言调用点在 `ensureDshPluginsProfileLink` 之后、`runProfile` 之前（`tasks.md` T3.2 的验收检查）—— 当前 `:484` 落在 `:479` 与 `runProfile` 之间；
- 启动日志应出现 `[dsh-harmony] runtime ...` 前缀行（AC-18 / FR-6.1）—— 属真机项，保持 `未验证`（无设备）。

---

## 7. 规格歧义与解决方式（如实记录）

1. **权限落点的文件选择**。`plan §6.2` / FR-5.2 写的是 `electron/src/main/module.json5`（并同步 overlay），但本工作单**明确**要求改 `runtime-overlays/web_engine/src/main/module.json5`（并禁止改 `runtime-overlays/electron/**`）。**解决**：只改 `web_engine` overlay —— 它才是随包的真实权限面（`electron/src/main/module.json5` 是另一个 agent 的所有物），且 overlay 在阶段 3 回盖，产物以 overlay 为准。`hnpPackages` 行（T2.4）因同属 `runtime-overlays/electron/**` 而被阻断，列在 §3.2 待人工处理。

2. **`reason` 必须是资源引用**。工作单要求「Chinese `reason` + `usedScene`」，而 HarmonyOS 的 `reason` 只接受 `$string:` 引用，不能写字面中文。**解决**：新增 3 条 `$string:` key，`zh_CN` 写中文、`base`/`en_US` 写英文，沿用邻近条目的双语形态。

3. **shim 的适用路径**。`plan` D8 写「shim 只在路径 A 生成」，但其给出的判据是「存在可 exec 的 node」——路径 C（设备第三方 Node）同样满足该判据，且 `plan §8.2` 也给路径 C 分配了 `<userData>/runtime-bin`。**解决**：实现为「**路径 A 与 C 都生成 shim**；路径 B 不生成（无 node 可 exec，改为进程内调用）」。若不这样，路径 C 的 `dshArgv()` 回退（`dsh-cli.ts:339` 的裸 `dsh`）将无入口，机会性兜底形同虚设。**这是对 D8 的一处偏离，特此报告。**

4. **路径 A 的判定强度**。`spec §4.3` 规则 1 说「运行时已随包就位且通过完整性校验」。**解决**：**同时**要求 `node` 与 `pnpm` 均通过严格结构校验才选 A —— 市场安装通道两者缺一不可（`spec §1.1`「同一问题的两个面」）。

5. **两条校验口径**。**解决**：随包产物（路径 A）用**严格** ELF 结构校验（FR-1.3 / §9.1），设备第三方运行时（路径 C）用**宽松**存在 + 可执行位 + `node -e` 探针（FR-4.3 明确「复用对象不得来自本工程产物之外的任何签名 / 完整性假定」，其硬门槛是探针）。

6. **测试目录**。`plan §12` 写 `src-main/tests/`。本工作单说「match whichever the repo already uses for non-plugin tests」。**解决**：仓库既有的非插件测试在 `scripts/tests/`（`sharp-stub.test.mjs`），故落在 `scripts/tests/`，与 `plan §12` 的目录名不同，测试内容一致。

7. **`provision-hint.test.mjs`（T8.3）**。其被测对象是 `../dsh-market` 的 TypeScript 纯函数，不属于本工程构建产物；本工作单交付清单未含它。**解决**：不写（见 §3.3），避免把非本工程的逻辑复制进来冒充测试。

8. **`fetch-market-runtime.mjs` 的 Node 来源**。`plan §16 Q1` 未决，不能硬编码第三方 URL。**解决**：把来源作为**显式外部输入**（`--node-url` / `DSH_MARKET_NODE_URL`），未提供即**响亮失败并说明原因**；pnpm 默认 URL 按 `plan` 语义固定为 `pnpm-linuxstatic-arm64@9.15.9`，并注明其在 OpenHarmony 上**未验证**（Q3）。

---

## 8. 未验证 / 无设备结论（如实披露）

以下项**未在任何设备上验证**，结论保持 `未验证`；本工作单**不**声称任何真机结果：

- 路径 A：HNP 随 HAP 的自动安装是否需开发者模式、系统创建的 `node`/`pnpm` 软链接是否可用、`pnpm-linuxstatic` 能否在 OpenHarmony 直接执行（`plan §16 Q5/Q3`）。
- 二进制证书：可得性 / 受理资格 / `-selfSign` 适用范围（`spec §4.4`、FR-5.6）。
- `writeFileSync(..., { mode: 0o755 })` 在 B1 下是否真给出可执行位（`plan §16 Q2`，真机 TC-D6）。
- `dshArgv()` 是否命中第一分支（`plan §16 Q6`，真机 TC-D3）。
- 路径 C：现设备 `node -e` 无输出（`plan §16 Q8`，真机 TC-D2）—— 因此路径 C 在当前设备上大概率不通过。
- 签名 ELF 能否 `execve("/system/bin/sh")`（`spec §7.4` 最高风险未知，已由 010 / TC-D9 跟踪）。
- `A2-a/A2-b` 的 ACL 审批结果（`docs/ACL申请清单-v2.md`，用户所有）。

设备相关验收（AC-22 ~ AC-31）全部维持 `未验证`（无设备）。

---

## 9. 复现命令清单（下一次接手可直接执行）

```bash
# 语法
node --check src-main/market-runtime.js
node --check scripts/fetch-market-runtime.mjs
node --check scripts/tests/market-runtime.test.mjs
node --check scripts/tests/artifact-integrity.test.mjs

# 单测
node --test scripts/tests/market-runtime.test.mjs scripts/tests/artifact-integrity.test.mjs

# 获取脚本的响亮失败（未提供来源时必须非零退出）
node scripts/fetch-market-runtime.mjs

# 获取路径 A 运行时（来源在 T1.1 决策后提供；本命令会访问网络）
node scripts/fetch-market-runtime.mjs --node-url <第三方 aarch64-ohos Node URL> [--node-sha256 <hex>]

# 权限静态断言（等价 TC-B4）
grep -nE "CUSTOM_SANDBOX|RUN_ANY_CODE|kernel\.ALLOW_EXTERNAL_NATIVE_CODE" \
  runtime-overlays/web_engine/src/main/module.json5
```
