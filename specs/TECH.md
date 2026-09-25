# TECH.md — 技术选型

> dsh-desktop-hos 技术栈选型、版本与依赖说明。
> Last Updated: 2026-09-04

## 1. 技术栈总览

| 类别 | 技术 | 版本 | 用途 |
|---|---|---|---|
| 运行时 | Electron-on-鸿蒙（harmonypc-electron） | Electron 37（v37.2.3） | 鸿蒙设备上的 Electron 运行时（原生 SO + ArkTS 桥接层） |
| 内置 Node | Node.js | 22.17.0 | 主进程 JS 运行时（承载 dsh Host） |
| 目标系统 | HarmonyOS | 6.1.0.135（API 24） | 真机验证环境 |
| 目标 SDK | targetSdkVersion | 6.1.1(24) | build-profile.json5 |
| 兼容 SDK | compatibleSdkVersion | 5.0.5(17) | build-profile.json5 |
| 宿主 | deepseek-harness（dsh） | dsh-v0.1.2-rc.1（patch 基线） | agent harness（「一切皆插件」，Cordis 驱动） |
| 插件市场 | dsh-market | 1.26.0 | 可视化插件市场（物化为 dshmarket bundle） |
| 架构参考 | dsh-desktop | — | 仅架构设计参考，不参与构建 |
| 包管理 | pnpm | 11 | dsh / dsh-market 依赖安装与构建 |
| 构建 | hvigor（DevEco Studio） | 4.0+ | 鸿蒙 HAP 构建 + 签名 |
| 语言 | ArkTS / TypeScript / Node.js（CJS） | — | 桥接层 ArkTS；主进程 CommonJS |

## 2. 原生模块（SO）清单

| SO | 来源 | 大小 | 作用 |
|---|---|---|---|
| `libelectron.so` | harmonypc-electron（Electron 37 编译产物） | ~172.7MB | Electron 主运行时 |
| `libadapter.so` | harmonypc-electron | — | 注册原生方法（`getNativeContext` + `bindFunction`） |
| `libffmpeg.so` | harmonypc-electron | — | 媒体编解码 |
| `libc++_shared.so` | DevEco SDK（aarch64-linux-ohos LLVM lib） | — | C++ 运行库（better-sqlite3 依赖，collect-runtime 注入） |

> 桥接三件套：`aki`（libaki_jsbind.so，JS 绑定框架）+ `adapter`（libadaptertest.so）+ `addon`（electron-addon.node 链 libshim.a），运行时已编译好，本工程无需自建。

## 3. 依赖清单

### 3.1 根工程（oh-package.json5）

| 依赖 | 版本 | 用途 |
|---|---|---|
| `@ohos/hypium` | 1.0.25 | 测试框架（dev） |
| `@ohos/hamock` | 1.0.0 | mock 框架（dev） |

### 3.2 web_engine 模块（oh-package.json5）

| 依赖 | 版本 | 用途 |
|---|---|---|
| `inversify` | ^6.0.1 | ArkTS 侧依赖注入（Adapter 注册） |
| `reflect-metadata` | ^0.1.13 | 装饰器元数据（inversify 依赖） |
| `libadapter.so` | file:./src/main/cpp/types/libadapter | 原生模块 TS 类型（dev） |

### 3.3 desktop profile（profiles/desktop/package.json）

| 依赖 | 版本 | 用途 |
|---|---|---|
| `dshmarket` | 1.26.0 | 插件市场 bundle |

## 4. 关键决策与理由

| 决策 | 理由 |
|---|---|
| Electron 37 / Node 22.17.0（弃 Electron 34 / Node 20.18.1） | dsh 依赖 `node:zlib.createZstdDecompress`（解压会话产物），Electron 34 的 Node 20.18.1 不具备；Electron 37 可用（§18.1） |
| better-sqlite3（Node ABI v138）替代 `node:sqlite` | OpenHarmony aarch64 需原生 SQLite；`@deepseek-ai/dsh-sqlite` 兼容层统一加载 better-sqlite3 |
| sharp → 纯 JS stub | libvips 在鸿蒙 aarch64 不可用；stub 按容器头解析真实 metadata（不做解码/缩放/编码），限额内本就干净的 8-bit sRGB PNG/JPEG/WebP 可原样通过，需转换的图片明确报错 |
| node-pty / koffi → 禁用 | win32-x64 二进制无法在 aarch64 加载（终端/沙箱取舍） |
| dsh-dist 压缩为 dsh-dist.tar.gz | HAP 内 5 万+ 小文件导致 hvigor 打包超限；单文件压缩 + 运行时流式解压 |
| webserver 绑 0.0.0.0 + 局域网 IP 加载 | 鸿蒙 NEXT 渲染进程访问 127.0.0.1 被 loopback 网络隔离 |
| 直接 pnpm（弃 corepack pnpm） | 鸿蒙构建环境 corepack 不可用 |

## 5. 构建/运行环境要求

| 项 | 要求 |
|---|---|
| DevEco Studio | 4.0+ |
| HarmonyOS SDK | API 17+（targetSdk 6.1.1(24)） |
| Node | 18+（构建脚本） |
| pnpm | 11 |
| HDC | 安装/启动调试 |

## 6. 与 desktop 的技术差异

| 维度 | dsh-desktop | 本工程（harmony） |
|---|---|---|
| 运行时 | 官方 Electron（npm 依赖） | Electron-on-鸿蒙（构建期 copy SO + ArkTS 桥接） |
| UI 加载 | `loadURL(localhost)` | `loadURL(局域网 IP)` + Host 头改写为 loopback |
| 桌面能力注入 | Electron `Tray`/`Notification` | 桥接 ArkTS（`*AdapterBind` + addon） |
| 构建 | Electron Forge（Vite + make） | hvigor（DevEco Studio）产 HAP |
| 分发 | 本地打包 exe/deb/rpm | 签名 HAP + `hdc install` |
| 主进程入口 | host.ts + index.ts（ESM） | main.js（CommonJS 单文件） |
