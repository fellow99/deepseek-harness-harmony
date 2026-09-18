# 301-skill-runtime-capabilities 技术方案（As-Built）

> 模块：301-skill-runtime-capabilities
> 对应规格：[specs/301-skill-runtime-capabilities/spec.md](./spec.md)
> 对应用例：[specs/301-skill-runtime-capabilities/test-cases.md](./test-cases.md)
> Last Updated: 2026-09-18

> 本模块是**文档模块**，不是代码模块。它的"实现落点"指每项能力在本工程中**实际由什么承载**（dsh 补丁 / 插件 / profile 配置 / agent-preset 行 / 运行期 overlay / 上游包），以便读者从一条能力结论直接走到产生它的那处代码或配置。落点信息全部来自各能力的证据出处（C / D / E 节），本文不新增事实。

## 1. 技术上下文

### 1.1 "运行时环境"

- **规范阅读面**：仓库内纯 Markdown，无构建步骤、无运行时。
- **事实来源**：`docs/鸿蒙环境能力清单-v0.1.5.md`（921 行，权威）与 `skills/harmony-runtime-capabilities/SKILL.md`（138 行，运行期摘要）。
- **被描述的真实运行环境**：HarmonyOS HAP（Electron-on-HarmonyOS，Electron 37 / Node 22.17.0）内的 dsh Host；设备 `3QC0226526001227` / HarmonyOS 6.1.0.135（API 24）（`docs/鸿蒙环境能力清单-v0.1.5.md:14`）。

### 1.2 依赖（事实来源与工具链）

| 依赖 | 来源 | 用途 |
|---|---|---|
| `docs/鸿蒙环境能力清单-v0.1.5.md` | 本工程 `docs/` | 唯一权威：A 能力现状、C 结论与依据、D 平台事实、E 实测记录 |
| `skills/harmony-runtime-capabilities/SKILL.md` | 本工程 `skills/` | 运行期摘要，本规范描述它的派生关系与同步义务 |
| `specs/constitution.md` | 本工程 `specs/` | 文档口径与治理规则（§3.1 / §6） |
| `specs/202-plugin-fs-mutate/` | 本工程 `specs/` | 文件变更工具的当前能力与契约（`delete` / `move` / `copy` / `chmod`） |
| `README.md`（工程根"技能告警"段）+ 提交 `c9ad23e` | 本工程根 | 技能脱节的真实案例（作为反例保留） |

> 本文档不引入新依赖；所有落点路径均引用既有工程文件，不新建代码。

## 2. 宪法合规检查

| 宪法原则（[constitution.md](../constitution.md)） | 状态 | 说明 |
|---|---|---|
| §1.1 零上游改动 | ✅ | 本模块不触碰 dsh 源码与补丁集；只读既有事实，产出文档 |
| §1.3 只写装配代码 | ✅ | 不新造业务逻辑；本模块是纯文档 |
| §3.1 源码即真理 | ✅ | 每条能力带证据出处与行号；未验证项显式标注 |
| §3.2 类型安全 | N/A | 无 ArkTS / TS 代码产出 |
| §3.3 日志规范 | ✅ | 验证策略约定 `hilog \| grep dsh-harmony` 为运行期观测口径 |
| §5.1 幂等构建 | N/A | 无构建步骤；构建期验证是**断言**（只读），不改产物 |
| §5.3 产物适配集中在收集脚本 | N/A | 不涉及产物适配 |
| §6 治理规则（spec/plan 成对） | ✅ | 本模块产出 `spec.md` + `plan.md` + `test-cases.md` |
| §6 治理规则（中文 + 英文术语） | ✅ | 与既有 spec 集口径一致 |

## 3. 能力 ↔ 实现落点映射

**落点类型**：`dsh patch`（本工程补丁）/ `plugin`（本工程插件）/ `profile config`（`profiles/desktop/`）/ `agent-preset row`（运行期或构建期补丁的 preset 行）/ `runtime overlay`（`runtime-overlays/` 覆盖上游运行时的文件）/ `upstream package`（dsh 或 dsh-market 的原生包）。

### 3.1 FR-1 文件读取与发现

| 能力 | 落点类型 | 落点（文件 / 配置） | 证据出处 |
|---|---|---|---|
| 读文件 | upstream package | `@deepseek-ai/dsh-tool-fs` 的 `read` | A.2 #1 `:27` |
| 列目录（`view`） | agent-preset row | `@deepseek-ai/dsh-tool-str-replace-editor`（PURE，`inject: ['tools','fs']`） | A.2 #2 `:28`、C.2/C.3 `:117`、E.3 `:355-363` |
| 内容搜索 `grep` | plugin | `plugins/harmony-plugin-fs-search`（C1 纯 JS，基于 `ctx.fs`） | A.2 #14 `:40`、C.3 `:117`、E.5 `:480-496` |
| 文件发现 `glob` | plugin | `plugins/harmony-plugin-fs-search/lib/glob.js` + `lib/index.js` 注册（无需新增 preset 行） | A.2 #15 `:41`、E.7 `:537`、`:592-602` |

### 3.2 FR-2 文件变更

| 能力 | 落点类型 | 落点（文件 / 配置） | 证据出处 |
|---|---|---|---|
| 新建 / 覆盖工作区内文件 | upstream package | `@deepseek-ai/dsh-tool-fs` 的 `write` / `edit`；覆盖经 `fs-local` 的 `rename()` | A.2 #3/#4 `:29-30`、C.3 `:138`、E.2 `:320` |
| 工作区外写入（审批） | profile config + agent-preset row | `profiles/desktop/cordis.patch.yml:31`（不禁用 `fs-sandbox`）；`approval` 链路 | A.2 #5 `:31`、C.4 `:167-172` |
| 用户目录直写 | dsh patch + profile config | `dsh-fs-hardlink-fallback.patch`（E1）；`dsh-extra-writable-roots.patch` + `DSH_EXTRA_WRITABLE_ROOTS`（E2） | A.2 #6 `:32`、C.3 `:142`、E.5 `:457-468` |
| 删除 `delete` | dsh patch + plugin | `dsh-fs-remove-primitive.patch`（非抽象 `FileSystem.remove` + `fs-local/remove.ts` + `fs-sandbox` 覆写）+ `plugins/harmony-plugin-fs-mutate` 的 `delete` | A.2 #7 `:33`、C.3 `:123` |
| 移动 `move` | dsh patch + plugin | `dsh-fs-write-bytes.patch`（`writeBytes`）+ `harmony-plugin-fs-mutate` 的 `move`（copy-then-remove） | A.2 #8 `:34`、C.3 `:124`、E.5 `:470-478` |
| 复制 `copy` | plugin | `harmony-plugin-fs-mutate` 的 `copy`，与 `move` 共用规划器 `lib/transfer.js`；**无新 seam 原语** | A.2 #9 `:35`、C.3 `:128`、E.8 `:618`、`:630-632` |
| 改权限 `chmod` | dsh patch + plugin | `dsh-fs-chmod-primitive.patch`（第 13 补丁：`types.ts` 的 `FsChmodOutcome`、非抽象 `FileSystem.chmod`、`fs-local/src/chmod.ts` 回读校验、`fs-local` 与 `fs-sandbox` 覆写）+ `harmony-plugin-fs-mutate` 的 `chmod` | A.2 #10 `:36`、C.3 `:129-130`、E.8 `:620`、`:633-634` |
| 文件围栏 `fs-sandbox` | upstream package + profile config | `packages/fs/fs-sandbox/src/index.ts:122-144` 的 `checkedTarget`；`profiles/desktop/cordis.patch.yml:31` | A.2 #25 `:51`、C.4 `:169`、E.2 `:321` |
| 提权审批 `approval` | profile config / bundle | `packages/interaction/user-approval/src/index.ts:274`；`packages/client/ui-approval` 的 `ApprovalPanel.tsx`，注册于 `packages/bundle/web-app/cordis.patch.yml:252-253` | A.2 #26 `:52`、C.4 `:170` |

> `dsh-fs-remove-primitive.patch` / `dsh-fs-write-bytes.patch` / `dsh-fs-chmod-primitive.patch` 的形状一致：**非抽象** `FileSystem` 成员（默认体抛错，不破坏既有六个子类）+ 独立 `fs-local` 实现文件 + `fs-sandbox` 覆写（先走 `checkedTarget`）（C.3 `:123`、`:129`）。补丁链的上下文约束见 §4.6。

### 3.3 FR-3 命令执行与进程

| 能力 | 落点类型 | 落点（文件 / 配置） | 证据出处 |
|---|---|---|---|
| shell / 命令执行 | profile config + agent-preset row | `profiles/desktop/cordis.patch.yml:32-39` 禁用 `subprocess` / `sandbox` / `bash-sandbox` / `permission`；`dsh-web-app/cordis.patch.yml:368-371` 禁用 `tool-bash` / `tool-pwsh`；`src-main/main.js:174-178` 的 `HARMONY_DISABLED_PRESET_ROWS` 摘掉 `tool-bash` / `tool-fs-search` / `persistent-shell` | A.2 #11 `:37`、C.3 `:99-106` |
| PTY / 终端 | upstream package（缺席）+ 平台 | `node-pty` 在 dsh-dist 里是 win32-x64；平台无应用级 pty API | A.2 #12 `:38`、D.1 `:230`、E.2 `:328` |
| 进程沙箱 | upstream package（缺席） | `koffi` win32-x64；`landlock` 在 `libelectron.so` 中无字符串 | A.2 #13 `:39`、C.3 `:108-112` |
| 后台任务 `job_*` | upstream package | `@deepseek-ai/dsh-tool-jobs`（PURE，只管注册表）；缺的是执行后端 | A.2 #22 `:48`、C.3 `:162` |

### 3.4 FR-4 网络

| 能力 | 落点类型 | 落点（文件 / 配置） | 证据出处 |
|---|---|---|---|
| `web_search` / `web_fetch` | upstream package | `@deepseek-ai/dsh-tool-web`（PURE） | A.2 #16 `:42` |
| 上传 / 外部发送 | upstream package（缺席） | 无工具；网络只读且托管 | A.2 #17 `:43` |

### 3.5 FR-5 会话与编排能力

| 能力 | 落点类型 | 落点（文件 / 配置） | 证据出处 |
|---|---|---|---|
| 子 agent 家族 | agent-preset row | `standard` preset 中启用且 PURE，运行期补丁只禁 3 行 | A.2 #18 `:44`、C.3 `:164`、E.3 `:386-388` |
| `todo_write` / goal / `present` / `ask_user_question` | agent-preset row | 同上 | A.2 #19 `:45`、C.3 `:164`、E.3 `:381-389` |
| `skill` | profile config + agent-preset row + runtime 环境变量 | `skill-filesystem` 与 `tool-skill` 在 standard preset 启用（`presets/standard/agent.cordis.yml:84-88`）；`src-main/main.js` 设 `DSH_BUNDLED_SKILL_DIR` | A.2 #20 `:46`、C.3 `:163`、E.3 `:345`、`:365` |
| `workflow` / `ralph` | upstream package + agent-preset row | `dsh-workflow` / `dsh-workflow-worker-thread` / `dsh-tool-workflow` / `dsh-tool-ralph` 均已物化，`workflowEngine: true` | A.2 #21 `:47`、C.3 `:164`、E.7 `:604` |

### 3.6 FR-6 媒体

| 能力 | 落点类型 | 落点（文件 / 配置） | 证据出处 |
|---|---|---|---|
| `read_image`（直通） | upstream package | `tool-fs/src/read-image.ts:210`（PURE）；`attachment-local` 的 `normalizeImage()` 直通分支 | A.2 #23 `:49`、C.3 `:144-149` |
| `read_image`（持久化阻断） | dsh patch | `dsh-attachment-durable-walk-sandbox.patch`（`syncDirectory()` 在平台拒绝打开该目录时结束本层参与） | C.3 `:150-158`、E.7 `:550-566` |
| `read_image`（转换） | runtime overlay + plugin-ish stub | `runtime-overlays/` 的 `ImageAdapter.ets` + `ImageAdapterBind.ets`（`JsBindingUtils.bindFunction("HarmonyImage.Convert", …)`）；`OVERLAY_ADD_FILES` 登记；Node 侧 `scripts/lib/sharp-stub.mjs` + `sharp-stub-body.js` | C.3 `:153-158`、E.7 `:537`、E.9 `:664`、`:723-737` |
| 图片缩略图 | upstream package（接口缺失） | 上游无生成代码；`readImageRequest(ref, policy)` 已实现但只服务模型请求投影（`attachment-local/src/index.ts:245`） | A.2 #24 `:50`、C.7 `:197-219` |

### 3.7 FR-7 平台集成与分发

| 能力 | 落点类型 | 落点（文件 / 配置） | 证据出处 |
|---|---|---|---|
| 后台常驻 | runtime overlay + HAP 声明 | `EntryAbility` 的 `backgroundModes: ["taskKeeping"]` + `KEEP_BACKGROUND_RUNNING` + `onBackground` / `onForeground` 申请释放 | A.2 #27 `:53`、E.8 `:649-653` |
| 托盘 / 状态栏图标 | runtime overlay + runtime 调用 | `TrayAdapter` + `TrayAdapterBind` + `OVERLAY_ADD_FILES` + `src-main` 调用 | A.2 #28a `:54`、E.10 `:800`、`:806-819` |
| 无边框窗口 | 无落点（决策不实现） | API 就绪（`window.setWindowDecorVisible(false)`） | A.2 #28b `:55`、D.2 `:255` |
| 更新检查 | 无落点（决策不实现） | API 就绪（`updateManager.checkAppUpdate` / `showUpdateDialog`） | A.2 #28c `:56`、D.2 `:256` |
| 开机自启 | 无落点（不可实现） | `autoStartupManager` 仅只读接口 | A.2 #28d `:57`、D.2 `:257` |
| 用户目录授权策略 | 无落点（仅决策） | 上架须移除 Desktop 声明与可写根 | A.2 #29 `:58`、D.1 `:235` |
| HNP 发布 | 构建脚本 + HAP 声明 | `scripts/inject-hnp.ps1`（`app_packing_tool --hnp-path` + `hap-sign-tool sign-app` + `verify-app`）、`scripts/lib/decrypt-signing-pwd.cjs`、`electron/hnp-src/`、`hnpPackages` 声明 | A.2 #30 `:59`、E.10 `:884-902` |
| `executableBinaryPaths` | 无落点（T4） | `module.executableBinaryPaths` + `.permission` ELF 节 + `binary-sign-tool` | A.2 #31 `:60`、D.2 `:260-286` |

### 3.8 FR-8 Node ↔ ArkTS 通用桥

| 能力 | 落点类型 | 落点（文件 / 配置） | 证据出处 |
|---|---|---|---|
| 通用桥本体 | upstream runtime（`libelectron.so`） | `systemPreferences.callArkTSFunction` / `callArkTSAsyncFunction`，配合 `JsBindingUtils.bindFunction` 注册 | A.2 #32 `:61`、D.2 `:250`、E.9 `:668-679` |
| 首个生产使用者 | runtime overlay | `ImageAdapterBind.ets` 的 `JsBindingUtils.bindFunction("HarmonyImage.Convert", …)` | E.9 `:664`、`:723-737` |
| 接线薄包装约定 | 设计约定 | 凡经桥暴露的既有能力，加 "JSON 单入单出"薄包装（`ImageAdapter.convert` 与 `TrayAdapter` 同形） | D.2 `:258`、E.10 `:828-843` |

## 4. 根因分层与证据出处

本节把能力清单的 C / D / E 节结论按可复用性重排，作为规范中每条"根因层"的出处索引。

### 4.1 根因分层模型（C.1）

见 `docs/鸿蒙环境能力清单-v0.1.5.md:78-89`。四层即 L1 平台硬约束 / L2 原生产物缺失 / L3 本工程配置 / L4 dsh 上游接口缺失。其中 L2 的来源是"dsh-dist 在 Windows 收集"：`node-pty` / `koffi` 是 win32-x64，aarch64 无法加载（C.1 `:85`）。

### 4.2 桌面版对照（C.2）

`deepseek-harness-desktop/profiles/desktop/cordis.patch.yml` **只**覆盖 `web-runtime` 与 `dsh-market`，没有禁用 `subprocess` / `sandbox` / `permission`，也没有禁用 preset 里的 `tool-bash` / `tool-fs-search`。桌面版因此有终端、有内容搜索。**鸿蒙版多出来的限制，是本工程自己在 L3 加的**，动因是 L2（C.2 `:91-93`）。

### 4.3 逐项根因结论（C.3）

| 主题 | 结论摘要 | 出处 |
|---|---|---|
| 终端 / shell | 四重根因：产物层（`node-pty` win32-x64）+ 配置层（禁用 `subprocess` 等）+ bundle 层（禁用 `tool-bash`）+ preset 层（`HARMONY_DISABLED_PRESET_ROWS`）；平台 `fork` + `execve` 放行，过不去的只是"用 `node-pty` 实现" | C.3 `:97-106` |
| 进程沙箱 | `koffi` win32-x64；`landlock` 是 Linux LSM，OHOS 内核是否具备未证实；不恢复，无 shell 时无意义 | C.3 `:108-112` |
| 列目录 / 内容搜索 | `dsh-tool-fs-search` 依赖 `@vscode/ripgrep` 外部二进制；已用 C2 `str_replace_editor` 的 `view` 与 C1 纯 JS `grep` 替代；`glob` 只返回文件 | C.3 `:114-118` |
| 删除 / 移动 / 重命名 | 不是鸿蒙限制，是 dsh `ctx.fs` seam 缺原语；删除 / 移动在 dsh 里唯一的原生途径是 shell 的 `rm` / `mv`，桌面版同样没有 | C.3 `:120-124` |
| 复制 / `chmod` | `copy` 不需要新 seam 原语（`readBytes` + `writeBytes` 已足够）；`chmod` 必须新增原语；`chmod` 被 hmdfs 语义倒逼成"应用后回读校验" | C.3 `:126-131` |
| 用户目录写入失败 + 每次审批 | 两个独立问题：DSH 沙箱白名单只有 session workspace + `/tmp` + `os.tmpdir()`；DSH 建文件走硬链接而 hmdfs 无 `.link` 处理器；鸿蒙授权等级差异 | C.3 `:133-142` |
| 图片附件 | 根因 L2（libvips 不可用）；`normalizeImage()` 有直通分支，真实图片头解析即为充分修复 | C.3 `:144-149` |
| ArkTS 图像桥 | 不必交叉编译 libvips，直接调用平台能力；纯 ArkTS 无需 C/C++ | C.3 `:151-158` |
| `job_*` / `skill` / 未测项 | `job_*` 缺执行后端；`skill` 是纯配置 + 无技能目录，已由 H1 修复；其余是"没测"而非"不可用" | C.3 `:160-165` |

### 4.4 安全：围栏与审批（C.4）

见 `docs/鸿蒙环境能力清单-v0.1.5.md:167-172`。要点：围栏 fail-closed 且拒绝先于审批；审批链路完整（服务侧默认 `unavailable` 且调用方一律拒绝）；原"提权静默放行"归因不成立（J1 作废）；`DSH_EXTRA_WRITABLE_ROOTS` 是部署期状态、不是模型输入。规范第 6 节即此节的规范化。

### 4.5 平台可行性与 T1 的两个设计约束（C.5）

`fork` + `execve` + 管道 + PATH 查找全部放行，子进程继承应用沙箱（C.5 `:174-176`）。两个必须带入 T1 设计的约束：① 子进程退出不可观测 + 僵尸泄漏，T1 必须做成常驻单 shell 进程 + 哨兵行完成信号（C.5 `:180`）；② shell 绕过 fs 围栏与审批，必须在 exec 工具层自建围栏（C.5 `:181`）。规范 FR-3.1 与 §6.4 引用后者作为安全风险记录。

### 4.6 补丁链上下文约束（C.6）

`scripts/build-dsh.mjs` 的幂等判据是 `git apply --reverse --check` 成功即视为已应用，隐含"后加入的补丁不得落在既有补丁的上下文窗口内"（`git apply` 默认前后各 3 行）。禁区是**连续区间**，不是固定 3 行（C.6 `:183-193`）。验证方法：对每一个补丁跑 reverse-check，全部返回 0；新补丁做一次"反向 apply → 正向 apply"往返，确认受影响文件 SHA256 完全还原（C.6 `:195`、E.8 `:624`）。

### 4.7 图片缩略图：上游没有该功能（C.7）

全客户端清点结论：数据源统一走 `ctx.uiConversation.imageUrl()` → `session.attachment` RPC → `ctx.attachments.readImage(ref)`，读的是已规范化存储对象，请求类型 `SessionAttachmentRequest` 只有 `{sessionId, attachmentId}`，**没有任何尺寸 / 变体参数**；「thumbnail」只出现在客户端 UI，指 CSS 缩放完整规范化字节（C.7 `:199-201`）。可复用但未接线的现成件是 `readImageRequest(ref, policy)`（C.7 `:217`）。收益排序见 C.7 `:219`。

### 4.8 平台事实（D.1-D.2）

| 主题 | 结论 | 出处 |
|---|---|---|
| 手机 fork / fork+exec | 手机设备禁止三方应用 fork；PC/2in1 API 24 实测放行 | D.1 `:227-228` |
| PTY | 无官方应用级 API；`forkpty` / `openpty` 在 SELinux 受影响清单，失败表现为 `EACCES` | D.1 `:230` |
| HNP | `hnpPackages` 仅 entry 模块；public 包落 `/data/service/hnp`，可被系统终端访问 | D.1 `:232`、D.2 `:288-297` |
| HAP 内二进制 | `executableBinaryPaths`（API 24 起，仅 PC/2in1）+ `.permission` 节 + `binary-sign-tool` | D.1 `:233`、D.2 `:260-286` |
| 外部原生代码 | `ohos.permission.ALLOW_EXTERNAL_NATIVE_CODE`（system_basic / PC/2in1 / API 23）；不存在 `kernel.` 前缀同名权限 | D.1 `:234`、D.2 `:262` |
| 用户目录权限 | Download / Documents = `normal` / `user_grant`；Desktop = `system_basic` | D.1 `:235`、D.2 `:244` |
| hmdfs | 不支持 `symlink`；不支持硬链接；默认大小写不敏感；`rename` 实测同目录与跨目录均成功（与 prose 有张力） | D.1 `:237`、D.2 `:245-246` |
| 长时任务 | `TASK_KEEPING` API 21 起对 PC/2in1 开放；仅 UIAbility 可申请 | D.1 `:239` |
| 托盘 | `statusBarManager` + `StatusBarViewExtensionAbility`，仅 2in1，无运行时权限 | D.2 `:253`、`:258` |
| 无边框 / 更新检查 / 开机自启 | 装饰接口无需权限；更新检查无静默自更新公开 API；开机自启无公开 setter | D.2 `:255-257` |
| 通用 ArkTS 桥 | 标签信封返回值；两个入口都返回 Promise；类型与参数上限；两条硬性约束 | D.2 `:250`、`:258` |

### 4.9 历史实测记录（E.*）

| 记录 | 支撑的规范内容 | 出处 |
|---|---|---|
| E.3 恢复与回归 | 列目录、技能加载、围栏与审批、I1 能力回归 | E.3 `:335-394` |
| E.4 `fork` / `exec` 探针 | 平台可行性（C.5）、PTY 结论的前提；外部依赖不得作为产品功能 | E.4 `:396-453` |
| E.5 档1 三项落地 | E2 额外可写根（FR-6.3）、D1+ 二进制搬运（FR-2.1）、C1 内容搜索（FR-1） | E.5 `:455-498` |
| E.7 档0 / 档1 | `grep` / `glob`、图片头解析、附件 fsync 链阻塞、`workflow` 工具级调用 | E.7 `:508-612` |
| E.8 `copy` / `chmod` / K1 | FR-2 复制与权限、后台常驻声明进包、E3 决策 | E.8 `:614-662` |
| E.9 `--inspect` 门控 / 桥 / 图像桥 | FR-8 两条硬约束、`read_image` 三路径、ICC 剥离 | E.9 `:664-796` |
| E.10 托盘 / HNP | FR-7 托盘接线结果与未排除项、HNP 端到端 | E.10 `:798-921` |

## 5. 规范源 ↔ 技能同步机制

### 5.1 关系

`skills/harmony-runtime-capabilities/SKILL.md` 是本规范正文的**运行期摘要**，随 HAP 分发，在设备上被 `skill` 工具按需加载。它是 dsh 的 **bundled 技能根**（`DSH_BUNDLED_SKILL_DIR` 指向 resfile `app/skills`），rank 600，最低优先级；同名用户级或项目级技能会覆盖它（**有意行为**，不得"修掉"，因为它使"用户可改写内置行为"成立）。

技能可用时机是**惰性**的：进程启动只配置 `DSH_BUNDLED_SKILL_DIR`；会话首次请求前注入技能目录（`name` + 截断 500 字的 `description`）；正文按需加载且不缓存。

### 5.2 同步义务（强制）

| 事件 | 必做 | 依据 |
|---|---|---|
| 某项能力的结论变化（新增 / 移除 / 状态从 ❌ 变 ✅ 等） | 先改本规范 `spec.md`，再按其改 `SKILL.md`；不得只改技能 | 本规范 §1.1、§8.2 |
| 技能正文与规范冲突 | 以规范为准，并修正技能 | 本规范 §8.2 |
| 新增能力（A.2 之外） | 不入本规范（规范只收 A.2），先在能力清单 A.2 立行 | 本规范 §1.3、§8.4 |

### 5.3 历史脱节案例（作为反例保留）

`harmony-runtime-capabilities` 曾因未随能力交付同步更新，声称 `delete` / `move` 不存在，导致模型拒绝使用已交付的工具。该案例记录在工程根 `README.md:169` 的技能告警段，修正见提交 `c9ad23e`。本规范把"技能正文由规范派生、能力变化必须同步"确立为治理规则（AC-20）。

### 5.4 覆盖语义的正确表述

- **不要**把技能写成"启动时即加载"：正文是惰性加载、不缓存。
- **不要**把"同名技能可覆盖内置技能"当成缺陷：rank 600 最低优先级是设计结果。
- **不要**在本规范或技能中加入路线图；未完成项属能力清单 B 表。

## 6. 验证策略

| 层 | 手段 | 覆盖的 AC |
|---|---|---|
| 静态 | `grep` 逐行对照规范能力表与能力清单 A.2（35 行） | AC-1 |
| 静态 | `grep` 检查三个文件无禁用旧名、无路线图 / 待办章节 | AC-21 |
| 静态 | `grep` 检查未验证项均带"未验证"标注 | AC-23 |
| 静态 | 人工对照技能正文与规范，确认无冲突 | AC-20 |
| 构建 | `node scripts/collect-dsh.mjs` 后断言物化产物（插件 / 技能 / preset） | AC-2、AC-15（前提） |
| 构建 | 解包 HAP 断言 `module.json` 含 `backgroundModes` + `KEEP_BACKGROUND_RUNNING`、`modules.abc` 含 `TASK_KEEPING` | AC-15 |
| 构建 | `scripts/inject-hnp.ps1` 产物含 `hnp/<abi>/<pkg>.hnp` 且 `verify-app` 通过 | AC-17 |
| 构建 | 对 13 个补丁逐个 `git apply --reverse --check` 返回 0 | AC-1（补丁前提） |
| 真机 | `--inspect`（CDP `Runtime.evaluate`）读目录、发起工具调用、读对话内容 | AC-2~AC-13、AC-18 |
| 真机 | `hilog \| grep dsh-harmony` | AC-2、AC-15、AC-16 |
| 真机 | `uitest dumpLayout -p` + `hdc file recv` 核验审批面板文本 | AC-19 |
| 真机 | 截图核验托盘区（如实记录无图标） | AC-16 |
| 来源 | 官方出处（D.1 / D.2）与源码清点（C.7） | AC-14、AC-18、AC-19、AC-22 |

> 真机 `--inspect` 的 CDP 表达式与用例见 `test-cases.md`；`--inspect` 由 `CommandLineAdapter` overlay 按 debug 构建门控（E.9 `:693-705`），非 debug 构建下该通道不存在，改用 `hilog` 与 `uitest`。

## 7. 关键决策记录

| # | 决策 | 备选 | 理由 |
|---|---|---|---|
| P1 | 规范源采用"能力清单 A.2 全表 + 根因层 + 是否可修"的形状，不重写为叙述 | 只写摘要 + 链接 | 摘要漂移正是本模块要解决的问题；全表可逐行核验（AC-1） |
| P2 | 35 行全部收进 FR-1..FR-8，其中 A.2 #25 / #26（围栏 / 审批）作为 FR-2 共用的安全基元列出 | 单列安全 FR 域 | 二者在实现上只作用于文件目标，归入文件变更域更忠实；其完整语义仍在第 6 节展开 |
| P3 | 能力清单 B 表（待办）**整体排除**，规范不设路线图 | 附一节"可修项与成本" | 用户明确不需要 B 表内容；规范只给"是否可修"判断，不给排期 |
| P4 | 所有证据以 `C.x / D.x / E.x` 加行号引用，不复制原始 stdout | 直接内嵌探针输出 | 权威结论在 A / C；原始记录保留在 E，规范只引用出处，避免第二份真相 |
| P5 | 明确"技能正文由规范派生"的单向同步方向 | 双向同步 | 双向同步会让技能成为第二事实来源，重新引入漂移 |
| P6 | 把"rank 600 最低优先级"写成**有意行为**，不列为缺陷 | 记为限制并提出修复 | 覆盖能力是设计结果，修掉即取消"用户可改写内置行为" |
| P7 | 未验证项逐条标注"未验证"（后台常驻获批、托盘缓冲区、`ralph`、`executableBinaryPaths`、PTY 真机调用） | 不标注，按结论陈述 | 能力清单本身已区分"已实测"与"未证实"；规范必须保留该区分 |
| P8 | `chmod` 在用户目录的"失败"写成**正确行为** | 记为缺陷 | 回读校验把 hmdfs 的静默忽略转成显式错误，比伪装成功安全 |
| P9 | FR-8 桥的两条硬约束独立编号（FR-8.1 / FR-8.2） | 并入说明列 | 两者都会永久阻塞主进程，是使用桥时的强制约束，必须可单独验收（AC-18） |

## 8. 待确认

无。
