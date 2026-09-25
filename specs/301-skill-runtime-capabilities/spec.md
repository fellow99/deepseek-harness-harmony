# 技能运行能力规范（能力边界全表 + 安全围栏）

> Module: 301-skill-runtime-capabilities
> Status: Implemented
> Last Updated: 2026-09-18

## 1. 模块概述

### 1.1 目的：为什么存在这个模块

本工程随 HAP 分发一份内置技能 `harmony-runtime-capabilities`（源文件 `skills/harmony-runtime-capabilities/SKILL.md`，138 行）。它的定位是**运行期摘要**：装在安装包内、在设备上被 `skill` 工具按需加载，告诉模型"这个壳能做什么、不能做什么、遇到限制该怎么办"。它不追求穷尽，也不携带证据。

问题出在"它是唯一来源"这件事上：

- **它是运行期摘要，不是权威出处。** 技能正文只写结论（"没有 `ls`""`chmod` 只在工作区内生效"），不写这些结论背后的根因层、证据行号和可修性判断。模型的判断依赖它，而它只有一页。
- **它是 bundled 技能根，优先级最低（rank 600）。** 同名时，用户级（`$DSH_HOME/skills`）或项目级（`.dsh/skills`）技能会**覆盖**本壳内置技能。这是 rank 排序的直接结果，也是"用户可改写内置行为"的来源，属**有意行为**，不能也不应"修掉"。
- **它曾经脱节。** 本工程内置技能曾因未随能力交付同步更新，仍声称 `delete` / `move` 不存在，导致模型拒绝使用已交付的工具（先例见工程根 `README.md:169` 的技能告警段，修正见提交 `c9ad23e`）。**一个描述能力边界的过期技能，比没有技能更有害。**

因此本模块把能力边界与安全语义从"技能正文"提升为**规范源**：技能正文成为本规范正文的运行期摘要，由本规范派生；能力变化时先改本规范，再同步技能。规范源可审计（每条结论带文件与行号）、可追溯（每条结论带根因层 L1-L4），也可被机器核验（构建期断言 + 真机 `--inspect`）。

**事实来源**：本规范的能力与数字全部取自两份既有文档，不新增、不臆测：

| 来源 | 角色 |
|---|---|
| `docs/鸿蒙环境能力清单-v0.1.5.md`（921 行） | **权威**：A 能力现状（A.1 环境标识 + A.2 主表）、C 关键结论与依据（C.1-C.7）、D 平台事实与官方结论（D.1-D.3）、E 历史实测记录（E.1-E.10） |
| `skills/harmony-runtime-capabilities/SKILL.md`（138 行） | **运行期摘要**：可用工具、如何列目录、已知限制、工作区外写入的处置 |

### 1.2 解决的问题

- **能力边界没有规范源。** 结论散落在技能正文、能力清单 A 节与 E 节实测记录三处，读者要自己拼。本模块把 A.2 主表整体搬进规范，并补上根因层与是否可修。
- **安全语义没有被固化为可验收条目。** 围栏的 fail-closed 顺序（拒绝发生在审批之前）、审批链路的完整形状、以及 `DSH_EXTRA_WRITABLE_ROOTS` 的部署期属性，此前只存在于实现与实测记录里。本模块把它们写成可验收的安全章节（第 6 节）与 AC-19。
- **"受限"被当成同一类问题。** 把 L1 平台硬约束、L2 原生产物缺失、L3 本工程配置、L4 dsh 上游接口缺失混为一谈，会导致方案选错。本模块在每行能力上标注根因层，并把分层模型写入术语表。
- **过期的运行期摘要会误导模型。** 本模块确立"技能正文由规范派生、能力变化必须同步"的治理规则（第 8 节），并把它列为 AC-20。

### 1.3 范围

**包含**：

- A.2 主表全量能力的规范化：主表共 **32 个编号**（#1 至 #32，其中 #28 展开为 28a / 28b / 28c / 28d），合计 **35 行**；每行给出 `状态` / `根因层` / `是否可修 · 说明`。
- 按功能域归并为 **FR-1 至 FR-8**，覆盖全部 35 行（含 A.2 #25 文件围栏与 #26 提权审批，它们作为 FR-2 全部变更操作共用的安全基元列出，语义在第 6 节展开）。
- 安全章节：围栏与审批的 fail-closed 顺序、审批链路、`DSH_EXTRA_WRITABLE_ROOTS` 的部署期属性（来源 C.4、E.5）。
- 已知限制清单（含 `SKILL.md` 正文声明的全部限制）。
- 可逐条验收的 AC 表（第 7 节），每条 AC 在 `test-cases.md` 有对应用例。

**不包含**：

- **能力清单 B 表（待办工作）的任何内容。** T1（非 pty exec 后端）、T4（`executableBinaryPaths`）、E3（用户目录权限策略）、K2a 与 K2b-d（托盘、无边框、更新检查、开机自启）等未完成项及其实施路线，属 B 表范围，本规范**不设路线图 / 待办章节**。每行能力只在"是否可修 · 说明"里给出判断（可修 / 不修 / 已决策 / 已修），不给排期与实施步骤。
- **任何能力修复动作。** 本模块只做规范化与证据引用，不改 `skills/harmony-runtime-capabilities/SKILL.md`、不改 `docs/鸿蒙环境能力清单-v0.1.5.md`、不改任何补丁、插件或运行时代码。
- **A.2 之外的新能力。** 不新增未在清单中实测或分析过的能力项。
- **桌面版（`dsh-desktop`）的能力对照**。C.2 的桌面版对照仅作为"这些限制是本工程在 L3 加的"这一判断的依据被引用，不展开为独立文档。

## 2. 术语与图例

### 2.1 状态图例

与能力清单 A.2 表头一致（`docs/鸿蒙环境能力清单-v0.1.5.md:5`）：

| 标记 | 含义 |
|---|---|
| ✅ | 实测通过 |
| ⚠️ | 受限 / 部分可用 |
| ❌ | 无此能力，或已确认不可修 |
| ❓ | 未实测 |

### 2.2 根因分层（L1-L4）

与能力清单 C.1 一致（`docs/鸿蒙环境能力清单-v0.1.5.md:78-89`）：

| 层 | 性质 | 可恢复性 | 典型涉及项 |
|---|---|---|---|
| **L1 平台硬约束** | 鸿蒙产品策略 / 权限体系 | 难；部分**不可上架** | PTY、Desktop 目录权限、开机自启 |
| **L2 原生产物缺失** | dsh-dist 在 Windows 收集，`node-pty` / `koffi` 是 win32-x64，aarch64 无法加载 | 交叉编译可恢复，但受 L1 封顶 | 终端、进程沙箱、ripgrep 搜索、图片处理 |
| **L3 本工程配置选择** | `cordis.patch.yml` + agent preset 的 disabled 行 | **改配置即可，成本最低** | skill、todo、goal、jobs、workflow、subagent、web、present、str_replace_editor、exec |
| **L4 dsh 上游接口缺失** | `ctx.fs` seam 原语里没有 delete / rename / copy / mkdir / watch | 与鸿蒙无关，需自研或上游改 | 删除、移动、重命名、复制、改权限 |

一句话：平台侧真正卡住的只有 PTY（`forkpty` / `openpty` 被 SELinux 拒）；`fork` + `execve` 已实测放行（C.5 `:174-176`）。被原生产物卡住的是终端与搜索；其余绝大部分是本工程的配置取舍或 dsh 本身的设计边界（C.1 `:89`）。

## 3. 环境基线

取自能力清单 A.1 环境标识（`docs/鸿蒙环境能力清单-v0.1.5.md:11-19`）：

| 项 | 值 |
|---|---|
| 平台 | HarmonyOS（`/etc/hostname` 不存在，符合移动端布局） |
| 设备 / 版本 | `3QC0226526001227` / HarmonyOS 6.1.0.135（API 24） |
| 工作区 | `/data/storage/el2/base/files/aaa` |
| 用户家目录 | `/storage/Users/currentUser`（挂在 hmdfs，大小写不敏感、不支持硬链接） |
| DSH 版本 | `0.1.5-rc.2` |
| 交互界面 | DSH Web GUI |
| 沙箱策略 | `workspace-write`，审批策略 `ask` |

补充的平台事实（D.2 `:247-248`）：工作区 `/data/storage/el2/base/files` 实测文件系统为 **`hmfs`**；用户家目录为 **`hmdfs`**。这两者的差异直接决定 `chmod` 的行为（见 FR-2 与第 5 节）。

## 4. 功能需求

> 以下 8 个能力域覆盖能力清单 A.2 主表全部 35 行。每行第四列"是否可修 · 说明"合并了主表的"是否可修 / 说明"。括注的行号指向两份事实来源。

### FR-1 文件读取与发现

| 能力 | 状态 | 根因层 | 是否可修 · 说明 |
|---|---|---|---|
| 读文件（工作区内 / 工作区外） | ✅ | 无 | 工作区外读文件无任何限制（`:27`）。用 `read` 而非 `cat`（`SKILL.md:41`） |
| 列目录（`str_replace_editor` 的 `view`） | ✅ | 无 | 已修 C2：挂 `@deepseek-ai/dsh-tool-str-replace-editor`，`view` 对目录返回两层清单（`:28`、E.3 `:355-363`）。本壳无 `ls` 且无 shell（`SKILL.md:15`） |
| 内容搜索 `grep` | ✅ | 无 | 已修 C1：纯 JS 插件，基于 `ctx.fs` 的 `stat` / `listDir` / `readText`，零原生依赖、零子进程（`:40`、E.5 `:480-496`）。返回 `<path>:<line>: <text>`，跳过二进制或不可读文件（`SKILL.md:28-30`） |
| 文件发现 `glob`（独立工具） | ✅ | 无 | 已修：`harmony-plugin-fs-search` 增加 `glob` 工具（纯 JS，复用遍历器，无需新增 preset 行）（`:41`、E.7 `:592-602`）。**只返回文件、从不返回目录**（C.3 `:118`）；隐藏目录与 `node_modules` 被跳过（`SKILL.md:24-27`） |

**FR-1.1** 发现类工具（`grep` / `glob`）为纯 JavaScript，不 spawn ripgrep 二进制（该二进制在此沙箱不可执行），它们是搜索工具而非 shell（`SKILL.md:32-33`）。
**FR-1.2** 工作目录已知（来自上下文），但无法用 `pwd` 发现（`SKILL.md:43`）。

### FR-2 文件变更

| 能力 | 状态 | 根因层 | 是否可修 · 说明 |
|---|---|---|---|
| 新建文件（工作区内） | ✅ | 无 | 正常。`read` → `write` 在工作区内始终可用（`:29`、`SKILL.md:93`） |
| 覆盖 / 编辑已有文件 | ✅ | 无 | 覆盖走 `rename()`，`hmdfs` 支持（`:30`、C.3 `:141`、`SKILL.md:100-101`）。`fs-observation-policy` 要求覆盖前先读过该文件（E.1 `:312`） |
| 新建文件（工作区外） | ⚠️ | L3 | 可修：需逐次审批，提权通道可用且 fail-closed（`:31`、C.4 `:167-172`） |
| 新建文件（用户目录 Desktop / Documents / Download） | ✅ | 无 | 已修 E1 + E2：硬链接回退扩展到 `fsio.ts`，额外可写根并入 `writableRoots()`（`:32`、E.5 `:457-468`）。Desktop / Documents / Download 三项启动时全部可达 |
| 删除文件 `delete` | ✅ | 无 | 已修：`remove` seam 原语（补丁 `dsh-fs-remove-primitive.patch`）+ 插件 `harmony-plugin-fs-mutate` 的 `delete`（`:33`、C.3 `:123`）。逐路径独立，一个失败不中断批次；非空目录需 `recursive: true`（`SKILL.md:49-51`） |
| 移动 / 重命名 `move` | ✅ | 无 | 已修：`writeBytes` 落地后二进制亦可搬运（`:34`、C.3 `:124`、E.5 `:470-478`）。`move` 是 copy-then-remove，从不覆盖，源在复制成功后才删除（`SKILL.md:52-54`） |
| 复制 `copy` | ✅ | 无 | 已修：`copy` 工具与 `move` 共用同一个字节拷贝规划器，seam 仍无 copy 原语但**无需新增**（`:35`、C.3 `:128`、E.8 `:618`） |
| 改权限 `chmod` | ⚠️ | 无（原 L4） | 已修：新增 `ctx.fs.chmod` 原语（补丁 `dsh-fs-chmod-primitive.patch`，第 13 补丁）+ `chmod` 工具，写入后**回读校验**（`:36`、C.3 `:129-130`）。工作区（`hmfs`）如实生效（实测 `640` 回读 `640`）；用户目录（`hmdfs`）**不落实请求的 mode**（实测请求 `640` 得到 `660`），故工具报错而非静默成功（E.8 `:633-634`、D.2 `:249`） |
| 文件围栏 `fs-sandbox`（A.2 #25） | ✅ | 无 | fail-closed，拒绝发生在审批之前（`:51`、C.4 `:169`）。FR-2 全部变更操作共用的安全基元，语义见第 6 节 |
| 提权审批 `approval`（A.2 #26） | ✅ | 无 | 链路完整可用且 fail-closed；J1 作废（`:52`、C.4 `:170-171`）。语义见第 6 节 |

**FR-2.1（按字节搬运）** `copy` 与 `move` 对每个文件按**逐字节**搬运（raw read 到 raw write），二进制内容原样保留，不得按文本处理（`SKILL.md:64-65`、E.8 `:639-640` 的 sha256 一致证据）。
**FR-2.2（从不覆盖）** `copy` 与 `move` 遇到已存在的目标文件一律失败；需要替换时先删除或移走（`SKILL.md:73-74`、E.8 `:632`）。
**FR-2.3（空目录拒绝）** 含空目录的树无法被复制或移动：seam 没有目录创建原语，故整棵树在开始前被拒绝，而不是静默丢弃空目录（`SKILL.md:69-71`）。
**FR-2.4（不继承源 mode）** 复制出的新文件获得后端默认 mode（原子写路径以 `0600` 创建目标），源的权限位不被继承；需要时随后用 `chmod`（`SKILL.md:77-79`、C.3 `:131`）。
**FR-2.5（失败留下部分目标）** 失败的 `copy` 会在目标留下已写入的部分文件；`move` 的源在复制成功前保留，但目标已写入的部分同样残留，重试前须清理目标（`SKILL.md:74-76`）。
**FR-2.6（chmod 回读校验）** `chmod` 必须应用后回读校验；存储层接受了调用却未落实 mode 时，工具报显式 `FS_IO_ERROR`，不得伪装成功（C.3 `:130`、D.2 `:249`）。这是"正确的失败"：模型据此换路径而不是重试。
**FR-2.7（rename 缺席）** 本壳无 `rename` 工具、无 shell，`move` 即 copy-then-remove，目标是一个带新元数据（新修改时间、上述 mode）的新文件（`SKILL.md:87-89`）。

### FR-3 命令执行与进程

| 能力 | 状态 | 根因层 | 是否可修 · 说明 |
|---|---|---|---|
| 命令执行 / shell | ❌ | L3 + L2 + 设计约束 | 可修：T1（不在本规范范围）。`sh` / `bash` / `zsh` / `pwsh` 与任意进程启动均不可用，因此 `pwd` / `cat` / `git` / `curl` / `node` 不能运行（`:37`、`SKILL.md:35-39`）。四重根因（产物 / 配置 / bundle / preset 层）见 C.3 `:97-106`；平台侧 `fork` + `execve` 已实测放行（C.5 `:174-176`） |
| PTY / 终端 | ❌ | L1 | 不修：SELinux 拒 `forkpty` / `openpty`；T2 确认交叉编译 `node-pty` 不必要（`:38`、D.1 `:230`、E.2 `:328`）。**未在真机直接调用 PTY API**（平台无应用级 API），结论依据官方 SELinux 受影响清单与运行时符号缺失 |
| 进程沙箱（koffi / landlock） | ❌ | L2 + L1 | 不修（B1）：无 shell 时无意义，文件面已有 `fs-sandbox` 的 `checkedTarget` 叠加 `approval`（`:39`、C.3 `:108-112`）。不得用 `ohos.permission.CUSTOM_SANDBOX` 替代，它改的是应用自身沙箱类型 |
| 后台任务 `job_*` | ⚠️ | L3 派生 | 空壳：`job_list` / `job_output` / `job_kill` 能查询注册表，但**没有任何工具能启动后台任务**；随 T1 恢复（`:48`、C.3 `:162`）。`SKILL.md:131` 记"从 shell 启动的后台作业"缺席 |

**FR-3.1（安全前置）** 恢复 shell 会**整体绕过** `fs-sandbox` 的围栏与审批：子进程以同一 uid 运行，能直接读写用户目录，不经过 `checkedTarget`、不弹审批。这是 T1 落地真正的设计难点，必须在 exec 工具层自建路径围栏或明确接受安全降级（C.5 `:181`）。本规范记录该风险，不实施 T1。

### FR-4 网络

| 能力 | 状态 | 根因层 | 是否可修 · 说明 |
|---|---|---|---|
| `web_search` / `web_fetch` | ✅ | 无 | `@deepseek-ai/dsh-tool-web` 是 PURE，不受原生模块取舍影响（`:42`）。只读、仅 GET；正确用法是读文件用 `read`、网络用这两个工具（`SKILL.md:42`） |
| 上传 / 发送数据到外部 | ❌ | L3 | 不修：网络只读且托管，只能 GET 抓取（`:43`） |

### FR-5 会话与编排能力

| 能力 | 状态 | 根因层 | 是否可修 · 说明 |
|---|---|---|---|
| 子 agent 家族（`subagent` / `subagent_fork` / `send_message` / `interrupt_agent` / `list_agents`） | ✅ | 无 | 回归实测通过（`:44`、E.3 `:386-388`） |
| `todo_write` / goal 三件套 / `present` / `ask_user_question` | ✅ | 无 | 回归实测通过（`:45`、E.3 `:381-389`） |
| `skill` | ✅ | 无 | 已修 H1：投递技能目录（`:46`、E.3 `:365`）。技能的可用时机为惰性：进程启动只配置 `DSH_BUNDLED_SKILL_DIR`，会话首次请求前注入技能目录（name + 截断 500 字的 description），正文按需加载且不缓存（`SKILL.md` 与工程技能目录约定） |
| `workflow` / `ralph` | ✅ | 无 | 引擎前置已实测就绪（`worker_threads` 可用）；`workflow` 工具级真机调用成功（`:47`、E.7 `:604`）。`ralph` 与 `workflow` 同引擎，**未单独调用（未验证）** |

**FR-5.1** 这些能力在 `standard` preset 里本就启用且都是 PURE；运行期补丁只禁用 3 行（`tool-bash` / `tool-fs-search` / `persistent-shell`），其余是"没测"而非"不可用"（C.3 `:164`）。

### FR-6 媒体

| 能力 | 状态 | 根因层 | 是否可修 · 说明 |
|---|---|---|---|
| `read_image` | ✅ | 无（原 L2） | 已修：stub 如实解析图片头 + 附件耐久性遍历补丁 + **ArkTS 图像桥**（`:49`、C.3 `:144-158`）。**三路径**：① 干净的 8-bit sRGB PNG/JPEG/WebP 按字节**直通**，不经过编码器；② stub 自身做不了的转换（16-bit PNG / ICC / EXIF / 超限缩放）改由平台图像框架完成；③ 取不到桥时（纯 Node）**如实拒绝**（E.9 `:711-719`、`:725-733`）。适配器与模型级端到端**两侧均已真机验证**（E.9 `:723-733`、E.7 `:570-590`）。EXIF 方向支持 1/3/6/8，镜像类 2/4/5/7 明确拒绝（C.3 `:158`） |
| 图片缩略图 | ⚠️ | **L4（上游接口缺失）** | 上游 dsh **根本没有**缩略图生成代码：无 `createThumbnail`、无缩略图 API、无缩略图路由、无缩略图存储变体；`thumbnail` 一词只出现在**客户端 UI**，指把**完整规范化字节**用 CSS 缩到 64px 的 `<img>`（`:50`、C.7 `:197-219`）。故"用户看到的小图"当前**已可用**（CSS 缩放）；真正缺的是服务端小图产物，属**新增功能**。`readImageRequest(ref, policy)` 已实现缩放与缓存，但只服务模型请求投影，未暴露给任何客户端 RPC（C.7 `:217`） |

### FR-7 平台集成与分发

| 能力 | 状态 | 根因层 | 是否可修 · 说明 |
|---|---|---|---|
| 后台常驻（`taskKeeping`） | ⚠️ | 无（原 L3） | 已修 K1：`EntryAbility` 声明 `backgroundModes: ["taskKeeping"]` + 请求 `KEEP_BACKGROUND_RUNNING`，并在 `onBackground` / `onForeground` 申请 / 释放长时任务。**声明与代码已确证在安装包内**（HAP 的 `module.json` 含两项声明；编译产物 `modules.abc` 含 `TASK_KEEPING`）（`:53`、E.8 `:649-651`）。⚠️ **是否真正获批未验证**：无头环境下 2in1 多窗口桌面未触发 `onBackground`，通知栏无长时任务通知（E.8 `:653`） |
| 托盘 / 状态栏图标 | ⚠️ | 无（原 L3） | API 就绪（`statusBarManager` + `StatusBarViewExtensionAbility`，`@kit.DeskTopExtensionKit`，syscap `PCService.StatusBarManager`，**仅 2in1**）；运行时 ArkTS 侧完整，**缺口只在 Node 侧无人调用**。第 5 轮已实现接线（`TrayAdapter` + `TrayAdapterBind` + `OVERLAY_ADD_FILES` + `src-main` 调用），真机日志确认框架**接受**（`statusbar addToStatusBar succeed!`、菜单已注册），但**图标未渲染**（`:54`、E.10 `:806-819`）。伴发的 `The size of the pixelmap exceeds the limit.` 经 4×4 图标实验证实**不是尺寸限制**；未排除 PixelMap 的 parcel 可序列化性，若成立则该能力卡在 L2（E.10 `:819-841`）。⚠️ **缓冲区来源实验未实施、未验证**：两轮改动因设备掉线未装机，结论一律以"已实测的排除项"为准（E.10 `:867-882`） |
| 无边框窗口 / 自绘标题栏 | ⚠️ | 无（原 L3） | API 就绪且**无需权限**：`window.setWindowDecorVisible(false)`（`@since 11`）、`setWindowTitleButtonVisible` / `setWindowTitleMoveEnabled`（`@since 14`）（`:55`、D.2 `:255`）。**本轮决定不实现**：隐藏系统标题栏后须自绘窗口控制，成本落在 renderer 侧，收益不足 |
| 更新检查（检测 + 引导） | ⚠️ | 无（原 L3） | API 就绪：`updateManager.checkAppUpdate` / `showUpdateDialog`（`@kit.AppGalleryKit`，无需权限，支持 2in1）；但**只能发现新版本并跳转 AppGallery，不存在静默自更新的公开 API**，前置条件是必须已上架、签名一致、App 处于前台（`:56`、D.2 `:256`）。**本轮决定不实现**：依赖尚未达成的上架时点 |
| 开机自启 | ❌ | L1 | 不可实现：`autoStartupManager` 只有**只读**接口（`getAutoStartupStatusForSelf()` `@since 21` 与 `isAutoStartupSupported()`），**无任何公开的启用接口**；设置侧唯一途径是企业 MDM（`ohos.permission.ENTERPRISE_MANAGE_APPLICATION`，受限 ACL，仅 MDM 应用）；第三方应用也无 `BOOT_COMPLETED` 静态订阅。唯一可行路径是引导用户在系统设置中手动开启（`:57`、D.2 `:257`） |
| 用户目录授权策略（上架） | ⚠️ | L1 | **已决策（无代码）**：自用 / 调试保持不变；上架须移除 Desktop 声明（`:58`）。`READ_WRITE_DESKTOP_DIRECTORY` 是 `system_basic`，是唯一上架障碍；Documents / Download 是 `normal` / `user_grant`（D.1 `:235`） |
| HNP 发布 | ✅ | 无（原 L3） | **第 5 轮打通并真机验证**：hvigor 产不出 HNP（其 `PackingToolOptions` 无 `addHnpPath`），正确做法是在**签名前**由 `app_packing_tool --mode hap --hnp-path <目录>` 嵌入，再用 `hap-sign-tool sign-app` 重签（已封装为 `scripts/inject-hnp.ps1`）（`:59`、E.10 `:884-902`）。真机结果：`/data/service/hnp/dshprobe.org/dshprobe_1.0.0/`，软链接 `/data/service/hnp/bin/dsh-probe`，**以裸命令名调用即执行成功**（E.10 `:904-918`） |
| `executableBinaryPaths` | ❌ | L3 | 仅自用 / 调试分发：T4（不在本规范范围）。需 ACL 且须经 AGC 审核；**该机制本身能否上架未证实**（`:60`、D.2 `:260-286`）。**未落地、未验证** |

### FR-8 Node ↔ ArkTS 通用桥

| 能力 | 状态 | 根因层 | 是否可修 · 说明 |
|---|---|---|---|
| Node ↔ ArkTS 通用桥（新增 ArkTS 能力） | ✅ | 无（原 L2） | 已修：`systemPreferences.callArkTSFunction` / `callArkTSAsyncFunction` 可按**运行期名字**调用任意经 `JsBindingUtils.bindFunction` 注册的 ArkTS 函数，**无需 C/C++ 或重建 `.so`**（`:61`、D.2 `:250`、E.9 `:668-679`）。首个生产使用者为图像桥（E.9 `:664`） |

**FR-8.1（硬性约束一）** async 的 ArkTS 方法**必须**用 `callArkTSAsyncFunction`；用 `callArkTSFunction` 去调 async 方法会把 Electron 主进程**永久阻塞**，需重启应用恢复（D.2 `:250`、E.9 `:680`）。
**FR-8.2（硬性约束二）** **应用被挂起时**（例如屏幕锁定）调用桥同样会阻塞主进程，因为 ArkTS 线程不运行；解锁并在应用前台后即恢复（D.2 `:250`、E.9 `:682`）。
**FR-8.3（接线口径）** 返回值是**标签信封** `{type, value}`，不是裸值；`callArkTSFunction` 也返回 Promise；支持 `string` / `number` / `boolean` / `string[]` / `number[]`，参数 ≤3 个。凡是要经桥暴露的既有能力，都应先加一层"JSON 单入单出"薄包装，而不是调用原始 binding（D.2 `:250`、`:258`）。

## 5. 已知限制

以下为该能力边界的已知限制，均来自事实来源；未在真机验证的条目标注"未验证"。

**文件系统**

1. **空目录不能复制或移动**：seam 没有目录创建原语，含空目录的树在开始前被拒绝（`SKILL.md:69-71`）。
2. **复制从不覆盖**：已存在的目标文件导致操作失败，需先删除或移走（`SKILL.md:73-74`）。
3. **失败的复制留下部分目标**：`move` 的源在复制成功前保留，但已写入目标的部分文件残留，重试前须清理（`SKILL.md:74-76`）。
4. **复制不继承源 mode**：新目标由后端以 `0600` 创建，源的权限位不随复制传递（`SKILL.md:77-79`）。
5. **`chmod` 只在工作区内生效**：工作区（`hmfs`）如实生效；用户目录（`hmdfs`）接受调用但不落实请求的 mode（实测请求 `640` 得到 `660`，请求 `755` 得到 `770`），工具回读校验后如实报错（`SKILL.md:80-86`、D.2 `:249`）。
6. **`rename` 缺席**：无 rename 工具、无 shell，`move` 是 copy-then-remove，目标是新文件、带新元数据（`SKILL.md:87-89`）。
7. **`hmdfs` 大小写不敏感且不支持硬链接**：用户目录在 `hmdfs` 上，`README.md` 与 `readme.md` 会碰撞；工作区在本地大小写敏感文件系统上（`SKILL.md:103-105`、D.1 `:237`）。
8. **用户目录新建文件曾因硬链接失败（`EPERM ... link`）**：**已由 E1 修复**。硬链接回退扩展到 `fsio.ts`，staging 目录建在 `dirname(absolutePath)` 下以满足 `hmdfs` 的同目录 rename 契约（C.3 `:142`）；E.5 `:468` 实测 Documents 下新建文件成功且无需审批，A.2 #6 据此记为 ✅。**注意**：运行期摘要 `SKILL.md:93-101` 仍保留修复前的表述（"先在工作区内创建 / 让目标先存在"的绕行方案），属**技能滞后于本规范**，按 §8.2 待技能同步时移除。
9. **工作区外写入需审批**：首次写入被 `file access denied under workspace-write mode` 拒绝，需以最窄的更宽模式 + `justification` 重试一次并等待用户批准（`SKILL.md:107-116`、C.4 `:167-172`）。
10. **用户目录受 HarmonyOS 系统权限管辖**：Desktop / Documents / Download 的写入即使提权后仍可能失败；优先把产物留在工作区内并告知用户位置（`SKILL.md:114-116`）。

**能力缺席**

11. **无 shell、无 PTY**：`sh` / `bash` / `zsh` / `pwsh`、任意进程启动、`pwd` / `cat` / `git` / `curl` / `node` 均不可用（`SKILL.md:35-39`、`:126`）。
12. **无内容上传 / 外部发送**：网络只读且托管，只能 GET 抓取（`:43`）。
13. **进程沙箱（koffi / landlock）缺席**：无 shell 时无意义（`:39`、C.3 `:108-112`）。
14. **后台任务 `job_*` 是空壳**：可查询注册表，无工具能启动任务（`:48`、C.3 `:162`）。

**媒体**

15. **图片缩略图无服务端产物**：上游无缩略图生成代码，客户端"小图"是把完整规范化字节用 CSS 缩小；单图最坏约 4 MiB、线上 base64 约 5.3 MiB（`:50`、C.7 `:197-219`）。
16. **EXIF 镜像方向（2/4/5/7）被拒绝**：只支持 1/3/6/8 的旋转（C.3 `:158`）。

**平台集成（未验证项集中在此）**

17. **后台常驻是否真正获批未验证**：声明与代码确证在包内，但无头环境未能触发 `onBackground`、通知栏无长时任务通知（`:53`、E.8 `:653`）。
18. **托盘图标未渲染**：框架接受调用但图标不可见；PixelMap parcel 可序列化性未排除，缓冲区来源实验未实施、未验证（`:54`、E.10 `:819-882`）。
19. **`ralph` 未单独调用（未验证）**：与 `workflow` 同 worker-thread 引擎（`:47`）。
20. **`executableBinaryPaths` 未落地、未验证**：需 ACL 且该机制本身能否上架未证实（`:60`、D.2 `:260-286`）。
21. **无边框窗口 / 更新检查本轮不实现**：API 就绪，但成本收益不足 / 依赖尚未达成的上架时点（`:55-56`）。
22. **开机自启不可实现**：`autoStartupManager` 无公开 setter，只能引导用户手动开启（`:57`、D.2 `:257`）。

**其他未证实与未解张力**

23. **托盘 Kit 可能仅限中国区（未证实，中等置信度）**：区域 / 策略门未排除，早前研究提示该 Kit 可能仅限中国区（E.10 `:822`）。与 FR-7 托盘的"图标未渲染"并列，落地前须复核。
24. **HNP 是否仅限 PC / 2in1（未证实）**：官方 HNP 文档未声明设备类型限制，但系统终端集成与相关权限均为 PC/2in1，社区一致称仅 2in1，属**未证实的强指向**（D.2 `:297`）。
25. **二进制证书申请门槛（未证实）**：给 ELF 做代码签名所需的二进制证书申请门槛社区普遍反映较高；官方"申请二进制证书"页为 SPA 未能直取（D.2 `:286`）。
26. **`hmdfs` rename 的文档 / 实测张力（未解）**：官方 prose 写"仅同目录"，实测**同目录与跨目录均成功**（Documents → Download，同一 `hmdfs` 挂载内），现象与解释之间的张力未解；不据 prose 设置保守契约（D.2 `:245`）。

## 6. 安全：围栏与审批

本节来源为能力清单 C.4（`docs/鸿蒙环境能力清单-v0.1.5.md:167-172`）与 E.5（`:457-468`）。对应能力项为 A.2 #25（文件围栏）与 #26（提权审批），已在 FR-2 表中列出。

### 6.1 fail-closed 与顺序：拒绝发生在审批之前

文件围栏 `fs-sandbox` **fail-closed 且生效**：对工作区外路径的写入先被拒绝（`file access denied under workspace-write mode`），**该拒绝发生在审批之前**。`profiles/desktop/cordis.patch.yml:31` 明确写着 `sandbox-policy` / `pwsh-sandbox` / `fs-sandbox` 不额外禁用（C.4 `:169`）。

**FR-6.1.1** 围栏判定必须先于审批交互：不得为了"先问用户"而跳过围栏检查。

### 6.2 审批链路

审批链路完整可用：

| 环节 | 事实 | 出处 |
|---|---|---|
| UI | 渲染"等待审批"面板，含理由与 `[拒绝]` / `[允许一次]` 两个动作，agent 阻塞等待 | C.4 `:170`、E.3 `:375` |
| 拒绝文案 | 拒绝后返回 `the user rejected escalating this operation to "danger-full-access"` | C.4 `:170`、E.3 `:375` |
| 服务侧默认值 | `ApprovalService.decide()` 的 waterfall 终结默认值是 `() => Promise.resolve('unavailable')` | `packages/interaction/user-approval/src/index.ts:274`（C.4 `:170`） |
| 调用方语义 | 调用方对 `unavailable` 一律**拒绝** | `packages/core/tools/src/index.ts:1713-1715`、`packages/sandbox/sandbox/src/escalation.ts:186`（C.4 `:170`） |
| 客户端注册 | `packages/client/ui-approval` 的 `ApprovalPanel.tsx` 呈现面板，注册于 `packages/bundle/web-app/cordis.patch.yml:252-253` | C.4 `:170` |

**FR-6.2.1** 审批的默认结局是拒绝：链路任一处不可用（`unavailable`）时，操作被拒绝而非放行。
**FR-6.2.2** 原"提权静默放行"的归因**不成立**：当时那次工作区外写入成功，是有人在审批面板上点了"允许一次"。J1 作废，无可开发项；贸然改接通知反而可能降低安全性（C.4 `:171`）。

### 6.3 额外可写根是部署期状态，不是模型输入

用户目录的直写问题由 E2 解决：额外可写根注入 `DSH_EXTRA_WRITABLE_ROOTS`（路径分隔符分隔的列表），并入 `writableRoots()`。实测应用进程内可写根为：

```
["/data/storage/el2/base/files/aaa", "/tmp", "/data/storage/el2/base/cache",
 "/storage/Users/currentUser/Desktop",
 "/storage/Users/currentUser/Documents",
 "/storage/Users/currentUser/Download"]
```

（E.5 `:460-465`）

**FR-6.3.1** `DSH_EXTRA_WRITABLE_ROOTS` 是**部署期状态**，由产品在启动时设置，**不是模型输入**：模型无法自行扩大可写面（C.4 `:172`）。
**FR-6.3.2** 该机制是"加白"而非"拆围栏"：写入**未授权**的工作区外路径仍被 `file access denied under workspace-write mode` 拒绝（E.5 `:468`）。

### 6.4 已知安全风险（记录，不在本规范实施）

若将来恢复 shell（T1），子进程以同一 uid 运行、可直接读写用户目录，**不经过 `fs-sandbox` 的 `checkedTarget`、也不弹审批**，本节 6.1 与 6.2 的围栏与审批体系会被整体绕过。必须在 exec 工具层自建路径白名单 / 围栏，或明确接受安全降级；不能只"接个 spawn"就上线（C.5 `:181`）。

## 7. 验收标准

每条 AC 均可行验证，验证方式限"构建期断言 / 真机 `--inspect` / `hilog` / `uitest` / 官方或源码出处"之一或组合。每条 AC 在 `test-cases.md` 有对应用例（见该文件第 4 节对照表）。

| 编号 | 验收标准 | 验证方式 |
|---|---|---|
| AC-1 | `spec.md` 的 FR-1 至 FR-8 能力表覆盖能力清单 A.2 主表全部 **35 行**（编号 1-27、28a-28d、29-32），每行含 状态 / 根因层 / 是否可修 · 说明，且不新增 A.2 之外的能力 | 静态对照（逐行 grep 能力名） |
| AC-2 | 技能随 HAP 分发并在设备上被 `skill` 工具按名加载：`DSH_BUNDLED_SKILL_DIR` 指向 resfile `app/skills`，加载 `harmony-runtime-capabilities` 返回正文首段 | 真机 `--inspect` 对话 + hilog（`DSH_BUNDLED_SKILL_DIR`） |
| AC-3 | 列目录可用：`str_replace_editor` 的 `view` 对目录返回两层清单，排除隐藏项、`node_modules` 与 Python cache | 真机 `--inspect` 工具调用 |
| AC-4 | `grep` / `glob` 为纯 JS，零原生依赖、零子进程；`glob` 只返回文件、跳过隐藏目录与 `node_modules`；`grep` 支持 `include` 过滤 | 真机 `--inspect` 工具调用 |
| AC-5 | 工作区内 `read` / `write` / `edit` 可用；覆盖已有文件经 `rename()` 成功 | 真机 `--inspect` 工具调用 |
| AC-6 | 工作区外写入 fail-closed：首次被 `file access denied under workspace-write mode` 拒绝，且拒绝携带提权提示 | 真机 `--inspect` 工具调用 |
| AC-7 | 用户目录 Desktop / Documents / Download 经 `DSH_EXTRA_WRITABLE_ROOTS` 注入后可直接写入且无审批标记；未授权的其他工作区外路径仍被拒绝 | 真机 `--inspect` 工具调用 + hilog 启动日志 |
| AC-8 | `delete` 真实删除；`move` 与 `copy` 按字节保真搬运；`copy` 不覆盖已有目标、拒绝含空目录的树、失败留在部分目标、不继承源 mode | 真机 `--inspect` 工具调用 |
| AC-9 | `chmod` 在工作区（`hmfs`）如实落实并回读校验；在用户目录（`hmdfs`）不落实请求 mode 时如实报错而非静默成功 | 真机 `--inspect` 工具调用 |
| AC-10 | shell / PTY / 进程沙箱缺席；`job_*` 为只读空壳（可查询，无启动者） | 真机 `--inspect` 探针 + 官方出处 |
| AC-11 | `web_search` / `web_fetch` 可用且只读 GET；不存在上传 / 发送数据到外部的能力 | 真机 `--inspect` 工具调用 |
| AC-12 | 会话与编排能力可用：`skill` / `todo_write` / goal 三件套 / `present` / `ask_user_question` / 子 agent 家族 / `workflow` | 真机 `--inspect` 工具调用 |
| AC-13 | `read_image` 三路径成立：干净 8-bit sRGB 直通；16-bit / ICC / EXIF / 超限经 ArkTS 图像桥转换；取不到桥时如实拒绝 | 真机 `--inspect` 工具调用 |
| AC-14 | 缩略图结论成立：上游 dsh 无缩略图生成代码，客户端"小图"是 CSS 缩放完整规范化字节 | 来源核验（源码清点，C.7） |
| AC-15 | 后台常驻声明与代码进包（`backgroundModes` / `KEEP_BACKGROUND_RUNNING` / `TASK_KEEPING`）；是否真正获批标注为未验证 | 构建期断言 + 真机 hilog |
| AC-16 | 托盘接线结果如实记录：框架接受调用（`addToStatusBar succeed!`、菜单已注册）但图标未渲染；缓冲区来源实验标注为未验证 | 真机 hilog + 截图 |
| AC-17 | HNP 通路：HAP 内含 `hnp/<abi>/<pkg>.hnp`，真机 `/data/service/hnp/bin/dsh-probe` 以裸命令名执行成功 | 构建期断言 + 真机命令 |
| AC-18 | Node ↔ ArkTS 通用桥两条硬约束被记录：async 方法必须用 async 入口；应用挂起时调用阻塞主进程 | 真机 `--inspect` 探针 + 来源核验（D.2） |
| AC-19 | 安全语义完整：围栏拒绝发生在审批之前（fail-closed）；审批链路 UI 渲染"等待审批"面板并可拒绝；`DSH_EXTRA_WRITABLE_ROOTS` 是部署期状态，模型无法自行扩大可写面 | 真机 `--inspect` + `uitest dumpLayout` + 来源核验（C.4） |
| AC-20 | 规范源 ↔ 技能同步：技能正文为本规范的运行期摘要，能力变化时须同步更新（含历史脱节案例被记录） | 人工对照 + 静态 grep |
| AC-21 | 本规范不含路线图 / 待办 / roadmap 章节；三个文件不含已废弃旧名 | 静态 grep |
| AC-22 | 平台集成与分发决策有官方出处支撑并如实记录：无边框 / 更新检查 / 开机自启（D.2 第 11-13 条）、`executableBinaryPaths` 的 ACL 与未证实项（D.2 第 15 条）、用户目录上架授权策略（D.1） | 来源核验 |
| AC-23 | 所有未在真机验证的结论均显式标注"未验证"（后台常驻获批状态、托盘缓冲区来源、`ralph` 单独调用、`executableBinaryPaths` 落地、PTY 真机调用） | 静态 grep + 人工 |

## 8. 约束

### 8.1 与宪法的一致

- **源码即真理（constitution §3.1）**：本规范所有能力结论、行号与数字均来自两份事实来源，不臆测；不确定处标注"未验证"。
- **spec / plan 成对（constitution §6）**：本模块产出 `spec.md` + `plan.md` + `test-cases.md`。
- **中文 + 英文技术术语（constitution §6）**：与本工程既有 spec 集口径一致。
- **零上游改动（constitution §1.1）**：本规范是文档，不改 dsh 源码、不新增或删除补丁。

### 8.2 规范源 ↔ 技能同步（强制）

- `skills/harmony-runtime-capabilities/SKILL.md` 正文是本规范的**运行期摘要**，由本规范派生。**能力发生变化时，必须同步更新该技能**；未同步的技能会使模型拒绝使用已交付的工具（本工程已有先例，见工程根 `README.md:169` 的技能告警段与提交 `c9ad23e`）。
- 同步方向为**单向**：先改本规范，再由本规范改技能。技能正文不得成为比本规范更新的事实来源。
- 技能是 bundled 技能根（rank 600，最低优先级）：同名用户级或项目级技能会**覆盖**它。这是**有意行为**，不得"修掉"，因为它正是"用户可改写内置行为"这一能力的来源。

### 8.3 本规范不含路线图

- 本规范**不设**路线图 / 待办 / roadmap 章节。能力清单 B 表（T1 / T4 / E3 / K2 等未完成项与其实施路线）不在本规范范围。
- 每行能力只在"是否可修 · 说明"中给出判断（已修 / 可修 / 不修 / 已决策 / 不可实现），不给排期与实施步骤。

### 8.4 范围边界

- 不修改 `skills/harmony-runtime-capabilities/SKILL.md`、`docs/鸿蒙环境能力清单-v0.1.5.md`，也不修改本模块目录之外的任何文件。
- 不增删能力清单 A.2 的能力项；不引入 A.2 之外的能力。

### 8.5 未验证项的标注

- 任何未在真机验证的结论必须显式标注"未验证"。当前未验证项集中在：后台常驻的获批状态、托盘图标可见性与缓冲区来源、`ralph` 的单独调用、`executableBinaryPaths` 的落地、PTY 的真机调用。

## 9. 术语

| 术语 | 含义 |
|---|---|
| **规范源** | 本规范 `spec.md`：能力边界与安全语义的权威出处，带证据与根因层 |
| **运行期摘要** | 技能正文 `skills/harmony-runtime-capabilities/SKILL.md`：随 HAP 分发、供模型按需加载的浓缩版，由规范源派生 |
| **bundled 技能根** | 本壳内置技能根（`DSH_BUNDLED_SKILL_DIR` 指向 resfile `app/skills`），rank 600，最低优先级，可被同名用户 / 项目技能覆盖 |
| **根因层（L1-L4）** | 把受限项按性质分层的模型：L1 平台硬约束 / L2 原生产物缺失 / L3 本工程配置 / L4 dsh 上游接口缺失 |
| **围栏（fs-sandbox）** | 对文件目标的沙箱检查，工作区外的写入被拒绝，fail-closed |
| **审批（approval）** | 提权链路：围栏拒绝后，模型以最窄更宽模式 + 理由重试一次，由用户在面板上批准或拒绝 |
| **fail-closed** | 判定不可用或未知时按拒绝处理；围栏拒绝先于审批，审批默认结局是拒绝 |
| **直通（passthrough）** | 图片归一化的短路分支：已干净的 8-bit sRGB 图片复用源字节，不经编码器 |
| **ArkTS 图像桥** | `ImageAdapter.convert` + `ImageAdapterBind`：以 JSON 单入单出经通用桥调用平台图像框架做解码 / 缩放 / 编码 |
| **部署期状态** | 由产品在启动时设置、不作为模型输入的运行时配置（如 `DSH_EXTRA_WRITABLE_ROOTS`），模型无法自行扩大 |
| **通用 ArkTS 桥** | `systemPreferences.callArkTSFunction` / `callArkTSAsyncFunction`：按运行期名字调用已注册 ArkTS 函数，无需改 C/C++ |
| **HNP** | HarmonyOS Native 包（`.hnp`），public 包落 `/data/service/hnp`，可被系统终端直接调用 |
