# 201-dsh-market 技术方案（As-Built）

> 本文档为「回溯性」技术方案，记录模块实际架构、设计决策与实现策略。
> 模块：201-dsh-market
> 对应规格：specs/201-dsh-market/spec.md
> Last Updated: 2026-09-04

## 1. 技术上下文

### 1.1 运行时环境

- **构建期**：Windows 宿主机 Node（`node scripts/*.mjs` 直接调用），dsh-market 的 `npm install` / `npm run build` 由 `build-dsh.mjs` 用 `execSync` 执行。
- **运行期**：Electron-on-鸿蒙（Electron 37 / Node 22.17.0）主进程内。dshmarket 是 dsh Host 的 in-process Cordis 插件，不独立成进程。
- **部署形态**：市场产物随 `dsh-dist/` 打包进 `dsh-dist.tar.gz` → 打入 resfile → 首次启动解压到 `userData/dsh-dist`。

### 1.2 依赖

| 依赖 | 版本/来源 | 用途 |
|------|-----------|------|
| dsh-market | 同级源码引用（`../dsh-market`，非 submodule；包名 `dshmarket`，`1.26.0`） | 内置插件市场（构建 `lib/` + `client/`） |
| deepseek-harness（dsh） | 同级源码引用（`../deepseek-harness`） | 提供 `dsh.client` 机制、`cordis.patch.yml` 补丁层；市场的 `@deepseek-ai/*` 依赖从宿主物化产物解析 |
| 市场运行时依赖 | `undici`、`js-yaml`、`argparse` 等（`dependencies` + 传递依赖） | 由 `copyMarketRuntimeDeps()` 从市场 `node_modules` 复制进物化目录 |

> **构建前置**：`../dsh-market` 必须在编译前存在于本工程同级目录。`build-dsh.mjs` 缺失时警告跳过；`collect-dsh.mjs` 物化时缺失则 `process.exit(1)` 硬失败。

## 2. 宪法合规检查

| 宪法原则（constitution.md） | 状态 | 说明 |
|---|---|---|
| §1.1 零上游改动 | ✅ | 不改 dsh-market 与 dsh 源码；仅通过 profile patch 注入配置 |
| §1.3 只写装配代码 | ✅ | 内置 = 构建 + 收集物化 + 运行期复制 + patch 注入，无业务逻辑 |
| §1.5 sibling 源码引用 + 构建期 copy（非 submodule） | ✅ | `../dsh-market` 同级源码引用，构建期收集产物，无 submodule |
| §5.1 幂等构建 | ✅ | 物化/复制均以「目标 package.json 已存在则跳过」保证幂等 |
| §5.3 产物适配集中在收集脚本 | ✅ | 市场物化集中在 `collect-dsh.mjs` 的 `collectDshMarket()` |
| §2.2 沙箱边界 | ✅ | 运行期复制而非 symlink（规避沙箱 `EACCES`） |
| §4.2 崩溃兜底 | ✅ | `ensureDshMarketProfileLink` 失败不阻塞 Host 启动 |

> 合规结论：全部 ✅，无 ⚠️ / ❌。

## 3. 研究结论

- **双解析锚点**（市场前后端两个半体须在两个位置均可解析）：
  1. **bundle loader 锚点 = `DSH_ROOT/node_modules`**：`cordis-plugin-loader` 用裸 `import('<plugin>')` 加载 bundle，Node 沿 dsh 根目录树向上查 node_modules，故市场须物化到 `dsh-dist/node_modules/dshmarket`（解压后即 `DSH_ROOT/node_modules/dshmarket`）。
  2. **client 扫描锚点 = profile 目录**：`dsh-client-modules` 以 profile 目录为 baseUrl 扫描 `dsh.client` 声明来服务 `/plugins/<pkg>/client.js`，故运行期须复制到 `$DSH_HOME/profiles/node_modules/dshmarket`。
- **复制而非 symlink**：鸿蒙沙箱禁止 `symlinkSync`（抛 `EACCES`），故 `ensureDshMarketProfileLink()` 用 `cpSync(..., {recursive, dereference:true})` 物理复制（对齐 `dsh-symlink-to-copy.patch` 的取舍，FR-201-007）。
- **运行时依赖须显式复制**：npm 扁平布局下市场的传递依赖（`undici` 等）不在 dsh 根 node_modules，不复制则市场 host 端 import 失败；`copyMarketRuntimeDeps()` 用 BFS 沿 `dependencies` 字段复制 + 传递依赖，`@deepseek-ai/*` scope 跳过（宿主 dsh-dist 已物化）(FR-201-005)。
- **profile 注入 desktop + allowRestart:false**：市场默认 profile 为 `web`，桌面用 `desktop`，须显式注入避免写错目录；桌面壳拥有进程生命周期，市场不得 spawn 独立 dsh 进程（FR-201-010）。
- **无便携运行时（与 desktop 的关键差异）**：desktop 版提供 `fetch-runtime.mjs` + `setupMarketRuntime()`（便携 Node/pnpm + `dsh` shim + PATH 注入）打通「安装/删除」通道；本工程**未**内置这些，故市场的安装/删除子进程通道在鸿蒙设备上不可用（见 spec §7 [NEEDS CLARIFICATION]）。

## 4. 数据模型

### 4.1 物化产物结构（构建期，`dsh-dist/node_modules/dshmarket/`）

```
dshmarket/
├── package.json        # name=dshmarket
├── cordis.patch.yml    # insert 声明（- insert: [{id: dsh-market, name: dshmarket}]）
├── lib/                # host half
├── client/             # browser half
└── node_modules/       # 运行时依赖（undici/js-yaml 等，无 @deepseek-ai/*）
```

### 4.2 运行期双锚点

| 锚点 | 路径 | 用途 |
|------|------|------|
| bundle loader 锚点 | `userData/dsh-dist/node_modules/dshmarket` | 裸名 `import('dshmarket')` 解析 |
| client 扫描锚点 | `$DSH_HOME/profiles/node_modules/dshmarket` | 服务 `/plugins/dshmarket/client.js` |

### 4.3 profile 声明与配置

- `profiles/desktop/package.json`：`dependencies.dshmarket = "1.26.0"`；`dsh.profile.bundles = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dshmarket"]`。
- `profiles/desktop/cordis.patch.yml`（dsh-market 段）：

```yaml
- id: dsh-market
  name: dshmarket
  config:
    profile: desktop
    allowRestart: false
```

### 4.4 状态与幂等

- 物化幂等判定：`dsh-dist/node_modules/dshmarket/package.json` 存在即跳过（`collectDshMarket()`）。
- 复制幂等判定：`$DSH_HOME/profiles/node_modules/dshmarket/package.json` 存在即跳过（`ensureDshMarketProfileLink()`）。

## 5. 接口契约

### 5.1 提供的接口

| 位置 | 符号 | 说明 |
|------|------|------|
| `scripts/build-dsh.mjs`（108-118 行） | dsh-market 构建段 | `npm install`（node_modules 缺失时）+ `npm run build`，缺失 warn 跳过 |
| `scripts/collect-dsh.mjs`（113-140 行） | `collectDshMarket()` | 物化市场到 `dsh-dist/node_modules/dshmarket`；缺失 `process.exit(1)` |
| `scripts/collect-dsh.mjs`（85-108 行） | `copyMarketRuntimeDeps(srcNm, destNm, marketRoot)` | BFS 复制运行时依赖（跳过 `@deepseek-ai` scope） |
| `src-main/main.js`（292-304 行） | `ensureDshMarketProfileLink(home)` | 复制 dshmarket 到 `$DSH_HOME/profiles/node_modules/dshmarket`（幂等、非阻塞） |
| `profiles/desktop/package.json` | manifest | `dshmarket@1.26.0` 依赖 + bundles 声明 |
| `profiles/desktop/cordis.patch.yml`（51-62 行） | dsh-market 段 | 注入 `config: { profile: desktop, allowRestart: false }` |

### 5.2 消费的接口

- dshmarket 自身 `cordis.patch.yml` 的 `- insert: [{id: dsh-market, name: dshmarket}]` 行（由 profile 声明为 bundle 后随组合应用）。
- dsh 的 `dsh.client` 机制与 `cordis-plugin-loader`（裸名 import）。

### 5.3 事件协议

- 无自定义事件协议。构建/收集为同步 `execSync` 编排；运行期复制为一次性 `cpSync`，日志带 `[dsh-harmony]` / `[collect-dsh]` 前缀。

## 6. 实现策略

### 6.1 架构模式

**装配 + 物化 + 引导**：构建期（`build-dsh.mjs` + `collect-dsh.mjs`）准备并物化产物；运行期（`main.js`）复制到 profile + profile patch 注入配置。不修改上游，仅装配。

### 6.2 关键算法

- **市场物化**（FR-201-003/004/006）：`collectDshMarket()` 校验 `../dsh-market/package.json` 存在，否则 `process.exit(1)`；`cpSync(marketRoot, dest, {filter})` 只保留顶层 `package.json`、`cordis.patch.yml`、`lib`、`client`（排除源码/测试/devDeps）。
- **运行时依赖复制**（FR-201-005）：`copyMarketRuntimeDeps()` 以市场 `package.json` 的 `dependencies` 键为初始队列，`while(queue)` BFS——`seen` 去重、`@deepseek-ai/` 跳过、源/目标 `package.json` 任一已存在则跳过；`cpSync(srcPkg, destPkg, {recursive, dereference:true})` 后把其 `dependencies` 键继续入队。
- **运行期复制**（FR-201-007/008）：`ensureDshMarketProfileLink(home)` 校验 `DSH_ROOT/node_modules/dshmarket/package.json` 与目标 `package.json`；`mkdirSync` 建父目录后 `cpSync(src, dest, {recursive, dereference:true})`；`catch` 仅 `console.error` 不抛出。

### 6.3 错误处理

- **致命**（`process.exit(1)` + `console.error`）：收集阶段 `../dsh-market/package.json` 缺失。
- **可跳过**（`console.warn`）：构建阶段市场缺失。
- **非阻塞**（`console.error` 后返回）：运行期 `ensureDshMarketProfileLink` 复制失败（`cpSync` EACCES 等）不阻断 Host 启动。

### 6.4 性能

- 均为一次性构建/首次启动操作，无热路径；`cpSync` 递归复制 `lib`/`client` 与少量运行时依赖，体积可控（排除源码/测试/devDeps 与 `@deepseek-ai` scope）。

## 7. 测试考量

- **产物结构检查**（Windows 可执行）：`Test-Path dsh-dist/node_modules/dshmarket/package.json`、`dsh-dist/node_modules/dshmarket/lib`、`dsh-dist/node_modules/dshmarket/client`、`dsh-dist/node_modules/dshmarket/cordis.patch.yml` 均存在；`dsh-dist/node_modules/dshmarket/node_modules` 含运行时依赖且不含 `@deepseek-ai`。
- **幂等验证**：重复执行 `collect-dsh.mjs` 断言打印「dshmarket 已物化」；重复启动断言「已复制」日志仅出现一次。
- **边界**：`../dsh-market` 缺失 → `collect-dsh.mjs` `process.exit(1)`；`build-dsh.mjs` 缺失 → warn 跳过；运行时复制失败 → 不阻塞启动。
- **真机验证**（Electron 37 真机）：设置页出现「插件市场」入口；`/plugins/dshmarket/client.js` → 200；`/dsh-market/installed` 返回 `dshmarket` 且 `bundle=true`。安装/删除通道受「无便携运行时」约束，需单独确认（spec §7 [NEEDS CLARIFICATION]）。

## 8. 文件清单

| 文件 | 用途 | 行数 |
|------|------|------|
| `scripts/build-dsh.mjs`（108-118 行） | 构建 dsh-market（`npm install` + `npm run build`） | 120 |
| `scripts/collect-dsh.mjs`（85-140 行） | `copyMarketRuntimeDeps()` + `collectDshMarket()` 物化市场 | 431 |
| `src-main/main.js`（292-304 行） | `ensureDshMarketProfileLink()` 复制市场到 profile | 537 |
| `profiles/desktop/cordis.patch.yml`（51-62 行） | dsh-market 行 `config: { profile: desktop, allowRestart: false }` | 62 |
| `profiles/desktop/package.json` | `dshmarket@1.26.0` 依赖 + bundles 声明 | 12 |

## 9. 与规格的交叉引用

| 技术决策 | 对应规格需求 |
|---|---|
| `build-dsh.mjs` 市场构建段（`npm install` + `npm run build`） | FR-201-001 |
| 市场缺失 `console.warn` 跳过 | FR-201-002 |
| `collectDshMarket()` 复制 `package.json`/`cordis.patch.yml`/`lib`/`client` | FR-201-003 |
| `collectDshMarket()` 缺失 `process.exit(1)` | FR-201-004 |
| `copyMarketRuntimeDeps()` BFS 复制（跳过 `@deepseek-ai`） | FR-201-005 |
| `existsSync(dest/package.json)` 跳过 | FR-201-006 |
| `ensureDshMarketProfileLink()` `cpSync`（复制非 symlink） | FR-201-007 |
| 复制幂等 + `catch` 非阻塞 | FR-201-008 |
| `profiles/desktop/package.json` bundles + dependencies | FR-201-009 |
| `cordis.patch.yml` dsh-market 段 `profile: desktop` + `allowRestart: false` | FR-201-010 |
