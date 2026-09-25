# overall-data-model.md — 数据模型

> dsh-desktop-hos 全局数据实体、状态机、目录布局。
> Last Updated: 2026-09-04

## 1. 核心实体

### 1.1 宿主句柄（HostHandle）

主进程持有的 dsh Host 句柄，由 `startHost()` 返回：

| 字段 | 类型 | 说明 |
|---|---|---|
| `ctx` | Cordis Context | dsh 宿主上下文（含 `webServer.port`） |
| `shutdown` | `(code?) => Promise<void>\|void` | 优雅关闭句柄 |
| `port` | number | 实际绑定端口（`ctx.webServer.port`） |
| `url` | string | 同源加载地址 `http://<局域网 IP>:<port>/` |

### 1.2 tar 条目（ustar 解压）

`extractTarGz` 流式解析的归档条目：

| 字段 | 说明 |
|---|---|
| `name`（0-100） | 文件名 |
| `prefix`（345-500） | 路径前缀 |
| `size`（124-136，八进制） | 文件大小 |
| `typeflag`（156） | `'5'`=目录、`'0'`/空=文件、`0`=结束块 |

### 1.3 运行时禁用工具行（HARMONY_DISABLED_PRESET_ROWS）

| 工具行 id | 禁用原因 |
|---|---|
| `tool-bash` | 依赖 shell/node-pty（MVP 已禁用） |
| `tool-fs-search` | 依赖 subprocess 跑 ripgrep（node-pty 已禁用） |
| `persistent-shell` | 依赖 pty（node-pty 已禁用） |

## 2. 目录布局（状态化）

### 2.1 打包产物布局（构建期）

```
web_engine/src/main/resources/resfile/resources/app/
├── main.js                 # 主进程入口（编译自 src-main/）
└── dsh-dist.tar.gz         # dsh 产物压缩包（~143MB，ustar 格式）
```

### 2.2 dsh 产物解压布局（运行期，userData/dsh-dist）

```
userData/dsh-dist/
├── lib/                    # dsh CLI lib（profile-boot-*.js 薄入口）
├── node_modules/
│   ├── @deepseek-ai/       # 物化的 dsh workspace 包（dsh-app-boot 等）
│   ├── dshmarket/          # 插件市场（lib + client + cordis.patch.yml）
│   ├── sharp/dist/         # 纯 JS stub（index.mjs + index.cjs）
│   └── better-sqlite3/     # aarch64 v138 原生模块
├── config/agent-presets/   # agent preset（<id>/agent.cordis.yml，运行时补丁禁用工具行）
└── profiles/desktop/       # desktop profile（复制到 $DSH_HOME）
```

### 2.3 dsh 数据布局（运行期，DSH_HOME = userData/.dsh）

```
userData/.dsh/
├── profiles/
│   ├── desktop/            # 安装的 desktop profile（package.json + cordis.patch.yml）
│   └── node_modules/dshmarket/  # dshmarket 物化目录
└── ...                     # dsh 运行时数据（会话/配置/凭据）
```

## 3. 状态机

### 3.1 产物就位状态

```
首次启动 ──(existsSync marker?)──→ 是：跳过解压（复用）
         └→ 否：extractTarGz 流式解压 ──成功→ 就位
                                      └─失败→ __extractError 记录（兜底空白页）
```

### 3.2 Host 启动状态

```
startHost() ──findProfileBootEntry 无→ null（__hostError）
            └→ runProfile ──ctx.webServer 存在→ HostHandle（port/url 可用）
                           └─webServer 缺失→ null（__hostError: 'webServer undefined'）
```

### 3.3 应用生命周期

```
whenReady → 建窗(loading) → 解压 → startHost → 成功? loadURL(host.url) : loadURL(about:blank)
window-all-closed → app.quit()
before-quit → host.shutdown() → app.quit()
```

## 4. 校验规则

- `port`：OS 分配正整数（`--port 0`），非硬编码。
- `url`：`http://<pickReachableHost()>:<port>/`，host 优先局域网 IPv4（非 internal），回退 127.0.0.1。
- `marker`（解压就位判定）：`dsh-dist/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js` 存在即视为已解压。
- profile 安装幂等：package.json 合并（保留用户插件），cordis.patch.yml 等种子文件强制覆盖。

## 5. 配置模型

### 5.1 cordis.patch.yml（desktop profile）

| id | 覆盖 |
|---|---|
| `web-runtime` | `printUrl: false`、`surfaceContext: true` |
| `webserver` | `host: '0.0.0.0'`、`port: ctx.webStartup.port ?? 3080` |
| `dsh-market` | `profile: desktop`、`allowRestart: false` |
| `subprocess`/`sandbox`/`bash-sandbox`/`permission` | `disabled: true` |

### 5.2 desktop profile package.json

```json
{ "dependencies": { "dshmarket": "1.26.0" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dshmarket"] } } }
```
