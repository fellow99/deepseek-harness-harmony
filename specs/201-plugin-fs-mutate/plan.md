# 201-plugin-fs-mutate 技术方案

> 模块：201-plugin-fs-mutate
> 对应规格：[specs/201-plugin-fs-mutate/spec.md](./spec.md)
> Last Updated: 2026-09-17

## 1. 技术上下文

### 1.1 运行时环境

- **构建期**：Windows 宿主机 Node（`node scripts/*.mjs`），无 DevEco 参与（除最后的 HAP 构建）。
- **运行期**：Electron-on-鸿蒙（Electron 37 / Node 22.17.0）主进程内的 dsh Host。插件是 in-process Cordis 插件，不独立成进程。
- **部署形态**：插件源码 → `dsh-dist/node_modules/<包名>/` → `dsh-dist.tar.gz` → resfile → 首启解压到 `$DSH_HOME/dsh-dist` → 运行期再镜像到 `$DSH_HOME/profiles/node_modules/`。

### 1.2 依赖

| 依赖 | 来源 | 用途 |
|---|---|---|
| `@deepseek-ai/cordis` | 宿主 dsh-dist 的依赖闭包（`peerDependencies`） | 插件框架 |
| `@deepseek-ai/dsh-fs` | 同上 | `ctx.fs` 缝隙（含 `remove` 原语） |
| `@deepseek-ai/dsh-sandbox` | 同上 | 围栏模式与升级语义 |
| `@deepseek-ai/dsh-tools` | 同上 | 工具注册 |
| `@deepseek-ai/schemastery` | 同上 | 配置 schema |
| `dsh-fs-remove-primitive.patch` | 本工程 `patches/dsh-v0.1.5-rc.2/` | 提供 `ctx.fs.remove`；**插件可用性的前提** |

> 插件为纯 ESM、无构建步骤（`lib/` 即发布源码）、`private: true`、不发布到 registry。

## 2. 宪法合规检查

| 宪法原则（[constitution.md](../constitution.md)） | 状态 | 说明 |
|---|---|---|
| §1.1 零上游改动 | ✅ | 不改 dsh 源码；不新增/删除任何 dsh 补丁；仅改本工程的插件归属与收集/镜像代码 |
| §1.3 只写装配代码 | ✅ | 仅目录归属、命名、物化与复制；`lib/{sandbox,delete,move}.js` 逐字节不变 |
| §3.1 源码即真理 | ✅ | 本文档所有符号/行号均来自实际读取；不确定处标 `[待确认]` |
| §3.3 日志规范 | ✅ | 运行期新增/修改的日志均用 `[dsh-harmony]` 前缀 |
| §4.1 优雅关闭 | ✅ | 不涉及进程/端口生命周期 |
| §5.1 幂等构建 | ✅ | `collectPlugins()` 保持"目标已有 `package.json` 即跳过"；`ensureDshPluginsProfileLink()` 本就先删后拷，天然幂等 |
| §5.3 产物适配集中在收集脚本 | ✅ | 构建期适配在 `collect-dsh.mjs`，运行期兜底在 `main.js`，双保险 |
| §6 治理规则（前缀） | ✅ | 提交用 `docs` / `refactor` / `fix`，均在 constitution §6 与团队提交规范的白名单内 |
| §6 治理规则（spec/plan 成对） | ✅ | 本模块产出 `spec.md` + `plan.md`（+ `test-cases.md`） |

> **观察（不在本次范围）**：constitution §1.1 记"仅限 4 个 patch"，而实际已有 9 个。该文档为 2026-09-04 提取物，未随补丁增加而更新。本次不改（属无关重构）。

## 3. 命名与身份映射

插件身份有 **5 个落点**，必须同时改；漏一处即表现为「会话无法创建」（`agent-preset/invalid`，与 2026-09-17 修复的 bug 同一形态）。

| # | 落点 | 文件 | 旧 | 新 |
|---|---|---|---|---|
| 1 | 包名 | `plugins/harmony-plugin-fs-mutate/package.json` | `dsh-plugin-fs-mutate` | `harmony-plugin-fs-mutate` |
| 2 | 插件 `name` 导出 | `plugins/harmony-plugin-fs-mutate/lib/index.js` | `dsh-plugin-fs-mutate` | `harmony-plugin-fs-mutate` |
| 3 | **preset 行 `name`（运行时导入说明符）** | `src-main/main.js` 的 `HARMONY_ENSURED_PRESET_ROWS` | `dsh-plugin-fs-mutate` | `harmony-plugin-fs-mutate` |
| 4 | **preset 行 `name`（构建期烘焙，镜像 #3）** | `scripts/collect-dsh.mjs` 的 `HARMONY_ENSURED_PRESET_ROWS` | `dsh-plugin-fs-mutate` | `harmony-plugin-fs-mutate` |
| 5 | 目录名 | 文件系统 | `dsh-plugin-fs-mutate` | `harmony-plugin-fs-mutate` |

**不改**：preset 行 `id: fs-mutate`（行 id 是稳定身份，改它无收益且会与设备上已成型的 preset 产生无谓差异）。

**连带文案**（非功能性，但属"零残留"要求；令牌合计 12 处）：
- `lib/index.js` 3 处：`@module` 名、`export const name`、`throw new Error('... : maxTransferBytes must be ...')` 文案前缀；
- `lib/sandbox.js` 2 处：`@module` 名、`throw new Error('... : the mounted filesystem confines but ctx.sandboxPolicy is missing')` 文案前缀；
- `lib/delete.js` / `lib/move.js` 各 1 处：`@module` 名；
- `package.json` 1 处：`name`；
- `plugins/harmony-plugin-fs-mutate/README.md` / `README_zh.md` 各 2 处：标题与 `- name:` 配置示例；
- `collect-dsh.mjs` 的断言正则 `/^harmony-plugin-[A-Za-z0-9._-]+$/`、日志与报错文案、函数头注释；
- `src-main/main.js` 的 `ensureDshPluginsProfileLink()` 通配 `startsWith('harmony-plugin-')` 与注释；
- 两端 `README.md` / `README_zh.md` 的插件约定章节。

## 4. 改动清单

### 4.1 harmony 子工程 —— 插件本体

| # | 路径 | 动作 | 要点 |
|---|---|---|---|
| 1 | `plugins/harmony-plugin-fs-mutate/package.json` | 新增（移动） | `name` 改新名；其余字段（`private`/`type`/`main`/`exports`/`files`/`peerDependencies`）不变 |
| 2 | `plugins/harmony-plugin-fs-mutate/lib/index.js` | 新增（移动+改） | 改 `@module`、`export const name`、错误文案前缀（3 行） |
| 3 | `plugins/harmony-plugin-fs-mutate/lib/sandbox.js` | 新增（移动+改） | 仅改 `@module` 与错误文案前缀（2 行） |
| 4 | `plugins/harmony-plugin-fs-mutate/lib/delete.js` | 新增（移动+改） | 仅改 `@module`（1 行） |
| 5 | `plugins/harmony-plugin-fs-mutate/lib/move.js` | 新增（移动+改） | 仅改 `@module`（1 行） |
| 6 | `plugins/harmony-plugin-fs-mutate/README.md` | 新增（移动+改） | 标题与配置示例改新名；Known Limitations 等正文不变 |
| 7 | `plugins/harmony-plugin-fs-mutate/README_zh.md` | 新增（移动+改） | 同 #6，中文镜像 |
| 8 | `plugins/README.md` | **新增** | 本工程专用插件目录约定（见 §4.4） |
| 9 | `dsh-plugins/dsh-plugin-fs-mutate/`（父工程） | **删除** | 需在 #1-#7 就位并经 md5 核对后再删 |

### 4.2 harmony 子工程 —— 构建期

| 文件 | 位置（符号） | 动作 |
|---|---|---|
| `scripts/collect-dsh.mjs` | `collectPlugins()` | ① 源根 `resolve(projectRoot, '../dsh-plugins')` → `resolve(projectRoot, 'plugins')`；② 目录通配 `entry.name.startsWith('dsh-plugin-')` → `'harmony-plugin-'`；③ 断言 `/^dsh-plugin-[A-Za-z0-9._-]+$/` → `/^harmony-plugin-[A-Za-z0-9._-]+$/`；④ 全部日志/报错文案与函数头注释改为"本工程 plugins/、harmony-plugin-XXX" |
| `scripts/collect-dsh.mjs` | `HARMONY_ENSURED_PRESET_ROWS` | 第 2 条 `name` → `harmony-plugin-fs-mutate`；注释里"由 collectPlugins() 从父工程 ../dsh-plugins 物化"改为"从本工程 plugins/ 物化" |
| `scripts/collect-dsh.mjs` | 主流程尾部注释（步骤 10） | 同上口径更新 |

> `scripts/collect-runtime.mjs` **不需要改**：它不涉及 `plugins/`（仅 `src-main/*` 三件套 + `skills/` 需要 resfile 恢复），且 `APP_KEEP` 只守护 `resfile/resources/app`，而插件落在 `dsh-dist.tar.gz` 内。

### 4.3 harmony 子工程 —— 运行期

| 文件 | 位置（符号） | 动作 |
|---|---|---|
| `src-main/main.js` | `HARMONY_ENSURED_PRESET_ROWS` | 第 2 条 `name` → `harmony-plugin-fs-mutate`（必须与 `collect-dsh.mjs` 逐条一致）；`reason` 文案改为"本工程 plugins/ 物化" |
| `src-main/main.js` | `ensureDshPluginsProfileLink()` | ① 通配 `startsWith('dsh-plugin-')` → `'harmony-plugin-'`；② **新增同族陈旧目录清理**（见 §4.5）；③ 注释同步（两处清单镜像说明） |

### 4.4 文档

| # | 文件 | 动作 |
|---|---|---|
| 1 | `plugins/README.md`（新建） | 目录定位、约定（命名/目录名=包名/编译期打入/运行期全默认加载）、与父工程 `dsh-plugins/` 的分工、**新增插件步骤**、现有插件索引 |
| 2 | `<父工程>/dsh-plugins/README.md`（新建） | 目录定位（通用可插拔）、约定（`dsh-plugin-XXX`）、指向本工程 `plugins/` 作为专用插件归位点、当前为空 |
| 3 | `deepseek-harness-harmony/README.md` | "Plugins: the `dsh-plugins/` convention" 节 → 改为新分工；stage ② 描述（`dsh-plugins` → 本工程 `plugins`）；目录结构树；插件文档链接 |
| 4 | `deepseek-harness-harmony/README_zh.md` | 同 #3，中文镜像 |
| 5 | 父工程 `README.md` | Repository layout 表 `dsh-plugins` 行、Roles at a glance 表行、"Plugin convention" 节 |
| 6 | 父工程 `README_zh.md` | 同 #5，中文镜像 |

### 4.5 `ensureDshPluginsProfileLink()` 的陈旧清理设计

**现状**（改名前）：函数遍历 `dsh-dist/node_modules` 下 `dsh-plugin-*`，逐个"先删后拷"到 `profiles/node_modules/`。它**只负责写入**，不负责删除"源里已不存在"的同族目录。

**改名后会暴露的问题**：已经跑过旧版的设备上，`profiles/node_modules/dsh-plugin-fs-mutate/` 会永久残留。这与 `profiles/node_modules/` 应当"忠实镜像 `dsh-dist/node_modules/`"的意图相悖，并制造一个**最难排查的状态**：若设备上任何 preset 文件仍带旧行 `name: 'dsh-plugin-fs-mutate'`（例如旧 `dsh-dist` 未删时由旧 tar 烘焙的行，且 `ensurePresetRows` 只追加、从不改写已存在的行），该行会解析到**过期的插件副本**并静默生效。

**设计**（窄范围、非致命）：

```
清理集合 = { d in readdir(profiles/node_modules) | d 匹配 /^(dsh|harmony)-plugin-/ } − 本次源集合
对每个 d：rmSync(profiles/node_modules/d, { recursive: true, force: true })
```

- **范围**：仅 `dsh-plugin-*` 与 `harmony-plugin-*`（覆盖改名前后两代）。`dshmarket` 无 `plugin-` 前缀，不受影响；`@deepseek-ai/*` 为 scoped 目录，不匹配。
- **失败处理**：`try/catch` 记日志、**不中断启动**——该目录已无引用者，属纯卫生动作，删除失败不应让应用起不来。
- **日志**：成功与失败都打 `[dsh-harmony]` 前缀，便于真机确认（对应 AC-8）。
- **幂等**：第一次启动清掉旧名后，后续启动清理集合为空，无副作用。

## 5. 数据流

```
[构建期]
  <projectRoot>/plugins/harmony-plugin-fs-mutate/   ← 唯一真源（入库）
        │ collectPlugins()  读 package.json 的 name 决定落地名；断言 ^harmony-plugin-*
        ▼
  dsh-dist/node_modules/harmony-plugin-fs-mutate/      （gitignored）
        │ collect-dsh.mjs:489 开头已整体 rmSync(distDir)，故不会残留旧名
        ▼
  dsh-dist.tar.gz  ──►  web_engine/.../resfile/resources/app/dsh-dist.tar.gz
        │
[运行期]
        ▼
  $DSH_HOME/dsh-dist/                                  首启解压，marker 命中则跳过
        │ ensureDshPluginsProfileLink()   先删后拷 + 陈旧清理
        ▼
  $DSH_HOME/profiles/node_modules/harmony-plugin-fs-mutate/
        │ dsh-agent-presets discovery：从 ctx.baseUrl(=profiles/desktop) 向上 walk
        ▼
  preset 行 `- id: fs-mutate` / `name: 'harmony-plugin-fs-mutate'` 解析成功
        ▼
  session.create 成功（否则 agent-preset/invalid）
```

## 6. 迁移与残留处理

| 位置 | 旧 tar 残留？ | 处理 |
|---|---|---|
| 构建机 `dsh-dist/` | 否 | `collect-dsh.mjs:489` 开头 `rmSync(distDir)` 整体清空 |
| 构建机 `profiles/node_modules/` | 不适用（构建机不跑运行期镜像） | — |
| 设备 `$DSH_HOME/dsh-dist/` | **是** | 测试流程强制删除该目录（保留 `.dsh` 其余）以解压新 tar |
| 设备 `$DSH_HOME/profiles/node_modules/dsh-plugin-fs-mutate/` | **是** | 由 FR-4 的陈旧清理在启动时删除 |
| 设备 preset 内旧行 `name: 'dsh-plugin-fs-mutate'` | **是**（仅当旧 tar 未删） | 删 `dsh-dist` 后由新 tar 的烘焙行取代；`ensurePresetRows` 只追加不改写，故**必须**删旧 `dsh-dist` |

> `collectPlugins()` **不需要**扩展为"清理 dsh-dist 内旧名"：`collect-dsh.mjs` 已在开头清空整个 `dsh-dist`（约 `:489`，位于 `pnpm deploy` 之前），构建产物天然干净。

### 6.1 就地升级路径（评审发现，已知边界）

上表的处理全部**依赖"删掉设备 `$DSH_HOME/dsh-dist`"** 这一操作。它在测试流程与全新安装下成立，但**就地升级**（覆盖安装 / `hdc app install -r`）做不到：

1. `ensureDshExtracted()` 只比对解压 marker，不比对版本或内容 hash；新旧 tar 都含该文件 → **命中即跳过**，设备继续用**旧** `dsh-dist`。
2. 旧 `dsh-dist` 里烘焙的 preset 行仍是 `name: 'dsh-plugin-fs-mutate'`；且 `ensurePresetRows()` 只在行 `id` 缺失时追加、**从不改写已存在的行** → 新行不会被写入。
3. `ensureDshPluginsProfileLink()` 因源集合中没有 `harmony-plugin-*` 而提前返回 → 既不复制新名，也不清理旧名。

**净结果**：应用仍可用（旧行解析到旧副本，且新旧插件代码行为等价），但**改名不生效**，本模块的目标状态未达成。

**这是刻意的取舍，不是遗漏**：若把第 3 步改成"源集合为空时也执行清理"，则旧名副本被删而旧 preset 行仍在 → 该行不可解析 → **会话创建直接失败**（正是本插件历史上真实发生过的故障形态，见提交 `a488cac`）。用一个不可用的会话入口换取一次改名生效，代价不对等。故 `names.length === 0` 的提前返回是**安全属性**，不是待修的 bug——源码中已就地注释，防止后人"修正"它。

**结论**：改名以「全新安装 / 清除 `$DSH_HOME/dsh-dist`」为生效条件，并在 spec §6 与 `plugins/README.md` 中明示。让 `ensureDshExtracted()` 具备版本感知（按内容 hash 而非仅 marker 判定）是**影响所有 `dsh-dist` 变更的既有架构缺口**（不止本次改名），本模块只记录不改，以免引入范围外变更。

## 7. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 5 个身份落点漏改一处 | 会话无法创建（`agent-preset/invalid`） | 改完对两处 `HARMONY_ENSURED_PRESET_ROWS` 做双文件 `grep` 对照；再在**设备端**直接读实际 preset `agent.cordis.yml` 断言新名（构建期 + 运行期双重验证），而非只信源码 |
| R2 | 设备旧 `dsh-dist` 未删，旧行被保留 | 旧行不可解析 → 会话创建失败 | 测试流程显式删除 `$DSH_HOME/dsh-dist`；AC-6/AC-9 覆盖 |
| R3 | 旧名副本残留于 `profiles/node_modules` | 若有旧行仍可解析，则静默加载过期插件 | FR-4 陈旧清理 + AC-8 |
| R4 | 插件源码在移动中损坏 | 行为变更（违反 FR-6） | 旧副本经 `sed` 包名归一化后与迁移结果 `diff -r` **必须为空**（AC-13）。该判据可机械化且**充分**：直接证明"每一处差异恰好是包名令牌"。辅以不一致行数 == 24 交叉校验（注意：计数单独**不充分**——12 处行为改动同样产生 12 行差异） |
| R5 | `collectPlugins()` 源根改错，导致收集静默无操作 | 产物缺插件 → 运行期 preset 不可解析 | `collect-dsh` 后断言 `dsh-dist/node_modules/harmony-plugin-fs-mutate/package.json` **存在**（AC-5）——不能只看"脚本没报错" |
| R6 | 断言正则改宽（如误留 `dsh-plugin-`） | 命名约定失守 | AC-4 + §4.2 逐项清单 |
| R7 | 父工程 submodule 指针被误提交 | 父工程指向未预期的 harmony 提交 | 默认**不提交**指针；`git add` 显式列文件，不用 `git add -A` |

## 8. 验证策略

| 层 | 手段 | 覆盖 |
|---|---|---|
| 静态 | `grep -rn 'dsh-plugin-fs-mutate'`（排除 `dsh-dist`/`node_modules`/`build`） | AC-2 |
| 静态 | 两处 `HARMONY_ENSURED_PRESET_ROWS` 双文件对照 | AC-4 |
| 静态 | 迁移前后 md5 对比 | AC-13 |
| 静态 | `node --check` 语法校验改动过的 `.mjs`/`.js` | 语法 |
| 构建 | `collect-dsh` 后断言产物含新名、不含旧名；grep 烘焙 preset | AC-5, AC-6 |
| 构建 | `build-hap.ps1` 自带签名断言（profile type 必须匹配 `-SignMode`） | 打包 |
| 真机 | `--inspect`（CDP）读目录、读 console、读对话内容 | AC-7~AC-11 |
| 真机 | `hilog | grep dsh-harmony` | AC-7 |

## 9. 关键决策记录

| # | 决策 | 备选 | 理由 |
|---|---|---|---|
| D1 | 包名**一并**改为 `harmony-plugin-fs-mutate` | 只挪目录、包名保留 `dsh-plugin-fs-mutate` | 两端 README 均明文声明"目录名 = npm 包名"；只挪不改会让该约定失效，并使 `collectPlugins()` 的"目录名 vs 包名"断言无法自洽。已获用户确认 |
| D2 | preset 行 `id` 保持 `fs-mutate` | 改为 `harmony-fs-mutate` | 行 id 是 preset 内的稳定身份；改名无功能收益，却引入与设备已成型的 preset 的差异面 |
| D3 | 用**复制**而非 symlink | symlink | 鸿蒙沙箱禁止 symlink（`EACCES`）；与 `dshmarket` 既有做法一致 |
| D4 | 新增**同族陈旧目录清理** | 不清理（残留无害） | 残留并非无害：旧 preset 行可解析到过期插件副本 → 静默错误。属本次改名引入的副作用，故在本模块内消解 |
| D5 | 清理失败**不中断**启动 | 硬失败 | 该目录已无引用者，属卫生动作；硬失败会把"可用的应用"变成"起不来的应用"，代价不对等 |
| D6 | `plugins/README.md` 与 `dsh-plugins/README.md` **中文单文件** | 中英双语对 | 受众为本团队，与 `specs/` 及脚本注释口径一致；避免为一段目录说明维护两份镜像 |
| D7 | 不扩展 `collectPlugins()` 做旧名清理 | 扩展 | `collect-dsh.mjs` 已在开头清空整个 `dsh-dist`，扩展即死代码（YAGNI） |
| D8 | 不出 `tasks.md` | 出 | 本次为约 19 个机械改动的迁移，`plan.md` §4 的逐文件清单已可逐条勾选；额外任务文档属仪式 |
| D9 | 「纯移动」判据由**逐字节不变**放宽为**仅名字令牌行不同**，并连改 4 处源码名字令牌（`sandbox.js`×2、`delete.js`×1、`move.js`×1） | 保留旧名以维持字节不变 | 开发阶段实测证伪：`lib/sandbox.js:77` 抛错文案与 3 个 `@module` 标签内嵌包名，与原判据不可兼得。**FR-1.2 零残留优先**——留旧名会让抛错文案指向一个已不存在的包。判据改为「差异行数 == 令牌数」，仍**等价**保证行为零变更 |
| D10 | 保留集取**实际复制成功**的集合 `copied`，而非源目录集合 `names` | 沿用 `names` | 评审发现：源里缺 `package.json` 的目录不会被物化，却会被"保留"，使 `profiles/node_modules` 不是 `dsh-dist/node_modules` 的忠实镜像。改用 `copied` 后镜像关系精确 |
| D11 | 「纯移动」主判据采用**包名归一化（`sed`）后 `diff -r` 为空** | 仅用「差异行数 == 令牌数」 | 评审指出计数单独**不充分**（12 处行为改动同样产生 12 行差异）。归一化 diff 为空可机械证明"每一处差异恰好是包名令牌"，且已实证通过。计数降级为交叉校验 |
| D12 | `names.length === 0` 的提前返回**保留**（不按评审建议改为"总是清理"） | 源集合为空时也执行清理 | 评审建议会使就地升级下旧名副本被删而旧 preset 行仍在 → 该行不可解析 → **会话创建失败**（历史上真实发生过的故障）。提前返回是保护升级路径的**安全属性**。采纳评审的"现象观察"并写入 FR-4.5/FR-4.6 与 §6.1，驳回其修复方案 |

## 10. 待确认

无。
