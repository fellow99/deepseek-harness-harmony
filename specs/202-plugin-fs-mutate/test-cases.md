# 202-plugin-fs-mutate 测试用例

> 模块：202-plugin-fs-mutate
> 对应规格：[specs/202-plugin-fs-mutate/spec.md](./spec.md)
> 对应方案：[specs/202-plugin-fs-mutate/plan.md](./plan.md)
> Last Updated: 2026-09-18

## 0. 测试环境与前置

| 项 | 值 |
|---|---|
| 目标设备 | `3QC0226526001227` |
| 系统 | HarmonyOS 6.1.0.135（API 24） |
| 应用包名 | `org.fellow99.dsh.DshDesktop` |
| `hdc` | `D:/oh-workspace/command-line-tools/sdk/default/openharmony/toolchains/hdc.exe` |
| 构建前置 | `DEVECO_SDK_HOME=d:\oh-workspace\command-line-tools\sdk\`；`export MSYS_NO_PATHCONV=1` |
| 设备侧 `$DSH_HOME` | `<userData>/.dsh`（即 `/data/storage/el2/base/files/.dsh`） |
| 调试通道 | `hdc fport tcp:19229 tcp:9229` → CDP `Runtime.evaluate`（主进程 `--inspect`） |
| 关键坑 | `--inspect` 的 `Runtime.evaluate` 必须带 `includeCommandLineAPI: true`，否则 `require` 未定义；用 `require` 而非 `import()` |

> **本组用例的首要目的**：验证插件在**构建期**与**运行期**两个真实链路上都闭合，而不是只验证源码里字符串写对了。原因：preset 行的 `name` 是**运行时导入说明符**，写错不会在编译期暴露，只会表现为会话创建失败。

---

## 1. 构建期用例

### TC-B1 —— 插件被物化到当前包名

| 项 | 内容 |
|---|---|
| 目的 | 验证 `collectPlugins()` 从本工程 `plugins/` 读取，并按包名落地 |
| 前置 | 插件位于 `dsh-desktop-hos/plugins/harmony-plugin-fs-mutate/` |
| 步骤 | 1. `node scripts/collect-dsh.mjs`<br>2. 检查 `dsh-dist/node_modules/harmony-plugin-fs-mutate/package.json` 是否存在<br>3. 检查该 `package.json` 的 `name` 字段 |
| 期望 | 文件存在；`name` == `"harmony-plugin-fs-mutate"` |
| 证据 | 文件路径 + `name` 字段输出 |
| 失败含义 | 源根/通配改错，或收集静默无操作（脚本不报错但产物缺插件） |

### TC-B2 —— 全工程包名令牌一致性

| 项 | 内容 |
|---|---|
| 目的 | 落实 AC-2：全工程不存在任何非 `harmony-plugin-fs-mutate` 的 `-plugin-fs-mutate` 包名令牌 |
| 步骤 | 1. `grep -rn "plugin-fs-mutate" .`（排除 `dsh-dist/`、`node_modules/`、`oh_modules/`、`**/build/`、`.git/`）<br>2. 逐条检查命中 |
| 期望 | 每一处命中都是 `harmony-plugin-fs-mutate`；**不存在**任何其它 `-plugin-fs-mutate` 包名令牌 |
| 证据 | grep 输出（逐条核对） |
| 失败含义 | 存在漏改的名字令牌 → 目录名 / 包名 / preset 行 / 文档口径不一致，可能在运行期产生不可解析的 preset 行 |
| 说明 | 构建产物目录（`dsh-dist/`、`electron/build/`）**刻意排除**：它们是可再生中间物，由 TC-B4 单独核验 |

### TC-B3 —— 两处 preset 行清单逐条一致

| 项 | 内容 |
|---|---|
| 目的 | 验证 `src-main/main.js` 与 `scripts/collect-dsh.mjs` 的 `HARMONY_ENSURED_PRESET_ROWS` 镜像未失真 |
| 步骤 | 1. 从两文件各提取 `HARMONY_ENSURED_PRESET_ROWS` 条目<br>2. 逐条比对 `id` / `name` / `requireRow` |
| 期望 | 两处逐条相同；`fs-mutate` 行的 `name` == `harmony-plugin-fs-mutate`，`id` 仍为 `fs-mutate` |
| 证据 | 双文件提取结果对照 |
| 失败含义 | 两处不一致 → 构建期烘焙与运行期补丁产生分歧，设备上表现取决于走哪条路径，极难排查 |
| 备注 | 构建期由 `assertPresetRowsMirrorMainJs()` 机械互校并在不等时硬失败；本用例是"理论保证"的实测确认 |

### TC-B4 —— 烘焙进产物的 preset 行是当前包名

| 项 | 内容 |
|---|---|
| 目的 | 验证**产物内**（而非源码内）的 preset 已是 `harmony-plugin-fs-mutate` |
| 步骤 | 1. 构建后 `grep -rn "harmony-plugin-fs-mutate" dsh-dist/node_modules/@deepseek-ai/dsh-agent-presets/presets/`<br>2. 同时 `grep -rn "plugin-fs-mutate"` 同一路径，核对每一处命中都带 `harmony-` 前缀 |
| 期望 | 命中 `- name: 'harmony-plugin-fs-mutate'`；不存在任何其它 `-plugin-fs-mutate` 令牌 |
| 证据 | grep 输出 |
| 备注 | 这是 AC-6 的直接证据；产物是运行时真正被读取的东西 |

### TC-B5 —— HAP 构建与签名断言通过

| 项 | 内容 |
|---|---|
| 目的 | 确认改动不破坏打包链路 |
| 步骤 | `powershell -ExecutionPolicy Bypass -File "scripts/build-hap.ps1" -BuildMode debug -SignMode debug -JbrHome "<..>" -NodeHome "<..>" -Hvigorw "<..>" -SdkHome "<..>"` |
| 期望 | 退出码 0；产物 `electron/build/default/outputs/default/electron-default-signed.hap` 生成；`build-hap.ps1` 内置的签名断言（profile type == 请求的 SignMode）通过 |
| 证据 | 构建尾部输出 + 产物大小 |

---

## 2. 真机用例（`--inspect`）

### TC-D1 —— 启动日志出现复制记录

| 项 | 内容 |
|---|---|
| 目的 | 验证运行期镜像逻辑以 `harmony-plugin-fs-mutate` 工作（AC-7） |
| 前置 | 新 HAP 已安装；设备 `$DSH_HOME/dsh-dist` 已删除以强制解压新 tar；应用已重启 |
| 步骤 | `hdc shell "hilog -x \| grep dsh-harmony \| tail -40"` |
| 期望 | 出现 `[dsh-harmony] 已复制 harmony-plugin-fs-mutate → profiles/node_modules` |
| 证据 | hilog 片段 |
| 失败含义 | 通配或产物名不一致 → 该行不出现 |

### TC-D2 —— `profiles/node_modules` 忠实镜像源集合，无同族陈旧目录

| 项 | 内容 |
|---|---|
| 目的 | 验证 FR-4 陈旧清理生效（AC-8） |
| 步骤 | 通过 CDP 读 `$DSH_HOME/profiles/node_modules/` 目录清单，与 `dsh-dist/node_modules/` 的 `harmony-plugin-*` 集合比对 |
| 期望 | 含 `harmony-plugin-fs-mutate`；`profiles/node_modules/` 中匹配 `dsh-plugin-*` / `harmony-plugin-*` 的目录全部在本次源集合内，**无**同族陈旧残留 |
| 证据 | 目录清单 JSON |
| 备注 | 本用例在"设备上曾存在同族陈旧目录"时最有意义；若从未存在，则退化为一次镜像一致性确认。清理**只在源集合非空时**执行（FR-4.5），源集合为空时既不复制也不清理，这是刻意的安全属性 |

### TC-D3 —— 新建会话成功

| 项 | 内容 |
|---|---|
| 目的 | 验证 preset 行可解析（AC-9）—— 这是插件是否真的挂载成功的**判定性**用例 |
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

### TC-D6 —— 插件配置项生效

| 项 | 内容 |
|---|---|
| 目的 | 验证 `Config.maxTransferBytes` 被 preset 行正确解析并传给插件 |
| 步骤 | 读 CDP 中该插件已解析的配置（或通过一次超限 `move` 观察 `FS_TOO_LARGE`） |
| 期望 | `maxTransferBytes` == `10485760`（默认值，preset 行未显式传 config） |
| 证据 | 配置值输出 |
| 优先级 | 低（`config` 传递路径独立于命名，本项为防御性） |

### TC-D7 —— `copy` 工具真实复制文件与目录

| 项 | 内容 |
|---|---|
| 目的 | 验证 `copy`（受围栏复制、无删除）在设备上生效，且**二进制按字节保真**，并遵守**不覆盖**契约（AC-13） |
| 前置 | TC-D5 通过 |
| 步骤 | 1. CDP 在工作区创建 `.../aaa/r3/src.bin`（10 字节，含 `0x00`/`0xFF`/`0xFE`/`0x80`）、目录树 `.../aaa/r3/tree/{inner.txt,deep/deeper.txt}`、以及一个**已存在**的 `.../aaa/r3/existing.bin`；记下 `src.bin` 与 `existing.bin` 的 sha256<br>2. 发消息：用 `copy` 把 `src.bin` 复制为 `copied.bin`；用 `copy` 把 `tree` 递归复制为 `tree_out`（`recursive: true`）；再用 `copy` 把 `src.bin` 复制到**已存在的** `existing.bin`<br>3. 读对话 + 读文件系统 |
| 期望 | 前两次返回 `Copied "<from>" to "<to>".` 与 `Copied directory "…" to "…" (N files).`；`copied.bin` 的 sha256 **等于** `src.bin`（证明按字节复制）；`tree_out/inner.txt` 与 `tree_out/deep/deeper.txt` 存在且内容一致（证明递归）；第三次**失败**且 `existing.bin` 的内容 sha256 **未被改写**（不覆盖契约成立） |
| 证据 | 对话片段 + 三处 sha256/内容 + 存在性 |
| 失败含义 | `copy` 未注册、`ctx.fs.writeBytes` 缺失（补丁未进产物），或复用 `move` 规划器时引入了行为偏差 |

### TC-D8 —— `chmod` 在两种文件系统上的行为差异

| 项 | 内容 |
|---|---|
| 目的 | 验证 `chmod` 在工作区（`hmfs`）**真实落实**、在用户目录（`hmdfs`）**如实报错**而非静默成功（AC-14） |
| 前置 | TC-D7 通过 |
| 步骤 | 1. 用 `chmod` 把 `.../aaa/r3/copied.bin` 设为 `"640"`<br>2. 用 `chmod` 把 `/storage/Users/currentUser/Documents/<某文件>` 设为 `"640"`<br>3. CDP 读两处的实际 `mode & 0o7777` |
| 期望 | 第 1 次返回 `Set mode 0640 on "<path>".`，且实际模式读回为 `640`；第 2 次**失败**，错误文本含 `the filesystem kept mode <实际> instead of 640`，且该文件实际模式**未变** |
| 证据 | 对话片段 + 两处模式读回值 |
| 失败含义 | `ctx.fs.chmod` 未进产物（`dsh-fs-chmod-primitive.patch` 失效）；若第 2 次**报成功**，则回读校验被绕过——那会把 `hmdfs` 的静默忽略伪装成成功，是本用例要拦的主要回归 |
| 补充 | 第 2 次返回的「失败」是**正确行为**、不是缺陷：`hmdfs` 接受 `chmod` 调用但不落实权限位。该行为已由设备探针独立证实，并记入能力清单 D 节 |

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
| AC-1 插件目录文件齐备（13 个文件） | 目录列举（`find`） |
| AC-2 全工程包名令牌一致性 | TC-B2 |
| AC-3 父工程 `dsh-plugins/` 仅剩 `README.md` | `ls` |
| AC-4 两处 preset 行逐条一致 | TC-B3 |
| AC-5 `dsh-dist` 含 `harmony-plugin-fs-mutate` | TC-B1 |
| AC-6 烘焙 preset 为当前包名 | TC-B4 |
| AC-7 日志出现复制行 | TC-D1 |
| AC-8 `profiles/node_modules` 忠实镜像源集合，无同族陈旧目录 | TC-D2 |
| AC-9 新建会话成功 | TC-D3 |
| AC-10 `delete` / `move` 真实生效 | TC-D4, TC-D5 |
| AC-11 既有能力不退化 | TC-R1, TC-R2, TC-R3 |
| AC-12 两份插件目录 README 与两端 README 约定章节就位 | 人工阅读 |
| AC-13 `copy` 真实生效、二进制保真、不覆盖 | TC-D7 |
| AC-14 `chmod` 工作区落实 / 用户目录如实报错 | TC-D8 |
