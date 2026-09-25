# 202-plugin-fs-mutate 技术方案

> 模块：202-plugin-fs-mutate
> 对应规格：[specs/202-plugin-fs-mutate/spec.md](./spec.md)
> Last Updated: 2026-09-18

## 1. 技术上下文

### 1.1 运行时环境

- **构建期**：Windows 宿主机 Node（`node scripts/*.mjs`），无 DevEco 参与（除最后的 HAP 构建）。
- **运行期**：Electron-on-鸿蒙（Electron 37 / Node 22.17.0）主进程内的 dsh Host。插件是 in-process Cordis 插件，不独立成进程。
- **部署形态**：插件源码 → `dsh-dist/node_modules/<包名>/` → `dsh-dist.tar.gz` → resfile → 首启解压到 `$DSH_HOME/dsh-dist` → 运行期再镜像到 `$DSH_HOME/profiles/node_modules/`。

### 1.2 依赖

| 依赖 | 来源 | 用途 |
|---|---|---|
| `@deepseek-ai/cordis` | 宿主 dsh-dist 的依赖闭包（`peerDependencies`） | 插件框架 |
| `@deepseek-ai/dsh-fs` | 同上 | `ctx.fs` 缝隙（含本工程补丁补入的 `remove` / `writeBytes` / `chmod` 原语） |
| `@deepseek-ai/dsh-sandbox` | 同上 | 围栏模式与升级语义 |
| `@deepseek-ai/dsh-tools` | 同上 | 工具注册 |
| `@deepseek-ai/schemastery` | 同上 | 配置 schema |
| `dsh-fs-remove-primitive.patch` | 本工程 `patches/dsh-v0.1.5-rc.2/` | 提供 `ctx.fs.remove`（`delete`、`move` 的删除半程） |
| `dsh-fs-write-bytes.patch` | 本工程 `patches/dsh-v0.1.5-rc.2/` | 提供 `ctx.fs.writeBytes`（`copy`、`move` 的拷贝半程，按字节搬运） |
| `dsh-fs-chmod-primitive.patch` | 本工程 `patches/dsh-v0.1.5-rc.2/` | 提供 `ctx.fs.chmod`（权限位变更；`fs-local` 实现会回读校验） |

> 插件为纯 ESM、无构建步骤（`lib/` 即发布源码）、`private: true`、不发布到 registry。

## 2. 宪法合规检查

| 宪法原则（[constitution.md](../constitution.md)） | 状态 | 说明 |
|---|---|---|
| §1.1 零上游改动 | ✅ | 不改 dsh 源码；不新增/删除任何 dsh 补丁；插件经本工程既有补丁提供的 `ctx.fs` 原语工作 |
| §1.3 只写装配代码 | ✅ | 插件只经 `ctx.fs` seam 注册工具；收集/镜像只做物化与复制，不新造业务逻辑 |
| §3.1 源码即真理 | ✅ | 本文档所有符号/行号均来自实际读取；不确定处标 `[待确认]` |
| §3.3 日志规范 | ✅ | 运行期新增/修改的日志均用 `[dsh-harmony]` 前缀 |
| §4.1 优雅关闭 | ✅ | 不涉及进程/端口生命周期 |
| §5.1 幂等构建 | ✅ | `collectPlugins()` 保持"目标已有 `package.json` 即跳过"；`ensureDshPluginsProfileLink()` 本就先删后拷，天然幂等 |
| §5.3 产物适配集中在收集脚本 | ✅ | 构建期适配在 `collect-dsh.mjs`，运行期兜底在 `main.js`，双保险 |
| §6 治理规则（前缀） | ✅ | 提交用 `docs` / `refactor` / `fix`，均在 constitution §6 与团队提交规范的白名单内 |
| §6 治理规则（spec/plan 成对） | ✅ | 本模块产出 `spec.md` + `plan.md`（+ `test-cases.md`） |

> **观察（不在本次范围）**：constitution §1.1 记"仅限 4 个 patch"，而实际已有 13 个。该文档为 2026-09-04 提取物，未随补丁增加而更新。本次不改（属无关重构）。

## 3. 命名约定与身份落点

插件身份有 **5 个落点**，必须同时一致；漏一处即表现为「会话无法创建」（`agent-preset/invalid`，reason 为 `row "<id>" names a plugin that cannot be resolved`）。

| # | 落点 | 文件 | 当前值 |
|---|---|---|---|
| 1 | 包名 | `plugins/harmony-plugin-fs-mutate/package.json` | `harmony-plugin-fs-mutate` |
| 2 | 插件 `name` 导出 | `plugins/harmony-plugin-fs-mutate/lib/index.js` | `harmony-plugin-fs-mutate` |
| 3 | **preset 行 `name`（运行时导入说明符）** | `src-main/main.js` 的 `HARMONY_ENSURED_PRESET_ROWS` | `harmony-plugin-fs-mutate` |
| 4 | **preset 行 `name`（构建期烘焙，镜像 #3）** | `scripts/collect-dsh.mjs` 的 `HARMONY_ENSURED_PRESET_ROWS` | `harmony-plugin-fs-mutate` |
| 5 | 目录名 | 文件系统 | `harmony-plugin-fs-mutate` |

**preset 行 `id`** 固定为 `fs-mutate`：行 id 是 preset 内的稳定身份，与包名/目录名解耦。

**包名令牌**（非功能性，但同属"身份一致"要求；合计 **16 处**，分布于 11 个文件）：
- `lib/index.js` 3 处：`@module` 名、`name` 导出、`throw new Error('... : maxTransferBytes must be ...')` 文案前缀；
- `lib/sandbox.js` 2 处：`@module` 名、`throw new Error('... : the mounted filesystem confines but ctx.sandboxPolicy is missing')` 文案前缀；
- `lib/chmod.js` / `lib/copy.js` / `lib/delete.js` / `lib/move.js` / `lib/permissions.js` / `lib/transfer.js` 各 1 处：`@module` 名；
- `package.json` 1 处：`name`；
- `plugins/harmony-plugin-fs-mutate/README.md` / `README_zh.md` 各 2 处：标题与 `- name:` 配置示例。

**相关的非插件令牌**（同属命名约定，随插件名一致）：
- `collect-dsh.mjs` 的断言正则 `/^harmony-plugin-[A-Za-z0-9._-]+$/`、日志与报错文案、函数头注释；
- `src-main/main.js` 的 `ensureDshPluginsProfileLink()` 通配 `startsWith('harmony-plugin-')` 与注释；
- 两端 `README.md` / `README_zh.md` 的插件约定章节。

## 4. 实现落点清单

### 4.1 插件本体（`plugins/harmony-plugin-fs-mutate/`）

| 路径 | 职责 |
|---|---|
| `lib/index.js` | 插件入口：`name` 导出、`inject = ['tools','fs']`、`Config`（`maxTransferBytes` 默认 10 MiB）与 `apply` |
| `lib/delete.js` | `delete` 工具注册：逐路径 `ctx.fs.remove`，逐路径失败进结果而非抛出 |
| `lib/move.js` | `move` 工具注册：受围栏复制 + 源删除 |
| `lib/copy.js` | `copy` 工具注册：与 `move` 共用规划器，不做删除 |
| `lib/chmod.js` | `chmod` 工具注册：设置权限位并回读校验 |
| `lib/sandbox.js` | `FsMutationSandbox`：围栏模式判定、提权 schema 字段与按调用打戳 |
| `lib/transfer.js` | 共用规划器：包含关系判断、覆盖规则、空目录拒绝、按字节搬运 |
| `lib/permissions.js` | `mode` 语法解析（三/四位八进制字符串，拒绝符号模式） |
| `package.json` | 包元数据（`name`、`private`、`type`、`main`、`exports`、`files`、`peerDependencies`） |
| `README.md` / `README_zh.md` | 插件文档：工具语义、配置、Known Limitations |
| `tests/permissions.test.mjs` / `tests/transfer.test.mjs` | 纯 Node 单测；两个引擎模块（`permissions.js` / `transfer.js`）刻意无 import，用内存 `ctx.fs` 桩驱动 |

### 4.2 构建期（`scripts/collect-dsh.mjs`）

| 位置（符号） | 职责 |
|---|---|
| `collectPlugins()` | 源根 `resolve(projectRoot, 'plugins')`；按 `harmony-plugin-*` 目录通配发现；落地目录名取自 `package.json` 的 `name`；断言 `/^harmony-plugin-[A-Za-z0-9._-]+$/`；缺 `package.json` / JSON 非法 / 名不符约定即 `process.exit(1)`；无匹配目录仅打印一行日志；目标已有 `package.json` 即跳过 |
| `HARMONY_ENSURED_PRESET_ROWS` | 烘焙 preset 行（含 `fs-mutate` 行，`name: 'harmony-plugin-fs-mutate'`） |
| `assertPresetRowsMirrorMainJs()` | 读 `src-main/main.js` 源码解析同名表，逐条比对 `id` / `name` / `requireRow`，不等即构建期抛错 |

> `scripts/collect-runtime.mjs` **不涉及** `plugins/`（它只恢复 `src-main/*` 三件套与 `skills/`），且 `APP_KEEP` 只守护 `resfile/resources/app`，而插件落在 `dsh-dist.tar.gz` 内。

### 4.3 运行期（`src-main/main.js`）

| 位置（符号） | 职责 |
|---|---|
| `HARMONY_ENSURED_PRESET_ROWS` | 运行期补 preset 行（必须与 `collect-dsh.mjs` 逐条一致） |
| `ensureDshPluginsProfileLink()` | 把 `dsh-dist/node_modules/harmony-plugin-*` 复制到 `$DSH_HOME/profiles/node_modules/`；先删后拷、每次启动覆盖；复制失败响亮报错；末尾做同族陈旧目录清理（源集合非空时） |

### 4.4 文档

| 文件 | 内容 |
|---|---|
| `plugins/README.md` | 目录定位、约定（命名 / 目录名=包名 / 编译期打入 / 运行期全默认加载）、与父工程 `dsh-plugins/` 的分工、**新增插件步骤**、现有插件索引 |
| `<父工程>/dsh-plugins/README.md` | 目录定位（通用可插拔）、约定（`dsh-plugin-XXX`）、指向本工程 `plugins/` 作为专用插件归位点 |
| `dsh-desktop-hos/README.md` / `README_zh.md` | 插件约定章节（两侧分工）+ stage ② 描述 + 目录结构树 + 插件文档链接 |
| 父工程 `README.md` / `README_zh.md` | Repository layout 表、Roles at a glance 表、"Plugin convention" 节 |

## 5. 数据流

```
[构建期]
  <projectRoot>/plugins/harmony-plugin-fs-mutate/   ← 唯一真源（入库）
        │ collectPlugins()  读 package.json 的 name 决定落地名；断言 ^harmony-plugin-*
        ▼
  dsh-dist/node_modules/harmony-plugin-fs-mutate/      （gitignored）
        │ collect-dsh.mjs 开头已整体 rmSync(distDir)，产物天然干净
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

## 6. `dsh-dist` 更新生效条件

设备只有在**重新解压 `dsh-dist`** 后才会看到新的插件集合。关键事实：

1. `ensureDshExtracted()` 只比对解压 marker，不比对版本或内容 hash；新旧 tar 都含该 marker → **命中即跳过**。
2. **就地升级**（覆盖安装 / `hdc app install -r`、保留 `$DSH_HOME/dsh-dist`）因此不会重解压，设备继续用**旧** `dsh-dist` 里烘焙的 preset 行与旧插件副本。
3. `ensurePresetRows()` 只在行 `id` 缺失时追加、**从不改写已存在的行**，故新行不会被写入。

**净结果**：应用仍可用（旧行解析到旧副本），但插件集合的变更不生效。

**为什么 `names.length === 0` 的提前返回不能被"修正"**：若把 `ensureDshPluginsProfileLink()` 改成"源集合为空时也执行清理"，则旧 `dsh-dist` 烘焙的旧 preset 行对应的旧插件副本被删 → 该行不可解析 → **会话创建直接失败**。用一个不可用的会话入口换取一次清理，代价不对等。故该提前返回是**安全属性**，不是待修的 bug —— 源码中已就地注释，防止后人"修正"它。

**结论**：插件集合变更以「全新安装 / 清除 `$DSH_HOME/dsh-dist`」为生效条件，并在 spec §6 与 `plugins/README.md` 中明示。让 `ensureDshExtracted()` 具备版本/哈希感知是**影响所有 `dsh-dist` 变更的既有架构缺口**（不止本模块），本模块只记录不改，以免引入范围外变更。

## 7. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 两处 `HARMONY_ENSURED_PRESET_ROWS` 漂移（新增行只加了一边，或改了 `id` / `name` / `requireRow`） | 构建期与运行期分叉；运行期以 `agent-preset/invalid` 暴露，构建期完全静默 | `assertPresetRowsMirrorMainJs()` 构建期硬失败 + 双文件 `grep` 对照 + 设备端直接读实际 `agent.cordis.yml` 断言，而非只信源码 |
| R2 | `collectPlugins()` 源根错误，导致收集静默无操作 | 产物缺插件 → 运行期 preset 不可解析 | `collect-dsh` 后断言 `dsh-dist/node_modules/harmony-plugin-fs-mutate/package.json` **存在**（AC-5）—— 不能只看"脚本没报错" |
| R3 | 命名约定失守（目录名 ≠ 包名，或包名不匹配 `harmony-plugin-*`） | 两端 README 声明失效；物化到错误目录或收集阶段硬失败 | `collectPlugins()` 的包名断言 `/^harmony-plugin-[A-Za-z0-9._-]+$/` + AC-2 全工程令牌一致性 |
| R4 | 父工程 submodule 指针被误提交 | 父工程指向未预期的 harmony 提交 | 默认**不提交**指针；`git add` 显式列文件，不用 `git add -A` |

## 8. 验证策略

| 层 | 手段 | 覆盖 |
|---|---|---|
| 静态 | `grep -rn 'plugin-fs-mutate'`（排除 `dsh-dist`/`node_modules`/`build`），每一处命中必须带 `harmony-` 前缀 | AC-2 |
| 静态 | 两处 `HARMONY_ENSURED_PRESET_ROWS` 双文件对照 | AC-4 |
| 静态 | `node --check` 语法校验改动过的 `.mjs`/`.js` | 语法 |
| 构建 | `collect-dsh` 后断言产物含 `harmony-plugin-fs-mutate`；`grep` 烘焙 preset | AC-5, AC-6 |
| 构建 | `build-hap.ps1` 自带签名断言（profile type 必须匹配 `-SignMode`） | 打包 |
| 真机 | `--inspect`（CDP）读目录、读 console、读对话内容 | AC-7~AC-14 |
| 真机 | `hilog | grep dsh-harmony` | AC-7 |

## 9. 关键决策记录

| # | 决策 | 备选 | 理由 |
|---|---|---|---|
| D1 | 运行期用**复制**而非 symlink | symlink | 鸿蒙沙箱禁止 symlink（`EACCES`）；与 `dshmarket` 既有做法一致 |
| D2 | **每次启动都覆盖复制**（先删后拷） | 沿用 `dshmarket` 的"已存在即跳过" | 插件内容随 HAP 迭代，跳过会让 profile 侧 pin 住旧版本；先删后拷才能让目标与源精确一致（源里删掉的文件不会残留） |
| D3 | 复制失败**响亮报错** | 沿用 `dshmarket` 的"不阻塞" | 复制失败 ⇒ preset 行不可解析 ⇒ 会话无法创建；静默会把致命故障伪装成正常启动 |
| D4 | 新增**同族陈旧目录清理**，且失败**不中断**启动 | 不清理；或清理失败硬失败 | 残留并非无害：旧 preset 行可解析到过期插件副本 → 静默错误。但该目录已无引用者，属卫生动作；硬失败会把"可用的应用"变成"起不来的应用" |
| D5 | `names.length === 0` 的提前返回**保留**（不改为"总是清理"） | 源集合为空时也执行清理 | 会删掉旧 `dsh-dist` 烘焙的旧 preset 行所依赖的副本 → 该行不可解析 → **会话创建失败**。提前返回是保护升级路径的**安全属性**（见 §6） |
| D6 | `copy` **不新增** seam 原语 | 为复制单独加原语 | `readBytes` + `writeBytes` 已足够按字节搬运（`writeText` 拒绝二进制），无需改 dsh |
| D7 | `chmod` **必须回读校验** | 只调用 `chmod` 即认为成功 | `hmdfs`（共享用户目录）接受调用却不落实请求的模式且不报错；不回读会把静默忽略伪装成成功 |
| D8 | 插件身份固定为 **5 个落点**（目录名、包名、`name` 导出、两处 preset 行），preset 行 `id` 保持 `fs-mutate` | 让行 id 随包名变化 | 行 id 是 preset 内的稳定身份，改它无功能收益却引入与设备已成型的 preset 的差异面；两处 preset 行由 `assertPresetRowsMirrorMainJs()` 机械互校 |

## 10. 待确认

无。
