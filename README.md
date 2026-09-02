# DeepSeek Harness HarmonyOS 桌面版

基于「Electron-on-鸿蒙」运行时（`harmonypc-electron`，Electron 37 / Node 22.17.0）的 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 桌面封装——在鸿蒙设备的 Electron 主进程内跑 dsh Host（含 webserver），渲染进程同源加载 dsh Web UI，界面 100% 复用 dsh Web UI。

> **已真机验证**：HarmonyOS 6.1.0.135（API 24），Electron 37 / Node 22.17.0，dsh Web UI 正常运行。完整工程规划与最终实现记录见 [`docs/工程规划.md`](docs/工程规划.md)。

## 架构

```
deepseek-harness-harmony/（鸿蒙 HAP）
├── AppScope/          # 应用 scope（图标/名称/签名）
├── electron/          # 入口模块（copy 自 harmonypc-electron，含 SO）
├── web_engine/        # 桥接 HAR（ArkTS 桥接层 + resfile 承载 dsh 产物）
├── src-main/          # 主进程 main.js（解压 + runProfile + loadURL）
├── scripts/           # 三阶段构建：collect-runtime → build-dsh → collect-dsh
├── profiles/desktop/  # 自定义 desktop profile（cordis.patch.yml）
└── patches/           # dsh 上游 patch（4 个）
```

**核心流程**：`main.js` 流式解压 `dsh-dist.tar.gz` → `runProfile('desktop')` 挂起 dsh Host（webserver 绑 `0.0.0.0`）→ `loadURL(局域网 IP)` 同源加载 dsh Web UI。

## 相关工程（sibling，同级目录）

| 工程 | 角色 |
|---|---|
| `../harmonypc-electron` | Electron-on-鸿蒙运行时（Electron 37 / Node 22.17.0） |
| `../deepseek-harness` | dsh Host |
| `../dsh-market` | 插件市场 |
| `../deepseek-harness-desktop` | 架构参考 |

## 构建与运行

```bash
# ① 收集运行时：copy ../harmonypc-electron 的 electron + web_engine 模块 + 3 个 SO
node scripts/collect-runtime.mjs

# ② 构建 dsh：apply patch → pnpm build host/client/web + dsh-market
node scripts/build-dsh.mjs

# ③ 收集 dsh 产物：收集 dsh-dist → resfile/resources/app/，并压缩为 dsh-dist.tar.gz
node scripts/collect-dsh.mjs

# ④ 构建 + 签名 HAP（DevEco Studio 或命令行 hvigor）
# ⑤ 安装 + 启动
hdc app install -r electron/build/default/outputs/default/electron-default-signed.hap
hdc shell aa start -a EntryAbility -b com.huawei.ohos_electron
```

> 环境要求：DevEco Studio 4.0+、HarmonyOS SDK API 17+（targetSdk 6.1.1(24)）、Node 18+、HDC。

## MVP 取舍（原生模块）

dsh-dist 在 Windows 上收集，`sharp`/`node-pty`/`koffi` 二进制为 win32-x64，鸿蒙 aarch64 无法加载：

| 能力 | 依赖 | 状态 |
|---|---|---|
| 图片附件校验/缩略图 | sharp（libvips） | ⚠️ 纯 JS stub（no-op） |
| 终端（bash 工具） | node-pty | ❌ 禁用 |
| 进程沙箱 | koffi（landlock） | ❌ 禁用 |
| 会话持久化 / 全文搜索 | better-sqlite3（Electron 37 / Node ABI v138，OpenHarmony aarch64 成品） | ✅ 正常（由 collect-dsh 注入） |

恢复完整能力需按 HarmonyOS aarch64 工具链交叉编译原生模块（`clang --target=aarch64-linux-ohos` + node 头文件 + `libshim.a`），详见 `docs/工程规划.md` §18.5。

## 文档

- [`docs/工程规划.md`](docs/工程规划.md) — 完整工程规划 + 最终实现记录（Electron 37 落地、关键适配改动、MVP 取舍、交叉编译优化路径）。
