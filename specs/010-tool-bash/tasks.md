# 010-tool-bash 任务拆解

> 模块：010-tool-bash
> 对应规格：[specs/010-tool-bash/spec.md](./spec.md)
> 对应方案：[specs/010-tool-bash/plan.md](./plan.md)
> 对应用例：[specs/010-tool-bash/test-cases.md](./test-cases.md)
> Last Updated: 2026-09-18

## 0. 使用说明

- 任务按**依赖顺序**排列；同一 Phase 内的任务可按标注的依赖并行。
- 每个任务的**验收检查**均可独立执行；全部为构建期 / 单元可验证项。
- **真机验证不在本文件**：所有需要设备的检查归入 `test-cases.md`，状态 `未验证`。
- 本文件是**依赖排序的任务拆解**，不是时间表；不含排期（spec §8.3）。

### 状态约定

| 标记 | 含义 |
|---|---|
| `[ ]` | 未开始 |
| `[~]` | 进行中 |
| `[x]` | 完成（验收检查通过） |

---

## Phase 1 —— 插件骨架

### T1.1 创建插件目录与包元数据

- **做什么**：新建 `plugins/harmony-plugin-exec/package.json`，`name` = `harmony-plugin-exec`（裸包名、非 scoped），`private: true`，`type: "module"`，`main` / `exports` 指向 `lib/index.js`，`scripts.test` 串联三个单测；`peerDependencies` 声明 `@deepseek-ai/cordis` / `@deepseek-ai/dsh-tools` / `@deepseek-ai/dsh-sandbox` / `@deepseek-ai/dsh-fs` / `@deepseek-ai/schemastery`。
- **文件**：`plugins/harmony-plugin-exec/package.json`
- **依赖**：无
- **验收检查**：`node -e "const p=require('./plugins/harmony-plugin-exec/package.json'); if(p.name!=='harmony-plugin-exec'||p.private!==true||p.type!=='module') process.exit(1)"` 退出码 0。
- **对应**：AC-1、AC-2

### T1.2 创建入口骨架 `lib/index.js`

- **做什么**：声明 `export const name = 'harmony-plugin-exec'`、`export const inject = ['tools', 'fs']`、`Config`（schemastery，键与默认值见 plan §1 / spec FR-5.1：`commandTimeoutMs` 120000、`maxOutputBytes` 262144、`maxCommandChars` 65536、`fenceMode` `enforce`、`commandPolicy` `disclose-only`、`shellPath` `/system/bin/sh`），`apply(ctx, config)` 中校验配置为合法值并预留接线点（本任务只做骨架，不注册工具）。
- **文件**：`plugins/harmony-plugin-exec/lib/index.js`
- **依赖**：T1.1
- **验收检查**：`node --check plugins/harmony-plugin-exec/lib/index.js` 退出码 0；`grep -n "export const name = 'harmony-plugin-exec'"` 命中。
- **对应**：AC-1、AC-2、AC-15

### T1.3 创建三份纯模块占位与测试骨架

- **做什么**：新建 `lib/protocol.js` / `lib/fence.js` / `lib/inventory.js`（各含 `@module harmony-plugin-exec/<name>` 头注释）与 `tests/protocol.test.mjs` / `tests/fence.test.mjs` / `tests/inventory.test.mjs`（`node:test` 骨架，先各含一个通过的空断言）。
- **文件**：上述 6 个文件
- **依赖**：T1.1
- **验收检查**：`node --test plugins/harmony-plugin-exec/tests/` 退出码 0。
- **对应**：AC-1

---

## Phase 2 —— shell 会话与协议

### T2.1 实现哨兵行协议 `lib/protocol.js`

- **做什么**：实现 `generateToken()`（注入式，便于测试固定 token）、`frame(token, command)`（返回 plan §5.2 的四段文本）、`createParser(token)`（支持分块喂入，返回 `{ push(chunk) → { output, exitCode } | undefined }`）。**无 import**。
- **文件**：`plugins/harmony-plugin-exec/lib/protocol.js`
- **依赖**：T1.3
- **验收检查**：`node --test plugins/harmony-plugin-exec/tests/protocol.test.mjs` 通过；单测覆盖 plan §10 的 protocol 行（token 嵌入、开/关捕获、逐字节保真、无换行结尾、近似行不误判、NUL 保真、逐字节分块）。
- **对应**：AC-6、AC-8

### T2.2 实现常驻会话 `lib/session.js` 的 spawn 与存活判定

- **做什么**：实现 `ShellSession` 的 `ensure()`：`spawn(shellPath, [], { cwd, stdio: ['pipe','pipe','pipe'], env: process.env })`；只 spawn 一次；监听 stdout `data` / `close` 与 stderr（仅诊断）；**不得**使用 `exec` / `execFile`、**不得**监听 `'exit'` / `'close'` 作为完成信号。stdout 关闭 ⇒ 标记 `DEAD`。
- **文件**：`plugins/harmony-plugin-exec/lib/session.js`
- **依赖**：T2.1
- **验收检查**：`node --check lib/session.js` 通过；`grep -nE "exec\(|execFile\(|on\('exit'|on\('close'"` **不**出现在完成判定路径（人工核对 AC-16 的 grep 断言）。
- **对应**：AC-16、FR-1.1、FR-1.3、FR-6.2

### T2.3 实现 `run()`：框架注入 + 解析 + 串行

- **做什么**：实现 `run(command, { timeoutMs })`：把 `frame` 写入 stdin；用 `createParser` 消费 stdout；以 `Promise` 返回 `{ output, exitCode, truncated, cancelled, timedOut }`；用一个 FIFO 队列把并发调用串行化。
- **文件**：`plugins/harmony-plugin-exec/lib/session.js`
- **依赖**：T2.2
- **验收检查**：`node --check` 通过；串行逻辑由 code review 核对（单测不覆盖 spawn，见 plan §10）。
- **对应**：AC-14、FR-5.6

### T2.4 实现超时、取消与排空

- **做什么**：超时（`commandTimeoutMs` 或 `timeout_ms` 的较小值）触发 `DRAINING`：继续读直到哨兵；二次超时（默认 = 主超时的 1 倍，可配置）触发 `reset()`。`exec.signal` 中止时标记 `cancelled` 并走同一排空路径。
- **文件**：`plugins/harmony-plugin-exec/lib/session.js`
- **依赖**：T2.3
- **验收检查**：`node --check` 通过；状态机与 plan §5.4 一致（人工核对）；超时/取消的分支在真机用例覆盖（`未验证`）。
- **对应**：AC-13、FR-5.2、FR-5.3、FR-5.5

### T2.5 实现输出截断与重置

- **做什么**：`maxOutputBytes` 截断（保留前 N 字节、记录总数 M、附标记）且**继续排空**；`reset()` 杀旧 spawn 新并重新初始化 `cwd`；`dispose()` 尽力 kill 并释放管道。
- **文件**：`plugins/harmony-plugin-exec/lib/session.js`
- **依赖**：T2.4
- **验收检查**：`node --check` 通过；截断标记文案与 plan §7.3 一致（人工核对）。
- **对应**：AC-12、FR-5.4、FR-6.3

---

## Phase 3 —— 路径围栏

### T3.1 实现词法切分与路径候选抽取 `lib/fence.js`

- **做什么**：实现 `tokenize(command)`（尊重单引号 / 双引号 / 反斜杠，不展开变量、不做 glob）与 `extractPathTokens(tokens)`（含 `/` 的 token、`.` / `~` 开头、重定向前后的目标）。**无 import**。
- **文件**：`plugins/harmony-plugin-exec/lib/fence.js`
- **依赖**：T1.3
- **验收检查**：`node --test tests/fence.test.mjs` 通过；覆盖引号内路径、转义空格、`>` / `>>` / `<` / `<>` / `2>` 目标抽取。
- **对应**：AC-9、FR-3.2、FR-3.5

### T3.2 实现归一化与允许根判定

- **做什么**：实现 `normalize(token, cwd)`（纯词法 `path.resolve`，**不**访问文件系统）与 `withinRoots(resolved, roots)`（前缀 + 分隔符边界判定）。`fence.check()` 对每个路径候选判定 `allow` / `deny`。
- **文件**：`plugins/harmony-plugin-exec/lib/fence.js`
- **依赖**：T3.1
- **验收检查**：`node --test tests/fence.test.mjs` 通过；覆盖 `..` 归一化后越界、`root` 自身、`root/` 边界不误判（如 `/a/bc` 不算在 `/a/b` 内）。
- **对应**：AC-9、FR-3.2、FR-3.3

### T3.3 实现不可判定构造扫描

- **做什么**：扫描 `$`、`` ` ``、`$(`、`eval`、`env`、`xargs`、`find ... -exec`、嵌套 shell（命令位置的 `sh` / `bash` 带 `-c`）⇒ `unanalyzable`。
- **文件**：`plugins/harmony-plugin-exec/lib/fence.js`
- **依赖**：T3.2
- **验收检查**：`node --test tests/fence.test.mjs` 通过；覆盖 plan §10 的每一类构造，且普通文本（如 `echo hello`）**不**误判。
- **对应**：AC-10、FR-3.4

### T3.4 实现命令策略与 `toybox` 特例

- **做什么**：实现 `commandPolicy` 三分支（`disclose-only` / `allowlist` / `denylist`）与默认 `denyCommands`；`allowlist` 下 `toybox <applet>` 必须命中 B 类白名单才放行。
- **文件**：`plugins/harmony-plugin-exec/lib/fence.js`、`lib/inventory.js`（B 类 `toyboxApplets`）
- **依赖**：T3.3、T4.1（inventory 数据）
- **验收检查**：`node --test tests/fence.test.mjs` 通过；覆盖 `toybox nc` 放行、`toybox chmod` 拒绝、未列命令拒绝、`denyCommands` 命中拒绝。
- **对应**：AC-18、AC-19、FR-4.3、FR-4.4、FR-4.5

### T3.5 实现三种 `fenceMode` 与降级声明

- **做什么**：`enforce` 下 `deny` / `unanalyzable` 整体拒绝；`warn` / `off` 放行但返回标记；`lib/index.js` 在 `apply` 时若模式非 `enforce`，以 `[dsh-harmony]` 前缀**响亮**输出降级声明。
- **文件**：`plugins/harmony-plugin-exec/lib/fence.js`、`lib/index.js`
- **依赖**：T3.4
- **验收检查**：`node --test tests/fence.test.mjs` 通过（`enforce` 拒绝、`warn`/`off` 放行并带标记）；`grep -n "dsh-harmony" lib/index.js` 命中降级声明。
- **对应**：AC-10、FR-3.7、§6.5

---

## Phase 4 —— 工具注册

### T4.1 编写能力清单数据 `lib/inventory.js`

- **做什么**：以常量表达 A/B/C/D 四类命令与 `denyCommands` 默认集、`toyboxApplets`（B 类）白名单；导出描述文案生成函数，文案必须包含四分类、`chmod`/`chown` 平台拒绝（`13900012`）、`未验证` 标注（C 类）。**无 import**。
- **文件**：`plugins/harmony-plugin-exec/lib/inventory.js`
- **依赖**：T1.3
- **验收检查**：`node --test tests/inventory.test.mjs` 通过；四类非空互斥、B 类含 `nc`/`netcat`、C 类含 `awk`/`wget`/`diff`/`expr` 且文案含 `未验证`、D 类含 `bash`/`busybox`。
- **对应**：AC-17、FR-4.1、FR-4.2、FR-4.7

### T4.2 注册 `bash` 工具 `lib/bash.js`

- **做什么**：`ctx.tools.register(defineTool({ name: 'bash', description, parameters: { command, timeout_ms?, ...escalationFields() }, output: { schema: { type:'string' }, render }, async execute }))`；`execute` 顺序为 plan §6.3：参数校验 → `fence.check` → 升级 → `session.run` → 渲染。
- **文件**：`plugins/harmony-plugin-exec/lib/bash.js`
- **依赖**：T2.5、T3.5、T4.1
- **验收检查**：`node --check lib/bash.js` 通过；`grep -n "name: 'bash'"` 命中；`execute` 内 `fence` 调用出现在 `session.run` 之前（人工核对 fail-closed 顺序）。
- **对应**：AC-11、AC-30、FR-2.1

### T4.3 接入升级（审批）语义

- **做什么**：复用 `@deepseek-ai/dsh-sandbox` 的 `validateEscalationArgs` / `approveEscalation` / `sandboxDenialMarker` / `escalationHintMarker`；只在 `ctx.fs.sandboxMode` 定义时暴露升级字段；拒绝标记与提示文案与 `harmony-plugin-fs-mutate` 同源。
- **文件**：`plugins/harmony-plugin-exec/lib/bash.js`、`lib/index.js`
- **依赖**：T4.2
- **验收检查**：`node --check` 通过；`grep -n "sandboxDenialMarker\|escalationHintMarker\|approveEscalation"` 命中；无沙箱组合下字段不出现（code review）。
- **对应**：AC-11、FR-3.6、FR-2.2

### T4.4 在 `apply()` 完成组装与 `dispose`

- **做什么**：`lib/index.js` 的 `apply` 构造 `ShellSession`、注册工具、注册 `ctx.on('dispose')` 调 `session.dispose()`；配置非法时抛错。
- **文件**：`plugins/harmony-plugin-exec/lib/index.js`
- **依赖**：T4.2、T2.5
- **验收检查**：`node --check lib/index.js` 通过；非法配置（0 / 负数 / 非整数）使 `apply` 抛错（由 code review + 后续真机组合验证）。
- **对应**：AC-15、FR-6.1

---

## Phase 5 —— preset 接线

### T5.1 在 `src-main/main.js` 新增 `exec` 行

- **做什么**：在 `HARMONY_ENSURED_PRESET_ROWS` 追加 `{ id: 'exec', name: 'harmony-plugin-exec', requireRow: 'tool-bash', reason: '...' }`，键序 `id → name → requireRow`（plan §8.2）。**不**改 `HARMONY_DISABLED_PRESET_ROWS`。
- **文件**：`src-main/main.js`（`HARMONY_ENSURED_PRESET_ROWS`）
- **依赖**：T1.2
- **验收检查**：`grep -n "harmony-plugin-exec"` 命中；`HARMONY_DISABLED_PRESET_ROWS` 中 `tool-bash` 仍在（`grep`）。
- **对应**：AC-2、AC-3、AC-5

### T5.2 在 `scripts/collect-dsh.mjs` 镜像同一行

- **做什么**：在 `HARMONY_ENSURED_PRESET_ROWS` 追加**逐字相同**的条目。
- **文件**：`scripts/collect-dsh.mjs`（`HARMONY_ENSURED_PRESET_ROWS`）
- **依赖**：T5.1
- **验收检查**：两文件提取的条目逐条一致（`grep` 对照）；`node --check scripts/collect-dsh.mjs` 通过。
- **对应**：AC-3

### T5.3 核对互校通过

- **做什么**：运行 `assertPresetRowsMirrorMainJs()` 的路径（通过执行 collect-dsh 的前置段或直接跑该脚本）；确认输出 `preset 行互校通过（N 条与 src-main/main.js 一致）` 且 N 由 3 增至 4。
- **文件**：`scripts/collect-dsh.mjs`
- **依赖**：T5.2
- **验收检查**：构建日志出现互校通过且条目数 = 4；无 `preset 行互校失败`。
- **对应**：AC-3

---

## Phase 6 —— 文档与技能同步

### T6.1 编写插件 README

- **做什么**：新建 `plugins/harmony-plugin-exec/README.md` 与 `README_zh.md`：Purpose、工具契约、参数表、配置表（默认值）、能力四分类与 `chmod` 平台拒绝、**Known Limitations**（对齐 `harmony-plugin-fs-mutate/README.md` 的 Known Limitations 风格：单列每一条限制）、Dependencies、Tests。必须显式写明"围栏是尽力而为、可被绕过，不是沙箱"。
- **文件**：`plugins/harmony-plugin-exec/README.md`、`README_zh.md`
- **依赖**：T4.4
- **验收检查**：两文件存在；`grep -in "best-effort\|尽力而为"` 命中；两份 README 的 `- name:` 配置示例为 `harmony-plugin-exec`。
- **对应**：AC-2、AC-17、AC-21

### T6.2 更新 `plugins/README.md` 现有插件表

- **做什么**：在"现有插件"表中新增 `harmony-plugin-exec` 行（提供的工具 `bash`；依赖：无上游补丁，依赖平台 `/system/bin/sh` 与 `@deepseek-ai/dsh-sandbox` 语义）；如新增插件步骤有变化则同步。
- **文件**：`plugins/README.md`
- **依赖**：T6.1
- **验收检查**：`grep -n "harmony-plugin-exec" plugins/README.md` 命中。
- **对应**：AC-2

### T6.3 同步内置技能与能力清单（强制）

- **做什么**：更新 `skills/harmony-runtime-capabilities/SKILL.md`，把"无 shell"的表述改为"经 `bash` 工具提供非 PTY 命令执行"，并写明无 PTY、围栏可绕过、能力四分类；核对 `docs/鸿蒙环境能力清单-v0.1.5.md` 的 FR-3 相关结论并同步。方向单向：先 spec 后技能（spec §8.5）。
- **文件**：`skills/harmony-runtime-capabilities/SKILL.md`、`docs/鸿蒙环境能力清单-v0.1.5.md`
- **依赖**：T4.4（能力已定型）
- **验收检查**：技能正文不再声称"无 shell / 无命令执行"；`grep -n "bash" SKILL.md` 命中且与 spec FR-1~FR-6 无冲突。
- **对应**：AC-21、spec §8.5

---

## Phase 7 —— 单元测试收口

### T7.1 补齐 `protocol.test.mjs`

- **做什么**：按 plan §10 覆盖：token 嵌入、开/关捕获、逐字节保真、无换行结尾、近似行不误判、NUL 保真、逐字节分块。
- **文件**：`tests/protocol.test.mjs`
- **依赖**：T2.1
- **验收检查**：`node --test tests/protocol.test.mjs` 全绿。
- **对应**：AC-6、AC-7、AC-8

### T7.2 补齐 `fence.test.mjs`

- **做什么**：按 plan §10 覆盖：界内/界外、`..` 归一化越界、重定向目标、不可判定构造七类、`enforce`/`warn`/`off`、`allowlist` + `toybox` 特例、`denyCommands`。
- **文件**：`tests/fence.test.mjs`
- **依赖**：T3.5
- **验收检查**：`node --test tests/fence.test.mjs` 全绿。
- **对应**：AC-9、AC-10、AC-18、AC-19

### T7.3 补齐 `inventory.test.mjs`

- **做什么**：按 plan §10 覆盖四分类非空互斥、B/C/D 类关键成员、C 类文案含 `未验证`、描述含四分类与 `chmod` 平台拒绝。
- **文件**：`tests/inventory.test.mjs`
- **依赖**：T4.1
- **验收检查**：`node --test tests/inventory.test.mjs` 全绿。
- **对应**：AC-17

### T7.4 跑通 `npm test`

- **做什么**：在 `plugins/harmony-plugin-exec/` 下执行 `npm test`，确认三个测试文件串联通过。
- **文件**：`plugins/harmony-plugin-exec/package.json`
- **依赖**：T7.1、T7.2、T7.3
- **验收检查**：`npm test --prefix plugins/harmony-plugin-exec`（或 `node --test tests/`）退出码 0。
- **对应**：AC-6 ~ AC-15、AC-17 ~ AC-19

---

## Phase 8 —— 构建验证

### T8.1 物化断言

- **做什么**：运行 `node scripts/collect-dsh.mjs`，断言 `dsh-dist/node_modules/harmony-plugin-exec/package.json` 存在且 `name` 正确。
- **文件**：`scripts/collect-dsh.mjs`（`collectPlugins()`，无需改动）
- **依赖**：T1.1、T5.2
- **验收检查**：文件存在；`name === 'harmony-plugin-exec'`。
- **对应**：AC-4

### T8.2 烘焙 preset 断言

- **做什么**：构建后 `grep -rn "harmony-plugin-exec" dsh-dist/node_modules/@deepseek-ai/dsh-agent-presets/presets/`；同时断言 `tool-bash` 行仍为 `disabled: true`。
- **文件**：构建产物（`dsh-dist`）
- **依赖**：T8.1
- **验收检查**：命中 `- name: 'harmony-plugin-exec'`；`grep -n "id: tool-bash" -A2` 中 `disabled: true` 仍在。
- **对应**：AC-5

### T8.3 静态约束断言（AC-16）

- **做什么**：对 `plugins/harmony-plugin-exec/lib/*.js` 运行 grep 断言：无 `exec(` / `execFile(`、无把 `'exit'` / `'close'` 当完成信号、无 `process.execPath` 作 spawn 目标、无 `statSync` 判可执行性。
- **文件**：`plugins/harmony-plugin-exec/lib/`
- **依赖**：T4.4
- **验收检查**：四条 grep 均无违规命中（白名单注释与文档字符串除外，需人工确认）。
- **对应**：AC-16

### T8.4 未恢复上游的回归断言（AC-20）

- **做什么**：核对 `profiles/desktop/cordis.patch.yml:36-43` 与 `dsh-web-app/cordis.patch.yml:368-371` 未变；`src-main/main.js` 的 `HARMONY_DISABLED_PRESET_ROWS` 仍禁用三项。
- **文件**：上述三文件
- **依赖**：T5.1
- **验收检查**：四处禁用内容与基线一致（无新增启用）。
- **对应**：AC-20

### T8.5 文档纪律断言（AC-21）

- **做什么**：对 `specs/010-tool-bash/` 四文件运行 grep：无 `roadmap` / `路线图` / `待办` 章节与占位文本（检查模式用字符类拼写以避免自命中）；未验证项均带 `未验证`。
- **文件**：`specs/010-tool-bash/*.md`
- **依赖**：T6.1、T6.3
- **验收检查**：占位类 grep 零命中；`未验证` 出现于 spec §7 的真机条目与相关限制。
- **对应**：AC-21

### T8.6 全量 HAP 构建

- **做什么**：`powershell -ExecutionPolicy Bypass -File scripts/build-hap.ps1 -BuildMode debug -SignMode debug`（参数按工程既有习惯），确认签名断言通过。
- **文件**：`scripts/build-hap.ps1`
- **依赖**：T8.1、T8.2
- **验收检查**：退出码 0；产物 `electron/build/default/outputs/default/electron-default-signed.hap` 生成；`build-hap.ps1` 内置签名断言通过。
- **对应**：构建链路（非 AC 单列）

---

## 9. 任务 → AC 汇总

| AC | 覆盖任务 |
|---|---|
| AC-1 文件齐备 | T1.1, T1.2, T1.3 |
| AC-2 包名令牌一致 | T1.1, T1.2, T5.1, T6.1, T6.2 |
| AC-3 两处 preset 行一致 | T5.1, T5.2, T5.3 |
| AC-4 物化断言 | T8.1 |
| AC-5 烘焙 preset + `tool-bash` 仍禁用 | T5.1, T8.2 |
| AC-6 哨兵协议 | T2.1, T7.1 |
| AC-7 退出码解析 | T2.1, T7.1 |
| AC-8 stdout/stderr 合流与行边界 | T2.1, T7.1 |
| AC-9 围栏 fail-closed | T3.1, T3.2, T7.2 |
| AC-10 不可判定构造与三种模式 | T3.3, T3.5, T7.2 |
| AC-11 拒绝先于审批 | T4.2, T4.3 |
| AC-12 输出截断 + 排空 | T2.5, T7.1 |
| AC-13 超时/取消 | T2.4 |
| AC-14 串行化 | T2.3 |
| AC-15 配置校验 | T1.2, T4.4 |
| AC-16 静态约束 | T2.2, T8.3 |
| AC-17 能力四分类披露 | T4.1, T7.3 |
| AC-18 命令策略 + `toybox` 特例 | T3.4, T7.2 |
| AC-19 默认 `denyCommands` | T3.4, T7.2 |
| AC-20 不恢复上游 | T8.4 |
| AC-21 无路线图 + 未验证标注 + 技能同步 | T6.3, T8.5 |
| AC-22 ~ AC-30 真机 | `test-cases.md`（`未验证`，需设备） |
