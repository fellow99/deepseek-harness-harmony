# 004-artifact-bootstrap 技术方案（As-Built）

> 本文档为回溯式技术方案，记录产物解压引导模块的**实际**架构、设计决策与实现策略。
> Module: 004-artifact-bootstrap
> 对应规格: [spec.md](./spec.md)
> Last Updated: 2026-09-04

## 1. 技术上下文

### 1.1 运行时环境

- 运行于 **Electron-on-鸿蒙 主进程**（Node.js 环境，Electron 37 / Node 22.17.0）。
- 主进程入口为 CommonJS 单文件 `src-main/main.js`（编译后作为 `resfile/resources/app/main.js` 分发），本模块为其中的一段（行 77-170）。
- 依赖 Electron `app.getPath('userData')` 获取应用沙箱可写的用户数据目录。

### 1.2 依赖

| 依赖 | 版本/来源 | 用途 |
|------|-----------|------|
| `node:fs`（`createReadStream`/`mkdirSync`/`openSync`/`writeSync`/`closeSync`/`existsSync`） | Node 内置 | 读归档流、创建目录、逐条目落盘、就位判定 |
| `node:zlib`（`createGunzip`） | Node 内置 | gzip 流式解压 |
| `node:path`（`join`/`dirname`） | Node 内置 | 路径拼接、父目录定位 |
| `node:util`（`inspect`） | Node 内置（函数内按需 require） | 解压错误详情的序列化 |
| Electron（`app.getPath`） | Electron 37 | 用户数据目录解析 |

> 无第三方解压库（tar / tar-stream 等），解压逻辑为手写的极简 ustar 解析器。

## 2. 宪法合规检查

| 原则 | 状态 | 说明 |
|------|------|------|
| 架构：零上游改动 | ✅ | 纯装配代码，不修改 dsh 任何文件 |
| 架构：只写装配代码 | ✅ | 仅解压 + 就位判定，无业务逻辑 |
| 安全：沙箱边界 | ✅ | 解压目标位于 `app.getPath('userData')`（沙箱可写），不触碰沙箱外目录 |
| 代码质量：源码即真理 | ✅ | 归档格式假设以注释固化（`main.js:86`），与打包命令（工程规划 §18.4）对应 |
| 代码质量：类型安全 | ✅ | CommonJS 无类型；不涉及 `as any`/`@ts-ignore` |
| 代码质量：日志规范 | ✅ | 统一 `[dsh-harmony]` 前缀（`main.js:150/154/158/162/165`） |
| 生命周期：崩溃兜底 | ✅ | 归档缺失/解压失败仅记录 `__extractError` 并返回 `false`，不抛异常阻塞启动（`main.js:155/167`） |
| 构建：产物适配集中在收集脚本 | ⚠️ 部分 | 打包压缩在 `collect-dsh`/`tar`（构建期）完成；本模块是运行时侧的兜底双保险（对应宪法 5.3「运行时兜底」） |

> 合规结论：全部 ✅ / ⚠️ 可解释，无 ❌。

## 3. 研究结论

### 3.1 关键决策与理由

| 决策 | 理由 |
|------|------|
| 打包为单个 tar.gz 而非直接打入目录 | dsh-dist 5 万+ 小文件，hvigor 打包阶段卡死/内存爆（工程规划 §18.2 行 391） |
| `--format=ustar` | 生成标准 ustar 条目，字段按固定字节偏移解析，无需 pax 扩展头，解析器可极简实现（工程规划 §18.4 行 455） |
| `createGunzip` + `createReadStream` 流式解压 | 解压后产物约 555MB，一次性载入内存会在移动设备触发 OOM（`main.js:87` 注释） |
| 剥离 `dsh-dist/` 前缀 | tar 由 `-C . dsh-dist` 打包，条目自带 `dsh-dist/` 前缀；解压目标本身已含该目录，剥离避免双重前缀（`main.js:108`） |
| marker 文件判定就位 | `node_modules/@deepseek-ai/dsh-app-boot/lib/index.js` 存在即视为已解压，避免重复全量解压（`main.js:148`） |
| 失败写 `globalThis.__extractError` | 与 `__hostError`/`__winError` 一致，写入全局变量并经 console 记录（`main.js:155/167`） |

### 3.2 源码级核实（固化于 main.js）

- 归档路径：`DSH_ARCHIVE = join(__dirname, 'dsh-dist.tar.gz')` —— `main.js:78`。
- 目标根目录：`getDshRoot() = join(app.getPath('userData'), 'dsh-dist')` —— `main.js:81-83`。
- 就位标记：`join(DSH_ROOT, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')` —— `main.js:148`。
- 打包命令（构建期，非本模块）：`tar -czf ... --format=ustar -C . dsh-dist` —— 工程规划 §18.4 行 431。

## 4. 数据模型

### 4.1 模块级状态（`main.js:77-83`）

| 符号 | 类型 | 说明 |
|------|------|------|
| `DSH_ARCHIVE` | `string`（const） | 归档绝对路径，`join(__dirname, 'dsh-dist.tar.gz')` |
| `DSH_ROOT` | `string \| null` | 产物根目录（模块级变量，初始 `null`，`ensureDshExtracted()` 内赋值） |

### 4.2 ustar 条目解析（`extractTarGz`，`main.js:100-111`）

| 字段 | 字节偏移 | 说明 |
|------|----------|------|
| `name` | 0-100 | 文件名（`\0` 截断，`main.js:102`） |
| `size` | 124-136 | 文件大小，八进制（`main.js:104-105`） |
| `typeflag` | 156 | `'5'`=目录、`'0'`/`\u0000`/空=普通文件、首字节 `0`=结束块（`main.js:101/106/115/117`） |
| `prefix` | 345-500 | ustar 路径前缀（`main.js:103`） |

- 完整名 = `prefix ? prefix + '/' + name : name`，再经 `.replace(/^\.\//, '').replace(/^dsh-dist\//, '')` 剥离前缀（`main.js:107-109`）。
- 条目数据区对齐：`paddedEnd = dataStart + Math.ceil(size / 512) * 512`（512 字节块对齐，`main.js:110-111`）。

### 4.3 状态转换

```
ensureDshExtracted()
  ├─ marker 存在 ──→ 返回 true（跳过解压，main.js:149-152）
  ├─ 归档缺失 ──→ __extractError='archive-missing'，返回 false（main.js:153-157）
  └─ 解压 ── mkdirSync(DSH_ROOT) → extractTarGz(DSH_ARCHIVE, DSH_ROOT)
             ├─ 成功 → 返回 true（main.js:161-163）
             └─ 失败 → __extractError=inspect(err)，返回 false（main.js:164-169）
```

### 4.4 校验规则

- 就位判定：仅以 marker 文件存在性为准，不校验归档完整性/文件数（`main.js:149`）。
- 结束块判定：`header[0] === 0`（首字节为 0）即视为归档结束（`main.js:101`）。
- 条目落盘：仅处理非空名且非以 `/` 结尾的条目（`main.js:113`）。

## 5. 接口契约

### 5.1 提供接口（本模块导出/暴露）

| 符号 | 类型 | 说明 |
|------|------|------|
| `getDshRoot()` | `() => string` | 返回解压目标根目录绝对路径（`main.js:81-83`） |
| `ensureDshExtracted()` | `() => Promise<boolean>` | 就位引导：幂等解压，返回是否就位（`main.js:146-170`） |
| `DSH_ROOT` | `string \| null` | 解压后的产物根目录，供下游 Host 模块读取（`main.js:79`） |

### 5.2 消费接口（本模块 import）

| 来源 | 符号 | 说明 |
|------|------|------|
| `node:fs` | `createReadStream`/`mkdirSync`/`openSync`/`writeSync`/`closeSync`/`existsSync` | 流式读、建目录、落盘、判定 |
| `node:zlib` | `createGunzip` | gzip 流式解压 |
| `node:path` | `join`/`dirname` | 路径拼接 |
| `electron` | `app.getPath('userData')` | 用户数据目录 |
| `node:util` | `inspect` | 错误详情序列化（函数内按需 `require`，`main.js:166`） |

### 5.3 事件协议

- `gunzip` 的 `data`/`end`/`error` 与 `input` 的 `error` 事件驱动解压状态机（`main.js:134-141`）。
- 本模块不产生自有事件，仅以 `ensureDshExtracted()` 的布尔返回值与 `globalThis.__extractError` 向调用方（lifecycle）传递结果。

## 6. 实现策略

### 6.1 架构模式

**流式管道 + 增量解析状态机**：`createReadStream(archivePath).pipe(createGunzip())` 建立解压管道
（`main.js:141`），`gunzip.on('data')` 将每次到达的 chunk 追加到缓冲区并调用 `process()` 增量消费
（`main.js:134-137`）。`process()` 在「缓冲区至少含一个完整 512 字节头 + 其数据区」时推进一个条目，
不足则 `break` 等待更多数据（`main.js:99-126`）。

### 6.2 关键算法

- **512 字节块游标**：以 `offset` 标记已消费位置，逐块解析 header；每次推进后 `buf = Buffer.from(buf.subarray(offset))` 释放已处理数据，避免缓冲区无限增长（`main.js:128-131`）。
- **前缀剥离**：先 `.replace(/^\.\//, '')` 去掉 `./`，再 `.replace(/^dsh-dist\//, '')` 去掉打包根前缀（实现 FR-004-009，`main.js:109`）。
- **目录/文件分派**：`typeflag === '5'` → `mkdirSync(recursive)`；`'0'`/`\u0000`/空 → 先 `mkdirSync(dirname)` 再 `openSync('w')` + `writeSync` + `closeSync`，并递增 `count`（实现 FR-004-008，`main.js:115-123`）。
- **结束块**：读到首字节为 0 的 header 即置 `ended`，停止消费（`main.js:101`）。

### 6.3 错误处理

- 归档缺失：`console.error` + `__extractError='archive-missing'` + 返回 `false`（`main.js:153-157`）。
- 解压异常：`gunzip.on('error', reject)` / `input.on('error', reject)` 使 Promise reject；`ensureDshExtracted` 捕获后 `console.error` + `__extractError = inspect(err, {depth:4, colors:false}).slice(0, 400)` + 返回 `false`（`main.js:138-139/164-169`）。
- 失败不抛异常上抛，不阻塞应用启动（对齐 lifecycle 的兜底约定）。

### 6.4 性能

- 内存有界：流式 gunzip + 增量消费 + `subarray` 释放已处理缓冲，峰值内存 ≈ 最大单个文件 + 缓冲余量，与 555MB 产物总体积无关（`main.js:87/128-131`）。
- 首次解压耗时较长（工程规划 §18.4 提及 ~45s 量级），期间由窗口模块的 loading 页提示等待，本模块不做进度上报（`main.js:158` 仅打日志）。
- 幂等：marker 命中后零解压开销，后续启动直接返回（`main.js:149-152`）。

## 7. 测试考虑

- **就位判定**：marker 存在 → 返回 true 且不触发解压；marker 缺失 → 走解压。
- **前缀剥离**：条目名 `dsh-dist/lib/x.js`、`./dsh-dist/...`、`dsh-dist/`（目录）分别正确落到 `lib/x.js` 等无双重前缀路径。
- **目录/文件分派**：`typeflag '5'` 建目录、`'0'` 写文件、结束块终止；空名/以 `/` 结尾条目被跳过。
- **流式边界**：单个大文件跨多个 chunk、512 块边界不完整时 `break` 等待更多数据，最终 `count` 正确。
- **失败路径**：归档缺失返回 `false` + `__extractError='archive-missing'`；解压中途出错（截断/损坏）返回 `false` 且 `__extractError` 含详情。
- **边界**：空归档（仅结束块）→ `count` 为 0；`size` 为 0 的条目不写入数据但正确推进游标。`[NEEDS CLARIFICATION]`：`size` 字段解析失败（`parseInt` 返回 NaN）时以 `|| 0` 兜底为 0，未验证实际归档中是否可能触发。

## 8. 文件清单

| 文件 | 用途 | 行数 |
|------|------|------|
| `src-main/main.js` | 主进程入口；本模块为其中「产物路径 + 解压 + 就位引导」段（行 77-170，约 94 行） | 537（全文件） |

> 模块内符号：`DSH_ARCHIVE`（78）、`DSH_ROOT`（79）、`getDshRoot()`（81-83）、`extractTarGz()`（89-143）、`ensureDshExtracted()`（146-170）。
> 相邻但属其他模块：`DSH_CLI_LIB`/`DSH_APP_BOOT_LIB`/`DESKTOP_PROFILE_SRC`（172-174，供 001-host 消费）、`startHost()`（325-393，001-host）、`app.whenReady` 编排（474-527，003-lifecycle）。

## 9. 与规格的交叉引用

| 规格需求 | 实现位置 |
|----------|----------|
| FR-004-001（定位归档） | `DSH_ARCHIVE`（`main.js:78`） |
| FR-004-002（解析目标目录） | `getDshRoot()`（`main.js:81-83`） |
| FR-004-003（暴露根目录） | `DSH_ROOT` 模块变量 + `ensureDshExtracted()` 赋值（`main.js:79/147`） |
| FR-004-004（就位标记判定） | `marker` + `existsSync(marker)`（`main.js:148-149`） |
| FR-004-005（标记存在跳过解压） | `main.js:149-152` |
| FR-004-006（标记缺失执行解压） | `main.js:158-163` |
| FR-004-007（流式解压，不整体载入内存） | `createGunzip` + `createReadStream` 管道（`main.js:91-92/141`） |
| FR-004-008（逐条目落盘，目录/文件） | `typeflag` 分派 + `mkdirSync`/`writeSync`（`main.js:115-123`） |
| FR-004-009（剥离目录前缀） | `fullName.replace(/^\.\//, '').replace(/^dsh-dist\//, '')`（`main.js:109`） |
| FR-004-010（报告文件条目数） | `count` 递增 + `resolve(count)`（`main.js:122/138`） |
| FR-004-011（归档缺失记录失败） | `__extractError='archive-missing'` + 返回 `false`（`main.js:153-157`） |
| FR-004-012（解压错误记录失败） | `catch` → `__extractError=inspect(err)` + 返回 `false`（`main.js:164-169`） |
