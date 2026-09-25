# 301-skill-runtime-capabilities 测试用例

> 模块：301-skill-runtime-capabilities
> 对应规格：[specs/301-skill-runtime-capabilities/spec.md](./spec.md)
> 对应方案：[specs/301-skill-runtime-capabilities/plan.md](./plan.md)
> Last Updated: 2026-09-18

## 0. 测试环境与前置

| 项 | 值 |
|---|---|
| 目标设备 | `3QC0226526001227` |
| 系统 | HarmonyOS 6.1.0.135（API 24） |
| 应用包名 | `org.fellow99.dsh.DshDesktop` |
| `hdc` | `D:/oh-workspace/command-line-tools/sdk/default/openharmony/toolchains/hdc.exe` |
| 构建前置 | `DEVECO_SDK_HOME=d:\oh-workspace\command-line-tools\sdk\`；`export MSYS_NO_PATHCONV=1` |
| 工作区 | `/data/storage/el2/base/files/aaa` |
| 用户家目录 | `/storage/Users/currentUser`（hmdfs） |
| 设备侧 `$DSH_HOME` | `<userData>/.dsh`（即 `/data/storage/el2/base/files/.dsh`） |
| 调试通道 | `hdc fport tcp:19229 tcp:9229` → CDP `Runtime.evaluate`（主进程 `--inspect`） |
| 关键坑 | `--inspect` 的 `Runtime.evaluate` 必须带 `includeCommandLineAPI: true`，否则 `require` 未定义；用 `require` 而非 `import()`（E.6 `:505`） |
| 文本输入 | composer 是 `contenteditable` 富文本编辑器且由 React 受控，必须用 `wc.debugger.attach('1.3')` + `Input.insertText`，不能赋值 `value` / `innerText`（E.6 `:505`） |
| 可复用脚本 | `cdp.mjs` / `cdp2.mjs`（可调超时）、`dsh-send.mjs`；探针 `expr-*.js` / `probe-*.js`（E.4 `:451`、E.7 `:612`、E.9 `:754`） |

> 当前 `--inspect` 由 `CommandLineAdapter` 的 overlay 按 **debug 构建**门控（E.9 `:693-705`）。非 debug 构建下该通道不存在，相关真机用例改以 `hilog` 与 `uitest` 观测。
> 本组用例的首要目的：让每条能力结论**可核验**，而不是只在文档里自洽。凡是只在文档陈述、未在设备上跑过的，用例里明确写"未验证"。

代表性 CDP 表达式（经主进程 inspector 读渲染进程可见文本，用于核验 UI 与对话内容，机制见 E.6 `:504`）：

```js
// 读第一个窗口的可见文本
(async () => { const { BrowserWindow } = require('electron'); return await BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('document.body.innerText'); })()
```

> 发消息/填 composer 不能用上面的表达式赋值，须用 `Input.insertText`（见上表"文本输入"）。探针脚本可直接复用 E 节列出的 `expr-*.js` / `probe-*.js`。

---

## 1. 构建期用例

### TC-B1 能力矩阵完备性

| 项 | 内容 |
|---|---|
| 目的 | 核验 `spec.md` 的 FR-1 至 FR-8 覆盖能力清单 A.2 主表全部 35 行（编号 1-27、28a-28d、29-32）（AC-1） |
| 前置 | 已读取 `docs/鸿蒙环境能力清单-v0.1.5.md` A.2（`:25-61`） |
| 步骤 | 1. 从 A.2 逐行提取"能力"文本，共 35 条<br>2. 在 `spec.md` 的 FR 表逐条检索对应行<br>3. 检查每行第四列含状态、根因层、是否可修 · 说明 |
| 期望 | 35 条全部命中；无 A.2 之外的新能力；每行四列齐备 |
| 证据 | 逐行对照表（命中 / 未命中） |
| 失败含义 | 能力矩阵不完整，规范源不可作为权威 |

### TC-B2 零禁用旧名与无路线图章节

| 项 | 内容 |
|---|---|
| 目的 | 核验三个文件不含已废弃旧名，且本规范不含路线图 / 待办 / roadmap 章节（AC-21） |
| 步骤 | 1. `grep -rnE "dsh-plugin-.?fs-mutate" specs/301-skill-runtime-capabilities/`（正则中的 `.?` 是可选中转字符，用于匹配已废弃旧名而不在检查脚本里原样写出该名）<br>2. `grep -rniE "路线图\|roadmap\|待办\|TODO\|TBD" specs/301-skill-runtime-capabilities/` |
| 期望 | 步骤 1 **零命中**；步骤 2 **零命中**（"待办工作"仅在明确声明"不在范围"的句子中出现，若出现必须位于 §1.3 / §8.3 的排除语境） |
| 证据 | 两条 grep 输出 |
| 失败含义 | 引入了已废弃命名或路线图，违反本规范定位 |

### TC-B3 未验证项标注

| 项 | 内容 |
|---|---|
| 目的 | 核验所有未在真机验证的结论均显式标注"未验证"（AC-23） |
| 步骤 | 1. `grep -n "未验证" specs/301-skill-runtime-capabilities/*.md`<br>2. 对照清单：后台常驻获批状态、托盘缓冲区来源、`ralph` 单独调用、`executableBinaryPaths` 落地、PTY 真机调用 |
| 期望 | 五项均在正文有"未验证"标注，且与能力清单 A / E 节的措辞一致 |
| 证据 | grep 输出 + 逐项对照 |
| 失败含义 | 把未验证结论当成已验证陈述，违背来源区分 |

### TC-B4 技能随 HAP 分发

| 项 | 内容 |
|---|---|
| 目的 | 核验 `skills/harmony-runtime-capabilities/SKILL.md` 经构建进入 resfile 的技能根（AC-2 的构建侧前提） |
| 前置 | 已运行 `node scripts/collect-runtime.mjs` |
| 步骤 | 1. 检查 `web_engine/src/main/resources/resfile/resources/app/skills/harmony-runtime-capabilities/SKILL.md` 是否存在<br>2. 检查 `APP_KEEP` 含 `skills`（跨 re-run 保留） |
| 期望 | 文件存在；内容与源 `skills/` 下一致（技能在 `dsh-dist.tar.gz` 之外，换 HAP 即可更新） |
| 证据 | 文件存在性 + `md5` 对比 |
| 失败含义 | 技能未随 HAP 分发，设备上 `skill` 工具将无内置技能可加载 |

### TC-B5 后台常驻声明进包

| 项 | 内容 |
|---|---|
| 目的 | 核验 K1 的声明与代码确证在安装包内（AC-15 的构建侧） |
| 步骤 | 1. 解包 HAP，断言 `module.json` 含 `"backgroundModes":["taskKeeping"]` 与 `ohos.permission.KEEP_BACKGROUND_RUNNING`<br>2. 断言编译产物 `modules.abc` 含 `TASK_KEEPING` |
| 期望 | 两项声明均在；`modules.abc` 命中 `TASK_KEEPING`（E.8 `:651`） |
| 证据 | 解包后的 `module.json` 片段 + `modules.abc` grep |
| 失败含义 | 后台常驻未进包，运行期无从申请 |

### TC-B6 HNP 嵌入并验签

| 项 | 内容 |
|---|---|
| 目的 | 核验 HNP 通路（AC-17 的构建侧） |
| 前置 | `scripts/inject-hnp.ps1` 可用；`electron/hnp-src/` 载荷存在 |
| 步骤 | 1. 运行 `scripts/inject-hnp.ps1`<br>2. 断言产物 `electron-default-signed-hnp.hap` 内含 `hnp/arm64-v8a/dshprobe.hnp`<br>3. `hap-sign-tool verify-app` 复核 |
| 期望 | 含 hnp 目录；`verify-app` 通过（codesign + digest 均成功）（E.10 `:902`） |
| 证据 | 打包产物清单 + `verify-app` 输出 |
| 备注 | hvigor 自身产不出 HNP（其 `PackingToolOptions` 无 `addHnpPath`），必须在**签名前**由 `app_packing_tool --hnp-path` 嵌入再重签（E.10 `:886-898`） |

### TC-B7 补丁链幂等判据（能力前提）

| 项 | 内容 |
|---|---|
| 目的 | 核验规范所声明能力所依赖的 13 个补丁处于可重复应用状态（AC-1 的前提） |
| 步骤 | 1. 对构建列表里每一个补丁跑 `git apply --reverse --check`<br>2. 对新补丁做一次"反向 apply → 正向 apply"往返 |
| 期望 | 13/13 返回 0；受影响文件 SHA256 完全还原（纯 LF）（C.6 `:195`、E.8 `:624`） |
| 证据 | 逐补丁退出码 + SHA256 对比 |
| 失败含义 | 补丁链漂移，`remove` / `writeBytes` / `chmod` 等原语可能不在产物中 |

### TC-B8 规范源与技能一致性

| 项 | 内容 |
|---|---|
| 目的 | 核验技能正文是本规范的运行期摘要且无冲突（AC-20） |
| 步骤 | 1. 从 `spec.md` 的 FR-1 至 FR-8 提取能力项<br>2. 与 `SKILL.md` 的"Available capabilities"表及正文限制逐条比对<br>3. 检查技能正文未声称规范中为 ❌ / ⚠️ 的能力"可用"，反之亦然 |
| 期望 | 无冲突；技能正文为浓缩表述，不引入规范之外的新结论 |
| 证据 | 逐条对照 |
| 失败含义 | 技能与规范脱节，模型将据过期信息行动（历史案例见工程根 `README.md:169` 技能告警段与提交 `c9ad23e`） |

---

## 2. 真机用例（`--inspect` / `hilog` / `uitest`）

### TC-D1 技能端到端加载

| 项 | 内容 |
|---|---|
| 目的 | 核验 `DSH_BUNDLED_SKILL_DIR` 生效且 `skill` 工具按名加载内置技能（AC-2） |
| 前置 | 新 HAP 已安装；应用已启动；`--inspect` 已连通 |
| 步骤 | 1. `hdc shell "hilog -x \| grep dsh-harmony \| tail -20"`，确认 `DSH_BUNDLED_SKILL_DIR = …/resfile/resources/app/skills`<br>2. 经 CDP 发消息请模型调用 `skill` 工具加载 `harmony-runtime-capabilities`<br>3. 读回正文首段与技能基目录 |
| 期望 | 日志含 `DSH_BUNDLED_SKILL_DIR`；技能返回正文首段并报出基目录 `…/app/skills/harmony-runtime-capabilities`（E.3 `:345`、`:365`） |
| 证据 | hilog 片段 + 对话文本 |
| 失败含义 | 技能根未配置或未被发现，模型看不到内置技能目录 |

### TC-D2 列目录（`view`）

| 项 | 内容 |
|---|---|
| 目的 | 核验 `str_replace_editor` 的 `view` 对目录返回清单（AC-3） |
| 步骤 | 经 CDP 发消息请模型用 `str_replace_editor` 的 `view` 列出一个工作区目录并贴回结果 |
| 期望 | 返回"up to 2 levels deep … excluding hidden items, node_modules, and Python cache directories"的清单（E.3 `:355-363`） |
| 证据 | 对话文本片段 |
| 失败含义 | `tool-str-replace-editor` preset 行失效，本壳无 `ls` 时列目录能力缺失 |

### TC-D3 `glob` 只返回文件

| 项 | 内容 |
|---|---|
| 目的 | 核验 `glob` 的发现语义（AC-4） |
| 前置 | 工作区存在 fixture：`aaa/t2_img/{clean.png,deep16.png,iccp.png}` |
| 步骤 | 经 CDP 请模型用 `glob` 搜索 `aaa/t2_img/*.png` |
| 期望 | 只返回 3 个文件、不含目录；汇总句含 `Found 3 files (files searched: 12).`（E.7 `:592-602`） |
| 证据 | 对话文本片段 |
| 失败含义 | `glob` 被误用为列目录（C.3 明确 `glob` 从不返回目录） |

### TC-D4 `grep` 的 `include` 过滤与隐藏目录跳过

| 项 | 内容 |
|---|---|
| 目的 | 核验纯 JS 内容搜索的语义（AC-4） |
| 前置 | fixture 树 `aaa/t1_search/`，在 `.hidden/` 与 `node_modules/` 下各放一个含同一模式的文件 |
| 步骤 | 1. 搜 `NEEDLE_T1_ALPHA`<br>2. 同 pattern + `include: *.txt`<br>3. `ALSO_NEEDLE_T1_BETA` + `include: *.log` |
| 期望 | 第 1 次只返回 `alpha.txt` 与 `nested/deeper/gamma.log`，不返回隐藏目录内文件；第 2 次仅 1 条；第 3 次 0 命中（E.5 `:480-496`） |
| 证据 | 三次工具返回文本 |
| 失败含义 | `grep` 走了 ripgrep 二进制（不可执行）或未正确跳过 `.hidden` / `node_modules` |

### TC-D5 工作区内写入与覆盖

| 项 | 内容 |
|---|---|
| 目的 | 核验工作区内 `read` / `write` / `edit` 与覆盖（AC-5） |
| 步骤 | 1. 请模型用 `write` 在工作区创建 `dsh_cap_test.txt`<br>2. 用 `read` 读回<br>3. 用 `edit` / `write` 覆盖同一文件 |
| 期望 | 三次均成功；覆盖不报错（覆盖走 `rename()`，hmdfs 也支持）（E.1 `:310`、E.3 `:361`、C.3 `:141`） |
| 证据 | 对话文本 + 文件系统读回 |
| 失败含义 | 工作区写入链路退化，全部文件能力受影响 |

### TC-D6 工作区外写入 fail-closed

| 项 | 内容 |
|---|---|
| 目的 | 核验围栏拒绝且拒绝发生在审批之前（AC-6、AC-19） |
| 前置 | 工作区外某路径未在可写根白名单内 |
| 步骤 | 1. 请模型用 `write` 写一个工作区外路径（不使用 `sandbox_permissions`）<br>2. 读回工具错误 |
| 期望 | 返回 `file access denied under workspace-write mode`，并附 `escalation available … sandbox_permissions … + justification` 提示；**此时尚未出现审批请求**（E.3 `:369-375`、C.4 `:169`） |
| 证据 | 工具返回全文 |
| 失败含义 | 围栏被绕过（例如为问用户而跳过检查），或为静默放行 |

### TC-D7 审批面板与拒绝文案

| 项 | 内容 |
|---|---|
| 目的 | 核验审批链路 UI 与拒绝语义（AC-19） |
| 前置 | TC-D6 已产生提权提示 |
| 步骤 | 1. 请模型按提示带 `sandbox_permissions` + `justification` 重试一次<br>2. `hdc shell uitest dumpLayout -p /data/local/tmp/layout.json` + `hdc file recv`<br>3. 在该面板上选择"拒绝"<br>4. 读回工具错误 |
| 期望 | dump 中出现带理由与 `[拒绝]` / `[允许一次]` 的"等待审批"面板；agent 阻塞；拒绝后返回 `the user rejected escalating this operation to "danger-full-access"`（E.3 `:375`、C.4 `:170`） |
| 证据 | `layout.json` 文本 + 工具返回 |
| 失败含义 | 审批面板未渲染或拒绝语义未回传，提权链路不可用 |
| 备注 | `uitest uiInput text` / `keyEvent` 无法注入 Web 内容，此处只用 `dumpLayout` 读取（E.6 `:502`） |

### TC-D8 用户目录直写与反向对照

| 项 | 内容 |
|---|---|
| 目的 | 核验 `DSH_EXTRA_WRITABLE_ROOTS` 是加白而非拆围栏，且写入无审批（AC-7、AC-19） |
| 前置 | 启动日志含三项用户目录均可达 |
| 步骤 | 1. `hdc shell "hilog -x \| grep dsh-harmony \| grep DSH_EXTRA_WRITABLE_ROOTS"`<br>2. 请模型用 `write` 一次写入 `/storage/Users/currentUser/Documents/dsh_e2_probe.txt`（不使用 `sandbox_permissions`）<br>3. 读回内容；检查会话内是否出现拒绝标记<br>4. 反向：写一个**未授权**的工作区外路径 |
| 期望 | 日志列出三项且"启动时可达"；步骤 2 成功、读回 `E2_OK_TIER1`；会话内 `[sandbox:` / `escalation available` / `rejected escalating` / `file access denied` 四项均为 false；步骤 4 仍被 `file access denied under workspace-write mode` 拒绝（E.5 `:457-468`） |
| 证据 | hilog 片段 + 文件内容 + 四项布尔检查 + 反向拒绝文本 |
| 失败含义 | 可写根被误当作拆围栏，或用户目录直写仍需逐次审批 |

### TC-D9 `delete` 真实删除

| 项 | 内容 |
|---|---|
| 目的 | 核验 `delete`（`remove` seam 原语 + 插件）在设备上生效（AC-8） |
| 前置 | TC-D5 通过 |
| 步骤 | 1. 经 CDP 在工作区创建 `dsh_delete_probe.txt`<br>2. 请模型用 `delete` 删除该路径并原样贴出返回<br>3. 读文件系统 |
| 期望 | 返回 `Deleted 1 path:` + `- <path> (file)`；文件**已不存在**；工作区内删除不触发审批（`SKILL.md:49-51`、C.3 `:123`） |
| 证据 | 对话片段 + `existsSync` 结果 |
| 失败含义 | `ctx.fs.remove` 未进产物或插件未挂载 |

### TC-D10 `move` 二进制按字节搬运

| 项 | 内容 |
|---|---|
| 目的 | 核验 `move` 对二进制按字节保真（AC-8） |
| 前置 | fixture 文件含 `0x00 / 0xFF / 0xFE / 0x80` 共 10 字节，记录其 sha256 |
| 步骤 | 1. 请模型用 `move` 把 `t1_binary.bin` 移到 `t1_binary_moved.bin`<br>2. 读回目标内容与 sha256 |
| 期望 | 返回 `Moved "<from>" to "<to>".`；源不存在、目标存在；sha256 与源一致（E.5 `:470-478`） |
| 证据 | 对话片段 + sha256 |
| 失败含义 | `writeBytes` 未进产物，`move` 退化为文本搬运 |

### TC-D11 `copy` 的多条契约

| 项 | 内容 |
|---|---|
| 目的 | 核验 `copy` 的按字节保真、递归、不覆盖（AC-8） |
| 前置 | 工作区 fixture：`src.bin`（含 `0x00/0xFF/0xFE/0x80`）、目录树 `tree/{inner.txt,deep/deeper.txt}`、已存在的 `existing.bin` |
| 步骤 | 1. 用 `copy` 复制 `src.bin` 为 `copied.bin`<br>2. 用 `copy` 递归复制 `tree` 为 `tree_out`（`recursive: true`）<br>3. 用 `copy` 把 `src.bin` 复制到**已存在的** `existing.bin`<br>4. 读回 sha256 与存在性 |
| 期望 | 步骤 1/2 成功（`Copied "<from>" to "<to>".`、`Copied directory "…" to "…" (N files).`）；`copied.bin` sha256 等于 `src.bin`；`tree_out` 两层齐全；步骤 3 **失败**且 `existing.bin` sha256 未变（E.8 `:630-643`） |
| 证据 | 对话片段 + 三处 sha256 + 目录清单 |
| 失败含义 | 规划器分歧或 `writeBytes` 缺失；不覆盖契约被破坏 |

### TC-D12 `chmod` 在两文件系统上的行为

| 项 | 内容 |
|---|---|
| 目的 | 核验 `chmod` 在 hmfs 落实、在 hmdfs 如实报错（AC-9） |
| 前置 | TC-D11 通过 |
| 步骤 | 1. 用 `chmod` 把 `copied.bin` 设为 `"640"`<br>2. 用 `chmod` 把 `/storage/Users/currentUser/Documents/<某文件>` 设为 `"640"`<br>3. 读回两处实际 mode |
| 期望 | 第 1 次返回 `Set mode 0640 on "<path>".` 且回读 `640`；第 2 次**失败**，错误含 `the filesystem kept mode 660 instead of 640`，文件实际 mode 未变（E.8 `:633-644`） |
| 证据 | 对话片段 + 两处 mode 读回 |
| 失败含义 | 回读校验被绕过，hmdfs 的静默忽略被伪装成成功（本用例要拦的主要回归） |
| 备注 | 第 2 次的"失败"是**正确行为**：hmdfs 接受调用但不落实请求的 mode（D.2 `:249`） |

### TC-D13 shell / PTY 缺失探针

| 项 | 内容 |
|---|---|
| 目的 | 核验本壳无 shell 工具且 `node-pty` 不可用（AC-10） |
| 步骤 | 1. 检查当前会话工具清单无 `bash` / `pwsh` / `shell`<br>2. `--inspect` 下探测 `require('node-pty')` 的行为（预期失败或非 aarch64 产物）<br>3. 官方出处核验 `forkpty` / `openpty` 属 SELinux 受影响清单 |
| 期望 | 工具清单无 shell；`node-pty` 不可加载；官方出处成立（E.4 `:422-430`、D.1 `:230`） |
| 证据 | 工具清单 + 探测异常 + 官方出处 |
| 备注 | ⚠️ **未在真机直接调用 PTY API**（平台无应用级 API）；结论依据官方清单与运行时符号缺失（E.2 `:328`） |

### TC-D14 `job_*` 为只读空壳

| 项 | 内容 |
|---|---|
| 目的 | 核验"能查询、无启动者"（AC-10） |
| 步骤 | 1. 检查 `job_list` / `job_output` / `job_kill` 可用<br>2. 检查工具清单中无任何能启动后台任务的工具 |
| 期望 | 查询类工具存在；无启动者（`tool-bash-persistent` / `persistent-shell` 被禁）（C.3 `:162`） |
| 证据 | 工具清单 + 对话返回 |
| 备注 | 随 T1 恢复（T1 不在本规范范围） |

### TC-D15 会话与编排能力族

| 项 | 内容 |
|---|---|
| 目的 | 核验 `todo_write` / goal 三件套 / `present` / `ask_user_question` / 子 agent 家族（AC-12） |
| 步骤 | 依次请模型调用：`todo_write`、`create_goal` + `get_goal` + `update_goal`、`present`、`ask_user_question`、`subagent_fork` + `send_message` + `interrupt_agent` |
| 期望 | 返回与 E.3 回归一致：`Updated todo list: …`；goal 读回并 revision 递增；`Presented …` 且 UI 渲染卡片；UI 弹结构化提问；`started subagent …` / `message delivered …` / `interrupt requested …`（E.3 `:381-389`） |
| 证据 | 逐项对话片段 + UI 截图 |
| 失败含义 | preset 行被本次无关改动牵连 |

### TC-D16 `workflow` 可跑

| 项 | 内容 |
|---|---|
| 目的 | 核验工作流引擎在设备上真实可跑（AC-12） |
| 步骤 | 请模型调用 `workflow` 跑一个最小工作流 |
| 期望 | 返回 `workflow "…" completed (0 agents).` 与结构化结果（如 `{"ok": true, "marker": "WF_T2_OK"}`）（E.7 `:604`） |
| 证据 | 对话片段 |
| 备注 | `ralph` 与 `workflow` 同 worker-thread 引擎，**未单独调用（未验证）**（`:47`） |

### TC-D17 `read_image` 三路径

| 项 | 内容 |
|---|---|
| 目的 | 核验图片媒体能力的三种路径（AC-13） |
| 前置 | fixture：`clean.png`（8-bit sRGB，直通）、`deep16.png`（16-bit，需转换）、`iccp.png`（带 ICC，需转换） |
| 步骤 | 1. 请模型用 `read_image` 读 `clean.png`<br>2. 读 `deep16.png`<br>3. 在无桥环境（纯 Node，例如 stub 自测）读需转换的图<br>4. 读回模型对图像内容的描述 |
| 期望 | 路径 1 成功且按字节直通（对象 sha256 与源一致、字节数一致）；路径 2 成功（16-bit → 8-bit，如 350 B → 138 B）；路径 3 **如实拒绝**（`code=SHARP_STUB_UNSUPPORTED`，指名边界）；模型能描述图像内容（E.9 `:711-733`、E.7 `:570-590`） |
| 证据 | 对话片段 + 附件对象 sha256 / 字节数 + 拒绝文本 |
| 失败含义 | 图像桥未接线，或 stub 把不支持边界伪装成成功 |
| 备注 | EXIF 镜像类 2/4/5/7 应被明确拒绝（C.3 `:158`） |

### TC-D18 通用桥两条硬约束

| 项 | 内容 |
|---|---|
| 目的 | 核验 Node ↔ ArkTS 桥的两条硬性约束（AC-18） |
| 前置 | 应用前台；`--inspect` 连通；已有经 `JsBindingUtils.bindFunction` 注册的 ArkTS 函数 |
| 步骤 | 1. 用 `callArkTSAsyncFunction` 调一个 async ArkTS 方法，观察返回值信封 `{type, value}`<br>2. （对照，只在隔离的测试构建上做）用 `callArkTSFunction` 调同一 async 方法，观察主进程是否阻塞<br>3. 在应用挂起（锁屏）状态下调用桥，观察是否阻塞；解锁并回到前台后复测 |
| 期望 | 步骤 1 正常返回标签信封；步骤 2 主进程永久阻塞（需重启应用恢复）；步骤 3 挂起时阻塞、前台恢复（D.2 `:250`、E.9 `:680-682`） |
| 证据 | CDP 返回 + 超时 / 无响应记录 |
| 备注 | 步骤 2 会阻塞主进程，必须在**隔离构建**上执行；不要在日常构建上复现 |

### TC-D19 后台常驻运行期观测

| 项 | 内容 |
|---|---|
| 目的 | 核验后台常驻的声明与代码已进包；获批状态如实记录为未验证（AC-15） |
| 步骤 | 1. 在设备上确认 HAP 的 `module.json` 含 `backgroundModes` 与 `KEEP_BACKGROUND_RUNNING`<br>2. 尝试最小化窗口 / Home / 电源键，观察是否触发 `onBackground` 与通知栏长时任务通知 |
| 期望 | 步骤 1 成立；步骤 2 在无头环境下未触发（2in1 多窗口桌面），通知栏无长时任务通知，结论标注**未验证**（E.8 `:653`） |
| 证据 | `module.json` 片段 + hilog / 截图 |
| 失败含义 | 把"已进包"当成"已获批"，混淆声明与运行期效果 |

### TC-D20 托盘接线结果

| 项 | 内容 |
|---|---|
| 目的 | 核验托盘接线结果如实记录（AC-16） |
| 前置 | 含 `TrayAdapter` 的构建已装机 |
| 步骤 | 1. `hdc shell "hilog -x \| grep -E 'TrayAdapter\|statusbar' \| tail -40"`<br>2. 截三态图：窗口前台 / 最小化 / 点开 `^` 溢出面板<br>3. （设备可用时）运行 `scripts/probes/tray-scan.js <ws-url>` 扫参数矩阵并回读 PixelMap 真实尺寸 |
| 期望 | 日志含 `tray installed, menu items: 2`、`statusbar addToStatusBar succeed!`、`menuItemCodeToSubMenItemsMap: 2`；**三态截图托盘区均无图标**；`pixelmap exceeds the limit` 不能被解释为尺寸限制（4×4 同样报错）；缓冲区来源实验标注**未验证**（E.10 `:806-882`） |
| 证据 | hilog 片段 + 三张截图 + 回读值 |
| 失败含义 | 把框架"接受"当成"已渲染"，或据未装机改动判定托盘可用 |

### TC-D21 HNP 裸命令名执行

| 项 | 内容 |
|---|---|
| 目的 | 核验 HNP 端到端（AC-17） |
| 前置 | `inject-hnp.ps1` 产物已装机 |
| 步骤 | 1. 经 `--inspect` 读 `HNP_PUBLIC_HOME` 与 `/data/service/hnp/bin` 清单<br>2. 以裸命令名 `dsh-probe` 调用 |
| 期望 | `HNP_PUBLIC_HOME=/data/service/hnp`；`/data/service/hnp/bin` 含 `dsh-probe`；裸命令名调用输出 `DSH_HNP_PROBE_OK` 等（E.10 `:904-918`） |
| 证据 | 目录清单 + 调用 stdout |
| 失败含义 | HNP 未真正嵌入或软链接未建立 |

### TC-D22 网络能力边界

| 项 | 内容 |
|---|---|
| 目的 | 核验 `web_search` / `web_fetch` 可用且只读，无外部上传能力（AC-11） |
| 步骤 | 1. 请模型用 `web_fetch` 抓一个 URL（GET）<br>2. 检查工具清单无上传 / POST 类工具 |
| 期望 | `web_fetch` GET 成功；无上传工具；工具说明为只读（`SKILL.md:42`、A.2 #16/#17 `:42-43`） |
| 证据 | 对话片段 + 工具清单 |
| 失败含义 | 误判网络能力可写，或存在未记录的发送工具 |

---

## 3. 来源核验用例（官方出处 / 源码清点）

### TC-S1 PTY 的官方结论

| 项 | 内容 |
|---|---|
| 目的 | 核验 PTY 不可修（L1）的官方依据（AC-10） |
| 步骤 | 1. 查阅 `guidance-on-ndk-libc-interfaces-affected-by-permissions.md` 中 `forkpty` / `openpty` / `posix_openpt` / `popen` 的条目<br>2. 核对 `libelectron.so` 中 `forkpty` / `openpty` / `posix_spawn` 的符号缺失 |
| 期望 | 官方列为 SELinux 受影响、失败表现为 `EACCES`；运行时不导出这些符号（D.1 `:230`、E.2 `:328`） |
| 证据 | 官方文档条目 + 符号表 |

### TC-S2 缩略图的上游接口缺失

| 项 | 内容 |
|---|---|
| 目的 | 核验"上游无缩略图生成代码"（L4）的源码依据（AC-14） |
| 步骤 | 1. 在 dsh 源码检索 `createThumbnail` 与缩略图相关 API / 路由 / 存储变体<br>2. 核对 `SessionAttachmentRequest` 的类型定义只有 `{sessionId, attachmentId}`<br>3. 核对 `readImageRequest(ref, policy)` 的调用者仅模型请求投影 |
| 期望 | 无缩略图生成代码；请求类型无尺寸 / 变体参数；`readImageRequest` 未暴露给客户端 RPC（C.7 `:199-217`） |
| 证据 | 检索结果 + 类型定义片段 |

### TC-S3 平台集成决策的官方出处

| 项 | 内容 |
|---|---|
| 目的 | 核验无边框 / 更新检查 / 开机自启 / `executableBinaryPaths` / 用户目录授权的结论有官方依据（AC-22） |
| 步骤 | 1. 核对无边框装饰接口（`setWindowDecorVisible` 等）与"无需权限"<br>2. 核对更新检查无静默自更新公开 API 及其前置条件<br>3. 核对 `autoStartupManager` 只有只读接口、无公开 setter<br>4. 核对 `ALLOW_EXTERNAL_NATIVE_CODE` 名称与 ACL 范围、`.permission` 是 ELF 节 |
| 期望 | 四项均与 D.2 第 11-15 条一致；"不可上架"原句的精确范围被正确理解（被禁的是离线 / 调试手法，经 AGC 申请 ACL 是正式路径）（D.2 `:255-286`） |
| 证据 | 官方条目逐项对照 |

### TC-S4 通用桥契约与返回值形状

| 项 | 内容 |
|---|---|
| 目的 | 核验桥契约（标签信封、类型上限、参数上限）与来源一致（AC-18） |
| 步骤 | 1. 核对 `callArkTSFunction` / `callArkTSAsyncFunction` 的返回值形状与 Promise 语义<br>2. 核对支持类型与参数上限（≤3 参）<br>3. 核对桥位于 `libelectron.so`、新增 ArkTS 能力无需改 C/C++ |
| 期望 | 与 D.2 `:250`、`:258` 一致；`StatusBarManagerAdapter.SetImage`（8 参、含 `ArrayBuffer` 与回调）超出桥限制，须加 JSON 薄包装 |
| 证据 | D.2 条目 + 适配器签名 |

### TC-S5 围栏与审批的源码出处

| 项 | 内容 |
|---|---|
| 目的 | 核验安全章节的每条声明有源码依据（AC-19） |
| 步骤 | 1. 核对 `ApprovalService.decide()` 的 waterfall 终结默认值为 `() => Promise.resolve('unavailable')`<br>2. 核对调用方对 `unavailable` 一律拒绝（tools 与 escalation 两处）<br>3. 核对 `ApprovalPanel.tsx` 的注册位置<br>4. 核对 `fs-sandbox` 的 `checkedTarget` 与 `writableRoots()` 的白名单形状 |
| 期望 | 四条均命中：`packages/interaction/user-approval/src/index.ts:274`、`packages/core/tools/src/index.ts:1713-1715`、`packages/sandbox/sandbox/src/escalation.ts:186`、`packages/bundle/web-app/cordis.patch.yml:252-253`、`packages/fs/fs-sandbox/src/index.ts:122-144`、`packages/sandbox/sandbox/src/roots.ts:52-55`（C.4 `:169-172`、E.2 `:321`） |
| 证据 | 逐处源码片段 |

---

## 4. 用例与验收标准对照

| 验收标准 | 覆盖用例 |
|---|---|
| AC-1 能力矩阵覆盖 A.2 全部 35 行 | TC-B1, TC-B7 |
| AC-2 技能随 HAP 分发并被 `skill` 工具加载 | TC-B4, TC-D1 |
| AC-3 列目录（`view`） | TC-D2 |
| AC-4 `grep` / `glob` 纯 JS 语义 | TC-D3, TC-D4 |
| AC-5 工作区内 `read` / `write` / `edit` 与覆盖 | TC-D5 |
| AC-6 工作区外写入 fail-closed | TC-D6 |
| AC-7 用户目录直写与反向对照 | TC-D8 |
| AC-8 `delete` / `move` / `copy` 契约 | TC-D9, TC-D10, TC-D11 |
| AC-9 `chmod` 两文件系统行为 | TC-D12 |
| AC-10 shell / PTY / 进程沙箱缺席，`job_*` 空壳 | TC-D13, TC-D14, TC-S1 |
| AC-11 网络只读 GET，无外部上传 | TC-D22 |
| AC-12 会话与编排能力族 | TC-D15, TC-D16 |
| AC-13 `read_image` 三路径 | TC-D17 |
| AC-14 缩略图上游接口缺失 | TC-S2 |
| AC-15 后台常驻声明进包、获批状态未验证 | TC-B5, TC-D19 |
| AC-16 托盘接线结果如实记录 | TC-D20 |
| AC-17 HNP 端到端 | TC-B6, TC-D21 |
| AC-18 通用桥两条硬约束与契约 | TC-D18, TC-S4 |
| AC-19 安全语义（围栏 / 审批 / 部署期状态） | TC-D6, TC-D7, TC-D8, TC-S5 |
| AC-20 规范源与技能同步 | TC-B8 |
| AC-21 零禁用旧名、无路线图章节 | TC-B2 |
| AC-22 平台集成与分发决策有官方出处 | TC-S3 |
| AC-23 未验证项显式标注 | TC-B3 |
