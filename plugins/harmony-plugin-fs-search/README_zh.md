[English](./README.md) | 中文

---

# harmony-plugin-fs-search

面向模型的 DeepSeek Harness `grep` 内容搜索工具。

## 用途

`@deepseek-ai/dsh-tool-fs-search` 通过 `ctx.subprocess` 执行打包的 `@vscode/ripgrep` 原生二进制来提供 `grep`/`glob`。鸿蒙构建做不到这一点（HAP 沙箱中没有可运行的原生二进制），因此停用了该 preset 行；而 `str_replace_editor` 的 `view` 命令已经覆盖了目录列举 —— 于是仍然缺失的是**内容搜索**。本插件用一个工具把这一点原样补回：

| 工具 | 参数 | 行为 |
|---|---|---|
| `grep` | `pattern`（必填）、`path?`、`include?`、`max_results?` | 递归遍历 `path`（默认为会话工作区），对每个匹配行返回一行 `<displayPath>:<lineNumber>: <line text>`，其后附一句汇总。 |

搜索是运行在宿主进程中的纯 JavaScript：无原生二进制、无子进程、无 glob 包，也不使用 `node:fs`。每次读取都经 `ctx.fs`（`stat`、`listDir`、`readText`），因此路径身份、解码与二进制拒绝仍由所挂载的后端负责，与 `read`/`write`/`edit` 完全一致。由于本工具**只读**，它不提供任何沙箱提权字段 —— 读取永远不受围栏限制，只有变更才受。

## 配置

每个键都是可选的；默认值取自 `lib/search.js` 的 `DEFAULT_LIMITS`。所有数值上限都在 `apply` 中校验为**正的安全整数** —— 零、负数、小数，或超过 `Number.MAX_SAFE_INTEGER` 的值都会让组合失败，而不是静默地让某个边界失效。在设备上不能无界遍历：遍历会真实读取文件。

| 键 | 默认值 | 含义 |
|---|---|---|
| `maxResults` | `200` | 单次调用保留的匹配总数。一旦下一个匹配会超出，遍历立即停止，汇总会说明结果被截断。 |
| `maxMatchesPerFile` | `50` | 单个文件保留的匹配数；该文件后续匹配被丢弃，汇总会统计该文件。 |
| `maxFiles` | `2000` | 单次调用读取的文件数。一旦下一个文件会超出，遍历立即停止，汇总会说明这一点。 |
| `maxFileBytes` | `524288`（512 KiB） | 单个文件的字节上限（含边界）。上报大小更大的文件会在**被读取之前**跳过，并计入跳过。 |
| `maxDepth` | `8` | 在搜索根之下下探的目录层级数。根本身为第 0 层，因此 `1` 会搜索根及其直接子目录。 |
| `maxLineChars` | `300` | 每个匹配行保留的字符数，超出则截断并标记。 |
| `skippedDirectories` | `["node_modules", ".git"]` | 任意深度下**永不进入**的目录名。以 `.` 开头的名称也**始终**被跳过，因此从该列表移除 `.git` 并不会让它变为可搜索；在此列出它只是记录意图。隐藏**文件**仍会被搜索。 |

```yaml
- name: harmony-plugin-fs-search
  config:
    maxResults: 200
    maxFileBytes: 524288
    skippedDirectories:
      - node_modules
      - .git
```

## 模型看到什么

**工具结果。** 值是一个字符串，渲染为一个文本块：每个匹配一行 `<displayPath>:<lineNumber>: <line text>`，空一行，然后是汇总句。

```
src/parser.ts:12: const token = lexer.needle()
src/parser.ts:88: // needle: the anchor token
docs/notes.md:4: replace the needle before shipping

Found 3 matches in 3 files (files searched: 41, files skipped as unreadable or too large: 2).
```

汇总总会给出匹配数、命中文件数与已搜索文件数。它只追加适用的事实：`files skipped as unreadable or too large`、`directories skipped as unreadable`、`directories not entered past maxDepth N`，以及 `files past the N-matches-per-file cap`。无匹配的搜索只有汇总本身 —— `Found 0 matches in 0 files (files searched: 41).`

当某个全局上限让搜索提前停止时，会以第二句明说，而不是静默丢弃结果：

```
Found 200 matches in 12 files (files searched: 355).
Results were truncated because the maxResults cap of 200 was reached; narrow pattern, path, or include and retry.
```

**参数。** `pattern` 是 JavaScript 正则表达式源码，逐行逐个测试，不施加任何 flag —— 匹配区分大小写，没有忽略大小写的开关。`path` 默认为会话工作区。`include` 是单个文件名 glob 过滤器，支持 `*` 与 `?`（不含 `/` 的过滤器匹配任意深度的文件名，这是 ripgrep 的约定）。`max_results` 只会在单次调用中**下调**工具自身的 `maxResults` 上限；更大的值会被钳制到该上限。

**错误。** 参数问题都是普通错误：`pattern must be a non-empty string`、`path must be a non-empty string when given`、`max_results must be a positive integer when given`、`pattern is not a valid JavaScript regular expression: <detail>`，以及下方 `include` 的各种拒绝。搜索根不可用时是类型化 `FsError`：`cannot search "<path>": not found`（`FS_NOT_FOUND`）或 `cannot search "<path>": not a regular file or directory`（`FS_NOT_REGULAR_FILE`）。列举根失败会原样传播后端自身的错误；`grep was aborted (tool timeout or caller cancellation)` 表示调用被放弃。不可读的**文件**从不是错误 —— 它会被跳过并计数。

## 已知限制

- **没有 ripgrep 语法，也没有 flag。** `pattern` 是普通 JavaScript `RegExp` 源码，编译时不带任何 flag，因此没有忽略大小写模式、没有全词匹配开关，多行模式也不可用。匹配按行进行，所以只能跨换行匹配的模式什么也找不到。
- **`include` 是极简 glob。** 只有 `*` 与 `?` 是通配符；`{a,b}` 交替、取反（`!…`）与逗号分隔列表都会被**报错拒绝**，而不是去搜索模型没有要求的东西。
- **被跳过的文件仍可能含有匹配。** 二进制内容、权限错误、已消失的条目，以及超过 `maxFileBytes` 的文件都不会被读取，而是跳过并计数。当汇总报告有跳过文件时，要检查其中之一需要用一次针对性的 `read`。
- **没有 spill 交接，也没有分页。** 基于 ripgrep 的上游通过 `ctx.spillStore` 保存完整匹配列表；本替代实现不这么做，因此被截断的结果只能靠收窄 `pattern`、`path` 或 `include` 来挽回。没有 offset 参数。
- **每次读取都缓冲整个文件。** `readText` 在一次 `stat` 之后逐个解码文件，因此 `maxFileBytes` 是唯一的单文件字节边界 —— 而对于无法上报 `size` 的后端，该文件上的这个上限无法强制生效。遍历的总边界是 `maxFiles`。
- **遍历是广度优先。** 结果按后端稳定的名称顺序、逐层给出，因此被截断的结果取到的是树的浅层，而不是完整走完某一棵很深的子树。
- **显式指定的根优先于跳过列表与 `include`。** 名为 `.git` 或 `node_modules` 的 `path` 会被遍历，名为文件的 `path` 无论 `include` 如何都会被搜索 —— 同时 `maxFileBytes` 的大小检查仍然对它生效。符号链接的目录会被跟随，因为 `listDir` 报告的是链接目标的类型。
- **未声明超时预算。** 工具注册时不带 `timeoutMs`，因此取消只能依赖 `exec.signal`（与 `read`/`write`/`edit` 的立场相同）。
- **只有 `grep`。** 本插件不提供按模式发现文件（上游的 `glob`）；目录列举仍由 `str_replace_editor` 的 `view` 负责。

## 依赖

`@deepseek-ai/cordis`、`@deepseek-ai/dsh-fs`、`@deepseek-ai/dsh-sandbox`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery` 均声明为 `peerDependencies`，由消费方构建在运行时提供；它们随 `dsh-dist/node_modules` 一同发布，因此本插件**不发布**、也不自带任何被打包或安装的依赖。`dsh-sandbox` 仅用于 `canonicalPath`，即本族所有面向模型的文件系统工具共用的、针对符号链接 cwd 的规范化。纯 ESM、无构建步骤 —— `lib/` 即发布源码。

`lib/search.js` —— 搜索引擎 —— **不 import 任何东西**，正因如此它能在裸 Node 上直接测试：`node tests/search.test.mjs` 以内存中的 `ctx.fs` 桩驱动它（无测试框架、无依赖），任何失败都以非零码退出。
