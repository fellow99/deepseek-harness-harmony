[English](./README.md) | 中文

---

# DeepSeek Harness HarmonyOS 桌面版

> 基于「Electron-on-鸿蒙」运行时（[harmonypc-electron](https://atomgit.com/jianguoxu/harmonypc-electron)，Electron 37 / Node 22.17.0）的 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 桌面封装——在鸿蒙设备的 Electron 主进程内跑 dsh Host（含 webserver），渲染进程同源加载 dsh Web UI，界面 100% 复用 dsh Web UI。

**版本**：`0.1.5` · **状态**：✅ 已真机验证——HarmonyOS 6.1.0.135（API 24），Electron 37 / Node 22.17.0，dsh Web UI 正常运行（核心聊天 / agent / 工具调用 / Web UI 全部可用）。完整工程规划与最终实现记录见 [docs/工程规划.md](docs/工程规划.md)。

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

关键点：**渲染进程同源加载——零 CORS、零鉴权、零自定义协议、零 IPC 载体**——复用 dsh 现有 `WebApiClient`（HTTP 上行 + WebSocket 下行），**对 dsh 零上游改动**（仅 5 个 patch）。

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
- **分发**：本地签名 HAP 自用（DevEco 自动签名 + 华为证书）；暂无商店分发、自动更新、代码签名

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

### 构建流程（三阶段 + 5 个 patch）

dsh 依赖的 Node 内建 API（HMR、原生目录对话框）与鸿蒙沙箱（symlink、loopback 隔离）冲突，需先应用 5 个 patch（幂等——`--reverse --check` 检测已应用则跳过）：

```bash
# ① 收集运行时：copy ../harmonypc-electron 的 electron + web_engine 模块 + 3 个 SO + libc++_shared.so
node scripts/collect-runtime.mjs

# ② 构建 dsh：清理 workspace 残留 → apply 5 patch → pnpm build host/client/web → build ../dsh-market
node scripts/build-dsh.mjs

# ③ 收集 dsh 产物：pnpm deploy 物化 → 补包 → sharp stub → better-sqlite3 注入 → web dist + profile + dshmarket
node scripts/collect-dsh.mjs

# ④ 压缩 dsh-dist 为 dsh-dist.tar.gz（--format=ustar，~143MB，运行时流式解压）
tar -czf web_engine/src/main/resources/resfile/resources/app/dsh-dist.tar.gz --format=ustar -C . dsh-dist

# ⑤ 构建 + 签名 HAP（DevEco Studio 或命令行 hvigor）
#    NODE_HOME=<DevEco>/tools/node DEVECO_SDK_HOME=<sdk>  ohpm install  hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon
```

> **dsh 版本锚定**：本工程基于 deepseek-harness tag **`dsh-v0.1.5-rc.2`** 构建。补丁按 dsh 版本分目录存放（`patches/<dsh-tag>/`），`scripts/build-dsh.mjs` 固定指向 `patches/dsh-v0.1.5-rc.2/` —— 升级到新的 dsh tag 时，需新增对应的 `patches/<新 tag>/` 目录并更新该指向。

| Patch | 目的 |
|---|---|
| `patches/dsh-v0.1.5-rc.2/dsh-symlink-to-copy.patch` | 鸿蒙沙箱禁 symlink（`EACCES`）→ 回退 `cpSync` 递归拷贝 |
| `patches/dsh-v0.1.5-rc.2/dsh-allow-all-interfaces.patch` | 移除 webserver `--host 0.0.0.0` 拒绝检查（loopback 隔离需绑全网卡 + 局域网 IP） |
| `patches/dsh-v0.1.5-rc.2/dsh-disable-hmr.patch` | `DSH_DISABLE_HMR` 开关，跳过依赖 `--expose-internals` 的 watch-only HMR |
| `patches/dsh-v0.1.5-rc.2/dsh-disable-native-picker.patch` | 目录选择器走 browse（原生 dialog worker 在 Electron 下 spawn 失败） |
| `patches/dsh-v0.1.5-rc.2/dsh-flock-openharmony.patch` | openharmony 平台以进程内方式放行 POSIX flock 写锁（无原生插件；单进程宿主，同 dsh 浏览器 worker stub 语义） |

**前置——同级工程 checkout**：本工程消费 3 个同级工程（非 submodule），构建前需放到同级目录：

```bash
git clone --branch dsh-v0.1.5-rc.2 https://github.com/deepseek-ai/deepseek-harness.git ../deepseek-harness
git clone --branch v1.26.0           https://github.com/dsh-market/dsh-market.git       ../dsh-market
# ../harmonypc-electron 为 Electron-on-鸿蒙运行时工程，需解压 Electron 37 编译产物补齐 3 个 SO
```

`collect-runtime.mjs` 校验 3 个 SO（`libelectron.so`/`libadapter.so`/`libffmpeg.so`）缺失即报错；`collect-dsh.mjs` 在 `../dsh-market` 缺失时硬失败（打包产物内置 `dsh-dist/node_modules/dshmarket`）。

### 运行

```bash
hdc tconn <设备IP>:<端口>   # 先建立无线（IP）调试连接；端口见设备 开发者选项 → 无线调试
hdc uninstall org.fellow99.DeepseekHarnessHarmony   # 首装/换产物需先卸载，清掉旧 userData 中过期 dsh-dist
hdc app install -r electron/build/default/outputs/default/electron-default-signed.hap
hdc shell aa start -a EntryAbility -b org.fellow99.DeepseekHarnessHarmony
```

> 环境要求：DevEco Studio 4.0+、HarmonyOS SDK API 17+（targetSdk 6.1.1(24)）、Node 18+、pnpm@11、HDC。

## 目录结构

本工程与 3 个被消费工程、1 个架构参考工程**同级目录**存放（非 submodule）：

```
（同级目录）
├── deepseek-harness-harmony/      # 本工程（鸿蒙 HAP，桌面版鸿蒙移植）
│   ├── AppScope/                  # 应用 scope（图标/名称/签名）
│   ├── electron/                  # 入口模块（copy 自 harmonypc-electron，含 SO）
│   ├── web_engine/                # 桥接 HAR（ArkTS 桥接层 + resfile 承载 dsh 产物）
│   ├── src-main/                  # 主进程 main.js（解压 + runProfile + loadURL + 鸿蒙适配）
│   ├── scripts/                   # 三阶段构建：collect-runtime → build-dsh → collect-dsh
│   ├── profiles/desktop/          # 自定义 desktop profile（cordis.patch.yml + package.json）
│   ├── patches/                   # dsh 上游 patch（5 个）
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
