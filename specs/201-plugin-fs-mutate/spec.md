# fs-mutate 插件（工程内专用）功能规格

> Module: 201-plugin-fs-mutate
> Status: Implemented
> Last Updated: 2026-09-17

## 1. 模块概述

### 1.1 目的 —— 为什么存在这个模块

把 `delete` / `move` 两个模型可见的文件系统工具，以 **deepseek-harness-harmony 工程内专用插件**的身份（`plugins/harmony-plugin-fs-mutate/`）收进本工程，并同时确立本工程内的两条插件目录约定：

- `<父工程>/dsh-plugins/` —— 存放**通用的、可插拔的**插件（不依赖任何特定壳的补丁，可被多个壳消费）。
- `deepseek-harness-harmony/plugins/` —— 存放**本工程专用**的插件；该目录下的插件在**编译期打入包内**，在**运行期全部默认加载**。

在此之前，本插件位于父工程的通用插件目录 `dsh-plugins/dsh-plugin-fs-mutate/`。这个位置是**错的**：该插件只有在 `ctx.fs` 具备 `remove` 原语时才可用，而该原语由本工程独有的上游补丁 [`dsh-fs-remove-primitive.patch`](../../patches/dsh-v0.1.5-rc.2/dsh-fs-remove-primitive.patch) 提供。换言之，它是一个**补丁式插件**——离开本工程的补丁集就无法工作，因此它不是"通用可插拔插件"，而是"本壳专用插件"。

### 1.2 解决的问题

- **插件归属错位**。`dsh-plugins/` 的语义是"通用、可被任一壳消费"，而本插件与 `deepseek-harness-harmony` 的补丁集强耦合（`ctx.fs.remove` 仅在本壳打过补丁的 dsh 上存在）。放在通用目录会误导后续开发者以为它可被其它壳直接复用。
- **命名不自洽**。父工程旧约定为 `dsh-plugin-XXX`，而本工程内专用插件的新约定为 `harmony-plugin-XXX`。目录名与包名不一致会让"目录名 = npm 包名"这条被两端 README 明文声明的约定失效，进而使 `collectPlugins()` 这类"读 `package.json` 的 `name` 决定落地目录"的自动化逻辑失去可读性。
- **缺少目录级文档**。两个插件目录此前都没有 `README.md` 说明各自的用途边界，新人无法判断"新插件该放哪边"。
- **归属与版本绑定**。专用插件随 HAP 编译期打入、运行期默认加载。插件与壳同仓，才能保证"插件版本与它依赖的补丁集版本"在同一个提交里同步演进，而不是隔着一个仓库指针。

### 1.3 范围

**包含**：

- 把插件从 `dsh-plugins/dsh-plugin-fs-mutate/` 迁到 `deepseek-harness-harmony/plugins/harmony-plugin-fs-mutate/`。
- **全量改名**：npm 包名、插件 `name` 导出、出错文案、JSDoc 模块名、两份插件 README 标题与配置示例、agent preset 行的 `name`（**运行时导入说明符**）、构建期断言正则与日志文案。
- 构建期收集逻辑重根：`collectPlugins()` 改为从**本工程** `plugins/` 读取，按 `harmony-plugin-*` 通配发现。
- 运行期解析逻辑跟进：`ensureDshPluginsProfileLink()` 的通配改为 `harmony-plugin-*`，并新增对**同族陈旧目录**的清理（见 FR-4）。
- 两个插件目录各新增一份 `README.md` 说明用途边界与新增插件的步骤。
- 本工程与父工程两份 `README.md` / `README_zh.md` 的插件约定章节同步更新。
- 本模块的 `spec.md` / `plan.md` / `test-cases.md`，以及 `specs/README.md` 索引更新。

**不包含**：

- **插件的任何行为变更**。`delete` / `move` 的语义、结果文案、沙箱升级（`sandbox_permissions` / `justification`）、`maxTransferBytes` 配置项全部保持字节级不变。这是纯迁移 + 改名。
- `patches/dsh-v0.1.5-rc.2/` 下任何补丁的增删改。`dsh-fs-remove-primitive.patch` 是 dsh 上游补丁，位置本就正确。
- 删除父工程 `dsh-plugins/` 目录本身。该目录保留为空目录 + `README.md`，作为**通用**插件的归位点。
- 桌面工程 `deepseek-harness-desktop`。经核实它当前离线目录下**不消费** `dsh-plugins/`，本次迁移不影响它。
- Git 分支操作（按需求"Git分支：不改动"）。

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
| 插件目录 | `deepseek-harness-harmony/plugins/harmony-plugin-fs-mutate/` |
| npm `name` | `harmony-plugin-fs-mutate` |
| 插件 `name` 导出 | `harmony-plugin-fs-mutate` |
| agent preset 行 `name` | `harmony-plugin-fs-mutate` |
| agent preset 行 `id` | `fs-mutate`（**保持不变**：行 id 是稳定身份，改名无收益且徒增风险） |
| 旧位置 | `dsh-plugins/dsh-plugin-fs-mutate/` **删除** |

**FR-1.1** 目录名必须等于 npm 包名（`harness-plugin-*` 通配下二者一致），以维持两端 README 声明的约定。
**FR-1.2** 插件目录内不得残留任何旧包名字符串 `dsh-plugin-fs-mutate`。

### FR-2 构建期物化

**FR-2.1** `scripts/collect-dsh.mjs` 的 `collectPlugins()` 必须从**本工程** `<projectRoot>/plugins/` 读取，而非 `<projectRoot>/../dsh-plugins/`。
**FR-2.2** 发现规则为 `harmony-plugin-*` 目录通配；落地目录名取自各插件 `package.json` 的 `name`（而非目录名），因此**新增插件无需改动收集脚本**。
**FR-2.3** 包名必须匹配 `/^harmony-plugin-[A-Za-z0-9._-]+$/`（裸包名、非 scoped），既落实命名约定，也杜绝 `../` 逃逸出 `node_modules`。
**FR-2.4** 硬失败语义保持：`plugins/` 存在但匹配到的目录缺 `package.json` / JSON 非法 / 包名不符约定 → 收集阶段 `process.exit(1)`。`plugins/` 不存在或无匹配目录 → 打印一行日志、不做任何事。
**FR-2.5** 产物落在 `dsh-dist/node_modules/<包名>/`，随 `dsh-dist.tar.gz` 打进 resfile。**不得**为此在 `APP_KEEP` 增条目（`APP_KEEP` 只守护 `resfile/resources/app`，插件不在其下）。

### FR-3 运行期解析

**FR-3.1** `src-main/main.js` 的 `ensureDshPluginsProfileLink()` 必须把 `dsh-dist/node_modules/harmony-plugin-*` 复制到 `$DSH_HOME/profiles/node_modules/`。
**FR-3.2** 用**复制**而非 symlink（鸿蒙沙箱禁止 symlink，`EACCES`），与既有 `dshmarket` 同法。
**FR-3.3** **每次启动都覆盖复制**（先删后拷）。不得沿用 `dshmarket` 的"已存在即跳过"：插件内容随 HAP 迭代，跳过会让 profile 侧 pin 住旧版本。
**FR-3.4** 复制失败必须**响亮报错**（不能像 `dshmarket` 那样"不阻塞"）：复制失败 ⇒ preset 行不可解析 ⇒ 会话无法创建。

**FR-3.5（解析必要性，记录既有结论）** agent preset 行的可解析性由 `dsh-agent-presets` 的 discovery 判定：对裸包名，它从 `ctx.baseUrl`（即 profile 目录 `$DSH_HOME/profiles/desktop`）向上走 `node_modules` 找 `<pkg>/package.json`。因此插件**必须**同时存在于 `profiles/node_modules/` 下，仅有 `dsh-dist/node_modules/` 是不够的。

### FR-4 同族陈旧目录清理

**FR-4.1** `ensureDshPluginsProfileLink()` 必须清理 `profiles/node_modules/` 下**匹配 `dsh-plugin-*` 或 `harmony-plugin-*`、但不在本次源集合中**的目录。
**FR-4.2** 目的：使 `profiles/node_modules/` 忠实镜像 `dsh-dist/node_modules/`，并消除"旧包残留 + 旧 preset 行仍能解析 → 静默加载过期插件"这一最难排查的状态。
**FR-4.3** 清理范围必须**窄**：仅这两个通配。`dshmarket` 无 `plugin-` 前缀，不受影响。
**FR-4.4** 清理失败不得中断启动（该目录无引用者，属纯卫生动作）；但需在日志中留痕。

### FR-5 文档约定

**FR-5.1** `deepseek-harness-harmony/plugins/README.md` 必须说明：本目录存放本工程**专用**插件、编译期打入、运行期默认全部加载、命名 `harmony-plugin-XXX`、目录名=包名，以及**新增一个插件的完整步骤**。
**FR-5.2** `<父工程>/dsh-plugins/README.md` 必须说明：本目录存放**通用、可插拔**插件（不依赖任何特定壳的补丁）、命名 `dsh-plugin-XXX`、目录名=包名，并指向本工程 `plugins/` 作为"专用插件"的归位点。
**FR-5.3** 本工程与父工程的 `README.md` / `README_zh.md` 中描述旧 `dsh-plugins/` 约定的章节，必须改为描述**新分工**（哪一侧放什么）。

### FR-6 零行为变更

**FR-6.1** `lib/sandbox.js`、`lib/delete.js`、`lib/move.js` 三个文件在迁移中**内容必须逐字节不变**（仅 `lib/index.js` 因改名而变）。
**FR-6.2** 工具名 `delete` / `move`、参数 schema、结果文案、错误文案、沙箱升级行为、`Config.maxTransferBytes` 语义与默认值（`10485760`）均不变。

## 4. 目录约定

| 维度 | `<父工程>/dsh-plugins/` | `deepseek-harness-harmony/plugins/` |
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
| AC-1 | `deepseek-harness-harmony/plugins/harmony-plugin-fs-mutate/` 含 7 个文件（`package.json`、`README.md`、`README_zh.md`、`lib/{index,sandbox,delete,move}.js`） | `find` 列举 |
| AC-2 | 全工程 `grep 'dsh-plugin-fs-mutate'` 无残留（构建产物与 gitignored 目录除外） | `grep -rn` |
| AC-3 | `dsh-plugins/dsh-plugin-fs-mutate/` 已删除，`dsh-plugins/` 仅剩 `README.md` | `ls` |
| AC-4 | 两处 `HARMONY_ENSURED_PRESET_ROWS` 的 `name` 均为 `harmony-plugin-fs-mutate` 且逐条一致 | 双文件 `grep` 对照 |
| AC-5 | `collect-dsh` 后 `dsh-dist/node_modules/harmony-plugin-fs-mutate/package.json` 存在，且**不存在** `dsh-plugin-fs-mutate` | 构建断言 |
| AC-6 | 烘焙进 `dsh-dist` 的 preset（`agent.cordis.yml`）中该行 `name` 为新名 | 构建后 `grep` |
| AC-7 | 真机 hilog 出现 `[dsh-harmony] 已复制 harmony-plugin-fs-mutate → profiles/node_modules` | hilog |
| AC-8 | 真机 `$DSH_HOME/profiles/node_modules/` 内**无** `dsh-plugin-fs-mutate` 残留 | `--inspect` 读目录 |
| AC-9 | 真机可**新建会话**（不报 `agent-preset/invalid`） | `--inspect` 读 console |
| AC-10 | 真机 `delete` 工具真实删除文件；`move` 工具真实移动文件 | `--inspect` 发起对话 + 读工具结果 |
| AC-11 | 既有能力不退化：列目录（`tool-str-replace-editor` 的 `view`）与 `skill` 工具仍可用 | `--inspect` 对话 |
| AC-12 | 两个 `README.md` 已就位；两端 `README.md` / `README_zh.md` 的插件约定章节已改为新分工 | 人工阅读 |
| AC-13 | `lib/{sandbox,delete,move}.js` 内容未变 | 迁移前后 `md5` 对比 |

## 6. 约束

- **零上游改动**（constitution §1.1）：不改 dsh 源码，不新增/删除 dsh 补丁。
- **只写装配代码**（constitution §1.3）：本模块只做目录归属、命名与物化/复制逻辑，不新造业务逻辑。
- **幂等构建**（constitution §5.1）：`collectPlugins()` 可重复执行；目标已有 `package.json` 即跳过。
- **产物适配集中在收集脚本**（constitution §5.3）：构建期在 `collect-dsh.mjs`，运行期在 `main.js`，双保险。
- **日志规范**（constitution §3.3）：运行期输出统一 `[dsh-harmony]` 前缀，便于 `hilog | grep dsh-harmony`。
- **禁 symlink**：鸿蒙沙箱拒绝 symlink，一律复制。
- **不臆测未读代码**（constitution §3.1）：本文档中所有行号/符号均来自实际读取。

## 7. 术语

| 术语 | 含义 |
|---|---|
| **专用插件** | 依赖本工程补丁集或运行期适配，只能在本壳工作的插件（本模块处理的对象） |
| **通用插件** | 不依赖任何特定壳的补丁，可被多个壳消费的插件（父工程 `dsh-plugins/` 的语义） |
| **补丁式插件** | 依赖某个上游补丁才成立的插件；`fs-mutate` 依赖 `dsh-fs-remove-primitive.patch` |
| **物化（materialize）** | 把插件源码从源目录复制到 `dsh-dist/node_modules/<包名>`，使其随部署产物分发 |
| **运行时镜像** | 把 `dsh-dist/node_modules/<包名>` 再复制到 `$DSH_HOME/profiles/node_modules/`，使其可被 preset 解析 |
| **preset 行** | agent preset YAML 中的一条挂载声明（`- id: ...` / `name: ...`），`name` 是运行时导入说明符 |
