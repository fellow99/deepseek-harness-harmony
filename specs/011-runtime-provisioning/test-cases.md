# 011-runtime-provisioning 测试用例

> 模块：011-runtime-provisioning
> 对应规格：[specs/011-runtime-provisioning/spec.md](./spec.md)
> 对应方案：[specs/011-runtime-provisioning/plan.md](./plan.md)
> 对应任务：[specs/011-runtime-provisioning/tasks.md](./tasks.md)
> Last Updated: 2026-09-18
>
> ⛔ **HNP 已整体移除（2026-09-23）**：`hnpPackages` 声明、`electron/hnp{,-src}/` 载荷与探针、`scripts/inject-hnp.ps1` 与 `inject-hnp-app.ps1`、以及 `build-hap.ps1` 的自动嵌入逻辑与 `-hnp` 产物**均已删除** —— 本工程不再使用 HNP（见 `docs/鸿蒙环境能力清单-v0.1.5.md` A.2 #30）。故本文件中**以 HNP 载荷/声明为对象的用例（TC-B2、TC-B3 等）与含 `inject-hnp.ps1` / `hnp/` 的步骤均不再适用**，仅作为当时的设计记录保留；**设备端第三方 HNP 仍被复用**（TC-D1 的设备路径复核仍有效）。

## 0. 测试环境与前置

| 项 | 值 |
|---|---|
| 目标设备 | `3QC0226526001227` |
| 系统 | HarmonyOS 6.1.0.135（API 24） |
| 应用包名 | `org.fellow99.DeepseekHarnessHarmony` |
| `hdc` | `D:/oh-workspace/command-line-tools/sdk/default/openharmony/toolchains/hdc.exe` |
| 构建前置 | `DEVECO_SDK_HOME=d:\oh-workspace\command-line-tools\sdk\`；`export MSYS_NO_PATHCONV=1` |
| 设备侧 `$DSH_HOME` | `<userData>/.dsh`（即 `/data/storage/el2/base/files/.dsh`） |
| 调试通道 | `hdc fport tcp:19229 tcp:9229` → CDP `Runtime.evaluate`（主进程 `--inspect`） |
| 关键坑 | `--inspect` 的 `Runtime.evaluate` 必须带 `includeCommandLineAPI: true`，否则 `require` 未定义；用 `require` 而非 `import()`（沿用 202 / 010 的实测结论） |
| HNP 设备路径 | `HNP_PUBLIC_HOME=/data/service/hnp`，软链接目录 `/data/service/hnp/bin` |

> **本组用例的首要目的**：验证"市场安装通道"在**构建期**、**单元**、**真机**三个层面都闭合。
> **纪律**：真机用例在**当前无设备可用**时全部标 `未验证`；不得据源码推断其上结论。任何标注 `[设备实测]` 的预期值只覆盖 §4 来源中明确记录过的测量。

---

## 1. 构建期用例（可运行）

### TC-B1 —— 运行时获取幂等与防截断（AC-9）

| 项 | 内容 |
|---|---|
| 目的 | 验证 `fetch-market-runtime.mjs` 的幂等跳过错、以及截断产物不被记为"就绪" |
| 前置 | `runtime/` 尚无产物，或存在一个完整产物 |
| 步骤 | 1. `node scripts/fetch-market-runtime.mjs`<br>2. 再次运行同一命令<br>3. 人为把产物截断为前半（`fs.truncateSync`），删除版本戳，再运行 |
| 期望 | 第 1 次下载并写版本戳；第 2 次打印"已就绪，跳过"且不改戳；第 3 次结构校验失败、**非零退出**、**不写戳** |
| 证据 | 三次运行输出 + 版本戳内容 |
| 失败含义 | 截断产物被当成完整产物 → 设备上运行时不可用，且静默遮蔽设备可能可用的运行时 |

### TC-B2 —— HNP 载荷清单合法（AC-12）

| 项 | 内容 |
|---|---|
| 目的 | 验证 `electron/hnp-src-runtime/hnp.json` 结构合法且 `links` 正确 |
| 步骤 | `node -e "const j=require('./electron/hnp-src-runtime/hnp.json'); ..."` 断言 `type==='hnp-config'`、`name` 无空格 / 特殊字符、`install.links` 恰含 `node` 与 `pnpm`、`target` 为裸命令名 |
| 期望 | 全部断言通过 |
| 证据 | 断言输出 |
| 失败含义 | 清单非法 → HNP 打包 / 安装失败（`name`/`version` 不得含空格或特殊字符） |

### TC-B3 —— `module.json5` 源与 overlay 一致（AC-7、plan D13）

| 项 | 内容 |
|---|---|
| 目的 | 验证 `hnpPackages` 与 `requestPermissions` 的改动未被 overlay 回盖 |
| 步骤 | 1. `node scripts/collect-runtime.mjs --verify-only`<br>2. 比对 `electron/src/main/module.json5` 与 `runtime-overlays/electron/src/main/module.json5` 的 `hnpPackages` / `requestPermissions` |
| 期望 | `--verify-only` 退出码 0；两文件的 `hnpPackages` 逐条一致；`requestPermissions` 一致 |
| 证据 | 退出码 + 两文件 diff |
| 失败含义 | overlay 回盖会把源改动静默覆盖；或阶段 7.6 守卫失败 |

### TC-B4 —— 权限静态断言（AC-7）

| 项 | 内容 |
|---|---|
| 目的 | 验证未引入禁用权限 |
| 步骤 | `grep -nE "CUSTOM_SANDBOX\|RUN_ANY_CODE\|kernel\.ALLOW_EXTERNAL_NATIVE_CODE" electron/src/main/module.json5 runtime-overlays/electron/src/main/module.json5` |
| 期望 | 零命中（`ALLOW_EXTERNAL_NATIVE_CODE` 若为备选形态而声明，须为无 `kernel.` 前缀的正确名） |
| 证据 | grep 输出 |
| 失败含义 | `CUSTOM_SANDBOX` / `RUN_ANY_CODE` 是 system-only / 第三方不可得；`kernel.ALLOW_EXTERNAL_NATIVE_CODE` **根本不存在**，按此名申请必失败 |

### TC-B5 —— `.permission` 合法且为 HAP 权限子集（AC-8，仅备选形态）

| 项 | 内容 |
|---|---|
| 目的 | 验证独立二进制的 `.permission` 节满足安装期硬约束 |
| 步骤 | 1. `JSON.parse` 生成的 `.permission` 内容<br>2. 断言其 `requestPermissions[].name` 集合 ⊆ HAP `requestPermissions[].name`<br>3. 注入一个超集权限 / 非法 JSON，各跑一次构建 |
| 期望 | 正常内容通过；超集 → 构建非零退出；非法 JSON → 构建非零退出 |
| 证据 | 三次构建退出码 |
| 失败含义 | 超集或非法 JSON 会使**整包 HAP 安装失败**，且失败发生在安装期而非构建期时排查成本极高 |

### TC-B6 —— 路径 B 物化与补丁幂等（AC-14、AC-16）

| 项 | 内容 |
|---|---|
| 目的 | 验证 `dsh-market` 进程内补丁可应用且幂等，产物不含 spawn |
| 步骤 | 1. 在 `../dsh-market` 干净树 `git apply --check patches/dsh-market-v1.26.0/dsh-market-in-process-pnpm.patch`<br>2. 应用后再次 `git apply --reverse --check`（应报已应用）<br>3. `collect-dsh` 后 grep 构建产物 `dshmarket` 的 spawn 点 |
| 期望 | `--check` 通过；二次幂等；产物中 `node:child_process` 的 `spawn` 调用已改写为进程内分支 |
| 证据 | git apply 输出 + grep |
| 失败含义 | 补丁失配 → 安装通道构建失败；spawn 未改写 → 路径 B 在设备上仍走 spawn，必失败 |

### TC-B7 —— 未恢复上游禁用（AC-19）

| 项 | 内容 |
|---|---|
| 目的 | 验证未重新启用 PTY / subprocess / sandbox |
| 步骤 | grep `profiles/desktop/cordis.patch.yml` 的 `subprocess` / `sandbox` / `bash-sandbox` / `permission` 四行仍为 `disabled: true`；全工程无新增启用 |
| 期望 | 四行禁用保持；无新增启用 |
| 证据 | grep 输出 |
| 失败含义 | 重新启用会撞上 L1（PTY 被 SELinux 拒）与 L2（node-pty win32-x64 不可加载） |

### TC-B8 —— 文档纪律（AC-1、AC-21）

| 项 | 内容 |
|---|---|
| 目的 | 验证四份文档无占位、无路线图、未验证项已标注 |
| 步骤 | `grep -nE "TBD\|TODO\|待补\|待办\|roadmap" specs/011-runtime-provisioning/*.md`；并核对 `未验证` / `[NEEDS CLARIFICATION]` 出现处 |
| 期望 | 无占位文本（"不含路线图 / 待办章节"这类**否定表述**不算命中，人工甄别）；未验证项均带标记 |
| 证据 | grep 输出 + 人工核对 |

### TC-B9 —— HAP 构建与签名断言

| 项 | 内容 |
|---|---|
| 目的 | 确认改动不破坏打包链路 |
| 步骤 | `powershell -ExecutionPolicy Bypass -File scripts\build-hap.ps1 -BuildMode debug -SignMode debug`（路径 A 再跑 `inject-hnp.ps1`） |
| 期望 | 退出码 0；产物生成；`build-hap.ps1` 内置签名断言（profile type == 请求 SignMode）通过；路径 A 的产物 zip 含 `hnp/arm64-v8a/dshruntime.hnp` |
| 证据 | 构建尾部输出 + zip 条目列举 |

---

## 2. 单元用例（可运行）

### TC-U1 —— 选路与禁跳级（AC-3、AC-15）

| 项 | 内容 |
|---|---|
| 目的 | 验证 §4.3 的有序决策规则 |
| 步骤 | `node --test src-main/tests/market-runtime.test.mjs` |
| 期望 | A 产物校验通过 → 选 A；A 不可用 + B JS 就位 → 选 B；A/B 不可用 + C 探针通过 → 选 C；全不可用 → 显式失败（含 `reason`，不抛异常）；**A 可用时选 C 的用例必须失败**（禁跳级）；C 结果含 `device-environment` 标记，A/B 不含 |
| 证据 | 测试输出 |
| 失败含义 | 跳级会让"可用的 A"被"机会性的 C"覆盖，违背 §4.2 |

### TC-U2 —— 完整性校验矩阵（AC-9）

| 项 | 内容 |
|---|---|
| 目的 | 验证 `isUsableExecutable` / `isParsableJs` |
| 步骤 | `node --test src-main/tests/artifact-integrity.test.mjs` |
| 期望 | 合法 aarch64 ELF 通过；截断 ELF（节表越界）拒绝；x86_64 ELF（`e_machine` 非 `0xB7`）拒绝；非 ELF（`PNG` magic）拒绝；空文件拒绝；不存在文件返回 false **且不抛异常**；非空 JS 入口通过，空 / 不存在拒绝 |
| 证据 | 测试输出 |
| 失败含义 | 校验放过截断产物 → 遮蔽设备可用运行时；抛异常 → 启动期崩溃 |

### TC-U3 —— PATH 顺序与 `PNPM_HOME`（AC-10、AC-11）

| 项 | 内容 |
|---|---|
| 目的 | 验证注入顺序与 `PNPM_HOME` |
| 步骤 | 同上测试文件的 PATH / PNPM_HOME 用例 |
| 期望 | 顺序 `[binDir, pnpmDir, nodeDir, ...prev]`；校验失败目录**不**入前缀；已在 PATH 的项不重复；空项剔除；`PNPM_HOME` 指向 `pnpmDir`（路径 A 为 `/data/service/hnp/bin`） |
| 证据 | 测试输出 |
| 失败含义 | 损坏目录被前置 → 遮蔽；`PNPM_HOME` 未设 → 市场搜索列表首项不是本工程目录 |

### TC-U4 —— shim 内容（AC-12）

| 项 | 内容 |
|---|---|
| 目的 | 验证 shim 文本与创建 mode |
| 步骤 | 同上测试文件的 shim 用例 |
| 期望 | POSIX 精确等于 `#!/bin/sh\nexec "<node>" "<DSH_ROOT>/lib/bin.js" "$@"\n`；Windows 对应 `.cmd` 形态；`writeFileSync` 的 `options.mode === 0o755`；重复调用覆盖写入 |
| 证据 | 测试输出 |

### TC-U5 —— `provisionHint` 三分支（AC-17）

| 项 | 内容 |
|---|---|
| 目的 | 验证市场提示在失败形态下可达且双语 |
| 步骤 | `node --test src-main/tests/provision-hint.test.mjs` |
| 期望 | "Node 不可达（`npmFound=false` 或 corepack/npm 均 ENOENT）"、"pnpm 存在但 `pnpm --version` 失败"、"装好但不在搜索路径"三分支各返回非空双语文本；鸿蒙特有形态（`13900012`、`node -e` 无输出）返回可操作文本 |
| 证据 | 测试输出 |
| 失败含义 | 设备上安装按钮转圈而无提示，用户与模型都无从下手 |

---

## 3. 真机用例（`未验证`，当前无设备）

> 以下全部状态 `❓ 未验证`。命令中的 `<...>` 为占位符，真机执行时替换。

### TC-D1 —— 设备 HNP 清单与软链接（AC-22）

| 项 | 内容 |
|---|---|
| 目的 | 复核设备当前 HNP 布局与 §3.2 基线 |
| 步骤 | `hdc shell "echo HNP_PUBLIC_HOME=$HNP_PUBLIC_HOME; ls -l /data/service/hnp; ls -l /data/service/hnp/bin"` |
| 期望 | `/data/service/hnp` = `[bin, dshprobe.org, node.org, python.org]`；`/data/service/hnp/bin` = `[dsh-probe, node, npm, npx, python, python3, python3.12]`（若与基线不同，如实记录） |
| 证据 | `ls -l` 输出 |
| 失败含义 | 与基线不一致 → 路径 C 的探测前提变化，需重估 |

### TC-D2 —— 设备第三方 `node -e` 行为复现（AC-23）

| 项 | 内容 |
|---|---|
| 目的 | 复现并尝试定位 `node -e` 无输出（现基线：3 次复现，原因未定位） |
| 步骤 | 1. `hdc shell "/data/service/hnp/bin/node -v"`<br>2. `hdc shell "/data/service/hnp/bin/node -e \"process.stdout.write('OK')\""`<br>3. `hdc shell "/data/service/hnp/bin/node -e \"console.error('ERR')\""`<br>4. 经 CDP 在 Electron 内 `spawnSync('/data/service/hnp/bin/node', ['-e', "process.stdout.write('OK')"], {encoding:'utf8'})` 并读 `stdout`/`stderr`/`status` |
| 期望 | `-v` 输出 `v24.13.0`（或当前版本）；`-e`：**如实记录现象**（无输出 / 有输出 / 非零退出）。**不作猜测** |
| 证据 | 每次的 stdout / stderr / 退出码 |
| 失败含义 | 若 `-e` 无输出 → 路径 C 的探针门槛不通过，路径 C 在本设备上实际不可用（正是"不得作为产品能力"的实证） |
| 标注 | ❓ `未验证`；根因未定位前不得据此推断任何结论 |

### TC-D3 —— 市场探测 `pnpm --version` 与注入环境（AC-24）

| 项 | 内容 |
|---|---|
| 目的 | 验证注入后的 PATH / `PNPM_HOME` 是否让市场找得到 pnpm；并确认 `dshArgv()` 命中分支 |
| 前置 | 新 HAP 已安装并启动；应用处于前台 |
| 步骤 | 1. `hdc fport tcp:19229 tcp:9229`；CDP 连接主进程<br>2. CDP 求值：`JSON.stringify({path:process.env.PATH, pnpmHome:process.env.PNPM_HOME, execPath:process.execPath, argv0:process.argv0, argv1:process.argv[1], runtime:{...globalThis.__marketRuntime}})`<br>3. CDP 求值：`require('node:child_process').spawnSync('pnpm',['--version'],{encoding:'utf8'})`（读 `status`/`stdout`/`stderr`/`error`）<br>4. CDP 求值：`require('node:fs').existsSync('<userData>/runtime-bin/dsh')` 与对 shim 的 `spawnSync` |
| 期望 | `PATH` 前缀含 `<userData>/runtime-bin` 与运行时目录（或路径 A 下 `/data/service/hnp/bin`）；`PNPM_HOME` 已设；`pnpm --version` 返回成功与版本号；shim 存在。**如实记录**（`未验证`） |
| 证据 | CDP 返回的 JSON 与 spawn 结果 |
| 失败含义 | 找不到 pnpm → 市场 `probePnpm()` 返回 `missing`/`failed`，安装入口不可用 |
| 备注 | `dshmarket` 的 `spawnEnv()` 在 spawn 时读 `process.env.PATH`（`dsh-cli.ts:235-250`），故注入结果必须在 Host 起来前写好 |

### TC-D4 —— `dsh plugin` 通道（AC-25）

| 项 | 内容 |
|---|---|
| 目的 | 验证端到端安装通道 |
| 步骤 | 1. CDP 求值：`require('node:child_process').spawnSync('dsh',['plugin','--profile','desktop','add','<npm-pkg>'],{encoding:'utf8',timeout:900000})`<br>2. 经市场 UI 触发同一安装（设置页 → 插件市场 → 安装）<br>3. 两个方向都记录 `stdout` / `stderr` / `status` / `signal` |
| 期望 | 路径 A/C：命令成功、插件出现在 `$DSH_HOME/profiles/desktop`；路径 B：进程内通道成功（spawn 不被使用）。**如实记录**（`未验证`） |
| 证据 | 两份结果 + 安装后的目录清单 |
| 失败含义 | shim 不命中 / pnpm 入口缺失 / 路径 B 补丁未生效 |
| 备注 | **当前最高概率的失败点**是 shim 的可执行位（TC-D6）与 `dshArgv()` 是否命中（TC-D3） |

### TC-D5 —— 市场日志与 `provisionHint`（AC-30）

| 项 | 内容 |
|---|---|
| 目的 | 验证失败时用户能看到可操作提示 |
| 步骤 | 1. `hdc shell "hilog -x \| grep dsh-harmony \| tail -60"`（启动日志含采用的路径 / PATH / PNPM_HOME）<br>2. 在设置页触发"自动准备 pnpm"，读市场 UI 文本与 CDP console<br>3. 记录 `provisionHint` 的实际输出 |
| 期望 | 启动日志含 `[dsh-harmony]` 前缀的路径标记；市场 UI 给出与失败形态匹配的双语提示（`provisionHint`），非"永远转圈" |
| 证据 | hilog 片段 + UI 文本 + `provisionHint` 输出 |
| 失败含义 | 静默降级 → 用户无从下手（FR-6.1 禁止） |

### TC-D6 —— shim 可执行位（AC-12 / plan Q2）

| 项 | 内容 |
|---|---|
| 目的 | 验证 B1 下 `writeFileSync(..., {mode:0o755})` 是否真给出可执行位 |
| 步骤 | 1. CDP 求值：对 `<userData>/runtime-bin/dsh` 做 `fs.statSync().mode.toString(8)`<br>2. CDP 求值：`spawnSync('<userData>/runtime-bin/dsh',['--version'])`<br>3. 若不具可执行位，改试 `spawnSync('/bin/sh',['<shim>','--version'])` |
| 期望 | **如实记录**可执行位与两种调用结果（`未验证`） |
| 证据 | `mode` 八进制 + 两次 spawn 结果 |
| 失败含义 | 若不可 exec 且 `sh <shim>` 也不可行 → shim 形态必须退化或改走路径 B |
| 标注 | ❓ `未验证` |

### TC-D7 —— ELF 执行与签名结果（AC-28、plan Q3/Q7）

| 项 | 内容 |
|---|---|
| 目的 | 验证已签名 ELF 可执行、未签名 / 用户目录 ELF 被拒；并验证 `pnpm` 入口 |
| 步骤 | 1. `hdc shell "/data/service/hnp/bin/node -v"`（HNP 已签名 ELF）<br>2. `hdc shell "/data/service/hnp/bin/pnpm --version"`（路径 A 的 pnpm 入口）<br>3. CDP：把 `<某 ELF>` 复制到 `/data/storage/el2/base/files/aaa/`（用户目录 / hmdfs）后执行，观察是否被拒<br>4. 用 `binary-sign-tool display-sign -inFile <elf>` 读签名信息 |
| 期望 | 1 成功（若已签名且 B2 满足）；2 成功或给出明确失败（`pnpm-linuxstatic` 在 OpenHarmony 上 `未验证`）；3 预期失败（用户目录 ELF 被拒，B2）；4 显示签名 |
| 证据 | 各命令 stdout / stderr / 退出码 + display-sign 输出 |
| 失败含义 | 未签名 / 错误上下文 ELF 被执行 → B2 结论被推翻；`pnpm-linuxstatic` 不可运行 → 路径 A 需改第三方 ohos 构建 |
| 标注 | ❓ `未验证` |

### TC-D8 —— 生命周期脚本默认禁用（AC-16）

| 项 | 内容 |
|---|---|
| 目的 | 验证路径 B 下 `--ignore-scripts` 生效 |
| 步骤 | CDP / 市场安装一个带 `postinstall` 的探针 npm 包；观察脚本是否执行 |
| 期望 | 脚本**不被执行**；市场返回"ignored build scripts"类信息 |
| 证据 | 探针脚本的副产物是否存在 + 市场返回 |
| 失败含义 | 生命期脚本被执行 → 等于在 Electron 主进程内执行任意代码，安全属性失效 |
| 标注 | ❓ `未验证` |

### TC-D9 —— 签名 ELF 能否 `execve("/system/bin/sh")`（AC-29，最高风险未知）

| 项 | 内容 |
|---|---|
| 目的 | 确定本模块**最高风险未知** |
| 步骤 | 1. CDP 求值：`spawnSync('/data/service/hnp/bin/node',['-e',"require('node:child_process').spawnSync('/system/bin/sh',['-c','echo SH_OK'],{encoding:'utf8'})"])`，读结果<br>2. 若失败，记录 `error` / `status` / `stderr` |
| 期望 | **如实记录**是否放行；`未验证` 前**不得**假设可用 |
| 证据 | spawn 结果 |
| 失败含义 | 若放行 → 应用沙箱内引入命令执行面，须在安全章节更新；若拒绝 → 路径 A 的市场须直接执行 `node` / `pnpm`，不经 `sh` |
| 标注 | ❓ `未验证` |

### TC-D10 —— 既有能力不退化（AC-31）

| 项 | 内容 |
|---|---|
| 目的 | 确认运行时供给未牵连既有链路 |
| 步骤 | 1. 新建会话成功（无 `agent-preset/invalid`）<br>2. `fs-mutate` 的 `delete` / `move` 仍可用<br>3. 插件市场设置页入口可见、可浏览目录<br>4. `skill` 工具列出 `harmony-runtime-capabilities` |
| 期望 | 四项均正常 |
| 证据 | 对话文本 + 目录清单 + UI 文本 |
| 标注 | ❓ `未验证` |

---

## 4. 来源核验用例（不依赖设备）

### TC-S1 —— 根因 B0 / B1 / B2 / B3 的出处

| 项 | 内容 |
|---|---|
| 目的 | 落实"不臆测"：四条根因各有可指认来源 |
| 步骤 | 对照 `spec.md` §1.1 表：B0 指向 `specs/010-tool-bash/spec.md:139` 与 `docs/鸿蒙环境能力清单-v0.1.5.md:424,426`；B1 指向 `010:146` 与 `能力清单:246,249`（`cl.filemanagement.2` / `13900012`）；B2 指向 `能力清单:233,295`；B3 为设计推论（`/usr/bin/env` 存在性 `未验证`） |
| 期望 | 每一条都能在来源中找到对应文字，无推断冒充实测 |
| 证据 | 逐条对照结果 |

### TC-S2 —— 市场内部 spawn 点出处

| 项 | 内容 |
|---|---|
| 目的 | 落实 `dsh-cli.ts` 的行号引用 |
| 步骤 | 逐条核对 `spec.md` §1.1：`:6-7` 注释、`:50-54` `nodeExecutable`、`:68` `nodeBinDir`、`:172-195` `toolSearchDirs`、`:235-250` `spawnEnv`、`:307-321` `spawnShim`、`:328-340` `dshArgv`、`:617-638` `probePnpm`、`:662-690` `provisionPnpm`、`:730-780` `provisionHint`、`:895-972` `runDshPlugin`、`:252` 超时 |
| 期望 | 行号与符号一一对应 |
| 证据 | 逐条对照结果 |

### TC-S3 —— desktop 参考解出处

| 项 | 内容 |
|---|---|
| 目的 | 落实 `[参考]` 引用 |
| 步骤 | 核对 `deepseek-harness-desktop/scripts/fetch-runtime.mjs`（`:24-25` 版本常量、`:45` pnpm URL、`:64-85` 防截断、`:157-166` `isValidArtifact`、`:186` 版本戳、`:225-226` 写戳时机）与 `src/main/runtime.ts`（`:47-55` `dshShim`、`:73-125` `isUsableExecutable`、`:130-186` `setupMarketRuntime`、`:154` `chmod 0755`、`:181` PATH 前置） |
| 期望 | 行号与语义一致 |
| 证据 | 逐条对照结果 |

### TC-S4 —— 权限与 HNP 事实出处

| 项 | 内容 |
|---|---|
| 目的 | 落实 `[官方]` 声明的来源 |
| 步骤 | 对照 `docs/鸿蒙环境能力清单-v0.1.5.md`：`:232-234`（HNP / HAP 内二进制 / 外部原生代码）、`:262`（`ALLOW_EXTERNAL_NATIVE_CODE` 精确名与不存在 `kernel.*`）、`:268-271`（`LOAD_INDEPENDENT_LIBRARY` / normal 项）、`:275`（`.permission` 是 ELF 节 + 安装期约束）、`:277`（`executableBinaryPaths` 构建配置）、`:286`（未证实项）、`:288-297`（HNP 事实）；ACL 机制与二进制证书见 `README.md`（ACL 流程、`type` 4） |
| 期望 | 每条权限 / 事实可指认来源；未证实项在 `spec.md` 标 `未验证` |
| 证据 | 逐条对照结果 |

### TC-S5 —— 插件 ACL 不适用（AC-6）

| 项 | 内容 |
|---|---|
| 目的 | 落实范围裁定 |
| 步骤 | 对照 `spec.md` FR-5.5 的四个权限名与"Node 包 ≠ HarmonyOS plugin bundle"的裁定；grep 全工程确认未申请 |
| 期望 | 四权限零命中；裁定有文字记录 |
| 证据 | grep 输出 + 对照 |

---

## 5. 用例与验收标准对照

| 验收标准 | 覆盖用例 |
|---|---|
| AC-1 文档齐备 / 无占位 / 无路线图 | TC-B8 |
| AC-2 FR 六域齐备 | TC-S1、TC-S2（规范对照） |
| AC-3 三路径对比 + 主/兜底 + 决策规则 | TC-U1 |
| AC-4 二进制证书为用户所有且阻塞路径 A | TC-S4、Phase 0 登记（`tasks.md`） |
| AC-5 ACL 申请登记与机制 | TC-S4、Phase 0 登记（`tasks.md`） |
| AC-6 plugin ACL 不适用 | TC-S5、TC-B4 |
| AC-7 权限清单不含禁用项 | TC-B3、TC-B4 |
| AC-8 `.permission` 合法且为 HAP 权限子集 | TC-B5 |
| AC-9 完整性校验 | TC-B1、TC-U2 |
| AC-10 PATH 顺序 | TC-U3、TC-D3 |
| AC-11 `PNPM_HOME` | TC-U3、TC-D3 |
| AC-12 `dsh` shim 内容 | TC-B2、TC-U4、TC-D6 |
| AC-13 注入时机 | TC-D3（真机确认接线生效） |
| AC-14 路径 B 进程内改写点 | TC-B6、TC-D4 |
| AC-15 有序降级 + 禁跳级 + C 标记 | TC-U1 |
| AC-16 生命周期脚本默认禁用 | TC-B6、TC-D8 |
| AC-17 `provisionHint` 三分支 | TC-U5、TC-D5 |
| AC-18 日志 + 无静默降级 | TC-U1、TC-D5 |
| AC-19 未恢复上游禁用 | TC-B7 |
| AC-20 规范源 ↔ 技能同步 | 人工对照（`tasks.md` T7.2） |
| AC-21 未验证项标注 | TC-B8 |
| AC-22 设备 HNP 清单 | TC-D1 |
| AC-23 `node -e` 行为复现 | TC-D2 |
| AC-24 市场 `pnpm --version` 探测 | TC-D3 |
| AC-25 `dsh plugin` 通道 | TC-D4 |
| AC-26 路径 B 进程内 pnpm 安装 | TC-D4、TC-D8 |
| AC-27 路径 A HNP Node + pnpm 入口 | TC-D7、TC-B9 |
| AC-28 ELF 执行 / 签名结果 | TC-D7 |
| AC-29 签名 ELF `execve("/system/bin/sh")` | TC-D9 |
| AC-30 市场日志 / `provisionHint` | TC-D5 |
| AC-31 既有能力不退化 | TC-D10 |
