# plugins/ —— 本工程专用插件

本目录存放 **deepseek-harness-harmony 专用**的 dsh 插件。

## 一、与父工程 `dsh-plugins/` 的分工

| 维度 | `<父工程>/dsh-plugins/` | 本目录 |
|---|---|---|
| 定位 | 通用、可插拔插件 | 本工程**专用**插件 |
| 判定标准 | 不依赖任何特定壳的补丁/适配，可被多个壳消费 | 依赖本壳特有的上游补丁、profile 或运行期适配 |
| 命名 | `dsh-plugin-XXX` | `harmony-plugin-XXX` |
| 目录名 = 包名 | 是 | 是 |
| 载入时机 | 由各消费壳自行决定 | **编译期**打入 HAP，运行期**全部默认加载** |

**判断一个插件该放哪边**：问一句 —— 「把它装到另一个 dsh 壳（例如 `deepseek-harness-desktop`）上，它能工作吗？」

- 能 → 通用插件，放父工程 `dsh-plugins/`。
- 不能（依赖本工程的补丁集 / profile / 运行期适配）→ 专用插件，放本目录。

## 二、约定

1. **一个插件一个目录**，且**同一个名字必须出现在 4 个语义位置**：目录名、npm 包名、插件的 `name` 导出、preset 行的 `name`。其中 preset 行的 `name` 在**两个文件**里各写一次（`src-main/main.js` + `scripts/collect-dsh.mjs`），故实际共 **5 处落点**。
2. **命名 `harmony-plugin-XXX`**，裸包名（非 scoped），`XXX` 描述功能。
3. **纯 ESM，无构建步骤** —— `lib/` 即发布源码。
4. **`private: true`**，不发布到 registry；依赖一律声明为 `peerDependencies`，由宿主 `dsh-dist/node_modules` 提供。
5. **编译期打入**：`scripts/collect-dsh.mjs` 的 `collectPlugins()` 按 `harmony-plugin-*` 通配自动发现，把目录复制到 `dsh-dist/node_modules/<包名>/`，随后随 `dsh-dist.tar.gz` 打进 HAP。因为落地目录名取自 `package.json` 的 `name` 而非目录名，**新增插件无需改动收集脚本**。
6. **运行期镜像**：`src-main/main.js` 的 `ensureDshPluginsProfileLink()` 在每次启动时把 `dsh-dist/node_modules/harmony-plugin-*` 复制（**非 symlink** —— 鸿蒙沙箱禁止 symlink，`EACCES`）到 `$DSH_HOME/profiles/node_modules/`，并清理同族陈旧目录。这一步是**必需**的：preset 行的可解析性由 `dsh-agent-presets` 的 discovery 判定，对裸包名它会从 profile 目录向上走 `node_modules` 找 `<pkg>/package.json`。

   该清理是一处**删除操作**：`profiles/node_modules/` 下任何匹配 `dsh-plugin-*` / `harmony-plugin-*` 且不在本次复制集合中的目录都会被移除（`dshmarket` 无 `plugin-` 前缀、`@deepseek-ai/*` 为 scoped，均不匹配）。它**只在源集合非空时**执行——**不要把"源为空就跳过清理"当 bug 去修**：那时若剪除旧名副本，旧 `dsh-dist` 里烘焙的旧 preset 行会不可解析，直接导致会话创建失败。
7. **挂载**：preset 行写在 `HARMONY_ENSURED_PRESET_ROWS` 里，且**必须同时写两处** —— `src-main/main.js`（运行期补丁）与 `scripts/collect-dsh.mjs`（构建期烘焙）。两处逐条镜像，改一处必须改另一处。
8. **日志前缀** `[dsh-harmony]`（constitution §3.3），便于 `hilog | grep dsh-harmony` 排查。
9. **重命名 / 移除插件的生效条件**：运行期镜像是「复制 + 清理」语义，但设备只有在**重新解压 `dsh-dist`** 后才会看到新的插件集合。**就地升级**（保留 `$DSH_HOME/dsh-dist`）不会重解压（解压 marker 命中即跳过），因此改名或删插件**必须**配合「全新安装」或「清除设备 `$DSH_HOME/dsh-dist`」才会生效，否则设备会继续以旧 preset 行 + 旧副本运行（功能可用，但改名不生效）。

## 三、新增一个插件的步骤

1. 在本目录新建 `harmony-plugin-XXX/`，内含：
   - `package.json`：`name` = `harmony-plugin-XXX`、`private: true`、`type: "module"`、`main` / `exports` 指向 `lib/index.js`；
   - `lib/index.js`：含 `export const name`（与包名一致）与 `export const inject`（声明所需服务）。
2. 写该插件自己的 `README.md`（如需中文镜像，另加 `README_zh.md`）。
3. 在 `src-main/main.js` 与 `scripts/collect-dsh.mjs` 的 `HARMONY_ENSURED_PRESET_ROWS` **各加一行**（`id` / `name` / `requireRow` / `reason`）。
4. 重跑阶段 ②：`node scripts/collect-dsh.mjs`。
5. 按本工程既有流程打包、装机，并用 `--inspect` 验证。

> ⚠️ **preset 行的 `name` 是运行时导入说明符，不是注释。** 改漏一处**不会**在编译期报错，只会表现为「新建会话 / 发消息失效」（`session.create` 报 `agent-preset/invalid`，reason 为 `row "<id>" names a plugin that cannot be resolved`）。改完务必两处对照，并在设备上直接读实际的 `agent.cordis.yml` 断言，而不是只信源码。

## 四、现有插件

| 插件 | 提供的工具 | 依赖的本工程补丁 |
|---|---|---|
| [`harmony-plugin-fs-mutate`](./harmony-plugin-fs-mutate/) | `delete`、`move` | [`dsh-fs-remove-primitive.patch`](../patches/dsh-v0.1.5-rc.2/dsh-fs-remove-primitive.patch)（提供 `ctx.fs.remove` 原语） |
| [`harmony-plugin-fs-search`](./harmony-plugin-fs-search/) | `grep` | 无（纯 JavaScript 实现，仅使用既有的 `ctx.fs` seam，不依赖本工程任何补丁） |

## 五、相关文档

- [`specs/201-plugin-fs-mutate/`](../specs/201-plugin-fs-mutate/) —— fs-mutate 插件迁移与本约定的规格、技术方案、测试用例
- [`../dsh-plugins/README.md`](../../dsh-plugins/README.md) —— 父工程通用插件目录
- [`../README.md`](../README.md) —— 本工程总说明中的插件约定章节
