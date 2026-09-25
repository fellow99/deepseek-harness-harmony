# 010-tool-bash 测试用例

> 模块：010-tool-bash
> 对应规格：[specs/010-tool-bash/spec.md](./spec.md)
> 对应方案：[specs/010-tool-bash/plan.md](./plan.md)
> 对应任务：[specs/010-tool-bash/tasks.md](./tasks.md)
> Last Updated: 2026-09-18

## 0. 测试环境与前置

| 项 | 值 |
|---|---|
| 目标设备 | `3QC0226526001227` |
| 系统 | HarmonyOS 6.1.0.135（API 24） |
| 应用包名 | `org.fellow99.dsh.DshDesktop` |
| `hdc` | `D:/oh-workspace/command-line-tools/sdk/default/openharmony/toolchains/hdc.exe` |
| 构建前置 | `DEVECO_SDK_HOME=d:\oh-workspace\command-line-tools\sdk\`；`export MSYS_NO_PATHCONV=1` |
| 会话工作区 | `/data/storage/el2/base/files/aaa`（下称 `$WS`） |
| 用户家目录 | `/storage/Users/currentUser`（hmdfs） |
| 设备侧 `$DSH_HOME` | `<userData>/.dsh`（即 `/data/storage/el2/base/files/.dsh`） |
| 调试通道 | `hdc fport tcp:19229 tcp:9229` → CDP `Runtime.evaluate`（主进程 `--inspect`） |
| 关键坑 | `--inspect` 的 `Runtime.evaluate` 必须带 `includeCommandLineAPI: true`，否则 `require` 未定义；用 `require` 而非 `import()` |
| 文本输入 | composer 是 `contenteditable` 富文本编辑器且由 React 受控，必须用 `wc.debugger.attach('1.3')` + `Input.insertText`，不能赋值 `value` / `innerText` |

> **本组用例的两段式目的**：
> - **第一段（构建期 + 单元）可直接运行**：覆盖协议、围栏、能力清单、preset 互校、静态约束、构建物化。**这些是本次交付即可验证的部分**。
> - **第二段（真机）当前无设备可用**：全部标注 **`未验证`**，并给出**确切的设备命令**，以便设备恢复后逐条执行。凡是未在真机跑过的结论，一律不得作为"已证"陈述。
>
> **本模块最重要的真机用例是 TC-D10（围栏旁路探针）**：它不是找 bug，而是**证明**工具层围栏可被绕过，从而让 spec §6.4 的残余风险披露有实测依据。

---

## 1. 构建期用例（可运行）

### TC-B1 插件物化断言

| 项 | 内容 |
|---|---|
| 目的 | 验证 `collectPlugins()` 从本工程 `plugins/` 读取并按包名落地（AC-4） |
| 前置 | `plugins/harmony-plugin-exec/` 就位 |
| 步骤 | 1. `node scripts/collect-dsh.mjs`<br>2. 检查 `dsh-dist/node_modules/harmony-plugin-exec/package.json`<br>3. 读其 `name` 字段 |
| 期望 | 文件存在；`name` == `"harmony-plugin-exec"` |
| 证据 | 文件路径 + `name` 输出 |
| 失败含义 | 源根 / 通配改错，或收集静默无操作 |

### TC-B2 全工程包名令牌一致性

| 项 | 内容 |
|---|---|
| 目的 | 落实 AC-2：不存在任何非 `harmony-plugin-exec` 的 `-plugin-exec` 包名令牌 |
| 步骤 | 1. `grep -rn "plugin-exec" .`（排除 `dsh-dist/`、`node_modules/`、`oh_modules/`、`**/build/`、`.git/`）<br>2. 逐条检查命中 |
| 期望 | 每一处命中都是 `harmony-plugin-exec`；不存在其它 `-plugin-exec` 令牌 |
| 证据 | grep 输出（逐条核对） |
| 失败含义 | 漏改的名字令牌 → 目录名 / 包名 / preset 行 / 文档口径不一致 |

### TC-B3 两处 preset 行清单逐条一致

| 项 | 内容 |
|---|---|
| 目的 | 验证 `src-main/main.js` 与 `scripts/collect-dsh.mjs` 的 `HARMONY_ENSURED_PRESET_ROWS` 镜像未失真（AC-3） |
| 步骤 | 1. 从两文件各提取 `HARMONY_ENSURED_PRESET_ROWS` 条目<br>2. 逐条比对 `id` / `name` / `requireRow` |
| 期望 | 两处逐条相同；新增行 `id` == `exec`、`name` == `harmony-plugin-exec`、`requireRow` == `tool-bash`；条目数由 3 增至 4 |
| 证据 | 双文件提取结果对照 |
| 失败含义 | 构建期烘焙与运行期补丁分叉，只在运行期以 `agent-preset/invalid` 暴露 |
| 备注 | 构建期由 `assertPresetRowsMirrorMainJs()` 机械互校；本用例是实测确认（TC-B3b） |

### TC-B3b 互校函数硬通过

| 项 | 内容 |
|---|---|
| 目的 | 验证 `assertPresetRowsMirrorMainJs()` 对新条目解析成功（AC-3） |
| 步骤 | 运行 `node scripts/collect-dsh.mjs`，读日志 |
| 期望 | 出现 `[collect-dsh] preset 行互校通过（4 条与 src-main/main.js 一致）`；**不**出现 `preset 行互校失败` |
| 证据 | 构建日志 |
| 失败含义 | 键序写错或任一侧漏改（见 plan §8.2 的键序硬约束） |

### TC-B4 烘焙进产物的 preset 行

| 项 | 内容 |
|---|---|
| 目的 | 验证产物内（而非源码内）的 preset 已含新行，且上游 `tool-bash` 仍禁用（AC-5） |
| 步骤 | 1. `grep -rn "harmony-plugin-exec" dsh-dist/node_modules/@deepseek-ai/dsh-agent-presets/presets/`<br>2. `grep -n "id: tool-bash" -A2 dsh-dist/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml` |
| 期望 | 步骤 1 命中 `- name: 'harmony-plugin-exec'`；步骤 2 显示 `tool-bash` 行仍为 `disabled: true` |
| 证据 | grep 输出 |
| 备注 | AC-5 的直接证据；产物是运行时真正被读取的东西 |

### TC-B5 静态约束 grep（AC-16）

| 项 | 内容 |
|---|---|
| 目的 | 验证实现未踩三条已被实测否定的写法 |
| 步骤 | 对 `plugins/harmony-plugin-exec/lib/*.js` 运行：<br>1. `grep -nE "exec\(|execFile\("`（期望：无调用；`RegExp.exec` 不在禁列，需人工甄别）<br>2. `grep -n "process.execPath"`（期望：无）<br>3. `grep -n "statSync"`（期望：无）<br>4. 人工核对完成判定路径未监听 `'exit'` / `'close'` |
| 期望 | 四条均无违规命中；`node --check` 全通过 |
| 证据 | grep 输出 + 人工核对记录 |
| 失败含义 | `exec` 不回调、`process.execPath` 路径 `ENOENT`、`statSync` 对可 spawn 目标返回 `EACCES` —— 三者都会让会话在真机上失效 |

### TC-B6 未恢复上游禁用（AC-20）

| 项 | 内容 |
|---|---|
| 目的 | 验证交付未重新启用被禁用的四层 |
| 步骤 | 1. `grep -n "subprocess\|sandbox\|bash-sandbox\|permission" profiles/desktop/cordis.patch.yml` 核对 `:36-43` 四行仍 `disabled: true`<br>2. 核对 `dsh-web-app/cordis.patch.yml:368-371` 的 `tool-bash` / `tool-pwsh` 仍禁用<br>3. `grep -n "tool-bash\|tool-fs-search\|persistent-shell" src-main/main.js` 核对 `HARMONY_DISABLED_PRESET_ROWS` 三项仍在 |
| 期望 | 三处与基线一致；无新增启用 |
| 证据 | 三处 grep 输出 |
| 失败含义 | 上游 PTY 后端被意外启用 → 撞上 win32-x64 `node-pty`，加载失败 |

### TC-B7 文档纪律（AC-21）

| 项 | 内容 |
|---|---|
| 目的 | 验证无路线图 / 占位，且未验证项已标注 |
| 步骤 | 1. `grep -rniE "roadmap|路线图|待办|T[O]DO\|TB[D]" specs/010-tool-bash/`<br>2. `grep -n "未验证" specs/010-tool-bash/spec.md` 并对照 §7 的真机条目 |
| 期望 | 步骤 1 零命中（"待办"若出现必须位于 §8.3 的排除语境）；步骤 2 覆盖 AC-22~AC-30 与相关限制 |
| 说明 | 检查模式里的 `T[O]DO` / `TB[D]` 用字符类拼写，避免检查脚本自身被 grep 命中（与 301 的 `TC-B2` 同一手法） |
| 证据 | 两条 grep 输出 |
| 失败含义 | 引入路线图或把未验证结论当成已验证 |

### TC-B8 HAP 构建与签名断言

| 项 | 内容 |
|---|---|
| 目的 | 确认改动不破坏打包链路 |
| 步骤 | `powershell -ExecutionPolicy Bypass -File scripts/build-hap.ps1 -BuildMode debug -SignMode debug` |
| 期望 | 退出码 0；产物 `electron/build/default/outputs/default/electron-default-signed.hap` 生成；签名断言（profile type == 请求的 `SignMode`）通过 |
| 证据 | 构建尾部输出 + 产物大小 |

---

## 2. 单元用例（可运行）

### TC-U1 哨兵行协议（AC-6）

| 项 | 内容 |
|---|---|
| 目的 | 验证框架构造与解析的确定性 |
| 前置 | `npm test --prefix plugins/harmony-plugin-exec`（`node --test tests/protocol.test.mjs`） |
| 步骤 | 1. 固定 token 调 `frame()`，核对四段文本<br>2. 构造 `BEGIN / 多行输出 / END <rc>` 喂 `createParser`<br>3. 逐字节分块喂入（每次 1 字节）<br>4. 在输出中注入近似 `__DSH_BASH_END__` 字符串（token 不匹配） |
| 期望 | 步骤 1 文本与 plan §5.2 逐字一致；步骤 2 捕获窗口与 `rc` 正确；步骤 3 结果与一次性喂入相同；步骤 4 **不**误判为结束 |
| 证据 | 测试输出 |

### TC-U2 输出保真与 NUL（AC-8）

| 项 | 内容 |
|---|---|
| 目的 | 验证输出逐字节保真且结束哨兵总在新行首 |
| 步骤 | 1. 捕获窗口内含 `\x00`、`\xFF`、无结尾换行的输出<br>2. 检查结束哨兵仍在行首 |
| 期望 | 捕获字节与输入逐字节相同（含 NUL）；结束哨兵前置 `\n` 生效 |
| 证据 | 测试输出 |

### TC-U3 退出码解析（AC-7）

| 项 | 内容 |
|---|---|
| 目的 | 验证 `0` / `1` / `127` 正确带回且非零不抛错 |
| 步骤 | 解析 `__DSH_BASH_END__ <token> 0` / `1` / `127` |
| 期望 | `exitCode` 分别为 `0` / `1` / `127`；`run` 不抛错 |
| 证据 | 测试输出 |
| 备注 | 真机语义（`sh -c '<cmd>; echo "__RC=$?"'` 得 0/1/127）由 TC-D4 复核（`未验证`） |

### TC-U4 围栏词法与允许根（AC-9）

| 项 | 内容 |
|---|---|
| 目的 | 验证 fail-closed 判定 |
| 步骤 | 1. `$WS/a`（界内）<br>2. `/data`（界外）<br>3. `$WS/../b`（`..` 归一化后越界）<br>4. `echo x > /data/y`（重定向目标界外）<br>5. `/a/bc` 对 root `/a/b`（边界不误判） |
| 期望 | 1 放行；2/3/4 拒绝；5 拒绝（`/a/bc` 不在 `/a/b` 内） |
| 证据 | 测试输出 |

### TC-U5 不可判定构造与三种模式（AC-10）

| 项 | 内容 |
|---|---|
| 目的 | 验证 `enforce` 拒绝、`warn`/`off` 放行 |
| 步骤 | 对 `X=/etc; ls $X`、`ls $(printf /etc)`、`` ls `pwd` ``、`eval true`、`sh -c 'true'`、`xargs`、`find . -exec` 七类逐一在三种模式下判定 |
| 期望 | `enforce` 全部 `deny` / `unanalyzable`；`warn` / `off` 全部放行并返回降级标记 |
| 证据 | 测试输出 |

### TC-U6 命令策略与 `toybox` 特例（AC-18 / AC-19）

| 项 | 内容 |
|---|---|
| 目的 | 验证 allowlist 与默认 denylist |
| 步骤 | 1. `allowlist` + `allowCommands={ls}`：`ls` 放行、`cat` 拒绝<br>2. `allowlist` + B 类白名单：`toybox nc ...` 放行、`toybox chmod ...` 拒绝<br>3. `denyCommands` 命中 `reboot` / `mount` / `devmem` 等 |
| 期望 | 与 plan §6.2 第 6 步一致 |
| 证据 | 测试输出 |

### TC-U7 能力清单数据（AC-17）

| 项 | 内容 |
|---|---|
| 目的 | 验证四分类齐备、互斥、关键成员 |
| 步骤 | 1. 四类非空且两两无交集<br>2. B 类含 `nc` / `netcat`<br>3. C 类含 `awk` / `wget` / `diff` / `expr`，且其描述含 `未验证`<br>4. D 类含 `bash` / `busybox`<br>5. 工具描述包含四分类与 `chmod` 平台拒绝（`13900012`） |
| 期望 | 全通过 |
| 证据 | 测试输出 |

### TC-U8 输出截断与排空（AC-12）

| 项 | 内容 |
|---|---|
| 目的 | 验证截断保留前 N 字节、附标记、且不提前结束读取 |
| 步骤 | 1. 输入大于 `maxOutputBytes` 的输出 + 结束哨兵<br>2. 检查返回内容长度、标记、以及解析器在下游仍能收到结束哨兵 |
| 期望 | 保留前 `maxOutputBytes` 字节；标记 `[output truncated: kept <N> of <M> bytes]`；结束哨兵仍被消费 |
| 证据 | 测试输出 |

### TC-U9 配置校验（AC-15）

| 项 | 内容 |
|---|---|
| 目的 | 验证非法配置使组合失败 |
| 步骤 | 对 `commandTimeoutMs` / `maxOutputBytes` / `maxCommandChars` 各喂 `0` / `-1` / `1.5` |
| 期望 | `apply` 抛错；消息前缀含 `harmony-plugin-exec` |
| 证据 | 测试输出 |

---

## 3. 真机用例（`未验证`，当前无设备）

> **本节全部条目标注 `未验证`**：当前无可用设备。命令已给出，设备恢复后逐条执行并回填证据。**在跑过之前不得把它们陈述为已验证。**

### TC-D1 常驻 shell 单进程与端到端命令

| 项 | 内容 |
|---|---|
| 目的 | 验证单常驻 shell、命令与退出码端到端正确（AC-22、AC-30） |
| 前置 | 新 HAP 已安装；设备 `$DSH_HOME/dsh-dist` 已清除以强制解压新 tar；应用已启动；`--inspect` 已连通 |
| 步骤 | 1. 经 CDP 读当前工具的 `bash` 注册信息（名称 + 描述）<br>2. 请模型用 `bash` 依次执行：`pwd`、`echo DSH_010_OK`、`exit 7`<br>3. 读回三次工具结果<br>4. `hdc shell "ps -A -o pid,ppid,state,name"` 统计主进程的子进程 |
| 期望 | 工具名为 `bash` 且描述披露非 PTY 后端；`pwd` 返回 `$WS`；`echo` 返回 `DSH_010_OK` 且 `Exit code: 0`；`exit 7` 后会话不可用并在下一次调用触发一次重置；主进程任一时刻**至多一个** `sh` 子进程 |
| 证据 | 三次工具结果 + `ps` 输出 |
| 状态 | **`未验证`** |
| 失败含义 | 后端写成了一次命令一次 spawn，或完成判定仍依赖退出事件 |

### TC-D2 退出码三态

| 项 | 内容 |
|---|---|
| 目的 | 验证 `0` / `1` / `127` 语义（AC-22） |
| 前置 | TC-D1 通过 |
| 步骤 | 依次执行 `true`、`false`、`definitely_not_a_command_010` |
| 期望 | `Exit code: 0` / `1` / `127`；三者都**不**抛工具错误 |
| 证据 | 三次工具结果 |
| 状态 | **`未验证`** |
| 备注 | 与设备既有实测 `sh -c '<cmd>; echo "__RC=$?"'` 得 0/1/127 一致 |

### TC-D3 stdout/stderr 合流与行序

| 项 | 内容 |
|---|---|
| 目的 | 验证合流与行序（AC-8 的真机面） |
| 步骤 | 执行 `echo out1; echo err1 1>&2; echo out2; echo err2 1>&2` |
| 期望 | 返回内容按 `out1 / err1 / out2 / err2` 顺序出现 |
| 证据 | 工具结果 |
| 状态 | **`未验证`** |

### TC-D4 围栏拒绝真实生效（fail-closed）

| 项 | 内容 |
|---|---|
| 目的 | 验证界外路径被拒且拒绝先于审批（AC-23） |
| 前置 | `fenceMode: enforce` |
| 步骤 | 1. 执行 `echo IN > $WS/fence_probe.txt`<br>2. 执行 `ls /data`（界外字面路径）<br>3. 执行 `echo X > /storage/Users/currentUser/Documents/dsh_010_out.txt`（界外，需审批）<br>4. 观察步骤 2/3 的结果：是否出现共享拒绝标记与升级提示、**此时是否尚未出现审批面板** |
| 期望 | 步骤 1 成功；步骤 2 被拒（无审批交互）；步骤 3 被拒 + 升级提示，**围栏拒绝先于审批**；将模式退化为 `warn` 后步骤 3 才需要审批 |
| 证据 | 工具结果 + 审批面板出现时机 |
| 状态 | **`未验证`** |
| 失败含义 | 围栏被绕过（例如为问用户而跳过检查）或顺序颠倒 |

### TC-D5 围栏旁路探针（残余风险实证）

| 项 | 内容 |
|---|---|
| 目的 | **证明**工具层围栏可被绕过，使 spec §6.4 的披露有实测依据（AC-24） |
| 前置 | 分两段：`(a)` `fenceMode: enforce`；`(b)` `fenceMode: warn`（**显式降级**） |
| 步骤 | 在 `(a) enforce` 下执行：<br>1. `X=/data; ls $X` → 期望被拒（不可判定）<br>2. `ls $(printf /data)` → 期望被拒<br>3. `/system/bin/sh -c 'ls /data'` → 期望被拒<br>4. `toybox ls /data` → 期望按当前策略判定<br>在 `(b) warn` 下重复 1-3：<br>5. 记录三次是否**成功读取 `/data`** |
| 期望 | `(a)` 三条全部被拒；`(b)` 三条**成功**（证明底层 shell 具备访问能力、围栏只是工具层检查） |
| 证据 | 两段工具结果对照 |
| 状态 | **`未验证`** |
| 备注 | 这是**披露性用例**：通过**不**代表安全，通过代表文档的"可绕过"结论成立 |

### TC-D6 直接 spawn 绕过（不依赖插件）

| 项 | 内容 |
|---|---|
| 目的 | 独立复核 spec §1.1 / §6.1 的"shell 绕过 `fs-sandbox` 与审批"事实 |
| 步骤 | 经 CDP 在**主进程**直接 `spawn('/system/bin/sh', ['-c', 'echo DSH_RAW_OK > /storage/Users/currentUser/Documents/dsh_010_raw.txt; cat /storage/Users/currentUser/Documents/dsh_010_raw.txt'])`，然后把写入的路径删掉 |
| 期望 | 写入与读回均成功，**不经过** `fs-sandbox` 的 `checkedTarget`、**不弹**审批；`ln -s` 在同一路径下失败 |
| 证据 | spawn stdout + 文件系统读回 |
| 状态 | **`未验证`** |
| 备注 | 该探针复现的是**原始证据**；它不是 010 的实现，而是 010 存在理由的证据 |

### TC-D7 僵尸计数

| 项 | 内容 |
|---|---|
| 目的 | 验证单常驻 shell 不线性泄漏僵尸、每次重置 +1（AC-25） |
| 前置 | TC-D1 通过 |
| 步骤 | 1. 经 CDP 取 Electron 主进程 pid（`process.pid`）<br>2. `hdc shell "ps -A -o pid,ppid,state,name"` 统计 `state=Z` 且 `ppid=<主进程 pid>` 的行数（基准 B）<br>3. 连续执行 10 次 `bash`（`echo 1` … `echo 10`）<br>4. 再次统计（结果 C）<br>5. 强制一次会话重置（如执行 `exit 0` 后再跑一条命令）<br>6. 再次统计（结果 D） |
| 期望 | `C == B`（10 次命令**不**增加僵尸）；`D == C + 1`（一次重置恰好 +1） |
| 证据 | 三次 `ps` 计数 |
| 状态 | **`未验证`** |
| 失败含义 | 实现写成一次命令一次 spawn（每次 +1），或重置路径被高频触发。原始证据：4 spawns → 4 zombies；一个会话累计 30 个僵尸 |
| 备注 | 若设备 `ps` 不支持 `-o state`，退化用 `hdc shell "for p in /proc/[0-9]*; do s=\$(awk '{print \$3}' \$p/stat 2>/dev/null); [ \"\$s\" = Z ] && cat \$p/comm; done"` |

### TC-D8 `/system/bin/sh` 身份裁定（toybox vs mksh）

| 项 | 内容 |
|---|---|
| 目的 | 裁定 spec FR-4.6 的矛盾（AC-26） |
| 前置 | 无 |
| 步骤 | 依次执行：<br>1. `hdc shell "ls -l /system/bin/sh /system/bin/toybox"`<br>2. `hdc shell "readlink /system/bin/sh; readlink -f /system/bin/sh"`<br>3. `hdc shell "md5sum /system/bin/sh /system/bin/toybox"`<br>4. `hdc shell "/system/bin/sh -c 'readlink /proc/self/exe; echo KSH_VERSION=\$KSH_VERSION; echo BASH_VERSION=\$BASH_VERSION; echo arg0=\$0'"`<br>5. `hdc shell "/bin/sh -c 'readlink /proc/self/exe; echo KSH_VERSION=\$KSH_VERSION'"` |
| 期望（裁定规则） | **toybox**：步骤 2 的 `readlink /system/bin/sh` 指向 `toybox`，且步骤 3 两个 md5 **相同**，步骤 4 的 `KSH_VERSION` 为空。<br>**mksh R59c**：步骤 2 的 `readlink` 回显自身（非软链），步骤 3 两个 md5 **不同**，步骤 4 的 `KSH_VERSION` 非空（形如 `@(#)MIRBSD KSH R59c …`）。<br>**两者皆非**：md5 不同且 `KSH_VERSION` 为空 → 记为"未裁定"，继续排查。 |
| 证据 | 五条命令的原始输出 |
| 状态 | **`未验证`** |
| 备注 | OpenHarmony 源码称 `/system/bin/sh` 由 `third_party_mksh/BUILD.gn:147` 的 `ohos_executable("sh")` 从 mksh R59c 构建、toybox 的 `sh.c` 未编译；设备记录称经 `readlink /proc/self/exe` 解析为 toybox。**两说矛盾，由本用例裁定。** |

### TC-D9 mksh builtin 遮蔽探针

| 项 | 内容 |
|---|---|
| 目的 | 若 TC-D8 判为 mksh，核实 builtin 遮蔽（AC-26 的后续） |
| 前置 | TC-D8 结论为 mksh |
| 步骤 | `hdc shell "/system/bin/sh -c 'type time; type test; type pwd; type realpath; type ulimit; type kill'"` |
| 期望 | 六者均报 shell builtin（而非 toybox 路径）；据此在能力清单标注 `time` / `test` / `pwd` / `realpath` / `ulimit` / `kill` 的行为由 mksh 决定 |
| 证据 | `type` 输出 |
| 状态 | **`未验证`** |

### TC-D10 C 类命令核实（`toybox --long`）

| 项 | 内容 |
|---|---|
| 目的 | 核实 C 类（`toybox_extended_cmd`）命令是否编入本设备镜像（AC-27） |
| 步骤 | 1. `hdc shell "/system/bin/toybox --long"`（保存完整输出）<br>2. 在其中检索 `awk` / `wget` / `diff` / `expr` / `getfattr` / `ipcs` / `telnet` / `traceroute` / `traceroute6` / `tr`<br>3. 对每个命中者再跑 `toybox <name> --help`；对未命中者跑一次实际调用并记录错误 |
| 期望 | 每个 C 类命令得到"编入 / 未编入"的明确结论；结论回填 spec FR-4.2 与能力清单 |
| 证据 | `toybox --long` 输出 + 逐命令结果 |
| 状态 | **`未验证`** |
| 备注 | 官方文档记录 `awk` / `wget` / `diff` / `telnet` / `traceroute`，但 OH FAQ 说"文档有描述的即未编译" —— **文档是超集**，不得据此认定可用 |

### TC-D11 `chmod` / `chown` 平台拒绝

| 项 | 内容 |
|---|---|
| 目的 | 验证 AC-28：命令在 PATH 上但运行时被平台拒（`13900012`） |
| 步骤 | 经 `bash` 执行：`touch $WS/chmod_probe; chmod 600 $WS/chmod_probe; echo rc=$?`；再执行 `chown 0 $WS/chmod_probe; echo rc=$?` |
| 期望 | `chmod` / `chown` 返回非零（`Permission denied` / `13900012`）；文件权限位未变 |
| 证据 | 工具结果 + 回读 mode |
| 状态 | **`未验证`** |
| 备注 | 与既有实测 `symlink()` / `chmod()` / `chown()` 返回 `13900012`（`cl.filemanagement.2`，SDK 4.1.5.2）一致 |

### TC-D12 `ln -s` 拒绝（围栏缓解项）

| 项 | 内容 |
|---|---|
| 目的 | 验证 AC-24 的缓解前提：符号链接被平台拒 |
| 步骤 | 经 `bash` 执行 `ln -s $WS/target $WS/link; echo rc=$?` |
| 期望 | 非零（symlink denied）；`$WS/link` 不存在 |
| 证据 | 工具结果 + 存在性 |
| 状态 | **`未验证`** |
| 备注 | 这是**缓解**不是保证：FR-3.8 明说不得据此宣称围栏安全 |

### TC-D13 B 类命令仅 `toybox` 可达

| 项 | 内容 |
|---|---|
| 目的 | 验证 A/B 类区分正确（AC-17 的真机面） |
| 步骤 | 经 `bash` 执行 `nc --help`（期望 `command not found`，`127`）与 `toybox nc --help`（期望有输出） |
| 期望 | 直接命令名解析失败（`127`）；经 `toybox` 可调用 |
| 证据 | 两次工具结果 |
| 状态 | **`未验证`** |

### TC-D14 超时与取消

| 项 | 内容 |
|---|---|
| 目的 | 验证 FR-5.2 / FR-5.3 的真机行为（AC-22 的延伸） |
| 步骤 | 1. 设 `commandTimeoutMs` 较低（如 3000），执行 `sleep 30`，观察是否按时返回超时说明、`Exit code` 不伪装成 0<br>2. 执行一条长命令并用 `interrupt` 取消，观察 `[command cancelled]` 与随后会话仍可用 |
| 期望 | 超时/取消均返回标记；随后的 `echo` 仍正常（会话保持同步） |
| 证据 | 工具结果 |
| 状态 | **`未验证`** |
| 备注 | 取消/超时的彻底性受"退出不可观测"限制；重置是最坏路径 |

### TC-D15 既有能力不退化

| 项 | 内容 |
|---|---|
| 目的 | 验证 preset 表相邻条目与既有插件未受牵连（AC-29） |
| 步骤 | 1. 新建会话成功（无 `agent-preset/invalid`）<br>2. 用 `str_replace_editor` 的 `view` 列一个目录<br>3. 用 `fs-mutate` 的 `delete` 删除一个探针文件<br>4. 用 `fs-search` 的 `glob` 搜一个文件<br>5. 用 `skill` 工具加载 `harmony-runtime-capabilities` |
| 期望 | 五项均正常 |
| 证据 | 逐项对话片段 |
| 状态 | **`未验证`** |
| 备注 | 本次改动**触碰了 `HARMONY_ENSURED_PRESET_ROWS` 同一张表**，必须回归 |

---

## 4. 来源核验用例（不依赖设备）

### TC-S1 禁用链的四层出处

| 项 | 内容 |
|---|---|
| 目的 | 核验 spec §1.1 的四层禁用与 PTY 硬约束有源码出处（AC-20） |
| 步骤 | 1. 核对 `profiles/desktop/cordis.patch.yml:36-43` 的四个 `disabled: true`<br>2. 核对 `dsh-web-app/cordis.patch.yml:368-371` 的 `tool-bash` / `tool-pwsh`<br>3. 核对 `src-main/main.js:174-178` 的 `HARMONY_DISABLED_PRESET_ROWS` 三项<br>4. 核对 `node-pty` 在 `dsh-dist` 内为 win32-x64 产物<br>5. 官方 SELinux 受影响清单含 `forkpty` / `openpty`（平台无应用级 PTY API） |
| 期望 | 五条均命中 |
| 证据 | 逐处源码片段 + 官方条目 |

### TC-S2 命令清单的 `[上游]` 出处

| 项 | 内容 |
|---|---|
| 目的 | 核验 A/B/C/D 分类有 OpenHarmony 上游依据（AC-17） |
| 步骤 | 1. 核对 `third_party_toybox` 的 `TOYBOX_VERSION "0.8.12"`<br>2. 核对标准系统 `BUILD.gn` 的 176 源文件 / 223 applet / 206 symlink 计数<br>3. 核对 `toybox.gni:31-35` 的 `toybox_extended_cmd` 默认 `false` 且无公开 product override<br>4. 核对 B 类命令不在 symlink 集合、C 类命令受构建标志控制、D 类命令在 toybox / 内核 / mksh 仓库中不存在<br>5. 核对 `build_selinux` 下 `chcon` 加入、`restorecon` 移除 |
| 期望 | 五条均命中；C 类结论标注 `未验证` |
| 证据 | 上游构建文件片段 + 计数 |

### TC-S3 平台受限项出处

| 项 | 内容 |
|---|---|
| 目的 | 核验 `symlink()` / `chmod()` / `chown()` 被拒（`13900012`）有出处（AC-28 的文档面） |
| 步骤 | 核对 OpenHarmony 文件管理子系统变更 `cl.filemanagement.2`（SDK 4.1.5.2）与 `13900012 Permission denied` 的对应关系 |
| 期望 | 与设备实测一致（TC-D11 交叉验证） |
| 证据 | 变更条目 + 错误码定义 |

### TC-S4 `sh` 身份矛盾的双方出处

| 项 | 内容 |
|---|---|
| 目的 | 核验 FR-4.6 的两说各有出处，且未被文档单方裁定 |
| 步骤 | 1. 设备记录：`readlink /proc/self/exe` 解析为 toybox<br>2. 源码：`third_party_mksh/BUILD.gn:147` 的 `ohos_executable("sh")` 从 mksh R59c 构建；toybox 的 `sh.c` 未编译<br>3. 核对本规范未在文档层给出单向结论 |
| 期望 | 两说均被记录；`spec.md` FR-4.6 明确"不猜、由 TC-D8 裁定" |
| 证据 | 设备记录 + 上游构建文件 |

---

## 5. 用例与验收标准对照

| 验收标准 | 覆盖用例 | 类别 |
|---|---|---|
| AC-1 插件文件齐备 | 目录列举（`find`） | 构建期 |
| AC-2 全工程包名令牌一致性 | TC-B2 | 构建期 |
| AC-3 两处 preset 行逐条一致 | TC-B3, TC-B3b | 构建期 |
| AC-4 `dsh-dist` 含 `harmony-plugin-exec` | TC-B1 | 构建期 |
| AC-5 烘焙 preset + `tool-bash` 仍禁用 | TC-B4 | 构建期 |
| AC-6 哨兵行协议 | TC-U1 | 单元 |
| AC-7 退出码解析 | TC-U3 | 单元 |
| AC-8 stdout/stderr 合流与行边界 | TC-U1, TC-U2 | 单元 |
| AC-9 围栏 fail-closed | TC-U4 | 单元 |
| AC-10 不可判定构造 + 三种模式 | TC-U5 | 单元 |
| AC-11 拒绝先于审批 | TC-D4（真机）、TC-U4/U5（判定面） | 单元 + 真机 |
| AC-12 输出截断 + 排空 | TC-U8 | 单元 |
| AC-13 超时 / 取消 | TC-D14（真机）、TC-U3（退出码不伪装） | 单元 + 真机 |
| AC-14 串行化 | code review + TC-D1（真机） | 构建期 + 真机 |
| AC-15 配置校验 | TC-U9 | 单元 |
| AC-16 静态约束 | TC-B5 | 构建期 |
| AC-17 能力四分类披露 | TC-U7, TC-S2, TC-D13 | 单元 + 来源 + 真机 |
| AC-18 命令策略 + `toybox` 特例 | TC-U6 | 单元 |
| AC-19 默认 `denyCommands` | TC-U6 | 单元 |
| AC-20 不恢复上游 | TC-B6, TC-S1 | 构建期 + 来源 |
| AC-21 无路线图 + 未验证标注 + 技能同步 | TC-B7 | 构建期 |
| AC-22 单常驻 shell 端到端 | TC-D1, TC-D2, TC-D14 | 真机（`未验证`） |
| AC-23 围栏拒绝真实生效且先于审批 | TC-D4 | 真机（`未验证`） |
| AC-24 围栏旁路实证 | TC-D5, TC-D6, TC-D12 | 真机（`未验证`） |
| AC-25 僵尸计数 | TC-D7 | 真机（`未验证`） |
| AC-26 `sh` 身份裁定 | TC-D8, TC-D9, TC-S4 | 真机（`未验证`）+ 来源 |
| AC-27 C 类命令核实 | TC-D10, TC-S2 | 真机（`未验证`）+ 来源 |
| AC-28 `chmod` / `chown` 平台拒绝 | TC-D11, TC-S3 | 真机（`未验证`）+ 来源 |
| AC-29 既有能力不退化 | TC-D15 | 真机（`未验证`） |
| AC-30 工具名 `bash` 与描述披露 | TC-D1 | 真机（`未验证`） |
