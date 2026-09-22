# 011-runtime-provisioning 任务拆解

> 模块：011-runtime-provisioning
> 对应规格：[specs/011-runtime-provisioning/spec.md](./spec.md)
> 对应方案：[specs/011-runtime-provisioning/plan.md](./plan.md)
> 对应用例：[specs/011-runtime-provisioning/test-cases.md](./test-cases.md)
> Last Updated: 2026-09-18

## 0. 使用说明

- 任务按**依赖顺序**排列；同一 Phase 内的任务可按标注的依赖并行。
- 每个任务的**验收检查**均可独立执行；除显式标注"用户所有"外，均为构建期 / 单元可验证项。
- **真机验证不在本文件**：所有需要设备的检查归入 `test-cases.md`，状态 `未验证`。
- 本文件是**依赖排序的任务拆解**，不是时间表；不含排期（spec §9.3）。
- **路径标记**：标注 `[路径 A]` / `[路径 B]` / `[A+B]` 的任务只服务对应机制；`[通用]` 三路径共用。

### 状态约定

| 标记 | 含义 |
|---|---|
| `[ ]` | 未开始 |
| `[~]` | 进行中 |
| `[x]` | 完成（验收检查通过） |
| `[用户]` | **用户所有**：由本项目外部（用户 / 企业）执行，工程侧只登记与消费其结果 |

---

## Phase 0 —— 前置外部依赖（用户所有）—— **0.1.5 已作废**

> ⛔ **本节整体作废（2026-09-22）**：**二进制证书对个人开发者不可得**（工单要求企业实体），而个人开发者身份是本工程当前主体 → **路径 A 撤回**；其附带的 ACL（T0.2）服务于自有 ELF，**一并失去意义**。
> **0.1.5 改为采用 §4.2 的路径 C（「路线一：主机装好 pnpm」），且不对该能力作上架承诺。** 因此本 Phase **无待办** —— 唯一动作是**用户在主机（系统终端）装好 `pnpm`**，见下方 T0.1′。
> 下列 T0.1–T0.4 原文**保留备查**（若将来具备企业资质并决定投入路径 A，可直接复用）。

### T0.1′ 【用户所有】在主机装好 `pnpm` —— **0.1.5 实际前置（替代 T0.1/T0.2）**

- **做什么**：在设备的**系统终端**（`u:r:sh:s0`，**不是应用域**）装 `pnpm`，使其落在应用 `PATH` 可见的目录（优先 `/data/service/hnp/bin`，该目录**已实测在应用 PATH 中**且其中 `node` 已通过结构校验）。
- **为什么必须在系统终端**：软链禁令**只作用于应用域** —— 应用域里 `ln -s` 报 `13900012`，而 shell 域实测 `ln -s` 与 `chmod` **均成功**。故 `npm i -g pnpm` 必须在系统终端 / `hdc shell` 里执行，否则 bin 入口根本建不出来。
- **依赖**：无（`node` 已就位）。
- **验收检查**：`hdc shell "readlink <pnpm 所在 PATH 目录>/pnpm"` 非空；且在**应用内**读回 `globalThis.__marketRuntime.ok === true`（`path` 应为 `C`）—— 即 `probePnpm()` 成功。
- **对应**：AC-11、AC-15、AC-24；**不作上架承诺**（见 §4.2）。
- **未验证**：主机补上 `pnpm` 后市场是否真能装插件（需设备复验）；第三方 `node` 的 `node -e` 在现设备**无输出**（原因未定位）—— 该门禁仍然生效。

---

### T0.1 【用户所有】提交二进制证书工单 —— **阻塞路径 A**（⛔ 0.1.5 作废，保留备查）

- **做什么**：经华为**在线工单系统**申请**二进制证书**（AGC 证书类型 `type` 4 = 二进制证书，用于二进制程序签名）。工单须提供：企业名称与资质 / 应用名称及 APP ID / 应用的业务场景与用途 / 申请的证书类型。该证书是路径 A 的 ELF 代码签名的**硬前置**。
- **文件**：无（外部流程）；工程侧结果登记于 `specs/011-runtime-provisioning/spec.md` §4.4 与本文件。
- **依赖**：无。
- **验收检查**：持有工单编号与受理回执；证书类型确认为 `type` 4；产出的证书材料（`.cer` / 私钥）可被 `binary-sign-tool` 用于 `sign`。
- **对应**：AC-4（阻塞路径 A / AC-27）
- **未验证**：工单受理时长、成功率、是否要求应用已上架、本项目是否具备受理资格——`spec.md` §4.4 全部标 `未验证`。

### T0.2 【用户所有】在 AGC 提交 ACL 申请 —— **阻塞路径 A 的 `executableBinaryPaths` 备选形态**（⛔ 0.1.5 作废，保留备查）

- **做什么**：AGC → 开发与服务 → 项目 → 应用 → `项目设置` → **ACL 权限** → 勾选"我已知晓" → 选权限 → 申请。申请项：
  - 必选：`ohos.permission.ALLOW_EXTERNAL_NATIVE_CODE`（system_basic / system_grant / since 23 / `[2in1]` / 受限）；
  - 按需：`ohos.permission.kernel.LOAD_INDEPENDENT_LIBRARY`（system_basic / since 20 / `[2in1]` / 受限）——**仅当**运行时需加载二进制证书签名的共享库时。
  - **注意权限名精确性**：**不存在** `ohos.permission.kernel.ALLOW_EXTERNAL_NATIVE_CODE`（按此名申请必失败）。
- **文件**：无（外部流程）；结果写入 release profile，工程侧登记于 `specs/011-runtime-provisioning/spec.md` §3.3 / FR-5.1。
- **依赖**：无（可与 T0.1 并行）。
- **验收检查**：AGC 的"已获取权限"列表含上述权限；**建 release profile 时权限被自动写入**；若 profile 已建而 ACL 后变更，**重建 profile**。单次申请 ≤ **30** 条；新申请须待当前申请完成。
- **对应**：AC-5（阻塞路径 A 备选形态 / AC-27）
- **未验证**：审核通过率与时长——`spec.md` §4.4 标 `未验证`。

### T0.3 【用户所有】申请理由与资质材料准备

- **做什么**：按 AGC 要求准备 `申请原因`（≤256 字）、`使用场景` 选择、可选附件。业务场景须与"应用启用捆绑引擎的 JIT 编译"一致（本工程既有 `ALLOW_WRITABLE_CODE_MEMORY` 的申请口径，`README.md`）。
- **文件**：无（外部材料）。
- **依赖**：无。
- **验收检查**：材料齐备且与 `template` / 官方 `发布准备工作` 页面要求一致。
- **对应**：AC-4 / AC-5

### T0.4 【用户所有】确认不申请 plugin ACL

- **做什么**：**不**申请 `SUPPORT_PLUGIN` / `INSTALL_PLUGIN_BUNDLE` / `UNINSTALL_PLUGIN_BUNDLE` / `PLUGIN_UPDATE`——它们只适用于 HarmonyOS plugin bundle，本市场安装的是 Node 包。
- **文件**：`specs/011-runtime-provisioning/spec.md` FR-5.5（记录裁定）。
- **依赖**：无。
- **验收检查**：AGC 申请清单**不含**上述四项。
- **对应**：AC-6

---

## Phase 1 —— 方案定型（路径 A / B / C 决策）

### T1.1 【通用】落定路径 A 的 Node 运行时来源与版本

- **做什么**：选定第三方 aarch64-ohos Node 构建的**发布方与具体版本**，登记其非官方属性；确认其产物为可用于 HNP 的 ELF。
- **文件**：`scripts/fetch-market-runtime.mjs`（版本常量）、`specs/011-runtime-provisioning/plan.md` §16 Q1 的答案记录。
- **依赖**：无（不阻塞路径 B）。
- **验收检查**：版本常量 + 发布方登记在案；文档如实标注"非 Node 官方产物"。
- **对应**：AC-4、plan §16 Q1
- **未验证**：该构建的实际质量——由 Phase 9 / 真机核实。

### T1.2 【通用】落定 pnpm 入口形态

- **做什么**：确定路径 A 用 standalone 单文件 pnpm（版本对齐 desktop `9.15.9` 的语义，实际版本另行固定）还是自有构建；路径 B 用官方 pnpm JS（锁定版本）。**记录 `pnpm-linuxstatic-arm64` 在 OpenHarmony 上的可用性为 `未验证`**。
- **文件**：`scripts/fetch-market-runtime.mjs`、`scripts/collect-dsh.mjs`（路径 B）。
- **依赖**：无。
- **验收检查**：两条路径的 pnpm 来源与版本常量写死并可复现。
- **对应**：AC-4、plan §16 Q3
- **未验证**：`pnpm-linuxstatic` 能否在 OpenHarmony 直接执行——真机 TC-D7 核实。

### T1.3 【通用】实现选路骨架 `selectRuntime()`

- **做什么**：实现 §4.3 的**有序决策规则**：A（产物就位且校验通过）→ B（pnpm JS 就位且 CLI 进程内可用）→ C（设备 node 探针通过）→ 显式失败。禁跳级；C 启用时返回带"设备环境"标记的结果。
- **文件**：`src-main/market-runtime.js`。
- **依赖**：T1.1、T1.2。
- **验收检查**：`node --test src-main/tests/market-runtime.test.mjs` 覆盖"四态选路 + 禁跳级 + C 标记"并通过。
- **对应**：AC-3、AC-15

### T1.4 【通用】把定型结论回写规范

- **做什么**：把 T1.1 / T1.2 / T1.3 的结论与剩余未验证项回写 `spec.md` §4 与 `plan.md` §16，保持"设计已定、未验证项显式"。
- **文件**：`specs/011-runtime-provisioning/spec.md`、`specs/011-runtime-provisioning/plan.md`。
- **依赖**：T1.1、T1.2、T1.3。
- **验收检查**：两份文档中无残留 `[NEEDS CLARIFICATION]`（除 §16 Q1 明确保留者）；未验证项仍带 `未验证`。
- **对应**：AC-1、AC-21

---

## Phase 2 —— 运行时获取与打包

### T2.1 【路径 A】新增 `scripts/fetch-market-runtime.mjs`

- **做什么**：拉取 Node（T1.1 选定）+ standalone pnpm 到 `runtime/`；下载先写 `.part`、比对 `Content-Length` 后 `rename`；重试 `3` 次；对产物做结构校验；**只在全部通过后写版本戳** `{node, pnpm, platform, arch}`。镜像 desktop `fetch-runtime.mjs` 的幂等与防截断语义。
- **文件**：`scripts/fetch-market-runtime.mjs`（新增，复用 `src-main/market-runtime.js` 的校验算法）。
- **依赖**：T1.1、T1.2、T1.3。
- **验收检查**：首次运行下载并写戳；二次运行跳过；人为截断一个产物后运行 → 非零退出且**不**更新戳。
- **对应**：AC-9、FR-1.1、FR-1.3、FR-1.5

### T2.2 【路径 A】新增 HNP 载荷清单 `electron/hnp-src-runtime/hnp.json`

- **做什么**：按 `plan.md` §6.1 写清单：`type: hnp-config`、`name: dshruntime`、固定 `version`、`install.links` 为 `{source:"/bin/node", target:"node"}` 与 `{source:"/bin/pnpm", target:"pnpm"}`。`name` / `version` 不含空格或特殊字符。
- **文件**：`electron/hnp-src-runtime/hnp.json`（新增）。
- **依赖**：T1.2。
- **验收检查**：JSON 合法；`type == "hnp-config"`；`links` 恰含 `node` / `pnpm` 两项且 target 为裸命令名。
- **对应**：AC-12、FR-1.4

### T2.3 【路径 A】路径 A 的 ELF 载荷就位

- **做什么**：由 T2.1 获取的 Node / pnpm 填入 `electron/hnp-src-runtime/bin/{node,pnpm}`；构建期由 `hnpcli` 打包为 `electron/hnp/arm64-v8a/dshruntime.hnp`（gitignored 产物）。
- **文件**：`electron/hnp-src-runtime/bin/node`、`electron/hnp-src-runtime/bin/pnpm`（构建期产物，不入库）、`electron/hnp/arm64-v8a/dshruntime.hnp`（gitignored）。
- **依赖**：T2.1、T2.2。
- **验收检查**：两份 ELF 通过结构校验（magic + `e_machine` = `AARCH64`）；`.hnp` 归档内含 `hnp.json` 与 `bin/` 两项。
- **对应**：AC-9、FR-1.3、FR-1.4

### T2.4 【路径 A】`module.json5` 增 `hnpPackages` 行（源 + overlay 双改）

- **做什么**：`hnpPackages` 增 `{ "package": "dshruntime.hnp", "type": "public" }`（保留既有 `dshprobe.hnp` 行不动）。**同时**改 `runtime-overlays/electron/src/main/module.json5`。
- **文件**：`electron/src/main/module.json5`、`runtime-overlays/electron/src/main/module.json5`。
- **依赖**：T2.2。
- **验收检查**：两文件 `hnpPackages` 逐条一致；`node scripts/collect-runtime.mjs --verify-only` 的 7.6 守卫通过。
- **对应**：AC-7、FR-1.4、plan D13

### T2.5 【路径 A】扩展 `scripts/inject-hnp.ps1` 以嵌入运行时载荷

- **做什么**：让 `inject-hnp.ps1` 在同一轮嵌入 `dshruntime.hnp`（与既有 `dshprobe.hnp` 并存）：`-HnpRoot` 指向一个含 `dshruntime.hnp` 的目录，或扩展支持第二载荷目录；保留其 `hnp/*` 存在性断言与 `verify-app`。
- **文件**：`scripts/inject-hnp.ps1`。
- **依赖**：T2.3、T2.4。
- **验收检查**：产物 `electron-default-signed-hnp.hap` 的 zip 条目含 `hnp/arm64-v8a/dshruntime.hnp`；`verify-app` 通过。
- **对应**：AC-27（真机）、plan §10

### T2.6 【路径 B】物化 pnpm JS 到 `dsh-dist`

- **做什么**：扩展 `collectDshMarket()`（或新增 `collectMarketPNPM()`），把锁定的 pnpm JS 及其依赖物化进 `dsh-dist/node_modules/`（布局由实现确定），并做**存在性断言**——缺失即 `process.exit(1)`，不产出残缺产物。
- **文件**：`scripts/collect-dsh.mjs`。
- **依赖**：T1.2。
- **验收检查**：`collect-dsh` 后 `dsh-dist` 内含 pnpm JS 入口；`node --check` 级语法校验通过；缺失时脚本非零退出。
- **对应**：AC-16、FR-1.2

---

## Phase 3 —— 安装与注入

### T3.1 【通用】实现 `setupMarketRuntime()`

- **做什么**：在 `src-main/market-runtime.js` 实现：探测（A/B/C）→ 校验将前置目录 → 组装 PATH / `PNPM_HOME` → （路径 A）生成 shim → 记录日志。**不得**抛异常；失败即降级到 §4.3 的下一序或显式失败。
- **文件**：`src-main/market-runtime.js`。
- **依赖**：T1.3、T2.1（A）、T2.6（B）。
- **验收检查**：单测覆盖四态选路与 PATH 组装；函数返回结构固定的结果对象（采用的路径 / 注入的目录 / 失败原因）。
- **对应**：AC-10、AC-11、AC-18、FR-2.2、FR-2.3

### T3.2 【通用】在 `startHost()` 内接线

- **做什么**：在 `src-main/main.js` 的 `startHost()` 内、`ensureDshPluginsProfileLink()`（`:472`）之后、`installExtraWritableRoots()`（`:474`）之前调用 `setupMarketRuntime()`；`require('./market-runtime.js')`。
- **文件**：`src-main/main.js`。
- **依赖**：T3.1。
- **验收检查**：grep 断言调用点在 `ensureDshPluginsProfileLink` 之后、`runProfile` 之前；`node --check src-main/main.js` 通过。
- **对应**：AC-13、FR-2.1、plan §3.2

### T3.3 【通用】注入结果日志

- **做什么**：以 `[dsh-harmony]` 前缀打印采用的路径（A/B/C）、各产物校验结果、最终 `PATH`、`PNPM_HOME`、shim 路径；降级原因显式。**禁止静默降级**。
- **文件**：`src-main/market-runtime.js`。
- **依赖**：T3.1。
- **验收检查**：单测断言日志函数在四种选路下都产生含路径标记的输出；grep 断言前缀为 `[dsh-harmony]`。
- **对应**：AC-18、FR-6.1

---

## Phase 4 —— shim / CLI 通道

### T4.1 【路径 A】生成 `dsh` shim

- **做什么**：实现 `dshShim()` 与写文件逻辑：POSIX 内容 `#!/bin/sh\nexec "<node>" "<DSH_ROOT>/lib/bin.js" "$@"\n`；`writeFileSync(..., { mode: 0o755 })`；每次启动重写。
- **文件**：`src-main/market-runtime.js`。
- **依赖**：T3.1。
- **验收检查**：单测断言 POSIX 内容精确匹配；`mode` 参数为 `0o755`；重复调用覆盖写入。
- **对应**：AC-12、FR-3.1、FR-3.2
- **未验证**：`mode: 0o755` 在 B1 下是否给出可执行位——真机 TC-D6。

### T4.2 【路径 B】新增 `dsh-market` 进程内补丁

- **做什么**：新建 `patches/dsh-market-v1.26.0/dsh-market-in-process-pnpm.patch`，按 `plan.md` §11.2 改写 `dshArgv()` / `spawnShim()` / `runDshPlugin()` / `probePnpm()` / `provisionPnpm()` 与 `dsh plugin` 内部 pnpm spawn；默认 `--ignore-scripts`；包装 `process.exit` 为抛异常；保存 / 恢复 `process.argv`。
- **文件**：`patches/dsh-market-v1.26.0/dsh-market-in-process-pnpm.patch`（新增）。
- **依赖**：T1.2。
- **验收检查**：在 `../dsh-market` 干净树 `git apply --check` 通过；`git apply --reverse --check` 幂等；补丁不含对 `deepseek-harness` 的改动。
- **对应**：AC-14、AC-16、FR-3.4

### T4.3 【路径 B】`build-dsh.mjs` 应用补丁

- **做什么**：在 `build-dsh.mjs` 的 `dsh-market` build **之前**应用 `patches/dsh-market-v1.26.0/`（幂等 `git apply --reverse --check`）。
- **文件**：`scripts/build-dsh.mjs`。
- **依赖**：T4.2。
- **验收检查**：首次 build 应用成功；二次 build 报告"已应用，跳过"；构建出的 `dshmarket/lib/dsh-cli.js` 无 `node:child_process` 的 spawn 调用（或仅剩进程内分支）。
- **对应**：AC-14

---

## Phase 5 —— 探测与降级

### T5.1 【通用】实现探测函数 `probeRuntimes()`

- **做什么**：探测：路径 A 产物存在性；路径 B 的 pnpm JS 入口存在 + 可解析；路径 C 的设备 `node` 存在 + `node -e` 探针（`node -e "process.stdout.write('ok')"`）通过。探测**不启动长驻子进程**（除 C 的单次短探针）。
- **文件**：`src-main/market-runtime.js`。
- **依赖**：T3.1。
- **验收检查**：单测以内存桩驱动四种探测结果；C 的探针在无输出 / 非零退出时判**不通过**（对齐现设备 `node -e` 无输出的实测）。
- **对应**：AC-15、FR-4.1
- **未验证**：设备 `node -e` 行为——真机 TC-D2。

### T5.2 【通用】实现完整性校验器

- **做什么**：实现 `isUsableExecutable(file, {platform, arch})`（ELF：magic + class 2 + `e_machine` `0xB7` + 节表不越界）与 `isParsableJs(file)`；**任意 IO / 解析异常返回 false，绝不抛出**；不启动子进程。
- **文件**：`src-main/market-runtime.js`。
- **依赖**：T1.3。
- **验收检查**：`node --test src-main/tests/artifact-integrity.test.mjs` 通过（合法 ELF / 截断 ELF / 非 ELF / 空文件 / x86_64 ELF / 不存在文件）。
- **对应**：AC-9、FR-1.3、§9

### T5.3 【通用】降级与显式失败

- **做什么**：按 §4.3 有序降级；全不可用时返回显式失败结果（**不阻塞应用启动**），并把原因交给 FR-6.3 的探针与日志。
- **文件**：`src-main/market-runtime.js`。
- **依赖**：T5.1、T5.2。
- **验收检查**：单测断言四态与"禁跳级"；显式失败时返回含 `reason` 的结果而非抛异常。
- **对应**：AC-15、AC-18

### T5.4 【通用】路径 C 的"设备环境"标注

- **做什么**：路径 C 启用时，在日志与返回结果中带固定标记（如 `source: 'device-environment'`）；市场 UI / 文档据此显示"复用了设备环境运行时，非本应用保障"。
- **文件**：`src-main/market-runtime.js`。
- **依赖**：T5.3。
- **验收检查**：单测断言 C 结果含 `device-environment` 标记；A/B 结果不含。
- **对应**：AC-15、FR-4.3

---

## Phase 6 —— 权限声明

### T6.1 【路径 A 备选形态】声明 normal 权限

- **做什么**：按需在 `module.json5` 的 `requestPermissions` 增 `INHERIT_PARENT_PERMISSION` / `kernel.IGNORE_LIBRARY_VALIDATION` / `kernel.EXEMPT_ANONYMOUS_EXECUTABLE_MEMORY` / `INTERNET` / `GET_NETWORK_INFO` / `ALLOW_COREDUMP`（**仅声明实际需要的**）。仅 `executableBinaryPaths` 备选形态需要 `ALLOW_EXTERNAL_NATIVE_CODE`。
- **文件**：`electron/src/main/module.json5`、`runtime-overlays/electron/src/main/module.json5`。
- **依赖**：T2.4。
- **验收检查**：新增项均属 normal（无需 ACL）或已在 T0.2 获批；**不**出现在权限清单里的 `CUSTOM_SANDBOX` / `RUN_ANY_CODE` / 不存在的 `kernel.ALLOW_EXTERNAL_NATIVE_CODE`。
- **对应**：AC-5、AC-7、FR-5.2

### T6.2 【路径 A 备选形态】生成 `.permission` 节

- **做什么**：为 `executableBinaryPaths` 的独立二进制生成合法 JSON 的 `.permission`（`{"requestPermissions":[…]}`），内容权限集合 ⊆ HAP `requestPermissions`；由 `binary-sign-tool sign … -moduleFile <module.json>` 注入。
- **文件**：构建脚本（生成命令）+ `electron/src/main/module.json5`。
- **依赖**：T0.2、T6.1。
- **验收检查**：`.permission` 可被 `JSON.parse`；权限集合为 HAP 声明的**子集**（否则安装失败）。
- **对应**：AC-8、FR-5.3

### T6.3 【路径 A 备选形态】权限子集断言

- **做什么**：构建期断言：bin 声明的权限集合 ⊆ HAP `requestPermissions`；`.permission` 为合法 JSON。断言失败即 `process.exit(1)`。
- **文件**：`scripts/collect-dsh.mjs`（或构建期断言脚本）。
- **依赖**：T6.2。
- **验收检查**：注入一个超集权限 → 构建失败；注入非法 JSON → 构建失败。
- **对应**：AC-8

### T6.4 【通用】确认不申请 plugin ACL

- **做什么**：在 `module.json5` 与申请清单中**不**出现 `SUPPORT_PLUGIN` / `INSTALL_PLUGIN_BUNDLE` / `UNINSTALL_PLUGIN_BUNDLE` / `PLUGIN_UPDATE`。
- **文件**：`electron/src/main/module.json5`、`specs/011-runtime-provisioning/spec.md` FR-5.5。
- **依赖**：T0.4。
- **验收检查**：全工程 grep 四项零命中；规范记录了"不适用"的裁定。
- **对应**：AC-6

---

## Phase 7 —— 文档 / 技能同步

### T7.1 【通用】关闭 201 的 `[NEEDS CLARIFICATION]`

- **做什么**：更新 `specs/201-dsh-market/spec.md:35,131` 的"便携 Node/pnpm 运行时与 `dsh plugin` 安装/删除通道"表述，指向 011；按实际落地状态标注（路径 B 已落地 / 路径 A 待证书）。
- **文件**：`specs/201-dsh-market/spec.md`。
- **依赖**：Phase 3–6 完成（取决于落地形态）。
- **验收检查**：`201` 不再把该通道整体记为 `[NEEDS CLARIFICATION]`，而是指向 011 与当前路径。
- **对应**：AC-20

### T7.2 【通用】同步内置技能（强制）

- **做什么**：更新 `skills/harmony-runtime-capabilities/SKILL.md`，使其反映 011 交付后安装通道的真实状态（可装 / 不可装、限制如 `git:` 源不可装、路径 C 不得作为能力）。**单向**：先改本规范，再改技能。
- **文件**：`skills/harmony-runtime-capabilities/SKILL.md`。
- **依赖**：T7.1。
- **验收检查**：技能正文与 `spec.md` 的能力表述一致；未把路径 C 写成产品能力。
- **对应**：AC-20、spec §9.5

### T7.3 【通用】更新工程 README

- **做什么**：在 `README.md` / `README_zh.md` 的构建阶段与运行期说明中增 011 的运行时供给说明，并如实记录上架约束（二进制证书 / ACL、plugin ACL 不适用）。
- **文件**：`README.md` / `README_zh.md`。
- **依赖**：T7.1。
- **验收检查**：README 含运行时供给与前置外部依赖；无排期 / 路线图。
- **对应**：AC-4、AC-20

---

## Phase 8 —— 单元测试收口

### T8.1 【通用】`market-runtime.test.mjs`

- **做什么**：覆盖选路（四态 / 禁跳级 / C 标记）、PATH 顺序、`PNPM_HOME`、shim 内容。
- **文件**：`src-main/tests/market-runtime.test.mjs`。
- **依赖**：T3.1、T5.1、T5.3、T5.4、T4.1。
- **验收检查**：`node --test src-main/tests/market-runtime.test.mjs` 通过。
- **对应**：AC-10、AC-11、AC-12、AC-15

### T8.2 【通用】`artifact-integrity.test.mjs`

- **做什么**：覆盖合法性校验矩阵与"异常不抛出"。
- **文件**：`src-main/tests/artifact-integrity.test.mjs`。
- **依赖**：T5.2。
- **验收检查**：`node --test src-main/tests/artifact-integrity.test.mjs` 通过。
- **对应**：AC-9

### T8.3 【通用】`provision-hint.test.mjs`

- **做什么**：覆盖 `provisionHint()` 三分支（Node 不可达 / npm 不在搜索路径 / pnpm 存在但运行失败）的双语形态，并含鸿蒙特有形态（`13900012`、`node -e` 无输出）的可操作文本。
- **文件**：`src-main/tests/provision-hint.test.mjs`。
- **依赖**：T3.1。
- **验收检查**：`node --test src-main/tests/provision-hint.test.mjs` 通过。
- **对应**：AC-17

### T8.4 【通用】跑通单测

- **做什么**：把上述三个测试文件接入工程 `npm test`（或等价入口）并全部通过。
- **文件**：`package.json`（测试脚本）。
- **依赖**：T8.1、T8.2、T8.3。
- **验收检查**：`npm test` 退出码 0。
- **对应**：AC-9、AC-10、AC-11、AC-12、AC-15、AC-17

---

## Phase 9 —— 构建验证

### T9.1 【通用】获取脚本幂等与防截断断言

- **做什么**：`fetch-market-runtime.mjs` 的幂等（二次跳过）与防截断（截断后非零退出且不写戳）断言。
- **文件**：`scripts/fetch-market-runtime.mjs`（+ 测试脚本）。
- **依赖**：T2.1、T5.2。
- **验收检查**：二次运行打印"已就绪，跳过"；人为截断 → 非零退出。
- **对应**：AC-9

### T9.2 【路径 B】`collect-dsh` 物化断言

- **做什么**：`collect-dsh` 后断言 `dsh-dist` 内含路径 B 的 pnpm JS 入口；断言失败即硬失败。
- **文件**：`scripts/collect-dsh.mjs`。
- **依赖**：T2.6。
- **验收检查**：产物含入口文件；缺入口时脚本非零退出。
- **对应**：AC-16

### T9.3 【路径 A】overlay 守卫通过

- **做什么**：`node scripts/collect-runtime.mjs --verify-only` 的 7.6 / 7.10 守卫通过（`module.json5` 源与 overlay 一致）。
- **文件**：`runtime-overlays/electron/src/main/module.json5`。
- **依赖**：T2.4。
- **验收检查**：`--verify-only` 退出码 0。
- **对应**：AC-7、plan D13

### T9.4 【路径 A】HNP 嵌入 + 重签 + 验证断言

- **做什么**：`inject-hnp.ps1` 产出含 `hnp/arm64-v8a/dshruntime.hnp` 的 signed HAP；`verify-app` 通过；zip 条目含该包。
- **文件**：`scripts/inject-hnp.ps1`。
- **依赖**：T2.5。
- **验收检查**：`verify-app` 退出码 0；`hnp/*` 条目含 `dshruntime.hnp`。
- **对应**：AC-27（真机执行另计）

### T9.5 【通用】权限静态断言（AC-7）

- **做什么**：grep `module.json5`（源 + overlay）断言不含 `CUSTOM_SANDBOX` / `RUN_ANY_CODE` / `kernel.ALLOW_EXTERNAL_NATIVE_CODE`。
- **文件**：`electron/src/main/module.json5`、`runtime-overlays/electron/src/main/module.json5`。
- **依赖**：T6.1、T6.4。
- **验收检查**：三个令牌零命中。
- **对应**：AC-7

### T9.6 【通用】未恢复上游禁用断言（AC-19）

- **做什么**：断言未新增启用 `node-pty` / PTY / 上游 `subprocess` / `sandbox` / `bash-sandbox` / `permission`（`profiles/desktop/cordis.patch.yml` 四行禁用保持）。
- **文件**：`profiles/desktop/cordis.patch.yml`（来源核验）、全工程 grep。
- **依赖**：无。
- **验收检查**：四行仍 `disabled: true`；无新增启用。
- **对应**：AC-19

### T9.7 【通用】文档纪律断言（AC-1 / AC-21）

- **做什么**：grep 四份文档：无占位文本（`TBD` / `TODO` / `待补`）、无路线图 / 待办章节、未验证项带 `未验证` / `[NEEDS CLARIFICATION]`。
- **文件**：`specs/011-runtime-provisioning/{spec,plan,tasks,test-cases}.md`。
- **依赖**：无。
- **验收检查**：断言全通过。
- **对应**：AC-1、AC-21

### T9.8 【通用】全量 HAP 构建

- **做什么**：`build-hap.ps1`（debug / debug-signed）完整构建，含既有签名断言。
- **文件**：`scripts/build-hap.ps1`（既有）。
- **依赖**：T9.1–T9.7。
- **验收检查**：退出码 0；产物生成；`build-hap.ps1` 内置签名断言（profile type == 请求 SignMode）通过。
- **对应**：全部构建期 AC

---

## 10. 任务 → AC 汇总

| AC | 覆盖任务 |
|---|---|
| AC-1 文档齐备 / 无占位 / 无路线图 | T1.4、T9.7 |
| AC-2 FR 六域齐备 | T1.4 |
| AC-3 三路径对比 + 主/兜底 + 决策规则 | T1.3、T1.4 |
| AC-4 二进制证书为用户所有且阻塞路径 A | T0.1、T0.3、T7.3 |
| AC-5 ACL 申请登记与机制 | T0.2、T6.1 |
| AC-6 plugin ACL 不适用 | T0.4、T6.4 |
| AC-7 权限清单不含禁用项 | T2.4、T6.1、T9.3、T9.5 |
| AC-8 `.permission` 合法且为 HAP 权限子集 | T6.2、T6.3 |
| AC-9 完整性校验 | T2.1、T2.3、T5.2、T8.2、T9.1 |
| AC-10 PATH 顺序 | T3.1、T8.1 |
| AC-11 `PNPM_HOME` | T3.1、T8.1 |
| AC-12 `dsh` shim 内容 | T2.2、T4.1、T8.1 |
| AC-13 注入时机 | T3.2 |
| AC-14 路径 B 进程内改写点 | T4.2、T4.3 |
| AC-15 有序降级 + 禁跳级 + C 标记 | T1.3、T5.1、T5.3、T5.4、T8.1 |
| AC-16 生命周期脚本默认禁用 | T2.6、T4.2、T9.2 |
| AC-17 `provisionHint` 三分支 | T8.3 |
| AC-18 日志 + 无静默降级 | T3.1、T3.3、T5.3 |
| AC-19 未恢复上游禁用 | T9.6 |
| AC-20 规范源 ↔ 技能同步 | T7.1、T7.2 |
| AC-21 未验证项标注 | T1.4、T9.7 |
| AC-22 ~ AC-31 真机 | `test-cases.md` §2（`未验证`），无构建期任务 |
