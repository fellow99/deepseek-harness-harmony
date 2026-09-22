# 命令执行工具 `bash`（非 PTY exec 后端）功能规格

> Module: 010-tool-bash
> Status: Proposed（设计已定，未实现）
> Last Updated: 2026-09-18

## 1. 模块概述

### 1.1 目的 —— 为什么存在这个模块

给 harness 内的模型（LLM）一个**命令执行工具**，即上游 dsh `tool-bash` 的鸿蒙等价物 —— 上游 `tool-bash` 在本平台当前**不可用**（`src-main/main.js:174-178` 的 `HARMONY_DISABLED_PRESET_ROWS` 显式禁用 `tool-bash` / `tool-fs-search` / `persistent-shell`）。

上游不可用不是一处开关没打开，而是**四层同时禁用 + 一层平台硬约束**的结果：

| 层 | 事实 | 出处 |
|---|---|---|
| ① 产物层 | 依赖链是 `ctx.shell` → `bash-local` / `bash-sandbox` → `ctx.subprocess` → `node-pty`；`node-pty` 在 `dsh-dist` 内是 **win32-x64** 二进制，aarch64 无法加载 | `[源码]` 依赖链；`[设备实测]` 加载失败 |
| ② 配置层 | `profiles/desktop/cordis.patch.yml:36-43` 禁用 `subprocess` / `sandbox` / `bash-sandbox` / `permission` 四行 | `[源码]` |
| ③ bundle 层 | `dsh-web-app/cordis.patch.yml:368-371` 禁用 host 平面的 `tool-bash` / `tool-pwsh` | `[源码]`（已核对：`:368` 为 `- id: tool-bash`，`:371` 为 `- id: tool-pwsh`） |
| ④ preset 层 | `src-main/main.js:174-178` 的 `HARMONY_DISABLED_PRESET_ROWS` 禁用 `tool-bash`、`tool-fs-search`、`persistent-shell` | `[源码]` |

**PTY 不可行**：SELinux 拒 `forkpty` / `openpty`，平台无应用级 PTY API。因此本模块的后端**必须是非 PTY**，且**不得**试图重新启用 `node-pty`、PTY 或上游 `subprocess` / `sandbox` 插件。

**平台侧放行了非 PTY 的子进程**：`fork` + `execve` + pipes + PATH 查找全部放行；`/system/bin/toybox`（0.8.12）、`/system/bin/sh`、`/bin/sh` 均能 spawn 并正确返回 stdout（`[设备实测]`）。

**真正的设计难题不是"能不能跑命令"，而是两件事**：

1. **子进程退出不可观测**：观测到的事件序列只有 `proc:spawn → stdout:end → stderr:end → stdout:close`，`proc:exit` / `proc:close` **从不触发**，子进程变成**僵尸**（`/proc/<pid>/stat` 里的 `Z`），`exec()` 也从不回调。因此不能用"一次命令一次 spawn + 等退出"的模型，也不能靠退出事件判完成。
2. **shell 整体绕过文件围栏与审批**：实测子进程以同一 uid 直接写入 `/storage/Users/currentUser/Documents`、删除它、跨目录 `mv`、`cp`、`mkdir -p`、`rm -rf`，**完全不经过 `fs-sandbox` 的 `checkedTarget`、不弹任何审批**。因此 010 **必须**在 exec 工具层自建路径围栏，或**明确接受安全降级** —— 不能只"接个 `spawn`"就上线。

本模块把这两点的结论、约束、接口与验收标准固化为规范源，并把"围栏是尽力而为、可被绕过"这一事实**如实记录**，而不是把它包装成一个沙箱。

### 1.2 解决的问题

- **上游能力在鸿蒙上不可用，且原因分层。** 四层禁用 + PTY 硬约束必须一次讲清，否则会有人从"配置层"下手去重新启用 `subprocess`，走进死路。
- **PTY 思维会写出错误的后端。** 退出事件不可观测 ⇒ 单 spawn / 等退出 / 依赖 `exec` 的写法必然失败并漏僵尸。本模块把"单常驻 shell + 哨兵行协议 + 不依赖退出事件"定为强制结构。
- **shell 绕过围栏被低估。** 现有 `fs-sandbox` + `approval` 体系对 shell 子进程**完全无效**；本模块把 exec 工具层围栏的语义、fail-closed 顺序与**残余风险**写成可验收条目。
- **命令能力清单存在三类不可互换的可达性。** "PATH 上的命令""只能经 `toybox <name>` 调用的命令""需 `toybox_extended_cmd` 编译标志的命令"三者不能混为一谈；且官方文档是**超集**，不能当作保证。本模块把三类分开披露，并把未验证项显式标注。
- **模型可见身份要与上游一致。** 工具名保持 `bash`，即使后端不是 PTY，以免既有技能与文档失去连贯性。

### 1.3 范围

**包含**：

- 交付形态：本工程专用插件 `plugins/harmony-plugin-exec/`（包名 `harmony-plugin-exec`），**不**通过重新启用上游 `tool-bash` 交付。
- 模型可见工具 `bash`：参数、结果渲染、错误语义。
- 常驻 shell 会话与哨兵行协议（FR-1）。
- 命令分发、输出捕获与退出码恢复（FR-2）。
- exec 工具层路径围栏与审批升级（FR-3）。
- 命令 allowlist 与能力披露（FR-4）。
- 超时、取消、输出截断（FR-5）。
- 会话生命周期与僵尸约束（FR-6）。
- 与既有装配的接线：`collectPlugins()` 物化、`HARMONY_ENSURED_PRESET_ROWS` 双写、被禁用的上游 `tool-bash` 行的交互。
- 本模块的 `spec.md` / `plan.md` / `tasks.md` / `test-cases.md`。

**不包含**（010 明确**不做**）：

- **实现完整的 `ctx.shell` 服务**。010 只交付一个工具，不向上游缝隙注册 `ctx.shell`。
- **`persistent-shell` / `job_*` 后台任务**。010 不提供后台任务启动者，不改 `tool-jobs` 的空壳状态。
- **`tool-fs-search` / ripgrep**。010 不触碰内容搜索（那是 `harmony-plugin-fs-search` 的领域）。
- **PTY**。平台无应用级 PTY API（`forkpty` / `openpty` 被 SELinux 拒），010 不尝试。
- **进程沙箱（koffi / landlock）**。010 的文件面围栏是**工具层**的，不是内核沙箱。
- **重新启用上游 `tool-bash` / `subprocess` / `sandbox` / `bash-sandbox` / `permission`。**
- **`executableBinaryPaths` 或任何上架/ACL 相关机制。**
- **路线图 / 排期。** 每项能力只给判断（可修 / 不修 / 已决策 / 未验证），见 §8.3。

### 1.4 事实来源与标注

本规范的结论**只**来自下列来源，不新增、不臆测：

| 来源 | 角色 | 本规范的标注 |
|---|---|---|
| 设备 `3QC0226526001227`（HarmonyOS 6.1.0.135 / API 24）上的实测记录 | 平台行为、进程/退出/僵尸、SELinux、uid、命令可达性、围栏绕过 | `[设备实测]` |
| 本工程源码与其引用的上游 dsh 源码 | 禁用链、配置文件、行号、preset 表、构建脚本 | `[源码]` + `file:line` |
| OpenHarmony 上游仓库 / 构建文件 / 官方文档（`third_party_toybox`、`TOYBOX_VERSION "0.8.12"`、`BUILD.gn`、`third_party_mksh/BUILD.gn:147`、`toybox.gni:31-35`、`cl.filemanagement.2`、SDK 4.1.5.2） | 命令清单、编译标志、sh 的真实构建来源、第三方应用受限项 | `[上游]` + 文件/条目名 |
| 本规范的**设计决策**（协议格式、默认值、围栏算法、配置项） | 由本模块自行确定、可被评审 | `[设计]` |

**纪律**：任何未在真机上验证的结论**必须**显式标注 `未验证`（或 `[NEEDS CLARIFICATION]`）。标注 `[设备实测]` 的条目**只**覆盖来源中明确记录过的测量；不得据此推断相邻结论。

## 2. 术语与图例

### 2.1 状态图例

| 标记 | 含义 |
|---|---|
| ✅ | 已实测通过 / 结论已被证据直接支持 |
| ⚠️ | 受限 / 部分可用 / 尽力而为（有已知边界） |
| ❌ | 无此能力，或已确认不可行 |
| ❓ | 未实测（`未验证`） |

### 2.2 根因分层（沿用 301 的 L1-L4）

与 `specs/301-skill-runtime-capabilities/spec.md:65-76` 一致：

| 层 | 性质 | 本模块中的典型项 |
|---|---|---|
| **L1 平台硬约束** | 鸿蒙产品策略 / 权限体系 | PTY（`forkpty` / `openpty` 被 SELinux 拒）、`symlink()`、`chmod()` / `chown()` |
| **L2 原生产物缺失** | `dsh-dist` 在 Windows 收集，`node-pty` 是 win32-x64 | 上游 `tool-bash` 的默认后端 |
| **L3 本工程配置选择** | `cordis.patch.yml` + agent preset 的 disabled 行 | `HARMONY_DISABLED_PRESET_ROWS` 对 `tool-bash` 的禁用 |
| **L4 dsh 上游接口缺失** | `ctx.shell` 服务不存在于本组合 | 010 不实现 `ctx.shell`，只交付工具 |

### 2.3 命令可达性分级（本模块新增）

设备 `toybox` 0.8.12 与 OpenHarmony 内置的同一份（`third_party_toybox`，`TOYBOX_VERSION "0.8.12"`）。OpenHarmony 标准系统 `BUILD.gn` 编译 **176** 个 toy 源文件 → **223** 个 applet → `/system/bin` 下 **206** 个 symlink。命令按**可达方式**分四类，**不可互换**：

| 级别 | 含义 | 例子 | 调用方式 |
|---|---|---|---|
| **A 直接可达** | 已 symlink 进 `/system/bin`，直接命令名即可解析 | `ls cat grep sed cp mv rm find xargs sort ps kill date env id uname which` 等（完整分组见 §4 FR-4） | `ls` |
| **B 仅 `toybox` 可达** | 已编译但**未** symlink，直接命令名**不在 PATH 上** | `base32 blkid nc netcat route reboot sha224sum sha384sum sha512sum unicode getty mdev openvt deallocvt telnetd nfsmount i2ctransfer bootchartd` | `toybox nc` |
| **C 需编译标志** | 由 `toybox_extended_cmd` 构建开关控制，**默认 `false`**（`toybox.gni:31-35`，未找到公开 product override） | `awk wget diff expr getfattr ipcs telnet traceroute traceroute6 tr` | 需先 `toybox --long` 核实；**`未验证`** |
| **D 未编译** | 根本不存在 | `bash`、`busybox`、全部 GNU coreutils、`fdisk fsck vi man strace bc hexdump`、toybox 自身的 `sh.c` / `su.c` | ❌ |

> **官方文档是超集**：OpenHarmony 官方文档**确实**记录 `awk` / `wget` / `diff` / `telnet` / `traceroute`，但 OH FAQ 明说"若命令在本主题有描述，则该命令**未被编译**"，因此**文档不得当作保证**。C 类一律按 `未验证` 处理，依赖前必须在真机跑 `toybox --long`。
>
> **`build_selinux` 差异**：SELinux 构建下 `chcon` **被加入** symlink 集合、`restorecon` **被移除**。本规范以普通标准系统构建的 206 symlink 为准。

### 2.4 其它术语

| 术语 | 含义 |
|---|---|
| **非 PTY exec 后端** | 不用伪终端，靠 `spawn` + pipes + 哨兵行驱动一个常驻 shell 的后端 |
| **哨兵行（sentinel line）** | 由 shell 在命令前后打印的、带随机 token 的独立标记行；起始行开捕获、结束行携带退出码并关捕获 |
| **常驻 shell 会话** | 进程内唯一、跨多次 `bash` 调用复用的一个 `/system/bin/sh` 子进程 |
| **工具层围栏** | 在**命令字符串派发之前**做的 token 级路径检查；不是内核沙箱，不是 `fs-sandbox` |
| **fail-closed** | 判定为"不允许/不确定"时按拒绝处理；围栏拒绝发生在审批之前 |
| **升级（escalation）** | 围栏拒绝后经 dsh 既有审批路径申请更宽权限；获批后按调用打戳 |
| **会话重置（reset）** | 杀掉当前子进程并重新 spawn 一个；**每次重置泄漏一个僵尸** |

## 3. 环境基线

平台事实取自设备实测（`[设备实测]`）：

| 项 | 值 | 出处 |
|---|---|---|
| 设备 / 系统 | `3QC0226526001227` / HarmonyOS 6.1.0.135（API 24） | `[设备实测]`，与 `specs/301-skill-runtime-capabilities/spec.md:84-85` 同一设备 |
| `process.platform` | `openharmony` | `[设备实测]` |
| `process.arch` | `arm64` | `[设备实测]` |
| Node 版本 | `22.17.0` | `[设备实测]` |
| `process.execPath` | `/data/app/electron.org/electron_1.0/bin/electron/electron`，**该路径不存在（`ENOENT`）** | `[设备实测]` |
| 子进程 uid | 与应用相同（`20020195`）；`id` 报 `bad uid 20020195`，无额外特权 | `[设备实测]` |
| 可用的 spawn 目标 | `/system/bin/toybox`（0.8.12）、`/system/bin/sh`、`/bin/sh` | `[设备实测]` |
| `statSync` 可执行性探测 | **不可靠**：`/system/bin/sh` 与 `/bin/sh` 都返回 `EACCES`，但能正常 spawn | `[设备实测]` |
| 观测到的事件序列 | `proc:spawn → stdout:end → stderr:end → stdout:close`；`proc:exit` / `proc:close` **从不触发** | `[设备实测]` |
| 僵尸 | 每次 spawn 泄漏**恰好一个**僵尸；实测 4 spawns → 4 zombies；一个会话累计 30 个僵尸挂在 Electron 主进程 pid 上 | `[设备实测]` |
| 退出码恢复 | `sh -c '<cmd>; echo "__RC=$?"'` 得 `__RC=0` / `__RC=1` / `__RC=127` | `[设备实测]` |
| 第三方应用被拒的两项 | `symlink()` 与 `chmod()` / `chown()` 返回 `13900012 Permission denied`（OpenHarmony 文件管理子系统变更 `cl.filemanagement.2`，SDK 4.1.5.2） | `[设备实测]` + `[上游]` |

**两条硬性推论**：

1. **`process.execPath` 永不作为 spawn 目标**（`ENOENT`）。
2. **永不使用 `statSync` 判定可执行性**（`EACCES` 假阴性）；可执行性只由"spawn 成功且返回正确 stdout"判定。

**工作区与可写根语义**（沿用 301 的实测结果，`specs/301-skill-runtime-capabilities/spec.md:266-273`）：应用进程内可写根为 `["/data/storage/el2/base/files/aaa", "/tmp", "/data/storage/el2/base/cache", "/storage/Users/currentUser/Desktop", "/storage/Users/currentUser/Documents", "/storage/Users/currentUser/Download"]`，其中用户目录三项由 `src-main/main.js:600-630` 经 `DSH_EXTRA_WRITABLE_ROOTS` 注入。该变量是**部署期状态，不是模型输入**。

## 4. 功能需求

> FR-1 至 FR-6 为本模块的六个能力域。每个断言后的括注指向 §1.4 的来源标注。

### FR-1 常驻 shell 会话与哨兵行协议

| 需求 | 状态 | 根因层 | 判断 |
|---|---|---|---|
| 单常驻 shell 会话 | ✅（约束明确） | L1 | **已决策**：spawn **一次** `/system/bin/sh`，stdin/stdout/stderr 三管道，跨调用复用；**禁止**一次命令一次 spawn |
| 以哨兵行判完成 | ✅（约束明确） | L1 | **已决策**：完成由 stdout 上的哨兵行判定，**不**依赖退出事件 |
| 退出码经哨兵行带回 | ✅（机制已验证） | 无 | **已决策**：shell 打印 `$?`，格式见 FR-1.5 |
| `exec` / `execFile` 不可用 | ❌ | L1 | **不修**：`exec()` 从不回调（`[设备实测]`），禁用这两个 API |

**FR-1.1（单进程不变式）** 后端**必须**是一个长期存活的 shell 子进程。理由：退出不可观测 ⇒ 每次 spawn 泄漏恰好一个僵尸（`[设备实测]`：4 spawns → 4 zombies；一个会话累计 30 个）。一次命令一次 spawn 会在一个会话内线性泄漏僵尸，不可接受。

**FR-1.2（完成判定）** 一次命令的"完成"**只**由 stdout 上出现本次调用的结束哨兵行判定。`proc:exit` / `proc:close` **从不触发**，任何依赖它们的设计都是错的（`[设备实测]`）。

**FR-1.3（禁用 API）** **不得**使用 `child_process.exec` / `execFile`；**不得**依赖 `'exit'` / `'close'` 事件作为完成信号。

**FR-1.4（退出码）** 命令退出码由 shell 在命令结束后读取 `$?` 并写进结束哨兵行。`sh -c '<cmd>; echo "__RC=$?"'` 得 `0` / `1` / `127` 已实测（`[设备实测]`），本模块复用同一语义（`0` 成功、`127` 命令未找到）。

**FR-1.5（哨兵行格式，`[设计]`）** 每次调用生成一个**一次性随机 token**（16 位十六进制）。发往 shell stdin 的框架为：

```
printf '\n__DSH_BASH_BEGIN__ %s\n' '<token>'
{ <command>
} 2>&1
__dsh_rc=$?
printf '\n__DSH_BASH_END__ %s %s\n' '<token>' "$__dsh_rc"
```

- 起始行：`__DSH_BASH_BEGIN__ <token>`，独立成行（前置 `\n` 保证行边界）。
- 结束行：`__DSH_BASH_END__ <token> <rc>`，独立成行，`<rc>` 为十进制退出码。
- 捕获窗口 = 起始行之后、结束行之前的**逐字节**输出；结束行的 `\n` 前缀把结束标记推到新行，因此命令行输出即使不以换行结尾也不会污染标记。
- token 每调用随机，命令自身无法预测；解析器只认**与本次 token 精确匹配**的结束行，输出中偶然出现的近似字符串不构成结束。

**FR-1.6（单一输出流）** 命令的 stdout 与 stderr 在 shell 侧经 `{ ... } 2>&1` 合流为**同一** stdout 流，行序即真实执行序。子进程独立的 stderr 管道**只**用于 shell 级诊断（如子进程意外死亡），**不**承载协议。

**FR-1.7（会话状态）** 常驻 shell 使 `cwd` 与 shell 变量在多次 `bash` 调用之间**持续存在**（`cd` 会延续）。这是"单常驻 shell"的直接后果，**是刻意属性**，不是缺陷；工具描述必须告知模型。会话起始 `cwd` 为会话工作区。

**FR-1.8（命令非空与长度）** 空命令或纯空白命令在派发前拒绝；命令长度超过 `maxCommandChars`（FR-5）在派发前拒绝。

### FR-2 命令分发与输出 / 退出码

| 需求 | 状态 | 根因层 | 判断 |
|---|---|---|---|
| 模型可见工具名 `bash` | ✅（已决策） | 无 | **已决策**：与上游身份一致，既有技能与文档保持连贯；后端非 PTY 由描述披露 |
| 输出 + 退出码渲染 | ✅ | 无 | **已决策**：结果含 `Exit code:` 与命令输出正文 |
| 非交互 / 无 TTY | ⚠️ | L1 | **不修**：无 PTY；交互式程序（`top`、`vi` 类）行为无法保证，标记 `未验证` |
| PATH 查找 | ✅ | 无 | 实测放行，`/system/bin/sh` 按 PATH 解析（`[设备实测]`） |

**FR-2.1（工具名与描述）** 注册的模型可见工具名**必须**是 `bash`（`[设计]`），描述中**必须**写明：后端是非 PTY、非交互的常驻 shell；无 TTY；`cwd` 跨调用延续。

**FR-2.2（参数，`[设计]`）**

| 参数 | 必填 | 说明 |
|---|---|---|
| `command` | 是 | 要执行的命令字符串，交由常驻 shell 解释 |
| `timeout_ms` | 否 | 本次调用的超时；只能**下调**到工具自身 `commandTimeoutMs` 以内，超过则被钳制 |
| `sandbox_permissions` / `justification` | 否 | 由围栏升级机制在受限组合下提供（见 FR-3）；无沙箱能力的组合下这两个字段**不出现**于 schema |

**FR-2.3（结果渲染，`[设计]`）** 结果为一个文本块：

```
Exit code: <rc>
<命令输出正文>
```

被截断时追加一行 `[output truncated: kept <N> of <M> bytes]`。被取消时追加 `[command cancelled]`。

**FR-2.4（输出保真）** 输出按**逐字节**捕获，不做文本解码后再编码；非 UTF-8 字节不得导致调用失败。含 NUL 的二进制输出按原字节返回（是否可渲染由客户端决定）。

**FR-2.5（退出码非零不是工具错误）** 退出码非零是**正常结果**（`Exit code: 1`），不得作为工具异常抛出；只有围栏拒绝、超时不可恢复、会话不可用才是工具错误。

**FR-2.6（交互式命令，`未验证`）** 无 PTY 意味着需要 TTY 的程序（`top`、`watch`、`more` 等）行为未知；**未在真机验证**。工具描述应引导优先使用非交互形式。

### FR-3 路径围栏与审批

| 需求 | 状态 | 根因层 | 判断 |
|---|---|---|---|
| exec 工具层路径围栏 | ⚠️（尽力而为） | L1 + L3 | **已决策**：**必须**实现，否则接受安全降级；但**不是沙箱** |
| fail-closed 顺序 | ✅（已决策） | L3 | **已决策**：围栏拒绝**先于**审批交互 |
| 审批升级 | ✅（链路既有） | 无 | **已决策**：复用 `@deepseek-ai/dsh-sandbox` 的审批与拒绝标记 |
| 完全围栏 shell 子进程 | ❌ | L1 | **不修**：shell 以同 uid 运行、直连文件系统，工具层围栏**无法**构成内核级隔离 |
| 符号链接逃逸 | ⚠️ | L1 | **缓解项**：`ln -s` 实测**失败**（symlink 被拒），但不作为保证 |

**FR-3.1（围栏先于审批）** 对命令字符串的路径检查**必须**发生在命令派发之前，且围栏拒绝**必须**发生在审批交互之前：不得为了"先问用户"而跳过围栏判定（与 `specs/301-skill-runtime-capabilities/spec.md:245` 的 `FR-6.1.1` 同口径）。

**FR-3.2（围栏算法，`[设计]`）** 派发前对命令字符串做 token 级分析：

1. **词法切分**：按 POSIX shell 词法切分命令，尊重单引号、双引号与反斜杠转义。
2. **抽取路径候选 token**：含 `/` 的 token、以 `.` 或 `~` 开头的 token、以及重定向操作符（`>`、`>>`、`<`、`<>`）的目标 token。
3. **词法规范化**：以会话 `cwd` 为基准做词法 `resolve`/归一化（消除 `.` 与 `..`），**不**访问文件系统（不解析符号链接）。
4. **判定**：归一化后的路径若落在**允许根集合**内 ⇒ 放行；否则 ⇒ **拒绝**（fail-closed），返回共享拒绝标记 + 升级提示。

**FR-3.3（允许根集合，`[设计]`）** 与 `src-main/main.js:600-630` 的可写根语义对齐：

- 会话工作区 `cwd`（来自 `exec.agent.session.header.cwd`）；
- `DSH_EXTRA_WRITABLE_ROOTS` 环境变量列出的部署期目录（`path.delimiter` 分隔）。

> **`[NEEDS CLARIFICATION]`**：是否应改为直接复用 dsh 的 `writableRoots()` seam（而非读环境变量）尚未确认 —— 本次**未**在源码中定位到插件可用的该访问器。当前设计以会话 `cwd` + `DSH_EXTRA_WRITABLE_ROOTS` 为准，并在真机用例中核对两者与 `specs/301-skill-runtime-capabilities/spec.md:266-273` 的实测可写根一致。

**FR-3.4（不可判定构造）** 命令中出现会**隐藏**路径的构造时，围栏无法证明其安全：变量展开（`$X` / `${X}`）、命令替换（`$(...)` / 反引号）、`eval`、嵌套 `sh -c` / `sh` / `env` / `xargs` / `find -exec`、以及引号内的路径拼接。`fenceMode: enforce`（默认）下这些构造一律按**不可判定**处理并**拒绝**，经升级审批放行。

**FR-3.5（重定向目标同样受限）** `>` / `>>` / `<` / `<>` 的目标路径**必须**参与同一围栏判定，不得只检查命令操作数。

**FR-3.6（升级与打戳）** 被拒时返回共享标记（`@deepseek-ai/dsh-sandbox` 的 `sandboxDenialMarker` + `escalationHintMarker`）与升级提示；带最窄足够更宽模式 + `justification` 的一次重试触发**一次**用户审批；获批模式按调用打戳并覆盖该调用的**全部**动作（与 `plugins/harmony-plugin-fs-mutate/lib/sandbox.js` 的语义一致）。

**FR-3.7（模式配置，`[设计]`）** `fenceMode` 取 `enforce`（默认）/ `warn` / `off`：

| 值 | 行为 |
|---|---|
| `enforce`（默认） | 越界字面路径与不可判定构造**均拒绝**（fail-closed），可经审批升级 |
| `warn` | 仅记录日志并放行；**显式安全降级** |
| `off` | 不检查；**显式安全降级** |

`warn` / `off` 必须在插件启动日志中**响亮**声明（`[dsh-harmony]` 前缀）—— 静默降级不可接受。

**FR-3.8（符号链接，缓解而非保证）** `ln -s` 实测失败（symlink 被平台拒），这**降低**了"用软链把越界路径伪装成界内路径"的风险，但**不构成保证**：平台行为可能变化，且其它间接路径（变量展开、嵌套 shell）本就不经符号链接即构成绕过（见 §6.4）。不得把该缓解项写成"围栏因此安全"。

### FR-4 命令 allowlist 与能力披露

| 需求 | 状态 | 根因层 | 判断 |
|---|---|---|---|
| 能力四分类披露 | ✅（已决策） | 无 | **已决策**：A/B/C/D 四类在工具描述与能力清单中分列 |
| C 类（extended）可信度 | ❓ | 上游构建 | **未验证**：默认 `false`；依赖前必须真机 `toybox --long` |
| 命令级 allowlist | ⚠️（可选） | L3 | **已决策**：默认 `disclose-only`，可选 `allowlist` / `denylist` |
| 危险命令默认拒绝 | ⚠️（可选） | L3 | **已决策**：`denyCommands` 默认列出系统/硬件类命令 |
| `chmod` / `chown` 平台拒绝 | ⚠️ | L1 | **不修**：PATH 上存在但运行时被平台拒（`13900012`），在披露中标注 |
| mksh builtin 遮蔽 | ✅ | L1 | **已确证**：`/system/bin/sh` = mksh R59（真机裁定，FR-4.6），其 builtin 确实遮蔽同名 toybox 命令 |

**FR-4.1（能力四分类）** 工具描述与配套能力清单**必须**区分 §2.3 的 A/B/C/D 四类：A 类可直接调用；B 类**只能**经 `toybox <name>` 调用（直接命令名不在 PATH 上，典型如 `nc` / `netcat`）；C 类需先核实；D 类不存在。

**FR-4.2（C 类一律标注未验证）** C 类（`awk wget diff expr getfattr ipcs telnet traceroute traceroute6 tr`）由 `toybox_extended_cmd` 控制、默认 `false`（`toybox.gni:31-35`，未找到公开 product override），**且官方文档是超集**。因此 C 类一律 `未验证`；依赖前必须在真机执行 `toybox --long` 核实该 applet 是否编入。

**FR-4.3（命令策略，`[设计]`）** `commandPolicy` 取：

| 值 | 行为 |
|---|---|
| `disclose-only`（默认） | 不做命令名级检查；只做 FR-4.1 的披露 |
| `allowlist` | 只允许显式列出的命令名；其余拒绝并升级 |
| `denylist` | 除 `denyCommands` 外允许 |

**FR-4.4（`toybox` 直通的 allowlist 漏洞，必须处理）** 在 `allowlist` 模式下，若把 `toybox` 本身列入允许集，则 `toybox <任意 applet>` 会**绕过**命令名 allowlist。因此 `allowlist` 模式对 `toybox` **必须**做特殊处理：仅当其子命令在声明的 B 类白名单内时放行，否则拒绝。

**FR-4.5（默认 `denyCommands`，`[设计]`）** 默认拒绝一组系统级 / 硬件级命令（即使在 `disclose-only` 下也拒绝），因为它们无正常模型用途且失败模式嘈杂：`reboot reset mount umount swapon swapoff mkswap insmod rmmod modinfo devmem i2cdetect i2cdump i2cget i2cset i2ctransfer chroot pivot_root switch_root nsenter unshare`。该列表可配置。

**FR-4.6（`/system/bin/sh` 身份 —— **已于真机裁定：mksh R59**）** 本项曾为"两说矛盾、不猜"状态：设备记录称 `readlink /proc/self/exe` 解析为 toybox，而 OpenHarmony 源码显示 `/system/bin/sh` 由 `third_party_mksh/BUILD.gn:147` 以 `ohos_executable("sh")` 从 **mksh R59c** 构建、toybox 的 `sh.c` 未编译。

**2026-09-22 真机裁定（设备 `3QC0226526001227`，见 `logs/20260922-1/TEST_REPORT.md` §E）**：`/system/bin/sh` **是 mksh R59（2020/10/31）**，OpenHarmony 源码正确、原设备记录错误。判定证据：

```
md5sum /system/bin/sh     = 5b5e8eb9591548a4120cdeacfa320ec2
md5sum /system/bin/toybox = 19f83712ed609de90655d35e9f129363   ← 两者不同
KSH_VERSION = @(#)MIRBSD KSH R59 2020/10/31                    ← 决定性
```

**两个会得出假结论的探针（必须记录，不得再用）**：

- `readlink /proc/self/exe` 在本平台对 mksh **报出 `/system/bin/toybox`** —— 按此判定会得到**错误**结论（原设备记录即栽在此处）。
- `uname -a` 尾部的 `Toybox` 是**内核 build-time utsname 字符串**，与当前 shell 无关。

**已确认的后果（2026-09-22 逐条实测，`unalias` 后判定；详见 `docs/toybox命令清单.md`）**：被 shell 抢先的名字**只有 11 个** —— mksh **内建** `cat` / `echo` / `false` / `kill` / `pwd` / `realpath` / `sleep` / `test` / `true` / `ulimit`，加**保留字** `time`。这些名字裸名跑的是 **mksh 实现**，要 toybox 实现须写 `toybox <n>`。

⚠️ **更正**：本规范上一版把 `printf` 一并列为"内建遮蔽"，**不准确** —— `unalias printf; type printf` 报 `tracked alias for /bin/printf`，即 `printf` **走 PATH 上的 toybox**。`ls` / `grep` / `sed` 同理，均**不是**内建。

**同批实测的另两项结论**（已并入 FR-4.1/FR-4.2）：

- **`toybox_extended_cmd` 在本设备已启用**：`awk` / `wget` / `diff` / `expr` / `tr` / `telnet` / `traceroute` / `traceroute6` / `getfattr` / `ipcs` **全部已编译、软链齐全、可直接使用** ⇒ 原"C 类一律 `未验证`"的保守假设在本设备**不成立**，C 类实测可用。
- **B 类只有 `nc` 一个**（不在原记录的 18 项之列）；原以为的 B 类成员多为**悬空软链**（42 个：软链指向 `toybox` 但 applet 未编译，执行报 `toybox: Unknown command`） ⇒ **判定可用性必须用 `toybox <n> --help`，不得用 `ls` / `command -v`**。另有 4 个软链指向**其它程序**（`reboot`/`service_control` → `begetctl`；`resize.f2fs`/`sload.f2fs` → `fsck.f2fs`），其中 `reboot` **会真的重启设备**。

**FR-4.7（`chmod` / `chown` 的运行时拒绝）** `chmod` 在 A 类 symlink 集合内，但第三方应用调用 `chmod()` / `chown()` 被平台拒（`13900012`，`cl.filemanagement.2` / SDK 4.1.5.2）。因此命令**存在但运行时失败**；披露中必须标注，不得声称权限位可改。

**FR-4.8（`build_selinux` 差异）** `chcon` / `restorecon` 的可达性随 `build_selinux` 变化（前者加入、后者移除）；披露不得把它们当固定成员。

### FR-5 超时 / 取消 / 输出截断

| 需求 | 状态 | 根因层 | 判断 |
|---|---|---|---|
| 超时 | ✅（已决策） | L3 | **已决策**：默认 `120000` ms，可配置 |
| 取消（`exec.signal`） | ✅（已决策） | L3 | **已决策**：优先"drain 到哨兵"，无法恢复才重置 |
| 输出截断 | ✅（已决策） | L3 | **已决策**：默认保留上限 `262144` 字节，可配置 |
| 命令长度上限 | ✅（已决策） | L3 | **已决策**：默认 `65536` 字符，可配置 |

**FR-5.1（默认值，`[设计]`）**

| 配置键 | 默认 | 含义 |
|---|---|---|
| `commandTimeoutMs` | `120000`（2 分钟） | 单次命令墙钟上限（含排空） |
| `maxOutputBytes` | `262144`（256 KiB） | 单次命令保留的输出字节上限（含边界） |
| `maxCommandChars` | `65536` | 单次命令字符串字符上限 |
| `fenceMode` | `enforce` | 见 FR-3.7 |
| `commandPolicy` | `disclose-only` | 见 FR-4.3 |
| `shellPath` | `/system/bin/sh` | 常驻 shell 可执行文件 |

所有数值配置在 `apply` 阶段校验为**正安全整数**，非法值使插件组合失败（与 `harmony-plugin-fs-search` / `harmony-plugin-fs-mutate` 的既有口径一致）。

**FR-5.2（超时处置顺序）** 超时时先尝试**排空到哨兵**（继续读 stdout 直到结束哨兵或二次超时），以便把已产生的输出交给模型；只有在排空也失败（会话无法回到已知状态）时才**重置会话**（FR-6.3）。重置必然泄漏一个僵尸，因此是最后手段。

**FR-5.3（取消处置）** `exec.signal` 中止时，工具**不得**丢弃已经到达的输出：标记 `[command cancelled]`，优先排空到哨兵；若命令不响应且超时也到，按 FR-5.2 重置。取消不得把会话留在"下一个命令的哨兵会与上一个命令的输出混淆"的状态。

**FR-5.4（输出截断）** 输出超过 `maxOutputBytes` 时保留**前** `maxOutputBytes` 字节，追加 `[output truncated: kept <N> of <M> bytes]`，并**继续排空**直到结束哨兵以保证会话同步（截断的是返回给模型的内容，不是管道的读取）。`<M>` 为实际总字节数。

**FR-5.5（超时非工具成功）** 超时是工具结果的一部分：返回 `Exit code: <未知或哨兵值>` + 已捕获输出 + 超时说明；不得伪装成 `Exit code: 0`。

**FR-5.6（串行化）** 单会话意味着同一时刻**只能**有一条命令在途。工具执行**必须**串行化：并发调用排队（或按实现拒绝并说明）。不得在同一常驻 shell 上并发注入框架。

### FR-6 会话生命周期与僵尸约束

| 需求 | 状态 | 根因层 | 判断 |
|---|---|---|---|
| 惰性 spawn | ✅（已决策） | 无 | **已决策**：首次 `bash` 调用时 spawn，插件实例内唯一 |
| 会话存活判定 | ✅（已决策） | L1 | **已决策**：以 stdout 关闭推断子进程不可用 |
| 重置成本 | ⚠️ | L1 | **不修**：每次 spawn 泄漏一个僵尸，重置必须稀少 |
| 子进程权限 | ⚠️（同 uid） | L1 | **不修**：无额外特权即为下限，也是围栏无法内核化的根因 |
| `cwd` 延续 | ✅ | 无 | **已决策**：单常驻 shell 的自然属性（见 FR-1.7） |

**FR-6.1（惰性 spawn 与单例）** 插件实例内**至多**存在一个 shell 子进程；首次调用时 spawn，之后复用。spawn 失败（例如 `shellPath` 不存在）必须**响亮**报错并让调用失败，不得静默回退到其它目标。

**FR-6.2（存活判定）** 因为退出不可观测（`[设备实测]`），子进程存活只能由 stdout 的 `close` / `end` 推断：stdout 关闭 ⇒ 会话不可用 ⇒ 后续调用触发一次重置。**不得**等待 `exit` / `close` 事件。

**FR-6.3（重置）** 重置 = 杀掉当前子进程（若存活）+ 重新 spawn + 重新初始化 `cwd`。触发条件限于：stdout 已关闭、超时排空失败、显式要求。**每次重置泄漏一个僵尸**（`[设备实测]`：每次 spawn 恰好一个），因此重置在设计与测试中都要被当作**昂贵操作**对待；不得把"每个命令前重置一次"当作实现手段。

**FR-6.4（子进程特权边界）** 子进程以**应用自身 uid**（`20020195`）运行，`id` 报 `bad uid 20020195`，**无**任何额外特权（`[设备实测]`）。这既是安全下限（不存在提权），也是"工具层围栏无法替代内核沙箱"的根因：越界路径的**读写能力本身**在子进程内是真实存在的。

**FR-6.5（spawn 目标约束）** **不得**使用 `process.execPath` 作为 spawn 目标（其路径 `ENOENT`，`[设备实测]`）；**不得**用 `statSync` 判定可执行性（`EACCES` 假阴性，`[设备实测]`）。`shellPath` 只接受已知可 spawn 的目标（`/system/bin/sh`、`/bin/sh`、`/system/bin/toybox` 已实测放行）。

**FR-6.6（会话工作目录）** 会话 `cwd` 初始为会话工作区；因为 `cd` 跨调用延续（FR-1.7），围栏的"允许根"判定也随 `cwd` 变化 —— 这是刻意的：模型 `cd` 到界内目录后，相对路径继续按该目录解析。

## 5. 已知限制

以下为该能力边界的已知限制，均来自 §1.4 的来源；未在真机验证的条目标注 `未验证`。

**执行模型**

1. **无 PTY、无 TTY**：平台无应用级 PTY API，`forkpty` / `openpty` 被 SELinux 拒；交互式程序行为无法保证（`未验证`）。
2. **退出不可观测**：`proc:exit` / `proc:close` 从不触发，子进程成僵尸；完成只能靠哨兵行（FR-1.2）。
3. **每次 spawn 泄漏一个僵尸**：实测 4 spawns → 4 zombies；一个会话累计 30 个僵尸（FR-6.3）。
4. **必须单常驻 shell**：一次命令一次 spawn 会线性泄漏僵尸（FR-1.1）。
5. **`exec` / `execFile` 不可用**：无从回调（FR-1.3）。
6. **命令串行**：同一时刻只能一条命令在途（FR-5.6）。

**能力可达性**

7. **B 类命令不在 PATH 上**：`nc` / `netcat` 等只能经 `toybox <name>` 调用（§2.3）。
8. **C 类命令默认未编译**：`awk` / `wget` / `diff` / `expr` 等受 `toybox_extended_cmd`（默认 `false`）控制，**官方文档是超集**；依赖前必须真机 `toybox --long`（`未验证`）。
9. **D 类命令不存在**：无 `bash`、`busybox`、GNU coreutils、`vi`、`strace` 等（§2.3）。
10. **`chmod` / `chown` 运行时被平台拒**（`13900012`）：命令在 PATH 上但改不了权限位（FR-4.7）。
11. **`chcon` / `restorecon` 随构建变化**（FR-4.8）。
12. **sh 身份已裁定为 mksh R59**（原为"两说矛盾"）：`/system/bin/sh` **是** mksh R59，其 `time` / `test` / `pwd` / `realpath` / `ulimit` / `kill` / `echo` / `printf` 等 builtin **确实遮蔽**同名 toybox 命令。⚠️ 不得用 `readlink /proc/self/exe`（会误报 toybox）或 `uname -a`（内核 utsname）判定 shell 身份（FR-4.6，真机证据见 `logs/20260922-1/TEST_REPORT.md` §E）。

**安全**

13. **shell 绕过 `fs-sandbox` 与审批**：子进程直接读写用户目录，不经过 `checkedTarget`、不弹审批（`[设备实测]`）。
14. **工具层围栏是尽力而为、可被绕过**：变量展开、`$(...)`、嵌套 `sh -c` 等构造可绕过 token 级检查（FR-3.4、§6.4）。**不得**把本围栏描述为沙箱。
15. **符号链接拒绝只是缓解**：`ln -s` 实测失败，但不构成保证（FR-3.8）。
16. **子进程无内核沙箱**：进程沙箱（koffi / landlock）缺席，010 不引入。

**工具接口**

17. **命令字符串上限**：超过 `maxCommandChars` 在派发前拒绝（FR-1.8 / FR-5.1）。
18. **输出截断**：超过 `maxOutputBytes` 只保留前若干字节（FR-5.4）。
19. **超时的退出码不可靠**：超时时退出码未知或由哨兵带回；不得伪装成功（FR-5.5）。
20. **`warn` / `off` 是显式安全降级**：必须在启动日志响亮声明（FR-3.7）。

## 6. 安全：围栏语义、顺序与旁路披露

本节是 010 的核心。来源为设备实测（`[设备实测]`）与既有围栏/审批语义（`specs/301-skill-runtime-capabilities/spec.md:237-280`）。

### 6.1 为什么需要一个新围栏

`fs-sandbox` 的围栏只在**经 `ctx.fs` 的文件操作**上生效。shell 子进程**不经过** `ctx.fs`：实测中它直接写入 `/storage/Users/currentUser/Documents`、删除它、跨目录 `mv`、`cp`、`mkdir -p`、`rm -rf`，**不经过 `checkedTarget`、不弹任何审批**。因此：

- 既有围栏与审批体系对 shell **整体失效**；
- 010 若只"接个 `spawn`"，等于**引入一个静默绕过全部文件安全的通道**。

这正是 301 §6.4 `未在规范中实施` 所记录的风险（`specs/301-skill-runtime-capabilities/spec.md:280`），010 是它的落地实现。

### 6.2 fail-closed 与顺序

**FR-6.1.1（顺序，强制）** 围栏判定**先于**审批：越界路径先被拒绝，**该拒绝发生在审批之前**（与 301 的 `FR-6.1.1` 同口径）。不得为了"先问用户"而跳过围栏检查。

**FR-6.2.1（默认拒绝）** 审批的默认结局是拒绝：升级链路任一处不可用时按拒绝处理（沿用 `ApprovalService.decide()` 的 `unavailable ⇒ 拒绝` 语义，见 301 §6.2）。

### 6.3 围栏可判定性矩阵（`[设计]`）

| 输入形态 | `enforce` 下的判定 | 说明 |
|---|---|---|
| 界内字面路径（`cwd` 之下） | 放行 | 归一化后落在允许根内 |
| 界外字面路径（`/etc/...`、`/storage/...` 非授权目录） | **拒绝** → 升级 | fail-closed |
| 重定向到界外（`> /etc/x`） | **拒绝** → 升级 | FR-3.5 |
| `$VAR` / `${VAR}` 参与路径 | **拒绝** → 升级 | 路径不可判定（FR-3.4） |
| `$(...)` / 反引号 | **拒绝** → 升级 | 命令替换可产出任意路径 |
| `eval` / 嵌套 `sh -c` / `env` / `xargs` / `find -exec` | **拒绝** → 升级 | 分析边界之外 |
| 无路径 token 的纯命令（`ls`、`pwd`） | 放行 | 无路径面 |

> 矩阵只描述**判定**，不承诺**阻断**。§6.4 说明为何。

### 6.4 旁路披露（必须如实记录，不得淡化）

**token 级围栏是尽力而为（best-effort），可被绕过，且残余风险不可消除。** 具体绕过面：

1. **变量展开**：`X=/storage/Users/currentUser; cat $X/Documents/x` —— 围栏只看到 `$X`（无 `/`），无法把它识别为路径。
2. **命令替换**：`cat $(printf '/storage/Users/currentUser/Documents/x')` —— 路径在执行期产生，静态不可见。
3. **嵌套 shell**：`sh -c 'cat /etc/hostname'` —— 若外层命令被放行，内层字符串是普通参数。
4. **间接路径**：工具（如某些 applet）接受配置文件 / 环境变量指定路径，路径不出现在命令字符串里。
5. **`toybox` 直通**：`toybox <name>` 可调用任意已编入 applet（`allowlist` 模式下尤须按 FR-4.4 特殊处理）。

**结论**：本围栏**提高**了越界的成本与可见性，但**不构成**安全边界。任何将该能力交付给不受信输入的部署，都必须把"子进程以应用 uid 拥有完整文件读写能力"作为**已知事实**接受，而不是假称被围栏覆盖。符号链接逃逸被平台拒绝（FR-3.8）是一条**缓解**，不是证明。

### 6.5 显式安全降级

`fenceMode` 设为 `warn` / `off` 即**显式接受**上述残余风险。此时插件必须在启动日志以 `[dsh-harmony]` 前缀**响亮**声明当前模式；不得静默降级（FR-3.7）。

### 6.6 不引入的机制

- **不**重新启用 `node-pty` / PTY / 上游 `subprocess` / `sandbox` / `bash-sandbox` / `permission`。
- **不**用 `ohos.permission.CUSTOM_SANDBOX` 替代（它改的是应用自身沙箱类型，不是进程沙箱）。
- **不**实现 koffi / landlock 进程沙箱。

## 7. 验收标准

每条 AC 均可行验证。**验证方式**列限 `构建期断言` / `单元测试` / `真机 --inspect` / `来源核验` 之一或组合。凡涉及真机执行、当前无设备可用的条目，状态标注 `未验证`。每条 AC 在 `test-cases.md` 有对应用例（见该文件第 5 节「用例与验收标准对照」）。

| 编号 | 验收标准 | 验证方式 | 状态 |
|---|---|---|---|
| AC-1 | 插件文件齐备：`plugins/harmony-plugin-exec/` 含 `package.json`、`README.md`、`README_zh.md`、`lib/{index,session,protocol,fence,inventory,bash,config}.js`、`tests/{protocol,fence,inventory,session,index}.test.mjs` | 构建期断言（目录列举） | ✅ 可构建期核验 |
| AC-2 | 全工程 `harmony-plugin-exec` 包名令牌一致（目录名 / 包名 / `name` 导出 / 两处 preset 行），不存在其它包名令牌 | 构建期断言（`grep -rn`） | ✅ 可构建期核验 |
| AC-3 | 两处 `HARMONY_ENSURED_PRESET_ROWS` 逐条一致（`id` / `name` / `requireRow`），由 `assertPresetRowsMirrorMainJs()` 机械互校 | 构建期断言 + 双文件 grep | ✅ 可构建期核验 |
| AC-4 | `collect-dsh` 后 `dsh-dist/node_modules/harmony-plugin-exec/package.json` 存在且 `name` 正确 | 构建期断言 | ✅ 可构建期核验 |
| AC-5 | 烘焙进产物的 preset（`agent.cordis.yml`）含 `- id: exec` / `name: 'harmony-plugin-exec'`，且上游 `tool-bash` 行仍为 `disabled: true` | 构建期断言 + 构建后 grep | ✅ 可构建期核验 |
| AC-6 | 哨兵行协议：起始行开捕获、结束行带退出码关捕获；token 不匹配的近似行不误判 | 单元测试 | ✅ 可构建期核验 |
| AC-7 | 退出码解析：`0` / `1` / `127` 正确带回；非零退出码不抛工具错误 | 单元测试 | ✅ 可构建期核验 |
| AC-8 | stdout 与 stderr 合流且行序保持；结束哨兵总在新行首 | 单元测试 | ✅ 可构建期核验 |
| AC-9 | 围栏 fail-closed：界外字面路径被拒、界内放行、重定向目标参与判定 | 单元测试 | ✅ 可构建期核验 |
| AC-10 | 围栏不可判定构造（`$VAR` / `$(...)` / 反引号 / `eval` / 嵌套 `sh -c` / `xargs` / `find -exec`）在 `enforce` 下被拒、在 `warn` 下放行并留痕 | 单元测试 | ✅ 可构建期核验 |
| AC-11 | 围栏拒绝**先于**审批交互（先围栏、后升级），且升级按调用打戳覆盖整条命令 | 单元测试 | ✅ 可构建期核验 |
| AC-12 | 变长输出截断：保留前 `maxOutputBytes` 字节、附截断标记、且**继续排空到哨兵**（会话保持同步） | 单元测试 | ✅ 可构建期核验 |
| AC-13 | 超时与取消：标记 `[command cancelled]` / 超时说明，退出码不伪装成 0 | 单元测试 | ✅ 可构建期核验 |
| AC-14 | 命令串行化：并发调用不交错注入框架 | 单元测试 | ✅ 可构建期核验 |
| AC-15 | 配置校验：非法数值（零 / 负 / 非整数）使 `apply` 抛错 | 单元测试 | ✅ 可构建期核验 |
| AC-16 | 静态约束：代码中**无** `exec` / `execFile`、**无**依赖 `'exit'` / `'close'` 事件、**无** `process.execPath` 作 spawn 目标、**无** `statSync` 判可执行性 | 构建期断言（`grep`） | ✅ 可构建期核验 |
| AC-17 | 能力披露四分类（A/B/C/D）在工具描述与清单中齐备，且 C 类标注 `未验证` | 静态 grep + 来源核验 | ✅ 可构建期核验 |
| AC-18 | 命令策略：`allowlist` 下未列命令被拒；`toybox <applet>` 不绕过 allowlist（FR-4.4） | 单元测试 | ✅ 可构建期核验 |
| AC-19 | 默认 `denyCommands` 生效（系统/硬件类命令被拒） | 单元测试 | ✅ 可构建期核验 |
| AC-20 | 未恢复 `node-pty` / PTY / 上游 `subprocess` / `sandbox` / `bash-sandbox` / `permission`（无新增启用） | 构建期断言 + 来源核验 | ✅ 可构建期核验 |
| AC-21 | 本规范不含路线图 / 待办 / roadmap 章节，且不含占位文本；未验证项显式标注 | 静态 grep | ✅ 可构建期核验 |
| AC-22 | 真机：常驻 shell 单进程成立，命令与退出码端到端正确 | 真机 `--inspect` | ❓ `未验证`（无设备） |
| AC-23 | 真机：围栏拒绝真实生效（界外路径被拒），且拒绝先于审批 | 真机 `--inspect` | ❓ `未验证`（无设备） |
| AC-24 | 真机：围栏旁路探针（变量展开 / `$(...)` / 嵌套 `sh -c`）**确实绕过**围栏 —— 如实记录残余风险 | 真机 `--inspect` | ❓ `未验证`（无设备） |
| AC-25 | 真机：僵尸计数符合预期（单会话不线性增长；每次重置 +1） | 真机 `--inspect` + `/proc/<pid>/stat` | ❓ `未验证`（无设备） |
| AC-26 | 真机：`/system/bin/sh` 身份裁定（toybox vs mksh R59c）经 md5 比对给出结论 | 真机命令 | ✅ **已验证**（2026-09-22）= **mksh R59**；见 `logs/20260922-1/TEST_REPORT.md` §E |
| AC-27 | 真机：C 类命令经 `toybox --long` 核实（`awk`/`wget`/`diff`/`expr` 等） | 真机命令 | ❓ `未验证`（无设备） |
| AC-28 | 真机：`chmod` / `chown` 运行时被拒（`13900012`）被证实并在披露中一致 | 真机命令 | ❓ `未验证`（无设备） |
| AC-29 | 真机：既有能力不退化（新建会话、`fs-mutate`、`fs-search`、`skill`） | 真机 `--inspect` | ❓ `未验证`（无设备） |
| AC-30 | 真机：模型可见工具名为 `bash`，且描述披露非 PTY 后端 | 真机 `--inspect` | ❓ `未验证`（无设备） |

## 8. 约束

### 8.1 与宪法的一致

- **源码即真理（constitution §3.1）**：本规范所有平台结论、行号与数字均来自 §1.4 的来源；未验证处显式标注。
- **零上游改动（constitution §1.1）**：本模块**不**改 dsh 源码、**不**新增或删除 dsh 补丁、**不**改上游禁用的四层配置中的任何一层。
- **只写装配代码（constitution §1.3）**：插件只做装配与协议实现，不新造业务逻辑。
- **spec / plan 成对（constitution §6）**：本模块产出 `spec.md` + `plan.md` + `tasks.md` + `test-cases.md`。
- **中文 + 英文技术术语（constitution §6）**：与既有 spec 集口径一致。
- **日志规范（constitution §3.3）**：运行期输出统一 `[dsh-harmony]` 前缀。
- **幂等构建（constitution §5.1）**：`collectPlugins()` 可重复执行；目标已有 `package.json` 即跳过。
- **产物适配集中在收集脚本（constitution §5.3）**：构建期在 `collect-dsh.mjs`，运行期在 `main.js`，双保险。

### 8.2 范围边界（不包含）

- **不**实现 `ctx.shell` 服务、`persistent-shell`、`job_*` 后台任务、`tool-fs-search` / ripgrep、PTY、进程沙箱（koffi / landlock）。
- **不**重新启用上游 `tool-bash` / `tool-pwsh` / `subprocess` / `sandbox` / `bash-sandbox` / `permission`。
- **不**触碰 `profiles/desktop/cordis.patch.yml:36-43` 与 `dsh-web-app/cordis.patch.yml:368-371` 的禁用行；**不**删除 `src-main/main.js:174-178` 中 `tool-bash` 的禁用项（我们的行是**新增**一行 `exec`，不是解除禁用）。
- **不**修改 `plugins/harmony-plugin-fs-mutate/` 与 `plugins/harmony-plugin-fs-search/` 的既有语义；010 复用其围栏/审批**语义**，不回改其代码。

### 8.3 本规范不含路线图

- 本规范**不设**路线图 / 待办 / roadmap 章节。每项能力只给判断（**可修 / 不修 / 已决策 / 未验证**），不给排期与实施步骤。
- `tasks.md` 只做**依赖排序的任务拆解**，不构成时间表。

### 8.4 未验证项的标注（强制）

任何未在真机验证的结论必须显式标注 `未验证`。当前未验证项集中在：C 类命令是否编译（AC-27）、交互式命令行为（FR-2.6）、围栏旁路实证（AC-24）、僵尸计数与超时/取消设备行为、全部真机条目（AC-22~AC-30）中尚未执行者。**已转正的项**：AC-26（`/system/bin/sh` = mksh R59）、会话级 `bash` 工具可调用、哨兵行退出码与多行输出、围栏 fail-closed 与拒绝先于审批、C2 修复（cwd = 会话工作区）—— 证据见 `logs/20260922-1/TEST_REPORT.md` §D/§E。

### 8.5 规范源 ↔ 技能同步（强制）

本工程内置技能 `skills/harmony-runtime-capabilities/SKILL.md` 是能力的**运行期摘要**。010 一旦交付，`bash` 能力与"无 shell"的既有表述**冲突**，**必须**同步更新该技能（并核对 `docs/鸿蒙环境能力清单-v0.1.5.md` 的 FR-3 相关结论）。未同步的技能会让模型拒绝使用新工具（本工程已有先例，见 `README.md` 的技能告警段与提交 `c9ad23e`）。同步方向**单向**：先改本规范，再改技能。

### 8.6 未解张力的处置

`/system/bin/sh` 身份矛盾（FR-4.6）**不**在文档层裁定，**必须**由真机 md5 比对给出；在裁定前，凡依赖 sh 身份的结论保持 `未验证`。不得用推测填补。

## 9. 术语

| 术语 | 含义 |
|---|---|
| **非 PTY exec 后端** | 不用伪终端，靠 `spawn` + pipes + 哨兵行驱动常驻 shell 的执行后端 |
| **常驻 shell 会话** | 插件实例内唯一、跨调用复用的 `/system/bin/sh` 子进程 |
| **哨兵行（sentinel line）** | 带一次性随机 token 的独立标记行；起始行开捕获、结束行携带退出码并关捕获 |
| **框架（framing）** | 发往 shell stdin 的 `printf BEGIN / 命令 / printf END` 包装；`[设计]`，格式见 FR-1.5 |
| **排空（drain）** | 超时/取消后继续读 stdout 直到结束哨兵，以保持会话同步的动作 |
| **会话重置（reset）** | 杀掉并重新 spawn 常驻 shell；每次泄漏一个僵尸 |
| **工具层围栏** | 在命令字符串派发前做的 token 级路径检查；**不是**沙箱 |
| **允许根集合** | 围栏判定为"界内"的根目录集合：会话 `cwd` + `DSH_EXTRA_WRITABLE_ROOTS` |
| **fail-closed** | 判定不允许或不确定时按拒绝处理；围栏拒绝先于审批 |
| **升级（escalation）** | 围栏拒绝后经 dsh 既有审批路径申请更宽权限，获批后按调用打戳 |
| **不可判定构造** | 隐藏路径的 shell 构造（变量展开 / 命令替换 / `eval` / 嵌套 shell 等），围栏无法证明其安全 |
| **A 类 / B 类 / C 类 / D 类命令** | 直接可达 / 仅 `toybox <name>` 可达 / 需编译标志（默认未编） / 未编译，见 §2.3 |
| **`toybox_extended_cmd`** | 控制 C 类 applet 的构建开关，默认 `false`（`toybox.gni:31-35`） |
| **`cl.filemanagement.2`** | OpenHarmony 文件管理子系统变更（SDK 4.1.5.2），使第三方应用 `symlink()` / `chmod()` / `chown()` 返回 `13900012` |
| **部署期状态** | 由产品在启动时设置、不作为模型输入的运行时配置（如 `DSH_EXTRA_WRITABLE_ROOTS`） |
