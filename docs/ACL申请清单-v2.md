> **版本**：v2（首版为口头整理，未落盘；本版为落盘基线）
> **更新日期**：2026-09-18
> **用途**：**申请操作手册**。列出本工程为「命令执行（tool-bash）」与「设备侧 Node 运行时预置（runtime-provisioning）」两个需求必须申请的**受限权限（ACL）**与**二进制证书**，可直接照此提交 AGC 申请。
> **配套文档**：本清单只讲「申请什么、怎么申请」。能力边界与根因分层见 `docs/鸿蒙环境能力清单-v0.1.5.md`；两个需求的规格见 `specs/010-tool-bash/` 与 `specs/011-runtime-provisioning/`。
> **数据来源**：本机 DevEco SDK 的权威权限目录 `sdk/default/openharmony/toolchains/lib/PermissionDefinitions.json`（**第一手**）＋ OpenHarmony 官方文档 ＋ 华为 AGC 官方文档（出处见 §11）。
> **图例**：✅ 已获得 / 已声明 ｜ ⬜ 待申请 ｜ ❌ 不申请 ｜ ❓ 未证实。

---

## 1. 摘要：要申请什么

| # | 项目 | 类型 | 优先级 | 阻塞谁 |
|---|---|---|---|---|
| **A1** | **二进制证书**（AGC `certType: 4`） | 在线工单（受限开放） | **最高 · 关键路径** | 011 主路径（随包携带签名 Node ELF）；也决定 010 能否用自有二进制 |
| **A2-a** | `ohos.permission.ALLOW_EXTERNAL_NATIVE_CODE` | ACL | 高 | `executableBinaryPaths` 机制的合法化 |
| **A2-b** | `ohos.permission.kernel.LOAD_INDEPENDENT_LIBRARY` | ACL | 高 | Node 加载二进制证书签名的 `.so` |
| **A2-c** | `ohos.permission.READ_WRITE_DESKTOP_DIRECTORY` | ACL | 中 | **已声明**，需确认进入**发布 Profile** + 上架前评估 |
| **A2-d** | `ohos.permission.ACCESS_USER_FULL_DISK`（或 `READ_WRITE_USER_FILE`） | ACL | 中 | 用户目录免弹窗直写 |
| ❌ | 四个插件权限（`kernel.SUPPORT_PLUGIN` 等） | — | **不申请** | 本工程插件是 Node 包，非鸿蒙插件包 |

**一句话**：真正要做的只有三件 —— ① **开工单申请二进制证书**（周期最长，今天就开）；② **提交 A2 的 ACL 批次**（一次最多 30 个，四项一次交完）；③ 上架前复核 `READ_WRITE_DESKTOP_DIRECTORY` 是否保留。

**⚠️ 前提更正**：提交者**不必**是中国大陆账号。官方口径是**海外**账号仅支持**亚太和欧洲**地区申请 ACL —— 中国大陆账号是支持的（见 §11 出处 11）。

---

## 2. 判定规则：什么才算「需要申请」

本工程所有权限判断统一用下面这条规则，**不要凭印象申请**：

> **受限开放权限（需 ACL）** ⟺ `provisionEnable == true` **且** `availableLevel ∈ {system_basic, system_core}`。
>
> `provisionEnable == false` 的，无论 level 是什么，都是**开放权限** —— 写进 `requestPermissions` 即可，安装时授予（`user_grant` 的还需运行期弹窗）。**把它们提交 ACL 是浪费配额**。

两个易错点：

1. `availableLevel: normal` 但 `provisionEnable: false` 的权限（如 `INHERIT_PARENT_PERMISSION`、`kernel.IGNORE_LIBRARY_VALIDATION`、`kernel.EXEMPT_ANONYMOUS_EXECUTABLE_MEMORY`）**不用 ACL**，尽管名字带 `kernel.` 前缀、看起来很像受限权限。
2. `grantMode: system_grant` 不等于「不用申请」。受限权限绝大多数也是 `system_grant`（安装即授予，但**前提是 Profile 里有它**）。

---

## 3. A 类：立刻申请

### 3.1 A1 — 二进制证书（**关键路径，建议今天开工单**）

这是本清单里**唯一真正的硬阻塞**，且是**企业资质门槛 + 人工审核**，周期不可控。

官方定义（AGC 证书概述）：

> **二进制证书**：用于二进制程序签名。**二进制程序需使用二进制证书签名，才能在鸿蒙PC上正常运行。**

| 项 | 值 |
|---|---|
| AGC 证书类型号 | **`certType: 4`** —— 「二进制证书（用于二进制程序签名）」 |
| 获取方式 | **受限开放**：无自助控制台入口，需通过**在线工单系统**联系华为 |
| 工单必填四项 | ① **企业名称与资质** ② **应用名称及 APP ID** ③ **应用的业务场景与用途** ④ **申请的证书类型：二进制证书** |
| 为什么本工程必须要 | 我们必须在设备上运行 **Node 运行时（ELF）**。HNP 内嵌 ELF 会被安装器的 `CodeSign + BssInstall（若 CODE_SIGNATURE_ENABLE）` **验签**；未签名跑不起来。`executableBinaryPaths` 路线同理 |
| 能否用自签名替代 | ❌ **不能用于发布**。`binary-sign-tool ... -selfSign 1` 存在且可用（`display-sign` 会报 `code signature is self-sign`），但官方文档**未说明**它是否仅限开发者模式（❓ 未证实）；社区反馈自签名二进制在 PC 上首次执行会弹窗确认。**一律按「仅本地调试便利」对待** |
| 配额 | ❓ 未证实（官方未公布二进制证书的账号配额） |
| ⛔ **个人开发者不可得（2026-09-22 确证）** | **本工程当前主体（个人开发者）申请不下来** —— 工单要求企业名称与资质。**因此 011 的"自带 Node/pnpm/python 运行时"路线（T5）在当前主体下不可行**，A2 的 `ALLOW_EXTERNAL_NATIVE_CODE` / `LOAD_INDEPENDENT_LIBRARY` **也一并失去意义**（它们服务于自有 ELF，而 ELF 过不了签名闸门）→ **A2-a / A2-b 建议暂缓提交**，只保留 A2-c / A2-d（它们与 ELF 无关）。影响范围与两条**不需要证书**的替代路线见 `鸿蒙环境能力清单-v0.1.5.md` §C.8。 |
| 替代路线（不需要证书） | ① **依赖主机自带工具链**：应用 PATH 已含 `/data/service/hnp/bin`，其中 node 已通过结构校验，只缺 `pnpm` —— 主机补上 pnpm 即打通市场安装通道；② **进程内 JS 跑 pnpm**：不落 ELF、不 spawn。二者均把该能力降级为**可选依赖**，不可作为上架功能承诺 |
| 被驳回的后果 | ⛔ **已成立**（个人开发者拿不到）。「随包携带 Node ELF」**没有官方替代路径**；只能退守 §C.8 的两条免证书路线 |
| ✅ **0.1.5 已决策（2026-09-22）** | **走路线一：主机装好 `pnpm`；本应用对该能力不作上架（AppGallery）承诺。** 据此：**A2-a（`ALLOW_EXTERNAL_NATIVE_CODE`）与 A2-b（`LOAD_INDEPENDENT_LIBRARY`）暂缓提交**（它们服务于自有 ELF，而 ELF 过不了签名闸门）；A1 二进制证书**不再申请**。只保留与 ELF 无关的 A2-c / A2-d。用户唯一动作 = 在设备**系统终端**装 `pnpm`（放进应用 PATH 可见目录，首选 `/data/service/hnp/bin`；**勿在应用域装**，否则 bin 软链建不出来）。详见 `鸿蒙环境能力清单-v0.1.5.md` §C.8.7 与 `specs/011-runtime-provisioning/spec.md` §4.2 |

签名工具与命令（证书到手后用）：

```bash
# 对 ELF 做代码签名（-moduleFile 会把权限声明注入 ELF 的 .permission 节）
binary-sign-tool sign \
  -keyAlias <别名> -appCertFile <二进制>.cer -profileFile <>.p7b \
  -keystoreFile <>.p12 -signAlg SHA256withECDSA \
  -inFile <unsigned-elf> -outFile <signed-elf> \
  -moduleFile module.json

# 自签名（仅本地调试，不可发布）
binary-sign-tool sign -inFile <in> -outFile <out> -selfSign "1"

# 复核签名与权限
binary-sign-tool display-sign -inFile <signed-elf>
```

> 工具形态：OpenHarmony `toolchains/lib/binary-sign-tool`（Linux CLI）、DevEco/DevBox（PC 2in1）、Java `binary-sign-tool.jar`（API 24+）。**注意区分**：`hapsigntool` 管 `hap/hsp/hqf`，`binary-sign-tool` 管 **ELF**。

### 3.2 A2 — ACL 批次（四项一次提交）

AGC 单次申请上限 **30 个权限**，下列四项一起交。

| 权限名 | level | since | 设备类型 | grantMode | 受限 | 用途 |
|---|---|---|---|---|---|---|
| `ohos.permission.ALLOW_EXTERNAL_NATIVE_CODE` | system_basic | **23** | **仅 2in1** | system_grant | ✅ | 官方：「允许应用使用外部 native 程序。包括加载外部动态链接库(so)、**二进制文件(bin)** 等」。`executableBinaryPaths` 的合法化权限 |
| `ohos.permission.kernel.LOAD_INDEPENDENT_LIBRARY` | system_basic | **20** | **仅 2in1** | system_grant | ✅ | 官方：「允许应用加载**二进制证书签名的共享库**」。API 20–21 仅系统应用；API 22 起对普通应用开放 |
| `ohos.permission.READ_WRITE_DESKTOP_DIRECTORY` | system_basic | 11 | 2in1 + tablet | user_grant | ✅ | 桌面目录读写。**本工程已声明**，此处申请/确认是为了**上架**（`system_basic` 是当前唯一的上架障碍） |
| `ohos.permission.ACCESS_USER_FULL_DISK` | system_basic | **22** | **仅 2in1** | manual_settings | ✅ | 官方：「无需弹窗访问用户公共路径」。**替代方案**：`ohos.permission.READ_WRITE_USER_FILE`（system_basic / since 13 / 仅 2in1），语义更窄、审核更容易解释 |

**已获得、无需重复申请**：`ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY`（system_basic / system_grant / since 14 / 平板+2in1 / 受限）。它已在本工程 `module.json5` 的 `requestPermissions` 与 `definePermissions` 中，用于启用 Electron 引擎的 JIT 编译。

**提交时按此口径写「使用场景」**（决定审核通过率）：

- `ALLOW_EXTERNAL_NATIVE_CODE`：本应用在 HAP 内集成自有 Node.js 运行时（aarch64-ohos ELF，已用**二进制证书**签名），用于运行内置插件市场的包管理能力；不用于热更新，不加载外部不可信代码。
- `LOAD_INDEPENDENT_LIBRARY`：上述 Node 运行时需加载其自带的、**已用二进制证书签名**的 `.so`（native 模块 / ICU / OpenSSL）。
- `READ_WRITE_DESKTOP_DIRECTORY` / `ACCESS_USER_FULL_DISK`：用户在应用内主动选择的工作目录位于桌面/文档/下载，应用需直写该目录；不用于批量扫描用户磁盘。

### 3.3 提交操作步骤与硬约束

1. 路径：**AGC → 开发与服务 → 你的项目 → 你的应用 → `项目设置` → `ACL权限`**。
2. 在「未获取权限」区勾选 **我已知晓**，勾选目标权限，填写 `申请原因`（≤256 字）、`使用场景`，必要时附材料，提交 **申请**。
3. **配额与节奏**：单次最多 **30 个权限**；**审核结果一起返回**；**上一批未审完不能提交新一批**。
4. **获批落点**：获批权限在**创建发布 Profile 时自动写入**。
   > ⚠️ **若 ACL 权限在 Profile 创建之后发生变化，必须重建 Profile** —— 这是本工程 201 号文档已记录过的踩坑点。
5. **区域**：海外账号仅支持**亚太和欧洲**；中国大陆账号正常支持。
6. 另存在 **试用调试 Profile**：5 天有效期、每应用最多 5 个 —— 可用于在正式 ACL 下来之前先做可行性验证。

---

## 4. B 类：取决于所选方案（**现在不要申请**）

| 方案 | 是否需要新 ACL / 证书 |
|---|---|
| **进程内 JS 运行 pnpm**（`011` 的候选主路径） | ❌ **不需要任何 ACL，也不需要二进制证书**。主进程本身就是 Node 22.17，把 pnpm 与 dsh CLI 以 JS 形式 vendor 进来、进程内 `import()` 执行 —— 不 spawn、不建软链、不落 ELF |
| **HNP 携带已签名 ELF** | HNP **机制本身不需要任何权限/ACL**（`module.json5` 的 `hnpPackages` 纯配置项）；但**里面的 ELF 仍需要 A1 的二进制证书 + `.codesign`** |
| **Node 以 `.so` 形式进程内加载** | 需要 A2-b「`LOAD_INDEPENDENT_LIBRARY`」+ 证书签名的 `.so` |
| **用 `CUSTOM_SANDBOX` 做真隔离** | ❌ **不要申请**。system_basic / since 18 / 受限，但社区一致反映仅华为内部可得（❓ 未证实），且变更应用沙箱类型属高风险变更，上架几乎不可能 |
| **`ohos.permission.RUN_ANY_CODE`** | ❌ **不要申请**。system_basic / since 10 / 受限，无正当第三方用途，申请会降低整批可信度 |
| **`ohos.permission.ALLOW_COREDUMP`** | 可选。level `normal`、`provisionEnable: false` → **不需要 ACL**，声明即可（since 23 / 2in1） |

---

## 5. C 类：不需要 ACL（**本工程已全部声明**，见 §9）

这些是开放权限，**不要提交 ACL**。列在此处是为了防止误申请。

| 权限名 | level | since | grantMode | 本工程状态 |
|---|---|---|---|---|
| `ohos.permission.INTERNET` | normal | 9 | system_grant | ✅ 已声明 |
| `ohos.permission.GET_NETWORK_INFO` | normal | 8 | system_grant | ✅ 已声明 |
| `ohos.permission.KEEP_BACKGROUND_RUNNING` | normal | 8 | system_grant | ✅ 已声明（electron 模块，配合 `backgroundModes: ["taskKeeping"]`） |
| `ohos.permission.READ_WRITE_DOCUMENTS_DIRECTORY` | normal | 11 | user_grant | ✅ 已声明 |
| `ohos.permission.READ_WRITE_DOWNLOAD_DIRECTORY` | normal | 11 | user_grant | ✅ 已声明 |
| `ohos.permission.FILE_ACCESS_PERSIST` | normal（API 11 时为 system_basic） | 11 | system_grant | ✅ 已声明（API 12 起可直接声明） |
| `ohos.permission.INHERIT_PARENT_PERMISSION` | normal | 23 | system_grant | ⬜ **待补**（走 ELF 路线时，需同时写进 `module.json5` 与 ELF 的 `.permission` 节） |
| `ohos.permission.kernel.IGNORE_LIBRARY_VALIDATION` | normal | 20 | system_grant | ⬜ **待补**（同上） |
| `ohos.permission.kernel.EXEMPT_ANONYMOUS_EXECUTABLE_MEMORY` | normal | 23 | system_grant | ⬜ **待补**（同上，V8 JIT 相关） |
| `ohos.permission.ALLOW_COREDUMP` | normal | 23 | system_grant | ⬜ 可选 |

> `provisionEnable` 均为 `false` —— 这就是它们不属于 ACL 的判据。

---

## 6. D 类：明确**不要**申请

| 权限名 | 不申请的理由 |
|---|---|
| `ohos.permission.kernel.SUPPORT_PLUGIN`（system_basic / since 19 / 受限） | 「允许主体应用安装插件」—— 仅当插件是**鸿蒙插件包**时需要 |
| `ohos.permission.INSTALL_PLUGIN_BUNDLE`（system_basic / since 19 / 受限） | 同上 |
| `ohos.permission.UNINSTALL_PLUGIN_BUNDLE`（system_basic / since 19 / 受限） | 同上 |
| `ohos.permission.PLUGIN_UPDATE`（system_basic / since 18 / 受限） | 同上 |
| `ohos.permission.CUSTOM_SANDBOX` | system_basic / since 18 / 受限；仅华为内部可得（❓ 未证实），上架不可得 |
| `ohos.permission.RUN_ANY_CODE` | system_basic / since 10 / 受限；无第三方正当用途 |
| `ohos.permission.SANDBOX_ACCESS_MANAGER` / `..._EXT` | **system_core** —— 仅系统应用 |
| `ohos.permission.GET_DEVICE_INDEPENDENT_BINARY_CERT` / `SET_DEVICE_INDEPENDENT_BINARY_CERT_STATUS` | **system_core** / since 20 / 仅 2in1 —— 不可得 |

> **本工程插件的性质决定了这一整类都不需要**：`dshmarket` 安装的是**写进 profile 目录的 Node 包**，**不是**鸿蒙插件包。因此四个 `*PLUGIN*` 权限一律不申请。若将来改为分发鸿蒙插件包，再回来评估 `kernel.SUPPORT_PLUGIN`（它是 kernel-effect 权限，审核更严）。

---

## 7. 不存在可申请的权限：执行 `/system/bin/sh`

**结论：没有这个权限，也没有东西可申请。**

- 已枚举 SDK 权限目录中全部条目，**不存在**任何以「执行 shell / 启动进程」为语义的权限；`ohos.permission.EXECUTE_CMD` **不存在**（该名字仅见于第三方移植仓库，❓ 未证实，按不存在处理）。
- 原因：**进程执行不由权限体系管辖**，而由 **SELinux 域 + seccomp** 管辖，叠加**强制代码签名**门禁（OpenHarmony 的应用级 seccomp 策略见 §11 出处 12）。
- 因此 `010-tool-bash` 的 `bash` 工具**不依赖任何新权限**即可 spawn `/system/bin/sh`、`/system/bin/toybox`（这两者已在真机实测放行）。
- 但「放行」与「允许」是两件事：**应用沙箱内一个已签名 ELF 是否被 SELinux 允许 `execve("/system/bin/sh")`，官方无表态** —— 见 §10 第 1 项，这是全设计最高风险的未知项。

---

## 8. 与本工程现有代码的差距对照

现状（`runtime-overlays/` 下的实际声明，非推测）：

| 文件 | 现有声明 |
|---|---|
| `runtime-overlays/electron/src/main/module.json5` | `KEEP_BACKGROUND_RUNNING` |
| `runtime-overlays/web_engine/src/main/module.json5` → `requestPermissions`（20 项） | `INTERNET`、`GET_NETWORK_INFO`、`ACCESS_CERT_MANAGER`、`RUNNING_LOCK`、`PRINT`、`PREPARE_APP_TERMINATE`、`ACCESS_BIOMETRIC`、`FILE_ACCESS_PERSIST`、`PRIVACY_WINDOW`、`WINDOW_TOPMOST`、`kernel.ALLOW_WRITABLE_CODE_MEMORY`、`GYROSCOPE`、`ACCELEROMETER`、`GET_FILE_ICON`、`LOCK_WINDOW_CURSOR`、`READ_PASTEBOARD`、`READ_WRITE_DOWNLOAD_DIRECTORY`、`READ_WRITE_DOCUMENTS_DIRECTORY`、`READ_WRITE_DESKTOP_DIRECTORY`、`CUSTOM_SCREEN_CAPTURE` |
| `runtime-overlays/web_engine/src/main/module.json5` → `definePermissions` | `LOCK_WINDOW_CURSOR`、`kernel.ALLOW_WRITABLE_CODE_MEMORY` |

**待补清单**（按方案定型的顺序）：

| 动作 | 内容 | 触发条件 |
|---|---|---|
| 声明层（**无需等审核**） | 若走 ELF 路线：补 `INHERIT_PARENT_PERMISSION`、`kernel.IGNORE_LIBRARY_VALIDATION`、`kernel.EXEMPT_ANONYMOUS_EXECUTABLE_MEMORY` | `011` 方案定型为「ELF（HNP 或 `executableBinaryPaths`）」 |
| 声明层 | 若走 `executableBinaryPaths`：加 `module.executableBinaryPaths`、`extractNativeLibs: true`、`collectAllLibs: true` | 同上 |
| ELF 侧 | 用 `binary-sign-tool -moduleFile` 把同一批权限写进 ELF 的 **`.permission` 节** | 证书到手后 |
| ACL | A2-a / A2-b 入发布 Profile | A1 与 A2 提交获批后 |
| 上架前复核 | `READ_WRITE_DESKTOP_DIRECTORY` 是否保留 | 上架时点确定后 |

> ⚠️ **安装期硬约束（必须一起满足，否则整个 HAP 装不上）**：
> 1. **ELF 的 `.permission` 节声明的权限，不得超过集成它的 HAP 已声明的权限** —— 否则安装失败。
> 2. `.permission` 的内容必须是**合法 JSON**（形如 `{"requestPermissions":[{"name":"<权限名>"}]}`）—— 否则同样安装失败。
> 3. `.permission` 是 **ELF 的节（section）**，**不是** `module.json5` 字段 —— 最易误解之处。

---

## 9. 申请操作步骤（速查）

```
① 开【二进制证书】工单（在线工单系统，非 AGC 自助）
   └ 填报：企业名称与资质 / 应用名称及 APP ID / 业务场景与用途 / 申请的证书类型：二进制证书

② 提交 ACL 批次（AGC 一次 ≤30 个，结果一起返回）
   AGC → 开发与服务 → 项目 → 应用 → 项目设置 → ACL权限 → 勾「我已知晓」→ 选权限 → 申请
   └ 本批 4 项：ALLOW_EXTERNAL_NATIVE_CODE / kernel.LOAD_INDEPENDENT_LIBRARY /
                READ_WRITE_DESKTOP_DIRECTORY / (ACCESS_USER_FULL_DISK 或 READ_WRITE_USER_FILE)

③ 等审核（官方仅说明「各权限的审核时长见受限开放权限列表」，不承诺统一 SLA —— ❓ 未证实）

④ 获批后【创建发布 Profile】—— 权限会自动写入
   ⚠️ 若 ACL 随后变更，必须【重建 Profile】

⑤ 若想在正式 ACL 前先验证可行性：用【试用调试 Profile】（5 天、每应用 ≤5 个）
```

---

## 10. 必须向华为确认的未知项

| # | 问题 | 影响 |
|---|---|---|
| 1 | **应用沙箱内一个已签名 ELF，是否被 SELinux 允许 `execve("/system/bin/sh")`？** 官方无表态 | 决定 `010` 的 `bash` 工具能否直接用系统 shell，还是必须完全自建 |
| 2 | **HNP 内嵌 ELF 的签名，用二进制证书还是被 HAP 签名覆盖？** 官方无表态 | 决定 HNP 路线的工作量与是否需要 A1 |
| 3 | `binary-sign-tool -selfSign 1` 是否**仅限开发者模式**？自签名二进制能否用于正式分发？ | 决定能否在证书下来之前先跑通端到端 |
| 4 | ACL 各权限的**实际审核时长**（官方未给统一 SLA） | 影响排期 |
| 5 | 二进制证书的**账号配额**与驳回后的申诉路径 | 影响风险预案 |
| 6 | HNP `independentSign: true` 的**签名渠道**（社区称须走华为签名通道，官方未载明） | 决定 HNP 独立签名是否可自建流程 |
| 7 | `ACCESS_USER_FULL_DISK` 与 `READ_WRITE_USER_FILE` 在**上架审核**中的口径差异 | 决定 §3.2 A2-d 选哪一个 |

> 建议：把 1–3 与二进制证书工单**一并**提问 —— 一次沟通覆盖三个关键未知项。

---

## 11. 来源与出处

| # | 主题 | 出处 |
|---|---|---|
| 1 | 二进制证书定义（「二进制程序需使用二进制证书签名，才能在鸿蒙PC上正常运行」） | [AGC 证书概述](https://developer.huawei.com/consumer/cn/doc/doccenter-getting-started/agc-help-cert-overview-0000002283343885) |
| 2 | AGC `certType: 4` 二进制证书 + 「受限开放，可通过在线工单系统与我们联系」 | [AGC 申请证书 API](https://developer.huawei.com/consumer/cn/doc/doccenter-submission/agc-help-provision-api-apply-cent-0000002236201302) |
| 3 | HAP 集成 bin（`executableBinaryPaths`、`.permission` 节、安装期约束、`collectAllLibs`） | [应用程序包集成bin文件（PC/2in1）](https://developer.huawei.com/consumer/cn/doc/doccenter-getting-started/hap-bin) |
| 4 | ACL 申请机制、30 个/次、结果一起返回、获批写入 Profile、Profile 重建 | [声明权限（ACL）](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/declare-permissions-in-acl) |
| 5 | 受限开放权限清单（`ALLOW_EXTERNAL_NATIVE_CODE`、`LOAD_INDEPENDENT_LIBRARY`、`READ_WRITE_DESKTOP_DIRECTORY`、`ACCESS_USER_FULL_DISK`、`READ_WRITE_USER_FILE`、`SUPPORT_PLUGIN` 等） | [restricted-permissions.md](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/security/AccessToken/restricted-permissions.md) |
| 6 | 开放权限清单（`INHERIT_PARENT_PERMISSION`、`kernel.IGNORE_LIBRARY_VALIDATION`、`kernel.EXEMPT_ANONYMOUS_EXECUTABLE_MEMORY`、`INTERNET`、`KEEP_BACKGROUND_RUNNING` 等） | [permissions-for-all.md](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/security/AccessToken/permissions-for-all.md) |
| 7 | ELF 代码签名工具（`sign` / `display-sign` / `-selfSign`） | [binary-sign-tool.md](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/tools/binary-sign-tool.md) |
| 8 | 强制代码签名机制（「签名工具默认开启代码签名」） | [hapsigntool-overview.md](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/security/hapsigntool-overview.md) |
| 9 | `hnpPackages` / `executableBinaryPaths` 字段定义（API 24、仅 PC/2in1） | [module-configuration-file.md](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/quick-start/module-configuration-file.md) |
| 10 | HNP 打包/安装/软链/验签/开发者模式 | [hnp_wiki.md](https://github.com/openharmony/startup_appspawn/blob/master/docs/hnp_wiki.md) · [HNP installer README](https://github.com/openharmony/startup_appspawn/blob/master/service/hnp/installer/README_zh.md) |
| 11 | 区域限制（海外仅亚太与欧洲） | 同 4 |
| 12 | 应用 seccomp 策略 | OpenHarmony docs `zh-cn/device-dev/subsystems/subsys-boot-init-seccomp.md` |
| 13 | `symlink` / `chmod` 对**第三方应用（应用域）**不可用（`cl.filemanagement.2`，SDK 4.1.5.2，`13900012`）。⚠️ **2026-09-22 真机实测限定**：该限制**按 SELinux 域生效** —— **shell 域**（`id` → `context=u:r:sh:s0`）下 `ln -s` **成功**、`chmod 640` **生效**；被禁的只是**应用域**。**硬链接**（`ln` 无 `-s`）则**两边都被拒**。故本表结论须读作「应用域不可用」，不可写成「平台全局禁止」 | [changelogs-filemanagement.md](https://github.com/openharmony/docs/blob/master/zh-cn/release-notes/changelogs/OpenHarmony_4.1.5.2/changelogs-filemanagement.md) |
| 14 | **第一手权限目录**（本清单所有 level / since / grantMode / provisionEnable / deviceTypes 的取值依据） | 本机 SDK：`sdk/default/openharmony/toolchains/lib/PermissionDefinitions.json` |

---

## 12. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v2 | 2026-09-18 | 首版落盘。确立 §2 判定规则；给出 A1 二进制证书工单口径与 A2 四项 ACL 批次；**更正**「仅中国大陆账号可申请 ACL」的错误前提（实为海外仅亚太与欧洲）；**更正**「本工程未声明 `INTERNET`」的错误判断（实际已声明，见 §8）；明确执行 `/system/bin/sh` 无可申请权限；明确四个插件权限不申请 |
