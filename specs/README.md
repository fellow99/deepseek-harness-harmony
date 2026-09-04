# 规格文档索引

**项目名称：** deepseek-harness-harmony
**版本：** N/A
**技术栈：** Electron-on-鸿蒙（Electron 37 / Node 22.17.0）+ ArkTS + HarmonyOS（封装 deepseek-harness）
**文档生成时间：** 2026-09-04
**最后更新：** 2026-09-04

---

## 一、文档总览

| 层级 | 分类 | 文档数量 | 说明 |
|------|------|---------|------|
| 整体 | 项目级顶层文档 | 8 | 架构、技术、宪法、结构、数据模型等全局文档 + 检查清单 |
| 模块 | 主进程装配模块 | 8 | 001-004 共 4 个模块，各含 spec.md + plan.md |
| 模块 | 构建与配置模块 | 4 | 005-006 共 2 个模块，各含 spec.md + plan.md |
| 模块 | 运行时集成模块 | 4 | 007-008 共 2 个模块，各含 spec.md + plan.md |
| 模块 | 扩展模块 | 2 | 201-dsh-market（spec + plan） |
| **合计** | **9 模块目录 / 27 文件**（含 README 索引） | | |

> 注：本项目级规格文档集不含 `API.md`、`overall-api.md`、`overall-test-cases.md`——数据面在 dsh 侧，本工程无自有 API 清单，这些文档尚未生成（对齐 sibling desktop 规范集）。

---

## 二、项目级顶层文档

全局性的架构、技术、宪法等文档，定义项目基线和开发准则。

| 文档 | 路径 | 说明 |
|------|------|------|
| **方案总纲** | [ARCHITECTURE.md](./ARCHITECTURE.md) | 系统整体架构设计（进程模型、分层、数据流、关键决策） |
| **宪法原则** | [constitution.md](./constitution.md) | 项目开发原则、编码规范、治理规则 |
| **整体规格** | [overall-spec.md](./overall-spec.md) | 系统级功能规格（技术无关） |
| **整体方案** | [overall-plan.md](./overall-plan.md) | 系统级技术方案（各模块 plan 总纲） |
| **技术选型** | [TECH.md](./TECH.md) | 核心技术栈选型理由、版本、依赖说明 |
| **项目结构** | [STRUCTURE.md](./STRUCTURE.md) | 源码目录结构、模块清单、关键配置 |
| **数据模型** | [overall-data-model.md](./overall-data-model.md) | 全局数据实体、状态机、目录布局定义 |
| **检查清单** | [SPECS_CHECKLIST.md](./SPECS_CHECKLIST.md) | 规格文档完成度追踪 |

---

## 三、主进程装配模块（001-004）

### 001 — Host 宿主（host）

> 在主进程内 runProfile('desktop') 挂起 dsh Host（含 webserver），返回宿主句柄（ctx/shutdown/port/url）；就绪判定 + agent preset 运行时补丁。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [001-host/spec.md](./001-host/spec.md) | Host 宿主功能规格 |
| 技术方案 | [001-host/plan.md](./001-host/plan.md) | Host 宿主技术实现方案 |

### 002 — 窗口管理（window）

> BrowserWindow 创建、内联 loading 页、loadURL(同源)/兜底页、crypto.randomUUID polyfill、关窗即退出。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [002-window/spec.md](./002-window/spec.md) | 窗口管理功能规格 |
| 技术方案 | [002-window/plan.md](./002-window/plan.md) | 窗口管理技术实现方案 |

### 003 — 生命周期与鸿蒙适配（lifecycle）

> HOME 沙箱修正、loopback 头改写、NO_PROXY 并入、崩溃兜底、优雅关闭。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [003-lifecycle/spec.md](./003-lifecycle/spec.md) | 生命周期与鸿蒙适配功能规格 |
| 技术方案 | [003-lifecycle/plan.md](./003-lifecycle/plan.md) | 生命周期与鸿蒙适配技术实现方案 |

### 004 — 产物解压引导（artifact-bootstrap）

> dsh-dist.tar.gz 流式解压与产物就位（首次启动，幂等跳过）。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [004-artifact-bootstrap/spec.md](./004-artifact-bootstrap/spec.md) | 产物解压引导功能规格 |
| 技术方案 | [004-artifact-bootstrap/plan.md](./004-artifact-bootstrap/plan.md) | 产物解压引导技术实现方案 |

---

## 四、构建与配置模块（005-006）

### 005 — 构建编排（build-pipeline）

> 三阶段构建编排：collect-runtime（copy 运行时）→ build-dsh（patch + build）→ collect-dsh（物化 + 产物适配）。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [005-build-pipeline/spec.md](./005-build-pipeline/spec.md) | 构建编排功能规格 |
| 技术方案 | [005-build-pipeline/plan.md](./005-build-pipeline/plan.md) | 构建编排技术实现方案 |

### 006 — 运行时 profile（runtime-profile）

> 自定义 desktop profile（cordis.patch.yml + package.json）+ 4 个 dsh 上游 patch（symlink→copy / allow-all-interfaces / disable-hmr / disable-native-picker）。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [006-runtime-profile/spec.md](./006-runtime-profile/spec.md) | 运行时 profile 功能规格 |
| 技术方案 | [006-runtime-profile/plan.md](./006-runtime-profile/plan.md) | 运行时 profile 技术实现方案 |

---

## 五、运行时集成模块（007-008）

> 以下两模块为 copy 自同级 `harmonypc-electron` 的运行时（集成面级别文档，标注 copy 来源，不逐一深挖所有 Adapter/Binding）。

### 007 — 运行时入口（runtime-entry）

> electron 入口模块：EntryAbility 启动 Electron-on-鸿蒙运行时，承载 5 个原生 SO。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [007-runtime-entry/spec.md](./007-runtime-entry/spec.md) | 运行时入口功能规格 |
| 技术方案 | [007-runtime-entry/plan.md](./007-runtime-entry/plan.md) | 运行时入口技术实现方案 |

### 008 — Web 桥接层（web-bridge）

> web_engine 桥接 HAR：ArkUI Web 组件承载渲染 + ~46 Adapter（系统能力）+ ~44 AdapterBind（Node 侧绑定）+ resfile 承载 dsh 产物。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [008-web-bridge/spec.md](./008-web-bridge/spec.md) | Web 桥接层功能规格 |
| 技术方案 | [008-web-bridge/plan.md](./008-web-bridge/plan.md) | Web 桥接层技术实现方案 |

---

## 六、扩展模块（201+）

扩展模块编号从 201 起，区别于 001-008 的桌面壳基础模块，用于集成外部能力。

### 201 — dsh-market 插件市场（dsh-market）

> 把 dsh-market（可视化插件市场）集成到本工程：构建期 npm build + 物化进 dsh-dist/node_modules/dshmarket + 运行时复制到 $DSH_HOME + 配置注入（profile: desktop、allowRestart: false）。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [201-dsh-market/spec.md](./201-dsh-market/spec.md) | dsh-market 集成功能规格 |
| 技术方案 | [201-dsh-market/plan.md](./201-dsh-market/plan.md) | dsh-market 集成技术实现方案 |

---

## 七、模块编号一览

| 编号 | 模块名 | 英文名 | 分类 |
|------|--------|--------|------|
| 001 | Host 宿主 | host | 主进程装配 |
| 002 | 窗口管理 | window | 主进程装配 |
| 003 | 生命周期与鸿蒙适配 | lifecycle | 主进程装配 |
| 004 | 产物解压引导 | artifact-bootstrap | 主进程装配 |
| 005 | 构建编排 | build-pipeline | 构建与配置 |
| 006 | 运行时 profile | runtime-profile | 构建与配置 |
| 007 | 运行时入口 | runtime-entry | 运行时集成 |
| 008 | Web 桥接层 | web-bridge | 运行时集成 |
| 201 | dsh-market 插件市场 | dsh-market | 扩展模块 |

---

## 八、模块文档结构规范

每个模块目录 `NNN-name/` 下包含以下标准文档：

| 文件 | 命名 | 说明 |
|------|------|------|
| 功能规格 | `spec.md` | 定义模块的功能需求、用户故事、验收标准 |
| 技术方案 | `plan.md` | 模块的技术实现方案、架构决策、组件设计 |

> 如项目需要，模块目录还可扩展以下文档：
> - `tasks.md` — 开发任务拆解、依赖关系、里程碑
> - `api.md` — 模块涉及的 API 接口定义
> - `data-model.md` — 模块所需的实体、类型、枚举定义
> - `pages.md` — 模块包含的页面路由、组件树、交互流程
> - `test-cases.md` — 模块 UI 功能测试用例

---

## 九、快速导航

| 目标读者 | 推荐阅读顺序 |
|---------|-------------|
| **新加入开发者** | constitution.md → STRUCTURE.md → overall-spec.md → 具体模块 spec.md |
| **架构师 / Tech Lead** | ARCHITECTURE.md → TECH.md → overall-plan.md → overall-data-model.md |
| **桌面壳开发** | STRUCTURE.md → 001-004 对应模块的 spec.md + plan.md |
| **构建/发布** | 005-build-pipeline → 006-runtime-profile 的 spec.md + plan.md |
| **测试 / QA** | SPECS_CHECKLIST.md → 各模块 spec.md 验收场景 |

---

**文档维护者：** deepseek-harness-harmony 开发团队
