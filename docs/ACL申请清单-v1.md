> **版本**：v1（落盘版；v2 首版为口头整理未落盘，见 `ACL申请清单-v2.md` 文首说明。本版按 0.1.5 上架实际提交批次落盘补记）
> **更新日期**：2026-09-25
> **用途**：**0.1.5 版 AppGallery 上架 ACL 申请记录**。记录本批次在 AGC「ACL权限」页申请的 6 项权限及其可直接照填的 `申请原因` 文案。
> **配套文档**：申请操作机制与判定规则见 `ACL申请清单-v2.md`；权限用途的代码事实见 `src-main/main.js`、`web_engine/src/main/module.json5`。
> **数据来源**：本机 DevEco SDK 23 权威权限目录 `Sdk/23/toolchains/lib/PermissionDefinitions.json`（**第一手**）＋ 工程 `module.json5` 实际声明 ＋ 代码实际调用点。
> **图例**：⬜ 待申请 ｜ 🔄 申请中 ｜ ✅ 已获批/已声明 ｜ ℹ️ 开放权限（仅需声明，无需 ACL）。

---

## 1. 本批次摘要

申请路径：**AGC → 开发与服务 → 项目 → 应用（`org.fellow99.dsh.DshDesktop`）→ 项目设置 → ACL权限 → 未获取权限 → 勾「我已知晓」→ 提交申请**。

| # | 权限名 | level | grantMode | since | 是否需 ACL | 状态 | 服务的产品能力 |
|---|---|---|---|---|---|---|---|
| 1 | `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY` | system_basic | system_grant | 14 | ✅ **需要** | ⬜ 待申请 | 内置 V8/Electron 引擎 JIT 编译 |
| 2 | `ohos.permission.READ_PASTEBOARD` | system_basic | user_grant | 11 | ✅ **需要** | ⬜ 待申请 | 剪贴板文本/图片粘贴到对话输入框 |
| 3 | `ohos.permission.READ_WRITE_DESKTOP_DIRECTORY` | system_basic | user_grant | 11 | ✅ **需要** | ⬜ 待申请 | 读写用户桌面目录 |
| 4 | `ohos.permission.READ_WRITE_DOCUMENTS_DIRECTORY` | normal | user_grant | 11 | ℹ️ **不需要**（开放权限，已在 `requestPermissions` 声明，运行期弹窗授权） | ✅ 已声明 | 读写用户文档目录 |
| 5 | `ohos.permission.READ_WRITE_DOWNLOAD_DIRECTORY` | normal | user_grant | 11 | ℹ️ **不需要**（同上） | ✅ 已声明 | 读写用户下载目录 |
| 6 | `ohos.permission.FILE_ACCESS_PERSIST` | normal | system_grant | 11 | ℹ️ **不需要**（开放权限，已声明；API 12 起可直接声明） | ✅ 已声明 | 文件选择器所选目录授权持久化 |

> ⚠️ **提交前必读**：按 SDK 23 权限定义，本批次真正走 ACL 的只有 **#1 / #2 / #3**（`system_basic` 跨级别）；#4–#6 为 `normal` 开放权限，写进 `module.json5` 的 `requestPermissions` 即生效（`user_grant` 项首次访问时系统弹窗），**在 AGC ACL 列表中通常无法勾选，无需提交**。申请原因文案下方仍一并给出，供弹窗/审核问询或 AGC 页面要求时直接使用。
>
> 三项 ACL 可**一次提交**（单次上限 30 项），审核结果一起返回，约 3 个工作日；**上一批未审完不能提交新一批**。

---

## 2. 申请原因文案（可直接照填，均 ≤256 字）

### 2.1 `kernel.ALLOW_WRITABLE_CODE_MEMORY`

- **使用场景**：应用基于「Electron-on-鸿蒙」运行时（Electron 37 / Node 22.17.0）构建，内置 Chromium V8 与 Node.js 引擎。用户进行 AI 对话、agent 工具调用、插件市场包安装及加载内置 dsh Web UI 时，V8/Node 引擎需要对 JavaScript 执行 JIT 即时编译以保证运行性能；同时应用加载引擎自带的 `.so` 原生库。权限仅用于引擎自身 JIT 代码缓存，**不用于应用热更新、不下载执行外部代码**，且应用已适配坚盾模式（JShield），坚盾模式下不崩溃。仅平板 / 2in1 设备使用。

- **申请原因**：因为应用内置的 V8/Node.js 引擎需要申请可写可执行内存以完成 JavaScript JIT 即时编译、保障 AI 对话与 agent 工具调用的运行性能，所以需要 `kernel.ALLOW_WRITABLE_CODE_MEMORY` 权限。该权限仅用于引擎自身 JIT，不用于热更新或加载外部不可信代码，应用已适配坚盾模式（JShield）并在该模式下正常运行。

### 2.2 `READ_PASTEBOARD`

- **申请原因**：因为需要支持用户把剪贴板中的文本、HTML 或图片粘贴到对话输入框（用户主动触发粘贴操作时读取），所以需要 `READ_PASTEBOARD` 权限。仅在用户粘贴时读取剪贴板内容，不在后台读取、不上传剪贴板数据。

### 2.3 `READ_WRITE_DESKTOP_DIRECTORY`

- **申请原因**：因为用户在应用内选择的工作目录可能位于桌面，AI agent 的文件工具（读取/新建/编辑/保存文件）需要直接读写该目录，所以需要 `READ_WRITE_DESKTOP_DIRECTORY` 权限。仅访问用户主动选择或授权的桌面目录，不批量扫描磁盘。

### 2.4 `READ_WRITE_DOCUMENTS_DIRECTORY`（ℹ️ 开放权限，通常无需提交 ACL）

- **申请原因**：因为用户在应用内选择的工作目录可能位于文档目录，AI agent 的文件工具需要直接读写其中的文件，所以需要 `READ_WRITE_DOCUMENTS_DIRECTORY` 权限。仅访问用户主动选择或授权的目录，不批量扫描磁盘。

### 2.5 `READ_WRITE_DOWNLOAD_DIRECTORY`（ℹ️ 开放权限，通常无需提交 ACL）

- **申请原因**：因为用户在应用内选择的工作目录可能位于下载目录，AI agent 的文件工具需要直接读写其中的文件，所以需要 `READ_WRITE_DOWNLOAD_DIRECTORY` 权限。仅访问用户主动选择或授权的目录，不批量扫描磁盘。

### 2.6 `FILE_ACCESS_PERSIST`（ℹ️ 开放权限，通常无需提交 ACL）

- **申请原因**：因为需要让用户通过文件选择器授权的目录在应用重启后持续可访问，避免每次启动重复弹窗授权，所以需要 `FILE_ACCESS_PERSIST` 权限。仅对用户主动选择并授权的目录持久化，不扩大访问范围。

---

## 3. 声明现状（代码事实）

| 文件 | 相关声明 |
|---|---|
| `runtime-overlays/web_engine/src/main/module.json5` → `requestPermissions` | 上述 6 项均已声明；#2–#5 带 `reason` + `usedScene`（`EntryAbility` / `when: inuse`） |
| 同文件 → `definePermissions` | `kernel.ALLOW_WRITABLE_CODE_MEMORY`（连同 `LOCK_WINDOW_CURSOR`） |
| `src-main/main.js` → `installExtraWritableRoots()` | 启动时把用户已授权的 `Desktop` / `Documents` / `Download` 写入 `DSH_EXTRA_WRITABLE_ROOTS`，免去 DSH 沙箱内逐次写入提权 |
| `web_engine/.../adapter/PasteBoardApadter.ets` | `readPasteBoardText` / `readPasteBoardHTML` / `readImageBuff`：由渲染进程粘贴动作触发读取 |
| `web_engine/.../adapter/PermissionManagerAdapter.ets` | `fileAccessPersist` / `activateFileAccessPersist`：文件选择器所选 URI 授权持久化 |

---

## 4. 获批后事项

1. 审批通过（约 3 个工作日）后权限出现在「已获取权限」。
2. **创建发布 Profile** 时获批 ACL 自动写入；**若 ACL 在 Profile 创建后变更，必须重建 Profile**。
3. 用发布证书 + 发布 Profile 构建 release App Pack（`.app`）后提交 AppGallery。
4. 本批次结果回填本文件第 1 节状态列（🔄/✅）与第 5 节记录表。

---

## 5. 申请提交记录

| 批次 | 提交日期 | 权限 | 提交人 | 审批结果 | 结果日期 | 备注 |
|---|---|---|---|---|---|---|
| 1 | 2026-09-25 | #1 `kernel.ALLOW_WRITABLE_CODE_MEMORY`、#2 `READ_PASTEBOARD`、#3 `READ_WRITE_DESKTOP_DIRECTORY` | — | ⬜ 待审批 | — | #4–#6 为开放权限，已声明、不占 ACL 批次 |

---

## 6. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-09-25 | 落盘 0.1.5 上架 ACL 申请批次：6 项权限的申请原因文案；依据 SDK 23 `PermissionDefinitions.json` 区分 3 项需 ACL（`kernel.ALLOW_WRITABLE_CODE_MEMORY` / `READ_PASTEBOARD` / `READ_WRITE_DESKTOP_DIRECTORY`）与 3 项开放权限（文档 / 下载 / FILE_ACCESS_PERSIST）；补记使用场景与提交记录 |
