# fs-mutate 插件（工程内专用）功能规格

> Module: 202-plugin-fs-mutate
> Status: Implemented
> Last Updated: 2026-09-18

## 1. 模块概述

### 1.1 目的 —— 为什么存在这个模块

把 `delete` / `move` / `copy` / `chmod` 四个模型可见的文件系统工具，以 **dsh-desktop-hos 工程内专用插件**的身份（`plugins/harmony-plugin-fs-mutate/`）交付，并同时确立本工程内的两条插件目录约定：

- `<父工程>/dsh-plugins/` —— 存放**通用的、可插拔的**插件（不依赖任何特定壳的补丁，可被多个壳消费）。
- `dsh-desktop-hos/plugins/` —— 存放**本工程专用**的插件；该目录下的插件在**编译期打入包内**，在**运行期全部默认加载**。

本插件是**补丁式插件**：四个工具都建立在 `ctx.fs` seam 的变更原语之上，其中三个原语由**本工程自己的上游 dsh 补丁**提供 —— `ctx.fs.remove`（[`dsh-fs-remove-primitive.patch`](../../patches/dsh-v0.1.5-rc.2/dsh-fs-remove-primitive.patch)）、`ctx.fs.writeBytes`（[`dsh-fs-write-bytes.patch`](../../patches/dsh-v0.1.5-rc.2/dsh-fs-write-bytes.patch)）、`ctx.fs.chmod`（[`dsh-fs-chmod-primitive.patch`](../../patches/dsh-v0.1.5-rc.2/dsh-fs-chmod-primitive.patch)）。离开本工程的补丁集，插件无法工作。这正是它必须留在本工程 `plugins/`、而不能放进父工程通用目录 `dsh-plugins/` 的原因。

### 1.2 解决的问题

- **`ctx.fs` 缺变更原语**。上游 `ctx.fs` 此前只有读写，模型能创建和编辑文件，却无法删除、搬移、复制或改权限。四个工具经围栏原语补齐这四项能力。
- **插件归属**。`dsh-plugins/` 的语义是"通用、可被任一壳消费"，而本插件与本工程的补丁集强耦合。放进通用目录会误导后续开发者，以为它可被其它壳直接复用。
- **命名自洽**。本工程专用插件命名 `harmony-plugin-XXX`，目录名与包名一致，使"目录名 = npm 包名"这条被两端 README 明文声明的约定成立，也让 `collectPlugins()` 这类"读 `package.json` 的 `name` 决定落地目录"的自动化逻辑可读。
- **缺少目录级文档**。两个插件目录若无 `README.md` 说明各自用途边界，新人无法判断"新插件该放哪边"。
- **归属与版本绑定**。专用插件随 HAP 编译期打入、运行期默认加载。插件与壳同仓，才能保证"插件版本与它依赖的补丁集版本"在同一个提交里同步演进。

### 1.3 范围

**包含**：

- 插件本体：`dsh-desktop-hos/plugins/harmony-plugin-fs-mutate/` 下的四个工具注册与实现（`lib/`）、`package.json`、中英两份 README、两个纯 Node 单测（`tests/`）。
- 构建期收集逻辑：`collectPlugins()` 从**本工程** `plugins/` 读取，按 `harmony-plugin-*` 通配发现，物化到 `dsh-dist/node_modules/<包名>/`。
- 运行期解析逻辑：`ensureDshPluginsProfileLink()` 把 `dsh-dist/node_modules/harmony-plugin-*` 复制到 `$DSH_HOME/profiles/node_modules/`，并清理**同族陈旧目录**（见 FR-4）。
- 两个插件目录各一份 `README.md`，说明用途边界与新增插件的步骤。
- 本工程与父工程 `README.md` / `README_zh.md` 的插件约定章节。
- 本模块的 `spec.md` / `plan.md` / `test-cases.md`。

**不包含**：

- **插件对外契约之外的任何行为变更**。四个工具的名称、参数 schema、结果文案、`ctx.fs` 抛出的 `FsError` 文案、沙箱升级行为、`maxTransferBytes` 配置语义与默认值，一律以其契约为准（见 FR-5 / FR-6）。
- `patches/dsh-v0.1.5-rc.2/` 下任何补丁的增删改。三个原语补丁是 dsh 上游补丁，位置本就正确。
- 删除父工程 `dsh-plugins/` 目录本身。该目录保留为**通用**插件的归位点（当前仅含 `README.md`）。
- 桌面工程 `dsh-desktop`。它不参与本工程的构建与打包。
- Git 分支操作。

## 2. 用户故事

- 作为**本工程开发者**，我希望专用插件与壳同仓，这样"改壳"与"改插件"能进同一个提交、同一次评审、同一次真机验证。
- 作为**本工程开发者**，我希望专用插件的命名一眼可辨（`harmony-plugin-XXX`），不必打开 `package.json` 才能判断它属于哪一侧。
- 作为**打包者**，我希望插件在编译期自动打入 `dsh-dist.tar.gz`、运行期自动加载，全程零手工拷贝步骤。
- 作为**新加入开发者**，我希望两个插件目录各有 `README.md`，读一遍就知道"新插件该放哪边、怎么加"。
- 作为**设备上的排障者**，我希望从 hilog 就能确认插件已被物化到 profile（`[dsh-harmony]` 前缀），而不是只能靠会话是否能创建来反推。

## 3. 功能需求

### FR-1 目录与命名

| 项 | 取值 |
|---|---|
| 插件目录 | `dsh-desktop-hos/plugins/harmony-plugin-fs-mutate/` |
| npm `name` | `harmony-plugin-fs-mutate` |
| 插件 `name` 导出 | `harmony-plugin-fs-mutate` |
| agent preset 行 `name` | `harmony-plugin-fs-mutate` |
| agent preset 行 `id` | `fs-mutate`（行 id 是稳定身份，不随包名或目录变化） |

**FR-1.1** 目录名必须等于 npm 包名（在 `harmony-plugin-*` 通配下二者一致），以维持两端 README 声明的约定。
**FR-1.2（当前不变式）** 插件目录内**每一个**包名令牌都必须等于 `harmony-plugin-fs-mutate`，不得出现任何其它包名。令牌共 16 处、分布于 11 个文件：

| 文件 | 处数 | 落点 |
|---|---|---|
| `package.json` | 1 | `name` |
| `lib/index.js` | 3 | JSDoc `@module`、`name` 导出、错误文案前缀 |
| `lib/sandbox.js` | 2 | JSDoc `@module`、错误文案前缀 |
| `lib/{chmod,copy,delete,move,permissions,transfer}.js` | 各 1 | JSDoc `@module` |
| `README.md` | 2 | 标题、`- name:` 配置示例 |
| `README_zh.md` | 2 | 标题、`- name:` 配置示例 |

JSDoc `@module` 与错误文案前缀同样是名字令牌：留着会让抛错文案指向一个不存在的包名。

### FR-2 构建期物化

**FR-2.1** `scripts/collect-dsh.mjs` 的 `collectPlugins()` 必须从**本工程** `<projectRoot>/plugins/` 读取。
**FR-2.2** 发现规则为 `harmony-plugin-*` 目录通配；落地目录名取自各插件 `package.json` 的 `name`（而非目录名），因此**新增插件无需改动收集脚本**。非 scoped 包直接落在 `node_modules` 顶层（与 `dshmarket` 同策略）；拷贝时排除 `node_modules`，插件的运行时依赖由宿主 `dsh-dist` 解析。
**FR-2.3** 包名必须匹配 `/^harmony-plugin-[A-Za-z0-9._-]+$/`（裸包名、非 scoped），既落实命名约定，也杜绝 `../` 逃逸出 `node_modules`。
**FR-2.4** 硬失败语义：`plugins/` 存在但匹配到的目录缺 `package.json` / JSON 非法 / 包名不符约定 → 收集阶段 `process.exit(1)`。`plugins/` 不存在或无匹配目录 → 打印一行日志、不做任何事。幂等：目标已有 `package.json` 即跳过。
**FR-2.5** 产物落在 `dsh-dist/node_modules/<包名>/`，随 `dsh-dist.tar.gz` 打进 resfile。**不得**为此在 `APP_KEEP` 增条目（`APP_KEEP` 只守护 `resfile/resources/app`，插件不在其下）。

### FR-3 运行期解析

**FR-3.1** `src-main/main.js` 的 `ensureDshPluginsProfileLink()` 必须把 `dsh-dist/node_modules/harmony-plugin-*` 复制到 `$DSH_HOME/profiles/node_modules/`。
**FR-3.2** 用**复制**而非 symlink（鸿蒙沙箱禁止 symlink，`EACCES`），与既有 `dshmarket` 同法。
**FR-3.3** **每次启动都覆盖复制**（先删后拷）。不得沿用 `dshmarket` 的"已存在即跳过"：插件内容随 HAP 迭代，跳过会让 profile 侧 pin 住旧版本。
**FR-3.4** 复制失败必须**响亮报错**（不能像 `dshmarket` 那样"不阻塞"）：复制失败 ⇒ preset 行不可解析 ⇒ 会话无法创建。
**FR-3.5（解析必要性，记录既有结论）** agent preset 行的可解析性由 `dsh-agent-presets` 的 discovery 判定：对**裸包名**，它从 `ctx.baseUrl`（即 profile 目录 `$DSH_HOME/profiles/desktop`）向上走 `node_modules` 找 `<pkg>/package.json`。因此插件**必须**同时存在于 `profiles/node_modules/` 下，仅有 `dsh-dist/node_modules/` 是不够的。

### FR-4 同族陈旧目录清理

**FR-4.1** `ensureDshPluginsProfileLink()` 必须清理 `profiles/node_modules/` 下**匹配 `dsh-plugin-*` 或 `harmony-plugin-*`、但不在本次成功复制集合中**的目录。
**FR-4.2** 目的：使 `profiles/node_modules/` 忠实镜像 `dsh-dist/node_modules/`，并消除"旧包残留 + 旧 preset 行仍能解析 → 静默加载过期插件"这一最难排查的状态。
**FR-4.3** 清理范围必须**窄**：仅这两个通配。`dshmarket` 无 `plugin-` 前缀，不受影响；`@deepseek-ai/*` 为 scoped 目录，不匹配。
**FR-4.4** 清理失败不得中断启动（该目录无引用者，属纯卫生动作）；但需在日志中留痕。
**FR-4.5** **前置条件（刻意保守）**：清理只在"专用插件确实已被物化"（即源集合非空）时执行。源集合为空时**既不复制也不清理**。理由：此时无法区分"确实没有插件"与"设备上的 `dsh-dist` 仍是旧 tar"，而**若此刻剪除同族旧副本，会使旧 tar 中烘焙的旧 preset 行不可解析 → 会话创建失败**。宁留无引用者的陈旧副本，也不制造一个不可用的会话入口。这是**安全属性**，不是待修的 bug。
**FR-4.6** 保留集取**实际复制成功**的集合，而非源目录集合：源里缺 `package.json` 的目录不会被物化，也不应被保留成镜像外残留。

### FR-5 工具语义与契约

| 工具 | 参数 | 行为 |
|---|---|---|
| `delete` | `paths`（必填）、`recursive?` | 对每个路径**独立**经 `ctx.fs.remove` 删除。任一路径失败都不中断整批；结果列出已删除项，以及每个失败路径的**错误原文**。删除非空目录需 `recursive: true`。 |
| `move` | `from`（必填）、`to`（必填）、`recursive?` | 先做受围栏保护的复制，再做受围栏保护的源删除。复制**从不覆盖**：目标已存在则整个 move 失败；源仅在复制成功后才被删除。搬移目录需 `recursive: true`。 |
| `copy` | `from`（必填）、`to`（必填）、`recursive?` | 与 `move` 相同的受围栏复制，但不删除源。同样**从不覆盖**已存在的目标文件；复制目录需 `recursive: true`。 |
| `chmod` | `path`（必填）、`mode`（必填） | 设置 POSIX 权限位。`mode` 是**三或四位八进制数字的字符串**（`"644"`、`"0755"`），符号模式会被拒绝。变更后**回读并校验**。 |

**FR-5.1（按字节搬运）** `copy` 与 `move` 对每个文件**按字节复制**（`readBytes` 读入 `writeBytes`），二进制内容原样传递。两者共用同一个规划器，因此「包含关系判断、覆盖规则、空目录拒绝」三套规则不可能彼此漂移。
**FR-5.2（从不覆盖）** 目标文件已存在则整个操作失败；没有 force 开关。
**FR-5.3（空目录拒绝）** `ctx.fs` 没有建目录原语，目标目录只能作为"往里写文件"的副作用存在。若某棵树会产生空目录，则在**任何复制发生之前**整体拒绝，而不是静默丢弃该空目录。
**FR-5.4（复制不继承源权限位）** 复制经原子写路径发布，该路径为新目标请求 `0600`，且从不复制源的权限位。模式有意义时应随后调用 `chmod`。
**FR-5.5（失败留下部分目标）** `move` 的源仍然保留（仅在复制成功后才删除），但已写入目标的文件会留在那里；重试前需手动清掉目标。
**FR-5.6（`chmod` 回读校验）** 变更后读回实际模式并比对，因此"接受调用但不落实请求模式"的文件系统会**如实报错**，而不是静默成功。
**FR-5.7（必经 `ctx.fs`）** 插件**从不**用 `node:fs` 打开路径，也**从不**调用 `rename` —— 产品所用的鸿蒙文件系统 `hmdfs` 在文档中把 rename 限定为**仅同目录**，因此"复制后删除"才是可移植的实现。目标身份、原子性与沙箱围栏均由所挂载的后端负责。
**FR-5.8（沙箱升级）** 当 `ctx.fs` 受限（后端定义了 `sandboxMode`）时，四个工具都在 schema 中提供 `sandbox_permissions` 与 `justification`；在无沙箱能力的后端下这两个字段**不出现**，校验器会直接拒绝它们。被拒绝的变更返回共享标记 `[sandbox: file access denied under <mode> mode]` 及提权提示；用**能完成任务的最小更宽模式**重试会触发**一次**用户审批。获批的模式按调用打戳，并覆盖该调用的全部变更 —— `move` 的复制与删除两半，以及 `copy` 的每一次写入。

### FR-6 配置

**FR-6.1** `maxTransferBytes`，默认 `10485760`（10 MiB），为 `copy` 与 `move` 复制时**单个文件**的字节上限（含边界）。`ctx.fs.readBytes` 强制要求提供上限，以免后端缓冲无界文件；超过上限的源会在复制开始前以 `FS_TOO_LARGE` 失败。
**FR-6.2** 插件自身不变式：`maxTransferBytes` 必须是正整数，否则 `apply` 阶段抛错。

### FR-7 文档约定

**FR-7.1** `dsh-desktop-hos/plugins/README.md` 必须说明：本目录存放本工程**专用**插件、编译期打入、运行期默认全部加载、命名 `harmony-plugin-XXX`、目录名=包名，以及**新增一个插件的完整步骤**。
**FR-7.2** `<父工程>/dsh-plugins/README.md` 必须说明：本目录存放**通用、可插拔**插件（不依赖任何特定壳的补丁）、命名 `dsh-plugin-XXX`、目录名=包名，并指向本工程 `plugins/` 作为"专用插件"的归位点。
**FR-7.3** 本工程与父工程的 `README.md` / `README_zh.md` 中描述插件分工的章节，必须描述**两侧分工**（哪一侧放什么）。

## 4. 目录约定

| 维度 | `<父工程>/dsh-plugins/` | `dsh-desktop-hos/plugins/` |
|---|---|---|
| 定位 | 通用、可插拔插件 | 本工程**专用**插件 |
| 判定标准 | 不依赖任何特定壳的补丁/适配，可被多个壳消费 | 依赖本壳特有的补丁、profile 或运行期适配 |
| 命名 | `dsh-plugin-XXX` | `harmony-plugin-XXX` |
| 目录名 = 包名 | 是 | 是 |
| 载入时机 | 由各消费壳自行决定 | **编译期**打入 HAP，**运行期全部默认加载** |
| 当前内容 | （空，仅 `README.md`） | `harmony-plugin-fs-mutate/` |

## 5. 验收标准

| 编号 | 验收标准 | 验证方式 |
|---|---|---|
| AC-1 | `dsh-desktop-hos/plugins/harmony-plugin-fs-mutate/` 文件齐备：`package.json`、`README.md`、`README_zh.md`、`lib/{index,sandbox,transfer,permissions,delete,move,copy,chmod}.js`、`tests/{permissions,transfer}.test.mjs`（共 13 个文件） | `find` / 目录列举 |
| AC-2 | 全工程 `grep -rn "plugin-fs-mutate"` 的每一处命中都必须是 `harmony-plugin-fs-mutate`（即不存在任何其它 `-plugin-fs-mutate` 包名令牌） | `grep -rn` |
| AC-3 | 父工程 `dsh-plugins/` 仅剩 `README.md` | `ls` |
| AC-4 | 两处 `HARMONY_ENSURED_PRESET_ROWS` 逐条一致（`id` / `name` / `requireRow`） | 双文件 `grep` 对照；构建期由 `assertPresetRowsMirrorMainJs()` 硬失败 |
| AC-5 | `collect-dsh` 后 `dsh-dist/node_modules/harmony-plugin-fs-mutate/package.json` 存在 | 构建断言 |
| AC-6 | 烘焙进产物的 preset（`agent.cordis.yml`）中该行 `name` 为 `harmony-plugin-fs-mutate` | 构建后 `grep` |
| AC-7 | 真机 hilog 出现 `[dsh-harmony] 已复制 harmony-plugin-fs-mutate → profiles/node_modules` | hilog |
| AC-8 | 真机 `$DSH_HOME/profiles/node_modules/` 忠实镜像 `dsh-dist/node_modules/`（无同族陈旧目录） | `--inspect` 读目录 |
| AC-9 | 真机可**新建会话**（不报 `agent-preset/invalid`） | `--inspect` 读 console |
| AC-10 | 真机 `delete` 与 `move` 工具真实生效 | `--inspect` 发起对话 + 读工具结果 |
| AC-11 | 既有能力不退化：`str_replace_editor` 的 `view` 列目录、`skill` 工具、`dshmarket` 插件市场 | `--inspect` 对话 |
| AC-12 | 两份插件目录 README 与两端 README 的插件约定章节就位 | 人工阅读 |
| AC-13 | 真机 `copy` 工具真实生效、二进制按字节保真、且不覆盖已存在目标 | `--inspect` 对话 + 读 sha256 / 存在性 |
| AC-14 | 真机 `chmod` 在应用沙箱（`hmfs`）如实落实、在共享用户目录（`hmdfs`）如实报错而非静默成功 | `--inspect` 对话 + 读回模式 |

## 6. 约束

- **零上游改动**（constitution §1.1）：不改 dsh 源码，不新增/删除 dsh 补丁。
- **只写装配代码**（constitution §1.3）：本模块只做插件实现、目录归属、命名与物化/复制逻辑，不新造业务逻辑。
- **幂等构建**（constitution §5.1）：`collectPlugins()` 可重复执行；目标已有 `package.json` 即跳过。
- **产物适配集中在收集脚本**（constitution §5.3）：构建期在 `collect-dsh.mjs`，运行期在 `main.js`，双保险。
- **日志规范**（constitution §3.3）：运行期输出统一 `[dsh-harmony]` 前缀，便于 `hilog | grep dsh-harmony`。
- **禁 symlink**：鸿蒙沙箱拒绝 symlink，一律复制。
- **不臆测未读代码**（constitution §3.1）：本文档中所有行号/符号均来自实际读取。
- **`dsh-dist` 更新生效条件**：设备只有在**重新解压 `dsh-dist`** 后才会看到新的插件集合。`ensureDshExtracted()` 只比对解压 marker，不比对版本或内容 hash，因此**就地升级**（不卸载、保留设备 `$DSH_HOME/dsh-dist`）因 marker 命中而**跳过重解压**，应用继续以旧 `dsh-dist` 烘焙的 preset 行 + 旧插件副本运行（功能可用，但插件集合的变更不生效）。验证插件集合变更因此需要**全新安装**或清除设备 `$DSH_HOME/dsh-dist`。
- **不在本模块范围**：让 `ensureDshExtracted()` 具备版本/哈希感知，以支持 `dsh-dist` 的就地刷新。这是影响**所有** `dsh-dist` 变更的既有架构缺口（不止本模块），本模块只记录、不改动，以免引入范围外变更。

## 7. 术语

| 术语 | 含义 |
|---|---|
| **专用插件** | 依赖本工程补丁集或运行期适配，只能在本壳工作的插件（本模块处理的对象） |
| **通用插件** | 不依赖任何特定壳的补丁，可被多个壳消费的插件（父工程 `dsh-plugins/` 的语义） |
| **补丁式插件** | 依赖某个上游补丁才成立的插件；`fs-mutate` 依赖 `dsh-fs-remove-primitive.patch`、`dsh-fs-write-bytes.patch` 与 `dsh-fs-chmod-primitive.patch` |
| **物化（materialize）** | 把插件源码从源目录复制到 `dsh-dist/node_modules/<包名>`，使其随部署产物分发 |
| **运行时镜像** | 把 `dsh-dist/node_modules/<包名>` 再复制到 `$DSH_HOME/profiles/node_modules/`，使其可被 preset 解析 |
| **preset 行** | agent preset YAML 中的一条挂载声明（`- id: ...` / `name: ...`），`name` 是运行时导入说明符 |
