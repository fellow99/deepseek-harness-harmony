[English](./README.md) | 中文

---

# DeepSeek Harness HarmonyOS 桌面版

> 基于「Electron-on-鸿蒙」运行时（[harmonypc-electron](https://atomgit.com/jianguoxu/harmonypc-electron)，Electron 37 / Node 22.17.0）的 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 桌面封装——在鸿蒙设备的 Electron 主进程内跑 dsh Host（含 webserver），渲染进程同源加载 dsh Web UI，界面 100% 复用 dsh Web UI。

**版本**：`0.1.5` · **状态**：✅ 已真机验证——HarmonyOS 6.1.0.135（API 24），Electron 37 / Node 22.17.0，dsh Web UI 正常运行（核心聊天 / agent / 工具调用 / Web UI 全部可用）。完整工程规划与最终实现记录见 [docs/工程规划.md](docs/工程规划.md)。

---

## 当前版本

| 字段 | 值 |
|---|---|
| `versionName` | `0.1.5` |
| `versionCode` | `1005` |

来源：`AppScope/app.json5`。`versionCode` 必须为数字，且每次向 AppGallery 提交都必须**严格递增** —— 见[应用市场上架](#应用市场上架)。

---

## 这是什么

DeepSeek Harness（`dsh`）是 DeepSeek AI 开源的 agent harness，基于「一切皆插件」架构（由 [Cordis](https://github.com/cordiverse/cordis) 驱动），原生入口是 `dsh web`（浏览器 Web UI）。

本工程把 dsh Web UI 封装进鸿蒙原生桌面壳（Electron-on-鸿蒙运行时），100% 复用 dsh 前端，让 agent harness 在鸿蒙设备上像一等公民桌面应用一样运行。它**不是**「包一层 `dsh web` 指向 localhost」的粗壳，而是构建在 dsh 现有架构之上、对标 `deepseek-harness-desktop` 的一等公民桌面应用。

## 核心设计

dsh 已完成 **Host/Client 分层**，其 webserver **同时服务 SPA dist 与 `/api`**。本工程因此采用**进程内 Host + webserver + 同源数据面**：

```
┌─ 鸿蒙 HAP ──────────────────────────────────────────────────────┐
│  electron 模块（entry）：EntryAbility 启动 Electron-on-鸿蒙运行时 │
│  web_engine 模块（HAR）：ArkTS 桥接层 + resfile 承载 dsh 产物     │
│         ┌─ Electron 主进程（Node.js，承载 dsh Host）────────────┐│
│         │  main.js: 解压 dsh-dist.tar.gz → runProfile('desktop')││
│         │    ├─ webserver ← 0.0.0.0:<空闲端口>，服务 dist + /api ││
│         │    ├─ apiProxy  ← RPC 网关                            ││
│         │    └─ connection ← /api + WebSocket 注册              ││
│         │  就绪后 loadURL(http://<局域网 IP>:<port>/)            ││
│         └────────────────────▲─────────────────────────────────┘│
│                              │ 同源（无 CORS/鉴权）+ Host 头改写  │
│         ┌────────────────────┴─────────────────────────────────┐│
│         │ 渲染进程：loadURL(局域网 IP) ← 同源                    ││
│         │   标准 dsh Web UI（WebApiClient：fetch /api + WS 事件）││
│         └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

关键点：**渲染进程同源加载——零 CORS、零鉴权、零自定义协议、零 IPC 载体**——复用 dsh 现有 `WebApiClient`（HTTP 上行 + WebSocket 下行），**对 dsh 零上游改动**（仅 6 个 patch）。

**与 desktop 的差异**（鸿蒙独有适配，详见 `docs/工程规划.md` §18）：

- 鸿蒙 NEXT 下渲染进程访问 `127.0.0.1` 存在 **loopback 网络隔离** → webserver 绑 `0.0.0.0`、渲染进程走局域网 IP 建连，并在内嵌渲染进程请求出栈前把 `Host`/`Origin` 改写为 `127.0.0.1:<port>` 以通过 dsh 的 loopback-only 特权方法围栏（安全语义不变，局域网其他设备仍 403）。
- 鸿蒙沙箱禁 symlink（`EACCES`）→ dsh profile 回退 `cpSync` 递归拷贝（patch）。
- 鸿蒙沙箱中 `os.homedir()` 返回沙箱外目录（`EPERM`）→ 主进程启动前把 `HOME` 指向沙箱可写目录 `userData`。

## MVP 能力

- ✅ dsh Web UI 在窗口内运行（100% 复用 dsh 前端）
- ✅ 会话持久化 / 全文搜索（better-sqlite3，Electron 37 / Node ABI v138 aarch64 成品，由 collect-dsh 注入）
- ✅ 插件市场（dsh-market 内置）
- ✅ 窗口状态持久化（最大化/位置尺寸）+ F11 全屏
- ⚠️ 图片附件校验/缩略图（sharp 纯 JS stub，no-op）
- ❌ 终端（bash 工具，node-pty 无 aarch64 产物）
- ❌ 进程沙箱（koffi / landlock）

（二期：系统托盘、无边框窗口、开机自启；原生文件选择器复用 dsh 标准前端目录浏览）

## 目标平台与分发

- **平台**：HarmonyOS 2in1 / tablet（`deviceTypes: ["2in1", "tablet"]`）
- **分发**：本地 debug 签名 HAP 供开发调试（DevEco 自动签名 + 华为证书），**并上架 AppGallery** —— 用华为签发的**发布证书 + 发布 Profile**构建 release 签名的 App Pack（`.app`）（见[应用市场上架](#应用市场上架)）。自动更新尚未实现。

## 技术栈

- **Electron-on-鸿蒙**（harmonypc-electron，Electron 37 / Node 22.17.0）—— 原生 SO + ArkTS 桥接层（aki / adapter / addon + libshim.a）
- **ArkTS / ArkUI**（Stage 模型，`web_engine` HAR 桥接：~46 Adapter + ~44 AdapterBind）
- **deepseek-harness**（`dsh`，同级目录 `../deepseek-harness`，非 submodule，源码引用）—— 当前构建基于 **`dsh-v0.1.5-rc.2`**，其补丁位于 `patches/dsh-v0.1.5-rc.2/`
- **dsh-market**（同级目录 `../dsh-market`，npm 包 `dshmarket`，内置插件市场）
- **hvigor / DevEco Studio**（HAP 构建 + 签名）

## 开发

### 集成方式

- **运行时 copy**：`harmonypc-electron` 为同级鸿蒙工程（非 npm 包），构建期 `collect-runtime.mjs` 把其 `electron` + `web_engine` 模块 + 3 个 SO 物理 copy 进本工程（sibling 存放、产物内嵌），并注入 `libc++_shared.so`。
- **源码引用**：dsh 与 dsh-market 为同级目录源码引用（非 submodule），构建期 patch + build + 收集产物。
- **Host 集成**：`src-main/main.js` 动态 import dsh 的 `runProfile`（`apps/cli` 构建产物），进程内挂起 dsh Host（webserver 绑 `0.0.0.0`），返回 `{ ctx, shutdown, port, url }` 句柄。
- **同源数据面**：渲染进程 `loadURL(http://<局域网 IP>:<port>/)` 同源加载 dsh Web UI，复用 `WebApiClient`——零 CORS、零鉴权、零新载体。
- **desktop profile**：`profiles/desktop/`（`dsh.profile.bundles = [dsh-base, dsh-web-app, dshmarket]`，cordis.patch.yml 覆盖 `web-runtime.printUrl: false`、`webserver.host: 0.0.0.0`），运行时复制到 `$DSH_HOME/profiles/desktop`。

### 构建流程（四阶段 + 6 个 patch）

dsh 依赖的 Node 内建 API（HMR、原生目录对话框）与鸿蒙沙箱（symlink、loopback 隔离）冲突，需先应用 6 个 patch（幂等——`--reverse --check` 检测已应用则跳过）：

流水线共 **四阶段**（⓪–③），之后是本机构建 + 签名步骤（④）。阶段 ⓪ 是运行时同步：它强制覆盖上游运行时，**并重新施加本工程自己的定制**（prune + overlay），因此必须始终第一个运行。

```bash
# ⓪ 同步运行时 + 重新施加应用定制：copy ../harmonypc-electron 的 electron + web_engine
#    模块 + 3 个 SO + libc++_shared.so，prune 不需要的上游文件，再 overlay 回盖 runtime-overlays/
node scripts/collect-runtime.mjs

# ① 构建 dsh：清理 workspace 残留 → apply 6 patch → pnpm build host/client/web → build ../dsh-market
node scripts/build-dsh.mjs

# ② 收集 dsh 产物：pnpm deploy 物化 → 补包 → sharp stub → better-sqlite3 注入 → web dist + profile + dshmarket
node scripts/collect-dsh.mjs

# ③ 压缩 dsh-dist 为 dsh-dist.tar.gz（--format=ustar，~143MB，运行时流式解压）
tar -czf web_engine/src/main/resources/resfile/resources/app/dsh-dist.tar.gz --format=ustar -C . dsh-dist

# ④ 构建 + 签名（专用入口；配置/SIGN_MODE 见「签名」与「运行」）
#    powershell -ExecutionPolicy Bypass -File scripts\build-debug.ps1      # debug（默认 -Task Hap）
#    powershell -ExecutionPolicy Bypass -File scripts\build-release.ps1    # release（默认 -Task App）
```

#### 运行时 overlay + prune（应用定制）

阶段 ⓪（`scripts/collect-runtime.mjs`）对上游运行时（`../harmonypc-electron/ohos_hap` → `electron/` + `web_engine/`）做**整目录** `cpSync(..., { recursive: true, force: true })` 覆盖本工程，因此**任何未被后续阶段重新施加的应用定制都会被静默回退**。本工程用两个机制保护自己的改动：

- **prune（阶段 1b）** —— 删除本应用不使用的 4 个上游蓝牙文件：`BluetoothAdapter.ets`、`BluetoothLowEnergyAdapter.ets` 及其两个 `*Bind.ets` jsbinding。删除前先断言每个文件存在：缺失即**硬失败**，提示上游结构漂移需重新评估（绝不静默跳过）。
- **overlay（阶段 3）** —— 把 `OVERLAY_FILES` 中每个文件从 `runtime-overlays/<相同相对路径>` 回盖到工程。当前 8 项：两个 `module.json5`（`electron` + `web_engine`）、`electron/src/main/resources/base/profile/shortcuts_config.json`、`web_engine` 的 `MediaAdapter.ets` 与 `JsBindingMethod.ets`，以及 3 个 locale `string.json`（`base` / `en_US` / `zh_CN`）。
- `OVERLAY_PRE_REWRITE_FILES`（1 项：`web_engine/src/main/ets/adapter/PermissionManagerAdapter.ets`）在阶段 3 回盖，但**同时**也是阶段 4（bundleName 字面量替换）的目标。因此其 overlay 副本刻意保留通用字面量 `com.huawei.ohos_electron`，由阶段 4 替换为 App bundleName。由于阶段 4 后源与目标本就不同，它**排除**在阶段 7.6 的 md5 一致性守卫之外，改由阶段 7.4 与新增守卫 7.9 保障。
- **守卫** —— 7.8 断言 `PRUNE_FILES` 每个文件必须不存在；7.9 断言 `OVERLAY_PRE_REWRITE_FILES` 每个条目的 overlay 源仍含通用字面量、目标含 App bundleName 且已无通用字面量。

**保护新的应用定制：** 把改动后的文件放到 `runtime-overlays/<相同相对路径>`，把其相对路径加入 `collect-runtime.mjs` 中正确的列表（`OVERLAY_FILES` / `OVERLAY_PRE_REWRITE_FILES` / `PRUNE_FILES`），然后跑 `node scripts/collect-runtime.mjs` 验证。`collect-runtime.mjs` 需要 `DEVECO_SDK_HOME`；`--verify-only` 只跑守卫。

### 签名（外置，密钥永不入库）

签名材料**外置**，`build-profile.json5` 因此保持无密钥、可安全入库。共有**两个** gitignored 配置文件，每个签名模式一个：

| 模式 | 配置（gitignored） | 入库样例 |
|---|---|---|
| `debug` | `signing.debug.local.json` | `signing.debug.local.json.sample` |
| `release` | `signing.release.local.json` | `signing.release.local.json.sample` |

两个文件 schema 相同（相对路径相对工程根解析）：

```json5
{
  "certpath":      ".ohos/release/release.cer",
  "storeFile":     ".ohos/release/release.p12",
  "profile":       ".ohos/release/release.p7b",
  "keyAlias":      "debugKey",            // 可选，默认 "debugKey"
  "keyPassword":   "<hvigor DecipherUtil AES-GCM 密文 hex>",
  "storePassword": "<hvigor DecipherUtil AES-GCM 密文 hex>",
  "signAlg":       "SHA256withECDSA"      // 可选，默认 SHA256withECDSA
}
```

模式由环境变量 **`SIGN_MODE`**（`debug` | `release`）选择；未设置则默认 `debug`；其他任何值都**硬失败**——绝不静默回退到 `debug`。

- **`hvigorfile.ts`** —— 在 `afterNodeEvaluate` 按优先级解析 `app.signingConfigs`：
  1. CI 环境变量：`CERTPATH` / `STORE_FILE` / `STORE_PASSWORD` / `KEY_PASSWORD` 四项齐全（可选 `PROFILE` / `KEY_ALIAS` / `SIGN_ALG`）
  2. `signing.<SIGN_MODE>.local.json`
  3. 都没有 → **不修改** `signingConfigs`，并打印醒目警告指明缺失路径（构建产出未签名 / IDE 自动签名的包）
- 注入**仅在内存**（`setBuildProfileOpt`）：**`build-profile.json5` 以 `"signingConfigs": []` 入库**，永不写盘。
- **`scripts/build-hap.ps1`** —— CLI 构建 + 签名，使用 DevEco 自带的 JBR（规避 Temurin/sdkman JDK 21 在 `hap-sign-tool.jar` 中的 `Invalid CEN header` zip64 失败）。它为 hvigor 子进程设置 `SIGN_MODE`。

> 任一配置里的 `keyPassword` / `storePassword` 都必须是 hvigor DecipherUtil 的 AES-GCM 密文（≥32 位 hex，非明文），且 `.p12` 同级目录需有 `material/{fd,ac,ce}` 密钥链——否则签名失败。

> **构建后签名断言。** 构建成功后，`build-hap.ps1` 用 SDK 的 `hap-sign-tool verify-app` 解出产物内嵌 provisioning profile 的 `type`，与请求的 `-SignMode` 比对；不一致即醒目报错并非零退出。（`.p7b` 是二进制，故用 Latin-1 逐字节映射 + 括号配平定位其中的 profile JSON。）此守卫的存在原因：本项目曾出现 release 构建被静默用 debug 材料签名。

> **dsh 版本锚定**：本工程基于 deepseek-harness tag **`dsh-v0.1.5-rc.2`** 构建。补丁按 dsh 版本分目录存放（`patches/<dsh-tag>/`），`scripts/build-dsh.mjs` 固定指向 `patches/dsh-v0.1.5-rc.2/` —— 升级到新的 dsh tag 时，需新增对应的 `patches/<新 tag>/` 目录并更新该指向。

| Patch | 目的 |
|---|---|
| `patches/dsh-v0.1.5-rc.2/dsh-symlink-to-copy.patch` | 鸿蒙沙箱禁 symlink（`EACCES`）→ 回退 `cpSync` 递归拷贝 |
| `patches/dsh-v0.1.5-rc.2/dsh-allow-all-interfaces.patch` | 移除 webserver `--host 0.0.0.0` 拒绝检查（loopback 隔离需绑全网卡 + 局域网 IP） |
| `patches/dsh-v0.1.5-rc.2/dsh-disable-hmr.patch` | `DSH_DISABLE_HMR` 开关，跳过依赖 `--expose-internals` 的 watch-only HMR |
| `patches/dsh-v0.1.5-rc.2/dsh-disable-native-picker.patch` | 目录选择器走 browse（原生 dialog worker 在 Electron 下 spawn 失败） |
| `patches/dsh-v0.1.5-rc.2/dsh-flock-openharmony.patch` | openharmony 平台以进程内方式放行 POSIX flock 写锁（无原生插件；单进程宿主，同 dsh 浏览器 worker stub 语义） |
| `patches/dsh-v0.1.5-rc.2/dsh-hardlink-to-rename.patch` | 鸿蒙沙箱禁硬链接（`EACCES`）→ 以同目录 `rename` 独占发布，其余环境仍保持 `link` 优先 + `EEXIST` 语义（会话日志首次落盘 + 代际发布） |

**前置——同级工程 checkout**：本工程消费 3 个同级工程（非 submodule），构建前需放到同级目录：

```bash
git clone --branch dsh-v0.1.5-rc.2 https://github.com/deepseek-ai/deepseek-harness.git ../deepseek-harness
git clone --branch v1.26.0           https://github.com/dsh-market/dsh-market.git       ../dsh-market
# ../harmonypc-electron 为 Electron-on-鸿蒙运行时工程，需解压 Electron 37 编译产物补齐 3 个 SO
```

`collect-runtime.mjs` 校验 3 个 SO（`libelectron.so`/`libadapter.so`/`libffmpeg.so`）缺失即报错；`collect-dsh.mjs` 在 `../dsh-market` 缺失时硬失败（打包产物内置 `dsh-dist/node_modules/dshmarket`）。

### 运行

用专用脚本构建（配置/`SIGN_MODE` 细节见[签名](#签名外置密钥永不入库)）：

```powershell
# debug（默认 task：Hap）—— debug 签名的包**可以**侧载
powershell -ExecutionPolicy Bypass -File scripts\build-debug.ps1

# release（默认 task：App）—— 产出 build\outputs\default\*-signed.app
#   + build\outputs\default\symbol\release\app-symbol.zip
powershell -ExecutionPolicy Bypass -File scripts\build-release.ps1

# release 编译 + debug 签名 —— 真机回归需要
powershell -ExecutionPolicy Bypass -File scripts\build-hap.ps1 -BuildMode release -SignMode debug
```

`scripts/build-hap.ps1` 是引擎（参数：`-Task Hap|App`、`-BuildMode debug|release`、`-SignMode auto|debug|release`，以及 `-JbrHome -SdkHome -NodeHome -Hvigorw -DevEcoHome`）；`-SignMode auto`（默认）跟随 `-BuildMode`。两个薄包装固定各自的默认值：`build-debug.ps1` 固定 `-BuildMode debug -SignMode debug`，`build-release.ps1` 固定 `-BuildMode release -SignMode release`。

经 HDC 安装 debug 包并启动：

```bash
hdc tconn <设备IP>:<端口>   # 先建立无线（IP）调试连接；端口见设备 开发者选项 → 无线调试
hdc uninstall org.fellow99.DeepseekHarnessHarmony   # 首装/换产物需先卸载，清掉旧 userData 中过期 dsh-dist
hdc app install -r electron/build/default/outputs/default/electron-default-signed.hap
hdc shell aa start -a EntryAbility -b org.fellow99.DeepseekHarnessHarmony
```

> ⚠️ **发布签名的包无法侧载。** 对 release 签名的包执行 `hdc app install` 会报 `code:9568322 ... signature verification failed due to not trusted app source`。真机回归请用 `-BuildMode release -SignMode debug`（release 编译 + debug 签名）；release 签名的包只用于 AppGallery 提交。

> 环境要求：DevEco Studio 4.0+、HarmonyOS SDK API 17+（targetSdk 6.1.1(24)）、Node 18+、pnpm@11、HDC。

### 签名与受限权限（完整流程）

在 provisioning profile（`.p7b`）授予 `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY`（`system_basic` 级受限权限、`system_grant`，仅平板/2in1）之前，应用无法安装。获取方式有两条：

**A. 发布路径（AppGallery）—— 在 AGC 以 ACL 方式申请该权限**

受限权限**不是**靠手改 profile 获得的。应用在 AppGallery Connect 申请 **ACL**（跨级别权限），华为审核使用场景，审批通过的权限会在创建发布 Profile 时**自动写入** profile —— 因此发布签名路径完全不需要手工处理 `.p7b`。

1. AGC → 开发与服务 → 你的项目 → 你的应用 → `项目设置` → **ACL权限** 页签。
2. 在「未获取权限」勾选「我已知晓」，选择 `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY`，提交申请
   （单次申请最多 **30** 项；须等上一次审批完成后再提交新申请）。
3. 审核（约 **3 个工作日**）检查权限是否符合应用使用场景 —— 本应用启用了自带引擎的 JIT 编译、仅平板/2in1、不将权限用于热更新，并适配坚盾模式（JShield）。
4. 审批通过后再在 AGC 创建**发布 Profile** —— 已授予的 ACL 权限会自动写入其中。**若 Profile 创建后 ACL 权限发生变更，必须重新创建 Profile。**
5. 目前仅**账号归属地为中国大陆**的开发者可用 ACL 权限。

完整发布证书 / 发布 Profile 流程见[应用市场上架](#应用市场上架)。

**B. 调试路径 —— 在 DevEco 重新生成调试 Profile（与以往一致）**

`.p7b` provisioning profile 由华为签名 —— 它**无法在本地重新生成**（无本地 profile 签名 CA；编辑 SDK 的 `Unsigned*ProfileTemplate.json` 不会自动重生成既有 `.p7b`）。默认的 DevEco 调试 profile **不**授予该受限权限，因此安装 debug 包会报：

> `install failed due to grant request permissions failed. PermissionName: ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY`

在 DevEco Studio 重新生成：

1. 在 DevEco Studio 打开工程。
2. `File → Project Structure → Signing Configs`。
3. 勾选 **Automatically generate signature**，用华为开发者账号登录。
4. DevEco 会在 `~/.ohos/config/` 重新生成调试密钥库 + provisioning profile
   （`<bundle>_…=.p12/.cer/.p7b` + `material/` 密钥链）。
5. 确保请求的权限包含该受限权限。模块已声明它（`web_engine/src/main/module.json5` → `requestPermissions` + `definePermissions`
   → `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY`）。对 `normal`-APL 应用的跨级别（ACL）授权，DevEco 的签名对话框会列出该受限权限待批准；
   接受它，使重生成的 `.p7b` 在 `acls.allowed-acls` 中携带它。
6. 把 `signing.debug.local.json` 指向重生成的签名材料（样例：
   `signing.debug.local.json.sample`；写相对工程根的路径即可）。

**构建 + 签名**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-debug.ps1     # debug
powershell -ExecutionPolicy Bypass -File scripts\build-release.ps1   # release（App Pack）
```

`build-hap.ps1` 会在每次构建后校验产物内嵌 profile 的 `type` 是否与请求的签名模式一致（见[签名](#签名外置密钥永不入库)）。

**安装与启动**

```bash
hdc uninstall org.fellow99.DeepseekHarnessHarmony
hdc app install -r electron/build/default/outputs/default/electron-default-signed.hap
hdc shell aa start -a EntryAbility -b org.fellow99.DeepseekHarnessHarmony
```

> 若 debug 包仍报权限授予失败，说明 `.p7b` 尚未携带该受限权限 —— 重复上面的 DevEco 重生成（确认 ACL 审批已通过）后再重新构建。
> **release** 签名的包永远无法以此方式安装；release 签名只用于 AppGallery。

## 应用市场上架

分发不再只是「自用 HAP」：上架 **AppGallery** 已是目标。AppGallery **只接受**用华为签发的**发布证书 + 发布 Profile** 签名的包 —— debug 签名的包无法上架。

### 前置条件

- **已实名认证**的华为开发者账号 —— 创建发布证书的前提。
- 本应用所需的 ACL 权限目前仅对**账号归属地为中国大陆**的开发者开放。
- 资质材料：AGC 的发布准备工作会要求隐私声明、电子版权证书、应用版权证书或代理证书，以及核准/备案等 —— 具体清单请在 AGC「发布准备工作」页确认。非游戏类应用的软件著作权（软著）是**非强制**资质（建议的变体：计算机软件著作权登记证书 / APP 电子版权证书 / 软件著作权认证证书）；游戏另需版号。

### 体积上限

| 产物 | 上限 |
|---|---|
| App Pack（`.app`） | ≤ **4GB** |
| HAP —— PC/2in1、平板、手机 | ≤ **4GB** |
| HAP —— 智能手表 / 智能大屏 | ≤ 2GB |
| HAP —— 运动手表 | ≤ 20MB |

本工程发布 HAP ≈360MB、App Pack ≈245MB —— 远低于上限。HAP 不得为 `installationFree`，`bundleType` 须为 `app`。

### 1. 创建发布证书

AGC → `证书、APP ID和Profile` → `证书` → `新增证书`，类型选**发布证书**，上传 `.csr`（由 DevEco Studio 的 `Build > Generate Key and CSR` 或 `keytool` 生成），然后下载 `.cer`。

- 每账号最多 **3 个**发布证书；已实名认证开发者有效期 **3 年**。
- 更新发布证书后，发布 Profile 也需同步更新。

### 2. 申请受限权限（ACL）

AGC → 开发与服务 → 你的项目 → 你的应用 → `项目设置` → **ACL权限** 页签 → 「未获取权限」勾选「我已知晓」→ 选择 `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY` → 申请。

- 单次申请最多 **30** 项；须等上一次审批完成后再提交新申请。
- 部分权限需填 申请原因（≤256 字）、选择 使用场景，并可附证明材料。
- 申请后审核约 **3 个工作日**。
- 审批通过后权限出现在「已获取权限」，创建 Profile 时会**自动写入** Profile。**若 Profile 创建后 ACL 权限发生变更，必须重新创建 Profile。**
- 另有「试用调试Profile」：有效期 5 天，每应用最多 5 个。

该权限官方分类为 level `system_basic`、grantMode `system_grant`、类型 受限开放权限、`startVersion` API 14；**仅平板与 PC/2in1 设备**可申请；仅限**启用了自带引擎 JIT 编译**的应用，**不允许用于热更新**；应用须主动适配**坚盾模式（JShield）**且在坚盾模式下不得崩溃。

### 3. 创建发布 Profile

AGC → `证书、APP ID和Profile` → `Profile` → `添加`，类型选**发布**，绑定包名 + 一个发布证书。与调试 Profile 不同，发布 Profile 的设备列表**为空**（不绑设备）。

### 4. 构建、版本与上传

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-release.ps1   # -Task App -BuildMode release -SignMode release
```

- 上传已签名的 App Pack：`build\outputs\default\*-signed.app`。
- 可选上传 `build\outputs\default\symbol\release\app-symbol.zip`，以便崩溃报告可符号化。
- `versionCode`（当前 `1005`）必须为数字，且每次后续提交必须**严格递增** —— 见[当前版本](#当前版本)。
- 官方审核指南中**没有** PC/2in1 独立审核赛道。提交时若软件包支持 PC/2in1 但「配置支持设备」未包含它，AGC 会提示更新支持的设备。

> **待确认：** AppGallery 上架本身的端到端审核时长（上文只记录了 ACL 审核约 3 个工作日），以及发布准备的确切材料清单 —— 两者都需在首次提交前从 AGC 页面确认。

## 目录结构

本工程与 3 个被消费工程、1 个架构参考工程**同级目录**存放（非 submodule）：

```
（同级目录）
├── deepseek-harness-harmony/      # 本工程（鸿蒙 HAP，桌面版鸿蒙移植）
│   ├── AppScope/                  # 应用 scope（图标/名称/签名）
│   ├── electron/                  # 入口模块（copy 自 harmonypc-electron，含 SO）
│   ├── web_engine/                # 桥接 HAR（ArkTS 桥接层 + resfile 承载 dsh 产物）
│   ├── src-main/                  # 主进程 main.js（解压 + runProfile + loadURL + 鸿蒙适配）
│   ├── scripts/                   # 四阶段构建：collect-runtime → build-dsh → collect-dsh，外加 build-debug / build-release
│   ├── runtime-overlays/          # 每次运行时 copy 后重新施加的应用定制（prune + overlay）
│   ├── profiles/desktop/          # 自定义 desktop profile（cordis.patch.yml + package.json）
│   ├── patches/                   # dsh 上游 patch（6 个）
│   ├── docs/                      # 工程规划与最终实现记录
│   └── specs/                     # 规范文档（as-built；见 specs/README.md 索引）
│
├── harmonypc-electron/            # Electron-on-鸿蒙运行时（Electron 37 / Node 22.17.0）
│   └── ohos_hap/                  # electron + web_engine 模块 + SO 源（collect-runtime copy 源）
│
├── deepseek-harness/              # 被封装宿主（dsh，源码引用，非 submodule）
│   ├── apps/                      # cli（dsh bin / profile-boot）、web（前端，build:web 产 dist）
│   ├── packages/                  # host / client / core / session 等 workspace 包
│   ├── vendor/                    # vendored cordis 框架包（cordis / loader / hmr / …）
│   └── native/                    # landlock-run 原生模块（Linux 沙箱，MVP 裁掉）
│
└── dsh-market/                    # 插件市场（源码引用，npm 包 dshmarket）
    ├── src/                       # host 半（挂 /dsh-market/* 路由）
    ├── client/                    # 浏览器半（设置页 UI）
    ├── lib/                       # 编译产物（物化进 dsh-dist/node_modules/dshmarket）
    └── cordis.patch.yml           # loader insert 声明（{ id: dsh-market, name: dshmarket }）
```

> `../deepseek-harness-desktop` 为**架构设计参考**（复用其架构决策 + patch + 主进程编排逻辑），不参与本工程构建/打包。

## 相关文档

- [docs/工程规划.md](docs/工程规划.md) — 完整工程规划 + 最终实现记录（Electron 37 落地、关键适配改动、MVP 取舍、交叉编译优化路径）
- [specs/README.md](specs/README.md) — 规范文档索引（项目级 + 9 模块 spec/plan，as-built）

## 参考资料

- [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（同级目录 `../deepseek-harness`）—— 被封装宿主；其 `docs/` 目录含完整架构文档
- [dsh-market](https://github.com/dsh-market/dsh-market)（同级目录 `../dsh-market`）—— 内置插件市场（npm 包 `dshmarket`），经 `collect-dsh.mjs` 物化
- [harmonypc-electron](https://atomgit.com/jianguoxu/harmonypc-electron)（同级目录 `../harmonypc-electron`）—— Electron-on-鸿蒙运行时
- [deepseek-harness-desktop](https://github.com/fellow99/deepseek-harness-desktop)（同级目录 `../deepseek-harness-desktop`）—— 架构设计参考（Electron 桌面壳）

## 许可证

[MIT](LICENSE) © 2026 fellow99
