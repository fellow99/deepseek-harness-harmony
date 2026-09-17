# skills/ —— 本工程专用技能

本目录存放 **deepseek-harness-harmony 专用**的 dsh 工具技能：它们描述或依赖**本壳特有的运行期环境**（HarmonyOS HAP 的沙箱围栏、`hmdfs` 特性、能力缺口、打包路径等），因此在其它壳上不成立。

## 一、与父工程 `skills/` 的分工

| 维度 | `<父工程>/skills/` | 本目录 |
|---|---|---|
| 定位 | **通用、可插拔**技能 | 本工程**专用**技能 |
| 判定标准 | 不依赖任何特定壳的补丁 / 适配 / 路径，可被多个壳采纳 | 描述或依赖该壳特有的运行期环境 |
| 命名 | 功能性 kebab-case，**无前缀** | 同左（**无前缀**） |
| 目录名 = frontmatter `name` | 是（**约定，非校验**） | 是（同） |
| 何时可用 | 由采纳它的壳决定 | 随本壳的 HAP 分发，运行期作为 bundled 根提供 |

**判断一个技能该放哪边**：问一句 —— 「它描述的东西在另一个 dsh 壳上还成立吗？」成立 → 通用，放父工程；不成立 → 本目录。

## 二、本目录的技能如何生效（装配链路）

本目录**随 HAP 分发**，运行期作为 dsh 的 **bundled 技能根**提供：

```
skills/<技能名>/SKILL.md
   │ ⓪ scripts/collect-runtime.mjs  restoreTree('skills', resfile/app/skills)
   ▼
web_engine/src/main/resources/resfile/resources/app/skills/
   │（APP_KEEP 含 'skills' —— 技能故意放在 dsh-dist.tar.gz 之外，只换 HAP 即可更新）
   ▼
设备：/data/storage/el1/bundle/electron/resources/resfile/resources/app/skills
   │ src-main/main.js 在启动时设 DSH_BUNDLED_SKILL_DIR 指向它
   ▼
dsh skill-filesystem 的 bundled 根（rank 600、trustedHost —— 直接经 Node fs 读取，绕过 ctx.fs）
   ▼
模型可见
```

### 准确的可用时机（**不要写成"启动时即加载"**）

| 时点 | 实际发生的事 |
|---|---|
| 进程启动 | 只是把 `DSH_BUNDLED_SKILL_DIR` 配好；**不读技能** |
| 技能发现 | **惰性** —— dsh 按需扫描技能根并按 cwd / scope 缓存 |
| 会话首次请求**之前** | 注入一条持久的 user-role **技能目录**消息：仅 `name` + `description`（描述截断 500 字） |
| 需要正文时 | **按需加载** —— 模型调用 `skill` 工具，或人工输入 `/name`。正文**不缓存**，每次重读文件 |

## 三、优先级：本目录的技能**可被覆盖**（有意行为）

dsh 的技能根按 rank 排序，**数字小者优先**：

| rank | 根 | 级别 |
|---|---|---|
| 100 | `<项目>/.dsh/skills` | 项目 |
| 200 | `<项目>/.agents/skills` | 项目 |
| 300 | `customSkillDirs` | 配置 |
| 400 | `$DSH_HOME/skills` | 用户 |
| 500 | `$DSH_AGENTS_HOME/skills` | 用户 |
| **600** | **本目录（bundled）** | **本壳内置** |

即 **bundled 优先级最低**：同名时用户级或项目级的同名技能会**覆盖**本壳内置的技能。这是刻意设计（让用户能改写内置行为），**不要试图"修掉"它**。

## 四、命名与格式

**命名：功能性 kebab-case，无前缀。** 不要写 `harmony-skill-xxx` —— dsh 自身的技能也不用前缀（如 `cordis-plugin-development`），而技能的 `name` 是**模型可见标识**、也是人工 `/name` 要输入的字符串，加前缀只是噪音。**归属由目录区分，不由名字区分。**

> **约定：目录名必须等于 frontmatter `name`。** 实现**不校验**这一点（目录 `foo/` 里写 `name: bar` 会被发现为 `bar`），所以靠自觉 —— 不一致只会让人和模型都困惑。

深度 1、`<技能名>/SKILL.md` 或 `<名>.md`、必填/可选 frontmatter 字段、驼峰旧键被拒等完整格式规则，见 [`../../skills/README.md`](../../skills/README.md)。

## 五、新增一个技能

1. 在本目录新建 `<技能名>/SKILL.md`（**顶层**，不要嵌套）。
2. frontmatter 的 `name` 与目录名一致；`description` 写清「什么时候该用它」。
3. 正文只写**在本壳上验证过**的事实；未验证的明确标注"未验证"。
4. 重跑 ⓪：`node scripts/collect-runtime.mjs`（把 `skills/` 同步进 resfile），然后构建 HAP 并装机。
   > 技能在 `dsh-dist.tar.gz` **之外**，故**无需**重跑 ② collect-dsh、**无需**重打 tar、**无需**删设备 `$DSH_HOME/dsh-dist`。
5. 设备上验证：`hilog -x | grep DSH_BUNDLED_SKILL_DIR` 确认路径，再用 `skill` 工具按名加载。

> ⚠️ **本目录的技能是模型判断本壳能力边界的依据，写错比不写更有害。** 工程内已有先例：`harmony-runtime-capabilities` 曾因未随能力交付同步更新，声称 `delete` / `move` 不存在，导致模型拒绝使用已交付的工具（详见 [`specs/201-plugin-fs-mutate/`](../../specs/201-plugin-fs-mutate/)，其修正见提交 `c9ad23e`）。**能力发生变化时，必须同步更新引用了该能力的技能。**

## 六、现有技能

| 技能 | 说明 |
|---|---|
| [`harmony-runtime-capabilities`](./harmony-runtime-capabilities/SKILL.md) | 本壳的能力边界：可用工具、如何列目录、工作区围栏、缺哪些能力 |

## 七、相关文档

- [`../../skills/README.md`](../../skills/README.md) —— 父工程通用技能目录约定（含完整格式规则）
- [`../plugins/README.md`](../plugins/README.md) —— 对应的**插件**两层约定（plugins 与 skills 是同一套分工思路）
- [`../specs/201-plugin-fs-mutate/`](../specs/201-plugin-fs-mutate/) —— 技能内容与实际能力脱节的真实案例
