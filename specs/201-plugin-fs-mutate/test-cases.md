# 201-plugin-fs-mutate 测试用例

> 模块：201-plugin-fs-mutate
> 对应规格：[specs/201-plugin-fs-mutate/spec.md](./spec.md)
> 对应方案：[specs/201-plugin-fs-mutate/plan.md](./plan.md)
> Last Updated: 2026-09-17

## 0. 测试环境与前置

| 项 | 值 |
|---|---|
| 目标设备 | `3QC0226526001227` |
| 系统 | HarmonyOS 6.1.0.135（API 24） |
| 应用包名 | `org.fellow99.DeepseekHarnessHarmony` |
| `hdc` | `D:/oh-workspace/command-line-tools/sdk/default/openharmony/toolchains/hdc.exe` |
| 构建前置 | `DEVECO_SDK_HOME=d:\oh-workspace\command-line-tools\sdk\`；`export MSYS_NO_PATHCONV=1` |
| 设备侧 `$DSH_HOME` | `<userData>/.dsh`（即 `/data/storage/el2/base/files/.dsh`） |
| 调试通道 | `hdc fport tcp:19229 tcp:9229` → CDP `Runtime.evaluate`（主进程 `--inspect`） |
| 关键坑 | `--inspect` 的 `Runtime.evaluate` 必须带 `includeCommandLineAPI: true`，否则 `require` 未定义；用 `require` 而非 `import()` |

> **本组用例的首要目的**：验证"改名"这件事在**构建期**与**运行期**两个真实链路上都闭合，而不是只验证源码里字符串被替换了。原因：preset 行的 `name` 是**运行时导入说明符**，漏改/错改不会在编译期暴露，只会表现为会话创建失败。

---

## 1. 构建期用例

### TC-B1 —— 插件被物化为新名

| 项 | 内容 |
|---|---|
| 目的 | 验证 `collectPlugins()` 已重根到本工程 `plugins/`，并按新名落地 |
| 前置 | 插件已迁至 `deepseek-harness-harmony/plugins/harmony-plugin-fs-mutate/` |
| 步骤 | 1. `node scripts/collect-dsh.mjs`<br>2. 检查 `dsh-dist/node_modules/harmony-plugin-fs-mutate/package.json` 是否存在<br>3. 检查该 `package.json` 的 `name` 字段 |
| 期望 | 文件存在；`name` == `"harmony-plugin-fs-mutate"` |
| 证据 | 文件路径 + `name` 字段输出 |
| 失败含义 | 源根/通配改错，或收集静默无操作（脚本不报错但产物缺插件） |

### TC-B2 —— `dsh-dist` 无旧名残留

| 项 | 内容 |
|---|---|
| 目的 | 确认改名后构建产物里不残留旧包 |
| 步骤 | 1. 同 TC-B1 构建后<br>2. 检查 `dsh-dist/node_modules/dsh-plugin-fs-mutate/` |
| 期望 | 目录**不存在** |
| 证据 | `ls` 输出 |
| 备注 | 理论保证来自 `collect-dsh.mjs` 开头 `rmSync(distDir)` 整体清空；本用例是"理论保证"的实测确认 |

### TC-B3 —— 两处 preset 行清单逐条一致

| 项 | 内容 |
|---|---|
| 目的 | 验证 `src-main/main.js` 与 `scripts/collect-dsh.mjs` 的 `HARMONY_ENSURED_PRESET_ROWS` 镜像未失真 |
| 步骤 | 1. 从两文件各提取 `HARMONY_ENSURED_PRESET_ROWS` 条目<br>2. 逐条比对 `id` / `name` / `requireRow` |
| 期望 | 两处逐条相同；`fs-mutate` 行的 `name` == `harmony-plugin-fs-mutate`，`id` 仍为 `fs-mutate` |
| 证据 | 双文件提取结果对照 |
| 失败含义 | 两处不一致 → 构建期烘焙与运行期补丁产生分歧，设备上表现取决于走哪条路径，极难排查 |

### TC-B4 —— 烘焙进产物的 preset 行是新名

| 项 | 内容 |
|---|---|
| 目的 | 验证**产物内**（而非源码内）的 preset 已是新名 |
| 步骤 | 1. 构建后 `grep -rn "harmony-plugin-fs-mutate" dsh-dist/node_modules/@deepseek-ai/dsh-agent-presets/presets/`<br>2. 同时 `grep -rn "dsh-plugin-fs-mutate"` 同一路径 |
| 期望 | 前者命中 `- name: 'harmony-plugin-fs-mutate'`；后者**零命中** |
| 证据 | grep 输出 |
| 备注 | 这是 AC-6 的直接证据；产物是运行时真正被读取的东西 |

### TC-B5 —— 插件源码差异仅限包名令牌

| 项 | 内容 |
|---|---|
| 目的 | 落实 FR-6（纯迁移，行为零变更）与 FR-1.2（零残留） |
| 前置 | 旧目录已删除；旧副本已固化在 `logs/20260917-1/evidence/pre-migration-dsh-plugin-fs-mutate/`（其 `lib/{sandbox,delete,move}.js` md5 与迁移前记录的基线一致，故可证为迁移前真实状态） |
| 步骤 | 1. `cp -r logs/20260917-1/evidence/pre-migration-dsh-plugin-fs-mutate /tmp/norm`<br>2. `find /tmp/norm -type f -exec sed -i 's/dsh-plugin-fs-mutate/harmony-plugin-fs-mutate/g' {} +`<br>3. `diff -r /tmp/norm plugins/harmony-plugin-fs-mutate`<br>4. 交叉校验：`diff -r <原始副本> plugins/harmony-plugin-fs-mutate \| grep -c "^[<>]"` 应为 24<br>5. `grep -rn "dsh-plugin-fs-mutate" plugins/` |
| 期望 | 步骤 3 **无输出**（归一化后完全一致）；步骤 4 == 24（12 行 `-` + 12 行 `+`）；步骤 5 **零命中** |
| 证据 | `diff -r` 输出（空）+ 行数计数 + grep 结果 |
| 失败含义 | 步骤 3 有任何输出 → 存在**非包名**的改动混入，行为可能已变（比计数更早、更确定地暴露问题） |
| 判据变更记录 | 原判据为「`lib/{sandbox,delete,move}.js` md5 逐字节一致」（开发阶段被证伪，见 spec.md FR-6.1）；改为「差异行数 == 12」后，评审指出**计数单独不充分**（12 处行为改动同样产生 12 行差异），故定稿为**归一化后 `diff -r` 为空**（充分、可机械化），计数降级为交叉校验 |

### TC-B6 —— 全工程旧名零残留

| 项 | 内容 |
|---|---|
| 目的 | 落实 AC-2 |
| 步骤 | `grep -rn "dsh-plugin-fs-mutate" .`（排除 `dsh-dist/`、`node_modules/`、`oh_modules/`、`**/build/`、`.git/`） |
| 期望 | 零命中 |
| 证据 | grep 输出为空 |
| 说明 | 构建产物目录（`dsh-dist/`、`electron/build/`）**刻意排除**：它们是可再生中间物 |

### TC-B7 —— HAP 构建与签名断言通过

| 项 | 内容 |
|---|---|
| 目的 | 确认改动不破坏打包链路 |
| 步骤 | `powershell -ExecutionPolicy Bypass -File "scripts/build-hap.ps1" -BuildMode debug -SignMode debug -JbrHome "<..>" -NodeHome "<..>" -Hvigorw "<..>" -SdkHome "<..>"` |
| 期望 | 退出码 0；产物 `electron/build/default/outputs/default/electron-default-signed.hap` 生成；`build-hap.ps1` 内置的签名断言（profile type == 请求的 SignMode）通过 |
| 证据 | 构建尾部输出 + 产物大小 |

---

## 2. 真机用例（`--inspect`）

### TC-D1 —— 启动日志出现新名复制记录

| 项 | 内容 |
|---|---|
| 目的 | 验证运行期镜像逻辑以新名工作（AC-7） |
| 前置 | 新 HAP 已安装；设备 `$DSH_HOME/dsh-dist` 已删除以强制解压新 tar；应用已重启 |
| 步骤 | `hdc shell "hilog -x \| grep dsh-harmony \| tail -40"` |
| 期望 | 出现 `[dsh-harmony] 已复制 harmony-plugin-fs-mutate → profiles/node_modules` |
| 证据 | hilog 片段 |
| 失败含义 | 通配或产物名不一致 → 该行不出现 |

### TC-D2 —— `profiles/node_modules` 只有新名、无旧名

| 项 | 内容 |
|---|---|
| 目的 | 验证 FR-4 陈旧清理生效（AC-8） |
| 步骤 | 通过 CDP 读 `$DSH_HOME/profiles/node_modules/` 目录清单 |
| 期望 | 含 `harmony-plugin-fs-mutate`；**不含** `dsh-plugin-fs-mutate` |
| 证据 | 目录清单 JSON |
| 备注 | 本用例**必须在"曾运行过旧版的设备"上执行**才有意义——若设备从未跑过旧版，旧名本就不存在，用例退化为 TC-B2 的设备端等价物 |

### TC-D3 —— 新建会话成功

| 项 | 内容 |
|---|---|
| 目的 | 验证 preset 行可解析（AC-9）—— 这是改名是否真的闭合的**判定性**用例 |
| 步骤 | 1. CDP 触发新建会话（或读取 `session.create` 的返回值/console）<br>2. 读 console 错误 |
| 期望 | 会话创建成功；console **无** `agent-preset/invalid`；无 `row "fs-mutate" names a plugin that cannot be resolved` |
| 证据 | console 输出（期望 `[]` 或空）+ 新会话出现 |
| 失败含义 | 5 个身份落点有漏改，或设备旧 `dsh-dist` 未删导致旧行被保留 |

### TC-D4 —— `delete` 工具真实删除文件

| 项 | 内容 |
|---|---|
| 目的 | 验证插件在设备上确实被挂载并生效（AC-10） |
| 前置 | TC-D3 通过 |
| 步骤 | 1. CDP 在工作区创建探针文件 `/data/storage/el2/base/files/aaa/dsh_delete_probe.txt`<br>2. 通过 composer 发消息：请用 `delete` 工具删除该路径并原样贴出工具返回<br>3. 等模型答完，读对话文本 + 读文件系统 |
| 期望 | 工具返回 `Deleted 1 path:` + `- <path> (file)`；文件系统确认该文件**已不存在**；工作区内删除**不触发审批** |
| 证据 | 对话文本片段 + `existsSync` 结果 + 目录清单 |
| 失败含义 | 插件未挂载（工具不存在）或 `ctx.fs.remove` 不可用（补丁未生效） |

### TC-D5 —— `move` 工具真实移动文件

| 项 | 内容 |
|---|---|
| 目的 | 验证 `move`（copy + 受围栏 remove）在设备上生效，且文本迁移路径正确（AC-10） |
| 前置 | TC-D4 通过 |
| 步骤 | 1. CDP 创建 `/data/storage/el2/base/files/aaa/dsh_move_src.txt`，内容已知<br>2. 发消息：请用 `move` 工具把它移到 `/data/storage/el2/base/files/aaa/dsh_move_dst.txt`，并原样贴出返回<br>3. 读对话 + 读文件系统 |
| 期望 | 工具返回 `Moved "<from>" to "<to>".`；源**不存在**、目标**存在**且内容与源一致 |
| 证据 | 对话片段 + 两个路径的存在性与内容 |
| 失败含义 | `move` 的 copy 或 remove 环节在设备上失败 |

### TC-D6 —— 插件配置项未被改名破坏

| 项 | 内容 |
|---|---|
| 目的 | 验证 `Config.maxTransferBytes` 仍被 preset 行正确传递（改名后配置仍生效） |
| 步骤 | 读 CDP 中该插件已解析的配置（或通过一次超限 `move` 观察 `FS_TOO_LARGE`） |
| 期望 | `maxTransferBytes` == `10485760`（默认值，preset 行未显式传 config） |
| 证据 | 配置值输出 |
| 优先级 | 低（改名不影响 `config` 传递路径，本项为防御性） |

---

## 3. 回归用例

### TC-R1 —— 列目录（`view`）能力未退化

| 项 | 内容 |
|---|---|
| 目的 | 确认 `tool-str-replace-editor` 行（同属 `HARMONY_ENSURED_PRESET_ROWS`，与本次改动同表）未被牵连（AC-11） |
| 步骤 | 发消息请模型用 `str_replace_editor` 的 `view` 列出一个目录并贴回结果 |
| 期望 | 返回该目录的 2 层清单，非报错 |
| 证据 | 对话片段 |
| 风险说明 | 本次改动**触碰了同一张表的相邻条目**，必须回归 |

### TC-R2 —— `skill` 工具未退化

| 项 | 内容 |
|---|---|
| 目的 | 确认 `DSH_BUNDLED_SKILL_DIR` 链路与 preset 挂载未被牵连（AC-11） |
| 步骤 | 发消息请模型调用 `skill` 工具列出可用技能 |
| 期望 | 返回 `skills/` 下的技能清单（含 `harmony-runtime-capabilities`），非空、非报错 |
| 证据 | 对话片段 |

### TC-R3 —— 插件市场未被牵连

| 项 | 内容 |
|---|---|
| 目的 | 确认 `dshmarket` 的物化与镜像未受本次改动影响（FR-4.3 的实证） |
| 步骤 | 1. 启动日志中 `dshmarket` 相关行仍在<br>2. CDP 读 `profiles/node_modules/dshmarket` 是否存在<br>3. 设置页「插件市场」入口可见 |
| 期望 | 三项均正常 |
| 证据 | 日志 + 目录存在性 + UI 文本 |

---

## 4. 用例与验收标准对照

| 验收标准 | 覆盖用例 |
|---|---|
| AC-1 插件目录 7 文件 | TC-B5（+ 迁移后 `find` 列举） |
| AC-2 旧名零残留 | TC-B6 |
| AC-3 旧目录已删 | 迁移步骤 + `ls` |
| AC-4 两处 preset 行一致 | TC-B3 |
| AC-5 `dsh-dist` 含新名不含旧名 | TC-B1, TC-B2 |
| AC-6 烘焙 preset 为新名 | TC-B4 |
| AC-7 日志新名复制行 | TC-D1 |
| AC-8 无旧名残留 | TC-D2 |
| AC-9 新建会话成功 | TC-D3 |
| AC-10 `delete`/`move` 真实生效 | TC-D4, TC-D5 |
| AC-11 既有能力不退化 | TC-R1, TC-R2, TC-R3 |
| AC-12 文档就位 | 人工阅读（spec/plan 已列清单） |
| AC-13 源码差异仅限 12 行包名令牌 | TC-B5 |
