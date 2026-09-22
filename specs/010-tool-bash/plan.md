# 010-tool-bash 技术方案

> 模块：010-tool-bash
> 对应规格：[specs/010-tool-bash/spec.md](./spec.md)
> 对应用例：[specs/010-tool-bash/test-cases.md](./test-cases.md)
> Last Updated: 2026-09-18

## 1. 技术上下文

### 1.1 运行时环境

- **构建期**：Windows 宿主机 Node（`node scripts/*.mjs`），无 DevEco 参与（除最后的 HAP 构建）。
- **运行期**：Electron-on-鸿蒙（Electron 37 / Node 22.17.0）主进程内的 dsh Host。插件是 in-process Cordis 插件，不独立成进程。
- **执行后端**：**非 PTY**。`node:child_process.spawn` 起**一个**长期存活的 `/system/bin/sh`，经 stdin/stdout 管道驱动多命令；完成由哨兵行判定（平台退出事件不可观测，见 spec §3）。
- **部署形态**：插件源码 → `dsh-dist/node_modules/harmony-plugin-exec/` → `dsh-dist.tar.gz` → resfile → 首启解压到 `$DSH_HOME/dsh-dist` → 运行期再镜像到 `$DSH_HOME/profiles/node_modules/`。

### 1.2 依赖

| 依赖 | 来源 | 用途 |
|---|---|---|
| `@deepseek-ai/cordis` | 宿主 dsh-dist 的依赖闭包（`peerDependencies`） | 插件框架 |
| `@deepseek-ai/dsh-tools` | 同上 | `defineTool` 工具注册 |
| `@deepseek-ai/dsh-sandbox` | 同上 | 升级词汇、`sandboxDenialMarker` / `escalationHintMarker` / `validateEscalationArgs` / `approveEscalation` |
| `@deepseek-ai/dsh-fs` | 同上 | 会话路径规范化（`canonicalPath`），与 fs 家族工具同口径 |
| `@deepseek-ai/schemastery` | 同上 | `Config` schema |
| `node:child_process` | Node 22.17.0 内置 | `spawn` 常驻 shell（**禁** `exec` / `execFile`） |
| `node:path` | Node 内置 | 路径词法归一化 |
| `node:crypto` | Node 内置 | 每调用一次性 token |

> 插件为纯 ESM、无构建步骤（`lib/` 即发布源码）、`private: true`、不发布到 registry。
> **不新增任何第三方依赖**（不引入 shell 解析库：token 词法切分自实现，以便单测无依赖）。

## 2. 宪法合规检查

| 宪法原则（[constitution.md](../constitution.md)） | 状态 | 说明 |
|---|---|---|
| §1.1 零上游改动 | ✅ | 不改 dsh 源码、不增删补丁、不解除四层禁用中的任何一层；插件经既有 `@deepseek-ai/dsh-sandbox` 语义工作 |
| §1.3 只写装配代码 | ✅ | 只做协议、围栏与工具注册装配，不新造业务逻辑 |
| §3.1 源码即真理 | ✅ | 本文档所有符号/行号均来自实际读取；平台事实取自设备实测；不确定处标 `未验证` / `[NEEDS CLARIFICATION]` |
| §3.2 类型安全 | N/A | 无 ArkTS / TS 代码产出（纯 JS 插件） |
| §3.3 日志规范 | ✅ | 运行期输出统一 `[dsh-harmony]` 前缀 |
| §4.1 优雅关闭 | ✅ | 插件 `dispose` 时杀掉常驻 shell（尽力而为；退出不可观测，故关闭时机不阻塞主进程退出） |
| §5.1 幂等构建 | ✅ | `collectPlugins()` 保持"目标已有 `package.json` 即跳过" |
| §5.3 产物适配集中在收集脚本 | ✅ | 构建期适配在 `collect-dsh.mjs`，运行期兜底在 `main.js` |
| §6 治理规则（spec/plan 成对） | ✅ | 本模块产出 `spec.md` + `plan.md` + `tasks.md` + `test-cases.md` |
| §6 治理规则（中文 + 英文术语） | ✅ | 与既有 spec 集口径一致 |

## 3. 命名约定与身份落点

插件身份有 **5 个落点**，必须同时一致；漏一处即表现为「会话无法创建」（`agent-preset/invalid`，reason 为 `row "<id>" names a plugin that cannot be resolved`）。

| # | 落点 | 文件 | 值 |
|---|---|---|---|
| 1 | 包名 | `plugins/harmony-plugin-exec/package.json` | `harmony-plugin-exec` |
| 2 | 插件 `name` 导出 | `plugins/harmony-plugin-exec/lib/index.js` | `harmony-plugin-exec` |
| 3 | **preset 行 `name`（运行时导入说明符）** | `src-main/main.js` 的 `HARMONY_ENSURED_PRESET_ROWS` | `harmony-plugin-exec` |
| 4 | **preset 行 `name`（构建期烘焙，镜像 #3）** | `scripts/collect-dsh.mjs` 的 `HARMONY_ENSURED_PRESET_ROWS` | `harmony-plugin-exec` |
| 5 | 目录名 | 文件系统 | `harmony-plugin-exec` |

**preset 行 `id`** 固定为 `exec`：行 id 是 preset 内的稳定身份，与包名/目录名解耦。

> **行 id 的冲突检查（已核对）**：上游四个 preset（`standard` / `ptc` / `cordis` / `minimal`）的顶层行 id 中**没有** `exec`；`tool-bash` 与 `tool-pwsh` 是既有行，我们的新增行与它们**不冲突**。

**包名令牌**（非功能性，但同属"身份一致"要求）：

| 文件 | 落点 |
|---|---|
| `package.json` | `name` |
| `lib/index.js` | JSDoc `@module`、`name` 导出、错误文案前缀 |
| `lib/session.js` / `lib/fence.js` / `lib/protocol.js` / `lib/inventory.js` / `lib/bash.js` | JSDoc `@module` |
| `README.md` / `README_zh.md` | 标题、`- name:` 配置示例 |

## 4. 插件布局（模块 / 文件）

```
plugins/harmony-plugin-exec/
├── package.json                 # name=harmony-plugin-exec, private, type=module, main=lib/index.js
├── README.md                    # 英文：目的 / 工具契约 / 配置 / Known Limitations
├── README_zh.md                 # 中文镜像
├── lib/
│   ├── index.js                 # 插件入口：name / inject=['tools','fs'] / Config / apply()
│   ├── protocol.js              # 纯函数：框架构造 + 哨兵行解析（无 import，单测驱动）
│   ├── fence.js                 # 纯函数：token 词法切分 + 路径判定（无 import，单测驱动）
│   ├── inventory.js             # 纯数据：A/B/C/D 四类命令清单 + 描述文案（无 import）
│   ├── session.js               # ShellSession：spawn 一次、框架注入、排空、超时、重置
│   └── bash.js                  # `bash` 工具注册（defineTool + 围栏 + 升级字段）
└── tests/
    ├── protocol.test.mjs        # node:test 风格纯 Node 单测
    ├── fence.test.mjs
    └── inventory.test.mjs
```

**职责边界**：

| 文件 | 职责 | 是否 import 外部包 |
|---|---|---|
| `lib/protocol.js` | 构造框架字符串；从 stdout 字节流解析 `BEGIN` / `END` 哨兵、抽出退出码与捕获窗口；token 生成接口由调用方传入 | 否（可单测） |
| `lib/fence.js` | 命令字符串 → token 列表 → 路径候选 → 归一化 → 判定（`allow` / `deny` / `unanalyzable`） | 否（可单测） |
| `lib/inventory.js` | A/B/C/D 四类命令名常量与描述文本；`toybox` 子命令白名单（B 类） | 否（可单测） |
| `lib/session.js` | `spawn`、写入框架、读取与分发、超时计时、排空、重置、串行队列 | `node:child_process` / `node:crypto` |
| `lib/bash.js` | `ctx.tools.register(defineTool({...}))`；调用 `fence` → 升级 → `session.run` | `@deepseek-ai/dsh-tools` / `@deepseek-ai/dsh-sandbox` |
| `lib/index.js` | 组装：校验配置、构造 `ShellSession`、`FsMutationSandbox` 同款升级适配、注册工具、`dispose` | 上述全部 |

> **为什么把 `protocol` / `fence` / `inventory` 做成无 import 的纯模块**：与 `harmony-plugin-fs-search` 的 `lib/search.js` / `lib/glob.js`、`harmony-plugin-fs-mutate` 的 `lib/permissions.js` / `lib/transfer.js` 同一策略 —— 让核心引擎在**裸 Node** 上被 `node:test` 直接驱动，无需设备、无需 dsh 包、无测试框架依赖。

## 5. shell 会话协议（哨兵行）

### 5.1 会话构造

```
spawn(shellPath, [], {
  cwd: sessionCwd,                       // exec.agent.session.header.cwd，缺省用进程 cwd
  stdio: ['pipe', 'pipe', 'pipe'],       // stdin / stdout / stderr 均为管道
  env: process.env,                      // 继承应用沙箱环境
})
```

- `shellPath` 默认 `/system/bin/sh`（实测可 spawn）。
- **禁用** `child_process.exec` / `execFile`：`exec()` 从不回调（设备实测）。
- **禁用** `process.execPath` 作为 spawn 目标（路径 `ENOENT`）。
- **禁用** `statSync` 判定可执行性（`/system/bin/sh` 与 `/bin/sh` 均返回 `EACCES` 却可 spawn）。

### 5.2 每次命令的框架（`[设计]`，与 spec FR-1.5 一致）

一次性随机 token（`crypto.randomBytes(8).toString('hex')`，16 位十六进制）。发往 stdin 的文本：

```
printf '\n__DSH_BASH_BEGIN__ %s\n' '<token>'
{ <command>
} 2>&1
__dsh_rc=$?
printf '\n__DSH_BASH_END__ %s %s\n' '<token>' "$__dsh_rc"
```

**格式要点**：

| 要点 | 说明 |
|---|---|
| 起始行 | `__DSH_BASH_BEGIN__ <token>`，前置 `\n` 保证独立成行 |
| 结束行 | `__DSH_BASH_END__ <token> <rc>`，前置 `\n` 保证独立成行 |
| 退出码 | `$?` 在 `{ ... } 2>&1` 之后读取，即命令组的退出码 |
| 合流 | `{ ... } 2>&1` 把命令 stdout+stderr 合入同一 stdout 流，保持行序 |
| 捕获窗口 | 起始行之后、结束行之前的**逐字节**内容 |
| 防误判 | 结束行必须**逐字匹配**本次 token；输出中的近似字符串不构成结束 |

### 5.3 解析器（`lib/protocol.js`）

1. 以行边界扫描累积缓冲；**只**在行首位置识别哨兵。
2. 首行精确等于 `__DSH_BASH_BEGIN__ <token>` ⇒ 进入捕获态，清空捕获缓冲。
3. 捕获态下，遇到精确匹配 `^__DSH_BASH_END__ <token> (\d+)$` 的行 ⇒ 退出捕获态，返回 `{ output, exitCode, beganAt, endedAt }`。
4. 非哨兵行按原字节追加到捕获缓冲；保留行尾判定所需的最后一个不完整行直到下一块数据到达。
5. token 不匹配的 `__DSH_BASH_*` 行按普通输出处理（防注入误判）。

### 5.4 会话状态机

```
IDLE ──run()──► WAITING ──哨兵 END──► IDLE
                  │
                  ├─ 超时/取消 ──► DRAINING ──哨兵 END──► IDLE
                  │                  └──二次超时──► RESET ──► IDLE
                  └─ stdout close ──► DEAD ──下次 run──► RESET ──► IDLE
```

- **串行**：`WAITING` / `DRAINING` 状态下新调用进入队列（FR-5.6）。
- **重置是最后手段**：每次重置泄漏一个僵尸（设备实测），故只在 `stdout close` 或排空二次超时时发生。
- **`dispose`**：尽力 `kill` 子进程并释放管道；不等待退出事件（不可观测）。

## 6. 围栏算法（`lib/fence.js`）

### 6.1 输入 / 输出

```js
// 输入
{ command, cwd, roots: [absoluteRoot, ...], mode: 'enforce'|'warn'|'off',
  commandPolicy: 'disclose-only'|'allowlist'|'denylist',
  allowCommands: Set<string>, denyCommands: Set<string>, toyboxApplets: Set<string> }

// 输出
{ decision: 'allow' | 'deny' | 'unanalyzable' | 'skipped',
  reason: string, offenders: [{ token, resolved }] }
```

### 6.2 判定步骤

1. **词法切分**（自实现，尊重单引号 / 双引号 / 反斜杠转义；不展开变量、不做 glob）。
2. **抽取路径候选**：
   - 含 `/` 的 token；
   - 以 `.` 或 `~` 开头的 token；
   - 重定向操作符（`>`、`>>`、`<`、`<>`、`2>`、`&>`）之后的目标 token。
3. **词法归一化**：以会话 `cwd` 为基准 `path.resolve`，消除 `.` 与 `..`；**不**访问文件系统（不解析符号链接）。
4. **允许根判定**：归一化路径若等于某个 root 或位于 `root + '/'` 之下 ⇒ 界内；否则界外。
5. **不可判定构造扫描**：命令中出现 `$`（变量展开）、`` ` ``（反引号）、`$(`（命令替换）、整词 `eval` / `env` / `xargs` / `find ... -exec`、嵌套 shell（`sh -c` / `bash -c` / `sh`/`bash` 出现在命令位置）⇒ 标记 `unanalyzable`。
6. **命令策略判定**：
   - `allowlist`：命令首 token 不在 `allowCommands` 中 ⇒ `deny`；
   - `toybox` 特例（FR-4.4）：首 token 为 `toybox` 时，第二 token 必须命中 `toyboxApplets`（B 类白名单），否则 `deny`；
   - `denylist`（含 `disclose-only` 的默认拒绝集）：命令名命中 `denyCommands` ⇒ `deny`。
7. **汇总**：
   - `mode === 'off'` ⇒ `skipped`（放行 + 日志）；
   - `mode === 'warn'` ⇒ 任何 `deny` / `unanalyzable` 都降级为 `skipped`（放行 + 响亮日志）；
   - `mode === 'enforce'` ⇒ 任一 `deny` 或 `unanalyzable` ⇒ 整体拒绝，返回 offenders。

### 6.3 与审批的接线顺序（fail-closed）

```
bash.execute
  ├─ (1) 参数校验（命令非空 / 长度 / 数值）
  ├─ (2) fence.check(command)            ← 围栏先于一切交互
  │        ├─ allow/skipped → 继续
  │        └─ deny/unanalyzable →
  │             ├─ validateEscalationArgs(args.sandbox_permissions, args.justification)
  │             ├─ 无 sandbox_permissions → 返回拒绝标记 + 升级提示（此时尚无审批）
  │             └─ 有 sandbox_permissions → approveEscalation(...) 一次审批
  │                   ├─ 拒绝 → 返回拒绝标记
  │                   └─ 批准 → 继续（按调用打戳）
  ├─ (3) session.run(command, timeout)   ← 只有到这里才真正执行
  └─ (4) 渲染 Exit code + 输出
```

**顺序不可交换**：`(2)` 必须完整结束（含审批）后 `(3)` 才发生。不得为"先问用户"而跳过围栏。

### 6.4 围栏不可判定性（如实记录）

`fence.js` 的 token 级判定**无法**覆盖：变量展开、命令替换、嵌套 shell、间接路径、`toybox` 直通。因此在 `enforce` 下把这些构造**一律拒绝**（宁拒绝不放过），但这仍不是沙箱 —— 一段不含任何"不可判定构造"命令若通过其它途径（配置文件、环境变量、applet 自身行为）读到界外路径，围栏看不到。spec §6.4 如实披露。

## 7. 工具注册（`lib/bash.js`）

### 7.1 工具契约

```js
ctx.tools.register(defineTool({
  name: 'bash',
  description: <见 7.2>,
  parameters: {
    command: { type: 'string', required: true, description: '…' },
    timeout_ms: { type: 'integer', description: '…' },
    ...sandbox.escalationFields(),          // 受限组合下才出现
  },
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
  async execute(args, exec) { … },
}))
```

- **工具名固定 `bash`**（与上游身份一致）。后端非 PTY 由描述披露。
- **参数校验前置**：命令非空、长度 ≤ `maxCommandChars`、`timeout_ms` 为正整数且钳制到 `commandTimeoutMs`。
- **升级字段**：复用与 `plugins/harmony-plugin-fs-mutate/lib/sandbox.js` 同源的 `@deepseek-ai/dsh-sandbox` API；无沙箱能力的组合下字段不出现（FR-2.2）。

### 7.2 描述要点（能力披露）

描述必须包含：

1. **后端性质**：非 PTY、非交互、单常驻 shell；无 TTY；`cwd` 与 shell 变量跨调用延续。
2. **完成与退出码**：完成由哨兵行判定；结果含 `Exit code:`。
3. **能力四分类**：A 类可直接调用（列举分组示例）；B 类**只能** `toybox <name>`（列举 `nc` / `netcat` 等）；C 类默认未编、`未验证`（列举 `awk` / `wget` / `diff` / `expr` 等）；D 类不存在（`bash` / `busybox` / GNU coreutils / `vi` / `strace` 等）。
4. **平台拒绝项**：`chmod` / `chown` 在 PATH 上但运行时被平台拒（`13900012`）。
5. **围栏性质**：路径围栏是尽力而为、可被绕过；越界路径会被拒绝并可经审批升级。

### 7.3 结果渲染

```
Exit code: <rc>
<output>
```

- 截断：追加 `[output truncated: kept <N> of <M> bytes]`。
- 取消：追加 `[command cancelled]`。
- 超时：追加 `[command timed out after <ms>ms]`，退出码不伪装成 0。
- 拒绝：返回共享标记（`sandboxDenialMarker(mode)` + `escalationHintMarker('operation')`）与升级提示。

## 8. preset 接线

### 8.1 被禁用的上游 `tool-bash` 行的交互

- `HARMONY_DISABLED_PRESET_ROWS`（`src-main/main.js:174-178`）**继续**禁用 `tool-bash`；010 **不**改动它。
- 010 的做法是**新增**一行 `exec`（`name: 'harmony-plugin-exec'`），与 `tool-bash` 是**两个不同的行**。设备上 `tool-bash` 仍为 `disabled: true`，我们的 `exec` 行独立挂载。
- `requireRow: 'tool-bash'` 的作用：把我们的行**限定**到"已经挂载了 `tool-bash` 行"的 preset。已核对：`standard` / `ptc` / `cordis` 含 `- id: tool-bash`，**`minimal` 不含**（其固定双工具配置不被追加）。这与既有 `tool-str-replace-editor` / `fs-mutate` / `fs-search` 用 `requireRow: 'tool-fs'` 的语义同构。

### 8.2 两处镜像表（必须同时改）

`src-main/main.js` 与 `scripts/collect-dsh.mjs` 各有一份 `HARMONY_ENSURED_PRESET_ROWS`，逐条镜像。新增条目：

```js
{
  id: 'exec',
  name: 'harmony-plugin-exec',
  requireRow: 'tool-bash',
  reason: 'HarmonyOS: 非 PTY 常驻 shell 命令执行（单 spawn + 哨兵行；替代依赖 node-pty 的 tool-bash）',
}
```

> **键序硬约束**：`collect-dsh.mjs` 的 `assertPresetRowsMirrorMainJs()` 用正则
> `/\{\s*id: '([^']+)',\s*name: '([^']+)',(?:\s*requireRow: '([^']+)',)?/g`
> 解析 `src-main/main.js` 中的表，**键序必须是 `id` → `name` → `requireRow`**。若把 `reason` 放在 `requireRow` 之前也无妨（正则只要求前三个键依次出现），但**不得**调换 `id` / `name` / `requireRow` 的相对顺序，否则互校解析失败并构建期硬失败。

### 8.3 禁用行与新增行并存的效果

| preset | 既有 `tool-bash` 行 | 010 新增 `exec` 行 | 结果 |
|---|---|---|---|
| `standard` | 存在，运行期置 `disabled: true` | `requireRow: 'tool-bash'` 命中 ⇒ 追加 | 只有 `harmony-plugin-exec` 的 `bash` 工具可用 |
| `ptc` | 同上 | 追加 | 同上 |
| `cordis` | 同上 | 追加 | 同上 |
| `minimal` | **不存在** | `requireRow` 不命中 ⇒ 不追加 | `minimal` 保持固定双工具配置 |

## 9. 构建脚本触点

| 位置（符号） | 职责 | 需改动 |
|---|---|---|
| `scripts/collect-dsh.mjs` 的 `collectPlugins()` | 源根 `resolve(projectRoot, 'plugins')`；按 `harmony-plugin-*` 目录通配发现；落地目录名取自 `package.json` 的 `name`；断言 `/^harmony-plugin-[A-Za-z0-9._-]+$/`；缺 `package.json` / JSON 非法 / 名不符约定即 `process.exit(1)`；目标已有 `package.json` 即跳过 | **无需改动**（通配自动发现新插件） |
| `scripts/collect-dsh.mjs` 的 `HARMONY_ENSURED_PRESET_ROWS` | 烘焙 preset 行 | **新增 `exec` 条目** |
| `scripts/collect-dsh.mjs` 的 `assertPresetRowsMirrorMainJs()` | 读 `src-main/main.js` 源码解析同名表，逐条比对 `id` / `name` / `requireRow`，不等即构建期抛错 | **无需改动**（自动覆盖新条目） |
| `src-main/main.js` 的 `HARMONY_ENSURED_PRESET_ROWS` | 运行期补 preset 行（必须与 `collect-dsh.mjs` 逐条一致） | **新增 `exec` 条目** |
| `src-main/main.js` 的 `ensureDshPluginsProfileLink()` | 把 `dsh-dist/node_modules/harmony-plugin-*` 复制到 `$DSH_HOME/profiles/node_modules/` | **无需改动**（通配已覆盖） |
| `src-main/main.js` 的 `HARMONY_DISABLED_PRESET_ROWS` | 禁用上游 `tool-bash` / `tool-fs-search` / `persistent-shell` | **无需改动**（保持禁用） |
| `scripts/collect-runtime.mjs` | 只恢复 `src-main/*` 与 `skills/`，不涉及 `plugins/` | **无需改动** |

> **`dsh-dist` 更新生效条件（既有约束）**：设备只有在**重新解压 `dsh-dist`** 后才会看到新插件集合；就地升级因解压 marker 命中而跳过。验证插件集合变更需要**全新安装**或清除设备 `$DSH_HOME/dsh-dist`（沿用 202 的结论）。

## 10. 单元测试计划

三个纯模块使用 `node:test` + `node:assert`（Node 22 内置，无框架、无依赖），由 `npm test` 串联。

| 用例文件 | 覆盖 | 关键断言 |
|---|---|---|
| `tests/protocol.test.mjs` | 框架构造 + 哨兵解析 | token 正确嵌入；起始行开捕获；结束行带 `rc` 关捕获；多行输出逐字节保真；不以换行结尾的输出不污染哨兵；token 不匹配的近似行不误判；NUL 字节保真；分块到达（一次喂一个字节）仍能正确解析 |
| `tests/fence.test.mjs` | 词法切分 + 路径判定 + 策略 | 界内放行 / 界外拒绝 / `..` 归一化后越界被拒 / 重定向目标参与判定 / `$VAR`、`$(...)`、反引号、`eval`、`sh -c`、`xargs`、`find -exec` 判为 `unanalyzable` / `enforce` 拒绝、`warn` 放行、`off` 跳过 / `allowlist` 未列拒绝 / `toybox nc` 命中白名单放行、`toybox chmod` 拒绝 / `denyCommands` 生效 |
| `tests/inventory.test.mjs` | 能力分类数据 | A/B/C/D 四类非空且互斥（同一命令不同时属两类，`chmod` 的"平台拒绝"以单独集合表达）；B 类含 `nc` / `netcat`；C 类含 `awk` / `wget` / `diff` / `expr`，且其描述文本含 `未验证`；D 类含 `bash` / `busybox`；工具描述包含四分类与 `chmod` 平台拒绝说明 |

> 单测**不**覆盖 `lib/session.js` 与 `lib/bash.js`（需真实 spawn / dsh 运行时）；它们的验证归入 `test-cases.md` 的真机用例（`未验证`）。这与 `harmony-plugin-fs-mutate` 把 `delete.js` / `move.js` 的验证放到 202 真机用例的做法一致。

## 11. FR/AC → 实现落点映射

| 需求 / AC | 落点 | 类型 |
|---|---|---|
| FR-1 常驻 shell 与哨兵协议 | `lib/session.js`（spawn/串行/重置）、`lib/protocol.js`（框架/解析）、`src-main/main.js` 无改动 | plugin |
| FR-1.5 哨兵行格式 | `lib/protocol.js` 的 `frame()` / `parse()` | plugin |
| FR-2 分发与输出/退出码 | `lib/bash.js`（工具契约/渲染）、`lib/session.js`（run） | plugin |
| FR-2.1 工具名 `bash` | `lib/bash.js` 的 `defineTool({ name: 'bash' })` | plugin |
| FR-3 路径围栏与审批 | `lib/fence.js`（判定）、`lib/bash.js`（升级接线）、`@deepseek-ai/dsh-sandbox` | plugin + upstream package |
| FR-3.3 允许根集合 | `lib/bash.js` 读取 `exec.agent.session.header.cwd` + `process.env.DSH_EXTRA_WRITABLE_ROOTS`（`src-main/main.js:600-630` 的部署期语义） | plugin |
| FR-4 能力披露 | `lib/inventory.js`（数据 + 描述）、`lib/bash.js`（承载） | plugin |
| FR-4.4 `toybox` 直通 | `lib/fence.js` 的特例子路径 | plugin |
| FR-5 超时/取消/截断 | `lib/session.js`（计时/排空）、`lib/index.js`（`Config` 默认值）、`lib/bash.js`（渲染） | plugin |
| FR-6 会话生命周期与僵尸 | `lib/session.js`（惰性 spawn/存活判定/重置）、`lib/index.js`（`dispose`） | plugin |
| AC-1 文件齐备 | `plugins/harmony-plugin-exec/` 目录 | plugin |
| AC-2 / AC-3 / AC-4 / AC-5 | `package.json`、两处 `HARMONY_ENSURED_PRESET_ROWS`、`collectPlugins()` | build |
| AC-6 ~ AC-15 | `lib/protocol.js` / `lib/fence.js` / `lib/inventory.js` | plugin + 单元测试 |
| AC-16 静态约束 | 全 `lib/*.js` 源码（`grep` 断言） | build |
| AC-17 / AC-18 / AC-19 | `lib/inventory.js` / `lib/fence.js` | plugin + 单元测试 |
| AC-20 不恢复上游 | `profiles/desktop/cordis.patch.yml:36-43` 与 `dsh-web-app/cordis.patch.yml:368-371` 保持原状 | 来源核验 |
| AC-21 无路线图 | `spec.md` / `plan.md` / `tasks.md` / `test-cases.md` | 文档 |
| AC-22 ~ AC-30 真机 | `lib/session.js` / `lib/bash.js` + 设备 | 真机（`未验证`） |

## 12. 关键决策记录

| # | 决策 | 备选 | 理由 |
|---|---|---|---|
| D1 | 交付为**本工程专用插件** `harmony-plugin-exec`，不重新启用上游 `tool-bash` | 解除四层禁用，改回 PTY 后端 | 产物层 `node-pty` 是 win32-x64（不可加载）；平台无 PTY API。四层禁用是四重冗余，绕过任一层都会撞上 L1 |
| D2 | 模型可见工具名保持 **`bash`** | 新名字如 `exec` / `shell` | 与上游身份一致，既有技能与文档保持连贯；后端差异由描述披露 |
| D3 | 后端为**一个**常驻 `/system/bin/sh`，哨兵行判完成 | 一次命令一次 spawn；依赖退出事件 | 退出事件从不触发；每次 spawn 泄漏一个僵尸（4 spawns → 4 zombies） |
| D4 | 命令的 stdout+stderr 在 shell 侧经 `{ ... } 2>&1` 合流 | 两个流分别捕获后在 JS 端拼接 | 合流保证**行序**即真实执行序；分开捕获无法在不依赖退出事件的前提下确定 stderr 何时结束 |
| D5 | 完成判定用**哨兵行**，token 每次随机 | 用固定字符串 / 用 `proc:exit` | 随机 token 防输出误判；退出事件不可用 |
| D6 | **禁用** `exec` / `execFile`，**禁用** `process.execPath`，**禁用** `statSync` 判可执行性 | 沿用常规 Node 写法 | `exec` 不回调；`process.execPath` 路径 `ENOENT`；`statSync` 对可 spawn 的 `/system/bin/sh` 返回 `EACCES` |
| D7 | 在 exec 工具层自建 **token 级路径围栏**，并**如实披露其可绕过** | 只接 `spawn`；或声称围栏等于沙箱 | shell 完全绕过 `fs-sandbox` 与审批（实测）；但工具层围栏**无法**构成安全边界，必须诚实披露 |
| D8 | 围栏 **fail-closed**：界外路径与不可判定构造在 `enforce` 下一律拒绝，拒绝先于审批 | 先问用户；或只检查"明显危险" | 与 301 的 `FR-6.1.1` 同口径；审批默认结局是拒绝 |
| D9 | 允许根 = 会话 `cwd` + `DSH_EXTRA_WRITABLE_ROOTS`（部署期状态） | 自建一份独立白名单 | 与 `src-main/main.js:600-630` 的可写根语义对齐；模型无法自行扩大可写面 |
| D10 | `fenceMode: warn` / `off` 是**显式安全降级**，必须在启动日志响亮声明 | 静默降级 | 静默降级会把"没有围栏"伪装成"有围栏" |
| D11 | 超时/取消处置顺序：**先排空到哨兵**，排空失败才重置 | 一律 kill+respawn | 重置每次泄漏一个僵尸；排空让已产生的输出仍可交付 |
| D12 | 命令**串行化** | 并发注入 | 单常驻 shell 会话在同一时刻只能承载一条命令 |
| D13 | `requireRow: 'tool-bash'` 限定新行只加到已含 `tool-bash` 行的 preset | 无 `requireRow`；或用 `tool-fs` | 已核对 `standard`/`ptc`/`cordis` 有 `tool-bash`、`minimal` 无；与既有插件用 `requireRow` 锁定范围的语义一致，并让 `minimal` 保持固定双工具配置 |
| D14 | `protocol` / `fence` / `inventory` 做成**无 import 的纯模块** | 直接写进 `session.js` / `bash.js` | 让核心逻辑在裸 Node 上被单测直接驱动（既有插件同一策略）；无需设备与 dsh 包 |
| D15 | C 类（extended）命令一律 **`未验证`**，依赖前真机 `toybox --long` | 信官方文档即可用 | 官方文档是超集；OH FAQ 明说"文档有描述 ≠ 已编译" |
| D16 | sh 身份矛盾（toybox vs mksh R59c）**不猜**，由真机 md5 裁定 | 取设备记录或源代码其一 | 两说矛盾；若为 mksh，builtin 会遮蔽同名命令，影响行为 |

## 13. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 僵尸泄漏在实现中被放大（每命令重置一次，或异常路径频繁重置） | 主进程 pid 上僵尸累积（实测一个会话曾达 30） | D3/D11 单常驻 + 重置最小化；真机用例断言单会话僵尸数不线性增长（AC-25） |
| R2 | 围栏被当作沙箱使用 | 越界访问被误认为"已被阻止" | spec §6.4 与 README 显式披露可绕过；真机旁路探针（AC-24）**证明**可绕过并如实记录 |
| R3 | 两处 `HARMONY_ENSURED_PRESET_ROWS` 漂移 | 运行期以 `agent-preset/invalid` 暴露，构建期静默 | `assertPresetRowsMirrorMainJs()` 构建期硬失败 + 双文件 grep（AC-3） |
| R4 | 键序写错导致互校解析失败 | 构建期硬失败（可见） | §8.2 明确键序；新条目按 `id → name → requireRow` 写 |
| R5 | `tool-bash` 的 `disabled` 行被误删 | 上游 PTY 后端被重新启用 → 加载失败（node-pty win32-x64） | spec §8.2 明令不改 `HARMONY_DISABLED_PRESET_ROWS`；AC-20 断言无新增启用；AC-5 断言 `tool-bash` 仍 `disabled: true` |
| R6 | 哨兵 token 冲突 / 输出伪造哨兵 | 完成判定被劫持 | token 每次随机且逐字匹配；AC-6 单测覆盖近似行与分块到达 |
| R7 | `shellPath` 被改成不可 spawn 的目标 | 会话失败 | 只接受已实测可 spawn 的目标；spawn 失败响亮报错，不静默回退（FR-6.1） |
| R8 | 交互式命令在无 PTY 下挂住 | 单会话被占用直到超时 | 工具描述引导非交互用法；超时 + 排空 + 重置兜底；FR-2.6 标注 `未验证` |
| R9 | `dsh-dist` 就地升级不生效（既有架构缺口） | 设备继续用旧插件集合 | 沿用 202 结论：验证需全新安装或清除设备 `$DSH_HOME/dsh-dist`；本模块只记录不改 |

## 14. 待确认

| # | 事项 | 处置 |
|---|---|---|
| Q1 | 插件是否有可用的 dsh `writableRoots()` seam 访问器（而非读 `DSH_EXTRA_WRITABLE_ROOTS`）？本次未在源码中定位到 | `[NEEDS CLARIFICATION]`：当前以会话 `cwd` + `DSH_EXTRA_WRITABLE_ROOTS` 实现；真机用例核对与实测可写根一致（spec FR-3.3） |
| Q2 | `/system/bin/sh` 的真实构建来源（toybox vs mksh R59c） | 由真机 md5 比对裁定（AC-26）；裁定前依赖 sh 身份的结论保持 `未验证` |
| Q3 | C 类（`toybox_extended_cmd`）命令在本设备镜像上是否编入 | 由真机 `toybox --long` 核实（AC-27） |
| Q4 | 无 PTY 下交互式命令的实际行为 | `未验证`；AC 未覆盖，FR-2.6 仅披露 |
