# STRUCTURE.md — 目录文件结构

> deepseek-harness-harmony 整个工程的目录与文件结构记录（源码即真理，基于实际目录扫描生成）。
> Last Updated: 2026-09-04

## 1. 顶层目录

```
deepseek-harness-harmony/（鸿蒙 HAP 工程）
├── AppScope/          # 应用 scope：app.json5（包名 com.huawei.ohos_electron）+ 图标 + 签名配置
├── electron/          # 入口模块（type: entry，copy 自 ../harmonypc-electron，含原生 SO）
├── web_engine/        # 桥接 HAR（ArkTS 桥接层 + resfile 承载 dsh 产物）
├── src-main/          # 主进程编排源码（main.js，编译/复制到 resfile/resources/app/）
├── scripts/           # 三阶段构建脚本（collect-runtime / build-dsh / collect-dsh）
├── profiles/desktop/  # 自定义 desktop profile（cordis.patch.yml + package.json）
├── patches/           # dsh 上游 4 个 Electron/鸿蒙兼容 patch
├── docs/              # 工程规划文档（工程规划.md）
├── hvigor/            # hvigor 构建配置（hvigor-config.json5）
├── specs/             # 本规范文档集
├── build-profile.json5    # 根构建配置：modules = electron(entry) + web_engine(HAR)
├── hvigorfile.ts          # hvigor 根构建脚本
├── oh-package.json5       # 根 ohos 包清单（@ohos/hypium、@ohos/hamock 测试依赖）
└── code-linter.json5      # 代码检查配置
```

## 2. 模块清单（build-profile.json5 modules）

| 模块 | type | 路径 | 职责 |
|---|---|---|---|
| `electron` | entry | `./electron` | HAP 入口，承载 Electron-on-鸿蒙原生运行时 SO |
| `web_engine` | har | `./web_engine` | ArkTS 桥接层（Web 组件 + Adapter/Binding + resfile） |

> 注：原脚手架 `harness` 占位 entry 模块已移除（见 docs/工程规划.md §16 决策 2）；`chromium` 独立浏览器 demo 模块裁剪不 copy（§16 决策 1）。

## 3. 各模块目录结构

### 3.1 electron/（入口模块，copy 自运行时）

```
electron/
├── build-profile.json5          # 模块构建配置
├── oh-package.json5             # 模块包清单
├── hvigorfile.ts
├── obfuscation-rules.txt
├── libs/arm64-v8a/              # 原生 SO（构建期 copy，gitignore）
│   ├── libelectron.so           # ~172.7MB，Electron 37 运行时
│   ├── libadapter.so            # 原生方法注册（getNativeContext + bindFunction）
│   ├── libffmpeg.so             # 媒体
│   └── libc++_shared.so         # C++ 运行库（collect-runtime 从 DevEco SDK 注入）
└── src/
    ├── main/
    │   ├── module.json5         # EntryAbility / BrowserAbility / StatelessAbility / StatusBarEntryAbility / BrowserEmbeddedAbility
    │   ├── ets/
    │   │   ├── Application/AbilityStage.ets
    │   │   ├── entryability/    # EntryAbility.ets / BrowserAbility.ets / StatelessAbility.ets / StatusBarEntryAbility.ets / TaskManagerAbility.ets
    │   │   ├── extensionAbility/BrowserEmbeddedAbility.ets
    │   │   ├── pages/           # Index.ets / NodeHandleWindow.ets / QuickLoginButtonComponent.ets / WebPage.ets 等
    │   │   └── process/CustomChildProcess.ets
    │   └── resources/           # base/en_US/zh_CN 资源 + main_pages.json + shortcuts_config.json
    ├── ohosTest/                # 自动化测试（Ability.test.ets / TestAbility.ets）
    └── test/                    # 本地单元测试（LocalUnit.test.ets）
```

### 3.2 web_engine/（桥接 HAR，copy 自运行时）

```
web_engine/
├── Index.ets                    # HAR 导出入口（WebAbilityStage/WebAbility/WebWindow 等）
├── build-profile.json5 / oh-package.json5 / BuildProfile.ets / hvigorfile.ts
├── src/main/
│   ├── module.json5             # 权限声明（~28 个权限）+ type: har
│   ├── cpp/types/libadapter/    # libadapter 原生模块 TS 类型声明
│   ├── ets/
│   │   ├── ability/             # WebAbility.ets(21KB) / WebBaseAbility.ets / WebEmbeddedAbility.ets / ContinueAbility.ets 等
│   │   ├── adapter/             # ~50 个 Adapter（AppWindow/Notification/PasteBoard/Permission/Dialog/Display/FileManager…）
│   │   ├── jsbindings/          # ~50 个 AdapterBind + JsBindingMethod.ets（Node↔ArkTS 桥）
│   │   ├── components/          # WebWindow / WebSubWindow / WebEmbeddedWindow / WebWindowNode / WebNodeHandleWindow 等
│   │   ├── application/WebAbilityStage.ets
│   │   ├── common/              # AbilityManager / CommandLineAdapter / DragParamManager / WindowStyle 等
│   │   ├── interface/           # CommonInterface.ts / Dependency.ets / WebProxy.ets
│   │   ├── process/WebChildProcess.ets
│   │   └── utils/               # KVStore / LogUtil / GlobalContext / JsBindingUtils 等
│   └── resources/
│       ├── base|en_US|zh_CN/    # 字符串/颜色资源
│       └── resfile/             # 承载 Electron 运行时资源 + dsh 产物
│           ├── resources/app/   # ← dsh 产物收集目标（main.js + dsh-dist.tar.gz）
│           ├── electron/        # 运行时配置
│           ├── *.pak / icudtl.dat / v8_context_snapshot.bin / vulkan/  # Chromium 资源
│           └── locales/         # en-US.pak / zh-CN.pak
```

### 3.3 src-main/（自研主进程编排，单文件）

```
src-main/
└── main.js（537 行）            # 主进程入口：extractTarGz + startHost + BrowserWindow + 鸿蒙沙箱适配
```

### 3.4 scripts/（自研三阶段构建）

| 脚本 | 职责 | 行数 |
|---|---|---|
| `collect-runtime.mjs` | ① copy ../harmonypc-electron 的 electron + web_engine 模块 + 3 个 SO + 注入 libc++_shared.so + 恢复 main.js | 79 |
| `build-dsh.mjs` | ② 清理 workspace 残留 → apply 4 patch → pnpm build host/client/web + dsh-market | 120 |
| `collect-dsh.mjs` | ③ pnpm deploy 物化 → 补全 @deepseek-ai 包 → 写 sharp stub → 注入 better-sqlite3 → 复制 web dist + profile + dshmarket | 431 |

### 3.5 profiles/ + patches/（配置与补丁）

```
profiles/desktop/
├── package.json                 # dsh.profile.bundles = dsh-base + dsh-web-app + dshmarket；dependencies: dshmarket 1.26.0
└── cordis.patch.yml             # 覆盖：web-runtime(printUrl=false) / 禁用 subprocess|sandbox|bash-sandbox|permission / webserver(host=0.0.0.0) / dsh-market(profile=desktop, allowRestart=false)

patches/
├── dsh-symlink-to-copy.patch    # 鸿蒙沙箱禁 symlink（EACCES）→ cpSync 回退
├── dsh-allow-all-interfaces.patch  # 移除 webserver 0.0.0.0 拒绝检查
├── dsh-disable-hmr.patch        # DSH_DISABLE_HMR 跳过 watch-only HMR
└── dsh-disable-native-picker.patch  # 目录选择器走 browse（原生 dialog worker spawn 失败）
```

## 4. 关键配置位置

| 配置 | 路径 | 说明 |
|---|---|---|
| 应用签名 | `build-profile.json5` → app.signingConfigs | 含调试签名 material（注意：含硬编码口令，见安全审查） |
| 目标 SDK | `build-profile.json5` → targetSdkVersion `6.1.1(24)` | compatibleSdkVersion `5.0.5(17)` |
| 应用包名 | `AppScope/app.json5` | `com.huawei.ohos_electron` |
| 设备类型 | `electron/src/main/module.json5` deviceTypes | `["2in1", "tablet"]` |
| 权限声明 | `web_engine/src/main/module.json5` requestPermissions | ~28 项（INTERNET/PasteBoard/MICROPHONE/CAMERA 等） |
| 运行时产物收集目标 | `web_engine/src/main/resources/resfile/resources/app/` | main.js + dsh-dist.tar.gz |

## 5. 运行期数据目录（设备端）

| 目录 | 路径 | 说明 |
|---|---|---|
| 应用数据根 | `app.getPath('userData')`（`/data/storage/el2/base/files`） | 沙箱可写目录，同时被指为 HOME |
| dsh 产物 | `userData/dsh-dist/` | 首次启动从 dsh-dist.tar.gz 解压 |
| dsh 数据 | `userData/.dsh/`（DSH_HOME） | dsh 运行时数据 |
| desktop profile | `userData/.dsh/profiles/desktop/` | 运行时安装的 desktop profile |
| dshmarket | `userData/.dsh/profiles/node_modules/dshmarket/` | 插件市场物化目录 |
