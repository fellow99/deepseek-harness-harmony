# SPECS_CHECKLIST.md — 规格检查清单

> deepseek-harness-harmony 规范文档完成情况追踪（2026-09-04，最后更新 2026-09-18）。

## 1. 项目级文档

| # | 文档 | 路径 | 状态 |
|---|---|---|---|
| P-01 | 目录结构 | [STRUCTURE.md](./STRUCTURE.md) | ✅ Done |
| P-02 | 技术选型 | [TECH.md](./TECH.md) | ✅ Done |
| P-03 | 整体架构 | [ARCHITECTURE.md](./ARCHITECTURE.md) | ✅ Done |
| P-04 | 宪法原则 | [constitution.md](./constitution.md) | ✅ Done |
| P-05 | 整体规格 | [overall-spec.md](./overall-spec.md) | ✅ Done |
| P-06 | 整体技术方案 | [overall-plan.md](./overall-plan.md) | ✅ Done |
| P-07 | 数据模型 | [overall-data-model.md](./overall-data-model.md) | ✅ Done |
| P-08 | 检查清单 | [SPECS_CHECKLIST.md](./SPECS_CHECKLIST.md) | ✅ Done |
| P-09 | 文档索引 | [README.md](./README.md) | ✅ Done |

> 注：按需求，不写 API.md、overall-api.md、overall-test-cases.md（数据面在 dsh 侧，本工程无自有 API 清单）。

## 2. 模块级文档

| # | 模块 | spec.md | plan.md | 状态 |
|---|---|---|---|---|
| M-01 | 001-host（Host 宿主） | [001-host/spec.md](./001-host/spec.md) | [001-host/plan.md](./001-host/plan.md) | ✅ Done |
| M-02 | 002-window（窗口管理） | [002-window/spec.md](./002-window/spec.md) | [002-window/plan.md](./002-window/plan.md) | ✅ Done |
| M-03 | 003-lifecycle（生命周期与鸿蒙适配） | [003-lifecycle/spec.md](./003-lifecycle/spec.md) | [003-lifecycle/plan.md](./003-lifecycle/plan.md) | ✅ Done |
| M-04 | 004-artifact-bootstrap（产物解压引导） | [004-artifact-bootstrap/spec.md](./004-artifact-bootstrap/spec.md) | [004-artifact-bootstrap/plan.md](./004-artifact-bootstrap/plan.md) | ✅ Done |
| M-05 | 005-build-pipeline（构建编排） | [005-build-pipeline/spec.md](./005-build-pipeline/spec.md) | [005-build-pipeline/plan.md](./005-build-pipeline/plan.md) | ✅ Done |
| M-06 | 006-runtime-profile（运行时 profile） | [006-runtime-profile/spec.md](./006-runtime-profile/spec.md) | [006-runtime-profile/plan.md](./006-runtime-profile/plan.md) | ✅ Done |
| M-07 | 007-runtime-entry（运行时入口） | [007-runtime-entry/spec.md](./007-runtime-entry/spec.md) | [007-runtime-entry/plan.md](./007-runtime-entry/plan.md) | ✅ Done |
| M-08 | 008-web-bridge（Web 桥接层） | [008-web-bridge/spec.md](./008-web-bridge/spec.md) | [008-web-bridge/plan.md](./008-web-bridge/plan.md) | ✅ Done |
| M-09 | 201-dsh-market（dsh-market 插件市场） | [201-dsh-market/spec.md](./201-dsh-market/spec.md) | [201-dsh-market/plan.md](./201-dsh-market/plan.md) | ✅ Done |
| M-10 | 202-plugin-fs-mutate（fs-mutate 插件，工程内专用） | [202-plugin-fs-mutate/spec.md](./202-plugin-fs-mutate/spec.md) | [202-plugin-fs-mutate/plan.md](./202-plugin-fs-mutate/plan.md) | ✅ Done |
| M-11 | 301-skill-runtime-capabilities（技能运行能力规范） | [301-skill-runtime-capabilities/spec.md](./301-skill-runtime-capabilities/spec.md) | [301-skill-runtime-capabilities/plan.md](./301-skill-runtime-capabilities/plan.md) | ✅ Done |

> M-10 / M-11 另各含一份 `test-cases.md`（真机核验用例）。

## 3. 完成度统计

- 项目级：9 / 9 完成
- 模块级：11 / 11 完成
