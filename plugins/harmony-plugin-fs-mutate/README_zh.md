[English](./README.md) | 中文

---

# harmony-plugin-fs-mutate

面向模型的 DeepSeek Harness 文件系统 `delete` / `move` / `copy` / `chmod` 工具。

## 用途

`ctx.fs` 此前没有删除、重命名、复制与权限位原语，模型只能创建和编辑文件，无法删除、搬移、复制或改权限。本插件在 seam 的**受围栏保护的变更原语**之上注册四个工具：

| 工具 | 参数 | 行为 |
|---|---|---|
| `delete` | `paths`（必填）、`recursive?` | 对每个路径**独立**经 `ctx.fs.remove` 删除。任一路径失败都不会中断整批；结果列出已删除项，以及每个失败路径的**错误原文**。删除非空目录需 `recursive: true`。 |
| `move` | `from`（必填）、`to`（必填）、`recursive?` | 先做受围栏保护的复制，再做受围栏保护的源删除。复制**从不覆盖**：目标已存在则整个 move 失败；源仅在复制成功后才被删除。搬移目录需 `recursive: true`。 |
| `copy` | `from`（必填）、`to`（必填）、`recursive?` | 与 `move` 相同的受围栏复制，但不删除源。同样**从不覆盖**已存在的目标文件，复制目录需 `recursive: true`。 |
| `chmod` | `path`（必填）、`mode`（必填） | 设置 POSIX 权限位。`mode` 是**三或四位八进制数字的字符串**（`"644"`、`"0755"`），符号模式会被拒绝。变更后会**回读并校验**。 |

`copy` 与 `move` 对每个文件**按字节复制**（`readBytes` 读入 `writeBytes`），二进制内容原样传递。两者共用同一个规划器，因此「包含关系判断、覆盖规则、空目录拒绝」三套规则不可能彼此漂移。

所有变更都经 `ctx.fs`，因此目标身份、原子性与沙箱围栏均由所挂载的后端负责。本插件**从不**用 `node:fs` 打开路径，也**从不**调用 `rename` —— 产品所用的鸿蒙文件系统 `hmdfs` 在文档中把 rename 限定为**仅同目录**，因此「复制后删除」才是可移植的实现。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `maxTransferBytes` | `10485760`（10 MiB） | `copy` 与 `move` 复制时**单个文件**的字节上限（含边界）。`ctx.fs.readBytes` 强制要求提供上限，以免后端缓冲无界文件；超过上限的源会在复制开始前以 `FS_TOO_LARGE` 失败。 |

```yaml
- name: harmony-plugin-fs-mutate
  config:
    maxTransferBytes: 10485760
```

## 沙箱提权

当 `ctx.fs` 受限（后端定义了 `sandboxMode`）时，四个工具都会在 schema 中提供 `sandbox_permissions` 与 `justification`；在无沙箱能力的后端下这两个字段**不出现**在 schema 中，因此校验器会直接拒绝它们。被拒绝的变更会返回共享标记 `[sandbox: file access denied under <mode> mode]` 及提权提示；用**能完成任务的最小更宽模式**重试会触发**一次**用户审批。获批的模式按调用打戳，并覆盖该调用的全部变更 —— `move` 的复制与删除两半，以及 `copy` 的每一次写入。

## 模型看到什么

**工具结果。** `delete` 渲染为 `Deleted N paths:` 与若干 `- <path> (<kind>)` 行；若有失败，再空一行并渲染 `Failed to delete M paths:` 与若干 `- <path>: <错误原文>` 行。`move` 对文件渲染 `Moved "<from>" to "<to>".`，对目录渲染 `Moved directory "<from>" to "<to>" (N files).`；`copy` 用同样的句式、动词为 `Copied`。`chmod` 渲染 `Set mode <mode> on "<path>".`，其中 `<mode>` 是**回读到的**四位八进制模式。

**错误。** 失败均为 seam 的类型化 `FsError` 消息，未经改写：`cannot move "<path>": not found`、`cannot copy "<a>" to "<b>": the destination is the source itself or inside it`、`cannot chmod "<path>": the filesystem kept mode 660 instead of 755`，以及上述沙箱标记。非法 `mode` 在**任何 I/O 之前**即被拒绝。`delete` **把逐路径失败放进结果而非抛出**，因此模型总能拿到完整的批次结果。

## 已知限制

- **字节原语依赖已被 patch 的 seam。** 上游 `ctx.fs` 没有写字节的变更原语 —— `writeText` 拒绝二进制内容 —— 因此 `copy` 与 `move` 经 [`dsh-fs-write-bytes.patch`](../../patches/dsh-v0.1.5-rc.2/dsh-fs-write-bytes.patch) 补入的 `writeBytes` 原语发布每个文件。在未打该补丁的组合上，seam 会拒绝写入，而不会写出被截断的副本。
- **`chmod` 同样依赖已被 patch 的 seam。** 上游 `ctx.fs` 没有权限位原语，因此该工具需要 [`dsh-fs-chmod-primitive.patch`](../../patches/dsh-v0.1.5-rc.2/dsh-fs-chmod-primitive.patch) 补入的 `chmod` 成员；缺失时基类成员抛 `FS_IO_ERROR`，工具会如实报告失败，而不是假装改成功。
- **`chmod` 在「忽略权限位」的文件系统上会失败。** 变更会被回读并比对**实际**模式，因此「接受调用但不落实**请求的**模式」的存储层会**报错**而非静默成功。这正是鸿蒙共享用户目录（`hmdfs`）的实测行为 —— 它存下的是**它自己选定的**模式（请求 `640` 得到 `660`）且不返回任何错误；而在应用沙箱内（`hmfs`）权限位按请求如实生效。符合 POSIX 的文件系统不受影响。
- **复制出的文件不继承源的权限位。** 复制经原子写路径发布，该路径为新目标**请求** `0600`，且从不复制源的权限位。在忽略权限位的文件系统上，实际模式由该文件系统决定。模式有意义时应随后调用 `chmod`。
- **复制从不覆盖。** 目标文件已存在则整个操作失败；没有 force 开关。
- **空目录无法复制或搬移。** `ctx.fs` 没有建目录原语，目标目录只能作为「往里写文件」的副作用存在。若某棵树会产生空目录，则在**任何复制发生之前**整体拒绝，而不是静默丢弃该空目录。
- **复制失败会留下部分目标。** 对 `move` 而言源仍然保留（仅在复制成功后才删除），但已写入目标的文件会留在那里；重试前需手动清掉目标。
- **符号链接会被跟随并物化。** `listDir` 报告的是链接目标的类型，因此复制会把链接目标的内容作为普通条目复制，而不会重建该链接。
- **目标路径假定宿主分隔符。** 目标树由 `ctx.fs.resolve(name, { cwd })` 基于已解析的 display path 构造，对发布所用的 local / sandboxed 后端是正确的；若某远程后端的 display path 使用其他方言，需要由该后端自行完成路径拼接。
- **不发出 `fs/observed`。** 被这些工具删除或搬移的路径不会被记录为「不存在」，因此后续对它的**带守卫写入**需要先 `read` 一次。这是 `dsh-fs-observation-policy` 契约中 fail-closed 的方向，属有意为之。

## 依赖

`@deepseek-ai/cordis`、`@deepseek-ai/dsh-fs`、`@deepseek-ai/dsh-sandbox`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery` 均声明为 `peerDependencies`，由消费方构建在运行时提供；它们随 `dsh-dist/node_modules` 一同发布，因此本插件**不发布**、也不自带任何被打包或安装的依赖。纯 ESM、无构建步骤 —— `lib/` 即发布源码。

## 测试

`npm test` 运行 `tests/permissions.test.mjs`（`mode` 语法）与 `tests/transfer.test.mjs`（共用规划器）。两者都在纯 Node 上运行、无测试框架：`lib/permissions.js` 与 `lib/transfer.js` 这两个引擎模块**刻意不含任何 import**，因此可以只用内存中的 `ctx.fs` 桩驱动，不碰真实磁盘、也不导入任何 dsh 包。`lib/delete.js` / `lib/move.js` / `lib/copy.js` / `lib/chmod.js` 中的工具注册部分在真机上经 `specs/202-plugin-fs-mutate/` 覆盖。
