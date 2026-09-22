[English](./README.md) | 中文

---

# harmony-plugin-exec

鸿蒙侧 DeepSeek Harness 的模型可见 `bash` 命令执行工具，后端是**一个非 PTY 的常驻 `/system/bin/sh`**，由哨兵行协议驱动。

## 目的

本壳禁用了上游 `tool-bash` preset 行：其后端依赖链（`ctx.shell` → `bash-local`/`bash-sandbox` → `ctx.subprocess` → `node-pty`）无法加载 —— `node-pty` 是 win32-x64 二进制，且平台无应用级 PTY API。本插件以**本工程专用插件**形态恢复命令执行，**不**重新启用上游任何一层。

平台有两个无法回避的事实，本插件即围绕它们构建：

| 事实（设备实测） | 后果 |
|---|---|
| 子进程的 `proc:exit` / `proc:close` **从不触发**，子进程变僵尸。 | 完成不能来自生命周期事件。shell 在命令前打印随机 token 的 BEGIN 标记、命令后打印携带 `$?` 的随机 token END 标记；解析器只认 END 行（`lib/protocol.js`）。 |
| 每次 spawn 恰好泄漏一个僵尸。 | 惰性 spawn 一个长期存活的 shell 并复用；不是每条命令都 spawn。重置（kill + 重新 spawn）是最后手段，按设计泄漏一个僵尸。 |

**不**使用 `child_process.exec` / `execFile`（从不回调），**不**把 `process.execPath` 作为 spawn 目标（其路径 `ENOENT`），**不**用 `statSync` 判定可执行性（`EACCES` 假阴性）。

## 工具契约

| 项 | 值 |
|---|---|
| 工具名 | `bash`（与上游身份保持一致；非 PTY 后端在描述中披露） |
| 参数 | `command`（必填）、`timeout_ms`（可选，只能下调上限），以及**仅当**挂载了限制性文件系统后端时才出现的 `sandbox_permissions` / `justification` |
| 结果 | 单个文本块：先 `Exit code: <rc>`，再命令输出；其后可选 `[output truncated: kept N of M bytes]`、`[command cancelled]`、`[command timed out after Nms]`、`[session reset: …]` |
| 非零退出 | 正常结果（`Exit code: 1`），不是工具错误。只有围栏拒绝、不可恢复的超时、会话不可用才是错误。 |
| 状态 | shell 常驻，故 `cd` 与 shell 变量**跨调用延续**（刻意属性，描述已告知模型）。 |

## 配置

| 键 | 默认 | 含义 |
|---|---|---|
| `commandTimeoutMs` | `120000` | 单条命令墙钟上限（含排空）。 |
| `maxOutputBytes` | `262144` | 单条命令保留的字节数；流水仍排空到哨兵，`totalBytes` 报告真实大小。 |
| `maxCommandChars` | `65536` | 命令字符串长度上限，派发前强制。 |
| `fenceMode` | `enforce` | `enforce` fail-closed 拒绝；`warn` 记日志并放行；`off` 跳过分析。`warn` / `off` 是显式安全降级，启动时以 `[dsh-harmony]` 前缀响亮声明。 |
| `commandPolicy` | `disclose-only` | `disclose-only` 不做命令名检查；`allowlist` 只允许清单内命令；`denylist` 目前**等价于 `disclose-only`** —— 两者都应用 `denyCommands`，故 `denylist` 除拒绝集外不提供额外防护。 |
| `shellPath` | `/system/bin/sh` | 常驻 shell 可执行文件。只有已知可 spawn 的目标（`/system/bin/sh`、`/bin/sh`、`/system/bin/toybox`）经过验证；**不**用 `statSync` 探测。 |
| `allowCommands` | `[]` | `commandPolicy: allowlist` 使用的允许清单。 |
| `denyCommands` | 系统/硬件类命令 | 默认拒绝集（FR-4.5）：`reboot reset mount umount swapon swapoff mkswap insmod rmmod modinfo devmem i2cdetect i2cdump i2cget i2cset i2ctransfer chroot pivot_root switch_root nsenter unshare`。即使 `disclose-only` 下也生效。 |
| `toyboxApplets` | B 类集合 | `allowlist` 模式下 `toybox <applet>` 直通的白名单（spec FR-4.4）。 |

三个数值上限在 `apply` 中校验为正安全整数；非法值使插件组合失败。

```yaml
- name: harmony-plugin-exec
  config:
    commandTimeoutMs: 120000
    maxOutputBytes: 262144
    fenceMode: enforce
    commandPolicy: disclose-only
```

## 命令可达性

四类**不可互换**（spec §2.3 / FR-4.1）：

| 级别 | 含义 | 例子 | 调用方式 |
|---|---|---|---|
| **A** | 已 symlink 进 `/system/bin`，直接命令名可解析。 | `ls cat grep sed cp mv rm find xargs sort ps kill date env id uname which` … | `ls` |
| **B** | 已编译但未 symlink，直接命令名**不在** PATH。 | `nc netcat base32 blkid route reboot sha224sum sha512sum unicode getty mdev` … | `toybox nc` |
| **C** | 由 `toybox_extended_cmd`（默认 `false`）控制；可用性 **`未验证`**。 | `awk wget diff expr getfattr ipcs telnet traceroute traceroute6 tr` | 先用 `toybox --long` 核实 |
| **D** | 本平台未编译，不存在。 | `bash busybox fdisk fsck vi man strace bc hexdump` 及 GNU coreutils | ❌ |

`chmod` / `chown` 属 A 类（在 PATH 上），但平台在运行期拒其效果（`13900012 Permission denied`），故无法修改权限位。

## 路径围栏

派发前，`lib/fence.js` 对命令做词法切分（尊重单引号、双引号与反斜杠转义；不展开变量、不做 glob）并判定：

- 字面路径 token：含 `/` 的 token、以 `.` 或 `~` 开头的 token，以及**任何重定向目标**（`>`、`>>`、`<`、`<>`）；
- 路径以会话 `cwd` 为基准做**词法**归一化（不访问文件系统、不解析符号链接）；
- 允许根 = 会话 `cwd` + `DSH_EXTRA_WRITABLE_ROOTS`；
- 不可判定构造（`$VAR`、`$(...)`、反引号、`eval`、`env`、`xargs`、`find -exec`、嵌套 `sh -c`）在 `enforce` 下 fail-closed 拒绝。

**顺序固定**：围栏先判定。无升级字段的被拒命令返回共享 `[sandbox: …]` 标记，**绝不**弹审批；只有携带 `sandbox_permissions` + `justification` 的重试才会触发一次审批。

## 模型看到什么

**工具结果**（spec FR-2.3）：单个文本块，首行 `Exit code: <rc>`，随后是命令输出，可选追加截断 / 取消 / 超时 / 会话重置说明。描述文案承载 A/B/C/D 四分类、平台拒绝的 `chmod`/`chown`，以及非 PTY / cwd 延续事实。

**错误**。围栏拒绝返回 `Error`，文本为共享拒绝标记（存在限制性后端时）+ 原因，升级可用时附升级提示。参数错误（`command` 空或过长、`timeout_ms` 非正整数、升级参数配对错误）在一切执行前即为普通错误。spawn 失败响亮报错并指名 `shellPath`。

## 已知限制

- **围栏是尽力而为、可被绕过 —— 它不是沙箱。** 变量展开（`X=/data; ls $X`）、命令替换（`ls $(printf /data)`）、反引号、嵌套 `sh -c '…'`、`eval`/`env`/`xargs`，以及从配置文件 / 环境变量读取路径的工具，都能让真实路径逃出 token 级检查的视野。围栏提高成本与可见性，但不构成安全边界（spec §6.4）。
- **shell 以应用自身 uid 拥有完整文件访问能力。** 文件沙箱与审批体系对 shell 子进程没有管辖权；本插件围栏是唯一的工具层检查，无法替代内核沙箱（spec FR-6.4 / §6.1）。
- **平台的符号链接拒绝只是缓解，不是保证。** `ln -s` 实测失败，降低了"把越界路径伪装成界内路径"的风险，但平台行为可能变化，且不覆盖上述非符号链接旁路（spec FR-3.8）。
- **C 类命令 `未验证`。** `awk` / `wget` / `diff` / `expr` / `tr` 等是否编译由 `toybox_extended_cmd`（默认 `false`）控制，且 OpenHarmony 官方文档是超集 —— "有文档"不等于"已编译"。依赖前必须在真机跑 `toybox --long`（spec FR-4.2 / AC-27）。
- **`/system/bin/sh` 的身份已裁定：**mksh R59（2020/10/31），**不是** toysh。2026-09-22 真机 md5 比对：`/system/bin/sh` = `5b5e8eb9…`、`/system/bin/toybox` = `19f83712…`（两者不同），且 `KSH_VERSION=@(#)MIRBSD KSH R59 2020/10/31`。⚠️ **两个探针会骗人，勿用**：`readlink /proc/self/exe` 误报 `/system/bin/toybox`；`uname -a` 尾部的 `Toybox` 是内核 utsname。**被 shell 抢先的名字恰好是这些**（裸名**不**跑 toybox）：内建 `cat` `echo` `false` `kill` `pwd` `realpath` `sleep` `test` `true` `ulimit`，加保留字 `time`；`printf` / `ls` / `grep` / `sed` **不在其中**。要 toybox 实现请写 `toybox <n>`。另：mksh 预置 130 条恒等 alias，故 `command -v cat` 返回 `alias cat=cat` 而非路径。逐条实测证据见 `docs/toybox命令清单.md`（spec FR-4.6 / AC-26）。
- **单常驻 shell、单一 cwd。** 因为 `cd` 延续，插件实例内所有 `bash` 调用共享最先 spawn 该 shell 的会话 cwd；没有 per-call `workdir` 参数（spec FR-1.7 / FR-6.6）。
- **无 PTY、无 TTY。** 交互式程序（`top`、分页器、编辑器）行为未知，`未验证`；描述引导使用非交互形式（spec FR-2.6）。
- **每次重置泄漏一个僵尸。** 重置只限于 stdout 关闭与排空失败，但并非免费；插件绝不逐命令重置（spec FR-6.3）。
- **串行。** 同一时刻只有一条命令在途；并发调用排队（spec FR-5.6）。
- **输出截断为前 `maxOutputBytes` 字节。** 其后的字节仍被读取（保持会话同步）但不返回；提示报告保留量与总量（spec FR-5.4）。
- **超时可能报告未知退出码。** 若排空预算用尽仍未等到哨兵，则重置会话并报告 `Exit code: unknown` —— 绝不伪装成 `0`（spec FR-5.5）。
- **升级链路忠于词汇，但不构成限制。** 无限制性后端时升级字段不出现；挂载限制性后端时走共享审批序列，但获批模式并不能真正限制 shell 子进程。请优先使用 `fenceMode: enforce`。
- **引号不闭合会吞掉收尾框架。** 框架的收尾 `}`、`__dsh_rc=$?` 与 END 标记只在命令语法闭合时执行；未闭合的引号会让 shell 把它们并入命令，哨兵因而永不出现，该调用会耗尽完整超时与排空预算后才重置恢复。

## 依赖

`@deepseek-ai/cordis`、`@deepseek-ai/dsh-fs`、`@deepseek-ai/dsh-sandbox`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery` 声明为 `peerDependencies`，由消费构建在运行时提供（随 `dsh-dist/node_modules` 分发），故插件不发布、不带任何自有依赖。纯 ESM、无构建步骤 —— `lib/` 即发布源码。`lib/protocol.js`、`lib/fence.js`、`lib/inventory.js` **零 import**。

除 dsh 包外，唯一的运行时依赖是平台自身的 `/system/bin/sh`；不新增原生模块、PTY 或 subprocess 能力。

## 测试

`npm test`（或 `node --test tests/*.test.mjs`）在裸 Node 上跑四个文件，无需设备、无需 dsh 包：

| 文件 | 覆盖 |
|---|---|
| `tests/protocol.test.mjs` | 框架文本、BEGIN/END 捕获、逐字节保真、NUL、逐字节分块、token 不匹配不误判、退出码、截断 |
| `tests/fence.test.mjs` | 词法切分、路径候选、归一化、根边界、重定向目标、不可判定构造、三种模式、allowlist + `toybox` 直通、拒绝集 |
| `tests/inventory.test.mjs` | 四类非空互斥、关键成员、`未验证` 披露、`chmod`/`chown` 平台拒绝、描述内容 |
| `tests/session.test.mjs` | 经注入的假 `spawn` 驱动常驻会话：串行、截断、超时 → 排空 → 重置、取消、stdout 关闭存活判定、spawn 失败、释放 |

会话测试走注入的 `spawn` seam，故设备相关路径无需设备即可覆盖。任何依赖真实 `/system/bin/sh` 的结论保持 `未验证`，列于 `specs/010-tool-bash/test-cases.md` §3。
